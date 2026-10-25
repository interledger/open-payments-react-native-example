import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text } from 'react-native'
import { API_URL, api, type ConnectionView } from '../api'
import { FINISH_URI, WalletWebView } from '../components/WalletWebView'
import { parseQuery } from '../op/encoding'
import { useAppState } from '../state/AppState'
import { loadConnectionId, saveConnectionId } from '../storage'
import { Button, Card, Field, Row, Small, Toggle, styles } from '../ui'

/**
 * Model A — "connect once" (Web Monetization extension style): the backend
 * (server/) holds its own key and one budget grant on the user's wallet; the
 * phone only shows the consent. Uses the wallet connected on the Wallet tab,
 * and the same in-app WebView, so the user is already signed in. See
 * docs/mobile-clients.md.
 */

const IS_WEB = Platform.OS === 'web'
// On web there's no WebView: consent runs in a popup that lands back on the app.
const WEB_FINISH_URI = Linking.createURL('op/finish')

type Pending = { connectionId: string; redirectUrl: string }

export function BudgetScreen() {
  const { ready, account, wallet } = useAppState()
  const [health, setHealth] = useState<string>('checking…')
  const [connection, setConnection] = useState<ConnectionView | null>(null)
  const [consent, setConsent] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const [budget, setBudget] = useState('10')
  const [recurring, setRecurring] = useState(true)
  const [receiver, setReceiver] = useState('')
  const [amount, setAmount] = useState('1')

  const addLog = useCallback((line: string) => {
    setLog((lines) => [`${new Date().toLocaleTimeString()}  ${line}`, ...lines].slice(0, 30))
  }, [])

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      try {
        await fn()
      } catch (error) {
        addLog(`⚠️ ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setBusy(false)
      }
    },
    [addLog]
  )

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth(`${h.target} · client ${h.client}`))
      .catch(() => setHealth(`unreachable at ${API_URL}`))
  }, [])

  // Restore the budget grant for the connected wallet (a budget left over from
  // another wallet is cancelled).
  useEffect(() => {
    if (!account) return
    loadConnectionId().then(async (id) => {
      if (!id) return
      try {
        const view = await api.getConnection(id)
        if (view.status === 'connected' && view.walletAddress === account.walletAddress) {
          setConnection(view)
          addLog('Restored budget — no browser, no login, no consent')
          return
        }
        if (view.status === 'connected') await api.disconnect(id).catch(() => undefined)
      } catch {
        // Unknown on the backend (e.g. a reset database).
      }
      await saveConnectionId(null)
    })
  }, [account?.walletAddress, addLog])

  // The backend requests the interactive grant (signed with ITS key) for the
  // connected wallet; the user approves it in the wallet.
  const approveBudget = () =>
    run(async () => {
      if (!account) return
      const finishUri = IS_WEB ? WEB_FINISH_URI : FINISH_URI
      const result = await api.startConnection({ walletAddress: account.walletAddress, amount: budget, recurring, finishUri })
      addLog(`Budget grant requested → approve it in ${result.redirectUrl.split('/')[2]}`)
      if (!IS_WEB) return setConsent({ connectionId: result.connectionId, redirectUrl: result.redirectUrl })
      const popup = await WebBrowser.openAuthSessionAsync(result.redirectUrl, WEB_FINISH_URI)
      if (popup.type !== 'success') return addLog(`Wallet window closed (${popup.type}) — the grant expires in 10 min`)
      await finishBudget(result.connectionId, parseQuery(popup.url))
    })

  const finishBudget = async (connectionId: string, params: Record<string, string>) => {
    setConsent(null)
    await run(async () => {
      addLog(params.interact_ref ? 'Back from the wallet with interact_ref + hash' : `Back from the wallet: ${params.result ?? 'no result'}`)
      const view = await api.finishConnection(connectionId, params)
      if (view.status === 'connected') {
        await saveConnectionId(view.id)
        setConnection(view)
        addLog('Budget approved ✅ — tokens are held by the backend')
      } else {
        addLog(`Not approved: ${view.status}${view.error ? ` — ${view.error}` : ''}`)
      }
    })
  }

  const refresh = () =>
    run(async () => {
      if (!connection) return
      setConnection(await api.getConnection(connection.id))
    })

  const payNow = () =>
    run(async () => {
      if (!connection) return
      const payment = await api.pay(connection.id, { receiver, amount })
      addLog(`Paid ${payment.debitAmount} (receiver gets ${payment.receiveAmount}) — no browser opened`)
      setConnection(await api.getConnection(connection.id))
    })

  const disconnect = () =>
    run(async () => {
      if (!connection) return
      await api.disconnect(connection.id)
      await saveConnectionId(null)
      setConnection(null)
      addLog('Budget removed — grant cancelled')
    })

  if (!ready || !account) {
    return (
      <Card title="Connect your wallet first">
        <Small>The budget is set on the wallet you connect on the Wallet tab.</Small>
        <Button label="Go to Wallet" onPress={() => router.navigate('/wallet')} />
      </Card>
    )
  }

  return (
    <>
      <Card title="Your wallet">
        <Row label="Wallet" value={account.walletAddress} />
        {wallet && <Row label="Name" value={wallet.publicName ?? '—'} />}
        {wallet && <Row label="Asset" value={`${wallet.assetCode} (scale ${wallet.assetScale})`} />}
      </Card>

      {connection ? (
        <>
          <Card title="Budget">
            <Row label="Budget" value={`${connection.budget}${connection.recurring ? ' / month' : ''}`} />
            <Row label="Spent" value={connection.spent ?? '—'} />
            <Row label="Token rotations" value={String(connection.tokenRotations)} />
            <Button label="Refresh" onPress={refresh} disabled={busy} secondary />
          </Card>

          <Card title="Pay (no browser, no consent)">
            <Field label="Receiver wallet address" value={receiver} onChangeText={setReceiver} placeholder="$ilp.interledger-test.dev/bob" />
            <Field label={`Amount (${wallet?.assetCode ?? ''})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Button label="Pay" onPress={payNow} disabled={busy || !receiver} />
          </Card>

          {connection.payments.length > 0 && (
            <Card title="Payments">
              {connection.payments.map((p) => (
                <Text key={p.id} style={styles.small}>
                  {new Date(p.createdAt).toLocaleTimeString()} · {p.debitAmount} → {p.receiver}
                </Text>
              ))}
            </Card>
          )}

          <Button label="Remove budget" onPress={disconnect} disabled={busy} danger />
        </>
      ) : (
        <Card title="Set a budget">
          <Field label={`Amount (${wallet?.assetCode ?? ''})`} value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
          <Toggle label="Recurring monthly budget" value={recurring} onValueChange={setRecurring} />
          <Button label="Approve budget" onPress={approveBudget} disabled={busy || !budget} />
          <Small>
            You approve it once in your wallet (already signed in). The backend then pays from this budget without asking
            again.
          </Small>
        </Card>
      )}

      {busy && <ActivityIndicator style={{ marginVertical: 8 }} />}

      <Card title="Log">
        {log.length === 0 ? <Text style={styles.small}>—</Text> : log.map((line, i) => <Text key={i} style={styles.small}>{line}</Text>)}
      </Card>
      <Text style={screenStyles.meta}>Backend: {API_URL}</Text>
      <Text style={screenStyles.meta}>{health}</Text>

      {consent && (
        <WalletWebView
          mode="consent"
          title="Approve the budget"
          url={consent.redirectUrl}
          onFinish={(params) => finishBudget(consent.connectionId, params)}
          onCancel={() => {
            setConsent(null)
            addLog('Cancelled before approving')
          }}
        />
      )}
    </>
  )
}

const screenStyles = StyleSheet.create({
  meta: { fontSize: 12, color: '#52525b', marginTop: 8 }
})
