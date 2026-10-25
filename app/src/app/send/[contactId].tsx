import * as Crypto from 'expo-crypto'
import * as Linking from 'expo-linking'
import { router, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { FINISH_URI, WalletWebView } from '../../components/WalletWebView'
import { paymentUuid, saveGrant } from '../../device/store'
import { formatAmount, toMinorUnits } from '../../op/amount'
import {
  CheckoutRejectedError,
  completeCheckout,
  prepareCheckout,
  settleCheckout,
  type CheckoutResult,
  type SettleResult,
  type CheckoutStep,
  type PendingCheckout
} from '../../op/checkout'
import { parseQuery } from '../../op/encoding'
import { useAppState } from '../../state/AppState'
import { Button, Card, Field, Row, Small } from '../../ui'

/**
 * Send = one checkout: amount → Proceed → consent in the in-app WebView (still
 * logged in to the wallet) → WebView closes on the finish redirect → continue
 * grant + create the outgoing payment. See src/op/checkout.ts.
 */

const IS_WEB = Platform.OS === 'web'
const WEB_FINISH_URI = Linking.createURL('op/finish')

const STEP_LABELS: Record<CheckoutStep, string> = {
  'wallet-addresses': 'Looking up wallets…',
  'incoming-payment': 'Creating incoming payment at the receiver…',
  quote: 'Getting a quote…',
  grant: 'Requesting a payment grant…'
}

type Phase =
  | { phase: 'form' }
  | { phase: 'working'; label: string }
  | { phase: 'ready'; redirectUrl: string; pending: PendingCheckout } // web: tap to open popup
  | { phase: 'consent'; redirectUrl: string; pending: PendingCheckout } // native: WebView open
  | { phase: 'done'; result: CheckoutResult; settled: SettleResult | null }
  | { phase: 'error'; message: string }

export default function SendPage() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>()
  const { contacts, account, wallet, client, addHistory, updateHistory } = useAppState()
  const contact = contacts.find((c) => c.id === contactId)
  const [amount, setAmount] = useState('1')
  const [state, setState] = useState<Phase>({ phase: 'form' })

  if (!contact || !account || !client || !wallet) {
    return (
      <Screen>
        <Card title="Can't send">
          <Small>{!contact ? 'Unknown contact.' : 'Set up your wallet first.'}</Small>
          <Button label="Back" secondary onPress={() => router.back()} />
        </Card>
      </Screen>
    )
  }

  const proceed = async () => {
    try {
      const { redirectUrl, pending } = await prepareCheckout(client, {
        senderWalletAddress: account.walletAddress,
        receiverWalletAddress: contact.walletAddress,
        debitValue: toMinorUnits(amount, wallet.assetScale),
        finishUri: IS_WEB ? WEB_FINISH_URI : FINISH_URI,
        nonce: Crypto.randomUUID(),
        onStep: (step) => setState({ phase: 'working', label: STEP_LABELS[step] })
      })
      setState(IS_WEB ? { phase: 'ready', redirectUrl, pending } : { phase: 'consent', redirectUrl, pending })
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const finish = async (pending: PendingCheckout, params: Record<string, string>) => {
    setState({ phase: 'working', label: 'Sending…' })
    try {
      const result = await completeCheckout(client, pending, params)
      await saveGrant(result.outgoingPaymentId, result.grant)
      await addHistory({
        id: result.outgoingPaymentId,
        contactName: contact.name,
        receiver: contact.walletAddress,
        debit: formatAmount(result.debitAmount),
        receive: formatAmount(result.receiveAmount),
        createdAt: new Date().toISOString(),
        incomingPaymentId: result.incomingPaymentId,
        receiverAuthServer: result.receiverAuthServer,
        incomingCompleted: false
      })

      // Wait for delivery, then mark the receiver's incoming payment complete.
      setState({ phase: 'working', label: 'Delivering and completing the payment…' })
      let settled: SettleResult | null = null
      try {
        settled = await settleCheckout(client, {
          outgoingPaymentId: result.outgoingPaymentId,
          grant: result.grant,
          incomingPaymentId: result.incomingPaymentId,
          receiverAuthServer: result.receiverAuthServer
        })
        await saveGrant(result.outgoingPaymentId, settled.grant)
        await updateHistory(result.outgoingPaymentId, {
          state: settled.state,
          sent: formatAmount(settled.sent),
          delivered: settled.delivered && formatAmount(settled.delivered),
          incomingCompleted: settled.incomingCompleted,
          checkedAt: new Date().toISOString()
        })
      } catch {
        // The payment exists; History → detail retries settling on refresh.
      }
      setState({ phase: 'done', result, settled })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setState({ phase: 'error', message: e instanceof CheckoutRejectedError ? `Declined — ${message}` : message })
    }
  }

  const openWebConsent = async (redirectUrl: string, pending: PendingCheckout) => {
    setState({ phase: 'working', label: 'Waiting for your approval in the wallet…' })
    const result = await WebBrowser.openAuthSessionAsync(redirectUrl, WEB_FINISH_URI)
    if (result.type !== 'success') return setState({ phase: 'error', message: 'Wallet window closed before approving' })
    await finish(pending, parseQuery(result.url))
  }

  return (
    <Screen>
      <Card title={`Send to ${contact.name}`}>
        <Row label="To" value={contact.walletAddress} />
        <Row label="From" value={account.walletAddress} />

        {state.phase === 'form' && (
          <>
            <Field
              label={`Amount (${wallet.assetCode})`}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Button label="Proceed" onPress={proceed} disabled={!amount} />
          </>
        )}

        {(state.phase === 'working' || state.phase === 'consent') && (
          <View style={local.working}>
            <ActivityIndicator />
            <Text style={local.workingText}>
              {state.phase === 'working' ? state.label : 'Waiting for your approval in the wallet…'}
            </Text>
          </View>
        )}

        {state.phase === 'ready' && (
          <>
            <Row label="You pay" value={formatAmount(state.pending.debitAmount)} />
            <Row label="They get" value={formatAmount(state.pending.receiveAmount)} />
            <Button label="Open wallet to approve" onPress={() => openWebConsent(state.redirectUrl, state.pending)} />
          </>
        )}

        {state.phase === 'done' && (
          <>
            <Text style={local.success}>
              {state.settled?.state === 'failed' ? '⚠️ Payment failed' : state.settled?.state === 'completed' ? '✅ Delivered' : '✅ Sent'}
            </Text>
            <Row label="You paid" value={formatAmount(state.result.debitAmount)} />
            <Row label="They get" value={formatAmount(state.result.receiveAmount)} />
            {state.settled?.delivered && <Row label="Delivered" value={formatAmount(state.settled.delivered)} />}
            <Row
              label="Receiver's incoming payment"
              value={state.settled?.incomingCompleted ? 'completed' : 'still open — refresh on the transfer page'}
            />
            <Button
              label="View transfer"
              onPress={() =>
                router.replace({
                  pathname: '/history/[id]',
                  params: { id: paymentUuid(state.result.outgoingPaymentId) }
                })
              }
            />
            <Button label="Done" secondary onPress={() => router.back()} />
          </>
        )}

        {state.phase === 'error' && (
          <>
            <Text style={local.error}>{state.message}</Text>
            <Button label="Try again" onPress={() => setState({ phase: 'form' })} />
          </>
        )}
      </Card>

      {state.phase === 'consent' && (
        <WalletWebView
          mode="consent"
          url={state.redirectUrl}
          onFinish={(params) => finish(state.pending, params)}
          onCancel={() => {
            // Revoke the pending grant instead of leaving it to expire.
            client.cancelGrant(state.pending.continueUri, state.pending.continueToken).catch(() => undefined)
            setState({ phase: 'error', message: 'Cancelled before approving' })
          }}
        />
      )}
    </Screen>
  )
}

const local = StyleSheet.create({
  working: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  workingText: { color: '#3f3f46' },
  success: { fontSize: 18, fontWeight: '700', marginVertical: 8 },
  error: { color: '#b91c1c', marginTop: 8 }
})
