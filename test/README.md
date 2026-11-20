# test/ —— 统一离线测试入口（Phase 5 收口）

Phase 5 将把三仓测试合并到此处：`node test/run-all.mjs --offline` 一键执行
（openfinlens 离线组 + Meridian 全离线 suite + Academy 引擎/契约/渲染/无障碍/基建 suite）。

Phase 1~4 状态：仅占位；现行测试仍在 `_test/`（`node _test/run-all.mjs --offline`）。
验收口径为「各测试入口实跑全绿」，不写死断言数量（数量随增删漂移，写死必过期）。
