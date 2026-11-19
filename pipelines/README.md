# pipelines/ —— 采集管线落位（Phase 3 起整理归位）

- `pipelines/events/`    每 5 分钟：GDELT + 新浪 7x24 + Polymarket + 13F
                         （Phase 1 起 collect.yml 已把产物改写 data 分支；脚本归位在 Phase 3）
- `pipelines/meridian/`  每日美东收盘：SPMO + SP500 前 150 扫描 + 多渠道推送（Phase 3 迁入；
                         K 线增量缓存走 Actions Cache，严禁提交进任何 Git 分支）
- `pipelines/academy/`   Markdown 编译、历史数据采集、SEO 生成（Phase 4 迁入）

Phase 1 状态：仅占位。现有采集脚本仍在 `_scripts/`，workflow 仍在 `.github/workflows/`。
