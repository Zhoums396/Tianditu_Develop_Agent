export interface ContractDescriptor {
  id: string
  title: string
  triggers: RegExp[]
  required: string[]
  responseChecks: string[]
  forbidden: string[]
}

export interface ContractSelectionInput {
  userInput: string
  conversationHistory?: string
  loadedSkills?: string[]
  runtimeError?: string
  mode: 'generate' | 'fix'
}

export const CONTRACT_REGISTRY: ContractDescriptor[] = [
  {
    id: 'geocode',
    title: '地理编码（地址 -> 坐标）',
    triggers: [/地理编码|地址转坐标|geocode|开弦弓村|坐标是什么|查坐标/i],
    required: [
      '优先调用代理：GET /api/tianditu/geocode?address=<地址>',
      '若直接解释官方协议，只能说明 /geocoder?ds=JSON，不可写成 address= 参数',
      '请求前对地址做非空校验；地址为空时直接提示，不发请求',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '地理编码成功条件：String(res.data.status) === "0" 且 res.data.location 存在',
      '坐标容错：Number(lon)/Number(lat) 后再使用 toFixed/地图定位',
    ],
    forbidden: [
      '禁止使用 /v5/geocoder',
      '禁止在运行时代码中写 https://api.tianditu.gov.cn/geocoder?address=...',
      '禁止假设正向编码会返回 addressComponent',
    ],
  },
  {
    id: 'reverse-geocode',
    title: '逆地理编码（坐标 -> 地址）',
    triggers: [/逆地理|坐标转地址|reverse geocode|反向地理编码/i],
    required: [
      '优先调用代理：GET /api/tianditu/reverse-geocode?lng=<经度>&lat=<纬度>',
      '坐标参数必须是有限数字；非法坐标直接拦截',
      '优先读取 res.data.result.formatted_address 与 result.addressComponent',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '逆地理成功条件：String(res.data.status) === "0" 且 res.data.result 存在',
    ],
    forbidden: ['禁止把逆地理接口当正向编码接口使用'],
  },
  {
    id: 'drive',
    title: '驾车路线规划',
    triggers: [/驾车|开车|路线规划|北京到上海|drive/i],
    required: [
      '优先调用代理：GET /api/tianditu/drive?origLng=&origLat=&destLng=&destLat=&style=0',
      '若起终点是地点名、机构名或详细地址，而不是明确经纬度，优先先调用 /api/tianditu/geocode 获取真实坐标，再进入 /api/tianditu/drive',
      'style 取值仅 0/1/2/3（默认 0）',
      '路线坐标优先从 routelatlon 字符串解析，不要用模拟路线冒充真实结果',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '解析前先判空：res.data.routelatlon',
      '距离/时长字段判空：distance、duration 可能缺失，UI 要可降级展示',
    ],
    forbidden: ['禁止写死模拟路线坐标作为最终实现'],
  },
  {
    id: 'transit',
    title: '公交/地铁规划',
    triggers: [/公交|地铁|换乘|transit|busline|linetype/i],
    required: [
      '优先调用代理：GET /api/tianditu/transit?startLng=&startLat=&endLng=&endLat=&lineType=1',
      'lineType 取值 1/2/3/4（快捷/少换乘/少步行/不坐地铁）',
      '线路坐标优先从 segments[].segmentLine[*].linePoint 解析',
      'segmentLine 可能是对象或数组，先归一化再读取',
      '时间/距离统计从 segmentLine[*].segmentTime / segmentDistance 读取',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '业务成功条件：Number(res.data.resultCode) === 0 且 results 数组非空',
      '空结果分支：显示 empty 状态，不得一直停留 loading',
    ],
    forbidden: [
      '禁止混用 startPosition / endPosition 与 startposition / endposition 大小写',
      '禁止把公交规划错写为 /drive 或 v2/search',
    ],
  },
  {
    id: 'administrative',
    title: '行政区划边界',
    triggers: [/行政区|行政区划|边界|省界|市界|district|childlevel|administrative|江苏省/i],
    required: [
      '优先调用代理：GET /api/tianditu/administrative',
      '省级下钻地级市常用参数：childLevel=1&extensions=true&boundaryFormat=geojson&outputScope=children&expandChildrenBoundary=true',
      '前端渲染优先使用 boundaryGeoJSON，不要手写正则拆 WKT',
      '运行沙箱中，代理 URL 优先使用 window.__TDT_API_URL__("/api/tianditu/administrative")；没有该 helper 时再用 new URL("/api/tianditu/administrative", window.location.origin).toString()',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '业务成功条件：Number(res.data.status) === 200',
      '边界数据来源：res.data.data.district[*].boundaryGeoJSON',
    ],
    forbidden: [
      '禁止前端正则硬拆 MULTIPOLYGON 生成坐标',
      '禁止只看根节点导致只显示 1 个省界却宣称加载了地级市',
    ],
  },
  {
    id: 'search-v2-poi',
    title: '地名搜索/POI',
    triggers: [/poi|周边|附近|医院|景点|学校|v2\/search|querytype|pointlonlat|queryradius/i],
    required: [
      '优先调用代理：GET /api/tianditu/search?...',
      '必须使用 GET + query string 传参（不要 POST body postStr）',
      '新代码优先沿用官方字段名：keyWord、queryType、level、mapBound、pointLonlat、queryRadius、polygon、specify、dataTypes、show',
      '新代码必须显式传 queryType，不要依赖 type=nearby/view/polygon/category/stats/admin-area 这类兼容推断',
      'queryType=13（分类搜索）新代码显式传 mapBound，不要依赖代理默认值',
      '运行沙箱中 URL 优先使用 window.__TDT_API_URL__("/api/tianditu/search")；没有该 helper 时再用 new URL("/api/tianditu/search", window.location.origin).toString()',
      '按场景设置 queryType：视野内=2、周边=3、多边形=10、行政区=12、分类=13、统计=14',
    ],
    responseChecks: [
      '代理返回成功条件：res.success === true',
      '必须先解包代理层：const data = res.data || {}',
      'POI 成功条件：Number(data.resultType)===1 且 Array.isArray(data.pois)',
      '分类搜索（queryType=13）若一次传多个 dataTypes，需要兼容“按分类名分组对象”与标准 resultType 外壳两种返回结构',
      '服务状态判定：以 data.status.infocode===1000 为成功',
      '空结果分支：展示无结果状态并关闭 loading',
    ],
    forbidden: [
      '禁止 queryType 与参数组合不匹配',
      '禁止把 keyword、type=nearby/view/polygon/category/stats/admin-area、lng/lat/radius 作为新代码默认写法',
      '禁止前端直连 https://api.tianditu.gov.cn/v2/search 或 /search/v1/poi',
      '禁止 /api/tianditu/search 使用 POST + JSON.stringify(postStr)',
    ],
  },
]

export function getContractById(id: string): ContractDescriptor | undefined {
  return CONTRACT_REGISTRY.find((contract) => contract.id === id)
}

export function formatContractPrompt(contractIds: string[]): string {
  const selected = contractIds
    .map((id) => getContractById(id))
    .filter((item): item is ContractDescriptor => Boolean(item))

  if (!selected.length) return ''

  const asyncStateRules = [
    '[Contract:async-state] 异步状态机（强约束）',
    '- 所有异步数据加载必须维护 4 态：loading / ready / empty / error',
    '- fetch 成功但无数据时，状态必须进入 empty，不得继续显示正在加载',
    '- fetch 失败时，状态必须进入 error 并展示可操作提示（重试/检查参数）',
    '- loading 关闭必须放在 finally 或成功/失败分支的收敛点',
  ].join('\n')

  return [
    asyncStateRules,
    ...selected.map((contract) => {
      return [
        `[Contract:${contract.id}] ${contract.title}`,
        '- 必须遵守：',
        ...contract.required.map((item) => `  - ${item}`),
        '- 返回判定：',
        ...contract.responseChecks.map((item) => `  - ${item}`),
        '- 禁止项：',
        ...contract.forbidden.map((item) => `  - ${item}`),
      ].join('\n')
    }),
  ].join('\n\n')
}

export function selectContractsFallback(input: ContractSelectionInput): string[] {
  const text = [
    input.userInput || '',
    input.conversationHistory || '',
    input.runtimeError || '',
    ...(input.loadedSkills || []),
  ].join('\n')

  const matched = CONTRACT_REGISTRY.filter((contract) => contract.triggers.some((trigger) => trigger.test(text)))
  if (input.mode === 'fix' && matched.length > 3) {
    return prioritizeContractsForFix(matched, input.runtimeError || '').map((contract) => contract.id)
  }
  return matched.slice(0, 4).map((contract) => contract.id)
}

function prioritizeContractsForFix(contracts: ContractDescriptor[], runtimeError: string): ContractDescriptor[] {
  const lower = runtimeError.toLowerCase()
  const scored = contracts.map((contract) => {
    let score = 0
    if (contract.id === 'administrative' && /administrative|district|childlevel|boundary|wkt/.test(lower)) score += 6
    if (contract.id === 'geocode' && /geocoder|address|lon|lat/.test(lower)) score += 6
    if (contract.id === 'transit' && /transit|busline|linetype/.test(lower)) score += 6
    if (contract.id === 'drive' && /drive|route|routelatlon/.test(lower)) score += 6
    if (contract.id === 'search-v2-poi' && /querytype|pointlonlat|queryradius|poi/.test(lower)) score += 6
    if (/failed to parse url|fetch|404|400|500/.test(lower)) score += 2
    return { contract, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.contract)
}
