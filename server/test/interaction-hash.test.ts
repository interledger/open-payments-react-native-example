import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInteractionHash, verifyInteractionHash } from '../src/op/interaction-hash'

const base = { clientNonce: 'client-nonce', asFinishNonce: 'as-nonce', interactRef: 'ref-123' }

test('matches a hash computed over the exact grant endpoint (current Rafiki: authServer incl. tenant)', () => {
  const grantEndpointUri = 'https://auth.interledger-test.dev/tenant-1'
  const receivedHash = computeInteractionHash({ ...base, grantEndpointUri })
  assert.ok(verifyInteractionHash({ ...base, grantEndpointUri, receivedHash }))
})

test('accepts the legacy trailing-slash form when we posted to the bare URL', () => {
  const receivedHash = computeInteractionHash({ ...base, grantEndpointUri: 'https://auth.example/' })
  assert.ok(verifyInteractionHash({ ...base, grantEndpointUri: 'https://auth.example', receivedHash }))
})

test('accepts the no-trailing-slash form when we posted to a URL ending in /', () => {
  const receivedHash = computeInteractionHash({ ...base, grantEndpointUri: 'https://auth.example/t1' })
  assert.ok(verifyInteractionHash({ ...base, grantEndpointUri: 'https://auth.example/t1/', receivedHash }))
})

test('matches Rafiki: padded standard base64 of sha-256', () => {
  const hash = computeInteractionHash({ ...base, grantEndpointUri: 'https://auth.example/t1' })
  assert.match(hash, /^[A-Za-z0-9+/]{43}=$/)
})

test('rejects a hash for a different interact_ref', () => {
  const grantEndpointUri = 'https://auth.example/t1'
  const receivedHash = computeInteractionHash({ ...base, interactRef: 'other', grantEndpointUri })
  assert.equal(verifyInteractionHash({ ...base, grantEndpointUri, receivedHash }), false)
})

test('rejects a hash for a different auth server', () => {
  const receivedHash = computeInteractionHash({ ...base, grantEndpointUri: 'https://evil.example/t1' })
  assert.equal(
    verifyInteractionHash({ ...base, grantEndpointUri: 'https://auth.example/t1', receivedHash }),
    false
  )
})
