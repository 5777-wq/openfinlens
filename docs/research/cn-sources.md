# 中国大陆市场免费行情源实测（A股 / 港股 / 期货 / 外汇 / 指数）

> 实测时间：**2026-10-20 22:13–23:10（UTC+8）**，均为**本机实测**（PowerShell `Invoke-WebRequest -UseBasicParsing`，UA=Chrome/124，默认 `Origin: https://5777-wq.github.io`）。出口 IP `64.118.152.87`，非中国大陆住宅网络。
> **口径**：分时线（tick/均价线）≠ 分钟 K 线（OHLC）≠ 日/周/月 K。本轮**没有找到任何免费免 key 的真正逐笔 tick 源**，最细是 1 分钟价格点/1 分钟 OHLC。

## 0. 三种东西的区别

| 概念 | 含义 | 典型接口 | 不是什么 |
|---|---|---|---|
| **分时线** | 按分钟聚合的价格点，常含均价线，可能有盘后固定价 | 东财 `trends2`、腾讯 `minute/query`、同花顺 `time/...`、深交所 `getTimeData`、上交所 `line` | 不是逐笔 tick，也不是 OHLC |
| **分钟 K 线** | 固定周期 OHLC+量额 | 东财 `klt=1/5/15/30/60`、腾讯 `mkline`、同花顺 `31/41/51/61`、新浪 `scale=1/5/15/30/60`、深交所 `getHistoryData` | 不是均价线 |
| **日/周/月 K** | 日/周/月 OHLC | 东财 `klt=101/102/103`、同花顺 `01/11/21`、腾讯 `kline/kline`、新浪 `scale=240/1200/7200` | 别拿日线冒充分钟线 |

## 1. 浏览器零 key 直连分层

### A. 可直接用（实测有 ACAO）

| 源 | 覆盖 | 前提 |
|---|---|---|
| **腾讯 `ifzq.gtimg.cn` / `web.ifzq.gtimg.cn`** | A股分时+A股1/5/15/30/60m+A/HK/US日周月+HK分时+US分时(`usMinute`) | ACAO=`*`；OPTIONS 也 200 |
| **同花顺 `d.10jqka.com.cn`** | A股分时+均价+盘后固定价、A股1/5/15/30/60m、日/周/月；港股、美股、指数 | ACAO=`*`；只发简单 GET（OPTIONS 404） |
| **东财 `push2his.eastmoney.com`** | A/HK/US 分时+1/5/15/30/60m+日/周/月；外汇、商品期货 | ACAO 回显任意 Origin；免 Referer；**IP 级 WAF 极敏感** |
| **Frankfurter `api.frankfurter.app`** | 美元/人民币等**日线汇率** | ACAO=`*`；只有日频 |

### B. 需 worker.js 代理（无 ACAO / 必须改 Referer / 混合内容）

| 源 | 原因 |
|---|---|
| 新浪 `quotes.sina.cn` K线 | 200 免 Referer，但**无 ACAO** |
| 新浪 `hq.sinajs.cn` 快照 | 无 Referer 403；带 `finance.sina.com.cn` 才 200；带 `5777-wq.github.io` 仍 403；无 ACAO |
| 新浪期货/外汇 JSONP | 200 免 Referer，但**无 ACAO** |
| 深交所 `www.szse.cn` API | HTTP/HTTPS 均 200，但**无 ACAO** |
| 上交所 `yunhq.sse.com.cn:32041` | 无 ACAO，且**仅 HTTP 32041**（HTTPS 页面混合内容）。分时可用，K线 503 |
| 中金所 `cffex.com.cn`、上期所 `shfe.com.cn` | 200 但**无 ACAO** |
| Yahoo `query1.finance.yahoo.com` | 200，`Vary: Origin` 但**无 ACAO** |
| 网易 `quotes.money.163.com` | 本机全 502，无法验证 CORS |

### C. 不可用 / 未测到

- **雪球 `stock.xueqiu.com`**：无 cookie 直接 **400**（`error_code=400016`）；带首页 `acw_tc` cookie 仍 400；首页有阿里云 WAF。**不可靠**。
- **网易 `quotes.money.163.com/service/chddata.html`**：HTTP/HTTPS 全 **502**；`img1.money.126.net` 也 502。未测到数据，**不能判定下线**。
- **上交所 `yunhq.../kline/...`**：多次 **503**；老 `query.sse.com.cn/security/stock/getStockKLine.do` **404**。
- **大商所 / 郑商所**：**412**，返回阿里云 WAF JS 挑战页。
- **东财 CFFEX `220.IF2611`**：suggest 确认 secid 存在，随后再次触发 WAF，**分钟线未测完**。
- **腾讯 `mkline` 港股/美股**：稳定 `{"code":-1,"msg":"param error"}`。

### 东财 WAF 本机时间线（2026-10-20）

| 时间 | 现象 |
|---|---|
| 22:13 | 首次成功：A股日K 200，ACAO 回显 |
| 22:16 前后 | 密集请求长历史（lmt=100000），push2his 全域名开始 TLS 层连接被意外关闭 |
| 22:16–22:49 | 封禁期：push2his/push2delay/push2 全部连接重置；quote.eastmoney.com、datacenter-web、searchapi 仍 200，封的是行情 API 不是整个域名 |
| 22:49 | 解封：单发小 lmt 请求成功（1m/5m/日K、trends2 均 200） |
| 22:50–23:00 | 用 ≥3s 间隔、lmt≤10 完成 A/HK/US 三类 secid 的 klt=1/5/15/30/60/101/102/103 与外汇商品扫描 |
| 23:00–23:06 | 再次因密集请求被重置；之后只做零散小请求，能通即记录，不能通记未测 |

**结论**：不是接口下线，而是按出口 IP 的滑动窗口限频/临时封禁，恢复约 30 分钟量级。项目必须按可失败、可退避、可降级到腾讯/同花顺设计。

## 2. 实测明细表

> ACAO：`*`=通配；`回显`=原样回显 Origin；`无`=无该头；`未测`=没拿到响应。

| 源/端点 | 市场 | 粒度 | 实测 HTTP | 条数/时间跨度 | CORS(ACAO) | 是否需 key/Referer | 限频/封禁迹象 | 坑 |
|---|---|---|---|---|---|---|---|---|
| 东财 `kline/get` klt=1 | A股 1.600519 | 1分钟OHLC | 200 | 240根，2026-10-20 09:31–15:00（仅当日） | 回显 | 免key，免Referer | 连续长历史请求后整域连接重置；22:16–22:49封禁约33分钟 | 只给**当日**1分钟；`beg`拉不出历史；`dktotal=6024`是日线总数不是分钟数 |
| 同上 klt=5/15/30/60 | A股 | 5/15/30/60分钟OHLC | 200 | 5m 1536根、15m 512、30m 256、60m 128；均2026-08-28→10-20（约32交易日） | 回显 | 免key，免Referer | 同上；大lmt/长历史是封禁触发器 | **不是全历史**；只回最近约32交易日，改beg/lmt无效 |
| 同上 klt=101/102/103 | A股 | 日/周/月OHLC | 200 | 日6024根（2001-08-27至2026-10-20）、周1269、月302 | 回显 | 免key，免Referer | 长历史lmt大时最易触发WAF | fqt=2后复权当前价被放大（茅台8243），展示用fqt=0；fqt=1长历史会出负价 |
| 同上 klt=1 | 港股 116.00700 | 1分钟OHLC | 200 | 330根，2026-10-20 09:31–16:00 | 回显 | 免key，免Referer | 同上 | 港股下午到16:00；1m也只有当日 |
| 同上 klt=5/15/30/60 | 港股 | 5/15/30/60分钟OHLC | 200 | 5m 1518、15m 506、30m 253、60m 138；均2026-09-16至10-20（约23交易日） | 回显 | 免key，免Referer | 同上 | 领队此前港股klt=5空数组是封禁期现象；解封后实测1518根 |
| 同上 klt=101/102/103 | 港股 | 日/周/月OHLC | 200 | 日5506根（2004-06-16起）、周1167、月269 | 回显 | 免key，免Referer | 同上 | 港股历史深度远好于分钟线 |
| 同上 klt=1 | 美股 105.AAPL | 1分钟OHLC | 200 | 81–90根，当日21:31–23:00（随盘中增长） | 回显 | 免key，免Referer | 同上 | 美股1m是当前交易时段，不是历史 |
| 同上 klt=5/15/30/60 | 美股 | 5/15/30/60分钟OHLC | 200 | 5m 1421–1423、15m 474、30m 237、60m 128；2026-09-24 21:35 至 10-20 22:55，共 1421–1423 根，覆盖约 19 个交易日 | 回显 | 免key，免Referer | 同上 | 与A/HK一样只回最近约1个月 |
| 同上 klt=101/102/103 | 美股 | 日/周/月OHLC | 200 | 日10613根（1984-09-07起）、周2199、月506 | 回显 | 免key，免Referer | 同上 | secid市场位不能猜：AAPL在105，SPY等可能在107 |
| 东财 `trends2/get` | A股 | **分时+均价** | 200 | ndays=1 241点09:30–15:00；ndays=2 482；ndays=5 1205（10-14至10-20） | 回显 | 免key，免Referer | 同 push2his WAF | 字段顺序为时间,开,收,高,低,量,额,均价；**只到15:00，没有15:05–15:30盘后固定价** |
| 同上 | 港股 | **分时+均价** | 200 | ndays=1 331点09:30–16:00；ndays=5 1655点/5日 | 回显 | 免key，免Referer | 同上 | 港股到16:00 |
| 同上 | 美股 | **分时+均价** | 200 | ndays=1 84–91点（当前时段21:30–23:00）；ndays=5 1658点/6个日历日 | 回显 | 免key，免Referer | 同上 | 当前时段未收盘点数会变；没有逐笔 |
| 东财 `push2delay` klt=1/5/101 | A股 | 1分钟/5分钟/日 | 200 | klt=1：240根当日；**klt=5：0根；klt=101：0根**（dktotal=0） | 回显 | 免key，免Referer | 同 push2his WAF | **push2delay不存历史K**，别当备用历史源 |
| 东财 `push2his` 外汇/商品 | USDCNH/COMEX金/NYMEX油/国内商品 | 1m/5m/日 | 200 | `133.USDCNH`：1m 1073、5m 1367、日4204（2010-08-23起）；`101.GC00Y`：1m 1003、5m 1581、日9298（1990-01-03起）；`102.CL00Y`：1m 1004、5m 1581、日10142（1986-09-04起）；`113.rbm`：1m 114、5m 1424、日4279（2009-03-30起）；au2612/a2611/SA611日约223–224根 | 回显 | 免key，免Referer | 同 push2his WAF；这一批成功后再次被封 | 期货分钟线**必须fqt=0**；fqt=2会放大价格（沪金5m显示11478499）。secid：133=外汇、101/102=外盘期货、113=上期所、114=大商所、115=郑商所、220=中金所 |
| 东财 `220.IF2611` | 中金所股指 | 未测 | 0（连接重置） | 未测 | 未测 | 免key | 复测时仍处WAF封禁 | secid由suggest确认存在，但分钟/日线均未完成；**不要写成已支持** |
| 腾讯 `minute/query` | A股 sh600519 | **分时线** | 200 | 267点，09:30–15:30（含15:05–15:30盘后固定价） | `*` | 免key，免Referer | 未观察到 | 字段HHMM 价格 累计量 累计额；**不是OHLC**；只有当日 |
| 同上 | 港股 hk00700 | **分时线** | 200 | 332点，09:30–16:08 | `*` | 免key，免Referer | 未观察到 | 港股收盘竞价到16:08 |
| 同上 | 美股 usAAPL.OQ | **分时线** | 200 | 返回`["  0"]`占位，无有效数据 | `*` | 免key | 未观察到 | **web版minute对美股不可用**；美股换`usMinute/query` |
| 腾讯 `usMinute/query` | 美股 usAAPL.OQ | **分时线** | 200 | 54–71点，当日09:30–10:40（美东时间显示） | `*` | 免key，免Referer | 未观察到 | 3列HHMM 价格 累计量（无成交额）；只有当日 |
| 腾讯 `day/query` | A股/港股 | **最近5日分时线** | 200 | A股5天×267点；港股5天×332点 | `*` | 免key，免Referer | 未观察到 | 美股day/query返回param error；A/HK只有5天 |
| 腾讯 `mkline` | A股 | 1/5/15/30/60分钟OHLC | 200 | 320→320根；640→640；**800→800；801→320**；900/1000/2000/3200/8000/16000→320。m5 800根：2026-09-18 10:55至10-20 15:00（约20交易日）；m1 800根：10-15 13:44至10-20 15:00（约4交易日） | `*` | 免key，免Referer | 未观察到；**超限静默回320** | **实测硬上限是800，不是320**（320是超限后的回落值）；字段YYYYMMDDHHMM,开,收,高,低,量,额,换手，开收高低顺序不是标准OHLC |
| 腾讯 `mkline` | 港股/美股 | 5分钟OHLC | 200 | 0根，`{"code":-1,"msg":"param error"}` | `*` | 免key | 无 | **港股/美股均不可用** |
| 腾讯 `kline/kline` | A股 | 日/周/月（不复权） | 200 | 日320→2025-06-25起；日1084→2022-04-28起；日2000→2018-07-19起；**2001起param error**；周320→2020-07-31起；月302→2001-08-31起 | `*` | 免key，免Referer | 未观察到 | 不复权日线最多2000根；月线只有302根 |
| 同上 | 港股 | 日/周/月 | 200 | 日320→2025-07-04起；日2000→2018-09-05起；周320→2020-09-11起；月269→2004-06-30起 | `*` | 免key | 未观察到 | 港股日线2000根可用 |
| 同上 | 美股 | 日/周/月 | 200 | 日2001→2018-11-01起；周320→2020-09-11起；周1756请求→1023根（2007-03-23起）；月236→2007-03-30起 | `*` | 免key | 未观察到 | 美股周线硬上限约1023；代码必须带.OQ/.N/.AM，裸usAAPL会param error |
| 腾讯 `fqkline/get` | A股 qfq | 日/周/月 | 200 | 日l=800→801根（2023-06-29起）；l=801→641根；周640；月302 | `*` | 免key | 未观察到 | qfq边界怪：800回801、801反回641；建议固定≤640或≤800并校验首根日期。qfq不是含分红总收益 |
| 腾讯 `hkfqkline/get`、`usfqkline/get` | 港股/美股 qfq | 日线 | 200 | HK日800根→2023-07-21起；US日800根→2023-08-14起 | `*` | 免key | 未观察到 | 港股/美股qfq参数被忽略（返回不复权价），见docs/FIELD-NOTES.md |
| 同花顺 `v6/time/hs_600519/last.js` | A股 | 分时+均价+盘后固定价 | 200 | 268点，09:30–15:30（含盘后）；pre=1324.97 | `*` | 免key；Referer可不带 | 高频后曾回212字节空数据，间隔后恢复 | JSONP需剥壳；字段为时间,价格,成交额,均价,成交量(股)，与常见博客写法不同 |
| 同花顺 `v6/time/hk_HK0700/last.js` | 港股 | 分时+均价 | 200 | 342点，09:30–16:10；pre=417.800 | `*` | 免key | 同上 | 港股前缀是 `hk_HK0700`（4位代码+下划线）；`hk_00700`/`hk00700`/`hk_700`/`HK00700`/`hk_0700` 全404。可从 stockpage.10jqka.com.cn/HK0700/ 页面发现 |
| 同花顺 `v6/time/usa_AAPL/last.js` | 美股 | 分时+均价 | 200 | 63点（截至22:32），21:30–22:32北京时间 | `*` | 免key | 同上 | 美股前缀是 `usa_AAPL`；返回时间也是北京时间 |
| 同花顺 `v6/line/hs_600519/01 / 11 / 21` 的 last.js | A股 | 日/周/月OHLC | 200 | 日140根（2026-03-24起）；周1269根（2001-08-31起）；月302根（2001-08-31起） | `*` | 免key | 同上 | last.js 对日线只回140根；周/月反而回全量；字段为分号串，价格可能因复权出现负值 |
| 同花顺 `v6/line/hs_600519/31 / 41 / 51 / 61` 的 last.js | A股 | 5/15/30/60分钟OHLC | 200 | 5m 140根（10-16 09:55起）；15m 140根（09-17 13:30起）；30m 140根（08-25 10:30起）；1m 140根（10-20 11:11–15:00） | `*` | 免key | 高频后偶发502或空数据，间隔后恢复 | 1m last.js 只有当前日最后140分钟；历史1m要按年文件；字段 日期,开,高,低,收,量,额,换手,,, |
| 同花顺 `v6/line/hs_600519/31/2026.js`、`61/2026.js` | A股 | 5m/1m 年文件 | 200 | 5m 9120根（2026-01-05 09:35至2026-10-20 15:00）；1m 8676根（2026-08-10 09:30至2026-09-29 15:00） | `*` | 免key | 高频后502 | **5m历史约1年**：31/2025.js仅384根（2025-12-22至12-31），31/2024.js 404；**1m约2个月且年文件停在9/29**，最新1m只能靠last.js补 |
| 同花顺 `v6/line/hs_600519/41/2026.js`、`51/2026.js` | A股 | 15m/30m 年文件 | 200 | 15m 1520根；30m 760根；均2026-01-05至10-20 | `*` | 免key | 同上 | 15m/30m年文件可用；21/2026.js 502，但21/all.js可用（302根） |
| 同花顺 `v6/line/hk_HK0700/01 / 11 / 21 / 31 / 41 / 51 / 61` 的 last.js | 港股 | 日/周/月/5m/15m/30m/1m | 200 | 日140根（2026-03-26起）；周1167根（2004-06-18起）；月269根；5m 140根（10-15 15:55起）；15m 140；30m 140；1m 140根（04-21 10:28至13:46，明显是旧数据） | `*` | 免key | 同上 | 港股1m last.js 不是当前日，是4月旧区间；港股5m年文件31/2026.js实测13323根（2026-01-02至10-20），比A股更全 |
| 同花顺 `v6/line/usa_AAPL/01/last.js`、`61/last.js` | 美股 | 日/1分钟 | 200 | 日140根（2026-04-01至10-20）；1m 140根（10-19 14:34至10-20 10:22） | `*` | 免key | 同上 | **美股5m/15m/30m返回空**（31只有194字节、total=0；41/51空）；美股只有日线+1分钟 |
| 同花顺 `v6/line/hs_600519/81 / 91 / 71` | A股 | 年/季/日级（推断） | 200 | 81：26根（2001–2026，按年）；91：102根（2001-09-28起，约每季一根）；71：734根（2023-10-10起，带15:00时间戳，OHLC与日线一致） | `*` | 免key | 同上 | **71不是年线**，更像近3年日线变体；81才是年线（26根）；91疑为季线（102根≈25年×4），未逐根验证。不要照搬博客的周期码解释 |
| 新浪 `quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData` | A股/指数 | 1/5/15/30/60分钟 + 日/周/月OHLC | 200 | datalen=1023：1m 1023根（2026-10-14 13:48至10-20 15:00，约4交易日）；5m 1023（09-11至10-20，约1个月）；15m 1023（07-15起）；30m 1023（04-10起）；60m 1023（2025-09-23起）；日1023（2022-07-28起）；周1023（2006-10-27起）；月302（2001-08-31起） | 无 | **免key，免Referer** | 未观察到 | datalen=2000返回null，硬上限1023；标准JSON数组 day/open/high/low/close/volume/amount；**无ACAO，浏览器直连不可用**；Content-Type写gbk但内容纯ASCII，response.json()可解析 |
| 新浪 `quotes.sina.cn` 港股/美股 | HK/US | 分钟K | 200 | null 或 `{"__ERROR":3,"__ERRORMSG":"Service not valid"}` | 无 | 免key | 无 | **该服务只覆盖A股/指数，不支持港股/美股** |
| 新浪 `hq.sinajs.cn/list=...` | A/HK/US/外汇/商品快照 | 实时快照（非K线） | 200（带新浪Referer）/ 403（不带或带GitHub Referer） | 一次可取6个标的：sh600519,hk00700,gb_aapl,fx_susdcnh,hf_GC,nf_RB0 | 无 | **必须Referer: https://finance.sina.com.cn**；免key | 无Referer时约5秒后403 | 浏览器fetch**不能设置Referer**；带 https://5777-wq.github.io 实测仍403。故纯前端不可用，必须worker。响应GBK/GB18030，需转码 |
| 新浪期货 `stock2.finance.sina.com.cn/futures/api/jsonp.php/.../InnerFuturesNewService.getFewMinLine` | 国内商品/股指期货 | 1/5/15/30/60分钟OHLC | 200 | 每周期1023根：RB0 5m 2026-09-21 11:30至10-20 22:25；1m 10-15 22:34至10-20 22:21；15m 08-10起；60m 01-28起；日线getDailyKLine 4263根（2009-03-27起）；IF0 5m、AU0 5m均1023根 | 无 | **免key，免Referer** | 未观察到 | JSONP需剥壳；含夜盘；字段d,o,h,l,c,v,p；**无ACAO，需worker**；symbol用RB0/IF0/AU0（主连） |
| 新浪全球期货 `GlobalFuturesService.getGlobalFuturesMinLine` | COMEX金/原油等 | 分时线（不是多周期K） | 200 | GC/CL type=1/5/15/30/60 返回**完全相同的1分钟点**（约6万字节）；日线getGlobalFuturesDailyKLine GC从2016-10-20、CL从1996-10-21 | 无 | 免key，免Referer | 未观察到 | **type参数被忽略**，别当5/15/30/60分钟K；只有1分钟线和日线；无ACAO |
| 新浪外汇 `vip.stock.finance.sina.com.cn/forex/api/jsonp.php/.../NewForexService.getMinKline` | USDCNH等 | 1/5/15/30/60分钟OHLC | 200 | 5m datalen=1023→990根（2026-10-15 11:55至10-20 22:25）；15m/30m/60m可用；日线getDayKLine 3116根（2014-11-07起） | 无 | 免key，免Referer | 未观察到 | 5m上限约990不是1023；JSONP需剥壳；无ACAO；旧接口getMinLine?scale=5返回Service not found，要用getMinKline |
| 网易 `quotes.money.163.com/service/chddata.html` | A股 | 日线（宣称） | **502** | 未测到 | 未测 | 未测 | 本机全502，非限频证据 | HTTP/HTTPS、不同code、不同日期均502；img1.money.126.net也502；api.money.126.net连接重置。**本机无法验证，不能判定接口下线** |
| 雪球 `stock.xueqiu.com/v5/stock/chart/minute.json` | A股 | 分时线（宣称） | **400** | 0 | 无 | 需cookie/token；免key但不匿名 | 无cookie直接拒 | 错误体error_code=400016；带首页acw_tc仍400；首页有阿里云WAF JS挑战。**浏览器直连不可靠** |
| 雪球 `.../kline.json` | A股 | K线（宣称） | **400** | 0 | 无 | 同上 | 同上 | 同上；无法作为零key前端源 |
| 上交所 `http://yunhq.sse.com.cn:32041/v1/sh1/line/600519` | 沪A/指数/ETF | **分时线（无均价）** | 200 | 266点，09:30–15:00；select=time,price,volume；select=avgprice返回null | 无 | 免key，免Referer | 多次请求后整站502，间隔后恢复 | **只有HTTP 32041，HTTPS连接失败**；HTTPS页面会混合内容拦截；无ACAO；**不提供均价线**；snap快照可用（200，116字节） |
| 上交所 kline | 沪A | 日/分钟K | 503 | 0 | 未测 | 免key | 多次503 | 所有period组合均503，老接口404，勿写可用 |
| 深交所 getTimeData | 深A | 分时+均价 | 200 | picupdata 266点09:30–15:30；picavgprice 266点；7字段 时间,价,均价,涨跌,涨跌幅,量,额 | 无 | 免key，免Referer | 未观察到 | HTTPS同样200；无ACAO；只有当日；需worker |
| 深交所 getHistoryData 17/18/19/20 | 深A | 5/15/30/60分钟OHLC | 200 | 17：5m 201点/5日；18：15m 201点/13日；19：30m 112–201点/26日；20：60m 201点/51日 | 无 | 免key，免Referer | 未观察到 | **cycleNum被忽略**：传1/2/3/5/10结果完全相同；每次最多约201点，无法翻页拉更长；字段9列，开收高低顺序非标准 |
| 深交所 getHistoryData 32/33/34/35/36/37 | 深A | 日/周/月/更长周期 | 200 | 32：201根日线（2025-12-17至2026-10-20）；33：201根周线（2022-11-25起）；34：201根月线（2009-11-30起）；35：143根（1991-06-28起，疑季线）；36：72根（疑半年线）；37：36根（疑年线） | 无 | 免key，免Referer | 未观察到 | 32/33/34的日/周/月身份较确定；35/36/37是按根数推断，**未逐根验证**；21返回51根日级但用途未定，不建议依赖 |
| 中金所 quote_IF.txt | 中金所股指/国债 | 实时快照CSV | 200 | IF 4行；T/TF/TS/TL/IC/IH/IM各有文件；12列 instrument,openprice,highest,lowest,lastprice,updown,bprice,bamount,sprice,samount,volume,position | 无 | 免key | 未观察到 | 只有**当日快照**，不是K线；quote_SI.txt返回HTML（无此品种）；无ACAO |
| 中金所 fzjy/mrhq/YYYYMM/DD/index.xml | 中金所 | 日线OHLC | 200 | 700行（含期权），如IF2611 O=4127.4 H=4149.8 L=4077.6 C=4112 V=25589 OI=47623 | 无 | 免key | 未观察到 | XML；含期权，需按instrumentid过滤；index.json/_1.csv均404；**未找到官方分钟线** |
| 上期所 kxYYYYMMDD.dat | 上期所 | 日线OHLC | 200 | 332个合约；字段含OPENINTEREST,HIGHESTPRICE,LOWESTPRICE,CLOSEPRICE,VOLUME,TURNOVER,PRODUCTID等 | 无 | 免key | 未观察到 | JSON；无ACAO；日期必须为交易日，非交易日404；**未找到官方分钟线** |
| 上期所 dailyTimePrice/defaultTimePrice/mainTimePrice | 上期所 | **不是分钟线** | 200 | dailyTimePrice 602行但每合约只有2个时间点（10:15、15:00）；default/mainTimePrice各50行 | 无 | 免key | 未观察到 | **极易误判**：名字像分时，实际是分段参考价/结算参考价，每合约只有2个点，不能画分时图 |
| 大商所/郑商所 | 大商所/郑商所 | 日线/分时（宣称） | 412 | 0 | 无（WAF页） | 未测 | 返回阿里云WAF JS挑战 | HTTP/HTTPS、加Referer、加Cookie均412；**本机不可用**，不能用它证明接口下线 |
| Frankfurter | 外汇 | 日线汇率 | 200 | 1个日期点：2026-10-20，USD/CNY=6.678 | `*` | 免key，免Referer | 未观察到 | **只有日频，没有分时/分钟**；不能画日内图；适合做汇率日线/换算 |
| exchangerate.host | 外汇 | 日线（宣称） | 200 | 0（错误体） | `*` | **需要access_key** | 无 | 返回success:false, code:101, missing_access_key；**已不再是免key源** |
| Yahoo query1.finance.yahoo.com | 美股/外汇 | 1/5/15/30/60m、日 | 200 | AAPL 5m当日约78点；USDCNY=X 5m有数据 | 无（仅Vary: Origin） | 免key | 未观察到；可能被限流 | 浏览器fetch读不到响应（无ACAO）；条款/稳定性风险；USDCNY=X返回meta.symbol变成CNY=X，别按symbol硬校验 |

> **secid 纠错（任务里给的 119.USDCNH 是错的）**：东财 suggest `https://searchapi.eastmoney.com/api/suggest/get?input=USDCNH&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10` 返回 `QuoteID=133.USDCNH`（JYS=CNYOFFS，MarketType=_FOS）；`119.USDCNH` 不是东财有效市场位。同理 `101.GC00Y`（COMEX黄金）、`102.CL00Y`（NYMEX原油）均经 suggest 确认，实测有效。
## 3. 可直接用的原始请求 URL 示例

### A. 浏览器可直连（零key、有ACAO）
```text
腾讯A股分时：https://ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519
腾讯A股5mK（最多800，>800静默回320）：https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600519,m5,,800
腾讯A股日/周/月（不复权，日最多2000）：https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=sh600519,day,,,2000
腾讯A股前复权日K（注意801根怪边界）：https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,640,qfq
腾讯港股/美股日K：https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=hk00700,day,,,2000
腾讯美股日K：https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=usAAPL.OQ,day,,,2000
腾讯美股分时（web minute对美股空占位，须用usMinute）：https://ifzq.gtimg.cn/appstock/app/usMinute/query?code=usAAPL.OQ
同花顺A股分时+均价+盘后：https://d.10jqka.com.cn/v6/time/hs_600519/last.js
同花顺港股分时：https://d.10jqka.com.cn/v6/time/hk_HK0700/last.js
同花顺美股分时：https://d.10jqka.com.cn/v6/time/usa_AAPL/last.js
同花顺上证指数/深证成指分时（hs_000001是平安银行，别用错）：https://d.10jqka.com.cn/v6/time/hs_1A0001/last.js
同花顺深证成指：https://d.10jqka.com.cn/v6/time/hs_399001/last.js
同花顺A股5m/1m年文件（5m约1年，1m约2个月）：https://d.10jqka.com.cn/v6/line/hs_600519/31/2026.js
同花顺A股1m年文件：https://d.10jqka.com.cn/v6/line/hs_600519/61/2026.js
同花顺A股5m/15m/30m/1m最近140根：https://d.10jqka.com.cn/v6/line/hs_600519/31/last.js
同花顺A股15m/30m/1m最近140根：https://d.10jqka.com.cn/v6/line/hs_600519/41/last.js
同花顺A股30m：https://d.10jqka.com.cn/v6/line/hs_600519/51/last.js
同花顺A股1m：https://d.10jqka.com.cn/v6/line/hs_600519/61/last.js
东财A股分时+均价（ndays可多日）：https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0
东财A股5mK（fqt=0真实价，仅最近约32交易日）：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=5&fqt=0&beg=0&end=20500101&lmt=100000
东财A股日K（展示用fqt=0）：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=0&end=20500101&lmt=100000
东财港股/美股5mK：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=116.00700&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=5&fqt=0&beg=0&end=20500101&lmt=100000
东财美股5mK：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=105.AAPL&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=5&fqt=0&beg=0&end=20500101&lmt=100000
东财外汇USDCNH 5m：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=133.USDCNH&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=5&fqt=0&beg=0&end=20500101&lmt=100000
东财COMEX金1m：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=101.GC00Y&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=1&fqt=0&beg=0&end=20500101&lmt=100000
东财螺纹钢主连5m：https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=113.rbm&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=5&fqt=0&beg=0&end=20500101&lmt=100000
Frankfurter美元/人民币日线：https://api.frankfurter.app/latest?from=USD&to=CNY
```

### B. 需要worker.js代理（无ACAO，或需Referer，或混合内容）
```text
新浪A股1/5/15/30/60m + 日/周/月（标准JSON，最多1023）：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=5&ma=no&datalen=1023
新浪日K：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=240&ma=no&datalen=1023
新浪周K：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=1200&ma=no&datalen=1023
新浪月K：https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh600519&scale=7200&ma=no&datalen=1023
新浪实时快照（worker必须补Referer: https://finance.sina.com.cn）：https://hq.sinajs.cn/list=sh600519,hk00700,gb_aapl,fx_susdcnh,hf_GC,nf_RB0
新浪期货1/5/15/30/60m：https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_RB0_5=/InnerFuturesNewService.getFewMinLine?symbol=RB0&type=5
新浪期货日线：https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_RB0_D=/InnerFuturesNewService.getDailyKLine?symbol=RB0
新浪外汇1/5/15/30/60m：https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_fx_susdcnh_5=/NewForexService.getMinKline?symbol=fx_susdcnh&scale=5&datalen=1023
新浪外汇日线：https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_fx_susdcnh_D=/NewForexService.getDayKLine?symbol=fx_susdcnh
深交所分时+均价（当日）：https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code=000001
深交所5/15/30/60m（cycleNum无效，每次最多约201点）：https://www.szse.cn/api/market/ssjjhq/getHistoryData?marketId=1&code=000001&cycleType=17&cycleNum=1
深交所15m：https://www.szse.cn/api/market/ssjjhq/getHistoryData?marketId=1&code=000001&cycleType=18&cycleNum=1
深交所30m：https://www.szse.cn/api/market/ssjjhq/getHistoryData?marketId=1&code=000001&cycleType=19&cycleNum=1
深交所60m：https://www.szse.cn/api/market/ssjjhq/getHistoryData?marketId=1&code=000001&cycleType=20&cycleNum=1
深交所日/周/月K（32/33/34，各最多201根）：https://www.szse.cn/api/market/ssjjhq/getHistoryData?marketId=1&code=000001&cycleType=32&cycleNum=1
上交所分时（仅HTTP，无均价；K线503）：http://yunhq.sse.com.cn:32041/v1/sh1/line/600519?select=time,price,volume&begin=0&end=-1
上交所快照：http://yunhq.sse.com.cn:32041/v1/sh1/snap/600519?select=code,name,last,change,volume,amount
中金所快照：http://www.cffex.com.cn/quote_IF.txt
中金所日线XML：http://www.cffex.com.cn/fzjy/mrhq/202610/20/index.xml
上期所日线JSON：https://www.shfe.com.cn/data/tradedata/future/dailydata/kx20261020.dat
Yahoo 5m（无ACAO，需worker）：https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m
```

### C. 不可用（本机实测）
```text
雪球分时：https://stock.xueqiu.com/v5/stock/chart/minute.json?symbol=SH600519&period=1d   # 400 error_code=400016
雪球K线：https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=SH600519&begin=1792454400000&period=day&type=before&count=-10&indicator=kline   # 400
网易日线：https://quotes.money.163.com/service/chddata.html?code=0600519&start=20260101&end=20261020   # 本机502
上交所K线：http://yunhq.sse.com.cn:32041/v1/sh1/kline/600519?select=date,open,high,low,close,volume&begin=20260901&end=20261020&period=day   # 503
大商所：http://www.dce.com.cn/publicweb/quotesdata/dayQuotesCh.html   # 412 WAF
郑商所：http://www.czce.com.cn/cn/DFSStaticFiles/Future/2026/20261020/FutureDataDaily.htm   # 412 WAF
exchangerate.host：https://api.exchangerate.host/latest?base=USD&symbols=CNY   # 需要access_key
```

## 4. 实测原始响应片段（每源一行，截断120字符）

> 均为Invoke-WebRequest实际返回体截断，换行已压平。GBK源中文在PowerShell控制台会显示乱码，字节本身有效。

```text
东财 kline 日K:      {"rc":0,"rt":17,"svr":181216787,"lt":2,"full":0,"dlmkts":"","dsc":"0","data":{"code":"600519","market":1,"name...
东财 trends2 A:      {"rc":0,"rt":10,"svr":181669475,"lt":2,"full":1,"dlmkts":"","dsc":"0","data":{"code":"600519","market":1,"trends":["2026
东财 trends2 HK:     {"rc":0,"rt":10,"svr":181669633,"lt":2,"full":1,"dlmkts":"","dsc":"0","data":{"code":"00700","market":116,"trends":["2026
东财 trends2 US:     {"rc":0,"rt":10,"svr":181669906,"lt":2,"full":1,"dlmkts":"","dsc":"0","data":{"code":"AAPL","market":105,"trends":["2026
东财 push2delay 5m:  {"rc":0,"rt":17,"svr":177542531,"lt":2,"full":0,"dlmkts":"8,10,128","dsc":"0","data":{"code":"600519","market":1,"name...
东财 外汇 5m:        {"rc":0,"...","data":{"code":"USDCNH","market":133,"name":"美元兑离岸人民币","klines":["2026-10-14 05:05
腾讯 A股分时:        {"code":0,"msg":"","data":{"sh600519":{"data":{"data":["0930 1321.01 154 20343553.75","0931 1328.00 1067 141545747.88
腾讯 A股5mK:         {"code":0,"msg":"","data":{"sh600519":{"qt":{"sh600519":["1","\u8d35\u5dde\u8305\u53f0","600519","1331.88","1324.97
腾讯 A股日K:         {"code":0,"msg":"","data":{"sh600519":{"day":[["2025-06-25","1439.110","1435.860","1449.200","1420.510","41050.000"]
腾讯 美股分时占位:    {"code":0,"msg":"","data":{"usAAPL.OQ":{"data":{"data":["  0"],"date":""},"qt":{"usAAPL.OQ":[],"market":[...]}}}}
腾讯 usMinute:       {"code":0,"msg":"","data":{"usAAPL.OQ":{"data":{"data":["0930 340.88 876283","0931 340.88 1879246","0932 341.86
腾讯 mkline HK:      {"code":-1,"msg":"param error","data":[]}
同花顺 A股分时:      quotebridge_v6_time_hs_600519_last({"hs_600519":{"name":"\u8d35\u5dde\u8305\u53f0","open":0,"stop":0,"isTrading":0,"rt":
同花顺 A股5m:        quotebridge_v6_line_hs_600519_31_last({"rt":"0930-1130,1300-1500","num":140,"total":9504,"start":"202512220935","year":...
同花顺 A股5m年文件:  quotebridge_v6_line_hs_600519_31_2026({"data":"202601050935,1356.98,1373.98,1362.98,1366.98,1000,...
同花顺 港股分时:     quotebridge_v6_time_hk_HK0700_last({"hk_HK0700":{"name":"\u817e\u8baf\u63a7\u80a1","open":0,"stop":0,"isTrading":0,"rt":
同花顺 美股分时:     quotebridge_v6_time_usa_AAPL_last({"usa_AAPL":{"name":"\u82f9\u679c","open":0,"stop":0,"isTrading":0,"rt":
新浪 A股5mK:        [{"day":"2026-09-11 13:50:00","open":"1275.960","high":"1275.960","low":"1274.270","close":"1274.500","volume":"36800"
新浪 A股日K:        [{"day":"2022-07-28","open":"1921.100","high":"1938.990","low":"1892.660","close":"1898.440","volume":"3486986"
新浪 hq快照(带Ref):  var hq_str_sh600519="XXXX,1321.010,1324.970,1331.880,1335.000,1316.140,1331.500,1331.880,3413565,4525398959.000
新浪 hq(无Ref):      HTTP 403
新浪 期货5m:         /*<script>location.href='//sina.com';</script>*/ var _RB0_5=([{"d":"2026-09-21 11:30:00","o":"3114.000","h":"3115.000"
新浪 外汇5m:         /*<script>location.href='//sina.com';</script>*/ var _fx_susdcnh_5=([{"d":"2026-10-20 14:50:00","o":"6.6782000000","l":"6.67
网易 日线:           HTTP 502（无响应体）
雪球 minute:         HTTP 400, body: {"error_description":"遇到错误，请刷新页面或者重新登录帐号后再试","error_code":"400016"}
上交所 分时:         {"code":"600519","prev_close":1324.9700,"highest":1335.0000,"lowest":1316.1400,"date":20261020,"time":162904,"total":266,"line":[[93000
上交所 K线:          HTTP 503（无响应体）
深交所 分时:         {"datetime":"2026-10-20 15:30","code":"0","data":{"code":"000001","name":"平安银行","close":"11.65","open":"11.62","now":"11
深交所 5m历史:       {"code":"0","data":{"code":"000001","name":"平安银行","picupdata":[["2026-10-14 14:20:00","11.53","11.51","11.50","11.54"
中金所 快照:         instrument,openprice,highest,lowest,lastprice,updown,bprice,bamount,sprice,samount,volume,position IF2611,4127.40,4149.80
中金所 日线XML:      <?xml version="1.0" encoding="UTF-8"?> <dailydatas> <dailydata> <instrumentid>HO2611-C-2475</instrumentid>
上期所 日线:         {"o_IMChangeDate":"20150813","showlength":"1","o_day":"20","o_weekday":"二","o_curinstrument":[{"OPENINTEREST":161053,"HIGHESTPRICE":109630
上期所 dailyTimePrice: {"showlength":"1","o_currefprice":[{"INSTRUMENTID":"CU2611","TRADINGSEGMENT":"D","REFSETTLEMENTPRICE":109070,"TIME1":"2026102010:15:00",...
Frankfurter:         {"amount":1.0,"base":"USD","date":"2026-10-20","rates":{"CNY":6.678}}
exchangerate.host:   { "success": false, "error": { "code": 101, "type": "missing_access_key", "info": "You have not supplied an API Access Key
Yahoo 5m:            {"chart":{"result":[{"meta":{"currency":"USD","symbol":"AAPL","exchangeName":"NMS","fullExchangeName":"NasdaqGS","instru
大商所/郑商所:        HTTP 412，body为阿里云WAF JS挑战页（含 _ts.cd / charCodeAt）
```

## 5. 免费 Python/命令行方案（未安装任何包）

> 本轮没有pip install。版本来自PyPI JSON，能力来自官方文档页面，不是本机运行结果。

| 方案 | 免费? | 需要key? | 分钟K能力 | 日/周/月 | 浏览器可用? | 备注/限制 |
|---|---|---|---|---|---|---|
| baostock 0.9.4 | 是 | **不需要**（匿名bs.login()） | **5/15/30/60分钟**，字段date,time,code,open,high,low,close,volume,amount,adjustflag；文档称1990-12-19至今；**分钟线不包含指数**；**没有1分钟** | 日/周/月，支持不复权/前复权/后复权 | 否 | Python通过私有socket连baostock服务器，只能服务端/桌面用；匿名登录但仍有服务端会话；复权为涨跌幅复权算法 |
| mootdx 0.11.7 | 是 | 不需要 | 通达信服务器可读1/5/15/30/60分钟、日线等 | 有 | 否 | Python直连通达信行情服务器；服务器列表/端口可能失效，IP白名单/连接数限制不确定；不适合生产前端 |
| akshare 1.19.1 | 是 | 不需要（多数接口） | 有大量分钟接口（东财/新浪/腾讯等聚合），但随上游变化 | 有 | 否 | Python>=3.11；本质爬虫聚合，上游改版/WAF就会断；继承东财IP封禁、新浪Referer等问题 |
| efinance 0.5.9 | 是 | 不需要 | 基于东财，支持股票/基金/期货分钟与日线 | 有 | 否 | 与东财push2同源，**同样会触发IP级WAF**；封装不改变限频风险 |
| tushare 1.4.29 | 部分免费 | **必须token** | 文档：股票1/5/15/30/60分钟；**600积分用户可试用分钟（请求2次）**；完整历史分钟为付费包（历史分钟单独2000元/年，每分钟500次、每次8000行） | 日/周/月有，部分需积分 | 否 | **不是零key**；免费额度/积分门槛会变；前端铁律下不可用 |

**结论：** 允许服务端/离线任务时，baostock是A股5/15/30/60分钟最省事的免key方案（但没有1分钟、没有指数分钟）；mootdx可补1分钟但稳定性存疑；akshare/efinance是聚合层，不解决上游WAF；tushare分钟不是免费零key。

## 6. 关键结论（给主报告交叉校验）
1. **A股分时+分钟K的最佳零key浏览器直连组合：同花顺+腾讯。** 同花顺 v6/time/hs_600519/last.js 是唯一同时给分时+均价线+15:05到15:30盘后固定价的免费直连源（ACAO=*，268点）；v6/line/hs_600519/{31,41,51,61}/last.js 给5/15/30/60/1分钟OHLC最近140根，年文件 /31/2026.js 给2026全年5m 9120根；5m历史约1年、1m约2个月。腾讯 mkline A股1/5/15/30/60m，实测上限800根（>800静默回320）；minute/query A股267点只有当日、含盘后固定价、无均价线字段。
2. **港股/美股：** 腾讯港股分时可用（332点到16:08）；美股 web minute 是 ["  0"] 占位，必须用 usMinute/query（当前时段54-71点）；**腾讯 mkline 对HK/US全部param error**。同花顺港股前缀 **hk_HK0700**（不是hk_00700/hk00700），分时342点、日/周/月/5m/15m/30m/1m都有；美股前缀 **usa_AAPL**，只有日线+1分钟，5m/15m/30m为空。东财A/HK/US的1/5/15/30/60m和日/周/月都可用，但分钟线只回最近约1个月（A约32个交易日；HK约23个、US约19个交易日），1m只回当日；fqt=0才是真实价。
3. **东财WAF是最大工程风险：** 本机22:16–22:49因连续长历史请求被IP级封禁约33分钟；解封后再次因密集请求被重置。表现是TLS层连接被意外关闭，不是HTTP 4xx；quote.eastmoney.com/datacenter-web仍200，**只有push2his/push2delay/push2行情API被封**。生产必须：单请求、小lmt、串行、≥3s间隔、指数退避、缓存、worker兜底；绝不要一次拉lmt=100000长历史。
4. CORS 分层比支持什么周期更重要。可直接用：腾讯、同花顺、东财 push2his（有 WAF 风险）、Frankfurter。必须 worker：新浪全部 K 线/期货/外汇/快照、深交所、上交所、中金所、上期所、Yahoo。不可用：雪球 400 需 token、网易本机 502 未验证、上交所 K 线 503、大商所/郑商所 412 WAF。
5. 新浪 K 线是无 ACAO 但最好用的 A 股备源：quotes.sina.cn 免 Referer、标准 JSON、一次 1023 根，scale 1/5/15/30/60/240/1200/7200 全支持；但浏览器读不到响应，必须 worker。hq.sinajs.cn 则必须新浪 Referer，浏览器 fetch 无法伪造，纯前端不可用。
6. 分时线不等于分钟 K 线：同花顺 time 是 时间,价格,成交额,均价,成交量(股)；东财 trends2 是 时间,开,收,高,低,量,额,均价；腾讯 minute 是 HHMM 价格 累计量 累计额；深交所 getTimeData 是 时间,价,均价,涨跌,涨跌幅,量,额。这些都不是 OHLC，字段顺序各不相同，不能混用解析器。
7. 上交所官方源在本项目不可用：分时仅 HTTP 32041（HTTPS 页面混合内容拦截）且无 ACAO、无均价；K线接口多次 503。深交所官方源可用但无 ACAO，且每次最多约 201 点、cycleNum 无效。两者都只能 worker。
8. 期货：东财 push2his 对 133.USDCNH、101.GC00Y、102.CL00Y、113.rbm、113.au2612、114.a2611、115.SA611 的 1m/5m/日线均实测成功（但随后被封）；期货分钟线必须 fqt=0，fqt=2 会把价格乘上复权因子。新浪国内期货 JSONP 1/5/15/30/60m 加日线均可用（1023根，无 ACAO，需 worker）。交易所官方只找到日线/快照，没找到免费官方分钟线；上期所 dailyTimePrice 名字像分时，实际每合约只有 2 个时间点，不能当分时。
9. 外汇：东财 133.USDCNH 的 1m/5m/日线可用（有 WAF 风险，分钟线 fqt=0）；新浪 NewForexService 1/5/15/30/60m 加日线可用（JSONP，无 ACAO，需 worker）；Frankfurter 只有日线（ACAO=星号）；exchangerate.host 已改为必须 access_key；Yahoo 有 5m 但无 ACAO。没有找到免费、免 key、浏览器直连的外汇分钟源（除东财）。
10. 逐笔 tick 没有免费直连源。所有分时都是分钟级价格点；雪球需要 cookie/token 且 400；交易所 Level-2 需要授权。若产品需要 tick，只能服务端采购或降级到分钟线。

## 7. 未测/未完成清单（如实记录）

- 东财 220.IF2611 中金所股指期货的 1/5/15/30/60/日线：WAF 封禁期间未完成，只有 suggest 确认 secid 存在。
- 东财 klt=102/103 对港股/美股的周/月：测到了数量（HK 1167/269，US 2199/506），但未逐根核对首尾日期之外的质量。
- 腾讯 mkline 的 m15/m30/m60 只测到 l=640，未测 800 上限下的最早日期；m1/m5 已测 800。
- 同花顺 91 的季线身份是按 102 根/25 年推断，未逐根核对周期；71 的身份未确定（表现为近 3 年日线变体）。
- 上期所分钟线、中金所分钟线、大商所/郑商所官方分钟线：均未找到可用免费接口；大商所/郑商所因 412 WAF 无法进一步探索。
- 网易接口：本机 502，未拿到任何响应，无法判断是下线还是网络问题。
- 雪球：未尝试注册/登录获取 token（任务要求不带 cookie 是否可用，结论是不可用）。
- akshare/efinance/mootdx 未安装、未运行，只核对了 PyPI 版本和官方文档能力。
- 所有 CORS 结论基于 Invoke-WebRequest 的响应头读取；未在真实浏览器里逐条跑 fetch。ACAO=星号或回显是强证据，但真实浏览器还受混合内容、CSP、Private Network Access 等影响（尤其上交所 HTTP:32041）。
