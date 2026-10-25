import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { validateSignature, validateSignatureHeaders } from '@interledger/http-signature-utils'
import { keyFromSeed, publicJwk } from '../src/op/keys'
import { signRequest } from '../src/op/signatures'

// Our on-device signer must produce exactly what Rafiki's auth/resource
// servers accept — checked against the reference validator they use.
const key = keyFromSeed(new Uint8Array(randomBytes(32)), 'test-key-id')
const jwk = publicJwk(key)

async function assertValid(request: { method: string; url: string; headers: Record<string, string>; body?: string }) {
  const headers = signRequest(key, request)
  const requestLike = { method: request.method, url: request.url, headers, body: request.body }
  assert.ok(validateSignatureHeaders(requestLike), 'signature headers are well-formed')
  assert.ok(await validateSignature(jwk as never, requestLike), 'signature verifies with the JWK')
  return headers
}

test('GET without authorization', async () => {
  const headers = await assertValid({ method: 'GET', url: 'https://ilp.example/alice', headers: { accept: 'application/json' } })
  assert.match(headers['signature-input'], /^sig1=\("@method" "@target-uri"\);keyid="test-key-id";created=\d+$/)
})

test('POST grant request with body', async () => {
  const body = JSON.stringify({ access_token: { access: [{ type: 'quote', actions: ['create'] }] }, client: 'https://ilp.example/alice' })
  const headers = await assertValid({ method: 'POST', url: 'https://auth.example/tenant', headers: {}, body })
  assert.match(headers['content-digest'], /^sha-512=:[A-Za-z0-9+/]+=*:$/)
  assert.equal(headers['content-length'], String(Buffer.byteLength(body)))
  assert.ok(headers['signature-input'].includes('"content-digest" "content-length" "content-type"'))
})

test('POST with GNAP authorization and non-ASCII body', async () => {
  const body = JSON.stringify({ metadata: { description: 'café ☕' } })
  const headers = await assertValid({
    method: 'POST',
    url: 'https://ilp.example/t/outgoing-payments',
    headers: { Authorization: 'GNAP abc123' },
    body
  })
  assert.ok(headers['signature-input'].includes('"authorization"'))
  assert.equal(headers['content-length'], String(Buffer.byteLength(body)))
})

test('DELETE with authorization, no body', async () => {
  await assertValid({ method: 'DELETE', url: 'https://auth.example/continue/xyz', headers: { authorization: 'GNAP t' } })
})

test('tampered request fails verification', async () => {
  const request = { method: 'POST', url: 'https://auth.example/t', headers: {}, body: '{"a":1}' }
  const headers = signRequest(key, request)
  assert.equal(
    await validateSignature(jwk as never, { ...request, url: 'https://auth.example/other', headers }),
    false
  )
})
