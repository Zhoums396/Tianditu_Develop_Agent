import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { shareApi } from '../services/shareApi'
import type { ShareItem } from '../types/share'
import { appAsset } from '../utils/basePath'

type PublicSort = 'viewCount' | 'createdAt'

function formatDate(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleDateString('zh-CN', { hour12: false })
}

function getPageItems(page: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1])
  if (page <= 3) {
    pages.add(2)
    pages.add(3)
  }
  if (page >= totalPages - 2) {
    pages.add(totalPages - 1)
    pages.add(totalPages - 2)
  }

  const normalized = Array.from(pages)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b)

  const result: Array<number | 'ellipsis'> = []
  normalized.forEach((value, index) => {
    const previous = normalized[index - 1]
    if (previous && value - previous > 1) result.push('ellipsis')
    result.push(value)
  })
  return result
}

function GalleryThumbnail({ item }: { item: ShareItem }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="aspect-[1.64/1] bg-slate-100 overflow-hidden relative">
      {!failed ? (
        <img
          src={item.thumbnailUrl}
          alt={item.title}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(28deg,transparent_0_44%,rgba(204,132,50,.55)_44.5%_45.5%,transparent_46%),radial-gradient(circle_at_70%_58%,rgba(180,218,188,.9)_0_14%,transparent_15%)] bg-[#e8f0e3]" />
      )}

      <div className="absolute inset-0 ring-1 ring-inset ring-black/5" />
      <div className="absolute inset-0 flex translate-y-3 flex-col justify-end bg-gradient-to-t from-slate-950/82 via-slate-950/36 to-transparent p-5 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="text-base font-semibold leading-6 text-white line-clamp-2">{item.title}</div>
        <div className="mt-2 text-sm leading-6 text-white/82 line-clamp-3">{item.description || '未填写描述'}</div>
      </div>
    </div>
  )
}

export function PublicGalleryPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ShareItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<PublicSort>('viewCount')
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const pageSize = 12

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = useMemo(() => getPageItems(page, totalPages), [page, totalPages])

  const load = async (nextPage: number, nextQuery = query, nextSort = sort) => {
    setLoading(true)
    setError(null)
    try {
      const data = await shareApi.listPublic({ page: nextPage, pageSize, q: nextQuery, sort: nextSort })
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
    } catch (err: any) {
      setError(err?.message || '加载公开样例失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(1, query, sort)
  }, [query, sort])

  const goPrev = () => {
    if (page <= 1) return
    void load(page - 1)
  }

  const goNext = () => {
    if (page >= totalPages) return
    void load(page + 1)
  }

  const goPage = (nextPage: number) => {
    if (nextPage === page || nextPage < 1 || nextPage > totalPages) return
    void load(nextPage)
  }

  const changeSort = (nextSort: PublicSort) => {
    if (nextSort === sort) return
    setSort(nextSort)
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setQuery(searchText.trim())
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="h-16 border-b border-slate-200 bg-white/95 backdrop-blur-sm px-4 sm:px-6">
        <div className="mx-auto flex h-full max-w-[1160px] items-center justify-between">
          <Link to="/" className="flex items-center gap-3 no-underline">
            <img src={appAsset('/tianditu-logo.png')} alt="天地图" className="h-9 object-contain" />
            <img src={appAsset('/tianditu-agent-logo.svg')} alt="天地图开发智能体" className="h-8 sm:h-9 w-auto object-contain hidden sm:block" />
          </Link>

          <div className="flex items-center gap-2 text-sm">
            <Link to="/" className="flex h-10 items-center rounded-[3px] border border-slate-200 px-5 text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/60 no-underline transition">
              首页
            </Link>
            <Link to="/workspace" className="flex h-10 items-center rounded-[3px] bg-blue-600 px-5 text-white hover:bg-blue-700 no-underline transition">
              新建地图
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-5">
          <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">公开样例集</h1>
            <p className="text-sm text-slate-500 mt-1">浏览公开分享的地图快照，点击可直接查看完整交互页面。</p>
          </div>
          <div className="text-sm text-slate-500">共 {total} 个样例</div>
          </div>

          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">排序</span>
              <div className="inline-flex overflow-hidden border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => changeSort('viewCount')}
                  className={`px-4 py-2 text-sm transition ${
                    sort === 'viewCount' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  浏览次数
                </button>
                <button
                  type="button"
                  onClick={() => changeSort('createdAt')}
                  className={`border-l border-slate-200 px-4 py-2 text-sm transition ${
                    sort === 'createdAt' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  创建时间
                </button>
              </div>
            </div>

            <form onSubmit={submitSearch} className="flex w-full items-center border-b border-slate-400 bg-transparent md:w-[320px]">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="输入项目名称"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchText('')
                    setQuery('')
                  }}
                  className="px-2 text-xs text-slate-400 hover:text-slate-700"
                >
                  清空
                </button>
              )}
              <button type="submit" className="flex h-10 w-10 items-center justify-center text-slate-500 hover:text-slate-900" aria-label="搜索">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            正在加载公开样例...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <div className="text-slate-500 text-sm">暂无公开样例</div>
            <Link to="/workspace" className="inline-flex mt-3 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm no-underline hover:bg-blue-700 transition">
              去创建第一个分享
            </Link>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <Link
                  key={item.slug}
                  to={`/share/${item.slug}`}
                  className="group bg-white overflow-hidden shadow-[0_12px_28px_rgba(15,23,42,0.10)] transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(15,23,42,0.16)] no-underline"
                >
                  <GalleryThumbnail item={item} />

                  <div className="px-4 pb-4 pt-3.5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 text-[15px] font-semibold leading-6 text-slate-900 line-clamp-1">{item.title}</div>
                      <span className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-600 shrink-0">公开</span>
                    </div>
                    <div className="mt-3 space-y-2.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <div className="flex items-center justify-between gap-4">
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6v6l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatDate(item.createdAt)}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          {item.viewCount} 次浏览
                          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span className="h-5 w-5 rounded-full bg-blue-50 text-blue-400 flex items-center justify-center">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 7.5a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
                          </svg>
                        </span>
                        <span>{item.creatorName || '普通用户'}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={goPrev}
                disabled={page <= 1}
                className={`h-10 px-4 text-sm transition ${
                  page <= 1
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                上一页
              </button>
              {pageItems.map((item, index) => item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="flex h-10 min-w-10 items-center justify-center text-sm text-slate-400">...</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => goPage(item)}
                  className={`h-10 min-w-10 px-3 text-sm transition ${
                    item === page
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-600'
                  }`}
                  aria-current={item === page ? 'page' : undefined}
                >
                  {item}
                </button>
              ))}
              <button
                onClick={goNext}
                disabled={page >= totalPages}
                className={`h-10 px-4 text-sm transition ${
                  page >= totalPages
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
