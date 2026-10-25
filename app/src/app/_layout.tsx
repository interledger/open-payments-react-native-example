import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as WebBrowser from 'expo-web-browser'
import { AppStateProvider } from '../state/AppState'

// Web only: when a consent popup lands back on this app's finish URL, hand
// the URL to the opener window and close. No-op on iOS/Android.
WebBrowser.maybeCompleteAuthSession()

export default function RootLayout() {
  return (
    <AppStateProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="send/[contactId]" options={{ title: 'Send' }} />
        <Stack.Screen name="history/[id]" options={{ title: 'Transfer' }} />
        <Stack.Screen name="op/finish" options={{ headerShown: false }} />
      </Stack>
    </AppStateProvider>
  )
}
