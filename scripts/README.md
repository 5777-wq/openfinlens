# scripts/ —— monorepo 统一脚本

- `serve.mjs`  零依赖本地静态服务器（Phase 1 已就位）：
               `node scripts/serve.mjs [port]`，默认 8765。
               路由：`/` → apps/terminal/（空时回退仓库根旧布局）；`/core/`、`/academy/`、
               `/data/` 与 `/api/`（三级回退：`.data-local/<repo相对路径>` → 远程 data 分支
               raw 直链（6s 超时）→ 仓库内同名文件 → 404）。
               全部响应 `no-store`，杜绝本地联调吃旧缓存；
               `.data-local/` 内部目录结构与仓库一致（如 `.data-local/data/events/x.json`），
               已被 .gitignore 忽略。

Phase 1 状态：serve.mjs 已可用；后续阶段的新脚本（部署校验、迁移对账等）也放这里。
