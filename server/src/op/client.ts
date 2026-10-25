import { createAuthenticatedClient, type AuthenticatedClient } from '@interledger/open-payments'
import { CONFIG } from '../config'
import { installLocalRafikiNetworking, resolveLocalAuthServerUrl } from './local-rafiki'

if (CONFIG.target === 'local') installLocalRafikiNetworking()

let client: Promise<AuthenticatedClient> | undefined

/**
 * The single GNAP client for the whole backend: every request is signed with
 * CONFIG.privateKeyPath and identifies itself as CONFIG.clientWalletAddress.
 * That wallet address's `publicName` is the app name users see on the
 * consent screen.
 */
export function getClient(): Promise<AuthenticatedClient> {
  client ??= createAuthenticatedClient({
    walletAddressUrl: CONFIG.clientWalletAddress,
    privateKey: CONFIG.privateKeyPath,
    keyId: CONFIG.keyId,
    // Rafiki's local playground has no TLS.
    useHttp: CONFIG.target === 'local',
    validateResponses: true,
    logLevel: 'silent'
  })
  return client
}

/** The URL to POST grant requests to, given a wallet address's `authServer`. */
export function resolveAuthServerUrl(authServer: string): string {
  return CONFIG.target === 'local' ? resolveLocalAuthServerUrl(authServer) : authServer
}

/**
 * Accepts `$ilp.interledger-test.dev/alice` payment-pointer style input as well
 * as full wallet address URLs.
 */
export function normalizeWalletAddress(input: string): string {
  const trimmed = input.trim()
  return trimmed.startsWith('$') ? `https://${trimmed.slice(1)}` : trimmed
}
