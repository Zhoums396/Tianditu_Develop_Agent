import { useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../../types/auth'
import { useTiandituTokenStore } from '../../stores/useTiandituTokenStore'

interface UserMenuProps {
  session: AuthSession | null
  onLogout: () => void
}

export function UserMenu({ session, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { hasToken, maskedToken, status, refresh, openModal } = useTiandituTokenStore()
  const userName = session?.user?.displayName || session?.user?.loginName || '用户'
  const initial = userName.slice(0, 1).toUpperCase()

  useEffect(() => {
    if (status === 'idle') void refresh().catch(() => {})
  }, [status, refresh])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center gap-2 rounded-[3px] border border-slate-200 bg-white pl-2 pr-3 text-sm text-slate-600 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/60"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[12px] font-semibold text-blue-700">
          {initial}
        </span>
        <span className="hidden max-w-28 truncate text-[12px] font-medium md:inline">{userName}</span>
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-[8px] border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
            {hasToken ? (
              <div className="mt-2 rounded-[6px] border border-blue-100 bg-blue-50 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-500">天地图 tk 已启用</p>
                <p className="mt-1 font-mono text-xs font-semibold text-blue-700">{maskedToken}</p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">尚未设置天地图 tk</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              openModal()
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.03 5.92l-1.42 1.42h-2.12v2.12H9.06v2.12H5.25v-3.81l7.83-7.83A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            {hasToken ? '更新 tk' : '输入 tk'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="mt-1 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
