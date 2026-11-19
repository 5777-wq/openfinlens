# apps/academy/ —— 子站 /academy/（Phase 4 迁入）

白话金融科普与历史复盘站（openfin-academy）的最终落位（Phase 4）。

- Phase 1~3：本目录为空，`scripts/serve.mjs` 对 `/academy/*` 返回占位说明页。
- Phase 4：源码迁入本目录，Markdown 与术语源迁至 `content/`，编译/采集/SEO 脚本迁至
  `pipelines/academy/`；`vendor/` 与 `sync-core.mjs` 退役，改直引 `core/`。
  17 条 hash 路由（#/term/:id、#/compare、#/curve、#/analogy、#/calc、#/quiz、#/saved 等）、
  sitemap.xml / robots.txt 的 /academy/ 子路径适配在此阶段完成。

注意事项（来自 Phase 0 审计）：academy 的 SEO 产物（492 条 sitemap URL、canonical、
og:url、jsonld SITE_URL）全部写死 `5777-wq.github.io/openfin-academy` 域名，
迁移时需改 `gen-seo.mjs` 的 SITE 常量并重新生成。
