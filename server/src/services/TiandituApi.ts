import { config } from '../config.js'

const BASE_URL = 'https://api.tianditu.gov.cn'

/**
 * 天地图 Web Service API 封装
 */
export class TiandituApi {
  private token: string

  constructor(token = config.tiandituToken) {
    this.token = token
  }

  /** POI 搜索 */
  async searchPOI(keyword: string, options: {
    mapBound?: string
    level?: number
    queryType?: number
    start?: number
    count?: number
  } = {}) {
    const params = {
      keyWord: keyword,
      level: options.level || 12,
      mapBound: options.mapBound || '73.0,3.0,135.0,54.0',
      queryType: options.queryType || 1,
      start: options.start || 0,
      count: options.count || 20,
    }
    return this.request('/v2/search', params, 'query')
  }

  /** 地名搜索 V2（通用） */
  async searchV2(postStr: Record<string, any>) {
    return this.request('/v2/search', postStr, 'query')
  }

  /** 周边搜索 */
  async searchNearby(keyword: string, lng: number, lat: number, radius = 5000) {
    const params = {
      keyWord: keyword,
      queryType: 3,
      pointLonlat: `${lng},${lat}`,
      queryRadius: radius,
      start: 0,
      count: 20,
    }
    return this.request('/v2/search', params, 'query')
  }

  /** 地理编码 */
  async geocode(address: string) {
    const url = `${BASE_URL}/geocoder?ds=${encodeURIComponent(JSON.stringify({ keyWord: address }))}&tk=${this.token}`
    const resp = await fetch(url)
    return this.parseApiResponse(resp)
  }

  /** 逆地理编码 */
  async reverseGeocode(lng: number, lat: number) {
    const url = `${BASE_URL}/geocoder?postStr=${encodeURIComponent(JSON.stringify({ lon: lng, lat: lat, ver: 1 }))}&type=geocode&tk=${this.token}`
    const resp = await fetch(url)
    return this.parseApiResponse(resp)
  }

  /** 驾车路线规划 */
  async driveRoute(origLng: number, origLat: number, destLng: number, destLat: number, style = '0') {
    const params = {
      orig: `${origLng},${origLat}`,
      dest: `${destLng},${destLat}`,
      style,
    }
    return this.request('/drive', params, 'search')
  }

  /** 公交/地铁路线规划 */
  async transitRoute(
    startLng: number,
    startLat: number,
    endLng: number,
    endLat: number,
    lineType: '1' | '2' | '3' | '4' = '1',
  ) {
    const params = {
      startposition: `${startLng},${startLat}`,
      endposition: `${endLng},${endLat}`,
      linetype: lineType,
    }
    return this.request('/transit', params, 'busline')
  }

  /** 行政区划查询 */
  async administrative(keyword: string, options: { needPolygon?: boolean } = {}) {
    const params = {
      searchWord: keyword,
      searchType: '1',
      needSubInfo: 'false',
      needAll: 'false',
      needPolygon: options.needPolygon !== false ? 'true' : 'false',
      needPre: 'false',
    }
    const url = `${BASE_URL}/administrative?postStr=${encodeURIComponent(JSON.stringify(params))}&tk=${this.token}`
    const resp = await fetch(url)
    return this.parseApiResponse(resp)
  }

  /** 行政区划查询 V2（官方推荐） */
  async administrativeV2(
    keyword: string,
    options: {
      childLevel?: 0 | 1 | 2 | 3
      extensions?: boolean
    } = {},
  ) {
    const childLevel = options.childLevel ?? 0
    const extensions = options.extensions ?? false
    const url = `${BASE_URL}/v2/administrative?keyword=${encodeURIComponent(keyword)}&childLevel=${childLevel}&extensions=${extensions ? 'true' : 'false'}&tk=${this.token}`
    const resp = await fetch(url)
    return this.parseApiResponse(resp)
  }

  private async request(path: string, params: Record<string, any>, type: string) {
    const url = `${BASE_URL}${path}?postStr=${encodeURIComponent(JSON.stringify(params))}&type=${type}&tk=${this.token}`
    const resp = await fetch(url)
    return this.parseApiResponse(resp)
  }

  private async parseApiResponse(resp: Response): Promise<any> {
    const text = await resp.text()
    const trimmed = text.trim()
    if (!trimmed) return {}

    // 天地图多数接口返回 JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return { rawText: trimmed, parseError: 'invalid-json' }
      }
    }

    // drive 接口在部分环境返回 XML，做服务端兼容解析
    if (trimmed.startsWith('<')) {
      const distance = extractXmlTag(trimmed, 'distance')
      const duration = extractXmlTag(trimmed, 'duration')
      const routelatlon = extractXmlTag(trimmed, 'routelatlon')
      const center = extractXmlTag(trimmed, 'center')
      const scale = extractXmlTag(trimmed, 'scale')
      return {
        format: 'xml',
        distance: toFiniteNumber(distance),
        duration: toFiniteNumber(duration),
        routelatlon: routelatlon || '',
        mapinfo: {
          center: center || '',
          scale: scale || '',
        },
        rawXml: trimmed,
      }
    }

    return { rawText: trimmed }
  }
}

function extractXmlTag(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const m = xml.match(re)
  return m?.[1]?.trim() || ''
}

function toFiniteNumber(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
