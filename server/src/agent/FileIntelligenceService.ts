import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { config } from '../config.js'
import {
  extractRuntimeFileContract,
  formatRuntimeGeojsonContract,
  formatRuntimeJsonContract,
  type RuntimeFileContract,
  type RuntimeJsonContract,
  type RuntimeGeojsonContract,
} from './FileContextContract.js'
import { parseJsonBufferWithFallback } from '../services/FileParser.js'

const MAX_SAMPLE_FEATURES = 3
const MAX_FIELD_COUNT = 12
const MAX_TOP_VALUES = 5
const MAX_SAMPLE_VALUES = 3
const MAX_SAMPLE_ARRAY_ITEMS = 6
const MAX_SAMPLE_OBJECT_KEYS = 12
const FETCH_TIMEOUT_MS = 12000

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface FileIntelligenceResult {
  fileData: string
  summary: {
    status: 'ok' | 'skipped' | 'error'
    fileUrl?: string
    featureCount?: number
    geometryTypes?: Record<string, number>
    fieldCount?: number
    suggestedVisualizations?: string[]
    reason?: string
  }
}

export class FileIntelligenceService {
  async enrich(fileData?: string): Promise<FileIntelligenceResult> {
    if (!fileData || !fileData.trim()) {
      return {
        fileData: fileData || '',
        summary: { status: 'skipped', reason: 'no_file_data' },
      }
    }

    const baseFileData = stripExistingIntelligenceSection(fileData)
    const runtimeContract = extractRuntimeFileContract(baseFileData)
    if (!runtimeContract) {
      return {
        fileData: baseFileData,
        summary: { status: 'skipped', reason: 'no_runtime_contract' },
      }
    }

    try {
      const payload = await this.loadJson(runtimeContract.fileUrl)
      const insight = runtimeContract.kind === 'geojson'
        ? analyzeGeojsonPath(payload, runtimeContract)
        : analyzeJson(payload, runtimeContract)

      if (insight.status === 'error') {
        const note = buildFailureSection(insight.reason)
        return {
          fileData: `${baseFileData}\n\n${note}`,
          summary: {
            status: 'error',
            fileUrl: runtimeContract.fileUrl,
            reason: insight.reason,
          },
        }
      }

      const enriched = [
        baseFileData.trim(),
        '',
        buildIntelligenceSection({
          runtimeContract,
          rootPayload: payload,
          insight: insight.value,
        }),
      ].join('\n')

      return {
        fileData: enriched,
        summary: {
          status: 'ok',
          fileUrl: runtimeContract.fileUrl,
          ...buildSummaryFields(insight.value),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const note = buildFailureSection(message)
      return {
        fileData: `${baseFileData}\n\n${note}`,
        summary: {
          status: 'error',
          fileUrl: runtimeContract.fileUrl,
          reason: message,
        },
      }
    }
  }

  private async loadJson(fileUrl: string): Promise<any> {
    const localPath = resolveLocalUploadPath(fileUrl)
    if (localPath) {
      const content = await readFile(localPath)
      return parseJsonBufferWithFallback(content, localPath).value
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(fileUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`fetch_failed:${response.status}`)
      }
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }
}

function buildIntelligenceSection(params: {
  runtimeContract: RuntimeFileContract
  rootPayload: any
  insight: GeojsonInsight | JsonInsight
}): string {
  const { insight, runtimeContract } = params
  const verifiedContract = runtimeContract.kind === 'geojson'
    ? formatRuntimeGeojsonContract(runtimeContract)
    : formatRuntimeJsonContract(runtimeContract)

  if (runtimeContract.kind === 'geojson') {
    const geoInsight = insight as GeojsonInsight
    const fieldPreview = geoInsight.propertyProfiles.slice(0, MAX_FIELD_COUNT).map((profile) => ({
      name: profile.name,
      inferredType: profile.inferredType,
      nonEmptyRate: `${Math.round(profile.nonEmptyRate * 100)}%`,
      sampleValues: profile.sampleValues,
      ...(profile.numericRange ? { numericRange: profile.numericRange } : {}),
      ...(profile.topValues.length ? { topValues: profile.topValues } : {}),
    }))

    return [
      '## 自动数据理解结果（系统已读取真实文件，高优先级）',
      `- 数据读取状态: 成功`,
      `- 实际读取 URL: ${runtimeContract.fileUrl}`,
      `- 运行时路径验证: ${runtimeContract.geojsonPath} -> FeatureCollection（已验证）`,
      `- 根结构: ${describeRootShape(params.rootPayload)}`,
      `- 要素数量: ${geoInsight.featureCount}`,
      `- 几何类型统计: ${formatStats(geoInsight.geometryTypeStats)}`,
      geoInsight.bboxText ? `- 数据范围: ${geoInsight.bboxText}` : '',
      `- 字段数量: ${geoInsight.propertyProfiles.length}`,
      `- 推荐可视化: ${geoInsight.visualizationSuggestions.join('；')}`,
      `- 推荐分组/分色字段: ${geoInsight.recommendedCategoryFields.join('、') || '暂无明显分类字段'}`,
      `- 推荐权重/强度字段: ${geoInsight.recommendedNumericFields.join('、') || '暂无明显数值字段'}`,
      `- 安全坐标提取: ${geoInsight.coordinateGuide}`,
      geoInsight.codeHint ? `- 代码提示: ${geoInsight.codeHint}` : '',
      '### 字段画像（节选）',
      '```json',
      JSON.stringify(fieldPreview, null, 2),
      '```',
      `### GeoJSON 样例（前 ${MAX_SAMPLE_FEATURES} 个要素，已裁剪）`,
      '```json',
      JSON.stringify(geoInsight.featureSamples, null, 2),
      '```',
      '### 系统判断',
      '- 可以安全遍历 FeatureCollection.features 做列表、热力图权重计算、字段统计',
      '- 但 map.addSource({ type: "geojson", data }) 必须接收完整 FeatureCollection/Feature，不能传 features 数组',
      '- 优先信任本节与上方“运行时文件契约”；不要再根据原始来源附注猜测包装层',
      '### 运行时契约回显',
      verifiedContract,
    ].filter(Boolean).join('\n')
  }

  const jsonInsight = insight as JsonInsight
  return [
    '## 自动数据理解结果（系统已读取真实文件，高优先级）',
    '- 数据读取状态: 成功',
    `- 实际读取 URL: ${runtimeContract.fileUrl}`,
    `- 运行时根结构验证: ${runtimeContract.responseShape}（已验证）`,
    `- 根结构: ${describeRootShape(params.rootPayload)}`,
    runtimeContract.responseShape === 'object'
      ? `- 顶层 key: ${runtimeContract.rootKeys?.join('、') || '无'}`
      : `- 根数组长度: ${runtimeContract.arrayLength ?? 0}`,
    `- 推荐可视化: ${jsonInsight.visualizationSuggestions.join('；')}`,
    `- 坐标识别: ${jsonInsight.coordinateGuide}`,
    `- 访问示例: ${runtimeContract.canonicalAccess.join('；') || '无'}`,
    jsonInsight.codeHint ? `- 代码提示: ${jsonInsight.codeHint}` : '',
    '### 顶层结构画像',
    '```json',
    JSON.stringify(jsonInsight.structureSummary, null, 2),
    '```',
    '### 字段画像（节选）',
    '```json',
    JSON.stringify(jsonInsight.fieldGroups.slice(0, MAX_FIELD_COUNT), null, 2),
    '```',
    `### JSON 样例（已裁剪）`,
    '```json',
    JSON.stringify(jsonInsight.sample, null, 2),
    '```',
    '### 系统判断',
    '- 必须按运行时契约中的 canonicalAccess 访问顶层数据，不要猜测 rawData[0] 或别名 key',
    '- 可以安全遍历契约指向的真实数组做列表、路线、点位和统计',
    '- 优先信任本节与上方“运行时文件契约”；不要再根据原始来源附注猜测根结构',
    '### 运行时契约回显',
    verifiedContract,
  ].filter(Boolean).join('\n')
}

function buildSummaryFields(insight: GeojsonInsight | JsonInsight) {
  if ('featureCount' in insight) {
    return {
      featureCount: insight.featureCount,
      geometryTypes: insight.geometryTypeStats,
      fieldCount: insight.propertyProfiles.length,
      suggestedVisualizations: insight.visualizationSuggestions,
    }
  }

  return {
    fieldCount: insight.fieldCount,
    suggestedVisualizations: insight.visualizationSuggestions,
  }
}

function buildFailureSection(message: string): string {
  return [
    '## 自动数据理解结果（系统读取失败）',
    `- 状态: 失败`,
    `- 原因: ${message}`,
    '- 请继续以已有运行时文件契约为准，不要自行猜测包装层路径。',
  ].join('\n')
}

function stripExistingIntelligenceSection(fileData: string): string {
  return fileData
    .replace(/\n## 自动数据理解结果（系统已读取真实文件，高优先级）[\s\S]*$/m, '')
    .replace(/\n## 自动数据理解结果（系统读取失败）[\s\S]*$/m, '')
    .trim()
}

function resolveLocalUploadPath(fileUrl: string): string | null {
  const value = String(fileUrl || '').trim()
  if (!value) return null

  let pathname = value
  try {
    if (/^https?:\/\//i.test(value)) {
      pathname = new URL(value).pathname
    }
  } catch {
    pathname = value
  }

  const rawBase = config.publicSamples.basePath || process.env.VITE_BASE_PATH || ''
  const basePath = rawBase && rawBase !== '/'
    ? `/${rawBase.replace(/^\/+|\/+$/g, '')}`
    : ''
  if (basePath && pathname.startsWith(`${basePath}/uploads/`)) {
    pathname = pathname.slice(basePath.length)
  }

  if (!pathname.startsWith('/uploads/')) return null
  const relativePath = decodeURIComponent(pathname.slice('/uploads/'.length))
  if (!relativePath || relativePath.includes('..')) return null
  return resolve(config.upload.dir, relativePath)
}

function extractByPath(root: any, path: string): any {
  if (!path || path === 'rawData') return root
  return path
    .split('.')
    .slice(1)
    .reduce((acc: any, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), root)
}

function normalizeGeojson(value: any): any | null {
  if (!value || typeof value !== 'object') return null
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) return value
  if (value.type === 'Feature') {
    return { type: 'FeatureCollection', features: [value] }
  }
  return null
}

type PropertyProfile = ReturnType<typeof buildPropertyProfiles>[number]

interface GeojsonInsight {
  featureCount: number
  geometryTypeStats: Record<string, number>
  bboxText: string
  propertyProfiles: PropertyProfile[]
  recommendedCategoryFields: string[]
  recommendedNumericFields: string[]
  visualizationSuggestions: string[]
  coordinateGuide: string
  codeHint: string
  featureSamples: any[]
}

interface JsonInsight {
  structureSummary: any
  fieldGroups: any[]
  visualizationSuggestions: string[]
  coordinateGuide: string
  codeHint: string
  sample: any
  fieldCount: number
}

function analyzeGeojsonPath(rootPayload: any, runtimeContract: RuntimeGeojsonContract): { status: 'ok'; value: GeojsonInsight } | { status: 'error'; reason: string } {
  const extracted = extractByPath(rootPayload, runtimeContract.geojsonPath)
  const normalized = normalizeGeojson(extracted)
  if (!normalized) {
    return {
      status: 'error',
      reason: `运行时契约声明的路径 ${runtimeContract.geojsonPath} 未解析出合法 GeoJSON。`,
    }
  }
  return { status: 'ok', value: analyzeGeojson(normalized, runtimeContract) }
}

function analyzeGeojson(geojson: any, runtimeContract: RuntimeGeojsonContract): GeojsonInsight {
  const features = Array.isArray(geojson.features) ? geojson.features : []
  const geometryTypeStats = collectGeometryStats(features)
  const bbox = computeBBox(features)
  const propertyProfiles = buildPropertyProfiles(features)
  const coordinateGuide = buildCoordinateGuide(geometryTypeStats)

  return {
    featureCount: features.length,
    geometryTypeStats,
    bboxText: bbox ? formatBbox(bbox) : '',
    propertyProfiles,
    recommendedCategoryFields: propertyProfiles
      .filter((item) => item.inferredType === 'category' && item.nonEmptyRate >= 0.3)
      .slice(0, 3)
      .map((item) => item.name),
    recommendedNumericFields: propertyProfiles
      .filter((item) => item.inferredType === 'number' && item.nonEmptyRate >= 0.2)
      .slice(0, 3)
      .map((item) => item.name),
    visualizationSuggestions: suggestVisualizations({
      geometryTypeStats,
      propertyProfiles,
    }),
    coordinateGuide,
    codeHint: buildCodeHint(runtimeContract, geometryTypeStats),
    featureSamples: features.slice(0, MAX_SAMPLE_FEATURES).map(sanitizeFeatureSample),
  }
}

function analyzeJson(rootPayload: any, runtimeContract: RuntimeJsonContract): { status: 'ok'; value: JsonInsight } | { status: 'error'; reason: string } {
  const responseShape = Array.isArray(rootPayload) ? 'array' : (rootPayload && typeof rootPayload === 'object' ? 'object' : 'unknown')
  if (responseShape !== runtimeContract.responseShape) {
    return {
      status: 'error',
      reason: `运行时契约声明的根结构是 ${runtimeContract.responseShape}，但实际读取到的是 ${responseShape}。`,
    }
  }

  const groups = collectJsonGroups(rootPayload, runtimeContract)
  const coordinateGuide = groups.map((group) => group.coordinateGuide).filter(Boolean)[0] || '未识别到明确坐标字段'

  return {
    status: 'ok',
    value: {
      structureSummary: buildJsonStructureSummary(rootPayload, groups),
      fieldGroups: groups.map((group) => ({
        group: group.name,
        count: group.count,
        coordinateField: group.coordinateField || null,
        sampleKeys: group.sampleKeys,
        fieldProfiles: group.fieldProfiles.slice(0, 6).map((profile) => ({
          name: profile.name,
          inferredType: profile.inferredType,
          nonEmptyRate: `${Math.round(profile.nonEmptyRate * 100)}%`,
          sampleValues: profile.sampleValues,
          ...(profile.numericRange ? { numericRange: profile.numericRange } : {}),
          ...(profile.topValues.length ? { topValues: profile.topValues } : {}),
        })),
      })),
      visualizationSuggestions: suggestJsonVisualizations(runtimeContract, groups),
      coordinateGuide,
      codeHint: buildJsonCodeHint(runtimeContract, groups),
      sample: sanitizeJsonSample(rootPayload),
      fieldCount: groups.reduce((sum, group) => sum + group.fieldProfiles.length, 0),
    },
  }
}

function collectGeometryStats(features: any[]): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const feature of features) {
    const geometryType = feature?.geometry?.type || 'Unknown'
    stats[geometryType] = (stats[geometryType] || 0) + 1
  }
  return stats
}

function computeBBox(features: any[]): [number, number, number, number] | null {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (node: any) => {
    if (!Array.isArray(node)) return
    if (node.length >= 2 && isFiniteNumber(node[0]) && isFiniteNumber(node[1])) {
      minLng = Math.min(minLng, node[0])
      minLat = Math.min(minLat, node[1])
      maxLng = Math.max(maxLng, node[0])
      maxLat = Math.max(maxLat, node[1])
      return
    }
    for (const child of node) visit(child)
  }

  for (const feature of features) {
    visit(feature?.geometry?.coordinates)
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null
  return [minLng, minLat, maxLng, maxLat]
}

function computeBBoxFromRows(rows: Record<string, any>[], coordinateField?: string | null): [number, number, number, number] | null {
  if (!coordinateField) return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  for (const row of rows) {
    const point = row?.[coordinateField]
    if (!Array.isArray(point) || point.length < 2) continue
    const lng = Number(point[0])
    const lat = Number(point[1])
    if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) continue
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null
  return [minLng, minLat, maxLng, maxLat]
}

function buildPropertyProfiles(features: any[]) {
  const map = new Map<string, {
    total: number
    nonEmpty: number
    numberCount: number
    booleanCount: number
    stringCount: number
    uniqueValues: Set<string>
    topCounts: Map<string, number>
    min?: number
    max?: number
    sampleValues: string[]
  }>()

  for (const feature of features) {
    const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {}
    for (const [key, raw] of Object.entries(props)) {
      if (!map.has(key)) {
        map.set(key, {
          total: 0,
          nonEmpty: 0,
          numberCount: 0,
          booleanCount: 0,
          stringCount: 0,
          uniqueValues: new Set<string>(),
          topCounts: new Map<string, number>(),
          sampleValues: [],
        })
      }
      const profile = map.get(key)!
      profile.total += 1
      if (!isEmptyValue(raw)) {
        profile.nonEmpty += 1
        const sample = sampleText(raw)
        if (sample && !profile.sampleValues.includes(sample) && profile.sampleValues.length < MAX_SAMPLE_VALUES) {
          profile.sampleValues.push(sample)
        }

        if (typeof raw === 'number' && Number.isFinite(raw)) {
          profile.numberCount += 1
          profile.min = profile.min == null ? raw : Math.min(profile.min, raw)
          profile.max = profile.max == null ? raw : Math.max(profile.max, raw)
        } else if (typeof raw === 'boolean') {
          profile.booleanCount += 1
        } else {
          profile.stringCount += 1
          const normalized = sample
          if (normalized) {
            profile.uniqueValues.add(normalized)
            profile.topCounts.set(normalized, (profile.topCounts.get(normalized) || 0) + 1)
          }
        }
      }
    }
  }

  return Array.from(map.entries())
    .map(([name, profile]) => {
      const inferredType = inferFieldType(profile)
      const topValues = Array.from(profile.topCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TOP_VALUES)
        .map(([value, count]) => ({ value, count }))
      return {
        name,
        inferredType,
        nonEmptyRate: profile.total > 0 ? profile.nonEmpty / profile.total : 0,
        sampleValues: profile.sampleValues,
        topValues,
        numericRange: profile.numberCount > 0 && profile.min != null && profile.max != null
          ? { min: profile.min, max: profile.max }
          : undefined,
      }
    })
    .sort((a, b) => {
      if (b.nonEmptyRate !== a.nonEmptyRate) return b.nonEmptyRate - a.nonEmptyRate
      return a.name.localeCompare(b.name)
    })
}

function buildRowPropertyProfiles(rows: Record<string, any>[]) {
  return buildPropertyProfiles(rows.map((row) => ({ properties: row })))
}

function collectJsonGroups(rootPayload: any, runtimeContract: RuntimeJsonContract) {
  if (runtimeContract.responseShape === 'array') {
    const rows = Array.isArray(rootPayload)
      ? rootPayload.filter((item): item is Record<string, any> => !!item && typeof item === 'object' && !Array.isArray(item))
      : []
    const coordinateField = rows.length > 0 ? detectCoordinateField(rows[0]) : null
    return [{
      name: '$root',
      count: Array.isArray(rootPayload) ? rootPayload.length : 0,
      coordinateField,
      coordinateGuide: coordinateField ? `item[${JSON.stringify(coordinateField)}] -> [lng, lat]` : '',
      sampleKeys: rows.length ? Object.keys(rows[0]).slice(0, 12) : [],
      fieldProfiles: buildRowPropertyProfiles(rows),
      bboxText: formatMaybeBbox(computeBBoxFromRows(rows, coordinateField)),
    }]
  }

  const groups: Array<{
    name: string
    count: number
    coordinateField: string | null
    coordinateGuide: string
    sampleKeys: string[]
    fieldProfiles: ReturnType<typeof buildPropertyProfiles>
    bboxText: string
  }> = []

  for (const key of runtimeContract.rootKeys || []) {
    const value = rootPayload?.[key]
    if (!Array.isArray(value)) continue
    const rows = value.filter((item): item is Record<string, any> => !!item && typeof item === 'object' && !Array.isArray(item))
    const coordinateField = rows.length > 0 ? detectCoordinateField(rows[0]) : null
    groups.push({
      name: key,
      count: value.length,
      coordinateField,
      coordinateGuide: coordinateField ? `item[${JSON.stringify(coordinateField)}] -> [lng, lat]` : '',
      sampleKeys: rows.length ? Object.keys(rows[0]).slice(0, 12) : [],
      fieldProfiles: buildRowPropertyProfiles(rows),
      bboxText: formatMaybeBbox(computeBBoxFromRows(rows, coordinateField)),
    })
  }

  return groups
}

function buildJsonStructureSummary(rootPayload: any, groups: ReturnType<typeof collectJsonGroups>) {
  return {
    rootShape: Array.isArray(rootPayload) ? 'array' : 'object',
    topLevelKeys: !Array.isArray(rootPayload) && rootPayload && typeof rootPayload === 'object'
      ? Object.keys(rootPayload)
      : undefined,
    groups: groups.map((group) => ({
      name: group.name,
      count: group.count,
      coordinateField: group.coordinateField,
      sampleKeys: group.sampleKeys,
      ...(group.bboxText ? { bbox: group.bboxText } : {}),
    })),
  }
}

function suggestJsonVisualizations(runtimeContract: RuntimeJsonContract, groups: ReturnType<typeof collectJsonGroups>): string[] {
  const hasCoordinateGroups = groups.some((group) => !!group.coordinateField)
  const multiGroups = groups.length >= 2
  if (hasCoordinateGroups && multiGroups) {
    return ['分组路线专题图', '分组点位图', '按组分色的折线+节点可视化']
  }
  if (hasCoordinateGroups) {
    return ['点位专题图', '带时间信息的事件分布图']
  }
  if (runtimeContract.responseShape === 'object') {
    return ['结构化信息面板', '分组列表/时间轴']
  }
  return ['表格列表', '统计图表']
}

function buildJsonCodeHint(runtimeContract: RuntimeJsonContract, groups: ReturnType<typeof collectJsonGroups>): string {
  const hints = [
    runtimeContract.responseShape === 'object'
      ? '根结构是对象，先按顶层 key 取数组，不要写 rawData[0]。'
      : '根结构是数组，先取数组元素再访问字段，不要写 rawData.someKey。',
  ]
  if (runtimeContract.canonicalAccess.length) {
    hints.push(`优先使用这些访问方式：${runtimeContract.canonicalAccess.join('；')}`)
  }
  const coordinateGroup = groups.find((group) => group.coordinateField)
  if (coordinateGroup?.coordinateField) {
    hints.push(`坐标字段使用 ${JSON.stringify(coordinateGroup.coordinateField)}，格式为 [lng, lat]。`)
  }
  return hints.join('')
}

function sanitizeJsonSample(value: any) {
  return sanitizeForJsonSample(value, 0)
}

function sanitizeForJsonSample(value: any, depth: number): JsonValue {
  if (value == null) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value
  if (depth >= 3) return Array.isArray(value) ? '[...]' : '{...}'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SAMPLE_ARRAY_ITEMS).map((item) => sanitizeForJsonSample(item, depth + 1))
  }
  if (typeof value === 'object') {
    const output: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value).slice(0, MAX_SAMPLE_OBJECT_KEYS)) {
      output[key] = sanitizeForJsonSample(item, depth + 1)
    }
    return output
  }
  return String(value)
}

function detectCoordinateField(row: Record<string, any>): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      return key
    }
  }
  return null
}

function inferFieldType(profile: {
  numberCount: number
  booleanCount: number
  stringCount: number
  uniqueValues: Set<string>
}): 'number' | 'boolean' | 'category' | 'text' {
  if (profile.numberCount > 0 && profile.numberCount >= profile.stringCount) return 'number'
  if (profile.booleanCount > 0 && profile.booleanCount >= profile.stringCount) return 'boolean'
  if (profile.stringCount > 0 && profile.uniqueValues.size <= 12) return 'category'
  return 'text'
}

function suggestVisualizations(params: {
  geometryTypeStats: Record<string, number>
  propertyProfiles: Array<{
    name: string
    inferredType: 'number' | 'boolean' | 'category' | 'text'
    nonEmptyRate: number
  }>
}): string[] {
  const suggestions: string[] = []
  const geomTypes = Object.keys(params.geometryTypeStats)
  const hasPolygon = geomTypes.some((type) => /Polygon/.test(type))
  const hasPoint = geomTypes.some((type) => /Point/.test(type))
  const numericField = params.propertyProfiles.find((item) => item.inferredType === 'number' && item.nonEmptyRate >= 0.2)
  const categoryField = params.propertyProfiles.find((item) => item.inferredType === 'category' && item.nonEmptyRate >= 0.3)

  if (hasPolygon) {
    suggestions.push(categoryField ? `面填充分色（按 ${categoryField.name}）` : '基础面填充图层')
    suggestions.push('点击面要素后在侧边栏展示详情')
    if (numericField) suggestions.push(`可选 fill-extrusion / 分级设色（按 ${numericField.name}）`)
  }
  if (hasPoint) {
    suggestions.push('点位分布图 + 点击高亮 + 侧边栏详情')
    if (numericField) suggestions.push(`热力图（按 ${numericField.name} 计算权重）`)
    suggestions.push('必要时做聚合或时间筛选')
  }
  if (!suggestions.length) {
    suggestions.push('基础 GeoJSON 图层渲染 + 点击详情面板')
  }
  return suggestions
}

function buildCoordinateGuide(stats: Record<string, number>): string {
  if (stats.MultiPoint) return 'MultiPoint: geometry.coordinates[0] -> [lng, lat]'
  if (stats.Point) return 'Point: geometry.coordinates -> [lng, lat]'
  if (stats.MultiPolygon) return 'MultiPolygon: geometry.coordinates[n][ring][point]；首点示例 geometry.coordinates[0][0][0]'
  if (stats.Polygon) return 'Polygon: geometry.coordinates[ring][point]；首点示例 geometry.coordinates[0][0]'
  if (stats.MultiLineString) return 'MultiLineString: geometry.coordinates[line][point]'
  if (stats.LineString) return 'LineString: geometry.coordinates[point]'
  return '按 geometry.type 判断 coordinates 层级，访问 [0] 前必须判空'
}

function buildCodeHint(contract: RuntimeGeojsonContract, stats: Record<string, number>): string {
  const lines = [
    `const rawData = await fetch(url).then(res => res.json())`,
    `const geojson = ${contract.geojsonPath === 'rawData' ? 'rawData' : contract.geojsonPath}`,
    `const features = Array.isArray(geojson.features) ? geojson.features : []`,
  ]
  if (stats.MultiPoint) {
    lines.push(`const point = Array.isArray(feature.geometry?.coordinates?.[0]) ? feature.geometry.coordinates[0] : null`)
  }
  return lines.join('；')
}

function sanitizeFeatureSample(feature: any): JsonValue {
  const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {}
  return {
    type: feature?.type || 'Feature',
    properties: sanitizeObject(props, 12),
    geometry: sanitizeGeometry(feature?.geometry),
  }
}

function sanitizeGeometry(geometry: any): JsonValue {
  if (!geometry || typeof geometry !== 'object') return null
  return {
    type: geometry.type || 'Unknown',
    coordinatesPreview: previewCoordinates(geometry.coordinates, 2),
  }
}

function previewCoordinates(value: any, depth: number): JsonValue {
  if (depth <= 0) return Array.isArray(value) ? '[...]' : sampleValue(value)
  if (!Array.isArray(value)) return sampleValue(value)
  return value.slice(0, 2).map((item) => previewCoordinates(item, depth - 1))
}

function sanitizeObject(value: Record<string, any>, limit: number): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value).slice(0, limit)) {
    output[key] = sampleValue(item)
  }
  return output
}

function sampleValue(value: any): JsonValue {
  if (value == null) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => sampleValue(item))
  if (typeof value === 'object') return sanitizeObject(value, 6)
  return String(value)
}

function sampleText(value: any): string {
  const sampled = sampleValue(value)
  if (typeof sampled === 'string') return sampled
  if (typeof sampled === 'number' || typeof sampled === 'boolean') return String(sampled)
  if (sampled == null) return ''
  return JSON.stringify(sampled)
}

function isEmptyValue(value: any): boolean {
  return value == null || value === '' || value === 'null' || value === 'undefined'
}

function isFiniteNumber(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function describeRootShape(value: any): string {
  if (Array.isArray(value)) return `数组(${value.length})`
  if (value && typeof value === 'object') return `对象(${Object.keys(value).slice(0, 8).join(', ')})`
  return typeof value
}

function formatStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ')
}

function formatBbox(bbox: [number, number, number, number]): string {
  return `${bbox[0].toFixed(6)}, ${bbox[1].toFixed(6)} ~ ${bbox[2].toFixed(6)}, ${bbox[3].toFixed(6)}`
}

function formatMaybeBbox(bbox: [number, number, number, number] | null): string {
  return bbox ? formatBbox(bbox) : ''
}
