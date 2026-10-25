import Ionicons from '@expo/vector-icons/Ionicons'
import { Tabs } from 'expo-router'
import type { ComponentProps } from 'react'
import type { ColorValue } from 'react-native'

type IconName = ComponentProps<typeof Ionicons>['name']

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  )
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1d4ed8' }}>
      <Tabs.Screen name="index" options={{ title: 'Send', tabBarIcon: icon('paper-plane-outline') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('key-outline') }} />
      <Tabs.Screen
        name="budget"
        options={{ title: 'Budget', headerTitle: 'Budget (server key)', tabBarIcon: icon('wallet-outline') }}
      />
    </Tabs>
  )
}
