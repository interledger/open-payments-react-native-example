import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { toBase64, toBase64Url, utf8 } from './encoding'

// Synchronous SHA-512 so signing works without WebCrypto (Hermes has none).
ed.hashes.sha512 = sha512

/**
 * The phone's Open Payments identity — same shape as the Web Monetization
 * extension's key (src/shared/crypto.ts + services/wallet.ts generateKeys):
 * a raw 32-byte Ed25519 secret, a UUID key id, and an OKP JWK registered on
 * the user's own wallet address.
 */
export interface DeviceKey {
  keyId: string
  privateKey: Uint8Array
}

export interface Jwk {
  kid: string
  kty: 'OKP'
  crv: 'Ed25519'
  alg: 'EdDSA'
  x: string
}

/** `seed` must be 32 cryptographically random bytes (expo-crypto on device). */
export function keyFromSeed(seed: Uint8Array, keyId: string): DeviceKey {
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes')
  return { keyId, privateKey: seed }
}

export function publicJwk(key: DeviceKey): Jwk {
  return {
    kid: key.keyId,
    kty: 'OKP',
    crv: 'Ed25519',
    alg: 'EdDSA',
    x: toBase64Url(ed.getPublicKey(key.privateKey))
  }
}

/** The format the test wallet's upload-key endpoint expects: base64(JSON(jwk)). */
export function base64Jwk(key: DeviceKey): string {
  return toBase64(utf8(JSON.stringify(publicJwk(key))))
}

export function sign(key: DeviceKey, data: Uint8Array): Uint8Array {
  return ed.sign(data, key.privateKey)
}
