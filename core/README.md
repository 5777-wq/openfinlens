# core/ —— 三仓共享内核（Phase 2 已落位）

monorepo 唯一真源层。本目录全部为**原生 ESM（.mjs）+ 纯数据 JSON**，零第三方依赖、
零构建；浏览器与 Node 共用同一套模块（sources 仅 Node 侧可用，见下）。

## engine/ —— 纯计算层（零 DOM / 零网络）

- `indicators.mjs`  技术指标唯一真源：SMA/EMA、**Wilder RSI**（序列 + 标量 + 快照，
  对齐通达信 SMA(X,N,1) / TradingView RMA）、Vegas 三通道（位置/穿越事件/快照）、
  MACD(12,26,9)、KDJ(9,3,3)、BOLL(20,2)、ATR(14)、量比(5)、均线系统。
  合并自 Meridian lib/indicators.mjs ∪ 主仓 js/technical.js（两仓口径 Phase 0 已核实一致）。
- `weekly.mjs`      日线 → 周线重采样（周标签 = 日历周周五；开收高低量聚合）。
- `market-time.mjs` 美东（ET）墙钟时钟：最后收盘交易日判定、live bar 切分、交易日差。
- `signals.mjs`     单标的信号评估（事实层 + 描述层，绝不"建议买卖"）、新鲜度闸门、分组汇总。
- `compare.mjs`     归一化资产对比（index/pct/mult 三口径、CAGR/波动/回撤/年度收益/相关性、
  共同起点对齐与诚实的排除说明）。

## sources/ —— 统一数据源适配器（Node-only；浏览器走 /data/ HTTP 端点）

- `history.mjs`  K 线三级降级链：东财 push2his 后复权（fqt=2，fetch→curl 传输链，
  WAF 熔断 60s 冷却 + 600ms 限速 + 可选 worker 代理）→ Yahoo 复权收盘 → 腾讯不复权兜底
  （adj='raw' 如实打标）。含后复权现价锚定、缓存按日合并、新鲜度判定。
  测试钩子：`__setHttpTransport/__setEastGapMs/__resetState`（离线单测注入假传输层）。

## registry/ —— 唯一静态注册表

- `industry-chains.json`  产业链真源：**10 链 · 49 环节 · 177 只去重成分股**
  （自主仓 js/data/industry-chains.js vm 抽取，该文件与 openfin-academy vendor 版 md5 一致）。
- `sp500-candidates.json` / `ndx-candidates.json` / `spmo-holdings.json`
  Meridian 候选池快照（220 / 103 / 40，带 asOf 溯源）。
- `series-map.json`  当前快照来自 academy 编译产物（Phase 4 随内容管线归位）。
- `index.mjs`        Node 侧加载器（loadChains / loadCandidates / loadSeriesMap）。

## vendor/ —— 第三方本地库全仓唯一 canonical 副本

- `lightweight-charts.standalone.production.js`  **v4.2.3**（主仓现役字节，md5 钉住；
  三仓版本核实同为 v4.2.3，无 API 兼容风险）。
- `d3-geo.min.js` / `d3-array.min.js` / `topojson-client.min.js` / `THIRD_PARTY.md`。
- 过渡期（Phase 2~4）lib/ 旧副本仍在用，`_test/core-registry.test.mjs` 断言两处逐字节一致防漂移。

## bridge/ —— IIFE 桥接层（裁定：不为洁癖重写老视图）

- `iife.mjs`  `installOn(target)`：把 engine/compare 挂到 `target.OpenFinCore`，
  并提供 `target.Technical` 兼容面（js/technical.js 原语子集同名同口径镜像；
  analyze/computeProfile 是视图聚合层，Phase 4 随视图迁移，此处刻意不提供）。
- `auto.mjs`  经典页面的零配置入口：`<script type="module" src="/core/bridge/auto.mjs">`。
- Phase 4 正式接入；契约（键集合快照）由 `_test/core-bridge.test.mjs` 钉死。

## 测试

- `_test/core-engine.test.mjs`（22 断言块）/ `core-sources`（9）/ `core-registry`（7）/
  `core-bridge`（5）——全部离线，已注册进 `_test/run-all.mjs`（当前 51 组 / 离线 45 全绿）。
- 旧路径（js/、lib/、_scripts/）Phase 2 期间原样运行，零破坏。
