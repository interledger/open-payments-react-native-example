// Byte/string helpers that work the same in Hermes (React Native), browsers and
// Node — no Buffer. Hermes ships btoa/atob/TextEncoder.

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Parses the query string of a URL by hand — Hermes' URL implementation
 * doesn't support searchParams reliably, and the finish redirect may use a
 * custom scheme (openpayments-rn-example://…).
 */
export function parseQuery(url: string): Record<string, string> {
  const query = url.split('#')[0].split('?')[1] ?? ''
  const params: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const [key, value = ''] = pair.split('=')
    params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '))
  }
  return params
}
