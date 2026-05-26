# 场景七：行政区划查询

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 用行政区名称或编码查中心点
- 查行政区轮廓边界
- 查下级行政区列表

## 不要在这些情况使用

- 用户是要查 POI：优先回到搜索系列
- 用户只是想统计 POI：优先 `scene4-category-stats-search.md`

## 官方端点

- `http://api.tianditu.gov.cn/v2/administrative`
- 默认 key：`${TIANDITU_TOKEN}`

## 必填参数

| 参数 | 说明 |
| --- | --- |
| `keyword` | 行政区划名称或编码，只支持单个关键词 |

## 可选参数

| 参数 | 说明 |
| --- | --- |
| `childLevel` | 返回下级行政区层级，`0-3` |
| `extensions` | 是否返回边界轮廓，`true/false` |

## 参数提取规则

- 查中心点：`childLevel=0` 即可
- 查下级行政区：按需要设置 `childLevel=1/2/3`
- 查边界：`extensions=true`
- `keyword` 只有一个字符时，只返回 `suggestion`，一般不返回 `district`
- 行政区名称和国标码优先从本地表查：
  - `references/data/AdminCode.csv`

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/v2/administrative?keyword=156110000&childLevel=0&extensions=true&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：按编码查北京边界

```bash
curl -s "http://api.tianditu.gov.cn/v2/administrative?keyword=156110000&childLevel=0&extensions=true&tk=${TIANDITU_TOKEN}"
```

### 示例 2：按名称查杭州及下一级行政区

```bash
curl -s "http://api.tianditu.gov.cn/v2/administrative?keyword=杭州&childLevel=1&extensions=false&tk=${TIANDITU_TOKEN}"
```

### 示例 3：查省市县三级下钻

```bash
curl -s "http://api.tianditu.gov.cn/v2/administrative?keyword=河南&childLevel=3&extensions=false&tk=${TIANDITU_TOKEN}"
```

## 返回结构

行政区划接口返回 JSON，`data.district` 是数组，不是单个对象。

```json
{
  "status": 200,
  "message": "成功",
  "data": {
    "suggestion": [
      {
        "name": "河南省",
        "gb": "156410000"
      }
    ],
    "district": [
      {
        "gb": "156330100",
        "pgb": "156330000",
        "name": "杭州市",
        "center": {
          "lng": 120.204218,
          "lat": 30.247755
        },
        "level": 3,
        "boundary": "MULTIPOLYGON(((...)))",
        "children": [
          {
            "gb": "156330102",
            "pgb": "156330100",
            "name": "上城区",
            "center": {
              "lng": 120.193231,
              "lat": 30.229417
            },
            "level": 2,
            "children": []
          }
        ]
      }
    ]
  }
}
```

- `data.suggestion[]` 是模糊提示。
- 真正的主体通常在 `data.district[0]`。
- `extensions=true` 时常见 `boundary`，`extensions=false` 时可能不返回该字段。
- `boundary` 是 WKT 字符串，常见形态为 `MULTIPOLYGON(((...)))`。

## 如何读取关键返回字段

- `status`
  - `200`：正常
- `message`
- `data.suggestion`
- `data.district[0].name`
- `data.district[0].gb`
- `data.district[0].center.lng`
- `data.district[0].center.lat`
- `data.district[0].boundary`
- `data.district[0].children`

## 常见错误

- `keyword` 只支持单个关键词，不要一次传多个行政区
- 查边界时要显式写 `extensions=true`
- `childLevel` 默认是 `0`
- 名称支持模糊，编码不支持模糊
- 官方下载的是 CSV，不是 `.xlsx`；skill 已经内置本地编码表，优先直接查本地

## 输出模板

```text
已按行政区划查询构造天地图请求。

- 端点：/v2/administrative
- 默认 key：${TIANDITU_TOKEN}
- 是否返回边界：extensions=true/false
- 下级层级：childLevel=0-3

关键结果：
- data.district[0].center
- data.district[0].boundary
- data.district[0].children
```
