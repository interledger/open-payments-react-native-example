import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { fromHex, toHex } from '../op/encoding'
import type { PaymentGrant } from '../op/checkout'
import { keyFromSeed, type DeviceKey } from '../op/keys'

/**
 * Model B storage: the Ed25519 private key lives only on this device, in the
 * Keychain (iOS) / Keystore-backed storage (Android) via expo-secure-store.
 * (The Secure Enclave can't hold Ed25519 keys, so Keychain is the best we get.)
 * On web there is no secure store — localStorage, dev only.
 */

export interface DeviceAccount {
  walletAddress: string
  keyId: string
  privateKeyHex: string
  /** When the user's wallet confirmed ownership (subject grant, done by the backend — server/src/ownership.ts). */
  verifiedAt?: string
}

export interface Contact {
  id: string
  name: string
  walletAddress: string
  publicName?: string
  assetCode?: string
}

export interface PaymentRecord {
  /** The outgoing payment URL (its Open Payments id). */
  id: string
  contactName: string
  receiver: string
  debit: string
  receive: string
  createdAt: string
  /** Last status read from the wallet (see op/payment-status.ts). */
  state?: 'completed' | 'processing' | 'failed'
  /** Sender side (sender's asset). */
  sent?: string
  /** Receiver side (receiver's asset), from the incoming payment. */
  delivered?: string
  checkedAt?: string
  /** Receiver-side incoming payment, completed once the outgoing one delivers. */
  incomingPaymentId?: string
  receiverAuthServer?: string
  incomingCompleted?: boolean
}

const ACCOUNT_KEY = 'deviceAccount'
const CONTACTS_KEY = 'contacts'
const HISTORY_KEY = 'history'

export async function loadAccount(): Promise<DeviceAccount | null> {
  const raw = await secureGet(ACCOUNT_KEY)
  return raw ? (JSON.parse(raw) as DeviceAccount) : null
}

/**
 * Creates the device key for a wallet address the user has just proven they
 * own (`verifiedAt`). Reuses the existing key if it already belongs to it.
 */
export async function createAccount(walletAddress: string, verifiedAt: string): Promise<DeviceAccount> {
  const existing = await loadAccount()
  if (existing?.walletAddress === walletAddress) {
    const updated = { ...existing, verifiedAt }
    await secureSet(ACCOUNT_KEY, JSON.stringify(updated))
    return updated
  }
  const account: DeviceAccount = {
    walletAddress,
    keyId: Crypto.randomUUID(),
    privateKeyHex: toHex(Crypto.getRandomBytes(32)),
    verifiedAt
  }
  await secureSet(ACCOUNT_KEY, JSON.stringify(account))
  return account
}

export async function markVerified(verifiedAt: string): Promise<DeviceAccount | null> {
  const account = await loadAccount()
  if (!account) return null
  const next = { ...account, verifiedAt }
  await secureSet(ACCOUNT_KEY, JSON.stringify(next))
  return next
}

export async function resetAccount(): Promise<void> {
  await secureSet(ACCOUNT_KEY, null)
}

export function deviceKeyOf(account: DeviceAccount): DeviceKey {
  return keyFromSeed(fromHex(account.privateKeyHex), account.keyId)
}

export async function loadContacts(): Promise<Contact[]> {
  return JSON.parse((await AsyncStorage.getItem(CONTACTS_KEY)) ?? '[]')
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts))
}

export async function loadHistory(): Promise<PaymentRecord[]> {
  return JSON.parse((await AsyncStorage.getItem(HISTORY_KEY)) ?? '[]')
}

export async function addHistory(record: PaymentRecord): Promise<PaymentRecord[]> {
  const history = [record, ...(await loadHistory())].slice(0, 200)
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  return history
}

export async function updateHistory(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord[]> {
  const history = (await loadHistory()).map((record) => (record.id === id ? { ...record, ...patch } : record))
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  return history
}

/**
 * Each payment's grant tokens go to the Keychain, keyed by the payment's
 * UUID (SecureStore keys allow only [A-Za-z0-9._-]). Requests with them must
 * still be signed with the device key, but they're bearer-ish — keep them out
 * of AsyncStorage.
 */
function grantKey(paymentId: string): string {
  return `grant_${paymentUuid(paymentId).replace(/[^A-Za-z0-9._-]/g, '')}`
}

/** The UUID at the end of an outgoing payment URL — used as the route param. */
export function paymentUuid(outgoingPaymentUrl: string): string {
  return outgoingPaymentUrl.split('/').pop() ?? outgoingPaymentUrl
}

export async function saveGrant(paymentId: string, grant: PaymentGrant): Promise<void> {
  await secureSet(grantKey(paymentId), JSON.stringify(grant))
}

export async function loadGrant(paymentId: string): Promise<PaymentGrant | null> {
  const raw = await secureGet(grantKey(paymentId))
  return raw ? (JSON.parse(raw) as PaymentGrant) : null
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(key)
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

async function secureSet(key: string, value: string | null): Promise<void> {
  if (Platform.OS !== 'web') {
    if (value === null) await SecureStore.deleteItemAsync(key)
    else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
    return
  }
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode etc. — the key just won't persist on web.
  }
}
