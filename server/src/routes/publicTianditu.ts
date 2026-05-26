import { Router } from 'express'
import { config } from '../config.js'
import tiandituRouter from './tianditu.js'

const PUBLIC_TOKEN_PLACEHOLDER = '__TDT_PUBLIC_SAMPLE_TOKEN__'

const router = Router()

function normalizeBasePath(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed === '/') return ''
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function assertPublicToken() {
  if (!config.publicSamples.tiandituToken) {
    throw new Error('未配置公开样例天地图 tk')
  }
}

function isAllowedTiandituHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'tianditu.gov.cn' || normalized.endsWith('.tianditu.gov.cn')
}

function buildProxyUrl(rawUrl: string): URL {
  const target = new URL(rawUrl)
  if (!['http:', 'https:'].includes(target.protocol) || !isAllowedTiandituHost(target.hostname)) {
    throw new Error('不允许代理该资源地址')
  }
  target.searchParams.set('tk', config.publicSamples.tiandituToken)
  return target
}

function buildTileProxyUrl(hostKey: string, pathAndQuery: string): URL {
  const normalizedHost = String(hostKey || '').trim().toLowerCase()
  if (!/^[a-z0-9-]+$/.test(normalizedHost)) {
    throw new Error('无效瓦片服务主机')
  }

  const target = new URL(`https://${normalizedHost}.tianditu.gov.cn/${pathAndQuery.replace(/^\/+/, '')}`)
  if (!isAllowedTiandituHost(target.hostname)) {
    throw new Error('不允许代理该瓦片地址')
  }
  target.searchParams.set('tk', config.publicSamples.tiandituToken)
  return target
}

function rewriteSdkTileTemplates(js: string): string {
  const basePath = normalizeBasePath(config.publicSamples.basePath)
  const tileProxy = `${basePath}/api/public/tianditu-tile`
  const originExpression = `(globalThis.location&&globalThis.location.origin||'')`

  return js
    .replace(/'https:\/\/\{s\}\.tianditu\.gov\.cn\/tvt'/g, `(${originExpression}+${JSON.stringify(`${tileProxy}/{s}/tvt`)})`)
    .replace(/'https:\/\/\{s\}\.tianditu\.gov\.cn'/g, `(${originExpression}+${JSON.stringify(`${tileProxy}/{s}`)})`)
    .replace(/'https:\/\/lcdata\.tianditu\.gov\.cn\/([^']+)'/g, (_match, path) => {
      return `(${originExpression}+${JSON.stringify(`${tileProxy}/lcdata/${path}`)})`
    })
}

function createSdkRequestInterceptor(): string {
  const basePath = normalizeBasePath(config.publicSamples.basePath)
  const resourceProxy = `${basePath}/api/public/tianditu-resource?url=`
  const publicApiPath = `${basePath}/api/public/`

  return `;(function(){var p=${JSON.stringify(PUBLIC_TOKEN_PLACEHOLDER)};var b=${JSON.stringify(resourceProxy)};var a=${JSON.stringify(publicApiPath)};function q(v){return new URL(v,globalThis.location&&globalThis.location.origin||location.origin).toString()}function r(u){try{var x=new URL(String(u),globalThis.location&&globalThis.location.href||location.href);if(x.pathname.indexOf(a)===0||x.pathname.indexOf('/api/public/')===0){return x.toString()}if(/(^|\\.)tianditu\\.gov\\.cn$/i.test(x.hostname)){if(!x.searchParams.get('tk')||x.searchParams.get('tk')===p){x.searchParams.set('tk',p)}return q(b+encodeURIComponent(x.toString()))}}catch(e){}return u}var f=window.fetch;if(f){window.fetch=function(input,init){if(typeof input==='string'||input instanceof URL){return f.call(this,r(input),init)}if(input&&input.url){return f.call(this,new Request(r(input.url),input),init)}return f.call(this,input,init)}}var o=XMLHttpRequest&&XMLHttpRequest.prototype&&XMLHttpRequest.prototype.open;if(o){XMLHttpRequest.prototype.open=function(m,u){arguments[1]=r(u);return o.apply(this,arguments)}}function s(C,k){try{var d=Object.getOwnPropertyDescriptor(C.prototype,k);if(d&&d.set&&d.get&&!d.__tdtPatched){Object.defineProperty(C.prototype,k,{configurable:true,enumerable:d.enumerable,get:function(){return d.get.call(this)},set:function(v){return d.set.call(this,r(v))}})}}catch(e){}}if(window.HTMLImageElement){s(HTMLImageElement,'src')}if(window.HTMLScriptElement){s(HTMLScriptElement,'src')}if(window.HTMLLinkElement){s(HTMLLinkElement,'href')}var ea=Element&&Element.prototype&&Element.prototype.setAttribute;if(ea){Element.prototype.setAttribute=function(n,v){var k=String(n||'').toLowerCase();if(k==='src'||k==='href'){v=r(v)}return ea.call(this,n,v)}}})();\n`
}

function createMapRequestInterceptor(): string {
  const basePath = normalizeBasePath(config.publicSamples.basePath)
  const resourceProxy = `${basePath}/api/public/tianditu-resource?url=`
  const publicApiPath = `${basePath}/api/public/`
  const rasterTileUrl = `${basePath}/api/public/tianditu-tile/t0/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${PUBLIC_TOKEN_PLACEHOLDER}`

  return `\n;(function(){var p=${JSON.stringify(PUBLIC_TOKEN_PLACEHOLDER)};var b=${JSON.stringify(resourceProxy)};var a=${JSON.stringify(publicApiPath)};var tile=${JSON.stringify(rasterTileUrl)};function q(v){return new URL(v,globalThis.location&&globalThis.location.origin||location.origin).toString()}function r(u){try{var x=new URL(String(u),globalThis.location&&globalThis.location.href||location.href);if(x.pathname.indexOf(a)===0||x.pathname.indexOf('/api/public/')===0){return x.toString()}if(/(^|\\.)tianditu\\.gov\\.cn$/i.test(x.hostname)){if(!x.searchParams.get('tk')||x.searchParams.get('tk')===p){x.searchParams.set('tk',p)}return q(b+encodeURIComponent(x.toString()))}}catch(e){}return u}function addRasterBase(m){var id='__tdt_public_raster_base__';function add(){try{if(!m||!m.addSource||!m.addLayer||m.getSource&&m.getSource(id)){return}var layers=m.getStyle&&m.getStyle().layers||[];var before=layers[0]&&layers[0].id;m.addSource(id,{type:'raster',tiles:[q(tile)],tileSize:256});m.addLayer({id:id,type:'raster',source:id,minzoom:0,maxzoom:18},before)}catch(e){setTimeout(add,300)}}if(m&&m.on){m.on('load',function(){setTimeout(add,0)});setTimeout(add,800)}}function patch(){var g=window.TMapGL;if(!g||!g.Map||g.Map.__tdtPublicSamplePatched){return}var M=g.Map;function W(container,options){options=options||{};var user=options.transformRequest;options=Object.assign({},options,{transformRequest:function(url,type){var result=user?user(url,type):null;if(result&&result.url){return Object.assign({},result,{url:r(result.url)})}return {url:r(url)}}});var map=new M(container,options);addRasterBase(map);return map}try{Object.setPrototypeOf(W,M)}catch(e){}W.prototype=M.prototype;for(var k in M){try{W[k]=M[k]}catch(e){}}W.__tdtPublicSamplePatched=true;g.Map=W}patch();})();\n`
}

router.get('/tianditu-js/v5', async (_req, res, next) => {
  try {
    assertPublicToken()
    const url = `https://api.tianditu.gov.cn/api/v5/js?tk=${encodeURIComponent(config.publicSamples.tiandituToken)}`
    const response = await fetch(url)
    if (!response.ok) {
      return res.status(response.status).type('text/plain').send('天地图 JS SDK 加载失败')
    }

    const sanitized = await response.text()
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(sanitized)
  } catch (err) {
    next(err)
  }
})

router.get('/tianditu-resource', async (req, res, next) => {
  try {
    assertPublicToken()
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : ''
    if (!rawUrl) {
      return res.status(400).json({ success: false, error: '缺少资源地址' })
    }

    const target = buildProxyUrl(rawUrl)
    const response = await fetch(target)
    res.status(response.status)
    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', response.headers.get('cache-control') || 'public, max-age=3600')
    res.send(Buffer.from(await response.arrayBuffer()))
  } catch (err: any) {
    if (err?.message?.includes('不允许') || err instanceof TypeError) {
      return res.status(400).json({ success: false, error: err.message || '无效资源地址' })
    }
    next(err)
  }
})

router.get(/^\/tianditu-tile\/([^/]+)\/(.+)$/, async (req, res, next) => {
  try {
    assertPublicToken()
    const [, hostKey, pathPart] = req.path.match(/^\/tianditu-tile\/([^/]+)\/(.+)$/) || []
    if (!hostKey || !pathPart) {
      return res.status(400).json({ success: false, error: '缺少瓦片地址' })
    }

    const queryIndex = req.originalUrl.indexOf('?')
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex + 1) : ''
    const target = buildTileProxyUrl(hostKey, query ? `${pathPart}?${query}` : pathPart)
    const response = await fetch(target)
    res.status(response.status)
    const contentType = response.headers.get('content-type')
    if (contentType) res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', response.headers.get('cache-control') || 'public, max-age=3600')
    res.send(Buffer.from(await response.arrayBuffer()))
  } catch (err: any) {
    if (err?.message?.includes('不允许') || err?.message?.includes('无效') || err instanceof TypeError) {
      return res.status(400).json({ success: false, error: err.message || '无效瓦片地址' })
    }
    next(err)
  }
})

router.use('/tianditu', (req, _res, next) => {
  ;(req as any).tiandituTokenOverride = config.publicSamples.tiandituToken
  next()
}, tiandituRouter)

export default router
