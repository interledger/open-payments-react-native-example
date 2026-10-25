import type { ReactNode } from 'react'
import { ScrollView, StyleSheet } from 'react-native'

/** Scrollable page body; headers and safe areas come from the router's navigators. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f4f4f5' },
  container: { padding: 16, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' }
})
