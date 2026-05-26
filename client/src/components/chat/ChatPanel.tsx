import { useEffect } from 'react'
import { useChatStore } from '../../stores/useChatStore'
import { useMapStore } from '../../stores/useMapStore'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { WorkspaceExampleGallery } from './WorkspaceExampleGallery'
import { useTiandituTokenStore } from '../../stores/useTiandituTokenStore'
import { withBasePath } from '../../utils/basePath'

export function ChatPanel() {
  const { messages, loading, error, sendMessage } = useChatStore()
  const { visualChecking, visualCheckingOwner, fixing, fixingSource } = useMapStore()
  const { hasToken, openModal } = useTiandituTokenStore()
  const scrollRef = useAutoScroll([messages])
  const handleSend = (content: string, file?: File, filePreviewText?: string | null) => {
    void sendMessage(content, file, undefined, undefined, filePreviewText)
  }
  const inputLocked = !hasToken || visualChecking || (fixing && fixingSource === 'visual')
  const inputLockReason = !hasToken
    ? '请先在右上角用户菜单中输入并校验天地图 tk'
    : (fixing && fixingSource === 'visual') || visualCheckingOwner === 'repair'
    ? 'AI 正在处理视觉补修，请稍候后再发送消息'
    : (visualChecking
        ? 'AI 正在进行视觉检查，请稍候后再发送消息'
        : null)

  // 判断是否在 "等待响应"（loading 但还没创建 assistant 消息）
  const lastMsg = messages[messages.length - 1]
  const isWaiting = loading && (!lastMsg || lastMsg.role === 'user')

  useEffect(() => {
    if (messages.length === 0 && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [messages.length, scrollRef])

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <WorkspaceExampleGallery
            disabled={loading || inputLocked}
            onSelectExample={(prompt, sampleId) => {
              void sendMessage(prompt, undefined, undefined, sampleId)
            }}
          />
        ) : (
          /* 消息列表 */
          <div className="px-4 py-5 space-y-1">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} msg={msg} />
            ))}

            {/* 思考中指示器 */}
            {isWaiting && (
              <div className="flex items-start gap-2.5 mb-3 animate-msg-in">
                <div className="w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-slate-900/10">
                  <img src={withBasePath('/assets/assistant-avatar.png')} alt="" className="h-5 w-5" />
                </div>
                <div className="bg-gray-50 rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full thinking-dot" />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full thinking-dot" />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full thinking-dot" />
                  </div>
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="animate-msg-in ml-9">
                <div className="flex max-w-full items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-500">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div className="min-w-0 whitespace-pre-wrap break-all leading-5">
                    {error}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      {!hasToken && (
        <div className="border-t border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-700">
          <button
            type="button"
            onClick={openModal}
            className="font-semibold underline decoration-blue-300 underline-offset-4 hover:text-blue-800"
          >
            输入天地图 tk
          </button>
          <span className="ml-2 text-blue-600/80">后即可开始创建地图。</span>
        </div>
      )}
      <ChatInput
        onSend={handleSend}
        loading={loading}
        disabled={inputLocked}
        disabledReason={inputLockReason}
      />
    </div>
  )
}
