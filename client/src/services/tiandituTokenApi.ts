import { withBasePath } from '../utils/basePath'

export interface TiandituTokenStatus {
  hasToken: boolean
  maskedToken: string
  token?: string
  message?: string
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(typeof input === 'string' ? withBasePath(input) : input, init)
  const json = await response.json().catch(() => null)
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || `HTTP ${response.status}`)
  }
  return json.data as T
}

export const TIANDITU_TOKEN_CREATE_URL = 'https://oauth.tianditu.gov.cn/login?service=https%3A%2F%2Fwww.tianditu.gov.cn%2Fgateway%2Flogin%2Flogin%3Furl%3Dhttps%253A%252F%252Fwww.tianditu.gov.cn%252F'

export const tiandituTokenApi = {
  status() {
    return requestJson<TiandituTokenStatus>('/api/tianditu-token/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  },

  validateAndSave(token: string) {
    return requestJson<TiandituTokenStatus>('/api/tianditu-token/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  },

  clear() {
    return requestJson<TiandituTokenStatus>('/api/tianditu-token', {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    })
  },
}
