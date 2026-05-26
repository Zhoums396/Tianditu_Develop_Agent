import { randomUUID } from 'crypto'
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, resolve } from 'path'
import { isLikelyBlankThumbnailBuffer } from './ShareThumbnailRenderer.js'

export type ShareVisibility = 'unlisted' | 'public'
export type ShareStatus = 'active' | 'removed'

interface ShareIndexFile {
  version: 1
  items: ShareRecord[]
}

export interface ShareRecord {
  id: string
  slug: string
  title: string
  description: string
  visibility: ShareVisibility
  status: ShareStatus
  htmlRelativePath: string
  thumbnailRelativePath: string
  assetFiles: string[]
  viewCount: number
  lastViewedAt?: number
  createdAt: number
  updatedAt: number
  codeSizeBytes: number
  creatorName?: string
}

export interface CreateShareInput {
  htmlCode: string
  title?: string
  description?: string
  visibility?: ShareVisibility
  thumbnailBase64?: string
  tiandituToken?: string
  creatorName?: string
}

export interface ListPublicOptions {
  page: number
  pageSize: number
  q?: string
  sort?: 'viewCount' | 'createdAt'
}

export interface ListPublicResult {
  total: number
  page: number
  pageSize: number
  items: ShareRecord[]
}

export interface ShareStoreOptions {
  rootDir: string
  uploadDir: string
  tiandituToken?: string
  publicBasePath?: string
  thumbnail?: {
    enabled?: boolean
    baseUrl?: string
    chromiumPath?: string
    timeoutMs?: number
    waitAfterLoadMs?: number
    maxConcurrentRenders?: number
  }
}

const INDEX_FILE_NAME = 'index.json'
const SNAPSHOT_DIR_NAME = 'snapshots'
const PUBLIC_SDK_VERSION = '20260522-restore-v5'

function normalizePublicBasePath(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed === '/') return ''
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function nowTs() {
  return Date.now()
}

function normalizeVisibility(input?: string): ShareVisibility {
  return input === 'public' ? 'public' : 'unlisted'
}

function sanitizeTitle(input?: string): string {
  const raw = String(input || '').trim()
  const title = raw || `地图快照 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  return title.slice(0, 80)
}

function sanitizeDescription(input?: string): string {
  const raw = String(input || '').trim()
  return raw.slice(0, 240)
}

function sanitizeCreatorName(input?: string): string | undefined {
  const raw = String(input || '').replace(/\s+/g, ' ').trim()
  return raw ? raw.slice(0, 80) : undefined
}

const MAX_THUMBNAIL_IMAGE_BYTES = 6 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function decodeThumbnailBase64(raw?: string): Buffer | null {
  const input = String(raw || '').trim()
  if (!input) return null

  const normalized = input
    .replace(/^data:image\/png;base64,/i, '')
    .replace(/\s+/g, '')
    .trim()
  if (!normalized) return null

  try {
    const buf = Buffer.from(normalized, 'base64')
    if (!buf.length || buf.length > MAX_THUMBNAIL_IMAGE_BYTES) return null
    if (buf.length < PNG_SIGNATURE.length) return null
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
      if (buf[i] !== PNG_SIGNATURE[i]) return null
    }
    return buf
  } catch {
    return null
  }
}

function safeSlug(): string {
  const seed = randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}-${seed.slice(0, 10)}`
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildThumbnailSvg(title: string, visibility: ShareVisibility, createdAt: number): string {
  const normalizedTitle = String(title || '地图快照').replace(/\s+/g, ' ').trim() || '地图快照'
  const displayTitle = normalizedTitle.length > 16 ? `${normalizedTitle.slice(0, 15)}…` : normalizedTitle
  const safeTitle = escapeXml(displayTitle)
  const sub = visibility === 'public' ? '公开样例' : '未公开链接'
  const safeSub = escapeXml(sub)
  const date = escapeXml(new Date(createdAt).toLocaleString('zh-CN', { hour12: false }))

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f5fff"/>
      <stop offset="100%" stop-color="#18a4ff"/>
    </linearGradient>
    <radialGradient id="r1" cx="20%" cy="15%" r="60%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.42)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <clipPath id="titleClip">
      <rect x="72" y="190" width="1040" height="100" rx="8"/>
    </clipPath>
  </defs>
  <rect width="1200" height="630" fill="#0f1628"/>
  <rect x="20" y="20" width="1160" height="590" rx="28" fill="url(#g1)"/>
  <rect x="20" y="20" width="1160" height="590" rx="28" fill="url(#r1)"/>
  <text x="72" y="150" font-size="38" fill="rgba(255,255,255,0.95)" font-family="PingFang SC, Microsoft YaHei, sans-serif">天地图智能开发平台</text>
  <text x="72" y="250" font-size="56" fill="#ffffff" font-weight="700" clip-path="url(#titleClip)" font-family="PingFang SC, Microsoft YaHei, sans-serif">${safeTitle}</text>
  <text x="72" y="332" font-size="30" fill="rgba(255,255,255,0.9)" font-family="PingFang SC, Microsoft YaHei, sans-serif">${safeSub}</text>
  <text x="72" y="580" font-size="24" fill="rgba(255,255,255,0.82)" font-family="PingFang SC, Microsoft YaHei, sans-serif">${date}</text>
</svg>`
}

function isPathInside(baseDir: string, candidate: string): boolean {
  const resolvedBase = resolve(baseDir)
  const resolvedCandidate = resolve(candidate)
  return resolvedCandidate.startsWith(resolvedBase)
}

export class ShareStore {
  private readonly rootDir: string
  private readonly uploadDir: string
  private readonly snapshotsDir: string
  private readonly indexPath: string
  private readonly tiandituToken?: string
  private readonly publicBasePath: string

  private ready = false
  private initPromise: Promise<void> | null = null
  private indexData: ShareIndexFile = { version: 1, items: [] }
  private opQueue: Promise<unknown> = Promise.resolve()

  constructor(opts: ShareStoreOptions) {
    this.rootDir = opts.rootDir
    this.uploadDir = opts.uploadDir
    this.snapshotsDir = resolve(this.rootDir, SNAPSHOT_DIR_NAME)
    this.indexPath = resolve(this.rootDir, INDEX_FILE_NAME)
    this.tiandituToken = opts.tiandituToken
    this.publicBasePath = normalizePublicBasePath(opts.publicBasePath || process.env.PUBLIC_SAMPLE_BASE_PATH || process.env.VITE_BASE_PATH || '/ai/dev/')
  }

  async init() {
    if (this.ready) return
    if (this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = (async () => {
      await mkdir(this.rootDir, { recursive: true })
      await mkdir(this.snapshotsDir, { recursive: true })

      try {
        await access(this.indexPath)
        const raw = await readFile(this.indexPath, 'utf-8')
        const parsed = JSON.parse(raw) as ShareIndexFile
        if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) {
          this.indexData = {
            version: 1,
            items: parsed.items.filter((item) => item && typeof item.slug === 'string'),
          }
        } else {
          this.indexData = { version: 1, items: [] }
        }
      } catch {
        this.indexData = { version: 1, items: [] }
        await this.persistIndex()
      }

      this.ready = true
    })()

    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private async persistIndex() {
    await writeFile(this.indexPath, JSON.stringify(this.indexData, null, 2), 'utf-8')
  }

  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.opQueue.then(fn, fn)
    this.opQueue = task.then(() => undefined, () => undefined)
    return task
  }

  private async writeSvgThumbnail(slug: string, title: string, visibility: ShareVisibility, createdAt: number): Promise<string> {
    const thumbnailRelativePath = `${slug}/thumbnail.svg`
    const thumbnailPath = resolve(this.snapshotsDir, thumbnailRelativePath)
    const thumbnailSvg = buildThumbnailSvg(title, visibility, createdAt)
    await writeFile(thumbnailPath, thumbnailSvg, 'utf-8')
    return thumbnailRelativePath
  }

  private normalizeHtml(rawHtml: string, _tiandituToken?: string): string {
    let html = String(rawHtml || '')
    if (!html.includes('<!DOCTYPE html>') && !html.includes('<html')) {
      html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>${html}</body></html>`
    }

    const publicApiPrefix = `${this.publicBasePath}/api/public/tianditu/`
    const publicSdkUrl = `${this.publicBasePath}/api/public/tianditu-js/v5?v=${PUBLIC_SDK_VERSION}`

    html = html.replace(/https?:\/\/api\.tianditu\.gov\.cn\/api\/v5\/js(?:\?tk=[^"'`\s&>]*)?/gi, publicSdkUrl)
    html = html.replace(/(["'`])\/(?:ai\/dev\/)?api\/public\/tianditu-js\/v5(?:\?[^"'`\s&>]*)?/gi, `$1${publicSdkUrl}`)
    html = html.replace(/\$\{TIANDITU_TOKEN\}/g, '__TDT_PUBLIC_SAMPLE_TOKEN__')
    html = html.replace(/\b(?:your_tianditu_token_here|YOUR_TIANDITU_TOKEN|YOUR_TIANDITU_API_KEY|your_tianditu_api_key)\b/g, '__TDT_PUBLIC_SAMPLE_TOKEN__')
    html = html.replace(/((?:https?:\/\/)?[^"'`\s<>]*tianditu\.gov\.cn[^"'`\s<>]*[?&]tk=)[^"'`\s&<>]+/gi, '$1__TDT_PUBLIC_SAMPLE_TOKEN__')
    html = html.replace(/(["'`])\/(?:ai\/dev\/)?api\/tianditu\//g, `$1${publicApiPrefix}`)
    html = html.replace(/(["'`])https?:\/\/[^"'`]+\/(?:ai\/dev\/)?api\/tianditu\//g, `$1${publicApiPrefix}`)

    return html
  }

  private extractUploadRelativePath(rawUrl: string): string | null {
    const text = String(rawUrl || '').trim()
    if (!text) return null

    let pathname = ''
    if (text.startsWith('/uploads/')) {
      pathname = text
    } else {
      try {
        const parsed = new URL(text)
        pathname = parsed.pathname || ''
      } catch {
        return null
      }
    }

    const marker = '/uploads/'
    const idx = pathname.indexOf(marker)
    if (idx < 0) return null

    const relative = pathname.slice(idx + marker.length)
    if (!relative || relative.includes('..')) return null
    return decodeURIComponent(relative)
  }

  private async rewriteUploadReferences(html: string, slug: string, snapshotDir: string): Promise<{ html: string; assetFiles: string[] }> {
    const urlRegex = /(?:https?:\/\/[^\s"'`<>]+)?\/uploads\/[^\s"'`<>]+/g
    const matched = html.match(urlRegex) || []
    if (!matched.length) return { html, assetFiles: [] }

    const assetsDir = resolve(snapshotDir, 'assets')
    await mkdir(assetsDir, { recursive: true })

    const rewriteMap = new Map<string, string>()
    const savedAssets: string[] = []
    let seq = 1

    for (const originalUrl of matched) {
      if (rewriteMap.has(originalUrl)) continue

      const relativeUploadPath = this.extractUploadRelativePath(originalUrl)
      if (!relativeUploadPath) continue

      const sourcePath = resolve(this.uploadDir, relativeUploadPath)
      if (!isPathInside(this.uploadDir, sourcePath)) continue

      try {
        await access(sourcePath)
      } catch {
        continue
      }

      const sourceBase = basename(relativeUploadPath)
      const ext = extname(sourceBase)
      const safeExt = ext && ext.length <= 12 ? ext : ''
      const targetName = `asset-${seq}${safeExt}`
      const targetPath = resolve(assetsDir, targetName)
      seq += 1

      await copyFile(sourcePath, targetPath)
      rewriteMap.set(originalUrl, `/share-assets/${slug}/assets/${targetName}`)
      savedAssets.push(`assets/${targetName}`)
    }

    if (!rewriteMap.size) return { html, assetFiles: savedAssets }

    const rewrittenHtml = html.replace(urlRegex, (raw) => rewriteMap.get(raw) || raw)
    return { html: rewrittenHtml, assetFiles: savedAssets }
  }

  async createShare(input: CreateShareInput): Promise<{ item: ShareRecord }> {
    await this.init()

    const rawCode = String(input.htmlCode || '').trim()
    if (!rawCode) {
      throw new Error('分享代码不能为空')
    }
    if (rawCode.length > 2_500_000) {
      throw new Error('分享代码过大，请精简后重试')
    }

    return this.runExclusive(async () => {
      const createdAt = nowTs()
      const slug = safeSlug()
      const id = randomUUID()
      const safeTitle = sanitizeTitle(input.title)
      const safeDescription = sanitizeDescription(input.description)
      const creatorName = sanitizeCreatorName(input.creatorName)
      const visibility = normalizeVisibility(input.visibility)
      const snapshotDir = resolve(this.snapshotsDir, slug)
      await mkdir(snapshotDir, { recursive: true })

      const normalizedHtml = this.normalizeHtml(rawCode, input.tiandituToken)
      const rewritten = await this.rewriteUploadReferences(normalizedHtml, slug, snapshotDir)
      const uploadedThumbnail = decodeThumbnailBase64(input.thumbnailBase64)

      const htmlRelativePath = `${slug}/index.html`
      const htmlPath = resolve(this.snapshotsDir, htmlRelativePath)
      await writeFile(htmlPath, rewritten.html, 'utf-8')

      const pngRelativePath = `${slug}/thumbnail.png`
      const pngPath = resolve(this.snapshotsDir, pngRelativePath)
      let thumbnailRelativePath = ''

      if (uploadedThumbnail) {
        if (isLikelyBlankThumbnailBuffer(uploadedThumbnail)) {
          console.warn(`[ShareStore] 前端缩略图疑似空白，改用 SVG 缩略图 (${slug})`)
        } else {
          try {
            await writeFile(pngPath, uploadedThumbnail)
            thumbnailRelativePath = pngRelativePath
          } catch (err: any) {
            console.warn(`[ShareStore] 前端缩略图写入失败，改用 SVG 缩略图 (${slug}): ${err?.message || 'unknown reason'}`)
          }
        }
      }

      if (!thumbnailRelativePath) {
        thumbnailRelativePath = await this.writeSvgThumbnail(slug, safeTitle, visibility, createdAt)
      }

      const htmlStat = await stat(htmlPath)
      const item: ShareRecord = {
        id,
        slug,
        title: safeTitle,
        description: safeDescription,
        visibility,
        status: 'active',
        htmlRelativePath,
        thumbnailRelativePath,
        assetFiles: rewritten.assetFiles,
        viewCount: 0,
        createdAt,
        updatedAt: createdAt,
        codeSizeBytes: htmlStat.size,
        creatorName,
      }

      this.indexData.items.unshift(item)
      await this.persistIndex()

      return { item }
    })
  }

  async getBySlug(slug: string, options?: { incrementView?: boolean }): Promise<ShareRecord | null> {
    await this.init()
    const normalizedSlug = String(slug || '').trim()
    if (!normalizedSlug) return null

    if (!options?.incrementView) {
      const found = this.indexData.items.find((item) => item.slug === normalizedSlug) || null
      return found ? { ...found } : null
    }

    return this.runExclusive(async () => {
      const idx = this.indexData.items.findIndex((item) => item.slug === normalizedSlug)
      if (idx < 0) return null
      const target = this.indexData.items[idx]
      target.viewCount += 1
      target.lastViewedAt = nowTs()
      await this.persistIndex()
      return { ...target }
    })
  }

  async listPublic(options: ListPublicOptions): Promise<ListPublicResult> {
    await this.init()

    const page = Number.isFinite(options.page) && options.page > 0 ? Math.floor(options.page) : 1
    const pageSize = Number.isFinite(options.pageSize) && options.pageSize > 0 ? Math.min(Math.floor(options.pageSize), 60) : 24

    const query = String(options.q || '').trim().toLowerCase()
    const sort = options.sort === 'viewCount' ? 'viewCount' : 'createdAt'

    const all = this.indexData.items
      .filter((item) => item.status === 'active' && item.visibility === 'public')
      .filter((item) => {
        if (!query) return true
        return [
          item.title,
          item.description,
          item.creatorName || '',
        ].some((text) => String(text || '').toLowerCase().includes(query))
      })
      .sort((a, b) => {
        if (sort === 'viewCount') {
          return (b.viewCount - a.viewCount) || (b.createdAt - a.createdAt)
        }
        return b.createdAt - a.createdAt
      })

    const total = all.length
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const items = all.slice(start, end).map((item) => ({ ...item }))

    return {
      total,
      page,
      pageSize,
      items,
    }
  }
}
