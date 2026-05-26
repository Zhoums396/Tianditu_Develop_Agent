import { useState, type ReactNode } from 'react'
import type { Message } from '../../types/chat'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useChatStore } from '../../stores/useChatStore'
import { ThoughtChain } from './ThoughtChain'
import { JsonPreviewModal } from '../common/JsonPreviewModal'
import { isJsonPreviewableFileName } from '../../utils/jsonPreview'
import { withBasePath } from '../../utils/basePath'

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative group my-2.5 rounded-xl overflow-hidden text-[13px] shadow-sm">
      <div className="flex items-center justify-between bg-[#21252b] px-3.5 py-1.5 text-[11px] text-gray-500">
        <span className="font-mono">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 transition-colors group-hover:opacity-100 text-gray-500 hover:text-gray-300"
        >
          {copied ? (
            <span className="flex items-center gap-1 text-green-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              copied
            </span>
          ) : 'copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', padding: '14px 16px' }}
        wrapLongLines
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

const mdComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const codeStr = String(children).replace(/\n$/, '')

    if (match || codeStr.includes('\n')) {
      return <CodeBlock language={match?.[1] || ''} children={codeStr} />
    }

    return (
      <code className="bg-blue-50/80 text-blue-700 px-1.5 py-0.5 rounded-md text-[12.5px] font-mono" {...props}>
        {children}
      </code>
    )
  },
  p({ children }: { children?: ReactNode }) {
    return <p className="my-1.5 leading-relaxed">{children}</p>
  },
  table({ children }: { children?: ReactNode }) {
    return (
      <div className="overflow-x-auto my-2.5 rounded-lg border border-gray-200/80">
        <table className="min-w-full text-[12px] border-collapse">{children}</table>
      </div>
    )
  },
  th({ children }: { children?: ReactNode }) {
    return <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-medium text-gray-700">{children}</th>
  },
  td({ children }: { children?: ReactNode }) {
    return <td className="border-b border-gray-100/80 px-3 py-2 text-gray-600">{children}</td>
  },
  ul({ children }: { children?: ReactNode }) {
    return <ul className="list-disc pl-5 my-1.5 space-y-0.5 marker:text-gray-300">{children}</ul>
  },
  ol({ children }: { children?: ReactNode }) {
    return <ol className="list-decimal pl-5 my-1.5 space-y-0.5 marker:text-gray-400">{children}</ol>
  },
  li({ children }: { children?: ReactNode }) {
    return <li className="leading-relaxed">{children}</li>
  },
  strong({ children }: { children?: ReactNode }) {
    return <strong className="font-semibold text-gray-900">{children}</strong>
  },
  h1({ children }: { children?: ReactNode }) {
    return <h1 className="text-[15px] font-bold text-gray-900 mt-4 mb-2 pb-1.5 border-b border-gray-100">{children}</h1>
  },
  h2({ children }: { children?: ReactNode }) {
    return <h2 className="text-[14px] font-semibold text-gray-800 mt-3 mb-1.5">{children}</h2>
  },
  h3({ children }: { children?: ReactNode }) {
    return <h3 className="text-[13.5px] font-medium text-gray-700 mt-2.5 mb-1">{children}</h3>
  },
  blockquote({ children }: { children?: ReactNode }) {
    return <blockquote className="border-l-[3px] border-blue-300 pl-3 my-2 text-gray-500 italic">{children}</blockquote>
  },
  hr() {
    return <hr className="my-3 border-gray-100" />
  },
}

export function ChatMessage({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const [previewOpen, setPreviewOpen] = useState(false)
  const activeFileContext = useChatStore((state) => state.activeFileContext)
  const latestUserFileMessageId = useChatStore((state) => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const current = state.messages[index]
      if (current.role === 'user' && current.file && isJsonPreviewableFileName(current.file.name)) {
        return current.id
      }
    }
    return null
  })
  const previewableFile = !!msg.file && isJsonPreviewableFileName(msg.file.name)
  const effectivePreviewText = msg.file?.previewText
    || (previewableFile && msg.id === latestUserFileMessageId ? activeFileContext || undefined : undefined)
  const canPreviewJson = previewableFile

  const renderFileBadge = (tone: 'user' | 'assistant') => {
    if (!msg.file) return null

    if (!canPreviewJson) {
      return (
        <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] ${tone === 'user' ? 'text-blue-100/85' : 'text-slate-500'}`}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32" />
          </svg>
          <span>{msg.file.name}</span>
          <span className="opacity-60">({(msg.file.size / 1024).toFixed(1)}KB)</span>
        </div>
      )
    }

    if (tone === 'user') {
      return (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="mb-2 flex w-full max-w-full items-center gap-3 rounded-2xl border border-white/14 bg-white/12 px-3 py-2 text-[11px] text-blue-50 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white"
          title="点击预览 JSON 文件"
        >
          <div className="min-w-0 flex flex-1 items-center gap-2">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32" />
            </svg>
            <span className="truncate underline decoration-white/35 underline-offset-2">{msg.file.name}</span>
            <span className="shrink-0 text-white/60">({(msg.file.size / 1024).toFixed(1)}KB)</span>
          </div>
          <span className="ml-auto shrink-0 rounded-full border border-white/18 bg-white/14 px-2.5 py-1 text-[10px] font-medium tracking-[0.02em] text-white/90">
            预览
          </span>
        </button>
      )
    }

    return (
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100"
        title="点击预览 JSON 文件"
      >
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12Z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5Z" />
        </svg>
        <span className="truncate">{msg.file.name}</span>
        <span className="shrink-0 opacity-65">({(msg.file.size / 1024).toFixed(1)}KB)</span>
        <span className="shrink-0 opacity-90">预览</span>
      </button>
    )
  }

  if (isUser) {
    return (
      <>
        <div className="flex justify-end mb-3 animate-msg-in">
          <div className="max-w-[85%] bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl rounded-tr-md px-4 py-2.5 shadow-sm shadow-blue-500/10">
            {renderFileBadge('user')}
            <p className="text-[13.5px] leading-relaxed m-0">{msg.content}</p>
          </div>
        </div>
        <JsonPreviewModal
          open={previewOpen}
          title={msg.file?.name || 'JSON 文件'}
          size={msg.file?.size}
          jsonText={effectivePreviewText || null}
          onClose={() => setPreviewOpen(false)}
        />
      </>
    )
  }

  // Assistant message — 无背景气泡，直接渲染，类似 ChatGPT 风格
  return (
    <>
      <div className="flex items-start gap-2.5 mb-4 animate-msg-in">
        {/* 助手头像 */}
        <div className="w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-slate-900/10">
          <img src={withBasePath('/assets/assistant-avatar.png')} alt="" className="h-5 w-5" />
        </div>

        {/* 消息内容 */}
        <div className={`min-w-0 flex-1 text-gray-700 ${msg.streaming ? 'typing-cursor' : ''}`}>
          {msg.thoughtChain && msg.thoughtChain.length > 0 && (
            <ThoughtChain items={msg.thoughtChain} streaming={msg.streaming} />
          )}
          {renderFileBadge('assistant')}
          <div className="text-[13.5px] leading-[1.7] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
          </div>
        </div>
      </div>
      <JsonPreviewModal
        open={previewOpen}
        title={msg.file?.name || 'JSON 文件'}
        size={msg.file?.size}
        jsonText={effectivePreviewText || null}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  )
}
