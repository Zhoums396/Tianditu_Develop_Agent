import { create } from 'zustand'
import type { Message, MessageFileAttachment, ThoughtChainItem } from '../types/chat'
import type { CodeDiffPayload } from '../types/codeDiff'
import { useMapStore } from './useMapStore'
import { useWorkspaceStore } from './useWorkspaceStore'
import { createId } from '../utils/createId'
import { extractFirstCompleteHtmlDocument } from '../utils/extractFirstCompleteHtmlDocument'
import { injectTiandituTokenPlaceholders } from '../utils/injectTiandituTokenPlaceholders'
import { isJsonPreviewableFileName } from '../utils/jsonPreview'
import { withBasePath } from '../utils/basePath'
import { encodeTextBase64 } from '../utils/transportEncoding'

interface ChatStore {
  messages: Message[]
  loading: boolean
  error: string | null
  activeFileContext: string | null
  sendMessage: (
    content: string,
    file?: File,
    syntheticFile?: { name: string; size: number },
    sampleId?: string,
    filePreviewText?: string | null,
  ) => Promise<void>
  autoFixMapError: (options?: {
    userInputHint?: string
    overrideError?: string
    source?: 'runtime' | 'visual'
  }) => Promise<void>
  addAssistantMessage: (content: string) => void
  clearMessages: () => void
}

/** 从消息数组构建对话历史字符串（最近 10 条） */
function buildHistory(messages: Message[]): string | undefined {
  const recent = messages.slice(-10)
  if (recent.length === 0) return undefined
  return recent
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n')
}

function hashCode(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return `h${(hash >>> 0).toString(16)}`
}

async function createDisplayFile(
  file?: File,
  syntheticFile?: { name: string; size: number },
  filePreviewText?: string | null,
) : Promise<MessageFileAttachment | undefined> {
  if (!file && !syntheticFile) return undefined

  const baseFile = file
    ? { name: file.name, size: file.size }
    : syntheticFile

  if (!baseFile) return undefined

  let resolvedPreviewText = filePreviewText || undefined
  if (!resolvedPreviewText && file && isJsonPreviewableFileName(file.name)) {
    try {
      resolvedPreviewText = await file.text()
    } catch {
      resolvedPreviewText = undefined
    }
  }

  return {
    ...baseFile,
    previewText: isJsonPreviewableFileName(baseFile.name) ? resolvedPreviewText : undefined,
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  loading: false,
  error: null,
  activeFileContext: null,

  sendMessage: async (content, file, syntheticFile, sampleId, filePreviewText) => {
    const mapState = useMapStore.getState()
    const blockedByVisualFlow = mapState.visualChecking || (mapState.fixing && mapState.fixingSource === 'visual')
    if (get().loading || blockedByVisualFlow) return

    const displayFile = await createDisplayFile(file, syntheticFile, filePreviewText)
    const userMsg: Message = {
      id: createId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      file: displayFile,
    }

    const history = buildHistory(get().messages)
    const activeFileContext = get().activeFileContext
    const existingCode = useMapStore.getState().currentCode || undefined
    useMapStore.getState().setCurrentRunId(null)
    useMapStore.getState().setLastFixDiff(null)
    useMapStore.getState().setCodeViewMode('code')

    set((s) => ({ messages: [...s.messages, userMsg], loading: true, error: null }))

    // 不提前创建空的 assistant 消息，等第一个 text chunk 到达再创建
    const assistantId = createId()
    let assistantCreated = false
    let textContent = ''
    let receivedCode = false
    let receivedCodeDelta = false
    let previewCommitted = false

    const extractRenderableHtml = (code: string | null | undefined) => {
      const html = extractFirstCompleteHtmlDocument(code)
      return html ? injectTiandituTokenPlaceholders(html) : ''
    }

    const ensureAssistantMessage = () => {
      if (assistantCreated) return
      assistantCreated = true
      set((s) => ({
        messages: [...s.messages, {
          id: assistantId,
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          streaming: true,
          thoughtChain: [],
        }],
      }))
    }

    const upsertThoughtChainItem = (patch: Partial<ThoughtChainItem> & Pick<ThoughtChainItem, 'toolCallId' | 'toolName'>) => {
      ensureAssistantMessage()
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m

          const chain = [...(m.thoughtChain || [])]
          const idx = chain.findIndex((item) => item.toolCallId === patch.toolCallId)
          if (idx === -1) {
            chain.push({
              toolCallId: patch.toolCallId,
              toolName: patch.toolName,
              status: patch.status || 'running',
              args: patch.args,
              result: patch.result,
              isError: patch.isError,
              startedAt: patch.startedAt,
              endedAt: patch.endedAt,
              decisionSource: patch.decisionSource,
              selectedPackages: patch.selectedPackages,
              selectedReferences: patch.selectedReferences,
              selectedContracts: patch.selectedContracts,
              fallbackReason: patch.fallbackReason,
              vetoApplied: patch.vetoApplied,
              uiLabel: patch.uiLabel,
              uiSummary: patch.uiSummary,
              uiGroup: patch.uiGroup,
              uiGroupLabel: patch.uiGroupLabel,
              uiVisibility: patch.uiVisibility,
            })
          } else {
            chain[idx] = { ...chain[idx], ...patch }
          }

          return { ...m, thoughtChain: chain }
        }),
      }))
    }

    /** 处理单个 SSE data line */
    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return
      const data = line.slice(6)
      if (data === '[DONE]') return

      try {
        const chunk = JSON.parse(data) as Record<string, any>

        if (chunk.type === 'tool_execution_start') {
          upsertThoughtChainItem({
            toolCallId: String(chunk.toolCallId || ''),
            toolName: String(chunk.toolName || 'unknown'),
            args: chunk.args,
            status: 'running',
            startedAt: typeof chunk.startedAtMs === 'number' ? chunk.startedAtMs : Date.now(),
            uiLabel: typeof chunk.uiLabel === 'string' ? chunk.uiLabel : undefined,
            uiSummary: typeof chunk.uiSummary === 'string' ? chunk.uiSummary : undefined,
            uiGroup: typeof chunk.uiGroup === 'string' ? chunk.uiGroup : undefined,
            uiGroupLabel: typeof chunk.uiGroupLabel === 'string' ? chunk.uiGroupLabel : undefined,
            uiVisibility: chunk.uiVisibility === 'activity' || chunk.uiVisibility === 'grouped' || chunk.uiVisibility === 'debug'
              ? chunk.uiVisibility
              : undefined,
          })
          return
        }

        if (chunk.type === 'tool_execution_end') {
          upsertThoughtChainItem({
            toolCallId: String(chunk.toolCallId || ''),
            toolName: String(chunk.toolName || 'unknown'),
            result: chunk.result,
            isError: !!chunk.isError,
            status: chunk.isError ? 'error' : 'done',
            endedAt: typeof chunk.endedAtMs === 'number' ? chunk.endedAtMs : Date.now(),
            decisionSource: typeof chunk.decisionSource === 'string' ? chunk.decisionSource : undefined,
            selectedPackages: Array.isArray(chunk.selectedPackages) ? chunk.selectedPackages : undefined,
            selectedReferences: Array.isArray(chunk.selectedReferences) ? chunk.selectedReferences : undefined,
            selectedContracts: Array.isArray(chunk.selectedContracts) ? chunk.selectedContracts : undefined,
            fallbackReason: typeof chunk.fallbackReason === 'string' ? chunk.fallbackReason : undefined,
            vetoApplied: chunk.vetoApplied === true,
            uiLabel: typeof chunk.uiLabel === 'string' ? chunk.uiLabel : undefined,
            uiSummary: typeof chunk.uiSummary === 'string' ? chunk.uiSummary : undefined,
            uiGroup: typeof chunk.uiGroup === 'string' ? chunk.uiGroup : undefined,
            uiGroupLabel: typeof chunk.uiGroupLabel === 'string' ? chunk.uiGroupLabel : undefined,
            uiVisibility: chunk.uiVisibility === 'activity' || chunk.uiVisibility === 'grouped' || chunk.uiVisibility === 'debug'
              ? chunk.uiVisibility
              : undefined,
          })
          return
        }

        if (chunk.type === 'file_context') {
          const content = typeof chunk.content === 'string' ? chunk.content.trim() : ''
          if (content) {
            set((s) => ({
              activeFileContext: content,
              messages: s.messages.map((m) => {
                if (m.id !== userMsg.id || !m.file || m.file.previewText || !isJsonPreviewableFileName(m.file.name)) {
                  return m
                }
                return {
                  ...m,
                  file: {
                    ...m.file,
                    previewText: content,
                  },
                }
              }),
            }))
          }
          return
        }

        if (chunk.type === 'run_context') {
          const runId = typeof chunk.runId === 'string' ? chunk.runId.trim() : ''
          if (runId) {
            useMapStore.getState().setCurrentRunId(runId)
          }
          return
        }

        if (chunk.type === 'text') {
          // 第一个 text chunk 时创建 assistant 消息
          ensureAssistantMessage()
          textContent += chunk.content
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: textContent } : m,
            ),
          }))
        } else if (chunk.type === 'code_diff') {
          useMapStore.getState().setLastFixDiff(chunk.data as CodeDiffPayload)
          useMapStore.getState().setCodeViewMode('diff')
          useWorkspaceStore.getState().setShowCode(true)
        } else if (chunk.type === 'code_start') {
          if (receivedCode) return
          // 代码开始生成 → 立即展开代码面板，开始流式显示
          useMapStore.getState().startCodeStream()
          useWorkspaceStore.getState().setShowCode(true)
        } else if (chunk.type === 'code_reset') {
          if (receivedCode) return
          const mapState = useMapStore.getState()
          if (previewCommitted || mapState.previewCode) {
            return
          }
          useMapStore.getState().resetCodeStream()
          useWorkspaceStore.getState().setShowCode(true)
        } else if (chunk.type === 'code_delta') {
          if (receivedCode) return
          // 代码增量 → 追加到流式代码缓冲
          receivedCodeDelta = true
          const mapState = useMapStore.getState()
          if (previewCommitted || mapState.previewCode) {
            return
          }
          useMapStore.getState().appendCodeDelta(String(chunk.content || ''))
          const updatedStreamingCode = useMapStore.getState().streamingCode || ''
          const previewCode = extractRenderableHtml(updatedStreamingCode)
          if (previewCode) {
            useMapStore.getState().commitPreviewCode(previewCode)
            set({ error: null })
            previewCommitted = true
          }
        } else if (chunk.type === 'code') {
          if (receivedCode) return
          receivedCode = true
          const code = String(chunk.content || '')
          const mapState = useMapStore.getState()
          const extractedFinalCode = extractRenderableHtml(code)
          const finalCode = mapState.previewCode
            || extractedFinalCode
            || injectTiandituTokenPlaceholders(code)
          // 收到完整代码 → 结束流式，渲染地图
          ensureAssistantMessage()
          // 更新消息的 code 字段，并标记流式结束
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, code: finalCode, streaming: false } : m,
            ),
          }))
          // 完成流式：设置最终代码并渲染地图
          useMapStore.getState().finishCodeStream(finalCode)
          set({ error: null })
        } else if (chunk.type === 'error') {
          const mapState = useMapStore.getState()
          const recoveredHtml = mapState.previewCode
            || extractRenderableHtml(mapState.streamingCode)
            || extractRenderableHtml(mapState.currentCode)

          // 如果已经有一份可运行的完整 HTML，就不要再把通用“不完整”错误展示给用户
          if (recoveredHtml) {
            return
          }

          set({ error: chunk.content })
        }
      } catch {
        // 忽略无效 JSON
      }
    }

    /** 流结束后清理状态 */
    const finalize = () => {
      // 兜底：如果服务端只返回了 code_delta 没有最终 code，则优先使用已预渲染代码收尾
      const mapState = useMapStore.getState()
      if (!receivedCode && receivedCodeDelta) {
        const previewCode = mapState.previewCode
        if (previewCode) {
          useMapStore.getState().finishCodeStream(previewCode)
          ensureAssistantMessage()
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    code: previewCode,
                    content: textContent,
                    streaming: false,
                  }
                : m,
            ),
          }))
          set({ error: null })
          receivedCode = true
        } else {
          const recoveredHtml = extractRenderableHtml(mapState.streamingCode)
          if (recoveredHtml) {
            useMapStore.getState().finishCodeStream(recoveredHtml)
            ensureAssistantMessage()
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      code: recoveredHtml,
                      content: `${textContent}\n\n[系统提示] 模型输出在代码中途结束，已自动使用当前代码收尾。`,
                      streaming: false,
                    }
                  : m,
              ),
            }))
            set({ error: null })
            receivedCode = true
          }
        }
      }

      // 没拿到最终代码且没有可恢复代码时，兜底关闭代码流状态，避免 UI 一直“生成中”
      const latestMapState = useMapStore.getState()
      if (!receivedCode && latestMapState.codeStreaming) {
        useMapStore.setState({
          previewCode: null,
          codeStreaming: false,
          streamingCode: null,
        })
      }

      if (assistantCreated) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        }))
      }
      set({ loading: false })
    }

    try {
      const formData = new FormData()
      formData.append('message', content)
      if (file) formData.append('file', file)
      if (existingCode) formData.append('existingCodePayload', encodeTextBase64(existingCode))
      if (history) formData.append('conversationHistoryPayload', encodeTextBase64(history))
      if (sampleId) {
        formData.append('sampleId', sampleId)
      } else if (!file && activeFileContext) {
        formData.append('fileContext', activeFileContext)
      }
      const response = await fetch(withBasePath('/api/chat/stream'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            processLine(line)
          }
        }

        // 处理 buffer 中剩余内容
        if (buffer.trim()) {
          processLine(buffer)
        }
      } catch (streamErr: any) {
        // "Premature close" 或网络中断 — 如果已经收到了内容，则静默处理
        if (assistantCreated && (textContent || receivedCode)) {
          console.warn('[SSE] 流意外关闭，但已有内容，继续显示:', streamErr.message)
        } else {
          throw streamErr
        }
      }

      finalize()
    } catch (err: any) {
      // 如果已经部分接收了数据，只 finalize 不报错
      if (assistantCreated && (textContent || receivedCode)) {
        console.warn('[SSE] 请求出错，但已有部分数据:', err.message)
        finalize()
      } else {
        set({ loading: false, error: err.message || '请求失败' })
      }
    }
  },

  autoFixMapError: async (options) => {
    const mapState = useMapStore.getState()
    const {
      currentCode,
      execError,
      fixing,
      fixRetryCount,
      visualFixRetryCount,
    } = mapState

    const source = options?.source === 'visual' ? 'visual' : 'runtime'
    const MAX_RUNTIME_FIX_RETRIES = 2
    const MAX_VISUAL_FIX_RETRIES = 2
    const VISUAL_FIX_TIMEOUT_MS = 30000
    const maxRetries = source === 'visual' ? MAX_VISUAL_FIX_RETRIES : MAX_RUNTIME_FIX_RETRIES
    const currentRetryCount = source === 'visual' ? visualFixRetryCount : fixRetryCount
    const effectiveError = (options?.overrideError || execError || '').trim()
    const currentCodeHash = currentCode ? hashCode(currentCode) : null

    if (fixing || !currentCode || !effectiveError || currentRetryCount >= maxRetries) return

    const attempt = currentRetryCount + 1
    const parentRunId = useMapStore.getState().currentRunId || undefined
    const assistantId = createId()
    let assistantCreated = false
    let receivedCode = false
    let previewCommitted = false
    let explanationStarted = false
    let textContent = ''
    let streamedFixCode = ''
    const extractRenderableHtml = (code: string | null | undefined) => {
      const html = extractFirstCompleteHtmlDocument(code)
      return html ? injectTiandituTokenPlaceholders(html) : ''
    }

    const ensureAssistantMessage = () => {
      if (assistantCreated) return
      assistantCreated = true
      const prefix = [
        source === 'visual'
          ? `检测到视觉检查异常，正在自动修复（第 ${attempt}/${maxRetries} 次）。`
          : `检测到地图运行错误，正在自动修复（第 ${attempt}/${maxRetries} 次）。`,
        '',
        '错误信息：',
        '```text',
        effectiveError,
        '```',
      ].join('\n')
      textContent = prefix

      set((s) => ({
        messages: [...s.messages, {
          id: assistantId,
          role: 'assistant',
          content: prefix,
          timestamp: Date.now(),
          streaming: true,
          thoughtChain: [],
        }],
      }))
    }

    const upsertThoughtChainItem = (patch: Partial<ThoughtChainItem> & Pick<ThoughtChainItem, 'toolCallId' | 'toolName'>) => {
      ensureAssistantMessage()
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== assistantId) return m
          const chain = [...(m.thoughtChain || [])]
          const idx = chain.findIndex((item) => item.toolCallId === patch.toolCallId)
          if (idx === -1) {
            chain.push({
              toolCallId: patch.toolCallId,
              toolName: patch.toolName,
              status: patch.status || 'running',
              args: patch.args,
              result: patch.result,
              isError: patch.isError,
              startedAt: patch.startedAt,
              endedAt: patch.endedAt,
              decisionSource: patch.decisionSource,
              selectedPackages: patch.selectedPackages,
              selectedReferences: patch.selectedReferences,
              selectedContracts: patch.selectedContracts,
              fallbackReason: patch.fallbackReason,
              vetoApplied: patch.vetoApplied,
              uiLabel: patch.uiLabel,
              uiSummary: patch.uiSummary,
              uiGroup: patch.uiGroup,
              uiGroupLabel: patch.uiGroupLabel,
              uiVisibility: patch.uiVisibility,
            })
          } else {
            chain[idx] = { ...chain[idx], ...patch }
          }
          return { ...m, thoughtChain: chain }
        }),
      }))
    }

    const appendText = (delta: string) => {
      ensureAssistantMessage()
      if (!delta) return
      if (!explanationStarted) {
        textContent += '\n\n修复分析：\n'
        explanationStarted = true
      }
      textContent += delta
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, content: textContent } : m,
        ),
      }))
    }

    const finalizeMessage = () => {
      if (!assistantCreated) return
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      }))
    }

    useMapStore.setState({ fixing: true, fixingSource: source })
    useMapStore.getState().setLastFixDiff(null)
    useMapStore.getState().setCodeViewMode('code')
    console.log(`[AutoFixStream][${source}] 第 ${attempt} 次修复尝试:`, effectiveError)

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timeoutId = source === 'visual' && controller
      ? window.setTimeout(() => {
          controller.abort(new DOMException('视觉补修超时', 'AbortError'))
        }, VISUAL_FIX_TIMEOUT_MS)
      : null

    try {
      const response = await fetch(withBasePath('/api/chat/fix/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal,
        body: JSON.stringify({
          codePayload: encodeTextBase64(currentCode),
          errorPayload: encodeTextBase64(effectiveError),
          userInput: options?.userInputHint || '',
          fileContext: get().activeFileContext || undefined,
          parentRunId,
          source,
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return
        const data = line.slice(6)
        if (data === '[DONE]') return

        try {
          const chunk = JSON.parse(data) as Record<string, any>

          if (chunk.type === 'tool_execution_start') {
            upsertThoughtChainItem({
              toolCallId: String(chunk.toolCallId || ''),
              toolName: String(chunk.toolName || 'unknown'),
              args: chunk.args,
              status: 'running',
              startedAt: typeof chunk.startedAtMs === 'number' ? chunk.startedAtMs : Date.now(),
              uiLabel: typeof chunk.uiLabel === 'string' ? chunk.uiLabel : undefined,
              uiSummary: typeof chunk.uiSummary === 'string' ? chunk.uiSummary : undefined,
              uiGroup: typeof chunk.uiGroup === 'string' ? chunk.uiGroup : undefined,
              uiGroupLabel: typeof chunk.uiGroupLabel === 'string' ? chunk.uiGroupLabel : undefined,
              uiVisibility: chunk.uiVisibility === 'activity' || chunk.uiVisibility === 'grouped' || chunk.uiVisibility === 'debug'
                ? chunk.uiVisibility
                : undefined,
            })
            return
          }

          if (chunk.type === 'run_context') {
            const runId = typeof chunk.runId === 'string' ? chunk.runId.trim() : ''
            if (runId) {
              useMapStore.getState().setCurrentRunId(runId)
            }
            return
          }

          if (chunk.type === 'tool_execution_end') {
            upsertThoughtChainItem({
              toolCallId: String(chunk.toolCallId || ''),
              toolName: String(chunk.toolName || 'unknown'),
              result: chunk.result,
              isError: !!chunk.isError,
              status: chunk.isError ? 'error' : 'done',
              endedAt: typeof chunk.endedAtMs === 'number' ? chunk.endedAtMs : Date.now(),
              decisionSource: typeof chunk.decisionSource === 'string' ? chunk.decisionSource : undefined,
              selectedPackages: Array.isArray(chunk.selectedPackages) ? chunk.selectedPackages : undefined,
              selectedReferences: Array.isArray(chunk.selectedReferences) ? chunk.selectedReferences : undefined,
              selectedContracts: Array.isArray(chunk.selectedContracts) ? chunk.selectedContracts : undefined,
              fallbackReason: typeof chunk.fallbackReason === 'string' ? chunk.fallbackReason : undefined,
              vetoApplied: chunk.vetoApplied === true,
              uiLabel: typeof chunk.uiLabel === 'string' ? chunk.uiLabel : undefined,
              uiSummary: typeof chunk.uiSummary === 'string' ? chunk.uiSummary : undefined,
              uiGroup: typeof chunk.uiGroup === 'string' ? chunk.uiGroup : undefined,
              uiGroupLabel: typeof chunk.uiGroupLabel === 'string' ? chunk.uiGroupLabel : undefined,
              uiVisibility: chunk.uiVisibility === 'activity' || chunk.uiVisibility === 'grouped' || chunk.uiVisibility === 'debug'
                ? chunk.uiVisibility
                : undefined,
            })
            return
          }

          if (chunk.type === 'text') {
            appendText(String(chunk.content || ''))
            return
          }

          if (chunk.type === 'code_diff') {
            useMapStore.getState().setLastFixDiff(chunk.data as CodeDiffPayload)
            useMapStore.getState().setCodeViewMode('diff')
            useWorkspaceStore.getState().setShowCode(true)
            return
          }

          if (chunk.type === 'code_start') {
            if (receivedCode) return
            useMapStore.getState().startCodeStream()
            useWorkspaceStore.getState().setShowCode(true)
            return
          }

          if (chunk.type === 'code_reset') {
            if (receivedCode) return
            streamedFixCode = ''
            const nextMapState = useMapStore.getState()
            if (previewCommitted || nextMapState.previewCode) {
              return
            }
            useMapStore.getState().resetCodeStream()
            useWorkspaceStore.getState().setShowCode(true)
            return
          }

          if (chunk.type === 'code_delta') {
            if (receivedCode) return
            streamedFixCode += String(chunk.content || '')
            const nextMapState = useMapStore.getState()
            if (previewCommitted || nextMapState.previewCode) {
              return
            }
            useMapStore.getState().appendCodeDelta(String(chunk.content || ''))
            const updatedStreamingCode = useMapStore.getState().streamingCode || ''
            const previewCode = extractRenderableHtml(updatedStreamingCode)
            if (previewCode) {
              useMapStore.getState().commitPreviewCode(previewCode)
              previewCommitted = true
            }
            return
          }

          if (chunk.type === 'code') {
            if (receivedCode) return
            ensureAssistantMessage()
            receivedCode = true
            const code = String(chunk.content || '')
            const nextMapState = useMapStore.getState()
            const extractedFinalCode = extractRenderableHtml(code)
            const finalCode = nextMapState.previewCode
              || extractedFinalCode
              || injectTiandituTokenPlaceholders(extractFirstCompleteHtmlDocument(code) || code)
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId ? { ...m, code: finalCode, streaming: false } : m,
              ),
            }))
            // 修复成功后直接替换代码并清空 execError；计数递增防止连续无限重试
            useMapStore.setState({
              currentCode: finalCode,
              previewCode: null,
              streamingCode: null,
              codeStreaming: false,
              execError: null,
              fixing: false,
              fixingSource: null,
              shareThumbnailBase64: null,
              ...(source === 'visual'
                ? { lastVisualCheckedCodeHash: null }
                : { visualFixRetryCount: 0, lastVisualCheckedCodeHash: null }),
              ...(source === 'visual'
                ? { visualFixRetryCount: attempt }
                : { fixRetryCount: attempt }),
            })
            return
          }

          if (chunk.type === 'error') {
            appendText(`\n\n修复失败：${String(chunk.content || '')}`)
            set({ error: String(chunk.content || '自动修复失败') })
          }
        } catch {
          // ignore invalid json
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) processLine(line)
      }
      if (buffer.trim()) processLine(buffer)

      if (!receivedCode) {
        const latestMapState = useMapStore.getState()
        const recoveredFixCode = latestMapState.previewCode
          || extractRenderableHtml(latestMapState.streamingCode)
          || injectTiandituTokenPlaceholders(extractFirstCompleteHtmlDocument(streamedFixCode) || '')
        if (recoveredFixCode) {
          receivedCode = true
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, code: recoveredFixCode, streaming: false } : m,
            ),
          }))
          useMapStore.setState({
            currentCode: recoveredFixCode,
            previewCode: null,
            streamingCode: null,
            codeStreaming: false,
            execError: null,
            fixing: false,
            fixingSource: null,
            shareThumbnailBase64: null,
            ...(source === 'visual'
              ? { lastVisualCheckedCodeHash: null }
              : { visualFixRetryCount: 0, lastVisualCheckedCodeHash: null }),
            ...(source === 'visual'
              ? { visualFixRetryCount: attempt }
              : { fixRetryCount: attempt }),
          })
          appendText('\n\n修复输出未显式返回最终 code 事件，已自动提取完整 HTML 并应用。')
        } else if (streamedFixCode.trim()) {
          appendText('\n\n检测到修复输出在代码中途结束，本轮未自动应用截断代码。')
        }
        useMapStore.setState({
          previewCode: null,
          fixing: false,
          fixingSource: null,
          codeStreaming: false,
          streamingCode: null,
          ...(source === 'visual'
            ? { lastVisualCheckedCodeHash: currentCodeHash }
            : {}),
          ...(source === 'visual'
            ? { visualFixRetryCount: attempt }
            : { fixRetryCount: attempt }),
        })
      }
      finalizeMessage()
    } catch (err: any) {
      console.error('[AutoFixStream] 请求错误:', err.message)
      ensureAssistantMessage()
      const isAbort = err?.name === 'AbortError'
      appendText(`\n\n${isAbort
        ? '视觉补修超时：服务繁忙或排队过久，系统已结束本轮自动补修并恢复输入。'
        : `修复请求失败：${err.message || '未知错误'}`}`)
      useMapStore.setState({
        previewCode: null,
        fixing: false,
        fixingSource: null,
        codeStreaming: false,
        streamingCode: null,
        ...(source === 'visual'
          ? { lastVisualCheckedCodeHash: currentCodeHash }
          : {}),
        ...(source === 'visual'
          ? { visualFixRetryCount: attempt }
          : { fixRetryCount: attempt }),
      })
      finalizeMessage()
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  },

  addAssistantMessage: (content) => {
    const text = String(content || '').trim()
    if (!text) return
    set((s) => ({
      messages: [...s.messages, {
        id: createId(),
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
      }],
    }))
  },

  clearMessages: () => {
    useMapStore.setState({
      currentRunId: null,
      execError: null,
      fixing: false,
      fixingSource: null,
      visualChecking: false,
      visualBlocking: false,
      visualCheckingOwner: null,
    })
    set({ messages: [], error: null, activeFileContext: null, loading: false })
  },
}))
