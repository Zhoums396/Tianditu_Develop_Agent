# 行政区划服务（search-admin）

用于“按行政区名称/编码查询中心点、边界、下级行政区”，并在地图中稳定渲染边界。

本参考重点解决三类高频问题：

1. 读取到了行政区数据，但边界渲染畸形（飞线、扇形、不闭合）。
2. `fetch('/api/tianditu/administrative?...')` 在运行容器中报 URL 解析失败。
3. 模糊关键词命中错误行政区，导致展示错区。

---

## 1) 本项目推荐调用路径（优先）

优先调用后端代理：

```text
GET /api/tianditu/administrative
  ?keyword=江苏省
  &childLevel=0
  &extensions=true
  &autoResolveCodebook=true
  &expandChildrenBoundary=true
  &outputScope=root
  &boundaryFormat=geojson
```

原因：

- 代理已接入官方 `/v2/administrative`。
- 代理可联动本地 `xzqh2020-03.xlsx` 编码表做名称↔编码解析。
- `boundaryFormat=geojson` 时，后端会把 WKT 边界转换为 `boundaryGeoJSON`（前端可直接渲染）。
- `childLevel>0` 且 `expandChildrenBoundary=true` 时，后端会按子级 gb 自动补查边界，避免“只返回省界”。
- `outputScope` 控制返回给前端的 `district`：
  - `root`：根行政区（默认用于 childLevel=0）
  - `children`：下一级行政区（默认用于 childLevel>0）
  - `all`：根 + 下级

---

## 2) 代理返回结构（前端需要关注）

根结构：

- `success: boolean`
- `data: <官方行政区划响应>`
- `meta: { requestedKeyword, resolvedKeyword, childLevel, extensions, boundaryFormat, codebook }`

其中 `data.data.district[]` 每项在 `boundaryFormat=geojson` 时会附带：

- `boundaryGeoJSON: Feature | null`

另外会附带：

- `data.data.rootDistrict[]`：始终保留根级行政区结果（用于回退或中心点定位）

前端渲染时优先读取 `district[*].boundaryGeoJSON`，不要手拆 `boundary` 字符串。

---

## 3) 代码模板（稳定版）

```javascript
function buildApiUrl(path, params) {
  if (window.__TDT_API_URL__) {
    var proxyUrl = new URL(window.__TDT_API_URL__(path), window.location.origin);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && String(v) !== '') {
        proxyUrl.searchParams.set(k, String(v));
      }
    });
    return proxyUrl.toString();
  }

  var origin = '';
  try {
    if (window.location && /^https?:/.test(window.location.origin)) {
      origin = window.location.origin;
    }
  } catch (_) {}
  if (!origin) throw new Error('无法确定页面 origin，无法构建 API 地址');

  var url = new URL(path, origin);
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    if (v !== undefined && v !== null && String(v) !== '') {
      url.searchParams.set(k, String(v));
    }
  });
  return url.toString();
}

async function loadAdministrative(keyword) {
  var requestUrl = buildApiUrl('/api/tianditu/administrative', {
    keyword: keyword,
    childLevel: 1,
    extensions: true,
    autoResolveCodebook: true,
    expandChildrenBoundary: true,
    outputScope: 'children',
    boundaryFormat: 'geojson',
  });

  var res = await fetch(requestUrl);
  var json = await res.json();

  if (!json || !json.success) {
    throw new Error((json && json.error) || '行政区划代理请求失败');
  }

  var result = json.data;
  if (!result || Number(result.status) !== 200) {
    throw new Error((result && result.message) || '行政区划查询失败');
  }

  var districts = (result.data && result.data.district) || [];
  if (!districts.length) throw new Error('未找到行政区划结果');

  var features = districts
    .map(function (d) { return d.boundaryGeoJSON; })
    .filter(Boolean);

  // 没边界时降级中心点定位
  if (!features.length) {
    var c = districts[0].center;
    if (c && Number.isFinite(Number(c.lng)) && Number.isFinite(Number(c.lat))) {
      map.flyTo({ center: [Number(c.lng), Number(c.lat)], zoom: 8 });
    }
    return;
  }

  if (map && map.getSource && map.getSource('admin-boundary')) {
    if (map.getLayer && map.getLayer('admin-fill')) map.removeLayer('admin-fill');
    if (map.getLayer && map.getLayer('admin-line')) map.removeLayer('admin-line');
    map.removeSource('admin-boundary');
  }

  map.addSource('admin-boundary', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: features,
    },
  });

  map.addLayer({
    id: 'admin-fill',
    type: 'fill',
    source: 'admin-boundary',
    paint: {
      'fill-color': '#1677ff',
      'fill-opacity': 0.18,
    },
  });

  map.addLayer({
    id: 'admin-line',
    type: 'line',
    source: 'admin-boundary',
    paint: {
      'line-color': '#1454d8',
      'line-width': 2.2,
      'line-opacity': 0.92,
    },
  });

  var bounds = new TMapGL.LngLatBounds();
  var hasBoundsPoint = false;
  features.forEach(function (f) {
    var g = f.geometry;
    if (!g) return;
    if (g.type === 'Polygon') {
      g.coordinates.forEach(function (ring) {
        ring.forEach(function (pt) {
          if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
          bounds.extend(pt);
          hasBoundsPoint = true;
        });
      });
    } else if (g.type === 'MultiPolygon') {
      g.coordinates.forEach(function (poly) {
        poly.forEach(function (ring) {
          ring.forEach(function (pt) {
            if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
            bounds.extend(pt);
            hasBoundsPoint = true;
          });
        });
      });
    }
  });
  if (hasBoundsPoint) {
    map.fitBounds(bounds, { padding: 50, maxZoom: 10 });
  }
}
```

---

## 4) 关键策略（生成与修复都要遵守）

1. 行政区边界场景优先走 `/api/tianditu/administrative` 代理。
2. 读取边界时优先使用 `boundaryGeoJSON`，不要手写正则拆 `MULTIPOLYGON`。
3. 运行容器里若出现相对 URL 解析失败，优先改为：
   - `new URL('/api/tianditu/administrative', window.location.origin).toString()`
4. 只有在“明确无后端代理可用”时，才允许前端直接请求官方 API。
5. `district.level` 是数字（国家 5 / 省 4 / 市 3 / 县 2），不要按字符串枚举比较。
6. 若要画省下地级市边界，必须使用 `childLevel=1 + outputScope=children`（并建议 `expandChildrenBoundary=true`）。

---

## 5) 常见错误 -> 修复动作

### 错误 A

```text
Failed to execute 'fetch' on 'Window': Failed to parse URL from /api/tianditu/administrative...
```

修复动作：

1. 不要直接 `fetch('/api/...')` 字符串。
2. 使用 `new URL(path, window.location.origin)` 构造绝对 URL。
3. 继续走代理，不要立刻退化到官方直连接口。

---

### 错误 B

```text
Invalid LngLat object: (NaN, ...)
```

修复动作：

1. 检查是否在前端手拆 WKT 并生成了非法坐标。
2. 切回代理 `boundaryFormat=geojson`。
3. `bounds.extend` 前做坐标有限值检查。
4. 不要调用 `bounds.isValid()`；天地图 `TMapGL.LngLatBounds` 没有这个方法，应改用 `hasBoundsPoint` / 计数器判断是否执行 `fitBounds`。

---

### 错误 C

```text
Input data is not a valid GeoJSON object.
```

修复动作：

1. `map.addSource({ type:'geojson', data })` 的 `data` 必须是 `FeatureCollection`/`Feature`。
2. 不要把 `district[]`、`boundary` 字符串或 `features[]` 直接传给 `data`。
3. 用：
   - `{ type:'FeatureCollection', features: districts.map(d => d.boundaryGeoJSON).filter(Boolean) }`

---

## 6) 编码表辅助（提高命中准确率）

可在 UI 中提供“候选行政区”确认：

```text
GET /api/tianditu/admin-codebook/search?keyword=吴江区&limit=10
```

用于：

- 关键词多义时的人机确认。
- 让 `resolvedKeyword` 更稳定（优先 gb 码查询）。

---

## 7) 反模式（应避免）

1. 直接把官方 `boundary` WKT 用 `replace/split` 粗暴拆分后渲染。
2. 看到 `/api/...` URL 报错后立即改官方接口 + 硬编码 token。
3. 忽略 `suggestion`，在模糊关键词场景下直接默认第一条并静默跳转。
4. 把行政区边界问题误判成“坐标系转换问题”并优先读取 `coordinate-transform`。

---

## 8) 与其他技能的配合

- 行政区内关键字检索（医院/学校/公园）：`references/search-v2.md`
- 面图层样式增强（分级着色）：`references/bindPolygonLayer.md`
- 点击高亮、信息弹窗：`references/bindEvents.md`
