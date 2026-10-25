import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the `hash` Rafiki appends to the interact.finish redirect — the
 * standard GNAP finish-hash check, but tolerant of the one thing that varies
 * between Rafiki deployments: the last line.
 *
 * Rafiki hashes `${clientNonce}\n${interactNonce}\n${interactRef}\n${grantRequestUrl}`
 * (packages/auth/src/interaction/routes.ts). Since rafiki#3728 that last line
 * is `<AUTH_SERVER_URL>/<tenantId>` with no trailing slash — i.e. the wallet
 * address's `authServer`; older deployments used `<AUTH_SERVER_URL>/`. Like
 * the Web Monetization extension (outgoingPaymentGrant.ts), try the URL we
 * POSTed the grant to as-is first, then with/without a trailing slash.
 */
export function verifyInteractionHash(input: {
  clientNonce: string
  asFinishNonce: string
  interactRef: string
  grantEndpointUri: string
  receivedHash: string
}): boolean {
  return grantEndpointVariants(input.grantEndpointUri).some((uri) =>
    safeEqual(computeInteractionHash({ ...input, grantEndpointUri: uri }), input.receivedHash)
  )
}

export function computeInteractionHash(input: {
  clientNonce: string
  asFinishNonce: string
  interactRef: string
  grantEndpointUri: string
}): string {
  const data = `${input.clientNonce}\n${input.asFinishNonce}\n${input.interactRef}\n${input.grantEndpointUri}`
  return createHash('sha256').update(data).digest('base64')
}

function grantEndpointVariants(uri: string): string[] {
  const withoutSlash = uri.replace(/\/+$/, '')
  return [...new Set([uri, withoutSlash, `${withoutSlash}/`])]
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer)
}
