import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * The app only stores an opaque connection id — never a key or a GNAP token
 * (those stay on server, see docs/mobile-clients.md, Model A).
 * Keychain / Keystore on device; localStorage on web, where SecureStore
 * isn't available.
 */
const KEY = 'connectionId'

export async function loadConnectionId(): Promise<string | null> {
  if (Platform.OS === 'web') return safeLocalStorage()?.getItem(KEY) ?? null
  return SecureStore.getItemAsync(KEY)
}

export async function saveConnectionId(id: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (id) safeLocalStorage()?.setItem(KEY, id)
    else safeLocalStorage()?.removeItem(KEY)
    return
  }
  if (id) await SecureStore.setItemAsync(KEY, id)
  else await SecureStore.deleteItemAsync(KEY)
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
