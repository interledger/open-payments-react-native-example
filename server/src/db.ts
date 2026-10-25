import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config'

mkdirSync(path.dirname(CONFIG.databaseFile), { recursive: true })
const db = new Database(CONFIG.databaseFile)
db.pragma('journal_mode = WAL')

/**
 * One row per "connected wallet". Everything needed to keep the user
 * connected without ever showing them a browser again — the same set the
 * Web Monetization extension keeps in storage.local (GrantDetails):
 * access token + manage URL (for rotation) and continue URI + token (for
 * cancellation). In a real app these belong to an authenticated app user.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,              -- pending | connected | rejected | failed | disconnected
    wallet_address TEXT NOT NULL,
    auth_server TEXT NOT NULL,
    resource_server TEXT NOT NULL,
    asset_code TEXT NOT NULL,
    asset_scale INTEGER NOT NULL,
    debit_limit TEXT NOT NULL,
    interval TEXT,
    client_nonce TEXT NOT NULL,
    as_finish_nonce TEXT NOT NULL,
    grant_endpoint TEXT NOT NULL,
    continue_uri TEXT NOT NULL,
    continue_token TEXT NOT NULL,
    access_token TEXT,
    manage_url TEXT,
    token_rotations INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id),
    receiver TEXT NOT NULL,
    outgoing_payment_url TEXT,
    debit_amount TEXT NOT NULL,
    receive_amount TEXT,
    created_at TEXT NOT NULL
  );
`)

export type ConnectionStatus = 'pending' | 'connected' | 'rejected' | 'failed' | 'disconnected'

export interface Connection {
  id: string
  status: ConnectionStatus
  walletAddress: string
  authServer: string
  resourceServer: string
  assetCode: string
  assetScale: number
  debitLimit: string
  interval: string | null
  clientNonce: string
  asFinishNonce: string
  grantEndpoint: string
  continueUri: string
  continueToken: string
  accessToken: string | null
  manageUrl: string | null
  tokenRotations: number
  error: string | null
  createdAt: string
  updatedAt: string
}

const COLUMNS: Record<keyof Connection, string> = {
  id: 'id',
  status: 'status',
  walletAddress: 'wallet_address',
  authServer: 'auth_server',
  resourceServer: 'resource_server',
  assetCode: 'asset_code',
  assetScale: 'asset_scale',
  debitLimit: 'debit_limit',
  interval: 'interval',
  clientNonce: 'client_nonce',
  asFinishNonce: 'as_finish_nonce',
  grantEndpoint: 'grant_endpoint',
  continueUri: 'continue_uri',
  continueToken: 'continue_token',
  accessToken: 'access_token',
  manageUrl: 'manage_url',
  tokenRotations: 'token_rotations',
  error: 'error',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
}

const SELECT = `SELECT ${Object.entries(COLUMNS)
  .map(([key, column]) => `${column} AS ${key}`)
  .join(', ')} FROM connections`

export function createConnection(
  input: Omit<Connection, 'status' | 'accessToken' | 'manageUrl' | 'tokenRotations' | 'error' | 'createdAt' | 'updatedAt'>
): Connection {
  const now = new Date().toISOString()
  const row: Connection = {
    ...input,
    status: 'pending',
    accessToken: null,
    manageUrl: null,
    tokenRotations: 0,
    error: null,
    createdAt: now,
    updatedAt: now
  }
  const keys = Object.keys(COLUMNS) as (keyof Connection)[]
  db.prepare(
    `INSERT INTO connections (${keys.map((k) => COLUMNS[k]).join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`
  ).run(row)
  return row
}

export function getConnection(id: string): Connection | undefined {
  return db.prepare(`${SELECT} WHERE id = ?`).get(id) as Connection | undefined
}

export function updateConnection(
  id: string,
  patch: Partial<Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>>
): Connection {
  const entries = Object.entries(patch) as [keyof Connection, unknown][]
  const sets = [...entries.map(([key]) => `${COLUMNS[key]} = @${key}`), 'updated_at = @updatedAt']
  db.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = @id`).run({
    ...patch,
    id,
    updatedAt: new Date().toISOString()
  })
  return getConnection(id)!
}

export interface PaymentRecord {
  id: string
  connectionId: string
  receiver: string
  outgoingPaymentUrl: string | null
  debitAmount: string
  receiveAmount: string | null
  createdAt: string
}

export function recordPayment(payment: PaymentRecord): void {
  db.prepare(
    `INSERT INTO payments (id, connection_id, receiver, outgoing_payment_url, debit_amount, receive_amount, created_at)
     VALUES (@id, @connectionId, @receiver, @outgoingPaymentUrl, @debitAmount, @receiveAmount, @createdAt)`
  ).run(payment)
}

export function listPayments(connectionId: string): PaymentRecord[] {
  return db
    .prepare(
      `SELECT id, connection_id AS connectionId, receiver, outgoing_payment_url AS outgoingPaymentUrl,
              debit_amount AS debitAmount, receive_amount AS receiveAmount, created_at AS createdAt
       FROM payments WHERE connection_id = ? ORDER BY created_at DESC`
    )
    .all(connectionId) as PaymentRecord[]
}
