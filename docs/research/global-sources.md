# 全球行情免费数据源实测报告（美股 / 全球指数 / ETF / 外汇）

> 实测人：probe-global（Team Lead: lead）  
> 实测日期：2026-10-20（响应头 GMT 14:11–14:43）  
> 环境：Windows + PowerShell 5.1 + curl.exe 8.21.0（Schannel），浏览器 UA Chrome/126，统一附 `Origin: https://5777-wq.github.io`，部分源附 `Referer`。  
> 本机 DNS 对部分域名返回 `198.18.0.x`（本地代理/分流），延迟含代理开销。以下数字均为本次真实请求结果。  

## 0. 一句话结论

- **Yahoo chart API 仍是免 key 全球行情最全的源**（1m/2m/5m/15m/30m/60m/1d，覆盖 AAPL/SPY/^GSPC/0700.HK/EURUSD=X/GC=F），但**响应无 `Access-Control-Allow-Origin`，浏览器前端零 key 不能直连**，必须同源代理。
- **Nasdaq 官方非公开 API 也可用**（当日 1 分钟折线 + 日线历史），但同样**无 ACAO**；业务错误也用 HTTP 200 返回，必须判 body。
- **Stooq 本机不可用**：796 字节 JavaScript 挑战页（HTTP 200 假成功）；PoW 解出 cookie 后仍 `Access denied`。
- **浏览器零 key 直连美股分钟 K 没有通用可行源**。唯一实测例外是 **MarketData.app 无 token 的 AAPL 演示端点**（`ACAO: *`，HTTP 203，可拉 1 年 1m/5m），但只支持 AAPL，属演示，不能生产。
- **可行路径**：自建 Cloudflare Worker 代理 Yahoo（把 `query1.finance.yahoo.com` / `query2.finance.yahoo.com` / `api.nasdaq.com` 加入 `worker.js` 的 `ALLOW_HOSTS`），Nasdaq 备用；日线可 Yahoo 或 Sina（仍走 Worker）。**不要**把免费 key 写进前端，违反零 key 铁律。

---

## 1. 总表（免 key / 无鉴权源）

| 源/端点 | 市场 | 粒度 | 实测 HTTP/延迟 | 条数/时间跨度 | CORS(ACAO) | key 要求/免费额度 | 限频迹象 | 坑 |
|---|---|---|---|---|---|---|---|---|
| Yahoo `query1/v8/finance/chart` | 美股、ETF、指数、港股、外汇、期货 | 1m/2m/5m/15m/30m/60m/90m/1h/4h/1d/5d/1wk/1mo/3mo | 200；AAPL 1m 约 0.8–1.4s；矩阵请求 0.2–1.3s | 1m+5d 1606–1610 根；60m+2y 3492 根；1d+20y 5030 根；1d+max 169 根（3mo 粒度） | **无 ACAO**（GET 与 OPTIONS 均无；`Vary: Origin` 但不回） | 无 key、无 crumb、无 cookie（chart 端点） | 浏览器 UA 下连续 40 次快速请求全 200；**不带 UA 立即 429**（19B `Too Many Requests`） | 时间戳是**秒**；1m 仅 8 天/请求；2m–30m 仅 60 天；60m 仅 730 天；`range=max` 强制 3mo 粒度；无官方 SLA，随时可能变更/限流 |
| Yahoo `v7/finance/quote` | 美股等 | 快照 | 401（无 crumb） | — | 无 ACAO | 需 cookie/crumb | 未测 | 本次不带 crumb 直接 401 `Unauthorized`；不要用它替代 chart |
| Nasdaq `api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks` | 美股、ETF、部分指数（COMP/NDX） | 默认当日 1 分钟折线（非 OHLC，带 `volumeChart`）；传 fromdate/todate 则变日线 | 200；1.4–4.0s | 380–409 个点（含 4:00 AM ET 盘前） | **无 ACAO**；OPTIONS 204 仅回 `Access-Control-Allow-Methods: GET` | 无 key、无需 UA（不带 UA 也 200） | 未观察到 429 | 只有当日；`assetclass=futures/currency` 报 400；SPX/DJI 等 index symbol 不存在；错误也 HTTP 200 |
| Nasdaq `historical?fromdate=..&todate=..&limit=9999` | 美股、ETF、指数 | 日线 | 200；3–4.8s | 1 年 251 行；2020–2026 共 1708 行；20 年 2513 行 | 无 ACAO | 无 key | 未观察到 | 价格带 `$` 和千分位、日期 `MM/DD/YYYY`；`limit` 不是硬上限（本次 9999 返回 2513 行）；默认不传 fromdate 报 400 |
| Stooq `q/d/l/?s=aapl.us&i=5 / i=d / i=60` | 美股、指数、外汇、期货 | 5m/d/60m（声称） | 200；0.8–1.3s，但 **796B HTML 挑战页** | 0 条有效数据 | 无 ACAO | 无 key | 反爬 JS 挑战 | 假 200；Referer 无效；PoW 解出 cookie 后仍 `Access denied`（13B）；`stooq.pl` 同样挑战。历史深度未测 |
| Eastmoney `push2.eastmoney.com/api/qt/stock/get` | 美股、港股指数、美指、外汇、期货 | 实时快照 | 200；60–100ms | 1 条快照 | **有，回显 Origin** | 无 key | 未观察到 | 数值需缩放（`f43=342570` 表示 342.57；EURUSD `11257` 表示 1.1257）；`100.GSPC` 返回 rc=100，需用 `100.SPX` |
| Eastmoney `push2his.../api/qt/stock/kline/get` | 美股、全球指数 | 1m/5m/15m/30m/60m/d（声称） | **本机 0（连接被重置）** | 未取到 | 未知（未拿到响应头） | 无 key | — | `push2his` 的 kline/trends2/clist 路径本机全部 `curl 56 / RemoteDisconnected`；同一 host 的 `stock/get` 正常。需其他网络复核；不能据此认定源不可用 |
| Sina `hq.sinajs.cn/list=...` | 美股、港股、国际指数、外汇、外盘期货 | 实时快照 | 200；90–150ms | 1 条/标的 | **无 ACAO** | 无 key；`int_*` 必须带 Referer | 未观察到 | 不带 Referer 时 `int_dji` 为 **403 Forbidden**；GB18030 编码；`US30/UKX/DAX/N225/HSI` 列表为空；`gb_$spy` 空、`gb_spy` 可用 |
| Sina `US_MinKService.getMinK` | 美股、ETF、美股指数 | 1m/5m/15m/30m/60m | 200；0.1–0.3s | 固定 1023 根；1m≈3 个交易日、5m≈1 个月、15m≈2 个月、30m≈4 个月、60m≈7 个月 | **无 ACAO** | 无 key | 未观察到 | 只回 1023 根，没有分页参数；`type=1/5/15/30/60`；`0700.HK`、`GC`、`EURUSD` 返回 `[]` |
| Sina `US_MinKService.getDailyK` | 美股、ETF、美股指数 | 日线 | 200；0.35–0.42s | AAPL 10056 根（1984-09-07 起）；SPY 6486 根（2001 起）；.DJI/.IXIC 5737/5735 根（2004 起） | **无 ACAO** | 无 key | 未观察到 | 一次返回全部历史，约 150–200KB；无日期范围参数；指数代码用 `.INX/.DJI/.IXIC` |
| Sina HK/Futures/FX K 线服务 | 港股/期货/外汇 | 声称分钟/日线 | 200 但 body 为 `{"__ERROR":3,"__ERRORMSG":"Service not valid"}` 或空 | 0 条 | 无 ACAO | 无 key | — | 本次测试的服务名均失效；港股只有 `hk00700` 快照，分钟 K 需另找源 |

## 2. 总表（免费 key / 有限额度源）

| 源/端点 | 市场 | 粒度 | 实测 HTTP/延迟 | 条数/时间跨度 | CORS(ACAO) | key 要求/免费额度 | 限频迹象 | 坑 |
|---|---|---|---|---|---|---|---|---|
| Alpha Vantage `TIME_SERIES_INTRADAY/DAILY` | 美股、ETF、外汇 | 1m/5m/15m/30m/60m、日线 | demo 200；0.4–1.9s | demo IBM 1m/5m 各 100 根；IBM 日线 full 6782 根（1999-11 起）；AAPL demo 失败 | **`*`** | 无 key → 200+错误文案；demo 仅 IBM/MSFT 等有限标的；官方免费 **25 req/日** | 未触发 | **假成功**：无 key 也是 HTTP 200，body 为 `{"Error Message":...}`；demo 15m/30m/60m 直接返回 `Information` 提示；AAPL/SPY 等 demo 不可用 |
| Twelve Data `time_series` | 美股、外汇 | 1m/5m/15m/30m/1h/1d | demo 200；0.5–2.8s | demo AAPL 1m `outputsize=5000` 返回 5000 根（约 100KB），可带 start/end | **`*`** | 无 key 401；demo 只对 AAPL 生效；官方 Basic 免费 **8 credits/min（800/日）** | 连续 10 次 demo 全 200；`/api_usage` 显示 `plan_limit=2584`（演示额度池） | `outputsize` 最大 5000，5001 直接 400；MSFT/SPY/0700.HK/GC=F/SPX demo 全部 401；batch `symbol=AAPL,MSFT` demo 401 |
| Financial Modeling Prep `historical-chart` | 美股 | 1m/5m/…/日线 | 401；1.1–1.8s | — | **`*`**（401 也带） | 无 key/demo 均 401；官方 Basic 免费 **250 calls/日**、30 天 500MB 流量 | 未测 | `apikey=demo` 已失效（全部 `Invalid API KEY`）；旧 v3 和 `/stable/` 新端点都 401 |
| Polygon.io `v2/aggs` | 美股、指数、外汇（付费权限） | 1m/5m/…/日线（按套餐） | 401；0.9–1.5s | — | **回显 Origin** | 无 key 401；`apiKey=demo` → `Unknown API Key`；官方免费额度页本次被重定向到 massive.com，未能读到 | 未测 | 免费档 5/min、15 分钟延迟为待复核信息，**未从官方页确认**；demo 已失效 |
| Tiingo `iex/...` | 美股、IEX 分时 | 1m/5m（IEX） | 403；0.8–1.4s | — | **无 ACAO** | 无 key 403 `Please supply a token`；demo 403 `Invalid token` | 未测 | 即使有 key 也不能浏览器直连；免费 500/日未从官方页确认 |
| Finnhub `stock/candle` | 美股、外汇、加密 | 1/5/15/30/60/D/W/M | 401；0.5–1.1s | — | **`*`** | 无 key/demo 401；文档明确 `stock-candles` 为 **Premium Access Required** | 未测 | 免费 60/min 本次未从定价页确认；candle 端点已变付费 |
| MarketData.app `stocks/candles/{1,5,15,30,60,D}` | 美股（仅 AAPL 免 token） | 1m/5m/15m/30m/60m/日线 | **203**；0.5–3.6s | 1m+365d 97532 根（4.5MB）；5m+1y 19508 根（916KB）；日线+5y 1254 根；不带 from/to 仅 1 根 | **`*`** | 无 token 仅 AAPL；`token=demo` 与无 token 相同；注册后试用结束 **100 请求/日** | `x-api-ratelimit-limit: 0`、`consumed: 0`；未触发 429 | HTTP **203 不是 200**；无 token 请求 IBM/TSLA/SPY/VFINX 全 401；intraday 最长 1 年，超过 413 |
| EODHD `intraday` / `eod` | 美股、全球指数/ETF（付费） | 1m/5m/15m/30m/1h、日线 | demo 200；1.0–5.4s | demo AAPL.US 5m 6557 根（2026-06-23→10-19）；EOD 11555 根（1980→2026） | **无 ACAO**（GET 200 也没有） | 无 key 401 `Unauthenticated`；demo 仅 AAPL.US；官方免费 **20 API calls/日、20 req/min**、注册送 500 | 未测 | demo 换 MCD/MSFT/SPY/GSPC/EURUSD 全部 401；`from/to` 必须传 Unix 秒，传日期字符串报 422；即使有 key 也不能浏览器直连 |
| Marketstack `v2/eod` | 全球 EOD | 仅日线 | 401；0.9–1.3s | — | **`*`** | 无 key/demo 均 401；官方免费 **100 requests/月**，EOD 仅 1 年历史 | 未测 | 免费档没有 intraday；`v2/intraday` 同样 401；API 层是 APILayer，错误码 `invalid_access_key` |
| IEX Cloud | 美股 | - | **TLS 握手失败**（cloud.iexapis.com / iexcloud.io 均 000） | - | 未拿到 | - | - | 本机不可达，符合已关停传闻；未从官方公告确认 |
| StockData.org | 美股/全球 | quote/EOD/intraday | 401；0.9–2.5s | - | **`*`** | 无 key/demo 401 `invalid_api_token`；官方免费 **100 requests/日**、1 个月 intraday/EOD、intraday 1 symbol/request | 未测 | 免费档限制多；`api_token=demo` 无效 |
| Databento | 美股/期货 L1/L2 | tick/bar（付费） | 401；约 2.0s | - | **无 ACAO** | 无 key 401 auth；付费产品 | 未测 | 不适合免费看板；定价页 JS 渲染，未读到具体价格 |
| TradingView | 全球 | widget 图表 | 未测试（不应抓取） | - | - | 无公开官方 API | - | 只有 widget/嵌入，未授权抓取违反条款；**建议不要使用** |

---

## 3. Yahoo Finance chart API 专项

### 3.1 可用性与鉴权

- `query1.finance.yahoo.com` 与 `query2.finance.yahoo.com` **都可用、结果一致**。AAPL 1m+1d 两者均 200，约 0.6–1.3s。
- **不需要 crumb、不需要 cookie**：chart 响应无 `Set-Cookie`；不带 crumb 仍 200。
- 但 **必须带浏览器 UA**：
  - 带 Chrome UA：连续 40 次快速请求（URL 加随机参数）全 200；10 次间隔 200ms 也全 200。
  - 不带 UA / 用 `curl/8.21.0`：立刻 **429**，body 仅 19 字节 `Too Many Requests`，响应头无 `Retry-After`。
  - 结论：本机观察到的 429 首先与 **UA/风控**相关，不是单纯 QPS；不能排除共享 IP 被限流。官方无 SLA、无公开文档，随时可能变。
- `v7/finance/quote?symbols=AAPL` 不带 crumb 返回 **401** `User is unable to access this feature`；本项目不需要，chart 足够。

### 3.2 interval × range 实测限制（AAPL，2026-10-20）

| 请求 | 结果 | 根数 | 说明 |
|---|---|---|---|
| 1m + 1d | 200 | 44–46 | 盘中请求，随交易时段增长 |
| 1m + 5d | 200 | 1606–1610 | 常用组合 |
| 1m + 7d | 200 | 2394 | 7 天可用 |
| 1m + 1mo | **422** | - | `Only 8 days worth of 1m granularity data are allowed to be fetched per request` |
| 1m + period1=8d | 200 | 2341 | 8 天整可用 |
| 1m + period1=9d | **422** | - | 超过 8 天即失败 |
| 2m + 1mo | 200 | 4119 | 2m 可用 |
| 2m + 3mo | **422** | - | `The requested range must be within the last 60 days` |
| 5m + 1mo | 200 | 1649 | 5m 常用 |
| 5m + 3mo | **422** | - | 同样 60 天限制 |
| 15m + 1mo | 200 | 551 | 15m 可用 |
| 15m + 3mo | **422** | - | 60 天限制 |
| 30m + 1mo | 200 | 276 | 30m 可用 |
| 30m + 3mo | **422** | - | 60 天限制 |
| 60m + 1y | 200 | 1755 | 60m 可用 |
| 60m + 2y | 200 | 3492 | 730 天内可用 |
| 60m + 5y | **422** | - | `The requested range must be within the last 730 days` |
| 1d + 1y | 200 | 252 | 日线正常 |
| 1d + 10y | 200 | 2513 | 日线正常 |
| 1d + 20y | 200 | 5030 | 日线正常 |
| 1d + max | 200 | 169 | **`meta.dataGranularity=3mo`**，不是日线；1wk/1mo+max 同样 169 根/3mo |
| 4m | **400** | - | `Invalid input - interval=4m is not supported`；合法列表含 `1m,2m,5m,15m,30m,60m,90m,1h,4h,1d,5d,1wk,1mo,3mo` |
| 90m + 5d | 200 | 22 | 90m 也能用，但本项目需求未列 |

### 3.3 标的矩阵（所有组合均 200）

| 标的 | 1m+5d | 5m+1mo | 15m+5d | 60m+1y | 1d+1y | 备注 |
|---|---|---|---|---|---|---|
| AAPL | 1610 | 1649 | 109 | 1755 | 252 | 美股 |
| SPY | 1610 | 1649 | 109 | 1755 | 252 | ETF |
| ^GSPC | 1610 | 1649 | 109 | 1755 | 252 | 指数；URL 需 `%5EGSPC` |
| 0700.HK | 2000 | 1600 | 135 | 1706 | 246 | 港股，时区 `Asia/Hong_Kong` |
| EURUSD=X | 6676 | 6233 | 447 | 6266 | 263 | 外汇，近似 24h |
| GC=F | 6366 | 7393 | 426 | 7236 | 252 | COMEX 黄金期货 |

### 3.4 其他坑

- `chart.result[0].timestamp` 是 **Unix 秒**，不是毫秒。乘 1000 再转日期，否则会显示成 1970 年。
- `includePrePost=false` 时，AAPL 1m+1d 本次只有 **81 根**（13:30–14:49 ET），默认 true 为 363 根（08:00–14:49 ET）。不同时间点请求根数变化很大，不要写死。
- `1d+range=1d` 只返回 1 根；`5d` 返回 5 根（最后可能是不完整当日）。
- `range=max` 虽然 200，但粒度变成 3mo，做长历史日线应改用 `period1/period2` 或 `range=20y`。
- Yahoo 没有官方文档/SLA，字段可能变；生产上要容错 `chart.error`。

---

## 4. Nasdaq 官方非公开 API 专项

- **粒度回答**：不带日期参数时返回 **1D 当日 1 分钟折线点**（`z.dateTime`/`x`/`y`，不是标准 OHLC K 线；另有 `volumeChart`、`events`，含 4:00 AM ET 盘前）。**没有 5D 分时参数**；带 `fromdate/todate` 时切换为**日线**。所以：1D 分时有，5D 分时没有，分钟 OHLC 也没有。
- `assetclass` 实测：
  - `stocks`：AAPL 200，380–409 点。
  - `etf`：SPY/QQQ 200，380/389 点。
  - `index`：`COMP`、`NDX` 200（本次 49–79 点，随时间变化）；`SPX/DJI/INX/RUT/VIX/HSI/N225/FTSE/DAX/CAC/STOXX50/GDAXI` 全部 `Symbol not exists`。
  - `futures`、`currency`：HTTP 200 但 body 报 `Bad or No parameterassetclass`，该端点不支持。
- `timeframe=5d` 参数**无效**：实测仍返回当日 1 分钟折线（380 点），没有 5D 分时。
- `chart?fromdate=YYYY-MM-DD&todate=YYYY-MM-DD` 会切换为**日线**：1 年 251 根，5 年 1254 根；日期是 `MM/DD/YYYY`，价格字符串带 `$` 和千分位。
- `historical?fromdate=..&todate=..&limit=9999`：1 年 251 行，2020–2026 共 1708 行，20 年 2513 行。`limit` 不是硬上限（本次 9999 可拿 2513 行），但默认不传 fromdate 会报 400。
- **UA 要求：不需要**。不带 `User-Agent` 请求仍 200（与 Yahoo 相反）。
- **CORS：无 ACAO**。OPTIONS 返回 204，只有 `Access-Control-Allow-Methods: GET`，没有 `Access-Control-Allow-Origin`，浏览器仍会拦截。
- **错误伪装**：所有业务错误都是 HTTP 200，body 里 `status.rCode=400`，必须解析 `data` 是否为 null。
- 只有当日 1 分钟，不能直接拿多日分钟 K；要做 5m/15m/30m/60m 需前端自行聚合，且只能聚合当日。

---

## 5. Stooq 专项

- 请求 `https://stooq.com/q/d/l/?s=aapl.us&i=5`、`i=d`、`i=60`，以及 SPY/^SPX/^DJI/EURUSD/GC.F/0700.HK，全部：
  - HTTP **200**
  - body **796 字节** HTML：`This site requires JavaScript to verify your browser. Please enable JavaScript and reload.`
- 加 `Referer: https://stooq.com/q/?s=aapl.us` 无效；`stooq.pl` 同样挑战页；`c=0` 参数无效。
- 页面内是 SHA-256 PoW：找到 `n` 使 `sha256(c+n)` 以 `d` 个 0 开头，然后 POST `__verify`。本次已解出（d=4，n=17884，约 185ms），拿到 `auth` cookie，但随后所有 CSV 请求返回 **13 字节 `Access denied`**。
- 结论：**本机不可用，疑似 JS 挑战 + IP 级封禁**。无 ACAO。历史深度/分钟数据本次无法验证。
- 不建议把它作为生产源；即使换 IP 也可能随时被拦。

---

## 6. 免 key 的全球指数 / ETF / 外汇源

### 6.1 东方财富

- 实时快照端点可用且**有 CORS**：
  `https://push2.eastmoney.com/api/qt/stock/get?secid=105.AAPL&fields=f43,f44,f45,f46,f57,f58`
  - HTTP 200，60–100ms，`Access-Control-Allow-Origin: https://5777-wq.github.io`（回显 Origin）。
  - `105.AAPL`（美股）、`100.HSI`（恒生）、`100.DJIA`（道指）、`100.SPX`（标普500）、`100.NDX`（纳指100）、`119.EURUSD`（外汇）、`101.GC00Y`（COMEX 黄金）均返回 `rc=0`。
  - `100.GSPC` 返回 `rc=100`，不要用；标普用 `100.SPX`。
  - 数值需缩放：`f43=342570` → 342.57；`f43=11257` → 1.1257；`f43=2386774` → 23867.74（HSI）。字段含义要按品种确认。
- **K 线/分时端点本机不可达**：
  - `https://push2his.eastmoney.com/api/qt/stock/kline/get?...` 无论 A 股/美股、是否带 Referer/UA/ut 参数，全部 `curl: (56) schannel: server closed abruptly` 或 Node `socket hang up`；`trends2/get`、`clist/get` 同样。
  - 同一 host 的 `stock/get` 正常 200，说明不是 DNS 完全不通，可能是该路径被本机代理/CDN 拦截。
  - **不能据此判定东财 K 线不可用**，需 Lead 或 probe-cn 在另一网络复核；本报告只能确认快照可用，K 线未验证。

### 6.2 新浪财经

- 实时快照 `https://hq.sinajs.cn/list=...`：
  - 国际指数：`int_dji`、`int_nasdaq`、`int_sp500` 返回 200；**必须带 `Referer: https://finance.sina.com.cn/`，否则 403 Forbidden**（实测无 Referer 时 9 字节 `Forbidden`）。
  - 美股：`gb_aapl`、`gb_spy` 可用；`gb_$spy` 为空。
  - 港股：`hk00700` 可用。
  - 外汇：`EURUSD`、`fx_seurusd` 可用；期货：`hf_GC`、`hf_CL` 可用。
  - `US30/UKX/DAX/N225/HSI` 在 `hq.sinajs.cn` 上为空，全球指数要用 `int_*` 或东财。
  - 无 ACAO，GB18030 编码。
- 美股分钟 K（**免 key、免 Referer**）：
  - `https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getMinK?symbol=AAPL&type=5`
  - HTTP 200，0.1–0.3s，返回 JSON 数组，**固定 1023 根**：`type=1` 约 3 个交易日；`type=5` 约 1 个月；`type=15` 约 2 个月；`type=30` 约 4 个月；`type=60` 约 7 个月。
  - 支持 AAPL/SPY/QQQ/GLD/MSFT/TSLA/.INX/.IXIC；`0700.HK`、`GC`、`EURUSD` 返回 `[]`。
  - 无 ACAO；字段 `{d,o,h,l,c,v,a}`，日期是美东时间；`json_v2` 返回纯 JSON（`jsonp.php` 版本带 `var x=(...)` 包装和 `/*<script>...*/` 前缀）。
- 美股日 K：
  - `https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=AAPL`
  - HTTP 200，0.35–0.42s；AAPL 10056 根（1984-09-07 起，约 200KB），SPY 6486 根（2001 起），`.DJI` 5737 根（2004 起），`.IXIC` 5735 根。
  - 无 ACAO；一次全量返回，无分页/日期参数。
- 港股/期货/外汇 K 线：本次试的 `HK_MinKService`、`GlobalFuturesService`、`NewForexService` 全部 `Service not valid/not found` 或空数组；只有快照可用。

### 6.3 其他全球指数/ETF 源

- **Yahoo**：覆盖最全（^GSPC、^DJI、^IXIC、^HSI、^N225、^FTSE、^GDAXI、^FCHI、SPY/QQQ/GLD 等），但无 CORS。
- **Stooq**：本机被反爬，不可用。
- **FRED**：只有宏观/汇率日频，需 key；不是行情 K 线源。
- **World Bank**：只有年度宏观指标（本次 `NY.GDP.MKTP.CD` 返回 2025 年值），无行情。
- **Frankfurter**：只有日线汇率，无分钟数据。

---

## 7. 另类 / 宏观 / 汇率源

| 源 | 实测 | 结论 |
|---|---|---|
| FRED `api.stlouisfed.org/fred/series/observations` | 无 key → 400 `Variable api_key is not set`；`api_key=demo` → 400 `not a 32 character alpha-numeric lower-case string`；无 ACAO | **需要免费 key**；只有日/周/月宏观序列，不是分钟行情；本次 `federalreserve.gov/developer-resources.htm` 404 且 FRED docs 超时，额度未从官方页读到 |
| World Bank `api.worldbank.org/v2/...` | 200，约 1.0s，`ACAO: *` | 只有年度宏观（如 GDP），不能做行情 |
| Frankfurter `api.frankfurter.dev/v1/latest` | 200，约 0.5s，`ACAO: *` | 免 key 日线汇率；`api.frankfurter.app` 会 301 到 `.dev`；无分钟 |
| Frankfurter `v2/rates?from=...&to=...` | 200，约 0.8s，`ACAO: *` | 日线时间序列可用 |
| exchangerate.host `latest` | 200 但 body `{"success":false,"error":{"code":101,"type":"missing_access_key"}}` | **已改为必须 key**（即使 latest 也要）；带 `access_key=demo` 仍是 `invalid_access_key`；ACAO `*` |
| IEX Cloud | `cloud.iexapis.com`、`iexcloud.io` 均 TLS 握手失败 | 本机不可达，疑似已关停；未从官方公告确认 |

---

## 8. 核心问题：浏览器前端零 key 直连，美股分钟 K 到底有没有可用源？

### 8.1 结论

**没有通用可行的零 key 浏览器直连源。**

| 候选 | 能否浏览器直连 | 原因 |
|---|---|---|
| Yahoo chart | **不能** | GET 无 ACAO；OPTIONS 200 但无 ACAO/ACAM；`corsDomain` 参数也无效 |
| Nasdaq chart | **不能** | GET 无 ACAO；OPTIONS 204 只有 ACAM，没有 ACAO |
| Sina US MinK | **不能** | 返回 200 和 JSON，但无任何 CORS 头 |
| 东财 K 线 | **未知/本机不可达** | 快照端点有 ACAO，但 kline 路径本机连接被重置，未拿到响应头 |
| MarketData.app 无 token | **仅 AAPL 可以** | `ACAO: *`；无 token 只允许 AAPL；HTTP 203；默认 1 根，带 from/to 可到 1 年 1m/5m |
| Alpha Vantage / Twelve Data / FMP / Finnhub / Marketstack / Polygon / StockData | **技术上可以（带 key）** | 成功或 401 响应都带 ACAO；但 key 放前端违反零 key 铁律 |
| Tiingo / EODHD | **不能（即使有 key）** | 响应无 ACAO，浏览器会拦 |

### 8.2 唯一例外：MarketData.app 的 AAPL 演示

- 实测 URL：`https://api.marketdata.app/v1/stocks/candles/5/AAPL/?from=2025-10-20&to=2026-10-20`
- 结果：HTTP **203**，`ACAO: *`，19508 根 5m；1m+365d 可到 97532 根；日线 5 年 1254 根。
- 无 token 只支持 **AAPL**；IBM/TSLA/SPY/VFINX 全部 401；默认不带 `from/to` 只回 **1 根**；intraday 最长 **1 年**，超过 413。
- 官方 Quick Start 定位为无需注册的试用，注册后才有多标的；免费账户试用结束 100 请求/日；HTTP 203 不是 200，部分前端库可能误判。
- 判断：可作零 key 演示/单标的原型兜底，不能作为生产级全市场分钟 K 源。

### 8.3 可行替代（按推荐度）

1. **自建 Cloudflare Worker 代理 Yahoo（首选）**：仓库已有 `worker.js`（`ALLOW_HOSTS` 白名单 + CORS `*` + 10s 缓存 + 透传 Content-Type），只需把 `query1.finance.yahoo.com`、`query2.finance.yahoo.com`、`api.nasdaq.com` 加入 `ALLOW_HOSTS`；Worker 已带浏览器 UA。优点：前端零 key、全标的、全粒度、可控缓存；缺点：需部署一个 Worker（免费额度足够）。
2. **Worker 代理 Nasdaq 备用**：适合当日 1 分钟折线和日线历史；无 UA 要求，但需清洗 `$`、逗号、`MM/DD/YYYY`；只有当日分钟，不能替代 Yahoo 多日 1m/5m。
3. **Worker 代理 Sina 美股分钟 K/日 K**：免 key、响应快、1023 根；无 ACAO 所以必须走 Worker；适合国内网络兜底。
4. **引入 Twelve Data 免费 key（不推荐，违反铁律）**：8 credits/min、800/日；浏览器可直连（ACAO `*`）；但 key 会暴露，且额度扛不住多用户。
5. **只用 MarketData.app AAPL 演示做单标的原型**：零 key、CORS 可用，但只 AAPL、额度/稳定性无保障，不能作为产品方案。

**最终建议**：保持前端零 key 铁律，使用 **Worker 代理 Yahoo 为主 + Nasdaq/Sina 备用**；日线用 Yahoo/Sina；外汇日线用 Frankfurter（本身有 CORS，可直连）；快照可用东财（有 CORS）或走 Worker 的新浪。

---

## 9. 原始请求 URL 示例

> 以下均为本次实际请求；统一请求头 `Origin: https://5777-wq.github.io` + Chrome UA，部分源附 `Referer`。

```text
# Yahoo 分钟
https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m&range=5d
https://query2.finance.yahoo.com/v8/finance/chart/SPY?interval=5m&range=1mo
https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=60m&range=2y
https://query1.finance.yahoo.com/v8/finance/chart/0700.HK?interval=1m&range=5d
https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=15m&range=5d
https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1y

# Yahoo 日线/长历史
https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=20y
https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=max

# Nasdaq 当日分时 + 日线
https://api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks
https://api.nasdaq.com/api/quote/SPY/chart?assetclass=etf
https://api.nasdaq.com/api/quote/NDX/chart?assetclass=index
https://api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks&fromdate=2025-10-20&todate=2026-10-20
https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2020-01-01&todate=2026-10-20&limit=9999

# Stooq
https://stooq.com/q/d/l/?s=aapl.us&i=5
https://stooq.com/q/d/l/?s=aapl.us&i=d
https://stooq.com/q/d/l/?s=aapl.us&i=60
```

```text
# Alpha Vantage（demo）
https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=demo
https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=IBM&outputsize=full&apikey=demo

# Twelve Data（demo）
https://api.twelvedata.com/time_series?symbol=AAPL&interval=1min&outputsize=5000&apikey=demo
https://api.twelvedata.com/api_usage?apikey=demo

# FMP / Polygon / Tiingo / Finnhub / Marketstack / StockData
https://financialmodelingprep.com/api/v3/historical-chart/5min/AAPL?apikey=demo
https://api.polygon.io/v2/aggs/ticker/AAPL/range/5/minute/2026-10-13/2026-10-20?apiKey=demo
https://api.tiingo.com/iex/AAPL/prices?startDate=2026-10-13&resampleFreq=5min&token=demo
https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=5&from=1791849600&to=1792506000&token=demo
https://api.marketstack.com/v2/eod?access_key=demo&symbols=AAPL
https://api.stockdata.org/v1/data/intraday?symbols=AAPL&interval=5m&api_token=demo

# MarketData.app 无 token（仅 AAPL）
https://api.marketdata.app/v1/stocks/candles/1/AAPL/?from=2025-10-20&to=2026-10-20
https://api.marketdata.app/v1/stocks/candles/5/AAPL/?countback=50

# EODHD（demo，仅 AAPL.US）
https://eodhd.com/api/intraday/AAPL.US?interval=5m&api_token=demo&fmt=json
https://eodhd.com/api/intraday/AAPL.US?interval=1m&api_token=demo&fmt=json&from=1782221400&to=1782307800
https://eodhd.com/api/eod/AAPL.US?api_token=demo&fmt=json
```

```text
# 东方财富
https://push2.eastmoney.com/api/qt/stock/get?secid=105.AAPL&fields=f43,f44,f45,f46,f57,f58
https://push2.eastmoney.com/api/qt/stock/get?secid=100.HSI&fields=f43,f44,f45,f46,f57,f58
https://push2.eastmoney.com/api/qt/stock/get?secid=100.SPX&fields=f43,f44,f45,f46,f57,f58
https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=105.AAPL&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&beg=0&end=20500101&lmt=5

# 新浪
https://hq.sinajs.cn/list=int_dji
https://hq.sinajs.cn/list=gb_aapl
https://hq.sinajs.cn/list=hk00700
https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getMinK?symbol=AAPL&type=5
https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getMinK?symbol=.INX&type=5
https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=AAPL

# 汇率/宏观
https://api.frankfurter.dev/v1/latest?base=USD
https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD&from=2026-09-01&to=2026-10-20
https://api.exchangerate.host/latest?base=USD
https://api.stlouisfed.org/fred/series/observations?series_id=DEXUSEU&file_type=json
https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=5
```

---

## 10. 响应片段（每条截断 120 字）

```text
# Yahoo 1m+5d（成功）
{"chart":{"result":[{"meta":{"currency":"USD","symbol":"AAPL","exchangeName":"NMS","fullExchangeName":"NasdaqGS","instrumentType":"EQUITY","firstTradeDate":345479400,"regular
```

```text
# Yahoo 1m+1mo（422）
{"chart":{"result":null,"error":{"code":"Unprocessable Entity","description":"1m data not available for startTime=1789827297 and endTime=1792505697. Only 8 days worth
```

```text
# Yahoo 60m+5y（422）
{"chart":{"result":null,"error":{"code":"Unprocessable Entity","description":"1h data not available for startTime=1634825810 and endTime=1792505810. The requested range
```

```text
# Nasdaq 当日分时
{"data":{"symbol":"AAPL","company":"Apple Inc. Common Stock","timeAsOf":"Oct 20, 2026 10:19 AM ET","isNasdaq100":false,"lastSalePrice":"$342.20","netChange":"-0.74"
```

```text
# Nasdaq 日线
{"data":{"symbol":"AAPL","totalRecords":251,"tradesTable":{"asOf":null,"headers":{"date":"Date","close":"Close/Last","volume":"Volume","open":"Open","high":"High"
```

```text
# Stooq 挑战页（HTTP 200 假成功）
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body><noscript>This site requires JavaScript to verify
```
```text
# Alpha Vantage demo（成功）
{     "Meta Data": {         "1. Information": "Intraday (5min) open, high, low, close prices and volume",         "2. Symbol": "IBM",         "3. Last Refreshed"
```

```text
# Alpha Vantage 无 key（HTTP 200 假成功）
{     "Error Message": "the parameter apikey is invalid or missing. Please claim your free API key on (https://www.alphavantage.co/support/#api-key). It should take
```

```text
# Alpha Vantage demo 不支持 AAPL（HTTP 200）
{     "Information": "The **demo** API key is for demo purposes only. Please claim your free API key at (https://www.alphavantage.co/support/#api-key) to explore
```

```text
# Twelve Data demo AAPL 5min
{"meta":{"symbol":"AAPL","interval":"5min","currency":"USD","exchange_timezone":"America/New_York","exchange":"NASDAQ","mic_code":"XNGS","type":"Common Stock"},"values"
```

```text
# Twelve Data demo 不支持 MSFT（401）
{"code":401,"message":"The 'demo' API key is only used for initial familiarity. To become a full user, you can request your own API key at https://twelvedata.com/pricing."
```

```text
# FMP demo（401）
{   "Error Message": "Invalid API KEY. Feel free to create a Free API Key or visit https://site.financialmodelingprep.com/faqs?search=why-is-my-api-key-invalid for more
```

```text
# Polygon demo（401）
{"status":"ERROR","request_id":"191234b469c047074cab481377afabc1","error":"Unknown API Key"}
```

```text
# Tiingo demo（403）
{"detail":"Invalid token."}
```

```text
# Finnhub demo（401）
{"error":"Invalid API key."}
```
```text
# MarketData.app 无 token AAPL（HTTP 203）
{"s":"ok","t":[1792071000,1792071300,1792071600,1792071900,1792072200,1792072500,1792072800,1792073100,1792073400,1792073700,1792074000,1792074300,1792074600,1792074900
```

```text
# EODHD demo 5m（成功，但无 ACAO）
[{"timestamp":1782221400,"gmtoffset":0,"datetime":"2026-06-23 13:30:00","open":297.537994,"high":298.309997,"low":295.179992,"close":297.049987,"volume":2685201}
```

```text
# EODHD 无 key（401，无 ACAO）
Unauthenticated
```

```text
# Marketstack demo（401）
{   "error": {     "code": "invalid_access_key",     "message": "You have not supplied a valid API Access Key. [Technical Support: support@apilayer.com]"   } }
```

```text
# 东方财富快照（有 ACAO）
{"rc":0,"rt":4,"svr":175642680,"lt":1,"full":1,"dlmkts":"","dsc":"0","data":{"f43":342515,"f44":343060,"f45":338700,"f46":339608,"f57":"AAPL","f58":"苹果"}}
```

```text
# 新浪美股 5m（无 ACAO）
[{"d":"2026-10-01 09:55:00","o":"331.1600","h":"331.7300","l":"330.7100","c":"330.9190","v":"347977","a":"115233000"},{"d":"2026-10-01 10:00:00","o":"330.8700"
```

```text
# 新浪美股日 K（无 ACAO）
[{"d":"1984-09-07","o":"26.50","h":"26.87","l":"26.25","c":"26.50","v":"2981600","a":"0"},{"d":"1984-09-10","o":"26.50","h":"26.62","l":"25.87","c":"26.37","v":"2346400"
```

```text
# 新浪国际指数快照（必须带 Referer）
var hq_str_int_dji="道琼斯,46247.29,299.97,0.65";
```

```text
# Frankfurter（有 ACAO）
{"amount":1.0,"base":"USD","date":"2026-10-20","rates":{"AUD":1.4317,"BRL":5.0235,"CAD":1.4051,"CHF":0.82363,"CNY":6.678,"CZK":21.693,"DKK":6.6648
```

```text
# exchangerate.host（已要 key）
{   "success": false,   "error": {     "code": 101,     "type": "missing_access_key",     "info": "You have not supplied an API Access Key. [Required format: access_key=YOUR_ACCESS_KEY]"   } }
```

```text
# FRED 无 key（400）
{"error_code":400,"error_message":"Bad Request.  Variable api_key is not set.  Read https:\/\/fred.stlouisfed.org\/docs\/api\/api_key.html for more information."}
```

---

## 11. 未测 / 本机不可达 / 待复核

| 项 | 状态 | 原因 |
|---|---|---|
| Stooq 历史深度、1m/5m/60m 实际数据 | 未测 | JS 挑战 + `Access denied` |
| 东财 kline/trends2/clist | 本机不可达 | `push2his` 路径连接被重置；需其他网络复核 |
| 东财 K 线 CORS | 未确认 | 没拿到响应头；快照端点有 ACAO，不能外推 |
| 港股 0700.HK 分钟 K（免 key 直连） | 未找到 | Yahoo 有但无 CORS；新浪 HK K 服务报 `Service not valid`；东财 K 线本机不可达 |
| GC=F / EURUSD=X 分钟 K（免 key、非 Yahoo） | 未找到 | 新浪 futures/forex K 服务失效；东财 K 线不可达；Yahoo 有但无 CORS |
| Polygon 免费档具体额度 | 未从官方页读到 | `polygon.io/pricing` 301 到 `massive.com/pricing`，内容 JS 动态渲染 |
| Tiingo 免费 500/日 | 未从官方页读到 | 文档页 JS 空壳，只返回标题 |
| Finnhub 免费 60/min | 未从官方页读到 | 定价页 JS 动态渲染；但 candle 端点文档明确 Premium |
| IEX Cloud 关停公告 | 未确认 | 域名 TLS 握手失败，无法访问公告 |
| Databento 具体价格 | 未读到 | 定价页 JS 应用，API 401 |
| FRED 文档与额度 | 未读到 | `federalreserve.gov/developer-resources.htm` 404，FRED docs 超时 |
| TradingView API | 未测试 | 无公开官方 API；不应未授权抓取 |

---

## 12. 给本项目的落地建议

1. **保持前端零 key**：不要让任何免费 key 进入 `index.html` / `js/`。
2. **Worker 白名单新增**：`query1.finance.yahoo.com`、`query2.finance.yahoo.com`、`api.nasdaq.com`；可选 `stock.finance.sina.com.cn`（若已用新浪分钟 K）。现有 `hq.sinajs.cn` 已在白名单，Worker 会补 Referer。
3. **主数据源**：Yahoo chart（1m/5m/15m/30m/60m/1d），前端通过 Worker 请求；注意秒级时间戳和区间限制。
4. **备用源**：Nasdaq chart（当日 1 分钟折线，可聚合成 5m/15m/30m/60m）；Nasdaq historical 日线；Sina US MinK 1023 根作为国内网络兜底。
5. **日线**：Yahoo `interval=1d&range=20y` 或 Sina `getDailyK`（走 Worker）。
6. **外汇日线**：Frankfurter 可直接浏览器请求（有 ACAO），但只有日线；分钟外汇走 Yahoo Worker。
7. **快照**：东财 `push2.eastmoney.com/api/qt/stock/get` 有 ACAO，可直接用；但数值缩放和 secid 需维护映射表。
8. **不要**把 Stooq、Tiingo、EODHD 作为浏览器直连方案；不要把 MarketData.app 的 AAPL 演示当生产。
9. **监控**：Yahoo/Nasdaq 都是非官方接口，建议前端对 HTTP 状态 + body 业务错误双重判断；Worker 层加 5–10s 缓存，避免多用户放大请求。

---

---

## 13. 与 Lead 实测结论的交叉核对（2026-10-20）

| Lead 结论 | 本次实测是否一致 | 备注 |
|---|---|---|
| Yahoo 本机 200 正常，但无 ACAO；OPTIONS 200 但不回 ACAM/ACAO | **一致** | 本次 OPTIONS 返回 `allow: HEAD,GET,OPTIONS`、`Vary: Origin`，无任何 ACAO |
| Yahoo 时间戳是秒；1m+1mo 422、60m+5y 422、1d+10y OK | **一致** | 另确认 1m 上限是 **8 天**（9d 才 422）、60m 上限 730 天（729d OK/731d 422） |
| 连续 25 次 query1 全 200，本机没触发 429 | **基本一致，但有关键补充** | 带浏览器 UA 时本次 40 次全 200；**不带 UA / curl UA 立即 429** → 429 与 UA/风控强相关 |
| Nasdaq 可用且无需 UA 特判，chart 约 372 点，无 ACAO | **一致** | 本次 380–409 点（含盘前）；不传日期=当日 1m 折线，传 fromdate/todate=日线 |
| Nasdaq historical 最多只回 200 条日线 | **不一致** | 本次 `limit=9999` + 明确 fromdate 返回 **251（1y）/1708（2020起）/2513（20y）** 行；`totalRecords` 随范围变化，不是恒 200。可能是参数不同导致，建议以带 fromdate/todate 的请求为准 |
| Stooq 本机反爬，796 字节挑战页，加 Referer 无效 | **一致** | 另做了 SHA-256 PoW 求解，拿到 cookie 后仍 `Access denied` |
| Twelve Data demo 只对 AAPL 生效，outputsize 5000 可拉 5000 根 | **一致** | `/api_usage` 显示 `plan_limit=2584`、`plan_category=ultra` |
| Alpha Vantage demo 对 IBM/MSFT 可用（1min/5min），免费 25/日 | **一致** | 另确认 demo 的 15m/30m/60m 直接返回 `Information` 提示，不支持 |
| Alpaca crypto 无 key 可用、股票 bars 401 | 未测（不在本任务范围） | 本次未覆盖 Alpaca |
| Marketstack/Finnhub/Polygon/Tiingo/FMP 无 key 或 demo 全 401 | **一致** | 均为 401（Tiingo 是 403） |
| EODHD demo 可用但无 ACAO | **一致** | demo 仅 AAPL.US；1m/5m/15m/30m/1h 均可取，但必须传 Unix 秒 |
| IEX Cloud 已不可达 | **一致** | TLS 握手失败 |
| 公共 CORS 代理不可靠，只有自建 Worker 可控 | 未测代理（不在本任务范围） | 本次未测试 allorigins/corsproxy/codetabs 等 |
| MarketData.app `token=demo` 可用（HTTP 203、ACAO=*、只有 1 根 K 线） | **部分一致** | 无 token 与 `token=demo` 都返回 203 + ACAO `*`；但**带 from/to 或 countback 可返回多根**（1m+365d 97532 根、5m+1y 19508 根），默认不带参数才只有 1 根 |
| 错误响应也带 CORS 头（Finnhub/FMP/Marketstack/Twelve Data ACAO `*`；Polygon 回显 Origin） | **一致** | 本次 401/403 均观察到对应 ACAO；Tiingo/EODHD 无 ACAO 也一致 |
---

## 14. 官方文档/定价页读取记录（用于核对免费额度）

| 页面 | 本次访问结果 | 读到的关键数字（原文） |
|---|---|---|
| `https://www.alphavantage.co/premium/` | 200，7.2KB | "For use cases that exceed our standard API usage limit (**25 API requests per day**) ... we offer a premium plan" |
| `https://twelvedata.com/pricing` | 200，77KB | "API credits **8 (800 a day)**"; "API credits reset each minute" |
| `https://site.financialmodelingprep.com/pricing-plans` | 200，36KB | Basic "$0/month ... **250 Calls / Day**"; "**Free plan - 500MB**"(30 天流量) |
| `https://www.marketdata.app/docs/api/` | 200，7.3KB | "After your trial ends ... you will still get **100 free requests per day**"; "Stock endpoints: Use **AAPL**" |
| `https://eodhd.com/pricing` | 200，25KB | "Once you register you get **20 free API calls per day**"; "Requests / minute **20**"; "Welcome bonus API calls **500**" |
| `https://marketstack.com/pricing` | 200，34KB | "Free ... **100 Requests / mo**"; "**End-of-Day Data** / **1 Year History**" |
| `https://www.stockdata.org/pricing/` | 200，134KB | "Free $0.00/mo ... **100 requests daily**"; "1 symbol / intraday request"; "1 month of intraday data" |
| `https://finnhub.io/docs/api/stock-candles` | 200，76KB | `"premium":"**Premium Access Required**"`; resolution 支持 `1, 5, 15, 30, 60, D, W, M` |
| `https://polygon.io/pricing` | **301 到 massive.com/pricing**，JS 渲染 | 未读到免费额度数字 |
| `https://www.tiingo.com/documentation/general/overview` | 200 但空壳（37 字符） | 未读到免费额度数字 |
| `https://databento.com/pricing` | 200 但 JS 应用提示页 | 未读到价格（付费产品） |
| `https://finnhub.io/pricing` | 200 但 JS 动态渲染 | 未读到 60/min |
| `https://fred.stlouisfed.org/docs/api/fred/` | 超时（30s） | 未能读文档；API 明确要求 32 位小写字母数字 key |
| `https://www.federalreserve.gov/developer-resources.htm` | **404** | FRED 开发者页已迁移 |

> 说明：上表只记录本次真实抓到的文字；JS 渲染页（Polygon/Tiingo/Databento/Finnhub pricing）无法用 Invoke-WebRequest 读到数字，凡未确认的额度都已标注为未从官方页确认。

---

*本报告只写入 `docs/research/global-sources.md`，未修改仓库其他文件，未执行 git commit。*
