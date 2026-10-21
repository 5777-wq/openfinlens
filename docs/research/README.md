# 免费行情 API 调研（分时 / 分钟 K 线）· 2026-10-20 实测

> 本目录所有结论来自**真实请求实测**（PowerShell `Invoke-WebRequest`，带浏览器 UA + `Origin: https://5777-wq.github.io`，以观察对方是否回显 CORS 头），不是凭记忆整理的清单。
> 实测时间：**2026-10-20 22:10 ~ 23:25（UTC+8）**，实测机出口 IP `64.118.152.87`（经代理，**非中国大陆住宅网络**）。
> 与项目铁律的关系：本仓库前端**零 API key**、浏览器直连，所以本报告把「**浏览器能不能直接 fetch**」放在第一位，把「数据全不全」放在第二位。

---

## 0. 一分钟结论（先看这个）

**结论一：真正卡住你的不是"有没有免费 API"，而是 CORS。**
绝大多数免费源（Yahoo、Nasdaq、新浪、雪球…）数据都能取到，但响应头里**没有 `Access-Control-Allow-Origin`**，浏览器里的 `fetch()` 会被同源策略拦掉。所以「TradingView 之外有哪些网站支持免费 API」这个问法要拆成两问：
- **哪家数据能免费拿到** → 一大堆（见 §2）；
- **哪家能让你的纯静态前端零 key 直连** → **只有 5 类**：腾讯 `gtimg`、东财 `push2his`、同花顺 `10jqka`、加密交易所（Binance/OKX/Kraken/Gate/Bitget…，**Bybit 已被区域封锁**）、以及带 CORS 的少量聚合源（CoinPaprika、Alpaca crypto、Frankfurter）。

**结论二：你的项目已经有 3 个直连源，其中 1 个是宝藏。**
- 腾讯 `web.ifzq.gtimg.cn`（分时）与 `ifzq.gtimg.cn`（分钟K）→ 已有，`ACAO: *`，稳定；
- 东财 `push2his`（K线 + trends2 分时）→ 已有，回显任意 Origin，但**有 IP 级 WAF 封禁**（本次实测亲手复现）；
- **同花顺 `d.10jqka.com.cn` → 尚未接入，`ACAO: *`，分时带均价线 + 盘后固定价 + 1/5/15/30/60 分钟K，是目前找到的性价比最高的补充源**（§2.3）。它也覆盖港股/美股/指数，**港股前缀是 `hk_HK0700`**（已复验，见 §2.3）。

**结论三：美股分钟 K 线在"零 key + 纯前端"约束下无解，必须做取舍。**
Yahoo / Nasdaq 都有美股分钟数据，但**都没有 CORS**（`OPTIONS` 预检也不回 `Access-Control-Allow-Methods`），浏览器直连是不可能的。三条出路：① 自建 Cloudflare Worker 代理（仓库已有 `worker.js`，加 2 个域名即可）；② 引入免费 key 源（Twelve Data / Alpha Vantage，但违反"前端零 key"铁律）；③ 美股只用日 K（腾讯/东财都有）。

**结论四：TradingView 本身没有公开免费 API。**
它的 `scanner.tradingview.com/scan`（行情快照）实测可用且**有 CORS**，但那是筛选器快照、不是历史 K 线；历史 K 线走的是需要登录 cookie 的 `widgetdata`/UDF 端点，未授权抓取违反其 ToS。**能用的是它的"图表组件"（免费嵌入，数据由 TV 自己拉，你拿不到数据）**，不是 API。

**结论五：任何免费源的"可用性"都有保质期，本次实测过程中就现场反转了一次。**
Bybit 同一台机器：22:21 还是 `200 + ACAO 回显`，22:53 变成 `403 CloudFront ... block access from your country`（且 ACAO 消失）；东财则是"连续 19 个长历史请求后封 IP **60 分钟以上**（22:16 封到 23:20 仍未恢复）"。**所以选型的判断标准不是"这个源现在能不能用"，而是"它挂了以后我多久能发现、能不能立刻换掉"**——降级链和熔断比选源本身更重要。


## 1. 三档分类：能不能浏览器直连

先定义清楚三种粒度，很多文章把它们混为一谈，接错会白干一天：

| 名称 | 含义 | 典型形态 | 本项目用途 |
|---|---|---|---|
| **分时线**（time-share） | 当日逐分钟"价格 + 成交量"，**常带均价线**、昨收基准线 | `腾讯 minute/query`、`同花顺 v6/time`、`东财 trends2` | 分时图（面积线 + 成交量副图） |
| **分钟 K 线**（intraday OHLC） | 1/5/15/30/60 分钟的 **开高低收** | `腾讯 kline/mkline`、`东财 klt=1/5/15/30/60`、交易所 `klines` | 分钟级 K 线图、MA、技术指标 |
| **日/周/月 K** | 长历史 OHLC | `腾讯 fqkline`、`东财 klt=101/102/103`、`同花顺 01/11/21` | 长历史对比、回测 |

> 注意：**分时 ≠ 1 分钟 K**。分时没有 OHLC（只有一个价），也没有跨日历史；1 分钟 K 有 OHLC 且可回溯。做技术指标（MACD/BOLL）必须用分钟 K，做"今日走势"用分时更轻（一条线 + 量）。

### 1.1 可直接用（响应带 ACAO，浏览器 `fetch` 可直连）

| 源 | 市场 | 粒度 | 备注 |
|---|---|---|---|
| 腾讯 `qt.gtimg.cn` / `web.ifzq.gtimg.cn` / `ifzq.gtimg.cn` | A股/港股/美股/指数 | 分时 + 7 档分钟K + 日周月 | `ACAO: *`（OPTIONS 也 200）；**港股分时可用、美股分时返回空**（见 §2.1） |
| 东财 `push2his.eastmoney.com` | A股/港股/美股/指数/期货/外汇 | 分时(trends2) + 1/5/15/30/60/日/周/月 | **回显任意 Origin**（`ACAO: <你的 Origin>`）；有 IP 级 WAF 封禁 |
| **同花顺 `d.10jqka.com.cn`** | A股 + 指数（美股 `usa_` 前缀也有） | **分时(含均价线) + 1/5/15/30/60/日/周/月/年** | `ACAO: *`；JSONP 需剥壳；**港股 `hk_HK0700`、美股 `usa_`**（§2.3） |
| Binance `data-api.binance.vision` | 加密 | 1s~1M 全档 K | `ACAO: *`，limit 1000，最早 2017-08-17 |
| OKX `www.okx.com` | 加密 | 1m~1M | 回显 Origin；`history-candles` 可回溯更早 |
| ~~Bybit `api.bybit.com`~~ | 加密 | 1m~1M | **⚠️ 已实测被区域封锁**（403 `CloudFront ... block access from your country`，且无 ACAO），**不要放进直连清单** |
| Kraken `api.kraken.com` | 加密 | 1m~1D | 回显 Origin；**单次固定回 720 根** |
| Gate.io `api.gateio.ws` | 加密 | 10s~1M | `ACAO: *` |
| Bitget `api.bitget.com` | 加密 | 1m~1M | `ACAO: *` |
| Coinbase Exchange `api.exchange.coinbase.com` | 加密 | 1m/5m/15m/1h/6h/1d | `ACAO: *`，**单次最多 300 根** |
| CoinPaprika `api.coinpaprika.com` | 加密 | 当日 OHLCV | `ACAO: *`，聚合源，粒度粗 |
| **Alpaca** `data.alpaca.markets/v1beta3/crypto/us/bars` | 加密 | 1Min/5Min/1Hour | **无需 key**、`ACAO: *`，可传 `start` 回溯 |
| Frankfurter `api.frankfurter.dev` | 外汇 | 仅日线 | `ACAO: *`，**无分钟/分时** |
| TradingView `scanner.tradingview.com/scan` | 全球 | 仅实时快照 | `ACAO` 回显 Origin，**无 K 线** |

### 1.2 数据能拿、但浏览器直连不了（无 ACAO / 需 Referer）→ 必须走代理

| 源 | 市场 | 粒度 | 为什么不行 | 出路 |
|---|---|---|---|---|
| Yahoo `query1.finance.yahoo.com/v8/finance/chart` | 美股/全球/港股/外汇 | 1m~1mo 全档 | **无 ACAO**（`Vary: Origin` 但不回），OPTIONS 预检不回 `Allow-Methods` | Worker 代理（推荐）/ 或 key 源 |
| Nasdaq `api.nasdaq.com/api/quote/.../chart` | 美股 | 当日 1 分钟折线 | **无 ACAO** | Worker 代理 |
| 新浪 `hq.sinajs.cn` | A股/港股/美股指数 | 快照 | 无 Referer 403；**带站点 Referer 也 403**；且无 ACAO | Worker 补 Referer（`worker.js` 已支持） |
| 新浪 `quotes.sina.cn/.../getKLineData` | A股 | 1/5/15/30/60 分钟K | **无需 Referer 就 200**，但**无 ACAO** | Worker 代理；一次 1023 根 |
| 雪球 `stock.xueqiu.com/v5/stock/chart/*` | A股/港股/美股 | 分时 + 分钟K | 无 cookie 直接 **400**（`error_code=400016`）；**带上首页 `acw_tc` cookie 仍是 400**；首页挂阿里云 WAF | 不可靠，不建议 |
| 深交所 `www.szse.cn/api/market/ssjjhq/*` | A股 | 分时/K线 | HTTP 和 HTTPS 都 200 但**无 ACAO** | Worker 代理 |
| 上交所 `yunhq.sse.com.cn:32041` | A股指数 | 分时 | 无 ACAO，且**只有 HTTP:32041**（HTTPS 页面会混合内容拦截）；分时可用、K线 503 | Worker 代理，且需注意混合内容 |
| 中金所 `cffex.com.cn` / 上期所 `shfe.com.cn` | 股指/商品期货 | 日线/分钟 | 200 但**无 ACAO**；大商所/郑商所返回 **412 阿里云 WAF 挑战页** | Worker 代理 |
| 新浪期货/外汇 JSONP | 期货/外汇 | 分钟 | 200 且免 Referer，但**无 ACAO** | Worker 代理 |
| Stooq `stooq.com/q/d/l/` | 全球 | 5m/60m/日 | **本机被反爬**（返回 796 字节 JS 挑战页，HTTP 200 假成功） | 不建议 |
| Tiingo / EODHD | 美股 | 分钟K | 即使有 key **也无 ACAO** | 只能服务端用 |
| KuCoin / MEXC / Poloniex / Bitfinex / Crypto.com / Deribit | 加密 | K线 | **无 ACAO** | 必须代理，否则别选 |

### 1.3 需要 key（免费额度）——技术上可直连，但违反项目铁律

带 `Origin` 实测：**这些源在 401 报错时也带着 `ACAO: *`**，说明"只要给 key 就能在浏览器里跑"。

| 源 | 免费额度 | 粒度 | 免费额度的真实限制（实测） |
|---|---|---|---|
| **Twelve Data** | 800 次/日、8 次/分 | 1min~1day | `apikey=demo` 是**共享 demo，只对 AAPL 生效**（MSFT/0700 → 401）；`outputsize=5000` 一次能拉 5000 根 1min（631 KB）；`/api_usage` 显示 `plan_limit=2584` |
| **Alpha Vantage** | **25 次/日** | 1/5/15/30/60min | demo key 对 IBM/MSFT 可用；无 key 时**返回 200 + 提示语**（假成功，必须判 body） |
| Financial Modeling Prep | 250 次/日 | 1/5/15/30min | demo key **已废弃**（401） |
| Polygon.io | 5 次/分 | 1/5/15/30/60min | 免费档 **15 分钟延迟**；demo key 401 |
| Finnhub | 60 次/分 | 1/5/15/30/60min | `/stock/candle` **已转为付费**，无 key 401 |
| Marketstack | 100 次/**月** | 仅 EOD | 无分钟数据，不适合本项目 |
| MarketData.app | demo token 可用 | 1/5/15min | **HTTP 203**（不是 200！）且只回 1 根，演示性质 |
| Tiingo | 500 次/日 | IEX intraday | **无 ACAO**，前端直连不了 |
| EODHD | 20 次/日 | 1m/5m/1h | **无 ACAO**，前端直连不了 |
| IEX Cloud | — | — | **已关停/不可达** |

---

## 2. A 股 / 港股 / 期货 / 外汇：三个直连源的横向对比

| 能力 | 腾讯 gtimg | 东财 push2his | **同花顺 10jqka** |
|---|---|---|---|
| 分时（逐分钟） | ✅ `minute/query`，267 点 | ✅ `trends2`（`ndays=1..5`） | ✅ `v6/time`，**268 点含盘后固定价** |
| 分时带均价线 | ❌（只有价+量+额） | ✅（f58 均价） | ✅（第 4 列就是均价） |
| 1 分钟 K | ✅ `mkline` m1，**800 根封顶**（>800 静默掉回 320） | ✅ `klt=1`，最深 6024 根 | ✅ `61`，**最近约 2 个月**（8676 根） |
| 5/15/30/60 分钟 K | ✅ **800 根封顶**（约 50 个交易日） | ✅ 深度最好，但分钟线只回最近约 1 个月 | ✅ `31/41/51`，5min 约 1 年（按年分页） |
| 日/周/月 K | ✅ `fqkline`，A股周线到 2003 | ✅ 到 2006，**后复权必须 fqt=2** | ✅ `01/11/21`，A股日线到 2001-08-27（茅台 6024 根） |
| CORS | `ACAO: *` | 回显任意 Origin | `ACAO: *` |
| 港股 | ✅ 分时可用 | ✅ trends2 可用 | ✅ **前缀是 `hk_HK0700`**（不是 `hk_00700`/`hk00700`，我已复验） |
| 美股 | ⚠️ 日K可用；分时**必须用 `usMinute/query`**（§2.1b） | ✅ trends2 可用（但数据量小） | ✅ `usa_AAPL` 日K + 1min |
| 限频/封禁 | 未见明显 | **有 IP 级 WAF 封禁**（实测复现） | 未见明显 |
| 返回格式 | JSON | JSON（标准） | **JSONP + 分号串**（要剥壳+切分） |
| 复权 | qfq 是**加性**口径，不能当含分红用 | `fqt=2` 后复权可信 | `priceFactor` 需自行处理 |
### 2.0 边界先说清楚：**免费源里没有真正的"逐笔 tick"**

本轮把 A 股/港股/期货/外汇全扫了一遍，**没有任何一个免费免 key 的源提供真正的逐笔成交（tick）**。能做到的最细是 **1 分钟价格点（分时）** 或 **1 分钟 OHLC（分钟 K）**。所以如果你要"分时图"，拿 1 分钟粒度完全够；如果要"逐笔成交明细/大单追踪"，免费源里没有，必须换思路（交易所 Level-2 付费、或龙虎榜/盘口快照替代）。

### 2.0b 六个市场的可用性矩阵（含期货/外汇）

| 市场 | 分时 | 1/5/15/30/60 分钟 K | 日/周/月 K | 哪个源 |
|---|---|---|---|---|
| A 股 | ✅ 腾讯/东财/同花顺 | ✅ 三家都有（深度不同） | ✅ 三家都有 | 三源可互为兜底 |
| 港股 | ✅ 腾讯/东财 | ⚠️ **两处实测结论冲突，需复测**：Lead 测到东财 `secid=116.00700&klt=5` 返回 `klines` 空数组（199 字节）；probe-cn 报告称港股 1/5/15/30/60m 可用。腾讯 `mkline` 对港股 `param error` 是确定的 | ✅ 腾讯 `fqkline` `hk00700` 正常（含派息/回购事件字段） | **港股分钟 K 存疑，接入前必须单独复测** |
| 美股 | ✅ 腾讯 `usMinute/query`、东财 trends2 都可用 | ⚠️ 东财量小（约 19 个交易日）；同花顺 `usa_AAPL` 只有日线+1min | ✅ 腾讯 `usAAPL.OQ`（周线到 1993） | 建议 Worker + Yahoo 拿完整分钟历史 |
| A 股指数 | ✅ | ✅ | ✅ | 同花顺 `hs_000001`/`hs_399001` |
| 期货 | ⚠️ 东财 trends2（CFFEX 需正确 secid） | ⚠️ 东财 klt（易触发 WAF）；交易所官方无 ACAO | ✅ 东财；交易所官方需代理 | **较弱，需谨慎** |
| 外汇 | ⚠️ 东财 trends2 | ⚠️ 东财 klt | ⚠️ 东财 klt（`push2delay` 不存历史 K 线，见 FIELD-NOTES） | **最弱的一环**；Frankfurter 只有日线汇率 |

> 一句话：**A 股三源齐全；港股分钟 K 已澄清（东财可用，我那次是撞上封禁）；外汇分钟 K 是真实的空洞**。别在选型时假设"有了东财就都有了"。

> ⚠️ **关于"国内可达性"的诚实声明**：本次实测机出口 IP 为 `64.118.152.87`（经代理，**不是中国大陆住宅网络**）。所以本报告能确认的是"这些接口本身可用/有无 CORS"，**不能替国内用户的网络环境背书**——新浪、Binance、Polymarket 这类源在国内的可达性恰恰是最不稳定的，必须由部署环境自己再验一遍。

### 2.1 腾讯：分钟 K 上限是 800 根，不是 320（我改过两次的结论）

```
https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m5,,320
→ bars=320   first=202610121055
https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m5,,800
→ bars=800   first=202609181055   ← 800 根是通的（约 50 个交易日）
https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m5,,801
→ bars=320   first=202610121055   ← 超过 800 不是截到 800，而是掉回 320
→ 1000 同样是 320
```

**这条我改了两次，值得记下来**：第一版我传 3200/8000/16000，看到都回 320，就下结论"硬上限 320"——**这是错的**。真相是**上限 800，超过就静默降级回 320**（不是截断到 800）。`320 → 800 → 801` 这三步才探出真实边界。

所以：**腾讯分钟 K 最多 800 根**（5min ≈ 50 个交易日，1min ≈ 3 个交易日）。比 320 好一倍多，但**回测仍然不够**，长历史还是得靠东财或同花顺。

另外：`mkline` 端点**只支持 A 股和指数**，`hk00700` / `usAAPL.OQ` 一律返回 `{"code":-1,"msg":"param error"}`。港股/美股走另外两个端点。

### 2.1b 腾讯的港股/美股分时：两个不同的端点（我原来也搞错了）

```
# 港股分时：minute/query 可用
https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=hk00700
→ 正常，332 点到收盘后

# 美股分时：minute/query 是空壳！只有 1 个占位点
https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=usAAPL.OQ
→ {"data":{"usAAPL.OQ":{"data":{"data":[" 0"],"date":""}}}}   ← 别被骗了，这是空数据

# 美股分时正确端点：usMinute/query
https://web.ifzq.gtimg.cn/appstock/app/usMinute/query?code=usAAPL.OQ
→ 200, ACAO=*, 正常返回：["0930 340.88 876283", "0931 340.88 1879246", ...]
```

**这是我这次犯的第二个错**：我在主报告第一版里写"腾讯美股分时返回空 → 美股分时不可用"。真相是**用错了端点**——美股要 `usMinute/query`，不是 `minute/query`。同一个 API 家族里，不同市场的路径不一样，而且**失败的响应是 HTTP 200 + 空数组**，不报错，最容易被误判成"这源不支持美股"。

> 教训：看到 `200 + 空数据`，先假设"我调错了端点"，再假设"上游不支持"。

### 2.2 东财：深度最好，但会封 IP（本次实测亲手复现）

封禁前后的对比（同一个 URL 结构，只差 `lmt`）：

```
# 封禁前（22:10）
klt=1 & lmt=5    → HTTP 200, dktotal=6024, ACAO 回显 Origin
trends2 ndays=1  → HTTP 200, A股/港股/美股 全部有数据

# 我连续发了 ~19 个 lmt=100000 的长历史请求之后（22:16）
任何 push2his 请求 → "基础连接已经关闭: 连接被意外关闭"（TCP 被重置）
退避 35 分钟后（22:51）再试 → 仍然被重置
```

这与 `docs/FIELD-NOTES.md` 里已记录的"东财 WAF 会按 IP 封禁短时间大量长历史请求（实测整段 `other side closed`）"完全一致。**结论：东财适合"按需、低频"取数，绝不适合批量回填；必须保留腾讯/同花顺做兜底。**

另一个容易误判的点：我测到**港股 `secid=116.00700` 的 `klt=5` 返回 `klines` 空数组**（199 字节），而 probe-cn 在解封窗口内（22:50–23:00，≥3s 间隔）测到**东财港股 1/5/15/30/60m 全部可用**。所以**这不是"港股不支持 5 分钟"，而是我那次请求正好撞在封禁边界上**——空数组和"被断开"看起来不一样，但根因都是 WAF。

**教训：在被限频的源上，任何"空数据"结论都不可信。** 判一个源不支持某周期，必须在它的健康窗口里复测。
（另外 probe-cn 实测补充：东财分钟线只回最近约 1 个月——A股约 32 个交易日、港股约 23 个、美股约 19 个；`1m` 只回当日；**分钟线必须 `fqt=0`**，用 `fqt=2` 会把价格乘上复权因子。）

### 2.3 同花顺：本次最有价值的新发现（尚未接入）

```
# 分时（逐分钟 + 均价线 + 盘后固定价）
https://d.10jqka.com.cn/v6/time/hs_600519/last.js
→ {"hs_600519":{"name":"贵州茅台","pre":1324.97,"date":"20261020",
     "rt":"0930-1130,1300-1500,1505-1530",
     "data":"0930,1321.01,20376579,1321.010,15425;1130,1323.51,6883300,1325.072,5200;..."}}
   268 个点，字段 = 时间,价,成交量,均价,成交额      ← 均价线直接给，不用自己算
   注意 rt 里有 `1505-1530` 盘后固定价交易时段

# 周期码（同一套 URL 模板，换数字即可）
https://d.10jqka.com.cn/v6/line/hs_600519/{code}/last.js     ← 最近 140 根
https://d.10jqka.com.cn/v6/line/hs_600519/{code}/{year}.js   ← 按年取整年
  code: 01=日  11=周  21=月  31=5min  41=15min  51=30min  61=1min  71=年
  前缀: hs_ = A股/指数    hk_HK0700 = 港股    usa_AAPL = 美股
```

实测覆盖：

| 周期 | 文件 | 根数 | 时间跨度 |
|---|---|---|---|
| 1min | `61/2026.js` | 8676 | 2026-08-10 → 2026-09-29（**约 2 个月**） |
| 5min | `31/2026.js` | 9120 | 2026-01-05 → 2026-10-20（**约 1 年**） |
| 5min | `31/2025.js` | 384 | 2025-12-22 → 2025-12-31（更早年份 404） |
| 日线 | `01/all.js` | 6024 | 2001-08-27 → 2026-10-20 |

**坑（务必写进 adapter 注释）**：
1. 响应是 **JSONP**：`quotebridge_v6_line_hs_600519_31_last({...})`，要先把 `^[^(]*\(` 和 `\)\s*$` 剥掉。
2. `data` 字段是 **分号分隔的字符串**，每行再逗号切分，不是 JSON 数组。
3. `all.js` 的日/周/月是**紧凑差分编码**：`price` 是一长串整数、配 `priceFactor=100`、`sortYear` 给每年的根数。要长历史建议**按年分页**，别硬解 `all.js`。
4. **港股前缀是 `hk_HK0700`**：`hk_00700` / `hk_07000` / `hk_700` / `hk00700` 全部 404，正确的是 `hk_HK0700`（已复验，`ACAO: *`）。美股前缀是 `usa_AAPL`。**这类"前缀猜不出来"的情况，答案在 stockpage 的页面源码里**，靠猜浪费半小时。
5. `last.js` 只回 **140 根**，别指望它给长历史。

---

## 3. 美股 / 全球：数据有，CORS 没有

### 3.1 Yahoo Finance（非官方，最全，但浏览器直连不了）

粒度 × 区间实测矩阵（`query1.finance.yahoo.com/v8/finance/chart/AAPL`）：

| 粒度 | 1d | 5d | 7d | 1mo | 60d | 1y | 2y | 5y | 10y | max |
|---|---|---|---|---|---|---|---|---|---|---|
| 1m | 43 根 | 1603 | 2383（7d）/ 2832（**8d 是上限**） | 9d → **422** | — | — | — | — | — | — |
| 2m | — | 802 | — | — | — | — | — | — | — | — |
| 5m | — | — | — | 1648 | 4612 | — | — | — | — | — |
| 15m | — | — | — | — | 1538 | — | — | — | — | — |
| 30m | — | — | — | 276 | — | — | — | — | — | — |
| 60m | — | — | — | — | — | 1755 | 3492 | **422** | — | — |
| 1d | — | — | — | — | — | — | — | — | 2513 | ✅ |
| 1wk | — | — | — | — | — | — | — | — | — | 1046（20y） |
| 1mo | — | — | — | — | — | — | — | — | — | 169 |

> `422 Unprocessable Entity` 就是"粒度不允许这个区间"。边界经过专门补测确认：
> - **1m 最多 8 天**（`range=8d` → 2832 根，`range=9d` → 422。我在第一版里写的是"7 天"，那是**只测到 7d 通就下的结论**，实测 8d 也通）；
> - **60m 最多 730 天（2 年）**，`5y` → 422；
> - `range=max` 时粒度会**退化成 3mo**（169 根），不是 1mo。
>
> 这条修正本身值得记下来：**"没报错"不等于"到边界了"**——1d/5d/7d 全通时，很容易误以为 7 就是上限。探边界要用"二分找第一个 422"，而不是"能跑通的最大值"。

**三个必须知道的坑**：
1. **`timestamp` 是秒，不是毫秒。** 我第一次按毫秒解析，显示成 `1970-01-21`。同理 Binance 是毫秒——两种源混用时最容易出这种"年份 1970"的 bug。
2. **没有 `ACAO`**，`OPTIONS` 预检 200 但不回 `Access-Control-Allow-Methods` → 浏览器直连封死。
3. `includePrePost=false` 时 1d 只有 43 根（常规时段），盘前盘后要显式打开。

限频观察（Lead 与 probe-global 各自独立测，结论互补）：
- 带浏览器 UA：连续 25~40 次请求全部 200，**没触发 429**；
- **不带 UA：立即 429**（19 字节 `Too Many Requests`）——**Yahoo 是按 UA 拦截的，不是按频率**。这条比"限流多少"更重要：它说明 Yahoo 的"免费"依赖"伪装成浏览器"，一旦它改规则，所有调用会同时挂。
- `v7/finance/quote` 端点不带 crumb 直接 **401**，不要拿它替代 chart。

Yahoo 无 SLA、无文档，随时可能变更——用它必须有降级链。

### 3.2 Nasdaq 官方非公开 API（当日分时折线可用，历史日线也能取数千条）

```
https://api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks
→ data.chart.z.points = 372 个当日点（1 分钟级折线）+ volumeChart
→ assetclass 还支持 etf（SPY）/ index（COMP），均 200

https://api.nasdaq.com/api/quote/AAPL/historical?fromdate=2026-01-01&todate=2026-10-20&limit=9999
→ Lead 实测 1 年窗口只回 200 条，但 probe-global 复测：
   · 1 年 → 251 行   · 2020–2026 → 1708 行   · 20 年 → 2513 行
→ 结论修正：limit 不是硬上限，**"200 条"是短窗口下的现象**；长窗口能拿更多
→ 日期格式 "10/19/2026"，价格带 "$" 和千分位逗号，要清洗
→ 不传 fromdate 直接 400；错误也用 HTTP 200 返回，必须判 body
```
**无 ACAO**。它的价值在"当日分时折线"，不在历史。

### 3.3 其它（本机实测失败，如实记录）

- **Stooq**：`q/d/l/?s=aapl.us&i=5|d|60` 全部返回 796 字节的 "This site requires JavaScript" 页（HTTP 200 假成功），加 Referer 无效，stooq.pl 同样。probe-global 进一步做了 PoW 解出 cookie，**仍然 `Access denied`**（13 字节）→ **确认不可用，不是"换个 UA 就行"**。
- **雪球**：无 cookie 直接 400，不建议。
- **新浪 `US_MinKService`（probe-global 新发现，重要）**：`quotes.sina.cn/us/api/json_v2.php/US_MinKService.getMinK?symbol=AAPL&type=5` 美股 1/5/15/30/60 分钟 K，**固定 1023 根**（1m≈3 个交易日、5m≈1 个月、60m≈7 个月），`getDailyK` 一次给全历史（AAPL 10056 根回到 1984）——数据很好，**但无 ACAO**，同样只能走 Worker。港股 `0700.HK`、期货 `GC`、外汇 `EURUSD` 返回空数组。
- **公共 CORS 代理**全部不可靠：allorigins（522）、corsproxy.io（401）、codetabs（超时）、cors-anywhere（403）、whateverorigin（返回 HTML）、r.jina.ai（能用但返回 Markdown 包 JSON，不能生产）。

### 3.4 所以美股分钟 K 到底怎么办

| 方案 | 可行性 | 代价 |
|---|---|---|
| **A. 自建 Cloudflare Worker 代理 Yahoo**（推荐） | ✅ 仓库已有 `worker.js`（ALLOW_HOSTS 白名单 + 10s 缓存 + 透传 Content-Type），加 `query1/query2.finance.yahoo.com`、`api.nasdaq.com`、`quotes.sina.cn` 三行即可 | 需部署一次；免费额度 10 万次/日，足够 |
| B. 引入免费 key 源（Twelve Data 800/日） | ✅ 技术可行（实测 401 响应也带 ACAO） | **违反"前端零 API key"铁律**；额度紧（8 次/分，10 秒轮询会打爆） |
| C. 美股只用日 K | ✅ 腾讯 `usAAPL.OQ` 日K 实测可用（1756 根回 1993） | 没有分时/分钟图 |

---

## 4. 加密：这里是"免费 API"最卷的领域

| 源 | 端点 | 单次上限 | 历史深度 | CORS | 时间戳 | 字段顺序 |
|---|---|---|---|---|---|---|
| **Binance** | `data-api.binance.vision/api/v3/klines` | 1000 | 2017-08-17 | `*` | **毫秒** | O,H,L,C,V,closeTime,quoteVol,trades,... |
| OKX | `/api/v5/market/candles` | 100~300 | 很久 | 回显 | 毫秒 | 数组最后一列是 confirm 标志 |
| Bybit | `/v5/market/kline` | 1000 | 很久 | 回显 | 毫秒 | 数组倒序（最新在前） |
| Coinbase | `/products/{id}/candles` | **300** | 中等 | `*` | **秒** | [time, low, high, open, close, volume] **注意 low 在 open 前** |
| Kraken | `/0/public/OHLC` | **固定 720** | 中等 | 回显 | **秒** | O,H,L,C,VWAP,Vol,Count |
| Gate.io | `/api/v4/spot/candlesticks` | 1000 | 久 | `*` | **秒** | [time, quoteVol, close, high, low, open, baseVol, closed] |
| Bitget | `/api/v2/spot/market/candles` | 1000 | 久 | `*` | 毫秒 | 数组 |
| **Alpaca（第三方）** | `/v1beta3/crypto/us/bars` | — | 2024 起 | `*` | **ISO 字符串** | 对象 `{o,h,l,c,v,t}` |

**接入时最容易踩的 4 个坑（比"支持哪些周期"重要得多）**：
1. **时间戳单位不统一**：Binance/OKX/Bybit 毫秒，Coinbase/Kraken/Gate 秒，Alpaca 是 ISO 字符串。混用时会出现 1970 年或 5 万年后的时间轴。
2. **字段顺序不统一**：Coinbase 是 `[time, low, high, open, close]`——**low 在 open 前面**，照 Binance 的顺序解析会得到"最高价 < 最低价"的荒谬 K 线。
3. **最新一根未收盘**：Binance 实测 `closeTime` 只比当前时间早 1 秒且持续滚动。**增量拉取必须丢弃最后一根未闭合 K 线**，否则前端每 10 秒轮询时最后一根会不断变形。
4. **返回顺序不统一**：OKX/Kraken/Coinbase 是倒序（最新在前），Binance/Bitget/Gate 是正序（最旧在前），画图前必须统一。

**字段顺序的正确性可以机械验证**，别靠肉眼：对真实数据跑断言 `high >= max(open, close) && low <= min(open, close)`。本次实测结果：Coinbase 按 `[t,l,h,o,c,v]` 解析 **350/350 通过**，按"天真的 o,h,l,c"解析只有 43/350 通过；Gate 天真解析 **0/20**；KuCoin 天真解析 **0/100**。**建议把这条断言做成 adapter 的单元测试**——它是"接错字段顺序"唯一能自动抓到的信号。

**降级链建议**：`Binance(data-api.binance.vision) → OKX → Gate.io`。
理由：Binance 有官方行情专用域（`data-api.binance.vision` 不带交易功能，更不容易被墙）、`ACAO: *`、limit 1000 最大、历史最深；OKX 回显 Origin、自带 `confirm` 字段能直接判断 K 线闭没闭；Gate.io `ACAO: *` 且限频头明确。
**Bybit 已从降级链剔除**：本机 22:21（UTC 14:21）测试还是 `200 + ACAO 回显`，22:53（UTC 14:53）同一 URL 变成 `403 CloudFront ... block access from your country` 且**无 ACAO**——半小时内可达性反转。这正是"交易所源不能只测一次"的活标本：**同一台机器、同一请求，30 分钟后结论就变了**。接交易所源必须把"区域封锁"当成常态而非异常。
**注意国内网络对 `api.binance.com` 常返回 451，必须用 `.vision` 域或走 Worker。**

**长历史回补**：`data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2026-08.zip` 实测可下（1.9 MB/月），适合一次性回填，不要用 API 逐根拉。

---

## 5. TradingView 到底能不能用

| 尝试 | 结果 |
|---|---|
| `scanner.tradingview.com/america/scan`（POST 快照） | ✅ HTTP 200，`ACAO` 回显 Origin，返回价格/成交量/评级 |
| `symbol-search.tradingview.com` | ❌ 403 |
| `biz.tradingview.com/api/v1/history`（UDF 历史） | ❌ 连接被重置 |
| `widgetdata.tradingview.com/symbols/NASDAQ-AAPL` | ❌ 连接被重置 |

**结论**：TradingView 只有"图表组件（widget）"是官方免费的——但那是个 iframe，数据在 TV 自己的域里，**你拿不到数据**。`scanner` 快照能用（有 CORS、免费），但那是**筛选器结果**，不是历史 K 线。任何"抓 TradingView 历史 K 线"的方案都依赖登录 cookie，且违反其 ToS——**不建议**。

---

## 6. 落地建议（按投入产出排序）

1. **接入同花顺 `d.10jqka.com.cn`**（半天）→ 补上"分时带均价线 + 盘后固定价 + 长一点的分钟 K"，且 `ACAO: *` 天然满足零 key 直连。注意 JSONP 剥壳与分号串解析。
2. **把东财请求改成"低频 + 小 lmt + 退避"**（半天）→ 已有熔断框架（`history.js` 的 `eastFailed()`），把分钟级 K 也纳入同一套熔断，避免像本次这样一封 35 分钟。
3. **Worker 白名单加 `query1.finance.yahoo.com` + `api.nasdaq.com`**（1 小时）→ 打开美股分钟 K 的门，这是零 key 约束下唯一干净的路。
4. **加密源统一一层 adapter**（1 天）→ 把"时间戳单位 / 字段顺序 / 是否倒序 / 最后一根未闭合"四件事在 adapter 里吃掉，别让上层画图代码碰。
5. **港股分钟 K 已澄清，不用再查了** → 东财可用（我那次"空数组"是撞在东财 WAF 封禁边界上，probe-cn 在健康窗口复测到 1/5/15/30/60m 全通）。这条恰好证明了一件事：**在被限频的源上，"空数据"和"被断开"看起来不一样，但结论都不可信**。
6. **不要做的事**：不要接公共 CORS 代理（全部实测不可靠）；不要抓 TradingView 历史 K 线（ToS + 需要 cookie）；不要把免费 key 塞进前端（违反铁律，且额度撑不住 10 秒轮询）；**不要假设"一家源能覆盖所有市场"**（东财的港股分钟 K、腾讯的美股分时、所有的外汇分钟 K 都是反例）。

---

## 6b. 复核与落地记录（2026-10-21，DeepSeek 报告交由上游复测）

**本节是另一台机器（开发机本机、国内网络直连）对报告关键结论的复测与修正。总体判断：数据面结论全部复现，但 §6 落地建议的优先级要倒过来——同花顺不稳，东财 push2his 才是第一落点。**

复测结果（全部 curl/node 直连实测，同一会话内）：

| 结论 | 报告原文 | 复测结果 |
|---|---|---|
| 腾讯美股分时 `usMinute/query` | 可用，需完整代码 `usAAPL.OQ` | ✅ 复现，且**裸代码 `usAAPL` 同样可用**（无需 .OQ 后缀）；date 字段正常（美股闭市时给上一交易日 20261020，391 行到 16:00） |
| 腾讯 `minute/query` 美股空壳 | `[" 0"]` + 空 date | ✅ 复现——这正是 issue #1「无法显示分时数据」的根因（HTTP 200 不报错，最易误判） |
| 东财 push2his 分钟 K 三市场 | 港股可用（probe-cn 复测） | ✅ 复现且更顺：`116.00700`/`105.MSFT`/`1.600519` + `klt=5&fqt=0` 全通，本机直连无 WAF（港股 320 根、美股 320 根、A股 lmt=800 给满 800） |
| 东财 trends2 美股分时 | 可用 | ✅ 复现（391 行 + preClose 直接给） |
| 同花顺 A股分时 `v6/time` | 可用，`ACAO: *` | ✅ 复现（268 点含均价线） |
| **同花顺分钟 K** | "性价比最高的补充源"、"已复验 hk_HK0700 可用" | ⚠️ **部分推翻**：同一会话内 `hs_600519/31/last.js` 返回 `num:1,total:0` 空数据、`hs_600519/31/2026.js` 502、`usa_AAPL/31/last.js` 两次 502、`hk_HK0700/31/last.js` 首次 502 重试才通。**同花顺的 5 分钟线在本机极不稳定（间歇 502 / 空响应）**，不能当第一落点——报告自己的结论五（"可用性有保质期，Bybit 半小时反转"）恰好打在它自己头上 |

**修正后的落地优先级**（即本次实际落地的顺序）：

1. **东财 push2his 分钟 K**（半天）→ 港/美股分钟 K 的唯一稳定免费直连源；A股做腾讯 mkline 的兜底。注意 `fqt=0` 与 "YYYY-MM-DD HH:mm" 墙钟串解析。
2. **腾讯 `usMinute/query`**（10 分钟）→ 修美股分时。裸代码即可。
3. 同花顺 → **观察名单**，不接。等它连续一周稳定再考虑（它的分时带均价线确实有价值，但分钟 K 不稳就不值得为它写 JSONP 剥壳 + 前缀映射 + 按年分页三套解析）。
4. Worker 白名单加 Yahoo/Nasdaq（美股分钟长历史）→ 维持原建议，未变。

**已按此落地**（commit 见 `git log`，issue #1）：
- `js/sources/tencent.js`：美股分时自动切 `usMinute/query`；
- `js/sources/eastmoney.js`：新增 `getMinuteKline`（klt=5/15/30/60、fqt=0、伪 UTC 时间）；
- `js/app.js`：m5/m15/m60 按钮对港/美股放开（需东财 secid），分钟 K 降级链 A股「腾讯→东财」、港美「东财单源」。

---

## 7. 复现方式

本报告所有数字可用下面的方式复现（PowerShell）：

```powershell
$UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
# 关键：带 Origin 才能看出对方是否允许浏览器直连
Invoke-WebRequest -Uri '<URL>' -Headers @{'User-Agent'=$UA; 'Origin'='https://5777-wq.github.io'} -UseBasicParsing |
  Select-Object StatusCode, @{n='ACAO';e={$_.Headers['Access-Control-Allow-Origin']}}
```

判读规则：
- `ACAO: *` 或 `ACAO: <你的 Origin>` → 浏览器可直连；
- `ACAO` 为空 → 浏览器直连会被同源策略拦截（无论 HTTP 200 还是 401）；
- HTTP 200 + body 是提示语 → 假成功（Alpha Vantage 无 key 就是这样）。

> 附：分域实测明细见同目录 `cn-sources.md`（A股/港股）、`global-sources.md`（美股/全球）、`crypto-sources.md`（加密）。