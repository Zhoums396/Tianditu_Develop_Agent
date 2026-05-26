import type { VisualInspectRequest, VisualInspectResult } from '../types/visualQa'
import { withBasePath } from '../utils/basePath'
import { encodeTextBase64 } from '../utils/transportEncoding'

interface ApiSuccess<T> {
  success: true
  data: T
}

interface ApiFailure {
  success: false
  error: string
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(typeof input === 'string' ? withBasePath(input) : input, init)
  const json = (await response.json()) as ApiSuccess<T> | ApiFailure
  if (!response.ok || !json.success) {
    const message = 'error' in json ? json.error : `HTTP ${response.status}`
    throw new Error(message || '请求失败')
  }
  return json.data
}

export const visualQaApi = {
  inspect(payload: VisualInspectRequest) {
    const bodyPayload = payload.code
      ? { ...payload, code: undefined, codeBase64: encodeTextBase64(payload.code) }
      : payload
    return requestJson<VisualInspectResult>('/api/chat/visual-inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    })
  },
}
