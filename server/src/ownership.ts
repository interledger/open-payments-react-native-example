import { randomUUID } from 'node:crypto'
import {
  isFinalizedGrantWithSubject,
  isPendingGrant,
  type AuthenticatedClient
} from '@interledger/open-payments'
import { getClient, normalizeWalletAddress, resolveAuthServerUrl } from './op/client'
import { verifyInteractionHash } from './op/interaction-hash'
import { HttpError, pickFinishUri } from './http'

/**
 * Step 1 of onboarding: "verify wallet address ownership"
 * (https://openpayments.dev/guides/verify-wallet-address-ownership/), done by
 * the app's backend BEFORE the phone creates or registers any key.
 *
 * Why the backend: an interactive grant must be signed by a client whose key
 * is already published. The phone has no key on the user's wallet yet, and
 * Rafiki refuses inline `client: { jwk }` for interactive grants. The backend
 * has its own wallet address + key (CLIENT_WALLET_ADDRESS), so it can ask the
 * user's wallet "does this user own this address?" right away. The grant
 * carries a `subject` and no access token, so it gives no payment rights.
 */

type OwnershipClient = Pick<AuthenticatedClient, 'walletAddress' | 'grant'>

interface PendingCheck {
  walletAddress: string
  grantEndpoint: string
  clientNonce: string
  asFinishNonce: string
  continueUri: string
  continueToken: string
  expiresAt: number
}

// Interactions expire after 10 minutes on Rafiki; keep pending checks in
// memory for a bit longer. A restart only means the user has to start again.
const PENDING_TTL_MS = 15 * 60 * 1000
const pending = new Map<string, PendingCheck>()

export async function startOwnershipCheck(
  input: { walletAddress: string; finishUri?: string },
  client: OwnershipClient | Promise<OwnershipClient> = getClient()
): Promise<{ checkId: string; redirectUrl: string; walletAddress: string }> {
  const op = await client
  const checkId = randomUUID()
  const finishUri = withQuery(pickFinishUri(input.finishUri), { checkId })
  const walletAddress = await op.walletAddress.get({ url: normalizeWalletAddress(input.walletAddress) })
  const grantEndpoint = resolveAuthServerUrl(walletAddress.authServer)
  const clientNonce = randomUUID()

  const grant = await op.grant.request(
    { url: grantEndpoint },
    {
      subject: { sub_ids: [{ id: walletAddress.id, format: 'uri' }] },
      interact: {
        start: ['redirect'],
        finish: { method: 'redirect', uri: finishUri, nonce: clientNonce }
      }
    }
  )
  if (!isPendingGrant(grant)) throw new Error('Expected the ownership check to need interaction')

  prune()
  pending.set(checkId, {
    walletAddress: walletAddress.id,
    grantEndpoint,
    clientNonce,
    asFinishNonce: grant.interact.finish,
    continueUri: grant.continue.uri,
    continueToken: grant.continue.access_token.value,
    expiresAt: Date.now() + PENDING_TTL_MS
  })
  log(checkId, `ownership check started for ${walletAddress.id} → user must confirm in the wallet`)
  return { checkId, redirectUrl: grant.interact.redirect, walletAddress: walletAddress.id }
}

/**
 * Step 2: the app hands back the finish redirect's query. Verify the hash,
 * continue the grant, and check the wallet confirmed the same address.
 */
export async function finishOwnershipCheck(
  checkId: string,
  params: { interact_ref?: string; hash?: string; result?: string; message?: string },
  client: OwnershipClient | Promise<OwnershipClient> = getClient()
): Promise<{ walletAddress: string; verifiedAt: string }> {
  const check = pending.get(checkId)
  if (!check || check.expiresAt < Date.now()) throw new HttpError(404, 'Unknown or expired ownership check — start again')
  pending.delete(checkId) // one shot, success or not

  const op = await client
  if (params.result || !params.interact_ref || !params.hash) {
    log(checkId, `not confirmed: ${params.result ?? 'missing interact_ref/hash'}`)
    await op.grant.cancel({ url: check.continueUri, accessToken: check.continueToken }).catch(() => undefined)
    throw new HttpError(
      403,
      params.result === 'grant_rejected' ? 'You declined the request in your wallet' : (params.message ?? 'Ownership not confirmed')
    )
  }
  const genuine = verifyInteractionHash({
    clientNonce: check.clientNonce,
    asFinishNonce: check.asFinishNonce,
    interactRef: params.interact_ref,
    grantEndpointUri: check.grantEndpoint,
    receivedHash: params.hash
  })
  if (!genuine) throw new HttpError(400, 'Interaction hash mismatch — the redirect may not come from the wallet')

  const grant = await op.grant.continue(
    { url: check.continueUri, accessToken: check.continueToken },
    { interact_ref: params.interact_ref }
  )
  // Rafiki echoes the confirmed subject. The docs' example shows a finalized
  // grant without it, so a successful continuation alone also counts.
  if (isFinalizedGrantWithSubject(grant)) {
    const ids = grant.subject.sub_ids.map((s) => s.id)
    if (!ids.includes(check.walletAddress)) {
      throw new HttpError(403, `The wallet confirmed a different address: ${ids[0]}`)
    }
  }
  if ('continue' in grant && grant.continue) {
    await op.grant.cancel({ url: grant.continue.uri, accessToken: grant.continue.access_token.value }).catch(() => undefined)
  }
  log(checkId, `ownership confirmed for ${check.walletAddress}`)
  return { walletAddress: check.walletAddress, verifiedAt: new Date().toISOString() }
}

function log(checkId: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [own ${checkId.slice(0, 8)}] ${message}`)
}

function prune(): void {
  const now = Date.now()
  for (const [id, check] of pending) if (check.expiresAt < now) pending.delete(id)
}

function withQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}
