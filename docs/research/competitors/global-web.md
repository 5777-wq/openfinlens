# 全球轻量行情聚合站 · 页面操作逻辑拆解

> 调研对象：Finviz（重点）、Yahoo Finance、Investing.com；简要覆盖 Koyfin、MarketWatch、Seeking Alpha。
> 调研时间：2026-10-21（北京时间 10:46–11:20，约 34 分钟，35 分钟时间盒内收尾并落盘）。
> 方法：直接请求 HTML（`Invoke-WebRequest` / `curl.exe`，Chrome UA）、读取官方帮助与定价页、下载前端 JS chunk 反查交互、Chrome headless 截图尝试。
> **证据标签**：`［实测］`= 本次直接抓到 HTML/接口/JS/截图；`［公开］`= 官网/帮助页/定价页明确写出；`［推断］`= 基于结构或第三方资料推断，未在本次实测中复现。
> 说明：Investing.com 与 MarketWatch 对普通请求反爬较强，部分页面仅 curl 携带完整浏览器头时返回 200；Finviz 在 headless 浏览器中被 Cloudflare 拦截，因此热力图的"观感"部分来自前端 JS 与数据树，不是截图目测。

---

## 0. 一句话定位

- **Finviz**：用"一张高密度表格 + 一张全市场热力图"把美股全市场压进一屏的**信息密度标杆**，免费版即可完成大部分筛选，靠延迟数据、广告和 Elite 订阅变现。
- **Yahoo Finance**：面向大众的**流量型行情入口**，行情、新闻、个人组合、筛选器都在一个超宽导航里，强调"什么都能查到"，而不是"一屏看尽"。
- **Investing.com**：**全球资产类别最全**的行情门户（股指/股票/商品/外汇/ crypto/债券/基金/ETF），用 InvestingPro 把 Fair Value、健康度、目标价、短周期技术信号切进付费墙。
- **Koyfin**：面向投研团队与投顾的**可定制 Bloomberg 轻量替代**，核心是图表、财务分析、筛选器、组合与客户报告，而不是公共流量。
- **MarketWatch**：**新闻驱动的行情页**，个股页以"价格 + 图表 + Key Data + 评级 + 新闻"编排，订阅与 Barron's 内容构成付费层。
- **Seeking Alpha**：**观点/分析内容平台**，行情只是入口，真正的商品是文章、Quant 评级与组合工具，付费墙切在"评级/全文"。

---

## 1. 首屏与信息架构

### 1.1 Finviz（详写）

**全局导航（［实测］首页/筛选器/个股页 HTML 一致）**

`Home | Stock Screener | Screener | ETF Screener | ETF | Maps | Charts | News | Groups | Insider | Futures | Forex | Crypto | Watchlist | Portfolio | Calendar | Pricing | Help`

- 一级导航 18 项，行情相关（Screener/Maps/Charts/News）与资产相关（Insider/Futures/Forex/Crypto）混排。
- **免费用户点 `Charts` 不进入图表页，而是弹 Elite 功能对话框**（HTML 中为 `javascript:window.openEliteFeaturesDialog?.('multi-charts', event)`）——这是一个很典型的"导航即付费墙"设计。［实测］
- 顶部常驻一条 Elite 促销条："Elite members get real-time data, technical charting, alerts, and no ads - starting at $24.96/mo. Try Elite for Free"。［实测］
- 搜索框在 Logo 右侧，宽约 380px，placeholder = `Search ticker, company or profile`。［实测］

**首页首屏（［实测］文本抽取，按 DOM 顺序）**

1. 一句市场总结："US stocks ended mixed with small caps and defensives leading…"
2. **市场宽度四组指标**：Advancing 65.3% (3664) / Declining 30.0% (1680)；New High 24.2% (112) / New Low 75.8% (351)；Above SMA50 30.1% (1684) / Below 69.9% (3910)；Above SMA200 38.2% (2136) / Below 61.8% (3458)。
3. 左右两栏异动榜：Top Gainers / Top Losers / New High / New Low / Overbought / Oversold / Unusual Volume / Most Volatile / Most Active / Upgrades / Downgrades / Earnings Before / Earnings After / Insider Buying / Insider Selling。每张榜约 5 行（同一模块内可并排多列，故文本流会连续出现多组 `Ticker | Last | Change % | Volume | Signal`）。
4. **S&P 500 - 1 Day Performance 热力图**（首页内嵌，非独立页）。
5. Headlines 新闻流（时间 + 标题，来源混合 Reuters/Barron's/CNBC/Investing.com 等）。
6. Major News 个股涨跌条（SPCX/NVDA/TSLA/NFLX/META/…）。
7. Recent Quotes（指数/期货/外汇/债券等行情条）。
8. Economic Events（日期/时间/Impact/Releases/Actual/Expected/Prior）。
9. Earnings（按日期列公司）、Insider Trading 两张表。
10. 右下角："**First Time Here? Watch the Guided Tour**" + Close。

→ 首页信息架构可以概括为：**市场宽度 → 异动 → 热力图 → 新闻 → 宏观事件 → 财报/内部人**。首屏在 1080p 下大约能看到"宽度 + 2~3 张异动榜"，热力图需要下滚。［推断，基于 DOM 顺序与常见 1080p 视口］

**Screener 首屏（［实测］）**

从上到下：

1. 一条控制条：`My Stock Presets | Order by [None] [Asc] | Signal [None (all stocks)] | Tickers [____] [→] | Filters`。
2. 筛选器面板（默认展开）：6 个筛选 tab（Descriptive / Fundamental / Technical / News / ETF / All）+ 22 个常用字段，每个字段是 `label + 下拉`，默认值都是 `Any`。
3. 视图 tab（15 个）：`Overview | Valuation | Financial | Ownership | Performance | Technical | Custom | Charts | Tickers | Basic | TA | News | Snapshot | Maps | Stats`。
4. 结果工具条：`#1 / 5607 Total`、`Auto refresh: Off`、`Add to Compare`、`Set Alert`、`Export`、页码 `1 / 281`。
5. 表格：默认 **20 行 × 11 列**（Overview 视图），行高 20px，字号 12px。
6. 底部分页：`Previous | 1 2 3 4 5 6 7 … 281 | Next | Go to [ ]`。

→ **Screener 页的默认落地不是一张"干净的结果表"，而是"筛选器 + 结果表"同屏**；筛选器和结果之间只隔一条视图 tab，几乎无纵向浪费（除了一个大广告位，见第 9 节）。［实测］

**个股页首屏（［实测］ `quote.ashx?t=AAPL`）**

- 价格头：`AAPL | Apple Inc | Last Close 339.50 | Oct 20 • 3:59 PM ET | -3.44 (-1.00%)`，右侧并列 `Aftermarket Close 338.00 | Aftermarket • 7:59 PM ET | -1.50 (-0.44%)`。
- 两级导航：**页面 tab**（Overview / Compare / Short Interest / Financials / Options / Latest Filings）+ **分类 chip**（Technology / Consumer Electronics / USA / Mega / NASD，全部链回 screener 带 `f=` 参数）。
- 一行上下文：`Peers: MSFT SONY GOOG HPQ DELL AVGO TSM AMZN NVDA META | Held by: VTI VOO IVV SPY VUG QQQ VGT XLK SPYM IWF`。
- 图表（约 990×446 的容器，`layout: 1h1v`，高 400）。
- **一大块财务/技术指标网格**（约 70+ 个字段，2 列排布，见 5.1）。
- 分析师评级表（Date / Action / Analyst / Rating Change / Price Target Change，约 20 行 + "Show Previous Ratings"）。
- 新闻流（时间 + 标题 + 来源）。
- 侧栏/底部广告位（见第 9 节）。

**Map 首屏（［实测］ HTML + JS chunk）**

- 整页即一张 treemap，无传统内容流；左侧 `Map Filter` 面板：市场类型下拉 + `Data type`（涨跌周期）下拉；顶部有 `Map / Bubbles / Matrix` 三视图切换、尺寸模式（Market / Equal）、设置（Why Is It Moving / Show Industry / Show ETFs / Fixed Sector Order / Colorblind）、Embed、Fullscreen。
- 地图下方/右侧是 legend（带 logo、可滚动）。
- 页面标题随市场类型变化：`S&P 500 Map` / `World Map` / `Dow Jones 30` / `ETF Map - Exchange Traded Funds` / `Stock Market Map`。［实测，请求 `t=sec/geo/sec_dji/etf/cap` 得到不同 title］

**Finviz 信息架构小结**

```
Home（市场总览）
├─ Stock Screener（核心，筛选+表格）
│   └─ 15 个视图（Overview/Valuation/.../Maps/Stats）
├─ ETF Screener / ETF
├─ Maps（Sector / World / Dow / Nasdaq / Russell / MarketCap / ETF / Themes / Crypto / Futures）
├─ Charts（免费=Elite 弹窗）
├─ News / Groups / Insider
├─ Futures / Forex / Crypto
├─ Watchlist / Portfolio / Calendar
└─ Pricing / Help（Guided Tour / Knowledge Base）
```

### 1.2 Yahoo Finance（简）

**导航（［实测］首页 HTML）**：`Home | News | Finance | Sports | More`；Finance 二级：`My portfolio | News | Markets | Research | Community | Personal finance | Videos | Crypto | AI | Network`。
**首页首屏**：顶部行情带（S&P Futures / Dow Futures / Nasdaq Futures / Russell 2000 Futures / 10-Yr Bond / VIX / Gold / Bitcoin USD / Crude Oil）→ 728×90 广告 → 头条新闻 + 股票代码涨跌条 → Top Stories / Markets & Economy / Tech & AI / Popular / Watch Now / More News。
**个股页**：左侧竖排 **11 个 tab**：`Summary | News | Chart | Conversations | Statistics | Historical Data | Profile | Financials | Analysis | Options | Holders`；主区价格 + 双行（收盘/隔夜）+ 图表；右栏 `Quote Lookup` + `Trending tickers` + 广告 + `Portfolios`（未登录显示 Sign in）。
**Screener 页**：`Equities` + "coverage that spans 50 regions, 10,000+ stocks" + 筛选 pill 行 + `Table View / Heatmap View` 切换 + 表格 + 右侧 Dock（可收起）。

### 1.3 Investing.com（简）

**导航（［实测］首页文本）**：`Markets | Indices | Stocks | Commodities | Cryptocurrency | Currencies | ETFs | Futures | Funds | Bonds | Certificates | My Watchlist | News | Analysis | Charts | Technical | Brokers | Tools | Academy`，共 19 项一级入口。
**首页首屏**：搜索框（`Search markets, news, analysis… Ctrl+K`）+ `Get 50% Off` + `Sign In / Free Sign Up` → 各地区/资产入口的巨型多列菜单 → 行情与新闻。
**指数页（SPX）**：代码切换（`US500 · Derived · Real-time` / `SPX · NYSE · Delayed`）→ 价格 `7,712.57 +21.84 (+0.28%) Closed` → `Day's Range / 52 wk Range` → 约 18 个 tab：`General / Overview / Components / Historical Data / Related Instruments / Chart / Streaming Chart / Interactive Chart / News & Analysis / News / Analysis & Opinion / Technical / Technical Analysis / Candlestick Patterns / Forum / Discussions / Recent Sentiments / User Rankings` → Overview 数据网格 → 多空投票。
**Screener 页**：`8,106 Stocks Found` + `Save My Screens` + 12 个筛选分类（Popular / Price / Valuation / Insights / Financials / Dividends / Growth / Returns / Risk / Technical / Efficiency / Profile）+ `Popular Screens`（20+，带历史收益）+ 结果表。

### 1.4 Koyfin / MarketWatch / Seeking Alpha（简）

| 产品 | 首屏/导航（证据） |
|---|---|
| Koyfin | 营销站导航：`Product \| Features \| Data Coverage \| Mobile App \| For Financial Advisors \| For Investors \| Pricing`；首屏 CTA `Sign Up For Free`；产品在 `app.koyfin.com` 登录后。［实测］ |
| MarketWatch | 顶部 `Investing \| Personal Finance \| Economy \| Market Data & Tools`；个股页 `Overview / Profile / Charts / Financials / Historical Quotes / Analyst Estimates / Options / Premium Tools`；右侧 `Latest News` 全量时间流。［实测］ |
| Seeking Alpha | `Home \| Stock Analysis \| Market News \| Market Data \| Sectors \| Dividends \| ETFs \| REITs \| Earnings \| Education \| Podcasts \| Videos \| Investing Groups \| Portfolios \| Find & Compare`；首页首屏是注册 CTA + 行情条 + Latest News / Trending Analysis / Trending News / In Case You Missed It。［实测］ |

---

## 2. 信息密度与排版

### 2.1 Finviz（详写）

**表格密度参数（［实测］ CSS）**

- `.fv-table { font-size: var(--text-2xs); font-variant-numeric: tabular-nums; }`
- `--text-2xs: .75rem`（12px）；`--text-2xs--line-height: 1.25rem`（20px）；`--fv-table-row-height: var(--fv-table-row-height-base)`。
- 即 **12px 字号 / 20px 行高 / 等宽数字**；按 900px 的内容高度算，理论上可放 **约 45 行**（900 ÷ 20），扣掉工具条/分页后约 **40 行**；但免费版默认只渲染 20 行/页。
- 数字列右对齐（`data-align="right"`），文本列左对齐；Ticker 列带 18×18 logo（失败回退首字母方块）。
- `font-variant-numeric: tabular-nums` 是"数字竖排对齐"的关键，Finviz 在表格级别统一设置，而不是逐列设置。［实测］

**Overview 视图 11 列（［实测］表头）**

`No. | Ticker | Company | Sector | Industry | Country | Market Cap | P/E | Price | Change % | Volume`

**6 个核心视图的列（［实测］逐个请求 `v=` 后解析表头）**

| 视图 | 列数 | 列 |
|---|---:|---|
| Overview (v=111) | 11 | No., Ticker, Company, Sector, Industry, Country, Market Cap, P/E, Price, Change %, Volume |
| Valuation (v=121) | 18 | No., Ticker, Market Cap, P/E, Forward P/E, PEG, P/S, P/B, P/C, P/FCF, EPS This Y, EPS Next Y, EPS Past 5Y, EPS Next 5Y, Sales Past 5Y, Price, Change %, Volume |
| Financial (v=161) | 18 | No., Ticker, Market Cap, Dividend, ROA, ROE, ROIC, Curr R, Quick R, LTDebt/Eq, Debt/Eq, Gross M, Oper M, Profit M, Earnings, Price, Change %, Volume |
| Ownership (v=131) | 15 | No., Ticker, Market Cap, Outstanding, Float, Insider Own, Insider Trans, Inst Own, Inst Trans, Short Float, Short Ratio, Avg Volume, Price, Change %, Volume |
| Performance (v=141) | 18 | No., Ticker, Perf Week, Perf Month, Perf Quart, Perf Half, Perf YTD, Perf Year, Perf 3Y, Perf 5Y, Perf 10Y, Volatility W, Volatility M, Avg Volume, Rel Volume, Price, Change %, Volume |
| Technical (v=171) | 15 | No., Ticker, Beta, ATR, SMA20, SMA50, SMA200, 52W High, 52W Low, RSI, Price, Change %, Change from Open %, Gap, Volume |

**颜色编码（［实测］ CSS class + data 属性）**

- Finviz 采用**美股惯例：涨绿跌红**。
- `--text-color-positive: var(--color-green-500)`、`--text-color-negative: var(--color-red-500)`；`.color-text.is-positive { color: var(--color-green-500) }`、`.color-text.is-negative { color: var(--color-red-500) }`。
- 表格单元格带 `data-tone="positive|negative"`，CSS：`.fv-table_cell[data-tone=positive]{color:var(--text-color-positive)}`、`[data-tone=negative]{color:var(--text-color-negative)}`。
- 注意：`data-tone` 不只用于涨跌幅。实测统计：Overview 视图里 `price` 与 `change` 两列按当日涨跌着色（positive 11 / negative 8）；Valuation 视图里 **PE、Forward P/E、PEG、P/S、P/B、P/C、P/FCF、EPS This Y、EPS Next 5Y 也带 `data-tone`**（如 PE 7.04 绿、PE 146.43 红；P/S 0.74 绿、P/S 10.61 红；EPS Next 5Y 105.16% 绿、-? 红）。即 Finviz 把"估值便宜/成长高"也编码成绿色、"贵/负增长"编码成红色。［实测］
- **着色阈值不是简单的">0 绿、<0 红"**：同为 P/E，34.06 与 38.67 未着色，7.04/5.89 绿，70.05/146.43 红。具体是按行业/板块中位数还是当前结果集分位数，**未验证（推断为相对同业的估值排序）**。我们的实现要明确规则并写进 tooltip，否则用户会把"红 P/E"误读为"亏损"。
- 涨跌/缺失：PE 缺失显示 `-`；涨跌幅 0.00% 不着色（如 AACI 的 `0.00%` 无 `data-tone`）。

**数字格式（［实测］表格文本）**

- 市值：**K/M/B/T 缩写 + 2 位小数**，如 `48.78B`、`98.45M`、`4954.72B`、`5.23T`（Investing 用 `$5.23T`，Yahoo 用 `4.955T`，MarketWatch 用 `$5T`）。
- 成交量：**千分位全写**，如 `1,978,715`、`59,924,010`；首页榜用 `58.09M`、`585.96K`（缩写）。
- 价格：2 位小数（BRK-A 这类高价股用 `809,555.00`，仍带千分位）。
- 百分比：2 位小数 + 符号，如 `1.83%`、`-2.11%`。
- 空值：`-`（不是 0，也不是 N/A）。
- 排序箭头：表头 `aria-sort="none|ascending|descending"`，实测 `o=-marketcap` 时 marketCap 表头为 `descending`，首行为 NVDA/AAPL/GOOG/GOOGL/MSFT/AMZN/TSM/SPCX/META/AVGO。［实测］

### 2.2 横向对比（密度）

| 产品 | 默认可见行 | 默认列 | 字号/行高 | 颜色 | 数字格式 |
|---|---:|---:|---|---|---|
| Finviz | 20（免费；Elite 可 100） | 11（Overview），最多 18 | 12px / 20px，tabular-nums | 涨绿跌红（美股惯例），PE 也着色 | K/M/B/T + 千分位 + `-` |
| Yahoo | 25 | 约 15 + Follow | 约 13–14px / 40–44px（宽松） | 涨绿跌红（截图：S&P +0.33% 绿、Dow -0.02% 红） | `4.955T`、`35,678,066`、`339.50 -3.44 (-1.00%)` |
| Investing | 约 20 | 15（其中 5 列值被 Pro+ 锁定） | 约 13px，行高较大 | 涨绿跌红［推断，未在截图中确认］ | `$5.23T`、`27.4x`、`-0.3%` |
| MarketWatch | 个股页为 Key Data 4×4 网格 | 16 个字段 | 约 14px | 涨绿跌红［推断］ | `$339.50`、`$5T`、`35.85M`、`65 Day Avg: 44.3M` |
| Seeking Alpha | 无传统表格，卡片流 | — | — | — | `+1.24%` 等 |
| Koyfin | 未知（登录后） | 未知 | 未知 | 未知 | 未知 |

> 结论：**同样 1080p 高度下，Finviz 能显示的行数约为 Yahoo 的 2 倍**（Finviz 行高 20px vs Yahoo 约 42–44px；Finviz 20 行 × 11 列，Yahoo 25 行 × 约 15 列，但 Yahoo 首屏还有行情带与广告占位）。列数上 Yahoo 更多，密度是两个维度的权衡。［推断，按 CSS 行高与截图估算］

---

## 3. 筛选 / 排序的操作逻辑

### 3.1 Finviz（详写）

**筛选维度总量（［实测］逐个请求 `ft=1..6` 解析 label）**

| 筛选 tab | 字段数 | 字段 |
|---|---:|---|
| Descriptive | 22 | Exchange, Index, Sector, Industry, Country, Market Cap., Dividend Yield, Short Float, Analyst Recom., Option/Short, Earnings Date, Average Volume, Relative Volume, Current Volume, Trades, Price $, Target Price, IPO Date, Shares Outstanding, Float, Theme, Sub-theme |
| Fundamental | 37 | P/E, Forward P/E, PEG, P/S, P/B, Price/Cash, Price/Free Cash Flow, EV/EBITDA, EV/Sales, Dividend Growth, EPS Growth This Year, EPS Growth Next Year, EPS Growth Qtr Over Qtr, EPS Growth TTM, EPS Growth Past 3 Years, EPS Growth Past 5 Years, EPS Growth Next 5 Years, Sales Growth Qtr Over Qtr, Sales Growth TTM, Sales Growth Past 3 Years, Sales Growth Past 5 Years, Earnings & Revenue Surprise, Return on Assets, Return on Equity, Return on Invested Capital, Current Ratio, Quick Ratio, LT Debt/Equity, Debt/Equity, Gross Margin, Operating Margin, Net Profit Margin, Payout Ratio, Insider Ownership, Insider Transactions, Institutional Ownership, Institutional Transactions |
| Technical | 20 | Performance, Performance 2, Volatility, RSI (14), Gap, 20-Day SMA, 50-Day SMA, 200-Day SMA, Change, Change from Open, 20-Day High/Low, 50-Day High/Low, 52-Week High/Low, All-Time High/Low, Pattern, Candlestick, Beta, Average True Range, After-Hours Close, After-Hours Change |
| News | 2 | Latest News, News Keywords |
| ETF | 1 | Held By |
| **All（去重）** | **82** | 以上 22+37+20+2+1 = 82 |

- **怎么组合**：所有筛选都是"字段 = 枚举/区间"的下拉，选完即进入 URL query 的 `f=` 参数，多个条件用逗号连接。实测 `screener.ashx?v=111&f=sec_technology,cap_large,fa_div_pos,sh_avgvol_o1000` 返回 45 只股票、3 页，筛选面板顶部出现 `Reset Filters`，且筛选 tab 上有计数徽标（Descriptive **4** … All **4**）；4 个已选字段的下拉值变成 Segment Technology / Market Cap Large ($10bln to $200bln) / Dividend Yield Positive (>0%) / Average Volume Over 1M，未选字段仍是 `Any`。注意：**Finviz 不在顶部列出可删除的 chip**，已选条件只能通过回看各下拉或看无结果页底部的 `Filters: cap:mega sh_price:u1` 摘要来确认。［实测］
- **是否立即刷新**：官方帮助写 "fast navigation, instant update"；实测每次改 `f=` 都是**整页 SSR 返回新结果**（首屏 HTML 直接含结果行），不是前端局部刷新。［公开 + 实测］
- **JS 依赖边界（重要）**：结果表与筛选结果都是 SSR 的，但 **筛选器的 27 个下拉全部是 `<button aria-haspopup="listbox">` + JS popover，静态 HTML 里 `<select>/<option>/role="option"` 的数量都是 0**。所以"无 JS 也能用"只对**读结果**成立，改筛选条件必须靠 JS（或手改 URL 的 `f=`）。这也意味着"改一个下拉是否立即提交"无法从静态 HTML 判断，**未在真实浏览器中验证**。［实测 + 未验证］
- **结果反馈**：工具条 `#1 / 45 Total`（当前页第 1 条 / 总命中 45），分页 `1 / 3`；无结果时表格 body 显示 `No Results` + `No stocks match the current screen.` + `Reset Filters`，底部还有 `Filters: cap:mega sh_price:u1` 的已选条件回显。［实测］
- **排序**：控制条有 `Order by [字段下拉] + [Asc/Desc]`；表头本身 `data-sortable="true"`，点击表头会写 `o=` 参数（升序 `o=marketcap`，降序 `o=-marketcap`），表头 `aria-sort` 同步。实测 `o=-marketcap` 首行 NVDA（5.23T）→ AAPL（4.95T）→ GOOG/GOOGL → MSFT → AMZN，排序生效。［实测］
- **Tickers 输入**：控制条有独立 `Tickers` 输入框 + 箭头提交按钮，用于"只看我给的这一串代码"，与 `f=` 筛选是两条并行入口。［实测］
- **Signal 下拉**：默认 `None (all stocks)`，可切到 Top Gainers / New High / Overbought / Unusual Volume / Upgrades 等首页同款信号。［实测，控件存在；选项全集未展开］
- **Presets**：`My Stock Presets` 下拉 + 编辑按钮；官方定价页写免费 50 个、Elite 无限。［实测控件 + 公开］
- **分页**：`?r=21` 即第 2 页（每页 20）；`Go to` 输入框可直接跳页；免费 20 行/页，Elite 100 行/页（官方对比表：Free 20/36/10，Elite 100/120/50，分别对应 rows/charts/snapshots）。［实测 + 公开］
- **批量动作**：`Add to Compare`（免费点进去是 Compare 的 Elite 推广页）、`Set Alert`、`Export`。实测直接请求 `POST/GET /api/v1/screener-export-csv` 返回 `{"status":"success","data":[]}`——免费用户拿到空数组，导出是 Elite 功能。［实测］
**15 个视图 tab 与 `v=` 映射（［实测］ tab 的 href）**

| 视图 | `v=` | 列是否实测 | 用途（推断/公开） |
|---|---:|---|---|
| Overview | 111 | 11 列，已实测 | 默认视图；代码/公司/行业/市值/PE/价格/涨跌/量 |
| Valuation | 121 | 18 列，已实测 | 估值倍数 + EPS/Sales 增长 |
| Financial | 161 | 18 列，已实测 | 分红/ROA/ROE/ROIC/负债/利润率 |
| Ownership | 131 | 15 列，已实测 | 内部人/机构/流通/做空 |
| Performance | 141 | 18 列，已实测 | 多周期涨跌 + 波动率 + 相对成交量 |
| Technical | 171 | 15 列，已实测 | Beta/ATR/SMA/52W/RSI/Gap |
| Custom | 151 | 未实测 | 自选列（Elite 保存） |
| Charts | 211 | 未实测 | 每行一个小图表（官方定价：Free 36 / Elite 120 charts per page） |
| Tickers | 411 | 未实测 | 纯代码列表，最轻的视图 |
| Basic | 311 | 未实测 | 基础版概览 |
| TA | 351 | 未实测 | 技术分析视图（信号/形态） |
| News | 321 | 未实测 | 新闻列视图 |
| Snapshot | 341 | 未实测 | 每行一组缩略指标（官方定价：Free 10 / Elite 50 snapshots per page） |
| Maps | 711 | 未实测 | 结果集热力图 |
| Stats | 611 | 未实测 | 统计视图 |

→ 这套"同一筛选结果 × 15 种呈现"的设计，是 Finviz 密度之外最值得注意的一点：**筛选只做一次，视图随时换，URL 里 `f=` 与 `v=` 正交**。我们的实现应当把 `filters` 与 `view` 拆成两个独立状态，而不是每换一个视图就重置筛选。

**一条典型操作路径（［推断］基于 URL 与链接关系）**

`首页看到 Top Gainers → 点 Signal 进 Screener（带 signal 参数）→ 在 Screener 加 Sector/市值/股息筛选 → 切到 Technical 视图按 RSI 排序 → 点 ticker 进个股页 → 用 Peers 横向比 → 加 Watchlist`

这条路径上 Finviz 只用了 3 次页面跳转、0 次弹窗（免费版除 Elite 推广），这是它"快"的体感来源。对照 Yahoo：首页 → Markets → Screener → 个股 → Statistics，同样是 3–4 跳，但每页都要等 React 水合与广告加载。［推断，基于两边的页面重量与渲染方式］

### 3.2 Yahoo Finance（简）

- 默认已带 1 个筛选：`Region / United States`，工具条显示 `Equity Filters (1)`。
- 筛选 pill 行：`Region / Market Cap (Intraday) / Price (Intraday) / Sector / Industry / Index`；`Explore and add more filters` 打开筛选面板，`Done` 关闭。
- 结果表有 `Table View / Heatmap View` 切换、`Customize`（列定制）、`Save`、`Download`、`Follow`。
- 实测默认 25 行，列约 15 个：`Symbol, Name, 1D Chart(sparkline), Price, Change, Change %, Volume, Avg Vol (3M), Market Cap, P/E (TTM), 52 Week Range, Region, Sector, Industry, Index`。
- 排序交互未实测（HTML 中表头未暴露 `aria-sort`）；筛选组合是否即时刷新未实测（页面为 Next.js 流式渲染，`data-testid` 丰富但本次未驱动 JS）。标记［未验证］。

### 3.3 Investing.com（简）

- 筛选分类 12 个：`Popular / Price / Valuation / Insights / Financials / Dividends / Growth / Returns / Risk / Technical / Efficiency / Profile`；默认展示 `Market Cap / Last Trade Price / Dividend Yield (%) / PEG Ratio` 等少量字段，`More Filters` 展开更多。
- `8,106 Stocks Found` 实时计数 + `Save My Screens` + `Filters Applied 0`。
- `Popular Screens`：Technical Titans +98.3%、Insider Favorites +49.8%、Momentum Masters +47.5%、Under $10/share +43.5% 等，每个都带历史收益，点击即套用预置条件。［实测］
- 结果表列：`Company Name, Exchange, Sector, Industry, Market Cap, P/E Ratio, PEG Ratio, Last Trade Price, Day Change (%), Fair Value, Fair Value Upside, Fair Value Label, Analyst Price Target, Analyst Target Upside, Overall Health`。**其中 5 列直接显示 `Upgrade to Pro+`**（Fair Value / Fair Value Upside / Fair Value Label / Analyst Price Target / Overall Health），只有 `Analyst Target Upside` 免费可见（NVDA 显示 +51.9% Upside、AAPL 显示 -3.3% Downside），即"列存在但值被付费墙替换"。［实测］
- 排序/筛选即时性未实测（页面为 React，初始 HTML 已含 20 行结果）。

### 3.4 其余

- **Koyfin**：官方 Features 页写 "Incorporate over 5,900 filters"（股票筛选器）。［公开］具体交互未验证。
- **MarketWatch**：有 `Stock Screener / Market Screener / Mutual Fund Screener` 入口；个股页无筛选器。［实测导航］
- **Seeking Alpha**：有 `Stock Screener / ETF Screener / All Stocks / Top Rated / Top Growth / Top Value / Top Small Cap / Most Shorted / Strong Buy – Short Squeeze` 等预置筛选入口。［实测导航］具体筛选字段未验证。

---

## 4. 热力图 / 可视化

### 4.1 Finviz Map（详写）

**布局算法与数据（［实测］反编译 `map_base_sec` JS chunk）**

- 数据是一棵三层的树：`Root → Sector → Industry → Ticker`。
- 本次抓到的 S&P 500 树：**11 个板块、111 个行业、500 只股票**；每个节点 `{name, description, value}`，`value` 为市值（单位百万美元）。
- 例：`NVDA 5,836,056`、`AAPL 4,848,624`、`GOOGL 4,213,949`、`MSFT 3,957,816`、`AMZN 2,727,158`、`META 1,884,059`、`AVGO 1,783,858`、`TSLA 1,501,184`、`MU 1,211,297`、`LLY 1,094,915`（单位：百万美元）。
- **面积悬殊极大**：500 只股票最大/最小市值比 **868 倍**（NVDA 5.84T vs MOS 6.72B），Top 10 占全树 **40.8%**；板块层面 Technology 占 **39.6%**、Financial 11.2%、Communication 10.6%、Consumer Cyclical 9.4%、Healthcare 8.9%、Industrials 7.4%，Real Estate 仅 1.6%、Basic Materials 1.5%。这正是 Finviz 需要 `Equal Size` 开关的原因——否则小市值股在图上只有几个像素，点不中也看不清。
- **板块→行业→个股的数量**：Financial 11/70、Technology 11/88、Consumer Defensive 11/32、Consumer Cyclical 18/54、Communication 5/19、Healthcare 10/60、Industrials 19/75、Real Estate 9/30、Utilities 5/31、Energy 5/21、Basic Materials 7/20（格式：行业数/股票数）。
- 板块节点本身不直接给 value，由子节点聚合；行业同理。
- **面积代表市值**：`sizeMode = market | equal`，即默认按市值加权，`Equal Size` 开关把每个 tile 拉成等面积（用于看"板块内普涨/普跌"而不是"巨头主导"）。［实测控件 + 推断渲染逻辑］
- 层级：Sector → Industry → Ticker 三层嵌套；**没有独立的"下钻页面"**，双击板块/行业是跳转到 Screener 的过滤结果（见下），不是在地图内部 zoom 到下一层。滚轮 zoom / 拖拽 pan 是在同一层级里看细节。［实测交互表 + 代码路径］
- 版式观感：经典的 squarified treemap（Finviz 未暴露算法名，但 tile 为矩形、按面积切分、行业成组），板块之间用间隙/边框分隔；每块显示 ticker（以及可选 industry 标签、logo、涨跌幅）。［推断，基于 treemap 结构与截图不可得；"squarified" 为推断］

**颜色代表什么**

- 颜色 = **所选周期的涨跌幅**，不是市值、不是 PE。
- 周期下拉（实测 JS）：`1 Day / 1 Week / 1 Month / 3 Months / YTD / 1 Year`，默认 `1 Day`。
- 颜色方向：**涨绿跌红**（美股惯例）；提供 `Dark / Light / Colorblind` 三套 palette，`Colorblind Mode` 是设置项。［实测控件；具体色阶未截图验证］
- 颜色深浅随涨跌幅变化，但**是线性还是分段（阈值档位）本次未验证**；可确认的是 legend 存在（JS 中有 `Legend` 参数可 `?legend=false` 关闭、`legendLeading:"logo"`、`scrollableLegend`），且色板有 dark/light/colorblind 三套。［实测控件 + 推断映射规则］
- Elite 才有 intraday maps（官方定价表原文：Intraday maps — Free "Not Included"，Elite "Included"）。［公开］

**点击/悬停行为（［实测］ JS 中的 interactions 表 + `onNodeClick` 代码）**

| 操作 | 结果 |
|---|---|
| 双击 ticker | 打开 Stock Detail（`/stock?t=XXX`；实测代码实际拼 `/stock?t=`，而表格链接是 `/quote?t=`，两个路由都存在） |
| 双击 industry | Opens in Screener（`/screener?f=ind_xxx`） |
| 双击 sector | Opens in Screener（`/screener?f=sec_xxx`） |
| 悬停 ticker | 显示"主要竞争对手 + 3 个月历史"（tooltip/hover chart） |
| 鼠标滚轮 | Zoom in/out |
| 拖拽 | Pan when zoomed |
| 双击 country（World Map） | Opens in Screener（`f=geo_xxx`） |
| 双击 market cap tier | Opens in Screener（`f=cap_xxx`） |
| 双击 ETF | 进入 `/screener/etf?tickers=...` |
| 双击 theme/subtheme | Opens in Screener（`f=theme_xxx / subtheme_xxx`） |

- 代码里还有"单击"路径：`Click a sector / Click an industry → Opens in Screener`（用于 clusters 视图），说明单击与双击语义在不同视图下不一致，**这是可感知的摩擦点**。［实测代码，两种 handler 都存在］
- 无"右键菜单/固定到对比"等更深操作（未在 JS 中发现）。

**Map 的市场类型与视图（［实测］ JS 枚举）**

- 市场类型：`sec`（S&P 500）、`sec_dji`（Dow）、`sec_ndx`（Nasdaq）、`sec_rut`（Russell）、`sec_comp`（Nasdaq Composite）、`sec_all`（全市场）、`geo`（World）、`cap`（Market Cap）、`etf`（ETF）、`themes`、`crypto`、`futures`、`screener`、`portfolio`、`etf_holdings`、`managers_and_funds`、`groups`。
- 视图：`Map`（treemap）/ `Bubbles`（气泡）/ `Matrix`（矩阵）。
- 设置：`Why Is It Moving`、`Show Industry`、`Show ETFs`、`Fixed Sector Order`、`Colorblind Mode`；`Embed Map` 可生成 iframe 代码，**免费版只能嵌入 1-Day 地图**，Elite 可任意周期。［实测 + 公开］

### 4.2 其他产品的热力图

- **Yahoo Finance**：Screener 页有 `Table View / Heatmap View` 切换；全站还有 `Crypto Heatmap` 入口（`finance.yahoo.com/crypto/heatmap/`）。本次未截到 heatmap 的实际渲染，**布局/面积/颜色规则未验证**。
- **Investing.com**：导航里有 `Currencies Heat Map`、`Currency Volatility`；股票是否有 heatmap 未验证。
- **MarketWatch**：未发现股票热力图入口（首页是新闻流 + 指数条，个股页是单票图表）。
- **Koyfin**：官方 Features 未提 heatmap（提的是 market dashboards、charting、screener），**未验证**。
- **Seeking Alpha**：未发现热力图。

---

## 5. 个股页结构

### 5.1 Finviz（详写）

**编排顺序（［实测］文本流）**

1. 价格头（含 after-hours 第二行）。
2. 页面 tab + 分类 chip + Peers / Held by。
3. 交互图表（`#chart`，`min-width: 990px; min-height: 446px`）。
4. 指标网格（约 70+ 字段，连续排布、无分组标题，靠字段名区分）：
   - **公司/规模**：Index, Market Cap, Enterprise Value, Income, Sales, Book/sh, Cash/sh, Employees, IPO。
   - **分红**：Dividend Est., Dividend TTM, Dividend Ex-Date, Dividend Gr. 3/5Y, Payout。
   - **估值**：P/E, Forward P/E, PEG, P/S, P/B, P/C, P/FCF, EV/EBITDA, EV/Sales。
   - **偿债/流动性**：Quick Ratio, Current Ratio, Debt/Eq, LT Debt/Eq, Option/Short。
   - **盈利/增长**：EPS (ttm), EPS next Y, EPS next Q, EPS this Y, EPS next Y %, EPS next 5Y, EPS past 3/5Y, Sales past 3/5Y, EPS Y/Y TTM, Sales Y/Y TTM, EPS Q/Q, Sales Q/Q, Earnings, EPS/Sales Surpr.
   - **股东/做空**：Insider Own, Insider Trans, Inst Own, Inst Trans, Shs Outstand, Shs Float, Short Float, Short Ratio, Short Interest。
   - **技术**：SMA20/50/200, 52W High/Low, Volatility, ATR (14), RSI (14), Beta, Rel Volume, Avg Volume, Volume, Perf Week/Month/Quarter/Half/YTD/Year/3Y/5Y/10Y, Recom, Target Price, Prev Close, Price, Change %。
5. 分析师评级表（Date/Action/Analyst/Rating Change/Price Target Change）。
6. 新闻流（时间 + 标题 + 来源，含 "Loading…" 占位行）。
7. 广告位（见第 9 节）。

**图表能切哪些周期（［实测］ URL + `globalChartConfig`）**

- 服务器支持 `p=d`（日线）、`p=w`（周线）、`p=m`（月线），三者返回的 `globalChartConfig.charts[0].timeframe` 分别为 `"d" / "w" / "m"`。
- 默认 `p=d`，`scale: "linear"`，`premarket: 0`、`aftermarket: 0`，`chartEventVisibility` 打开 earnings/dividends/split/ratings。
- 图表编辑器：`editors: ["tools","ideas","publish","timeframe","settings"]`；`layout: "1h1v"`、`height: 400`、`scrollable: true`。
- **默认叠加**：`FinvizSettings.TA = {"style":"candlestick","overlays":[sma20, sma50, sma200, patterns],"indicators":[]}`——即默认蜡烛图 + SMA20/50/200 + 形态识别，指标列表默认为空。
- 周期全集（1D/5D/1M/3M/6M/YTD/1Y/2Y/5Y/10Y/MAX）在本次抓到的免费 HTML 中没有静态枚举，只有 `p=d/w/m` 三个服务端入口；更细的周期切换在 JS 图表菜单里，**未验证**。第三方评测称免费只有 Daily/Weekly/Monthly，Intraday（1min 起）为 Elite；免费图表类型为 Candle/Line/Advanced，Interactive/Performance 为 Elite。［公开（daytradingz 评测）+ 未验证］
- 第三方评测还指出"**免费图表没有 zoom**"、"Elite 也没有 tick chart"，以及"免费版几乎每个图表操作都会弹升级提示"。［公开评测］

### 5.2 其他产品（简）

| 产品 | tab/区块 | 图表周期 | 指标 |
|---|---|---|---|
| Yahoo | 左侧 10 个 tab：Summary / News / Chart / Conversations / Statistics / Historical Data / Profile / Financials / Analysis / Options / Holders | `1D 5D 1M 6M YTD 1Y 5Y All`（8 个）；`Chart Range / Bar` 切换；`Advanced Chart`、`AlphaSpace Chart` | 图表设置、Chart Type、比较、事件；具体指标列表未展开 |
| Investing | 约 18 个 tab（Overview/Components/Historical Data/Chart/Streaming Chart/Interactive Chart/News/Technical/…） | 技术页周期：1 Min（Unlock）/5 Min（Unlock）/15 min（Unlock）/30 Min/Hourly/5 Hours/Daily/Weekly/Monthly | RSI(14)、STOCH(9,6)、STOCHRSI(14)、MACD(12,26)、ADX(14)、Williams %R、CCI(14)、ATR(14)、Highs/Lows(14)、Ultimate Oscillator、ROC、Bull/Bear Power(13)；MA5/10/20/50/100/200（Simple + Exponential）；Pivot：Classic/Fibonacci/Camarilla/Woodie's |
| MarketWatch | Overview / Profile / Charts / Financials / Historical Quotes / Analyst Estimates / Options / Premium Tools | `1D 5D 1M 3M 6M YTD 1Y 3Y All`（9 个）+ Range 下拉 | 图表内 `$ / % / Vol` 切换；Advanced Charting；指标未展开 |
| Seeking Alpha | 文章页为主；个股页有 ratings/quant（多数锁定） | 首页行情条支持 `1D 5D 1M 6M YTD 1Y 5Y 10Y MAX` | 未验证 |
| Koyfin | 图表 / 财务分析 / 组合 / 报告（产品功能层） | 未验证 | 未验证 |

---

## 6. 搜索与跳转

### 6.1 Finviz

- **入口**：全站 header 的 `<form action="/search"><input name="p" placeholder="Search ticker, company or profile">`。［实测］
- **结果页结构**（实测 `search?p=apple`）：
  - 标题 `Results for "apple" in a company name • Open 6 items in Screener`
  - 表 `Ticker | Description | Sector | Industry | Country | Market cap`，6 行（AAPL、AAPX、AAPY、APLE、MLP、PAPL）。
  - 第二组 `Results for "apple" in a company profile • Open 23 items in Screener`，23 行，含 ETF（AAPB/AAPE…）和 AAPL，Description 列变成公司简介长文本。
  - 每组都有 "Open N items in Screener" 按钮，把结果集直接灌进 Screener。
- **召回逻辑（实测）**：
  - 大小写不敏感：`AAPL` 与 `aapl` 返回同样的 9 条。
  - 支持**子串**匹配：`nvid` → 4 条（NVDA 等）；`biotech` → 42 条（公司名/简介含 biotech）。
  - ticker 与公司名/简介是两套独立召回，所以 `AAPL` 会先命中一堆含 AAPL 的杠杆 ETF。
- **自动补全**：本次抓到的静态 HTML 中**没有** `role="listbox"` / `aria-autocomplete` / autocomplete 容器；搜索是传统 form submit。是否由 JS 注入下拉**未验证**。［实测 + 未验证］
- **直接跳转**：搜索结果行本身是链接，ticker 可直达 quote；但输入框不会"回车即跳个股页"，而是进结果页。ticker 不存在时 `quote.ashx?t=ZZZZZZ` 返回 **404**。［实测］

### 6.2 其他产品

- **Yahoo**：搜索框 placeholder `Search for news, tickers or companies`；底层 `https://query1.finance.yahoo.com/v1/finance/search?q=apple` 实测返回 7 条，排序为 AAPL（score 391556）→ Apple 股票期货 → 微型 Apple 期货 → APLE → AAPL.TO → APC.DE → AAPY，**ticker 精确匹配权重最高，其次才是公司名/衍生品/海外上市**。UI 自动补全调用该 API 属［推断］。［实测 API］
- **Investing.com**：搜索框 `Search markets, news, analysis… Ctrl+K`，有 `All Instrument Types` 下拉（Indices/Equities/ETFs/Funds/Commodities/Currencies/Crypto/Bonds/Certificates）和 "Please try another search" 空态；搜索结果页未验证。［实测搜索 UI］
- **MarketWatch**：全站 Search 打开 overlay，tab 为 `Symbols / News & Articles / Video / Podcasts / Authors / Columns`，并有分组空态 "No results found / No Results Found / All News Articles…"。［实测］
- **Seeking Alpha**：搜索 placeholder `Symbols, Analysts, Keywords`；搜索召回与跳转未验证。［实测 placeholder］
- **Koyfin**：站内搜索未验证（营销站无产品搜索）。

---

## 7. 付费墙切割

### 7.1 Finviz（详写，官方定价页 + 实测交叉）

**免费 vs Elite（［公开］Finviz Elite 页对比表）**

| 能力 | Free（注册/未注册） | Elite |
|---|---|---|
| 广告 | 有 | 无 |
| 布局自定义 | 不支持 | Homepage / Portfolio / Signals |
| 行情 | 延迟（官方 FAQ：NASDAQ/NYSE/AMEX 延迟 1 分钟；期货延迟 20 分钟；页脚写 futures/options delayed 15 min，存在口径不一致） | 实时 |
| 财务报表 | 3 年 | 8 年 |
| ETF 数据 | 有限 | 全量 |
| Screener 筛选器 | Basic | Advanced |
| 保存的 presets | 50 | 无限 |
| 每页条数（rows/charts/snapshots） | 20 / 36 / 10 | 100 / 120 / 50 |
| 自动刷新 | 3 分钟 | 10 秒 |
| 交互图表 | 不支持 | 无限 intraday charts |
| 多布局图表 | 不支持 | 12 charts |
| Chart ideas | 不支持 | 无限 |
| 图表模板 | 不支持 | 无限 |
| Magnifier | 不支持 | 支持 |
| Peers / held by / 相关性 | 不支持 | 支持 |
| Intraday maps | 不支持 | 支持 |
| 组合数 / 持仓数 | 50 / 50 | 100 / 500 |
| Compare 自定义时间范围 / 最多对比数 | 不支持 | 支持 / 25 |
| 提醒（股票/价格/筛选器/组合/日历） | 不支持 | 无限 |
| 导出 Excel/CSV | 不支持 | 支持 |

- 价格：**$24.96/mo（按年付 $299.50/年）**；月付 **$39.50/mo**；免费试用需信用卡，试用结束自动续费；30 天内可退款。［公开］
- 免费额外切割（实测）：
  - Screener 的 `Trades` 筛选项标注 `Elite only`。
  - `Export` 按钮存在，但 CSV API 返回空数组 `{"status":"success","data":[]}`。
  - `Charts` 导航点击弹 Elite 功能对话框。
  - `Compare` 页面是 "stock-compare-perf" 的 Elite 推广链接。
  - Map 的 `Embed Map` 免费只能 1-Day。
  - 首页/个股页多处 `data-fv-notice="elite-top-banner-anonymous"` 促销条。
- 免费仍可用的核心：Screener 全部 82 个字段的**查看与筛选**、15 个视图里的 HTML 可见部分、20 行/页、热力图日线、个股页全部指标、新闻、评级、内部人。**这是"免费可用，付费增强"的典型**。［实测］
- 注意口径冲突：官方定价表写"免费 = Basic 筛选器 / Elite = Advanced"，但免费用户实际能看到并组合全部 82 个字段（含 Fundamental/Technical 的增长、利润率、技术指标）。**"Basic/Advanced"到底差在哪，未验证**——可能是高级字段的区间输入、保存数量（50 vs 无限）或某些字段的实时值，而不是字段可见性本身。

### 7.2 其他产品（简）

| 产品 | 免费可见 | 付费/登录切割 | 证据 |
|---|---|---|---|
| Yahoo | 行情、个股页、Key Statistics、图表、新闻、Screener、25 行结果、Heatmap View | `Yahoo Finance Rating` 显示 "Rating available with Stock Picks access"；Portfolio 需登录；广告位 | ［实测］ |
| Investing.com | 首页/指数页/个股页概览、Screener 基础列（代码/交易所/行业/市值/PE/PEG/价格/涨跌）、Technical 的 30Min 以上周期 | Screener 的 5 列（Fair Value / Fair Value Upside / Fair Value Label / Analyst Price Target / Overall Health）显示 `Upgrade to Pro+`；Technical 的 1/5/15 Min 显示 `Unlock`；InvestingPro 推广、`Get 50% Off` 横幅 | ［实测］ |
| MarketWatch | 个股页价格、图表、Key Data、Performance、Analyst Ratings、新闻 | `Premium Tools` tab、Subscribe 入口、Barron's 内容（多次出现 Barron's 来源） | ［实测导航；具体哪篇/哪块被锁未验证］ |
| Seeking Alpha | 首页新闻、部分分析标题、行情条 | "In Case You Missed It" 每行 `Locked. Go Premium to see this view ratings`；`Create Free Account`；Premium / Alpha Picks / Quant Growth & Income / PRO 四档 | ［实测 + 公开导航］ |
| Koyfin | Free：2 年财务 + 1 年预测、My Portfolios、Advanced charting、Market & macro dashboards、2 watchlists & 2 screens、2 custom dashboards、有限 snapshots、有限新闻 | Plus $39/mo：10 年财务 + 10 年预测、ETF holdings、**Stock & ETF screener**、无限 watchlists/screens、无限 dashboards、10 万+ 全球公司 snapshots、新闻稿/公告/电话会/ premium news；Premium $79/mo；Advisor $209/$299 | ［公开定价页］ |

> 付费墙设计差异：
> - Finviz = **"延迟 + 广告 + 行数"** 三层，但**不锁字段值**。
> - Investing = **"锁单元格"**（保留列，值替换为 Upgrade to Pro+），视觉上最"满"也最打断阅读。
> - Seeking Alpha = **"锁行"**（列表照常展示标题，行尾挂 Locked）。
> - Yahoo = **"锁模块"**（Rating 模块单独锁）。
> - Koyfin = **"锁年限/数量/标的范围"**（2 年 vs 10 年、2 个 watchlist vs 无限）。

---

## 8. 新手上手

- **Finviz**：
  - 有 **Guided Tour**（首页 "First Time Here? Watch the Guided Tour" + Help → Guided Tour）和 Knowledge Base；每个筛选字段在帮助页有定义与公式（如 P/E、PEG、Float 的解释）。［实测 + 公开］
  - 表头有 `data-tooltip` / `aria-label`（如 `data-tooltip="Market Cap"`），说明有 hover 解释。［实测］
  - 没有 onboarding wizard、没有空状态引导；**空状态只给 "No Results / No stocks match the current screen. Reset Filters"**（够用，但不教用户为什么为空）。［实测］
  - 学习曲线是公开吐槽点："The amount of data can initially feel overwhelming"、"limited educational materials and no chatbot"、"not the most beginner-friendly due to its learning curve"。［公开评测 stockbrokers.com］
- **Yahoo**：
  - 默认 `Region = United States`，预置 Most Shorted / Most Active / Penny Stocks / Analyst Strong Buy 等 screener，降低首次使用门槛。
  - Screener 有 "Maximize screen space / Close the dock for a larger table view. Got it" 的首次提示；表格有 skeleton loader。
  - 未登录时 Portfolios 直接显示 "Sign in to access your portfolio"，是明确的空状态。
- **Investing.com**：
  - Screener 顶部有一段解释文案（"Make stock research easier… filter thousands of stocks by metrics like price, market cap, dividend yield…"）+ `Popular Screens`（带收益），对新手是"从模板开始"的路径。
  - 但一级导航 19 项、首页可见文本约 2.1 万字符，其中前 4,000+ 字符几乎全是多级导航，**首屏认知负担极高**。［实测］
- **MarketWatch**：
  - "Recently Viewed Tickers" 空态写得很好：`No Recent Tickers` + `Visit a quote page and your recently viewed tickers will be displayed here.`——**明确告诉用户下一步做什么**。［实测］
  - 个股页有 `Analyst Ratings` 的 Sell/Under/Hold/Over/Buy 五档条 + "Number of Ratings 46"，把抽象评级可视化为分布。
- **Seeking Alpha**：
  - 首屏就是 `Create Free Account` 双份 CTA；内容列表用 "Locked" 明示付费，不隐藏。
- **Koyfin**：
  - 营销站按角色分流（Financial Advisors / Research Teams & CIOs / Independent Investors / Asset Managers / Schools），每类一个 use-case 页；产品内 onboarding 未验证。

---

## 9. 可感知的摩擦点

### 9.1 Finviz

- **广告位多且大**（［实测］ HTML 中的 ad slot id）：
  - 首页：`IC_D_728x90_1`、`IC_D_88x31_1`、`IC_D_234x20_1`、`IC_D_88x31_2/3`。
  - Screener：`IC_D_728x90_1`、`IC_D_88x31_1`、`IC_D_3x6_1`（**970×315**，位于筛选器与结果之间）、`IC_D_1x1_1`。
  - 个股页：`IC_D_728x90_1`、`IC_D_88x31_1`、`IC_D_970x91_1`、`IC_D_3x6_1`、`IC_D_3x8_1/2/3`、`IC_D_300x250_1/2`、`IC_D_3x3_1`、`IC_D_1x1_1`，**共 11 个 slot**。
- **促销条 + 弹窗**：顶部 Elite 条常驻；Map 页 HTML 里直接有一段 "Ever heard of Finviz Elite?" 的模态文案（"Find out more -->"）；`Charts` 导航与 `Compare` tab 点击即弹 Elite 对话框。［实测 HTML + 公开评测提到 "ads and pop-ups"］
- **免费版图表被刻意做弱**：第三方评测原文："nearly every action prompted a message encouraging me to upgrade. The free charting was so restricted that it felt not worth using."［公开］
- **分页而非无限滚动**：5607 只股票 / 20 行 = **281 页**；虽然有 Go to 跳页，但跨页比较很麻烦。［实测］
- **数据延迟**：官方 FAQ 说 1 分钟，页脚说 futures/options 15 分钟，第三方评测又说 "delayed by up to 20 minutes"——**口径不一致本身也是摩擦**。［公开 + 实测页脚］
- **反爬/可用性**：headless Chrome 打开 Finviz 直接停在 Cloudflare "正在进行安全验证" 页面（截图失败）；普通 HTTP 请求则正常。对"分享链接给同事"或"自动化"场景不友好。［实测］
- **固定宽度**：首页 `<meta name="viewport" content="width=1205">`，Screener / 个股页 / Map 页为 `width=1024`，图表 `min-width: 990px`；移动端是缩放而不是重排。［实测］

### 9.2 其他产品

- **Yahoo**：
  - 页面重：首页 HTML 文本 96.8 万字符、个股页 97.5 万字符、Screener 129.9 万字符、Markets 110.5 万字符（均为解压后字符数，非网络传输字节）。［实测］
  - 广告：首屏 728×90 + 右栏 300×250；`data-testid="ad-container"`、`dock-mid-ad`、`dock-top-insert` 等多处。
  - 静态 HTML 里直接出现 `Oops, something went wrong` 的兜底文案，说明首屏对 JS/接口失败敏感。［实测］
  - 未登录时 Portfolios 是登录墙；`Yahoo Finance Rating` 是订阅墙。
- **Investing.com**：
  - 反爬最狠：`Invoke-WebRequest` 对首页/指数页/个股页全部 403；curl 带完整头 + `--compressed` 才 200；个股页 `apple-computer-inc` 即使 curl 也 403。［实测］
  - 广告/促销：`Get 50% Off` 顶栏、`Sign In / Free Sign Up`、`InvestingPro` 推广；HTML 中有 `ad-slot`/`banner`/`googletag`。
  - 表格"半张脸"：5 列的值被 `Upgrade to Pro+` 替换而不是隐藏列，阅读时不断被"锁"打断。［实测］
  - 导航巨大：首页可见文本约 2.1 万字符，其中前 4,000+ 字符几乎全是多级导航。［实测］
- **MarketWatch**：
  - 反爬：`Invoke-WebRequest` 返回 401；headless Chrome 显示"访问暂时受限 / 请完成验证"（截图）。curl 带完整头才 200。［实测］
  - 页面重：首页 HTML 文本 64.8 万字符、个股页 62.0 万字符（传输分别约 136 KB / 116 KB）；订阅 CTA 多处。
  - 新闻流默认"All Times Eastern"、右栏信息密度高，但主内容区被广告/订阅挤压。［实测文本流］
- **Seeking Alpha**：
  - 首页 HTML 文本 61.6 万字符；内容列表大量 `Locked. Go Premium to see this view ratings`，**每行都提醒一次**。［实测］
  - `Create Free Account` 在首屏出现两次（顶部 + 正文），注册墙前置。
- **Koyfin**：
  - 营销站信息很"销售导向"（Built by investors、See more in less time、AI summary 入口 "Ask ChatGPT/Claude/Gemini"），产品本体要登录 `app.koyfin.com`；**免费层功能边界清楚但看不到真实 UI**。［实测］

**公开吐槽来源（本次实际抓到的）**

- StockBrokers.com（2026-08-25 评测）："Free plans have annoying ads and delays in reporting market data."；"nearly every action prompted a message encouraging me to upgrade. The free charting was so restricted that it felt not worth using."；"The amount of data can initially feel overwhelming."；"limited educational materials and no chatbot."。［公开］
- DayTradingz（2026-05-20 评测）：Cons 列 "No zoom on interactive charts"、"Crypto coverage is limited to 15 coins"、"Price alerts are basic"、"No tick charts, even on Elite"；同时称 "Free version is genuinely useful, not crippled"、"Screener covers 60+ filters with no registration required"。［公开］
- Reddit/论坛原帖：本次 `reddit.com/search.json` 返回 **403**，**未能取得社区原帖**，故不引用。［未验证］

---

## 10. 对我们的可借鉴 / 不要学

### 10.1 值得抄（5 条，具体可执行）

1. **首屏放"市场宽度四组指标"，但标清分母**。照搬 Finviz 的 `Advancing/Declining`、`New High/New Low`、`Above/Below SMA50`、`Above/Below SMA200` 四组"百分比 + 家数"，每组一条横向双段条（绿左/红右 + 中间 50% 刻度）。注意 Finviz 自己口径不统一：`Advancing 65.3% (3664)` / `Declining 30.0% (1680)` 的分母是全市场 5607 只（3664/5607=65.3%，剩 4.7% 平盘），而 `New High 24.2% (112)` / `New Low 75.8% (351)`、`Above SMA50 30.1% (1684)` / `Below 69.9% (3910)` 的分母是各自这对之和（112/463=24.2%，1684/5594=30.1%）。直接并排画会让人误以为同尺度——我们要么统一分母，要么在每组旁边写"占全市场 / 占涨跌股"。
2. **把表格密度写成设计 token，别逐处调**：`font-size: 12px; line-height: 20px; font-variant-numeric: tabular-nums;`；数字列右对齐、文本列左对齐；市值统一 `K/M/B/T` + 两位小数；成交量千分位；缺失值统一 `-`；涨跌颜色由 `data-tone` 属性驱动而不是写死 class。这样 1080p 一屏可放 30+ 行，且中英文混排时数字不会左右跳。
3. **筛选状态、视图状态、排序状态三者正交，且全部进 URL**：`?view=overview&f=sec_technology,cap_large&o=-marketcap&page=2`。Finviz 的 15 个视图共用同一套 `f=` 筛选，换视图不丢条件；首屏 SSR 直接出结果行（无 JS 也能用）。这是它"快"的根本原因——不要为了"现代"把它做成必须等水合的 SPA。
4. **筛选 chip 化 + 结果计数 + 空状态三件套**：Finviz 只做到了"结果计数 + 空状态回显"，**没有做可删除的筛选 chip**（只有 tab 上的计数徽标 `Descriptive 4` 和 `Reset Filters`），已选条件得回看每个下拉才能确认。我们要补上这一环：顶部 `Filters (4)` + 每个条件一个可删除 chip + `Reset Filters`；结果条 `#1 / 45 Total`；无结果时 `No Results` + 回显当前条件（Finviz 的 `Filters: cap:mega sh_price:u1` 这个做法值得抄）+ 重置。这三样能显著降低"我到底筛了什么"的困惑。
5. **把热力图的交互语义固定成一套**：面积 = 市值、颜色 = 选定周期涨跌幅、hover = 主要竞争对手 + 3 个月走势、双击个股 = 详情、双击行业/板块 = 进筛选结果；另给 `Equal Size`（消除巨头主导）与 `Colorblind` 两个开关。Finviz 的 S&P 500 树里最大/最小市值差 **868 倍**、Top 10 占 40.8%、Technology 占 39.6%，没有 `Equal Size` 时小票只有几像素——我们必须提供这个开关，否则地图对小市值股不可用。

### 10.2 不要学（5 条，具体可执行）

1. **不要在筛选器与结果之间插 970×315 的大广告**。Finviz 的 `screener-split-ad` 正好卡在这个位置（宽 970 / 高 315），小屏会把首屏结果挤到折叠线以下。我们的做法：广告只放右栏或结果表底部，且默认折叠。
2. **不要让免费版每点一次图表就弹升级**。第三方评测原文："nearly every action prompted a message encouraging me to upgrade. The free charting was so restricted that it felt not worth using." 我们的做法：免费图表保留缩放、周期切换、1–2 个指标；升级提示只出现在"导出 / 提醒 / 实时数据"三个明确动作上，不打断浏览。
3. **不要做 281 页的分页**。Finviz 5607 只股票 ÷ 20 行/页 = 281 页，虽然有 `Go to` 跳页，但跨页比较几乎不可用。我们的做法：默认 50 行 + 虚拟滚动 / 加载更多，保留"跳页"作为兜底。
4. **不要用"锁单元格"占位**。Investing.com 把 5 列（Fair Value / Fair Value Upside / Fair Value Label / Analyst Price Target / Overall Health）的值直接替换成 `Upgrade to Pro+`，表格看起来像坏了。我们的做法：付费列默认隐藏，用户在 `Customize columns` 里主动勾选时才显示锁图标 + 一行说明，且**不占据默认视野**。
5. **不要把一级导航做成 18–19 项**。Finviz 18 项、Investing.com 19 项，用户站在首页不知道从哪开始；Finviz 还把 `Charts` 做成"点了弹 Elite 对话框"的导航项。我们的做法：一级不超过 7 项（行情 / 筛选 / 热力图 / 新闻 / 自选 / 组合 / 我的），其余进"更多"；导航项必须真的能到达对应页面。

### 10.3 一句话取舍

如果只能抄一件事：**抄 Finviz 的"筛选 / 视图 / 排序三态正交 + 首屏 SSR 出结果"**。它决定了产品是"一个能用的工具"还是"一个等加载的网页"。

---

## 11. 证据与未验证清单

### 11.1 实测 URL 与状态码

| URL | 状态 | 关键观察 |
|---|---:|---|
| `https://finviz.com/` | 200 | HTML 26.6 万字符；导航 18 项；首页宽度/异动/热力图/新闻/宏观事件 |
| `https://finviz.com/screener.ashx` | 200 | HTML 35.5 万字符；20 行 × 11 列；`#1 / 5607 Total`；`1 / 281` |
| `https://finviz.com/screener.ashx?v=111/121/161/131/141/171` | 200 | 6 个视图的列数 11/18/18/15/18/15 |
| `https://finviz.com/screener.ashx?v=111&ft=1..6` | 200 | 筛选字段：Descriptive 22 / Fundamental 37 / Technical 20 / News 2 / ETF 1 / All 82 |
| `https://finviz.com/screener.ashx?v=111&f=sec_technology,cap_large` | 200 | 结果 139 条；筛选 chip 生效 |
| `https://finviz.com/screener.ashx?v=111&f=sec_technology,cap_large,fa_div_pos,sh_avgvol_o1000` | 200 | 45 条 / 3 页；`Reset Filters 4` |
| `https://finviz.com/screener.ashx?v=111&f=cap_mega,sh_price_u1` | 200 | 空态：`No Results` + `No stocks match the current screen.` + `Filters: cap:mega sh_price:u1` |
| `https://finviz.com/screener.ashx?v=111&o=-marketcap` | 200 | 降序生效，首行 NVDA；`aria-sort="descending"` |
| `https://finviz.com/map.ashx` | 200 | HTML 4.9 万字符；标题 `S&P 500 Map`；页面 body 只有地图容器 |
| `https://finviz.com/map.ashx?t=geo/sec_dji/etf/cap/sec_all` | 200 | 标题分别为 World Map / Dow Jones 30 / ETF Map / Stock Market Map / Stock Market Map |
| `https://finviz.com/quote.ashx?t=AAPL` | 200 | HTML 28.1 万字符；价格头 + 6 个页面 tab + 70+ 指标 + 评级 + 新闻 |
| `https://finviz.com/quote.ashx?t=AAPL&p=d/w/m` | 200 | `globalChartConfig.charts[0].timeframe` 分别为 d/w/m |
| `https://finviz.com/quote.ashx?t=ZZZZZZ` | 404 | 不存在的 ticker 返回 404 |
| `https://finviz.com/search?p=apple` | 200 | 两组结果（6 + 23）；`Open N items in Screener` |
| `https://finviz.com/search?p=AAPL` / `aapl` | 200 | 均 9 条，大小写不敏感 |
| `https://finviz.com/search?p=nvid` / `biotech` | 200 | 子串召回 4 / 42 条 |
| `https://finviz.com/help/screener` | 200 | 官方帮助：每个字段的定义、Sorting/Export/Appearance |
| `https://finviz.com/elite.ashx` | 200 | 免费 vs Elite 对比表、价格、退款、数据延迟 FAQ |
| `https://finviz.com/api/v1/screener-export-csv` | 200 | `{"status":"success","data":[]}`（免费导出为空） |
| `https://finviz.com/assets/dist/map.v1.48645a21.js` | 200 | 139,653 字符；treemap 交互表、`onNodeClick` 路由、map 类型枚举 |
| `https://finviz.com/assets/dist/8119.v1.4af2431c.js` | 200 | 34,920 字符；S&P 500 树：11 板块 / 111 行业 / 500 tickers |
| `https://finviz.com/assets/dist/main.97cb7200.css` | 200 | `tabular-nums`、`data-tone` 颜色、`--text-2xs: .75rem`、行高 1.25rem |
| `https://finance.yahoo.com/` | 200 | HTML 96.8 万字符；行情带 + 新闻流 |
| `https://finance.yahoo.com/quote/AAPL/` | 200 | HTML 97.5 万字符；11 个 tab + 8 个周期 + 15 个 Key Data |
| `https://finance.yahoo.com/markets/` | 200 | HTML 110.5 万字符；Overview/World Indices/Futures/Bonds/Currencies/Options/Sectors/Stocks/Crypto/Private/ETFs/Mutual Funds |
| `https://finance.yahoo.com/research-hub/screener/equity/` | 200 | HTML 129.9 万字符；10,000+ stocks；25 行；15 列；Table/Heatmap 切换 |
| `https://query1.finance.yahoo.com/v1/finance/search?q=apple` | 200 | 7 条，AAPL score 391556 排第一；含期货/海外/ETF |
| `https://www.investing.com/` | 403（Invoke-WebRequest）/ 200（curl） | 传输 186 KB；20+ 一级导航；`Ctrl+K` 搜索；`Get 50% Off` |
| `https://www.investing.com/indices/us-spx-500` | 403 / 200（curl） | HTML 114.7 万字符（传输 176 KB）；`7,712.57 +21.84 (+0.28%)`；约 18 个 tab；486 components |
| `https://www.investing.com/stock-screener/` | 403 / 308→200（curl -L） | HTML 17.4 万字符；8,106 stocks；12 个筛选分类；5 列 Upgrade to Pro+ |
| `https://www.investing.com/technical/technical-analysis` | 200（curl） | HTML 23.4 万字符；1/5/15min Unlock；RSI/MACD/MA/Pivot 全套 |
| `https://www.investing.com/equities/apple-computer-inc` | 403（curl 也 403） | **未取得** |
| `https://www.marketwatch.com/investing/stock/aapl` | 401（Invoke-WebRequest）/ 200（curl） | HTML 62.0 万字符（传输 116 KB）；价格 + 9 个周期 + Key Data + 评级 + 新闻 |
| `https://www.marketwatch.com/` | 401 / 200（curl） | HTML 64.8 万字符（传输 136 KB）；Search overlay 6 个 tab；Latest News |
| `https://www.marketwatch.com/rss/topstories` | 200 | 可读 RSS（标题/时间） |
| `https://www.investing.com/rss/news_25.rss` | 200 | 可读 RSS（股票市场新闻） |
| `https://www.koyfin.com/` | 200 | HTML 37.5 万字符；营销站导航 + CTA |
| `https://www.koyfin.com/pricing/` | 200 | HTML 11.3 万字符；Free/Plus $39/Premium $79/Advisor $209/$299 |
| `https://www.koyfin.com/features/` | 200 | HTML 12.5 万字符；"over 5,900 filters"、market dashboards、watchlists、alerts |
| `https://seekingalpha.com/` | 200 | HTML 61.6 万字符；`Locked. Go Premium…`；`Create Free Account` |
| `https://seekingalpha.com/subscriptions` | 403 | 未取得 |
| `https://r.jina.ai/https://seekingalpha.com/` | 200 | 72,727 字符，完整导航文本（备用证据） |
| `https://r.jina.ai/https://www.marketwatch.com/investing/stock/aapl` | 200（内容为空） | 提示 "This page maybe requiring CAPTCHA" |
| `https://web.archive.org/web/...` | 429 | Wayback 限流，未取得快照 |
| `https://www.reddit.com/search.json?q=finviz` | 403 | 未取得社区吐槽原帖 |

**截图尝试（Chrome headless）**

| 页面 | 结果 |
|---|---|
| `finance.yahoo.com/quote/AAPL/` | 成功；可见价格 339.50 -3.44 (-1.00%)、图表 1D–All、Key Data 两列、右栏 Trending/Portfolios |
| `finviz.com/map.ashx?t=sec` | 失败：Cloudflare "正在进行安全验证" |
| `finviz.com/screener.ashx?v=111` | 失败：同上 |
| `www.investing.com/` | 失败：空白页（被反爬拦截） |
| `www.marketwatch.com/investing/stock/aapl` | 失败："访问暂时受限 / 请完成验证" |

### 11.2 未验证 / 只能标"推断"的清单

**Finviz**

- [ ] 搜索框是否有 JS 自动补全下拉（静态 HTML 无相关 ARIA，未在真实浏览器驱动）。
- [ ] 筛选器下拉是否 `onchange` 即提交（HTML 无 Apply 按钮；官方说 "instant update"，但本次未在浏览器点击验证）。
- [ ] Map 的实际渲染截图与色阶（被 Cloudflare 拦截；面积/颜色规则来自 JS 数据与交互表，**"squarified" 算法名为推断**）。
- [ ] 图表周期全集（免费 HTML 只有 `p=d/w/m`；1D/5D/1M/3M/6M/YTD/1Y/2Y/5Y/10Y/MAX 是否存在、免费/Elite 边界，来自第三方评测）。
- [ ] 免费版广告弹窗的**触发频率**（HTML 有 modal 容器，评测说"occasional pop-ups"，未量化）。
- [ ] 移动端实际断点行为（只看到 `viewport width=1024` 与 `min-width`，未截移动端）。
- [ ] `Trades` 之外还有哪些筛选项标 `Elite only`（只看到 Trades 一处）。
- [ ] Map 单击 vs 双击的行为差异（JS 中两套 handler 并存，未在浏览器复现）。

**Yahoo**

- [ ] 搜索框自动补全的 UI 交互（只验证了底层 search API 的召回与排序）。
- [ ] Screener 的排序、筛选组合、`Save`/`Download` 是否需要登录。
- [ ] Heatmap View 的实际布局/面积/颜色规则。
- [ ] 移动端导航与图表交互。

**Investing.com**

- [ ] 个股页 `apple-computer-inc` 内容（403，未取得）。
- [ ] 搜索的结果页与自动补全（只看到搜索框与 `All Instrument Types` 下拉）。
- [ ] 涨跌颜色是否绿涨红跌（未取得可目测的截图，按美股惯例推断）。
- [ ] `Popular Screens` 点击后的筛选参数与结果页。
- [ ] InvestingPro 的具体价格与试用条款（只看到 `Get 50% Off` 与 Pro 推广）。

**MarketWatch**

- [ ] 具体哪些内容/工具被订阅墙锁（只看到 `Premium Tools`、Subscribe、Barron's 来源）。
- [ ] 图表指标列表与交互（只看到周期与 `$ / % / Vol`）。
- [ ] 搜索结果页的实际召回（只看到 Search overlay 的 tab 与空态）。

**Seeking Alpha**

- [ ] 免费/付费的精确边界（只看到行级 `Locked` 与四档产品名）。
- [ ] Stock Screener 的字段与结果（未登录未展开）。
- [ ] 个股页 Quant 评级的可见性。

**Koyfin**

- [ ] 产品内真实 UI（登录墙后）：Screener 5,900 filters 的实际字段、图表周期、热力图是否存在、空状态、onboarding。
- [ ] Free 层是否能打开 Stock & ETF screener（定价页把 screener 列在 Plus 下，**"Free 只有 2 个 screen"与"screener 属 Plus"存在冲突，未验证**）。

**行业通用**

- [ ] 各站在中国大陆网络下的实际可达性/延迟（本次部分请求受代理与反爬影响，不能代表普通用户）。
- [ ] 广告的实际加载数量与遮挡比例（只统计了 HTML slot，未统计运行时填充率）。
- [ ] 移动端首屏行数/列数（未做移动端截图）。

---

*本文只写本次能确认的内容；凡是"看起来应该如此"但没抓到的，都已标为未验证或推断。*
