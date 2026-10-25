import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { StateBadge } from '../../components/StateBadge'
import { loadGrant, paymentUuid, saveGrant } from '../../device/store'
import { formatAmount } from '../../op/amount'
import { settleCheckout } from '../../op/checkout'
import { useAppState } from '../../state/AppState'
import { Button, Card, Row, Small } from '../../ui'

/**
 * One transfer. Its live status comes from the wallets: the outgoing payment
 * (read with the payment's own kept grant, token rotated silently if expired)
 * and the receiver's incoming payment (fresh non-interactive grant), which is
 * also marked complete here if it was delivered but left open.
 */
export default function TransferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { history, client, updateHistory } = useAppState()
  const record = history.find((r) => paymentUuid(r.id) === id)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [hasGrant, setHasGrant] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!record || !client) return
    setError(null)
    setLoading(true)
    try {
      const grant = await loadGrant(record.id)
      setHasGrant(!!grant)
      if (!grant) return
      // One settle pass: reads the outgoing payment (rotating its token if
      // expired) and the receiver's incoming payment, and completes the
      // incoming payment if it's delivered but still open.
      const receiverAuthServer =
        record.receiverAuthServer ?? (await client.getWalletAddress(record.receiver)).authServer
      const settled = await settleCheckout(client, {
        outgoingPaymentId: record.id,
        grant,
        receiverAuthServer,
        incomingPaymentId: record.incomingPaymentId,
        timeoutMs: 0
      })
      if (settled.grant.accessToken !== grant.accessToken) {
        await saveGrant(record.id, settled.grant)
        setNote('Access token had expired — rotated silently.')
      }
      if (settled.incomingCompleted && !record.incomingCompleted) {
        setNote('Marked the receiver’s incoming payment as complete.')
      }
      await updateHistory(record.id, {
        state: settled.state,
        sent: formatAmount(settled.sent),
        delivered: settled.delivered && formatAmount(settled.delivered),
        incomingPaymentId: settled.incomingPaymentId,
        receiverAuthServer,
        incomingCompleted: settled.incomingCompleted,
        checkedAt: new Date().toISOString()
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [record?.id, client, updateHistory])

  useEffect(() => {
    refresh()
    // Only on open; the Refresh button handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id])

  if (!record) {
    return (
      <Screen>
        <Card title="Transfer not found">
          <Small>It may have been made on another device or before history was kept.</Small>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen>
      <Card title={`To ${record.contactName}`}>
        <View style={local.status}>
          <StateBadge state={record.state} />
          {loading && <ActivityIndicator />}
        </View>
        <Row label="You paid" value={record.debit} />
        <Row label="They get" value={record.receive} />
        {record.sent && <Row label="Sent (your side)" value={record.sent} />}
        {record.delivered && <Row label="Delivered (their side)" value={record.delivered} />}
        {record.incomingPaymentId && (
          <Row label="Receiver's incoming payment" value={record.incomingCompleted ? 'completed' : 'open'} />
        )}
        <Row label="Date" value={new Date(record.createdAt).toLocaleString()} />
        <Row label="Receiver" value={record.receiver} />
        {record.checkedAt && <Row label="Checked" value={new Date(record.checkedAt).toLocaleTimeString()} />}
        {note && <Small>{note}</Small>}
        {hasGrant === false && (
          <Small>Live status isn't available for this transfer — it was made before the app kept payment grants.</Small>
        )}
        {error && <Text style={local.error}>{error}</Text>}
        <Button label="Refresh status" onPress={refresh} disabled={loading || hasGrant === false} secondary />
      </Card>
      <Card title="Open Payments">
        <Small>Outgoing payment</Small>
        <Text selectable style={local.mono}>
          {record.id}
        </Text>
        {record.incomingPaymentId && (
          <>
            <Small>Incoming payment (receiver)</Small>
            <Text selectable style={local.mono}>
              {record.incomingPaymentId}
            </Text>
          </>
        )}
      </Card>
    </Screen>
  )
}

const local = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  error: { color: '#b91c1c', marginTop: 8 },
  mono: { fontFamily: 'Menlo', fontSize: 11, color: '#3f3f46' }
})
