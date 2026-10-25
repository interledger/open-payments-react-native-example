import { StyleSheet, Text } from 'react-native'
import type { PaymentRecord } from '../device/store'

const COLORS: Record<NonNullable<PaymentRecord['state']>, { bg: string; fg: string; label: string }> = {
  completed: { bg: '#dcfce7', fg: '#166534', label: 'Completed' },
  processing: { bg: '#fef9c3', fg: '#854d0e', label: 'Processing' },
  failed: { bg: '#fee2e2', fg: '#991b1b', label: 'Failed' }
}

export function StateBadge({ state }: { state: PaymentRecord['state'] }) {
  const c = state ? COLORS[state] : { bg: '#e4e4e7', fg: '#3f3f46', label: 'Sent' }
  return <Text style={[styles.badge, { backgroundColor: c.bg, color: c.fg }]}>{c.label}</Text>
}

const styles = StyleSheet.create({
  badge: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    alignSelf: 'flex-start'
  }
})
