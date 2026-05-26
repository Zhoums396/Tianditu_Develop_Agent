import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { config } from '../config.js'
import { createLLM } from '../llm/createLLM.js'

export type VisualSeverity = 'low' | 'medium' | 'high'
export type VisualInspectStatus = 'ok' | 'unavailable'

export interface VisualInspectionInput {
  imageBase64: string
  hint?: string
  runId?: string
}

export interface VisualInspectionResult {
  status: VisualInspectStatus
  anomalous: boolean
  shouldRepair: boolean
  severity: VisualSeverity
  summary: string
  diagnosis: string
  repairHint: string
  confidence: number
  model: string
}

export interface VisualInspectionServiceOptions {
  timeoutMs?: number
}

const MODEL_NAME = config.visualInspection.model || config.llm.model
const MAX_HINT_CHARS = 1500
const MAX_SUMMARY_CHARS = 120
const MAX_DIAGNOSIS_CHARS = 500
const MAX_REPAIR_HINT_CHARS = 500

function isLoadingLikeText(text: string): boolean {
  return /加载中|正在加载|请稍候|请稍等|loading|initializing|rendering|fetching|waiting|spinner|skeleton/i.test(String(text || ''))
}

function hasExplicitFailureSignal(text: string): boolean {
  return /错误|报错|异常|崩溃|失败|黑屏|404|500|exception|undefined|not found|failed/i.test(String(text || ''))
}

function isSemanticMapJudgement(text: string): boolean {
  return /高亮|省份|名单|数量|匹配|不一致|未高亮|错高亮|行政区|语义|数据源/.test(String(text || ''))
}

function hasHardVisualFailureSignal(text: string): boolean {
  return /空白|黑屏|白屏|无法显示|没有显示|未渲染|报错|崩溃|控件错位|严重遮挡|404|500|exception|undefined|not found|failed/i.test(String(text || ''))
}

function clampChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function normalizeSummary(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return clampChars(value || '视觉检查已完成，未发现明确异常。', MAX_SUMMARY_CHARS)
}

function normalizeDiagnosis(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return clampChars(value || '未发现可确认的页面异常。', MAX_DIAGNOSIS_CHARS)
}

function normalizeRepairHint(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return clampChars(value || '无', MAX_REPAIR_HINT_CHARS)
}

function normalizeSeverity(value: unknown): VisualSeverity {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return 'low'
}

function normalizeConfidenceValue(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n > 1 && n <= 100) return Number((n / 100).toFixed(2))
  if (n < 0) return 0
  if (n > 1) return 1
  return Number(n.toFixed(2))
}

function fallbackConfidence(params: {
  anomalous: boolean
  shouldRepair: boolean
  severity: VisualSeverity
}): number {
  if (!params.anomalous) return 0.9
  if (params.shouldRepair) {
    if (params.severity === 'high') return 0.88
    if (params.severity === 'medium') return 0.82
    return 0.76
  }
  if (params.severity === 'high') return 0.72
  if (params.severity === 'medium') return 0.66
  return 0.6
}

export function resolveVisualInspectionConfidence(
  value: unknown,
  params: {
    anomalous: boolean
    shouldRepair: boolean
    severity: VisualSeverity
  },
): number {
  const normalized = normalizeConfidenceValue(value)
  if (normalized == null) return fallbackConfidence(params)

  // 有些模型会把 confidence 理解成“异常概率”，导致页面正常时回 0。
  // 这里统一改成“对最终结论的把握度”语义，避免 UI 出现“通过但 0%”。
  if (!params.anomalous && normalized === 0) return fallbackConfidence(params)
  return normalized
}

function normalizeShouldRepair(value: unknown): boolean {
  return value === true
}

function parseJsonCandidate(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  if (!candidate || !candidate.startsWith('{')) return null
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function unavailableResult(reason: string): VisualInspectionResult {
  const diagnosis = clampChars(reason || '视觉检查暂时不可用。', MAX_DIAGNOSIS_CHARS)
  return {
    status: 'unavailable',
    anomalous: false,
    shouldRepair: false,
    severity: 'low',
    summary: '视觉检查不可用',
    diagnosis,
    repairHint: '无',
    confidence: 0,
    model: MODEL_NAME,
  }
}

export class VisualInspectionService {
  private readonly timeoutMs: number

  constructor(options?: VisualInspectionServiceOptions) {
    this.timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(5000, Number(options?.timeoutMs)) : 20000
  }

  async inspect(input: VisualInspectionInput): Promise<VisualInspectionResult> {
    const imageBase64 = String(input.imageBase64 || '').trim()
    if (!imageBase64) return unavailableResult('截图内容为空，无法执行视觉检查。')

    if (!config.llm.apiKey) return unavailableResult('DASHSCOPE_API_KEY 未配置，无法执行视觉检查。')

    const hint = clampChars(String(input.hint || '').trim(), MAX_HINT_CHARS)
    const runId = String(input.runId || '').trim()

    const systemPrompt = [
      '你是地图页面视觉质检助手。',
      '你会收到一张地图应用页面截图。',
      '请只基于截图判断页面是否存在异常或错误迹象，并给出简洁诊断。',
      '用户 hint 只作为辅助上下文，不是必须逐项满足的验收清单。',
      '你必须独立判断是否需要进入自动修复链路（shouldRepair），不要把这项交给规则推断。',
      '先观察后结论：先描述可见元素（道路/地名/控件/面板/点位等），再判断异常与是否需要修复。',
      '不要输出 Markdown，不要解释过程，只输出 JSON。',
      '输出 JSON schema:',
      '{"anomalous":boolean,"shouldRepair":boolean,"severity":"low|medium|high","summary":"...","diagnosis":"...","repairHint":"...","confidence":0-1}',
      '要求：',
      '1) 若无法确认异常，anomalous=false，shouldRepair=false，severity=low。',
      '2) 如果页面内容完整、可正常交互，仅存在轻微视觉差异，shouldRepair=false。',
      '3) 仅当确实需要代码修复（空白/黑屏/错位/关键功能失效）时，shouldRepair=true。',
      '4) diagnosis 描述可观察到的现象，不要编造未见事实。',
      '5) repairHint 用于代码修复输入，1~3 句即可；shouldRepair=false 时可填“无”。',
      '6) confidence 表示你对“最终判断”的把握度，不是异常概率。',
      '7) 若你判断页面正常且证据充分，confidence 通常应在 0.80~0.98。',
      '8) 若你判断页面异常且证据充分，confidence 通常应在 0.70~0.98。',
      '9) 只有当截图模糊、被遮挡、信息不足或难以判断时，confidence 才应低于 0.50，并在 diagnosis 说明不确定性来源。',
      '10) 如果截图主要呈现“加载中 / loading / 等待中 / 骨架屏”等加载态，而没有明确错误证据，不要触发自动修复：anomalous=false，shouldRepair=false。',
      '11) 如果截图主体是可用的地图页面，即使没有看到 hint 中提到的某些额外标题栏、侧栏或卡片，也不要仅凭“未看到这些额外 UI”就判定异常。',
      '12) 不要用截图去验收复杂业务语义或数据精确性，例如“23 个省份是否全部正确高亮”“名称列表和地图区域是否逐项匹配”。这类判断无法仅凭截图可靠确认，最多 anomalous=true 且 shouldRepair=false，除非同时存在空白、黑屏、报错、关键图层完全未渲染等硬故障。',
      '13) 如果地图主体、图例、面板和专题图层都已显示，只是你怀疑颜色/名单/数量存在语义不一致，必须 shouldRepair=false。',
    ].join('\n')

    const userPrompt = [
      runId ? `runId: ${runId}` : 'runId: (none)',
      `hint: ${hint || '(none)'}`,
      '请开始视觉检查并输出 JSON。',
    ].join('\n')

    try {
      const llm = createLLM({
        temperature: 0,
        maxTokens: 500,
        timeoutMs: this.timeoutMs,
        modelName: MODEL_NAME,
      })

      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ] as any,
        }),
      ])

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content)
      const parsed = parseJsonCandidate(content)
      if (!parsed) {
        return unavailableResult('视觉诊断输出解析失败。')
      }

      let summary = normalizeSummary(parsed.summary)
      let diagnosis = normalizeDiagnosis(parsed.diagnosis)
      let repairHint = normalizeRepairHint(parsed.repairHint)
      let anomalous = parsed.anomalous === true
      let shouldRepair = normalizeShouldRepair(parsed.shouldRepair)
      if (shouldRepair && !anomalous) {
        anomalous = true
      }
      if (!anomalous) {
        shouldRepair = false
      }

      let severity = anomalous ? normalizeSeverity(parsed.severity) : 'low'
      const combinedText = `${summary}\n${diagnosis}\n${repairHint}`
      if (isLoadingLikeText(combinedText) && !hasExplicitFailureSignal(combinedText)) {
        anomalous = false
        shouldRepair = false
        severity = 'low'
        summary = '页面处于加载阶段，暂不判定为需要修复的异常。'
        diagnosis = normalizeDiagnosis(`${diagnosis} 当前画面更接近加载态，而不是明确故障。`)
        repairHint = '无'
      }
      if (shouldRepair && isSemanticMapJudgement(combinedText) && !hasHardVisualFailureSignal(combinedText)) {
        shouldRepair = false
        severity = 'low'
        summary = '疑似语义一致性问题，暂不触发自动修复。'
        diagnosis = normalizeDiagnosis(`${diagnosis} 当前截图不足以可靠判断地图区域与名单/数量是否逐项一致，且页面主体已渲染。`)
        repairHint = '无'
      }
      const confidence = resolveVisualInspectionConfidence(parsed.confidence, {
        anomalous,
        shouldRepair,
        severity,
      })

      return {
        status: 'ok',
        anomalous,
        shouldRepair,
        severity,
        summary,
        diagnosis,
        repairHint,
        confidence,
        model: MODEL_NAME,
      }
    } catch (err: any) {
      return unavailableResult(err?.message || '视觉诊断调用失败。')
    }
  }
}
