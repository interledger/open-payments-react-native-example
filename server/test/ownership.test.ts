import { test } from 'node:test'
import assert from 'node:assert/strict'

// config.ts validates env at import time; give it what it needs (no .env in CI).
process.env.CLIENT_WALLET_ADDRESS ??= 'https://ilp.example/app'
process.env.KEY_ID ??= 'test-key'
process.env.PRIVATE_KEY_PATH ??= './data/keys/test.pem'

const { startOwnershipCheck, finishOwnershipCheck } = await import('../src/ownership')
const { computeInteractionHash } = await import('../src/op/interaction-hash')

const WA = 'https://ilp.example/alice'
const AUTH = 'https://auth.example/tenant'

function fakeClient(confirmedId?: string) {
  const requests: unknown[] = []
  const cancelled: string[] = []
  const client = {
    walletAddress: {
      get: async () => ({ id: WA, authServer: AUTH, resourceServer: 'https://ilp.example/t', assetCode: 'USD', assetScale: 2 })
    },
    grant: {
      request: async (_args: unknown, body: unknown) => {
        requests.push(body)
        return {
          interact: { redirect: 'https://auth.example/interact/1/2', finish: 'as-nonce' },
          continue: { uri: 'https://auth.example/continue/1', access_token: { value: 'ct' }, wait: 5 }
        }
      },
      continue: async () => ({
        continue: { uri: 'https://auth.example/continue/1', access_token: { value: 'ct2' } },
        ...(confirmedId ? { subject: { sub_ids: [{ id: confirmedId, format: 'uri' }] } } : {})
      }),
      cancel: async (args: { url: string }) => {
        cancelled.push(args.url)
      }
    }
  }
  return { client: client as never, requests, cancelled }
}

function finishParams(body: unknown, interactRef = 'ref') {
  const nonce = (body as { interact: { finish: { nonce: string } } }).interact.finish.nonce
  return {
    interact_ref: interactRef,
    hash: computeInteractionHash({ clientNonce: nonce, asFinishNonce: 'as-nonce', interactRef, grantEndpointUri: AUTH })
  }
}

test('the backend asks for a subject grant (no access token) with the app finish URI', async () => {
  const { client, requests } = fakeClient(WA)
  const { checkId, redirectUrl } = await startOwnershipCheck(
    { walletAddress: '$ilp.example/alice', finishUri: 'openpayments-rn-example://op/finish' },
    client
  )
  assert.equal(redirectUrl, 'https://auth.example/interact/1/2')
  const body = requests[0] as Record<string, any>
  assert.deepEqual(body.subject, { sub_ids: [{ id: WA, format: 'uri' }] })
  assert.equal(body.access_token, undefined)
  assert.equal(body.interact.finish.uri, `openpayments-rn-example://op/finish?checkId=${checkId}`)
})

test('verified when the hash matches and the wallet echoes the address; one shot', async () => {
  const { client, requests, cancelled } = fakeClient(WA)
  const { checkId } = await startOwnershipCheck({ walletAddress: WA, finishUri: 'openpayments-rn-example://op/finish' }, client)
  const result = await finishOwnershipCheck(checkId, finishParams(requests[0]), client)
  assert.equal(result.walletAddress, WA)
  assert.ok(cancelled.length === 1, 'the finalized grant is cancelled (it has no use)')
  await assert.rejects(finishOwnershipCheck(checkId, finishParams(requests[0]), client), /Unknown or expired/)
})

test('rejected: different confirmed address, forged hash, declined', async () => {
  for (const [confirmed, params, pattern] of [
    ['https://ilp.example/mallory', null, /different address/],
    [WA, { interact_ref: 'ref', hash: 'forged' }, /hash mismatch/],
    [WA, { result: 'grant_rejected' }, /declined/]
  ] as const) {
    const { client, requests } = fakeClient(confirmed)
    const { checkId } = await startOwnershipCheck({ walletAddress: WA, finishUri: 'openpayments-rn-example://op/finish' }, client)
    await assert.rejects(finishOwnershipCheck(checkId, params ?? finishParams(requests[0]), client), pattern)
  }
})

test('refuses finish URIs outside the allowlist', async () => {
  const { client } = fakeClient(WA)
  await assert.rejects(startOwnershipCheck({ walletAddress: WA, finishUri: 'https://evil.example/cb' }, client), /not allowed/)
})
