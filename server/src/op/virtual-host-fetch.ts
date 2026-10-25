// Only used when TARGET=local — see ./local-rafiki.ts.

import http from 'node:http'

export interface VirtualHostTarget {
  host: string
  port: number
}

/**
 * Rafiki's localenv backend identifies itself with a docker-internal
 * hostname (e.g. `cloud-nine-wallet-backend`, from its OPEN_PAYMENTS_URL env
 * var) — that's the value baked into every wallet address, quote, and
 * payment URL it returns. Rafiki resolves incoming Open Payments requests
 * purely by the `Host` header it receives (see
 * packages/backend/src/open_payments/wallet_address/middleware.ts and
 * open_payments/auth/middleware.ts in the Rafiki repo — there's no reverse
 * proxy or TRUST_PROXY config in the local playground), so a request that
 * physically arrives on the host-published port (e.g. localhost:3000) but
 * carries the wrong Host header won't resolve to the right wallet address
 * and won't pass HTTP Message Signature verification either.
 *
 * Node's fetch/undici silently drops any attempt to override the `Host`
 * header through the standard Headers/Request API (it's a "forbidden
 * header" per the Fetch spec) — verified empirically, not just assumed —
 * so ky (which the Open Payments SDK uses internally) can't be made to send
 * one. This module replaces the global `fetch` with a thin wrapper that, for
 * requests to one of Rafiki's known docker-internal hostnames, opens a raw
 * `http` connection to the real host:port instead and sets the `Host`
 * header on the wire by hand — reproducing what Rafiki's own Bruno API
 * collection does for the same reason (see bruno/collections/Rafiki/scripts.js,
 * `addHostHeader`, in the Rafiki repo).
 */
export function installVirtualHostFetch(hostMap: Record<string, VirtualHostTarget>): void {
  const g = globalThis as typeof globalThis & { __rafikiVirtualHostFetchInstalled?: boolean }
  if (g.__rafikiVirtualHostFetchInstalled) return
  g.__rafikiVirtualHostFetchInstalled = true

  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const target = hostMap[url.hostname]
    if (!target) return originalFetch(request)
    return forwardWithHostOverride(request, url, target)
  }) as typeof fetch
}

async function forwardWithHostOverride(
  request: Request,
  url: URL,
  target: VirtualHostTarget
): Promise<Response> {
  const bodyBuffer = request.body ? Buffer.from(await request.arrayBuffer()) : undefined

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'host') return
    headers[key] = value
  })
  // The whole point: claim the canonical hostname Rafiki expects, with no
  // port, regardless of which host:port we actually connect to.
  headers['host'] = url.hostname

  return new Promise<Response>((resolve, reject) => {
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        path: url.pathname + url.search,
        method: request.method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue
            if (Array.isArray(value)) {
              for (const v of value) responseHeaders.append(key, v)
            } else {
              responseHeaders.set(key, value)
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 200,
              statusText: res.statusMessage,
              headers: responseHeaders
            })
          )
        })
      }
    )
    req.on('error', reject)
    if (bodyBuffer) req.write(bodyBuffer)
    req.end()
  })
}
