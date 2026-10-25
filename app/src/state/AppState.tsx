import * as Crypto from 'expo-crypto'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  addHistory as storeAddHistory,
  createAccount,
  deviceKeyOf,
  loadAccount,
  loadContacts,
  loadHistory,
  markVerified as storeMarkVerified,
  resetAccount,
  saveContacts,
  updateHistory as storeUpdateHistory,
  type Contact,
  type DeviceAccount,
  type PaymentRecord
} from '../device/store'
import { OpenPaymentsClient, type WalletAddress } from '../op/client'

/**
 * State shared by every page of the Checkout flow (Send, History, Wallet):
 * the device account + its Open Payments client, whether its key is on the
 * wallet, contacts and the local payment history.
 */

export type KeyStatus = 'checking' | 'missing' | 'registered'

interface AppState {
  /** undefined while loading from storage */
  account: DeviceAccount | null | undefined
  wallet: WalletAddress | null
  keyStatus: KeyStatus
  client: OpenPaymentsClient | null
  ready: boolean
  /** Generate the device key for an address whose ownership was just verified. */
  setUpAccount: (walletAddress: string, verifiedAt: string) => Promise<void>
  checkKey: (attempts?: number) => Promise<void>
  /** The wallet confirmed the user owns the address (subject grant). */
  markVerified: (verifiedAt: string) => Promise<void>
  forgetAccount: () => Promise<void>

  contacts: Contact[]
  addContact: (name: string, walletAddressInput: string) => Promise<void>
  removeContact: (id: string) => Promise<void>

  history: PaymentRecord[]
  addHistory: (record: PaymentRecord) => Promise<void>
  updateHistory: (id: string, patch: Partial<PaymentRecord>) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<DeviceAccount | null | undefined>(undefined)
  const [wallet, setWallet] = useState<WalletAddress | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('checking')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [history, setHistory] = useState<PaymentRecord[]>([])

  const client = useMemo(
    () => (account ? new OpenPaymentsClient(account.walletAddress, deviceKeyOf(account)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account?.walletAddress, account?.keyId]
  )

  useEffect(() => {
    loadAccount().then(setAccount)
    loadContacts().then(setContacts)
    loadHistory().then(setHistory)
  }, [])

  const checkKey = useCallback(
    async (attempts = 1) => {
      if (!account || !client) return
      setKeyStatus('checking')
      for (let i = 0; i < attempts; i++) {
        const jwks = await client.getJwks(account.walletAddress).catch(() => ({ keys: [] as { kid: string }[] }))
        if (jwks.keys.some((k) => k.kid === account.keyId)) return setKeyStatus('registered')
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000))
      }
      setKeyStatus('missing')
    },
    [account, client]
  )

  useEffect(() => {
    if (!account || !client) return
    client.getWalletAddress(account.walletAddress).then(setWallet).catch(() => setWallet(null))
    checkKey()
  }, [account, client, checkKey])

  const setUpAccount = useCallback(async (walletAddress: string, verifiedAt: string) => {
    setAccount(await createAccount(walletAddress, verifiedAt))
  }, [])

  const markVerified = useCallback(async (verifiedAt: string) => {
    const next = await storeMarkVerified(verifiedAt)
    if (next) setAccount(next)
  }, [])

  const forgetAccount = useCallback(async () => {
    await resetAccount()
    setAccount(null)
    setWallet(null)
    setKeyStatus('checking')
  }, [])

  const addContact = useCallback(
    async (name: string, input: string) => {
      if (!client) throw new Error('Set up your wallet first')
      const wa = await client.getWalletAddress(input)
      const next = [
        ...contacts,
        {
          id: Crypto.randomUUID(),
          name: name.trim() || wa.publicName || wa.id,
          walletAddress: wa.id,
          publicName: wa.publicName,
          assetCode: wa.assetCode
        }
      ]
      setContacts(next)
      await saveContacts(next)
    },
    [client, contacts]
  )

  const removeContact = useCallback(
    async (id: string) => {
      const next = contacts.filter((c) => c.id !== id)
      setContacts(next)
      await saveContacts(next)
    },
    [contacts]
  )

  const addHistory = useCallback(async (record: PaymentRecord) => {
    setHistory(await storeAddHistory(record))
  }, [])

  const updateHistory = useCallback(async (id: string, patch: Partial<PaymentRecord>) => {
    setHistory(await storeUpdateHistory(id, patch))
  }, [])

  const value: AppState = {
    account,
    wallet,
    keyStatus,
    client,
    // Connected = this phone's key is on the wallet AND the wallet confirmed
    // the user owns the address.
    ready: !!account && keyStatus === 'registered' && !!account.verifiedAt,
    setUpAccount,
    checkKey,
    markVerified,
    forgetAccount,
    contacts,
    addContact,
    removeContact,
    history,
    addHistory,
    updateHistory
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}
