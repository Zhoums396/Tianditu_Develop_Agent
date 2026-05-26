import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { chromium } from 'playwright-core'
import { AsyncLimiter, normalizeConcurrencyLimit } from '../utils/AsyncLimiter.js'

export interface VisualRenderServiceOptions {
  enabled: boolean
  baseUrl: string
  snapshotsDir: string
  chromiumPath?: string
  timeoutMs: number
  waitAfterLoadMs: number
  viewportWidth: number
  viewportHeight: number
  maxConcurrentRenders?: number
}

export interface VisualRenderInput {
  code: string
  runId?: string
}

export interface VisualRenderResult {
  ok: boolean
  reason?: string
  imageBase64?: string
}

function normalizeErrText(input: unknown): string {
  return String(input || '').replace(/\s+/g, ' ').trim()
}

function isWebGlUnavailableSignal(text: string): boolean {
  const value = normalizeErrText(text)
  if (!value) return false
  return /failed to initialize webgl|webglcontextcreationerror|could not create a webgl context|webgl context/i.test(value)
}

function pickChromiumExecutablePath(configPath?: string): string | undefined {
  const explicit = String(configPath || '').trim()
  if (explicit) return explicit

  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return undefined
}

function sanitizeRunId(input?: string): string {
  const raw = String(input || '').trim()
  if (!raw) return randomUUID().slice(0, 12)
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || randomUUID().slice(0, 12)
}

function ensureHtmlDoc(code: string): string {
  const html = String(code || '').trim()
  if (!html) return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
  if (/<html[\s>]/i.test(html)) return html
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
}

export class VisualRenderService {
  private readonly opts: VisualRenderServiceOptions
  private readonly limiter: AsyncLimiter

  constructor(opts: VisualRenderServiceOptions) {
    this.opts = opts
    this.limiter = new AsyncLimiter(normalizeConcurrencyLimit(opts.maxConcurrentRenders, 2))
  }

  async render(input: VisualRenderInput): Promise<VisualRenderResult> {
    return this.limiter.run(async () => {
      if (!this.opts.enabled) {
        return { ok: false, reason: 'visual inspection disabled' }
      }

      const origin = String(this.opts.baseUrl || '').replace(/\/+$/, '')
      if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
        return { ok: false, reason: 'invalid visual inspection base url' }
      }

      const timeout = Number.isFinite(this.opts.timeoutMs) ? Math.max(8000, this.opts.timeoutMs) : 30000
      const waitAfterLoadMs = Number.isFinite(this.opts.waitAfterLoadMs) ? Math.max(500, this.opts.waitAfterLoadMs) : 2200
      const viewportWidth = Number.isFinite(this.opts.viewportWidth) ? Math.max(960, this.opts.viewportWidth) : 1440
      const viewportHeight = Number.isFinite(this.opts.viewportHeight) ? Math.max(540, this.opts.viewportHeight) : 900

      const runPart = sanitizeRunId(input.runId)
      const folderName = `diagnostics/${Date.now()}-${runPart}-${randomUUID().slice(0, 8)}`
      const targetDir = resolve(this.opts.snapshotsDir, folderName)
      const htmlPath = resolve(targetDir, 'index.html')
      const pageUrl = `${origin}/share-assets/${folderName}/index.html`
      const executablePath = pickChromiumExecutablePath(this.opts.chromiumPath)
      const expectsTMapGL = /TMapGL|api\.tianditu\.gov\.cn\/api\/v5\/js/i.test(input.code || '')

      let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
      try {
        await mkdir(targetDir, { recursive: true })
        await writeFile(htmlPath, ensureHtmlDoc(input.code), 'utf-8')

        browser = await chromium.launch({
          headless: true,
          executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--use-gl=swiftshader',
            '--use-angle=swiftshader',
            '--font-render-hinting=medium',
          ],
        })

        const context = await browser.newContext({
          viewport: { width: viewportWidth, height: viewportHeight },
          deviceScaleFactor: 1,
        })
        const page = await context.newPage()
        const runtimeErrors: string[] = []
        let mainDocStatus: number | undefined
        page.setDefaultTimeout(timeout)
        page.setDefaultNavigationTimeout(timeout)
        page.on('pageerror', (err) => {
          runtimeErrors.push(normalizeErrText((err as any)?.message || err))
        })
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            runtimeErrors.push(normalizeErrText(msg.text()))
          }
        })

        const nav = await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })
        mainDocStatus = nav?.status()
        if (mainDocStatus && mainDocStatus >= 400) {
          return { ok: false, reason: `visual page load failed: HTTP ${mainDocStatus}` }
        }
        await page.waitForTimeout(900)
        await page.waitForResponse((res) => {
          const u = res.url()
          return /tianditu\.gov\.cn/i.test(u) && res.ok()
        }, { timeout: Math.min(timeout, 12000) }).catch(() => undefined)
        await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) }).catch(() => undefined)
        await page.waitForTimeout(waitAfterLoadMs)

        const imageBuffer = await page.screenshot({
          type: 'png',
          animations: 'disabled',
        })

        await context.close()
        await browser.close()
        browser = null

        const hasWebGlError = runtimeErrors.some(isWebGlUnavailableSignal)
        if (expectsTMapGL && hasWebGlError) {
          return {
            ok: false,
            reason: '视觉检查运行环境不支持 WebGL，无法可靠渲染天地图截图。',
          }
        }

        return {
          ok: true,
          imageBase64: imageBuffer.toString('base64'),
        }
      } catch (err: any) {
        return {
          ok: false,
          reason: err?.message || 'visual render failed',
        }
      } finally {
        if (browser) {
          try {
            await browser.close()
          } catch {
            // ignore
          }
        }
        await rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }
}
