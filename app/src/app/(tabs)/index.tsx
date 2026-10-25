import { Link, router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Screen } from '../../components/Screen'
import { StateBadge } from '../../components/StateBadge'
import { paymentUuid } from '../../device/store'
import { useAppState } from '../../state/AppState'
import { Button, Card, Field, Small, styles as ui } from '../../ui'

/** Send tab: contacts. Tap one to start a checkout (send/[contactId]). */
export default function SendTab() {
  const { ready, account, contacts, addContact, removeContact, history } = useAppState()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!ready) {
    return (
      <Screen>
        <Card title="Connect your wallet first">
          <Small>
            {account === undefined
              ? 'Loading…'
              : 'Confirm you own your wallet address, then this phone adds its own key to it. It takes one login.'}
          </Small>
          <Button label="Go to Wallet" onPress={() => router.navigate('/wallet')} />
        </Card>
      </Screen>
    )
  }

  const add = async () => {
    setError(null)
    setBusy(true)
    try {
      await addContact(name, address)
      setName('')
      setAddress('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card title="Contacts">
        {contacts.length === 0 && <Small>No contacts yet — add one below.</Small>}
        {contacts.map((contact) => (
          <View key={contact.id} style={local.contact}>
            <View style={{ flex: 1 }}>
              <Text style={local.name}>{contact.name}</Text>
              <Text style={ui.small} numberOfLines={1}>
                {contact.walletAddress}
                {contact.assetCode ? ` · ${contact.assetCode}` : ''}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => removeContact(contact.id)} style={local.remove}>
              <Text style={ui.small}>Remove</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/send/[contactId]', params: { contactId: contact.id } })}
              style={local.send}
            >
              <Text style={local.sendText}>Send</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title="Add contact">
        <Field label="Name" value={name} onChangeText={setName} placeholder="Bob" />
        <Field label="Wallet address" value={address} onChangeText={setAddress} placeholder="$ilp.interledger-test.dev/bob" />
        <Button label="Add" onPress={add} disabled={busy || !address} />
        {error && <Text style={local.error}>{error}</Text>}
      </Card>

      {history.length > 0 && (
        <Card title="Latest transfer">
          <Link href={{ pathname: '/history/[id]', params: { id: paymentUuid(history[0].id) } }} asChild>
            <Pressable accessibilityRole="button" style={local.latest}>
              <View style={{ flex: 1 }}>
                <Text style={local.name}>
                  {history[0].debit} → {history[0].contactName}
                </Text>
                <Text style={ui.small}>{new Date(history[0].createdAt).toLocaleString()}</Text>
              </View>
              <StateBadge state={history[0].state} />
            </Pressable>
          </Link>
          <Button label="All transfers" secondary onPress={() => router.navigate('/history')} />
        </Card>
      )}
    </Screen>
  )
}

const local = StyleSheet.create({
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e4e4e7',
    gap: 8
  },
  name: { fontWeight: '600', marginBottom: 2 },
  remove: { paddingHorizontal: 6, paddingVertical: 4 },
  send: { backgroundColor: '#1d4ed8', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  sendText: { color: '#fff', fontWeight: '600' },
  latest: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  error: { color: '#b91c1c', marginTop: 8 }
})
