import type { Request, Response } from 'express'
import { config } from '../config.js'
import { parseCookieHeader } from './cookies.js'

export const TIANDITU_TOKEN_COOKIE = 'tdt_tk'

const TOKEN_RE = /^[A-Za-z0-9]{16,128}$/
const BASE_URL = 'https://api.tianditu.gov.cn'

export interface TiandituTokenValidation {
  valid: boolean
  message: string
}

export function normalizeTiandituToken(value: unknown): string {
  return String(value || '').trim()
}

export function isTiandituTokenShape(value: string): boolean {
  return TOKEN_RE.test(value)
}

export function maskTiandituToken(value: string): string {
  const token = normalizeTiandituToken(value)
  if (!token) return ''
  if (token.length <= 10) return `${token.slice(0, 2)}****${token.slice(-2)}`
  return `${token.slice(0, 6)}****${token.slice(-4)}`
}

export function getRequestTiandituToken(req: Request): string {
  const cookies = parseCookieHeader(req.headers.cookie)
  return normalizeTiandituToken(cookies[TIANDITU_TOKEN_COOKIE])
}

export function setTiandituTokenCookie(res: Response, token: string) {
  res.cookie(TIANDITU_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.tiandituTokenCookie.secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  })
}

export function clearTiandituTokenCookie(res: Response) {
  res.clearCookie(TIANDITU_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.tiandituTokenCookie.secure,
    path: '/',
  })
}

export async function validateTiandituToken(token: string): Promise<TiandituTokenValidation> {
  const normalized = normalizeTiandituToken(token)
  if (!normalized) {
    return { valid: false, message: '请输入天地图应用密钥 tk' }
  }
  if (!isTiandituTokenShape(normalized)) {
    return { valid: false, message: 'tk 格式不正确，请检查是否复制完整' }
  }

  const params = new URLSearchParams({
    ds: JSON.stringify({ keyWord: '北京' }),
    tk: normalized,
  })

  try {
    const response = await fetch(`${BASE_URL}/geocoder?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(8000),
    })
    const text = (await response.text()).trim()
    if (!response.ok) {
      return { valid: false, message: `天地图校验请求失败：HTTP ${response.status}` }
    }
    if (!text) {
      return { valid: false, message: '天地图返回为空，请稍后重试' }
    }

    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      return { valid: false, message: '天地图返回格式异常，请稍后重试' }
    }

    const code = Number(json?.code ?? json?.status ?? 0)
    const message = String(json?.message || json?.msg || '')
    if (code >= 300000 || /非法|无效|invalid|key|token|tk/i.test(message)) {
      return { valid: false, message: message || 'tk 无效，请确认应用密钥可用' }
    }
    if (json?.location || json?.result || json?.resultType != null || json?.formatted_address) {
      return { valid: true, message: 'tk 校验通过' }
    }

    return { valid: false, message: message || '未能确认 tk 有效，请检查后重试' }
  } catch (err: any) {
    return { valid: false, message: err?.name === 'TimeoutError' ? '天地图校验超时，请稍后重试' : '无法连接天地图校验服务' }
  }
}
