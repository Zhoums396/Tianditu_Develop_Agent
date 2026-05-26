import type { ThoughtChainItem } from '../../types/chat'

type ActivityStatus = ThoughtChainItem['status']

interface ActivityRow {
  key: string
  label: string
  summary?: string
  status: ActivityStatus
  durationMs?: number | null
  stepCount?: number
  grouped?: boolean
  children?: Array<{
    key: string
    label: string
    summary?: string
    status: ActivityStatus
  }>
}

function statusLabel(status: ActivityStatus) {
  if (status === 'running') return '运行中'
  if (status === 'error') return '失败'
  return '完成'
}

function statusClass(status: ActivityStatus) {
  if (status === 'running') return 'bg-blue-50 text-blue-600 border-blue-200/70'
  if (status === 'error') return 'bg-red-50 text-red-600 border-red-200/70'
  return 'bg-emerald-50 text-emerald-600 border-emerald-200/70'
}

function computeDuration(items: ThoughtChainItem[]) {
  const starts = items
    .map((item) => item.startedAt)
    .filter((value): value is number => typeof value === 'number')
  const ends = items
    .map((item) => item.endedAt)
    .filter((value): value is number => typeof value === 'number')

  if (!starts.length) return null
  const startedAt = Math.min(...starts)
  const endedAt = ends.length ? Math.max(...ends) : null
  if (endedAt == null) return null
  return Math.max(0, endedAt - startedAt)
}

function mergeStatus(items: ThoughtChainItem[]): ActivityStatus {
  if (items.some((item) => item.status === 'running')) return 'running'
  if (items.some((item) => item.status === 'error')) return 'error'
  return 'done'
}

function fallbackLabel(item: ThoughtChainItem) {
  return item.uiLabel || item.toolName || '执行步骤'
}

function fallbackSummary(item: ThoughtChainItem) {
  if (item.uiSummary) return item.uiSummary
  if (item.status === 'running') return '正在执行'
  return ''
}

function buildSingleRow(item: ThoughtChainItem): ActivityRow {
  const durationMs =
    typeof item.startedAt === 'number' && typeof item.endedAt === 'number'
      ? Math.max(0, item.endedAt - item.startedAt)
      : null

  return {
    key: item.toolCallId,
    label: fallbackLabel(item),
    summary: fallbackSummary(item) || undefined,
    status: item.status,
    durationMs,
  }
}

function buildGroupRow(items: ThoughtChainItem[]): ActivityRow {
  const status = mergeStatus(items)
  const reversed = [...items].reverse()
  const preferred = reversed.find((item) => item.status === 'running' && item.uiSummary)
    || reversed.find((item) => item.status === 'error' && item.uiSummary)
    || reversed.find((item) => item.uiSummary)

  const summary = preferred?.uiSummary
    || (status === 'running'
      ? `正在执行 ${items.length} 个内部步骤`
      : status === 'error'
        ? `其中 ${items.filter((item) => item.status === 'error').length} 个步骤失败`
        : `已完成 ${items.length} 个内部步骤`)

  return {
    key: `${items[0].uiGroup || 'group'}:${items[0].toolCallId}`,
    label: items[0].uiGroupLabel || '准备上下文',
    summary,
    status,
    durationMs: computeDuration(items),
    stepCount: items.length,
    grouped: true,
    children: items.map((item) => ({
      key: item.toolCallId,
      label: fallbackLabel(item),
      summary: fallbackSummary(item) || undefined,
      status: item.status,
    })),
  }
}

function buildRows(items: ThoughtChainItem[]): ActivityRow[] {
  const visible = items.filter((item) => item.uiVisibility !== 'debug')
  const rows: ActivityRow[] = []

  for (let index = 0; index < visible.length; index += 1) {
    const current = visible[index]
    if (current.uiVisibility === 'grouped' && current.uiGroup) {
      const groupItems = [current]
      let nextIndex = index + 1
      while (nextIndex < visible.length) {
        const candidate = visible[nextIndex]
        if (candidate.uiVisibility !== 'grouped' || candidate.uiGroup !== current.uiGroup) break
        groupItems.push(candidate)
        nextIndex += 1
      }
      rows.push(buildGroupRow(groupItems))
      index = nextIndex - 1
      continue
    }

    rows.push(buildSingleRow(current))
  }

  return rows
}

export function ThoughtChain({ items, streaming }: { items: ThoughtChainItem[]; streaming?: boolean }) {
  const rows = buildRows(items)
  if (!rows.length) return null

  const runningCount = rows.filter((row) => row.status === 'running').length
  const hiddenCount = items.length - rows.length

  return (
    <details open={streaming ? true : undefined} className="mb-2 rounded-xl border border-gray-200/80 bg-gray-50/70 overflow-hidden transition-colors">
      <summary className="list-none cursor-pointer select-none px-3 py-2.5 flex items-center justify-between gap-2 transition-colors hover:bg-gray-50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.5 6.75h15m-15 5.25h10.5m-10.5 5.25h15" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-gray-700">执行过程</div>
            <div className="text-[10.5px] text-gray-400">
              {rows.length} 个关键活动{hiddenCount > 0 ? `，已折叠 ${hiddenCount} 个内部步骤` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {runningCount > 0 && (
            <span className="text-[11px] text-blue-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              {runningCount} 运行中
            </span>
          )}
          <svg className="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 9l-7.5 7.5L4.5 9" />
          </svg>
        </div>
      </summary>

      <div className="px-2 pb-2 space-y-1.5 animate-fade-in">
        {rows.map((row) => {
          const body = (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-[11.5px] font-medium text-gray-700 leading-relaxed truncate">{row.label}</div>
                  {row.grouped && typeof row.stepCount === 'number' && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                      {row.stepCount} 步
                    </span>
                  )}
                </div>
                {row.summary && (
                  <div className="text-[10.5px] text-gray-500 leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                    {row.summary}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {row.durationMs != null && row.status !== 'running' && (
                  <span className="text-[10.5px] text-gray-400">{row.durationMs}ms</span>
                )}
                <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md border ${statusClass(row.status)}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
            </>
          )

          if (!row.grouped || !row.children?.length) {
            return (
              <div
                key={row.key}
                className="bg-white border border-gray-200/80 rounded-lg px-2.5 py-2 flex items-start justify-between gap-3"
              >
                {body}
              </div>
            )
          }

          return (
            <details
              key={row.key}
              open={row.status === 'running' ? true : undefined}
              className="bg-white border border-gray-200/80 rounded-lg overflow-hidden"
            >
              <summary className="list-none cursor-pointer px-2.5 py-2 flex items-start justify-between gap-3 transition-colors hover:bg-gray-50/60">
                {body}
              </summary>
              <div className="border-t border-gray-100 px-2.5 py-2 space-y-1.5 bg-slate-50/55">
                {row.children.map((child) => (
                  <div key={child.key} className="flex items-start justify-between gap-3 rounded-md bg-white/75 border border-slate-100 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-medium text-slate-600 leading-relaxed truncate">{child.label}</div>
                      {child.summary && (
                        <div className="text-[10px] text-slate-500 leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                          {child.summary}
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border ${statusClass(child.status)}`}>
                      {statusLabel(child.status)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </details>
  )
}
