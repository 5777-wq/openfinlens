#!/usr/bin/env node
/* minify-css.mjs —— 零依赖 CSS 压缩器（删注释 + 折叠空白）
 *
 * 只删注释和冗余空白，不动规则顺序、不删分号、不改 token 序列。
 *
 * 安全边界（哪些空格必须留）：
 *   · 字符串 '...' / "..." 原样保留（content: "a  b" 里的空格一个不动）
 *   · url(...) 整段原样保留（含 data: URI 里的分号/括号/引号）
 *   · `@media screen and (min-width: ...)`：`and` 与 `(` 之间的空格必须留
 *     （否则 `and(` 会被词法器当成函数 token）
 *   · `calc(100% - 2px)`：函数括号内的 `+`/`-` 两侧空格必须留（calc 语法硬要求）
 *   · 选择器里的后代组合符空格必须留：`a :hover` ≠ `a:hover`、`.a .b` ≠ `.a.b`
 *   · 数字/标识符相邻必须留空格：`1px solid` 不能变 `1pxsolid`（会变成别的 dimension）
 *   · 注释直接删掉是安全的（CSS 注释不产生 whitespace token），但若删除会让
 *     前后两个 token 粘成一个（如 1px + 空注释 + solid），补一个空格。
 *
 * 可以删的（本工具会删）：
 *   · `{ } ; , :` 两侧、`(` `)` 内侧、`!important` 的 `!` 两侧
 *   · 选择器组合符 `> + ~` 两侧（仅在括号外、规则前置区；不碰 calc/nth-child 括号内）
 *   · `@media` 特性括号内的 `:` 后空格（min-width:600px 合法）
 *
 * 用法：
 *   node _scripts/minify-css.mjs <in.css> [out.css]   # 无 out 时打印到 stdout；in 为 - 读 stdin
 *   import { minifyCss } from './minify-css.mjs'
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* ================================================================== *
 * 字符分类（CSS 侧）
 * ================================================================== */

function isCssWhitespace(ch) {
  return (
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\ufeff'
  );
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

// CSS 标识符字符（含非 ASCII、以及 - _ %；% 是为了保护 50 % 不被粘成 50%）
function isWordish(ch) {
  if (!ch) return false;
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return true;
  if (isDigit(ch)) return true;
  if (ch === '_' || ch === '-' || ch === '%') return true;
  if (ch <= '\u007f') return false;
  return !isCssWhitespace(ch);
}

// 直接拼接会不会变成另一个 token（只在删掉空格/注释后才需要检查）
function mergeHazard(a, b) {
  if (!a || !b) return false;
  if (isWordish(a) && isWordish(b)) return true;
  if (isWordish(a) && b === '(') return true; // and ( / url ( —— 会变函数 token
  if ((a === '+' || a === '-') && isDigit(b)) return true; // 符号会粘进数字
  if (isDigit(a) && b === '%') return true; // 50 % → 50%
  if (a === '.' && isDigit(b)) return true; // . 5 → .5
  if (isDigit(a) && b === '.') return true; // 1 .5 → 1.5
  return false;
}

const COMBINATORS = new Set(['>', '+', '~']);

// 规则/选择器上下文里，删掉「前一个字符之后」的空格是安全的
const DROP_AFTER_RULES = new Set(['{', '}', ';', ',', '(', '[', ':', '=', '!']);
// 规则/选择器上下文里，删掉「后一个字符之前」的空格是安全的
const DROP_BEFORE_RULES = new Set(['{', '}', ';', ',', ')', ']', '(', '=', '!']);

// 这些 @ 规则的块里装的是「规则」而不是声明
const RULE_LIST_AT = new Set([
  'media',
  'supports',
  'layer',
  'container',
  'scope',
  'document',
  '-moz-document',
  'starting-style',
]);

/* ================================================================== *
 * 压缩器
 * ================================================================== */

/**
 * @param {string} src CSS 源码
 * @returns {string} 压缩结果（不含结尾换行；CLI 负责补）
 */
export function minifyCss(src) {
  const s = String(src);
  const len = s.length;
  let pos = 0;

  const out = [];
  let lastChar = '';        // 最后一个「已输出」的有效字符
  let pendingSpace = false; // 中间有空白待决策
  let commentGap = false;   // 中间删了注释（零宽），可能要给粘连补空格
  let parenDepth = 0;       // 当前块内的圆括号深度（calc/媒体特性）
  let modeStack = ['rules']; // 'rules'（选择器/@规则前置区）| 'decls'（声明块）
  let preludeRaw = '';      // 当前块前置区（简单拼接，用于识别 @规则名）

  function topMode() {
    return modeStack[modeStack.length - 1];
  }

  function flushSeparator(nextChar) {
    if (!nextChar) {
      pendingSpace = false;
      commentGap = false;
      return;
    }
    let need = false;
    if (pendingSpace) {
      pendingSpace = false;
      commentGap = false;
      need = needsSpace(lastChar, nextChar);
    } else if (commentGap) {
      commentGap = false;
      need = mergeHazard(lastChar, nextChar);
    }
    if (need) out.push(' ');
  }

  function needsSpace(a, b) {
    if (!a) return false;
    if (mergeHazard(a, b)) return true;
    if (topMode() === 'decls') {
      // 声明值里：calc 一类函数括号内的 +/- 两侧必须留空格
      if (parenDepth > 0 && (a === '+' || a === '-' || b === '+' || b === '-')) return true;
      // 其余全部可删（word-word / word-( 已由 mergeHazard 兜住）
      return false;
    }
    // 选择器/@规则前置区：默认保留（后代组合符的空格有语义），只删明确安全的
    if (DROP_AFTER_RULES.has(a) || DROP_BEFORE_RULES.has(b)) return false;
    if (parenDepth === 0 && (COMBINATORS.has(a) || COMBINATORS.has(b))) return false;
    return true;
  }

  function emitChar(ch) {
    flushSeparator(ch);
    out.push(ch);
    lastChar = ch;
    if (modeStack.length && preludeRaw.length < 200) preludeRaw += ch;
  }

  // 原样吐出多字符片段（字符串 / url(...)）
  function emitRaw(chunk) {
    flushSeparator(chunk[0]);
    out.push(chunk);
    lastChar = chunk[chunk.length - 1];
    if (preludeRaw.length < 200) preludeRaw += chunk;
  }

  function isAtRulePrelude() {
    return preludeRaw[0] === '@';
  }

  function blockModeFor(prelude) {
    const m = /^@([-\w]+)/.exec(prelude);
    if (!m) return 'decls'; // 普通样式规则 → 声明块
    const name = m[1].toLowerCase();
    if (RULE_LIST_AT.has(name) || name.endsWith('keyframes')) return 'rules';
    return 'decls'; // @font-face / @page / @property / @counter-style ...
  }

  while (pos < len) {
    const ch = s[pos];

    // 空白
    if (isCssWhitespace(ch)) {
      pendingSpace = true;
      pos += 1;
      continue;
    }

    // 注释（块注释；CSS 没有行注释）
    if (ch === '/' && s[pos + 1] === '*') {
      pos += 2;
      while (pos < len && !(s[pos] === '*' && s[pos + 1] === '/')) pos += 1;
      pos += 2;
      commentGap = true;
      pendingSpace = false;
      continue;
    }

    // 字符串：原样保留
    if (ch === '"' || ch === "'") {
      const start = pos;
      const quote = ch;
      pos += 1;
      while (pos < len) {
        const c = s[pos];
        if (c === '\\') {
          if (s[pos + 1] === '\r' && s[pos + 2] === '\n') pos += 3;
          else pos += 2;
          continue;
        }
        if (c === quote) {
          pos += 1;
          break;
        }
        if (c === '\n' || c === '\r' || c === '\f') break; // 未闭合：保守停在行尾
        pos += 1;
      }
      emitRaw(s.slice(start, pos));
      continue;
    }

    // url(...)：原样保留整段（含引号、data: URI、分号、括号）
    if (
      (ch === 'u' || ch === 'U') &&
      /^url\(/i.test(s.slice(pos, pos + 4)) &&
      !isWordish(lastChar) &&
      lastChar !== '\\'
    ) {
      const start = pos;
      pos += 4;
      let depth = 1;
      while (pos < len && depth > 0) {
        const c = s[pos];
        if (c === '\\') {
          pos += 2;
          continue;
        }
        if (c === '"' || c === "'") {
          const quote = c;
          pos += 1;
          while (pos < len) {
            const cc = s[pos];
            if (cc === '\\') {
              pos += 2;
              continue;
            }
            if (cc === quote) {
              pos += 1;
              break;
            }
            pos += 1;
          }
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
        pos += 1;
      }
      emitRaw(s.slice(start, pos));
      continue;
    }

    // 结构标点
    if (ch === '{') {
      const prelude = preludeRaw;
      emitChar('{');
      modeStack.push(blockModeFor(prelude));
      preludeRaw = '';
      parenDepth = 0;
      pos += 1;
      continue;
    }
    if (ch === '}') {
      emitChar('}');
      if (modeStack.length > 1) modeStack.pop();
      preludeRaw = '';
      parenDepth = 0;
      pos += 1;
      continue;
    }
    if (ch === ';') {
      emitChar(';');
      preludeRaw = '';
      parenDepth = 0;
      pos += 1;
      continue;
    }
    if (ch === '(') {
      emitChar('(');
      parenDepth += 1;
      pos += 1;
      continue;
    }
    if (ch === ')') {
      emitChar(')');
      if (parenDepth > 0) parenDepth -= 1;
      pos += 1;
      continue;
    }

    // 标识符/单词类：成段输出，减少 emit 次数
    if (isWordish(ch) || ch === '\\') {
      const start = pos;
      while (pos < len) {
        const c = s[pos];
        if (c === '\\') {
          pos += 2;
          continue;
        }
        if (!isWordish(c)) break;
        pos += 1;
      }
      emitRaw(s.slice(start, pos));
      continue;
    }

    // 其它单字符（. # @ : , > + ~ = ! * [ ] 等）
    emitChar(ch);
    pos += 1;
  }

  // 结尾的 pendingSpace/commentGap 直接丢弃（文件末尾空白无意义）
  return out.join('');
}

/* ================================================================== *
 * CLI
 * ================================================================== */

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    console.error('用法: node _scripts/minify-css.mjs <in.css> [out.css]');
    console.error('  无 out 时打印到 stdout；in 为 - 时从 stdin 读。');
    process.exit(args.length ? 0 : 1);
  }
  const inFile = args[0];
  const outFile = args[1];
  let src;
  try {
    src = inFile === '-' ? readFileSync(0, 'utf8') : readFileSync(inFile, 'utf8');
  } catch (err) {
    console.error('minify-css: 读取失败：' + err.message);
    process.exit(1);
  }
  const out = minifyCss(src);
  if (!outFile) {
    process.stdout.write(out + '\n');
    return;
  }
  writeFileSync(outFile, out + '\n', 'utf8');
  const before = Buffer.byteLength(src);
  const after = Buffer.byteLength(out);
  const pct = before ? ((after / before) * 100).toFixed(1) : '0.0';
  console.log(
    `minify-css: ${path.basename(inFile)} ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB（${pct}%）→ ${outFile}`,
  );
}

if (isMainModule()) main();
