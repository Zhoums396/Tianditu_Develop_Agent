import { Router } from 'express'

const router = Router()

const PREVIEW_TOKEN = process.env.TIANDITU_PREVIEW_TK || '4043dde46add842282bacc412299311d'
const TILE_LAYER_MAP: Record<string, string> = {
  vec: 'vec_w',
  cva: 'cva_w',
}

function pickTileHost(z: number, x: number, y: number) {
  const index = Math.abs((z * 13 + x * 7 + y) % 8)
  return `https://t${index}.tianditu.gov.cn`
}

router.get('/tiles/:layer/:z/:x/:y.png', async (req, res) => {
  const tileLayer = TILE_LAYER_MAP[req.params.layer]
  const z = Number(req.params.z)
  const x = Number(req.params.x)
  const y = Number(req.params.y)

  if (!tileLayer || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 1 || z > 18 || x < 0 || y < 0) {
    res.status(400).json({ success: false, error: 'Invalid tile request' })
    return
  }

  const params = new URLSearchParams({
    T: tileLayer,
    x: String(x),
    y: String(y),
    l: String(z),
    tk: PREVIEW_TOKEN,
  })
  const url = `${pickTileHost(z, x, y)}/DataServer?${params.toString()}`
  const referer = req.get('referer') || `${req.protocol}://${req.get('host') || 'localhost'}/`

  try {
    const upstream = await fetch(url, {
      headers: {
        'Referer': referer,
        'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
      },
    })
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).end()
      return
    }

    const contentType = upstream.headers.get('content-type') || 'image/png'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.send(buffer)
  } catch (error) {
    res.status(502).json({ success: false, error: 'Failed to load preview tile' })
  }
})

export default router
