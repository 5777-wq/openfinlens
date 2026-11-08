/* window-env.mjs —— 用 Node 内置 vm 加载项目里的 window 风格前端模块（零依赖）
 *
 * 为什么不用一套新的取数代码：
 *   项目《架构》铁律是「网络调用只存在于 js/sources/」。行情/基金/宏观的 URL、GBK 解码、
 *   字段位、美股后缀重试等口径已经在前端适配器里逐条实测过（见 docs/FIELD-NOTES.md）。
 *   API 链路如果另发明一套，就会和页面出现两套口径。这里的做法与 _test/degrade.test.mjs
 *   完全一致：造一个假 window（含 fetch / TextDecoder / localStorage 桩），把 js/sources/*.js
 *   原样跑进去，再调用它暴露的 getQuotes / getKline。
 *
 * 只加载只读数据源；不加载任何 DOM 视图层。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Node 20.11+ 提供 import.meta.dirname；更老的 Node 用 fileURLToPath 兜底
const HERE = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

/* 与浏览器给定的一套最小全局对象。vm 上下文拿不到宿主的隐式全局，必须显式注入。 */
function makeContext({ fetchImpl, timeoutMs }) {
  const timedFetch = async (url, init = {}) => {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境没有可用的 fetch');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1000, timeoutMs));
    try {
      const signal = init.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, ctl.signal])
        : (init.signal || ctl.signal);
      return await fetchImpl(url, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const documentShim = {
    documentElement: { style: {} },
    body: { style: {}, appendChild() {}, removeChild() {} },
    head: { appendChild() {} },
    createElement: () => ({ style: {}, remove() {}, addEventListener() {}, setAttribute() {} }),
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() {},
  };

  const localStorageShim = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
    clear() {},
    key: () => null,
    length: 0,
  };

  const ctx = vm.createContext({
    console,
    Math, Date, JSON, Number, String, Boolean, Array, Object,
    isNaN, parseInt, parseFloat, Infinity, NaN,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, TextEncoder, Promise, Error, TypeError, RangeError,
    RegExp, Map, Set, WeakMap, WeakSet, Symbol,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    URL, URLSearchParams, AbortController, AbortSignal, performance,
    fetch: timedFetch,
    document: documentShim,
    localStorage: localStorageShim,
    navigator: { userAgent: 'openfinlens-mcp/1.0 (+https://github.com/5777-wq/openfinlens)' },
    location: { href: 'https://5777-wq.github.io/openfinlens/' },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  // 数据源适配器用 SourceState 记录健康状态；Node 侧不需要这份 UI 状态，给空实现即可
  ctx.SourceState = { ok() {}, fail() {} };
  return ctx;
}

/* 在同一个上下文里按顺序加载模块（顺序有依赖：utils → data → sources） */
export function loadWindowModules(files, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const ctx = makeContext({ fetchImpl, timeoutMs });
  for (const rel of files) {
    const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    vm.runInContext(readFileSync(abs, 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

/* 把一个独立的 JS 文本跑进干净上下文，返回上下文本身（基金 pingzhongdata 用） */
export function runScriptText(text, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const ctx = makeContext({ fetchImpl, timeoutMs });
  vm.runInContext(text, ctx, { filename: 'inline-script.js' });
  return ctx;
}
