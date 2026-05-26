import axios from 'axios'
import type { ChatResponse, FixResponse } from '../types/api'
import { withBasePath } from '../utils/basePath'
import { encodeTextBase64 } from '../utils/transportEncoding'

const client = axios.create({
  baseURL: withBasePath('/api'),
  timeout: 120000,
})

client.interceptors.response.use(
  (r) => r.data,
  (err) => {
    console.error('API Error:', err)
    return Promise.reject(err)
  },
)

export const api = {
  async chat(
    message: string,
    file?: File,
    existingCode?: string,
    conversationHistory?: string,
  ): Promise<ChatResponse> {
    const formData = new FormData()
    formData.append('message', message)
    if (file) formData.append('file', file)
    if (existingCode) formData.append('existingCodePayload', encodeTextBase64(existingCode))
    if (conversationHistory) formData.append('conversationHistoryPayload', encodeTextBase64(conversationHistory))
    return client.post('/chat', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as any
  },

  async fixCode(code: string, error: string, userInput: string): Promise<FixResponse> {
    return client.post('/chat/fix', { codePayload: encodeTextBase64(code), errorPayload: encodeTextBase64(error), userInput }) as any
  },
}
