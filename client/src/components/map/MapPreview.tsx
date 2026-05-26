import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../../stores/useMapStore'
import { useChatStore } from '../../stores/useChatStore'
import { useCodeRunner } from '../../hooks/useCodeRunner'
import { visualQaApi } from '../../services/visualQaApi'
import { runDossierApi } from '../../services/runDossierApi'
import html2canvas from 'html2canvas'
import { isLikelyBlankThumbnailBase64 } from '../../utils/isLikelyBlankThumbnail'
import { installAppFullscreenEnhancer } from '../../utils/appFullscreenEnhancer'
import { useTiandituTokenStore } from '../../stores/useTiandituTokenStore'

interface MapPreviewProps {
  pageFilled?: boolean
  onTogglePageFill?: () => void
}

/** 默认地图 HTML — 展示天安门附近 3D 倾斜视角 */
const DEFAULT_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}
  #map{width:100%;height:100%}
</style>
<script src="https://api.tianditu.gov.cn/api/v5/js?tk=${'${TIANDITU_TOKEN}'}"></script>
</head>
<body>
<div id="map"></div>
<script>
  var map = new TMapGL.Map('map', {
    center: [116.3913, 39.9066],
    zoom: 17,
    pitch: 60,
    bearing: 0,
    doubleClickZoom: true,
    scrollZoom: true,
    touchZoomRotate: true
  });
  map.on('load', function() {
    map.addControl(new TMapGL.NavigationControl(), 'bottom-right');
  });
</script>
</body>
</html>`

const DEFAULT_PREVIEW_TIANDITU_TOKEN = '4043dde46add842282bacc412299311d'

const MIN_CAPTURE_BASE64_LEN = 800
const VISUAL_LOADING_TEXT_RE = /加载中|正在加载|请稍候|请稍等|loading|initializing|rendering|fetching|waiting/i
const MAX_VISUAL_CAPTURE_ATTEMPTS = 8
const VISUAL_CAPTURE_RETRY_WAIT_MS = 900
const VISUAL_DEFERRED_RETRY_DELAY_MS = 3000
const MAX_VISUAL_DEFERRED_RETRIES = 1
const VISUAL_RENDER_MIN_WAIT_MS = 1800
const VISUAL_RENDER_QUIET_MS = 1400
const VISUAL_RENDER_MAX_WAIT_MS = 12000
const VISUAL_RENDER_POLL_MS = 250
const VISUAL_RENDER_STABLE_SAMPLES = 3

function dataUrlToBase64(dataUrl: string): string | null {
  const raw = String(dataUrl || '')
  const marker = ';base64,'
  const idx = raw.indexOf(marker)
  if (idx < 0) return null
  const value = raw.slice(idx + marker.length).trim()
  return value || null
}

function isCaptureValid(base64?: string | null): base64 is string {
  return typeof base64 === 'string' && base64.length >= MIN_CAPTURE_BASE64_LEN
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractVisualText(doc: Document | null | undefined): string {
  const raw = doc?.body?.innerText || doc?.documentElement?.innerText || ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 600)
}

function isLikelyLoadingText(text: string): boolean {
  return VISUAL_LOADING_TEXT_RE.test(String(text || ''))
}

function getRenderState(win: Window | null | undefined): {
  pendingRequests: number
  lastNetworkActivityAt: number
  lastDomMutationAt: number
} {
  const raw = (win as any)?.__codexRenderState || {}
  const now = Date.now()
  return {
    pendingRequests: Math.max(0, Number(raw.pendingRequests || 0)),
    lastNetworkActivityAt: Number(raw.lastNetworkActivityAt || now),
    lastDomMutationAt: Number(raw.lastDomMutationAt || 0),
  }
}

function buildRenderSignature(doc: Document | null | undefined): string {
  if (!doc) return 'no-doc'
  const canvases = Array.from(doc.querySelectorAll('canvas')).map((canvas) => {
    const rect = canvas.getBoundingClientRect?.()
    return [
      Math.round(Number(canvas.width || 0)),
      Math.round(Number(canvas.height || 0)),
      Math.round(Number(rect?.width || 0)),
      Math.round(Number(rect?.height || 0)),
    ].join('x')
  })
  const images = Array.from(doc.images || []).map((img) => [
    img.complete ? '1' : '0',
    Math.round(Number(img.naturalWidth || 0)),
    Math.round(Number(img.naturalHeight || 0)),
  ].join('x'))
  const text = extractVisualText(doc)
  return [
    doc.readyState,
    canvases.join('|'),
    images.join('|'),
    text.length,
    isLikelyLoadingText(text) ? 'loading' : 'ready',
  ].join('::')
}

async function waitForIframeRenderSettled(iframe: HTMLIFrameElement | null): Promise<{
  settled: boolean
  waitMs: number
  pendingRequests: number
  stableSamples: number
  loadingHintDetected: boolean
}> {
  const startedAt = Date.now()
  let stableSamples = 0
  let previousSignature = ''
  let loadingHintDetected = false
  let lastPendingRequests = 0

  while (Date.now() - startedAt < VISUAL_RENDER_MAX_WAIT_MS) {
    const win = iframe?.contentWindow
    const doc = iframe?.contentDocument
    const now = Date.now()
    const state = getRenderState(win)
    const visibleText = extractVisualText(doc)
    const loadingNow = isLikelyLoadingText(visibleText)
    const signature = buildRenderSignature(doc)
    if (loadingNow) loadingHintDetected = true
    lastPendingRequests = state.pendingRequests

    stableSamples = signature === previousSignature ? stableSamples + 1 : 1
    previousSignature = signature

    const elapsed = now - startedAt
    const networkQuietFor = now - state.lastNetworkActivityAt
    const domQuietFor = state.lastDomMutationAt > 0 ? now - state.lastDomMutationAt : Number.POSITIVE_INFINITY
    const documentReady = !doc || doc.readyState === 'complete' || doc.readyState === 'interactive'
    const renderSettled =
      elapsed >= VISUAL_RENDER_MIN_WAIT_MS
      && documentReady
      && state.pendingRequests === 0
      && networkQuietFor >= VISUAL_RENDER_QUIET_MS
      && domQuietFor >= 500
      && stableSamples >= VISUAL_RENDER_STABLE_SAMPLES
      && !loadingNow

    if (renderSettled) {
      return {
        settled: true,
        waitMs: elapsed,
        pendingRequests: state.pendingRequests,
        stableSamples,
        loadingHintDetected,
      }
    }

    await sleep(VISUAL_RENDER_POLL_MS)
  }

  return {
    settled: false,
    waitMs: Date.now() - startedAt,
    pendingRequests: lastPendingRequests,
    stableSamples,
    loadingHintDetected: true,
  }
}

function pickLargestCanvas(doc: Document): { canvas: HTMLCanvasElement | null; count: number; maxArea: number } {
  const canvases = Array.from(doc.querySelectorAll('canvas'))
  if (!canvases.length) return { canvas: null, count: 0, maxArea: 0 }
  let candidate: HTMLCanvasElement | null = null
  let maxArea = 0
  for (const canvas of canvases) {
    const width = Number(canvas.width || canvas.clientWidth || 0)
    const height = Number(canvas.height || canvas.clientHeight || 0)
    const area = width * height
    if (area > maxArea) {
      maxArea = area
      candidate = canvas as HTMLCanvasElement
    }
  }
  return { canvas: candidate, count: canvases.length, maxArea }
}

interface CaptureBounds {
  left: number
  top: number
  width: number
  height: number
}

function getRect(el: Element | null): DOMRect | null {
  if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') return null
  const rect = (el as HTMLElement).getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return rect
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function fillCaptureBackground(ctx: CanvasRenderingContext2D, target: HTMLElement | null, width: number, height: number) {
  let color = '#ffffff'
  try {
    const view = target?.ownerDocument?.defaultView || window
    const computed = target ? view.getComputedStyle(target).backgroundColor : ''
    if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
      color = computed
    }
  } catch {
    // ignore
  }
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
}

async function captureOverlayLayer(
  win: Window,
  doc: Document,
  bounds: CaptureBounds,
): Promise<string | null> {
  const rootEl = (doc.documentElement || doc.body) as HTMLElement | null
  if (!rootEl) return null

  const rendered = await html2canvas(rootEl, {
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: null,
    ignoreElements: (el) => el instanceof HTMLCanvasElement || el.id === 'codex-app-fullscreen-button',
    width: bounds.width,
    height: bounds.height,
    windowWidth: Math.max(bounds.width, win.innerWidth || 0),
    windowHeight: Math.max(bounds.height, win.innerHeight || 0),
    scrollX: win.scrollX || 0,
    scrollY: win.scrollY || 0,
  })

  return dataUrlToBase64(rendered.toDataURL('image/png'))
}

async function captureIframeScreenshot(iframe: HTMLIFrameElement | null): Promise<{
  imageBase64: string
  mode: 'dom' | 'canvas'
  canvasCount: number
  largestCanvasArea: number
  canvasReadable: boolean
  canvasTainted: boolean
}> {
  if (!iframe) throw new Error('预览容器不存在')
  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  if (!win || !doc) throw new Error('预览页面未就绪')

  await new Promise<void>((resolve) => {
    win.requestAnimationFrame(() => resolve())
  })
  await new Promise((resolve) => setTimeout(resolve, 220))

  const canvasMeta = pickLargestCanvas(doc)
  let canvasReadable = false
  let canvasTainted = false
  if (canvasMeta.canvas) {
    try {
      canvasMeta.canvas.toDataURL('image/png')
      canvasReadable = true
    } catch {
      canvasTainted = true
    }
  }

  const rootEl = (doc.documentElement || doc.body) as HTMLElement | null
  const captureBounds: CaptureBounds = {
    left: 0,
    top: 0,
    width: Math.max(320, rootEl?.clientWidth || win.innerWidth || 0),
    height: Math.max(240, rootEl?.clientHeight || win.innerHeight || 0),
  }

  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(captureBounds.width))
  output.height = Math.max(1, Math.round(captureBounds.height))
  const ctx = output.getContext('2d')
  if (!ctx) throw new Error('无法创建截图画布')

  const mapHost = doc.querySelector('#map, #map-container, .map-container, .map, [id*="map"], [class*="map"]') as HTMLElement | null
  fillCaptureBackground(ctx, mapHost, output.width, output.height)

  let drawnCount = 0
  const regionRect = {
    left: captureBounds.left,
    top: captureBounds.top,
    right: captureBounds.left + captureBounds.width,
    bottom: captureBounds.top + captureBounds.height,
  } as DOMRect

  for (const canvas of Array.from(doc.querySelectorAll('canvas'))) {
    const rect = getRect(canvas)
    if (!rect || !rectsIntersect(rect, regionRect)) continue

    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
    const left = Math.max(rect.left, captureBounds.left)
    const top = Math.max(rect.top, captureBounds.top)
    const right = Math.min(rect.right, captureBounds.left + captureBounds.width)
    const bottom = Math.min(rect.bottom, captureBounds.top + captureBounds.height)
    const width = right - left
    const height = bottom - top
    if (width <= 0 || height <= 0) continue

    try {
      ctx.drawImage(
        canvas,
        (left - rect.left) * scaleX,
        (top - rect.top) * scaleY,
        width * scaleX,
        height * scaleY,
        left - captureBounds.left,
        top - captureBounds.top,
        width,
        height,
      )
      drawnCount += 1
      canvasReadable = true
    } catch {
      canvasTainted = true
    }
  }

  let overlayMerged = false
  try {
    const overlayBase64 = await captureOverlayLayer(win, doc, captureBounds)
    if (isCaptureValid(overlayBase64)) {
      const overlayImage = new Image()
      await new Promise<void>((resolve, reject) => {
        overlayImage.onload = () => resolve()
        overlayImage.onerror = () => reject(new Error('DOM 叠加层解码失败'))
        overlayImage.src = `data:image/png;base64,${overlayBase64}`
      })
      ctx.drawImage(overlayImage, 0, 0, output.width, output.height)
      overlayMerged = true
    }
  } catch {
    // ignore and fallback to canvas-only result
  }

  const mergedBase64 = dataUrlToBase64(output.toDataURL('image/png'))
  if (isCaptureValid(mergedBase64)) {
    return {
      imageBase64: mergedBase64,
      mode: overlayMerged ? 'dom' : 'canvas',
      canvasCount: canvasMeta.count,
      largestCanvasArea: canvasMeta.maxArea,
      canvasReadable,
      canvasTainted,
    }
  }

  throw new Error('无法从前端页面捕获有效截图')
}

async function captureVisualInspectionCandidate(iframe: HTMLIFrameElement | null): Promise<{
  imageBase64?: string
  preferServerRender: boolean
  captureMeta: {
    mode?: 'dom' | 'canvas'
    canvasCount?: number
    largestCanvasArea?: number
    canvasReadable?: boolean
    canvasTainted?: boolean
    blankLikely?: boolean
    loadingHintDetected?: boolean
    captureAttempts?: number
    captureFailed?: boolean
    renderWaitMs?: number
    renderSettled?: boolean
    pendingRequests?: number
  }
}> {
  let loadingHintDetected = false
  let lastError: Error | null = null
  let fallbackMeta: {
    mode?: 'dom' | 'canvas'
    canvasCount?: number
    largestCanvasArea?: number
    canvasReadable?: boolean
    canvasTainted?: boolean
    blankLikely?: boolean
    loadingHintDetected?: boolean
    captureAttempts?: number
    captureFailed?: boolean
    renderWaitMs?: number
    renderSettled?: boolean
    pendingRequests?: number
  } = {}

  const readiness = await waitForIframeRenderSettled(iframe)
  loadingHintDetected = readiness.loadingHintDetected || !readiness.settled

  for (let attempt = 1; attempt <= MAX_VISUAL_CAPTURE_ATTEMPTS; attempt += 1) {
    const doc = iframe?.contentDocument
    const visibleText = extractVisualText(doc)
    const loadingNow = isLikelyLoadingText(visibleText)
    if (loadingNow) loadingHintDetected = true

    try {
      const captured = await captureIframeScreenshot(iframe)
      const blankLikely = await isLikelyBlankThumbnailBase64(captured.imageBase64).catch(() => false)
      const taintedLargeMap = captured.mode === 'dom'
        && captured.canvasTainted === true
        && captured.canvasReadable !== true
        && captured.canvasCount > 0
        && captured.largestCanvasArea >= 120000

      fallbackMeta = {
        mode: captured.mode,
        canvasCount: captured.canvasCount,
        largestCanvasArea: captured.largestCanvasArea,
        canvasReadable: captured.canvasReadable,
        canvasTainted: captured.canvasTainted,
        blankLikely,
        loadingHintDetected,
        captureAttempts: attempt,
        renderWaitMs: readiness.waitMs,
        renderSettled: readiness.settled,
        pendingRequests: readiness.pendingRequests,
      }

      const shouldRetry = attempt < MAX_VISUAL_CAPTURE_ATTEMPTS && (loadingNow || blankLikely)
      if (!shouldRetry) {
        return {
          imageBase64: captured.imageBase64,
          preferServerRender: taintedLargeMap && blankLikely,
          captureMeta: fallbackMeta,
        }
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err || '未知错误'))
      fallbackMeta = {
        ...fallbackMeta,
        loadingHintDetected,
        captureAttempts: attempt,
        captureFailed: true,
        renderWaitMs: readiness.waitMs,
        renderSettled: readiness.settled,
        pendingRequests: readiness.pendingRequests,
      }
    }

    if (attempt < MAX_VISUAL_CAPTURE_ATTEMPTS) {
      await sleep(VISUAL_CAPTURE_RETRY_WAIT_MS)
    }
  }

  if (lastError) {
    return {
      preferServerRender: true,
      captureMeta: {
        ...fallbackMeta,
        captureFailed: true,
      },
    }
  }

  throw new Error('无法从前端页面捕获有效截图')
}

export function MapPreview(props: MapPreviewProps) {
  const {
    currentRunId,
    previewCode,
    currentCode,
    codeStreaming,
    executing,
    execError,
    fixing,
    fixingSource,
    fixRetryCount,
    visualChecking,
    visualFixRetryCount,
    lastVisualCheckedCodeHash,
  } = useMapStore()
  const { status: tokenStatus, hasToken, token: tiandituToken, refresh: refreshToken } = useTiandituTokenStore()
  const { iframeRef, run, activeRunIdRef } = useCodeRunner()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [showError, setShowError] = useState(true)
  const fixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visualRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visualInFlightRef = useRef(false)
  const queuedVisualCodeHashRef = useRef<string | null>(null)
  const thumbnailInFlightRef = useRef(false)
  const defaultLoaded = useRef(false)
  const deferredVisualRetryRef = useRef<{ codeHash: string; count: number }>({ codeHash: '', count: 0 })
  const [visualRetryNonce, setVisualRetryNonce] = useState(0)
  const MAX_FIX_RETRIES = 2
  const MAX_VISUAL_FIX_RETRIES = 2
  const VISUAL_STABLE_DELAY_MS = 1200
  const THUMBNAIL_CACHE_DELAY_MS = 700
  const MAX_THUMBNAIL_CAPTURE_ATTEMPTS = 4
  const THUMBNAIL_RETRY_WAIT_MS = 900
  const renderCode = previewCode || currentCode
  const previewing = Boolean(previewCode && codeStreaming)
  const pageFilled = Boolean(props.pageFilled)

  useEffect(() => {
    if (tokenStatus === 'idle') void refreshToken().catch(() => {})
  }, [tokenStatus, refreshToken])

  const hashCode = (text: string) => {
    let hash = 2166136261
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i)
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    return `h${(hash >>> 0).toString(16)}`
  }

  const scheduleDeferredVisualRetry = (codeHash: string) => {
    const entry = deferredVisualRetryRef.current.codeHash === codeHash
      ? deferredVisualRetryRef.current
      : { codeHash, count: 0 }

    if (entry.count >= MAX_VISUAL_DEFERRED_RETRIES) return false
    deferredVisualRetryRef.current = { codeHash, count: entry.count + 1 }

    if (visualRetryTimerRef.current) {
      clearTimeout(visualRetryTimerRef.current)
      visualRetryTimerRef.current = null
    }

    visualRetryTimerRef.current = setTimeout(() => {
      const latestState = useMapStore.getState()
      if (!latestState.currentCode) return
      if (hashCode(latestState.currentCode) !== codeHash) return
      latestState.markVisualChecked(null)
      setVisualRetryNonce((value) => value + 1)
    }, VISUAL_DEFERRED_RETRY_DELAY_MS)

    return true
  }

  // 加载默认地图或用户代码
  useEffect(() => {
    if (!hasToken || !tiandituToken) {
      if (!defaultLoaded.current) {
        run(DEFAULT_MAP_HTML.replace(/\$\{TIANDITU_TOKEN\}/g, DEFAULT_PREVIEW_TIANDITU_TOKEN))
        defaultLoaded.current = true
      }
      return
    }
    if (renderCode) {
      run(renderCode)
      defaultLoaded.current = false
    } else if (!defaultLoaded.current) {
      // 没有用户代码时显示默认地图（同样注入错误捕获脚本）
      run(DEFAULT_MAP_HTML.replace(/\$\{TIANDITU_TOKEN\}/g, tiandituToken))
      defaultLoaded.current = true
    }
  }, [renderCode, run, iframeRef, hasToken, tiandituToken])

  // 监听 iframe 错误
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'map-error') {
        const runId = typeof e.data.runId === 'string' ? e.data.runId : ''
        if (!runId || runId !== activeRunIdRef.current) {
          return
        }
        const src = typeof e.data.src === 'string' ? e.data.src : ''
        const line = typeof e.data.line === 'number' ? e.data.line : 0
        const col = typeof e.data.col === 'number' ? e.data.col : 0
        const kind = typeof e.data.kind === 'string' ? e.data.kind : ''
        const requestUrl = typeof e.data.requestUrl === 'string' ? e.data.requestUrl : ''
        const method = typeof e.data.method === 'string' ? e.data.method : ''
        const status = typeof e.data.status === 'number' ? e.data.status : 0
        const kindInfo = kind ? `\n类型: ${kind}` : ''
        const requestInfo = requestUrl || method || status
          ? `\n请求: ${method ? `${method} ` : ''}${requestUrl || '[unknown]'}${status ? ` (${status})` : ''}`
          : ''
        const location = src ? `\n来源: ${src}${line ? `:${line}` : ''}${col ? `:${col}` : ''}` : ''
        const finalMessage = `${e.data.message || '执行错误'}${kindInfo}${requestInfo}${location}`
        useMapStore.getState().setExecError(finalMessage)
        const latestState = useMapStore.getState()
        if (latestState.currentRunId) {
          const codeHash = latestState.currentCode ? hashCode(latestState.currentCode) : ''
          void runDossierApi.reportRuntimeError({
            runId: latestState.currentRunId,
            previewRunId: runId,
            message: finalMessage,
            kind,
            src,
            line,
            col,
            requestUrl,
            method,
            status,
            codeHash,
          }).catch((err) => {
            console.warn('[MapPreview] runtime error dossier report failed:', err?.message || err)
          })
        }
        latestState.setVisualChecking(false)
        visualInFlightRef.current = false
        setShowError(true)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [activeRunIdRef])

  // 统一将全屏能力挂到“整页应用”，而不是仅放大地图容器。
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    let cleanup = () => {}

    const installEnhancer = () => {
      cleanup()
      cleanup = installAppFullscreenEnhancer(iframe.contentDocument, { showButton: false })
    }

    iframe.addEventListener('load', installEnhancer)
    installEnhancer()

    return () => {
      iframe.removeEventListener('load', installEnhancer)
      cleanup()
    }
  }, [iframeRef])

  useEffect(() => {
    if (!pageFilled) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [pageFilled])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (pageFilled) {
        event.preventDefault()
        props.onTogglePageFill?.()
      }
    }

    const bindWindow = (target: Window | null | undefined) => {
      if (!target) return () => {}
      target.addEventListener('keydown', handleEscape)
      return () => target.removeEventListener('keydown', handleEscape)
    }

    const iframe = iframeRef.current
    let cleanupFrameWindow = bindWindow(iframe?.contentWindow)

    const handleFrameLoad = () => {
      cleanupFrameWindow()
      cleanupFrameWindow = bindWindow(iframe?.contentWindow)
    }

    window.addEventListener('keydown', handleEscape)
    iframe?.addEventListener('load', handleFrameLoad)

    return () => {
      window.removeEventListener('keydown', handleEscape)
      iframe?.removeEventListener('load', handleFrameLoad)
      cleanupFrameWindow()
    }
  }, [iframeRef, pageFilled, props.onTogglePageFill])

  // 错误出现时自动触发修复（延迟 1.5s，避免瞬间错误）
  useEffect(() => {
    if (fixTimerRef.current) {
      clearTimeout(fixTimerRef.current)
      fixTimerRef.current = null
    }

    if (previewing) {
      return () => {
        if (fixTimerRef.current) {
          clearTimeout(fixTimerRef.current)
          fixTimerRef.current = null
        }
      }
    }

    if (execError) {
      setShowError(true)
      if (!fixing && fixRetryCount < MAX_FIX_RETRIES) {
        fixTimerRef.current = setTimeout(() => {
          useChatStore.getState().autoFixMapError()
        }, 1500)
      }
    }

    return () => {
      if (fixTimerRef.current) {
        clearTimeout(fixTimerRef.current)
        fixTimerRef.current = null
      }
    }
  }, [execError, fixing, fixRetryCount, previewing])

  // 渲染稳定后先在前端后台缓存一份缩略图，分享时直接复用，不再点击后临时抓图
  useEffect(() => {
    if (thumbnailTimerRef.current) {
      clearTimeout(thumbnailTimerRef.current)
      thumbnailTimerRef.current = null
    }

    if (previewing) return
    if (!currentCode || executing || fixing || execError) return
    if (useMapStore.getState().shareThumbnailBase64) return

    thumbnailTimerRef.current = setTimeout(async () => {
      const state = useMapStore.getState()
      if (state.previewCode && state.codeStreaming) return
      if (!state.currentCode || state.executing || state.fixing || state.execError) return
      if (state.shareThumbnailBase64 || thumbnailInFlightRef.current) return

      thumbnailInFlightRef.current = true
      try {
        for (let attempt = 0; attempt < MAX_THUMBNAIL_CAPTURE_ATTEMPTS; attempt += 1) {
          const latestState = useMapStore.getState()
          if (latestState.previewCode && latestState.codeStreaming) return
          if (!latestState.currentCode || latestState.executing || latestState.fixing || latestState.execError) return

          const captured = await captureIframeScreenshot(iframeRef.current)
          const blank = await isLikelyBlankThumbnailBase64(captured.imageBase64)
          if (!blank) {
            useMapStore.getState().setShareThumbnailBase64(captured.imageBase64)
            return
          }

          if (attempt < MAX_THUMBNAIL_CAPTURE_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_RETRY_WAIT_MS))
          }
        }
        console.warn('[MapPreview] 分享缩略图多次采样后仍为空白，本次分享将退回 SVG 占位图')
      } catch (err: any) {
        console.warn('[MapPreview] 分享缩略图后台缓存失败，本次分享将退回 SVG 占位图:', err?.message || err)
      } finally {
        thumbnailInFlightRef.current = false
      }
    }, THUMBNAIL_CACHE_DELAY_MS)

    return () => {
      if (thumbnailTimerRef.current) {
        clearTimeout(thumbnailTimerRef.current)
        thumbnailTimerRef.current = null
      }
    }
  }, [currentCode, execError, executing, fixing, iframeRef, previewing])

    // 渲染稳定后自动触发视觉检查
  useEffect(() => {
    deferredVisualRetryRef.current = { codeHash: '', count: 0 }
    if (!visualInFlightRef.current) {
      queuedVisualCodeHashRef.current = null
    }
    if (visualRetryTimerRef.current) {
      clearTimeout(visualRetryTimerRef.current)
      visualRetryTimerRef.current = null
    }
  }, [currentCode])

  useEffect(() => {
    if (visualTimerRef.current) {
      clearTimeout(visualTimerRef.current)
      visualTimerRef.current = null
    }

    if (previewing) return
    if (!currentCode || executing || fixing || execError) return
    if (visualFixRetryCount >= MAX_VISUAL_FIX_RETRIES) return

    const codeHash = hashCode(currentCode)
    if (lastVisualCheckedCodeHash === codeHash) return

    visualTimerRef.current = setTimeout(async () => {
      const state = useMapStore.getState()
      if (state.previewCode && state.codeStreaming) return
      if (!state.currentCode || state.executing || state.fixing || state.execError) return
      if (visualInFlightRef.current) {
        queuedVisualCodeHashRef.current = codeHash
        return
      }

      queuedVisualCodeHashRef.current = null
      visualInFlightRef.current = true
      useMapStore.getState().setVisualChecking(true, 'inspection')

      try {
        const messages = useChatStore.getState().messages
        const latestUser = [...messages].reverse().find((m) => m.role === 'user')
        const hint = latestUser?.content?.trim() || ''
        const runId = `${Date.now()}-${codeHash.slice(0, 8)}`
        const inspectionRunId = state.currentRunId || ''
        const capture = await captureVisualInspectionCandidate(iframeRef.current)
        const captureMeta = capture.captureMeta
        if (capture.imageBase64) {
          useMapStore.getState().setShareThumbnailBase64(capture.imageBase64)
        } else {
          useMapStore.getState().setShareThumbnailBase64(null)
        }
        const result = await visualQaApi.inspect({
          code: state.currentCode,
          imageBase64: capture.preferServerRender ? undefined : capture.imageBase64,
          dossierRunId: state.currentRunId || undefined,
          captureMeta,
          hint,
          runId,
        })

        const latestState = useMapStore.getState()
        const latestCodeHash = latestState.currentCode ? hashCode(latestState.currentCode) : ''
        const requestBecameStale =
          latestCodeHash !== codeHash
          || useChatStore.getState().loading
          || (inspectionRunId && latestState.currentRunId !== inspectionRunId)

        if (latestState.execError || latestState.executing || requestBecameStale) return

        if (result.status === 'unavailable') {
          if (captureMeta.loadingHintDetected && scheduleDeferredVisualRetry(codeHash)) {
            useChatStore.getState().addAssistantMessage([
              '视觉检查结果：暂缓',
              `诊断：${result.diagnosis}`,
              `页面仍处于加载阶段，${Math.round(VISUAL_DEFERRED_RETRY_DELAY_MS / 1000)} 秒后自动重试一次。`,
            ].join('\n'))
            return
          }
          useMapStore.getState().markVisualChecked(codeHash)
          useChatStore.getState().addAssistantMessage([
            '视觉检查结果：不可用',
            `诊断：${result.diagnosis}`,
            '本轮不会触发自动补修。',
          ].join('\n'))
          return
        }

        if (!result.anomalous) {
          useMapStore.getState().markVisualChecked(codeHash)
          useChatStore.getState().addAssistantMessage([
            '视觉检查结果：通过',
            `结论：${result.summary}`,
            `说明：${result.diagnosis}`,
          ].join('\n'))
          return
        }

        if (!result.shouldRepair) {
          useMapStore.getState().markVisualChecked(codeHash)
          useChatStore.getState().addAssistantMessage([
            `视觉检查结果：发现异常（${result.severity}）`,
            `结论：${result.summary}`,
            `诊断：${result.diagnosis}`,
            '当前无需触发自动补修。',
          ].join('\n'))
          return
        }

        useMapStore.getState().markVisualChecked(codeHash)
        useChatStore.getState().addAssistantMessage([
          `视觉检查结果：发现异常（${result.severity}）`,
          `结论：${result.summary}`,
          `诊断：${result.diagnosis}`,
          '系统将触发视觉回灌补修。',
        ].join('\n'))

        const retryState = useMapStore.getState()
        if (retryState.visualFixRetryCount >= MAX_VISUAL_FIX_RETRIES) {
          useChatStore.getState().addAssistantMessage(`视觉自动补修已达到上限（${MAX_VISUAL_FIX_RETRIES} 轮），本次不再继续。`)
          return
        }

        const repairError = [
          `[视觉检查异常] 严重级别: ${result.severity}`,
          `结论: ${result.summary}`,
          `诊断: ${result.diagnosis}`,
          `修复建议: ${result.repairHint}`,
        ].join('\n')

        useMapStore.getState().setVisualChecking(true, 'repair')
        await useChatStore.getState().autoFixMapError({
          source: 'visual',
          overrideError: repairError,
          userInputHint: '请根据视觉检查结果做最小改动修复，优先修复渲染异常并保持现有布局与功能。',
        })
      } catch (err: any) {
        useChatStore.getState().addAssistantMessage(`视觉检查执行失败：${err?.message || '未知错误'}`)
      } finally {
        useMapStore.getState().setVisualChecking(false)
        visualInFlightRef.current = false

        const latestState = useMapStore.getState()
        const latestCodeHash = latestState.currentCode ? hashCode(latestState.currentCode) : ''
        const queuedHash = queuedVisualCodeHashRef.current
        const shouldReplayQueuedInspection =
          !!queuedHash
          && queuedHash === latestCodeHash
          && queuedHash !== codeHash
          && !latestState.previewCode
          && !latestState.codeStreaming
          && !latestState.executing
          && !latestState.fixing
          && !latestState.execError

        if (shouldReplayQueuedInspection) {
          queuedVisualCodeHashRef.current = null
          setVisualRetryNonce((value) => value + 1)
        }
      }
    }, VISUAL_STABLE_DELAY_MS)

    return () => {
      if (visualTimerRef.current) {
        clearTimeout(visualTimerRef.current)
        visualTimerRef.current = null
      }
    }
  }, [
    currentCode,
    currentRunId,
    previewing,
    executing,
    fixing,
    execError,
    lastVisualCheckedCodeHash,
    visualFixRetryCount,
    visualRetryNonce,
  ])

  useEffect(() => {
    return () => {
      if (visualTimerRef.current) {
        clearTimeout(visualTimerRef.current)
        visualTimerRef.current = null
      }
      if (visualRetryTimerRef.current) {
        clearTimeout(visualRetryTimerRef.current)
        visualRetryTimerRef.current = null
      }
      queuedVisualCodeHashRef.current = null
    }
  }, [])

  const retriesExhausted = !fixing && execError && fixRetryCount >= MAX_FIX_RETRIES
  const fixingAttempt = fixingSource === 'visual' ? visualFixRetryCount + 1 : fixRetryCount + 1
  const fixingMax = fixingSource === 'visual' ? MAX_VISUAL_FIX_RETRIES : MAX_FIX_RETRIES

  return (
    <div
      ref={shellRef}
      className={`relative overflow-hidden bg-white ${
        pageFilled
          ? 'w-full h-full z-[20] shadow-2xl shadow-slate-900/20'
          : 'w-full h-full'
      }`}
    >
      {/* iframe — 始终可见（默认地图或用户代码） */}
      <iframe
        ref={iframeRef}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen"
        allowFullScreen
        title="地图预览"
      />

      {/* 渲染中指示器 */}
      {executing && (
        <div className="absolute top-3 right-28 animate-fade-in">
          <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md shadow-lg shadow-black/5 border border-gray-200/60 text-blue-600 text-xs font-medium px-3 py-2 rounded-xl soft-surface">
            <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
            渲染地图中...
          </div>
        </div>
      )}

      {/* 视觉检查阻塞层（按方案要求前台阻塞） */}
      {visualChecking && !fixing && (
        <div className="visual-inspect-overlay absolute inset-0 z-[9] pointer-events-auto">
          <div className="visual-inspect-haze" />

          <div className="visual-inspect-grid visual-inspect-grid-ne" />
          <div className="visual-inspect-grid visual-inspect-grid-nw" />
          <div className="visual-inspect-grid visual-inspect-grid-se" />
          <div className="visual-inspect-grid visual-inspect-grid-sw" />

          <div className="visual-inspect-glow visual-inspect-glow-ne" />
          <div className="visual-inspect-glow visual-inspect-glow-nw" />
          <div className="visual-inspect-glow visual-inspect-glow-se" />
          <div className="visual-inspect-glow visual-inspect-glow-sw" />

          <div className="visual-inspect-scanline" />

          <div className="visual-inspect-center">
            <div className="visual-inspect-chip">
              <div className="visual-inspect-chip-title">视觉检查中</div>
              <div className="visual-inspect-chip-subtitle">正在采样地图画面并进行一致性分析</div>
              <div className="visual-inspect-progress" />
            </div>
          </div>
        </div>
      )}

      {/* 自动修复中指示器 */}
      {fixing && (
        <div className="absolute top-3 right-28 animate-fade-in z-10">
          <div className="flex items-center gap-2 bg-amber-50/95 backdrop-blur-md shadow-lg shadow-amber-500/10 border border-amber-200/60 text-amber-700 text-xs font-medium px-3 py-2 rounded-xl soft-surface">
            <div className="w-3.5 h-3.5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
            {fixingSource === 'visual' ? '正在视觉回灌补修' : '正在自动修复'} ({fixingAttempt}/{fixingMax})...
          </div>
        </div>
      )}

      {/* 视觉检查中指示器（前台阻塞） */}
      {visualChecking && !fixing && (
        <div className="absolute top-3 right-28 animate-fade-in z-10">
          <div className="flex items-center gap-2 bg-slate-950/70 backdrop-blur-xl shadow-lg shadow-indigo-900/30 border border-indigo-300/20 text-indigo-100 text-xs font-medium px-3 py-2 rounded-xl soft-surface">
            <div className="w-3.5 h-3.5 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
            正在进行视觉检查...
          </div>
        </div>
      )}

      {/* 错误提示 — 修复中时隐藏 */}
      {execError && showError && !fixing && (
        <div className="absolute bottom-3 left-3 right-3 animate-slide-up">
          <div className={`backdrop-blur-md border px-4 py-3 rounded-xl shadow-lg flex items-start gap-3 ${
            retriesExhausted
              ? 'bg-orange-50/95 border-orange-200/60 text-orange-600 shadow-orange-500/5'
              : 'bg-red-50/95 border-red-200/60 text-red-600 shadow-red-500/5'
          } soft-surface`}>
            <svg className={`w-4 h-4 mt-0.5 shrink-0 ${retriesExhausted ? 'text-orange-400' : 'text-red-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium mb-0.5 ${retriesExhausted ? 'text-orange-700' : 'text-red-700'}`}>
                {retriesExhausted ? '自动修复未能解决此错误' : '执行错误'}
              </p>
              <p className={`text-[11px] leading-relaxed break-all ${retriesExhausted ? 'text-orange-500' : 'text-red-500'}`}>
                {execError}
              </p>
              {retriesExhausted && (
                <p className="text-[11px] text-orange-400 mt-1">
                  已尝试 {MAX_FIX_RETRIES} 次修复，请尝试在对话中描述问题以获取帮助
                </p>
              )}
            </div>
            <button
              onClick={() => setShowError(false)}
              className={`${retriesExhausted ? 'text-orange-300 hover:text-orange-500' : 'text-red-300 hover:text-red-500'} soft-pop shrink-0 p-0.5`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
