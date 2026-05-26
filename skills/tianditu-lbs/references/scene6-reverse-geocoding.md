# 场景六：逆地理编码

## 当前项目代理优先

- 运行时代码优先调用 `/api/tianditu/*` 代理，不要在前端直接拼接 `tk`。
- 如果前端通过代理调用，必须先判断 `payload.success===true`，再从 `payload.data` 读取业务字段。
- 下文的“返回结构”主要用于说明业务字段形状；通过代理调用时，这些字段通常位于 `payload.data` 内。
- 驾车规划是特例：当前项目代理会把原始 XML 兼容转换为 JSON 对象，再放进 `payload.data`。


## 适用任务

- 把经纬度坐标转换成结构化地址
- 需要拿到附近 POI、道路、地址组件

## 不要在这些情况使用

- 用户给的是地址，要转坐标：转到 `scene5-geocoding.md`

## 官方端点

- `http://api.tianditu.gov.cn/geocoder?postStr=...&type=geocode`
- 默认 key：`${TIANDITU_TOKEN}`

## 必填参数

| 参数 | 说明 |
| --- | --- |
| `lon` | 经度 |
| `lat` | 纬度 |

## 可选参数

| 参数 | 说明 |
| --- | --- |
| `ver` | 接口版本，官方示例使用 `1` |

## 最小请求模板

```bash
curl -s "http://api.tianditu.gov.cn/geocoder?postStr={'lon':116.37304,'lat':39.92594,'ver':1}&type=geocode&tk=${TIANDITU_TOKEN}"
```

## 完整示例

### 示例 1：坐标转详细地址

```bash
curl -s "http://api.tianditu.gov.cn/geocoder?postStr={'lon':116.37304,'lat':39.92594,'ver':1}&type=geocode&tk=${TIANDITU_TOKEN}"
```

### 示例 2：景区坐标反查

```bash
curl -s "http://api.tianditu.gov.cn/geocoder?postStr={'lon':116.39078,'lat':39.91743,'ver':1}&type=geocode&tk=${TIANDITU_TOKEN}"
```

## 返回结构

逆地理编码返回 JSON，重点读 `result` 和 `result.addressComponent`。

```json
{
  "result": {
    "formatted_address": "北京市东城区东华门街道公厕",
    "location": {
      "lon": 116.39751,
      "lat": 39.90854
    },
    "addressComponent": {
      "address": "南池子大街136号正南方向71米",
      "nation": "中国",
      "province": "北京市",
      "province_code": "156110000",
      "city": "",
      "city_code": "",
      "county": "东城区",
      "county_code": "156110101",
      "town": "东华门街道",
      "town_code": "156110101001",
      "road": "南池子大街",
      "poi": "公厕",
      "road_distance": 43,
      "address_distance": 30,
      "poi_distance": 30,
      "poi_position": "东南",
      "address_position": "东南"
    }
  },
  "msg": "ok",
  "status": "0"
}
```

官方页里有些说明文字会写成 `address_distince`、`poi_distince`、`road_distince`，但 live 返回常见的是 `*_distance`。解释结果时优先按真实 JSON。

## 如何读取关键返回字段

- `status`
  - `0`：正确
  - `1`：错误
  - `404`：出错
- `msg`
- `result.formatted_address`
- `result.addressComponent`
- `result.addressComponent.poi`
- `result.addressComponent.road`
- `result.location`

## 常见错误

- 逆地理编码必须加 `type=geocode`
- `postStr` 里写的是 `lon` 和 `lat`，仍然不要写反
- 不要把 `location` 当成输入参数，它是返回结果中的字段

## 输出模板

```text
已按逆地理编码构造天地图请求。

- 端点：/geocoder
- 参数容器：postStr
- type：geocode
- 默认 key：${TIANDITU_TOKEN}

关键结果：
- result.formatted_address
- result.addressComponent
- result.addressComponent.poi
- result.addressComponent.road
```
