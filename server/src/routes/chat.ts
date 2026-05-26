import { Router, type Request } from 'express'
import { constants as fsConstants } from 'fs'
import { access, stat } from 'fs/promises'
import { basename, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { MapAgent } from '../agent/MapAgent.js'
import { enrichToolExecutionChunk } from '../agent/ToolUiMetadata.js'
import { FileParser } from '../services/FileParser.js'
import { GeoJSONParser } from '../services/GeoJSONParser.js'
import { VisualRenderService } from '../services/VisualRenderService.js'
import { VisualInspectionService } from '../services/VisualInspectionService.js'
import { upload } from '../middleware/upload.js'
import { config } from '../config.js'
import {
  buildRuntimeGeojsonContract,
  buildRuntimeJsonContract,
  extractRuntimeFileContract,
  formatRuntimeGeojsonContract,
  formatRuntimeJsonContract,
} from '../agent/FileContextContract.js'
import { getRequestContext } from '../middleware/requestContext.js'
import {
  buildUploadRelativeUrl,
  normalizeStructuredRuntime,
  saveNormalizedStructuredData,
} from '../services/StructuredFileRuntime.js'
import { runDossierStore, type RunEntrySource, type RunOutcome, type RunPhase } from '../services/RunDossierStore.js'
import { getRequestTiandituToken } from '../utils/tiandituToken.js'
import { readTextField } from '../utils/transportEncoding.js'

const router = Router()
const agent = new MapAgent()
const fileParser = new FileParser()
const visualRenderService = new VisualRenderService({
  enabled: config.visualInspection.enabled,
  baseUrl: config.visualInspection.baseUrl,
  snapshotsDir: resolve(config.share.dir, 'snapshots'),
  chromiumPath: config.visualInspection.chromiumPath,
  timeoutMs: config.visualInspection.timeoutMs,
  waitAfterLoadMs: config.visualInspection.waitAfterLoadMs,
  viewportWidth: config.visualInspection.viewportWidth,
  viewportHeight: config.visualInspection.viewportHeight,
  maxConcurrentRenders: config.visualInspection.maxConcurrentRenders,
})
const visualInspectionService = new VisualInspectionService({
  timeoutMs: config.visualInspection.llmTimeoutMs,
})

const SAMPLE_FEATURE_COUNT = 3
const SAMPLE_ROW_COUNT = 3
const MAX_SAMPLE_OBJECT_KEYS = 16
const MAX_SAMPLE_ARRAY_ITEMS = 8
const MAX_SAMPLE_DEPTH = 5
const MAX_SAMPLE_STRING_LEN = 160

const currentDir = dirname(fileURLToPath(import.meta.url))
const builtinSampleDir = resolve(currentDir, '../../assets/samples')

const BUILTIN_SAMPLE_FILES = {
  'village-renovation': resolve(builtinSampleDir, 'village-renovation.geojson'),
  'fulian-centers': resolve(builtinSampleDir, 'fulian-centers.geojson'),
  'china-flood-events': resolve(builtinSampleDir, 'china-flood-events.geojson'),
  'long-march': resolve(builtinSampleDir, 'long-march.json'),
} as const

type BuiltinSampleId = keyof typeof BUILTIN_SAMPLE_FILES

function isBuiltinSampleId(value: unknown): value is BuiltinSampleId {
  return typeof value === 'string' && value in BUILTIN_SAMPLE_FILES
}

/** 统一替换 token：占位符 + LLM 可能硬编码的任意 32 位 hex token */
function injectToken(code: string, req?: Request): string {
  const token = req ? getRequestTiandituToken(req) : config.tiandituToken
  if (!token) return code
  // 替换占位符
  code = code.replace(/\$\{TIANDITU_TOKEN\}/g, token)
  code = code.replace(/\b(?:your_tianditu_token_here|YOUR_TIANDITU_TOKEN|YOUR_TIANDITU_API_KEY|your_tianditu_api_key)\b/g, token)
  // 替换 LLM 硬编码的任意 tk 值（CDN URL 中）
  code = code.replace(/(api\.tianditu\.gov\.cn\/api\/v5\/js\?tk=)[a-f0-9]{32}/g, `$1${token}`)
  // 兼容修复：部分模型会反复生成 style: 'default'，在当前天地图 v5.0 运行环境下可能触发底图 404（default）
  // 默认样式应省略 style 字段。
  code = code.replace(/(\s+)style\s*:\s*['"]default['"]\s*,/g, '$1')
  code = code.replace(/,\s*style\s*:\s*['"]default['"](\s*[}\]])/g, '$1')
  return code
}

function buildRuntimeFilePath(relativePath: string): string {
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  if (!path.startsWith('/uploads/')) return path

  const rawBase = config.publicSamples.basePath || process.env.VITE_BASE_PATH || ''
  const basePath = rawBase && rawBase !== '/'
    ? `/${rawBase.replace(/^\/+|\/+$/g, '')}`
    : ''

  if (!basePath || path.startsWith(`${basePath}/`)) return path
  return `${basePath}${path}`
}

function buildAbsoluteFileUrl(req: Request, relativePath: string): string | undefined {
  const runtimePath = buildRuntimeFilePath(relativePath)

  // 优先使用浏览器 Origin（经 Vite 代理转发时通常仍保留），这样更贴近页面实际运行的同源地址（如 :5173）
  const origin = req.get('origin')
  if (origin && /^https?:\/\//i.test(origin)) {
    try {
      return new URL(runtimePath, origin).toString()
    } catch {
      // ignore and fallback
    }
  }

  // 其次使用代理头/Host 构建服务端绝对地址
  const forwardedProto = req.get('x-forwarded-proto')
  const proto = (forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http')
  const host = req.get('host')
  if (!host) return undefined

  try {
    return new URL(runtimePath, `${proto}://${host}`).toString()
  } catch {
    return undefined
  }
}

function truncateText(value: string, maxLen = MAX_SAMPLE_STRING_LEN): string {
  if (value.length <= maxLen) return value
  return `${value.slice(0, maxLen)}…(truncated, ${value.length} chars)`
}

function roundNum(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n
}

function summarizeCoordinates(coords: any, depth = 0): any {
  if (coords == null) return coords
  if (typeof coords === 'number') return roundNum(coords)
  if (!Array.isArray(coords)) return coords

  // 几何坐标数组通常层级较深；逐层收缩，避免多边形坐标把 token 撑爆
  const limitsByDepth = [2, 3, 6, 2] // polygon/multipolygon: 多边形数 / ring 数 / 点数 / [lng,lat]
  const limit = limitsByDepth[Math.min(depth, limitsByDepth.length - 1)]
  const sliced = coords.slice(0, limit).map((item) => summarizeCoordinates(item, depth + 1))
  if (coords.length > limit) {
    sliced.push(`...(${coords.length - limit} more items)`)
  }
  return sliced
}

function extractFirstCoordinateFromGeometry(geometry: any): [number, number] | null {
  const walk = (coords: any): [number, number] | null => {
    if (!Array.isArray(coords)) return null
    if (
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number' &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1])
    ) {
      return [roundNum(coords[0]), roundNum(coords[1])]
    }
    for (const item of coords) {
      const found = walk(item)
      if (found) return found
    }
    return null
  }

  if (!geometry || typeof geometry !== 'object') return null
  return walk((geometry as any).coordinates)
}

function sanitizeForSample(value: any, depth = 0): any {
  if (value == null) return value
  if (typeof value === 'string') return truncateText(value)
  if (typeof value === 'number') return roundNum(value)
  if (typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    const limit = MAX_SAMPLE_ARRAY_ITEMS
    const arr = value.slice(0, limit).map((v) => sanitizeForSample(v, depth + 1))
    if (value.length > limit) arr.push(`...(${value.length - limit} more items)`)
    return arr
  }

  if (typeof value === 'object') {
    if (depth >= MAX_SAMPLE_DEPTH) return '[Object truncated]'
    const entries = Object.entries(value)
    const out: Record<string, any> = {}
    for (const [k, v] of entries.slice(0, MAX_SAMPLE_OBJECT_KEYS)) {
      out[k] = sanitizeForSample(v, depth + 1)
    }
    if (entries.length > MAX_SAMPLE_OBJECT_KEYS) {
      out.__truncatedKeys = `${entries.length - MAX_SAMPLE_OBJECT_KEYS} more keys`
    }
    return out
  }

  return String(value)
}

function countCoordinatePairs(coords: any): number {
  if (!Array.isArray(coords)) return 0
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') return 1
  let count = 0
  for (const item of coords) count += countCoordinatePairs(item)
  return count
}

function summarizeFeatureForSample(feature: any): any {
  if (!feature || typeof feature !== 'object') return sanitizeForSample(feature)

  const firstCoordinate = extractFirstCoordinateFromGeometry(feature.geometry)
  const geometry = feature.geometry && typeof feature.geometry === 'object'
    ? {
      type: feature.geometry.type,
      pointCount: countCoordinatePairs(feature.geometry.coordinates),
      firstCoordinate,
      coordinates: summarizeCoordinates(feature.geometry.coordinates),
    }
    : feature.geometry

  return {
    type: feature.type || 'Feature',
    id: feature.id ?? undefined,
    properties: sanitizeForSample(feature.properties || {}),
    geometry,
  }
}

function buildGeojsonFileContext(params: {
  fileName: string
  fileUrl: string
  originalSummaryLine: string
  normalizedGeoJSON: any
}): string {
  const featureSamples = Array.isArray(params.normalizedGeoJSON?.features)
    ? params.normalizedGeoJSON.features.slice(0, SAMPLE_FEATURE_COUNT).map(summarizeFeatureForSample)
    : []
  const contract = buildRuntimeGeojsonContract({
    fileUrl: params.fileUrl,
    geojsonPath: 'rawData',
    featureCollection: params.normalizedGeoJSON,
  })

  return [
    `文件: ${params.fileName}`,
    `文件获取链接URL: ${params.fileUrl}`,
    formatRuntimeGeojsonContract(contract),
    '## 运行时强约束',
    '- fetch(url).json() 的结果变量记为 rawData 时，必须直接把 rawData 当作 GeoJSON 使用。',
    '- 禁止根据原始来源去猜测 rawData.data、rawData.rawData 等额外包装层。',
    '- 允许为了遍历、统计、热力图权重计算而读取 FeatureCollection.features；但禁止把 features 数组直接传给 map.addSource。',
    '- coordinatesPreview 仅用于预览；运行时代码统一读取 geometry.coordinates。',
    '- 传给 map.addSource({ type: "geojson", data }) 的 data 必须是 FeatureCollection/Feature 对象，禁止传 features 数组。',
    `## GeoJSON 数据样例（前 ${SAMPLE_FEATURE_COUNT} 个要素，已截断长字段/坐标）`,
    JSON.stringify(featureSamples, null, 2),
    '## 原始来源附注（仅供溯源，禁止作为运行时代码读取路径）',
    `- 原始文件结构说明: ${params.originalSummaryLine}`,
    '- 后端已经将该文件归一化为新的 GeoJSON 文件 URL；运行时代码只能按“运行时文件契约”中的 fileUrl 与 geojsonPath 读取。',
  ].join('\n')
}

function buildJsonFileContext(params: {
  fileName: string
  fileUrl: string
  originalSummaryLine: string
  normalizedJson: any
}): string {
  const contract = buildRuntimeJsonContract({
    fileUrl: params.fileUrl,
    jsonData: params.normalizedJson,
  })
  const sample = sanitizeForSample(params.normalizedJson)
  const sampleLabel = Array.isArray(params.normalizedJson)
    ? `JSON 数据样例（前 ${Math.min(params.normalizedJson.length, SAMPLE_ROW_COUNT)} 项，已截断长字段）`
    : 'JSON 数据样例（根对象节选，已截断长字段）'

  return [
    `文件: ${params.fileName}`,
    `文件获取链接URL: ${params.fileUrl}`,
    formatRuntimeJsonContract(contract),
    '## 运行时强约束',
    '- fetch(url).json() 的结果变量记为 rawData 时，必须严格按 canonicalAccess 访问，不要自行猜测根结构。',
    '- responseShape=object 时，禁止使用 rawData[0] / data[0] 这类数组根写法。',
    '- responseShape=array 时，禁止直接假设 rawData.someKey；应先访问数组元素再读取字段。',
    '- 顶层 key、字段名、坐标字段只允许来自运行时契约或自动数据理解结果，禁止凭空发明“第一支队伍/第二支队伍/队伍列表”等别名。',
    `## ${sampleLabel}`,
    JSON.stringify(sample, null, 2),
    '## 原始来源附注（仅供溯源，禁止作为运行时代码读取路径）',
    `- 原始文件结构说明: ${params.originalSummaryLine}`,
    '- 后端已经将该文件归一化为新的 UTF-8 JSON 文件 URL；运行时代码只能按“运行时文件契约”中的 fileUrl 读取。',
  ].join('\n')
}

async function saveNormalizedRuntimeFile(req: Request, normalizedData: any, ext: '.json' | '.geojson'): Promise<string> {
  const sessionId = getRequestContext(req).sessionId
  const relativeUrl = await saveNormalizedStructuredData({
    sessionId,
    normalizedData,
    ext,
  })
  return buildAbsoluteFileUrl(req, relativeUrl) || relativeUrl
}

/** 解析上传的文件为文本摘要（含文件访问 URL） */
async function parseUploadedFile(file: Express.Multer.File, req: Request): Promise<string | undefined> {
  const parsed = await fileParser.parse(file.path)
  // 构建原始文件 URL（仅兜底使用）
  const rawFileUrl = buildUploadRelativeUrl(file.path)
  const rawPreferredFileUrl = buildAbsoluteFileUrl(req, rawFileUrl) || rawFileUrl
  const normalizedRuntime = normalizeStructuredRuntime(parsed)
  const originalSummaryLine = parsed.summary.split('\n')[0] || parsed.summary

  if (normalizedRuntime?.runtimeKind === 'geojson') {
    const normalizedFileUrl = await saveNormalizedRuntimeFile(req, normalizedRuntime.normalizedData, '.geojson')
    return buildGeojsonFileContext({
      fileName: file.originalname,
      fileUrl: normalizedFileUrl,
      originalSummaryLine,
      normalizedGeoJSON: normalizedRuntime.normalizedData,
    })
  }

  if (normalizedRuntime?.runtimeKind === 'json') {
    const normalizedFileUrl = await saveNormalizedRuntimeFile(req, normalizedRuntime.normalizedData, '.json')
    return buildJsonFileContext({
      fileName: file.originalname,
      fileUrl: normalizedFileUrl,
      originalSummaryLine,
      normalizedJson: normalizedRuntime.normalizedData,
    })
  }

  const rowSamples = parsed.rows.slice(0, SAMPLE_ROW_COUNT).map((row) => sanitizeForSample(row))
  return [
    `文件: ${file.originalname}`,
    `文件获取链接URL: ${rawPreferredFileUrl}`,
    parsed.summary,
    `前 ${SAMPLE_ROW_COUNT} 行数据（已截断长字段）:`,
    JSON.stringify(rowSamples, null, 2),
  ].join('\n')
}

async function parseBuiltinSampleFile(sampleId: BuiltinSampleId, req: Request): Promise<string> {
  const filePath = BUILTIN_SAMPLE_FILES[sampleId]
  await access(filePath, fsConstants.R_OK)
  const parsed = await fileParser.parse(filePath)
  const fileName = basename(filePath)
  const normalizedRuntime = normalizeStructuredRuntime(parsed)
  const originalSummaryLine = parsed.summary.split('\n')[0] || parsed.summary

  if (normalizedRuntime?.runtimeKind === 'geojson') {
    const normalizedFileUrl = await saveNormalizedRuntimeFile(req, normalizedRuntime.normalizedData, '.geojson')
    return buildGeojsonFileContext({
      fileName,
      fileUrl: normalizedFileUrl,
      originalSummaryLine,
      normalizedGeoJSON: normalizedRuntime.normalizedData,
    })
  }

  if (normalizedRuntime?.runtimeKind === 'json') {
    const normalizedFileUrl = await saveNormalizedRuntimeFile(req, normalizedRuntime.normalizedData, '.json')
    return buildJsonFileContext({
      fileName,
      fileUrl: normalizedFileUrl,
      originalSummaryLine,
      normalizedJson: normalizedRuntime.normalizedData,
    })
  }

  const rowSamples = parsed.rows.slice(0, SAMPLE_ROW_COUNT).map((row) => sanitizeForSample(row))
  return [
    `文件: ${fileName}`,
    '文件获取链接URL: N/A',
    parsed.summary,
    `前 ${SAMPLE_ROW_COUNT} 行数据（已截断长字段）:`,
    JSON.stringify(rowSamples, null, 2),
  ].join('\n')
}

async function getBuiltinSampleMeta(sampleId: BuiltinSampleId) {
  const samplePath = BUILTIN_SAMPLE_FILES[sampleId]
  await access(samplePath, fsConstants.R_OK)
  const fileStat = await stat(samplePath)
  return {
    samplePath,
    file: {
      name: basename(samplePath),
      size: fileStat.size,
    },
  }
}

async function resolveRequestFileData(params: {
  req: Request
  file?: Express.Multer.File
  sampleId?: unknown
  fileContext?: unknown
}) {
  const { req, file, sampleId, fileContext } = params

  if (file) {
    const uploadedFileData = await parseUploadedFile(file, req)
    return {
      fileData: uploadedFileData,
      emittedFileContext: uploadedFileData,
    }
  }

  if (sampleId != null) {
    if (!isBuiltinSampleId(sampleId)) {
      throw new Error('无效的样例 ID')
    }
    const sampleFileData = await parseBuiltinSampleFile(sampleId, req)
    return {
      fileData: sampleFileData,
      emittedFileContext: sampleFileData,
    }
  }

  const inlineFileContext = typeof fileContext === 'string' && fileContext.trim()
    ? fileContext
    : undefined

  return {
    fileData: inlineFileContext,
    emittedFileContext: undefined,
  }
}

function detectEntrySource(params: { file?: Express.Multer.File; sampleId?: unknown; fileContext?: unknown }): RunEntrySource {
  if (params.file) return 'upload'
  if (params.sampleId != null) return 'sample'
  if (typeof params.fileContext === 'string' && params.fileContext.trim()) return 'inline'
  return 'none'
}

function resolveContractInfo(fileData?: string): {
  fileKind?: string
  contractVersion?: string
  runtimeContractKind?: string
} {
  if (!fileData) return {}
  const contract = extractRuntimeFileContract(fileData)
  if (!contract) return {}
  return {
    fileKind: contract.kind,
    contractVersion: contract.version,
    runtimeContractKind: contract.kind,
  }
}

function visualInspectUnavailable(reason: string) {
  return {
    status: 'unavailable' as const,
    anomalous: false,
    shouldRepair: false,
    severity: 'low' as const,
    summary: '视觉检查不可用',
    diagnosis: reason || '视觉检查暂时不可用。',
    repairHint: '无',
    confidence: 0,
    model: config.llm.model,
  }
}

function isBlankLikeDiagnosis(text: string): boolean {
  const value = String(text || '').toLowerCase()
  return /空白|未显示|没有显示|无内容|未渲染|blank|empty|not rendered|no data/.test(value)
}

function isLoadingLikeDiagnosis(text: string): boolean {
  const value = String(text || '').toLowerCase()
  return /加载中|正在加载|请稍候|请稍等|loading|initializing|rendering|fetching|waiting/.test(value)
}

function isMissingOuterUiDiagnosis(text: string): boolean {
  const value = String(text || '').toLowerCase()
  return /缺失顶部标题栏|缺失左侧控制面板|未检测到.*标题栏|未检测到.*控制面板|missing.*header|missing.*sidebar|missing.*panel/.test(value)
}

function hasExplicitFailureSignal(text: string): boolean {
  const value = String(text || '').toLowerCase()
  return /错误|报错|异常|崩溃|失败|黑屏|404|500|exception|undefined|not found|failed/.test(value)
}

function normalizeVisualInspectByCaptureMeta(
  inspected: any,
  captureMeta: {
    mode?: string
    canvasCount?: number
    largestCanvasArea?: number
    canvasReadable?: boolean
    canvasTainted?: boolean
    blankLikely?: boolean
    loadingHintDetected?: boolean
    captureAttempts?: number
    captureFailed?: boolean
  } | null,
) {
  if (!captureMeta) return inspected
  if (inspected.status !== 'ok') return inspected

  const combinedText = `${inspected.summary || ''}\n${inspected.diagnosis || ''}\n${inspected.repairHint || ''}`
  const loadingLike = captureMeta.loadingHintDetected === true || isLoadingLikeDiagnosis(combinedText)
  const failureLike = hasExplicitFailureSignal(combinedText)
  if (loadingLike && !failureLike) {
    return visualInspectUnavailable('页面仍处于加载阶段，当前截图不适合触发自动补修。')
  }

  if (captureMeta.mode === 'canvas' && isMissingOuterUiDiagnosis(combinedText)) {
    return visualInspectUnavailable('当前截图只捕获到地图画布，无法可靠判断页面外围标题栏或侧栏是否缺失。')
  }

  const likelyCanvasMap = Number(captureMeta.canvasCount || 0) > 0 && Number(captureMeta.largestCanvasArea || 0) >= 120000
  const tainted = captureMeta.canvasTainted === true && captureMeta.canvasReadable !== true
  const blankLike = captureMeta.blankLikely === true || isBlankLikeDiagnosis(combinedText)
  if (!(likelyCanvasMap && tainted && blankLike)) return inspected

  return visualInspectUnavailable('前端截图受跨域画布限制影响，当前截图无法可靠反映地图渲染内容。')
}

// POST /api/chat/visual-inspect — 地图视觉检查
router.post('/visual-inspect', async (req, res) => {
  const rawCode = readTextField(req.body, 'code', 'codeBase64') || ''
  const rawImageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : ''
  const hint = typeof req.body?.hint === 'string' ? req.body.hint : ''
  const runId = typeof req.body?.runId === 'string' ? req.body.runId : ''
  const dossierRunId = typeof req.body?.dossierRunId === 'string' ? req.body.dossierRunId.trim() : ''
  const captureMeta = typeof req.body?.captureMeta === 'object' && req.body.captureMeta
    ? req.body.captureMeta as {
        mode?: string
        canvasCount?: number
        largestCanvasArea?: number
        canvasReadable?: boolean
        canvasTainted?: boolean
        blankLikely?: boolean
        loadingHintDetected?: boolean
        captureAttempts?: number
        captureFailed?: boolean
      }
    : null

  if (!rawCode.trim() && !rawImageBase64.trim()) {
    res.status(400).json({ success: false, error: '缺少可巡检内容（代码或截图）' })
    return
  }

  const maxCodeChars = Number.isFinite(config.visualInspection.maxCodeChars)
    ? Math.max(10000, config.visualInspection.maxCodeChars)
    : 400000
  const code = injectToken(rawCode.length > maxCodeChars ? rawCode.slice(0, maxCodeChars) : rawCode, req)
  const imageBase64 = rawImageBase64.trim()

  try {
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.appendEvent(dossierRunId, {
        type: 'visual_inspect_requested',
        status: 'running',
        payload: { runId, hint, captureMeta },
      })
    }

    let finalImageBase64 = imageBase64
    if (!finalImageBase64) {
      const rendered = await visualRenderService.render({ code, runId })
      if (!rendered.ok || !rendered.imageBase64) {
        if (config.runDossiers.enabled && dossierRunId) {
          const unavailable = visualInspectUnavailable(rendered.reason || '地图截图失败。')
          await runDossierStore.appendEvent(dossierRunId, {
            type: 'visual_inspect_result',
            status: 'done',
            payload: unavailable,
          })
          await runDossierStore.attachJsonArtifact(dossierRunId, 'visual-result', unavailable)
        }
        res.json({
          success: true,
          data: visualInspectUnavailable(rendered.reason || '地图截图失败。'),
        })
        return
      }
      finalImageBase64 = rendered.imageBase64
    }

    const inspected = await visualInspectionService.inspect({
      imageBase64: finalImageBase64,
      hint,
      runId,
    })
    const normalized = normalizeVisualInspectByCaptureMeta(inspected, captureMeta)
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.appendEvent(dossierRunId, {
        type: 'visual_inspect_result',
        status: normalized.anomalous ? 'error' : 'done',
        payload: normalized,
      })
      await runDossierStore.attachJsonArtifact(dossierRunId, 'visual-result', normalized, { runId, hint })
      if (finalImageBase64 && (normalized.status !== 'ok' || normalized.anomalous)) {
        await runDossierStore.attachPngBase64Artifact(dossierRunId, 'visual-screenshot', finalImageBase64, {
          runId,
          captureMeta,
        })
      }
      if (normalized.status === 'ok' && normalized.anomalous) {
        await runDossierStore.appendError(dossierRunId, {
          source: 'visual',
          kind: normalized.severity,
          message: `[视觉检查异常] ${normalized.summary}\n${normalized.diagnosis}`,
          markFailed: true,
          outcome: 'visual_error',
          details: {
            runId,
            captureMeta,
            repairHint: normalized.repairHint,
            confidence: normalized.confidence,
          },
        })
      }
    }
    res.json({
      success: true,
      data: normalized,
    })
  } catch (err: any) {
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.appendError(dossierRunId, {
        source: 'server',
        kind: 'visual-inspect',
        message: err?.message || '视觉检查失败',
        markFailed: false,
        details: { runId, hint },
      })
    }
    res.json({
      success: true,
      data: visualInspectUnavailable(err?.message || '视觉检查失败。'),
    })
  }
})

// POST /api/chat/sample-context — 返回首页样例文件元信息
router.post('/sample-context', async (req, res) => {
  const sampleId = req.body?.sampleId as BuiltinSampleId | undefined
  if (!sampleId || !(sampleId in BUILTIN_SAMPLE_FILES)) {
    res.status(400).json({ success: false, error: '无效的样例 ID' })
    return
  }

  try {
    const { file } = await getBuiltinSampleMeta(sampleId)
    res.json({
      success: true,
      data: {
        sampleId,
        file,
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || '样例数据加载失败' })
  }
})

// POST /api/chat/stream — 流式聊天接口 (SSE)
router.post('/stream', upload.single('file'), async (req, res) => {
  const { message, fileContext, sampleId } = req.body
  const existingCode = readTextField(req.body, 'existingCode', 'existingCodePayload')
    || readTextField(req.body, 'existingCode', 'existingCodeBase64')
  const conversationHistory = readTextField(req.body, 'conversationHistory', 'conversationHistoryPayload')
    || readTextField(req.body, 'conversationHistory', 'conversationHistoryBase64')

  if (!message) {
    res.status(400).json({ success: false, error: '请输入消息' })
    return
  }
  if (sampleId != null && !isBuiltinSampleId(sampleId)) {
    res.status(400).json({ success: false, error: '无效的样例 ID' })
    return
  }

  const requestContext = getRequestContext(req)
  const entrySource = detectEntrySource({
    file: req.file || undefined,
    sampleId,
    fileContext,
  })
  let dossierRunId = ''
  if (config.runDossiers.enabled) {
    const created = await runDossierStore.createRun({
      phase: 'generate',
      entrySource,
      sampleId: isBuiltinSampleId(sampleId) ? sampleId : undefined,
      userPrompt: message,
      conversationHistory: typeof conversationHistory === 'string' ? conversationHistory : undefined,
      existingCodeChars: typeof existingCode === 'string' ? existingCode.length : undefined,
      modelName: config.llm.model,
      agentMode: String(config.agentRuntime.mode || ''),
      verifierEnabled: config.agentRuntime.enableVerifier,
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
    })
    dossierRunId = created.summary.id
    await runDossierStore.attachJsonArtifact(dossierRunId, 'request-snapshot', {
      message,
      sampleId: isBuiltinSampleId(sampleId) ? sampleId : undefined,
      entrySource,
      conversationHistory: typeof conversationHistory === 'string' ? conversationHistory : '',
      existingCodeChars: typeof existingCode === 'string' ? existingCode.length : 0,
      modelName: config.llm.model,
      requestContext,
      uploadedFile: req.file
        ? { originalname: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype }
        : null,
    })
  }

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 关闭 nginx/proxy 缓冲
  res.flushHeaders()

  // 检测客户端断开（监听 response 的 close，而非 request 的 close）
  let clientDisconnected = false
  res.on('close', () => { clientDisconnected = true })

  try {
    if (dossierRunId && !clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'run_context', runId: dossierRunId, phase: 'generate' })}\n\n`)
    }
    const resolvedFile = await resolveRequestFileData({
      req,
      file: req.file || undefined,
      sampleId,
      fileContext,
    })
    const fileData = resolvedFile.fileData

    if (config.runDossiers.enabled && dossierRunId) {
      let resolvedFileName = req.file?.originalname
      let resolvedFileSize = req.file?.size
      if (!resolvedFileName && isBuiltinSampleId(sampleId)) {
        const meta = await getBuiltinSampleMeta(sampleId)
        resolvedFileName = meta.file.name
        resolvedFileSize = meta.file.size
      }
      const contractInfo = resolveContractInfo(fileData)
      await runDossierStore.updateRun(dossierRunId, {
        fileName: resolvedFileName,
        fileSize: resolvedFileSize,
        fileKind: contractInfo.fileKind,
        requestPatch: {
          fileName: resolvedFileName,
          fileSize: resolvedFileSize,
          fileKind: contractInfo.fileKind,
          fileContractVersion: contractInfo.contractVersion,
          runtimeContractKind: contractInfo.runtimeContractKind,
        },
      })
      if (resolvedFile.emittedFileContext) {
        await runDossierStore.attachTextArtifact(dossierRunId, 'file-context', resolvedFile.emittedFileContext)
      }
    }

    if (!clientDisconnected && resolvedFile.emittedFileContext) {
      res.write(`data: ${JSON.stringify({ type: 'file_context', content: resolvedFile.emittedFileContext })}\n\n`)
    }

    const stream = agent.invokeStream({
      userInput: message,
      fileData,
      conversationHistory,
      existingCode,
    })

    let receivedFinalCode = false
    for await (const chunk of stream) {
      if (clientDisconnected) break

      const decoratedChunk = chunk.type === 'tool_execution_start' || chunk.type === 'tool_execution_end'
        ? enrichToolExecutionChunk(chunk as Record<string, unknown>)
        : chunk

      if (config.runDossiers.enabled && dossierRunId) {
        if (decoratedChunk.type === 'tool_execution_start') {
          await runDossierStore.appendEvent(dossierRunId, {
            type: 'tool_execution_start',
            toolCallId: String((decoratedChunk as any).toolCallId || ''),
            toolName: String((decoratedChunk as any).toolName || ''),
            status: 'running',
            payload: {
              args: (decoratedChunk as any).args,
              startedAtMs: (decoratedChunk as any).startedAtMs,
              ui: {
                uiLabel: (decoratedChunk as any).uiLabel,
                uiSummary: (decoratedChunk as any).uiSummary,
                uiGroup: (decoratedChunk as any).uiGroup,
                uiGroupLabel: (decoratedChunk as any).uiGroupLabel,
                uiVisibility: (decoratedChunk as any).uiVisibility,
              },
            },
          })
        } else if (decoratedChunk.type === 'tool_execution_end') {
          await runDossierStore.appendEvent(dossierRunId, {
            type: 'tool_execution_end',
            toolCallId: String((decoratedChunk as any).toolCallId || ''),
            toolName: String((decoratedChunk as any).toolName || ''),
            status: (decoratedChunk as any).isError ? 'error' : 'done',
            payload: {
              result: (decoratedChunk as any).result,
              isError: (decoratedChunk as any).isError,
              endedAtMs: (decoratedChunk as any).endedAtMs,
              decisionSource: (decoratedChunk as any).decisionSource,
              selectedPackages: (decoratedChunk as any).selectedPackages,
              selectedReferences: (decoratedChunk as any).selectedReferences,
              selectedContracts: (decoratedChunk as any).selectedContracts,
              fallbackReason: (decoratedChunk as any).fallbackReason,
              vetoApplied: (decoratedChunk as any).vetoApplied,
              ui: {
                uiLabel: (decoratedChunk as any).uiLabel,
                uiSummary: (decoratedChunk as any).uiSummary,
                uiGroup: (decoratedChunk as any).uiGroup,
                uiGroupLabel: (decoratedChunk as any).uiGroupLabel,
                uiVisibility: (decoratedChunk as any).uiVisibility,
              },
            },
          })
        } else if (decoratedChunk.type === 'code' && decoratedChunk.content) {
          receivedFinalCode = true
          await runDossierStore.attachHtmlArtifact(dossierRunId, 'generated-code', String(decoratedChunk.content || ''), {
            codeChars: String(decoratedChunk.content || '').length,
          })
        } else if (decoratedChunk.type === 'code_diff' && decoratedChunk.data) {
          const payload = decoratedChunk.data as Record<string, unknown>
          await runDossierStore.attachJsonArtifact(dossierRunId, 'generated-diff-meta', {
            fallbackMode: payload.fallbackMode,
            summary: payload.summary,
            blockReports: payload.blockReports,
            patchBlocks: payload.patchBlocks,
            patchText: payload.patchText,
          })
          if (typeof payload.unifiedDiff === 'string' && payload.unifiedDiff.trim()) {
            await runDossierStore.attachTextArtifact(dossierRunId, 'generated-diff', payload.unifiedDiff, {
              fallbackMode: payload.fallbackMode,
              summary: payload.summary,
            })
          }
        } else if (decoratedChunk.type === 'error' && decoratedChunk.content) {
          await runDossierStore.appendError(dossierRunId, {
            source: 'server',
            kind: 'stream',
            message: String(decoratedChunk.content || ''),
            markFailed: true,
            outcome: 'request_error',
          })
        }
      }

      let data = decoratedChunk
      // 对 code 类型注入 token
      if (decoratedChunk.type === 'code' && decoratedChunk.content) {
        data = { ...decoratedChunk, content: injectToken(String(decoratedChunk.content || ''), req) }
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    if (!clientDisconnected) {
      res.write('data: [DONE]\n\n')
    }
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.updateRun(dossierRunId, {
        status: clientDisconnected && !receivedFinalCode ? 'failed' : 'succeeded',
        outcome: clientDisconnected && !receivedFinalCode
          ? 'client_disconnected'
          : (receivedFinalCode ? 'generated' : 'request_error'),
        finishedAt: Date.now(),
      })
    }
    res.end()
  } catch (err: any) {
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.appendError(dossierRunId, {
        source: 'server',
        kind: 'stream',
        message: err?.message || '聊天流执行失败',
        markFailed: true,
        outcome: 'request_error',
        details: { stack: typeof err?.stack === 'string' ? err.stack.slice(0, 4000) : undefined },
      })
    }
    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`)
      res.write('data: [DONE]\n\n')
    }
    res.end()
  }
})

// POST /api/chat — 非流式聊天接口（保留兼容）
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const { message, fileContext, sampleId } = req.body
    const existingCode = readTextField(req.body, 'existingCode', 'existingCodePayload')
      || readTextField(req.body, 'existingCode', 'existingCodeBase64')
    const conversationHistory = readTextField(req.body, 'conversationHistory', 'conversationHistoryPayload')
      || readTextField(req.body, 'conversationHistory', 'conversationHistoryBase64')

    if (!message) {
      return res.status(400).json({ success: false, error: '请输入消息' })
    }
    if (sampleId != null && !isBuiltinSampleId(sampleId)) {
      return res.status(400).json({ success: false, error: '无效的样例 ID' })
    }
    const resolvedFile = await resolveRequestFileData({
      req,
      file: req.file || undefined,
      sampleId,
      fileContext,
    })
    const fileData = resolvedFile.fileData

    const result = await agent.invoke({
      userInput: message,
      fileData,
      conversationHistory,
      existingCode,
    })

    // 替换 token
    let code = result.code
    if (code) {
      code = injectToken(code, req)
    }

    res.json({
      success: true,
      data: {
        code,
        response: result.response,
        error: result.error,
        fileContext: resolvedFile.emittedFileContext || undefined,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/fix — 代码修复
router.post('/fix', async (req, res, next) => {
  try {
    const { userInput, fileContext } = req.body
    const code = readTextField(req.body, 'code', 'codePayload')
      || readTextField(req.body, 'code', 'codeBase64')
    const error = readTextField(req.body, 'error', 'errorPayload')
      || readTextField(req.body, 'error', 'errorBase64')

    if (!code || !error) {
      return res.status(400).json({ success: false, error: '缺少代码或错误信息' })
    }
    const result = await agent.fixCode({
      code,
      error,
      userInput: userInput || '',
      fileData: typeof fileContext === 'string' && fileContext.trim() ? fileContext : undefined,
    })

    let fixedCode = result.code
    if (fixedCode) {
      fixedCode = injectToken(fixedCode, req)
    }

    res.json({
      success: true,
      data: {
        code: fixedCode,
        explanation: result.explanation,
        fixed: result.fixed,
        diff: result.diff,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/chat/fix/stream — 流式代码修复（用于前端展示修复过程）
router.post('/fix/stream', async (req, res) => {
  const { userInput, fileContext, parentRunId, source } = req.body
  const code = readTextField(req.body, 'code', 'codePayload')
    || readTextField(req.body, 'code', 'codeBase64')
  const error = readTextField(req.body, 'error', 'errorPayload')
    || readTextField(req.body, 'error', 'errorBase64')

  if (!code || !error) {
    res.status(400).json({ success: false, error: '缺少代码或错误信息' })
    return
  }

  const requestContext = getRequestContext(req)
  let dossierRunId = ''
  const phase: RunPhase = source === 'visual' ? 'fix_visual' : 'fix_runtime'
  if (config.runDossiers.enabled) {
    const contractInfo = resolveContractInfo(typeof fileContext === 'string' ? fileContext : undefined)
    const created = await runDossierStore.createRun({
      parentRunId: typeof parentRunId === 'string' && parentRunId.trim() ? parentRunId.trim() : undefined,
      phase,
      entrySource: typeof fileContext === 'string' && fileContext.trim() ? 'inline' : 'none',
      userPrompt: typeof userInput === 'string' && userInput.trim() ? userInput : '[auto-fix]',
      existingCodeChars: typeof code === 'string' ? code.length : undefined,
      modelName: config.llm.model,
      agentMode: String(config.agentRuntime.mode || ''),
      verifierEnabled: config.agentRuntime.enableVerifier,
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      fileKind: contractInfo.fileKind,
    })
    dossierRunId = created.summary.id
    await runDossierStore.attachJsonArtifact(dossierRunId, 'fix-request', {
      parentRunId: typeof parentRunId === 'string' ? parentRunId : '',
      source: source === 'visual' ? 'visual' : 'runtime',
      error,
      userInput: userInput || '',
      modelName: config.llm.model,
      requestContext,
    })
    await runDossierStore.attachHtmlArtifact(dossierRunId, 'input-code', String(code || ''))
    if (typeof fileContext === 'string' && fileContext.trim()) {
      await runDossierStore.attachTextArtifact(dossierRunId, 'file-context', fileContext)
    }
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let clientDisconnected = false
  res.on('close', () => { clientDisconnected = true })

  try {
    if (dossierRunId && !clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'run_context', runId: dossierRunId, phase, parentRunId: parentRunId || undefined })}\n\n`)
    }
    const stream = agent.fixCodeStream({
      code,
      error,
      userInput: userInput || '',
      fileData: typeof fileContext === 'string' && fileContext.trim() ? fileContext : undefined,
    })

    let receivedFinalCode = false
    for await (const chunk of stream) {
      if (clientDisconnected) break

      const decoratedChunk = chunk.type === 'tool_execution_start' || chunk.type === 'tool_execution_end'
        ? enrichToolExecutionChunk(chunk as Record<string, unknown>)
        : chunk

      if (config.runDossiers.enabled && dossierRunId) {
        if (decoratedChunk.type === 'tool_execution_start') {
          await runDossierStore.appendEvent(dossierRunId, {
            type: 'tool_execution_start',
            toolCallId: String((decoratedChunk as any).toolCallId || ''),
            toolName: String((decoratedChunk as any).toolName || ''),
            status: 'running',
            payload: {
              args: (decoratedChunk as any).args,
              startedAtMs: (decoratedChunk as any).startedAtMs,
              ui: {
                uiLabel: (decoratedChunk as any).uiLabel,
                uiSummary: (decoratedChunk as any).uiSummary,
                uiGroup: (decoratedChunk as any).uiGroup,
                uiGroupLabel: (decoratedChunk as any).uiGroupLabel,
                uiVisibility: (decoratedChunk as any).uiVisibility,
              },
            },
          })
        } else if (decoratedChunk.type === 'tool_execution_end') {
          await runDossierStore.appendEvent(dossierRunId, {
            type: 'tool_execution_end',
            toolCallId: String((decoratedChunk as any).toolCallId || ''),
            toolName: String((decoratedChunk as any).toolName || ''),
            status: (decoratedChunk as any).isError ? 'error' : 'done',
            payload: {
              result: (decoratedChunk as any).result,
              isError: (decoratedChunk as any).isError,
              endedAtMs: (decoratedChunk as any).endedAtMs,
              decisionSource: (decoratedChunk as any).decisionSource,
              selectedPackages: (decoratedChunk as any).selectedPackages,
              selectedReferences: (decoratedChunk as any).selectedReferences,
              selectedContracts: (decoratedChunk as any).selectedContracts,
              fallbackReason: (decoratedChunk as any).fallbackReason,
              vetoApplied: (decoratedChunk as any).vetoApplied,
              ui: {
                uiLabel: (decoratedChunk as any).uiLabel,
                uiSummary: (decoratedChunk as any).uiSummary,
                uiGroup: (decoratedChunk as any).uiGroup,
                uiGroupLabel: (decoratedChunk as any).uiGroupLabel,
                uiVisibility: (decoratedChunk as any).uiVisibility,
              },
            },
          })
        } else if (decoratedChunk.type === 'code' && decoratedChunk.content) {
          receivedFinalCode = true
          await runDossierStore.attachHtmlArtifact(dossierRunId, 'fixed-code', String(decoratedChunk.content || ''), {
            codeChars: String(decoratedChunk.content || '').length,
            source: source === 'visual' ? 'visual' : 'runtime',
          })
        } else if (decoratedChunk.type === 'code_diff' && decoratedChunk.data) {
          const payload = decoratedChunk.data as Record<string, unknown>
          await runDossierStore.attachJsonArtifact(dossierRunId, 'fix-patch', {
            fallbackMode: payload.fallbackMode,
            summary: payload.summary,
            blockReports: payload.blockReports,
            patchBlocks: payload.patchBlocks,
            patchText: payload.patchText,
          })
          if (typeof payload.unifiedDiff === 'string' && payload.unifiedDiff.trim()) {
            await runDossierStore.attachTextArtifact(dossierRunId, 'fix-diff', payload.unifiedDiff, {
              fallbackMode: payload.fallbackMode,
              summary: payload.summary,
            })
          }
        } else if (decoratedChunk.type === 'error' && decoratedChunk.content) {
          await runDossierStore.appendError(dossierRunId, {
            source: 'server',
            kind: 'fix-stream',
            message: String(decoratedChunk.content || ''),
            markFailed: true,
            outcome: 'request_error',
          })
        }
      }

      let data = decoratedChunk
      if (decoratedChunk.type === 'code' && decoratedChunk.content) {
        data = { ...decoratedChunk, content: injectToken(String(decoratedChunk.content || ''), req) }
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    if (!clientDisconnected) {
      res.write('data: [DONE]\n\n')
    }
    if (config.runDossiers.enabled && dossierRunId) {
      const outcome: RunOutcome = receivedFinalCode ? 'fixed' : (clientDisconnected ? 'client_disconnected' : 'request_error')
      await runDossierStore.updateRun(dossierRunId, {
        status: clientDisconnected && !receivedFinalCode ? 'failed' : 'succeeded',
        outcome,
        finishedAt: Date.now(),
      })
    }
    res.end()
  } catch (err: any) {
    if (config.runDossiers.enabled && dossierRunId) {
      await runDossierStore.appendError(dossierRunId, {
        source: 'server',
        kind: 'fix-stream',
        message: err?.message || '代码修复流失败',
        markFailed: true,
        outcome: 'request_error',
        details: { stack: typeof err?.stack === 'string' ? err.stack.slice(0, 4000) : undefined },
      })
    }
    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`)
      res.write('data: [DONE]\n\n')
    }
    res.end()
  }
})

export default router
