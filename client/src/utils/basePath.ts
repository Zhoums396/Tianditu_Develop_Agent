const rawBase = import.meta.env.BASE_URL || '/'

export const appBasePath = rawBase === '/'
  ? ''
  : `/${rawBase.replace(/^\/+|\/+$/g, '')}`

export function withBasePath(path: string): string {
  if (!path) return appBasePath || '/'
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(path) || path.startsWith('//')) return path

  const normalized = path.startsWith('/') ? path : `/${path}`
  if (!appBasePath) return normalized
  if (normalized === appBasePath || normalized.startsWith(`${appBasePath}/`)) return normalized
  return `${appBasePath}${normalized}`
}

export function stripBasePath(path: string): string {
  const value = path || '/'
  if (!appBasePath) return value
  if (value === appBasePath) return '/'
  if (value.startsWith(`${appBasePath}/`)) return value.slice(appBasePath.length) || '/'
  return value
}

export function appAsset(path: string): string {
  return withBasePath(path)
}
