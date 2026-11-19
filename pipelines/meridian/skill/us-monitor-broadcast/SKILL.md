# us-monitor-broadcast —— Meridian 收盘播报技能

读取 Meridian 当日产物并向用户播报核心信号（超买/超卖/回归/通道事件/周线信号）。

## 数据来源（monorepo 布局）

- 产物：仓库根 `data/us-signals.json`（协议见 `pipelines/meridian/us-schema.mjs`，
  `schemaVersion: 1`）；`data/us-signals-latest.csv` 是同内容表格版。
- 本技能文件与脚本位于 `pipelines/meridian/skill/us-monitor-broadcast/`。
- 本地试跑产物：`.meridian-cache/preview/us-signals.json`（`--limit`/mock 模式，
  不覆盖正式产物）。

## 使用步骤

1. 读 `data/us-signals.json`（路径相对仓库根；在本仓外运行时先用
   `<repo>/pipelines/meridian/` 定位）。
2. 播报顺序：
   - 开头：`marketClock.marketDate`（美东收盘日）+ `marketClock.runAtEt`；
   - `summary.counts`：超买/超卖/回归/通道事件计数一眼报；
   - `summary.obReturn`（超买回落·做T回补观察）与 `summary.osReturn`（超卖回升·吸纳确认观察）
     逐个报 `symbol(name) RSI6=xx`；
   - 仍停在区内的：`summary.overbought` / `summary.oversold`；
   - `summary.events`：Vegas 通道事件（`daily.vegas[].event`：break_up=上穿、break_down=下穿、
     reenter_up=回升、reenter_down=回落）；
   - `summary.week*`：周线信号（有则带「周」前缀）；
   - 结尾必带：`meta.eastError / srcTx / staleCount` 有值时提示口径风险；并声明
     「只描述事实，不构成投资建议」。
3. 未配置任何推送渠道时（`NOTIFY_*` 均为空）本技能是唯一的播报出口；已配置时以
   Server酱/Bark/Telegram 推送为准，本技能做补充解释。

## 红线

- 只描述事实与常用读法，绝不说"建议买入/卖出"。
- `items[].warnings` 里的口径警告（陈旧/不复权/数据不足）必须如实转述，不得省略。
- 不外泄推送密钥与 `config.local.json` 内容。
