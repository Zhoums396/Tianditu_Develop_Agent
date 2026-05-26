# 场景九：公交/地铁规划

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 查询公交路线
- 查询地铁换乘
- 希望按“较快捷 / 少换乘 / 少步行 / 不坐地铁”规划

## 不要在这些情况使用

- 用户明确要驾车规划：转到 `scene8-drive-route.md`
- 用户已经有公交 `uuid`，要查明细：转到 `scene10-bus-detail.md`

## 官方端点

- `http://api.tianditu.gov.cn/transit?type=busline&postStr=...`
- 默认 key：`${TIANDITU_TOKEN}`

## 必填参数

官方参数说明页写的是：

- `startPosition`
- `endPosition`
- `lineType`

但官方示例请求使用的是小写键名：

- `startposition`
- `endposition`
- `linetype`

为了避免弱 AI 混乱，默认按官方示例使用小写键名发请求。

## linetype 规则

`linetype` 按位控制，可组合：

| 值位 | 含义 |
| --- | --- |
| 第 0 位 | `1`，较快捷 |
| 第 1 位 | `1`，少换乘 |
| 第 2 位 | `1`，少步行 |
| 第 3 位 | `1`，不坐地铁 |

常见取值：

| linetype | 含义 |
| --- | --- |
| `1` | 较快捷 |
| `2` | 少换乘 |
| `4` | 少步行 |
| `8` | 不坐地铁 |
| `3` | 较快捷 + 少换乘 |
| `5` | 较快捷 + 少步行 |
| `10` | 少换乘 + 不坐地铁 |

默认使用 `1`。

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"startposition\":\"116.427562,39.939677\",\"endposition\":\"116.349329,39.939132\",\"linetype\":\"1\"}&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：较快捷

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"startposition\":\"116.427562,39.939677\",\"endposition\":\"116.349329,39.939132\",\"linetype\":\"1\"}&tk=${TIANDITU_TOKEN}"
```

### 示例 2：少换乘

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"startposition\":\"116.427562,39.939677\",\"endposition\":\"116.349329,39.939132\",\"linetype\":\"2\"}&tk=${TIANDITU_TOKEN}"
```

### 示例 3：少换乘且不坐地铁

```bash
curl -s "http://api.tianditu.gov.cn/transit?type=busline&postStr={\"startposition\":\"116.427562,39.939677\",\"endposition\":\"116.349329,39.939132\",\"linetype\":\"10\"}&tk=${TIANDITU_TOKEN}"
```

## 返回结构

公交/地铁规划返回 JSON，先看 `resultCode`，再读 `results[]`。

```json
{
  "hasSubway": true,
  "resultCode": 0,
  "results": [
    {
      "lineType": 1,
      "lines": [
        {
          "lineName": "地铁2号线 |",
          "segments": [
            {
              "stationStart": {
                "name": "东直门站",
                "uuid": "121227",
                "lonlat": "116.427562,39.939677"
              },
              "stationEnd": {
                "name": "西直门站",
                "uuid": "121230",
                "lonlat": "116.349338,39.939135"
              },
              "segmentType": 1,
              "segmentLine": [
                {
                  "lineName": "地铁2号线",
                  "linePoint": "116.427561,39.939676;...",
                  "segmentDistance": 7800,
                  "segmentTime": 900,
                  "segmentTransferTime": 0,
                  "segmentStationCount": 6,
                  "direction": "内环",
                  "byuuid": "21518",
                  "SEndTime": "23:00"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

`hasSubway` 在 live 返回里常见为布尔值，也可能在文档说明里写成 `0/1`，读取时两种都兼容。

## 如何读取关键返回字段

- `resultCode`
  - `0`：正常返回线路
  - `1`：找不到起点
  - `2`：找不到终点
  - `3`：规划失败
  - `4`：起终点太近，建议步行
  - `5`：起终点 500 米内仍返回线路
  - `6`：输入参数错误
- `hasSubway`
- `results[]`
- `results[].lines[]`
- `lines[].lineName`
- `lines[].segments`
- `segments[].stationStart`
- `segments[].stationEnd`
- `segments[].segmentLine`
- `segmentLine[].segmentDistance`
- `segmentLine[].segmentTime`

## 常见错误

- 坐标顺序仍然是 `经度,纬度`
- 默认按官方示例使用 `startposition`、`endposition`、`linetype`
- 不要把 `linetype` 当作单选枚举，它支持按位组合
- 别把公交规划和 `uuid` 明细查询混写

## 输出模板

```text
已按公交/地铁规划构造天地图请求。

- 端点：/transit?type=busline
- 规划类型：linetype
- 默认 key：${TIANDITU_TOKEN}

结果重点查看：
- resultCode
- hasSubway
- results[].lines[]
- lines[].segments
- segments[].segmentLine[]
```
