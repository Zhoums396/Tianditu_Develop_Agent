import type { ReactNode } from 'react'

export interface ExampleCard {
  title: string
  desc: string
  prompt?: string
  sampleId?: string
  category: string
  icon: ReactNode
  gradient: string
  bgLight: string
  iconColor: string
  coverUrl?: string
  preview: 'map' | 'pin' | 'parcel' | 'points' | 'flood' | 'drive' | 'transit' | 'admin' | 'batch' | 'bar3d' | 'history'
}

const jiangsuVillageBatchPrompt = `请把以下地点在地图上精确显示，并在页面左侧加一个可滚动列表框。要求：
1. 每个地点都做地理编码，拿到坐标后在地图上打点；
2. 点击地图点位时，左侧列表高亮对应地点；点击左侧列表项时，地图飞到该点并弹窗；
3. 左侧列表显示地点名称、经纬度与地理编码状态（成功/失败）；
4. 页面初始自动适配全部成功点位范围；
5. 地理编码失败的地点也要在列表里展示并标记失败原因。

地点清单：
江苏省苏州市吴江区七都镇开弦弓村
江苏省苏州市昆山市张浦镇姜杭村
江苏省苏州市昆山市周庄镇东浜村
江苏省镇江市丹阳市曲阿街道建山村
江苏省盐城市盐都区学富镇蒋河村
江苏省镇江市丹阳县曲阿街道祈钦村
江苏省泰州市姜堰区溱潼镇湖南村
江苏省苏州市张家港市塘桥镇金村村
江苏省盐城市盐都区楼王镇丁马港村
江苏省盐城市盐都区龙冈镇张本村
江苏省苏州市昆山市周市镇东方村
江苏省苏州市吴中区光福镇冲山村
江苏省镇江市丹阳市曲阿街道张巷村
江苏省苏州市昆山市锦溪镇朱浜村
江苏省苏州市常熟市碧溪街道李袁村
江苏省苏州市太仓市浮桥镇方桥村
江苏省徐州市铜山区柳泉镇北村
江苏省无锡市宜兴市张渚镇祝陵村
江苏省南京市溧水区白马镇石头寨村
江苏省镇江市丹徒区宝堰镇宝堰村
江苏省无锡市宜兴市徐舍镇芳庄村
江苏省无锡市宜兴市周铁镇洋溪村
江苏省徐州市睢宁县姚集镇黄山前村
江苏省徐州市新沂市棋盘镇花厅村
江苏省无锡市锡山区东港镇黄土塘村`

const lifeTreeStoryPrompt = `请先联网调研电视剧《生命树》里与青海省藏羚羊保护相关的故事背景、关键地点、真实原型线索和生态保护脉络，再据此生成一个有感染力的故事地图网页。

要求：
1. 不要直接复述搜索结果，要先提炼出适合地图叙事的主线，再组织成可视化页面；
2. 页面整体要像“叙事地图”而不是普通后台：地图是主角，故事面板负责引导阅读；
3. 地图范围聚焦青海高原与相关保护区域，关键地点、路线、阶段节点都要尽量基于你检索到的资料来组织；
4. 文案要克制、真诚，有纪念感，突出长期守护、人与自然共生、代际接力这些情感；
5. 页面至少要有：标题区、故事主线、关键地点说明、地图图例，以及地图与故事之间的联动；
6. 必须使用天地图 JS API v5（TMapGL），保证代码可运行、无报错、移动端也能正常阅读。`

export const exampleCards: ExampleCard[] = [
  {
    title: '基础地图',
    desc: '创建一个北京市中心的地图',
    category: '快速入门',
    preview: 'map',
    coverUrl: '/example-covers/basic-map.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
    gradient: 'from-blue-500 to-cyan-400',
    bgLight: 'bg-blue-50',
    iconColor: 'text-blue-500',
  },
  {
    title: '标注与弹窗',
    desc: '在地图上添加多个带弹窗的标注点',
    category: '快速入门',
    preview: 'pin',
    coverUrl: '/example-covers/markers-popup.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
    gradient: 'from-rose-500 to-pink-400',
    bgLight: 'bg-rose-50',
    iconColor: 'text-rose-500',
  },
  {
    title: '清华大学周边POI搜索',
    desc: '构建左侧检索面板 + 右侧地图，支持周边/视野/普通三种搜索模式',
    prompt:
      '请生成一个“清华大学周边POI搜索演示”网页，要求：1）整体布局参考专业 GIS 应用：顶部标题栏（标题、副标题、右侧复制链接按钮），左侧控制面板，右侧地图；2）左侧面板包含：关键词输入框（默认“医院”）、搜索类型切换按钮（周边搜索/视野搜索/普通搜索）、搜索半径输入框、开始搜索按钮、状态提示条、搜索结果列表；3）右侧地图默认定位清华大学，右上角显示“当前位置”信息卡（地名、经纬度）；4）点击地图可切换搜索中心点，结果点在地图和列表联动高亮；5）调用 /api/tianditu/search 代理接口，三种模式分别对应 queryType=3/2/1，结果包含名称、地址、距离；6）必须使用天地图 JS API v5（TMapGL），保证移动端可用、无运行时报错、视觉风格简洁现代。',
    category: 'POI搜索',
    preview: 'points',
    coverUrl: '/example-covers/tsinghua-poi.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.3-4.3m1.3-5.2a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
      </svg>
    ),
    gradient: 'from-indigo-500 to-purple-500',
    bgLight: 'bg-indigo-50',
    iconColor: 'text-indigo-500',
  },
  {
    title: '城中村改造地块',
    desc: '自动加载城中村 GeoJSON，探索拆迁地块并进行合理可视化',
    prompt: '请你探索一下我上传的这个数据，并进行合理的可视化。',
    sampleId: 'village-renovation',
    category: 'GeoJSON 分析',
    preview: 'parcel',
    coverUrl: '/example-covers/village-renovation.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 9.776L12 4.5l8.25 5.276M4.5 10.25V19.5h15v-9.25M9 19.5v-4.125a3 3 0 016 0V19.5" />
      </svg>
    ),
    gradient: 'from-amber-500 to-orange-400',
    bgLight: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  {
    title: '全国妇联中心分布',
    desc: '自动加载妇联中心 GeoJSON，按省市做点位与侧栏联动',
    prompt:
      '请你帮我生成一个美观合理的可视化页面。对全国妇联中心按照所在的省和市进行点数据可视化，每个点上面标注该中心的基本信息。地图左侧制作一个列表，显示当前省市的妇联中心信息。点位按需加载就可以，不需要一开始就加载这么多。',
    sampleId: 'fulian-centers',
    category: '点位专题',
    preview: 'points',
    coverUrl: '/example-covers/fulian-centers.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
    gradient: 'from-emerald-500 to-green-400',
    bgLight: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
  },
  {
    title: '长征胜利90周年专题',
    desc: '自动加载长征历史数据，生成三路红军长征路线与关键节点专题地图',
    prompt: '根据上传的长征数据，帮我生成长征胜利90周年专题地图',
    sampleId: 'long-march',
    category: '历史专题',
    preview: 'history',
    coverUrl: '/example-covers/long-march.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v18m0-18l6 3-6 3-6-3 6-3zm0 6l6 3-6 3-6-3 6-3z" />
      </svg>
    ),
    gradient: 'from-red-500 to-orange-500',
    bgLight: 'bg-red-50',
    iconColor: 'text-red-500',
  },
  {
    title: '生命树·藏羚羊守护',
    desc: '用故事地图讲述青海高原上关于巡山、保护区与生态接力的守护历程',
    prompt: lifeTreeStoryPrompt,
    category: '叙事地图',
    preview: 'history',
    coverUrl: '/example-covers/life-tree.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21c4.142 0 7.5-2.91 7.5-6.5 0-2.88-2.165-5.324-5.168-6.16A4.75 4.75 0 006 9.5c0 .247.02.49.06.728C3.84 11.03 2.25 12.97 2.25 15.25 2.25 18.426 5.161 21 8.75 21H12z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-6m0 0c-1.65 0-3-1.455-3-3.25S10.35 8.5 12 8.5s3 1.455 3 3.25S13.65 15 12 15z" />
      </svg>
    ),
    gradient: 'from-emerald-600 to-teal-500',
    bgLight: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    title: '中国洪水事件专题',
    desc: '自动加载洪水事件 GeoJSON，做点位详情与热力图分析',
    prompt:
      '请你帮我制作一个中国历年来发生的洪水事件空间分布专题地图应用。点击每个洪水受灾点时，在左侧侧边栏展示该事件相关信息，并在当前地图基础上增加热力图展示，以便识别中国受灾最严重的区域。',
    sampleId: 'china-flood-events',
    category: '灾害时空分析',
    preview: 'flood',
    coverUrl: '/example-covers/china-flood.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14.5a4 4 0 118 0c0 2.21-1.79 5.5-4 7.5-2.21-2-4-5.29-4-7.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14.5h.01" />
      </svg>
    ),
    gradient: 'from-cyan-500 to-blue-400',
    bgLight: 'bg-cyan-50',
    iconColor: 'text-cyan-500',
  },
  {
    title: '北京→上海驾车路线',
    desc: '调用天地图驾车 API 获取真实路线并渲染距离与时长',
    prompt: '帮我用API实现北京到上海的驾车路线规划',
    category: '路径规划',
    preview: 'drive',
    coverUrl: '/example-covers/beijing-shanghai-drive.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 16.5h16.5M6 16.5l1.125-4.5h9.75L18 16.5M8.25 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm10.5 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM9 12V9.75A2.25 2.25 0 0111.25 7.5h1.5A2.25 2.25 0 0115 9.75V12" />
      </svg>
    ),
    gradient: 'from-sky-500 to-blue-500',
    bgLight: 'bg-sky-50',
    iconColor: 'text-sky-500',
  },
  {
    title: '公交地铁路线规划',
    desc: '调用 transit API 规划公交/地铁换乘，展示方案列表与地图联动',
    prompt:
      '请帮我生成一个美观可用的公交地铁路线规划网页：左侧控制面板 + 右侧地图，支持输入或地图点击选择起终点，支持较快捷/少换乘/少步行/不坐地铁策略，调用天地图 transit?type=busline API 获取真实方案并渲染线路、方案列表和换乘详情。',
    category: '路径规划',
    preview: 'transit',
    coverUrl: '/example-covers/transit-route.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 18.75a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm10.5 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM4.5 16.5h15M6.75 16.5v-6A2.25 2.25 0 019 8.25h6a2.25 2.25 0 012.25 2.25v6M9 10.5h6M12 8.25V6" />
      </svg>
    ),
    gradient: 'from-teal-500 to-cyan-500',
    bgLight: 'bg-teal-50',
    iconColor: 'text-teal-500',
  },
  {
    title: '江苏地级市边界',
    desc: '加载江苏省全部地级市矢量边界并分色展示',
    prompt:
      '帮我加载江苏省所有地级市的矢量边界。要求：使用 /api/tianditu/administrative，设置 childLevel=1、extensions=true、autoResolveCodebook=true、boundaryFormat=geojson、outputScope=children、expandChildrenBoundary=true，并按地级市分色渲染面图层和边界线，自动适配视野。',
    category: '行政区划',
    preview: 'admin',
    coverUrl: '/example-covers/jiangsu-admin.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6.75l6.75-3 6.75 3 4.5-1.5v12l-4.5 1.5-6.75-3-6.75 3V6.75z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.75v12M16.5 6.75v12" />
      </svg>
    ),
    gradient: 'from-indigo-500 to-violet-500',
    bgLight: 'bg-indigo-50',
    iconColor: 'text-indigo-500',
  },
  {
    title: '江苏村落批量定位',
    desc: '批量地理编码 25 个村落点位，地图与侧栏列表联动',
    prompt: jiangsuVillageBatchPrompt,
    category: '批处理任务',
    preview: 'batch',
    coverUrl: '/example-covers/jiangsu-villages.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 6.75h15m-15 5.25h15m-15 5.25h9M16.5 17.25l1.5 1.5 3-3" />
      </svg>
    ),
    gradient: 'from-indigo-500 to-blue-500',
    bgLight: 'bg-indigo-50',
    iconColor: 'text-indigo-500',
  },
  {
    title: '3D 柱状图',
    desc: '城市 GDP 数据 3D 柱状图',
    category: '可视化模板',
    preview: 'bar3d',
    coverUrl: '/example-covers/bar3d.png',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    gradient: 'from-violet-500 to-purple-400',
    bgLight: 'bg-violet-50',
    iconColor: 'text-violet-500',
  },
]

export function getExamplePrompt(example: ExampleCard) {
  return example.prompt || example.desc
}

export function getExampleBySampleId(sampleId: string | undefined) {
  const normalized = String(sampleId || '').trim()
  if (!normalized) return undefined
  return exampleCards.find((item) => item.sampleId === normalized)
}

export function getExampleByLookupKey(lookup: string | undefined) {
  const normalized = String(lookup || '').trim()
  if (!normalized) return undefined

  if (normalized.startsWith('sample:')) {
    return getExampleBySampleId(normalized.slice('sample:'.length))
  }

  if (normalized.startsWith('title:')) {
    const title = normalized.slice('title:'.length).trim()
    return exampleCards.find((item) => item.title === title)
  }

  return getExampleBySampleId(normalized) || exampleCards.find((item) => item.title === normalized)
}

export function getExampleByIndex(index: number | undefined) {
  if (typeof index !== 'number' || !Number.isInteger(index)) return undefined
  if (index < 0 || index >= exampleCards.length) return undefined
  return exampleCards[index]
}
