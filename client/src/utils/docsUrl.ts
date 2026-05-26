import { withBasePath } from './basePath'

function resolveDocsUrl(): string {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/ai/dev')) {
    return '/ai/dev/docs/'
  }
  return withBasePath('/docs/')
}

export const docsUrl = resolveDocsUrl()
