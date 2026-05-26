# 场景二：周边搜索

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 搜某个点附近的餐厅、酒店、医院、景区
- 输入里同时包含“中心位置”和“搜索类别”

## 不要在这些情况使用

- 没有中心点，只是普通关键词搜索：转到 `scene1-keyword-search.md`
- 用户给的是行政区范围、视野范围、多边形范围：转到 `scene3-area-search.md`

## 官方端点

- 搜索端点：`http://api.tianditu.gov.cn/v2/search`
- 对应 `queryType=3`
- 默认 key：`${TIANDITU_TOKEN}`

## 当前项目代理推荐写法

```text
GET /api/tianditu/search?keyWord=公园&queryType=3&pointLonlat=116.48016,39.93136&queryRadius=5000&start=0&count=10&show=2
```

- 推荐继续使用官方字段名：`keyWord`、`queryType`、`pointLonlat`、`queryRadius`、`start`、`count`、`show`
- `lng/lat/radius`、`type=nearby` 属于当前项目兼容别名，不作为新代码首选

## 必填参数

| 参数 | 说明 |
| --- | --- |
| `keyWord` | 要搜索的类别或目标 |
| `pointLonlat` | 中心点坐标，格式 `经度,纬度` |
| `queryRadius` | 查询半径，单位米，最大 10 公里 |
| `queryType` | 固定为 `3` |
| `start` | 分页起始位，默认 `0` |
| `count` | 返回条数，建议默认 `10` |

## 可选参数

| 参数 | 说明 |
| --- | --- |
| `level` | 查询级别，官方示例常用 `12` |
| `show` | `1` 基础信息，`2` 详细信息 |

## 参数提取规则

- 如果用户给了经纬度，直接填 `pointLonlat`
- 如果用户给的是地址或地名，先做地理编码，再把结果填进 `pointLonlat`
- 半径默认 `1000`
- 用户明确要求“3 公里内”“5 公里内”时，按用户半径改写
- 官方参数表没有把 `level` 列为周边搜索必填；如果当前代码没有缩放级别依赖，可以不传 `level`

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"咖啡店\",\"pointLonlat\":\"116.39751,39.90854\",\"queryRadius\":1000,\"queryType\":3,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：1 公里内搜酒店

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"酒店\",\"pointLonlat\":\"116.39751,39.90854\",\"queryRadius\":1000,\"queryType\":3,\"start\":0,\"count\":10,\"show\":2}&type=query&tk=${TIANDITU_TOKEN}"
```

### 示例 2：5 公里内搜公园

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"公园\",\"pointLonlat\":\"116.48016,39.93136\",\"queryRadius\":5000,\"queryType\":3,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

### 示例 3：带 level 的官方风格写法

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"医院\",\"level\":12,\"queryRadius\":5000,\"pointLonlat\":\"116.48016,39.93136\",\"queryType\":3,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

## 返回结构

周边搜索通常返回 `resultType=1`，和普通搜索相同，但 `pois[]` 里多一个距离字段。

```json
{
  "count": 5,
  "resultType": 1,
  "pois": [
    {
      "name": "LUCKINCOFFEE瑞幸咖啡(APM店)",
      "address": "北京市东城区王府井大街138号新东安广场四层L426B号店铺",
      "lonlat": "116.405395,39.912423",
      "distance": "799m",
      "phone": "",
      "poiType": "101",
      "hotPointID": "695A4268EE58179F",
      "source": "0"
    }
  ],
  "lineData": [],
  "status": {
    "cndesc": "服务正常",
    "infocode": 1000
  },
  "keyWord": "咖啡店"
}
```

如果写了 `show=2`，`pois[]` 里还可能多出分类、行政区、英文名等详细字段。

## 如何读取关键返回字段

- 优先看：
  - `pois[].name`
  - `pois[].address`
  - `pois[].lonlat`
  - `pois[].distance`
- `status.infocode=1000` 时通常表示服务正常
- `distance` 单位会自动按米或千米返回

## 常见错误

- `pointLonlat` 顺序不要写反，必须是 `经度,纬度`
- 半径最大 10 公里，不要无上限放大
- 周边搜索的核心是有中心点，没有中心点不要硬写
- 当前项目里不要优先使用 `type=nearby&lng=...&lat=...` 这种代理别名模板；优先显式传 `queryType=3` 和官方字段名

## 输出模板

```text
已按周边搜索构造天地图 LBS 请求。

- 端点：/v2/search
- queryType：3
- 中心点：经度,纬度
- 半径：默认 1000 米
- 默认 key：${TIANDITU_TOKEN}

请求重点查看：
- resultType
- pois[].name
- pois[].address
- pois[].distance
```
