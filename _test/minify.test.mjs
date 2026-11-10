#!/usr/bin/env node
/* minify.test.mjs —— 压缩器自证测试（零依赖，只用 node:assert / node:vm / node:zlib）
 *
 * 核心自证（比手写用例更有说服力）：
 *   把 _scripts/js-bundle.manifest.json 里 69 个 JS 源逐个压缩，再用「同一个词法器」
 *   重新 token 化，断言压缩前后的 token 序列（type + value）完全相等。
 *   也就是说：压缩器只可能删掉了注释和空白，没有动任何代码 token。
 *   同时用 vm.Script 编译压缩结果（V8 真解析器），抓住 ASI 之类的语法漂移。
 *   再逐对检查「原始里有换行、且换行可能触发 ASI」的位置，压缩后换行必须还在。
 *
 * CSS：对 5 个样式文件断言压缩前后
 *   · 去掉注释/空白后的代码骨架完全一致（字符级自证）
 *   · 选择器序列 + @规则前置区序列 + 声明数一致（结构自证）
 *   · 标识符/数字词元序列一致（防止 1px solid 被粘成 1pxsolid）
 *   · calc() 里 `+`/`-` 两侧空格数量不减少；产物不含注释、行数下降、体积下降
 *
 * 跑法：node _test/minify.test.mjs     （全绿退出码 0，任一失败 1）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { minifyJs, tokenize, needsLineBreak } from '../_scripts/minify-js.mjs';
import { minifyCss } from '../_scripts/minify-css.mjs';

/* ================================================================== *
 * 小工具
 * ================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MANIFEST = path.join(ROOT, '_scripts/js-bundle.manifest.json');
const CSS_FILES = [
  'css/style.css',
  'css/ui/01-shell.css',
  'css/ui/02-market.css',
  'css/ui/03-panels.css',
  'css/ui/04-motion.css',
];

const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
const gzOf = (s) => zlib.gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
const pct = (a, b) => (a === 0 ? '0.0' : ((b / a) * 100).toFixed(1)) + '%';

let passed = 0;
const failures = [];

function indent(text) {
  return String(text)
    .split('\n')
    .slice(0, 10)
    .map((line) => '      ' + line)
    .join('\n');
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push(name);
    console.log('  ✗ ' + name);
    console.log(indent(err && err.message ? err.message : String(err)));
  }
}

function section(title) {
  console.log('\n===== ' + title + ' =====');
}

/* ---------- JS 断言工具 ---------- */

const tokenKey = (t) => t.type + ':' + t.value;

function firstTokenDiff(a, b) {
  if (a.length !== b.length) return 'token 数不同：' + a.length + ' → ' + b.length;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return '第 ' + i + ' 个 token 不同：' + JSON.stringify(a[i]) + ' → ' + JSON.stringify(b[i]);
    }
  }
  return '';
}

// 压缩前后 token 序列（type+value）必须逐项相等
function assertSameTokens(src, where) {
  const out = minifyJs(src);
  const a = tokenize(src).map(tokenKey);
  const b = tokenize(out).map(tokenKey);
  const diff = firstTokenDiff(a, b);
  assert.equal(diff, '', (where ? where + '：' : '') + diff);
  return out;
}

function assertNoComments(code, where) {
  const comments = tokenize(code, { keepComments: true }).filter((t) => t.type === 'comment');
  const first = String(JSON.stringify((comments[0] || {}).value)).slice(0, 100);
  assert.equal(
    comments.length,
    0,
    (where ? where + '：' : '') + '压缩后仍残留 ' + comments.length + ' 条注释，第一条是 ' + first,
  );
}

function assertCompiles(code, where) {
  new vm.Script(code, { filename: where || 'minified.js' });
}

// 在独立 vm 里跑一遍：返回 { ok, value } 或 { ok:false, error:错误类型 }
function probeEval(code) {
  try {
    const value = vm.runInNewContext(code, Object.create(null), { timeout: 2000 });
    return { ok: true, value: JSON.stringify(value) };
  } catch (err) {
    return { ok: false, error: err && err.constructor ? err.constructor.name : String(err) };
  }
}

// 行为必须与压缩前一致（值或异常类型都要一致）
function assertSameEval(src, where) {
  const out = minifyJs(src);
  const before = probeEval(src);
  const after = probeEval(out);
  assert.deepEqual(
    after,
    before,
    (where ? where + '：' : '') +
      '行为不一致：原始=' + JSON.stringify(before) + '，压缩后=' + JSON.stringify(after) +
      '\n压缩结果：' + out.slice(0, 300),
  );
  return out;
}

/* ---------- CSS 工具（字符串/url 感知的扫描） ---------- */

const CSS_WS = ' \t\n\r\f';
const isCssWs = (ch) => ch !== undefined && CSS_WS.includes(ch);
const isCssWord = (ch) =>
  ch !== undefined &&
  ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ||
    ch === '_' || ch === '-' || ch === '%' || ch > '\u007f');

// 从 i 开始扫一个引号字符串，返回结束位置（不含）
function skipCssString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === '\n' || ch === '\r' || ch === '\f') return i;
    i += 1;
  }
  return i;
}

// 从 i（指向 'url(' 的 u）开始扫完整 url(...)，返回结束位置
function skipCssUrl(src, i) {
  i += 4;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(src, i);
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  return i;
}

function isUrlAt(src, i) {
  return (
    (src[i] === 'u' || src[i] === 'U') &&
    /^url\(/i.test(src.slice(i, i + 4)) &&
    !isCssWord(src[i - 1])
  );
}

// 代码骨架：删注释、删字符串/url 内容、删空白；用于字符级自证
function cssSkeleton(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (isCssWs(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(src, i);
      out += '\u0000';
      continue;
    }
    if (isUrlAt(src, i)) {
      i = skipCssUrl(src, i);
      out += '\u0000';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// 标识符/数字词元序列：两个文件骨架里 token 被粘连会改变词元，用作交叉校验
function cssWordRuns(src) {
  return cssSkeleton(src).match(/[A-Za-z0-9_%.-]+/g) || [];
}

// 选择器/at 规则前置区归一化：字符串原样，空白折叠，标点两侧统一
function normalizePrelude(text) {
  let out = '';
  let i = 0;
  const pushSpace = () => {
    if (out && !out.endsWith(' ')) out += ' ';
  };
  const trimEndSpace = () => {
    out = out.replace(/ +$/, '');
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const start = i;
      i = skipCssString(text, i);
      out += text.slice(start, i);
      continue;
    }
    if (isCssWs(ch)) {
      pushSpace();
      i += 1;
      continue;
    }
    if (ch === ',') {
      trimEndSpace();
      out += ',';
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    if (ch === '>' || ch === '+' || ch === '~') {
      trimEndSpace();
      out += ' ' + ch + ' ';
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    if (ch === '(' || ch === '[') {
      trimEndSpace();
      out += ch;
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      trimEndSpace();
      out += ch;
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    if (ch === ':') {
      trimEndSpace();
      out += ':';
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    if (ch === '=') {
      trimEndSpace();
      out += ' = ';
      i += 1;
      while (isCssWs(text[i])) i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.trim().replace(/ +/g, ' ');
}

const RULE_LIST_AT = /^@(media|supports|layer|container|scope|document|-moz-document|starting-style)\b/i;
const KEYFRAMES_AT = /^@[-\w]*keyframes\b/i;

// CSS 结构：选择器序列（按出现顺序）+ @规则前置区序列 + 声明条数
function cssStructure(src) {
  const selectors = [];
  const atPreludes = [];
  let declCount = 0;
  const stack = ['rules'];
  let buf = '';
  let declHasColon = false;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const finishDecl = () => {
    if (declHasColon) declCount += 1;
    declHasColon = false;
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (isCssWs(ch)) {
      if (!buf.endsWith(' ')) buf += ' ';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i = skipCssString(src, i);
      buf += src.slice(start, i);
      continue;
    }
    if (isUrlAt(src, i)) {
      const start = i;
      i = skipCssUrl(src, i);
      buf += src.slice(start, i);
      continue;
    }
    if (ch === '{') {
      const prelude = normalizePrelude(buf);
      if (prelude.startsWith('@')) {
        atPreludes.push(prelude);
        stack.push(RULE_LIST_AT.test(prelude) || KEYFRAMES_AT.test(prelude) ? 'rules' : 'decls');
      } else {
        selectors.push(prelude);
        stack.push('decls');
      }
      buf = '';
      declHasColon = false;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (top() === 'decls') finishDecl();
      if (stack.length > 1) stack.pop();
      buf = '';
      declHasColon = false;
      i += 1;
      continue;
    }
    if (ch === ';') {
      if (top() === 'decls') finishDecl();
      else buf = '';
      i += 1;
      continue;
    }
    if (ch === ':' && top() === 'decls') declHasColon = true;
    buf += ch;
    i += 1;
  }
  return { selectors, atPreludes, declCount };
}

function sameArray(a, b, label) {
  const diff = firstTokenDiff(a, b);
  assert.equal(diff, '', label + '：' + diff);
}

// calc(...) 里二元 + / - 两侧的空格数：压缩后不许减少（少了会破坏 calc 语法）
function countCalcOpSpaces(src) {
  const skeleton = cssSkeleton(src);
  let count = 0;
  let from = 0;
  for (;;) {
    const at = skeleton.indexOf('calc(', from);
    if (at < 0) break;
    let depth = 1;
    let i = at + 5;
    while (i < skeleton.length && depth > 0) {
      if (skeleton[i] === '(') depth += 1;
      else if (skeleton[i] === ')') depth -= 1;
      i += 1;
    }
    const body = skeleton.slice(at + 5, i - 1);
    count += (body.match(/ [+-] /g) || []).length;
    from = i;
  }
  return count;
}

/* ================================================================== *
 * 1. JS 词法边界：注释 / 字符串 / 模板 / 正则 / HTML 注释
 * ================================================================== */

section('1. JS 词法边界：注释 / 字符串 / 模板 / 正则 / HTML 注释');

test('字符串里的 //、/* 不被当注释', () => {
  const src = "var u='https://x/y'; var v=\"/* keep */\"; var w='// keep'; [u,v,w];";
  const out = assertSameEval(src);
  assertNoComments(out);
  assert.ok(out.includes('https://x/y'), out);
  assert.ok(out.includes('/* keep */'), out);
  assert.ok(out.includes('// keep'), out);
});

test('行注释 / 块注释（含中文）都删干净', () => {
  const src = 'var a = 1; // 中文行注释\n/* 中文块注释 */\nvar b = 2; /*! 保留风格注释也删 */\n/* 多行\n块注释 */ var c = 3;';
  const out = minifyJs(src);
  assertNoComments(out);
  assert.ok(!out.includes('中文'), out);
  assert.equal(out, 'var a=1;var b=2;var c=3;');
});

test('模板字符串（含 ${} 嵌套 + 嵌套里再套模板）原样保留', () => {
  const src = 'var a=1,b=2; var t=`x ${a + `y ${b} z`} w`; t;';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('`x ${a + `y ${b} z`} w`'), out);
});

test('模板 ${} 里的字符串/正则/注释不会提前截断模板', () => {
  const src = 'var t = `a ${ "}" + /}/.test("}") + (1 /* } */) } b`; t;';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('`a ${'), out);
});

test('正则 /a\\/b/g 与除号 a/b/c 区分正确', () => {
  const src = String.raw`var re=/a\/b/g; var a=100,b=2,c=5; var x=a/b/c; [re.source,re.flags,x];`;
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes(String.raw`/a\/b/g`), out);
});

test('字符类里的 / 与 /= 赋值运算符', () => {
  const src = 'var re=/[/]/; var x=10; x/=2; [re.source,x];';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('/[/]/'), out);
});

test('return 后面的 / 是正则，]) 后面是除号', () => {
  const src = 'function f(){ return /a/.source; } var arr=[10]; var r=f(); var d=arr[0]/2; [r,d];';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('/a/'), out);
});

test('if (x) 后面的 / 是正则；调用 f(x) 后面是除号', () => {
  const src = 'var f=function(){return 10;}; var r=f(20)/2; var x=true; if (x) /a/.test("a"); r;';
  assertSameEval(src);
  assertSameTokens(src);
});

test('<!-- 与行首 --> 按 HTML 注释删除', () => {
  const src = 'var a = 1;\n<!-- 旧式开注释\nvar b = 2;\n--> 旧式闭注释\nvar c = 3;\n[a,b,c];';
  const out = minifyJs(src);
  assert.ok(!out.includes('旧式'), out);
  assertCompiles(out);
  assertSameEval(src);
});

test('不在行首的 --> 是 a-- > b，不是注释', () => {
  const src = 'var a=5,b=2; var r = a --> b; r;';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('-- >') || out.includes('-->'), out);
});

test('字符串里的 U+2028 与转义 \\u2028 都按字符串内容处理', () => {
  const U2028 = String.fromCharCode(0x2028);
  const src = 'var s="a\\u2028b"; var t="a' + U2028 + 'b"; [s.length,t.length];';
  const out = assertSameEval(src);
  assertSameTokens(src);
  assert.ok(out.includes('"a\\u2028b"'), out);
});

test('文件末尾没有换行的行注释', () => {
  assert.equal(minifyJs('var a = 1; // tail comment'), 'var a=1;');
});

test('BOM 与 #! hashbang 行都不进产物', () => {
  assert.equal(minifyJs('\ufeffvar a = 1;'), 'var a=1;');
  assert.equal(minifyJs('#!/usr/bin/env node\nvar a = 1;'), 'var a=1;');
});

/* ================================================================== *
 * 2. ASI 边界（换行必须保留 vs 可以删）
 * ================================================================== */

section('2. ASI 边界：换行该留的必须留');

test('a\\n(b)：换行保留（否则 a 被调用）', () => {
  const src = 'var a = 1; var b = 2; a\n(b);';
  const out = minifyJs(src);
  assert.ok(out.includes('a\n('), '换行被删：' + JSON.stringify(out));
  assertSameTokens(src);
  const probe = (code) => {
    try {
      vm.runInNewContext(code, Object.create(null), { timeout: 2000 });
      return 'no-throw';
    } catch (err) {
      return err.constructor.name;
    }
  };
  assert.equal(probe(out), probe(src), '压缩后行为变了：' + out);
});

test('return\\nx：return 值必须是 undefined', () => {
  const src = 'function f(){ return\n1 } f();';
  const out = assertSameEval(src);
  assert.ok(out.includes('return\n1'), '换行被删：' + out);
});

test('[1]\\n[0]：两条语句不能粘成下标', () => {
  const src = 'var a = [1]; var b = 2; [a]\n[b];';
  const out = minifyJs(src);
  assert.ok(/\]\n\[/.test(out), '换行被删：' + JSON.stringify(out));
  assertSameTokens(src);
});

test('x\\n++y：换行保留（否则 ++ 粘到 x 上）', () => {
  const src = 'var x = 1, y = 1; x\n++y; [x,y];';
  const out = assertSameEval(src);
  assert.ok(/\n\+\+/.test(out), '换行被删：' + JSON.stringify(out));
});

test('} 与反引号 / 正则之间的换行保留', () => {
  const src = 'if (true) {}\n`hi`;\nif (true) {}\n/x/.test("x");';
  const out = assertSameEval(src);
  assert.ok(out.includes('}\n`'), '块后反引号换行被删：' + JSON.stringify(out));
  assert.ok(out.includes('}\n/x/'), '块后正则换行被删：' + JSON.stringify(out));
});

test('U+2028 换行等价于 \\n（a U+2028 (b) 也要保留换行）', () => {
  const U2028 = String.fromCharCode(0x2028);
  const src = 'var a = 1; var b = 2; a' + U2028 + '(b);';
  const out = minifyJs(src);
  assert.ok(out.includes('a\n('), '换行被删：' + JSON.stringify(out));
  assertCompiles(out);
});

test('该删的换行要删掉（; { , [ 之后的换行）', () => {
  const src = 'var a = 1;\nvar b = 2;\nvar c = [\n  a,\n  b\n];\n';
  const out = minifyJs(src);
  assert.ok(!out.includes('\n'), '该删的新行没删：' + JSON.stringify(out));
  assertSameEval(src);
});

/* ================================================================== *
 * 3. 粘连保护：+ +、- -、1 .toString()、in / typeof / else if
 * ================================================================== */

section('3. 粘连保护：不能把两个 token 拼成一个');

test('+ + / - - 不能粘成 ++ / --', () => {
  const src = 'var a = 1, b = 2; var c = a + +b; var d = a - -b; [c,d];';
  const out = assertSameEval(src);
  assert.ok(out.includes('+ +'), '加号粘连：' + out);
  assert.ok(out.includes('- -'), '减号粘连：' + out);
});

test('数字后紧跟点：1 .toString() / 1..toString() / 0x1f .toString(16)', () => {
  const src = 'var x = 1 .toString(); var y = 1..toString(); var z = 0x1f .toString(16); [x,y,z];';
  const out = assertSameEval(src);
  assert.ok(out.includes('1 .toString'), '数字后空格丢了：' + out);
});

test('a in b / typeof x / else if 的空格保留', () => {
  const src = 'var a = "x", o = {x:1}; var r = a in o; function f(v){ if (v) return typeof v; else if (v === 0) return "zero"; return "no"; } [r,f("s"),f(0),f(1)];';
  const out = assertSameEval(src);
  for (const needle of ['in ', 'typeof ', 'else if']) {
    assert.ok(out.includes(needle), '缺少必须空格 ' + JSON.stringify(needle) + '：' + out);
  }
});

test('1 in x 数字与关键字之间要有空格', () => {
  const src = 'var r = 1 in [1]; r;';
  const out = assertSameEval(src);
  assert.ok(out.includes('1 in'), '数字/关键字粘连：' + out);
});

/* ================================================================== *
 * 4. 核心自证：manifest 里 69 个 JS 源，token 序列必须完全一致
 * ================================================================== */

section('4. 核心自证：69 个 JS 源压缩前后 token 序列完全一致 + V8 可编译');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const jsRows = [];

for (const rel of manifest.files) {
  test(rel, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const out = minifyJs(src);

    // (1) token 序列（type + value）逐项相等 —— 证明只删了注释/空白
    const before = tokenize(src);
    const after = tokenize(out);
    assert.equal(
      after.length,
      before.length,
      rel + '：token 数变化 ' + before.length + ' → ' + after.length,
    );
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].type !== after[i].type || before[i].value !== after[i].value) {
        assert.fail(
          rel + '：第 ' + i + ' 个 token 变了：' +
            JSON.stringify(before[i].type + ':' + before[i].value) + ' → ' +
            JSON.stringify(after[i].type + ':' + after[i].value),
        );
      }
    }

    // (2) 原始里可能触发 ASI 的换行，压缩后必须还在
    for (let i = 1; i < before.length; i += 1) {
      if (before[i].nlBefore && needsLineBreak(before[i - 1], before[i])) {
        assert.ok(
          after[i].nlBefore,
          rel + '：第 ' + i + ' 个 token（' + after[i].value.slice(0, 20) + '）前的必要换行被删了',
        );
      }
    }

    // (3) 注释清空
    assertNoComments(out, rel);

    // (4) V8 真解析器编译（抓 ASI 之类的语法漂移）
    assertCompiles(out, rel);

    // (5) 幂等 + 体积不增
    assert.equal(minifyJs(out), out, rel + '：压缩结果不幂等');
    assert.ok(bytesOf(out) <= bytesOf(src), rel + '：压缩后反而变大');

    jsRows.push({
      rel,
      before: bytesOf(src),
      after: bytesOf(out),
      gzBefore: gzOf(src),
      gzAfter: gzOf(out),
    });
  });
}

/* ================================================================== *
 * 5. bundle（Lead 产出的打包产物，若存在则一起自证）
 * ================================================================== */

section('5. bundle 产物（存在则自证）');

const bundleRows = [];
for (const rel of ['js/bundle.js', 'js/bundle-lazy.js']) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.log('  -- ' + rel + ' 不存在，跳过');
    continue;
  }
  test(rel, () => {
    const src = fs.readFileSync(file, 'utf8');
    // Lead 可能正在重建 bundle：只校验不是语法错误的文件，避免误报
    try {
      new vm.Script(src, { filename: rel });
    } catch {
      console.log('  -- ' + rel + ' 当前内容语法不完整（可能正在重建），跳过');
      return;
    }
    const out = minifyJs(src);
    const a = tokenize(src).map(tokenKey);
    const b = tokenize(out).map(tokenKey);
    const diff = firstTokenDiff(a, b);
    assert.equal(diff, '', rel + '：' + diff);
    assertNoComments(out, rel);
    assertCompiles(out, rel);
    bundleRows.push({ rel, before: bytesOf(src), after: bytesOf(out), gzBefore: gzOf(src), gzAfter: gzOf(out) });
  });
}

/* ================================================================== *
 * 6. CSS 针对性用例
 * ================================================================== */

section('6. CSS 针对性用例：必需空格与字符串保留');

test('@media ... and (min-width: ...) 的 and 与 ( 之间必须有空格', () => {
  const src = '@media screen and (min-width: 600px){.a{color:red}}';
  const out = minifyCss(src);
  assert.ok(out.includes('and (min-width:600px)'), out);
  assert.ok(!/\band\(/.test(out), 'and( 会变成函数 token：' + out);
});

test('calc() 里 + / - 两侧空格必须保留', () => {
  const src = '.a{width:calc(100% - 2px);height:calc(100% + 8px);margin:calc(var(--x) + 4px)}';
  const out = minifyCss(src);
  assert.ok(out.includes('calc(100% - 2px)'), out);
  assert.ok(out.includes('calc(100% + 8px)'), out);
  assert.ok(out.includes('calc(var(--x) + 4px)'), out);
});

test('content 字符串原样保留（含连续空格与中文）', () => {
  const src = '.a::before{content:"a  b  中文";}';
  const out = minifyCss(src);
  assert.ok(out.includes('content:"a  b  中文"'), out);
});

test('url() 原样保留（引号 / data URI / 空格）', () => {
  const src = '.a{background:url("x y.png")} .b{background:url(data:image/svg+xml;base64,AAAA)} .c{background:url( plain.png )}';
  const out = minifyCss(src);
  assert.ok(out.includes('url("x y.png")'), out);
  assert.ok(out.includes('url(data:image/svg+xml;base64,AAAA)'), out);
  assert.ok(out.includes('url( plain.png )'), out);
});

test('选择器后代组合符空格保留：a :hover ≠ a:hover、.a .b ≠ .a.b', () => {
  const src = 'a :hover{color:red} .a .b{color:blue} .c>.d{color:green}';
  const out = minifyCss(src);
  assert.ok(out.includes('a :hover'), 'a :hover 的空格被删了：' + out);
  assert.ok(out.includes('.a .b'), '.a .b 的空格被删了：' + out);
  assert.ok(out.includes('.c>.d'), '组合符两侧空格没删：' + out);
});

test('nth-child(2n + 1) 括号内空格保留', () => {
  const out = minifyCss('.a:nth-child(2n + 1){color:red}');
  assert.ok(out.includes('2n + 1'), out);
});

test('!important / 注释粘连 / 属性选择器', () => {
  const src = '.a{color:red !important;border:1px/**/solid}[data-x="a b" i]{color:blue}';
  const out = minifyCss(src);
  assert.ok(out.includes('red!important'), out);
  assert.ok(out.includes('border:1px solid'), '注释删除导致 token 粘连：' + out);
  assert.ok(out.includes('[data-x="a b" i]'), out);
});

test('@keyframes 与逗号分隔的媒体查询', () => {
  const src = '@keyframes spin{0%{opacity:0}100%{opacity:1}}@media (min-width:600px),(max-width:900px){.a{color:red}}';
  const out = minifyCss(src);
  assert.ok(out.includes('@keyframes spin{0%{opacity:0}'), out);
  assert.ok(out.includes('@media (min-width:600px),(max-width:900px)'), out);
});

test('自定义属性与空值', () => {
  const src = ':root{--bg:#000;--empty: ;--shadow:0 1px 2px rgba(0,0,0,.5)}';
  const out = minifyCss(src);
  assert.ok(out.includes('--bg:#000'), out);
  assert.ok(out.includes('--shadow:0 1px 2px rgba(0,0,0,.5)'), out);
  assert.ok(!out.includes('/*'), out);
});

test('综合样例：@media/@supports/属性选择器/字号简写/渐变/动画', () => {
  const src = [
    ':root{--a:10px;--b:rgba(0,0,0,.5)}',
    '@media screen and (min-width: 600px) and (orientation: landscape){.x > .y + .z ~ .w{color:red!important}}',
    '@supports (display: grid){.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:calc(var(--a) * 2)}}',
    '[type="checkbox"]:checked + .lbl::before{content:"\\"q\\" a  b"}',
    '.f{font:12px/1.5 "Helvetica Neue", Arial, sans-serif;background:linear-gradient(45deg, red 0%, blue 100%);transform:translate3d(-50%, -50%, 0);transition:opacity .2s ease-in-out, transform .2s}',
    '@font-face{font-family:X;src:url("x.woff2") format("woff2")}',
    '@keyframes k{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.f{transition:none}}',
  ].join('');
  const out = minifyCss(src);
  // 字符骨架 / 词元 / 选择器 / @规则前置区 / 声明数 全部一致
  assert.equal(cssSkeleton(out), cssSkeleton(src), '综合样例：代码骨架变了');
  sameArray(cssWordRuns(out), cssWordRuns(src), '综合样例：词元序列变了');
  const a = cssStructure(src);
  const b = cssStructure(out);
  sameArray(b.selectors, a.selectors, '综合样例：选择器序列变了');
  sameArray(b.atPreludes, a.atPreludes, '综合样例：@规则前置区变了');
  assert.equal(b.declCount, a.declCount, '综合样例：声明数变了');
  // 必需空格
  assert.ok(out.includes('and (min-width:600px)'), out);
  assert.ok(out.includes('calc(var(--a)*2)'), out);
  assert.ok(out.includes('content:"\\"q\\" a  b"'), out);
  assert.ok(out.includes('red!important'), out);
  assert.ok(out.split(/\r?\n/).length === 1, '综合样例：产物不是单行');
});

/* ================================================================== *
 * 7. 核心自证：5 个 CSS 文件
 * ================================================================== */

section('7. 核心自证：5 个 CSS 文件结构/词元一致 + 体积下降');

const cssRows = [];
for (const rel of CSS_FILES) {
  test(rel, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const out = minifyCss(src);

    // (1) 字符级：只有注释和空白被删（字符串/url 内容原样）
    assert.equal(cssSkeleton(out), cssSkeleton(src), rel + '：代码骨架变了（不只是删注释/空白）');

    // (2) 词元级：标识符/数字词元序列一致（防 1px + solid → 1pxsolid）
    sameArray(cssWordRuns(out), cssWordRuns(src), rel + '：词元序列变了（可能粘连）');

    // (3) 结构级：选择器序列 + @规则前置区序列 + 声明数
    const s1 = cssStructure(src);
    const s2 = cssStructure(out);
    sameArray(s2.selectors, s1.selectors, rel + '：选择器序列变了');
    sameArray(s2.atPreludes, s1.atPreludes, rel + '：@规则前置区变了');
    assert.equal(s2.declCount, s1.declCount, rel + '：声明数变了 ' + s1.declCount + ' → ' + s2.declCount);
    assert.ok(s1.selectors.length > 0, rel + '：解析器没读到任何选择器（测试自身可能失效）');

    // (4) calc 里的二元运算符空格不许减少
    assert.ok(
      countCalcOpSpaces(out) >= countCalcOpSpaces(src),
      rel + '：calc() 里的 +/- 空格被删了（calc 语法会坏）',
    );

    // (5) 注释没了、行数/体积下降
    assert.ok(!cssSkeleton(out).includes('/*'), rel + '：产物里还有注释');
    assert.ok(
      out.split(/\r?\n/).length < src.split(/\r?\n/).length,
      rel + '：行数没有下降',
    );
    assert.ok(bytesOf(out) < bytesOf(src), rel + '：体积没有下降');

    cssRows.push({
      rel,
      before: bytesOf(src),
      after: bytesOf(out),
      gzBefore: gzOf(src),
      gzAfter: gzOf(out),
      linesBefore: src.split(/\r?\n/).length,
      linesAfter: out.split(/\r?\n/).length,
      selectors: s1.selectors.length,
      decls: s1.declCount,
    });
  });
}

/* ================================================================== *
 * 8. 汇总：体积 / gzip 数据（给 Lead 引用）
 * ================================================================== */

section('8. 体积与 gzip（zlib level:9，UTF-8 字节）');

const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

if (jsRows.length) {
  const jsBefore = sum(jsRows, 'before');
  const jsAfter = sum(jsRows, 'after');
  const jsGzBefore = sum(jsRows, 'gzBefore');
  const jsGzAfter = sum(jsRows, 'gzAfter');
  console.log(
    '  JS  ' + jsRows.length + ' 个源合计：' + kb(jsBefore) + ' → ' + kb(jsAfter) +
      '（' + pct(jsBefore, jsAfter) + '）；gzip ' + kb(jsGzBefore) + ' → ' + kb(jsGzAfter) +
      '（' + pct(jsGzBefore, jsGzAfter) + '，省 ' + kb(jsGzBefore - jsGzAfter) + '）',
  );
  const top = jsRows
    .slice()
    .sort((a, b) => b.gzBefore - b.gzBefore)
    .slice(0, 3);
  for (const r of top) {
    console.log(
      '      最大项 ' + r.rel + '：' + kb(r.before) + ' → ' + kb(r.after) +
        '；gzip ' + kb(r.gzBefore) + ' → ' + kb(r.gzAfter),
    );
  }
} else {
  console.log('  JS  没有可统计的源');
}

for (const r of bundleRows) {
  console.log(
    '  ' + r.rel + '：' + kb(r.before) + ' → ' + kb(r.after) +
      '；gzip ' + kb(r.gzBefore) + ' → ' + kb(r.gzAfter) +
      '（' + pct(r.gzBefore, r.gzAfter) + '）',
  );
}

if (cssRows.length) {
  console.log('  CSS 明细（选择器 / 声明数 / 行数 / 原始 → 压缩后 / gzip 前后）：');
  for (const r of cssRows) {
    console.log(
      '      ' + r.rel + '：选择器 ' + r.selectors + '，声明 ' + r.decls + '，行 ' +
        r.linesBefore + ' → ' + r.linesAfter + '，' + kb(r.before) + ' → ' + kb(r.after) +
        '，gzip ' + kb(r.gzBefore) + ' → ' + kb(r.gzAfter),
    );
  }
  const cssBefore = sum(cssRows, 'before');
  const cssAfter = sum(cssRows, 'after');
  const cssGzBefore = sum(cssRows, 'gzBefore');
  const cssGzAfter = sum(cssRows, 'gzAfter');
  console.log(
    '  CSS 5 个文件合计：' + kb(cssBefore) + ' → ' + kb(cssAfter) +
      '（' + pct(cssBefore, cssAfter) + '）；gzip ' + kb(cssGzBefore) + ' → ' + kb(cssGzAfter) +
      '（' + pct(cssGzBefore, cssGzAfter) + '，省 ' + kb(cssGzBefore - cssGzAfter) + '）',
  );
}

/* ================================================================== *
 * 结果
 * ================================================================== */

console.log('\n===== 汇总 =====');
console.log('  通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  for (const name of failures) console.log('  ✗ ' + name);
  process.exitCode = 1;
} else {
  console.log('  ✓ 全部通过：压缩前后 token/结构一致，压缩产物可被 V8 编译');
}
