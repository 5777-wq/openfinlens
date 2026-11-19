# apps/terminal/ —— 主站 /（Phase 4 迁入）

OpenFinLens 实时看盘终端 + Meridian「美股信号」Tab 的最终落位（Phase 4）。

- Phase 1~3：本目录为空，`scripts/serve.mjs` 的 `/` 自动回退到仓库根旧布局，
  deploy-pages 也以 main 根为站点基底——线上行为不变。
- Phase 4：前端迁入本目录，静态资源与计算层指向 `/core/`，新增美股信号 Tab
  （消费 `/data/us-signals.json`，RSI6/RSI14 切换记忆在 localStorage）、共享术语抽屉、
  与 `/academy/` 双向深链；日/夜主题变量与 academy 跨页同步。
