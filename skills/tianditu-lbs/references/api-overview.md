# 天地图 LBS 总览

## 当前项目运行时优先

- 运行时代码优先调用当前项目代理：`/api/tianditu/*`
- 如果通过代理调用，前端必须先解包 envelope：
  - 先判断 `payload.success === true`
  - 再从 `payload.data` 读取业务字段
- 本目录各 `scene*.md` 的“返回结构”主要用于说明业务字段形状；当你在当前项目里写代码时，这些字段通常位于 `payload.data` 内
- 驾车规划是特例：当前项目代理会把官方 XML 兼容转换为 JSON 对象后再返回到 `payload.data`

## 当前项目代理矩阵

| 场景 | 运行时优先端点 | 前端先读什么 | 关键业务字段 |
| --- | --- | --- | --- |
| 搜索 V2 / POI | `/api/tianditu/search` | `payload.success` -> `payload.data` | `resultType`、`pois`、`status.infocode`、`pois[].lonlat` |
| 正向编码 | `/api/tianditu/geocode` | `payload.success` -> `payload.data` | `location.lon`、`location.lat`、`status` |
| 逆向编码 | `/api/tianditu/reverse-geocode` | `payload.success` -> `payload.data` | `result.formatted_address`、`result.addressComponent` |
| 行政区划 | `/api/tianditu/administrative` | `payload.success` -> `payload.data` 以及 `payload.meta` | `data.district[]`、`rootDistrict[]`、`boundaryGeoJSON`、`meta` |
| 驾车规划 | `/api/tianditu/drive` | `payload.success` -> `payload.data` | `distance`、`duration`、`routelatlon`、`mapinfo.center` |
| 公交 / 地铁 | `/api/tianditu/transit` | `payload.success` -> `payload.data` | `resultCode`、`results[].lines[]`、`segments[].segmentLine[].linePoint` |

## 当前项目代理参数速查

这些参数名属于当前项目代理，不要和官方直连端点混用：

| 场景 | 当前项目代理写法 | 不要误写成 |
| --- | --- | --- |
| 正向编码 | `/api/tianditu/geocode?address=自然资源部` | `/api/tianditu/geocode?query=...`、`/api/tianditu/geocoder?ds=...` |
| 逆向编码 | `/api/tianditu/reverse-geocode?lng=116.40&lat=39.90` | `/api/tianditu/reverse-geocode?lon=...` |
| 驾车规划 | `/api/tianditu/drive?origLng=...&origLat=...&destLng=...&destLat=...&style=0` | `/api/tianditu/drive?orig=...&dest=...` |
| 公交 / 地铁 | `/api/tianditu/transit?startLng=...&startLat=...&endLng=...&endLat=...` | `/api/tianditu/transit?orig=...&dest=...` |

## 当前项目搜索代理推荐写法

搜索 V2 在当前项目里仍然建议保持“官方字段名 + 官方 `queryType`”不变，只是把官方 `postStr` 拆成 query string：

```text
GET /api/tianditu/search?keyWord=北京大学&queryType=1&level=12&mapBound=116.02,39.83,116.65,39.99&start=0&count=10
GET /api/tianditu/search?keyWord=医院&queryType=2&level=12&mapBound=116.02,39.83,116.65,39.99&start=0&count=10
GET /api/tianditu/search?keyWord=公园&queryType=3&pointLonlat=116.48016,39.93136&queryRadius=5000&start=0&count=10
GET /api/tianditu/search?keyWord=学校&queryType=10&polygon=x1,y1,...,x1,y1&start=0&count=10
GET /api/tianditu/search?keyWord=商厦&queryType=12&specify=156110108&start=0&count=10
GET /api/tianditu/search?queryType=13&specify=156110000&mapBound=73,3,135,54&dataTypes=法院,公园&start=0&count=5
GET /api/tianditu/search?keyWord=学校&queryType=14&specify=156110108
```

补充说明：

- 推荐优先使用 `keyWord`，这样和官方 `postStr` 字段完全一致；`keyword` 仅是当前项目兼容写法。
- 推荐优先显式传 `queryType`，不要把 `type=nearby/view/polygon/category/stats` 当主写法。
- `type=nearby/view/...` 仍可兼容，但只建议用于历史代码，不建议再作为新生成代码模板。

## 当前项目代理读取速查

| 场景 | 正确读取方式 | 常见误读 |
| --- | --- | --- |
| 正向编码 | `payload.data.location.lon / payload.data.location.lat` | `payload.data.lon / payload.data.lat` |
| 逆向编码 | `payload.data.result.formatted_address` | `payload.data.formatted_address` |
| 驾车规划 | `payload.data.distance / duration / routelatlon` | 重新按 XML 节点做前端解析 |
| 搜索 V2 | `payload.data.pois[]` | `payload.pois[]` |

## 默认规则

- 默认 API Key：`${TIANDITU_TOKEN}`
- 如果用户没有主动提供新 key，官方协议示例默认使用这个 key
- 如果用户主动提供其他 key，优先使用用户提供的值
- 天地图 LBS 坐标顺序默认写作 `经度,纬度`

## 本地编码表

skill 已内置两份官方编码表，优先本地查，不要再让用户单独下载 Excel：

- 行政区编码表：`references/data/AdminCode.csv`
- 分类编码表：`references/data/Type.csv`

这两份文件来自官方下载地址，已转成 UTF-8 便于本地检索：

- `https://download.tianditu.gov.cn/download/xzqh/AdminCode.csv`
- `https://download.tianditu.gov.cn/download/xzqh/Type.csv`

推荐用法：

```bash
rg "北京|156110000" references/data/AdminCode.csv
rg "咖啡馆|110303" references/data/Type.csv
```

## 官方页面与能力边界

| 官方页面 | 主要能力 | 实际端点 |
| --- | --- | --- |
| `guide.html` | 能力总览 | 无单独业务端点 |
| `search2.html` | 搜索 V2.0，多模式 | `http://api.tianditu.gov.cn/v2/search` |
| `bus.html` | 公交规划、公交线/站明细、返程线路 | `http://api.tianditu.gov.cn/transit?type=busline` |
| `geocodinginterface.html` | 正向地理编码 | `http://api.tianditu.gov.cn/geocoder?ds=...` |
| `geocoding.html` | 逆地理编码 | `http://api.tianditu.gov.cn/geocoder?postStr=...&type=geocode` |
| `administrative2.html` | 行政区划查询 | `http://api.tianditu.gov.cn/v2/administrative` |
| `drive.html` | 驾车规划 | `http://api.tianditu.gov.cn/drive?postStr=...&type=search` |

## 搜索 V2.0 的 queryType 对照

`search2.html` 是同一端点下的多种模式，必须按 `queryType` 区分：

| queryType | 场景 | 说明 |
| --- | --- | --- |
| `1` | 普通搜索 | 一般 POI / 机构 / 地点搜索 |
| `2` | 视野内搜索 | 已有地图边界时使用 |
| `3` | 周边搜索 | 已有中心点和半径时使用 |
| `7` | 地名搜索 | 明确要做地名检索时使用 |
| `10` | 多边形搜索 | 已有多边形范围时使用 |
| `12` | 行政区划区域搜索 | 已知行政区名称或国标码时使用 |
| `13` | 数据分类搜索 | 只按分类筛数据时使用 |
| `14` | 统计搜索 | 只想要数量或统计时使用 |

## 与官方搜索说明保持一致时要注意的点

1. `queryType=13`（数据分类搜索）
   - 官方参数表写 `mapBound` 必填
   - 官方示例 `1.5.3` 又省略了 `mapBound`
   - 当前项目代理为了兼容性可以补默认范围，但新代码仍建议显式传 `mapBound`，这样最接近官方参数表
2. `queryType=13` 的返回
   - 官方说明把它描述成标准搜索外壳（`resultType=1` + `pois[]`）
   - 当前 live / 当前项目代理在一次请求传多个 `dataTypes`（如 `法院,公园`）时，常见返回是按分类名分组的对象
   - 因此当前项目运行时代码建议同时兼容两种形态：
     - 标准外壳：`payload.data.resultType / payload.data.pois`
     - 多分类分组：`payload.data["法院"] / payload.data["公园"]`
3. `queryType=3`（周边搜索）
   - 官方参数表不要求 `level`
   - 官方示例里出现了 `level`
   - 当前项目代码如果没有明确缩放级别依赖，可以不传 `level`

## bus 接口的三类请求

同一个 `transit?type=busline` 端点下，至少有三种用法：

1. 公交/地铁规划
2. 用 `uuid` 查询公交线或站点明细
3. 用 `lineUuid + stationUuid` 查询返程线路

不要把这三类请求混成一个模板。

## 返回结构阅读约定

- 搜索、编码、行政区划、公交接口通常返回 JSON。
- 驾车规划当前实际返回 XML，不要按 JSON 结构去猜字段。
- 每个 scene 文档都带 `返回结构` 小节，先认顶层结构，再看 `如何读取关键返回字段`。
- 如果官方页里的包装名和 live 返回略有差异，例如公交明细里的 `lineinfo` / `Stationdata`，优先以真实返回字段为准，再参考官方命名。
- 如果是在当前项目运行时里写前端代码，再额外做一步：先解包 `payload.success / payload.data`，然后按 scene 文档里的字段读取业务结果。

## 关键共识

- 用户问“搜某地附近的某类地点”，优先走 `scene2-nearby-search.md`
- 用户问“查行政区边界或中心点”，优先走 `scene7-administrative-lookup.md`
- 用户问“从 A 到 B 怎么坐公交”，优先走 `scene9-transit-planning.md`
- 用户问“从 A 到 B 开车怎么走”，优先走 `scene8-drive-route.md`
- 如果 A/B 是地点名、机构名或详细地址，而不是明确经纬度，优先先读 `scene5-geocoding.md`，拿到真实坐标后再进入 `scene8-drive-route.md` 或 `scene9-transit-planning.md`
- 命名地点路线规划的推荐顺序通常是：
  1. `/api/tianditu/geocode?address=...` 获取起点坐标
  2. `/api/tianditu/geocode?address=...` 获取终点坐标
  3. `/api/tianditu/drive` 或 `/api/tianditu/transit` 做路线规划
  4. 地图侧只负责渲染坐标、路线和交互，不要凭印象手写机构坐标

## 搜索 V2.0 常见返回码

这些返回码主要来自 `search2.html`：

| infocode | 含义 |
| --- | --- |
| `1000` | 服务正常 |
| `2001` | 请求参数错误 |
| `2002` | 参数格式错误 |
| `2003` | 缺少必填参数 |
| `2004` | 参数枚举值错误 |
| `2005` | 经纬度数据错误 |
| `2006` | 经纬度越界或点过多 |
| `2007` | 请求数据量溢出 |
| `3000` | 服务器异常 |
| `3001` | 没有找到数据 |

## 不在本轮范围内

- 静态地图 API
- 你没有提供官方页面的其他 LBS 子接口
