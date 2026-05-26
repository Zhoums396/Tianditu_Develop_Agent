import type {
  RunArtifactContentResult,
  RunDossierListResult,
  RunDossierRecord,
  RunEntrySource,
  RunOutcome,
  RunPhase,
  RunStatus,
} from '../types/runDossier'
import { withBasePath } from '../utils/basePath'

interface RuntimeErrorPayload {
  runId: string
  previewRunId?: string
  message: string
  kind?: string
  src?: string
  line?: number
  col?: number
  requestUrl?: string
  method?: string
  status?: number
  codeHash?: string
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(url), init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const json = await response.json()
  if (!json?.success) throw new Error(json?.error || '请求失败')
  return json.data as T
}

export const runDossierApi = {
  reportRuntimeError(payload: RuntimeErrorPayload) {
    return requestJson<{ recorded: boolean }>('/api/run-dossiers/runtime-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  listRuns(options?: {
    page?: number
    pageSize?: number
    status?: RunStatus | 'all'
    phase?: RunPhase | 'all'
    outcome?: RunOutcome | 'all'
    entrySource?: RunEntrySource | 'all'
    q?: string
  }) {
    const query = new URLSearchParams()
    if (options?.page) query.set('page', String(options.page))
    if (options?.pageSize) query.set('pageSize', String(options.pageSize))
    if (options?.status && options.status !== 'all') query.set('status', options.status)
    if (options?.phase && options.phase !== 'all') query.set('phase', options.phase)
    if (options?.outcome && options.outcome !== 'all') query.set('outcome', options.outcome)
    if (options?.entrySource && options.entrySource !== 'all') query.set('entrySource', options.entrySource)
    if (options?.q?.trim()) query.set('q', options.q.trim())
    const qs = query.toString()
    return requestJson<RunDossierListResult>(`/api/run-dossiers${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
  },

  getRun(runId: string) {
    return requestJson<RunDossierRecord>(`/api/run-dossiers/${encodeURIComponent(runId)}`, {
      method: 'GET',
    })
  },

  getArtifact(runId: string, artifactId: string) {
    return requestJson<RunArtifactContentResult>(
      `/api/run-dossiers/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { method: 'GET' },
    )
  },

  getArtifactRawUrl(runId: string, artifactId: string) {
    return withBasePath(`/api/run-dossiers/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/raw`)
  },
}
