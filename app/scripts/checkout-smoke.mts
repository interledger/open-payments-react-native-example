/**
 * Runs the app's on-device checkout code (src/op/*) from Node against the real
 * Interledger Test Wallet — same requests the phone makes, minus the UI.
 *
 *   npm run smoke -- --receiver '$ilp.interledger-test.dev/bob' [--amount 0.01] [--prepare-only]
 *   npm run smoke -- --receiver '$ilp.interledger-test.dev/bob' --complete-incoming <incoming payment URL>
 *
 * Sender/key default to server's .env (CLIENT_WALLET_ADDRESS, KEY_ID,
 * PRIVATE_KEY_PATH) since that key is already registered on the test wallet.
 * It prints the consent URL; approve it in a browser and the wallet redirects
 * to a temporary http://localhost:3999/finish listener, which completes the
 * payment.
 */
import { createPrivateKey, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { OpenPaymentsClient } from '../src/op/client'
import { completeCheckout, completeIncomingPayment, prepareCheckout, settleCheckout } from '../src/op/checkout'
import { formatAmount, toMinorUnits } from '../src/op/amount'
import { keyFromSeed } from '../src/op/keys'
import { parseQuery } from '../src/op/encoding'

const { values } = parseArgs({
  options: {
    receiver: { type: 'string' },
    amount: { type: 'string', default: '0.01' },
    sender: { type: 'string' },
    'prepare-only': { type: 'boolean', default: false },
    'complete-incoming': { type: 'string' }
  }
})

const serverDir = path.resolve(import.meta.dirname, '../../server')
const env = Object.fromEntries(
  readFileSync(path.join(serverDir, '.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
)

const sender = values.sender ?? env.CLIENT_WALLET_ADDRESS
if (!values.receiver) throw new Error('--receiver is required')

// PEM (Node) → raw 32-byte seed (what the phone stores in SecureStore).
const pem = readFileSync(path.resolve(serverDir, env.PRIVATE_KEY_PATH), 'utf8')
const d = createPrivateKey(pem).export({ format: 'jwk' }).d!
const key = keyFromSeed(new Uint8Array(Buffer.from(d, 'base64url')), env.KEY_ID)

const client = new OpenPaymentsClient(sender, key)

if (values['complete-incoming']) {
  const receiverWa = await client.getWalletAddress(values.receiver)
  const incoming = await completeIncomingPayment(client, values['complete-incoming'], receiverWa.authServer)
  console.log(`Incoming payment ${incoming.id}: completed=${incoming.completed}, received ${incoming.receivedAmount ? formatAmount(incoming.receivedAmount) : '?'}`)
  process.exit(0)
}
const finishUri = 'http://localhost:3999/finish'

const senderWa = await client.getWalletAddress(sender)
const { redirectUrl, pending } = await prepareCheckout(client, {
  senderWalletAddress: sender,
  receiverWalletAddress: values.receiver,
  debitValue: toMinorUnits(values.amount!, senderWa.assetScale),
  finishUri,
  nonce: randomUUID(),
  onStep: (step) => console.log(`… ${step}`)
})

console.log(`\nQuote: debit ${formatAmount(pending.debitAmount)} → receiver gets ${formatAmount(pending.receiveAmount)}`)
console.log(`Incoming payment: ${pending.incomingPaymentId}`)
console.log(`\nOpen this to approve:\n${redirectUrl}\n`)

if (values['prepare-only']) {
  console.log('--prepare-only: not waiting for consent (the pending grant expires in 10 min).')
  process.exit(0)
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/finish')) return void res.writeHead(404).end()
  res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Back from the wallet — you can close this tab.</p>')
  server.close()
  try {
    const result = await completeCheckout(client, pending, parseQuery(req.url))
    console.log(`✅ Paid ${formatAmount(result.debitAmount)} (receiver gets ${formatAmount(result.receiveAmount)})`)
    console.log(`Outgoing payment: ${result.outgoingPaymentId}`)
    const settled = await settleCheckout(client, {
      outgoingPaymentId: result.outgoingPaymentId,
      grant: result.grant,
      incomingPaymentId: result.incomingPaymentId,
      receiverAuthServer: result.receiverAuthServer
    })
    console.log(`Outgoing: ${settled.state}, sent ${formatAmount(settled.sent)}, delivered ${settled.delivered ? formatAmount(settled.delivered) : '?'}`)
    console.log(`Incoming payment ${result.incomingPaymentId}: ${settled.incomingCompleted ? 'completed ✅' : 'still open'}`)
    // The app keeps this grant to read status later; the script has no use for it.
    await client.cancelGrant(settled.grant.continueUri, settled.grant.continueToken).catch(() => undefined)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
})
server.listen(3999, () => console.log('Waiting for the finish redirect on http://localhost:3999/finish …'))
