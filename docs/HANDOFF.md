# 交接文档 · 持续开发流水线（写给下一个 Agent）

> ## ⚠️ 2026-11-08 最新状态（优先读这一段，下面的旧交接已被部分取代）
>
> **2026-11-09 追加 v3「减法重做」（已 push，`6b6179f`）**：按用户反馈把 v2 的装饰推平——
> 纯黑 `#000` / 纯白 `#fff` 底、单色强调（深空白/日光黑）、删掉渐变/玻璃/网格/光晕；
> 删除首屏市场简报带、「全部」页重复的全球指数表、页头解释长句、空自选占位卡、页脚数据源墙；
> 逻辑改动：空自选整块隐藏、指数墙降级为裸排条、分区可用性随内容判定。
> 顺手修了三个真 bug：手机端跑马条被后加载层重新显示、预测市场卡片撑破 390px 布局视口、`.primary-nav` 缺 min-width。
> 细节见 `docs/UI-V2-SPEC.md` §6。
>
> **已完成两件大事，工作区已提交为 `748c2aa`（未 push）：**
> 1. **UI v2 推倒重来**：「NEXUS 深空终端」单一设计语言两模式（深空/日光），旧 8 套皮肤已删除。
>    规格见 [`docs/UI-V2-SPEC.md`](UI-V2-SPEC.md)（令牌表/材质三模板/动效参数与 Telegram 出处/文件所有权）。
>    分层：`css/style.css`（令牌单一事实源 + 兜底）→ `css/ui/01-shell|02-market|03-panels|04-motion.css`；
>    `js/ui/navmap.js`（12 旧 key ↔ 5 一级的纯函数映射）、`js/ui/command.js`（⌘K 面板）、`js/ui/motion.js`（动效运行时）。
> 2. **Agent 数据链路**：`api/v1/**`（11 端点 + openapi，统一信封 + stale 标注）、`mcp/server.mjs`（stdio，零依赖，11 工具）、
>    `_scripts/build-api.mjs`（构建）、`_scripts/api-commit-guard.mjs`（语义无变化不提交）、`docs/API.md`、`mcp/README.md`。
>
> **接手必跑的四条验证（全绿才算没被改坏）：**
> ```bash
> node _test/run-all.mjs --offline     # 39 组离线全绿（含 api/navmap 两组新增）
> node _qa/qa.mjs                      # 63 条（需先起 python -m http.server 8123）
> node _qa/shell-check.mjs             # 48 条外壳专项
> node _qa/motion-probe.mjs            # 12 条动效真值
> ```
> 探针说明见 [`_qa/README.md`](../_qa/README.md)，内含「无头不产帧」这个必踩的坑。
>
> **下轮别踩**：`css/ui/*` 只许消费 `style.css` 的令牌（tokens.test 扫全量，间距/字号/圆角/描边/涨跌色都是硬断言）；
> 动 app.js 的 `.rv` 参数要同步 `04-motion.css` 的校准块；`#primaryNav [role=tab][aria-selected]` 与 `#primaryNav .nav-ink` 是动效层的契约，改导航要保留。
> **待裁决**：详情页仍展示成交量/成交额，与路线图「不展示成交量」红线存在历史矛盾（本轮未动，需用户裁定）。


> 生成于 2026-11-01，由「持续开发流水线」会话在用户叫停时写就。
> 配额耗尽（智谱 start-plan，code 1005）+ 用户指示停止。本文档是接手者的完整上下文。

## 0. 三十秒速览

- **使命**：用户要求把 OpenFinLens 做成企业级、对标 TradingView 的行情终端（网页 + Android WebView 壳，网页即 App），持续开发、不逐步汇报、说停才停。
- **已完成并已推送**：P0★「UI 语言统一」7 条 + P0「图表核心」8 条，两个里程碑全在远端（Pages 已发布）。
- **未完成**：P1 第一条「多图布局」施工到一半被配额打断，**6 个文件的半成品在工作区未提交**（见 §2）。
- **未推送**：`7f7ab64`（DST 测试修复，已验证全绿）。
- **定时任务已删**（automation-0ea459ec），saved workflow 仍在，恢复方式见 §4。

## 1. 必读文档（都在仓库里）

| 文件 | 内容 |
|---|---|
| `docs/TV-ROADMAP.md` | 勾选框路线图（P0★/P0 全勾，P1~P4 待做）。**每轮取最靠前未勾项，测试全绿才许勾** |
| `docs/OPTIMIZER-LOG.md` | 每轮施工留痕（目标/改动/测试/涉及文件），防重复先读它 |
| `docs/UI-AUDIT.md` | UI 六病灶诊断（P0★ 的依据，后续 UI 改动须符合统一后的设计语言） |
| `docs/FIELD-NOTES.md` | 家规与上游接口踩坑（动手前读相关条目） |
| `docs/HANDOFF.md` | 本文 |

## 2. 未完成事项（按优先级）

### 2.1 P1「多图布局」半成品（最高优先）

- **背景**：方案已过独立评审（1×1/1×2/2×2 网格 + 十字线与缩放范围逻辑下标同步，可开关）；施工员改到一半，provider 配额耗尽（2026-11-01 06:59）。
- **工作区未提交的 6 个文件**（就是它的半成品）：
  `js/charts.js`、`js/app.js`、`css/style.css`、`index.html`、`_test/charts.test.mjs`、`_test/tokens.test.mjs`
  ⚠️ 状态未知：可能不完整、离线测试**不保证绿**。接手时先 `node _test/run-all.mjs --offline` 验一把。
- **三条路**：
  1. （推荐）续跑原运行：`ResumeWorkflowRun` run_id=`dwfrun-e123ce61-013b-4373-9672-f5e0ab3017c0`——需先解决配额；规划/评审步骤从 journal 免费回放，施工员重新执行（会覆盖这些半成品文件，无需手工清理）；
  2. 人工接手：以 `docs/OPTIMIZER-LOG.md` 末尾与 TV-ROADMAP P1 第一条为规格，基于现有半成品继续；
  3. 放弃：`git checkout -- js/charts.js js/app.js css/style.css index.html _test/charts.test.mjs _test/tokens.test.mjs` 后重开一轮。
- 恢复不了的备选：直接按 saved workflow 重跑（`CreateWorkflow saved { name: "hourly-project-optimizer" }`），它会自动选中 P1 第一条重做。

### 2.2 未推送提交

- `7f7ab64` 沪纽时差断言修复（美国 2026-11-01 切冬令时日暴露的**测试自身**环绕数学错误；应用代码无恙）。已验证 37 组全绿，只差 push。推送走 §5 三步。

### 2.3 P1 剩余 + P2/P3/P4

见 `docs/TV-ROADMAP.md`：布局保存/恢复、命令面板（Ctrl+K，含"按意思找"）、自选列表升级、K线快照分享 → P2 选股器/提醒 → P3 移动手势/触控/PWA → P4 动效审计/性能预算/无障碍/皮肤/文档。每完成一个阶段（小节全勾）= 里程碑，推送发布。

### 2.4 OBV 裁决（已处理，留意即可）

OBV 是成交量衍生指标，撞"页面无成交量"红线，已按红线排除并在路线图留痕、指标条目照常勾选。用户未反对；若哪天用户松口，解阻路径记录在 OPTIMIZER-LOG 对应条目。

## 3. 运维铁律（血泪换的，别踩）

1. **Mimosa 钩子**：Bash 通道的 `git commit` / `git push` 会被硬拦（app.js 两跳 ssrf 等 23 条存量误报，用户已裁定放行但钩子不解锁）。**git 写操作走 workflow 通道**：工作流内 `world.run("git", [...])`，会话内用 `EvalWorkflowSnippet`。不对抗钩子、不反复重试。
2. **workflow 脚本里禁 `world.run("bash", ...)`**：Windows 下 spawn bash ENOENT（曾把里程碑轮崩在推送兜底处）。saved 定义已修，别改回去。
3. **推送三步**（远端常有采集服务推的 `data: refresh` 提交，直接 push 会被拒）：
   ```bash
   git fetch origin && git rebase origin/main   # Bash；data 提交只碰 data/，与代码零冲突
   ```
   然后 EvalWorkflowSnippet 里 `world.run("git", ["push"])`。
4. **行尾红线**：`css/style.css` 全 CRLF，只许声明片段级小段编辑（禁整文件重写）；`_test/`、`index.html`、`js/` 大多纯 LF——改前用 `git ls-files --eol` 核对，改后逐文件验证零翻转。`.sh` 保持 LF。
5. **版本号**：动了 `index.html` 资源引用，67 处 `?v=` 必须统一单调递增 bump（tokens.test 卡）。
6. **测试门禁**：`node _test/run-all.mjs --offline`（当前 37 组，约 7 秒）。红基线一律先修再开工；新纯函数必配单测，测试先行（先红后绿）。
7. **本机禁实网验证**：东财 WAF 会 IP 级封禁；实网组（6 个）留给采集/Actions 通道。
8. **合规红线（不可协商）**：无成交量展示、无 Polymarket 品牌、无省略号问句、内容全中文、只描述事实不荐股、前端零 API key、新增取数仅 https 且校验 host 拒内网。
9. **美学纪律**：时长 150–300ms、统一缓动令牌、只动 transform/opacity/color、尊重 prefers-reduced-motion；手感对标 openmarket.xyz（丝滑：密而不乱/按意思直达/60fps/层级克制）。
10. **判活**：workflow 在途时 `ListWorkflowRuns` 的 token/updated_at 有延迟假象，判死只认 `GetWorkflowRun` 的 `health.stalled`；施工员大批量小段编辑时 20+ 分钟无 journal 更新属正常。

## 4. 定时任务恢复（当前已停）

- saved workflow 完好：`.zcode/workflows/hourly-project-optimizer.dwf.ts`，按 `CreateWorkflow saved { name: "hourly-project-optimizer" }` 启动，无参数。
- cron automation `automation-0ea459ec` 已删除（用户叫停）。恢复要点：`CronCreate`，cron `0,13,33,53 * * * *`，prompt 里 `date +%M` 分支——分钟<15 为开发职责（先查在途运行防叠开，再按 saved 名启动），其余为健康检查（provider/interrupted 停摆→`ResumeWorkflowRun`；最新运行非在途且 created_at>70 分钟→补跑；errored 只修一次）。注意一个宿主限制：**一个会话只能属于一条定时任务**。
- 独立看门狗（跨会话）安装说明在 `_scripts/optimizer-monitor-prompt.md`。

## 5. 工作区遗留物清单

| 项 | 状态 | 处置建议 |
|---|---|---|
| 6 个半成品文件（§2.1） | 未提交，未验证 | 先跑测试看状态，再选三条路之一 |
| `7f7ab64` DST 修复 | 已提交未推送 | 下次推送顺带带走 |
| `OPTIONS-COMMIT-MSG.txt` | 未跟踪，早于本流水线存在 | 与流水线无关，别动 |
| 本文件 + OPTIMIZER-LOG/ROADMAP | 已提交 | 随仓库走 |

——交接完毕。往下做任何一轮之前，把 `docs/TV-ROADMAP.md` 的「使命与纪律」和本文 §3 再读一遍。
