<div align="center">

# 🔭 OpenFinLens

**把散落在一堆免费接口里的全球行情、事件与资金，连成一条能读的市场线索。**
*Global prices, events and money flows — scraped from free public APIs, connected into one readable thread.*

**[线上体验 · Live Demo →](https://5777-wq.github.io/openfinlens/)**

![no build](https://img.shields.io/badge/build-none-000?style=flat-square)
![no npm](https://img.shields.io/badge/dependencies-0-000?style=flat-square)
![no backend](https://img.shields.io/badge/backend-none-000?style=flat-square)
![tests](https://img.shields.io/badge/tests-239_passing-2ebd85?style=flat-square)
![no keys](https://img.shields.io/badge/API_keys-0-000?style=flat-square)

</div>

---

## 这是什么 · What is this

一个单文件够不着、框架配不上的金融看板：A股 5000+ 只全市场热力图、三大市场情绪温度计、
K 线 + 技术面、产业链图谱、板块新闻、世界经济仪表盘——全部数据在**你的浏览器里**直连免费公开接口抓取。
没有服务器，没有数据库，没有 `node_modules` 黑洞。克隆下来，双击 `index.html`，它就活了。

> A financial intelligence terminal that refuses to have a build step: vanilla HTML/CSS/JS, zero dependencies
> (three vendored libs, no runtime CDN), zero API keys, everything fetched client-side from free public endpoints.
> Clone it, double-click `index.html`, done.

## 快速开始 · Quick start

```bash
git clone https://github.com/5777-wq/openfinlens.git
cd openfinlens
# 方式一：直接双击 index.html（所有数据源 CORS 全通，file:// 也能跑）
# 方式二：本地服务器
python -m http.server 8765   # → http://127.0.0.1:8765
```

## 都有什么 · Features

| | 功能 | 说明 |
|---|---|---|
| 🖥️ | **行情总览** | 10 个板块：全部 / A股 / 港股 / 美股 / 加密 / 宏观 / 事件 / 产业链 / 自选 / 基金对比；「全部」只做总览（指数 + 热力图），各板块只看自己（10s 轮询，红涨绿跌可切换）。**宽屏 ≥1280px 自动两栏密排**，同屏做跨市场对比 |
| 🎯 | **首屏（全部 tab）** | 上面是**全球核心指数**（上证 / 纳斯达克 / 标普500 / 恒生，每格带 60 日迷你走势线 + 当日振幅条），中间一条**全球涨跌概览**（N 涨 / N 跌 + 等权平均），下面是**我的自选**卡片网格（同样带走势线与振幅条、等权平均涨跌、一键跳自选页）；再往下是全球指数、热力图。空自选时给引导文案，不整块消失 |
| 🗺️ | **平面世界地图（事件页唯一地图视图）** | GDELT + 新浪7x24 事件按类别着色落点，Canvas 等距圆柱投影自绘（d3-geo + topojson 本地 vendor，禁运行时海外 CDN），拖拽平移 / 滚轮缩放 / 悬停提示 / 点击聚合簇展开清单。3D 地球版已于 2026-09 按用户决策移除（同屏信息量不如平面图） |
| ⚡ | **Event-on-Chart** | 宏观/央行/贸易/冲突事件与龙虎榜按日期画上 K 线（圆点 marker），点击弹出事件卡——把事件和价格反应放在同一屏 |
| 🧠 | **披露类资金（按市场归位）** | 原「聪明钱」独立 tab 已拆解到各市场：**席位动向 + 今日龙虎榜**在 A股 tab（席位可点进近 90 天档案）、**多机构 13F** 在美股 tab（伯克希尔/桥水/ARK/Pershing，可切换）、**南向资金持股**在港股 tab（日频）、**公开言论**在事件页。发言 ≠ 交易，口径严格分开 |
| 🔥 | **全市场热力图** | **A股 ~5500 只 / 港股 ~2900 只 / 美股 ~13800 只 / 加密 80 币**（港股/美股/加密各自一个 tab，与 A股 同一套逻辑），手写 squarify + canvas；滚轮以光标为锚缩放、拖拽平移、双指捏合、右键复位 |
| 📈 | **K线详情** | 分时/日/周/**月**，成交量副图，MA5/10/20/60 + EMA12/26 六线自由开关（localStorage 记忆） |
| 🧪 | **技术面面板** | RSI(14) · MACD(12,26,9) · KDJ(9,3,3) · BOLL(20,2) · ATR(14) · 量比 · 均线排列——每条都是日K手算，附常用读法，绝不荐股 |
| 🌡️ | **情绪与市场宽度** | **各市场放进各自的 tab**：A股 tab 底部是 A股（~5500 只）温度计、涨跌家数、七段分布、逐日快照走势；美股 tab / 加密 tab 各有自己的宽度卡（不再混在 A股 页里） |
| 🗺️ | **产业链图谱** | 10 条链 · 49 个环节 · 163 只成分股（逐一实测代码），环节强度 = 成分股涨跌幅实时均值 |
| 📡 | **今日热门概念** | 东财 500+ 概念板块实时涨幅榜 → 命中人工链条直接跳转，未命中展开领涨成分股兜底 |
| 📰 | **快讯 + 公开言论** | 快讯按产业链板块分类过滤；马斯克/特朗普/黄仁勋/奥尔特曼等 10 人发言聚合（新闻口径，诚实标注，住**事件页**的快讯子页） |
| 🌍 | **世界经济仪表盘** | 宏观板块独占整屏：世界银行 API，美中日德英法印韩 × GDP/增长/通胀/失业/债务/经常账户，列内色阶热图 |
| ⭐ | **自选 + 搜索** | 跨市场收藏（localStorage）、组合概览、按涨跌幅排序；搜索支持中文/代码/拼音 |
| 🆚 | **基金对比** | 最多 8 只任意标的（A股/港股/美股/ETF/指数）放在同一条时间轴上：**东财后复权价（含分红再投资）** 归一化曲线（各自起点 / 共同起点，归一 100 / 累计 % / 增长倍数，可切对数轴）+ 区间指标（总收益 / CAGR / 年化波动 / 最大回撤含峰谷日期 / 卡玛 / 夏普）+ 自然年收益矩阵 + 收益率相关性矩阵；区间最长到 2006 年（日线 5000 根上限），改动的选择实时写进 hash，复制地址就是分享这个对比。**数据源拿不到含分红口径时会明确降级成"价格收益"**（腾讯兜底源不含分红），绝不把价格收益当总收益糊过去 |
| ⌨️ | **细节** | 市场时段徽章（夏令时正确）、hash 深链、键盘 1-9/0 切 tab、`/` 搜索、`Backspace` 返回；加密内容有**内置合规开关**（默认开，界面无入口，`?crypto=off` 关闭后加密板块/行情/新闻/热力图整体隐藏，其余功能不受影响——微信小程序合规预留） |

## 它怎么工作 · How it works

```
浏览器（纯客户端）
├── sources/  每类数据一个适配器，统一输出 Quote 结构
│     主源 ──失败──▶ 备源 ──失败──▶ localStorage 缓存（带时间戳）
│                                    │
├── app.js    轮询调度（setTimeout 链）→ 增量 patch DOM，不整墙重建
├── treemap/charts/technical/events/compare/spark  纯函数计算层，全部可单测（20 组 239 条断言）
├── worldmap.js + bus.js  平面事件地图 ↔ K线 ↔ 资金，通过轻量事件总线联动
├── compareview.js + sources/history.js  基金对比（长历史取数 + 归一曲线 + 指标/年度/相关性）
└── 永不白屏：任何一层挂掉都是"降级角标 + 旧数据/骨架"，绝无弹窗报错
```

海外源（GDELT / SEC EDGAR / Polymarket）**不在浏览器里请求**：`.github/workflows/collect.yml` 每 5 分钟抓取、清洗、
去重、地理定位后提交一份静态 JSON，浏览器只读自己的数据——核心功能不要求用户能直连海外接口。
国内的新浪 7x24 快讯作为全球事件的第二来源（GDELT 不可达时的兜底），同样只走采集层。
Polymarket 概率每 30 分钟采集一次，**合规口径：只提取"事件发生概率"这一个数字，产物不含任何
平台链接与交易入口**，类别白名单只保留可能影响市场的央行/宏观/贸易/地缘/选举/能源。
**注意**：GitHub 对免费仓库的 schedule 高负载时延迟严重（实测 `*/5` 被拖成 4~6 小时一次），
要保证事件新鲜度请把采集搬到自己的服务器：见 [docs/SERVER-COLLECT.md](docs/SERVER-COLLECT.md)
（cron 每 2 分钟，端到端 2~5 分钟；GDELT 不可达时自动降级为新浪源）。
*Overseas sources are collected server-side (GitHub Actions) into a static JSON; the browser only
ever talks to its own data plus domestic endpoints.*

*Every data category goes through an adapter chain: primary → fallback → cached, with a tiny
badge telling you when you're not looking at live data. The scheduler is a `setTimeout` chain,
DOM updates are incremental patches, and nothing ever throws a blank screen at you.*

## 数据源 · Data sources（全部免密钥）

| 品类 | 主源 | 备源 | 兜底 |
|---|---|---|---|
| A股 / 港股 / 美股 / 全球指数 | 腾讯 `qt.gtimg.cn`（GBK） | 东财 `push2delay` | 缓存 |
| A股全市场（热力图/宽度） | 东财 `clist` 分页并发 | 腾讯精选 | 缓存 |
| 港股全市场（热力图/宽度） | 东财 `m:116+t:3,m:116+t:4`（~2900 只正股；裸 `m:116` 会混进 1.7 万条权证） | — | 缓存 5min |
| 美股全市场（热力图/宽度） | 东财 `m:105,106,107`（~13800 只全量） | — | 缓存 5min |
| 加密 | 币安 `data-api.binance.vision` | OKX | 缓存 |
| 外汇 / 商品 / 国债收益率 | 东财 secid（119/133、101-103、171） | 新浪（需代理） | 缓存 |
| K线 / 分时 | 腾讯 `ifzq`（前复权） | 东财 → 空态 | 不白屏 |
| 基金对比长历史（日/周/月，2006 至今） | 东财 `push2his`（**后复权，含分红**，单次 5000 根；直连带 CORS） | 腾讯不复权 K 线（`kline/kline`：A股周线 1084 根回到 2003、美股周线 1756 根回到 1993；**不含分红**，界面标注"价格收益"） | 诚实空态 + 熔断重试 |
| 概念板块榜 / 成分股 | 东财 `clist`（`m:90+t:3` / `b:BKxxxx`） | — | 隐藏榜单 |
| A股龙虎榜 / 席位 | 东财 datacenter-web（净买额榜 + 席位明细，CORS 直连） | — | 空态 + 重试 |
| 港股南向持股 | 东财 datacenter-web `RPT_MUTUAL_STOCK_HOLDRANKS`（日频 660 只，CORS 直连） | — | 内存缓存 |
| 全球事件 | **GDELT + 新浪7x24 → Actions 每 5 分钟采集** → 静态 JSON | localStorage 缓存 | 诚实空态 |
| 市场预测（事件概率） | **Polymarket Gamma API → Actions 每 30 分钟采集** → 静态 JSON（**只读展示市场隐含概率**，无链接无交易功能，类别白名单过滤） | 缓存 | 诚实空态 |
| 机构持仓 13F | **SEC EDGAR → Actions 每 6 小时采集** → 静态 JSON（**多机构**：伯克希尔/桥水/ARK/Pershing；季度披露，滞后 34~45 天） | 缓存 | 诚实空态 |
| 新闻 | 新浪 roll（JSONP） | 东财 `np-listapi` | 缓存 60s |
| 宏观年度指标 | 世界银行 `api.worldbank.org` | — | 缓存 24h |
| 搜索 | 东财 searchapi（中文/代码） | codetable（拼音） | 空态 |

## 踩坑实录 · Field notes

这些坑都是逐个接口 curl 出来的，写在这里省下下一个人的一个下午：

- 东财 `push2his` 直连**是带 CORS 的**（回显任意 Origin），5000 根以内能取满，最长回到 2006 年；
  而 `push2delay` **不存历史 K 线**（`klines` 恒空）——所以外汇/商品的日K 至今没有免费直连源，详情页对这些品类诚实显示空态。
  （早期结论写成"push2his 直连不可达"，2026-09-16 逐个接口复测后修正。）
- 东财长历史必须用 `fqt=2`（后复权）：它的 **`fqt=1` 前复权是"减去累计分红"的加性口径**，
  长窗口会算出负价（实测长江电力最小收盘 −7.58、盈富基金 −1.67、腾讯 −39.33），收益比值直接变成负的；
  后复权是乘性口径且与美股前复权同比值（SPY/QQQ 两口径比值完全一致）。分红有没有真的算进去，
  用"后复权收益显著高于不复权"来卡（长江电力差 2 倍以上）。
- 东财 WAF 会按 IP 封禁短时间大量长历史请求（实测整段 `other side closed`，curl 与 node 同时挂、
  持续十几分钟）。所以基金对比：请求按需分档（BUCKETS，1 年日线只要 24KB 而不是 338KB）、
  并发限 3、失败进指数退避熔断，熔断期间自动走腾讯兜底并在界面标明"价格收益（未含分红）"；
  「重新取数」按钮带 `fresh` 参数绕过缓存（否则 6 小时缓存会记住兜底结果，按钮成了摆设）。
  直连被墙时可以部署 `worker.js`（Cloudflare Worker 代理，已放行 push2his）作为逃生口。
- **腾讯的 `qfq` 一律不能当"含分红"用**（2026-09-16 复核纠正了自己上一版结论）：A股的前复权同样是**加性**口径
  （原始价 − 前复权价在除息日阶梯式变化：长江电力 5.099 → 4.399 → 2.763 → 1.000 → 0.000，比例 1.368 → 1.000 一直变），
  拿它的比值当总收益会把长江电力 2010 至今算成 **+9324% / 年化 46.8%**（真值约 +317% / 12.8%），沪深300ETF 也虚高 60%；
  港美股则连 qfq 参数都被忽略（返回不复权价）。所以兜底源只算价格收益、界面必须标注，且**不做 `fqt=1` 重试**（东财前复权同理）。
- 腾讯兜底走**不复权**接口 `/appstock/app/kline/kline` 而不是 `fqkline`：除了口径（见上），深度反而更好
  （A股周线 1084 根回到 2003-11 vs fqkline 640 根；美股周线 1756 根回到 1993），而且没被 WAF 拦。
  `fqkline` 现在对 Node/curl 会回 **501 + JS 挑战页**（真实浏览器会自动过挑战，所以线上无感，但
  `detail.test.mjs`/`live.test.mjs` 这类 Node 直连测试会因此红——属环境问题，不是功能坏了）。
- 腾讯 K线必须用带交易所后缀的代码（`usAAPL.OQ`、`usSPY.AM`），裸代码只回 2 根脏数据——已自动补后缀重试。
  `.P` 这类猜出来的后缀会取空（`usSPY.P` 空、`usSPY.AM` 1756 根），后缀要从 `qt.gtimg.cn` 的 f[2] 取。
- 6 位 A股代码的市场位**按号段定**，不能靠"哪个源能取到"来猜：`1.000001` 是上证指数、`0.000001` 是平安银行
  （万科A/上证指数同理撞号），而场内基金最容易搞错——`510300` 在沪（1.）、`159915` 在深（0.），
  只按"6 沪 0 深"判断会把一半 ETF 指到错的市场位。所以：号段能定的直接定死，`000xxx` 段与美股
  105/106/107 这类歧义只认权威来源（搜索接口的 MktNum），拿不到就返回空态，绝不猜。
- 东财美股secid的市场位不可推断：`SPY/SCHD/SPMO/DIA` 在 `107`（ARCA）、`QQQ` 在 `105`（NASDAQ），
  一律按 105 猜会把一半美股 ETF 取成空。且它的 suggest 接口按名称模糊召回——**输入 `SPY` 会返回
  "远东股份 600869"**，所以代码类输入只认"代码完全一致"的搜索结果，否则用户加的是 SPY、图上画的是别的票。
- `pz=6000` 会被截断成 100：全市场抓取是 56 页分页并发 + 盘中按代码去重（排序分页时个股会位移）。
- 美股 K线必须用带交易所后缀的代码（`usAAPL.OQ`），裸代码只回 2 根脏数据——已自动补后缀重试。
- 新浪 JSONP 的回调名**不能以下划线开头**（`callback illegal character`）；东财新闻必须带 `req_trace` 参数。
- 深夜清算时段东财把涨跌幅回成 `"-"` 字符串：按数值过滤会把全市场清空，必须允许缺失（显示 `--`）。
- 美股宽度必须**全量抓 13800 只**：按涨跌幅排序分页只取前段，统计的是"跌幅榜"不是市场。
- SEC `data.sec.gov` 按 User-Agent 里的**邮箱域名**拉黑：`@users.noreply.github.com` 这类隐私代理域名直接 403，
  "名称 + 普通邮箱" 才放行；且 13F 的 `value` 字段自 2023-01 起是**整美元**（官方口径曾为千美元），乘 1000 就会把
  巴菲特算成三百万亿富翁。
- 东财龙虎榜"席位明细"报表（`RPT_BILLBOARD_DAILYDETAILSBUY/SELL`）**不含证券简称**（只有营业部名）：
  档案页的股票名由前端解析层补齐（东财 quote 批量接口 f14 + localStorage 缓存），缺的显示代码，绝不造名字。

## 家规 · House rules

这份代码有几条雷打不动的自律（也解释了为什么它长得这样）：

1. **不用 `setInterval`**——调度走 `setTimeout` 链，动画走 `requestAnimationFrame`；
2. **不动画 `width/height/top/left/box-shadow`**——只碰 `transform/opacity/color`，让合成器干活；
3. **前端零 API key**——拿不到免费数据的（如 FRED）宁可隐藏也不塞密钥；
4. **数据失败不是错误**——降级链 + 角标，用户永远看得见一块能看的屏幕；
5. **只描述事实，不荐股**——技术面和情绪面板全是统计口径，一个"买入"都不说。

## 安卓版 · Android

仓库里的 `android/` 是一个 **WebView 壳工程**（无 Gradle、无 Android Studio 也能构建），
加载的就是线上同一份页面——收藏/设置走 localStorage 与浏览器一致；App 自身只申请
`INTERNET` 一个权限，不收集任何设备信息。签名 APK 从
[Releases](https://github.com/5777-wq/openfinlens/releases) 下载（允许未知来源即可安装）。

```bash
cd android && bash build.sh
# 构建链：aapt2 + javac + d8 + uber-apk-signer（便携工具链放 toolchain/，TUNA/阿里云镜像，不用海外 CDN）
# 产物：OpenFinLens-v1.0.2.apk（应用名 OpenFinLens；版本号在 AndroidManifest.xml，OFL_VERSION=x.y.z 可覆盖产物名）
```

## 自己部署一份 · Deploy your own

1. GitHub 新建公开仓库；
2. `git push` 上去；
3. Settings → Pages → Source 选 `Deploy from a branch`（`main` / root）→ Save。

一分钟后固定地址：`https://<你的用户名>.github.io/<仓库名>/`
（相对路径 + hash 路由，任意子路径即开即用；`.nojekyll` 已备好，`_test/` 不会被 Jekyll 吞。）

可选：部署 `worker.js`（Cloudflare Worker）作为代理备援，启用新浪源——默认直连即可跑，Worker 不是必需品。

## 测试 · Tests

```bash
node _test/run-all.mjs            # 全部 14 组 169 项
node _test/run-all.mjs --offline  # 只跑离线 9 组 113 项（断网/CI 友好，已挂 GitHub Actions）
```

纯 Node 零依赖。覆盖：treemap 面积守恒与视口数学、情绪指数口径与七段分布守恒、技术指标手算核对
（RSI 的 Wilder 平滑、MACD、KDJ、BOLL 的 σ 都有构造序列对账）、时区口径、降级链逐条改坏主源实测、
实网逐源探活、概念榜黑名单、产业链成分股代码真实性。`live/breadth/boards` 组依赖实时行情，
深夜清算时段会自动跳过数值断言——它们不依赖具体价格，只盯结构和口径。

## 已知短板 · Known limitations

- 免费接口有延迟（东财 `push2delay` 名字里就写着 delay），**不构成投资建议**；
- 全球事件的坐标是**关键词地理定位（国家/地区级）**，不是精确地理编码；事件在 K 线上按"报道日期"落位，不是成交时间——两者都诚实标注；
- 龙虎榜 D1/D5 列是该股历史次日/5日涨跌的**统计**，不是预测；"某席位 = 某游资"这类推断未展示（上游不公开个人身份）；
- ARK 每日交易 / SEC Form 4 未接入：免费直连源不稳定且 data.sec.gov 不带 CORS，需要采集层支持，做了会补上——**宁可缺，不放假数据**（13F 已接入多机构）；
- 外汇/商品的日K 无免费直连源（详见踩坑实录第一条），报价与情绪不受影响；
- 加密"市值"用 24h 成交额代理——真实流通量免费拿不到；
- 美股分时盘前盘后只有 1 个点（上游限制），会自动降级为日K；
- 上游随时改字段：哪天整片降级，先跑 `node _test/live.test.mjs`，它比用户先知道谁挂了。

## 免责声明 · Disclaimer

本项目**仅供个人学习与技术研究，不构成任何投资建议**。
所有行情与资讯来自第三方公开接口，可能延迟、中断或出错；据此交易的后果自负。
*For learning and research only. Not investment advice. Data comes from third-party public
endpoints and may be delayed or wrong. Trade at your own risk.*

---

<div align="center">

**技术栈：** 原生 HTML/CSS/JS · [lightweight-charts](https://github.com/tradingview/lightweight-charts) v4.2.3（vendored, Apache-2.0）· [topojson-client](https://github.com/topojson/topojson-client) / d3-geo / d3-array（vendored, ISC）· 手写 squarify · 腾讯/东财/币安/新浪/世界银行/GDELT 公开接口（许可证详见 `lib/THIRD_PARTY.md`）

*如果它帮你省了一个付费行情软件的订阅，star 就是最好的咖啡。*
*If this saved you a market-data subscription, a star is the cheapest coffee.* ☕

</div>
