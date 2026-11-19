# core/ —— 三仓共享内核（Phase 2 抽取填充）

monorepo 唯一真源层，规划蓝图（由 openfinlens / us-stock-monitor / openfin-academy 三仓既有实现合并而来）：

- `engine/`   纯计算层（零 DOM、零网络，浏览器与 Node 共用原生 ESM）：
              Wilder RSI6/14（对齐通达信 SMA(X,N,1) / TradingView RMA）、Vegas 三通道
              （EMA144/169、288/338、576/676）、MACD/KDJ/BOLL（主仓 js/technical.js 口径）、
              归一化对比、周线重采样（Meridian lib/weekly.mjs 口径）
- `sources/`  统一数据源适配器：东财 push2his 后复权（WAF 熔断）→ Yahoo → 腾讯 三级降级、
              币安/OKX、世界银行；美东（ET）墙钟收盘判定与「盘中参考」标记
- `registry/` 唯一静态注册表：产业链 10 链·49 环节·177 股（已核实 openfinlens 与
              openfin-academy 两仓文件 md5 一致）、sp500/ndx/spmo 候选池、series-map.json
- `vendor/`   第三方本地库全仓唯一一份：lightweight-charts v4.2.3、d3-geo、topojson

**IIFE/ESM 桥接原则（Phase 2 沿用）**：core/ 用原生 ESM 写唯一真源；Academy 侧通过极薄的
桥接脚本把 ESM 挂回原有 `window` 命名空间，不硬重写老 IIFE 视图代码。

Phase 1 状态：仅占位。旧路径（js/、lib/、_scripts/）在此期间保持原样运行，零破坏。
