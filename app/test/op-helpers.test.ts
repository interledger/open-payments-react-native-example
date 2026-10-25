import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { base64Jwk, keyFromSeed, publicJwk, sign } from '../src/op/keys'
import { computeInteractionHash, verifyInteractionHash } from '../src/op/interaction-hash'
import { parseQuery } from '../src/op/encoding'
import { formatAmount, toMinorUnits } from '../src/op/amount'

test('JWK matches the shape the test wallet upload-key endpoint validates', () => {
  const key = keyFromSeed(new Uint8Array(randomBytes(32)), 'kid-1')
  const jwk = publicJwk(key)
  assert.deepEqual(Object.keys(jwk).sort(), ['alg', 'crv', 'kid', 'kty', 'x'])
  assert.equal(jwk.kty, 'OKP')
  assert.equal(jwk.crv, 'Ed25519')
  assert.match(jwk.x, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(JSON.parse(Buffer.from(base64Jwk(key), 'base64').toString()), jwk)
})

test('signatures verify with Node crypto via the exported JWK', () => {
  const key = keyFromSeed(new Uint8Array(randomBytes(32)), 'kid-2')
  const message = new TextEncoder().encode('hello')
  const publicKey = createPublicKey({ key: publicJwk(key) as never, format: 'jwk' })
  assert.ok(verify(null, message, publicKey, sign(key, message)))
})

test('interaction hash matches the Node implementation and tolerates slash variants', () => {
  const input = { clientNonce: 'c', asFinishNonce: 'a', interactRef: 'r', grantEndpointUri: 'https://auth.example/t1' }
  const nodeHash = createHash('sha256').update('c\na\nr\nhttps://auth.example/t1').digest('base64')
  assert.equal(computeInteractionHash(input), nodeHash)
  assert.ok(verifyInteractionHash({ ...input, grantEndpointUri: 'https://auth.example/t1/', receivedHash: nodeHash }))
  assert.equal(verifyInteractionHash({ ...input, interactRef: 'x', receivedHash: nodeHash }), false)
})

test('parseQuery handles custom schemes and encoded base64', () => {
  const params = parseQuery('openpayments-rn-example://op/finish?hash=ab%2Bc%2F%3D&interact_ref=r-1')
  assert.deepEqual(params, { hash: 'ab+c/=', interact_ref: 'r-1' })
  assert.deepEqual(parseQuery('openpayments-rn-example://op/finish?result=grant_rejected'), { result: 'grant_rejected' })
})

test('amounts', () => {
  assert.equal(toMinorUnits('12.5', 2), '1250')
  assert.equal(toMinorUnits('0,05', 2), '5')
  assert.throws(() => toMinorUnits('0', 2))
  assert.throws(() => toMinorUnits('1.234', 2))
  assert.equal(formatAmount({ value: '5', assetCode: 'USD', assetScale: 2 }), '0.05 USD')
})

test('paymentState: delivery is judged on the receiver side (cross-currency)', async () => {
  const { paymentState } = await import('../src/op/payment-status')
  // The real case that broke: 3.97 USD → 12652.37 COP. Rafiki reports
  // sentAmount in the SENDER's asset, so sent (USD) vs receive (COP) never matches.
  const payment = {
    failed: false,
    debitAmount: { value: '397', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '1265237', assetCode: 'COP', assetScale: 2 },
    sentAmount: { value: '397', assetCode: 'USD', assetScale: 2 }
  }
  const received = (value: string) => ({ receivedAmount: { value, assetCode: 'COP', assetScale: 2 } })
  assert.equal(paymentState(payment, received('1265237')), 'completed')
  assert.equal(paymentState(payment, received('1265300')), 'completed') // fixed-send may over-deliver slightly
  assert.equal(paymentState(payment, received('600000')), 'processing')
  // Without the receiver's view: sentAmount vs debitAmount, same asset.
  assert.equal(paymentState(payment), 'completed')
  assert.equal(paymentState({ ...payment, sentAmount: { ...payment.sentAmount, value: '0' } }), 'processing')
  assert.equal(paymentState({ ...payment, failed: true }, received('1265237')), 'failed')
})
