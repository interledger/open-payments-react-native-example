import { StyleSheet, Text, View } from 'react-native'

/**
 * Web only: where the wallet's consent popup lands (Linking.createURL('op/finish')).
 * The root layout's WebBrowser.maybeCompleteAuthSession() hands this URL to the
 * opener and closes the popup; this page is just what shows meanwhile.
 * Native builds never navigate here — the WebView intercepts the redirect.
 */
export default function FinishPage() {
  return (
    <View style={styles.container}>
      <Text>Returning to the app…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' }
})
