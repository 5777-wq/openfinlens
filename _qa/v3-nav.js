const fs = require('fs');
const p = 'D:/57的vibe coding内容/global-fin-dashboard/css/ui/01-shell.css';
let s = fs.readFileSync(p, 'utf8');
const crlf = s.includes('\r\n');
if (crlf) s = s.split('\r\n').join('\n');

const a1 = "  flex: 0 1 auto;\n  height: 34px;\n  margin: 0 auto;";
const b1 = "  flex: 0 1 auto;\n  /* 关键：flex 子项默认 min-width:auto = 内容宽度。390px 下 5 个一级按钮的\n" +
  "     min-content 会把顶栏撑到 407px，浏览器随后放大布局视口 → 整页横向溢出。 */\n  min-width: 0;\n  height: 34px;\n  margin: 0 auto;";
if (!s.includes(a1)) throw new Error('a1 miss');
s = s.replace(a1, b1, 1);

const a2 = "    flex: 0 0 100%;\n    height: 34px;\n    margin: var(--sp-4) 0 0;";
const b2 = "    flex: 0 0 100%;\n    min-width: 0;\n    height: 34px;\n    margin: var(--sp-4) 0 0;";
if (!s.includes(a2)) throw new Error('a2 miss');
s = s.replace(a2, b2, 1);

if (crlf) s = s.split('\n').join('\r\n');
fs.writeFileSync(p, s, 'utf8');
console.log('ok');
