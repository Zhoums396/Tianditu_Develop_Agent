import type { AuthSession } from '../types/auth'
import { stripBasePath, withBasePath } from '../utils/basePath'

const DEFAULT_PATHS = {
  login: withBasePath('/sso/login'),
  logout: withBasePath('/sso/logout'),
}

function normalizeRedirectPath(value?: string, fallback = '/workspace') {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  if (!trimmed.startsWith('/')) return fallback
  if (trimmed.startsWith('//')) return fallback
  return trimmed
}

export function buildLoginUrl(redirectPath?: string) {
  const redirect = withBasePath(normalizeRedirectPath(stripBasePath(redirectPath || ''), '/workspace'))
  return `${DEFAULT_PATHS.login}?redirect=${encodeURIComponent(redirect)}`
}

export function buildLogoutUrl(redirectPath = '/') {
  const redirect = withBasePath(normalizeRedirectPath(stripBasePath(redirectPath), '/'))
  return `${DEFAULT_PATHS.logout}?redirect=${encodeURIComponent(redirect)}`
}

export function currentLocationPath() {
  if (typeof window === 'undefined') return '/workspace'
  return stripBasePath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
}

export const authApi = {
  async getSession(): Promise<AuthSession> {
    const response = await fetch(withBasePath('/api/auth/me'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const json = await response.json()
    if (!json?.success) {
      throw new Error(json?.error || '获取登录状态失败')
    }

    const data = json.data as Partial<AuthSession> | undefined
    return {
      enabled: data?.enabled === true,
      authenticated: data?.authenticated === true,
      user: data?.user || null,
      paths: {
        login: typeof data?.paths?.login === 'string' ? data.paths.login : DEFAULT_PATHS.login,
        logout: typeof data?.paths?.logout === 'string' ? data.paths.logout : DEFAULT_PATHS.logout,
      },
    }
  },

  buildLoginUrl,
  buildLogoutUrl,
  currentLocationPath,
}
