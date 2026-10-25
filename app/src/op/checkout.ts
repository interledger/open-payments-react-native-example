import {
  OpenPaymentsClient,
  OpenPaymentsError,
  isPendingGrant,
  normalizeWalletAddress,
  type Amount,
  type IncomingPayment,
  type WalletAddress
} from './client'
import { verifyInteractionHash } from './interaction-hash'
import { fetchOutgoingPayment, paymentState, type PaymentState } from './payment-status'

/**
 * A normal "checkout / send" — one interactive grant per payment, scoped to
 * exactly this quote and receiver. The usual Open Payments send sequence, run
 * from the phone with the device key:
 *
 *   prepareCheckout:  receiver incoming payment (non-interactive grant)
 *                     → sender quote (non-interactive grant)
 *                     → interactive outgoing-payment grant  ⇒ redirectUrl
 *   [user approves in the wallet's consent screen]
 *   completeCheckout: verify hash → continue grant → create outgoing payment
 *                     (the spent grant is returned, so the app can read status)
 *   settleCheckout:   wait for the outgoing payment to deliver, then mark the
 *                     receiver's incoming payment complete (POST …/complete)
 */

export interface PendingCheckout {
  sender: { id: string; resourceServer: string; publicName?: string }
  receiver: { id: string; publicName?: string; authServer: string }
  incomingPaymentId: string
  quoteId: string
  debitAmount: Amount
  receiveAmount: Amount
  clientNonce: string
  asFinishNonce: string
  grantEndpoint: string
  continueUri: string
  continueToken: string
  finishUri: string
}

/**
 * The per-payment grant, kept after paying so the app can read the payment's
 * live status later. It can't move more money: its limits are exactly this
 * (already spent) quote to this incoming payment.
 */
export interface PaymentGrant {
  accessToken: string
  manageUrl: string
  continueUri: string
  continueToken: string
}

export interface CheckoutResult {
  outgoingPaymentId: string
  debitAmount: Amount
  receiveAmount: Amount
  grant: PaymentGrant
  /** The receiver-side incoming payment, to complete once delivered. */
  incomingPaymentId: string
  receiverAuthServer: string
}

export type CheckoutStep = 'wallet-addresses' | 'incoming-payment' | 'quote' | 'grant'

export async function prepareCheckout(
  client: OpenPaymentsClient,
  input: {
    senderWalletAddress: string
    receiverWalletAddress: string
    /** In the sender's asset, already in minor units (see toMinorUnits). */
    debitValue: string
    finishUri: string
    nonce: string
    onStep?: (step: CheckoutStep) => void
  }
): Promise<{ redirectUrl: string; pending: PendingCheckout }> {
  input.onStep?.('wallet-addresses')
  const [sender, receiver] = await Promise.all([
    client.getWalletAddress(input.senderWalletAddress),
    client.getWalletAddress(input.receiverWalletAddress)
  ])

  input.onStep?.('incoming-payment')
  const incomingGrant = await client.requestGrant(receiver.authServer, {
    access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }] }
  })
  if (isPendingGrant(incomingGrant) || !incomingGrant.access_token) {
    throw new Error("The receiver's wallet asked for interaction on an incoming-payment grant")
  }
  const incomingPayment = await client.createIncomingPayment(
    receiver.resourceServer,
    incomingGrant.access_token.value,
    receiver.id
  )

  input.onStep?.('quote')
  const quoteGrant = await client.requestGrant(sender.authServer, {
    access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] }
  })
  if (isPendingGrant(quoteGrant) || !quoteGrant.access_token) {
    throw new Error('Your wallet asked for interaction on a quote grant')
  }
  const quote = await client.createQuote(sender.resourceServer, quoteGrant.access_token.value, {
    walletAddress: sender.id,
    receiver: incomingPayment.id,
    method: 'ilp',
    debitAmount: { value: input.debitValue, assetCode: sender.assetCode, assetScale: sender.assetScale }
  })

  input.onStep?.('grant')
  const grant = await client.requestGrant(sender.authServer, {
    access_token: {
      access: [
        {
          type: 'outgoing-payment',
          actions: ['create', 'read'],
          identifier: sender.id,
          // Exactly this payment: the quoted amount, to this incoming payment.
          limits: { debitAmount: quote.debitAmount, receiver: incomingPayment.id }
        }
      ]
    },
    interact: {
      start: ['redirect'],
      finish: { method: 'redirect', uri: input.finishUri, nonce: input.nonce }
    }
  })
  if (!isPendingGrant(grant)) throw new Error('Expected the outgoing-payment grant to need consent')

  return {
    redirectUrl: grant.interact.redirect,
    pending: {
      sender: pick(sender),
      receiver: { id: receiver.id, publicName: receiver.publicName, authServer: receiver.authServer },
      incomingPaymentId: incomingPayment.id,
      quoteId: quote.id,
      debitAmount: quote.debitAmount,
      receiveAmount: quote.receiveAmount,
      clientNonce: input.nonce,
      asFinishNonce: grant.interact.finish,
      grantEndpoint: sender.authServer,
      continueUri: grant.continue.uri,
      continueToken: grant.continue.access_token.value,
      finishUri: input.finishUri
    }
  }
}

export class CheckoutRejectedError extends Error {}

/** `params` = the query string of the finish redirect, parsed. */
export async function completeCheckout(
  client: OpenPaymentsClient,
  pending: PendingCheckout,
  params: Record<string, string>
): Promise<CheckoutResult> {
  if (params.result || !params.interact_ref || !params.hash) {
    // Best effort: the grant is dead anyway once rejected.
    await client.cancelGrant(pending.continueUri, pending.continueToken).catch(() => undefined)
    if (params.result === 'grant_rejected') throw new CheckoutRejectedError('You declined the payment in your wallet')
    throw new Error(params.message ?? params.result ?? 'The wallet returned without approving')
  }

  const genuine = verifyInteractionHash({
    clientNonce: pending.clientNonce,
    asFinishNonce: pending.asFinishNonce,
    interactRef: params.interact_ref,
    grantEndpointUri: pending.grantEndpoint,
    receivedHash: params.hash
  })
  if (!genuine) throw new Error('Interaction hash mismatch — the redirect may not come from your wallet')

  const grant = await client.continueGrant(pending.continueUri, pending.continueToken, params.interact_ref)
  if (!grant.access_token) throw new Error('Grant continuation returned no access token')

  const payment = await client.createOutgoingPayment(pending.sender.resourceServer, grant.access_token.value, {
    walletAddress: pending.sender.id,
    quoteId: pending.quoteId,
    metadata: { description: 'open-payments-react-native-example checkout' }
  })

  return {
    outgoingPaymentId: payment.id,
    debitAmount: payment.debitAmount,
    receiveAmount: payment.receiveAmount,
    incomingPaymentId: pending.incomingPaymentId,
    receiverAuthServer: pending.receiver.authServer,
    grant: {
      accessToken: grant.access_token.value,
      manageUrl: grant.access_token.manage,
      continueUri: grant.continue.uri,
      continueToken: grant.continue.access_token.value
    }
  }
}

/**
 * Receiver-side access for settling: incoming-payment grants are
 * non-interactive, so a fresh `[read, complete]` grant is requested when
 * needed — no token has to be kept. Rafiki lets the client that created an
 * incoming payment read and complete it.
 */
async function withIncomingGrant<T>(
  client: OpenPaymentsClient,
  receiverAuthServer: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const grant = await client.requestGrant(receiverAuthServer, {
    access_token: { access: [{ type: 'incoming-payment', actions: ['read', 'complete'] }] }
  })
  if (isPendingGrant(grant) || !grant.access_token) {
    throw new Error("The receiver's wallet asked for interaction on an incoming-payment grant")
  }
  try {
    return await fn(grant.access_token.value)
  } finally {
    await client.cancelGrant(grant.continue.uri, grant.continue.access_token.value).catch(() => undefined)
  }
}

/** POST {incomingPayment}/complete. Idempotent: 409 "wrong state" + already completed = done. */
async function completeWithToken(
  client: OpenPaymentsClient,
  incomingPaymentId: string,
  accessToken: string
): Promise<IncomingPayment> {
  try {
    return await client.completeIncomingPayment(incomingPaymentId, accessToken)
  } catch (error) {
    if (!(error instanceof OpenPaymentsError && error.status === 409)) throw error
    const current = await client.getIncomingPayment(incomingPaymentId, accessToken)
    if (!current.completed) throw error
    return current
  }
}

/** Marks the receiver's incoming payment complete (fresh grant, see above). */
export function completeIncomingPayment(
  client: OpenPaymentsClient,
  incomingPaymentId: string,
  receiverAuthServer: string
): Promise<IncomingPayment> {
  return withIncomingGrant(client, receiverAuthServer, (token) => completeWithToken(client, incomingPaymentId, token))
}

export interface SettleResult {
  state: PaymentState
  /** Sender side, in the sender's asset. */
  sent: Amount
  /** Receiver side, in the receiver's asset (from the incoming payment). */
  delivered?: Amount
  grant: PaymentGrant
  incomingPaymentId: string
  incomingCompleted: boolean
}

/**
 * After creating the outgoing payment: watch delivery on the receiver's side
 * (incoming payment `receivedAmount` vs the quoted `receiveAmount`) and, once
 * delivered, mark the incoming payment complete — it was created without an
 * `incomingAmount` (the sender fixed the debit), so the receiver's wallet
 * can't close it by itself. Also detects a failed outgoing payment. With
 * `timeoutMs: 0` it does a single pass (used by the History detail page).
 */
export async function settleCheckout(
  client: OpenPaymentsClient,
  input: {
    outgoingPaymentId: string
    grant: PaymentGrant
    receiverAuthServer: string
    /** Optional: taken from the outgoing payment's `receiver` otherwise. */
    incomingPaymentId?: string
    timeoutMs?: number
    intervalMs?: number
  }
): Promise<SettleResult> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000)
  let grant = input.grant
  return withIncomingGrant(client, input.receiverAuthServer, async (incomingToken) => {
    for (;;) {
      const read = await fetchOutgoingPayment(client, input.outgoingPaymentId, grant)
      grant = read.grant
      const incomingPaymentId = input.incomingPaymentId ?? read.payment.receiver
      const incoming = await client.getIncomingPayment(incomingPaymentId, incomingToken)
      const state = paymentState(read.payment, incoming)
      const result = (incomingCompleted: boolean): SettleResult => ({
        state,
        sent: read.payment.sentAmount,
        delivered: incoming.receivedAmount,
        grant,
        incomingPaymentId,
        incomingCompleted
      })
      if (state === 'completed') {
        const completed = incoming.completed || (await completeWithToken(client, incomingPaymentId, incomingToken)).completed
        return result(!!completed)
      }
      if (state === 'failed' || Date.now() >= deadline) return result(!!incoming.completed)
      await new Promise((r) => setTimeout(r, input.intervalMs ?? 1000))
    }
  })
}

function pick(wa: WalletAddress) {
  return { id: wa.id, resourceServer: wa.resourceServer, publicName: wa.publicName }
}

export { normalizeWalletAddress }
