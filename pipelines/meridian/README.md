# pipelines/meridian/ —— Meridian 美股信号管线（Phase 3 迁入）

SPMO 攒股 + SP500 前 150 增强 · 日线+周线 RSI6（Wilder）超买超卖 · Vegas 三通道 ·
多渠道推送。移植自 `us-stock-monitor`（Phase 0 审计基线），计算层全部改引 `core/`
唯一真源，不保留重复模块。

## 文件

- `monitor.mjs`   CLI 编排：池子构建 → 逐标的取数评估 → 产物写出 → 推送。
- `universe.mjs`  监控池：SP500/纳指100 快照（core/registry）→ 腾讯实时市值重排 → topN；自选清单。
- `analytics.mjs` 专业级上下文：钝化/扩展度/量比/历史信号 5 日收益统计。
- `signals 评估`  在 `core/engine/signals.mjs`（evaluate/summarize/stalenessGate）。
- `us-schema.mjs` `data/us-signals.json` 产物协议（构建器 + 校验器 + 体积红线）。
- `report.mjs`    控制台表格 + CSV（UTF-8 BOM）+ 固定名原子写出。
- `notify.mjs`    Server酱/Bark/Telegram 三通道（密钥 env 优先，即 CI Secrets）。
- `tools/check-fresh.mjs`  心跳检查（marketDate == 最近已收盘交易日）。
- `skill/us-monitor-broadcast/`  Agent 播报技能。
- `config.json`   公开默认配置；`config.local.json`（gitignored）叠加密钥与真实持仓。

## 产物（写仓库 data/，collect-meridian.yml 经 _scripts/push-data-branch.sh 提交 data 分支）

- `data/us-signals.json` —— schemaVersion 1：`marketClock`（美东时钟/收盘状态）+
  `summary`（计数+名单）+ `items[]`（每标的 symbol/name/price/tags/daily/weekly/warnings）。
  **不含全量 K 线**（体积红线 900KB，校验器强制）——单票 K 线由终端按需取。
- `data/us-signals-latest.csv` —— 固定覆盖名（不再按日期堆积）。

## 本地运行

```bash
node pipelines/meridian/monitor.mjs                # 全量（首次 2-4 分钟，缓存后增量）
node pipelines/meridian/monitor.mjs --limit 5      # 试跑（产物只写 .meridian-cache/preview）
OFL_MOCK_HTTP=<路由JSON> node pipelines/meridian/monitor.mjs --limit 5   # 离线 mock
```

缓存：`.meridian-cache/klines/`（gitignored，CI 由 actions/cache 承载，严禁进 Git）。
