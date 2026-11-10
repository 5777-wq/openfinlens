#!/usr/bin/env node
/* minify-js.mjs —— 词法感知的「保守」JS 压缩器（零依赖）
 *
 * 只做两件事：删注释、删冗余空白。
 * 保证：不重命名标识符、不删分号/括号/逗号、不改 token 序列、不改语句边界。
 *
 * 为什么只做这两件事（做打包瘦身的背景）：
 *   gzip 对空白极其有效，去缩进几乎换不来传输体积；本仓库的注释是大量中文，
 *   gzip 压不动，所以真正的收益在「删注释」。因此本工具宁可在换行上保守
 *   （多留一个 \n），也绝不为了几个字节冒 ASI 语义漂移的风险。
 *
 * 用法：
 *   node _scripts/minify-js.mjs <in.js> [out.js]    # 无 out 时打印到 stdout；in 为 - 读 stdin
 *   import { minifyJs, tokenize } from './minify-js.mjs'
 *
 * 词法覆盖（全部为手写扫描，逐条处理）：
 *   · '...' / "..." 普通字符串（含 \ 续行、未闭合时保守停在行尾）
 *   · 模板字符串 `...`（含 ${} 嵌套；嵌套里还能再套模板字符串/字符串/正则/注释）。
 *     模板字面量本身原样保留（内部不压缩），这是最保守的选择：`${ }` 里
 *     空白/换行/注释一个字节都不动，绝不可能改变模板语义。
 *   · 正则字面量（含字符类 [...] 内的 /），与除号 `/`、`/=` 用「前一 token 能否
 *     出现在正则前」判定；判定失败（正则没在该行闭合）时回退成除号，不吞代码。
 *   · // 行注释、/* *\/ 块注释（块注释内有换行时，对 ASI 等价于换行）
 *   · 行首 <!-- 与 -->（HTML 风格注释，Annex B；--> 只在行首纯空白后成立）
 *   · 文件开头的 #! hashbang（按注释删掉；业务脚本不需要）
 *
 * ASI（自动分号）安全规则：
 *   只有当「前一个 token 能结束语句」且「后一个 token 能开始语句」时，才保留
 *   换行；其余换行一律折叠掉。宁可多留换行：例如
 *     a\n(b)      → 换行保留（否则变成函数调用）
 *     return\nx   → 换行保留（否则 return 变成 return x）
 *     [1]\n[0]    → 换行保留
 *     x\n++y      → 换行保留
 *     反引号/正则/字符串开头的下一行同理
 *   另外用「粘连保护」避免把两个 token 拼成一个：
 *     ident+ident（a in b / typeof x / else if / 1 in x）
 *     + +、- -（不能变 ++/--）、/ /（不能变注释）、/ *、< !（不能变 <!--）、
 *     -- >（不能变 -->）、1 .toString()（数字后紧跟点要留空格）
 *
 * 公开 API：
 *   minifyJs(src) -> string
 *   tokenize(src, { keepComments }) -> Token[]
 *   needsLineBreak(prevToken, nextToken) -> boolean   // 测试自证 ASI 保留用
 *
 * 注意：所有注释（包括 /*! 开头的）一律删除，保持一致；需要 banner 的调用方
 * 请在压缩完成后自行拼到结果前面。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ================================================================== *
 * 字符与 token 基础
 * ================================================================== */

function isLineTerminator(ch) {
  return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
}

function isWhitespace(ch) {
  if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f') return true;
  if (ch === '\u00a0' || ch === '\ufeff') return true;
  // 其余 Unicode 空白（Zs 等）数量少，交给正则；ASCII 热路径已在上方短路。
  return ch > '\u007f' && !isLineTerminator(ch) && /\s/u.test(ch);
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch) {
  if (!ch) return false;
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return true;
  if (ch === '_' || ch === '$') return true;
  if (ch <= '\u007f') return false;
  // 非 ASCII：Unicode 空白与 U+2028/U+2029 都不是标识符字符
  return !/\s/u.test(ch);
}

function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch) || ch === '\u200c' || ch === '\u200d';
}

// 数字字面量（十进制/十六/八/二/大整数/下划线分隔符/指数）
const NUMBER_RE = /(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*n?|0[bB][01](?:_?[01])*n?|0[oO][0-7](?:_?[0-7])*n?|(?:[0-9](?:_?[0-9])*)?\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[0-9](?:_?[0-9])*\.?(?:(?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?n?)/y;

// 标点：长的在前，保证最长匹配
const PUNCTUATORS = [
  '>>>=', '...',
  '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/',
  '%', '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#',
];

// 这些关键字后面的 `/` 是正则（而不是除号）
const KEYWORDS_BEFORE_EXPR = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await', 'extends', 'default', 'export', 'import',
  'if', 'while', 'for', 'with', 'switch', 'catch', 'class', 'const', 'let', 'var',
  'function', 'debugger', 'break', 'continue', 'try', 'finally', 'static', 'get',
  'set', 'async', 'as', 'from',
]);

// `if (x) /re/` 里的 `)` 后面可以跟正则；普通调用 `f(x) / 2` 后面是除号
const CONTROL_PAREN_KEYWORDS = new Set(['if', 'while', 'for', 'with']);

function makeToken(type, value, start, end) {
  return { type, value, start, end, nlBefore: false };
}

/* ================================================================== *
 * 词法器
 * ================================================================== */

/**
 * @param {string} src
 * @param {boolean} keepComments 为 true 时，注释也作为 token 返回（测试统计用）
 */
function createTokenizer(src, keepComments) {
  const len = src.length;
  let pos = 0;
  let prev = null;          // 上一个「代码」token（注释不算）
  let parenStack = [];      // 每个 '(' 的 token，用来判断 `)` 是否控制语句括号
  let lineStart = true;     // 本行到目前为止只有空白（`-->` 注释判定用）
  const queue = [];         // 待返回 token（注释与代码 token 混排）

  function takeToken(type, start) {
    return makeToken(type, src.slice(start, pos), start, pos);
  }

  /* ---------- 空白 / 注释 ---------- */

  // 返回「上一个 token 与本位置之间是否有换行」。
  // 块注释/行注释里的换行对 ASI 同样算换行。
  function skipTrivia(recordComments) {
    let nl = false;
    for (;;) {
      if (pos >= len) break;
      const ch = src[pos];

      if (isLineTerminator(ch)) {
        nl = true;
        lineStart = true;
        pos += 1;
        if (ch === '\r' && src[pos] === '\n') pos += 1;
        continue;
      }
      if (isWhitespace(ch)) {
        pos += 1;
        continue;
      }
      // #! hashbang（只可能在文件第 0 个字符）
      if (pos === 0 && ch === '#' && src[pos + 1] === '!') {
        const start = pos;
        pos += 2;
        while (pos < len && !isLineTerminator(src[pos])) pos += 1;
        if (recordComments) {
          queue.push(Object.assign(takeToken('comment', start), { nlBefore: nl }));
          nl = false;
        }
        continue;
      }
      // // 行注释
      if (ch === '/' && src[pos + 1] === '/') {
        const start = pos;
        pos += 2;
        while (pos < len && !isLineTerminator(src[pos])) pos += 1;
        if (recordComments) {
          queue.push(Object.assign(takeToken('comment', start), { nlBefore: nl }));
          nl = false;
        }
        continue;
      }
      // /* 块注释 */
      if (ch === '/' && src[pos + 1] === '*') {
        const start = pos;
        let hadNewline = false;
        pos += 2;
        while (pos < len) {
          const c = src[pos];
          if (c === '*' && src[pos + 1] === '/') {
            pos += 2;
            break;
          }
          if (isLineTerminator(c)) {
            hadNewline = true;
            lineStart = true;
            pos += 1;
            if (c === '\r' && src[pos] === '\n') pos += 1;
            continue;
          }
          pos += 1;
        }
        if (recordComments) {
          queue.push(Object.assign(takeToken('comment', start), { nlBefore: nl }));
          nl = hadNewline;
        } else if (hadNewline) {
          nl = true;
        }
        continue;
      }
      // 行首 `<!--`（HTML 风格开注释，Annex B：任何 token 边界都算注释）
      if (ch === '<' && src[pos + 1] === '!' && src[pos + 2] === '-' && src[pos + 3] === '-') {
        const start = pos;
        pos += 4;
        while (pos < len && !isLineTerminator(src[pos])) pos += 1;
        if (recordComments) {
          queue.push(Object.assign(takeToken('comment', start), { nlBefore: nl }));
          nl = false;
        }
        continue;
      }
      // 行首 `-->`（HTML 风格闭注释；规范要求行首/空白之后）
      if (
        lineStart &&
        ch === '-' &&
        src[pos + 1] === '-' &&
        src[pos + 2] === '>'
      ) {
        const start = pos;
        pos += 3;
        while (pos < len && !isLineTerminator(src[pos])) pos += 1;
        if (recordComments) {
          queue.push(Object.assign(takeToken('comment', start), { nlBefore: nl }));
          nl = false;
        }
        continue;
      }
      break;
    }
    return nl;
  }

  /* ---------- 单个 token ---------- */

  function readIdent() {
    const start = pos;
    if (src[pos] === '\\') {
      // 首字符是 \u 转义：按标识符读，转义原样保留
      pos += 1;
      if (src[pos] === 'u') {
        pos += 1;
        if (src[pos] === '{') {
          while (pos < len && src[pos] !== '}') pos += 1;
          pos += 1;
        } else {
          pos += 4;
        }
      }
    } else {
      pos += 1;
    }
    while (pos < len) {
      const ch = src[pos];
      if (ch === '\\' && src[pos + 1] === 'u') {
        pos += 2;
        if (src[pos] === '{') {
          while (pos < len && src[pos] !== '}') pos += 1;
          pos += 1;
        } else {
          pos += 4;
        }
        continue;
      }
      if (isIdentPart(ch)) {
        pos += 1;
        continue;
      }
      break;
    }
    return takeToken('ident', start);
  }

  function readNumber() {
    const start = pos;
    NUMBER_RE.lastIndex = pos;
    const m = NUMBER_RE.exec(src);
    if (m && m.index === pos && m[0].length > 0) {
      pos += m[0].length;
    } else {
      pos += 1; // 兜底：绝不丢字符
    }
    return takeToken('number', start);
  }

  function readString() {
    const start = pos;
    const quote = src[pos];
    pos += 1;
    while (pos < len) {
      const ch = src[pos];
      if (ch === '\\') {
        pos += 1;
        if (pos < len) {
          if (src[pos] === '\r' && src[pos + 1] === '\n') pos += 2;
          else pos += 1;
        }
        continue;
      }
      if (ch === quote) {
        pos += 1;
        break;
      }
      // ES2019 起 U+2028/U+2029 可以原样出现在字符串里；只有 \n / \r 会终止字符串
      if (ch === '\n' || ch === '\r') break; // 未闭合：保守地停在行尾（源文件本身非法）
      pos += 1;
    }
    return takeToken('string', start);
  }

  // 读 ${ ... } 里的 token，找出与之配对的 }
  function readTemplateExpr() {
    const savedPrev = prev;
    const savedParen = parenStack;
    prev = null;
    parenStack = [];
    let depth = 1;
    while (pos < len) {
      skipTrivia(false);
      if (pos >= len) break;
      const t = readCodeToken();
      if (!t) break;
      if (t.type === 'punct') {
        if (t.value === '{') depth += 1;
        else if (t.value === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
    }
    prev = savedPrev;
    parenStack = savedParen;
  }

  function readTemplate() {
    const start = pos;
    const savedPrev = prev;
    const savedParen = parenStack;
    const savedLineStart = lineStart;
    pos += 1; // `
    while (pos < len) {
      const ch = src[pos];
      if (ch === '\\') {
        pos += 1;
        if (pos < len) {
          if (src[pos] === '\r' && src[pos + 1] === '\n') pos += 2;
          else pos += 1;
        }
        continue;
      }
      if (ch === '`') {
        pos += 1;
        break;
      }
      if (ch === '$' && src[pos + 1] === '{') {
        pos += 2;
        readTemplateExpr();
        continue;
      }
      pos += 1;
    }
    const tok = takeToken('template', start);
    prev = savedPrev;
    parenStack = savedParen;
    lineStart = savedLineStart;
    return tok;
  }

  // 返回 null 表示「这不像一个在该行闭合的正则」→ 调用方回退成除号
  function readRegex() {
    const start = pos;
    let i = pos + 1;
    let inClass = false;
    let closed = false;
    while (i < len) {
      const ch = src[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (isLineTerminator(ch)) break;
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        i += 1;
        closed = true;
        break;
      }
      i += 1;
    }
    if (!closed) return null;
    while (i < len) {
      const ch = src[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (isIdentPart(ch)) i += 1;
      else break;
    }
    pos = i;
    return takeToken('regex', start);
  }

  function readPunct() {
    const start = pos;
    for (let k = 0; k < PUNCTUATORS.length; k += 1) {
      const p = PUNCTUATORS[k];
      if (!src.startsWith(p, pos)) continue;
      // `?.` 后面紧跟数字时不是可选链（a?.5:b 是合法三元），拆成 ? 与 .5
      if (p === '?.' && isDigit(src[pos + 2])) continue;
      pos += p.length;
      return takeToken('punct', start);
    }
    pos += 1; // 未知字符：原样吐一个，绝不丢字节
    return takeToken('punct', start);
  }

  function regexAllowed(p) {
    if (!p) return true;
    if (p.type === 'ident') {
      if (p.property) return false; // obj.return 之类：属性名后面是除号
      return KEYWORDS_BEFORE_EXPR.has(p.value);
    }
    if (p.type !== 'punct') return false; // number/string/template/regex 之后是除号

    switch (p.value) {
      case ')':
        return p.closesControl === true;
      case ']':
      case '++':
      case '--':
      case '.':
      case '?.':
        return false;
      case '}':
        // 代码块之后可以跟正则（`if (x) {} /re/.test(y)`）；对象字面量之后
        // 理论上该是除号，但真那么写极罕见，这里沿用主流工具的做法。
        return true;
      default:
        return true;
    }
  }

  function readCodeToken() {
    const ch = src[pos];
    const start = pos;
    let tok = null;

    if (ch === '\\' && src[pos + 1] === 'u') {
      tok = readIdent();
    } else if (isIdentStart(ch)) {
      tok = readIdent();
    } else if (isDigit(ch) || (ch === '.' && isDigit(src[pos + 1]))) {
      tok = readNumber();
    } else if (ch === '"' || ch === "'") {
      tok = readString();
    } else if (ch === '`') {
      tok = readTemplate();
    } else if (
      ch === '/' &&
      src[pos + 1] !== '/' &&
      src[pos + 1] !== '*' &&
      src[pos + 1] !== '=' &&
      regexAllowed(prev)
    ) {
      const r = readRegex();
      if (r) {
        tok = r;
      } else {
        pos = start + 1; // 回退成除号
        tok = takeToken('punct', start);
      }
    }

    if (!tok) tok = readPunct();

    // 属性名位置（obj.foo / obj?.foo）：用于正则/除号判定
    tok.property = !!(prev && prev.type === 'punct' && (prev.value === '.' || prev.value === '?.'));

    if (tok.type === 'punct') {
      if (tok.value === '(') {
        tok.control = !!(
          prev &&
          prev.type === 'ident' &&
          !prev.property &&
          CONTROL_PAREN_KEYWORDS.has(prev.value)
        );
        parenStack.push(tok);
      } else if (tok.value === ')') {
        const open = parenStack.pop();
        tok.closesControl = !!(open && open.control);
      }
    }

    prev = tok;
    lineStart = false;
    return tok;
  }

  function pump() {
    const nl = skipTrivia(keepComments);
    if (pos >= len) return;
    const tok = readCodeToken();
    if (!tok) return;
    tok.nlBefore = nl;
    queue.push(tok);
  }

  function nextToken() {
    if (!queue.length) pump();
    return queue.length ? queue.shift() : null;
  }

  return { nextToken };
}

/**
 * 把源码切成 token 序列（注释默认跳过；keepComments=true 时注释也返回）。
 * token: { type, value, start, end, nlBefore }
 * type ∈ ident | number | string | template | regex | punct | comment
 */
export function tokenize(src, opts = {}) {
  const lexer = createTokenizer(String(src), opts.keepComments === true);
  const out = [];
  for (;;) {
    const t = lexer.nextToken();
    if (!t) break;
    out.push(t);
  }
  return out;
}

/* ================================================================== *
 * 拼接（删空白 + 保 ASI）
 * ================================================================== */

// 能结束语句/表达式的标点；ident/number/string/template/regex 保守地算「能」
const PUNCT_CAN_END = new Set([')', ']', '}', '++', '--']);

// 能开始语句/表达式的标点；其余标点（, ; : = 等）不能
const PUNCT_CAN_START = new Set(['(', '[', '{', '!', '~', '+', '-', '++', '--', '/']);

function canEndToken(t) {
  if (!t) return false;
  if (t.type === 'punct') return PUNCT_CAN_END.has(t.value);
  return true;
}

function canStartToken(t) {
  if (!t) return false;
  if (t.type === 'punct') return PUNCT_CAN_START.has(t.value);
  return true;
}

/**
 * 这一对相邻 token 之间的换行是否可能影响 ASI / 语义。
 * 为 true 时必须保留换行（本工具用这个自证没改语句边界）。
 */
export function needsLineBreak(prevTok, nextTok) {
  return canEndToken(prevTok) && canStartToken(nextTok);
}

function isWordCharAt(ch) {
  return !!ch && (isIdentPart(ch) || ch === '\\');
}

// 两个 token 直接粘在一起会不会变成另一个 token / 改语义
function wouldMerge(prevTok, nextTok) {
  const a = prevTok.value;
  const b = nextTok.value;
  const al = a[a.length - 1];
  const bf = b[0];

  // 标识符/数字/关键字相邻：a in b、typeof x、else if、1 in x
  if (isWordCharAt(al) && isWordCharAt(bf)) return true;

  // 数字后紧跟点：1 .toString()（直接写 1.toString 会解析成 1. + ident）
  if (prevTok.type === 'number' && b === '.' && !a.includes('.')) return true;

  // + + / - - 不能粘成 ++/--；/ / 不能粘成注释；/ * 同理
  if ((al === '+' || al === '-') && bf === al) return true;
  if (al === '/' && (bf === '/' || bf === '*')) return true;

  // 不能拼出 HTML 风格注释 / 闭注释
  if (al === '<' && bf === '!') return true;
  if (a.endsWith('--') && bf === '>') return true;

  // ? . 不能粘成可选链
  if (al === '?' && bf === '.') return true;

  return false;
}

/**
 * 保守压缩入口：只删注释、折叠冗余空白，token 序列保持不变。
 * @param {string} src
 * @returns {string}
 */
export function minifyJs(src) {
  const tokens = tokenize(src);
  let out = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (i === 0) {
      out += t.value;
      continue;
    }
    const p = tokens[i - 1];
    if (t.nlBefore && needsLineBreak(p, t)) out += '\n';
    else if (wouldMerge(p, t)) out += ' ';
    out += t.value;
  }
  return out;
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
    console.error('用法: node _scripts/minify-js.mjs <in.js> [out.js]');
    console.error('  无 out 时打印到 stdout；in 为 - 时从 stdin 读。');
    process.exit(args.length ? 0 : 1);
  }
  const inFile = args[0];
  const outFile = args[1];
  let src;
  try {
    src = inFile === '-' ? readFileSync(0, 'utf8') : readFileSync(inFile, 'utf8');
  } catch (err) {
    console.error('minify-js: 读取失败：' + err.message);
    process.exit(1);
  }
  const out = minifyJs(src);
  if (!outFile) {
    process.stdout.write(out + '\n');
    return;
  }
  writeFileSync(outFile, out + '\n', 'utf8');
  const before = Buffer.byteLength(src);
  const after = Buffer.byteLength(out);
  const pct = before ? ((after / before) * 100).toFixed(1) : '0.0';
  console.log(
    `minify-js: ${path.basename(inFile)} ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB（${pct}%）→ ${outFile}`,
  );
}

if (isMainModule()) main();
