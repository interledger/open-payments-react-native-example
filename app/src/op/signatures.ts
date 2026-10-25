import { sha512 } from '@noble/hashes/sha2.js'
import { toBase64, utf8 } from './encoding'
import { sign, type DeviceKey } from './keys'

/**
 * HTTP Message Signatures (RFC 9421) as Open Payments requires them — a port
 * of @interledger/http-signature-utils createHeaders() and the Web Monetization
 * extension's createSignatureHeaders(), without Node crypto:
 *
 *   label `sig1`, params `keyid` + `created`, covering `@method`,
 *   `@target-uri`, `authorization` (if present) and — for requests with a
 *   body — `content-digest`, `content-length`, `content-type`.
 *
 * test/signatures.test.ts checks the output against the reference validator.
 */
export interface SignableRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export function signRequest(key: DeviceKey, request: SignableRequest, now = Date.now()): Record<string, string> {
  const headers: Record<string, string> = lowercaseKeys(request.headers)

  if (request.body !== undefined) {
    const canonical = JSON.stringify(JSON.parse(request.body))
    headers['content-digest'] = `sha-512=:${toBase64(sha512(utf8(canonical)))}:`
    headers['content-length'] = String(utf8(request.body).length)
    headers['content-type'] = 'application/json'
  }

  const components = ['@method', '@target-uri']
  if (headers['authorization']) components.push('authorization')
  if (request.body !== undefined) components.push('content-digest', 'content-length', 'content-type')

  const created = Math.floor(now / 1000)
  const params = `(${components.map((c) => `"${c}"`).join(' ')});keyid="${key.keyId}";created=${created}`

  const lines = components.map((component) => {
    if (component === '@method') return `"@method": ${request.method.toUpperCase()}`
    if (component === '@target-uri') return `"@target-uri": ${request.url}`
    return `"${component}": ${headers[component]}`
  })
  const signatureBase = [...lines, `"@signature-params": ${params}`].join('\n')

  headers['signature-input'] = `sig1=${params}`
  headers['signature'] = `sig1=:${toBase64(sign(key, utf8(signatureBase)))}:`
  return headers
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
}
