#!/usr/bin/env node
/* features-test.mjs —— 新工具页的无浏览器冒烟测试
   覆盖：#/compare、#/curve、#/analogy、#/calc、#/saved、#/tag、#/quiz、
        标的页图表、2020 危机回放页挂载。
   用法：node _test/features-test.mjs
*/
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(name + (extra ? '  →  ' + extra : '')); } };
const has = (name, hay, needle) => ok(name, typeof hay === 'string' && hay.includes(needle), '未找到：' + needle);

class El {
  constructor(id) {
    this.id = id || null; this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.dataset = {}; this.style = {}; this.attrs = {}; this.hidden = false;
    this.isConnected = true; this.children = []; this._scoped = new Map();
    const self = this;
    this.classList = {
      _s: new Set(), add(...c) { c.forEach((x) => self.classList._s.add(x)); },
      remove(...c) { c.forEach((x) => self.classList._s.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !self.classList._s.has(c) : !!f; on ? self.classList._s.add(c) : self.classList._s.delete(c); return on; },
      contains(c) { return self.classList._s.has(c); },
    };
  }
  addEventListener() {} removeEventListener() {} dispatchEvent() {}
  querySelectorAll() { return []; }
  querySelector(sel) {
    const m = /^#([A-Za-z0-9_-]+)$/.exec(String(sel || '').trim());
    if (!m) return null;
    const id = m[1];
    if (String(this.innerHTML).indexOf('id="' + id + '"') < 0) return null;
    if (!this._scoped.has(id)) this._scoped.set(id, new El(id));
    return this._scoped.get(id);
  }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 36 }; }
  focus() {} blur() {} click() {}
}

const REG = new Map();
const doc = {
  getElementById: (id) => { if (!REG.has(id)) REG.set(id, new El(id)); return REG.get(id); },
  createElement: () => new El('style'),
  createTextNode: (t) => ({ textContent: t }),
  body: new El('body'), head: new El('head'), documentElement: new El('html'),
  title: '', readyState: 'complete', addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], activeElement: null,
};
const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
async function localFetch(url) {
  const u = String(url);
  if (/^https?:\/\//.test(u)) return { ok: false, status: 0, json: async () => { throw new Error('offline'); } };
  const p = path.join(ROOT, u.split('?')[0].split('#')[0]);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  const text = await readFile(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
}
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Math, Date, JSON, Map, Set, WeakMap, WeakSet, Number, String, Array, Object, Boolean, Error,
  RegExp, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  AbortController, AbortSignal, URL, URLSearchParams, TextDecoder, TextEncoder, Intl, Symbol, Proxy, Reflect, BigInt,
  fetch: localFetch, localStorage, document: doc,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  location: { hash: '#/', href: 'http://127.0.0.1:8765/#/', search: '', protocol: 'http:', hostname: '127.0.0.1' },
  history: { pushState() {}, replaceState() {} },
  scrollY: 0, innerWidth: 1280, innerHeight: 900, scrollTo() {}, open() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

const SCRIPTS = [
  'vendor/core/utils.js', 'vendor/core/universe.js', 'vendor/core/explain.js',
  'vendor/core/industry-chains.js', 'vendor/core/academy-gloss.js',
  'js/site/format.js', 'js/site/jsonld.js', 'js/site/pwa.js', 'js/site/net.js',
  'js/site/cross.js', 'js/site/disclaimer.js', 'js/store.js', 'js/router.js',
  'js/engine/series.js', 'js/engine/percentile.js', 'js/engine/drawdown.js',
  'js/engine/crisis.js', 'js/engine/instrument.js', 'js/engine/spread.js',
  'js/engine/analogy.js', 'js/engine/compare.js', 'js/sources/quotes.js',
  'js/sources/history.js', 'js/site/content.js', 'js/components/term-card.js',
  'js/components/series-chart.js', 'js/components/replay-player.js', 'js/views/compare.js', 'js/views/curve.js',
  'js/views/analogy.js', 'js/views/calc.js', 'js/views/saved.js', 'js/views/tag.js',
  'js/views/quiz.js', 'js/views/series.js', 'js/views/assets.js', 'js/views/crisis.js',
];
for (const f of SCRIPTS) {
  const p = path.join(ROOT, f);
  if (!existsSync(p)) { ok('脚本存在 ' + f, false); continue; }
  try { vm.runInContext(await readFile(p, 'utf8'), ctx, { filename: f }); ok('加载 ' + f, true); }
  catch (e) { ok('加载 ' + f, false, e.message); }
}

async function main() {
  await sandbox.Content.loadAll();
  ok('内容加载', sandbox.Content.list().length >= 23);

  const view = () => doc.getElementById('view');

  {
    const v = view();
    await sandbox.CompareView.render(v, { ids: 'SPX,GC00Y', from: '2020-01', to: '2021-12' });
    const cmpResult = String((v.querySelector('#cmp-result') || {}).innerHTML || '');
    has('对比器：标题', v.innerHTML, '把两条线放在同一张图上');
    has('对比器：图表', cmpResult, '<svg');
    has('对比器：统计表', cmpResult, '区间读数');
    has('对比器：相关性', cmpResult, '相关性');
    has('对比器：口径', cmpResult, '归一化');
  }
  {
    const v = view();
    await sandbox.CurveView.render(v, { market: 'us' });
    has('曲线：标题', v.innerHTML, '一条曲线');
    has('曲线：图表', v.innerHTML, '<svg');
    has('曲线：倒挂文案', v.innerHTML, '倒挂');
    has('曲线：利差历史', v.innerHTML, '利差历史');
  }
  {
    const v = view();
    sandbox.AnalogyView.render(v, {});
    has('对照仪：标题', v.innerHTML, '本轮 AI 周期');
    has('对照仪：免责声明', v.innerHTML, '这是算术，不是预测');
    has('对照仪：相似度', v.innerHTML, '相似度');
    has('对照仪：两列条形', v.innerHTML, 'ana-bar base');
    ok('对照仪：不再提供可拖动滑块', !v.innerHTML.includes('type="range"'));
  }
  {
    const v = view();
    sandbox.CalcView.render(v, {});
    for (const t of ['名义收益 vs 实际购买力', '定投 / 复利', '房贷月供', '跌下去，要涨多少才回本']) has('计算器：' + t, v.innerHTML, t);
    has('计算器：不是建议', v.innerHTML, '不是理财建议');
    has('计算器：结果区', v.innerHTML, 'calc-out');
  }
  {
    sandbox.Store.set('bookmarks', ['gold']);
    sandbox.Store.set('recent', ['hk00700']);
    sandbox.Store.set('readAt', { hk00700: Date.now() });
    const v = view();
    sandbox.SavedView.render(v, {});
    has('收藏页：收藏', v.innerHTML, '收藏');
    has('收藏页：最近阅读', v.innerHTML, '最近阅读');
    has('收藏页：文章标题', v.innerHTML, '黄金');
  }
  {
    const v = view();
    sandbox.TagView.render(v, '美股');
    has('标签页：标题', v.innerHTML, '标签');
    has('标签页：文章段', v.innerHTML, '文章');
  }
  {
    const v = view();
    sandbox.QuizView.render(v, { n: 5, seed: 7 });
    has('自测：题干', v.innerHTML, '这句话说的是哪个词');
    ok('自测：五道题', (v.innerHTML.match(/quiz-opt/g) || []).length >= 4, '选项数不足');
  }
  {
    const v = view();
    await sandbox.AssetsView.renderDetail(v, 'gold');
    has('标的页：走势图', v.innerHTML, '月线走势');
    has('标的页：回撤图', v.innerHTML, '回撤');
    has('标的页：对比入口', v.innerHTML, '同区间对比');
  }
  {
    await sandbox.Content.ensureArticle('2020');
    const v = view();
    await sandbox.CrisisView.renderDetail(v, '2020');
    has('2020 危机：标题', v.innerHTML, '疫情熔断');
    has('2020 危机：回放容器', v.innerHTML, 'crisis-replay');
  }
  {
    const v = view();
    await sandbox.SeriesView.render(v, 'GC00Y');
    has('序列页：标题', v.innerHTML, 'COMEX黄金');
    has('序列页：来源', v.innerHTML, '来源');
    has('序列页：下载', v.innerHTML, '下载原始 JSON');
    has('序列页：图表', v.innerHTML, '走势');
  }
  {
    const v = view();
    await sandbox.StatusView.render(v, {});
    has('数据台账：标题', v.innerHTML, '每个数字');
    has('数据台账：序列数', v.innerHTML, '序列数');
  }
  {
    const paths = sandbox.Router.ROUTES.map((r) => r.path);
    for (const p of ['/compare', '/curve', '/analogy', '/calc', '/saved', '/quiz', '/tag/:tag', '/series/:id', '/status']) {
      ok('路由存在 ' + p, paths.indexOf(p) >= 0);
    }
  }

  console.log('\n新功能冒烟测试：通过 ' + pass + ' 条，失败 ' + fail
 + ' 条');
  if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
