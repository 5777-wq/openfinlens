# OpenFinLens 生产级技术架构设计

> 状态：设计基线 v1（2026-09-11）。上游参照见 [WORLDMONITOR-ANALYSIS.md](./WORLDMONITOR-ANALYSIS.md)。
> 铁律继承：零运行时新库（lightweight-charts 唯一例外）、前端无 API key、无假数据、rAF/setTimeout 链、RGBA 规范。
> 类型策略：项目无构建步骤（纯静态部署），**用 JSDoc typedef 作为类型契约的单一事实源**（等价于 TS 类型的安全子集，node 可直接测试）。若未来用户确认引入构建链，可无损迁移为 `.d.ts`/TS。

## 0. 总原则：三层渐进，不推翻现状

```
现状（已上线，保持）              演进层（本设计新增）              远期（按需）
─────────────────────          ─────────────────────          ─────────────
纯静态前端 + GitHub Actions      js/engine/ 事件与影响引擎        可选 Worker 后端
  浏览器直连公开行情接口           （纯函数、node 可测）             （仅当引入密钥类源时）
  采集脚本 → 静态 JSON            Mock/真实 adapter 双轨
  席位/13F/产业链/热力图          资产影响规则表
```

原则：**任何新能力先以"可独立测试的纯函数 + mock 数据"落地，再接真实源，最后才考虑服务端。** 这与 WorldMonitor 的 Edge→Gateway→Convex 三层相比是刻意的简化——我们的数据公开、无账号体系、预算为零，静态 JSON + 浏览器直连公开接口是最优解；只有"需要密钥的源"出现时才引入 Worker（届时照抄 WM 的阈值+缓存+并发三闸门）。

## 1. 前端架构（现状 + 增量）

```
index.html                 布局：顶栏(行情状态)/视图区/页脚 —— 已有
js/
  app.js                   视图编排与状态（单例 state + render 函数族）—— 已有
  events.js actors.js      事件/席位模型 —— 已有
  worldmap.js globe.js     2D/3D 地图 —— 已有（canvas 自绘 + globe.gl）
  sources/*.js             数据源 adapter（一源一文件，网络调用唯一合法位置）—— 已有
  engine/                  ★ 新增：语义引擎层（纯函数，无 DOM，node 可测）
    types.js               JSDoc 类型契约 + 类别/状态常量（单一事实源）
    geo.js                 国家/城市词表 → ISO2 + 坐标（地理编码）
    news-engine.js         新闻标准化 / URL+标题去重 / 分类 / 地理充实
    event-engine.js        事件聚类（网格+时间窗+标题相似度）/ 状态机 / 时间线
    llm-provider.js        LLMProvider adapter（Mock 实现 + Anthropic 骨架）+ AI 闸门
    impact-engine.js       Event→Country→Asset 影响规则表（FACT/DATA/CORRELATION/AI 证据分级）
  utils.js store.js bus.js  工具/localStorage/事件总线 —— 已有
_test/                     node 直跑测试（vm 加载 window 风格模块）—— 已有，engine 测试加入
docs/                      本文档 + WorldMonitor 分析
```

**UI/数据/地图/状态解耦规则**（继承既有架构）：网络调用只存在于 `sources/`；业务逻辑只存在于 `engine/` 与模型文件；`app.js` 只做编排与渲染；组件（渲染函数）不持业务判断。

## 2. 后端架构（现状 + 触发条件）

- **现在**：GitHub Actions 定时任务即"后端"——`_scripts/collect-events.mjs`（GDELT+新浪7x24，每 5 分钟）、`_scripts/collect-13f.mjs`（SEC 13F 多家机构，每 6 小时）→ 产物为静态 JSON（`data/`）→ Pages 分发。采集脚本复用 `js/events.js` 的同一套 normalize/dedupe 逻辑（node 直载），**采集与浏览器共享数据模型**。
- **演进触发条件**（满足任一才引入 Cloudflare Worker/Vercel Edge）：
  1. 需要密钥类新闻源（Reuters/Bloomberg API）；
  2. 需要 AI 摘要上线（密钥必须在服务端）；
  3. 需要 RSS 中继（上游封锁静态 IP）。
  届时按 WM 的 gateway 思想做单文件 Worker：路由表 + CORS + 缓存头 + 错误映射，**不引入 proto/生成代码**（JSDoc 契约 + JSON 足够）。

## 3. 数据库结构（现状：无库）

有状态数据分三类存放：

| 数据 | 存放 | 理由 |
|---|---|---|
| 事件/新闻快照 | `data/events/global-events.json`（git，静态分发） | 公开、只读、CDN 友好 |
| 用户数据（自选/设置/颜色） | localStorage（`gfd_` 前缀） | 隐私优先、零后端 |
| 引擎中间产物（聚簇缓存） | 内存 + 可选 `data/engine/*.json` 预计算 | 聚类是纯函数，可离线跑 |

远期若引入账号/订阅才考虑 Convex/Supabase 类（WM 的 convex 层对应物），当前明确不做。

## 4–9. 数据模型（契约详见 `js/engine/types.js`，此处为设计说明）

### NewsItem（新闻）
```
{ id, title, url, source, publishedAt(ms), lang,
  category(12 类枚举), country(ISO2|null), lat?, lng?,
  entities?: string[] }
```
- id = `hash(url)`（URL 级幂等）；来源标准化为小写域名。
- 12 类 category：geopolitics / war / economy / central_bank / politics / trade / energy / commodities / markets / technology / natural_disaster / social。

### Event（事件，新闻聚类产物）
```
{ id, title, createdAt, updatedAt,
  location: {lat, lng, label?}|null, countries: ISO2[],
  categories: category[], severity: 0-100, confidence: 0-1,
  status: 'active'|'updating'|'resolved',
  relatedAssets: symbol[], newsIds: id[],
  timeline: [{ t, kind:'news'|'system', note, newsId? }] }
```
- title 取簇内"最权威来源"（TOP_SOURCES 表优先）最长标题；severity 由 类别权重×来源数×新鲜度 合成；confidence 随独立来源数单调上升。
- status 状态机：窗内出现新新闻→`updating`；超窗无更新→`active`；>7 天→`resolved`。

### Asset / Country / Market
- 资产沿用既有 `universe.js`（symbol→{name, market, secid…}），engine 只引用 symbol；国家维度新增 `COUNTRY_ASSETS` 映射（ISO2→{fx, equity, bond}）。
- Market 数据沿用 `sources/tencent.js|eastmoney.js|binance.js` 的 quote 结构 `{ symbol, name, price, chg, pct }`，engine 不重复建模。

### ImpactEdge（资产影响边）
```
{ eventKind, assetSymbol, relationship('positive'|'inverse'|'risk_on'|'risk_off'),
  direction('up'|'down'|'flat'), confidence: 0-1,
  evidence: { kind: 'DATA'|'CORRELATION'|'AI', note },
  historicalCases: [{ label, date, move }] }
```
- **证据分级铁律**：`DATA`=规则表内置的机制性事实（央行加息→本币利率↑）；`CORRELATION`=历史案例统计（表内 historicalCases）；`AI`=LLM 产出。三者永不混装，UI 按标签展示。

### AI 分析（AiAssessment）
```
{ eventId, provider, model, text, tokens, cachedAt, answers: {
  what, why, whoAffected, assets, pricing, validation, uncertainty } }
```
由 `LLMProvider` 产出，缓存 key = 轻消毒标题组（WM 同款教训：先 zip 再过滤），TTL 30 分钟。

## 10. 地图图层架构

现有 `worldmap.js`/`globe.js` 为单文件渲染器。图层演进采用**注册表模式**（避免 WM `Map.ts` 3000 行单文件的反面教材）：
```
MapLayer = { id, z, visible, enabled(crypto 合规开关等), render(ctx, view, data), hitTest?(mx, my) }
map.addLayer(registry)  →  按z排序绘制；数据由 engine/sources 注入而非图层自取
```
首批图层拆分：底图（陆地/国界）、事件点、选中态、（未来）国家风险着色 / 密度热区 / 行情涨跌着色。性能沿用现有：屏幕坐标每帧重算、离屏副本剔除、聚类分级（`bucketForZoomAt`）、同步交互重绘 + rAF 仅动画。

## 11. API 架构

- 前端内部 API = `sources/*` 的公开方法（getQuotes/getKline/…）+ `engine/*` 的纯函数。**Mock adapter 策略**：`engine/mock-data.js` 提供与真实结构逐字段一致的样例集；`sources/` 的替换单位是文件——真实源与 mock 源实现同一方法签名。
- 远期 Worker API 形态：`POST /rpc/<domain>/<method>` + JSON + 缓存头，路由表单文件（WM gateway 的极简版）。

## 12. 缓存架构

| 层 | 机制 | TTL |
|---|---|---|
| 浏览器行情 | utils.Cache（内存 Map） | 各源自定（60s 级） |
| 新闻/事件快照 | localStorage（`gfd_` 前缀） + 静态 JSON | 快照 30min 降级窗口 |
| AI 结果 | （未来 Worker）Redis，key=轻消毒标题组 | 30min（WM 同款） |
| 聚类结果 | 内存 Map（会话级） | 会话 |

## 13. 定时任务架构

现状即最终形态的低配版：GitHub Actions cron（events 每 5min、BRK 每 6h）+ rebase 推送。演进：engine 聚类离线化（Actions 里跑 `node --engine` 产出 `data/engine/events.json`，浏览器零计算拿到事件）——**聚类函数双端复用是本设计的核心红利**。

## 14. 实时数据架构

沿用现状：浏览器直连公开接口（腾讯/东财/币安/世界银行）+ 10s/30s 轮询 + 页面隐藏暂停 + 降级链角标。新增源一律走 `sources/` 新文件 + `universe.js` 注册。密钥类源出现前不建服务端。

## 15. 权限架构

当前：无账号、无追踪（产品原则）。远期若上 Pro 功能（AI 摘要等）：Worker 验签 + entitlement 表 + 前端 `summarize-gate` 同款闸门——**只门控 AI 成本，永门控行情数据**（数据公共性是产品底线）。

## 16. 完整数据流（目标态）

```
第三方源                     [GDELT / 新浪7x24 / SEC / 腾讯 / 东财 / 币安 / 世界银行]
  ↓ 采集（Actions 定时，node）                    ← 未来：Worker 仅接密钥源
  _scripts/collect-*.mjs   标准化+URL去重（与 engine 共享模型）
  ↓ 静态 JSON                                     [data/events/*.json · Pages CDN]
  ↓ 浏览器
sources/*.js   抓取+降级链+角标                        什么跑浏览器：抓取/渲染/交互
  ↓
engine/news-engine.js   标准化/去重/分类/地理编码        什么由 AI 完成：
  ↓                                              仅"低置信或高严重"事件的
engine/event-engine.js  聚类→Event(状态机/时间线)   摘要/分类复核/影响叙述，
  ↓   ↘ needsAiReview() → llm-provider(Mock→Anthropic@Worker)   且 TTL 缓存+并发闸门
engine/impact-engine.js Event→Country→Asset 影响边（DATA/CORRELATION 证据）
  ↓
app.js 渲染（worldmap 图层 / 面板 / 顶部行情 / 时间轴）
  ↓ 用户点击 marker / 国家
选中态 → 右侧详情（事件卡+新闻簇+影响边+AI 叙述）+ 左侧新闻流按事件过滤
```

**边界总表**

| 位置 | 职责 |
|---|---|
| 浏览器 | 行情抓取（公开接口）、渲染、交互、聚类（小数据量）、缓存 |
| GitHub Actions（=服务器） | 采集、标准化、去重、静态化 |
| 数据库（现为 git 静态 JSON） | 事件/新闻快照、13F |
| Redis（远期） | AI 结果、热 RPC 缓存 |
| 第三方 API | 一切上游数据（经 sources 白名单） |
| AI | 摘要/分类复核/影响叙述——永不写库、永不替代规则表 |
