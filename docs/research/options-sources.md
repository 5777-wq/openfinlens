# 期权板块可行性调研 · 2026-10-22 实测

> 与主报告（README.md）同一方法论：所有结论来自真实请求实测，不是凭记忆整理。
> 判读规则（ACAO/Origin）沿用主报告 §7，此处不重复。
>
> 实测时间：**2026-10-22 12:40 ~ 13:10（UTC+8）**，本机国内网络直连；海外源
> （CBOE/Deribit/eapi/Yahoo）经本机代理 `127.0.0.1:7890` 出口验证——**只用于判定
> 服务端 CORS 行为，不代表国内用户可达**（与主报告同一诚实口径）。
> 本报告回答一个问题：在「纯静态前端、零 API key、浏览器直连优先」的约束下，
> 期权板块能不能做、做到什么程度、按什么顺序做。

---

## 0. 一分钟结论

**结论一：可行，且有一条「今天就能上线」的纯直连路线。**
中金所股指期权（IO 沪深300 / MO 中证1000 / HO 上证50）是唯一全链免费直连的 A股期权形态：
合约名规则可枚举（`IO2612-C-4000`）+ 东财 push2delay 批量报价（回显 CORS）+ 盘中实测有实时价。
不依赖 clist、不依赖 Worker、不加 key。

**结论二：美股期权数据面是三个市场里最好的，但要 Worker。**
CBOE 延迟行情（15 分钟）一个接口给全：**bid/ask/IV/持仓量/成交量 + 全套 greeks（delta/gamma/vega/theta/rho）+ 理论价**，
AAPL 3352 张、_SPX 29444 张。但无 ACAO → 浏览器直连封死，只能走 Worker
（`worker.js` 白名单加 `cdn.cboe.com` + `cdn-api.cboe.com` 两行；push2 其实在白名单里已经有了）。
注意 payload：AAPL 1.5MB、_SPX 13MB，**Worker 必须按到期日过滤后回传**，不能整包透传。

**结论三：加密期权零门槛，降级链 OKX → Deribit。**
两者都回显 Origin（实测带 `Origin: https://5777-wq.github.io` 都返回 `ACAO: <Origin>`）。
OKX 已是本站在用源（生产验证过可达性）；Deribit 数据更全（mark/OI/买卖价一接口全给），
但国内可达性与 Binance 现货同性质，只配当兜底。Binance eapi **无 ACAO**，剔除。

**结论四：本报告最大的一个反面结论——东财 clist 对期权市场位一律拒连。**
`fs=m:10`（上交所期权）/ `m:12`（深交所）/ `m:221`（中金所）在 push2delay 的 clist 上
全部 **HTTP 000（TCP 被重置）**，重试多次、组合 t: 参数都一样（A股/基金/板块的 fs 正常）。
含义：任何「期权合约列表页」的设计都**不能建立在 clist 之上**，链的发现只有两条路——
命名规则枚举（中金所，可行）或合约码段枚举（ETF 期权，可行但笨重，见 §2.3）。

**结论五：ETF 期权（50ETF/300ETF 等）是 A股里最难啃的一块，实时价只有 push2 主站有。**
push2delay 延迟镜像对 m:10/m:12 **只有静态字段**（昨收 f18 有值、现价 f2 恒为 "-"，
13:02 盘中复测确认）；push2 主站有实时价（现价/量/涨跌实测有数）且回显 CORS，
但本机直连不可达——好在 **push2 已在 worker.js 白名单里**，走既有 Worker 通道即可。

---

## 1. 三市场数据面矩阵

| 市场 | 品种 | 链发现 | 实时报价 | Greeks/IV | CORS 直连 | 结论 |
|---|---|---|---|---|---|---|
| A股·中金所 | IO/MO/HO 股指期权 | **命名规则枚举** | push2delay ulist ✓（回显） | 无（源不给，可自算近似） | ✅ | **P0，纯直连可上** |
| A股·上交所 | 50ETF/300ETF/500ETF/科创板ETF 期权 | 码段枚举（§2.3） | push2 才有（delay 只有昨收） | 无 | push2 需 Worker；delay 直连但无实时 | **P2，工程最重** |
| A股·深交所 | 300ETF/创业板ETF 期权（m:12） | 同上 | 同上 | 无 | 同上 | 并入 P2 |
| 美股 | 个股 + 指数期权（含 _SPX） | CBOE 一接口全链 | 延迟 15 分钟 | **全 greeks + IV + OI** | ❌ 无 ACAO → Worker | **P1，数据面满分** |
| 加密 | BTC/ETH 等 | OKX instruments / Deribit book_summary | 实时 | Deribit 有 mark/IV 待核 | OKX ✓ Deribit ✓（均回显） | **P0 可与中金所同批** |

---

## 2. A股期权：实测明细

### 2.1 市场位与命名规则（都经搜索接口 + ulist 双向验证）

| 交易所 | EM 市场位 | 合约代码形态 | 示例 | 名称规则可枚举 |
|---|---|---|---|---|
| 上交所 ETF 期权 | `10` | 顺序注册号 `10012441` | 50ETF购11月3000 | ❌（码号无规律） |
| 深交所 ETF 期权 | `12` | 顺序注册号 | 300ETF购11月4300（深市 159919） | ❌ |
| 中金所股指期权 | `221` | **规则名** `IO2612-C-4000` | 沪深300购26年12月4000 | ✅（品种×月×C/P×行权价网格） |

- 市场位来源：EM 搜索接口（`searchapi suggest`，`type=14` 会返回期权行，`MktNum` 即市场位）。
  中金所 = 221；上交所 ETF = 10；深交所 ETF = 12（实测「300ETF购11月」同时召回 m:10 沪 510300 与 m:12 深 159919 两套）。
- **中金所枚举法**：围绕指数点位生成行权价网格（近月 25 点一档、远月 50 点，实际以「生成一批 → ulist 批量问 → 存在即保留」探测，**不假设档距**），
  一次 ulist 可带 40+ secid，两三个请求即得单月全链。实测 `IO2612-C-4000`/`MO2612-C-7000`/`HO2612-C-2900`/`IO2611-P-3900` 全部有实时价（现价/涨跌%/量都有）。
- **ETF 期权没有这条路**：合约代码是上市顺序号（`10012437=购11月2800`、`10012441=购11月3000`，中间每 50 点 +1，
  但**分红除息后新挂的行权价（如 2650/2700）会追加在码段尾部**——10012537、10012637——不是按行权价排序）。

### 2.2 报价接口行为（这个差异是 ETF 期权难产的根源）

| 接口 | IO/MO/HO（m:221） | ETF 期权（m:10/12） | CORS |
|---|---|---|---|
| `push2delay ulist`（按 secid 批量） | ✅ 实时（盘中现价/涨跌/量/额） | ⚠️ **只有昨收 f18，f2 恒 "-"**（13:02 盘中复测） | 回显 Origin ✓ |
| `push2 ulist`（主站，本机直连不可达） | （未测，delay 已够） | ✅ **实时**（0.0077 / -13.48% / 量 8678，经代理实测） | 回显 Origin ✓（Worker 通道现成） |
| `push2his kline`（日K） | ❌ HTTP 000（期权合约无日K） | ❌ 同左 | — |
| `clist`（合约列表） | ❌ **HTTP 000 拒连** | ❌ 同左（结论四） | — |

其他被排除的路（都实测过）：
- **腾讯**：`qt.gtimg.cn/q=op10012441` → `v_pv_none_match`，不支持期权代码；
- **新浪**：`hq.sinajs.cn` Referer 门（主报告已判死）；
- **上交所官方** `query.sse.com.cn`：接口已改版（带 Referer 也只回 "SOA service is null"），且本就无 CORS；
- **搜索 API 组链**：`count=100` 只召回 12 行（同一月实际 30+ 档），**召回不全，不能当链发现用**。

### 2.3 ETF 期权的码段枚举方案（P2 的工程底牌）

实测 `ulist` 一次带 41 个连续 secid（`10.10012430..10012470`）全部返回合约名（`f14`），
购沽/月份/行权价全在名称里。方案：

1. 首次建链：批量探 `10.10000000~10.10099999` 中活跃段（ETF 期权目前总量约几千张，可按月增量探），
   按 `f14` 正则过滤「品种 + 月份 + 购/沽」→ 组出 T 链；**结果缓存一个交易日**（合约表只在开盘前变化）。
2. 刷新价格：只对链内 secid 发 ulist（一条链 ~100 合约 = 1~2 个请求）。
3. 实时价：delay 镜像没有（§2.2）→ 走 Worker 的 push2 通道；**没有 Worker 时诚实显示昨收 + 标注「延迟」**。

成本：首建链 20~40 个请求（一次性）、之后每轮 1~2 个。笨重但零 key、全在已验证的接口上。

### 2.4 字段缺口（接入时要补的）

- **持仓量（OI）**：ulist 的 f5/f6 是成交量/额；OI 字段未探明（premium 页有展示，大概率是未列入本次测试的 f 字段）——P0 接入时再探，探不到就不展示，不编数。
- **IV/greeks**：国内源都不给。展示层可自算近似（BSM，用无风险利率+隐含波动率反解），**但要标注「自行计算，非交易所口径」**；不自算就只展示价格/量，等 CBOE 那样的源（美股有）。

---

## 3. 美股期权：CBOE 延迟行情（数据面满分，Worker 前置）

```
https://cdn.cboe.com/api/global/delayed_quotes/options/AAPL.json
→ 307 → https://cdn-api.cboe.com/api/global/delayed_quotes/options/AAPL.json
→ 200，AAPL 1.5MB / 3352 张；_SPX.json 13MB / 29444 张（指数期权同样支持）
```

- **字段**（每张合约全给）：`bid/bid_size/ask/ask_size/iv/open_interest/volume/delta/gamma/vega/theta/rho/theo/change/open/high/low/last_trade_price/last_trade_time/percent_change/prev_day_close`。
  T 型报价、IV 曲面、greeks 热力图需要的一切都在，**且不需要自己算**。
- **延迟**：约 15 分钟（`delayed_quotes`，timestamp 与行情时间的差实测一致），展示层必须标注。
- **CORS**：无 ACAO（有 `vary: Origin` 但不回值，OPTIONS 预检也不回）→ 直连封死。**Worker 白名单加 `cdn.cboe.com` + `cdn-api.cboe.com` 两行**（307 跨子域，两个都加保险）。
- **payload 是最大的坑**：_SPX 13MB 一包全链全到期。Worker 端要做「按到期日过滤后回传」（合约代码里含 YYMMDD，如 `AAPL261023C00235000` = 2026-10-23 到期、行权价 235.000 的 Call，直接字符串切），单到期日回传可压到几十 KB。
- 对照组：Yahoo `/v7/finance/options/` 已退化为 **401 Invalid Crumb**（连数据都拿不到，不只是 CORS）；Nasdaq 无期权链。CBOE 是零 key 约束下的唯一解。

## 4. 加密期权：直连可用，降级链 OKX → Deribit

| 源 | 接口 | 实测 | CORS | 备注 |
|---|---|---|---|---|
| **OKX** | `/api/v5/public/instruments?instType=OPTION&uly=BTC-USD`（链）+ `/api/v5/market/tickers?instType=OPTION`（报价） | BTC-USD 期权 **1410 个合约**，instId 含到期日/行权价（`BTC-USD-261127-65000-C`） | 回显 ✓ | 已是在用源，生产可达性有验证；首选 |
| **Deribit** | `/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option` | **902 张**一包全给：bid/ask/**mark_price**/OI/最高最低 | 回显 ✓ | 数据比 OKX 概括（mark 定价口径）；国内可达性与 Binance 现货同性质 → 只配兜底 |
| Binance eapi | `/eapi/v1/ticker` | 1664 行 | ❌ **无 ACAO** | 剔除，不进直连清单 |

OKX tickers 的单合约 ticker（`/api/v5/market/ticker?instId=...`）含 mark/img/IV 字段（OKX 文档口径，本次未逐字段核验，接入时核对）——**先 tickers 全量后按需补单合约明细**的顺序最省请求。

---

## 5. 合规与产品形态（与现有板块对齐）

1. **「无成交量」红线不适用于期权板块**：那是 Polymarket 预测板块的专属约束（不外链交易平台、只展示隐含概率）。
   股票/基金板块本来就展示量/额；期权按**同一描述性行情口径**展示价格/涨跌/量/额/OI。
2. 期权是衍生品，**展示层要带固定口径**：「高风险品种 · 数据仅供参考 · 不构成投资建议」，
   并沿用 crypto 的内部开关模式（`?options=off`，小程序合规场景可整块隐藏）。
3. **不做什么**：不做策略推荐/胜率测算/回报模拟器（那会从「描述行情」滑向「投资建议」）；
   不外链任何开户/交易平台；IV/greeks 若自算必须标注「自行计算，非交易所口径」（CBOE 数据是官方口径可直接标源）。
4. UI 形态建议（对齐 TradingView）：**T 型报价**（左购右沽、中间行权价、按到期日切换）+
   主力月默认选中；中金所板块另给「认购/认沽 PCR 比例」这类描述性统计（数据即图表，不下结论）。

## 6. 落地建议（按投入产出排序）

| 档 | 内容 | 前置 | 工作量预估 |
|---|---|---|---|
| **P0** | 中金所 IO/MO/HO T 型报价（命名枚举 + push2delay ulist 实时） | 无（全直连） | 1~2 天（含 UI + 合规口径 + 开关） |
| **P0** | 加密期权（OKX instruments+tickers，Deribit 兜底） | 无 | 1 天（可并入 P0 同批） |
| **P1** | 美股期权 CBOE（Worker 加 2 个域名 + 按到期过滤转发）+ ETF 期权实时价（push2 走既有 Worker 通道） | 部署一次 Worker | 1~2 天 |
| **P2** | ETF 期权完整 T 链（码段枚举建链 + 缓存 + 无 Worker 时昨收降级） | P1 验证需求后 | 2~3 天，建议后置 |

**不要做的事**：不要把 clist 当期权列表接口（拒连，见结论四）；不要接 Yahoo 期权（401 + 无 CORS）；
不要让 Worker 整包透传 CBOE（_SPX 13MB 会打爆流量与首屏）；不要在没有「延迟」标注的情况下上 CBOE 数据（15 分钟延迟必须可见）。

## 7. 复现方式

```powershell
$UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
# 中金所期权实时（命名规则枚举 + 批量报价）
Invoke-WebRequest -Uri 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=221.IO2612-C-4000,221.MO2612-C-7000&fields=f2,f3,f5,f12,f14' -Headers @{'User-Agent'=$UA;'Origin'='https://5777-wq.github.io'}
# CBOE（需代理；注意 307 到 cdn-api）
Invoke-WebRequest -Uri 'https://cdn.cboe.com/api/global/delayed_quotes/options/AAPL.json' -Headers @{'User-Agent'=$UA;'Origin'='https://5777-wq.github.io'} -MaximumRedirection 2
# OKX 期权合约表 / Deribit 全链概要
Invoke-WebRequest -Uri 'https://www.okx.com/api/v5/public/instruments?instType=OPTION&uly=BTC-USD' -Headers @{'User-Agent'=$UA}
Invoke-WebRequest -Uri 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option' -Headers @{'User-Agent'=$UA}
# 反例：clist 对期权市场位拒连（HTTP 000）/ ETF 期权 delay 无实时 / 腾讯不认期权代码
Invoke-WebRequest -Uri 'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=6&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m%3A221&fields=f2,f12,f14' -Headers @{'User-Agent'=$UA}
```

> 主报告（README.md）的 CORS 判读规则与「可用性保质期」警告对本报告同样适用：
> 本报告结论的保鲜期按周计，接入前用上面命令重跑一遍再动工。
