import { create } from 'zustand'
import type { CodeDiffPayload } from '../types/codeDiff'
import { withBasePath } from '../utils/basePath'
import { encodeTextBase64 } from '../utils/transportEncoding'

interface MapStore {
  currentRunId: string | null
  currentCode: string | null
  /** 首份可运行 HTML 的预渲染代码 */
  previewCode: string | null
  /** 正在流式生成中的代码（逐步拼接） */
  streamingCode: string | null
  /** 是否正在流式生成代码 */
  codeStreaming: boolean
  executing: boolean
  execError: string | null
  fixing: boolean
  fixingSource: 'runtime' | 'visual' | null
  lastFixDiff: CodeDiffPayload | null
  codeViewMode: 'code' | 'diff'
  fixRetryCount: number
  visualChecking: boolean
  visualBlocking: boolean
  visualCheckingOwner: 'inspection' | 'repair' | null
  visualFixRetryCount: number
  lastVisualCheckedCodeHash: string | null
  shareThumbnailBase64: string | null
  setCode: (code: string | null) => void
  /** 开始代码流式生成 */
  startCodeStream: () => void
  /** 重置当前代码流缓冲 */
  resetCodeStream: () => void
  /** 追加代码增量 */
  appendCodeDelta: (delta: string) => void
  /** 提交首份完整 HTML 作为预渲染代码 */
  commitPreviewCode: (code: string) => void
  /** 结束代码流式生成（用完整代码替换） */
  finishCodeStream: (finalCode: string) => void
  setExecError: (error: string | null) => void
  setExecuting: (v: boolean) => void
  setVisualChecking: (v: boolean, owner?: 'inspection' | 'repair' | null) => void
  setVisualBlocking: (v: boolean) => void
  markVisualChecked: (hash: string | null) => void
  setShareThumbnailBase64: (base64: string | null) => void
  setCurrentRunId: (runId: string | null) => void
  setLastFixDiff: (diff: CodeDiffPayload | null) => void
  setCodeViewMode: (mode: 'code' | 'diff') => void
  autoFix: (userInput?: string) => Promise<void>
}

const MAX_FIX_RETRIES = 2

export const useMapStore = create<MapStore>((set, get) => ({
  currentRunId: null,
  currentCode: null,
  previewCode: null,
  streamingCode: null,
  codeStreaming: false,
  executing: false,
  execError: null,
  fixing: false,
  fixingSource: null,
  lastFixDiff: null,
  codeViewMode: 'code',
  fixRetryCount: 0,
  visualChecking: false,
  visualBlocking: false,
  visualCheckingOwner: null,
  visualFixRetryCount: 0,
  lastVisualCheckedCodeHash: null,
  shareThumbnailBase64: null,

  setCode: (code) => set({
    currentCode: code,
    previewCode: null,
    streamingCode: null,
    codeStreaming: false,
    execError: null,
    fixRetryCount: 0,
    fixingSource: null,
    lastFixDiff: null,
    codeViewMode: 'code',
    visualChecking: false,
    visualBlocking: false,
    visualCheckingOwner: null,
    visualFixRetryCount: 0,
    lastVisualCheckedCodeHash: null,
    shareThumbnailBase64: null,
  }),

  startCodeStream: () => set({
    previewCode: null,
    streamingCode: '',
    codeStreaming: true,
    execError: null,
    lastFixDiff: null,
    codeViewMode: 'code',
    visualChecking: false,
    visualBlocking: false,
    visualCheckingOwner: null,
    shareThumbnailBase64: null,
  }),

  resetCodeStream: () => set((s) => ({
    previewCode: s.previewCode,
    streamingCode: '',
    codeStreaming: true,
  })),

  appendCodeDelta: (delta) => set((s) => ({
    streamingCode: (s.streamingCode || '') + delta,
  })),

  commitPreviewCode: (code) => set({
    previewCode: code,
    execError: null,
    shareThumbnailBase64: null,
  }),

  finishCodeStream: (finalCode) => set({
    currentCode: finalCode,
    previewCode: null,
    streamingCode: null,
    codeStreaming: false,
    execError: null,
    fixRetryCount: 0,
    fixingSource: null,
    lastFixDiff: null,
    codeViewMode: 'code',
    visualChecking: false,
    visualBlocking: false,
    visualCheckingOwner: null,
    visualFixRetryCount: 0,
    lastVisualCheckedCodeHash: null,
    shareThumbnailBase64: null,
  }),

  setExecError: (error) => set({ execError: error }),
  setExecuting: (v) => set({ executing: v }),
  setVisualChecking: (v, owner = null) => set({
    visualChecking: v,
    visualCheckingOwner: v ? (owner || 'inspection') : null,
    visualBlocking: v ? true : false,
  }),
  setVisualBlocking: (v) => set({ visualBlocking: v }),
  markVisualChecked: (hash) => set({ lastVisualCheckedCodeHash: hash }),
  setShareThumbnailBase64: (base64) => set({ shareThumbnailBase64: base64 }),
  setCurrentRunId: (runId) => set({ currentRunId: runId }),
  setLastFixDiff: (diff) => set({ lastFixDiff: diff }),
  setCodeViewMode: (mode) => set({ codeViewMode: mode }),

  autoFix: async (userInput?: string) => {
    const { currentCode, execError, fixRetryCount, fixing } = get()

    // 防止重复修复、超过重试次数、无代码/无错误
    if (fixing || !currentCode || !execError || fixRetryCount >= MAX_FIX_RETRIES) return

    set({ fixing: true, fixingSource: 'runtime', lastFixDiff: null, codeViewMode: 'code' })
    console.log(`[AutoFix] 第 ${fixRetryCount + 1} 次修复尝试:`, execError)

    try {
      const res = await fetch(withBasePath('/api/chat/fix'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codePayload: encodeTextBase64(currentCode),
          errorPayload: encodeTextBase64(execError),
          userInput: userInput || '',
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = await res.json()
      if (json.success && json.data?.code && json.data?.fixed) {
        console.log('[AutoFix] 修复成功')
        // 设置修复后的代码，会触发 MapPreview 重新渲染
        set({
          currentCode: json.data.code,
          previewCode: null,
          execError: null,
          fixing: false,
          fixingSource: null,
          visualBlocking: false,
          visualCheckingOwner: null,
          lastFixDiff: json.data?.diff || null,
          codeViewMode: json.data?.diff ? 'diff' : 'code',
          fixRetryCount: fixRetryCount + 1,
          shareThumbnailBase64: null,
        })
      } else {
        console.log('[AutoFix] 修复失败:', json.data?.explanation)
        set({ fixing: false, fixingSource: null, visualBlocking: false, visualCheckingOwner: null, fixRetryCount: fixRetryCount + 1 })
      }
    } catch (err: any) {
      console.error('[AutoFix] 请求错误:', err.message)
      set({ fixing: false, fixingSource: null, visualBlocking: false, visualCheckingOwner: null, fixRetryCount: fixRetryCount + 1 })
    }
  },
}))
