import {
  OpenPaymentsError,
  type IncomingPayment,
  type OpenPaymentsClient,
  type OutgoingPayment
} from './client'
import type { PaymentGrant } from './checkout'

export type PaymentState = 'completed' | 'processing' | 'failed'

/**
 * Open Payments exposes no explicit state on an outgoing payment, so derive it:
 *  - `failed` is set on failure;
 *  - delivery is judged on the **receiver's** side: the incoming payment's
 *    `receivedAmount` reaching the quoted `receiveAmount` (both in the
 *    receiver's asset). Don't compare `sentAmount` with `receiveAmount` —
 *    Rafiki reports `sentAmount` in the *sender's* asset, so cross-currency
 *    payments would never look done;
 *  - without the receiver's view, fall back to `sentAmount` ≥ `debitAmount`
 *    (same asset; can under-report when the debit includes fees).
 */
export function paymentState(
  payment: Pick<OutgoingPayment, 'failed' | 'sentAmount' | 'debitAmount' | 'receiveAmount'>,
  incoming?: Pick<IncomingPayment, 'receivedAmount'>
): PaymentState {
  if (payment.failed) return 'failed'
  const received = incoming?.receivedAmount
  if (received && received.assetCode === payment.receiveAmount.assetCode) {
    return BigInt(received.value) >= BigInt(payment.receiveAmount.value) ? 'completed' : 'processing'
  }
  const sent = payment.sentAmount
  if (sent && sent.assetCode === payment.debitAmount.assetCode) {
    return BigInt(sent.value) >= BigInt(payment.debitAmount.value) && BigInt(sent.value) > 0n ? 'completed' : 'processing'
  }
  return 'processing'
}

/**
 * Reads the payment with its (kept) grant. GNAP access tokens live 10 minutes;
 * on 401 / 403 "Inactive Token" rotate via the manage URL — allowed while the
 * grant is alive, even after the token expired — and retry once. Returns the
 * possibly-rotated grant so the caller can persist it.
 */
export async function fetchOutgoingPayment(
  client: OpenPaymentsClient,
  outgoingPaymentUrl: string,
  grant: PaymentGrant
): Promise<{ payment: OutgoingPayment; grant: PaymentGrant; rotated: boolean }> {
  try {
    const payment = await client.getOutgoingPayment(outgoingPaymentUrl, grant.accessToken)
    return { payment, grant, rotated: false }
  } catch (error) {
    if (!isExpiredToken(error)) throw error
    const { access_token } = await client.rotateToken(grant.manageUrl, grant.accessToken)
    const next = { ...grant, accessToken: access_token.value, manageUrl: access_token.manage }
    const payment = await client.getOutgoingPayment(outgoingPaymentUrl, next.accessToken)
    return { payment, grant: next, rotated: true }
  }
}

function isExpiredToken(error: unknown): boolean {
  if (!(error instanceof OpenPaymentsError)) return false
  return error.status === 401 || (error.status === 403 && /inactive token/i.test(error.description ?? ''))
}
