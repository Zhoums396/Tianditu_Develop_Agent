import { Router, type Request, type Response } from 'express'
import { AdminCodebookService } from '../services/AdminCodebook.js'
import { parseBoundaryWKT } from '../services/BoundaryParser.js'
import { TiandituApi } from '../services/TiandituApi.js'
import { getRequestTiandituToken } from '../utils/tiandituToken.js'

const router = Router()
const adminCodebook = new AdminCodebookService()

const DEFAULT_MAP_BOUND = '73.0,3.0,135.0,54.0'

type OutputScope = 'root' | 'children' | 'all'

interface DistrictNode {
  name?: string
  gb?: string
  level?: number
  center?: { lng?: number | string; lat?: number | string }
  boundary?: string
  boundaryGeoJSON?: {
    type: 'Feature'
    geometry: unknown
    properties: Record<string, unknown>
  } | null
  children?: DistrictNode[]
  [key: string]: unknown
}

interface FlattenedNode {
  node: DistrictNode
  depth: number
}

function toOptionalInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value == null || value === '') return defaultValue
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(text)) return true
  if (['0', 'false', 'no', 'n'].includes(text)) return false
  return defaultValue
}

function toOutputScope(value: unknown, defaultValue: OutputScope): OutputScope {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'root' || text === 'children' || text === 'all') return text
  return defaultValue
}

function flattenDistrictTree(nodes: DistrictNode[], maxDepth: number): FlattenedNode[] {
  const out: FlattenedNode[] = []
  const walk = (list: DistrictNode[], depth: number) => {
    if (!Array.isArray(list) || !list.length) return
    for (const node of list) {
      out.push({ node, depth })
      if (depth < maxDepth && Array.isArray(node.children) && node.children.length) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(nodes, 0)
  return out
}

function attachBoundaryGeoJSON(node: DistrictNode) {
  if (!node || typeof node !== 'object') return
  if (node.boundaryGeoJSON) return
  if (!node.boundary || typeof node.boundary !== 'string') return

  const geometry = parseBoundaryWKT(node.boundary)
  node.boundaryGeoJSON = geometry
    ? {
      type: 'Feature',
      geometry,
      properties: {
        name: node.name,
        gb: node.gb,
        level: node.level,
      },
    }
    : null
}

function createRequestApi(req: Request, res: Response): TiandituApi | null {
  const token = (req as any).tiandituTokenOverride || getRequestTiandituToken(req)
  if (!token) {
    res.status(400).json({ success: false, error: '请先在用户菜单中配置天地图应用密钥 tk' })
    return null
  }
  return new TiandituApi(token)
}

// GET /api/tianditu/search — 地名搜索 V2（queryType 1/2/3/7/10/12/13/14）
router.get('/search', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const {
      keyword,
      keyWord,
      type,
      queryType,
      start,
      count,
      level,
      mapBound,
      specify,
      dataTypes,
      show,
      pointLonlat,
      queryRadius,
      polygon,
      lng,
      lat,
      radius,
    } = req.query

    const inferByType = (() => {
      if (type === 'nearby') return 3
      if (type === 'view') return 2
      if (type === 'polygon') return 10
      if (type === 'admin-area') return 12
      if (type === 'category') return 13
      if (type === 'stats') return 14
      if (type === 'admin') return 7
      return 1
    })()

    const qt = toOptionalInt(queryType) ?? inferByType
    const kw = pickString(keyword) || pickString(keyWord)
    const mapBoundText = pickString(mapBound) || DEFAULT_MAP_BOUND
    const levelNum = toOptionalInt(level) ?? 12
    const startNum = toOptionalInt(start) ?? 0
    const countNum = toOptionalInt(count) ?? 20
    const showNum = toOptionalInt(show)
    const specifyText = pickString(specify)
    const dataTypesText = pickString(dataTypes)

    const pointText = pickString(pointLonlat)
      || (pickString(lng) && pickString(lat) ? `${pickString(lng)},${pickString(lat)}` : undefined)
    const radiusNum = toOptionalInt(queryRadius) ?? toOptionalInt(radius) ?? 5000
    const polygonText = pickString(polygon)

    // 参数校验：按 queryType 做最小约束
    if ([1, 2, 3, 7, 10, 12, 14].includes(qt) && !kw) {
      return res.status(400).json({ success: false, error: '缺少搜索关键词 keyword/keyWord' })
    }
    if (qt === 2 && !mapBoundText) {
      return res.status(400).json({ success: false, error: '视野内搜索缺少 mapBound' })
    }
    if (qt === 3 && !pointText) {
      return res.status(400).json({ success: false, error: '周边搜索缺少 pointLonlat 或 lng+lat' })
    }
    if (qt === 10 && !polygonText) {
      return res.status(400).json({ success: false, error: '多边形搜索缺少 polygon' })
    }
    if ([12, 13, 14].includes(qt) && !specifyText) {
      return res.status(400).json({ success: false, error: '该搜索类型缺少 specify（行政区编码）' })
    }

    const postStr: Record<string, any> = {
      queryType: qt,
      start: startNum,
      count: countNum,
    }

    if (kw) postStr.keyWord = kw
    if (showNum != null) postStr.show = showNum
    if (dataTypesText) postStr.dataTypes = dataTypesText
    if (specifyText) postStr.specify = specifyText

    if ([1, 2, 7, 13].includes(qt)) {
      postStr.level = levelNum
      postStr.mapBound = mapBoundText
    }
    if (qt === 3) {
      postStr.pointLonlat = pointText
      postStr.queryRadius = radiusNum
    }
    if (qt === 10) {
      postStr.polygon = polygonText
    }

    const result = await api.searchV2(postStr)

    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/geocode — 地理编码
router.get('/geocode', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const { address } = req.query
    if (!address) return res.status(400).json({ success: false, error: '缺少地址' })
    const result = await api.geocode(address as string)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/reverse-geocode — 逆地理编码
router.get('/reverse-geocode', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const { lng, lat } = req.query
    if (!lng || !lat) return res.status(400).json({ success: false, error: '缺少坐标' })
    const result = await api.reverseGeocode(parseFloat(lng as string), parseFloat(lat as string))
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/drive — 驾车路线
router.get('/drive', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const { origLng, origLat, destLng, destLat, style } = req.query
    if (!origLng || !origLat || !destLng || !destLat) {
      return res.status(400).json({ success: false, error: '缺少起终点坐标' })
    }
    const result = await api.driveRoute(
      parseFloat(origLng as string), parseFloat(origLat as string),
      parseFloat(destLng as string), parseFloat(destLat as string),
      (style as string) || '0',
    )
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/transit — 公交/地铁路线
router.get('/transit', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const { startLng, startLat, endLng, endLat, lineType } = req.query
    if (!startLng || !startLat || !endLng || !endLat) {
      return res.status(400).json({ success: false, error: '缺少起终点坐标' })
    }

    const ltRaw = String(lineType || '1').trim()
    const lt = ['1', '2', '3', '4'].includes(ltRaw) ? (ltRaw as '1' | '2' | '3' | '4') : '1'

    const result = await api.transitRoute(
      parseFloat(startLng as string),
      parseFloat(startLat as string),
      parseFloat(endLng as string),
      parseFloat(endLat as string),
      lt,
    )
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/administrative — 行政区划
router.get('/administrative', async (req, res, next) => {
  try {
    const api = createRequestApi(req, res)
    if (!api) return
    const keyword = pickString(req.query.keyword)
    if (!keyword) return res.status(400).json({ success: false, error: '缺少关键词 keyword' })

    const childLevelRaw = toOptionalInt(req.query.childLevel)
    const childLevel = childLevelRaw != null && [0, 1, 2, 3].includes(childLevelRaw) ? (childLevelRaw as 0 | 1 | 2 | 3) : 0
    const extensions = toBoolean(req.query.extensions, false)
    const autoResolve = toBoolean(req.query.autoResolveCodebook, true)
    const expandChildrenBoundary = toBoolean(
      req.query.expandChildrenBoundary,
      childLevel > 0 && extensions,
    )
    const outputScope = toOutputScope(
      req.query.outputScope,
      childLevel > 0 ? 'children' : 'root',
    )
    // 默认返回可直接渲染的 GeoJSON，避免前端重复解析 WKT 造成闭合错误
    const boundaryFormat = pickString(req.query.boundaryFormat) || 'geojson'

    const requestedKeyword = keyword
    let resolvedKeyword = keyword
    let codebookBest = null as ReturnType<AdminCodebookService['resolveBest']>
    let codebookCandidates = [] as ReturnType<AdminCodebookService['search']>

    // 非纯 gb 编码时，先用本地 xlsx 对照表做一次解析（可关闭）
    if (autoResolve && !/^\d{9}$/.test(keyword)) {
      codebookBest = adminCodebook.resolveBest(keyword)
      codebookCandidates = adminCodebook.search(keyword, 10)
      if (codebookBest?.gb) {
        resolvedKeyword = codebookBest.gb
      }
    } else if (/^\d{9}$/.test(keyword)) {
      codebookCandidates = adminCodebook.getByGb(keyword).map((e) => ({
        ...e,
        score: 220,
        matchType: 'code-exact' as const,
      }))
      codebookBest = codebookCandidates[0] || null
    }

    const result = await api.administrativeV2(resolvedKeyword, {
      childLevel,
      extensions,
    })

    let enrichment = {
      attempted: 0,
      success: 0,
      skipped: 0,
      failed: 0,
    }

    // 可选：把 boundary WKT 预解析为 GeoJSON geometry，便于前端直接 addSource
    if (
      boundaryFormat === 'geojson'
      && result
      && typeof result === 'object'
      && result.data
      && Array.isArray(result.data.district)
    ) {
      const rootDistricts = result.data.district as DistrictNode[]

      // 先解析响应中自带的 boundary（通常只有根行政区有边界）
      for (const n of flattenDistrictTree(rootDistricts, childLevel)) {
        attachBoundaryGeoJSON(n.node)
      }

      // childLevel>0 时，官方 children 节点通常无 boundary；
      // 这里按 gb 逐个补查边界，避免“只显示 1 个省界”的问题。
      if (expandChildrenBoundary && childLevel > 0) {
        const allNodes = flattenDistrictTree(rootDistricts, childLevel)
        const targetNodes = allNodes.filter((x) => x.depth >= 1).map((x) => x.node)
        const cache = new Map<string, DistrictNode['boundaryGeoJSON']>()

        for (const node of targetNodes) {
          if (node.boundaryGeoJSON) {
            enrichment.skipped += 1
            continue
          }

          const gb = typeof node.gb === 'string' ? node.gb : ''
          if (!/^\d{9}$/.test(gb)) {
            enrichment.skipped += 1
            continue
          }

          enrichment.attempted += 1
          if (cache.has(gb)) {
            node.boundaryGeoJSON = cache.get(gb) || null
            if (node.boundaryGeoJSON) enrichment.success += 1
            else enrichment.failed += 1
            continue
          }

          try {
            const detail = await api.administrativeV2(gb, { childLevel: 0, extensions: true })
            const detailDistrict = detail?.data?.district?.[0] as DistrictNode | undefined

            let feature: DistrictNode['boundaryGeoJSON'] = null
            if (detailDistrict) {
              attachBoundaryGeoJSON(detailDistrict)
              feature = detailDistrict.boundaryGeoJSON || null
            }

            cache.set(gb, feature)
            node.boundaryGeoJSON = feature
            if (feature) enrichment.success += 1
            else enrichment.failed += 1
          } catch {
            cache.set(gb, null)
            node.boundaryGeoJSON = null
            enrichment.failed += 1
          }
        }
      }

      // 为前端提供更符合渲染直觉的 district 输出：
      // - root: 仅根行政区
      // - children: 仅下一级行政区（如省->地级市）
      // - all: 根 + 下级
      const flat = flattenDistrictTree(rootDistricts, childLevel)
      const outputDistricts = outputScope === 'all'
        ? flat.map((x) => x.node)
        : outputScope === 'children'
          ? flat.filter((x) => x.depth === 1).map((x) => x.node)
          : flat.filter((x) => x.depth === 0).map((x) => x.node)

      // 保留根级结果，便于前端按需回退
      ;(result.data as Record<string, unknown>).rootDistrict = rootDistricts
      ;(result.data as Record<string, unknown>).district = outputDistricts
    }

    res.json({
      success: true,
      data: result,
      meta: {
        requestedKeyword,
        resolvedKeyword,
        childLevel,
        extensions,
        boundaryFormat,
        expandChildrenBoundary,
        outputScope,
        boundaryEnrichment: enrichment,
        codebook: {
          ...adminCodebook.getMeta(),
          best: codebookBest,
          candidates: codebookCandidates,
        },
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/tianditu/admin-codebook/search — 本地行政区划编码表检索（xlsx）
router.get('/admin-codebook/search', (req, res) => {
  const keyword = pickString(req.query.keyword)
  if (!keyword) {
    return res.status(400).json({ success: false, error: '缺少关键词 keyword' })
  }

  const limit = Math.max(1, Math.min(toOptionalInt(req.query.limit) ?? 20, 100))
  const matches = adminCodebook.search(keyword, limit)

  res.json({
    success: true,
    data: {
      keyword,
      total: matches.length,
      matches,
    },
    meta: adminCodebook.getMeta(),
  })
})

export default router
