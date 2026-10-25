import { installVirtualHostFetch } from './virtual-host-fetch'

/**
 * TARGET=local only. Rafiki's local playground advertises docker-internal
 * hostnames (e.g. `cloud-nine-wallet-backend`) that only resolve inside its
 * Docker network; see ./virtual-host-fetch.ts. Values are the playground's
 * defaults (https://github.com/interledger/rafiki/tree/main/localenv).
 */
const BACKENDS = {
  'cloud-nine-wallet-backend': { host: '127.0.0.1', port: 3000 },
  'happy-life-bank-backend': { host: '127.0.0.1', port: 4000 }
}

const AUTH_REWRITES: Record<string, { hostname: string; port: number }> = {
  'cloud-nine-wallet-auth': { hostname: 'localhost', port: 3006 },
  'happy-life-bank-auth': { hostname: 'localhost', port: 4006 }
}

export function installLocalRafikiNetworking(): void {
  installVirtualHostFetch(BACKENDS)
}

export function resolveLocalAuthServerUrl(url: string): string {
  const parsed = new URL(url)
  const rewrite = AUTH_REWRITES[parsed.hostname]
  if (!rewrite) return url
  parsed.hostname = rewrite.hostname
  parsed.port = String(rewrite.port)
  return parsed.toString()
}
