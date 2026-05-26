# 场景四：分类搜索与统计搜索

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 想按分类筛数据
- 想统计某一区域内某类 POI 的数量
- 不一定需要完整 POI 列表

## 不要在这些情况使用

- 想拿 POI 明细列表：优先回到 `scene1`、`scene2` 或 `scene3`
- 想查边界或中心点：转到 `scene7-administrative-lookup.md`

## 官方端点

- 搜索端点：`http://api.tianditu.gov.cn/v2/search`
- 默认 key：`${TIANDITU_TOKEN}`

## 当前项目代理推荐写法

```text
GET /api/tianditu/search?queryType=13&specify=156110000&mapBound=73,3,135,54&dataTypes=法院,公园&start=0&count=5
GET /api/tianditu/search?keyWord=学校&queryType=14&specify=156110108
```

- 推荐继续使用官方字段名：`queryType`、`specify`、`mapBound`、`dataTypes`、`keyWord`
- `type=category`、`type=stats` 只作当前项目兼容别名，不作为新代码首选

## 两种子场景

### 1. 数据分类搜索

- `queryType=13`
- 核心参数：`dataTypes`
- 与官方参数表保持一致时，建议显式补上 `mapBound`

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"queryType\":13,\"start\":0,\"count\":5,\"specify\":\"156110000\",\"mapBound\":\"73,3,135,54\",\"dataTypes\":\"法院,公园\"}&type=query&tk=${TIANDITU_TOKEN}"
```

适合：
- “在北京按分类查法院和公园”
- “按分类列出某行政区的目标数据”

### 2. 统计搜索

- `queryType=14`
- 常见配合参数：`keyWord`、`specify`

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"学校\",\"queryType\":14,\"specify\":\"156110108\"}&type=query&tk=${TIANDITU_TOKEN}"
```

适合：
- “统计海淀区学校数量”
- “统计某区医院数量”

## 参数提取规则

- 如果用户只要“分类过滤”而不是数量，优先 `13`
- 如果用户明确只要“数量、统计”，优先 `14`
- `dataTypes` 支持分类名称或分类编码，多个值用英文逗号分隔
- `specify` 优先填 9 位行政区国标码
- 分类编码优先从本地表查：
  - `references/data/Type.csv`
- 行政区编码优先从本地表查：
  - `references/data/AdminCode.csv`

## 返回结构

分类搜索和统计搜索都走 `/v2/search`，但返回结构不一样，先看 `queryType` 和 `resultType`。

### `queryType=13`：分类搜索

官方说明通常把它描述成标准搜索外壳，结构接近普通搜索：

```json
{
  "count": 1888,
  "resultType": 1,
  "pois": [
    {
      "name": "某医院",
      "address": "北京市朝阳区...",
      "lonlat": "116.45,39.92",
      "phone": "",
      "poiType": "101",
      "typeCode": "120201",
      "typeName": "综合医院"
    }
  ],
  "lineData": [],
  "status": {
    "cndesc": "服务正常",
    "infocode": 1000
  },
  "keyWord": "医院"
}
```

但当前 live / 当前项目代理在一次请求传多个 `dataTypes`（如 `法院,公园`）时，经常返回“按分类名分组”的对象：

```json
{
  "法院": {
    "count": 119,
    "resultType": 1,
    "pois": [{ "name": "中华人民共和国最高人民法院" }],
    "status": { "infocode": 1000, "cndesc": "服务正常" }
  },
  "公园": {
    "count": 1655,
    "resultType": 1,
    "pois": [{ "name": "颐和园" }],
    "status": { "infocode": 1000, "cndesc": "服务正常" }
  }
}
```

### `queryType=14`：统计搜索

通常返回 `resultType=2`，重点读 `statistics`：

```json
{
  "count": 123,
  "resultType": 2,
  "statistics": {
    "count": 123,
    "adminCount": 5,
    "priorityCitys": [
      {
        "name": "海淀区",
        "count": 40,
        "lonlat": "116.298056,39.959912",
        "ename": "Haidian",
        "adminCode": 156110108
      }
    ],
    "allAdmins": [
      {
        "name": "北京市",
        "count": 123,
        "lonlat": "116.4074,39.9042",
        "adminCode": "156110000",
        "ename": "Beijing",
        "isleaf": false
      }
    ],
    "area": [
      {
        "lonlat": "116.4074,39.9042"
      }
    ]
  },
  "status": {
    "cndesc": "服务正常",
    "infocode": 1000
  },
  "keyWord": "学校"
}
```

统计结果里 `priorityCitys`、`allAdmins`、`area` 会随查询条件略有增减，但判读顺序不变：先看 `resultType=2`，再进 `statistics`。

## 如何读取关键返回字段

- `resultType=2` 时通常是统计结果
- 重点看：
  - `statistics`
  - `statistics.count`
  - `statistics.adminCount`
  - `statistics.priorityCitys`
  - `statistics.allAdmins`
- `queryType=13` 时，代码要同时兼容两种结果：
  - 标准外壳：`resultType=1` 后直接读 `pois[]`
  - 多分类分组：遍历顶层分类名，再分别读每组里的 `pois[]`
- `status.infocode=1000` 时通常表示服务正常

## 常见错误

- 不要把 `dataTypes` 当成关键词 `keyWord`
- 分类搜索和统计搜索虽然都走 `search2`，但 `queryType` 不一样
- `queryType=13` 的官方参数表与官方示例在 `mapBound` 上有出入；当前项目新代码请显式传 `mapBound`
- 当前项目里不要优先使用 `type=category` / `type=stats` 代理别名；优先继续使用官方字段名与 `queryType`
- 如果用户要 POI 明细列表，不要只返回统计结果
- 不要让用户单独去下载分类编码表，skill 已内置 `Type.csv`

## 输出模板

```text
已按分类/统计搜索构造天地图 LBS 请求。

- 端点：/v2/search
- queryType：13 或 14
- 默认 key：${TIANDITU_TOKEN}

结果重点查看：
- resultType
- statistics
- statistics.adminCount
- statistics.allAdmins
```
