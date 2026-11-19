# 上线前终检与切换手册（Phase 6 · 2026-11-20）

> 本清单对应 `feat/monorepo` 分支（Phase 0–6 全部完成）。执行者是仓库所有者本人；
> 标注 **[人工]** 的步骤无法由 Agent 代做。全程不要 force push。

## 一、GitHub Secrets 完整清单

| Secret | 必填性 | 用途 |
|---|---|---|
| `NOTIFY_SERVERCHAN_KEY` | 可选 | Meridian 信号 Server酱推送（微信）；未配置则该渠道静默跳过 |
| `NOTIFY_BARK_URL` | 可选 | Meridian 信号 Bark 推送（iOS） |
| `NOTIFY_TELEGRAM_TOKEN` | 可选 | Meridian 信号 Telegram Bot |
| `NOTIFY_TELEGRAM_CHAT_ID` | 可选 | 与 TOKEN 配对使用 |
| `OFL_AAPT2_URL` | 可选 | android-apk.yml 的 Linux aapt2 镜像兜底（google maven 主源失效时覆盖） |
| `eastProxy` | 可选 | 东财 WAF 代理（Cloudflare Worker 部署后填入 config，本地/CI 可选） |

> 推送类 Secret 全部缺省时系统照常运行：采集/发布不受影响，仅推送渠道静默关闭。

## 二、标准三步切换流程（按顺序执行）

### 第 1 步 [人工]：合并 feat/monorepo 进 main 并推送

```bash
git checkout main
git pull origin main
git merge --no-ff feat/monorepo -m "merge: 三仓合一 Monorepo（Phase 0–6）"
git push origin main
```

> 合并后 `ci.yml` 会在 push/PR 时自动跑 `node test/run-all.mjs`（主仓 53 组 + Academy 6088 断言）。

### 第 2 步 [人工]：手动触发三条采集 workflow，初始化并填满 data 分支

GitHub → Actions 页逐个 **Run workflow**：

| Workflow | 输入 | 作用 |
|---|---|---|
| `collect` | 无 | 全球事件 / Polymarket / 13F / 基金 / ETF 持仓 / Agent API → data 分支 |
| `collect-meridian` | version 留空（全量） | us-signals.json + us-signals-latest.csv → data 分支（顺带排查 11-10 起 Actions 采集停更的远端原因：Actions 页看 collect 近期运行记录与失败日志） |
| `collect-academy` | 无 | Academy 长历史序列 → data 分支（apps/academy/data/history） |

三条 workflow 共用 `concurrency: data-branch-write` 串行排队，互不覆盖。每条绿灯后
`data` 分支应能看到对应产物（`data/events/*`、`data/us-signals.json`、`apps/academy/data/history/*`）。

### 第 3 步 [人工]：切换 GitHub Pages Source

仓库 Settings → Pages → Build and deployment → **Source 选 "GitHub Actions"**。
切换后 `deploy-pages.yml` 接管发布（main 或 data 分支有新提交即自动拼装部署）。
在 Actions 页确认 `deploy-pages` 绿灯，打开 `https://5777-wq.github.io/openfinlens/` 验证。

## 三、上线后 5 分钟冒烟

- [ ] `https://5777-wq.github.io/openfinlens/` 打开，六个一级板块齐全（含「美股信号」）
- [ ] `https://5777-wq.github.io/openfinlens/academy/` 打开，134 篇文章/293 条术语可浏览
- [ ] 「美股信号」Tab：marketClock/筛选 chips 渲染；点击任一只美股行进入 K 线详情
- [ ] 详情页/ETF 面板的「白话金融」链接跳到 `/openfinlens/academy/#/term/<id>` 且页面可达
- [ ] Meridian 推送：配置了 Secret 的渠道收到当日信号（或"今日无信号"）
- [ ] `android-apk.yml` 手动 Run 一次：绿灯 + Releases 出现 `apk-v1.0.3`（首跑验证 Linux 工具链）

## 四、3–5 个交易日灰度观察项

- [ ] `collect` 每日提交频率恢复正常（对比 11-10 前的中位间隔），global-events 不再"最新事件 N 小时前"
- [ ] `collect-meridian` 每个美东交易日收盘后产出 us-signals；`check-fresh` 心跳不红
- [ ] `collect-academy` 每日长历史序列追加；`/academy/` 的曲线页数据跟手
- [ ] 自建服务器 `server-collect.sh` 的 cron `git pull` 拉到新脚本后改推 data 分支（日志确认 "data 分支已更新"）
- [ ] 终端「美股信号」Tab 星标/筛选/日周切换在手机 WebView 里正常
- [ ] 若 `android-apk.yml` 首跑失败，按日志修工具链 URL（或 Secrets 覆盖），APK 缺失不影响站点

## 五、旧仓退役（全部绿灯 + 灰度通过后）

- `us-stock-monitor` / `openfin-academy` 两仓：更新 README 为归档声明（见 `docs/migration/*-README-notice.md`）、
  根目录放入对应 redirect 页，然后 Settings → General → **Archive this repository**。
- 本地 `美股监控/` 目录与新仓 `openfin-academy/` 旧克隆由所有者手动清理。
