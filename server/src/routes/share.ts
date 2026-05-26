import { Router, type Request } from 'express'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { ShareStore, type ShareRecord, type ShareVisibility } from '../services/ShareStore.js'
import { ShareSuggestionService } from '../services/ShareSuggestionService.js'
import { getRequestTiandituToken } from '../utils/tiandituToken.js'
import { readTextField } from '../utils/transportEncoding.js'

const router = Router()
const store = new ShareStore({
  rootDir: config.share.dir,
  uploadDir: config.upload.dir,
  publicBasePath: config.publicSamples.basePath,
  thumbnail: {
    enabled: config.share.thumbnail.enabled,
    baseUrl: config.share.thumbnail.baseUrl,
    chromiumPath: config.share.thumbnail.chromiumPath,
    timeoutMs: config.share.thumbnail.timeoutMs,
    waitAfterLoadMs: config.share.thumbnail.waitAfterLoadMs,
    maxConcurrentRenders: config.share.thumbnail.maxConcurrentRenders,
  },
})
const suggestionService = new ShareSuggestionService({
  tiandituToken: config.tiandituToken,
})
const storeReady = store.init()
const MAX_SUGGEST_CODE_CHARS = 48 * 1024

function parseVisibility(value: unknown): ShareVisibility | undefined {
  if (value === 'public' || value === 'unlisted') return value
  return undefined
}

function buildAbsoluteUrl(req: Request, relativePath: string): string {
  const origin = req.get('origin')
  if (origin && /^https?:\/\//i.test(origin)) {
    try {
      return new URL(relativePath, origin).toString()
    } catch {
      // fallback below
    }
  }

  const forwardedProto = req.get('x-forwarded-proto')
  const proto = (forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http')
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || req.get('host') || `localhost:${config.port}`
  return new URL(relativePath, `${proto}://${host}`).toString()
}

function toPublicItem(req: Request, item: ShareRecord) {
  return {
    slug: item.slug,
    title: item.title,
    description: item.description,
    visibility: item.visibility,
    status: item.status,
    viewCount: item.viewCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastViewedAt: item.lastViewedAt,
    codeSizeBytes: item.codeSizeBytes,
    htmlUrl: buildAbsoluteUrl(req, `/share-assets/${item.htmlRelativePath}`),
    thumbnailUrl: buildAbsoluteUrl(req, `/share-assets/${item.thumbnailRelativePath}`),
    creatorName: item.creatorName || '普通用户',
  }
}

function resolveCreatorName(req: Request): string | undefined {
  return req.user?.displayName || req.user?.loginName
}

// POST /api/share/maps — 创建分享快照
router.post('/maps', requireAuth, async (req, res, next) => {
  try {
    await storeReady
    const code = readTextField(req.body, 'code', 'codeBase64') || ''
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined
    const description = typeof req.body?.description === 'string' ? req.body.description : undefined
    const visibility = parseVisibility(req.body?.visibility)
    const thumbnailBase64 = typeof req.body?.thumbnailBase64 === 'string' ? req.body.thumbnailBase64 : undefined

    if (!code.trim()) {
      return res.status(400).json({ success: false, error: '缺少可分享的地图代码' })
    }

    const created = await store.createShare({
      htmlCode: code,
      title,
      description,
      visibility,
      thumbnailBase64,
      tiandituToken: getRequestTiandituToken(req),
      creatorName: resolveCreatorName(req),
    })

    const sharePath = `/share/${created.item.slug}`

    res.json({
      success: true,
      data: {
        ...toPublicItem(req, created.item),
        shareUrl: buildAbsoluteUrl(req, sharePath),
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/share/maps/suggest — AI 生成分享标题和描述
router.post('/maps/suggest', requireAuth, async (req, res, next) => {
  try {
    await storeReady
    const rawCode = readTextField(req.body, 'code', 'codeBase64') || ''
    const hintRaw = typeof req.body?.hint === 'string' ? req.body.hint : ''
    const promptRaw = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
    const hint = [hintRaw, promptRaw].map((x) => x.trim()).filter(Boolean).join('\n')

    if (!rawCode.trim()) {
      return res.status(400).json({ success: false, error: '缺少可分析的地图代码' })
    }

    const code = rawCode.length > MAX_SUGGEST_CODE_CHARS
      ? rawCode.slice(0, MAX_SUGGEST_CODE_CHARS)
      : rawCode

    const suggestion = await suggestionService.suggest({
      code,
      hint: hint || undefined,
      tiandituToken: getRequestTiandituToken(req),
    })
    res.json({
      success: true,
      data: suggestion,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/share/maps/:slug — 获取分享详情（默认计数一次浏览）
router.get('/maps/:slug', async (req, res, next) => {
  try {
    await storeReady
    const slug = String(req.params.slug || '').trim()
    if (!slug) return res.status(400).json({ success: false, error: '缺少 slug' })

    const track = req.query.track === '0' ? false : true
    const rawItem = await store.getBySlug(slug, { incrementView: false })
    if (!rawItem) {
      return res.status(404).json({ success: false, error: '分享不存在或已下架' })
    }

    if (rawItem.status !== 'active') {
      return res.status(404).json({ success: false, error: '分享不存在或已下架' })
    }

    let item = rawItem
    if (track && rawItem.status === 'active') {
      const tracked = await store.getBySlug(slug, { incrementView: true })
      if (tracked) item = tracked
    }

    res.json({
      success: true,
      data: {
        ...toPublicItem(req, item),
        shareUrl: buildAbsoluteUrl(req, `/share/${item.slug}`),
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/share/public — 公开样例列表
router.get('/public', async (req, res, next) => {
  try {
    await storeReady
    const page = Number(req.query.page || 1)
    const pageSize = Number(req.query.pageSize || 24)
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const sort = req.query.sort === 'viewCount' ? 'viewCount' : 'createdAt'
    const result = await store.listPublic({ page, pageSize, q, sort })

    res.json({
      success: true,
      data: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        items: result.items.map((item) => toPublicItem(req, item)),
      },
    })
  } catch (err) {
    next(err)
  }
})

export default router
