import { randomUUID } from 'node:crypto'
import { isFinalizedGrantWithAccessToken, isPendingGrant } from '@interledger/open-payments'
import { CONFIG } from './config'
import { getClient, normalizeWalletAddress, resolveAuthServerUrl } from './op/client'
import { verifyInteractionHash } from './op/interaction-hash'
import { describeError, isInsufficientGrantError, isTokenExpiredError } from './op/errors'
import { formatAmount, toMinorUnits } from './amount'
import { HttpError, pickFinishUri } from './http'
import {
  createConnection,
  getConnection,
  listPayments,
  recordPayment,
  updateConnection,
  type Connection
} from './db'

/**
 * Step 1 of "connect once": request ONE interactive grant covering quotes +
 * outgoing payments up to a budget — the same shape as the Web Monetization
 * extension's createOutgoingPaymentGrant(). Returns the URL the phone must
 * open in the system auth browser (ASWebAuthenticationSession / Custom Tabs).
 * Whether the user then sees the wallet's login page or goes straight to
 * consent depends only on that browser's wallet session cookie.
 */
export async function startConnection(input: {
  walletAddress: string
  amount: string
  recurring: boolean
  finishUri?: string
}): Promise<{ connectionId: string; redirectUrl: string; finishUri: string }> {
  const connectionId = randomUUID()
  const finishUri = withQuery(pickFinishUri(input.finishUri), { connectionId })

  const client = await getClient()
  const walletAddress = await client.walletAddress.get({ url: normalizeWalletAddress(input.walletAddress) })

  const debitAmount = {
    value: toMinorUnits(input.amount, walletAddress.assetScale),
    assetCode: walletAddress.assetCode,
    assetScale: walletAddress.assetScale
  }
  // A repeating ISO 8601 interval makes the wallet reset the budget every
  // month server-side — no re-consent needed (WM extension: toAmount()).
  const interval = input.recurring ? `R/${new Date().toISOString()}/P1M` : null

  const clientNonce = randomUUID()
  const grantEndpoint = resolveAuthServerUrl(walletAddress.authServer)

  const grant = await client.grant.request(
    { url: grantEndpoint },
    {
      access_token: {
        access: [
          { type: 'quote', actions: ['create', 'read'] },
          {
            type: 'outgoing-payment',
            actions: ['create', 'read', 'list'],
            identifier: walletAddress.id,
            limits: { debitAmount, ...(interval ? { interval } : {}) }
          }
        ]
      },
      interact: {
        start: ['redirect'],
        finish: { method: 'redirect', uri: finishUri, nonce: clientNonce }
      }
    }
  )
  if (!isPendingGrant(grant)) {
    throw new Error('Expected an interactive grant for outgoing payments, got a finalized one')
  }

  createConnection({
    id: connectionId,
    walletAddress: walletAddress.id,
    authServer: walletAddress.authServer,
    resourceServer: walletAddress.resourceServer,
    assetCode: walletAddress.assetCode,
    assetScale: walletAddress.assetScale,
    debitLimit: debitAmount.value,
    interval,
    clientNonce,
    asFinishNonce: grant.interact.finish,
    grantEndpoint,
    continueUri: grant.continue.uri,
    continueToken: grant.continue.access_token.value
  })
  log(connectionId, `grant requested at ${grantEndpoint} → user must visit interact.redirect`)

  return { connectionId, redirectUrl: grant.interact.redirect, finishUri }
}

/**
 * Step 2: the phone hands back the query string from the finish redirect
 * (`openpayments-rn-example://op/finish?connectionId=…&hash=…&interact_ref=…`, or
 * `?result=grant_rejected` etc.). Verify the hash, then continue the grant.
 */
export async function finishConnection(
  connectionId: string,
  params: { interact_ref?: string; hash?: string; result?: string; message?: string }
): Promise<Connection> {
  const connection = requireConnection(connectionId)
  if (connection.status !== 'pending') return connection

  if (params.result || !params.interact_ref || !params.hash) {
    const rejected = params.result === 'grant_rejected'
    return updateConnection(connectionId, {
      status: rejected ? 'rejected' : 'failed',
      error: params.message ?? params.result ?? 'Missing interact_ref/hash in finish redirect'
    })
  }

  const hashOk = verifyInteractionHash({
    clientNonce: connection.clientNonce,
    asFinishNonce: connection.asFinishNonce,
    interactRef: params.interact_ref,
    grantEndpointUri: connection.grantEndpoint,
    receivedHash: params.hash
  })
  if (!hashOk) {
    updateConnection(connectionId, { status: 'failed', error: 'Interaction hash verification failed' })
    throw new HttpError(400, 'Interaction hash verification failed — this redirect may not be genuine')
  }

  const client = await getClient()
  const grant = await client.grant.continue(
    { url: connection.continueUri, accessToken: connection.continueToken },
    { interact_ref: params.interact_ref }
  )
  if (!isFinalizedGrantWithAccessToken(grant)) {
    return updateConnection(connectionId, { status: 'failed', error: 'Grant continuation returned no access token' })
  }

  log(connectionId, 'grant approved and continued — connected')
  return updateConnection(connectionId, {
    status: 'connected',
    accessToken: grant.access_token.value,
    manageUrl: grant.access_token.manage,
    // The continuation response carries a fresh continue token; keep it for cancel().
    continueUri: grant.continue.uri,
    continueToken: grant.continue.access_token.value,
    error: null
  })
}

/**
 * Pay without any UI: incoming payment on the receiver's side (its own
 * non-interactive grant), then quote + outgoing payment with the stored token.
 */
export async function pay(
  connectionId: string,
  input: { receiver: string; amount: string }
): Promise<{ outgoingPaymentUrl: string; debitAmount: string; receiveAmount: string }> {
  const connection = requireConnected(connectionId)
  const client = await getClient()

  const receiver = await client.walletAddress.get({ url: normalizeWalletAddress(input.receiver) })
  const incomingGrant = await client.grant.request(
    { url: resolveAuthServerUrl(receiver.authServer) },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read'] }] } }
  )
  if (isPendingGrant(incomingGrant) || !isFinalizedGrantWithAccessToken(incomingGrant)) {
    throw new Error("Receiver's wallet unexpectedly required interaction for an incoming payment grant")
  }
  const incomingPayment = await client.incomingPayment.create(
    { url: receiver.resourceServer, accessToken: incomingGrant.access_token.value },
    { walletAddress: receiver.id }
  )

  const debitAmount = {
    value: toMinorUnits(input.amount, connection.assetScale),
    assetCode: connection.assetCode,
    assetScale: connection.assetScale
  }

  try {
    const outgoingPayment = await withAccessToken(connectionId, async (accessToken) => {
      const quote = await client.quote.create(
        { url: connection.resourceServer, accessToken },
        { walletAddress: connection.walletAddress, receiver: incomingPayment.id, method: 'ilp', debitAmount }
      )
      return client.outgoingPayment.create(
        { url: connection.resourceServer, accessToken },
        { walletAddress: connection.walletAddress, quoteId: quote.id, metadata: { description: 'open-payments-react-native-example' } }
      )
    })

    recordPayment({
      id: randomUUID(),
      connectionId,
      receiver: receiver.id,
      outgoingPaymentUrl: outgoingPayment.id,
      debitAmount: formatAmount(outgoingPayment.debitAmount),
      receiveAmount: formatAmount(outgoingPayment.receiveAmount),
      createdAt: new Date().toISOString()
    })
    log(connectionId, `paid ${formatAmount(outgoingPayment.debitAmount)} → ${receiver.id}`)
    return {
      outgoingPaymentUrl: outgoingPayment.id,
      debitAmount: formatAmount(outgoingPayment.debitAmount),
      receiveAmount: formatAmount(outgoingPayment.receiveAmount)
    }
  } catch (error) {
    if (isInsufficientGrantError(error)) {
      // Budget used up: the only fix is a new interactive grant (consent again).
      throw new HttpError(403, 'This payment exceeds the remaining budget — reconnect with a new budget')
    }
    throw error
  }
}

export async function getConnectionView(connectionId: string) {
  const connection = requireConnection(connectionId)
  let spent: string | null = null
  if (connection.status === 'connected') {
    try {
      const client = await getClient()
      const amounts = await withAccessToken(connectionId, (accessToken) =>
        client.outgoingPayment.getGrantSpentAmounts({ url: connection.resourceServer, accessToken })
      )
      spent = formatAmount(
        amounts.spentDebitAmount ?? {
          value: '0',
          assetCode: connection.assetCode,
          assetScale: connection.assetScale
        }
      )
    } catch (error) {
      log(connectionId, `could not read spent amounts: ${describeError(error)}`)
    }
  }
  const latest = requireConnection(connectionId)
  return {
    id: latest.id,
    status: latest.status,
    walletAddress: latest.walletAddress,
    budget: formatAmount({ value: latest.debitLimit, assetCode: latest.assetCode, assetScale: latest.assetScale }),
    recurring: latest.interval !== null,
    spent,
    tokenRotations: latest.tokenRotations,
    error: latest.error,
    payments: listPayments(connectionId)
  }
}

export async function disconnect(connectionId: string): Promise<void> {
  const connection = requireConnection(connectionId)
  if (connection.status === 'connected' || connection.status === 'pending') {
    try {
      const client = await getClient()
      await client.grant.cancel({ url: connection.continueUri, accessToken: connection.continueToken })
    } catch (error) {
      // Already revoked/expired is fine — same tolerance as the WM extension's disconnect.
      log(connectionId, `grant cancel failed (ignored): ${describeError(error)}`)
    }
  }
  updateConnection(connectionId, { status: 'disconnected', accessToken: null, manageUrl: null })
  log(connectionId, 'disconnected (grant cancelled)')
}

/**
 * Runs `fn` with the connection's access token; if the resource server says
 * the token is expired/inactive, rotates it once via the manage URL and
 * retries. No user involvement — this is what keeps the app "connected"
 * beyond the 10-minute token lifetime (WM extension: rotateToken()).
 */
async function withAccessToken<T>(connectionId: string, fn: (accessToken: string) => Promise<T>): Promise<T> {
  const connection = requireConnected(connectionId)
  try {
    return await fn(connection.accessToken!)
  } catch (error) {
    if (!isTokenExpiredError(error)) throw error
    const rotated = await rotateToken(connection)
    return fn(rotated.accessToken!)
  }
}

const rotations = new Map<string, Promise<Connection>>()

function rotateToken(connection: Connection): Promise<Connection> {
  // De-duplicate concurrent rotations: rotating revokes the old token, so two
  // parallel rotations would invalidate each other.
  let inFlight = rotations.get(connection.id)
  if (!inFlight) {
    inFlight = (async () => {
      const client = await getClient()
      const { access_token } = await client.token.rotate({
        url: connection.manageUrl!,
        accessToken: connection.accessToken!
      })
      log(connection.id, `access token rotated (#${connection.tokenRotations + 1})`)
      return updateConnection(connection.id, {
        accessToken: access_token.value,
        manageUrl: access_token.manage,
        tokenRotations: connection.tokenRotations + 1
      })
    })().finally(() => rotations.delete(connection.id))
    rotations.set(connection.id, inFlight)
  }
  return inFlight
}

function requireConnection(id: string): Connection {
  const connection = getConnection(id)
  if (!connection) throw new HttpError(404, 'Unknown connection')
  return connection
}

function requireConnected(id: string): Connection {
  const connection = requireConnection(id)
  if (connection.status !== 'connected' || !connection.accessToken || !connection.manageUrl) {
    throw new HttpError(409, `Connection is ${connection.status}, not connected`)
  }
  return connection
}

function withQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function log(connectionId: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${connectionId.slice(0, 8)}] ${message}`)
}
