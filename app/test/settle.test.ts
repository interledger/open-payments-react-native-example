import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenPaymentsError, type OpenPaymentsClient } from '../src/op/client'
import { completeIncomingPayment, settleCheckout } from '../src/op/checkout'

const USD = (value: string) => ({ value, assetCode: 'USD', assetScale: 2 })
const COP = (value: string) => ({ value, assetCode: 'COP', assetScale: 2 })
const grant = { accessToken: 't1', manageUrl: 'https://auth/manage', continueUri: 'https://auth/continue', continueToken: 'c1' }

function fakeClient(opts: {
  receivedSequence: string[]
  failed?: boolean
  completeError?: OpenPaymentsError
  alreadyCompleted?: boolean
}) {
  const calls: string[] = []
  let reads = 0
  let completed = !!opts.alreadyCompleted
  const client = {
    getOutgoingPayment: async () => {
      calls.push('get-outgoing')
      return {
        id: 'op',
        walletAddress: 'wa',
        receiver: 'https://recv/incoming-payments/ip',
        failed: !!opts.failed,
        debitAmount: USD('397'),
        receiveAmount: COP('1265237'),
        sentAmount: USD('397') // sender's asset, as Rafiki reports it
      }
    },
    getIncomingPayment: async (url: string) => {
      calls.push(`get-incoming:${url.split('/').pop()}`)
      const value = opts.receivedSequence[Math.min(reads++, opts.receivedSequence.length - 1)]
      return { id: url, walletAddress: 'r', completed, receivedAmount: COP(value) }
    },
    requestGrant: async (_url: string, body: { access_token: { access: { actions: string[] }[] } }) => {
      calls.push(`grant:${body.access_token.access[0].actions.join(',')}`)
      return { access_token: { value: 'in', manage: 'm' }, continue: { uri: 'https://recv/continue', access_token: { value: 'ic' } } }
    },
    completeIncomingPayment: async () => {
      calls.push('complete')
      if (opts.completeError) throw opts.completeError
      completed = true
      return { id: 'ip', walletAddress: 'r', completed: true }
    },
    cancelGrant: async () => {
      calls.push('cancel')
    }
  }
  return { client: client as unknown as OpenPaymentsClient, calls }
}

test('cross-currency: waits for the receiver to get the quoted amount, then completes the incoming payment', async () => {
  const { client, calls } = fakeClient({ receivedSequence: ['0', '600000', '1265237'] })
  const result = await settleCheckout(client, { outgoingPaymentId: 'op', grant, receiverAuthServer: 'https://recv', intervalMs: 1 })
  assert.equal(result.state, 'completed')
  assert.equal(result.incomingCompleted, true)
  assert.equal(result.incomingPaymentId, 'https://recv/incoming-payments/ip') // taken from outgoing.receiver
  assert.deepEqual(result.delivered, COP('1265237'))
  assert.equal(calls.filter((c) => c === 'complete').length, 1)
  assert.equal(calls[0], 'grant:read,complete')
  assert.equal(calls.at(-1), 'cancel')
})

test('single pass (timeoutMs 0) while still delivering leaves the incoming payment open', async () => {
  const { client, calls } = fakeClient({ receivedSequence: ['600000'] })
  const result = await settleCheckout(client, { outgoingPaymentId: 'op', grant, receiverAuthServer: 'https://recv', timeoutMs: 0 })
  assert.equal(result.state, 'processing')
  assert.equal(result.incomingCompleted, false)
  assert.ok(!calls.includes('complete'))
})

test('an already-completed incoming payment is not completed twice', async () => {
  const { client, calls } = fakeClient({ receivedSequence: ['1265237'], alreadyCompleted: true })
  const result = await settleCheckout(client, { outgoingPaymentId: 'op', grant, receiverAuthServer: 'https://recv', timeoutMs: 0 })
  assert.equal(result.incomingCompleted, true)
  assert.ok(!calls.includes('complete'))
})

test('failed outgoing payment: no completion', async () => {
  const { client, calls } = fakeClient({ receivedSequence: ['0'], failed: true })
  const result = await settleCheckout(client, { outgoingPaymentId: 'op', grant, receiverAuthServer: 'https://recv' })
  assert.equal(result.state, 'failed')
  assert.ok(!calls.includes('complete'))
})

test('completeIncomingPayment treats 409 on an already-completed payment as done', async () => {
  const { client } = fakeClient({ receivedSequence: ['1'], completeError: new OpenPaymentsError('wrong state', 409), alreadyCompleted: true })
  assert.equal((await completeIncomingPayment(client, 'ip', 'https://recv')).completed, true)
})

test('completeIncomingPayment rethrows 409 when the payment is not completed', async () => {
  const { client } = fakeClient({ receivedSequence: ['1'], completeError: new OpenPaymentsError('wrong state', 409) })
  await assert.rejects(completeIncomingPayment(client, 'ip', 'https://recv'))
})
