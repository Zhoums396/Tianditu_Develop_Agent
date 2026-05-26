import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { runDossierApi } from '../services/runDossierApi'
import { copyText } from '../utils/copyText'
import { docsUrl } from '../utils/docsUrl'
import { appAsset } from '../utils/basePath'
import type {
  RunArtifactContentResult,
  RunArtifactRecord,
  RunDossierListResult,
  RunDossierRecord,
  RunEntrySource,
  RunOutcome,
  RunPhase,
  RunStatus,
} from '../types/runDossier'

type FilterValue<T extends string> = T | 'all'

const statusOptions: Array<{ value: FilterValue<RunStatus>; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
]

const phaseOptions: Array<{ value: FilterValue<RunPhase>; label: string }> = [
  { value: 'all', label: '全部阶段' },
  { value: 'generate', label: '生成' },
  { value: 'fix_runtime', label: '运行修复' },
  { value: 'fix_visual', label: '视觉修复' },
]

const outcomeOptions: Array<{ value: FilterValue<RunOutcome>; label: string }> = [
  { value: 'all', label: '全部结果' },
  { value: 'pending', label: '进行中' },
  { value: 'generated', label: '已生成' },
  { value: 'fixed', label: '已修复' },
  { value: 'runtime_error', label: '运行错误' },
  { value: 'visual_error', label: '视觉异常' },
  { value: 'request_error', label: '请求异常' },
  { value: 'client_disconnected', label: '客户端断开' },
]

const sourceOptions: Array<{ value: FilterValue<RunEntrySource>; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'sample', label: '首页样例' },
  { value: 'upload', label: '用户上传' },
  { value: 'inline', label: '纯文本任务' },
  { value: 'none', label: '未标记' },
]

function formatDateTime(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRelative(ts?: number) {
  if (!ts) return '-'
  const diff = Date.now() - ts
  const abs = Math.abs(diff)
  if (abs < 60_000) return diff >= 0 ? '刚刚' : '即将'
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${diff >= 0 ? '前' : '后'}`
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${diff >= 0 ? '前' : '后'}`
  return `${Math.round(abs / 86_400_000)} 天${diff >= 0 ? '前' : '后'}`
}

function formatDuration(startedAt?: number, finishedAt?: number) {
  if (!startedAt) return '-'
  const end = finishedAt || Date.now()
  const diff = Math.max(0, end - startedAt)
  if (diff < 1000) return `${diff}ms`
  if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`
  return `${Math.floor(diff / 60_000)}m ${Math.round((diff % 60_000) / 1000)}s`
}

function formatBytes(value?: number) {
  if (!value && value !== 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function phaseLabel(value: RunPhase) {
  return {
    generate: '生成',
    fix_runtime: '运行修复',
    fix_visual: '视觉修复',
  }[value]
}

function sourceLabel(value: RunEntrySource) {
  return {
    sample: '首页样例',
    upload: '用户上传',
    inline: '纯文本',
    none: '未标记',
  }[value]
}

function outcomeLabel(value: RunOutcome) {
  return {
    pending: '进行中',
    generated: '已生成',
    fixed: '已修复',
    runtime_error: '运行错误',
    visual_error: '视觉异常',
    request_error: '请求异常',
    client_disconnected: '客户端断开',
  }[value]
}

function artifactKindLabel(kind: string) {
  return {
    'request-snapshot': '请求快照',
    'file-context': '文件上下文',
    'generated-code': '生成代码',
    'fixed-code': '修复代码',
    'visual-result': '视觉检查',
    'visual-screenshot': '视觉截图',
    'fix-request': '修复请求',
    'input-code': '输入代码',
  }[kind] || kind
}

function toneClassForStatus(status: RunStatus) {
  return {
    running: 'bg-amber-50 text-amber-700 ring-amber-200',
    succeeded: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  }[status]
}

function toneClassForOutcome(outcome: RunOutcome) {
  if (outcome === 'generated' || outcome === 'fixed') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (outcome === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-rose-50 text-rose-700 ring-rose-200'
}

function payloadToString(value: unknown) {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function pickDefaultArtifact(artifacts: RunArtifactRecord[]) {
  const priorities = ['fixed-code', 'generated-code', 'file-context', 'visual-result', 'request-snapshot', 'input-code', 'fix-request']
  for (const kind of priorities) {
    const match = artifacts.find((item) => item.kind === kind)
    if (match) return match
  }
  return artifacts[0] || null
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${tone}`}>
      {children}
    </span>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:bg-slate-50/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function EmptyDetail() {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300/80 bg-white/80 px-8 py-12 text-center shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4.5 19.5h15m-15 0V8.25A2.25 2.25 0 016.75 6h10.5A2.25 2.25 0 0119.5 8.25V19.5m-15 0l3.125-3.125a2.25 2.25 0 013.182 0L12 17.568l1.193-1.193a2.25 2.25 0 013.182 0L19.5 19.5" />
        </svg>
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">选择一条运行档案</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        左侧会展示最近的生成、运行修复与视觉修复记录。选中之后，你可以直接查看输入、事件时间线、错误指纹和生成产物。
      </p>
    </div>
  )
}

export function RunDossiersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [listResult, setListResult] = useState<RunDossierListResult | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDossierRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const [artifactData, setArtifactData] = useState<RunArtifactContentResult | null>(null)
  const [copiedState, setCopiedState] = useState('')
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '')

  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const status = (searchParams.get('status') || 'all') as FilterValue<RunStatus>
  const phase = (searchParams.get('phase') || 'all') as FilterValue<RunPhase>
  const outcome = (searchParams.get('outcome') || 'all') as FilterValue<RunOutcome>
  const entrySource = (searchParams.get('entrySource') || 'all') as FilterValue<RunEntrySource>
  const selectedRunId = searchParams.get('runId') || ''
  const selectedArtifactId = searchParams.get('artifactId') || ''
  const q = searchParams.get('q') || ''

  const items = listResult?.items || []
  const total = listResult?.total || 0
  const visibleFailed = items.filter((item) => item.status === 'failed').length
  const visibleRunning = items.filter((item) => item.status === 'running').length
  const visibleRecovered = items.filter((item) => item.outcome === 'fixed').length

  function updateParams(patch: Record<string, string | null>, resetPage = false) {
    const next = new URLSearchParams(searchParams)
    Object.entries(patch).forEach(([key, value]) => {
      if (value == null || value === '' || value === 'all') next.delete(key)
      else next.set(key, value)
    })
    if (resetPage) next.delete('page')
    setSearchParams(next)
  }

  async function loadList() {
    setListLoading(true)
    setListError(null)
    try {
      const result = await runDossierApi.listRuns({
        page,
        pageSize: 24,
        status,
        phase,
        outcome,
        entrySource,
        q,
      })
      setListResult(result)
    } catch (err: any) {
      setListError(err?.message || '加载运行档案失败')
    } finally {
      setListLoading(false)
    }
  }

  async function loadDetail(runId: string) {
    if (!runId) {
      setDetail(null)
      setArtifactData(null)
      return
    }
    setDetailLoading(true)
    setDetailError(null)
    try {
      const result = await runDossierApi.getRun(runId)
      setDetail(result)
    } catch (err: any) {
      setDetailError(err?.message || '加载运行详情失败')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function loadArtifact(runId: string, artifactId: string) {
    if (!runId || !artifactId) {
      setArtifactData(null)
      return
    }
    setArtifactLoading(true)
    setArtifactError(null)
    try {
      const result = await runDossierApi.getArtifact(runId, artifactId)
      setArtifactData(result)
    } catch (err: any) {
      setArtifactError(err?.message || '加载产物失败')
      setArtifactData(null)
    } finally {
      setArtifactLoading(false)
    }
  }

  async function copyValue(value: string, label: string) {
    const result = await copyText(value)
    setCopiedState(result === 'copied' ? `${label}已复制` : result === 'manual' ? `请手动复制${label}` : `复制${label}失败`)
    window.setTimeout(() => setCopiedState(''), 1800)
  }

  useEffect(() => {
    setSearchDraft(q)
  }, [q])

  useEffect(() => {
    void loadList()
  }, [page, status, phase, outcome, entrySource, q])

  useEffect(() => {
    if (selectedRunId) return
    if (!items.length) return
    updateParams({ runId: items[0].id }, false)
  }, [selectedRunId, items])

  useEffect(() => {
    void loadDetail(selectedRunId)
  }, [selectedRunId])

  useEffect(() => {
    if (!detail?.artifacts?.length) {
      setArtifactData(null)
      return
    }
    const exists = detail.artifacts.some((item) => item.id === selectedArtifactId)
    if (!selectedArtifactId || !exists) {
      const fallback = pickDefaultArtifact(detail.artifacts)
      if (fallback) updateParams({ artifactId: fallback.id }, false)
      return
    }
    void loadArtifact(detail.summary.id, selectedArtifactId)
  }, [detail, selectedArtifactId])

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-slate-900">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_34%),radial-gradient(circle_at_84%_14%,rgba(240,232,216,0.85),transparent_28%),linear-gradient(180deg,#f6f4ef_0%,#f8f7f3_42%,#f3f0e8_100%)]" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(15,23,42,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.9) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="absolute left-[-9rem] top-28 h-72 w-72 rounded-full bg-white/70 blur-3xl" />
        <div className="absolute right-[-6rem] top-20 h-80 w-80 rounded-full bg-[#e8ded0]/65 blur-3xl" />
        <div className="absolute bottom-[-9rem] right-1/3 h-96 w-96 rounded-full bg-white/60 blur-3xl" />
      </div>

      <div className="relative">
        <header className="border-b border-black/5 bg-white/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link to="/" className="flex items-center gap-3 no-underline">
              <img src={appAsset('/tianditu-logo.png')} alt="天地图" className="h-8 object-contain" />
              <div className="h-6 w-px bg-slate-200" />
              <img src={appAsset('/tianditu-agent-logo.svg')} alt="天地图开发智能体" className="hidden h-8 w-auto object-contain sm:block" />
            </Link>

            <nav className="flex items-center gap-1.5 text-sm">
              <Link to="/" className="rounded-xl px-3 py-2 text-slate-500 transition hover:bg-white hover:text-slate-900 no-underline">首页</Link>
              <a href={docsUrl} className="rounded-xl px-3 py-2 text-slate-500 transition hover:bg-white hover:text-slate-900 no-underline">使用文档</a>
              <Link to="/workspace" className="rounded-xl px-3 py-2 text-slate-500 transition hover:bg-white hover:text-slate-900 no-underline">工作区</Link>
              <Link to="/gallery" className="rounded-xl px-3 py-2 text-slate-500 transition hover:bg-white hover:text-slate-900 no-underline">公开样例</Link>
              <Link to="/runs" className="rounded-xl bg-slate-900 px-3 py-2 text-white shadow-sm no-underline">运行档案</Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <section className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
            <div className="rounded-[32px] border border-white/80 bg-white/80 p-7 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur-xl">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                    Run Intelligence
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.5rem]">
                    运行档案中心
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500 sm:text-[15px]">
                    自动聚合用户输入、文件画像、ThoughtChain、错误指纹与生成产物。这里不是简单日志，而是一套能用于排障、复盘和持续优化的内部分析工作台。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200/80 bg-[#f7f5f0] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">当前筛选</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{total}</div>
                  </div>
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-rose-400">失败</div>
                    <div className="mt-2 text-2xl font-semibold text-rose-700">{visibleFailed}</div>
                  </div>
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-amber-400">运行中</div>
                    <div className="mt-2 text-2xl font-semibold text-amber-700">{visibleRunning}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-400">已修复</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-700">{visibleRecovered}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-white/80 bg-[#111111] p-7 text-white shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">What matters</div>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight">让失败变成结构化资产</h2>
                  <p className="mt-3 text-sm leading-7 text-white/65">
                    这块页面的目标不是“看起来像后台”，而是快速回答四个问题：谁失败了、为什么失败、修复是否生效、下一轮该优化什么。
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">Signal</div>
                  <div className="mt-1 text-lg font-semibold">{items.length ? 'Live' : 'Ready'}</div>
                </div>
              </div>

              <div className="mt-6 space-y-3 text-sm text-white/70">
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">保留用户需求、文件契约、代码版本与运行错误的同一条证据链。</div>
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">支持追踪首页样例、用户上传、运行修复与视觉回灌的连续关系。</div>
                <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">为后续做高频错误聚类、修复成功率与薄弱 reference 分析打基础。</div>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[32px] border border-white/80 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  updateParams({ q: searchDraft || null }, true)
                }}
                className="flex flex-col gap-2"
              >
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">搜索</span>
                <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35m1.6-5.4a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
                  </svg>
                  <input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="搜索 runId、样例名、报错指纹、Prompt..."
                    className="h-full flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  />
                  {q && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchDraft('')
                        updateParams({ q: null }, true)
                      }}
                      className="rounded-xl px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      清除
                    </button>
                  )}
                </div>
              </form>

              <FilterSelect label="状态" value={status} options={statusOptions} onChange={(value) => updateParams({ status: value }, true)} />
              <FilterSelect label="阶段" value={phase} options={phaseOptions} onChange={(value) => updateParams({ phase: value }, true)} />
              <FilterSelect label="结果" value={outcome} options={outcomeOptions} onChange={(value) => updateParams({ outcome: value }, true)} />
              <FilterSelect label="来源" value={entrySource} options={sourceOptions} onChange={(value) => updateParams({ entrySource: value }, true)} />
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="flex min-h-[760px] flex-col rounded-[32px] border border-white/80 bg-white/85 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
              <div className="flex items-center justify-between px-2 pb-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Timeline</div>
                  <div className="mt-1 text-sm font-medium text-slate-700">最近运行</div>
                </div>
                <div className="text-xs text-slate-400">{total} 条记录</div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {listLoading && (
                  <div className="rounded-3xl border border-slate-200 bg-[#f7f5f0] px-5 py-8 text-sm text-slate-500">
                    正在加载运行档案...
                  </div>
                )}

                {!listLoading && listError && (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-700">
                    {listError}
                  </div>
                )}

                {!listLoading && !listError && items.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-[#f7f5f0] px-5 py-8 text-sm leading-7 text-slate-500">
                    当前筛选下还没有运行档案。你可以先去工作区跑一条带数据样例或上传文件的任务，再回来查看完整运行证据链。
                  </div>
                )}

                {!listLoading && !listError && items.map((item) => {
                  const active = item.id === selectedRunId
                  return (
                    <button
                      key={item.id}
                      onClick={() => updateParams({ runId: item.id, artifactId: null }, false)}
                      className={`w-full rounded-[28px] border px-4 py-4 text-left transition-all ${
                        active
                          ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
                          : 'border-slate-200/80 bg-[#faf9f6] hover:border-slate-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`text-[11px] uppercase tracking-[0.16em] ${active ? 'text-white/45' : 'text-slate-400'}`}>
                            {item.id}
                          </div>
                          <div className={`mt-2 line-clamp-2 text-sm font-medium leading-6 ${active ? 'text-white' : 'text-slate-800'}`}>
                            {item.userPrompt}
                          </div>
                        </div>
                        <Chip tone={active ? 'bg-white/10 text-white ring-white/10' : toneClassForStatus(item.status)}>
                          {item.status === 'running' ? '运行中' : item.status === 'succeeded' ? '成功' : '失败'}
                        </Chip>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Chip tone={active ? 'bg-white/8 text-white/80 ring-white/10' : 'bg-slate-100 text-slate-600 ring-slate-200'}>
                          {phaseLabel(item.phase)}
                        </Chip>
                        <Chip tone={active ? 'bg-white/8 text-white/80 ring-white/10' : 'bg-slate-100 text-slate-600 ring-slate-200'}>
                          {sourceLabel(item.entrySource)}
                        </Chip>
                        <Chip tone={active ? 'bg-white/8 text-white/80 ring-white/10' : toneClassForOutcome(item.outcome)}>
                          {outcomeLabel(item.outcome)}
                        </Chip>
                      </div>

                      <div className={`mt-4 grid grid-cols-2 gap-3 text-xs ${active ? 'text-white/60' : 'text-slate-500'}`}>
                        <div>
                          <div className="uppercase tracking-[0.16em] opacity-70">时间</div>
                          <div className="mt-1 font-medium">{formatRelative(item.startedAt)}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-[0.16em] opacity-70">文件</div>
                          <div className="mt-1 font-medium">{item.fileName || '无文件'}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-[0.16em] opacity-70">模型</div>
                          <div className="mt-1 font-medium">{item.modelName || '-'}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-[0.16em] opacity-70">错误</div>
                          <div className="mt-1 font-medium">{item.errorCount}</div>
                        </div>
                      </div>

                      {item.latestErrorMessage && (
                        <div className={`mt-4 rounded-2xl px-3 py-3 text-xs leading-6 ${active ? 'bg-white/8 text-white/75' : 'bg-rose-50 text-rose-700'}`}>
                          {item.latestErrorMessage}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </aside>

            <div className="min-w-0">
              {detailLoading && (
                <div className="rounded-[32px] border border-white/80 bg-white/85 px-6 py-10 text-sm text-slate-500 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
                  正在加载运行详情...
                </div>
              )}

              {!detailLoading && detailError && (
                <div className="rounded-[32px] border border-rose-200 bg-rose-50 px-6 py-8 text-sm text-rose-700 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
                  {detailError}
                </div>
              )}

              {!detailLoading && !detailError && !detail && <EmptyDetail />}

              {!detailLoading && !detailError && detail && (
                <div className="space-y-6">
                  <section className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="max-w-3xl">
                        <div className="flex flex-wrap gap-2">
                          <Chip tone={toneClassForStatus(detail.summary.status)}>
                            {detail.summary.status === 'running' ? '运行中' : detail.summary.status === 'succeeded' ? '成功' : '失败'}
                          </Chip>
                          <Chip tone={toneClassForOutcome(detail.summary.outcome)}>{outcomeLabel(detail.summary.outcome)}</Chip>
                          <Chip tone="bg-slate-100 text-slate-600 ring-slate-200">{phaseLabel(detail.summary.phase)}</Chip>
                          <Chip tone="bg-slate-100 text-slate-600 ring-slate-200">{sourceLabel(detail.summary.entrySource)}</Chip>
                        </div>

                        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">
                          {detail.summary.userPrompt}
                        </h2>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                          <span>{detail.summary.id}</span>
                          <span className="text-slate-300">•</span>
                          <span>{formatDateTime(detail.summary.startedAt)}</span>
                          <span className="text-slate-300">•</span>
                          <span>耗时 {formatDuration(detail.summary.startedAt, detail.summary.finishedAt)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => copyValue(detail.summary.id, 'Run ID')}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          复制 Run ID
                        </button>
                        <button
                          onClick={() => copyValue(detail.summary.latestErrorFingerprint || '', '错误指纹')}
                          disabled={!detail.summary.latestErrorFingerprint}
                          className={`rounded-2xl border px-4 py-2 text-sm transition ${
                            detail.summary.latestErrorFingerprint
                              ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                              : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                          }`}
                        >
                          复制错误指纹
                        </button>
                      </div>
                    </div>

                    {copiedState && (
                      <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        {copiedState}
                      </div>
                    )}

                    <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">模型</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{detail.summary.modelName || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">固定单模型链路</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">文件</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{detail.summary.fileName || '无文件输入'}</div>
                        <div className="mt-1 text-xs text-slate-500">{detail.summary.fileKind || '-'} · {formatBytes(detail.summary.fileSize)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">事件 / 错误</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{detail.summary.eventCount} / {detail.summary.errorCount}</div>
                        <div className="mt-1 text-xs text-slate-500">产物 {detail.summary.artifactCount} 个</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] p-4">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">模式</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{detail.summary.agentMode || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">Verifier: {detail.summary.verifierEnabled ? '已开启' : '未开启'}</div>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Artifacts</div>
                          <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">产物查看器</h3>
                        </div>
                        <div className="text-xs text-slate-400">{detail.artifacts.length} 个产物</div>
                      </div>

                      <div className="mt-5 grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
                        <div className="space-y-2">
                          {detail.artifacts.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-[#f7f5f0] px-4 py-6 text-sm text-slate-500">
                              该运行暂时还没有落盘产物。
                            </div>
                          )}

                          {detail.artifacts.map((artifact) => {
                            const active = artifact.id === selectedArtifactId
                            return (
                              <button
                                key={artifact.id}
                                onClick={() => updateParams({ artifactId: artifact.id }, false)}
                                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                                  active
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-[#faf9f6] hover:border-slate-300 hover:bg-white'
                                }`}
                              >
                                <div className="text-sm font-medium">{artifactKindLabel(artifact.kind)}</div>
                                <div className={`mt-1 text-xs ${active ? 'text-white/60' : 'text-slate-500'}`}>{artifact.contentType}</div>
                                <div className={`mt-2 text-[11px] uppercase tracking-[0.16em] ${active ? 'text-white/45' : 'text-slate-400'}`}>
                                  {formatBytes(artifact.sizeBytes)} · {formatRelative(artifact.createdAt)}
                                </div>
                              </button>
                            )
                          })}
                        </div>

                        <div className="min-w-0">
                          {artifactLoading && (
                            <div className="flex min-h-[430px] items-center justify-center rounded-[28px] border border-slate-200 bg-[#0f172a] text-sm text-slate-300">
                              正在加载产物内容...
                            </div>
                          )}

                          {!artifactLoading && artifactError && (
                            <div className="min-h-[430px] rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-700">
                              {artifactError}
                            </div>
                          )}

                          {!artifactLoading && !artifactError && artifactData && (
                            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[#0f172a] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-white">
                                    {artifactKindLabel(artifactData.artifact.kind)}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">{artifactData.artifact.contentType}</div>
                                </div>
                                <div className="flex gap-2">
                                  {artifactData.rawUrl && (
                                    <a
                                      href={artifactData.rawUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 no-underline transition hover:bg-white/10"
                                    >
                                      打开原始内容
                                    </a>
                                  )}
                                  {!!artifactData.content && (
                                    <button
                                      onClick={() => copyValue(artifactData.content || '', '产物内容')}
                                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10"
                                    >
                                      复制内容
                                    </button>
                                  )}
                                </div>
                              </div>

                              {artifactData.artifact.contentType.startsWith('image/') && artifactData.rawUrl ? (
                                <div className="bg-[#111827] p-4">
                                  <img
                                    src={artifactData.rawUrl}
                                    alt={artifactKindLabel(artifactData.artifact.kind)}
                                    className="max-h-[560px] w-full rounded-2xl border border-white/8 object-contain"
                                  />
                                </div>
                              ) : (
                                <pre className="max-h-[560px] overflow-auto px-5 py-5 text-[12.5px] leading-6 text-slate-200 whitespace-pre-wrap">
                                  {artifactData.parsedJson ? JSON.stringify(artifactData.parsedJson, null, 2) : artifactData.content || '暂无内容'}
                                </pre>
                              )}
                            </div>
                          )}

                          {!artifactLoading && !artifactError && !artifactData && (
                            <div className="flex min-h-[430px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-[#f7f5f0] text-sm text-slate-500">
                              选择一个产物查看详细内容。
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <section className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Failure summary</div>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">错误与诊断</h3>

                        {detail.errors.length === 0 ? (
                          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                            当前这条运行档案还没有记录到错误。
                          </div>
                        ) : (
                          <div className="mt-5 space-y-3">
                            {detail.errors.map((error) => (
                              <div key={error.id} className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Chip tone="bg-rose-100 text-rose-700 ring-rose-200">{error.source}</Chip>
                                  {error.kind && <Chip tone="bg-white text-slate-600 ring-slate-200">{error.kind}</Chip>}
                                </div>
                                <div className="mt-3 text-sm font-medium leading-6 text-rose-900">{error.message}</div>
                                <div className="mt-3 text-xs text-rose-700/80">
                                  指纹：<span className="font-medium">{error.fingerprint}</span>
                                </div>
                                {error.details && (
                                  <details className="mt-3 rounded-2xl border border-rose-100 bg-white/70 p-3">
                                    <summary className="cursor-pointer text-xs font-medium text-slate-600">查看错误详情</summary>
                                    <pre className="mt-3 overflow-auto text-[12px] leading-6 text-slate-600 whitespace-pre-wrap">
                                      {JSON.stringify(error.details, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Request snapshot</div>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">请求与上下文</h3>
                        <div className="mt-5 grid gap-3 text-sm text-slate-600">
                          <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Prompt</div>
                            <div className="mt-2 leading-7 text-slate-800">{detail.request.userPrompt}</div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">来源</div>
                              <div className="mt-2 text-slate-800">{sourceLabel(detail.request.entrySource)}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Sample ID</div>
                              <div className="mt-2 text-slate-800">{detail.request.sampleId || '-'}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Request ID</div>
                              <div className="mt-2 break-all text-slate-800">{detail.request.requestId}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-[#f7f5f0] px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Session ID</div>
                              <div className="mt-2 break-all text-slate-800">{detail.request.sessionId}</div>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  </section>

                  <section className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Thought chain</div>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">事件时间线</h3>
                      </div>
                      <div className="text-xs text-slate-400">{detail.events.length} 个事件</div>
                    </div>

                    <div className="mt-6 space-y-3">
                      {detail.events.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-[#f7f5f0] px-4 py-6 text-sm text-slate-500">
                          当前还没有记录到事件时间线。
                        </div>
                      )}

                      {detail.events.map((event, index) => (
                        <div key={event.id} className="rounded-[24px] border border-slate-200 bg-[#faf9f6] p-4">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                                  #{index + 1}
                                </span>
                                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">
                                  {event.type}
                                </span>
                                {event.toolName && (
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                                    {event.toolName}
                                  </span>
                                )}
                                {event.status && (
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                                    {event.status}
                                  </span>
                                )}
                              </div>
                              {event.toolCallId && (
                                <div className="mt-3 text-xs text-slate-400">{event.toolCallId}</div>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">{formatDateTime(event.createdAt)}</div>
                          </div>

                          {event.payload != null && (
                            <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                              <summary className="cursor-pointer text-sm font-medium text-slate-600">展开查看 payload</summary>
                              <pre className="mt-3 max-h-[260px] overflow-auto text-[12px] leading-6 text-slate-600 whitespace-pre-wrap">
                                {payloadToString(event.payload)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
