export type ShareVisibility = 'unlisted' | 'public'
export type ShareStatus = 'active' | 'removed'

export interface ShareItem {
  slug: string
  title: string
  description: string
  visibility: ShareVisibility
  status: ShareStatus
  viewCount: number
  createdAt: number
  updatedAt: number
  lastViewedAt?: number
  codeSizeBytes: number
  htmlUrl: string
  thumbnailUrl: string
  creatorName?: string
}

export interface ShareCreateResult extends ShareItem {
  shareUrl: string
}

export interface ShareSuggestResult {
  title: string
  description: string
  source: 'ai' | 'fallback'
  model?: string
}

export interface SharePublicListResult {
  total: number
  page: number
  pageSize: number
  items: ShareItem[]
}
