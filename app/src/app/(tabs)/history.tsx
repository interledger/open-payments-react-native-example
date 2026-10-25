import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { StateBadge } from '../../components/StateBadge'
import { paymentUuid } from '../../device/store'
import { useAppState } from '../../state/AppState'
import { Card, Small, styles as ui } from '../../ui'

/** History tab: the transfers made from this app (stored on the phone). */
export default function HistoryTab() {
  const { history } = useAppState()

  return (
    <Screen>
      <Card title={`Transfers from this app (${history.length})`}>
        {history.length === 0 && <Small>Nothing sent yet. Pick a contact on the Send tab.</Small>}
        {history.map((record) => (
          <Pressable
            key={record.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/history/[id]', params: { id: paymentUuid(record.id) } })}
            style={({ pressed }) => [local.row, pressed && { opacity: 0.6 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={local.title}>{record.contactName}</Text>
              <Text style={ui.small}>{new Date(record.createdAt).toLocaleString()}</Text>
            </View>
            <View style={local.right}>
              <Text style={local.amount}>−{record.debit}</Text>
              <Text style={ui.small}>they got {record.receive}</Text>
              <StateBadge state={record.state} />
            </View>
          </Pressable>
        ))}
      </Card>
      {history.length > 0 && <Small>Tap a transfer for its live status from your wallet.</Small>}
    </Screen>
  )
}

const local = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
    gap: 12
  },
  title: { fontWeight: '600', marginBottom: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  amount: { fontWeight: '600', color: '#18181b' }
})
