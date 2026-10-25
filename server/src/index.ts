import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { CONFIG } from './config'
import { describeError } from './op/errors'
import { HttpError } from './http'
import { finishOwnershipCheck, startOwnershipCheck } from './ownership'
import {
  disconnect,
  finishConnection,
  getConnectionView,
  pay,
  startConnection
} from './connections'

/**
 * The phone app's API. A PoC: connection ids act as bearer handles. A real
 * app must authenticate its own users and bind each connection to one.
 */
const app = express()
app.use(express.json())
// Expo web runs on another origin (localhost:8081). Fine for a PoC; a real
// backend would restrict this.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return void res.status(204).end()
  next()
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, target: CONFIG.target, client: CONFIG.clientWalletAddress })
})

const connectBody = z.object({
  walletAddress: z.string().min(1),
  amount: z.string().min(1),
  recurring: z.boolean().default(false),
  finishUri: z.string().optional()
})

// Onboarding step 1 (Checkout tab): the backend, as GNAP client, asks the
// user's wallet to confirm they own the address — before the phone has a key.
const ownershipBody = z.object({ walletAddress: z.string().min(1), finishUri: z.string().optional() })

app.post('/ownership-checks', async (req, res) => {
  res.status(201).json(await startOwnershipCheck(ownershipBody.parse(req.body)))
})

app.post('/ownership-checks/:id/finish', async (req, res) => {
  res.json(await finishOwnershipCheck(req.params.id, finishBody.parse(req.body)))
})

app.post('/connections', async (req, res) => {
  res.status(201).json(await startConnection(connectBody.parse(req.body)))
})

const finishBody = z.object({
  interact_ref: z.string().optional(),
  hash: z.string().optional(),
  result: z.string().optional(),
  message: z.string().optional()
})

app.post('/connections/:id/finish', async (req, res) => {
  await finishConnection(req.params.id, finishBody.parse(req.body))
  res.json(await getConnectionView(req.params.id))
})

app.get('/connections/:id', async (req, res) => {
  res.json(await getConnectionView(req.params.id))
})

const payBody = z.object({ receiver: z.string().min(1), amount: z.string().min(1) })

app.post('/connections/:id/payments', async (req, res) => {
  res.status(201).json(await pay(req.params.id, payBody.parse(req.body)))
})

app.delete('/connections/:id', async (req, res) => {
  await disconnect(req.params.id)
  res.status(204).end()
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 502
  const message = error instanceof z.ZodError ? error.issues.map((i) => i.message).join('; ') : describeError(error)
  console.error(`[error ${status}] ${message}`)
  res.status(status).json({ error: message })
})

app.listen(CONFIG.port, () => {
  console.log(
    `mobile server on http://localhost:${CONFIG.port} — target=${CONFIG.target}, client=${CONFIG.clientWalletAddress}`
  )
})
