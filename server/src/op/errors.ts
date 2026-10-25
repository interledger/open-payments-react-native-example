import { OpenPaymentsClientError } from '@interledger/open-payments'

/**
 * An expired or rotated-away access token. Rafiki's resource server answers
 * 401 "Invalid Token" or 403 "Inactive Token"
 * (packages/backend/src/open_payments/auth/middleware.ts) — the same two
 * cases the Web Monetization extension's `isTokenExpiredError` rotates on.
 * Distinct from 403 "unauthorized", which means the grant's limits are used up.
 */
export function isTokenExpiredError(error: unknown): boolean {
  if (!(error instanceof OpenPaymentsClientError)) return false
  if (error.status === 401) return true
  return error.status === 403 && /inactive token/i.test(error.description ?? '')
}

/** 403 "unauthorized" from outgoing-payment create: the grant's limits are exhausted. */
export function isInsufficientGrantError(error: unknown): boolean {
  return (
    error instanceof OpenPaymentsClientError &&
    error.status === 403 &&
    !isTokenExpiredError(error)
  )
}

export function describeError(error: unknown): string {
  if (error instanceof OpenPaymentsClientError) {
    return [error.message, error.description, error.status && `(${error.status})`]
      .filter(Boolean)
      .join(' — ')
  }
  return error instanceof Error ? error.message : String(error)
}
