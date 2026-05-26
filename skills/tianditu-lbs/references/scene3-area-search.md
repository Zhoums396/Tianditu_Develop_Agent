# 场景三：区域约束搜索

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 在某个行政区内搜索
- 在当前地图视野内搜索
- 在多边形范围内搜索

## 不要和这些场景混用

- 只是普通关键词搜索：转到 `scene1-keyword-search.md`
- 只是中心点 + 半径搜索：转到 `scene2-nearby-search.md`
- 只想统计数量：转到 `scene4-category-stats-search.md`

## 官方端点

- 搜索端点：`http://api.tianditu.gov.cn/v2/search`
- 默认 key：`${TIANDITU_TOKEN}`

## 当前项目代理推荐写法

```text
GET /api/tianditu/search?keyWord=医院&queryType=2&level=12&mapBound=116.02524,39.83833,116.65592,39.99185&start=0&count=10
GET /api/tianditu/search?keyWord=学校&queryType=10&polygon=x1,y1,...,x1,y1&start=0&count=10
GET /api/tianditu/search?keyWord=商厦&queryType=12&specify=156110108&start=0&count=10
```

- 推荐优先显式传 `queryType`
- `type=view`、`type=polygon`、`type=admin-area` 仅是当前项目兼容别名，不作为第一选择

## 三种子场景

### 1. 行政区划区域搜索

- `queryType=12`
- 核心参数：`keyWord`、`specify`

适合：
- “在朝阳区搜公园”
- “在北京搜商厦”

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"公园\",\"queryType\":12,\"specify\":\"156110105\",\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

### 2. 视野内搜索

- `queryType=2`
- 核心参数：`keyWord`、`mapBound`、`level`

适合：
- “在当前视野内搜医院”
- 已经有地图边界框时的范围搜索

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"医院\",\"level\":12,\"mapBound\":\"116.02524,39.83833,116.65592,39.99185\",\"queryType\":2,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

### 3. 多边形搜索

- `queryType=10`
- 核心参数：`keyWord`、`polygon`

适合：
- 已有业务范围多边形时的 POI 检索

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/v2/search?postStr={\"keyWord\":\"学校\",\"polygon\":\"118.93232636500011,27.423305726000024,118.93146426300007,27.30976105800005,118.80356153600007,27.311829507000027,118.80469010700006,27.311829508000073,118.8046900920001,27.32381604300008,118.77984777400002,27.32381601800006,118.77984779100007,27.312213007000025,118.76792266100006,27.31240586100006,118.76680145600005,27.429347074000077,118.93232636500011,27.423305726000024\",\"queryType\":10,\"start\":0,\"count\":10}&type=query&tk=${TIANDITU_TOKEN}"
```

## 参数提取规则

- 已有行政区名称或国标码：优先用行政区划区域搜索
- 已有地图边界框：用视野内搜索
- 已有业务多边形：用多边形搜索
- `specify` 优先用 9 位行政区国标码；只有名字时可先用名称作为兜底
- 行政区编码优先从本地表查：
  - `references/data/AdminCode.csv`

## 返回结构

区域约束搜索常见返回仍是搜索 V2.0 的统一 JSON 外壳，最常见是 `resultType=1`。

```json
{
  "count": 221,
  "resultType": 1,
  "prompt": [
    {
      "type": 4,
      "admins": [
        {
          "adminName": "朝阳区",
          "adminCode": 156110105
        }
      ]
    }
  ],
  "pois": [
    {
      "name": "北京奥林匹克公园",
      "address": "北京市朝阳区北辰东路15号",
      "lonlat": "116.386359,39.993463",
      "phone": "010-84972647",
      "poiType": "101",
      "hotPointID": "9E29B41464215F22",
      "source": "0"
    }
  ],
  "lineData": [],
  "status": {
    "cndesc": "服务正常",
    "infocode": 1000
  },
  "keyWord": "公园"
}
```

- `queryType=12` 比较容易带出 `prompt`，表示行政区或关键词还可以继续收敛。
- `queryType=2` 和 `queryType=10` 也大多读 `pois[]`；如果没有命中，优先看 `status.infocode` 和 `prompt`。

## 如何读取关键返回字段

- 通常优先看：
  - `resultType`
  - `pois[].name`
  - `pois[].address`
  - `pois[].lonlat`
- `status.infocode=1000` 时通常表示服务正常
- 如果返回 `prompt`，说明需要用户确认更合适的行政区或关键词

## 常见错误

- 不要把 `specify` 和 `pointLonlat` 混成一类搜索
- `polygon` 首尾坐标对必须相同
- `mapBound` 格式固定为 `minx,miny,maxx,maxy`
- 坐标仍然是 `经度,纬度`
- 当前项目里不要优先依赖 `type=view/polygon/admin-area` 这类代理别名；优先继续使用官方字段名和 `queryType`
- 不要让用户自己再去找行政区编码表，skill 已内置 `AdminCode.csv`

## 输出模板

```text
已按区域约束搜索选择天地图 LBS 模式。

- 端点：/v2/search
- 模式：queryType=2 / 10 / 12
- 默认 key：${TIANDITU_TOKEN}

关键结果优先查看：
- resultType
- pois[].name
- pois[].address
- pois[].lonlat
```
