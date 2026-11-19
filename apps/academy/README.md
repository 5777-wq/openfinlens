<div align="center">

# 白话金融 · OpenFin Academy

**把美债收益率、黄金、纳指、原油、A股和 AI 产业链，讲成金融小白和宝妈听得懂的话。**

*Plain-language finance, in Chinese, for absolute beginners — US Treasury yields, gold, the Nasdaq, oil, A-shares and the AI supply chain, explained without jargon. Non-Chinese readers: there is an [English section](#english) at the bottom.*

**[在线体验 →](https://5777-wq.github.io/openfin-academy/)**

[![license](https://img.shields.io/badge/license-MIT-000?style=flat-square)](LICENSE)

零后端 · 零 API key · 零构建 —— clone 之后 `node scripts/serve.mjs 8765`，它就跑起来了

行情终端姐妹项目：**[OpenFinLens](https://5777-wq.github.io/openfinlens/)** —— A股 / 港股 / 美股 / 加密 / 全球事件，一块屏幕读完

<img src="docs/screenshots/home-desktop.png" alt="首页：报头、实时报价条、时代横轴、实时仪表、今日一词" width="100%">

</div>

---

## 为什么有这个项目

财经内容的问题不是信息太少，是**信息用错了语言**。

一个说"美债收益率上冲，全市场风险偏好收缩"的人，和一个说"美国借钱给别人要收的利息涨了，别的投资就变得不划算了，股票于是跌"的人，讲的是同一件事。区别只在后者能让一个没投过资的人听明白。

这个站想做的事只有一件：**把机制讲清楚，然后把数据摆在旁边让人自己看。**

- 每个数字都能点开看来源，没有"据说""业内普遍认为"
- 每场危机都能拖动时间轴回放，看到那一天各资产到底怎么了
- 每篇文章都写清数据截止日期
- **不荐股、不荐仓、不预测点位**——只解释机制、复盘历史、呈现真实数据

## 三个签名交互

### 时代横轴

首页的主导航不是一排栏目按钮，而是一条横跨 1987 到 2026 的时间轴。每个节点是一场真实发生过的危机或周期：悬停看一句话，点进去看完整复盘。

这个站的本质是「时间 × 资产 × 事件」，所以时间轴就该是它的门面。

### 危机回放器

多资产同步时间轴，**日频**。标普500、黄金、原油、美债10年、VIX 画在同一条轴上，拖动滑块就能看到任意一天各资产的反应，事件标注可点开。

日频不是炫技：月频会把崩盘日藏起来——1997 年 10 月恒指月末收 10623.78，但当月最低收盘只有 9059.89。**日频才能拖到那一天。**

2008 年最反直觉的一幕就是在这里被看到的：9 月 15 日雷曼倒闭当天，标普跌 4.71%，黄金却涨 2.94%、收于 787 美元。

**纵向必须看得出跌幅。** 每条轨道按它自己的最高、最低铺满整行，所以行与行之间可以直接比"跌了多少"。基准线取区间起点：线上方填涨色、下方填跌色（红涨绿跌），面积大小就是涨跌本身。峰值画金圈，从峰值到游标拉一条金色回撤段——那根斜线就是回撤。右栏三行：现价 / 较起点 / 距峰值；收益率一律用「个百分点」，价格用「%」，不混着写。

<img src="docs/screenshots/crisis-2008-desktop.png" alt="2008 危机回放器：五条资产同步时间轴，金色回撤段标出从峰值到雷曼当天的跌幅" width="100%">

### 术语抽屉

正文里的关键名词带金色虚线下划线。点一下，右侧滑出解释，**阅读位置不丢**。每条术语固定四段：一句话 / 一个比喻 / 一个真实数字 / 一个坑。

词条卡在「一句话」之后还多一段**名称由来**——「日经225」的 225 是 1950 年定下的样本股数量，成分股换了几轮但数字没变；「恒生指数」干脆没有数字，1969 年发布时 33 只成分股，到 2024 年 11 月已经 82 只。名字里的数字不等于现在的覆盖面，这是读指数最常踩的坑。

术语库现在有 **293 个词**，按十个分类排：研报数据 / 基金与策略 / 资产类别 / 期权与期权策略 / 宏观经济 / 基础概念 / 微观与行为 / 机构与人物 / 风险与交易 / 技术指标。每个分类配一张**速查表**（`#/data?cat=macro` 这种），一行一个词，看不懂某个数时不用在两百多条里翻；每张表前面还有「入门三词」，第一次接触这一类，先读这三个就够用。

每个词还有一条能直接发出去的链接：`#/term/<id>`（例：`#/term/gold`），落地就是那张四段式术语卡；`#/terms` 是完整术语库。行情终端那边鼠标挨着一个标的就浮出「这是什么」，点一下就跳到对应的术语页——两边共用同一套解释，不各说各话。

## 工具箱

数据不只摆在正文里，也做成能上手的东西：

| 工具 | 地址 | 做什么 |
|---|---|---|
| **资产对比** | `#/compare` | 任选 2–4 条序列、任意区间，归一化到同一起点，对比涨跌、波动、回撤与相关性 |
| **收益率曲线** | `#/curve` | 拖动年份看美债 / 中债曲线形状，10Y−2Y 与 10Y−3M 利差历史，倒挂区间标色 |
| **周期对照** | `#/analogy` | 2000 年互联网泡沫与本轮 AI 的六维打分对照 |
| **理财计算器** | `#/calc` | 通胀后的购买力、定投复利、房贷月供、跌后回本，全部本地算术 |
| **术语自测** | `#/quiz` | 从术语库随机出 5 道题（`?n=` 可加到 20），答错给「坑」的原文 |
| **收藏与记录** | `#/saved` | 收藏、最近阅读、路径进度；只存在本机，不上传 |
| **数据台账** | `#/status` | 每个数字回到它的文件：全站长历史序列的来源、覆盖范围与采集时间 |

标的详情页还带月线走势、水下回撤图与同区间对比。

## 七个栏目

| 栏目 | 内容 |
|---|---|
| **01 货币与利率** | 全站地基。为什么美债收益率是全球无风险利率，通胀怎么毁掉储蓄 |
| **02 危机复盘** | **1987 黑色星期一 / 1990 日本泡沫 / 1994 墨西哥比索危机 / 1998 亚洲金融危机与 LTCM / 2008 次贷 / 2020 疫情熔断 / 2022 暴力加息**——每场配一个日频回放器 |
| **03 标的百科** | **（114 只：指数 / A股 / 港股 / 美股 / 商品 / 利率）**，每只都能点开看真实历史读数（历史最高、历史最低、最大回撤、近一年涨跌）；旗舰标的另有专文，标的清单与行情终端是同一份 |
| **04 产业链图谱** | 10 条产业链 49 环节 177 只成分股，环节强弱实时算给你看 |
| **05 周期与镜鉴** | 本轮 AI 周期定位 + 2000 年互联网泡沫六维度对照 |
| **06 家庭理财** | 闲钱四分法、期限匹配、房贷怎么被利率影响。写给第一次认真管钱的人 |
| **07 读懂财报** | 三张表（利润表 / 资产负债表 / 现金流量表）各回答一个问题；PE、ROE、ROI 全是从三张表里算出来的 |

## 当前规模

<!-- AUTO:stats -->
| 术语 | 293 |
| 标的页 | 114 |
| 文章 | 134 |
| 危机复盘 | 7 |
| 产业链 | 10 条 / 49 环节 / 177 只成分股 |
<!-- /AUTO:stats -->

## 数据从哪来

**全部免密钥，官方或公开接口。**

| 品类 | 来源 | 说明 |
|---|---|---|
| 指数 / 商品 / 外汇 | 东方财富 `push2his` | 月线长历史，标普回溯到 **1986**、日经225 到 **1987** |
| 实时行情 | 东方财富 `ulist` | 浏览器直连，一次请求拿全报价条 |
| **VIX 恐慌指数** | CBOE 官方 CSV | 1990 年至今日频 |
| **美债收益率曲线** | 美国财政部官方 CSV | 1990 年至今，1M–30Y 全期限日频 |
| 产业链成分股 | 东方财富（secid 解析后落盘） | 177 只，全市场实时 |
| 事件 / 概率 / 持仓 | 复用 OpenFinLens 采集产物 | GitHub Actions 定时抓取 |
| 危机回放包日频 | 东方财富 / Yahoo Finance 备源 / CBOE / 美国财政部 | 7 场危机；东财不可达时自动换 Yahoo，产物与页面都写明来源 |

**危机回放包是日频的**（`data/history/crisis-*.json`）：月频会把崩盘日藏起来——1997 年 10 月恒指月末收 10623.78，当月最低收盘只有 9059.89。

海外源（财政部 / CBOE）**不在浏览器里请求**——采集脚本拉下来存成静态 JSON 提交进仓库，所以国内访问也不受影响。

产物全部登记在 [`data/series-map.json`](data/series-map.json)，正文只能引用注册表里的 id，杜绝"临时抓一个数就写进文章"。

## 快速开始

```bash
git clone https://github.com/5777-wq/openfin-academy.git
cd openfin-academy
# 用本地服务器打开（零依赖，正确处理 keep-alive）：
node scripts/serve.mjs 8765   # → http://127.0.0.1:8765
#
# 注意：不能直接双击 index.html。浏览器不允许 file:// 页面读取 JSON，
# 那样打开只会得到一个空页面（站里会提示你换成服务器打开）。
```

**没有 `package.json`、没有 `node_modules`、没有构建步骤。** 依赖只有 Node 本身，常用命令就这几条：

```bash
node _scripts/sync-core.mjs       # 从 OpenFinLens 同步共享代码到 vendor/
node _scripts/build-content.mjs   # content/*.md → data/content/*.json
node _scripts/collect-history.mjs # 拉长历史 → data/history/*.json
node scripts/reconcile.mjs 2008-09-15 SPX GC00Y   # 写文章时查准确值，别凭印象写数字
node _scripts/sync-docs.mjs       # README 里的词条数 / 标的数从数据里算，不手写
node _test/run-all.mjs            # 引擎 / 数据契约 / 内容契约
node _test/render-test.mjs        # 无浏览器渲染测试
node _test/a11y-test.mjs          # 焦点 / 对比度 / 按需加载
node _test/features-test.mjs      # 对比 / 曲线 / 对照 / 计算器 / 收藏 / 标签 / 自测
node _test/infra-test.mjs         # sitemap / manifest / SW / JSON-LD
node _scripts/gen-seo.mjs --check # sitemap 与 stats 产物是否同步
```

「当前规模」里的数字**不许手写**：`sync-docs.mjs` 从数据里算，CI 里跑 `--check`，对不上就红。

排障时给地址加上 `?debug=1`，页面左下角会显示启动轨迹，卡在哪一步一目了然。

## 键盘

| 键 | 作用 |
|---|---|
| `/` 或 `⌘K` | 命令面板（搜术语 / 文章 / 标的） |
| `?` | 快捷键面板 |
| `←` `→` | 危机回放器前后步进 |
| `T` | 切换日夜皮肤 |
| `G` 然后 `H` | 回首页 |
| `Esc` | 关闭抽屉 / 面板 |

## 与 OpenFinLens 的关系

| | OpenFinLens | OpenFin Academy |
|---|---|---|
| 形态 | 单页实时终端 | 多栏目内容站 + 交互式科普 |
| 回答 | 现在发生了什么 | 为什么是这样 / 这意味着什么 / 以前发生过什么 |
| 数据 | 实时轮询 + 静态 JSON | 实时 + 长历史 + 静态内容 |

**数据同源，视角互补。** 共享代码通过 `_scripts/sync-core.mjs` **单向**从 OpenFinLens 同步到 `vendor/`（记录上游 commit SHA，CI 校验），两站各自独立发布、互不耦合。

两站互相导流：OpenFinLens 顶栏指向本站，本站每个数据面板下方指向 OpenFinLens 的实时看板。

## 目录

```
openfin-academy/
├── index.html              # SPA 壳
├── css/                    # tokens / layout / components 三层
├── js/
│   ├── engine/             # 纯计算层：无 DOM 无网络，node 可测
│   ├── components/         # 签名交互：时代横轴 / 术语抽屉 / 回放器 / 产业链
│   ├── views/              # 各栏目视图
│   ├── sources/            # 数据源适配器（网络调用唯一合法位置）
│   └── site/               # 本站自研
├── vendor/                 # ← 从 OpenFinLens 自动同步，勿手改
├── content/                # Markdown 源（贡献者写这里）
├── data/                   # 产物：内容 JSON / 长历史 / 序列注册表
├── scripts/serve.mjs       # 零依赖本地静态服务器
├── _scripts/               # 同步 / 编译 / 采集
└── _test/                  # node 直跑测试
    ├── run-all.mjs        # 引擎 / 数据契约 / 内容契约
    └── render-test.mjs    # 无浏览器渲染测试（DOM 桩跑真视图）
```

## 写作与文档

每篇文章四段式术语卡、九项自检、免责声明位置固定。见 [docs/WRITING-GUIDE.md](docs/WRITING-GUIDE.md)。

架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · 数据源明细：[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)

## English

**OpenFin Academy** is a zero-backend, zero-build financial-literacy site that explains US Treasury yields, gold, the Nasdaq, oil, A-shares and the AI supply chain in plain Chinese — written for people who have never invested. Content is Chinese-first; this section is the map for non-Chinese readers.

**Why it exists.** The problem with finance content is not missing information — it's the wrong language. "Yields are surging and risk appetite is compressing" and "the interest America charges for borrowing went up, so other investments look worse, so stocks fell" are the same sentence; only the second one a beginner can understand. The site explains the mechanism, then puts the real data next to it — every number traceable to a source file, every article stamped with its data cutoff date, and no stock picks, no position advice, no price predictions.

**Signature interactions**

- **Era timeline** — the homepage's main navigation is a timeline from 1987 to 2026; every node is a real crisis or cycle. Hover for one line, click for the full replay.
- **Crisis replay player** — S&P 500, gold, oil, US 10Y and VIX on one synchronized, day-frequency timeline. Drag to any day and see what every asset did. Daily bars matter: in October 1997 the Hang Seng closed the month at 10,623.78 while its lowest close that month was 9,059.89 — monthly bars would hide the crash. On September 15, 2008 (Lehman), the S&P fell 4.71% while gold rose 2.94% to $787 — exactly the kind of counterintuitive day this player exists to show.
- **Term drawer** — key terms in articles carry a dotted gold underline; tap one and a four-part card slides in — one sentence, one analogy, one real number, one common trap — without losing your reading position. Every term has a shareable link (`#/term/gold`).

**Content & scale.** Seven columns — money & rates, crisis replays, asset encyclopedia, industry chains, cycles, family finance, reading reports. Day-frequency replay packs for **7 replayable crises**; an asset encyclopedia with detail pages for **114 tickers** with real historical readings (all-time high/low, max drawdown, one-year change); industry maps — **10 industry chains** with **49 segments** and **177 constituents**; and a glossary of **293 terms** across ten categories, each with a category cheat-sheet and three "start here" picks.

**Toolbox.** `#/compare` (normalized multi-asset comparison) · `#/curve` (US/China yield-curve shapes and spreads) · `#/analogy` (dot-com vs. AI cycle scoring) · `#/calc` (inflation, DCA, mortgage, drawdown-recovery calculators) · `#/quiz` (glossary quiz) · `#/saved` (local bookmarks) · `#/status` (data ledger — every number traces back to its file).

**Data.** Keyless public sources only: Eastmoney for index/commodity/FX history and live quotes, official CBOE CSVs for VIX, official US Treasury CSVs for the yield curve. Overseas sources are never requested from the browser — collector scripts fetch them into static JSON committed to the repo, so mainland-China access is unaffected. Every series is registered in `data/series-map.json`; articles may only reference registered ids.

**Quick start.** No build step, no `node_modules` — the only dependency is Node itself:

```bash
git clone https://github.com/5777-wq/openfin-academy.git
cd openfin-academy
node scripts/serve.mjs 8765   # → http://127.0.0.1:8765
```

Don't open `index.html` via `file://` — browsers refuse to fetch JSON from disk, and the page will tell you to use a server. Tests run on plain Node: `node _test/run-all.mjs` (engine / data / content contracts), plus render, a11y, features and infra suites in `_test/`.

**Related.** [OpenFinLens](https://5777-wq.github.io/openfinlens/) is the sister project: a single-screen live market terminal. Same data sources, different question — Lens answers *what is happening now*; Academy answers *why it works this way and what happened last time*. Shared code syncs one-way from Lens into `vendor/`, with the upstream commit recorded and verified in CI.

**Disclaimer.** Educational content only — not investment advice, no product recommendations, no market predictions. Data comes from third-party public APIs and may lag or err; past performance does not predict the future.

## 免责声明

本站只做金融知识科普，**不构成投资建议，不推荐任何具体产品，不预测市场走势**。

数据来自第三方公开接口，有延迟、会出错；历史不代表未来。据此决策，风险自负。

## License

[MIT](LICENSE)
