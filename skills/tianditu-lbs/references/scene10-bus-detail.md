# 场景十：公交明细查询

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 已有公交线路 `uuid`，要查线路详情
- 已有公交站点 `uuid`，要查站点详情
- 已有 `lineUuid + stationUuid`，要查返程线路

## 不要在这些情况使用

- 用户是要做起终点公交规划：转到 `scene9-transit-planning.md`

## 官方端点

- `http://api.tianditu.gov.cn/transit?type=busline&postStr=...`
- 默认 key：`${TIANDITU_TOKEN}`

## 三种请求

### 1. 用 uuid 查询公交线或站点明细

最小模板：

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"uuid\":\"23212\"}&tk=${TIANDITU_TOKEN}"
```

官方页写的是：如果 `uuid` 对应线路，返回 `lineinfo`；如果 `uuid` 对应站点，返回 `Stationdata`。
但 live 接口常见是直接返回顶层线路字段或顶层站点字段，不一定额外包一层 `lineinfo` / `Stationdata`。解释时优先按真实返回为准。

### 2. 查询公交站点详情

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"uuid\":\"133057\"}&tk=${TIANDITU_TOKEN}"
```

### 3. 查询返程线路

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"lineUuid\":\"21169\",\"stationUuid\":\"128156\"}&tk=${TIANDITU_TOKEN}"
```

## 参数提取规则

- 用户明确说“线路 uuid”：直接用 `uuid`
- 用户明确说“站点 uuid”：也用 `uuid`
- 用户说“返程线路”或“是否有反向线路”：用 `lineUuid + stationUuid`

## 返回结构

### 线路 `uuid` 明细

live 返回常见是平铺字段：

```json
{
  "ticketcal": 1,
  "ismanual": 1,
  "linepoint": "116.367231,39.947344;...",
  "linetype": 1,
  "totalprice": 0,
  "length": 12345,
  "starttime": "05:10",
  "endtime": "22:30",
  "stationnum": 19,
  "totaltime": 42,
  "station": [
    {
      "name": "西直门站",
      "uuid": "127909",
      "lonlat": "116.347069,39.940267"
    }
  ],
  "isbidirectional": 1,
  "linename": "地铁2号线",
  "interval": 5,
  "company": "..."
}
```

### 站点 `uuid` 明细

```json
{
  "name": "西直门站",
  "uuid": "127909",
  "linedata": [],
  "lonlat": "116.347069,39.940267"
}
```

### `lineUuid + stationUuid` 返程线路

这个请求常见有两种返回：

```json
{
  "ticketcal": 0,
  "linepoint": "109.892721,40.576648;...",
  "linename": "...",
  "station": [
    {
      "name": "...",
      "uuid": "...",
      "lonlat": "..."
    }
  ]
}
```

```json
{
  "resultCode": "6"
}
```

如果返回空体、`resultCode` 或字段很少，表示这组 `lineUuid + stationUuid` 没有稳定命中返程线路，需要如实说明。

## 如何读取关键返回字段

### 线路明细常见字段

- `linename`
- `length`
- `station`
- `starttime`
- `endtime`
- `totaltime`
- `stationnum`
- `interval`
- `totalprice`
- `company`
- `linepoint`

### 站点明细常见字段

- `name`
- `uuid`
- `linedata`
- `lonlat`

### 返程线路查询

- 重点看是否返回线路详情字段，或只返回 `resultCode`
- 如果没有返程结果，要明确说明“该站点与线路组合未返回反向线路”

## 常见错误

- 不要把 `uuid` 查询误当作规划请求
- 不要把 `lineUuid` 和 `stationUuid` 混成一个字段
- 如果只有一个 `uuid`，先不要臆断它一定是线路还是站点，要以返回结构为准

## 输出模板

```text
已按公交明细查询构造天地图请求。

- 端点：/transit?type=busline
- 请求类型：uuid 明细 / 返程线路
- 默认 key：${TIANDITU_TOKEN}

结果重点查看：
- linename / station[]
- name / linedata / lonlat
- lineUuid / stationUuid 对应的返程结果
```
