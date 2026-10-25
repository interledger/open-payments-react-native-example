import type { ComponentProps, ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  )
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  )
}

export function Field(props: ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...input } = props
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} {...input} />
    </View>
  )
}

export function Toggle(props: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.toggle}>
        <Text style={[styles.label, { flex: 1 }]}>{props.label}</Text>
        <Switch value={props.value} onValueChange={props.onValueChange} />
      </View>
      {props.hint && <Text style={styles.small}>{props.hint}</Text>}
    </View>
  )
}

export function Button(props: {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.button,
        props.secondary && styles.buttonSecondary,
        props.danger && styles.buttonDanger,
        props.disabled && { opacity: 0.5 }
      ]}
    >
      <Text style={[styles.buttonText, props.secondary && { color: '#1d4ed8' }]}>{props.label}</Text>
    </Pressable>
  )
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={styles.small}>{children}</Text>
}

export const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 12 },
  rowLabel: { color: '#52525b' },
  rowValue: { fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  label: { fontSize: 13, color: '#3f3f46', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#d4d4d8', borderRadius: 8, padding: 10, fontSize: 15, backgroundColor: '#fff' },
  toggle: { flexDirection: 'row', alignItems: 'center' },
  small: { fontSize: 12, color: '#52525b', marginBottom: 4 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: '#e0e7ff' },
  buttonDanger: { backgroundColor: '#b91c1c', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600' }
})
