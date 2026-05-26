import { Router } from 'express'
import {
  clearTiandituTokenCookie,
  getRequestTiandituToken,
  maskTiandituToken,
  normalizeTiandituToken,
  setTiandituTokenCookie,
  validateTiandituToken,
} from '../utils/tiandituToken.js'

const router = Router()

router.get('/status', (req, res) => {
  const token = getRequestTiandituToken(req)
  res.json({
    success: true,
    data: {
      hasToken: !!token,
      maskedToken: token ? maskTiandituToken(token) : '',
      token,
    },
  })
})

router.post('/validate', async (req, res) => {
  const token = normalizeTiandituToken(req.body?.token)
  const validation = await validateTiandituToken(token)
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.message, data: validation })
    return
  }

  setTiandituTokenCookie(res, token)
  res.json({
    success: true,
    data: {
      hasToken: true,
      maskedToken: maskTiandituToken(token),
      token,
      message: validation.message,
    },
  })
})

router.delete('/', (_req, res) => {
  clearTiandituTokenCookie(res)
  res.json({
    success: true,
    data: {
      hasToken: false,
      maskedToken: '',
    },
  })
})

export default router
