import { useEffect, useState } from 'react'
import { TIANDITU_TOKEN_CREATE_URL } from '../../services/tiandituTokenApi'
import { useTiandituTokenStore } from '../../stores/useTiandituTokenStore'

export function TiandituTokenModal() {
  const { modalOpen, status, error, maskedToken, hasToken, closeModal, validateAndSave, clear } = useTiandituTokenStore()
  const [token, setToken] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const saving = status === 'saving'
  const updating = hasToken

  useEffect(() => {
    if (modalOpen) {
      setToken('')
      setLocalError(null)
    }
  }, [modalOpen])

  if (!modalOpen) return null

  const submit = async () => {
    const value = token.trim()
    if (!value) {
      setLocalError('请输入天地图应用密钥 tk')
      return
    }
    setLocalError(null)
    await validateAndSave(value).catch(() => {})
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[520px] rounded-[8px] bg-white px-9 py-8 shadow-[0_28px_90px_rgba(15,23,42,0.24)]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={closeModal}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-colors"
            aria-label="返回"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h2 className="text-2xl font-bold tracking-normal text-slate-950">
              {updating ? '更新天地图 tk' : '设置天地图 tk'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {updating ? '替换当前保存的应用密钥，更新后会用于工作台地图预览。' : '输入你的天地图应用密钥，校验通过后即可创建和预览地图。'}
            </p>
          </div>
        </div>

        {hasToken && (
          <div className="mt-6 rounded-[8px] border border-blue-100 bg-blue-50/70 px-4 py-3">
            <p className="text-xs font-medium text-slate-500">当前已保存</p>
            <p className="mt-1 font-mono text-sm font-semibold text-blue-700">{maskedToken}</p>
          </div>
        )}

        <div className={hasToken ? 'mt-5' : 'mt-7'}>
          <label className="text-sm font-semibold text-slate-900" htmlFor="tianditu-token-input">
            {updating ? '新的天地图应用密钥 tk' : '天地图应用密钥 tk'}
          </label>
          <input
            id="tianditu-token-input"
            value={token}
            onChange={(event) => {
              setToken(event.target.value)
              setLocalError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !saving) void submit()
            }}
            className="mt-2 h-11 w-full rounded-[6px] border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            placeholder={updating ? '粘贴新的 tk，用于替换当前保存值' : '请输入天地图控制台创建的 tk'}
            autoComplete="off"
          />
          {(localError || error) && (
            <p className="mt-2 text-sm leading-5 text-rose-600">{localError || error}</p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <a
            href={TIANDITU_TOKEN_CREATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            没有 tk？去申请
          </a>
          {hasToken && (
            <button
              type="button"
              onClick={() => void clear()}
              className="text-sm font-medium text-slate-400 hover:text-rose-600 transition-colors"
            >
              清除当前 tk
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="mt-7 h-12 w-full rounded-[6px] bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {saving ? '正在处理...' : updating ? '更新 tk' : '校验并保存'}
        </button>
      </div>
    </div>
  )
}
