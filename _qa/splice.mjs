// 一次性结构手术：把 css/style.css 的 :root 令牌块换成 v2，删除旧 8 套皮肤，写入日光模式
// 用法：node _qa/splice.mjs [--dry]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const p = path.join(ROOT, 'css/style.css');
let s = fs.readFileSync(p, 'utf8');
const CRLF = s.includes('\r\n');
const lines = s.split(/\r?\n/);
const dry = process.argv.includes('--dry');

const newTokens = fs.readFileSync(path.join(__dirname, 'tokens-block.css'), 'utf8').replace(/\n$/, '');

// 1) :root 块（第 16 行到第 103 行，1-based）
const startIdx = lines.findIndex(l => l.trim() === ':root {');
let endIdx = -1;
for (let i = startIdx; i < lines.length; i++) if (lines[i].trim() === '}') { endIdx = i; break; }
console.log('root block lines', startIdx + 1, '..', endIdx + 1);

const before = lines.slice(0, startIdx);
const after = lines.slice(endIdx + 1);

// 2) 旧皮肤区域：从「界面皮肤（html[data-theme]）」注释起，到 memphis 最后一条规则止
const skinStart = after.findIndex(l => /界面皮肤（html\[data-theme\]）/.test(l));
let skinEnd = -1;
if (skinStart >= 0) {
  for (let i = skinStart; i < after.length; i++) {
    if (/宏观策略面板（macroview\.js）/.test(after[i])) { skinEnd = i - 1; break; }
  }
}
console.log('skin region', skinStart + 1, '..', skinEnd + 1, 'of after-array');

const lightTheme = `/* ==================== 日光模式（data-theme="daylight"）====================
   同一套设计语言的第二模式：结构与动效完全一致，只换明度关系。
   浅色下"光面"改用真实投影承接海拔（深空禁黑影，日光必须有影，否则卡片浮不起来）。
   强调色在浅底上压深一档到 #0091ad，保证焦点环 / 链接文字对白底 ≥4.5:1。 */
html[data-theme="daylight"] {
  --bg: #f6f8fb;
  --bg-elevated: #ffffff;
  --bg-card: #ffffff;
  --bg-hover: #eef3f9;
  --bg-sunken: #e8eef6;
  --bg-glass: rgba(255,255,255,0.78);
  --text: #0b1520;
  --text-secondary: #46586d;
  --text-tertiary: #5f7288;
  --text-faint: #6f8296;
  --border: rgba(18,42,70,0.12);
  --border-hover: rgba(18,42,70,0.26);
  --border-soft: rgba(18,42,70,0.06);
  --border-strong: rgba(18,42,70,0.34);
  --accent-signature: #0091ad;
  --accent-rgb: 0,145,173;
  --accent-2: #2f5bf0;
  --accent-2-rgb: 47,91,240;
  --accent-soft: rgba(0,145,173,0.10);
  --grid-line: rgba(30,70,110,0.05);
  --glow-1: 0,145,173;
  --glow-2: 47,91,240;
  --topbar-bg: rgba(246,248,251,0.85);
  --tape-bg: rgba(246,248,251,0.8);
  --text-rise: #d61f34;
  --text-fall: #0d8a5c;
  --up: #e5344a;
  --down: #10a06a;
  --up-bg: rgba(229,52,74,0.08);
  --down-bg: rgba(16,160,106,0.08);
  --up-rgb: 229,52,74;
  --down-rgb: 16,160,106;
  --focus-ring: #0091ad;
  --warn: #b45309;
  --chart-text: #5f7288;
  --chart-grid: rgba(18,42,70,0.07);
  --chart-border: rgba(18,42,70,0.14);
  --shadow-1: 0 1px 2px rgba(11,21,32,0.05), 0 8px 24px -12px rgba(11,21,32,0.18);
  --shadow-2: 0 2px 6px rgba(11,21,32,0.07), 0 24px 60px -24px rgba(11,21,32,0.28);
  --ring-glow: 0 0 0 1px rgba(var(--accent-rgb),0.45), 0 0 24px -10px rgba(var(--accent-rgb),0.5);
}

/* 画布环境光：两团极弱冷光 + 一层 40px 刻度网格，边缘用 mask 渐隐。
   网格与光斑都挂在 body::before（z-index:-1），永不吃点击、永不影响滚动。 */
body::before {
  content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(46% 34% at 18% -6%, rgba(var(--glow-1), 0.10), transparent 68%),
    radial-gradient(40% 30% at 88% 2%, rgba(var(--glow-2), 0.09), transparent 70%),
    linear-gradient(var(--grid-line) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) 0 0 / 40px 40px;
  -webkit-mask-image: radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 88%);
          mask-image: radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 88%);
}
`;

let mid = after.slice();
if (skinStart >= 0 && skinEnd > skinStart) {
  mid = [...after.slice(0, skinStart), lightTheme, ...after.slice(skinEnd + 1)];
}

const out = [...before, ...newTokens.split('\n'), ...mid].join(CRLF ? '\r\n' : '\n');
console.log('bytes', s.length, '->', out.length);
if (!dry) fs.writeFileSync(p, out, 'utf8');
