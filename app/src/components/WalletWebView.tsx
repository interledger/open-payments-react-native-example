import { useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { parseQuery } from '../op/encoding'
import type { KeyUploadMessage } from '../device/testWallet'

/**
 * The wallet, inside the app. An embedded WebView (not the system auth browser)
 * because:
 *  - its cookies persist across app launches, so after one login inside the app
 *    the wallet's consent screen opens directly (test wallet session ≈ 1 month);
 *  - the app can inject a script into the logged-in wallet page to upload the
 *    device key automatically (see device/testWallet.ts).
 * Rafiki's /interact → /finish cookie check is satisfied because both happen
 * in this same WebView.
 */

export const FINISH_URI = 'openpayments-rn-example://op/finish'

type Props =
  | {
      mode: 'consent'
      url: string
      title?: string
      onFinish: (params: Record<string, string>) => void
      onCancel: () => void
    }
  | {
      mode: 'key-upload'
      url: string
      script: string
      onResult: (message: Extract<KeyUploadMessage, { type: 'key-upload' }>) => void
      onCancel: () => void
    }

export function WalletWebView(props: Props) {
  const [loading, setLoading] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const done = useRef(false)

  const finish = (fn: () => void) => {
    if (done.current) return
    done.current = true
    fn()
  }

  // Rafiki's /finish answers with a 302 to FINISH_URI?hash=…&interact_ref=…
  // (or ?result=grant_rejected). Catch it before the WebView tries to load it
  // and close — the "WebView closes after the click" part.
  const onShouldStartLoadWithRequest = (request: ShouldStartLoadRequest) => {
    if (props.mode === 'consent' && request.url.startsWith(FINISH_URI)) {
      finish(() => props.onFinish(parseQuery(request.url)))
      return false
    }
    return true
  }

  const onMessage = (event: WebViewMessageEvent) => {
    if (props.mode !== 'key-upload') return
    try {
      const message = JSON.parse(event.nativeEvent.data) as KeyUploadMessage
      if (message.type === 'key-upload-waiting-for-login') setHint('Log in to the wallet — the key is added right after.')
      else finish(() => props.onResult(message))
    } catch {
      // Not ours.
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {props.mode === 'consent' ? (props.title ?? 'Approve in your wallet') : 'Registering this device'}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => finish(props.onCancel)}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        {hint && <Text style={styles.hint}>{hint}</Text>}
        <WebView
          source={{ uri: props.url }}
          // '*' so FINISH_URI reaches onShouldStartLoadWithRequest instead of
          // being handed to Linking.openURL by the whitelist check.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          injectedJavaScript={props.mode === 'key-upload' ? props.script : undefined}
          onMessage={onMessage}
          onLoadEnd={() => setLoading(false)}
          // Persistent, shared-with-nothing cookie store: the wallet login
          // survives app restarts but is separate from Safari/Chrome.
          incognito={false}
          setSupportMultipleWindows={false}
          style={styles.webview}
        />
        {loading && <ActivityIndicator style={styles.spinner} />}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d8'
  },
  title: { fontSize: 16, fontWeight: '600' },
  cancel: { color: '#1d4ed8', fontSize: 16 },
  hint: { padding: 12, backgroundColor: '#eff6ff', color: '#1e3a8a', fontSize: 13 },
  webview: { flex: 1 },
  spinner: { position: 'absolute', top: '50%', alignSelf: 'center' }
})
