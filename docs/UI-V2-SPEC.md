# UI v2 设计规格 ·「NEXUS 深空终端」

> 2026-11-08。用户裁定：**推倒重来**——只要一套设计语言，旧 8 套皮肤删除；要有科技感、要符合直觉；动效全盘对齐 Telegram-iOS 开源实现；同时重做 Agent 数据 API 链路。
> 本文是全体施工员的**唯一契约**。所有 CSS 只能消费令牌，不许写死颜色尺寸。

---

## 0. 文件所有权（禁止跨界，冲突会毁掉整合）

| 谁 | 拥有文件（只许改这些） |
|---|---|
| Lead | `css/style.css`（令牌单一事实源 + 旧结构兜底）、`docs/*`、`_test/*`、`README.md`、整合与截图 |
| shell | `index.html`、`css/ui/01-shell.css`、`js/ui/navmap.js`、`js/ui/command.js`、`js/tabscope.js`、`js/app.js`（只改导航/皮肤/深链相关段） |
| market | `css/ui/02-market.css` |
| panels | `css/ui/03-panels.css` |
| motion | `js/ui/motion.js`、`css/ui/04-motion.css`（**不许碰 app.js**，靠委托/观察者挂钩） |
| api | `api/**`、`mcp/**`、`_scripts/build-api.mjs`、`docs/API.md`、`_test/api.test.mjs` |

`index.html` 由 **shell 独占**：要加 `<link>`/`<script>`、要改结构，全部走 shell；其他人只发消息请求。
CSS 加载顺序（shell 负责落地）：`css/style.css` → `css/ui/01-shell.css` → `02-market.css` → `03-panels.css` → `04-motion.css`。

---

## 1. 设计语言：一套语言、两个模式

- `html[data-theme="nexus"]`（深空）／`html[data-theme="daylight"]`（**2026-11-09 起为默认**）。**旧 8 套皮肤与新皮肤随机换肤已删除**。
- 令牌全部已在 `css/style.css` 的 `:root` 里（下表即契约，**不要在别的文件重复定义**）。

### 1.1 底色五层（数字越小越深）

| 令牌 | 深空 | 用途 |
|---|---|---|
| `--bg` | `#05080d` | 应用画布（body） |
| `--bg-sunken` | `#03060a` | 凹陷区（表头、井、输入框底） |
| `--bg-elevated` | `#0b1119` | 面板 / 弹层 / 设置面板底 |
| `--bg-card` | `#0a0f17` | 标准卡片、图表底色（canvas 读它） |
| `--bg-hover` | `#131c27` | 悬停 |
| `--bg-glass` | `rgba(11,17,25,.72)` | 玻璃面（配 `backdrop-filter: blur(18px) saturate(1.4)`） |

### 1.2 文字四级（全部对四表面 ≥4.5:1）

`--text` `#e8f0fa` → `--text-secondary` `#a6b6ca` → `--text-tertiary` `#8496ab` → `--text-faint` `#7b8da4`。
**规则**：正文/数字用 `--text`；次要说明 `--text-secondary`；12px 大写字距标签 `--text-tertiary`；图表刻度/脚注 `--text-faint`。不要用 alpha 变淡造层级（除 hover 蒙版）。

### 1.3 描边三级
`--border` 0.17 / `--border-hover` 0.30 / `--border-soft` 0.07 / `--border-strong` 0.42（都是 `rgba(146,176,214,α)`）。
**深空禁阴影**（`--shadow-1/2: none`）——海拔只能靠：①1px 描边 ②顶部 1px 内高光 `inset 0 1px 0 rgba(255,255,255,.04)` ③模糊光斑。

### 1.4 强调色唯一
`--accent-signature` `#35e1ff` + `--accent-rgb`（必须同值）；副色 `--accent-2` `#4f7cff` 只用于渐变与图表次强调。
- **只允许**出现在：当前态（active tab / 选中卡片）、可交互高亮（hover 描边、焦点环）、品牌标识、图表主指标线。
- **禁止**：大面积填充（除 ≤8% alpha 的 hover 底）、正文文字色、非语义装饰。
- 渐变线 `--accent-line` 只用于「当前分区指示器」与「品牌下划线」。

### 1.5 涨跌语义（红涨绿跌默认，`body[data-updown="green"]` 反转）
色块/图形用 `--up`/`--down`；**文字用 `--text-rise`/`--text-fall`**；背景用 `--up-bg`/`--down-bg`。
**红绿只许表示涨跌**——选中、品牌、强调不许用红绿；警示用 `--warn`。

### 1.6 形状
`--r-sm 4` `--r-md 8` `--r-lg 14` `--r-pill 999px`。三档语义：迷你控件/行内 = `--r-sm`；标准卡/按钮/输入 = `--r-md`；浮层/大卡/弹窗 = `--r-lg`；条形与胶囊 = `--r-pill`。**不许出现第 5 个圆角值**（0 与 50% 只给图形与方角元素）。

### 1.7 间距与字号
间距七档 `--sp-4/8/12/16/24/32/48`；字号五档 `--fs-12/13/15/20/32`（floor 12px）。**不许写死 px 间距/字号**（1px 描边、1px 位移、icon 尺寸除外；icon 用 14/16/18/20 这类像素光栅值允许）。

### 1.8 材质三模板（全站只有这三种卡）
```
光面卡 .surface   background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0) 60%), var(--bg-card);
                  border: 1px solid var(--border); border-radius: var(--r-md);
                  内高光 inset 0 1px 0 rgba(255,255,255,.04)
玻璃浮层 .glass    background: var(--bg-glass); backdrop-filter: blur(18px) saturate(1.4);
                  border: 1px solid var(--border-hover); border-radius: var(--r-lg); box-shadow: var(--shadow-2)
裸排 .bare        无底无框，只靠 hairline 分隔（表格、行情行、事件流）
```
**禁止**：彩色左边框条（旧红竖条）、粗黑分隔线（>1px）、阴影叠阴影、嵌套超过两层卡。

---

## 2. 动效规格（Telegram-iOS 实测参数的 CSS 翻译）

来源：TelegramMessenger/Telegram-iOS（GPLv3，**只取参数不抄代码**）。曲线令牌已在 `:root`。

| 场景 | 时长/曲线 | 出处 |
|---|---|---|
| 按压高亮（进快出慢） | `:active{transition:none; 底色 rgba(255,255,255,.09); transform:scale(.98)}`；松开 `background .2s var(--ease-out)` | HighlightableButton:13-18 |
| 小元素弹入（徽标/复选/图标） | `.42s var(--ease-spring)`（6.5% 过冲） | CheckNode:192 |
| 弹层/菜单出现 | `transform .42s var(--ease-panel)` + `opacity .2s`（2.1% 过冲），`transform-origin` 指向触发点 | ContextControllerImpl:574 |
| 弹层收起 | `transform/opacity .2s var(--ease-exit)`——**永远比出现快，且不用弹簧** | ActionSheet:185 |
| 布局级位移 | `.3s var(--ease-signature)` 或 `--ease-out` | CAAnimationUtils:186 |
| 数字变化 | 旧数字 `translateY(±0.6em) scale(1→.3) opacity 0`，新数字 `scale(.3→1)`，两段各 `.2s`；**不做走马灯** | AnimatedCountLabelNode:186 |
| 勾选 | `scale 1→.9(80ms)→1.1(130ms)→1(100ms)` | CheckNode:196 |
| 列表错峰入场 | `translateY(8px)`→0，`.4s var(--ease-signature)`，stagger 40ms，总长 ≤.3s | 外推 |

**铁律**：
1. 只动 `transform` / `opacity` / `color` / `background-color`（外加 `backdrop-filter` 的静态值，不要动画它）。
2. `prefers-reduced-motion: reduce` 下：全部过渡压到 `0.01ms`，禁用位移与错峰（保留颜色反馈）。
3. `display:none` 切换的浮层用 `@keyframes`（transition 不触发）。
4. 不做「到处弹」——数据密集区克制，只在高频交互点给反馈。

---

## 3. 信息架构：12 → 5 个一级

```
市场  (all → 二级：全部 / A股 / 港股 / 美股 / 加密 / 宏观 / 期权)
事件  (events)
资产  (watch → 二级：自选 / 持仓)
基金  (compare)
洞察  (chain → 二级：产业链 / 席位·13F —— 若现有视图只有一条则不显示二级条)
```
- 一级栏 5 个按钮，等宽，胶囊或下划线二选一（**由 shell 定，且只有一个当前态表达**）。
- 二级用 segmented control（`.seg` 现有组件），只在子项 ≥2 时出现。
- **内部 `state.tab` 仍用旧 key**（`all/cn/hk/us/crypto/fxmacro/option/events/chain/watch/portfolio/compare`），由 `js/ui/navmap.js` 做「一级↔子项」纯函数映射。好处：深链、`tabscope.js`、`zones.js`、`marketscope.js` 的既有契约与测试全部不动。
- 深链兼容：`#tab=cn` 照旧可用，打开后自动切到「市场」一级 + A股 子项。
- **命令面板 Ctrl/Cmd+K**：搜索代码/名称/中文拼音首字母 + 跳功能（切 tab、开指标、改主题、导出快照）。键盘全流程：↑↓ 选择、↵ 执行、Esc 关闭、Tab 不逃逸。无障碍：`role="dialog"` + `aria-modal` + `combobox`/`listbox` 语义 + 焦点陷阱（复用 `js/focus-trap.js`）。
- 顶栏右侧：`⌘K` 触发按钮、刷新状态点、设置。移动端：一级栏横向可滚（隐藏滚动条、边缘渐隐），二级条吸顶。

---

## 4. 施工纪律

1. **只消费令牌**，不写死 hex / px 间距 / 字号。新组件必须在深空与日光两模式下都核对对比度（正文 4.5:1、非文本 3:1）。
2. `css/style.css` 是 **Lead 独占**；其他人一律在自己的 `css/ui/*.css` 里写，用同权重或更高权重覆盖旧规则（旧结构兜底层还在，覆盖不完全就会「半新半旧」，发现即报告）。
3. 不要把 `!important` 当常规手段；只有覆盖旧规则确有必要时，加注释说明为什么。
4. 每改一段就截图看：`node _qa/shot.mjs <url> <png> [w] [h] [waitMs] [theme] [tab]`（服务已起在 `http://127.0.0.1:8123/index.html`；若没起：`python -m http.server 8123 --bind 127.0.0.1`）。
5. 行尾：新建文件一律 LF。`index.html`、`css/style.css`、`js/app.js` 是 CRLF（autocrlf），用工具改或整文件重写时保持 CRLF。
6. 测试：`node _test/run-all.mjs --offline` 必须全绿；`_test/tokens.test.mjs` 会扫 `css/style.css + css/ui/*.css` 全量，别踩已钉死的令牌断言（间距七档/字号五档/圆角三档/描边 1px/涨跌色不外溢）。
7. 不 commit、不 push（Lead 统一处理）。

## 5. 验收（Lead 执行）

- `node _test/run-all.mjs --offline` 全绿；
- 截图：1440×1000 与 390×844 × 5 个一级视图 × 深空/日光；
- 命令面板键盘全流程可用；一级/二级切换有指示器滑动动效；
- 无「半新半旧」区块（逐个 tab 拍照比对）；无双滚动条、无溢出、无 12px 以下文字。

---

## 6. v3（2026-11-09）：减法重做（用户反馈后的一轮）

> 用户原话：「UI 推倒重来的意思不是你换个色就行的，是有的逻辑也要改。比如这个玩意啥用都没有，该删的删。皮肤还是白色或者黑色背景就行。」

**改了什么**

| 类型 | 内容 |
|---|---|
| 视觉 | 纯黑 `#000` / 纯白 `#fff` 底；中性灰文字与描边（去掉深空蓝调）；强调色退成单色（深空白 / 日光黑）；删除画布网格、双光斑、卡片光面渐变、玻璃模糊、内高光 |
| 删除 | 首屏「市场简报带」（那条全球指数/A股涨跌长条）；「全部」页的 9 行全球指数表（与 hero + 裸排条重复）；页头解释性长句（heroCap / eventsSub）；预测市场页头的口径长句与环图说明；页脚数据源墙（收进 `<details>`） |
| 逻辑 | 无自选 → 整块隐藏（不再留空态卡占一行首屏）；指数墙从「6 张和 hero 一样的卡」降级为裸排条（层级区分）；分区可用性随 `data-zone` 同步（不会留一个可选但空白的「概览」） |
| 修复 | 手机端 `.tape` 被后加载层重新显示（分层后同特异性后者胜）；预测市场卡片 `minmax(380px,1fr)` 在 390px 撑破布局视口（整页被缩小到 421→390）；`.primary-nav` 缺 `min-width:0` |

**验收**：45 组离线测试全绿（tokens 66）；`_qa/qa.mjs` 63/63；`_qa/shell-check.mjs` 48/48（390px 无横向溢出）；截图见 `_qa_shots/v3done/`。
