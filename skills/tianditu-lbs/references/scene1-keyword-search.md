# 场景一：关键词搜索

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 搜一个明确地点、机构、景区、学校、医院
- 搜一个明确类别，如餐厅、酒店、加油站
- 没有“附近”“周边”“范围内”这类限定条件

## 不要在这些情况使用

- 用户明确说“附近”“周边”：转到 `scene2-nearby-search.md`
- 用户给了行政区、视野、多边形范围：转到 `scene3-area-search.md`
- 用户只想统计数量：转到 `scene4-category-stats-search.md`

## 官方端点

- 搜索端点：`http://api.tianditu.gov.cn/v2/search`
- 默认 key：`${TIANDITU_TOKEN}`

## 当前项目代理推荐写法

```text
GET /api/tianditu/search?keyWord=北京大学&queryType=1&level=12&mapBound=116.02524,39.83833,116.65592,39.99185&start=0&count=10&show=2
```

- 推荐继续使用官方字段名：`keyWord`、`queryType`、`level`、`mapBound`、`start`、`count`、`show`
- `keyword` 是当前项目兼容参数，不作为第一选择
- `type=normal` 不是首选写法；关键词搜索请直接传 `queryType=1` 或 `7`

## 必填参数

| 参数 | 说明 |
| --- | --- |
| `keyWord` | 搜索关键词 |
| `queryType` | 关键词搜索场景常用 `1` 或 `7` |
| `level` | 搜索级别，稳妥起见默认带上 |
| `mapBound` | 搜索视野范围，稳妥起见默认带上 |
| `start` | 分页起始位，默认 `0` |
| `count` | 返回条数，建议默认 `10` |

## 可选参数

| 参数 | 说明 |
| --- | --- |
| `specify` | 限定行政区，可用国标码或部分名称 |
| `show` | `1` 返回基础信息，`2` 返回详细 POI 信息 |

## 参数提取规则

- 一般 POI、机构、站点、景区：优先 `queryType=1`
- 明确要做“地名搜索”时，再考虑 `queryType=7`
- `queryType=1/7` 的稳定请求建议同时带 `level` 和 `mapBound`
- 如果用户没有提供范围，默认可用全国视野兜底：
  - `level=5`
  - `mapBound="73,3,135,54"`
- 如果用户已经给了城市、行政区或更小范围，优先缩小 `mapBound` 或补 `specify`
- 如果用户没有要求详细字段，`show` 默认不写
- 如果用户想拿电话、地址、分类等更多信息，补 `show=2`

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"北京大学\",\"level\":5,\"mapBound\":\"73,3,135,54\",\"queryType\":1,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：搜明确地点

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"北京大学\",\"level\":5,\"mapBound\":\"73,3,135,54\",\"queryType\":1,\"start\":0,\"count\":10,\"show\":2}&type=query&tk=${TIANDITU_TOKEN}"
```

### 示例 2：搜明确类别

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"加油站\",\"level\":5,\"mapBound\":\"73,3,135,54\",\"queryType\":1,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

### 示例 3：限定行政区搜关键词

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"博物馆\",\"level\":10,\"mapBound\":\"115.7,39.4,117.4,41.6\",\"queryType\":1,\"specify\":\"156110000\",\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

## 返回结构

关键词搜索先看 `resultType`，不要默认所有结果都只有 `pois[]`。

### `resultType=1`：普通 POI / 机构 / 站点

```json
{
  "count": 1121,
  "resultType": 1,
  "prompt": [
    {
      "type": 4,
      "admins": [
        {
          "adminName": "海淀区",
          "adminCode": 156110108
        }
      ]
    }
  ],
  "pois": [
    {
      "name": "北京大学",
      "address": "北京市海淀区颐和园路5号",
      "lonlat": "116.30355,39.99046",
      "phone": "010-62751407",
      "poiType": "101",
      "hotPointID": "81D8AB160BE41189",
      "source": "0"
    }
  ],
  "lineData": [],
  "status": {
    "cndesc": "服务正常",
    "infocode": 1000
  },
  "keyWord": "北京大学"
}
```

当 `poiType=102` 时，`pois[]` 里常会带公交站补充信息：

```json
{
  "stationData": [
    {
      "stationUuid": "127909",
      "lineName": "地铁13号线",
      "uuid": "22281"
    }
  ]
}
```

### 其他常见类型

```json
{
  "resultType": 4,
  "prompt": [
    {
      "type": 4,
      "admins": [
        {
          "adminName": "北京市",
          "adminCode": 156110000
        }
      ],
      "keyword": "北京大学"
    }
  ]
}
```

```json
{
  "resultType": 5,
  "lineData": [
    {
      "stationNum": "19",
      "poiType": "103",
      "name": "地铁2号线",
      "uuid": "21518"
    }
  ]
}
```

`resultType=2` 是统计结果，`resultType=3` 是行政区结果，结构更适合回看 `scene4` 或 `scene7`。

## 如何读取关键返回字段

- 看 `resultType`
  - `1`：普通 POI 结果
  - `2`：统计结果
  - `3`：行政区结果
  - `4`：建议词
  - `5`：线路结果
- 当 `resultType=1` 时，重点读：
  - `pois[].name`
  - `pois[].address`
  - `pois[].lonlat`
  - `pois[].phone`
  - `pois[].typeName`
- `status.infocode=1000` 时通常表示服务正常
- 如果返回了 `prompt`，说明关键词或行政区仍可继续收敛
- 当 `poiType=102` 时，说明返回的是公交站点，额外关注：
  - `stationData`
  - `uuid`
  - `stationUuid`

## 常见错误

- 不要把 `附近` 场景误用成普通搜索
- 不要默认把所有搜索都写成 `queryType=7`
- 对 `queryType=1/7`，不要只给 `keyWord` 就直接发请求；优先补 `level + mapBound`
- 当前项目里不要优先依赖 `type=normal` 这类代理别名；优先显式传 `queryType`
- 不要忘记 `type=query`
- 需要更多字段时才补 `show=2`

## 输出模板

```text
已按关键词搜索为你匹配天地图 LBS 接口。

- 端点：/v2/search
- queryType：1
- 默认 key：${TIANDITU_TOKEN}

可直接请求：
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={...}&type=query&tk=${TIANDITU_TOKEN}"

结果重点查看：
- resultType
- pois[].name
- pois[].address
- pois[].lonlat
```
