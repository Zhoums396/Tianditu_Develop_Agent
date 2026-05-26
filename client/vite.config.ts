import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function normalizeBasePath(value: string | undefined) {
  const raw = (value || '/').trim()
  if (!raw || raw === '/') return '/'
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`
}

function contentType(filePath: string) {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.xml':
      return 'application/xml; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function docsStaticDevPlugin() {
  const docsRoot = resolve(__dirname, 'public', 'docs')

  return {
    name: 'docs-static-dev',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const requestUrl = (req.url || '').split('?')[0]
        if (!requestUrl.startsWith('/docs')) {
          next()
          return
        }

        const relativePath = requestUrl === '/docs' || requestUrl === '/docs/'
          ? 'index.html'
          : requestUrl.replace(/^\/docs\/?/, '')

        const candidates = [
          resolve(docsRoot, relativePath),
          resolve(docsRoot, relativePath, 'index.html'),
        ]

        const filePath = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
        if (!filePath) {
          next()
          return
        }

        res.setHeader('Content-Type', contentType(filePath))
        res.end(readFileSync(filePath))
      })
    },
  }
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss(), docsStaticDevPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api/chat/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
        // SSE 专用配置：超长超时 + 关闭缓冲
        timeout: 300000, // 5 分钟
        proxyTimeout: 300000,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, _req, res) => {
            // 禁用 Node.js 响应缓冲，让 SSE chunk 立即到达前端
            (res as any).flushHeaders?.()
          })
        },
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
      '/share-assets': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        xfwd: true,
      },
      '/sso': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
})
