# OpenFinLens 数据 API 与 MCP 链路

> 面向 LLM Agent 与其他机器的只读金融数据接口。**纯静态 REST/JSON + 本地 MCP server 双通道**，无后端、无 API key、无第三方运行时依赖。
> 生产地址：`https://5777-wq.github.io/openfinlens/`；仓库内路径：`api/v1/**`、`api/openapi.json`、`mcp/`。
> 人读文档（本文件）；机器可读清单见 `api/v1/manifest.json`，OpenAPI 3.1 见 `api/openapi.json`。

## 0. 为什么是「静态 API + MCP」双通道

| 通道 | 适合谁 | 怎么用 | 新鲜度 |
| --- | --- | --- | --- |
| REST/JSON | 任意 HTTP 客户端、浏览器、Agent 的普通 fetch 工具 | `GET https://5777-wq.github.io/openfinlens/api/v1/...` | 构建时快照（`meta.asof` / `meta.stale`） |
| MCP | Claude Code、Cursor、Claude Desktop 等支持 MCP 的 Agent | `node mcp/server.mjs`（stdio） | 行情/K 线/基金画像优先实时，失败回退静态 |

设计取舍：

1. **静态优先**：项目本身是纯静态站，GitHub Pages 就是 CDN。把数据编译成 JSON 产物放进仓库，Agent 不需要处理跨域代理、密钥、限流，也不依赖任何后端存活。
2. **MCP 负责补新鲜度**：浏览器能直连的公开接口（腾讯/东财/币安/天天基金）在 Node 里同样能直连。MCP 工具实时抓取，失败时回退静态文件，并把 `via` 与 `meta.stale` 说清楚。
3. **一套口径**：MCP 与构建脚本都通过 `vm` 加载 `js/sources/*.js`（与页面完全相同的 URL、GBK 解码、字段位、美股后缀重试），不复制解析逻辑。字段口径的实测记录见 `docs/FIELD-NOTES.md`。
4. **统一信封**：所有端点返回同一个形状，Agent 只需要学一次；字段级差异由 `manifest` 声明，避免 Agent 猜字段名。

## 1. 快速开始

```bash
# 根索引：有哪些数据集、各自是否过期
curl -s https://5777-wq.github.io/openfinlens/api/v1/index.json

# 机器可读清单
curl -s https://5777-wq.github.io/openfinlens/api/v1/manifest.json

# 行情快照
curl -s https://5777-wq.github.io/openfinlens/api/v1/quotes/latest.json

# 全球事件
curl -s https://5777-wq.github.io/openfinlens/api/v1/events/global.json
```

本地起一个静态服务器（任选其一，仓库根目录执行）：

```bash
python -m http.server 8000
# 然后 curl http://127.0.0.1:8000/api/v1/index.json
```

> GitHub Pages 对静态资源回显宽松的跨域头，浏览器跨域 `fetch` 可直接读取；所有端点都是 `GET`、无鉴权、无 Cookie。

## 2. 统一信封

每个 JSON 文件（包括每个 K 线文件）都是：

```json
{
  "ok": true,
  "data": { },
  "meta": {
    "dataset": "quotes.latest",
    "asof": "2026-11-08T14:50:39.380Z",
    "generatedAt": "2026-11-08T14:50:39.511Z",
    "source": "公开行情接口（腾讯 qt.gtimg.cn / 东方财富 push2delay / 币安 data-api）",
    "stale": false,
    "license": "公开数据，仅用于信息展示与统计研究；不构成任何投资建议。",
    "note": "实时抓取的行情快照；quoteAt 是上游行情时刻，updatedAt 是抓取时刻。不含交易量类字段。"
  }
}
```

| 字段 | 类型 | 必有 | 含义 |
| --- | --- | --- | --- |
| `ok` | boolean | 是 | 静态产物恒为 `true`；错误信封只在 MCP 工具失败时出现 |
| `data` | object | 是 | 业务内容，形状由数据集决定 |
| `meta.dataset` | string | 是 | 数据集 id，与 `manifest.data.datasets[].id` 对应 |
| `meta.asof` | string / null | 是 | 数据截止时间；日线为日期串，行情为 ISO，未知为 `null` |
| `meta.generatedAt` | string | 是 | 本文件构建时间（ISO 8601） |
| `meta.source` | string | 是 | 数据来源说明（不出现平台品牌） |
| `meta.stale` | boolean | 是 | `true` = 数据滞后或本轮抓取失败后降级 |
| `meta.license` | string | 是 | 许可与使用边界 |
| `meta.note` | string | 是 | 口径说明、降级原因、注意事项 |

**Agent 使用规则**：先看 `meta.stale`，再看 `meta.asof` 与当前时间的差距；回答用户时把滞后说明带上。`stale=true` 不代表数据错误，只代表"不是最新一轮"。

## 3. 端点表

| 端点 | 数据集 id | 说明 |
| --- | --- | --- |
| `GET /api/v1/index.json` | `index` | 根索引：数据集清单、路径、asof、stale、条数 |
| `GET /api/v1/manifest.json` | `manifest` | 机器可读清单：字段/类型/单位/说明、样例、文件列表 |
| `GET /api/v1/universe.json` | `universe` | 标的宇宙：代码/名称/市场/分组/拼音首字母/别名 |
| `GET /api/v1/quotes/latest.json` | `quotes.latest` | 行情快照（构建时抓取，抓不到标 stale） |
| `GET /api/v1/markets/klines.json` | `klines.catalog` | K 线目录：可用标的、周期、行数、文件路径 |
| `GET /api/v1/klines/{symbol}.json` | `klines.symbol` | 单标的日/周/月 K 线（`{symbol}` 取目录中的代码） |
| `GET /api/v1/events/global.json` | `events.global` | 全球事件：分类、国家、严重度、关联标的 |
| `GET /api/v1/prediction/markets.json` | `prediction.markets` | 预测市场概率：事件 + 档位两层 |
| `GET /api/v1/institutions/holdings.json` | `institutions.holdings` | 13F / 因子 ETF / 基金合计持仓 |
| `GET /api/v1/macro/series.json` | `macro.series` | 世界银行年度宏观序列 + FRED 目录 |
| `GET /api/v1/health.json` | `health` | 链路自检：各数据集 lastBuilt、条数、耗时 |

### 3.1 根索引 `index.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/index.json
```

```json
{
  "ok": true,
  "data": {
    "version": "v1",
    "generatedAt": "2026-11-08T14:50:39.511Z",
    "count": 11,
    "datasets": [
      {
        "id": "quotes.latest",
        "title": "行情快照",
        "description": "构建时抓取的行情快照，带 asof 与 stale；抓取失败时沿用上次快照并诚实标注。",
        "path": "api/v1/quotes/latest.json",
        "kind": "data",
        "asof": "2026-11-08T14:50:39.380Z",
        "stale": false,
        "count": 194,
        "updatedAt": "2026-11-08T14:50:39.511Z"
      }
    ],
    "entrypoints": {
      "manifest": "api/v1/manifest.json",
      "health": "api/v1/health.json",
      "openapi": "api/openapi.json",
      "universe": "api/v1/universe.json"
    },
    "health": "degraded"
  },
  "meta": { "dataset": "index", "asof": "2026-11-08T14:50:39.511Z", "generatedAt": "2026-11-08T14:50:39.511Z", "source": "本项目构建产物", "stale": false, "license": "公开数据，仅用于信息展示与统计研究；不构成任何投资建议。", "note": "先读本索引挑数据集，再读 manifest 看字段；stale=true 的数据集回答用户时必须说明时效。" }
}
```

### 3.2 机器可读清单 `manifest.json`

`data.datasets[]` 每项含：

| 字段 | 说明 |
| --- | --- |
| `id` / `title` / `description` | 数据集标识与说明 |
| `path` | 相对路径；含 `{symbol}` 的是模板 |
| `kind` | `data` 或 `meta` |
| `fields[]` | `{name, type, unit, desc}`，描述**条目级**字段 |
| `sample` | 与 `fields` 一一对应的示例对象 |
| `asof` / `stale` / `count` | 该数据集的时效与规模 |
| `files[]` | 仅模板路径数据集有：全部具体文件列表 |

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/manifest.json
```

### 3.3 标的宇宙 `universe.json`

```json
{
  "symbol": "sh600519",
  "name": "贵州茅台",
  "market": "cn",
  "kind": "stock",
  "group": "cn",
  "code": "600519",
  "secid": null,
  "pinyin": "gzmt",
  "aliases": ["600519", "gzmt", "sh600519", "茅台", "贵州茅台"],
  "source": "tencent"
}
```

`market` 取值：`cn` / `hk` / `us` / `global` / `crypto` / `fx` / `commodity` / `macro`。
`kind` 取值：`index` / `stock` / `crypto` / `fx` / `commodity` / `rate`。
Agent 应优先用 `symbol` 字段做后续查询；`aliases` 用于把"茅台""宁王""恒指""大饼"等口语解析成标准代码。

### 3.4 行情快照 `quotes/latest.json`

```json
{
  "count": 194,
  "via": "live",
  "quotes": [
    {
      "symbol": "sh600519",
      "name": "贵州茅台",
      "market": "cn",
      "kind": "stock",
      "price": 1453,
      "prevClose": 1452,
      "open": 1450,
      "high": 1457.72,
      "low": 1436,
      "change": 1,
      "changePct": 0.07,
      "quoteAt": 1793952898000,
      "updatedAt": 1794149454296,
      "source": "tencent"
    }
  ],
  "errors": []
}
```

- `via`：`live`（实时抓取成功）/ `snapshot`（沿用旧快照）/ `empty`（无数据）/ `offline`（离线构建）；
- `quoteAt` 是上游行情时刻，美股该字段为 `null`（源不提供可可靠换算的时区），`updatedAt` 是抓取时刻；
- 抓取失败且没有旧快照时，`quotes` 为空数组、`meta.stale=true`，不会编造数字。

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/quotes/latest.json
```

### 3.5 K 线目录与单标的文件

目录：

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/markets/klines.json
```

```json
{
  "count": 19,
  "periods": ["day", "week", "month"],
  "symbols": [
    {
      "symbol": "sh000001",
      "name": "上证指数",
      "market": "cn",
      "path": "api/v1/klines/sh000001.json",
      "asof": "2026-11-07",
      "stale": false,
      "periods": {
        "day": { "count": 160, "asof": "2026-11-07", "stale": false },
        "week": { "count": 104, "asof": "2026-11-07", "stale": false },
        "month": { "count": 60, "asof": "2026-11-07", "stale": false }
      }
    }
  ]
}
```

单标的（路径里的 `{symbol}` 替换成目录中的代码）：

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/klines/sh600519.json
```

```json
{
  "symbol": "sh600519",
  "name": "贵州茅台",
  "market": "cn",
  "periods": {
    "day": {
      "interval": "day",
      "count": 160,
      "asof": "2026-11-07",
      "stale": false,
      "source": "tencent/eastmoney/binance（经 js/sources 适配器）",
      "rows": [
        { "time": "2026-11-06", "open": 1410, "high": 1480.6, "low": 1395.02, "close": 1453 }
      ]
    },
    "week": { "interval": "week", "count": 104, "asof": "2026-11-06", "stale": false, "source": "...", "rows": [] },
    "month": { "interval": "month", "count": 60, "asof": "2026-11-06", "stale": false, "source": "...", "rows": [] }
  }
}
```

K 线行**只有** `time` / `open` / `high` / `low` / `close`；日/周/月三种周期同一个文件返回，Agent 按需取一个周期即可。构建覆盖 19 个主要指数与热门标的；更冷门的标的请用 MCP 的 `get_klines` 实时抓取。

### 3.6 全球事件 `events/global.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/events/global.json
```

```json
{
  "count": 54,
  "windowHours": 6,
  "categories": [{ "id": "trade", "count": 12 }],
  "countries": [{ "name": "美国", "count": 9 }],
  "events": [
    {
      "id": "事件哈希||1793500516000",
      "category": "geopolitics",
      "title": "【特朗普称会邀请泽连斯基参加二十国集团领导人峰会】（示例中截断）",
      "source": "新浪财经7x24",
      "sourceUrl": "https://finance.sina.com.cn/7x24/",
      "publishedAt": "2026-11-01T01:15:16.000Z",
      "country": "美国",
      "lat": 38.895,
      "lng": -77.036,
      "severity": 55,
      "importance": "med",
      "relatedSymbols": [],
      "relatedAssets": []
    }
  ]
}
```

`severity` 是本项目把上游 `importance` 映射成 0-100 的展示口径（high=85 / med=55 / low=30），不是上游原始字段；坐标为关键词地理定位，精度为国家/地区级，定位不到时为 `null`。

### 3.7 预测市场概率 `prediction/markets.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/prediction/markets.json
```

```json
{
  "count": 30,
  "categories": [{ "id": "election", "count": 8 }],
  "events": [
    {
      "id": "ev:1262243",
      "title": "Which Senate Swing States will Republicans win?",
      "titleZh": "共和党将赢得哪些参议院摇摆州？",
      "category": "election",
      "partition": true,
      "endDate": 1793750340000,
      "updatedAt": 1793500825630,
      "outcomeCount": 128,
      "outcomes": [
        { "id": "pm:6274257", "label": "None", "labelZh": "无", "probability": 0.255, "change24h": 1 }
      ],
      "rest": { "probability": 0.547, "count": 122 }
    }
  ]
}
```

`probability` 是 0-1 的隐含概率；`outcomes` 只保留档位标签与概率，**不含平台标识、链接与交易功能**。多档互斥事件 `partition=true`，`rest` 是未列出的剩余档位聚合。

### 3.8 机构持仓 `institutions/holdings.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/institutions/holdings.json
```

顶层三块：

- `institutions[]`：SEC 13F 机构季度持仓，含 `reportDate`、`lagDays`、`totalValueUsd`、`holdings[]`（`issuer/cusip/kind/valueUsd/shares/pctOfTotal/change`）、`exits[]`；
- `etf`：规则化因子 ETF 的发行方全量持仓（`funds[].holdings[]`）与两类因子交集（`overlap`）；
- `fundHoldings`：基金合计持仓的季度加仓/减仓榜（`topAdd[]` / `topTrim[]`）。

口径提醒：13F 报告期末到提交日实测滞后 34~45 天；ETF 是编制规则的被动持仓，不是基金经理主观判断；基金合计持仓含被动申赎，不能读成主动判断。

### 3.9 宏观序列 `macro/series.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/macro/series.json
```

```json
{
  "count": 44,
  "catalog": [
    { "key": "gdp", "code": "NY.GDP.MKTP.CD", "label": "GDP", "unit": "总量（万亿美元）", "source": "世界银行" }
  ],
  "series": [
    {
      "id": "WB:US:gdp",
      "name": "美国·GDP",
      "country": "美国",
      "iso": "US",
      "indicator": "gdp",
      "indicatorLabel": "GDP",
      "unit": "总量（万亿美元）",
      "freq": "年",
      "source": "世界银行公开数据",
      "points": [{ "date": "2024", "value": 29298013000000 }]
    }
  ],
  "fred": {
    "available": false,
    "reason": "前端不内置 API key；如需 FRED 序列，请在部署环境自行注入或走代理。",
    "series": [{ "id": "DGS10", "name": "美国10年期国债收益率" }]
  }
}
```

世界银行是年度数据，最新非空年份为准；不同国家的发布滞后一年属正常，因此 `macro.series` 的 stale 预算设为 45 天。

### 3.10 链路自检 `health.json`

```bash
curl -s https://5777-wq.github.io/openfinlens/api/v1/health.json
```

```json
{
  "status": "degraded",
  "generatedAt": "2026-11-08T14:50:39.511Z",
  "durationMs": 4553,
  "mode": "live",
  "staleDatasets": ["events.global", "prediction.markets"],
  "datasets": [
    { "id": "quotes.latest", "path": "api/v1/quotes/latest.json", "lastBuilt": "2026-11-08T14:50:39.511Z", "asof": "2026-11-08T14:50:39.380Z", "count": 194, "ms": 2810, "stale": false }
  ]
}
```

`status=degraded` 表示至少一个数据集已过期；`staleDatasets` 给出具体 id。Agent 可以把它当成"回答前先检查"的开关。

## 4. OpenAPI

`api/openapi.json` 是 OpenAPI 3.1 描述，路径集合与 `manifest.data.datasets[].path` 完全一致（测试会校验）。可用任意 OpenAPI 查看器打开，或：

```bash
curl -s https://5777-wq.github.io/openfinlens/api/openapi.json
```

## 5. MCP 工具表

启动方式与客户端配置见 `mcp/README.md`。所有工具返回结构化 JSON 文本；失败时 `isError: true`。

| 工具 | 说明 | 参数 |
| --- | --- | --- |
| `list_datasets` | 列出全部数据集、更新时间与滞后状态；Agent 第一步 | `keyword?`、`stale_only?` |
| `get_manifest` | 读取字段定义、样例与截止时间；传 `dataset` 返回单个数据集完整定义 | `dataset?` |
| `get_health` | 链路自检：各数据集 lastBuilt / 条数 / 耗时 / stale | 无 |
| `search_symbols` | 中文名、拼音首字母、代码、别名模糊搜索 | `query`（必填）、`market?`、`limit?` |
| `get_quotes` | 行情快照；实时优先，失败回退静态；返回 `via` 与 `meta.stale` | `symbols?`、`market?`、`limit?`、`live?` |
| `get_klines` | 日/周/月 K 线，只含时间与开高低收；实时失败回退 `api/v1/klines` | `symbol`（必填）、`period?`、`limit?`、`live?` |
| `get_events` | 全球事件；按分类/国家/起始时间/关键词过滤 | `category?`、`country?`、`since?`、`keyword?`、`limit?` |
| `get_prediction_markets` | 预测市场概率；按类别/关键词/最低概率过滤 | `category?`、`keyword?`、`min_percent?`、`limit?` |
| `get_institution_holdings` | 13F / 因子 ETF / 基金合计持仓 | `kind?`（13f/etf/fund）、`institution?`、`quarter?`、`limit?` |
| `get_macro_series` | 世界银行年度宏观序列 + FRED 目录 | `series_id?`、`country?`、`indicator?`、`from?`、`to?`、`limit?` |
| `get_fund_profile` | 公募基金画像：费率、收益、净值、规模、持有人、配置、经理、重仓股 | `code`（必填，5~6 位数字） |

### 5.1 参数细节

- **symbol 解析**：`get_quotes` / `get_klines` 接受标准代码（`sh600519`）、纯代码（`600519`）、中文名（`贵州茅台`）、拼音首字母（`gzmt`）、常见别名（`茅台`、`宁王`、`恒指`）与美股/加密简写（`AAPL` → `usAAPL`、`BTC` → `BTCUSDT`）。解析规则与 `api/v1/universe.json` 同源。
- **period**：`day` / `week` / `month`，默认 `day`。
- **since**：ISO 时间字符串或毫秒时间戳；用于事件的时间下界。
- **quarter**：支持 `2026-06-30` 与 `2026Q2` 两种写法。
- **indicator**：`gdp` / `growth` / `cpi` / `unemp` / `debt` / `cab`。
- **limit**：每个工具有自己的上限（最大 400/200/100 不等），超出会被收敛到上限。

### 5.2 JSON-RPC 示例

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_symbols","arguments":{"query":"茅台"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_klines","arguments":{"symbol":"sh600519","period":"day","limit":30}}}
{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"openfinlens://api/v1/index.json"}}
{"jsonrpc":"2.0","id":6,"method":"ping"}
```

工具结果形状：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      { "type": "text", "text": "{\n  \"ok\": true,\n  \"symbol\": \"sh600519\",\n  \"count\": 30,\n  \"rows\": [ ... ]\n}" }
    ]
  }
}
```

失败：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "{\"ok\":false,\"error\":{\"code\":\"TOOL_ERROR\",\"message\":\"无法识别标的：xxx\"}}" }],
    "isError": true
  }
}
```

`resources/list` 列出 `openfinlens://api/v1/**` 与 `openfinlens://api/openapi.json`；`resources/read` 返回原文件文本。

## 6. 新鲜度与降级语义

| 数据集 | stale 判定 | 降级行为 |
| --- | --- | --- |
| `quotes.latest` | 本轮实时抓取失败或零条 | 沿用上次提交的快照；无旧快照则空数组 |
| `klines.catalog` / `klines.symbol` | 任一标的任一周期抓取失败 | 该周期沿用旧文件行；无旧文件则空数组 |
| `events.global` | `asof` 距今 > 180 分钟 | 不动数据，只标 stale 并在 note 说明 |
| `prediction.markets` | `asof` 距今 > 120 分钟 | 不动数据，只标 stale |
| `institutions.holdings` | `asof` 距今 > 10 天 | 13F 本身按季度披露，10 天窗口足够 |
| `macro.series` | 本轮世界银行抓取失败，或 asof > 45 天 | 沿用旧序列；无旧序列则空数组 |
| `universe` / `manifest` / `index` / `health` | 构建时间即 `asof` | 永不为 stale（`health` 用 `status` 表达整体状态） |

三层降级链：**实时公开接口 → 仓库静态快照 → 诚实空态**。仓库静态快照同时就是缓存层：构建时抓一轮、随仓库提交、由 GitHub Pages/CDN 分发；MCP 实时抓取失败时直接回退它。任何一层失败都不会伪造数据；`meta.note` 会写明原因。

## 7. 合规红线

1. **不展示成交量**：行情、K 线、持仓等所有产物都不含交易量类字段，只有价格、涨跌、开高低收、持仓市值/股数等。
2. **不出现 Polymarket 品牌**：预测市场端点只保留事件、档位与概率；不含平台名称、slug、链接、tokenId，也不含交易入口。新闻快讯中整段引用品牌字样的条目按合规口径整条剔除（`meta.note` 会说明剔除了多少条）。
3. **中文**：所有说明、字段解释、错误信息与文档均为中文；英文只作为标题原文/代码/上游名称保留。
4. **无 API key**：全部数据来自公开接口或仓库内静态产物；不在任何文件里保存密钥。
5. **只描述事实，不推荐买卖**：概率是"市场定价隐含的可能性"，不是预测；13F/ETF 是公开披露的持仓快照，不是建议。
6. **只读**：没有写操作、下单、账户或交易功能。

## 8. Agent 应该怎么用（推荐配方）

| 用户问题 | 调用链 |
| --- | --- |
| "贵州茅台现在多少钱？" | `search_symbols("茅台")` → `get_quotes(["sh600519"])`；回答带 `meta.asof` |
| "最近全球有什么大事？" | `get_events({limit:20})`，必要时按 `country` / `category` 过滤；`severity` 只作排序参考 |
| "美股科技股最近走势如何？" | `search_symbols("英伟达")` → `get_klines("usNVDA","day",60)`；多标的就多次调用 |
| "市场怎么看这次选举？" | `get_prediction_markets({keyword:"election"})`；只引用概率，不预测结果 |
| "巴菲特最新持仓？" | `get_institution_holdings({institution:"berkshire"})`；注明 `reportDate` 与 `lagDays` |
| "美国最近通胀多少？" | `get_macro_series({country:"美国",indicator:"cpi"})`；年度数据，说明年份 |
| "这只基金怎么样？" | `get_fund_profile({code:"005827"})`；历史业绩不代表未来 |
| "API 现在新鲜吗？" | `get_health()` → 看 `status` 与 `staleDatasets` |

通用原则：

1. 不要猜字段，先 `get_manifest({dataset})`；
2. 不要猜代码，先 `search_symbols`；
3. 不要把 `stale=true` 的数据说成实时；
4. 不要根据概率/持仓生成买卖建议；
5. 工具返回 `isError: true` 时，读文本里的中文原因，换参数或告知用户，不要重试同一请求多次。

## 9. 构建与发布

```bash
# 联网构建：实时行情 + K 线 + 世界银行宏观 + 静态产物
node _scripts/build-api.mjs

# 离线构建：只用仓库已有数据，不发任何网络请求
node _scripts/build-api.mjs --offline

# 固定构建时间（回归测试用；保证输出可复现）
BUILD_API_NOW=2026-11-08T00:00:00Z node _scripts/build-api.mjs --offline
```

产物：`api/v1/**` 与 `api/openapi.json`，随仓库提交，GitHub Pages 直接可访问。构建脚本是幂等的：只覆盖同名文件、按固定顺序排序，不追加。`api/` 与 `mcp/` 不引入任何第三方依赖。

可选的定时刷新（与现有采集脚本并行，不影响 Actions/自建服务器）：在已有采集流程后追加一行 `node _scripts/build-api.mjs`，或单独加一个低频 workflow。本文不修改现有 workflow，避免与采集侧互相影响。

## 10. 测试

```bash
node _test/api.test.mjs           # API 契约 + 合规 + MCP 协议冒烟（离线，零外网）
node _test/run-all.mjs --offline  # 全量离线测试组
```

`api.test.mjs` 覆盖：统一信封约束、manifest 与实际文件一致、字段声明与样例匹配、OpenAPI 路径集合一致、全局合规扫描（品牌/交易量字段）、MCP 协议握手与工具调用。MCP 冒烟用 `--offline` 子进程，不依赖真实网络。

## 11. 已知限制

- **行情不是交易所级实时**：免费公开接口通常有数秒到数分钟延迟；`quoteAt` 是上游口径，收盘后为最后成交时刻。
- **K 线复权口径**：优先腾讯 `qfq`，WAF 拦截时用同一后端的裸域重试，仍失败则用东财兜底；两者复权口径不完全一致，只适合看趋势与形态，不适合精确的长期收益计算。
- **13F 有 34~45 天披露滞后**：这是 SEC 规则决定的，`lagDays` 已单列。
- **预测市场数据依赖采集任务**：采集停了就会 `stale=true`；概率只代表市场定价，不代表事实或结果。
- **世界银行是年度数据**：最新年份可能只有部分国家，缺失就是缺失，不插值。
- **冷门标的没有静态 K 线**：静态目录覆盖 19 个主要标的；其它标的用 MCP 的 `get_klines` 实时抓取，或把标的加入构建脚本的 `KLINE_SYMBOLS`。
- **GitHub Pages 缓存**：静态文件可能被 CDN 缓存数分钟；需要强制刷新时加查询串（`?v=时间戳`）。
