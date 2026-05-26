import { create } from 'zustand'
import { tiandituTokenApi } from '../services/tiandituTokenApi'

type TokenStatus = 'idle' | 'loading' | 'ready' | 'saving'

interface TiandituTokenStore {
  status: TokenStatus
  hasToken: boolean
  maskedToken: string
  token: string
  error: string | null
  modalOpen: boolean
  refresh: (force?: boolean) => Promise<void>
  openModal: () => void
  closeModal: () => void
  validateAndSave: (token: string) => Promise<void>
  clear: () => Promise<void>
}

let statusPromise: Promise<void> | null = null

export const useTiandituTokenStore = create<TiandituTokenStore>((set, get) => ({
  status: 'idle',
  hasToken: false,
  maskedToken: '',
  token: '',
  error: null,
  modalOpen: false,

  async refresh(force = false) {
    const current = get()
    if (!force && current.status === 'ready') return
    if (statusPromise && !force) return statusPromise

    set({ status: 'loading', error: null })
    statusPromise = tiandituTokenApi.status()
      .then((next) => {
        set({
          status: 'ready',
          hasToken: next.hasToken === true,
          maskedToken: next.maskedToken || '',
          token: next.token || '',
          error: null,
        })
      })
      .catch((err: any) => {
        set({ status: 'ready', hasToken: false, maskedToken: '', token: '', error: err?.message || '获取 tk 状态失败' })
      })

    try {
      await statusPromise
    } finally {
      statusPromise = null
    }
  },

  openModal() {
    set({ modalOpen: true, error: null })
  },

  closeModal() {
    set({ modalOpen: false, error: null })
  },

  async validateAndSave(token: string) {
    set({ status: 'saving', error: null })
    try {
      const next = await tiandituTokenApi.validateAndSave(token)
      set({
        status: 'ready',
        hasToken: next.hasToken === true,
        maskedToken: next.maskedToken || '',
        token: next.token || '',
        error: null,
        modalOpen: false,
      })
    } catch (err: any) {
      set({ status: 'ready', error: err?.message || 'tk 校验失败' })
      throw err
    }
  },

  async clear() {
    set({ status: 'saving', error: null })
    try {
      await tiandituTokenApi.clear()
      set({ status: 'ready', hasToken: false, maskedToken: '', token: '', error: null })
    } catch (err: any) {
      set({ status: 'ready', error: err?.message || '清除 tk 失败' })
      throw err
    }
  },
}))
