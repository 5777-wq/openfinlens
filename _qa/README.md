# _qa —— 可复跑的验收探针（零依赖，Node 直接跑）

> 这里不是产品代码，是**验收工具**。所有脚本都只用 Node 内置能力（CDP 走 Node 22+ 自带的
> `WebSocket`），不装 puppeteer/playwright。图片产物已被 `.gitignore` 忽略，脚本进仓库。

| 脚本 | 一句话 | 典型输出 |
|---|---|---|
| `qa.mjs` | **总验收**：5 个一级 × 2 模式遍历 + 命令面板全流程 + 深链 + 390px，收 console 异常与 4xx | `63 passed, 0 failed` |
| `shell-check.mjs` | 外壳专项：布局/IA/全键盘/深链/双模式/合规剔除（reduce 模式下拍，终态稳） | `48 passed, 0 failed` |
| `shell-normal.mjs` | 正常动效模式下的指示器终态与异常（强制出帧） | `6 passed` |
| `motion-probe.mjs` | 动效真值：按压/弹层曲线/数字滚动/错峰/指示器/reduced-motion | `12 条断言` |
| `shot.mjs` / `shots.mjs` / `peek.mjs` | 截图：单张 / 矩阵 / 带前置 JS 的取证（`peek` 可点分区、弹层再拍） | `saved …png` |
| `api-commit-guard`（在 `_scripts/`） | 采集流水线里「语义没变就不提交」的守卫 | — |

## 两个必须知道的坑

1. **无头 Chrome 不产帧时 `transition`/`rAF` 全停在起点**。截图/测量前要么
   `Page.captureScreenshot` 逼一帧，要么 `Emulation.setEmulatedMedia(prefers-reduced-motion: reduce)`。
   本目录的截图脚本已默认加 reduce（静态取证稳定），动效真值由 `motion-probe.mjs` 用逼帧方式测。
2. **服务要先起来**：`python -m http.server 8123 --bind 127.0.0.1`
   （脚本默认打 `http://127.0.0.1:8123/index.html`，可用 `QA_URL` 覆盖）。

## 用法

```bash
node _qa/qa.mjs                 # 总验收
node _qa/shots.mjs _qa/shots --themes=nexus,daylight --tabs=all,events,watch,compare,chain
MOBILE=1 node _qa/shots.mjs _qa/shots-m --tabs=all,events
node _qa/peek.mjs out.png "document.querySelector('[data-zone-btn=\"heat\"]').click()" 1440 1100 3000 nexus
```
