import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import { API_URL, api } from '../../api'
import { Screen } from '../../components/Screen'
import { FINISH_URI, WalletWebView } from '../../components/WalletWebView'
import { deviceKeyOf } from '../../device/store'
import { DEVELOPER_KEYS_URL, buildKeyUploadScript, isTestWalletAddress } from '../../device/testWallet'
import { parseQuery } from '../../op/encoding'
import { base64Jwk } from '../../op/keys'
import { useAppState } from '../../state/AppState'
import { Button, Card, Field, Row, Small } from '../../ui'

/**
 * Wallet tab — connecting the user's wallet, in the usual order:
 *  1. Ownership: the app's backend (server/) asks the user's wallet to confirm
 *     the user owns the address — an Open Payments subject grant, signed with
 *     the backend's own key, so it works before the phone has any key. The
 *     user logs in to the wallet here, in the in-app WebView.
 *  2. Device key: only now does the phone create its Ed25519 key.
 *  3. Key on the wallet: added automatically by a script running inside the
 *     already-logged-in wallet page (same WebView, no second login).
 */

const IS_WEB = Platform.OS === 'web'
const WEB_FINISH_URI = Linking.createURL('op/finish')

export default function WalletTab() {
  const { account, wallet, keyStatus, setUpAccount, checkKey, markVerified, forgetAccount } = useAppState()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState<{ checkId: string; url: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  // Step 3 starts by itself right after a successful ownership check.
  const [autoUpload, setAutoUpload] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(
        /Network request failed|Failed to fetch/.test(message)
          ? `Backend not reachable at ${API_URL}. Start it with "npm run dev" in server/.`
          : message
      )
    } finally {
      setBusy(false)
    }
  }

  // Step 1: the backend starts the ownership check; the user confirms in the wallet.
  const verifyOwnership = (walletAddress: string) =>
    run(async () => {
      const finishUri = IS_WEB ? WEB_FINISH_URI : FINISH_URI
      const { checkId, redirectUrl } = await api.startOwnershipCheck({ walletAddress, finishUri })
      if (!IS_WEB) return setConsent({ checkId, url: redirectUrl })
      const result = await WebBrowser.openAuthSessionAsync(redirectUrl, WEB_FINISH_URI)
      if (result.type !== 'success') throw new Error('Wallet window closed before confirming')
      await finishOwnership(checkId, parseQuery(result.url))
    })

  const finishOwnership = async (checkId: string, params: Record<string, string>) => {
    setConsent(null)
    await run(async () => {
      const { walletAddress, verifiedAt } = await api.finishOwnershipCheck(checkId, params)
      if (account?.walletAddress === walletAddress) {
        await markVerified(verifiedAt) // existing key, now verified
      } else {
        // Step 2: only now create the device key, for the verified address.
        await setUpAccount(walletAddress, verifiedAt)
        setAutoUpload(true)
      }
    })
  }

  // Step 3 runs as soon as the new key is known to be missing on the wallet.
  useEffect(() => {
    if (autoUpload && keyStatus === 'missing' && account && !IS_WEB && isTestWalletAddress(account.walletAddress)) {
      setAutoUpload(false)
      setUploading(true)
    }
  }, [autoUpload, keyStatus, account])

  const onUploadResult = async (message: { ok: boolean; error?: string }) => {
    setUploading(false)
    if (!message.ok) return setError(message.error ?? 'Key upload failed')
    setError(null)
    await checkKey(5)
  }

  if (account === undefined) return <Screen>{null}</Screen>

  const consentModal = consent && (
    <WalletWebView
      mode="consent"
      title="Sign in to your wallet"
      url={consent.url}
      onFinish={(params) => finishOwnership(consent.checkId, params)}
      onCancel={() => setConsent(null)}
    />
  )

  if (!account) {
    return (
      <Screen>
        <Card title="Connect your wallet">
          <Field label="Your wallet address" value={input} onChangeText={setInput} placeholder="$ilp.interledger-test.dev/alice" />
          <Button label="Connect" onPress={() => verifyOwnership(input)} disabled={busy || !input} />
          <Small>
            You log in to your wallet once, here in the app. Your wallet confirms you own the address, then this phone
            creates its own key and adds it to your wallet.
          </Small>
          {busy && <ActivityIndicator style={{ marginTop: 8 }} />}
          {error && <Text style={local.error}>{error}</Text>}
        </Card>
        {consentModal}
      </Screen>
    )
  }

  const canAutoUpload = !IS_WEB && isTestWalletAddress(account.walletAddress)
  const keyOnWallet = keyStatus === 'registered'

  return (
    <Screen>
      <Card title="Your wallet">
        <Row label="Wallet" value={account.walletAddress} />
        {wallet && <Row label="Name" value={wallet.publicName ?? '—'} />}
        {wallet && <Row label="Asset" value={`${wallet.assetCode} (scale ${wallet.assetScale})`} />}
      </Card>

      <Card title="Connection">
        <Step
          n={1}
          done={!!account.verifiedAt}
          label="Ownership confirmed by your wallet"
          detail={account.verifiedAt ? new Date(account.verifiedAt).toLocaleString() : 'not yet'}
        />
        <Step n={2} done label="Device key created" detail={account.keyId} />
        <Step
          n={3}
          done={keyOnWallet}
          label="Key added to your wallet"
          detail={keyStatus === 'checking' ? 'checking…' : keyOnWallet ? 'listed in jwks.json' : 'not yet'}
        />

        {!account.verifiedAt && (
          <>
            <Button label="Confirm ownership" onPress={() => verifyOwnership(account.walletAddress)} disabled={busy} />
            <Small>This key was created before ownership checks. Confirm once in your wallet.</Small>
          </>
        )}

        {account.verifiedAt &&
          keyStatus === 'missing' &&
          (canAutoUpload ? (
            <>
              <Button label="Add key to my wallet" onPress={() => setUploading(true)} />
              <Small>Opens your wallet in the app (you're already signed in) and adds this phone's key.</Small>
            </>
          ) : (
            <>
              <Small>Upload this public key in your wallet's developer keys, then check again:</Small>
              <Text selectable style={local.mono}>
                {base64Jwk(deviceKeyOf(account))}
              </Text>
              <Button label="Open developer keys" secondary onPress={() => Linking.openURL(DEVELOPER_KEYS_URL)} />
              <Button label="Check again" onPress={() => checkKey()} />
            </>
          ))}
        {account.verifiedAt && keyOnWallet && <Small>✅ Connected — you can send from the Send tab.</Small>}
        {busy && <ActivityIndicator style={{ marginTop: 8 }} />}
        {error && <Text style={local.error}>{error}</Text>}
      </Card>

      <Button label="Forget this device key" danger onPress={forgetAccount} />
      <Small>The key stays listed in your wallet's developer keys until you revoke it there.</Small>

      {uploading && (
        <WalletWebView
          mode="key-upload"
          url={DEVELOPER_KEYS_URL}
          script={buildKeyUploadScript({
            walletAddressUrl: account.walletAddress,
            keyId: account.keyId,
            base64Key: base64Jwk(deviceKeyOf(account)),
            nickname: 'Open Payments RN Example'
          })}
          onResult={onUploadResult}
          onCancel={() => setUploading(false)}
        />
      )}
      {consentModal}
    </Screen>
  )
}

function Step({ n, done, label, detail }: { n: number; done: boolean; label: string; detail: string }) {
  return (
    <View style={local.step}>
      <Text style={[local.stepNo, done && local.stepDone]}>{done ? '✓' : n}</Text>
      <View style={{ flex: 1 }}>
        <Text style={local.stepLabel}>{label}</Text>
        <Text style={local.stepDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </View>
  )
}

const local = StyleSheet.create({
  error: { color: '#b91c1c', marginTop: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, marginVertical: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  stepNo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: 'center',
    lineHeight: 26,
    overflow: 'hidden',
    backgroundColor: '#e4e4e7',
    color: '#3f3f46',
    fontWeight: '700'
  },
  stepDone: { backgroundColor: '#dcfce7', color: '#166534' },
  stepLabel: { fontWeight: '600' },
  stepDetail: { fontSize: 12, color: '#52525b' }
})
