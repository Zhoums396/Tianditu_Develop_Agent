# 场景八：驾车规划

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 从起点到终点做驾车规划
- 有途经点的路线规划
- 需要指定导航策略

## 不要在这些情况使用

- 用户明确要公交或地铁：转到 `scene9-transit-planning.md`
- 用户只想查 POI：转到搜索系列

## 组合场景提示

- 如果起点、终点来自地点名、机构名或详细地址，而不是用户已经明确给出的经纬度，优先先走 `scene5-geocoding.md` 获取真实坐标，再调用驾车规划。
- 例如“国家基础地理信息中心到自然资源部”“故宫到首都机场”这类请求，默认不要凭印象手写坐标。
- 只有当用户已经明确提供 `[lng, lat]` 或 `经度,纬度` 时，才可以直接进入 `/api/tianditu/drive`。

## 当前项目代理参数

当前项目里，驾车规划运行时优先写法是：

```text
GET /api/tianditu/drive?origLng=116.35506&origLat=39.92277&destLng=116.39751&destLat=39.90854&style=0
```

注意这里属于项目代理参数，不要误写成：

- `/api/tianditu/drive?orig=116.35506,39.92277&dest=...`
- `/api/tianditu/drive?start=...&end=...`
- 官方直连 `drive?postStr=...&type=search` 的整段参数格式

## 官方端点

- `http://api.tianditu.gov.cn/drive?postStr=...&type=search`
- 默认 key：`${TIANDITU_TOKEN}`

## 必填参数

| 参数 | 说明 |
| --- | --- |
| `orig` | 起点坐标，`经度,纬度` |
| `dest` | 终点坐标，`经度,纬度` |

## 可选参数

| 参数 | 说明 |
| --- | --- |
| `mid` | 途经点，多个点用分号分隔 |
| `style` | 路线类型 |

## style 取值

| 值 | 含义 |
| --- | --- |
| `0` | 最快路线 |
| `1` | 最短路线 |
| `2` | 避开高速 |
| `3` | 步行 |

## 参数提取规则

- 默认 `style=0`
- 用户说“最短路线”时改用 `1`
- 用户说“不走高速”时改用 `2`
- 用户提供途经点时，把多个点拼成 `mid`

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/drive?postStr={\"orig\":\"116.35506,39.92277\",\"dest\":\"116.39751,39.90854\",\"style\":\"0\"}&type=search&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：最快路线

```bash
curl -s "http://api.tianditu.gov.cn/drive?postStr={\"orig\":\"116.35506,39.92277\",\"dest\":\"116.39751,39.90854\",\"style\":\"0\"}&type=search&tk=${TIANDITU_TOKEN}"
```

### 示例 2：带途经点

```bash
curl -s "http://api.tianditu.gov.cn/drive?postStr={\"orig\":\"116.35506,39.92277\",\"dest\":\"116.39751,39.90854\",\"mid\":\"116.36506,39.91277;116.37506,39.92077\",\"style\":\"0\"}&type=search&tk=${TIANDITU_TOKEN}"
```

### 示例 3：避开高速

```bash
curl -s "http://api.tianditu.gov.cn/drive?postStr={\"orig\":\"116.35506,39.92277\",\"dest\":\"116.39751,39.90854\",\"style\":\"2\"}&type=search&tk=${TIANDITU_TOKEN}"
```

## 返回结构

驾车规划当前实际返回的是 XML，不是 JSON。

```xml
<result orig="116.35506,39.92277" mid="" dest="116.39751,39.90854">
  <parameters>
    <orig>116.35506,39.92277</orig>
    <dest>116.39751,39.90854</dest>
    <mid></mid>
    <style>0</style>
  </parameters>
  <routes count="11" time="0.0">
    <item id="0">
      <strguide>从阜成门内大街向西出发...</strguide>
      <signage>西二环/月坛北桥</signage>
      <streetName>阜成门内大街</streetName>
      <nextStreetName>阜成门桥</nextStreetName>
      <tollStatus>0</tollStatus>
      <turnlatlon>116.35506,39.92249</turnlatlon>
    </item>
  </routes>
  <simple>
    <item id="0">
      <strguide>从阜成门内大街出发...</strguide>
      <streetNames>阜成门内大街</streetNames>
      <lastStreetName></lastStreetName>
      <linkStreetName>阜成门桥</linkStreetName>
      <signage>西二环/月坛北桥</signage>
      <tollStatus>0</tollStatus>
      <turnlatlon>116.35506,39.92249</turnlatlon>
      <streetLatLon>116.35506,39.92277;...</streetLatLon>
    </item>
  </simple>
  <distance>6400</distance>
  <duration>900</duration>
  <routelatlon>116.35506,39.92277;...</routelatlon>
  <mapinfo>
    <center>116.3762,39.9146</center>
    <scale>11</scale>
  </mapinfo>
</result>
```

先认节点层级，再读内容：

- 顶层是 `<result>`，起终点坐标在属性里。
- 路线步骤在 `<routes><item>`。
- 简化步骤在 `<simple><item>`。
- 总距离、总耗时、路线折线在 `<distance>`、`<duration>`、`<routelatlon>`。

## 当前项目代理返回结构

当前项目不会把原始 XML 直接透传给前端，而是先在服务端做兼容解析，再统一返回：

```json
{
  "success": true,
  "data": {
    "format": "xml",
    "distance": 6400,
    "duration": 900,
    "routelatlon": "116.35506,39.92277;...",
    "mapinfo": {
      "center": "116.3762,39.9146",
      "scale": "11"
    },
    "rawXml": "<result ...>...</result>"
  }
}
```

字段映射关系：

| 官方 XML | 代理 `payload.data` |
| --- | --- |
| `<distance>` | `distance` |
| `<duration>` | `duration` |
| `<routelatlon>` | `routelatlon` |
| `<mapinfo><center>` | `mapinfo.center` |
| `<mapinfo><scale>` | `mapinfo.scale` |
| 整段 XML | `rawXml` |

前端通过代理调用时，不要再按 XML 去解析；直接使用 `payload.data.distance / duration / routelatlon`。

## 当前项目推荐组合顺序

如果起点、终点是命名地点，推荐按下面顺序组织代码：

```javascript
async function geocodeAddress(address) {
  var url = new URL('/api/tianditu/geocode', window.location.origin);
  url.searchParams.set('address', address);

  var res = await fetch(url.toString());
  if (!res.ok) throw new Error('地理编码失败: HTTP ' + res.status);

  var payload = await res.json();
  if (!payload || payload.success !== true) {
    throw new Error((payload && payload.error) || '地理编码失败');
  }

  var location = (payload.data && payload.data.location) || {};
  var lng = Number(location.lon);
  var lat = Number(location.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('地理编码未返回有效坐标');
  }
  return [lng, lat];
}

async function planNamedRoute(startName, endName) {
  var startCoords = await geocodeAddress(startName);
  var endCoords = await geocodeAddress(endName);

  var url = new URL('/api/tianditu/drive', window.location.origin);
  url.searchParams.set('origLng', String(startCoords[0]));
  url.searchParams.set('origLat', String(startCoords[1]));
  url.searchParams.set('destLng', String(endCoords[0]));
  url.searchParams.set('destLat', String(endCoords[1]));
  url.searchParams.set('style', '0');

  return fetch(url.toString()).then(function (res) { return res.json(); });
}
```

这种场景里，默认不建议直接写：

```javascript
var startCoords = [116.39751, 39.90854];
var endCoords = [116.404, 39.915];
```

除非用户本身已经明确提供这两个坐标。

## 如何读取关键返回字段

- `result/@orig`、`result/@dest`：起终点坐标
- `parameters/orig`、`parameters/dest`、`parameters/style`
- `routes/@count`：步骤数量
- `routes/item/strguide`：逐步导航文案
- `routes/item/streetName`、`routes/item/nextStreetName`
- `distance`：总距离
- `duration`：总耗时
- `routelatlon`：整条路线折线串
- `mapinfo/center`、`mapinfo/scale`

如果用户要 JSON 结构，应明确说明“这个接口原始返回是 XML，需要先解析或转换”。

## 单位约定

- 官方文档明确写的是：
  - `<distance>`：全长，单位“公里”
  - `<duration>`：总时间，单位“秒”
- `streetDistance` 是分段距离，单位“米”，不要和顶层 `distance` 混用。
- 当前项目代理不会改写这两个字段的数值，只是把 XML 节点转成 JSON 字段。
- 生成前端代码时，优先按：
  - `distance` 直接视为公里显示
  - `duration / 3600` 转小时显示
- 不要在前端先把 `distance` `/1000`，除非用户明确说明后端另行做了米制封装。

## 前端推荐读取顺序

```javascript
fetch('/api/tianditu/drive?...')
  .then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function (payload) {
    if (!payload || payload.success !== true) {
      throw new Error((payload && payload.error) || '代理请求失败');
    }

    var route = payload.data || {};
    var distanceKm = Number(route.distance);
    var durationSec = Number(route.duration);
    var coords = parseLatLonPairs(route.routelatlon || '');

    if (coords.length < 2) {
      throw new Error('未获取到可绘制的路线坐标');
    }

    // 用 distanceKm / durationSec / coords 做渲染
  });
```

## 常见错误

- `orig`、`dest`、`mid` 都是 `经度,纬度`
- 多个途经点用分号分隔
- 必须保留 `type=search`
- 不要把公交规划误写到 `drive` 端点
- 通过代理调用时，不要再写 XML 解析器；直接读 `payload.data`
- 不要把顶层 `distance` 和 `simple/item/streetDistance` 当成同一单位
- 渲染折线前至少校验 `coords.length >= 2`
- 当前项目里，命名地点路线规划应先 `/api/tianditu/geocode?address=...`，不要把地理编码误写成 `/api/tianditu/geocode?query=...`
- 当前项目里，地理编码结果要读 `payload.data.location.lon / lat`，不要误写成 `payload.data.lon / lat`

## 输出模板

```text
已按驾车规划构造天地图请求。

- 端点：/drive
- type：search
- 默认 key：${TIANDITU_TOKEN}
- 坐标顺序：经度,纬度

注意：
这个接口原始返回 XML，不是 JSON。
结果重点查看：
- /result/routes/item/strguide
- /result/distance
- /result/duration
- /result/routelatlon
```
