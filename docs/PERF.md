# 首屏性能（怎么量、量到了什么、还能往哪优化）

> 目标不是「Lighthouse 分数」，是**用户打开页面到看见自己关心的数字**这段时间。
> 所以所有指标都以「首屏数字真的出现在屏幕上」为准，而不是 load 事件。

## 1. 现在长什么样

线上：<https://5777-wq.github.io/openfinlens/>（GitHub Pages，无 CDN）。
首次访问（无缓存）走四段：

| 阶段 | 内容 | 现在 |
|---|---|---|
| 1. 文档 | `index.html`，22KB gzip（含静态骨架 DOM） | TTFB ≈ 0.3–0.6s（Pages 从国内访问，抖动大） |
| 2. 样式 | `css/bundle.css`，31KB gzip，**一个**渲染阻塞请求 | ≈ 0.3s |
| 3. 首屏包 | `js/bundle.js`，124KB gzip，**一个** defer 请求 | ≈ 0.4s |
| 4. 行情 | 首屏 47 个标的走腾讯/东财批量接口 | ≈ 0.3s |

第 3 步之前页面**已经画出骨架**（hero 四格 + 指数条 + 卡片墙的 `.sk`），所以第 1 步完成就看得见结构；
数字在第 4 步落地。老访客走 localStorage 缓存优先，第 1 步完成就有上一次的行情（带 cache 角标）。
懒加载包（`js/bundle-lazy.js`，102KB gzip）与图表库在第 3 步之后才开始下，**不占关键路径**。

## 2. 同条件 A/B 实测（v3.3 → v3.4）

只看线上数字会被链路抖动骗：同一份 124KB 在沙箱里有时 230ms、有时 670ms，TTFB 在 263–653ms 之间跳。
所以用 `_qa/perfcmp.mjs` 做固定条件的 A/B：同一浏览器、`1.6Mbps / 750kbps / 150ms RTT` 限速、
两边都用 gzip 托管、交替跑 3 轮取中位数（旧构建 `99b1661`，新构建 `1399682`）。

| 指标 | 改之前 (v3.3) | 改之后 (v3.4) | 变化 |
|---|---|---|---|
| FCP 首次绘制 | 1260ms | **764ms** | **−39%** |
| 首屏指数出数（hero） | 3459ms | **1334ms** | **−61%** |
| 全球指数条 | 3652ms | **1517ms** | **−58%** |
| DOMContentLoaded | 3457ms | **1320ms** | −62% |
| 样式传输 | 86KB gz | **31KB gz** | −64% |
| JS 传输 | 501KB gz | **328KB gz** | −35% |
| 总传输 | 1003KB | **744KB** | −26% |

> JS 那 328KB 含 102KB 懒加载包 + 51KB 图表库——它们在首屏绘制之后才下载，不计入关键路径；
> **关键路径 JS 只有 124KB**（v3.3 是 431KB）。
> 复现命令见 [`_qa/README.md`](../_qa/README.md)。

线上单次采样为什么看起来只快了一点：沙箱到 GitHub Pages 的 TTFB 在 263–653ms 之间抖，
单次噪声大于改动收益。用户网络越慢越远，这次「首屏少传约 850KB」的收益越明显。

## 3. 已经做掉的（按收益排序）

| 改动 | 收益 |
|---|---|
| 69 个 `<script defer>` → 1 个 `js/bundle.js` | JS 请求 73 → 5；慢网下不再排 ~1.9s 的队 |
| 核心包 / 懒加载包拆分（v3.4） | 首屏 JS 431KB → **124KB gzip**（−71%） |
| JS 词法压缩（只删注释与冗余空白） | 不压缩是 225KB gzip，压缩后 124KB |
| 5 个 CSS → `css/bundle.css` + 压缩 | 88KB → **31KB gzip**（−65%），渲染阻塞请求 5 → 1 |
| `lightweight-charts` 移出首屏 | 首屏少 50KB gzip；点开详情时才注入 |
| 缓存优先：先铺上一次的行情 | 二次访问数据 **51–62ms** 出现 |
| 首屏最多等行情 3.5s | 任一上游抽风不再整屏骨架挂死 |
| 全球指数条与行情并发 + 缓存 | 指数条首访 4374ms → 2407ms（线上 v3.3 实测） |
| 数据源 `preconnect` | 首屏 fetch 少 1–2 个 RTT |
| 静态骨架写进 HTML | JS 没跑完也能看见结构，不像「页面坏了」 |

## 4. 禁地（别为了指标破坏这些）

- **首屏 JS 包不许超过 300KB gzip**、**CSS 不许超过 60KB gzip**（`_test/bundle.test.mjs` 会失败）。
- **不许把懒加载包塞回 `index.html`**（同上，会失败）。
- 不许为了「快」把骨架换成空白：空白比骨架更让人以为页面坏了。
- 不许引入运行时海外 CDN（见 `lib/THIRD_PARTY.md`）；字体只做异步加载，断网也不影响可读性。

## 5. 怎么量

```bash
python -m http.server 8123 --bind 127.0.0.1                     # 本地（不压缩，够看时序）
node _qa/waterfall.mjs http://127.0.0.1:8123/                  # 逐资源：字节 / 起止 / TTFB
node _qa/waterfall.mjs https://5777-wq.github.io/openfinlens/  # 线上
node _qa/load.mjs                                              # 首屏时序（FCP/LCP/hero/globe）
node _qa/load2.mjs                                             # 首访 vs 二访（缓存优先是否生效）
node _qa/boot.mjs                                              # 首屏 + 5 个一级入口跑一遍，收报错
node _qa/slowshot.mjs                                          # 限速下截「加载中」的样子

# 想比「改之前/之后」：两边都用 serve.mjs 出 gzip，再限速对照跑
node _qa/serve.mjs ../ofl-before 8124 &
node _qa/serve.mjs . 8125 &
node _qa/perfcmp.mjs http://127.0.0.1:8124/ http://127.0.0.1:8125/ before after 3
```

判读要点：

- `waterfall.mjs` 输出里 **`Document` 的 `st→en`** 就是 TTFB，改代码动不了它（换 CDN 才行）。
- **`js/bundle.js` 的 `en`** 是「JS 可执行」的时刻，首屏 fetch 只能在这之后 —— 想提前只能减字节。
- 头部无 `gzip` 标记的资源是**未压缩**传输（本地 `http.server` 不压缩属正常；Pages 会压）。
- `Fetch` 行的 `kb` 全是数据不是代码：不阻塞首屏绘制，但会抢带宽。

## 6. 还能更快的三条路（未做）

1. **关键 CSS 内联**：把 `bundle.css` 直接写进 `<head>`。省掉一个渲染阻塞请求，
   FCP 可再提前约 200–300ms；代价是 HTML 从 22KB 涨到约 56KB gzip（每次访问都要下）。
   适合「首访体验优先」；对「十秒后回访」反而略亏。
2. **减少首屏后数据预取**：开屏会后台预取事件 / 13F / 龙虎榜（线上合计约 0.5MB），
   其中 `CoinGecko /v1/tickers?limit=1000` 一条 154KB、耗时 1.3s。按需再取可让网络更早安静。
3. **套 CDN**：GitHub Pages 国内 TTFB ≈ 0.5s，Cloudflare 前置可到 0.1s 级，
   这是唯一能改善第 1 段的办法（代码层面已经压到底了）。
