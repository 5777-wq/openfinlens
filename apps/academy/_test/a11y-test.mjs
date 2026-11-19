#!/usr/bin/env node
/* a11y-test.mjs —— 无障碍与首屏性能测试（无浏览器、无网络）
   用法：node _test/a11y-test.mjs

   这个文件只管四件事：
   1. 分享卡片该有的标签有没有（og / twitter / canonical）；
   2. 两级灰字对纸底的对比度够不够 4.5:1（**实算**，不靠眼睛）；
   3. 焦点环够不够明显，Tab 能不能出得来（焦点陷阱、背景隔离、焦点归还）；
   4. 正文是不是真的按需加载：首屏不拉 23 篇，open 哪篇才拉哪篇。

   跑法：node _test/a11y-test.mjs */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0, skip = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? '  →  ' + extra : '')); }
}
function skipTest(name, why) { skip++; console.log('  – ' + name + '（' + why + '）'); }

/* ============================================================
   WCAG 对比度：相对亮度 + alpha 合成，实算不目测
   ============================================================ */
function chan(c) {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const h = String(hex).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 从 CSS 里取一个自定义属性的值：--ink-3: #546267; */
function cssVar(css, name) {
  const m = new RegExp(name + '\\s*:\\s*([^;]+);').exec(css);
  return m ? m[1].trim() : null;
}

/* ============================================================
   最小 DOM 桩（够跑 app.js 就行）
   ============================================================ */
class El {
  constructor(id, tag) {
    this.id = id; this.tag = tag || 'div';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.dataset = {}; this.style = { cssText: '' }; this.attrs = {};
    this.children = []; this.hidden = false; this.isConnected = true;
    this.focusCount = 0;
    const self = this;
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach((x) => self.classList._set.add(x)); },
      remove(...c) { c.forEach((x) => self.classList._set.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !self.classList._set.has(c); f ? self.classList._set.add(c) : self.classList._set.delete(c); return f; },
      contains(c) { return self.classList._set.has(c); },
    };
  }
  addEventListener(type, fn) { (this.__on = this.__on || {})[type] = (this.__on[type] || []).concat(fn || []); }
  removeEventListener() {} dispatchEvent() {}
  querySelectorAll() { return []; }
  /**
   * 两种选择器：
   * - `[data-page-title]` —— 标题约定就靠它
   * - `#id` —— **容器作用域**，跟真实浏览器一致：只在自己的子树里找，
   *   找不到就是 null，绝不越界去文档里别处捞同名节点。
   *   （回放器改成作用域查询后，桩必须如实还原这条边界。）
   */
  querySelector(sel) {
    if (sel === '[data-page-title]') {
      const m = /data-page-title="([^"]*)"/.exec(this.innerHTML || '');
      if (!m) return null;
      const stub = new El(null, 'div');
      stub.attrs['data-page-title'] = m[1];
      return stub;
    }
    if (typeof sel === 'string') {
      const m = /^#([A-Za-z0-9_-]+)$/.exec(sel.trim());
      if (m) {
        const id = m[1];
        if (String(this.innerHTML || '').indexOf('id="' + id + '"') >= 0) return this._scopedEl(id);
        if (this._scoped) {
          for (const child of this._scoped.values()) {
            const hit = child.querySelector(sel);
            if (hit) return hit;
          }
        }
        return null;
      }
    }
    return null;
  }
  _scopedEl(id) {
    if (!this._scoped) this._scoped = new Map();
    if (!this._scoped.has(id)) {
      const child = new El(id);
      child._root = this._root || this;
      this._scoped.set(id, child);
      REG.set(id, child);
    }
    return this._scoped.get(id);
  }
  closest() { return null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() {}
  getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }; }
  getTotalLength() { return 100; }
  focus() { this.focusCount++; doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = null; }
  click() {}
  setPointerCapture() {} releasePointerCapture() {}
}

const REG = new Map();
function getElementById(id) {
  if (!REG.has(id)) REG.set(id, new El(id));
  return REG.get(id);
}

const doc = {
  getElementById,
  createElement: (t) => new El(null, t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  body: new El('body'),
  head: new El('head'),
  documentElement: new El('html'),
  title: '',
  readyState: 'complete',
  hidden: false,
  addEventListener(type, fn) { (doc.__on[type] = doc.__on[type] || []).push(fn); },
  removeEventListener() {},
  querySelector() { return null; },
  querySelectorAll(sel) {
    // 背景隔离只认这几个顶层容器：index.html 里就是这么写的
    const map = { '.masthead': 'masthead', '.ticker': 'ticker', '.shell': 'shell', '.tabbar': 'tabbar' };
    if (map[sel]) {
      const el = getElementById(map[sel]);
      el.classList.add(sel.slice(1));
      return [el];
    }
    return [];
  },
  activeElement: null,
  contains(el) { return !!el; },
};
doc.__on = {};

/* ---- 本地 fetch，并记账：首屏到底请求了哪些文件 ---- */
const fetched = [];
async function localFetch(url) {
  const u = String(url);
  fetched.push(u);
  if (/^https?:\/\//.test(u)) {
    return { ok: false, status: 0, json: async () => { throw new Error('offline'); } };
  }
  const p = path.join(ROOT, u.split('?')[0].split('#')[0]);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  const text = await readFile(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
}

const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Math, Date, JSON, Map, Set, WeakMap, WeakSet,
  Number, String, Array, Object, Boolean, Error, TypeError, RangeError, SyntaxError, RegExp,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  encodeURI, decodeURI, escape, unescape,
  AbortController, AbortSignal, URL, URLSearchParams,
  TextDecoder, TextEncoder, Intl, Symbol, Proxy, Reflect, BigInt,
  fetch: localFetch, localStorage, document: doc,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  location: {
    hash: '#/',
    search: '',
    get href() { return 'http://127.0.0.1:8765/' + this.hash; },
  },
  history: { pushState() {}, replaceState() {} },
  scrollY: 0, innerWidth: 1280, innerHeight: 900,
  scrollTo() {}, open() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.window.document = doc;

const ctx = vm.createContext(sandbox);

/** 与 index.html 保持一致的脚本顺序 */
const SCRIPTS = [
  'vendor/core/utils.js',
  'vendor/core/universe.js',
  'vendor/core/explain.js',
  'vendor/core/industry-chains.js',
  'vendor/core/academy-gloss.js',
  'js/site/format.js',
  'js/site/jsonld.js',
  'js/site/pwa.js',
  'js/site/net.js',
  'js/site/cross.js',
  'js/site/disclaimer.js',
  'js/store.js',
  'js/router.js',
  'js/engine/series.js',
  'js/engine/percentile.js',
  'js/engine/drawdown.js',
  'js/engine/crisis.js',
  'js/engine/instrument.js',
  'js/engine/spread.js',
  'js/engine/analogy.js',
  'js/engine/compare.js',
  'js/sources/quotes.js',
  'js/sources/history.js',
  'js/site/content.js',
  'js/components/term-card.js',
  'js/components/term-drawer.js',
  'js/components/era-timeline.js',
  'js/components/replay-player.js',
  'js/components/chain-heat.js',
  'js/components/series-chart.js',
  'js/views/home.js',
  'js/views/list.js',
  'js/views/assets.js',
  'js/views/article.js',
  'js/views/crisis.js',
  'js/views/chain.js',
  'js/views/path.js',
  'js/views/term.js',
  'js/views/search.js',
  'js/views/compare.js',
  'js/views/curve.js',
  'js/views/analogy.js',
  'js/views/calc.js',
  'js/views/saved.js',
  'js/views/tag.js',
  'js/views/quiz.js',
  'js/views/series.js',
  'js/app.js',
];

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

async function main() {
  /* ============================================================
     1. 分享卡片：爬虫不执行 JS，head 里得有静态兜底
     ============================================================ */
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  ok('head 里有 og:title', /<meta\s+property="og:title"/.test(head));
  ok('head 里有 og:description', /<meta\s+property="og:description"/.test(head));
  ok('head 里有 og:type', /<meta\s+property="og:type"/.test(head));
  ok('head 里有 og:url', /<meta\s+property="og:url"/.test(head));
  ok('head 里有 twitter:card', /<meta\s+name="twitter:card"/.test(head));
  ok('head 里有 twitter:title', /<meta\s+name="twitter:title"/.test(head));
  ok('head 里有 twitter:description', /<meta\s+name="twitter:description"/.test(head));
  ok('head 里有 canonical', /<link\s+rel="canonical"/.test(head));
  ok('页面里有跳到主内容的入口', /class="skip"[^>]*href="#main"/.test(html));
  ok('页面里有换页播报区', /id="route-live"[^>]*aria-live="polite"/.test(html));
  ok('播报区是视觉隐藏的（有 sr-only 类）', /id="route-live"[^>]*class="[^"]*sr-only/.test(html));

  /* ============================================================
     2. 对比度：两级灰字对纸底要 ≥4.5:1（实算）
     ============================================================ */
  const tokens = await readFile(path.join(ROOT, 'css/tokens.css'), 'utf8');
  const paper = cssVar(tokens, '--paper');
  ok('tokens.css 里取得到 --paper', !!paper, paper || '');
  for (const name of ['--ink-3', '--ink-4']) {
    const c = cssVar(tokens, name);
    ok('tokens.css 里取得到 ' + name, !!c, c || '');
    if (!c || !paper) continue;
    const r = contrast(c, paper);
    ok(name + ' 对 --paper 的对比度 ≥4.5:1', r >= 4.5,
      c + ' 对 ' + paper + ' = ' + r.toFixed(2) + ':1');
  }
  /* 语义色也是**文字色**：涨、跌、平、金、警示都要能读。
     原来的 --gold 只有 3.23:1、--flat 只有 3.00:1，标题级别的字都看不清。
     图形色（金色圈、游标、滑块）走 --gold，只需要 3:1，不跟文字一个尺子。 */
  const semantic = ['--gold-text', '--up', '--down', '--flat', '--warn'];
  const sheet = cssVar(tokens, '--sheet');
  for (const name of semantic) {
    const c = cssVar(tokens, name);
    ok('tokens.css 里取得到 ' + name, !!c, c || '');
    if (!c || !paper) continue;
    for (const [label, bg] of [['--paper', paper], ['--sheet', sheet]]) {
      if (!bg) continue;
      const r = contrast(c, bg);
      ok(name + ' 对 ' + label + ' 的对比度 ≥4.5:1', r >= 4.5,
        c + ' 对 ' + bg + ' = ' + r.toFixed(2) + ':1');
    }
  }
  // 夜间皮肤也看一眼：白天的达标不代表夜里达标
  const night = tokens.slice(tokens.indexOf('body[data-theme="night"]'));
  const nPaper = cssVar(night, '--paper');
  for (const name of ['--ink-3', '--ink-4']) {
    const c = cssVar(night, name);
    if (!c || !nPaper) continue;
    const r = contrast(c, nPaper);
    ok('夜间皮肤 ' + name + ' 对 --paper 的对比度 ≥4.5:1', r >= 4.5,
      c + ' 对 ' + nPaper + ' = ' + r.toFixed(2) + ':1');
  }

  /* ============================================================
     3. 焦点环：够宽、不能被 none 抹掉
     ============================================================ */
  const layout = await readFile(path.join(ROOT, 'css/layout.css'), 'utf8');
  const components = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
  // 注释里没有花括号，扫描选择器前先把注释剥掉——
  // 否则 /* 换页之后… */ 这种说明文字会被算进选择器，判断全乱。
  const allCss = (layout + '\n' + components).replace(/\/\*[\s\S]*?\*\//g, '');
  const focusRules = [...allCss.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
  ok('CSS 里有 :focus-visible 的焦点环规则', focusRules.length > 0, '找到 ' + focusRules.length + ' 条');
  let thin = 0, none = 0;
  for (const [, sel, body] of focusRules) {
    const outline = /outline\s*:\s*([^;]+)/.exec(body);
    if (!outline) continue;
    const v = outline[1].trim();
    // 唯一的例外：#main 这个**容器**。
    // 换页后焦点会落到它身上（读屏用户得知道内容整块换了），但它不是可交互控件——
    // 给它画一圈焦点框，版式上就是一条贴在正文右边缘、从头贯到尾的金线，
    // 读者会以为那是什么坏了。「换页了」这件事由 live region 播报。
    const targets = sel.split(',').map((x) => x.trim().replace(/:focus(-visible)?/g, '').trim());
    const onlyMain = targets.length > 0 && targets.every((t) => t === 'main' || t === '#main');
    if (/^none$/i.test(v) && !onlyMain) { none++; failures.push('焦点环被抹掉了：' + sel.trim()); fail++; }
    const w = /(\d+(?:\.\d+)?)px/.exec(v);
    if (w && Number(w[1]) < 2) thin++;
  }
  ok('所有 :focus-visible 的焦点环宽度都 ≥2px', thin === 0, thin + ' 条太细');
  ok('没有 :focus-visible 把 outline 设成 none（#main 容器除外）', none === 0, none + ' 条被抹掉');
  // 容器上的焦点框必须去掉——留着就是版式里一条莫名其妙的金线
  ok('#main 是容器，换页后不画焦点框（换页由 live region 播报）',
    /main:focus[^{}]*\{[^}]*outline\s*:\s*none/i.test(allCss),
    'layout.css 里没有 main:focus { outline: none }');
  const globalRing = /:focus-visible\s*\{[^}]*outline\s*:\s*(\d+(?:\.\d+)?)px/.exec(layout);
  ok('全局焦点环宽度 ≥2px', !!globalRing && Number(globalRing[1]) >= 2,
    globalRing ? globalRing[1] + 'px' : 'layout.css 里没找到 :focus-visible 规则');
  // .bchip 是别处的类名：这里没有就跳过，有就必须守规矩
  if (/\.bchip:focus-visible/.test(allCss)) {
    const m = /\.bchip:focus-visible\s*\{([^}]*)\}/.exec(allCss);
    ok('.bchip:focus-visible 的 outline 不是 none', !!m && !/outline\s*:\s*none/i.test(m[1]),
      m ? m[1].trim() : '没找到这条规则');
  } else {
    skipTest('.bchip:focus-visible 的 outline 不是 none', '本站没有 .bchip 这个类');
  }

  /* ============================================================
     3b. 触控热区：主要按钮的可点区域至少 44×44
     ============================================================ */
  const touchTargets = [
    ['.mh-btn', layout],
    ['.replay-head .rp-btn', components],
    ['.drawer-head .dx', components],
  ];
  for (const [sel, css] of touchTargets) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(css);
    ok('触控目标有样式规则：' + sel, !!rule, 'CSS 里找不到 ' + sel);
    if (!rule) continue;
    ok(sel + ' 是定位容器（撑热区用）', /position:\s*relative/.test(rule[1]), rule[1].trim().slice(0, 80));
    const exp = new RegExp(esc + '::after\\s*\\{([^}]*)\\}').exec(css);
    ok(sel + ' 有撑热区的 ::after', !!exp, '缺 ' + sel + '::after');
    if (!exp) continue;
    const up = /top:\s*-(\d+)px/.exec(exp[1]);
    ok(sel + ' 热区向上撑出至少 7px（30px + 14px = 44px）', !!up && Number(up[1]) >= 7,
      exp[1].trim().slice(0, 90));
  }
  // 时间轴滑块：看得见的金条只有 3px 宽，但可拖的盒子必须够大
  const thumb = /input\[type=range\]::-webkit-slider-thumb\s*\{([^}]*)\}/.exec(components);
  ok('滑块的可拖区域至少 24px 宽', !!thumb && /width:\s*24px/.test(thumb[1]),
    thumb ? thumb[1].trim().slice(0, 90) : '没找到滑块样式');

  /* ============================================================
     4. 跑起来：焦点陷阱 / 背景隔离 / 焦点归还 / 换页播报
     ============================================================ */
  for (const f of SCRIPTS) {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) { ok('脚本存在 ' + f, false, '文件缺失'); continue; }
    try {
      vm.runInContext(await readFile(p, 'utf8'), ctx, { filename: f });
      ok('脚本加载 ' + f, true);
    } catch (e) {
      ok('脚本加载 ' + f, false, e.message);
    }
  }

  // 等冷启动跑完
  await tick(200);

  /* ---- 首屏请求数：正文不该在首屏出现 ---- */
  const contentReqs = fetched.filter((u) => u.indexOf('data/content/') === 0)
    .map((u) => u.replace('data/content/', ''));
  const bodyReqs = contentReqs.filter((u) => u !== 'index.json' && u !== 'glossary.json'
    && u !== 'path.json' && u !== 'asset-ids.json' && u !== 'asset-notes.json');
  ok('首屏没有拉文章正文', bodyReqs.length === 0, '多拉了：' + bodyReqs.join(' '));
  ok('首屏只拉五份内容文件', contentReqs.length === 5,
    '实际 ' + contentReqs.length + ' 个：' + contentReqs.join(' '));
  for (const f of ['index.json', 'glossary.json', 'path.json', 'asset-ids.json', 'asset-notes.json']) {
    ok('首屏拉了 ' + f, contentReqs.indexOf(f) >= 0, '实际：' + contentReqs.join(' '));
  }

  /* ---- 冷启动只渲染一遍 ---- */
  ok('冷启动只渲染了一次', sandbox.App && sandbox.App.stats && sandbox.App.stats.routes === 1,
    '实际 ' + (sandbox.App && sandbox.App.stats ? sandbox.App.stats.routes : '?') + ' 次');

  /* ---- 换页之后焦点落到 main，播报区有话 ---- */
  const main = getElementById('main');
  const before = main.focusCount;
  sandbox.location.hash = '#/concepts';
  sandbox.App.route();
  ok('换页之后 #main 拿到焦点', main.focusCount > before,
    'focus 调用次数 ' + before + ' → ' + main.focusCount);
  const live = getElementById('route-live');
  ok('换页播报区有文本', !!live.textContent && live.textContent.length > 0,
    '播报区是空的');
  ok('换页播报说的是当前页', /当前页/.test(live.textContent || ''), live.textContent || '(空)');

  /* ---- 标题是内容驱动的：189 个词条页不能共用一个标题 ---- */
  sandbox.location.hash = '#/term/pe-ratio';
  sandbox.App.route();
  const termTitle = sandbox.document.title;
  ok('词条页的标题带词名', /市盈率/.test(termTitle), '标题：' + termTitle);
  ok('词条页的标题带栏目', /术语/.test(termTitle), '标题：' + termTitle);
  ok('词条页的标题带站名', /白话金融/.test(termTitle), '标题：' + termTitle);
  sandbox.location.hash = '#/term/sharpe-ratio';
  sandbox.App.route();
  ok('不同词条页的标题不一样', sandbox.document.title !== termTitle,
    '两个标题都是：' + sandbox.document.title);

  /* ---- 搜索页标题带查询词 ---- */
  sandbox.location.hash = '#/search?q=' + encodeURIComponent('市盈率');
  sandbox.App.route();
  ok('搜索页标题带查询词', /市盈率/.test(sandbox.document.title), '标题：' + sandbox.document.title);

  /* ---- 分享卡片跟着页面改写 ---- */
  const ogTitle = getElementById('og-title');
  ok('og:title 跟着页面改写', ogTitle.getAttribute('content') === sandbox.document.title,
    'og:title=' + ogTitle.getAttribute('content') + '，标题=' + sandbox.document.title);
  const ogUrl = getElementById('og-url');
  ok('og:url 就是当前页地址', ogUrl.getAttribute('content') === sandbox.location.href,
    'og:url=' + ogUrl.getAttribute('content') + '，地址=' + sandbox.location.href);
  ok('og:url 带 hash（每页各有各的地址）', /#\//.test(ogUrl.getAttribute('content') || ''),
    'og:url=' + ogUrl.getAttribute('content'));
  const canonical = getElementById('canonical');
  ok('canonical 跟着页面改写', (canonical.getAttribute('href') || '') === sandbox.location.href,
    'canonical=' + canonical.getAttribute('href'));

  /* ---- 抽屉：背景要真的被隔开，焦点要能出得来 ---- */
  const drawer = getElementById('drawer');
  const masthead = getElementById('masthead');
  sandbox.TermDrawer.init();
  sandbox.TermDrawer.close();
  ok('抽屉关着时标记为 inert', drawer.getAttribute('inert') !== null);
  const opener2 = getElementById('term-link-stub');
  opener2.focus();          // 焦点先落在「打开抽屉的那个元素」上
  sandbox.TermDrawer.open('gold');
  ok('抽屉打开时不再是 inert', drawer.getAttribute('inert') === null);
  ok('抽屉打开时有 role=dialog', drawer.getAttribute('role') === 'dialog');
  ok('抽屉打开时背景被 inert 挡住', masthead.getAttribute('inert') !== null,
    '背景没被挡住，Tab 会跑到弹层外面去');
  const closeBtn = getElementById('drawer-close');
  ok('抽屉打开时焦点进了抽屉', closeBtn.focusCount > 0);
  sandbox.TermDrawer.close();
  ok('抽屉关掉后焦点还给打开它的元素', doc.activeElement === opener2,
    '焦点在 ' + (doc.activeElement ? doc.activeElement.id : 'null') + ' 上');
  ok('抽屉关掉后背景的 inert 摘掉了', masthead.getAttribute('inert') === null);

  /* ---- 跳到主内容：点了不能改地址栏（本站是 hash 路由） ---- */
  const skipLink = getElementById('skip-link');
  const hashBefore = sandbox.location.hash;
  const mainBefore = getElementById('main').focusCount;
  let skipPrevented = false;
  (skipLink.__on && skipLink.__on.click ? skipLink.__on.click : []).forEach((fn) => fn({
    preventDefault() { skipPrevented = true; },
  }));
  ok('跳到主内容拦下了默认跳转', skipPrevented);
  ok('跳到主内容不改地址栏', sandbox.location.hash === hashBefore,
    '地址栏从 ' + hashBefore + ' 变成了 ' + sandbox.location.hash);
  ok('跳到主内容把焦点送进正文', getElementById('main').focusCount > mainBefore);

  /* ---- 回到顶部按钮：看不见的时候不许留在 Tab 序里 ---- */
  const toTop = getElementById('to-top');
  doc.documentElement.scrollTop = 0;
  sandbox.App.onScroll();
  ok('回到顶部不可见时退出 Tab 序', toTop.getAttribute('inert') !== null,
    '没设 inert，Tab 会停在一个看不见的按钮上');
  doc.documentElement.scrollTop = 900;
  sandbox.App.onScroll();
  ok('回到顶部可见时回到 Tab 序', toTop.getAttribute('inert') === null);
  ok('回到顶部可见时才有 .on', toTop.classList.contains('on'));

  /* ---- 快捷键面板走的是同一套流程 ---- */
  sandbox.App.showKeys();
  ok('快捷键面板打开时背景被 inert 挡住', masthead.getAttribute('inert') !== null);
  ok('快捷键面板打开时焦点进了抽屉', closeBtn.focusCount > 1);
  sandbox.TermDrawer.close();

  /* ---- 命令面板：焦点进得去、出不来、关掉还回来 ---- */
  const fireKey = (ev) => (doc.__on.keydown || []).forEach((fn) => fn(ev));
  const paletteInput = getElementById('palette-input');
  const paletteWrap = getElementById('palette-wrap');
  const opener = getElementById('btn-search');
  opener.focus();
  sandbox.App.openPalette();
  ok('命令面板打开时焦点进了输入框', doc.activeElement === paletteInput);
  ok('命令面板打开时背景被 inert 挡住', masthead.getAttribute('inert') !== null);
  let prevented = false;
  fireKey({ key: 'Tab', shiftKey: false, target: paletteInput, preventDefault() { prevented = true; } });
  ok('面板里按 Tab 不会跑出弹层', prevented, 'Tab 没被拦下，焦点会跑到背景上去');
  ok('面板里按 Tab 之后焦点还在面板内', doc.activeElement === paletteInput,
    '焦点跑到 ' + (doc.activeElement ? doc.activeElement.id : 'null') + ' 上去了');
  fireKey({ key: 'Escape', target: paletteInput, preventDefault() { prevented = true; } });
  ok('Esc 关掉命令面板', !paletteWrap.classList.contains('on'));
  ok('关掉面板后焦点还给打开它的元素', doc.activeElement === opener,
    '焦点在 ' + (doc.activeElement ? doc.activeElement.id : 'null') + ' 上');
  ok('关掉面板后背景的 inert 摘掉了', masthead.getAttribute('inert') === null);

  /* ============================================================
     5. 正文按需加载：23 篇逐一取回，正文一个字都不能少
     ============================================================ */
  const items = sandbox.Content.list();
  ok('内容索引至少 23 篇（随内容增长）', items.length >= 23, '实际 ' + items.length);
  let missing = 0, noBody = 0;
  for (const it of items) {
    const art = await sandbox.Content.ensureArticle(it.id);
    if (!art) { missing++; continue; }
    const got = sandbox.Content.article(it.id);
    if (!got || !got.body || !got.body.length) noBody++;
  }
  ok('每篇正文都取得到', missing === 0, missing + ' 篇取不到');
  ok('取回来之后 Content.article() 拿得到完整正文', noBody === 0, noBody + ' 篇正文是空的');
  const one = sandbox.Content.article(items[0].id);
  ok('正文里确实有内容', !!(one && one.body && one.body.length > 200),
    one && one.body ? one.body.length + ' 字' : '没有正文');
  ok('assetPages() 还在（搜索标的匹配要用）', Array.isArray(sandbox.Content.assetPages())
    && sandbox.Content.assetPages().length > 0,
    'assetPages() 返回：' + JSON.stringify(sandbox.Content.assetPages()).slice(0, 60));
  ok('asset-ids 还在缓存里', !!sandbox.Content.idx.assetIds);

  /* ---- 同一篇不该重复请求 ---- */
  const before2 = fetched.length;
  await sandbox.Content.ensureArticle(items[0].id);
  await sandbox.Content.ensureArticle(items[0].id);
  ok('同一篇正文不重复请求', fetched.length === before2,
    '又发了 ' + (fetched.length - before2) + ' 个请求');

  /* ============================================================
     6. 回放器：键盘用户要知道日期和回撤，峰值谷值不能只藏在 title 里
     ============================================================ */
  {
    const pkg = await sandbox.History.crisis('2008');
    ok('危机包可加载（用于回放器测试）', !!pkg);
    if (pkg) {
      sandbox.ReplayPlayer.render(getElementById('rp-host'), pkg);
      const live = getElementById('rp-live');
      const rpHtml = getElementById('rp-host').innerHTML;
      ok('回放器有播报区', !!live);
      ok('播报区是 role=status', /id="rp-live"[^>]*role="status"/.test(rpHtml),
        (rpHtml.match(/id="rp-live"[^>]*/) || [])[0] || '(没找到)');
      ok('播报区是 aria-live=polite', /id="rp-live"[^>]*aria-live="polite"/.test(rpHtml),
        (rpHtml.match(/id="rp-live"[^>]*/) || [])[0] || '(没找到)');
      const rows = getElementById('rp-rows').innerHTML;
      ok('轨道可以聚焦（键盘够得着）', /class="rp-track"[^>]*tabindex="0"/.test(rows),
        (rows.match(/class="rp-track"[^>]*/) || [])[0] || '(没找到)');
      ok('轨道带着峰值谷值的名字', /aria-label="[^"]*峰值[^"]*谷值/.test(rows),
        (rows.match(/aria-label="[^"]*"/) || [])[0] || '(没有 aria-label)');
      sandbox.ReplayPlayer.jumpTo('2008-09-15');
      ok('播报区说了日期', /2008-09-15/.test(live.textContent || ''), live.textContent || '(空)');
      ok('播报区说了距此前最高多少', /距此前最高/.test(live.textContent || ''), live.textContent || '(空)');
      ok('滑块的值念得出来', getElementById('rp-range').getAttribute('aria-valuetext') === '2008-09-15',
        'aria-valuetext=' + getElementById('rp-range').getAttribute('aria-valuetext'));
      sandbox.ReplayPlayer.stop();
    }
  }

  console.log('');
  console.log(`无障碍测试：通过 ${pass} 条，失败 ${fail} 条，跳过 ${skip} 条`);
  if (failures.length) {
    console.log('');
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('无障碍测试崩溃：', e); process.exit(1); });
