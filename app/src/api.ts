import Constants from 'expo-constants'
import { Platform } from 'react-native'

/**
 * server's URL. Override with EXPO_PUBLIC_API_URL; otherwise reuse the
 * host the dev server is served from, so Expo Go on a real phone reaches the
 * Mac over the LAN and the simulator/web reach localhost.
 */
function resolveApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3040`
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0]
  return `http://${host ?? 'localhost'}:3040`
}

export const API_URL = resolveApiUrl()

export interface ConnectionView {
  id: string
  status: 'pending' | 'connected' | 'rejected' | 'failed' | 'disconnected'
  walletAddress: string
  budget: string
  recurring: boolean
  spent: string | null
  tokenRotations: number
  error: string | null
  payments: {
    id: string
    receiver: string
    debitAmount: string
    receiveAmount: string | null
    createdAt: string
  }[]
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  if (response.status === 204) return undefined as T
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error ?? `${method} ${path} failed (${response.status})`)
  return json as T
}

export const api = {
  health: () => request<{ ok: boolean; target: string; client: string }>('GET', '/health'),
  startConnection: (body: { walletAddress: string; amount: string; recurring: boolean; finishUri: string }) =>
    request<{ connectionId: string; redirectUrl: string; finishUri: string }>('POST', '/connections', body),
  finishConnection: (id: string, params: Record<string, string>) =>
    request<ConnectionView>('POST', `/connections/${id}/finish`, params),
  getConnection: (id: string) => request<ConnectionView>('GET', `/connections/${id}`),
  pay: (id: string, body: { receiver: string; amount: string }) =>
    request<{ outgoingPaymentUrl: string; debitAmount: string; receiveAmount: string }>(
      'POST',
      `/connections/${id}/payments`,
      body
    ),
  disconnect: (id: string) => request<void>('DELETE', `/connections/${id}`),
  // Onboarding (Checkout tab): the backend, as GNAP client, asks the user's
  // wallet to confirm ownership before the phone creates its key.
  startOwnershipCheck: (body: { walletAddress: string; finishUri: string }) =>
    request<{ checkId: string; redirectUrl: string; walletAddress: string }>('POST', '/ownership-checks', body),
  finishOwnershipCheck: (checkId: string, params: Record<string, string>) =>
    request<{ walletAddress: string; verifiedAt: string }>('POST', `/ownership-checks/${checkId}/finish`, params)
}
