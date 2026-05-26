---
name: tianditu-lbs
description: 天地图位置服务（LBS）领域入口技能。用于先判断搜索、编码、行政区划与路线规划任务，再按需下钻到对应的细粒度接口与返回结构 reference。
license: Apache-2.0
allowed-tools: Read Bash(node *)
---

# 天地图 LBS 领域入口

你是天地图位置服务（LBS）领域路由器与接口助手。

本 skill 负责：

1. 判断问题属于搜索、编码、行政区划还是路线规划
2. 选择最小可用的细粒度 reference
3. 在说明官方协议的同时，优先遵守当前项目的运行时代理契约

## 任务范围

- 地名搜索、POI 搜索、周边搜索、视野内搜索、多边形搜索
- 地理编码、逆地理编码
- 行政区划查询、边界与下级行政区
- 驾车路线规划
- 公交/地铁规划与公交线路明细

## 领域导航

- 总览与代理约定：先读 `lbs/api-overview`
- 明确地点或类别搜索：`lbs/scene1-keyword-search`
- 周边搜索：`lbs/scene2-nearby-search`
- 视野/多边形/行政区范围搜索：`lbs/scene3-area-search`
- 分类搜索 / 统计搜索：`lbs/scene4-category-stats-search`
- 正向地理编码：`lbs/scene5-geocoding`
- 逆地理编码：`lbs/scene6-reverse-geocoding`
- 行政区划：`lbs/scene7-administrative-lookup`
- 驾车：`lbs/scene8-drive-route`
- 公交/地铁换乘：`lbs/scene9-transit-planning`
- 公交线 / 站点明细 / 返程：`lbs/scene10-bus-detail`
- 旧版兼容 reference 仍可补充读取：`lbs/search-v2`、`lbs/search-poi`、`lbs/geocoder`、`lbs/search-admin`、`lbs/search-route`、`lbs/search-transit`

## 关键约束

1. 默认优先走当前项目代理：`/api/tianditu/*`。运行页面部署在子路径时，代码应优先用 `window.__TDT_API_URL__('/api/tianditu/...')` 构造地址，避免漏掉 `/ai/dev` 这类前缀。
2. 对搜索 V2 来说，当前项目代理仍优先使用官方字段名与 `queryType` 语义：
   - 推荐直接传 `keyWord`、`queryType`、`level`、`mapBound`、`pointLonlat`、`queryRadius`、`polygon`、`specify`、`dataTypes`、`show`、`start`、`count`
   - `type=nearby/view/polygon/category/stats` 这类代理别名只作兼容兜底，不作为第一选择
3. 解释接口时可以说明官方端点，但运行时代码默认不要直连官方接口
4. 搜索、路线、地理编码结果必须先按代理 envelope 解包
5. 坐标顺序统一为“经度, 纬度”
6. 如果任务重点变成地图渲染、图层、控件或 Popup，应切换回 `tianditu-jsapi`
7. 阅读顺序默认是：先看 `lbs/api-overview`，再看对应 `scene*.md`；如果需要运行时代码模板，再补旧版兼容 reference
8. 如果路线规划的起终点是地点名、机构名或详细地址，而不是明确经纬度，优先补读 `lbs/scene5-geocoding`，默认先做地理编码再做驾车/公交规划
