const fs = require('fs');
const p = 'D:/57的vibe coding内容/global-fin-dashboard/README.md';
let s = fs.readFileSync(p, 'utf8');
const crlf = s.includes('\r\n');
if (crlf) s = s.split('\r\n').join('\n');

const start = s.indexOf('## 界面语言 v2 · NEXUS 深空终端');
const end = s.indexOf('## 给 Agent 的数据链路（REST + MCP）');
if (start < 0 || end < 0) throw new Error('anchor');

const block = `## 界面：一套设计语言，纯黑 / 纯白

2026-11 的两轮重构。第一轮把旧的 8 套皮肤（瑞士 / 包豪斯 / 黏土 / 孟菲斯 / 报纸 / 极光 / OLED / 暗色）全部删掉，收成**一套**设计语言的两个模式；第二轮按"减法"重做——去掉装饰、删掉讲第二遍的模块。

- **纯黑 / 纯白**：深空模式 \`#000\` 底、日光模式 \`#fff\` 底，文字与描边全是中性灰，**没有蓝色调、没有渐变、没有玻璃模糊、没有背景网格与光晕**。强调色退成单色（深空白 / 日光黑），颜色只留给涨跌和图表。
- **令牌单一事实源**：底色/文字/描边/圆角三档/间距七档/字号五档全部在 \`css/style.css\` 的 \`:root\`，被 \`_test/tokens.test.mjs\` 66 条断言逐条守着（间距不许离格、字号不许低于 12px、红绿不许外溢到非涨跌元素）。
- **信息架构 12 → 5**：一级只剩「市场 / 事件 / 资产 / 基金 / 洞察」，每个一级下面是原来的板块（市场 = 全部·A股·港股·美股·加密·宏观·期权）。内部 \`state.tab\` 的钥匙一个没改，\`#tab=cn\` 这类老深链、按板块自定义顺序、分区判定全部照旧。
- **⌘K / Ctrl+K 命令面板**：中文名 / 拼音首字母 / 代码 / 功能名直达，键盘全流程（↑↓ 选择、↵ 执行、Esc 关闭）。
- **动效按 Telegram-iOS 开源实现的实测参数翻译**（[\\\`docs/UI-V2-SPEC.md\\\`](docs/UI-V2-SPEC.md) 有逐条出处）：按压"进快出慢"（按下瞬时着色、松开 0.2s 淡出）、弹层 0.42s 弹簧（2.1% 过冲）而收起只要 0.2s、数字变化是"旧值位移淡出 + 新值放大进场"而不是走马灯、列表错峰 40ms、页面切换用 View Transitions。全部只动 \`transform/opacity/color\`，\`prefers-reduced-motion\` 下收敛成纯颜色反馈。

**减法删掉的东西**（都是同一信息讲第二遍）：首屏「市场简报带」那条红绿长条、「全部」页重复的 9 行全球指数表、页头解释实现口径的长句、空的自选占位卡、页脚数据源墙（收进折叠项）。**逻辑也跟着改**：没有自选就整块隐藏；指数墙从"6 张和主卡一样的卡"降级成裸排条；分区可用性随内容动态判定，不会出现"点了是空白"的分区。

分层在 \`css/ui/\`（\`01-shell\` 外壳 / \`02-market\` 行情 / \`03-panels\` 面板 / \`04-motion\` 动效），每层只消费令牌；\`css/style.css\` 是「令牌单一事实源 + 旧结构兜底」。设计契约与两轮改造记录见 [\\\`docs/UI-V2-SPEC.md\\\`](docs/UI-V2-SPEC.md)。

`;

s = s.slice(0, start) + block + s.slice(end);
if (crlf) s = s.split('\n').join('\r\n');
fs.writeFileSync(p, s, 'utf8');
console.log('README section rewritten');
