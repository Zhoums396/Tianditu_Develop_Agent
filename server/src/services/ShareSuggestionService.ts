import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { config } from '../config.js'
import { createLLM } from '../llm/createLLM.js'

export interface ShareSuggestionInput {
  code: string
  hint?: string
  tiandituToken?: string
}

export interface ShareSuggestionResult {
  title: string
  description: string
  source: 'ai' | 'fallback'
  model?: string
}

export interface ShareSuggestionStreamChunk extends ShareSuggestionResult {
  done?: boolean
}

const MAX_CODE_CHARS = 48 * 1024
const MAX_HINT_CHARS = 1500
const MAX_TITLE_CHARS = 80
const MAX_DESCRIPTION_CHARS = 240
const MAX_PROMPT_CODE_EXCERPT_CHARS = 12 * 1024
const GENERIC_TITLE_RE = /^(地图快照|地图应用快照|地图应用|地图页面)\s*\d{0,4}/
const TECHNICAL_TEXT_RE = /(api|sdk|js api|tmapgl|langchain|openai|qwen|token|tk=|接口|技术|实现|代码|脚本|html|css|javascript|typescript|geojson|\/api\/)/i

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampChars(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit)
}

function sanitizeTitle(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim()
  return clampChars(compact, MAX_TITLE_CHARS)
}

function sanitizeDescription(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim()
  return clampChars(compact, MAX_DESCRIPTION_CHARS)
}

function stripTitleSuffix(raw: string): string {
  return raw
    .replace(/[（(]?(演示|示例|快照|页面|应用)[）)]?$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function jsonCandidate(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function parseSuggestionJson(rawText: string): { title?: string; description?: string } | null {
  const candidate = jsonCandidate(rawText)
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
    }
  } catch {
    return null
  }
}

export function parseLabeledSuggestionText(rawText: string): { title?: string; description?: string } {
  const text = String(rawText || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/\r/g, '')

  const titleMatch = text.match(/标题[:：]\s*([\s\S]*?)(?=\n描述[:：]|\n?$)/)
  const descriptionMatch = text.match(/描述[:：]\s*([\s\S]*)$/)

  const title = sanitizeTitle(titleMatch?.[1] || '')
  const description = sanitizeDescription(descriptionMatch?.[1] || '')

  return {
    title: title || undefined,
    description: description || undefined,
  }
}

function redactCodeForPrompt(code: string, tiandituToken?: string): string {
  let redacted = String(code || '')

  // 占位符和常见 token 形态统一替换
  redacted = redacted.replace(/\$\{TIANDITU_TOKEN\}/g, '[TIANDITU_TOKEN]')
  redacted = redacted.replace(/(tk=)[a-z0-9]{32}/gi, '$1[REDACTED_TOKEN]')
  redacted = redacted.replace(/(["'])tk\1\s*:\s*(["'])[a-z0-9]{32}\2/gi, '"tk":"[REDACTED_TOKEN]"')

  if (tiandituToken) {
    const escaped = tiandituToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    redacted = redacted.replace(new RegExp(escaped, 'g'), '[REDACTED_TOKEN]')
  }

  return redacted
}

function detectScene(text: string): {
  key: 'transit' | 'drive' | 'admin' | 'poi' | 'geocode' | 'heatmap' | 'marker' | 'polygon' | 'base'
  label: string
} {
  const lower = text.toLowerCase()

  if (/transit|busline|linetype|公交|地铁|换乘|segmentline/.test(lower)) {
    return { key: 'transit', label: '公交地铁规划' }
  }
  if (/\/drive|orig|dest|驾车|路线规划|routelatlon/.test(lower)) {
    return { key: 'drive', label: '驾车路线规划' }
  }
  if (/administrative|行政区|district|boundary|childlevel/.test(lower)) {
    return { key: 'admin', label: '行政区边界展示' }
  }
  if (/\/search|querytype|poi|周边搜索|pointlonlat|地名搜索/.test(lower)) {
    return { key: 'poi', label: 'POI 检索分析' }
  }
  if (/geocoder|地理编码|逆地理|reverse-geocode/.test(lower)) {
    return { key: 'geocode', label: '地理编码定位' }
  }
  if (/heatmap|热力图/.test(lower)) {
    return { key: 'heatmap', label: '热力分布可视化' }
  }
  if (/marker|标注|景点|popup/.test(lower)) {
    return { key: 'marker', label: '点位标注地图' }
  }
  if (/polygon|fill|多边形|地块|geojson/.test(lower)) {
    return { key: 'polygon', label: '区域面数据可视化' }
  }
  return { key: 'base', label: '地图应用快照' }
}

interface CodeSignals {
  pageTitle: string
  headings: string[]
  apiEndpoints: string[]
  chinesePhrases: string[]
  uiPhrases: string[]
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function cleanSignalText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTechnicalPhrase(value: string): boolean {
  const text = cleanSignalText(value)
  if (!text) return true
  if (!/[\u4e00-\u9fa5]/.test(text)) return true
  if (TECHNICAL_TEXT_RE.test(text)) return true
  if (/^https?:\/\//i.test(text)) return true
  if (/^[A-Za-z0-9_./:=?-]+$/.test(text)) return true
  return false
}

function extractCodeSignals(code: string): CodeSignals {
  const titleMatch = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const pageTitle = stripTitleSuffix(cleanSignalText(titleMatch?.[1] || ''))

  const headingMatches = [...code.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => stripTitleSuffix(cleanSignalText(m[1] || '')))
    .filter(Boolean)
    .slice(0, 6)

  const endpointMatches = [...code.matchAll(/\/api\/tianditu\/[a-z-]+/gi)]
    .map((m) => m[0].toLowerCase())
  const apiEndpoints = uniq(endpointMatches).slice(0, 8)

  const phraseCandidates = [...code.matchAll(/["'`]([^"'`\n]{2,40})["'`]/g)]
    .map((m) => cleanSignalText(m[1] || ''))
    .filter((text) => /[\u4e00-\u9fa5]/.test(text))
    .filter((text) => text.length >= 2 && text.length <= 24)
    .filter((text) => !/^https?:\/\//i.test(text))
    .filter((text) => !/^(true|false|null|undefined)$/i.test(text))
    .slice(0, 40)
  const chinesePhrases = uniq(phraseCandidates).slice(0, 12)

  const placeholderMatches = [...code.matchAll(/\b(?:placeholder|aria-label|title)\s*=\s*["']([^"'`\n]{2,40})["']/gi)]
    .map((m) => cleanSignalText(m[1] || ''))
  const buttonMatches = [...code.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)]
    .map((m) => cleanSignalText(m[1] || ''))
  const uiPhrases = uniq([
    ...headingMatches,
    ...placeholderMatches,
    ...buttonMatches,
    ...chinesePhrases,
  ])
    .filter((text) => !isTechnicalPhrase(text))
    .slice(0, 16)

  return {
    pageTitle,
    headings: headingMatches,
    apiEndpoints,
    chinesePhrases,
    uiPhrases,
  }
}

function pickBestTitle(signals: CodeSignals, hint: string, sceneLabel: string): string {
  const hintLine = stripTitleSuffix(clampChars(hint.replace(/\s+/g, ' ').trim(), 30))
  const titleCandidates = [
    signals.pageTitle,
    ...signals.headings,
    ...signals.uiPhrases,
    hintLine,
    sceneLabel,
  ]
    .map((text) => stripTitleSuffix(text))
    .filter(Boolean)
    .filter((text) => !GENERIC_TITLE_RE.test(text))
    .filter((text) => !isTechnicalPhrase(text) || text === sceneLabel)

  return sanitizeTitle(titleCandidates[0] || sceneLabel)
}

function buildExperienceHighlights(sceneKey: string, signals: CodeSignals): string[] {
  const joined = `${signals.pageTitle}\n${signals.headings.join(' ')}\n${signals.uiPhrases.join(' ')}`
  const highlights: string[] = []

  if (/搜索|检索|附近|周边|poi|结果/.test(joined.toLowerCase())) {
    highlights.push('左侧可浏览搜索结果，地图会同步定位相关点位')
  }
  if (/当前位置|搜索中心|location|坐标|经度|纬度/.test(joined.toLowerCase())) {
    highlights.push('支持查看当前定位中心及关键信息')
  }
  if (/详情|弹窗|popup|点击/.test(joined.toLowerCase())) {
    highlights.push('点击地图点位后可查看详情信息')
  }
  if (sceneKey === 'drive') {
    highlights.push('页面会展示起终点、路线轨迹和行程信息')
  }
  if (sceneKey === 'transit') {
    highlights.push('页面会展示公交地铁换乘路线与出行信息')
  }
  if (sceneKey === 'admin') {
    highlights.push('页面重点展示行政区范围与边界轮廓')
  }
  if (sceneKey === 'polygon') {
    highlights.push('页面重点展示区域面数据及其专题信息')
  }
  if (sceneKey === 'marker' && !highlights.length) {
    highlights.push('页面会在地图上突出显示重点点位')
  }

  return uniq(highlights).slice(0, 3)
}

function buildPromptCodeExcerpt(code: string, signals: CodeSignals): string {
  if (!code) return ''

  const snippets: string[] = []
  const seenRanges = new Set<string>()
  const anchors = uniq([
    signals.pageTitle,
    ...signals.headings,
    ...signals.uiPhrases,
  ])
    .filter(Boolean)
    .slice(0, 10)

  const pushRange = (label: string, start: number, end: number) => {
    const safeStart = Math.max(0, start)
    const safeEnd = Math.min(code.length, end)
    if (safeEnd <= safeStart) return
    const key = `${safeStart}:${safeEnd}`
    if (seenRanges.has(key)) return
    seenRanges.add(key)
    snippets.push(`[${label}]`)
    snippets.push(code.slice(safeStart, safeEnd))
  }

  pushRange('head', 0, Math.min(code.length, 2400))

  for (const anchor of anchors) {
    const index = code.indexOf(anchor)
    if (index < 0) continue
    pushRange(`anchor:${anchor}`, index - 320, index + anchor.length + 480)
  }

  if (!snippets.length) {
    return clampChars(code, MAX_PROMPT_CODE_EXCERPT_CHARS)
  }

  return clampChars(snippets.join('\n\n'), MAX_PROMPT_CODE_EXCERPT_CHARS)
}

export function buildFallbackShareSuggestion(input: ShareSuggestionInput): ShareSuggestionResult {
  const hint = trimText(input.hint)
  const signals = extractCodeSignals(input.code)
  const scene = detectScene(`${hint}\n${signals.pageTitle}\n${signals.headings.join(' ')}\n${input.code}`)
  const title = pickBestTitle(signals, hint, scene.label)

  const sceneIntroMap: Record<string, string> = {
    transit: `页面围绕“${title}”展开，适合查看公交地铁出行方案`,
    drive: `页面围绕“${title}”展开，适合查看路线与出行信息`,
    admin: `页面围绕“${title}”展开，适合查看行政区范围与边界信息`,
    poi: `页面围绕“${title}”展开，适合查看周边点位与搜索结果`,
    geocode: `页面围绕“${title}”展开，适合查看地点定位与坐标信息`,
    heatmap: `页面围绕“${title}”展开，适合查看空间分布热点`,
    marker: `页面围绕“${title}”展开，适合查看重点点位与位置分布`,
    polygon: `页面围绕“${title}”展开，适合查看区域范围与专题信息`,
    base: `页面围绕“${title}”展开，适合快速查看地图内容`,
  }
  const highlights = buildExperienceHighlights(scene.key, signals)
  const uiHint = signals.uiPhrases
    .filter((text) => text !== title)
    .slice(0, 3)
    .join('、')
  const description = sanitizeDescription([
    sceneIntroMap[scene.key] || `页面围绕“${title}”展开`,
    highlights.length ? `并且 ${highlights.join('；')}。` : '。',
    uiHint ? `页面中还能看到 ${uiHint} 等信息。` : '',
  ].join(''))

  return { title, description, source: 'fallback' }
}

export class ShareSuggestionService {
  private readonly tiandituToken?: string

  constructor(options?: { tiandituToken?: string }) {
    this.tiandituToken = options?.tiandituToken || config.tiandituToken
  }

  private buildSuggestionContext(input: ShareSuggestionInput) {
    const code = trimText(input.code)
    const hint = clampChars(trimText(input.hint), MAX_HINT_CHARS)
    if (!code) throw new Error('分享代码不能为空')

    const fallback = buildFallbackShareSuggestion({ code, hint })
    const redactedCode = redactCodeForPrompt(code, input.tiandituToken || this.tiandituToken)
    const truncatedCode = clampChars(redactedCode, MAX_CODE_CHARS)
    const signals = extractCodeSignals(redactedCode)
    const scene = detectScene(`${hint}\n${signals.pageTitle}\n${signals.headings.join(' ')}`).label
    const focusedCodeExcerpt = buildPromptCodeExcerpt(truncatedCode, signals)

    const basePromptLines = [
      `场景判定: ${scene}`,
      `任务Prompt（用户需求）: ${hint || '（无，需主要依据代码内容生成）'}`,
      signals.pageTitle ? `代码<title>: ${signals.pageTitle}` : '代码<title>: （无）',
      signals.headings.length ? `页面标题文本: ${signals.headings.join(' | ')}` : '页面标题文本: （无）',
      signals.uiPhrases.length ? `页面可见关键词: ${signals.uiPhrases.join('、')}` : '页面可见关键词: （无）',
      signals.apiEndpoints.length ? `技术线索（仅作辅助，不要写进文案）: ${signals.apiEndpoints.join('、')}` : '技术线索（仅作辅助，不要写进文案）: （无）',
      '代码片段摘录（已脱敏，仅保留与页面内容相关的关键片段；请用它确认页面内容，不要复述技术实现）:',
      focusedCodeExcerpt || '（无）',
    ]

    return {
      code,
      hint,
      fallback,
      systemPrompt: [
        '你是地图分享页文案助手。',
        '你的文案会直接展示给最终用户，用来介绍这个网页里能看到什么、能做什么、适合什么场景。',
        '请优先描述页面内容本身：主题对象、地点、列表/卡片/弹窗/路线/结果等用户可见元素，以及用户能完成的事情。',
        '标题和描述必须与当前地图页面实际内容强相关，优先使用页面中的业务实体（专题名、地点名、机构名、对象名）。',
        '不要把文案写成技术说明，不要介绍 API、SDK、接口路径、代码结构、实现方式、模型名称。',
        '如果用户需求和最终页面内容不完全一致，应以页面当前实际呈现的内容为准。',
        '禁止输出与页面无关的泛化文案。',
        `硬性约束：标题 <= ${MAX_TITLE_CHARS} 字符，描述 <= ${MAX_DESCRIPTION_CHARS} 字符。`,
      ].join('\n'),
      jsonUserPrompt: [
        ...basePromptLines,
        '只输出 JSON，不要输出 Markdown，不要代码块，不要额外解释。',
        '输出格式：{"title":"...","description":"..."}',
      ].join('\n\n'),
      labeledUserPrompt: [
        ...basePromptLines,
        '请严格按以下两行格式输出，不要输出 JSON，不要额外解释，不要编号。',
        '标题：...',
        '描述：...',
      ].join('\n\n'),
    }
  }

  async *suggestStream(input: ShareSuggestionInput): AsyncGenerator<ShareSuggestionStreamChunk> {
    const context = this.buildSuggestionContext(input)
    const { fallback } = context

    if (!config.llm.apiKey) {
      yield { ...fallback, done: true }
      return
    }

    let fullContent = ''
    let lastTitle = ''
    let lastDescription = ''

    try {
      const llm = createLLM({
        temperature: 0.2,
        maxTokens: 180,
        timeoutMs: Math.min(config.llm.requestTimeoutMs, 12000),
        modelName: config.llm.auxModel,
        modelKwargs: {
          enable_thinking: false,
        },
      })

      const stream = await llm.stream([
        new SystemMessage(context.systemPrompt),
        new HumanMessage(context.labeledUserPrompt),
      ])

      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
            : ''
        if (!text) continue

        fullContent += text
        const parsed = parseLabeledSuggestionText(fullContent)
        const nextTitle = parsed.title || lastTitle
        const nextDescription = parsed.description || lastDescription

        if (nextTitle === lastTitle && nextDescription === lastDescription) continue

        lastTitle = nextTitle
        lastDescription = nextDescription
        yield {
          title: nextTitle,
          description: nextDescription,
          source: 'ai',
          model: config.llm.auxModel,
        }
      }

      const parsed = parseLabeledSuggestionText(fullContent)
      const title = sanitizeTitle(parsed.title || '') || fallback.title
      const description = sanitizeDescription(parsed.description || '') || fallback.description

      yield {
        title,
        description,
        source: 'ai',
        model: config.llm.auxModel,
        done: true,
      }
    } catch {
      yield {
        ...fallback,
        done: true,
      }
    }
  }

  async suggest(input: ShareSuggestionInput): Promise<ShareSuggestionResult> {
    const context = this.buildSuggestionContext(input)
    const { fallback } = context
    if (!config.llm.apiKey) return fallback

    try {
      const llm = createLLM({
        temperature: 0.2,
        maxTokens: 180,
        timeoutMs: Math.min(config.llm.requestTimeoutMs, 12000),
        modelName: config.llm.auxModel,
        modelKwargs: {
          enable_thinking: false,
        },
      })
      const response = await llm.invoke([
        new SystemMessage(context.systemPrompt),
        new HumanMessage(context.jsonUserPrompt),
      ])

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content)

      const parsed = parseSuggestionJson(content)
      const title = sanitizeTitle(parsed?.title || '')
      const description = sanitizeDescription(parsed?.description || '')
      if (!title || !description) return fallback

      return {
        title,
        description,
        source: 'ai',
        model: config.llm.auxModel,
      }
    } catch {
      return fallback
    }
  }
}
