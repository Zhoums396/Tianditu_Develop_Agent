import { describe, expect, it } from 'vitest'
import { analyzeGeneratedCode } from '../src/agent/CodeVerifier.js'

const runtimeFileContext = `
文件: village-renovation.geojson
文件获取链接URL: http://localhost:3000/uploads/example.geojson
## 运行时文件契约（唯一可信，代码必须只按本节读取）
\`\`\`json
{
  "version": "geojson-runtime-contract-v2",
  "kind": "geojson",
  "fileUrl": "http://localhost:3000/uploads/example.geojson",
  "responseShape": "FeatureCollection",
  "geojsonPath": "rawData",
  "forbiddenPaths": ["rawData.data", "rawData.rawData"],
  "featureCount": 268,
  "geometryTypeStats": { "MultiPolygon": 268 },
  "pointAccessorByGeometryType": {
    "MultiPolygon": "geometry.coordinates[0][0][0]"
  },
  "safeGuards": ["传入 map.addSource 的 data 必须是 FeatureCollection/Feature 对象，禁止传 features 数组"]
}
\`\`\`
`

const runtimeJsonObjectContext = `
文件: a.json
文件获取链接URL: http://localhost:3000/uploads/example.json
## 运行时文件契约（唯一可信，代码必须只按本节读取）
\`\`\`json
{
  "version": "json-runtime-contract-v1",
  "kind": "json",
  "fileUrl": "http://localhost:3000/uploads/example.json",
  "responseShape": "object",
  "rootKeys": ["中央红军（红一方面军）", "红二方面军", "红四方面军"],
  "canonicalAccess": [
    "rawData[\\"中央红军（红一方面军）\\"]",
    "rawData[\\"红二方面军\\"]",
    "rawData[\\"红四方面军\\"]",
    "item[\\"地点坐标\\"] -> [lng, lat]"
  ],
  "forbiddenPatterns": ["rawData[0]", "data[0]"],
  "encodingNormalized": true,
  "safeGuards": [
    "根结构是对象；不要使用 rawData[0] 或 data[0]。",
    "顶层 key、字段名只允许来自运行时契约或自动数据理解结果。"
  ]
}
\`\`\`
`

const runtimeJsonArrayContext = `
文件: events.json
文件获取链接URL: http://localhost:3000/uploads/events.json
## 运行时文件契约（唯一可信，代码必须只按本节读取）
\`\`\`json
{
  "version": "json-runtime-contract-v1",
  "kind": "json",
  "fileUrl": "http://localhost:3000/uploads/events.json",
  "responseShape": "array",
  "arrayLength": 12,
  "canonicalAccess": ["Array.isArray(rawData)", "rawData[0]", "item[\\"地点坐标\\"] -> [lng, lat]"],
  "forbiddenPatterns": ["rawData.someKey", "data.someKey"],
  "encodingNormalized": true,
  "safeGuards": [
    "根结构是数组；不要直接假设 rawData.someKey。",
    "访问数组元素前必须判空。"
  ]
}
\`\`\`
`

describe('CodeVerifier symbol text font checks', () => {
  it('flags symbol text layers without explicit text-font', () => {
    const issues = analyzeGeneratedCode(`
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12
        }
      })
    `)

    expect(issues.some((issue) => issue.code === 'symbol-text-font-missing')).toBe(true)
  })

  it('flags unsupported symbol text fonts', () => {
    const issues = analyzeGeneratedCode(`
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Microsoft YaHei'],
          'text-size': 12
        }
      })
    `)

    expect(issues.some((issue) => issue.code === 'symbol-text-font-unsupported')).toBe(true)
  })

  it('accepts supported symbol text font while keeping an advisory warning', () => {
    const issues = analyzeGeneratedCode(`
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'points',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['WenQuanYi Micro Hei Mono'],
          'text-size': 12
        }
      })
    `)

    expect(issues.some((issue) => issue.code === 'symbol-text-font-missing')).toBe(false)
    expect(issues.some((issue) => issue.code === 'symbol-text-font-unsupported')).toBe(false)
    expect(issues.some((issue) => issue.code === 'symbol-text-font')).toBe(true)
  })

  it('flags forbidden GeoJSON wrapper paths from runtime file contract', () => {
    const issues = analyzeGeneratedCode(`
      fetch(url)
        .then((res) => res.json())
        .then((rawData) => {
          var geojson = rawData.data
          map.addSource('village-data', { type: 'geojson', data: geojson })
        })
    `, { fileData: runtimeFileContext })

    expect(issues.some((issue) => issue.code === 'runtime-geojson-path-violated')).toBe(true)
  })

  it('allows iterating feature collections when source data stays a FeatureCollection', () => {
    const issues = analyzeGeneratedCode(`
      fetch(url)
        .then((res) => res.json())
        .then((rawData) => {
          var geojson = rawData
          geojson.features.forEach(function(feature) {
            console.log(feature.properties)
          })
          map.addSource('village-data', { type: 'geojson', data: geojson })
        })
    `, { fileData: runtimeFileContext })

    expect(issues.some((issue) => issue.code === 'runtime-geojson-path-violated')).toBe(false)
    expect(issues.some((issue) => issue.code === 'geojson-features-array-passed')).toBe(false)
  })

  it('flags passing features array directly into geojson source', () => {
    const issues = analyzeGeneratedCode(`
      var geojson = { type: 'FeatureCollection', features: [] }
      map.addSource('village-data', {
        type: 'geojson',
        data: geojson.features
      })
    `)

    expect(issues.some((issue) => issue.code === 'geojson-features-array-passed')).toBe(true)
  })

  it('flags unsupported fill paint properties such as fill-width', () => {
    const issues = analyzeGeneratedCode(`
      map.on('load', function() {
        map.addLayer({
          id: 'village-fill',
          type: 'fill',
          source: 'village-data',
          paint: {
            'fill-color': '#ff0000',
            'fill-outline-color': '#333333',
            'fill-width': 1
          }
        })
      })
    `)

    const issue = issues.find((entry) => entry.code === 'layer-paint-property-invalid')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('fill-width')
  })

  it('flags map.add(marker) overlay mounting that mixes non-TMapGL APIs', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      map.on('load', function() {
        var marker = new TMapGL.Marker().setLngLat([118.78, 32.04])
        map.add(marker)
      })
    `)

    expect(issues.some((issue) => issue.code === 'overlay-added-via-map-add')).toBe(true)
  })

  it('flags marker constructor options borrowed from other SDKs', () => {
    const issues = analyzeGeneratedCode(`
      var marker = new TMapGL.Marker({
        position: [118.78, 32.04],
        icon: document.createElement('div')
      })
    `)

    expect(issues.some((issue) => issue.code === 'marker-constructor-options-invalid')).toBe(true)
  })

  it('flags marker.setIcon usage that is not part of the verified examples', () => {
    const issues = analyzeGeneratedCode(`
      var marker = new TMapGL.Marker().setLngLat([118.78, 32.04]).addTo(map)
      marker.setIcon(document.createElement('div'))
    `)

    expect(issues.some((issue) => issue.code === 'marker-seticon-unsupported')).toBe(true)
  })

  it('flags popup.setElement usage borrowed from other SDKs', () => {
    const issues = analyzeGeneratedCode(`
      new TMapGL.Popup()
        .setLngLat([118.78, 32.04])
        .setElement(document.createElement('div'))
        .addTo(map)
    `)

    expect(issues.some((issue) => issue.code === 'popup-setelement-unsupported')).toBe(true)
  })

  it('flags bounds.isValid usage on TMapGL.LngLatBounds instances', () => {
    const issues = analyzeGeneratedCode(`
      var bounds = new TMapGL.LngLatBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: 50 })
      }
    `)

    expect(issues.some((issue) => issue.code === 'lnglatbounds-isvalid-unsupported')).toBe(true)
  })

  it('flags black named style values when they are written into style instead of styleId', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', {
        center: [116.4, 39.9],
        zoom: 10,
        style: 'black'
      })
    `)

    expect(issues.some((issue) => issue.code === 'invalid-styleid-field')).toBe(true)
  })

  it('flags default styleId values and suggests normal instead', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', {
        center: [116.4, 39.9],
        zoom: 10,
        styleId: 'default'
      })
    `)

    expect(issues.some((issue) => issue.code === 'invalid-styleid-default')).toBe(true)
  })

  it('allows verified styleId values and satellite mapType without style warnings', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', {
        center: [116.4, 39.9],
        zoom: 10,
        styleId: 'black',
        mapType: 'image'
      })
    `)

    expect(issues.some((issue) => issue.code === 'invalid-styleid-field')).toBe(false)
    expect(issues.some((issue) => issue.code === 'invalid-style-default')).toBe(false)
    expect(issues.some((issue) => issue.code === 'invalid-styleid-default')).toBe(false)
  })

  it('flags MultiPolygon geometry-type filters that can hide polygon features', () => {
    const issues = analyzeGeneratedCode(`
      map.addLayer({
        id: 'village-fill',
        type: 'fill',
        source: 'village-data',
        filter: ['==', ['geometry-type'], 'MultiPolygon'],
        paint: { 'fill-color': '#1890ff' }
      })
    `)

    expect(issues.some((issue) => issue.code === 'geometry-type-multipolygon-filter')).toBe(true)
  })

  it('allows Polygon geometry-type filters for polygon rendering', () => {
    const issues = analyzeGeneratedCode(`
      map.addLayer({
        id: 'village-fill',
        type: 'fill',
        source: 'village-data',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#1890ff' }
      })
    `)

    expect(issues.some((issue) => issue.code === 'geometry-type-multipolygon-filter')).toBe(false)
  })

  it('flags in/literal filters that pass runtime arrays to TMapGL', () => {
    const issues = analyzeGeneratedCode(`
      var highlightProvinces = ['北京', '上海']
      map.addLayer({
        id: 'province-fill',
        type: 'fill',
        source: 'province-data',
        filter: ['all',
          ['==', ['geometry-type'], 'Polygon'],
          ['in', ['get', 'name'], 'literal', highlightProvinces]
        ],
        paint: { 'fill-color': '#1890ff' }
      })
    `)

    expect(issues.some((issue) => issue.code === 'filter-in-runtime-array-unsupported')).toBe(true)
  })

  it('does not flag unrelated isValid usage when LngLatBounds is present', () => {
    const issues = analyzeGeneratedCode(`
      var bounds = new TMapGL.LngLatBounds()
      var validator = {
        isValid: function() {
          return true
        }
      }

      if (validator.isValid()) {
        console.log(bounds)
      }
    `)

    expect(issues.some((issue) => issue.code === 'lnglatbounds-isvalid-unsupported')).toBe(false)
  })

  it('flags unguarded map.getLayer cleanup that can explode before map is ready', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      function redrawRoute() {
        if (map.getLayer('route-line')) map.removeLayer('route-line')
      }
    `)

    expect(issues.some((issue) => issue.code === 'map-cleanup-getlayer-unguarded')).toBe(true)
  })

  it('flags unguarded map.getSource cleanup that can explode before map is ready', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      function redrawRoute() {
        if (map.getSource('route')) map.removeSource('route')
      }
    `)

    expect(issues.some((issue) => issue.code === 'map-cleanup-getsource-unguarded')).toBe(true)
  })

  it('allows guarded cleanup helpers for layers and sources', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      function safeRemoveLayer(id) {
        if (map && map.getLayer && map.getLayer(id)) map.removeLayer(id)
      }

      function safeRemoveSource(id) {
        if (map && map.getSource && map.getSource(id)) map.removeSource(id)
      }
    `)

    expect(issues.some((issue) => issue.code === 'map-cleanup-getlayer-unguarded')).toBe(false)
    expect(issues.some((issue) => issue.code === 'map-cleanup-getsource-unguarded')).toBe(false)
  })

  it('flags addLayer beforeId literals that are not guarded by map.getLayer', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      map.on('load', function() {
        map.addLayer({
          id: 'red-army-point',
          type: 'circle',
          source: 'red-army'
        }, 'waterway-label')
      })
    `)

    expect(issues.some((issue) => issue.code === 'layer-beforeid-unguarded')).toBe(true)
  })

  it('allows addLayer beforeId when existence is checked first', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [118.78, 32.04], zoom: 8 })
      function safeAddLayer(layerDef, beforeId) {
        if (map && map.getLayer && map.getLayer(beforeId)) {
          map.addLayer(layerDef, beforeId)
        } else {
          map.addLayer(layerDef)
        }
      }
    `)

    expect(issues.some((issue) => issue.code === 'layer-beforeid-unguarded')).toBe(false)
  })

  it('allows line-width on line layers', () => {
    const issues = analyzeGeneratedCode(`
      map.on('load', function() {
        map.addLayer({
          id: 'village-outline',
          type: 'line',
          source: 'village-data',
          paint: {
            'line-color': '#333333',
            'line-width': 2
          }
        })
      })
    `)

    expect(issues.some((issue) => issue.code === 'layer-paint-property-invalid')).toBe(false)
  })

  it('blocks object-root JSON from being accessed as an array', () => {
    const issues = analyzeGeneratedCode(`
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          const rawData = data[0]
          console.log(rawData["中央红军（红一方面军）"])
        })
    `, { fileData: runtimeJsonObjectContext })

    expect(issues.some((issue) => issue.code === 'runtime-json-root-object-violated')).toBe(true)
  })

  it('warns when object-root JSON uses invented top-level keys', () => {
    const issues = analyzeGeneratedCode(`
      fetch(url)
        .then((res) => res.json())
        .then((rawData) => {
          const teams = rawData["队伍列表"]
          console.log(teams)
        })
    `, { fileData: runtimeJsonObjectContext })

    expect(issues.some((issue) => issue.code === 'runtime-json-unknown-root-key')).toBe(true)
  })

  it('blocks array-root JSON from being accessed as an object root', () => {
    const issues = analyzeGeneratedCode(`
      fetch(url)
        .then((res) => res.json())
        .then((rawData) => {
          rawData.events.forEach(function(item) {
            console.log(item)
          })
        })
    `, { fileData: runtimeJsonArrayContext })

    expect(issues.some((issue) => issue.code === 'runtime-json-root-array-violated')).toBe(true)
  })

  it('blocks map source/layer mutations when no load guard exists', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [116.4, 39.9], zoom: 6 })
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route'
      })
    `)

    expect(issues.some((issue) => issue.code === 'map-load-guard-missing')).toBe(true)
  })

  it('blocks suspicious load order when fetch/render starts before load registration', () => {
    const issues = analyzeGeneratedCode(`
      var map = new TMapGL.Map('map', { center: [105, 34], zoom: 4 })

      fetch(url)
        .then((res) => res.json())
        .then((rawData) => {
          map.addSource('events', {
            type: 'geojson',
            data: rawData
          })
        })

      map.on('load', function() {
        map.addControl(new TMapGL.NavigationControl(), 'top-right')
      })
    `)

    expect(issues.some((issue) => issue.code === 'map-load-order-suspicious')).toBe(true)
  })

  it('blocks eager source updates that race with load-created sources', () => {
    const issues = analyzeGeneratedCode(`
      var map

      document.addEventListener('DOMContentLoaded', function() {
        initMap()
        loadData()
      })

      function initMap() {
        map = new TMapGL.Map('map', { center: [105, 34], zoom: 4 })
        map.on('load', function() {
          map.addSource('centers', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          })
        })
      }

      function loadData() {
        fetch(url)
          .then((res) => res.json())
          .then((rawData) => {
            if (map && map.getSource) {
              map.getSource('centers').setData(rawData)
            }
          })
      }
    `)

    expect(issues.some((issue) => issue.code === 'map-source-ready-race')).toBe(true)
  })

  it('allows parallel fetch when source updates are explicitly gated by readiness', () => {
    const issues = analyzeGeneratedCode(`
      var map
      var mapLoaded = false
      var pendingGeojson = null

      document.addEventListener('DOMContentLoaded', function() {
        initMap()
        loadData()
      })

      function initMap() {
        map = new TMapGL.Map('map', { center: [105, 34], zoom: 4 })
        map.on('load', function() {
          map.addSource('centers', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          })
          mapLoaded = true
          applyPendingGeojson()
        })
      }

      function loadData() {
        fetch(url)
          .then((res) => res.json())
          .then((rawData) => {
            pendingGeojson = rawData
            applyPendingGeojson()
          })
      }

      function applyPendingGeojson() {
        if (!mapLoaded || !pendingGeojson) return
        var source = map && map.getSource ? map.getSource('centers') : null
        if (!source || typeof source.setData !== 'function') return
        source.setData(pendingGeojson)
      }
    `)

    expect(issues.some((issue) => issue.code === 'map-source-ready-race')).toBe(false)
    expect(issues.some((issue) => issue.code === 'map-load-order-suspicious')).toBe(false)
  })

  it('warns when named route planning hardcodes start/end coordinates without geocoding', () => {
    const issues = analyzeGeneratedCode(`
      var startCoords = [116.39751, 39.90854]
      var endCoords = [116.404, 39.915]
      var startName = '国家基础地理信息中心'
      var endName = '自然资源部'
      var url = new URL('/api/tianditu/drive', window.location.origin)
      url.searchParams.set('origLng', String(startCoords[0]))
      url.searchParams.set('origLat', String(startCoords[1]))
      url.searchParams.set('destLng', String(endCoords[0]))
      url.searchParams.set('destLat', String(endCoords[1]))
    `)

    expect(issues.some((issue) => issue.code === 'named-route-geocode-recommended')).toBe(true)
  })

  it('does not warn when named route planning already geocodes locations first', () => {
    const issues = analyzeGeneratedCode(`
      async function geocodePlace(name) {
        var url = new URL('/api/tianditu/geocode', window.location.origin)
        url.searchParams.set('address', name)
        return fetch(url.toString()).then(function(res) { return res.json() })
      }
      Promise.all([
        geocodePlace('国家基础地理信息中心'),
        geocodePlace('自然资源部')
      ]).then(function(result) {
        var routeUrl = new URL('/api/tianditu/drive', window.location.origin)
        console.log(routeUrl, result)
      })
    `)

    expect(issues.some((issue) => issue.code === 'named-route-geocode-recommended')).toBe(false)
  })
})
