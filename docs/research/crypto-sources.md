# 加密货币行情源实测报告（免费 / 零 API Key / 浏览器可直连）

> 调研人：probe-crypto　测试时间：**2026-10-20 22:12–22:50 (UTC+8) / 14:12–14:50 UTC**
> 测试方式：本机 PowerShell `Invoke-WebRequest -UseBasicParsing`，每个请求统一带
> `User-Agent: Mozilla/5.0 ... Chrome/124.0` 和 `Origin: https://5777-wq.github.io`，
> 直接读取响应头 `Access-Control-Allow-Origin`（下称 ACAO）判断浏览器能否直连。
> **所有结论均为真实请求结果，未采用记忆或文档推测；确实没测的会标「未测」。**
> 项目铁律：前端零 API key、浏览器直连公开接口 —— 本报告只收录满足这一条的数据源。

---

## 0. 一句话结论（TL;DR）

1. **首选 Binance `data-api.binance.vision`**：ACAO=`*`、零 key、1000 根/次、支持 **1s**、BTCUSDT 回溯到 **2017-08-17**、时间戳毫秒、字段顺序固定 12 列；另有 `data.binance.vision` 的 zip/csv 历史包可回补长历史。
2. **次选 OKX**：ACAO 回显 Origin（实测 `https://5777-wq.github.io`）、零 key、300 根/次、毫秒时间戳，且响应自带 **`confirm` 字段（0=未收盘 / 1=已收盘）**，是唯一"原生告诉你 K 线闭没闭"的源。
3. **KuCoin / MEXC / Deribit / Crypto.com(v2) 本机无 ACAO → 浏览器直连会被 CORS 拦死，不要放进零 key 直连清单**（KuCoin、MEXC 的 OPTIONS 预检也不返回 CORS 头）。
4. **Kraken 有 ACAO 但 `since` 参数形同虚设**：任何 `since` 都只返回"最新 720 根 + 1"，无法往历史翻页 → 只能当"最近行情"源，不能当回补源。
5. **多数源字段顺序不是 OHLC**：Coinbase 是 `[t, low, high, open, close, vol]`；KuCoin 是 `[t, open, close, high, low, ...]`；Gate 是 `[t, quoteVol, close, high, low, open, ...]`；HTX 是 `{id, open, close, low, high, ...}`；Deribit 是**列式数组**（ticks/open/high/low/close 各自一个数组）。接错一个位置就画出鬼畜 K 线。
6. **Bybit 可达性不稳定**：同一台机器 14:21 UTC 还是 200 + ACAO 回显，14:53 UTC 就变成 403 `CloudFront ... block access from your country` —— 功能再合适也不能进主降级链。
7. **最新一根必然未收盘**：所有交易所端点都会返回"正在滚动的那根"。Binance 1m 实测 `closeTime - now = +53s`（closeTime 在未来），**增量拉取必须丢弃 `closeTime > now` 或最后一根**，否则 10 秒轮询下最后一根会不断变形。

---

## 1. 总表

> 「CORS」列：`*` = `Access-Control-Allow-Origin: *`（任意站点可用）；`回显` = 服务端把请求的 Origin 原样回显（本机 `https://5777-wq.github.io` 实测可用）；`无` = 响应里没有该头（浏览器 fetch 直接失败）。
> 「限频」列：标「实测」的是本次真实观测（响应头或压测），标「官方口径·未验证」的是业界通识但本机没打爆过，接入时按保守值限速。

| 源 | 端点 | 粒度 | 单次上限 | 历史深度（实测） | CORS | key | 限频 | 坑（时间戳 / 字段顺序） |
|---|---|---|---|---|---|---|---|---|
| **Binance** | `data-api.binance.vision/api/v3/klines`（同 `api.binance.com`、`api1-4`） | 1s,1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M | **1000**（1001/1500 静默截断为 1000，不报错） | BTCUSDT/ETHUSDT **2017-08-17**；BNBUSDT 2017-11-06 | `*` | 不要 | 6000 weight/min/IP（`exchangeInfo` 实测），klines **weight=2/次**（实测 `x-mbx-used-weight-1m` 每次 +2） | **毫秒**；12 列 `[openTime,o,h,l,c,vol,closeTime,quoteVol,trades,takerBuyBase,takerBuyQuote,ignore]`；数字是字符串；**最后一根未收盘** |
| **OKX** | `www.okx.com/api/v5/market/candles`（近期）+ `/history-candles`（翻历史） | 1s,1m,3m,5m,15m,30m,1H,2H,4H,6H,12H,1D,2D,3D,1W,1M,`1Dutc` | **300**（301/400 静默截断 300；两个端点都是 300） | 1D：**2017-10-10 16:00 UTC**；1m/5m/1H：**2018-01-11 11:26 UTC** | 回显 | 不要 | 无 Ratelimit 响应头；实测 60 次连发全 200 | **毫秒**；9 列 `[ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm]`；**最新在前（降序）**；`confirm=0` 表示未收盘；`after=<ms>` 翻页（取比该时间更早的） |
| **Bybit**（⚠️ 可达性不稳定） | `api.bybit.com/v5/market/kline` | 1,3,5,15,30,60,120,240,360,720,D,W,M（**无 1s**，1s 返回 retCode 10001） | **1000**（1001/2000 静默截断） | spot BTCUSDT **2021-07-05**；linear BTCUSDT **2020-03-25** | 08:21 UTC 时回显 + `Allow-Credentials:true`；**08:53 UTC 复测变 403 CloudFront 国家封锁、连 ACAO 都没有** | 不要 | 无 Ratelimit 头；未压测 | **毫秒**；7 列 `[start,o,h,l,c,vol,turnover]`；**最新在前**；无 closed 标记，只能靠 `start + interval > now` 判断；`end=<ms>` 翻页；**同一台机器半小时内 200→403，不可承诺可用性** |
| **Coinbase Exchange** | `api.exchange.coinbase.com/products/BTC-USD/candles` | 60,300,**900**,3600,**21600**,86400（其它值 400） | **显式 start/end 时 300 根**（301 根 → 400 `Count of aggregations requested exceeds 300`）；**不带参数默认 350 根**（g=60/300/3600/86400 复测 3 次全部 350） | BTC-USD **2015-07-20**；1m/5m 至少可回溯到 2016-01-01 | `*` | 不要 | 无 Ratelimit 头；实测 20 连发全 200 | **秒**（全表唯一秒级主流交易所之一）；行 `[time, LOW, HIGH, OPEN, CLOSE, vol]` —— **low/high 在 open/close 前面**；**最新在前**；分母是 USD 不是 USDT；**默认 350 与自定 300 两套上限，跨日线要注意** |
| **Kraken** | `api.kraken.com/0/public/OHLC?pair=XBTUSD` | 1,5,15,30,60,240,1440,10080,21600 | **720 根 + 1（实测 721）** | **只有最后 721 根窗口**：`since=2017/1 年前/30 天前` 实测返回完全相同的最新窗口，**不能翻历史** | 回显 | 不要 | **实测会触发 `EGeneral:Too many requests`**；建议 ≥1–2s 间隔 | **秒**；8 列 `[time,o,h,l,c,vwap,vol,count]`（**close 是 idx4，vwap 是 idx5**）；**最旧在前（升序）**；外层 key 是交易对名 `XXBTZUSD` 不是 `XBTUSD`；`result.last` 是游标 |
| **Bitget** | `api.bitget.com/api/v2/spot/market/candles`（近期）/ `history-candles`（历史） | 1min,3min,5min,15min,30min,1h,4h,6h,12h,1day,1week,1M，以及 `6Hutc/12Hutc/1Dutc/3Dutc/1Wutc/1Mutc` | 近期 **1000**（1001 → code 40053）；历史 **200**（201 → code 40020） | 1m 到 **2018-12-31 23:57**；更早（2018-05）返回空 | `*` | 不要 | 无 Ratelimit 头；未压测 | **毫秒**；8 列 `[ts,o,h,l,c,baseVol,quoteVol,quoteVol2]`；**最旧在前（升序）**；**`1day` 的换日点是 16:00 UTC（=UTC+8 日界），要 UTC 日线必须用 `1Dutc`**；`history-candles` **必须带 endTime**（只给 startTime → 400172） |
| **Gate.io** | `api.gateio.ws/api/v4/spot/candlesticks` | 10s,1m,5m,15m,30m,1h,4h,8h,1d,7d,30d | **1000**（1001 → 400 `INVALID_PARAM_VALUE`） | 受"最多 10000 点前"限制：1m 只能到 **~6.9 天前**（7 天 → 400）；1h 到 **~416 天前**；1d 可窗口翻页到 2015-12 | `*` | 不要 | `X-Gate-RateLimit-Limit: 200` / `Remaining` / `Reset-Timestamp`（实测响应头） | **秒**；8 列 `[ts, quoteVol, CLOSE, HIGH, LOW, OPEN, baseVol, closed]` —— **顺序是 C,H,L,O 且成交量在最前**；`closed=false` 表示未收盘；**最旧在前**；`from/to` 窗口跨度不能超过 1000 点 |
| **MEXC** | `api.mexc.com/api/v3/klines` | 1m,5m,15m,30m,60m,4h,1d,1W,1M（`1h`/`1w`/`2h`/`6h`/`12h` 全部 400） | **500**（1000 → 静默 500） | **无法回溯**：startTime/endTime 实测被忽略，永远返回最新窗口 | **无**（GET 无 ACAO，OPTIONS 403） | 不要 | 未测（不可用） | **毫秒**；8 列 `[openTime,o,h,l,c,vol,closeTime,quoteVol]`；**浏览器直连不可用** |
| **KuCoin** | `api.kucoin.com/api/v1/market/candles` | 1min,3min,5min,15min,30min,1hour,2hour,4hour,6hour,12hour,1day,1week,1month | 默认 **100**；带 `startAt/endAt` 最多 **1500**（1501 → 1500） | 2018-01-01 起（2017 返回空） | **无**（GET 无 ACAO，OPTIONS 也不返回 CORS 头；`Vary: Origin` 但从不回 ACAO） | 不要 | `gw-ratelimit-limit: 2000` / remaining / reset（实测响应头） | **秒**；7 列 `[ts, OPEN, CLOSE, HIGH, LOW, vol, turnover]` —— **o,c,h,l 顺序**；**最新在前**；**浏览器直连不可用**（虽不需要 cookie，但 CORS 拦死） |
| **Bitstamp** | `www.bitstamp.net/api/v2/ohlc/btcusd/` | 60,180,300,900,1800,3600,7200,14400,21600,43200,86400,259200 | **1000**（1001 → 400 validation-error） | **2011-08-18**（全表最深） | `*` | 不要 | 无 Ratelimit 头；未压测 | **秒**（且是**字符串** `"1792505700"`）；对象式 `{timestamp, open, high, low, close, volume}` 全是字符串；**最旧在前**；⚠️ Lead 本机曾 403、我这边 200 —— **可达性不稳定** |
| **Crypto.com** | ⚠️ 用 **v1**：`api.crypto.com/exchange/v1/public/get-candlestick`（v2 `/v2/public/...` **无 ACAO**） | 1m,5m,15m,30m,1h,4h,1d,1w,1M | **300**（301/1000 静默 300） | 1d/1m 到 **2021-01**（2020 及更早返回空） | v1 回显；v2 **无** | 不要 | 无 Ratelimit 头；未压测 | 参数名是 **`timeframe`**（用 `interval` 会被静默忽略、永远回 1m）；对象式 `{o,h,l,c,v,t}`，`t` **毫秒**；**最旧在前**（最新在数组末尾） |
| **HTX（火币）** | `api.huobi.pro/market/history/kline`（`api.htx.com` 同） | 1min,5min,15min,30min,60min,4hour,1day,1week,1mon,1year | **2000**（2001 → `invalid-parameter`） | **只有最新 2000 根**：1day 只能到 **2021-04-29**；`from` 参数实测被忽略 | 回显 | 不要 | 无 Ratelimit 头；未压测 | **秒**；对象式 `{id, open, CLOSE, LOW, HIGH, amount, vol, count}` —— **c 在 h 前面**；`amount`=基础币量、`vol`=计价币量；**最新在前** |
| **Deribit**（衍生品） | `www.deribit.com/api/v2/public/get_tradingview_chart_data` | 1,3,5,15,30,60,120,180,360,720,1D（240 → 400） | **~5001 点**（30 天 1m 请求实测正好 5001，**保留最新的一段、丢弃最早的**） | BTC-PERPETUAL 1D 到 **2018-08-14**；1m 2018 无数据、2019 起有 | **无** | 不要 | 无 Ratelimit 头 | **毫秒**；**列式返回** `result.ticks[] / open[] / high[] / low[] / close[] / volume[] / cost[]`，不是行数组；**浏览器直连不可用** |
| **CoinGecko** | `api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=1` | 聚合粒度：1d→**30min**；7d/30d→**4h**；90d→**4d(345600s)** | 48/42/180/23 根（服务端定，不给你选） | 90d 档实测可用；180d/365d/max 本次全部 429 未取得 | `*` | 不要 | 免费 30 req/min（官方口径）；**实测连打 ~8 次就 429**，冷却 65s 后才恢复 | **毫秒**；5 列 `[ts,o,h,l,c]` **没有 volume**；**聚合价不是交易所真 K 线**，不能当行情主源 |
| **CoinPaprika** | `api.coinpaprika.com/v1/coins/btc-bitcoin/ohlcv/today`、`/ohlcv/latest` | 仅"今天"和"昨天"1D | 1 根 | **免费档只给最近 2 天**：`/ohlcv/historical` 回溯任何历史 → **402 需付费** | `*` | 不要 | `ratelimit-limit: 20000`（响应头） | 时间是 **ISO8601 字符串**；字段 `{time_open,time_close,open,high,low,close,volume,market_cap}`；只能做"今日涨跌"参考 |
| **CryptoCompare** | `min-api.cryptocompare.com/data/v2/histominute` | — | — | — | 无 | **强制 key** | — | **实测 401 `API key required`**，零 key 直连已不可用，剔除 |
| **Alpaca**（第三方聚合，非交易所） | `data.alpaca.markets/v1beta3/crypto/us/bars` | 1Min,5Min,15Min,1Hour,1Day | **10000**（10001 → 400）；默认单页约 887 | **2021-01-01** 起（2020-12-31 返回空） | `*` | 不要（crypto 免鉴权） | `X-Ratelimit-Limit: 200` / Remaining / Reset（实测响应头） | **ISO8601 字符串** `"2026-10-20T00:00:00Z"`（不是毫秒！）；**对象式** `{t,o,h,l,c,v,n,vw}`；返回体按 symbol 分组 `bars["BTC/USD"]`；**volume 可能为 0**（聚合商口径）；有 `next_page_token` 分页 |
| **Binance 历史包** | `data.binance.vision/data/spot/{daily,monthly}/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01-01.zip` | 全部周期（含 1s） | 一整天/一整月 | **2017-08 起**（`1m/BTCUSDT-1m-2017-08.zip` 实测 200） | GET 实测 `*`；S3 列表 XML 也 `*` | 不要 | S3/CloudFront，无头限制 | **zip 内 csv 无表头**，12 列与 API 完全一致（毫秒）；1m 单日 zip ≈ 69KB；1s 单月 zip 可达 **114MB**（2023-01）、解压后 1,281,572 行 |

---

## 2. 分源详情（原始请求 + 响应片段）

> 片段统一截断到约 120 字，均为本次真实响应（价格是测试时点的快照）。

### 2.1 Binance（首选）

```
GET https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2
Origin: https://5777-wq.github.io
→ 200  ACAO: *   x-mbx-used-weight-1m: 5
```
```json
[[1792505460000,"83003.92000000","83118.38000000","83000.00000000","83118.38000000","70.94829000",1792505519999,"5893561...
```

**实测要点**

| 项目 | 结果 |
|---|---|
| 备用域名 | `api.binance.com` / `api1` / `api2` / `api3` / `api4` / `data-api.binance.vision` **全部 200 且 ACAO=`*`**（api4 第一次 TLS 握手失败、重试即 200，属抖动） |
| 是否要 key | 公开行情**不要**；`/api/v3/account` 无签名 → 400 `-1102 Missing parameter 'signature'`（证明只有私有接口要 key） |
| interval | 1s,1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M 全部 200 |
| limit | 上限 **1000**；`limit=1001/1500` **不报错、静默返回 1000**（最阴的坑，前端会以为拿全了） |
| startTime | `startTime=0` 或 1490000000000 → 最早 **2017-08-17 00:00 UTC**（`1502928000000`，BTCUSDT/ETHUSDT 上市日） |
| 1s 真相 | 接口 `startTime=0` 会从 **2017-08-17 04:00:28** 开始吐数据，但早期大量 `volume=0, trades=0` 的填充行（实测 2017-08-17 07:00 UTC 连续 60 秒全 0 成交；2018-01-01 同点位 26/60 秒有成交；2020-09 起基本每秒都有）→ **早期秒级请用历史包，接口只用于近期** |
| 权重 | `exchangeInfo` 实测：`REQUEST_WEIGHT 6000/MINUTE`、`RAW_REQUESTS 300000/5MIN`；单次 klines 实测 **+2 weight**（与 limit 无关） |
| 国内可达性 | 本机（境外出口）`api.binance.com` **200、无 451**；但国内常见 `451/被墙`，**生产必须以 `data-api.binance.vision` 为主域名**（官方行情专用域，见官方公告口径） |
| 未闭合 | `limit=2` 最后一根 `closeTime=1792506959999`，而 `now=1792506906532` → **closeTime 在未来、未收盘** |

**历史回补（data.binance.vision）**
```
GET https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01-01.zip
→ 200  ACAO: *  application/zip  68,923 bytes（魔法字 50 4B 03 04）
```
```
1704067200000,42283.58000000,42298.62000000,42261.02000000,42298.61000000,35.92724000,1704067259999,1519031.69451920,1327,...
```
- 单日文件正好 **1440 行**（1m），无表头，12 列与 API 完全一致（毫秒）。
- 月度：`.../monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01.zip` = 2,169,570 bytes。
- 1s：`.../monthly/klines/BTCUSDT/1s/BTCUSDT-1s-2017-08.zip` = 8,538,327 bytes → 解压 169MB / 1,281,572 行；`1s-2023-01.zip` = 114MB。
- 目录可枚举：`https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/spot/monthly/klines/BTCUSDT/1m/` → 200、ACAO=`*`、返回 S3 XML（可直接列全部月份）。

---

### 2.2 OKX（次选，自带 closed 标记）

```
GET https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1m&limit=2
Origin: https://5777-wq.github.io
→ 200  ACAO: https://5777-wq.github.io   Vary: Accept-Encoding, Origin
```
```json
{"code":"0","data":[["1792505580000","83037.1","83110.4","82991.8","83086.3","9.12972051","758163.461311401","758163...
```

- **粒度**：1s/1m/3m/5m/15m/30m/1H/2H/4H/6H/12H/1D/2D/3D/1W/1M 全部 200；`1Dutc` 存在（UTC 日界）；`1Y` → `51000 Parameter bar error`。**大小写敏感**（`1H` 不是 `1h`）。
- **上限**：`candles` 和 `history-candles` 都是 **300**（301/400 静默截到 300）。
- **两个端点的分工（关键）**：`candles` 只覆盖近期（`after=<ms>` 往老翻，超过窗口返回空数组）；**翻历史必须用 `history-candles`**：
  ```
  GET /api/v5/market/history-candles?instId=BTC-USDT&bar=1m&limit=3&after=1520000000000
  → {"code":"0","data":[["152000...]]   n=3  newest=2018-03-02 14:13
  ```
- **历史地板（二分实测）**：1D 走到 **2017-10-10 16:00 UTC**（连续 33 页 ×100 到 `n=97` 结束，再翻为空）；1m / 5m / 1H 都是 **2018-01-11 11:26 UTC** 附近。
- **字段**：`[ts(ms), o, h, l, c, vol(张), volCcy(币), volCcyQuote(计价), confirm]`，**最新在前**，`confirm=1` 已收盘 / `0` 未收盘（实测最新一根 `confirm=0`）。
- **限频**：响应**没有**任何 `x-ratelimit-*` 头；实测 **60 次连发全部 200**（未触发 429）。官方口径 20 次/2s（本机未验证，接入按保守值）。

---

### 2.3 Bybit

```
GET https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=2
→ 200  ACAO: https://5777-wq.github.io  Access-Control-Allow-Credentials: true
```
```json
{"retCode":0,"retMsg":"OK","result":{"category":"spot","list":[["1792505640000","83137.2","83206.5","83077.4","83147.2","15.552189","1293174.6595236"],...
```
- interval：`1,3,5,15,30,60,120,240,360,720,D,W,M`；**`1s` → retCode 10001 `Invalid period!`**。
- limit **1000**（1001/2000 静默截 1000）。
- 历史：`category=spot` 的 BTCUSDT 最早 **2021-07-05**（用 `end` 翻页：第 1 页 1000 根到 2024-01-25，第 2 页 934 根到 2021-07-05）；`category=linear` 的 BTCUSDT 到 **2020-03-25**。
- 字段 7 列 `[start,o,h,l,c,vol,turnover]`，**最新在前**，无 closed 标记（只能 `start + intervalMs > now`）。
- ACAO 是回显 Origin（不是 `*`），换域名部署时不需要改服务端——它跟着请求走。

**⚠️ 可达性反转（同一天实测，务必记录）**
```
# 14:21 UTC（首次）
GET https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=2
→ 200  ACAO: https://5777-wq.github.io

# 14:53 UTC（约 30 分钟后，同一台机器、同一个 UA/Origin）
GET https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=3
→ 403
{"error":"The Amazon CloudFront distribution is configured to block access from your country"}
响应头只剩 CloudFront 的 Connection/X-Cache/Via，**没有 ACAO**
```
→ Bybit 走 CloudFront 且按出口 IP 国家/地区封锁，本机出口的判定在短时间内发生了翻转。**结论：Bybit 可作"有时能用的第三备"，不能进 2 源降级链**（否则会出现"主备同时挂"）。这也是本报告推荐 Binance+OKX 而不是 Binance+Bybit 的直接证据。

---

### 2.4 Coinbase Exchange

```
GET https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60
→ 200  ACAO: *   access-control-expose-headers: cb-before, cb-after
```
```json
[[1792505700,83137.4,83266.89,83137.4,83220.27,52.85054968],[1792505640,82971.34,83151.98,...
```
- 合法 granularity：**60 / 300 / 900 / 3600 / 21600 / 86400**（1/15/120/7200 → 400）。
- **上限的坑**：
  - 不带 `start/end` → 默认返回 **350 根**（g=60 实测 350）；
  - 带 `start/end` → **严格 ≤300 根**，301 根直接 400：`"Count of aggregations requested exceeds 300"`。
- 历史：`BTC-USD` 最早 **2015-07-20**（2015-07-15 返回 `[]`）；1m/5m/1H 至少可到 **2016-01-01**（10 分钟窗口实测 11/3/1 根）。
- 字段 **`[time(秒), low, high, open, close, volume]`** —— low/high 在 open/close 之前，最易踩；**最新在前**，最后一根未收盘。
- 计价是 **USD**（不是 USDT），与其他所对比会有稳定微小的价差。

---

### 2.5 Kraken（有 CORS，但不能回补历史）

```
GET https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1
→ 200  ACAO: https://5777-wq.github.io
```
```json
{"error":[],"result":{"XXBTZUSD":[[1730246400,72661.0,72887.9,71400.0,72331.1,72180.5,1750.94496989,41109],...
```
- **721 根硬上限**（`interval=1` 时首根 2026-10-20 02:23、末根 14:23；`interval=1440` 时正好覆盖最近 721 天：2024-10-30 → 2026-10-20）。
- **`since` 基本是摆设（重要）**：`since=0`、`since=1367107200(2013)`、`since=1500000000(2017)`、`since=30 天前`、`since=2 天前` —— **实测全部返回同一个"最新 721 根"窗口**。也就是说**无法靠 since 往前翻页**，只能每次拿最近 720 根、靠长期轮询攒历史。
- 字段 **`[time(秒), open, high, low, close, vwap, volume, count]`**，**最旧在前（升序）**，`result.last` 是游标（比最后一根的 time 小 60 秒）。
- 外层 key 是 **`XXBTZUSD`**（请求写 `XBTUSD`，返回叫 `XXBTZUSD`），要遍历 `PSObject.Properties` 取第一个非 `last` 键。
- 限频：短时间多次调用**实测触发** `EGeneral:Too many requests`（4s 间隔连续 4 次也能触发），建议 ≥1–2s 且带退避。
- 无需 cookie（每次裸请求都成功；虽然会下发 `__cf_bm`）。

---

### 2.6 Bitget

```
GET https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=1min&limit=2
→ 200  ACAO: *
```
```json
{"code":"00000","msg":"success","requestTime":1792505764136,"data":[["1792499820000","81544.36","81561.64","81526.99","81526.99","1.335154","108877...
```
- **两个端点两套上限**：`candles` **1000**（1001 → `40053`）；`history-candles` **200**（201 → `40020 Parameter limit error`）。
- `history-candles` **必须带 `endTime`**（只给 `startTime` → `400172`）；`startTime+endTime` 可一起用。
- **日界陷阱（重点）**：`granularity=1day` 的 K 线起点是 **16:00 UTC（UTC+8 的 00:00）**；要标准 UTC 日线必须用 **`1Dutc`**。同理有 `6Hutc/12Hutc/3Dutc/1Wutc/1Mutc`。
- 字段 8 列 `[ts(ms), o, h, l, c, baseVol, quoteVol, quoteVol2]`，**最旧在前（升序）**，最新一根未收盘（`start+60s > now`）。
- 历史：1m 到 **2018-12-31 23:57**；2018-05 及更早返回空数组（`code:"00000"` 但仍要判空，它不报错）。

---

### 2.7 Gate.io

```
GET https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=1m&limit=2
→ 200  ACAO: *   X-Gate-RateLimit-Limit: 200
```
```json
[["1792505700","3746803.24324380","83205.3","83348.7","83205","83227.3","44.98963900","true"],["1792505760",...
```
- 粒度：10s/1m/5m/15m/30m/1h/4h/8h/1d/7d/30d；limit **1000** 硬上限（1001 → 400）。
- **字段顺序是最反直觉的**：`[ts(秒), 计价成交量, CLOSE, HIGH, LOW, OPEN, 基础成交量, closed(bool)]`。相邻两根满足 `high>close>open>low` 也能"看起来正常"，所以接错不会立刻报错，只会让 OHLC 错位。
- `closed` 字段：当前这根是 `false`、上一根是 `true`（实测）—— **Gate 是少数直接给"是否收盘"的交易所**。
- **历史窗口严格**：`from/to` 跨度最多 1000 点；且"最多只能取 10000 点之前"：
  - 1m：**~6.9 天**（6.9 天 OK、7 天 → `Candlestick too long ago. Maximum 10000 points ago are allowed`）
  - 1h：**~416 天**（416 天 OK、417 天 FAIL）
  - 1d：窗口翻页可到 **2015-12-14**
- 响应头 `X-Gate-RateLimit-Limit: 200 / Requests-Remain / Reset-Timestamp`（秒）。

---

### 2.8 MEXC（❌ 浏览器不可用）

```
GET https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2
→ 200  但响应头里 **没有** Access-Control-Allow-Origin（只有 Access-Control-Expose-Headers: x-cache）
OPTIONS 预检 → 403
```
```json
[[1792505700000,"83208.84","83312.71","83195.08","83195.08","3.40719844",1792505760000,"283732.56"],...
```
- **CORS 缺失 → 浏览器 fetch 必定被拦，零 key 直连方案直接排除。**
- interval：1m/5m/15m/30m/**60m**/4h/1d/**1W**/1M 可用；`1h`/`1w`/`2h`/`6h`/`12h` 全部 400。
- limit **500**（1000 → 静默 500）。
- **无法回溯历史**：`startTime`/`endTime` 实测被忽略，永远返回最新窗口。
- 字段 8 列 `[openTime,o,h,l,c,vol,closeTime,quoteVol]`（毫秒）。

---

### 2.9 KuCoin（❌ 浏览器不可用）

```
GET https://api.kucoin.com/api/v1/market/candles?type=1min&symbol=BTC-USDT
→ 200  但 **无 ACAO**（Vary: Origin 却从不回 ACAO）；OPTIONS 200 也不带 CORS 头
gw-ratelimit-limit: 2000   gw-ratelimit-remaining: 1997   gw-ratelimit-reset: 29999
```
```json
{"code":"200000","data":[["1792505760","83210.2","83143.6","83210.2","83143.6","1.66668649","138641.835133811"],...
```
- **不需要 cookie/Origin**（裸请求就 200，Set-Cookie 的 `__cf_bm` 不校验），但 **CORS 缺失，浏览器直连不可用**。这是"服务端能通、浏览器不能通"的典型，容易误判。
- 上限：默认 **100**；带 `startAt/endAt` 最多 **1500**（1501 静默截 1500）。
- 粒度：1min…1month 全支持。
- **字段 7 列 `[ts(秒), OPEN, CLOSE, HIGH, LOW, vol, turnover]`** —— o,c,h,l 顺序；**最新在前**。
- 历史：2018-01-01 起（2017 返回空数组）。

---

### 2.10 Bitstamp（可达性不稳定）

```
GET https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=2
→ 200  ACAO: *
```
```json
{"data": {"pair": "BTC/USD", "ohlc": [{"timestamp": "1792505700", "open": "83136.25", "high": "83250.22", ...
```
- step：60/180/300/900/1800/3600/7200/14400/21600/43200/86400/259200；limit **1000**。
- 历史 **2011-08-18**（最深的源）。
- **时间戳是字符串形式的秒**；字段也是字符串；**最旧在前**。
- ⚠️ **Lead 本机 403、我这边同期 200** —— 说明是边缘/WAF 波动，**不建议作为降级链主节点**。

---

### 2.11 Crypto.com（必须用 v1 路径）

```
GET https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=BTC_USDT&timeframe=1m&count=2
→ 200  ACAO: https://5777-wq.github.io （旧版 /v2/public/get-candlestick 无 ACAO！）
```
```json
{"id":-1,"method":"public/get-candlestick","code":0,"result":{"interval":"1m","data":[{"o":"82922.66","h":...
```
- **同一家两个端点 CORS 行为不同**：`/v2/public/...` **无 ACAO**，`/exchange/v1/public/...` **回显 ACAO** → 用 v1。
- **参数名是 `timeframe`**：传 `interval=1d` 会被**静默忽略**并永远返回 1m 数据（实测 9 个 interval 全返回同一批 1m 行）；用 `timeframe` 后粒度正常。
- count 上限 **300**（301/1000 静默 300）。
- 历史：1d/1m 到 **2021-01**（2020 及更早为空）。
- 字段对象 `{o,h,l,c,v,t}`，`t` **毫秒**；**最旧在前**（最新在数组末尾，取 `max(t)`）。
- `timeframe=1w` 返回 `t=0` 的脏数据，需过滤 `t<=0`。

---

### 2.12 HTX / 火币

```
GET https://api.huobi.pro/market/history/kline?symbol=btcusdt&period=1min&size=2
→ 200  ACAO: https://5777-wq.github.io
```
```json
{"ch":"market.btcusdt.kline.1min","status":"ok","ts":1792505772216,"data":[{"id":1792505760,"open":83182.91,"close":83103.85,...
```
- 粒度：1min/5min/15min/30min/60min/4hour/1day/1week/1mon/1year。
- size 上限 **2000**（2001 → `status:"error"` + `err-code:"invalid-parameter"`）。
- **只有最新 2000 根，`from` 参数被忽略**：1day 只能到 **2021-04-29**；1min 只能覆盖 ~33 小时。
- 字段 **`{id(秒), open, CLOSE, LOW, HIGH, amount, vol, count}`** —— **close 排在 high 前面**；`amount` 是基础币量、`vol` 是计价币量；**最新在前**。
- 备用域：`api.htx.com`、`api.hbdm.com` 实测同样 200 + ACAO 回显。

---

### 2.13 Deribit（衍生品，❌ 浏览器不可用）

```
GET https://www.deribit.com/api/v2/public/get_tradingview_chart_data
    ?instrument_name=BTC-PERPETUAL&start_timestamp=1792400000000&end_timestamp=1792500000000&resolution=1
→ 200  但 **无 ACAO**
```
```json
{"usOut":1792505937896117,"result":{"volume":[2.19106187,1.63981765,...],"ticks":[1792399980000,...],"status":"ok","open":[...],"low":[...],"high":[...],"cost":[...],"close":[...]}}
```
- **列式返回**（每个字段一个数组，按 index 对齐），不是行数组 —— 最容易接错。
- resolution：1/3/5/15/30/60/120/180/360/720/1D；**240 → 400**。
- **单次 ~5001 点上限，且截断方向是"保留窗口末尾"**：请求 2021-01-01→01-31 的 1m，返回 first=2021-01-**27 12:40**、last=01-31 00:00（即丢掉最早的，保留最新的 5001 根）→ **往前翻页要用 `end_timestamp` 游标**。
- 历史：BTC-PERPETUAL 1D 到 **2018-08-14**；1m 在 2018 返回空、2019 起有。
- 无限频头、无 CORS。

---

## 3. 聚合 / 第三方源

### 3.1 CoinGecko（能直连，但会 429，且不是真 K 线）

```
GET https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=1
→ 200  ACAO: *
```
```json
[[1792420200000,82065.0,82156.0,81745.0,82017.0],[1792422000000,82035.0,82334.0,81841.0,82202.0],...
```

| days | OHLC 根数 | 粒度 |
|---|---|---|
| 1 | 48 | **30 分钟** |
| 7 | 42 | **4 小时** |
| 30 | 180 | **4 小时** |
| 90 | 23 | **4 天** |

`market_chart`（分时/折线，不是 K 线）：
```
GET https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1
→ {"prices":[[1792420800000,81864.27366994596],[1792421100000,81934.54048270905],...
```
- `days=1` → **5 分钟**一个点（289 点）；`days=2..30` → **1 小时**一个点（2d=49、7d=169、30d=721）。
- **限频是硬伤**：我连续请求 8 次左右就开始 429（`{"status":{"error_code":429,...}}`，且 429 响应**不带 ACAO**），冷却 65 秒才恢复；`days=180/365/max` 本次全部没拿到。免费 30 req/min 对"每 10 秒轮询多个币"的前端一定会打爆。
- 定位：**只能做兜底展示，不做主源**（没有 volume、粒度不可控、是聚合价）。

### 3.2 CoinPaprika（免费档只剩 2 天）

```
GET https://api.coinpaprika.com/v1/coins/btc-bitcoin/ohlcv/today
→ 200  ACAO: *   ratelimit-limit: 20000
```
```json
[{"time_open":"2026-10-20T00:00:00Z","time_close":"2026-10-20T14:19:00Z","open":81850.10910516238,"high":83155...
```
- `/ohlcv/today` 只有当天 1 根、`/ohlcv/latest` 只有昨天 1 根。
- `/ohlcv/historical?start=...&end=...` → **402**：`Getting historical OHLCV data before <yesterday> is not allowed in this plan`（2011/2013/2017/2021 全试过）。
- 时间是 **ISO 字符串**。→ 只能做"今日涨跌"角标，不能做 K 线。

### 3.3 CryptoCompare（❌ 零 key 已死）

```
GET https://min-api.cryptocompare.com/data/v2/histominute?fsym=BTC&tsym=USD&limit=2
→ 401  {"Data":{},"Err":{"type":2,"message":"API key required, please refer to the documentation at https://developers.coindesk.com/"}}
```
`histoday` / `price` 同样 401。**确认现在强制 key，从零 key 清单剔除。**

### 3.4 Alpaca（第三方聚合，非交易所 —— 推荐作为「对账源」）

```
GET https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=1Min&limit=3
→ 200  ACAO: *   X-Ratelimit-Limit: 200
```
```json
{"bars":{"BTC/USD":[{"c":81831.5,"h":81908.95,"l":81831.5,"n":0,"o":81843.352,"t":"2026-10-20T00:00:00Z","v":0,"vw":81870.225},...
```
- **零 key 可用**（crypto 数据免鉴权，无需 `APCA-API-KEY-ID`）。
- timeframe：**1Min / 5Min / 15Min / 1Hour / 1Day**；limit 最大 **10000**（10001 → 400 `larger than the allowed maximum of 10000`）。
- 历史 **2021-01-01 起**（1Min 首根 `2021-01-01T06:00:00Z`，2020-12-31 为空）。
- **时间戳是 ISO8601 字符串**、对象式 `{t,o,h,l,c,v,n,vw}`、按 symbol 分组 `bars["BTC/USD"]`、**volume 可能为 0**（聚合口径，实测 1Min 的 `v=0`）。
- 分页：响应带 `next_page_token`，追加 `&page_token=`（实测第 2 页继续往下）。
- **价值**：它与交易所自有 K 线来自不同数据管线，**用来对账/校验插针最合适**——某交易所出现长影线、跳空、单根异常时，拿 Alpaca 同分钟 bar 一比就能判定是交易所个案还是全市场。

### 3.5 Binance 归档包（回补长历史的正解）

见 §2.1 后半。要点：
- 路径模板 `https://data.binance.vision/data/spot/{daily|monthly}/klines/{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{YYYY-MM-DD|YYYY-MM}.zip`
- 免费、无 key、GET 也带 `ACAO: *`、CloudFront 分发（`x-amz-cf-pop: HKG54-P2`，本机下载很快）。
- 每日 1m ≈ 69KB / 每月 1m ≈ 2MB / 每月 1s 可达 114MB。
- CSV **无表头**、12 列、毫秒，与 API 返回逐字段一致 → 前端/离线脚本可复用同一套解析器。

---

## 4. 接入规范：四个必查项（按踩坑频率排序）

### 4.1 时间戳单位（秒 vs 毫秒）—— 错一位 = 差 50 年

| 单位 | 源 |
|---|---|
| **毫秒 (ms)** | Binance、OKX、Bybit、Bitget、MEXC、Crypto.com(v1 `t`)、Deribit(`ticks`)、CoinGecko、Binance 归档 CSV |
| **秒 (s)** | Coinbase、Kraken、Gate、KuCoin、HTX、Bitstamp |
| **ISO 字符串** | Alpaca(`t`)、CoinPaprika(`time_open`/`time_close`) |

判据：`ts > 1e12` → 毫秒；`ts < 1e11` → 秒；字符串里有 `T`/`Z` → 直接 `Date.parse`。
（1e12 ms ≈ 2001-09；1e10 s ≈ 2286 年，两区间不重叠，判断安全。）

### 4.2 字段顺序（本报告最容易踩雷的一节）

| 源 | 行/对象结构（下标从 0 起） | 备注 |
|---|---|---|
| Binance | `[0]openTime(ms) [1]o [2]h [3]l [4]c [5]vol [6]closeTime(ms) [7]quoteVol [8]trades [9]takerBuyBase [10]takerBuyQuote [11]ignore` | 12 列，数字为字符串 |
| OKX | `[0]ts(ms) [1]o [2]h [3]l [4]c [5]vol [6]volCcy [7]volCcyQuote [8]confirm` | 降序 |
| Bybit | `[0]start(ms) [1]o [2]h [3]l [4]c [5]vol [6]turnover` | 降序 |
| Coinbase | `[0]t(s) [1]LOW [2]HIGH [3]OPEN [4]CLOSE [5]vol` | ⚠️ 低高在前 |
| Kraken | `[0]t(s) [1]o [2]h [3]l [4]c [5]vwap [6]vol [7]count` | ⚠️ idx5 是 vwap |
| Bitget | `[0]ts(ms) [1]o [2]h [3]l [4]c [5]baseVol [6]quoteVol [7]quoteVol2` | 升序 |
| Gate | `[0]t(s) [1]quoteVol [2]CLOSE [3]HIGH [4]LOW [5]OPEN [6]baseVol [7]closed` | ⚠️ C,H,L,O |
| MEXC | `[0]open(ms) [1]o [2]h [3]l [4]c [5]vol [6]close(ms) [7]quoteVol` | — |
| KuCoin | `[0]t(s) [1]OPEN [2]CLOSE [3]HIGH [4]LOW [5]vol [6]turnover` | ⚠️ O,C,H,L |
| HTX | `{id(s), open, CLOSE, LOW, HIGH, amount, vol, count}` | ⚠️ c 在 h 前；amount=基础量 |
| Bitstamp | `{timestamp(s,str), open, high, low, close, volume}` | 全字符串 |
| Crypto.com v1 | `{o,h,l,c,v,t(ms)}` | — |
| Deribit | **列式** `ticks[] open[] high[] low[] close[] volume[]` | ⚠️ 非行数组 |
| CoinGecko | `[0]ts(ms) [1]o [2]h [3]l [4]c` | 无 volume |
| Alpaca | `{t(ISO),o,h,l,c,v,n,vw}` | 按 symbol 分组 |

**建议**：所有源统一转成一个内部结构 `{ t: <ms>, o, h, l, c, v }`，转换表写死在上表顺序，不要"看名字猜"。

**字段顺序可以自动自检（本次用来验证上表的办法）**：对每根 K 线断言

```
high >= max(open, close)  &&  low <= min(open, close)  &&  high >= low
```

本次对 20–350 根真实数据跑了一遍，结果：

| 源 | 按上表顺序 | 若按"天真的 [t,o,h,l,c]" 解析 |
|---|---|---|
| Binance | 20/20 通过 | — |
| OKX | 20/20 通过 | — |
| Coinbase `[t,l,h,o,c,v]` | **350/350 通过** | **43/350**（307 根违反 high≥open 等） |
| Coinbase 若 close 取 idx5(volume) | 0/350 通过 | — |
| Kraken `[t,o,h,l,c,vwap,v,count]` | 721/721 通过 | — |
| Bitget | 20/20 通过 | — |
| Gate `[t,quoteVol,c,h,l,o,baseVol,closed]` | **20/20 通过** | **0/20**（成交量当 open，离谱） |
| KuCoin `[t,o,c,h,l,v,turnover]` | **100/100 通过** | **0/100** |
| MEXC | 20/20 通过 | — |
| HTX `{id,o,close,low,high,...}` | 20/20 通过 | — |

**结论：这个断言应该做成接入层的单元测试**——只要上错一个下标，绝大多数行会立刻违反价格关系。唯一骗过它的是 Kraken（vwap 恰好在 close 之后且数值接近），所以 Kraken 必须靠"idx5 是 vwap、idx6 才是 volume"的显式注释来保证。

> 注意：该断言只对大样本成立（单根可能恰好 o=h=l=c）。接入测试请至少跑 20 根。

### 4.3 最新一根是否闭合（必须丢弃）

所有交易所端点的最后一根都是**正在滚动、随时会变**的。三种判断方式：

| 判断方式 | 适用源 |
|---|---|
| `closeTime > now` | Binance（`[6]`）、MEXC（`[6]`） |
| 显式 `confirm` / `closed` 字段 | **OKX** `[8]==0`、**Gate** `[7]==false` |
| `openTime + intervalMs > now` | Bybit、Coinbase、Kraken、Bitget、KuCoin、HTX、Deribit、Alpaca、Crypto.com |

**实测证据**：Binance 1m 最后一根 `openTime=1792506900000, closeTime=1792506959999`，当时 `now=1792506906532` → `closeTime - now = +53467ms`，即 **closeTime 在未来 53 秒**，这根还在长。前端每 10 秒轮询时，若把最后一根画进图，会看到它反复伸缩、high/low 不断被刷新（"会变形的最后一根"）。

**推荐做法**：`const closed = bars.filter(b => b.closeTime <= Date.now())`，图表的最后一根始终用上一根已闭合的；实时价单独用 ticker 接口画一条水平线/闪烁数字，不要混进 K 线序列。

> **给前端的硬性约定（Lead 2026-10-20 22:19 实测确认）**
> 1. 任何 K 线响应，**必须丢弃 `closeTime > now` 的那一根**（Binance/MEXC 有 closeTime 字段），或丢弃"`openTime + interval > now`"的最后一根（没有 closeTime 的源）。
> 2. 判 `now` 用什么时钟？**用服务端时间**（Binance `GET /api/v3/time`、Bybit `/v5/market/time`、OKX `/api/v5/public/time`、Coinbase `/time`、Kraken `/0/public/Time`），别用浏览器本地钟——用户改系统时间会让最后一根直接判错。
> 3. 每 10 秒轮询时，**已闭合的 K 线用"按 openTime upsert"而不是 append**：服务端偶尔会修正刚闭合那根（补成交），upsert 才能自愈；append 会留下重复/错位的 bar。
> 4. 图表渲染层再加一道保险：`如果最后一根的 close 在两次轮询间变化超过 X%，先标记为"pending"并半透明渲染`，比直接画实线更不容易让人误读。

### 4.4 单次上限（都是"静默截断"，不会报错）

| 源 | 上限 | 超限行为 |
|---|---|---|
| Binance | 1000 | **静默返回 1000** |
| Bybit | 1000 | 静默 1000 |
| Bitget | 1000 / 历史 200 | 近期 1001 → 报错；历史 201 → 报错 |
| OKX | 300 | 静默 300 |
| Coinbase | 300（带 start/end）/ 350（默认） | >300 根 → **400** |
| Gate | 1000 | 1001 → **400** |
| MEXC | 500 | 静默 500 |
| KuCoin | 100 / 1500 | 静默 1500 |
| HTX | 2000 | 2001 → error |
| Deribit | ~5001 | 静默截断**保留窗口末尾** |
| Alpaca | 10000 | 10001 → 400 |
| Kraken | 721 | 无法突破 |

**通用做法**：请求时按"上限 × 0.9"设页大小，并**校验返回条数**——若返回条数 == 上限，说明可能还有下一页；若返回条数被截断（如要 1500 拿到 1000），说明服务端静默截断，需按起点重新分段。

### 4.5 限频汇总

| 源 | 限频（实测/口径） | 建议前端策略 |
|---|---|---|
| Binance | 6000 weight/min，klines 2/次 → **理论 3000 次/分钟** | 每币每 10s 一次远不到限；可放心轮询 |
| OKX | 无响应头；60 连发全 200 | 保守按 10 次/秒以内 |
| Bybit | 无响应头；未压测 | 保守 10 次/秒以内 |
| Coinbase | 无响应头；20 连发全 200 | 保守 5 次/秒以内 |
| Kraken | **实测会 429** | **≥1–2s 间隔 + 指数退避** |
| Gate | 响应头 `X-Gate-RateLimit-Limit: 200` | 按 200/窗口留 20% 余量 |
| KuCoin | 响应头 2000/窗口 | （本就用不了） |
| Bitstamp | 无头 | 保守 5 次/秒 |
| Crypto.com | 无头 | 保守 5 次/秒 |
| HTX | 无头 | 保守 5 次/秒 |
| CoinGecko | **30/min，实测 8 连发即 429** | **不要轮询**；只在页面首次加载拉一次并缓存 60s+ |
| Alpaca | 响应头 200/min | 够用；分页时留间隔 |
| 归档包 | 无 | 下载任务串行 + 本地缓存 |

---

## 5. 降级链推荐（只选 2 个源）

### 结论：**Binance `data-api.binance.vision`（主） → OKX `www.okx.com`（备）**

| 维度 | Binance vision | OKX | 判定 |
|---|---|---|---|
| 本机可达性证据 | `GET /api/v3/ping` **200**；klines 200；ACAO=`*` | `GET /api/v5/market/candles` **200**；ACAO=`https://5777-wq.github.io`（回显） | 两者都实测可直连 ✅ |
| 零 key | 公开行情免 key（`/api/v3/account` 才要签名） | 公开行情免 key | ✅ |
| 粒度覆盖 | **1s**+全档 | 1s+全档 | 并列 |
| 单次条数 | **1000** | 300 | Binance 更省请求 |
| 历史深度 | **2017-08-17** | 1D 2017-10 / 1m 2018-01 | Binance 更深 |
| 时间戳 | 毫秒 | 毫秒 | 一致，**无需写两套单位转换** |
| 闭合判断 | `closeTime > now` | **`confirm` 字段** | OKX 更省事（但仍要 drop 未闭合） |
| 回补能力 | **zip/csv 归档包**（2017 起全周期） | 只能 API 翻页（300/页） | Binance 完胜 |
| 限频 | 6000 weight/min（klines 2/次） | 无头、60 连发通 | 都够用 |
| 风险 | 国内可能 451/被墙（**必须用 vision 域**） | 单一区域（`x-routed-to: TKY`） | 两者互补 |

**本机可达性证据矩阵（同一台机器、同一组请求头）**

| 候选 | 实测状态码 | ACAO | 判定 |
|---|---|---|---|
| Binance `data-api.binance.vision` | 200 | `*` | ✅ 主源 |
| Binance `api.binance.com` / `api1/2/3/4` | 200 | `*` | ✅ 备用域名（国内可能 451，本机未复现） |
| OKX `www.okx.com` | 200 | 回显 `https://5777-wq.github.io` | ✅ 备源 |
| Coinbase `api.exchange.coinbase.com` | 200 | `*` | ⭕ 可直连但字段/上限成本高 |
| Alpaca `data.alpaca.markets` | 200 | `*` | ⭕ 对账源 |
| Gate / Bitget / HTX / Bitstamp / CoinPaprika | 200 | `*` 或回显 | ⭕ 限制多 |
| Crypto.com **v1** | 200 | 回显 | ⭕ 需用 v1 路径 |
| Kraken | 200（偶发 429） | 回显 | ⚠️ 只能取最近 721 根 |
| **Bybit** | 早 200 → 晚 **403** | 早回显 → 晚**无** | ❌ 不可承诺 |
| MEXC | 200 | **无** | ❌ CORS |
| KuCoin | 200 | **无**（OPTIONS 也无） | ❌ CORS |
| Deribit | 200 | **无** | ❌ CORS |
| Crypto.com **v2** | 200 | **无** | ❌ CORS |
| CryptoCompare | **401** | 无 | ❌ 强制 key |

**为什么是这两个：**
1. **本机网络证据最硬**：两个域都在同一台机器、同一组请求头（含 `Origin: https://5777-wq.github.io`）下返回 200 且 CORS 通过；Binance 给 `*`、OKX 回显 Origin，都满足"浏览器直连"。
2. **时间戳单位一致（都是毫秒）**：降级切换时不需要改时间轴代码，这是最少改动的组合。若选 Coinbase/Kraken/Gate/KuCoin（秒），切换瞬间时间轴会错 1000 倍。
3. **覆盖了两种失败模式**：Binance 是 Cloudflare/AWS 多域 + 官方行情专域，OKX 是 Cloudflare 香港出口；两者基础设施、运营方、地区不重叠，同时挂的概率低。
4. **OKX 的 `confirm` 字段是天然的"闭合校验器"**：当 Binance 的 `closeTime` 判断出现边界问题（时钟偏差）时，可以用 OKX 同分钟的 `confirm=1` 反向确认最后一根是否真的收完。
5. **深度与体量互补**：日常增量走 Binance（1000 根/次、2 weight），第一次冷启动/长历史用 Binance 归档包补齐；OKX 作为故障时的连续备用（300 根/次，10 分钟图够用 50 小时）。

**不选其他源的理由：**
- **KuCoin / MEXC / Deribit / Crypto.com v2**：本机无 ACAO → 浏览器直连直接失败（这是硬性排除，不是偏好问题）。
- **Bybit**：功能上很合适（1000 根、毫秒、spot/linear 都有），但**同一台机器半小时内从 200 + ACAO 回显变成 403 `CloudFront ... block access from your country`**，且 403 时连 ACAO 都没有。按"降级链必须比主源更稳"的原则，不能选它。
- **Kraken**：有 CORS 但 `since` 无效、只能拿最新 721 根，且**实测 429**，只能当"最近行情"第三备。
- **Coinbase**：CORS `*`、历史很深，但**秒级时间戳 + `[t,low,high,open,close]` 字段顺序 + 300 根硬上限**，接入成本明显高于收益（除非要 USD 计价对账）。
- **Gate / Bitget / HTX**：都有 CORS，但分别受"1m 只能到 7 天前"、"日界是 UTC+8"、"只能拿最新 2000 根"限制，不适合做冷启动。
- **CoinGecko**：聚合价 + 30/min + 实测极易 429，只能做兜底展示。
- **Bitstamp**：历史最深（2011），但**本机可达性不稳定**（Lead 403 / 我 200），不能承诺可用性。

**关于第 3 个"非交易所"源（强烈建议但不算进 2 源降级链）：Alpaca**
- `data.alpaca.markets/v1beta3/crypto/us/bars` 实测 **ACAO=`*`、零 key、200/min**，支持 1Min/5Min/1Hour，回溯到 **2021-01-01**。
- 它不参与主链路，但**作为对账源价值很高**：交易所自己的 K 线可能因撮合异常/闪崩出现长影线，Alpaca 是跨交易所聚合口径，两者同分钟 bar 一比对，就能区分"某所插针"与"全市场真实波动"。
- 代价：**ISO 字符串时间戳**（要额外 `Date.parse`）、**volume 可能为 0**、历史只到 2021。建议做成"仅在检测到异常 K 线时才去核对"的旁路，不要放进每 10 秒的轮询。

---

## 6. 未测 / 本机不可达清单（如实记录）

| 项 | 状态 |
|---|---|
| Binance 国内 451 / 被墙 | **未测**（本机出口在境外，实测 200 无 451；只能标注为"已知风险"） |
| Binance `interval=1s` 的完整早期质量 | **部分测**：接口能吐 2017-08-17 起的数据，但早期大量 0 成交填充行；未逐日验证何时开始"秒秒有成交" |
| OKX 官方限频 20次/2s | **未验证**（实测 60 连发未触发；响应无 ratelimit 头） |
| Bybit / Coinbase / Gate / HTX / Crypto.com / Bitstamp / Alpaca 的精确限频阈值 | **未压测**（只记录响应头或"未触发"） |
| CoinGecko `days=180/365/max` | **未取得**（本次持续 429） |
| CoinGecko 精确 429 阈值 | 观察到"约 8 连发后 429"，**未精确定位** |
| Kraken `since` 能否借"分页"突破 721 | **已证伪**（多种 since 均返回同一最新窗口） |
| Gate 1m 精确历史地板 | 二分到"6.9 天 OK / 7 天 FAIL"，**未精确到分钟** |
| MEXC / KuCoin 是否存在其他带 CORS 的备用域 | **未测**（`www.mexc.com` 403；KuCoin 只测了 `api.kucoin.com`） |
| Poloniex / Bitfinex / CoinEx / cryptowat.ch | **未测**（Lead 侧结论：Poloniex/Bitfinex 无 ACAO、CoinEx 503、cryptowat.ch 连接被重置；本次未复测） |
| Bitstamp 403 的触发条件 | **未复现**（我这边 200；Lead 侧 403） |
| Bybit 403 的国家判定规则 | **未测**（只观测到"200 → 403"翻转与 CloudFront 国家封锁文案，未确定触发边界，可能与出口 IP 漂移有关） |

---

## 7. 附：本次实测的原始请求清单（可复跑）

```bash
# Binance
curl -s -H "Origin: https://5777-wq.github.io" -D- \
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000" | head -c 200
curl -s -H "Origin: https://5777-wq.github.io" \
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=0&limit=1"

# OKX
curl -s -H "Origin: https://5777-wq.github.io" -D- \
  "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1m&limit=2" | head -c 200
curl -s -H "Origin: https://5777-wq.github.io" \
  "https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1D&limit=100&after=1520000000000"

# Bybit
curl -s -H "Origin: https://5777-wq.github.io" \
  "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=3"

# Coinbase
curl -s -H "Origin: https://5777-wq.github.io" \
  "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60"

# Kraken
curl -s -H "Origin: https://5777-wq.github.io" \
  "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1"

# Gate / Bitget / HTX / Bitstamp / Crypto.com(v1) / Alpaca
curl -s -H "Origin: https://5777-wq.github.io" "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=1m&limit=2"
curl -s -H "Origin: https://5777-wq.github.io" "https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=1min&limit=2"
curl -s -H "Origin: https://5777-wq.github.io" "https://api.huobi.pro/market/history/kline?symbol=btcusdt&period=1min&size=2"
curl -s -H "Origin: https://5777-wq.github.io" "https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=60&limit=2"
curl -s -H "Origin: https://5777-wq.github.io" "https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=BTC_USDT&timeframe=1m&count=2"
curl -s -H "Origin: https://5777-wq.github.io" "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=1Min&limit=3"

# 历史包
curl -sI "https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01-01.zip"
```

> 复跑提示：Kraken 与 CoinGecko 会限频，脚本里务必加 `sleep`；其余源可并发。