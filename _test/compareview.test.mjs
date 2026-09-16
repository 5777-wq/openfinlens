#!/usr/bin/env node
/* compareview.test.mjs —— 基金对比**视图层**的离线冒烟（Node 直跑，不联网、不需要浏览器）
 * 用法：node _test/compareview.test.mjs
 *
 * 为什么单独一组：`compare.test.mjs` 只测纯计算，视图层（compareview.js）的两类 bug 它一个都测不到——
 *   ① `metrics()` 返回 null 时模板里第一个 `.toFixed` 抛错，整块表停在骨架上；
 *   ② `applyHash` 里漏掉一行 `const g = get('g')`，`g is not defined` 让 refresh() 整个 reject，
 *      页面看起来"加载中"但什么都没有。
 * 两处都是**只在浏览器里才被发现**的。所以这里用最小 DOM/document 打桩，加载真实的
 * compare.js + compareview.js，把"进页面 → 解析深链 → 取数 → 渲染 → 删标的 → 重试"跑一遍，
 * 断言不抛异常且关键 DOM 有内容。桩只替掉 IO（网络/DOM/存储），业务与渲染都是真代码。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
/* 必须 await 回调：视图层的断言全在 await 之后，同步版 test() 会把"还没跑断言"的用例
   直接记成通过（任何后续断言失败只变成 unhandled rejection，测试照样绿）。 */
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

/* ---------------- 最小 DOM / 浏览器环境 ---------------- */

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, style: {},
    dataset: {}, children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; v ? this._s.add(c) : this._s.delete(c); return v; },
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); }, remove() {}, contains() { return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 800, height: 460, right: 800, bottom: 460, x: 0, y: 0 }; },
    click() {}, focus() {}, select() {},
  };
  return el;
}

function makeCtx() {
  const els = new Map();
  const styleVals = {};
  for (const m of readFileSync(path.join(ROOT, 'css/style.css'), 'utf8').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!(m[1] in styleVals)) styleVals[m[1]] = m[2].trim();
  }
  const store = new Map();
  const calls = { loadMany: [], fresh: [] };
  const ctx = {
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
    Infinity, isFinite, Map, Set, Promise, Error, RegExp, Symbol, setTimeout, clearTimeout, isNaN,
    document: {
      getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      createElement() { return makeEl('tmp'); },
      addEventListener() {},
      body: makeEl('body'),
      documentElement: makeEl('html'),
    },
    getComputedStyle: () => ({ getPropertyValue: (k) => styleVals[k] || '' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { hash: '#tab=compare', href: 'http://x/index.html#tab=compare' },
    history: { replaceState() {}, pushState() {} },
    __els: els, __calls: calls,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  const c = vm.createContext(ctx);

  // 只打桩 IO 与外部依赖；compare.js / compareview.js 用真源码
  vm.runInContext(`
    window.U = {
      num: (v) => { if (v === null || v === undefined || v === '' || v === '-') return null;
        const n = Number(v); return Number.isFinite(n) ? n : null; },
      fmt: (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? '--' : Number(n).toFixed(d),
      fmtPct: (n) => (n === null || n === undefined || isNaN(n)) ? '--' : (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%',
      escapeHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
      fetchJSONP: async () => { throw new Error('no jsonp in test'); },
      Cache: { get: () => null, set: () => {}, raw: () => null },
      request: async () => { throw new Error('no network in test'); },
    };
    window.Store = {
      get: (k, d) => { const v = localStorage.getItem('gfd_' + k); return v === null ? d : JSON.parse(v); },
      set: (k, v) => localStorage.setItem('gfd_' + k, JSON.stringify(v)),
    };
    window.SourceState = { ok() {}, fail() {}, all: () => [] };
    window.EastmoneySource = { search: async () => [] };
    window.Charts = {
      themeColors: () => ({ up: '#ff5c5c', down: '#2ebd85',
        lineColors: ['#e8a33d', '#5b8def', '#1fc2db', '#b06ad4', '#e0559b', '#aab82e'] }),
      createCompare: () => ({ setSeries() {}, setLog() {}, setHover() {}, applyTheme() {}, fit() {}, remove() {} }),
    };
    // 取数桩：按"当前用例"决定返回什么（可模拟全失败 / 单根 bar / 正常序列）
    window.__canned = { mode: 'ok' };
    window.HistorySource = {
      MAX_BARS: 5000,
      loadMany: async (inputs, opts) => {
        window.__calls.loadMany.push({ inputs: inputs.slice(), opts: { ...opts } });
        if (opts && opts.fresh) window.__calls.fresh.push(true);
        return inputs.map((code, i) => {
          const m = window.__canned.mode;
          if (m === 'fail') return null;
          const bars = m === 'onebar'
            ? [{ time: '2026-09-10', close: 100 }]
            : [{ time: '2020-01-02', close: 100 + i * 10 }, { time: '2021-01-04', close: 120 + i * 10 }, { time: '2022-01-04', close: 90 + i * 10 }];
          return { secid: '105.' + code, name: '基金' + code, market: 'us', adj: 'none', via: 'tencent', bars };
        });
      },
      load: async () => null,
      series: async () => null,
    };
  `, c);
  vm.runInContext(readFileSync(path.join(ROOT, 'js/compare.js'), 'utf8'), c, { filename: 'compare.js' });
  vm.runInContext(readFileSync(path.join(ROOT, 'js/compareview.js'), 'utf8'), c, { filename: 'compareview.js' });
  return c;
}

function mountView(c, overrides = {}) {
  const CV = vm.runInContext('window.CompareView', c);
  const g = (id) => vm.runInContext(`document.getElementById(${JSON.stringify(id)})`, c);
  const dom = {};
  ['cmpBar', 'cmpInput', 'cmpResults', 'cmpAdd', 'cmpStatus', 'cmpRetry', 'cmpPresets', 'cmpChips', 'cmpChipsSub',
    'cmpSub', 'cmpStart', 'cmpEnd', 'cmpQuick', 'cmpLog', 'cmpNormHint', 'cmpChartBox', 'cmpChart', 'cmpLegend',
    'cmpMetrics', 'cmpMetricsSub', 'cmpYearly', 'cmpCorr', 'cmpNote'].forEach(id => { dom[id.replace(/^cmp/, 'cmp')] = g(id); });
  CV.mount({
    wrap: dom.cmpBar, input: dom.cmpInput, results: dom.cmpResults, add: dom.cmpAdd, status: dom.cmpStatus,
    retry: dom.cmpRetry, presets: dom.cmpPresets, chips: dom.cmpChips, chipsSub: dom.cmpChipsSub, sub: dom.cmpSub,
    start: dom.cmpStart, end: dom.cmpEnd, quick: dom.cmpQuick, log: dom.cmpLog, normHint: dom.cmpNormHint,
    chartBox: dom.cmpChartBox, chart: dom.cmpChart, legend: dom.cmpLegend, metrics: dom.cmpMetrics,
    metricsSub: dom.cmpMetricsSub, yearly: dom.cmpYearly, corr: dom.cmpCorr, note: dom.cmpNote,
  }, overrides.deps || {});
  return { CV, g, dom };
}

const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------------- 用例 ---------------- */

const c1 = makeCtx();
const v1 = mountView(c1);
const txt = (id) => v1.g(id).innerHTML || v1.g(id).textContent || '';

await test('深链解析：正常 hash 进页面不抛异常，标的/区间/口径都落到 state', async () => {
  vm.runInContext(`window.CompareView.applyHash('#tab=compare&f=SPY,QQQ&start=2015-01-01&end=2020-01-01&g=week&n=pct&a=common&log=1')`, c1);
  await tick();
  const st = v1.CV.state;
  assert.deepEqual([...st.items.map(i => i.code)], ['SPY', 'QQQ']);
  assert.equal(st.start, '2015-01-01');
  assert.equal(st.end, '2020-01-01');
  assert.equal(st.granularity, 'week');
  assert.equal(st.norm, 'pct');
  assert.equal(st.align, 'common');
  assert.equal(st.log, false, '累计% 口径下对数轴必须关掉');
});

await test('深链解析：重复代码去重、非法区间回默认、非法枚举值忽略而不是重置', async () => {
  vm.runInContext(`window.CompareView.applyHash('#tab=compare&f=SPY,spy,SPY,QQQ&start=2026-01-01&end=2020-01-01&g=nope&n=nope')`, c1);
  await tick();
  const st = v1.CV.state;
  assert.deepEqual([...st.items.map(i => i.code)], ['SPY', 'QQQ'], '大小写不同的重复代码要去重');
  assert.ok(st.start < st.end, `起止日期被写反时应回默认，实际 ${st.start} → ${st.end}`);
  assert.equal(st.granularity, 'week', 'g=nope 是非法值：忽略它、保留上一次的 week（不是重置）');
  assert.equal(st.norm, 'pct', 'n=nope 同理：保留上一次的 pct');
});

await test('渲染：正常序列 → 图例/指标/年度/相关性四块都有内容，且一句话说明口径', async () => {
  await v1.CV.refresh();
  await tick();
  assert.match(txt('cmpLegend'), /SPY/, '图例应有 SPY');
  assert.match(txt('cmpMetrics'), /总收益/, '指标表应有表头');
  assert.match(txt('cmpMetrics'), /10\.0%|9\.1%/, '指标表应有实际数字');   // 100→90 = -10%
  assert.match(txt('cmpYearly'), /20\d\d/, '年度矩阵应有年份');
  assert.match(txt('cmpCorr'), /相关/, '相关性块应渲染');
  assert.match(txt('cmpSub'), /价格收益|含分红/, '副标题必须跟着实际口径走');
  assert.match(txt('cmpNote'), /口径/, '脚注必须写口径');
  vm.runInContext(`window.__calls.loadMany.length = 0`, c1);
});

await test('渲染：单根 bar 的区间不崩（曾在这里抛 toFixed 并永久卡骨架）', async () => {
  vm.runInContext(`window.__canned.mode = 'onebar'`, c1);
  await v1.CV.refresh();
  await tick();
  const m = txt('cmpMetrics');
  assert.ok(!/sk-card|sk-row/.test(m), '骨架必须被真实内容替换掉，实际仍停在骨架：' + m.slice(0, 80));
  assert.match(m, /没有可对比的标的/, '样本不足的标的都被排除后应给空态（而不是抛异常）');
  assert.match(txt('cmpNote'), /未纳入对比/, '被排除的标的必须写明理由');
});

await test('渲染：全部取数失败 → 诚实空态（不抛错、不留骨架）', async () => {
  vm.runInContext(`window.__canned.mode = 'fail'`, c1);
  await v1.CV.refresh();
  await tick();
  assert.match(txt('cmpNote'), /取数失败/, '应给出取数失败提示');
  assert.ok(!/sk-row/.test(txt('cmpMetrics')), '失败态不该停在骨架');
  vm.runInContext(`window.__canned.mode = 'ok'`, c1);
});

await test('重试按钮走 fresh 通道（否则 6 小时缓存会让它成为摆设）', async () => {
  vm.runInContext(`window.__calls.fresh.length = 0`, c1);
  vm.runInContext(`window.CompareView.refresh()`, c1);            // 普通刷新：不该带 fresh
  await tick();
  assert.equal(vm.runInContext('window.__calls.fresh.length', c1), 0, '普通刷新不应绕过缓存');
  vm.runInContext(`window.CompareView.refresh({ fresh: true })`, c1);   // 重试：必须带 fresh
  await tick();
  assert.equal(vm.runInContext('window.__calls.fresh.length', c1), 1, '重新取数必须带 fresh 绕过缓存');
});

await test('增删标的：去重、上限、删除都生效，并把结果持久化到 localStorage', async () => {
  const c = makeCtx();
  const v = mountView(c);
  const get = (code) => v.CV.state.items.map(i => i.code).join(',');
  const start = v.CV.state.items.length;                 // 首次进入是预设组合（6 只）
  assert.ok(start > 0, '首次进入应有预设组合');
  const firstCode = v.CV.state.items[0].code;
  v.CV.addItem(firstCode); await tick();                 // 已在列表里 → 不应增长
  assert.equal(v.CV.state.items.length, start, '重复代码不应重复加入');
  v.CV.addItem('ZZTEST'); await tick();                  // 新的 → +1
  assert.equal(v.CV.state.items.length, start + 1, '新标的应加入');
  for (let i = 0; i < 12; i++) v.CV.addItem('T' + i);
  await tick();
  assert.ok(v.CV.state.items.length <= v.CV.MAX_FUNDS, `上限 ${v.CV.MAX_FUNDS} 生效，实际 ${v.CV.state.items.length}`);
  v.CV.removeItem(firstCode); await tick();
  assert.ok(!v.CV.state.items.some(i => i.code === firstCode), '删除应生效');
  const saved = JSON.parse(vm.runInContext(`localStorage.getItem('gfd_cmp')`, c));
  assert.ok(saved && Array.isArray(saved.items) && !saved.items.some(i => i.code === firstCode),
    '删除后的列表必须写进 localStorage（否则刷新会复活）');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
