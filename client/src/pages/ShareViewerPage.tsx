import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { shareApi } from '../services/shareApi'
import type { ShareItem } from '../types/share'
import { copyText } from '../utils/copyText'
import { installAppFullscreenEnhancer } from '../utils/appFullscreenEnhancer'

type ShareDetail = ShareItem & { shareUrl: string }

function formatTime(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function ShareViewerPage() {
  const { slug = '' } = useParams()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const previewShellRef = useRef<HTMLElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [item, setItem] = useState<ShareDetail | null>(null)
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const [shareInfoOpen, setShareInfoOpen] = useState(true)

  const load = async (track = true) => {
    if (!slug) {
      setLoading(false)
      setError('分享链接不完整，缺少 slug')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const detail = await shareApi.getDetail(slug, { track })
      setItem(detail)
    } catch (err: any) {
      setError(err?.message || '加载分享失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(true)
  }, [slug])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || item?.status !== 'active') return

    let cleanup = () => {}

    const installEnhancer = () => {
      cleanup()
      cleanup = installAppFullscreenEnhancer(iframe.contentDocument, { showButton: false })
    }

    iframe.addEventListener('load', installEnhancer)
    installEnhancer()

    return () => {
      iframe.removeEventListener('load', installEnhancer)
      cleanup()
    }
  }, [item?.htmlUrl, item?.status])

  const metaItems = useMemo(() => {
    if (!item) return []
    return [
      { label: '可见性', value: item.visibility === 'public' ? '公开样例' : '未公开链接' },
      { label: '浏览次数', value: `${item.viewCount}` },
      { label: '创建时间', value: formatTime(item.createdAt) },
      { label: '更新时间', value: formatTime(item.updatedAt) },
      { label: '代码大小', value: `${Math.round(item.codeSizeBytes / 1024)} KB` },
    ]
  }, [item])

  const withCopyHint = async (text: string, okMsg: string, failMsg: string) => {
    const result = await copyText(text, {
      manualPromptTitle: '浏览器限制了自动复制，请手动复制以下内容：',
    })
    const hint = result === 'copied'
      ? okMsg
      : result === 'manual'
        ? '已弹出手动复制窗口，请直接复制'
        : failMsg
    setCopyHint(hint)
    setTimeout(() => setCopyHint(null), 2200)
  }

  return (
    <div className="min-h-screen bg-[#eef2f6]">
      <main className="min-h-screen">
        {loading && (
          <div className="m-6 rounded-sm border border-slate-200 bg-white p-6 text-sm text-slate-500">
            正在加载分享内容...
          </div>
        )}

        {!loading && error && (
          <div className="m-6 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && !error && item && (
          <section
              ref={previewShellRef}
            className="relative h-screen min-h-[640px] overflow-hidden bg-slate-100"
            >
              {item.status === 'active' ? (
                <>
                  <iframe
                    ref={iframeRef}
                    key={item.htmlUrl}
                    src={item.htmlUrl}
                    className="absolute inset-0 h-full w-full border-0"
                    sandbox="allow-scripts allow-same-origin"
                    allow="fullscreen"
                    allowFullScreen
                    title="分享地图预览"
                  />

                  <Link
                    to="/gallery"
                    className="absolute left-4 top-4 z-20 flex h-8 w-8 items-center justify-center bg-white/95 text-slate-600 shadow-[0_4px_14px_rgba(15,23,42,0.12)] no-underline hover:text-blue-600"
                    aria-label="返回公开样例"
                    title="返回公开样例"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19 8 12l7-7" />
                    </svg>
                  </Link>

                  {shareInfoOpen && (
                        <aside className="absolute right-3 top-3 z-20 w-[390px] max-w-[calc(100vw-24px)] bg-white shadow-[0_8px_26px_rgba(15,23,42,0.16)]">
                          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div className="min-w-0">
                              <div className="mb-2 inline-flex items-center bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">公开样例</div>
                              <h1 className="text-lg font-semibold leading-7 text-slate-900 line-clamp-2">{item.title}</h1>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShareInfoOpen(false)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              aria-label="关闭分享信息"
                            >
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <div className="px-5 py-4">
                            <p className="text-sm leading-7 text-slate-600">{item.description || '未填写描述'}</p>
                            <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                              {metaItems.map((meta) => (
                                <div key={meta.label} className="flex items-center justify-between gap-4 text-sm">
                                  <span className="text-slate-500">{meta.label}</span>
                                  <span className="text-right text-slate-800">{meta.value}</span>
                                </div>
                              ))}
                              <div className="flex items-center justify-between gap-4 text-sm">
                                <span className="text-slate-500">创建人</span>
                                <span className="text-slate-800">{item.creatorName || '普通用户'}</span>
                              </div>
                            </div>
                            <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                              <span className="text-xs text-slate-400">可复制链接分享当前地图</span>
                              <button
                                onClick={() => withCopyHint(item.shareUrl, '已复制分享链接', '复制失败，请手动复制')}
                                className="border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
                              >
                                复制链接
                              </button>
                            </div>
                          </div>
                          {copyHint && (
                            <div className="mx-5 mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                              {copyHint}
                            </div>
                          )}
                        </aside>
                  )}

                </>
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">
                  该分享已下架
                </div>
              )}
          </section>
        )}
      </main>
    </div>
  )
}
