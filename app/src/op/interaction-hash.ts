import { sha256 } from '@noble/hashes/sha2.js'
import { toBase64, utf8 } from './encoding'

/**
 * Same check as server/src/op/interaction-hash.ts, without Node crypto.
 * Rafiki hashes `${clientNonce}\n${interactNonce}\n${interactRef}\n${grantRequestUrl}`
 * (padded standard base64); the last line is the wallet address's
 * `authServer` (incl. tenant, no trailing slash) on current Rafiki and
 * `<authServerUrl>/` on older ones, so try the variants — as the Web
 * Monetization extension does.
 */
export function computeInteractionHash(input: {
  clientNonce: string
  asFinishNonce: string
  interactRef: string
  grantEndpointUri: string
}): string {
  const data = `${input.clientNonce}\n${input.asFinishNonce}\n${input.interactRef}\n${input.grantEndpointUri}`
  return toBase64(sha256(utf8(data)))
}

export function verifyInteractionHash(input: {
  clientNonce: string
  asFinishNonce: string
  interactRef: string
  grantEndpointUri: string
  receivedHash: string
}): boolean {
  const withoutSlash = input.grantEndpointUri.replace(/\/+$/, '')
  const variants = [...new Set([input.grantEndpointUri, withoutSlash, `${withoutSlash}/`])]
  return variants.some(
    (grantEndpointUri) =>
      constantTimeEqual(computeInteractionHash({ ...input, grantEndpointUri }), input.receivedHash)
  )
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
