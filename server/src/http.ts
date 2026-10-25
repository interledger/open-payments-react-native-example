import { CONFIG } from './config'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * Rafiki accepts any URI as interact.finish.uri, so the allowlist lives here:
 * only redirect to the app's own scheme (or dev equivalents), never to an
 * arbitrary URL a caller supplies.
 */
export function pickFinishUri(requested: string | undefined): string {
  if (!requested) return CONFIG.appFinishUri
  let parsed: URL
  try {
    parsed = new URL(requested)
  } catch {
    throw new HttpError(400, `finishUri is not a URI: ${requested}`)
  }
  // No userinfo: `http://localhost:80@evil.example/` would pass a prefix check.
  const allowed =
    !parsed.username &&
    !parsed.password &&
    CONFIG.allowedFinishUriPrefixes.some((prefix) => requested.startsWith(prefix))
  if (!allowed) throw new HttpError(400, `finishUri not allowed: ${requested}`)
  return requested
}
