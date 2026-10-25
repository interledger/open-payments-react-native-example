import type { DeviceKey } from './keys'
import { signRequest } from './signatures'

/**
 * A minimal Open Payments client for the phone: plain fetch + RFC 9421
 * signatures with the device key. The official @interledger/open-payments SDK
 * depends on Node crypto/pino, so — like the Web Monetization extension, which
 * signs in its own interceptor — the app signs requests itself. The GNAP client
 * identity is the user's own wallet address, whose JWKS lists the device key.
 */

export interface Amount {
  value: string
  assetCode: string
  assetScale: number
}

export interface WalletAddress {
  id: string
  publicName?: string
  assetCode: string
  assetScale: number
  authServer: string
  resourceServer: string
}

export interface AccessToken {
  value: string
  manage: string
  expires_in?: number
}

export interface PendingGrant {
  interact: { redirect: string; finish: string }
  continue: { access_token: { value: string }; uri: string; wait?: number }
}

export interface FinalizedGrant {
  access_token?: AccessToken
  continue: { access_token: { value: string }; uri: string }
  /** Present on subject grants ("verify wallet address ownership"). */
  subject?: { sub_ids: { id: string; format: string }[] }
}

export interface IncomingPayment {
  id: string
  walletAddress: string
  completed?: boolean
  incomingAmount?: Amount
  receivedAmount?: Amount
  expiresAt?: string
}

export interface Quote {
  id: string
  walletAddress: string
  receiver: string
  debitAmount: Amount
  receiveAmount: Amount
}

export interface OutgoingPayment {
  id: string
  walletAddress: string
  /** The incoming payment this pays into. */
  receiver: string
  failed?: boolean
  debitAmount: Amount
  receiveAmount: Amount
  sentAmount: Amount
  createdAt?: string
}

export class OpenPaymentsError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public description?: string
  ) {
    super(message)
  }
}

export class OpenPaymentsClient {
  constructor(
    /** The client identity: the user's wallet address URL. */
    private readonly clientWalletAddress: string,
    private readonly key: DeviceKey
  ) {}

  getWalletAddress(url: string): Promise<WalletAddress> {
    return this.unsigned<WalletAddress>(normalizeWalletAddress(url))
  }

  getJwks(walletAddressUrl: string): Promise<{ keys: { kid: string }[] }> {
    return this.unsigned(`${normalizeWalletAddress(walletAddressUrl).replace(/\/$/, '')}/jwks.json`)
  }

  requestGrant(authServer: string, body: Record<string, unknown>): Promise<PendingGrant | FinalizedGrant> {
    return this.signed('POST', authServer, { ...body, client: this.clientWalletAddress })
  }

  continueGrant(continueUri: string, continueToken: string, interactRef: string): Promise<FinalizedGrant> {
    return this.signed('POST', continueUri, { interact_ref: interactRef }, continueToken)
  }

  cancelGrant(continueUri: string, continueToken: string): Promise<void> {
    return this.signed('DELETE', continueUri, undefined, continueToken)
  }

  rotateToken(manageUrl: string, accessToken: string): Promise<{ access_token: AccessToken }> {
    return this.signed('POST', manageUrl, undefined, accessToken)
  }

  createIncomingPayment(resourceServer: string, accessToken: string, walletAddress: string): Promise<IncomingPayment> {
    return this.signed('POST', `${trimSlash(resourceServer)}/incoming-payments`, { walletAddress }, accessToken)
  }

  getIncomingPayment(incomingPaymentUrl: string, accessToken: string): Promise<IncomingPayment> {
    return this.signed('GET', incomingPaymentUrl, undefined, accessToken)
  }

  /**
   * Tells the receiver's wallet no more money is coming to this incoming
   * payment (POST {id}/complete). Needed when it was created without an
   * incomingAmount — as here, where the sender fixes the debit amount —
   * otherwise it stays open until it expires.
   */
  completeIncomingPayment(incomingPaymentUrl: string, accessToken: string): Promise<IncomingPayment> {
    return this.signed('POST', `${trimSlash(incomingPaymentUrl)}/complete`, undefined, accessToken)
  }

  createQuote(
    resourceServer: string,
    accessToken: string,
    body: { walletAddress: string; receiver: string; method: 'ilp'; debitAmount: Amount }
  ): Promise<Quote> {
    return this.signed('POST', `${trimSlash(resourceServer)}/quotes`, body, accessToken)
  }

  createOutgoingPayment(
    resourceServer: string,
    accessToken: string,
    body: { walletAddress: string; quoteId: string; metadata?: Record<string, unknown> }
  ): Promise<OutgoingPayment> {
    return this.signed('POST', `${trimSlash(resourceServer)}/outgoing-payments`, body, accessToken)
  }

  getOutgoingPayment(outgoingPaymentUrl: string, accessToken: string): Promise<OutgoingPayment> {
    return this.signed('GET', outgoingPaymentUrl, undefined, accessToken)
  }

  private async unsigned<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    return parseResponse<T>('GET', url, response)
  }

  private async signed<T>(method: string, url: string, body?: unknown, gnapToken?: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (gnapToken) headers['authorization'] = `GNAP ${gnapToken}`
    const bodyText = body === undefined ? undefined : JSON.stringify(body)
    const signedHeaders = signRequest(this.key, { method, url, headers, body: bodyText })
    // content-length is covered by the signature but set by fetch itself
    // (it's a forbidden header in browsers).
    const { 'content-length': _contentLength, ...sendHeaders } = signedHeaders
    const response = await fetch(url, { method, headers: sendHeaders, body: bodyText })
    return parseResponse<T>(method, url, response)
  }
}

async function parseResponse<T>(method: string, url: string, response: Response): Promise<T> {
  const text = await response.text()
  const json = text ? safeJson(text) : undefined
  if (!response.ok) {
    const error = (json as { error?: { code?: string; description?: string }; message?: string } | undefined) ?? {}
    const description = error.error?.description ?? error.message ?? text.slice(0, 200)
    throw new OpenPaymentsError(
      `${method} ${url} failed (${response.status})${description ? `: ${description}` : ''}`,
      response.status,
      error.error?.code,
      description
    )
  }
  return json as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Accepts `$ilp.interledger-test.dev/alice` as well as full URLs. */
export function normalizeWalletAddress(input: string): string {
  const trimmed = input.trim()
  return trimmed.startsWith('$') ? `https://${trimmed.slice(1)}` : trimmed
}

export function isPendingGrant(grant: PendingGrant | FinalizedGrant): grant is PendingGrant {
  return 'interact' in grant && !!(grant as PendingGrant).interact
}
