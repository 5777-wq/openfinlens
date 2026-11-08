// 一次性结构手术 v2：替换 :root 令牌 → 删掉旧 8 套皮肤的全部规则 → 换掉图表令牌与画布环境光 → 注入日光模式
// 用法：node _qa/splice2.cjs [--dry]
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const p = path.join(ROOT, 'css/style.css');
let s = fs.readFileSync(p, 'utf8');
const CRLF = s.includes('\r\n');
const dry = process.argv.includes('--dry');
const OLD = ['dark', 'aurora', 'oled', 'paper', 'swiss', 'bauhaus', 'clay', 'memphis'];
const isOldThemeSel = sel => OLD.some(t => sel.includes('html[data-theme="' + t + '"]'));

/* 顶层规则切分：返回 [{sel, body, start, end, kind:'rule'|'at'}], 位置为字符偏移 */
function parseRules(src) {
  const out = [];
  let i = 0, depth = 0, selStart = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      i = j < 0 ? src.length : j + 2;
      if (depth === 0) selStart = i;   // 注释后重新开始量选择器
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        const sel = src.slice(selStart, i).trim();
        // 找匹配的 }
        let d = 1, j = i + 1;
        while (j < src.length && d > 0) {
          if (src[j] === '/' && src[j + 1] === '*') { const k = src.indexOf('*/', j + 2); j = k < 0 ? src.length : k + 2; continue; }
          if (src[j] === '{') d++;
          else if (src[j] === '}') d--;
          j++;
        }
        out.push({ sel, start: selStart, end: j, body: src.slice(i + 1, j - 1) });
        i = j; selStart = j; continue;
      }
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      selStart = i + 1;   // 顶层 @import/@charset 之类
    }
    i++;
  }
  return out;
}

const rules = parseRules(s);
const drop = [];
let rootRule = null, chartRoot = null, ambient = null;
for (const r of rules) {
  if (isOldThemeSel(r.sel)) { drop.push(r); continue; }
  if (r.sel === ':root') {
    if (/--accent-signature/.test(r.body)) rootRule = r;
    else if (/--chart-text/.test(r.body)) chartRoot = r;
  }
  if (r.sel === 'body::before') ambient = r;
}
console.log('规则总数', rules.length, '待删旧皮肤规则', drop.length,
  'root', !!rootRule, 'chartRoot', !!chartRoot, 'ambient', !!ambient);

const newTokens = fs.readFileSync(path.join(__dirname, 'tokens-block.css'), 'utf8').replace(/\n$/, '');
const lightTheme = fs.readFileSync(path.join(__dirname, 'light-block.css'), 'utf8').replace(/\n$/, '');

// 从后往前替换，避免偏移失效
const edits = [];
if (rootRule) edits.push({ start: rootRule.start, end: rootRule.end, text: newTokens });
if (chartRoot) edits.push({
  start: chartRoot.start, end: chartRoot.end,
  text: `:root {\r\n  --chart-text: #7e90a6;\r\n  --chart-grid: rgba(146,176,214,0.06);\r\n  --chart-border: rgba(146,176,214,0.12);\r\n}`,
});
if (ambient) edits.push({ start: ambient.start, end: ambient.end, text: lightTheme });
for (const r of drop) edits.push({ start: r.start, end: r.end, text: '' });

edits.sort((a, b) => b.start - a.start);
let out = s;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

if (CRLF) out = out.replace(/\r?\n/g, '\r\n');
console.log('bytes', s.length, '->', out.length);
if (!dry) {
  fs.writeFileSync(path.join(ROOT, '_qa/style.before-v2.css'), s, 'utf8');
  fs.writeFileSync(p, out, 'utf8');
  console.log('written（原文件备份在 _qa/style.before-v2.css）');
}
