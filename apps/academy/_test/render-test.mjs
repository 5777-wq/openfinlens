#!/usr/bin/env node
/* render-test.mjs —— 无浏览器渲染测试
   目标：在 Node 里把站点 JS 真正跑起来，实测每个视图的输出。
   做法：最小 DOM 桩 + 本地 fetch → 执行真实视图函数 → 断言产物 HTML。
   能抓到的正是之前踩过的那类 bug：未定义标识符、字段名对不上、路由缺失。

   用法：node _test/render-test.mjs
*/
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? '  →  ' + extra : '')); }
}
function has(name, hay, needle) {
  ok(name, typeof hay === 'string' && hay.includes(needle),
    '未找到：' + needle + (typeof hay === 'string' ? '（实际长度 ' + hay.length + '）' : '（非字符串）'));
}
/** 元素文本：innerHTML 与 textContent 都算（视图里两种都用） */
function elText(el) {
  if (!el) return '';
  return String(el.innerHTML || '') + String(el.textContent || '');
}
function hasEl(name, el, needle) {
  has(name, elText(el), needle);
}

/* ================= 最小 DOM 桩 ================= */
class El {
  constructor(id, tag) {
    this.id = id; this.tag = tag || 'div';
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.dataset = {}; this.style = { cssText: '' }; this.attrs = {};
    this.children = []; this.hidden = false;
    this._connected = true; this._root = null;
    const self = this;
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach((x) => self.classList._set.add(x)); },
      remove(...c) { c.forEach((x) => self.classList._set.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !self.classList._set.has(c); f ? self.classList._set.add(c) : self.classList._set.delete(c); return f; },
      contains(c) { return self.classList._set.has(c); },
    };
  }
  /** 是否还挂在文档上：子元素跟着根走（真实浏览器就是这样） */
  get isConnected() { return this._root ? this._root.isConnected : this._connected; }
  set isConnected(v) { this._connected = !!v; }
  addEventListener() {} removeEventListener() {} dispatchEvent() {}
  querySelectorAll() { return []; }
  /**
   * 容器作用域查询（只认 #id）。
   *
   * 真实浏览器里 el.querySelector('#x') 只在 el 的**子树**里找，
   * 找不到就是 null——**绝不会**去文档里别处捞一个同名节点。
   * 这个区别就是异步串页 bug 的要害：视图用 document.getElementById 找节点时，
   * 旧页面 await 回来会命中新页面的同名节点，旧数据就写进了新页面。
   *
   * 所以桩里必须如实还原这条边界（还要能往下递归到子树），
   * 否则测试根本测不出那个 bug。
   */
  querySelector(sel) {
    if (typeof sel !== 'string') return null;
    const m = /^#([A-Za-z0-9_-]+)$/.exec(sel.trim());
    if (!m) return null;
    const id = m[1];
    if (String(this.innerHTML || '').indexOf('id="' + id + '"') >= 0) return this._scopedEl(id);
    if (!this._scoped) return null;
    for (const child of this._scoped.values()) {
      const hit = child.querySelector(sel);
      if (hit) return hit;
    }
    return null;
  }
  _scopedEl(id) {
    if (!this._scoped) this._scoped = new Map();
    if (!this._scoped.has(id)) {
      const child = new El(id);
      child._root = this._root || this;
      this._scoped.set(id, child);
      REG.set(id, child);   // 文档里最后一个同名节点：模拟「后挂载的页面在文档里」
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
  focus() {} blur() {} click() {}
  setPointerCapture() {} releasePointerCapture() {}
}

const REG = new Map();
function getElementById(id) {
  if (!REG.has(id)) REG.set(id, new El(id));
  return REG.get(id);
}

const documentEl = new El('document');
const doc = {
  getElementById,
  createElement: (t) => new El(null, t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  body: new El('body'),
  head: new El('head'),
  documentElement: new El('html'),
  title: '',
  readyState: 'complete',
  addEventListener() {}, removeEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  activeElement: null,
};
documentEl.appendChild(doc.body);

/* ================= 本地 fetch ================= */
async function localFetch(url) {
  const u = String(url);
  if (/^https?:\/\//.test(u)) {
    // 外部源：模拟不可达（离线测试）
    return { ok: false, status: 0, json: async () => { throw new Error('offline'); } };
  }
  const p = path.join(ROOT, u.split('?')[0].split('#')[0]);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  const text = await readFile(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
}

/* ================= 沙箱 ================= */
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
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() {},
  location: { hash: '#/', href: 'http://127.0.0.1:8765/#/', search: '' },
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
  'js/legacy/utils.js',
  'js/legacy/universe.js',
  'js/legacy/explain.js',
  'js/legacy/industry-chains.js',
  'js/legacy/academy-gloss.js',
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

async function main() {
  /* ---- 1. 所有脚本能无异常加载 ---- */
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

  /* ---- 2. 全局对象齐备 ---- */
  for (const g of ['Fmt', 'Store', 'Router', 'Quotes', 'History', 'Content', 'TermCard',
    'TermDrawer', 'EraTimeline', 'ReplayPlayer', 'ChainHeat',
    'HomeView', 'ListView', 'ArticleView', 'CrisisView', 'ChainView', 'PathView', 'SearchView', 'TermView',
    'Engine', 'Explain', 'INDUSTRY_CHAINS']) {
    ok('全局对象 ' + g, typeof sandbox[g] !== 'undefined');
  }
  ok('首屏用到的引擎模块齐备', sandbox.Engine
    && !!sandbox.Engine.percentile && !!sandbox.Engine.drawdown
    && !!sandbox.Engine.crisis && !!sandbox.Engine.instrument,
    'percentile / drawdown / crisis / instrument 缺了');

  /* ---- 2b. 网络收口：SSRF 防线 ---- */
  const SN = sandbox.SafeNet;
  ok('SafeNet 存在', !!SN);
  ok('SafeNet 放行同源相对路径', SN.allowed('data/content/index.json').ok);
  ok('SafeNet 放行公网 https', SN.allowed('https://push2.eastmoney.com/api/qt/ulist.np/get').ok);
  const blocked = [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'http://192.168.1.1/x',
    'http://172.16.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x',
    'file:///etc/passwd', 'javascript:alert(1)',
  ];
  for (const u of blocked) ok('SafeNet 拒绝 ' + u, !SN.allowed(u).ok, JSON.stringify(SN.allowed(u)));
  // ensureArticle 的 id 白名单：路径拼接进不来
  const evil = await sandbox.Content.ensureArticle('../_meta/glossary');
  ok('ensureArticle 拒绝路径穿越 id', evil === null);

  /* ---- 3. 内容加载 ---- */
  await sandbox.Content.loadAll();
  ok('内容索引非空', sandbox.Content.list().length >= 6, '实际 ' + sandbox.Content.list().length);
  ok('术语库非空', Object.keys(sandbox.Content.glossary()).length >= 12);
  ok('新手路径有 8 课', !!sandbox.Content.pathPlan() && sandbox.Content.pathPlan().lessons.length === 8);

  /* ---- 4. 路由表覆盖所有内容分区 ---- */
  const paths = sandbox.Router.ROUTES.map((r) => r.path);
  for (const p of ['/concepts/:id', '/crisis/:id', '/assets/:id', '/chains/:id', '/cycles/:id', '/family/:id',
    '/reports/:id', '/term/:id', '/terms']) {
    ok('路由存在 ' + p, paths.indexOf(p) >= 0);
  }
  // 每篇文章的 section 都要有对应的详情路由
  const routeOf = { concepts: '/concepts/:id', assets: '/assets/:id', crisis: '/crisis/:id', cycles: '/cycles/:id', family: '/family/:id', reports: '/reports/:id' };
  for (const a of sandbox.Content.list()) {
    ok('文章 ' + a.id + ' 有详情路由', paths.indexOf(routeOf[a.section]) >= 0, 'section=' + a.section);
  }

  /* ---- 5. 视图渲染 ---- */
  const view = () => getElementById('view');

  // 首页（先塞几条假报价，测到"有数据"那条分支）
  sandbox.Quotes.state.quotes.set('EM:171.US10Y', { key: 'EM:171.US10Y', name: '美债10年', price: 5.24, pct: 0.29, digits: 2, unit: '%' });
  sandbox.Quotes.state.quotes.set('EM:101.GC00Y', { key: 'EM:101.GC00Y', name: '黄金', price: 4143.8, pct: -0.13, digits: 1, unit: '美元/盎司' });
  sandbox.Quotes.state.quotes.set('sh000001', { key: 'sh000001', name: '上证', price: 3717.09, pct: -0.49, digits: 2, unit: '' });
  sandbox.Quotes.state.source = '测试桩';
  sandbox.HomeView.render(view());
  const home = view().innerHTML;
  has('首页：主标题', home, '讲成你听得懂的话');
  has('首页：今日一词', home, '今日一词');
  has('首页：行情终端入口', home, 'OpenFinLens');
  has('首页：新手路径入口', home, '从零开始');
  has('首页：时代横轴容器', home, 'id="home-era"');
  // 时代横轴与仪表是子元素，要单独断言
  hasEl('首页：时代横轴渲染', getElementById('home-era'), '互联网泡沫');
  hasEl('首页：时代横轴含 AI 周期', getElementById('home-era'), 'AI 周期');
  hasEl('首页：仪表卡名', getElementById('home-gauges'), '美债 10 年期收益率');
  hasEl('首页：仪表卡含黄金', getElementById('home-gauges'), 'COMEX 黄金');
  hasEl('首页：仪表卡有真实读数', getElementById('home-gauges'), '5.24');
  hasEl('首页：仪表卡有涨跌幅', getElementById('home-gauges'), '+0.29%');
  hasEl('首页：仪表卡有解释链接', getElementById('home-gauges'), 'risk-free-rate');
  hasEl('首页：仪表卡有"这是什么"提示', getElementById('home-gauges'), 'dp-f');
  hasEl('首页：仪表数据源标注', getElementById('gauge-src'), '测试桩');

  // 列表页
  for (const sec of ['concepts', 'assets', 'cycles', 'family']) {
    sandbox.ListView.render(view(), sec);
    const h = view().innerHTML;
    ok('列表页 ' + sec + ' 有条目', /class="entry"/.test(h) && h.length > 500);
  }

  // 文章详情（每一篇都要能渲染，且标题不为空）
  // 文章页现在是异步的（正文按需拉，js/site/content.js）——必须 await，否则读到的是骨架
  for (const a of sandbox.Content.list()) {
    let html = '';
    let err = null;
    try {
      await sandbox.ArticleView.render(view(), a.section, a.id);
      html = view().innerHTML;
    } catch (e) { err = e.message; }
    ok('文章渲染 ' + a.id, !err, err || '');
    if (!err) {
      // 标题：HTML 里引号被转义，所以比"非空 + 含标题主干"而不是全等
      const h1 = (html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
      ok('文章 ' + a.id + ' 标题非空', h1.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().length > 4, 'h1=' + h1);
      ok('文章 ' + a.id + ' 标题与索引一致', h1.replace(/&quot;/g, '"').includes(String(a.title).slice(0, 6)));
      ok('文章 ' + a.id + ' 有免责声明', html.includes('不构成投资建议'));
      ok('文章 ' + a.id + ' 有数据截止日期', html.includes('本文写于'));
      // 引了序列的文章还要标出「数据实际截止到哪天」——
      // 手写的 dataAsOf 是写作那天，永远停在那天，两个一起显示才对。
      const hasActual = !!a.dataAsOfActual;
      ok('文章 ' + a.id + (hasActual ? ' 标出数据实际截止日' : ' 没有自己的序列就不硬标数据日'),
        hasActual ? html.includes('数据截至') : !html.includes('数据截至'),
        'dataAsOfActual=' + (a.dataAsOfActual || '（无）'));
      ok('文章 ' + a.id + ' 正文非空', html.includes('class="prose"'));
    }
  }

  // 「接着读」：related 里既有文章 id 也有术语 id，两个都得渲染出来。
  // 以前只查文章索引，术语型 related 会让整块「接着读」无声消失（页面上什么都不报）。
  {
    await sandbox.ArticleView.render(view(), 'assets', 'hk00700');
    const rel = view().innerHTML;
    has('文章「接着读」：区块渲染', rel, '接着读');
    ok('文章「接着读」：四个术语都渲染成条目',
      (rel.match(/href="#\/term\//g) || []).length === 4,
      '实际 ' + (rel.match(/href="#\/term\//g) || []).length + ' 个');
    has('文章「接着读」：术语指向自己的页', rel, 'href="#/term/a-share"');
    has('文章「接着读」：术语显示中文名', rel, '股息 / 分红');
    // 文章型 related 与术语型 related 混在一起时，两种链接都要有
    await sandbox.ArticleView.render(view(), 'family', 'money-jar');
    const mix = view().innerHTML;
    has('文章「接着读」：文章型 related 指向文章页', mix, 'href="#/concepts/inflation"');
    has('文章「接着读」：术语型 related 指向术语页', mix, 'href="#/term/etf"');
  }

  // 危机详情
  let crisisErr = null;
  try { await sandbox.CrisisView.renderDetail(view(), '2008'); } catch (e) { crisisErr = e.message; }
  ok('危机详情渲染', !crisisErr, crisisErr || '');
  if (!crisisErr) {
    const h = view().innerHTML;
    has('危机：标题', h, '2008');
    has('危机：免责声明', h, '历史复盘不预测未来');
    ok('危机：含回放器容器', h.includes('id="crisis-replay"'));
  }

  /* ---- 竞态：旧页面慢、新页面快，旧页面回来后不许写进新页面 ----
     以前视图用 document.getElementById 找容器，
     旧页面 await 回来时会命中**新页面**的同名节点——
     于是 URL 显示 1998，图上画的却是 1987 的数据。 */
  {
    const realCrisis = sandbox.History.crisis;
    const delay = { '1987': 60, '1998': 5 };
    sandbox.History.crisis = (id) => new Promise((res) => {
      setTimeout(() => { realCrisis(id).then(res); }, delay[id] || 5);
    });

    // 情形一：路由把旧容器从文档里摘掉了（app.js 换页时就是这么做的）
    const oldA = new El(null, 'div');
    const newA = new El(null, 'div');
    const pOldA = sandbox.CrisisView.renderDetail(oldA, '1987');
    oldA.isConnected = false;
    const pNewA = sandbox.CrisisView.renderDetail(newA, '1998');
    await pNewA;
    const boxA = newA.querySelector('#crisis-replay');
    const snapA = boxA ? boxA.innerHTML : '';
    await pOldA;
    ok('竞态①：旧页面被摘掉后不写新页面', !!boxA && boxA.innerHTML === snapA);
    has('竞态①：新页面画的是 1998', snapA, '1998 亚洲金融危机');

    // 情形二：旧容器还挂在文档里（组件级竞态）——只有作用域查询能挡住
    const oldB = new El(null, 'div');
    const newB = new El(null, 'div');
    const pOldB = sandbox.CrisisView.renderDetail(oldB, '1987');
    const pNewB = sandbox.CrisisView.renderDetail(newB, '1998');
    await pNewB;
    const boxB = newB.querySelector('#crisis-replay');
    const snapB = boxB ? boxB.innerHTML : '';
    await pOldB;
    ok('竞态②：旧页面不得写进新页面的容器', !!boxB && boxB.innerHTML === snapB,
      '旧页面把新页面的回放器覆盖了');
    has('竞态②：新页面仍是 1998', snapB, '1998 亚洲金融危机');

    sandbox.History.crisis = realCrisis;
  }

  // 回放器：真实数据
  const pkg = await sandbox.History.crisis('2008');
  ok('危机包可加载', !!pkg && !!pkg.series);
  if (pkg) {
    ok('危机包 5 条序列', pkg.series.length === 5, '实际 ' + pkg.series.length);
    ok('危机包为日频', pkg.freq === 'D');
    ok('危机包 1000+ 个交易日', pkg.dates.length > 1000, '实际 ' + pkg.dates.length);
    sandbox.ReplayPlayer.render(getElementById('replay-host'), pkg);
    const rows = getElementById('rp-rows').innerHTML;
    has('回放器：标普轨道', rows, '标普500');
    has('回放器：黄金轨道', rows, 'COMEX黄金');
    has('回放器：美债轨道', rows, '美国10年期国债收益率');
    has('回放器：VIX 轨道', rows, 'VIX 恐慌指数');
    has('回放器：游标', rows, 'id="cur-SPX"');
    has('回放器：事件列表', getElementById('rp-events').innerHTML, '雷曼兄弟破产');

    // 纵向可读性：基准线、涨跌面积、峰谷标记、回撤段、现值点
    has('回放器：基准线', rows, 'rt-base');
    has('回放器：涨跌面积', rows, 'rt-area');
    has('回放器：峰值圈', rows, 'rt-peak');
    has('回放器：谷值圈', rows, 'rt-trough');
    has('回放器：现值点', rows, 'rt-now');
    has('回放器：回撤段', rows, 'id="dd-SPX"');
    has('回放器：轨道用 100×100 坐标系', rows, 'viewBox="0 0 100 100"');
    has('回放器：图例', getElementById('replay-host').innerHTML, '区间起点基准线');

    // 跳到 2008-09-30，读数必须与数据一致
    sandbox.ReplayPlayer.jumpTo('2008-09-30');
    const spx = getElementById('val-SPX').innerHTML;
    const gold = getElementById('val-GC00Y').innerHTML;
    const vix = getElementById('val-VIX').innerHTML;
    has('回放：标普读数 1,166', spx, '1,166');
    ok('回放：标普涨跌幅为负（相对区间起点）', /-\d+\.\d+%/.test(spx), spx);
    has('回放：黄金读数 880.80', gold, '880.80');
    has('回放：VIX 读数 39.4', vix, '39.4');
    hasEl('回放：日期显示 2008-09-30', getElementById('rp-date'), '2008-09-30');
    // 说明条应显示离游标最近的事件（09-30 距 AIG 09-16 为 14 天，比雷曼 09-15 的 15 天更近）
    hasEl('回放：事件说明条显示最近事件', getElementById('rp-note'), 'AIG');

    // 日频数据里有 09-15 这一天：游标能精确落在事件当天
    sandbox.ReplayPlayer.jumpTo('2008-09-15');
    hasEl('回放：游标精确落在 2008-09-15', getElementById('rp-date'), '2008-09-15');
    hasEl('回放：点雷曼就显示雷曼的说明', getElementById('rp-note'), '雷曼兄弟破产');
    has('回放：雷曼当天标普 1,192.70', getElementById('val-SPX').innerHTML, '1,192.70');
    has('回放：雷曼当天黄金 787', getElementById('val-GC00Y').innerHTML, '787');

    // 三行读数：现价 / 相对起点 / 距此前最高——"距此前最高"就是"跌了多少"
    has('回放：标普距此前最高 -23.80%', getElementById('val-SPX').innerHTML, '距此前最高 -23.80%');
    has('回放：标普较起点 -6.00%', getElementById('val-SPX').innerHTML, '较起点 -6.00%');
    has('回放：收益率用百分点', getElementById('val-US10Y').innerHTML, 'pp');
    has('回放：美债距此前最高 -1.79pp', getElementById('val-US10Y').innerHTML, '距此前最高 -1.79pp');
    ok('回放：回撤段已画出', (getElementById('dd-SPX').attrs.d || '').startsWith('M'),
      getElementById('dd-SPX').attrs.d || '(空)');
    ok('回放：现值点跟随游标', /%$/.test(String(getElementById('now-SPX').style.left || '')),
      String(getElementById('now-SPX').style.left));

    // 手动拖走之后，锁定自动解除
    sandbox.ReplayPlayer.jumpTo('2008-12-31');
    hasEl('回放：拖走后说明条跟随最近事件', getElementById('rp-note'), '12-16');
    hasEl('回放：12 月说明条', getElementById('rp-note'), '联邦基金利率');

    // 远离所有事件的日期：说明条回落到本场第一个事件，而不是写死的 2008
    sandbox.ReplayPlayer.jumpTo('2007-01-15');
    hasEl('回放：默认说明指向本场第一个事件', getElementById('rp-note'), pkg.events[0].t);
  }

  // 1990：日经的"跌了多少"读数（用户最在意的那条）
  const p90 = await sandbox.History.crisis('1990');
  if (p90) {
    sandbox.ReplayPlayer.render(getElementById('replay-1990'), p90);
    sandbox.ReplayPlayer.jumpTo('1992-02-21');
    const n225 = getElementById('val-N225').innerHTML;
    has('回放：日经现价 21,291.81', n225, '21,291.81');
    has('回放：日经距此前最高 -45.29%', n225, '距此前最高 -45.29%');
    has('回放：日经较起点 -10.86%', n225, '较起点 -10.86%');
    ok('回放：日经回撤段已画出', (getElementById('dd-N225').attrs.d || '').length > 10,
      getElementById('dd-N225').attrs.d || '(空)');
    ok('回放：日经峰值圈已定位', /rt-peak" style="left:\d+\.\d+%/.test(
      getElementById('rp-rows').innerHTML), '峰值圈没定位');
  }

  // 其余四场危机包
  for (const id of ['1987', '1990', '1994', '1998']) {
    const p = await sandbox.History.crisis(id);
    ok('危机包可加载 ' + id, !!p);
    if (!p) continue;
    const s = sandbox.Engine.crisis.summarize(p);
    ok('危机摘要 ' + id + ' 有头条跌幅', s && s.headline && typeof s.headline.dropPct === 'number');
    ok('危机摘要 ' + id + ' 天数正确', s.days === p.dates.length);
    sandbox.ReplayPlayer.render(getElementById('replay-' + id), p);
    ok('回放器渲染 ' + id, getElementById('rp-rows').innerHTML.length > 100);
    ok('回放器 ' + id + ' 有事件', getElementById('rp-events').innerHTML.length > 50);
  }

  // 危机列表：从回放包自动生成，头条跌幅由数据算出
  await sandbox.CrisisView.renderList(view());
  const clist = view().innerHTML;
  has('危机列表：标题', clist, '每一场危机');
  for (const id of ['1987', '1990', '1994', '1998', '2008']) {
    ok('危机列表含 ' + id, clist.indexOf('#/crisis/' + id) >= 0);
  }
  has('危机列表：日频标注', clist, '日频');
  has('危机列表：日经跌幅来自数据', clist, '-63.2%');
  has('危机列表：恒指跌幅来自数据', clist, '-60.1%');
  has('危机列表：标普跌幅来自数据', clist, '-56.8%');
  has('危机列表：1994 用收益率口径（百分点）', clist, '个百分点');
  has('危机列表：最惨一天', clist, '最惨一天');
  // 列表必须按**时间倒序**（最近的在前）。之前用的是采集脚本里的定义顺序
  // （2008/1990/1998/1994/1987）——既不是时间序也不是惨烈序，读者只觉得乱。
  {
    const order = [];
    const re = /href="#\/crisis\/(\d{4})"/g;
    let m;
    while ((m = re.exec(clist))) order.push(m[1]);
    const expect = order.slice().sort((a, b) => Number(b) - Number(a));
    ok('危机列表按时间倒序（最近的在前）',
      order.length >= 2 && order.join(',') === expect.join(','),
      '实际 ' + order.join(',') + '，期望 ' + expect.join(','));
  }

  // 产业链
  const chains = sandbox.INDUSTRY_CHAINS;
  ok('产业链 10 条', chains.length === 10, '实际 ' + chains.length);
  ok('产业链用 links 作环节数组', chains[0].links && chains[0].links.length > 0);
  let chainErr = null;
  try { await sandbox.ChainView.renderDetail(view(), 'ai'); } catch (e) { chainErr = e.message; }
  ok('产业链详情渲染', !chainErr, chainErr || '');
  if (!chainErr) {
    const h = view().innerHTML;
    has('产业链：标题', h, 'AI 算力');
    has('产业链：环节', h, '光模块');
    ok('产业链：强弱条容器', h.includes('id="chain-heat"'));
  }
  sandbox.ChainView.renderList(view());
  has('产业链列表', view().innerHTML, '新能源车');

  // 新手路径
  sandbox.PathView.render(view());
  has('新手路径：标题', view().innerHTML, '从零开始');
  ok('新手路径：8 个课次', (view().innerHTML.match(/data-lesson=/g) || []).length === 8);

  // 搜索
  sandbox.SearchView.render(view(), '黄金');
  has('搜索：命中术语', view().innerHTML, '黄金');
  sandbox.SearchView.render(view(), '不存在的词xyz');
  has('搜索：无结果提示', view().innerHTML, '没有找到');

  // 标的百科：索引（与行情终端同一份清单）+ 详情（专文 + 真实数据卡）
  await sandbox.AssetsView.renderIndex(view());
  const alist = view().innerHTML;
  has('标的百科：标题说明与终端同一份清单', alist, '和行情终端同一份标的清单');
  ok('标的百科：列出了 70 只以上标的', (alist.match(/href="#\/assets\//g) || []).length >= 70,
    '实际 ' + (alist.match(/href="#\/assets\//g) || []).length);
  has('标的百科：带上覆盖区间', alist, '个月度点');
  await sandbox.AssetsView.renderDetail(view(), 'usAAPL');
  const adet = view().innerHTML;
  has('标的百科详情：专文标题', adet, '苹果');
  has('标的百科详情：真实数据卡', adet, '真实历史读数');
  has('标的百科详情：最大回撤', adet, '最大回撤');
  has('标的百科详情：历史最高', adet, '历史最高');
  has('标的百科详情：历史最低', adet, '历史最低');
  // 「最新月末」是句假话：采集器月中的时候写的是当天盘中价。
  ok('标的百科详情：不许标成「最新月末」', !adet.includes('最新月末'), adet.slice(0, 200));
  has('标的百科详情：当月未收要说明', adet, '当月未收');
  // 真正的最大回撤：苹果 2007-12 → 2008-12 是 -56.9%。
  // 旧算法拿全局 min/max 相除会算出 -99.1%（谷底在峰值之前）。
  has('标的百科详情：回撤是按先后顺序算的', adet, '-56.9%');
  ok('标的百科详情：回撤没有算成 -99%', !adet.includes('-99.'), '出现了 -99% 的假回撤');
  has('标的百科详情：去终端看数据', adet, 'openfinlens/#symbol=usAAPL');
  has('标的百科详情：口径说明（未含分红）', adet, '不含分红');
  // 没有专文的标的：真实数据 + 三段短注（不再是只有一张数据表的半空页）。
  // sh601398 现在也补了专文，站内已没有「有短注却无专文」的真实标的，
  // 所以这里临时屏蔽它的专文，专门验证这条兜底渲染路径：
  // 短注、维基深链、月线序列仍全部走真实数据，只把 article() 的返回置空。
  // 取到 HTML 后立刻还原，后面的用例继续用真实 article()。
  const realArticle = sandbox.Content.article;
  sandbox.Content.article = (id) => (id === 'sh601398' ? null : realArticle(id));
  try {
    await sandbox.AssetsView.renderDetail(view(), 'sh601398');
  } finally {
    sandbox.Content.article = realArticle;
  }
  const noart = view().innerHTML;
  has('标的百科详情：无专文也给数据卡', noart, '真实历史读数');
  has('标的百科详情：无专文有三段短注', noart, '三段话读懂它');
  has('标的百科详情：短注含坑提示', noart, '最容易踩的坑');
  // 延伸阅读：维基深链（asset-wiki.json，按需加载）——有词条的标的双语都挂，豁免的不挂
  has('标的百科详情：有专文也带维基深链', adet, '延伸阅读');
  has('标的百科详情：深链指向中文维基', adet, 'https://zh.wikipedia.org/wiki/');
  has('标的百科详情：深链指向英文维基', adet, 'https://en.wikipedia.org/wiki/Apple_Inc.');
  has('标的百科详情：深链新窗口打开', adet, 'rel="noopener noreferrer"');
  has('标的百科详情：无专文标的也有深链', noart, 'zh.wikipedia.org/wiki/%E4%B8%AD%E5%9B%BD%E5%B7%A5%E5%95%86%E9%93%B6%E8%A1%8C');
  await sandbox.AssetsView.renderDetail(view(), 'EM:171.US10Y');
  ok('标的百科详情：豁免标的（美债10Y）不挂深链', !view().innerHTML.includes('延伸阅读'), '不该出现延伸阅读面板');

  // 术语页：给行情终端深链用的落地页
  sandbox.TermView.render(view(), 'gold');
  const th = view().innerHTML;
  has('术语页：术语名', th, '黄金');
  has('术语页：页面标题是 h1', th, '<h1>黄金</h1>');
  has('术语页：四段式卡片', th, 'class="term"');
  has('术语页：一句话', th, '一句话');
  has('术语页：可分享的说明', th, '这条链接可以直接分享出去');
  sandbox.TermView.render(view(), 'risk-free-rate');
  has('术语页：有延伸阅读时列出来', view().innerHTML, '延伸阅读');
  sandbox.TermView.render(view(), '不存在的词xyz');
  has('术语页：未收录有兜底', view().innerHTML, '还没有收录');
  sandbox.TermView.renderIndex(view());
  const tlist = view().innerHTML;
  has('术语库：标题', tlist, '按你遇到的地方找');
  // 索引里每个词都要能点开（入门三词会重复出现，所以按 id 去重后比对）
  const linkedIds = new Set((tlist.match(/href="#\/term\/([^"]+)"/g) || [])
    .map((s) => s.replace(/href="#\/term\//, '').replace(/"/g, '')));
  const allIds = Object.keys(sandbox.Content.glossary());
  ok('术语库：列出全部术语', allIds.every((k) => linkedIds.has(k)),
    '术语库 ' + allIds.length + ' 个，索引里点到 ' + linkedIds.size + ' 个');
  ok('术语库：每个术语都有可深链的 id', allIds.every((k) => sandbox.TermView.linkOf(k) === '#/term/' + k));
  // 分类分组 + 入门三词
  ok('术语库：按分类分组', tlist.includes('class="cat-block"') && tlist.includes('入门三词'));
  ok('术语库：每组有速查表出口', tlist.includes('#/data?cat=macro'));

  /* ---- 术语库词典化：查一个词不用再翻文章（反馈点名「想查 PE 很麻烦」） ---- */
  {
    // 词条默认展开完整四段：索引页本身就是词典，不是一列只能点开的链接
    ok('术语库：词条默认展开完整四段卡',
      (tlist.match(/class="term-link"/g) || []).length === Object.keys(sandbox.Content.glossary()).length,
      'term-link 卡 ' + (tlist.match(/class="term-link"/g) || []).length + ' 张，词条 '
        + Object.keys(sandbox.Content.glossary()).length + ' 个');
    has('术语库：卡片含四段标记（一句话）', tlist, '一句话');
    has('术语库：卡片含四段标记（坑）', tlist, '坑');

    // ?q=PE：进页面就是过滤态
    sandbox.TermView.renderIndex(view(), { q: 'PE' });
    const tq = view().innerHTML;
    has('词典 ?q=PE：市盈率在列', tq, 'href="#/term/pe-ratio"');
    ['一句话', '比喻', '数字', '坑'].forEach((k) =>
      has('词典 ?q=PE：页面含四段标记（' + k + '）', tq, k));
    ok('词典 ?q=PE：无关词条被滤掉', !tq.includes('href="#/term/moving-average"'));
    ok('词典 ?q=PE：过滤框带初始值', /id="terms-q"[^>]*value="PE"/.test(tq),
      (tq.match(/<input[^>]*>/) || [''])[0]);
    ok('词典 ?q=PE：有命中计数', tq.includes('命中'), '计数行没渲染');
    // 过滤规则与站内搜索同一套：pe 不能命中 sharpe（词边界），两处不能两个规则
    const keep = sandbox.TermView.filterIds(sandbox.Content.glossary(), 'PE');
    ok('词典过滤：PE 命中市盈率', keep && keep.has('pe-ratio'));
    ok('词典过滤：PE 不命中夏普（词边界规则与搜索一致）', !keep || !keep.has('sharpe-ratio'));
    // 空结果：友好引导，而不是一张空页
    sandbox.TermView.renderIndex(view(), { q: '不存在的词xyz' });
    const te = view().innerHTML;
    has('词典空结果：说清没命中', te, '没有命中');
    ok('词典空结果：给全站搜索出口', te.includes('#/search?q='));
    ok('词典空结果：给清掉过滤的出口', te.includes('href="#/terms"'));
  }

  /* ---- 搜索页：命中的术语直接读完整词条卡，文章与标的排其后 ---- */
  {
    sandbox.SearchView.render(view(), 'PE');
    const sp = view().innerHTML;
    ok('搜索页：术语命中渲染成完整词条卡', sp.includes('class="term"') && sp.includes('href="#/term/pe-ratio"'));
    has('搜索页：词条卡里有市盈率', sp, '市盈率');
    ['一句话', '比喻', '数字', '坑'].forEach((k) =>
      has('搜索页：词条卡含四段标记（' + k + '）', sp, k));
    // 词条卡用的与术语库同一份渲染（term.js 的 dictCard），不是另写的一套
    ok('搜索页：词条卡复用 term.js 的 dictCard',
      (typeof sandbox.TermView.dictCard === 'function')
      && sandbox.TermView.dictCard('pe-ratio').includes('class="term"')
      && sp.includes(sandbox.TermView.dictCard('pe-ratio')));
    // 顺序：术语在最前，文章与标的排其后
    const iT = sp.indexOf('术语 ·');
    const iA = sp.indexOf('文章 ·');
    const iS = sp.indexOf('标的 ·');
    ok('搜索页：文章排在词条卡之后', iT >= 0 && (iA < 0 || iA > iT), '术语@' + iT + ' 文章@' + iA);
    ok('搜索页：标的排在词条卡之后', iT >= 0 && (iS < 0 || iS > iT), '术语@' + iT + ' 标的@' + iS);
  }

  // 首页：hero 按钮区有词典入口（查一个词，一眼可见）
  sandbox.HomeView.render(view());
  const homeDic = view().innerHTML;
  ok('首页：词典入口链到 #/terms?q=PE', homeDic.includes('href="#/terms?q=PE"'));
  ok('首页：词典入口文案「查一个词」', homeDic.includes('查一个词'));

  // 速查页：按分类切换
  const idsOf = (html) => new Set((html.match(/href="#\/term\/([^"]+)"/g) || [])
    .map((s) => s.replace(/href="#\/term\//, '').replace(/"/g, '')));
  sandbox.TermView.renderDataSheet(view(), {});
  const ds0 = view().innerHTML;
  has('速查页：默认是研报数据', ds0, '看研报时撞见的那些数');
  ok('速查页：十个分类都能切', (ds0.match(/class="ds-tab[ "]/g) || []).length === 10,
    '实际 ' + (ds0.match(/class="ds-tab[ "]/g) || []).length);
  const G = sandbox.Content.glossary();
  const dataIds = Object.keys(G).filter((k) => G[k].cat === 'data');
  const ds0Ids = idsOf(ds0);
  ok('速查页：默认只列 data 类', dataIds.every((k) => ds0Ids.has(k))
    && [...ds0Ids].every((k) => G[k].cat === 'data'),
    'data 类 ' + dataIds.length + ' 个，页面上 ' + ds0Ids.size + ' 个');
  sandbox.TermView.renderDataSheet(view(), { cat: 'player' });
  const ds1 = view().innerHTML;
  has('速查页：切到机构分类', ds1, '机构');
  has('速查页：机构分类给入门三词', ds1, '入门三词');
  const playerIds = Object.keys(G).filter((k) => G[k].cat === 'player');
  const ds1Ids = idsOf(ds1);
  ok('速查页：机构分类只列 player 类', playerIds.every((k) => ds1Ids.has(k))
    && [...ds1Ids].every((k) => G[k].cat === 'player'),
    'player 类 ' + playerIds.length + ' 个，页面上 ' + ds1Ids.size + ' 个');
  sandbox.TermView.renderDataSheet(view(), { cat: '不存在的分类' });
  ok('速查页：非法分类退回研报数据', view().innerHTML.includes('看研报时撞见的那些数'));

  // 期权分类：终端里没有期权数据，但读者读研报/看盘照样会撞上这些词
  sandbox.TermView.renderDataSheet(view(), { cat: 'option' });
  const dsOpt = view().innerHTML;
  has('速查页：期权分类能打开', dsOpt, '期权与期权策略速查');
  ok('速查页：期权分类有词条', idsOf(dsOpt).size >= 15, '实际 ' + idsOf(dsOpt).size);
  // 期权分类没有排序信号可用，得按「基础 → 定价 → 策略」人工排
  const optIds = [...idsOf((dsOpt.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '')];
  ok('速查页：期权分类按「基础 → 定价 → 策略」排，不是字母序',
    optIds[0] === 'option-call' && optIds[1] === 'option-put' && optIds[2] === 'strike-price',
    '前三个：' + optIds.slice(0, 3).join(', '));

  // 组内排序：按「读者真会遇到的顺序」，不是字母序
  sandbox.TermView.renderDataSheet(view(), { cat: 'fund' });
  const dsFund = view().innerHTML;
  // 只取表格里的行（入门三词的卡片也在页面上，会排在表格前面）
  const tbody = (dsFund.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
  const fundIds = [...idsOf(tbody)];
  const G2 = sandbox.Content.glossary();
  const ARTICLE = (id) => (G2[id] && (G2[id].links || []).some((l) => l.href.indexOf('#/concepts/') === 0 || l.href.indexOf('#/crisis/') === 0));
  const HOT = (id) => {
    const AG2 = sandbox.AcademyGloss;
    const EX2 = sandbox.Explain;
    const hot = new Set();
    if (AG2) {
      Object.keys(AG2.TERM_BY_SYMBOL || {}).forEach((k) => hot.add(AG2.TERM_BY_SYMBOL[k]));
      Object.keys(AG2.CONCEPT_BY_SYMBOL || {}).forEach((k) => hot.add(AG2.CONCEPT_BY_SYMBOL[k].id));
    }
    if (EX2 && EX2.CONCEPT_NOTES) Object.keys(EX2.CONCEPT_NOTES).forEach((k) => hot.add(k));
    return hot.has(id);
  };
  const sortedByAlpha = fundIds.slice().sort();
  ok('速查页：组内不按字母序排', JSON.stringify(fundIds) !== JSON.stringify(sortedByAlpha),
    '第一项 ' + fundIds[0]);
  ok('速查页：第一项是「读者会撞见」的词（有专文，或行情里会解释）',
    ARTICLE(fundIds[0]) || HOT(fundIds[0]), '第一项 ' + fundIds[0] + '（' + (G2[fundIds[0]] || {}).term + '）');

  // 入门三词：显示比喻，不是把下面的一句话再抄一遍
  sandbox.TermView.renderDataSheet(view(), { cat: 'fund' });
  const dsSt = view().innerHTML;
  const starterBlock = (dsSt.match(/<div class="starters">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '';
  const stCard = (starterBlock.match(/<a class="starter"[^>]*>[\s\S]*?<\/a>/) || [])[0] || '';
  ok('入门三词：不是把一句话重复一遍', stCard && !stCard.includes('一篮子股票打包成的一张可以在交易所随时买卖的凭证'),
    stCard.slice(0, 120));

  // 与行情终端的双向跳转：术语页要能"去看历史数据"和"回到 OpenFinLens"
  sandbox.TermView.render(view(), 'gold', { from: 'lens', sym: 'EM:101.GC00Y' });
  const cross = view().innerHTML;
  has('术语页：去看历史数据', cross, '去看历史数据');
  has('术语页：去看历史数据指向终端深链', cross, 'openfinlens/#symbol=EM%3A101.GC00Y');
  has('术语页：从终端来才显示回终端', cross, '回到 OpenFinLens');
  // 不是从终端来的，就不该出现"回到 OpenFinLens"（那是给终端用户的出口）
  sandbox.TermView.render(view(), 'gold', {});
  ok('术语页：非终端来源不显示回终端', !view().innerHTML.includes('回到 OpenFinLens'));
  ok('术语页：非终端来源仍可去看数据', view().innerHTML.includes('去看历史数据'));
  // 有 sym 的术语自己就能给出去深链
  sandbox.TermView.render(view(), 'kechuang-50', {});
  has('术语页：术语自带 sym 深链', view().innerHTML, 'openfinlens/#symbol=sh000688');
  sandbox.TermView.render(view(), 'momentum', {});
  has('术语页：概念词走 lens 深链', view().innerHTML, 'openfinlens/#etf=spmo');

  // 跨站跳转条：三档出口（看数据 / 回终端 / 留在本站）
  sandbox.TermView.render(view(), 'gold', { from: 'lens', sym: 'EM:101.GC00Y' });
  const cbar = view().innerHTML;
  has('跨站条：去看历史数据', cbar, '去看历史数据');
  has('跨站条：回到 OpenFinLens', cbar, '回到 OpenFinLens');
  has('跨站条：留在本站继续读', cbar, '继续读别的');
  has('跨站条：指向终端那一只的 K 线', cbar, 'openfinlens/#symbol=EM%3A101.GC00Y');
  // 总开关关掉后，跨站入口一个都不剩
  sandbox.Store.set('lens', false);
  sandbox.TermView.render(view(), 'gold', { from: 'lens', sym: 'EM:101.GC00Y' });
  ok('关掉跨站链接后跳转条整个消失', !view().innerHTML.includes('term-cross'));
  ok('关掉后连"去看历史数据"都不出现', !view().innerHTML.includes('去看历史数据'));
  sandbox.Store.set('lens', true);
  sandbox.TermView.render(view(), 'gold', { from: 'lens', sym: 'EM:101.GC00Y' });
  ok('开关打开后跳转条回来', view().innerHTML.includes('term-cross'));

  // 站点设置：报头要有入口，设置项默认开
  {
    const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
    ok('报头有站点设置按钮', html.includes('id="btn-settings"'));
    ok('跨站链接默认开', sandbox.Store.defaults.lens === true);
    // 各处"去行情终端"的入口都要受同一个开关控制
    const homeSrc = await readFile(path.join(ROOT, 'js/views/home.js'), 'utf8');
    const artSrc = await readFile(path.join(ROOT, 'js/views/article.js'), 'utf8');
    const appSrc = await readFile(path.join(ROOT, 'js/app.js'), 'utf8');
    ok('首页的终端卡片受开关控制', homeSrc.includes('lens-only'));
    ok('文章页的终端卡片受开关控制', artSrc.includes('lens-only'));
    ok('左栏的终端卡片受开关控制', appSrc.includes('rail-sister lens-only'));
    ok('开关统一走 Cross.enabled', appSrc.includes('window.Cross.enabled()'));
    ok('全站不再出现「姊妹站」这种关系称呼', !(homeSrc + artSrc).includes('姊妹站'));
  }

  // 术语卡里的数字必须能在站内序列里对账（口径 = 站点显示的小数位）
  // 手写的数字会悄悄过期，读者对着站内数据一算就是错的——所以每条都验一遍
  {
    const seriesOf = {
      'sse-index': 'SH000001', 'szse-component': 'SZ399001', 'chinext': 'SZ399006',
      'kechuang-50': 'SH000688', 'sp500': 'SPX', 'dow-jones': 'DJIA', 'hsi': 'HSI',
      'nikkei': 'N225', 'vix': 'VIX', 'silver': 'SI00Y', 'dollar-index': 'UDI',
    };
    for (const [id, sid] of Object.entries(seriesOf)) {
      const t = sandbox.Content.term(id);
      const s = JSON.parse(await readFile(path.join(ROOT, 'data/history', sid + '.json'), 'utf8'));
      const set = new Set(s.points.map((p) => p.v.toFixed(s.digits)));
      const nums = (String(t.number || '').match(/\d[\d,]*\.\d+/g) || []).map((x) => x.replace(/,/g, ''));
      const hit = nums.filter((n) => set.has(n));
      ok('术语 ' + id + ' 的数字能在站内序列对账', hit.length >= 2,
        '只命中 ' + hit.length + ' 个：' + JSON.stringify(nums));
    }

    /* 词条里**不许引用序列的最新点**——这条对**所有**带 sym 的词条生效。
       序列每天被采集刷新一次，最新点每天都在动；词条里写死「2026-10-21 收 3713.03 点」
       这样的句子，第二天就过期了——对账测试会先红，然后人就会去改测试。
       正确的做法：词条只引用**不会变的历史值**，最新读数交给标的页的数据卡。
       （踩过的坑：采集流水线推了一次新数据，CI 就红了，而红的原因是这个。） */
    const histCache = new Map();
    const loadHist = async (sid) => {
      if (!histCache.has(sid)) {
        try {
          histCache.set(sid, JSON.parse(await readFile(path.join(ROOT, 'data/history', sid + '.json'), 'utf8')));
        } catch (e) { histCache.set(sid, null); }
      }
      return histCache.get(sid);
    };
    const symToSeries = {
      'a-share': 'SH000001', 'sse-index': 'SH000001', 'szse-component': 'SZ399001',
      'chinext': 'SZ399006', 'kechuang-50': 'SH000688', 'sp500': 'SPX', 'dow-jones': 'DJIA',
      'hsi': 'HSI', 'hstech': 'HSTECH', 'nikkei': 'N225', 'vix': 'VIX', 'silver': 'SI00Y',
      'gold': 'GC00Y', 'crude-oil': 'CL00Y', 'dollar-index': 'UDI', 'inversion': 'US2Y',
      'yield-curve': 'US2Y', 'real-rate': 'US10Y', 'risk-free-rate': 'US10Y',
      'discount-rate': 'US10Y', 'nasdaq': 'usIXIC',
    };
    for (const [id, t] of Object.entries(sandbox.Content.glossary())) {
      const sid = symToSeries[id] || t.sym;
      if (!sid) continue;
      const s = await loadHist(sid);
      if (!s || !s.points || !s.points.length) continue;
      const d = s.digits === undefined ? 2 : s.digits;
      const last = s.points[s.points.length - 1];
      const lastVal = Number(last.v).toFixed(d);
      const ym = String(last.t).slice(0, 7);
      const txt = String(t.number || '');
      const nums = (txt.match(/\d[\d,]*\.\d+/g) || []).map((x) => x.replace(/,/g, ''));
      const quotesLatest = nums.some((n) => n === lastVal)
        && (txt.indexOf(ym) >= 0 || txt.indexOf(String(last.t)) >= 0);
      ok('术语 ' + id + ' 不引用序列的最新点（最新读数交给数据卡）', !quotesLatest,
        '引用了 ' + last.t + ' 的 ' + lastVal + '——它每天都会变');
    }
  }

  /* ---- 6. 术语抽屉 ---- */
  /* 站内搜索：读者会怎么打这些词，站点就得搜得到。
     上一轮实测 67 个真实搜索词里搜不到 10 个，根因是「整串匹配某一个字段」：
     连着打的「pe市盈率」搜不到、英文缩写还会被误命中（pe ⊂ sharpe）。 */
  {
    const S = sandbox.SearchView.search;
    const QUERIES = [
      'pe', '市盈率', 'pe市盈率', 'pe ratio', 'eps', 'roe', 'roe 净资产收益率',
      'etf', 'etfs', '标普500', 'sp500', '标普', '纳指', '道琼斯', 'dow jones',
      '黄金', 'gold', '金价', '原油', '石油', '美联储', 'fed', 'lpr', '降息', '加息',
      'm2', '社融', 'cpi', 'ppi', 'pmi', '做空', '空头', '对冲基金', 'hedge fund',
      '桥水', '期权', 'option', 'call', '跨式', 'straddle', '股息率', '分红',
      'a股', '回撤', '最大回撤', '波动率', 'vix', '恐慌指数', '净值', '指数基金',
      'etf费率', '市净率', '夏普', 'sharpe',
    ];
    const miss = QUERIES.filter((q) => {
      const r = S(q);
      return !(r.terms.length + r.articles.length + r.assets.length);
    });
    ok('站内搜索：真实读者会打的词都搜得到', miss.length === 0,
      '搜不到：' + miss.join(' '));
    // 「pe ratio」不该命中「sharpe ratio」——pe 是 sharpe 的子串
    const pr = S('pe ratio');
    ok('站内搜索：英文缩写按词边界匹配（pe 不该命中 sharpe）',
      pr.terms.length > 0 && pr.terms[0].term.indexOf('市盈率') >= 0,
      '首个命中：' + (pr.terms[0] || {}).term);
  }

  sandbox.TermDrawer.init();
  sandbox.TermDrawer.open('discount-rate');
  const drawer = getElementById('drawer-body').innerHTML;
  has('抽屉：一句话', drawer, '一句话');
  has('抽屉：比喻', drawer, '比喻');
  has('抽屉：数字', drawer, '数字');
  has('抽屉：坑', drawer, '坑');
  hasEl('抽屉：术语名', getElementById('drawer-title'), '折现率');
  sandbox.TermDrawer.open('不存在的术语');
  has('抽屉：未收录兜底', getElementById('drawer-body').innerHTML, '还没有收录');

  /* ---- 7. 术语标记注入 ---- */
  const marked = sandbox.TermCard.markTerms('看[[discount-rate|折现率]]和[[没有这个词]]。', sandbox.Content.glossary());
  has('术语标记：已知词变锚点', marked, 'data-term="discount-rate"');
  ok('术语标记：未知词不生成假入口', !marked.includes('data-term="没有这个词"'));

  /* ---- 8. index.html 里的每个资源都真实存在 ---- */
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

  // 首屏骨架：静态 HTML 里就撑住版面，路由渲染后被替换
  ok('首屏骨架写在静态 HTML 里', html.includes('首屏骨架'));
  ok('首屏骨架含主标题', html.includes('讲成你听得懂的话'));
  ok('首屏骨架含占位卡', html.includes('class="skel"'));
  ok('渲染后首屏骨架被替换', !view().innerHTML.includes('class="skel"'));

  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^https?:/.test(u) && !u.startsWith('data:'))
    // 业务资源带 ?v= 版本号，校验存在性时把它去掉
    .map((u) => u.split('?')[0]);
  for (const r of refs) {
    ok('index.html 引用存在 ' + r, existsSync(path.join(ROOT, r)));
  }
  // 页面引用的脚本都应被本测试加载过
  for (const s of SCRIPTS) {
    ok('index.html 加载了 ' + s, html.includes(s));
  }
  /* 引擎接线：对比器用到 series + compare，曲线用到 spread，对照仪用到 analogy。
     这四个曾经是「测试在用、页面零引用」的死代码；现在有真实视图引用，必须加载。
     similarity 仍然没有视图引用，继续不进首屏（要用的时候再接）。 */
  for (const used of ['js/engine/series.js', 'js/engine/spread.js',
    'js/engine/analogy.js', 'js/engine/compare.js']) {
    ok('首屏加载被视图引用的 ' + used, html.includes(used));
  }
  ok('仍然没有视图引用的 similarity 留在首屏外', !html.includes('js/engine/similarity.js'));

  /* ---- 9. 站内链接不许有死链 ----
     首页时代横轴曾经有 4 个节点指向不存在的文章（#/crisis/2013、#/cycles/ai-cycle 等），
     点进去只有一句「没找到这篇文章」——最显眼的还是那个「现在」节点。
     这里把全站写死的站内链接都扫一遍：必须能在路由表 / 内容索引 / 术语库 / 产业链清单里解析到。 */
  {
    const routePaths = sandbox.Router.ROUTES.map((r) => r.path);
    const contentIds = new Set(sandbox.Content.list().map((a) => a.section + '/' + a.id));
    const termIds = new Set(Object.keys(sandbox.Content.glossary()));
    const chainIds = new Set((sandbox.INDUSTRY_CHAINS || []).map((c) => c.id));
    const crisisPkgs = new Set(['1987', '1990', '1994', '1998', '2008']);

    /** 一条站内链接能不能解析到真实内容 */
    const resolves = (href) => {
      const p = href.slice(2).split('?')[0].split('#')[0];
      const segs = p.split('/').filter(Boolean);
      if (!segs.length) return true;                                   // 首页
      if (segs.length === 1) return routePaths.indexOf('/' + segs[0]) >= 0;
      const [sec, id] = segs;
      if (sec === 'term') return termIds.has(decodeURIComponent(id));
      if (sec === 'chains') return chainIds.has(id);
      if (sec === 'crisis') return contentIds.has('crisis/' + id) || crisisPkgs.has(id);
      return contentIds.has(sec + '/' + id);
    };

    // 全站写死的站内链接（模板拼出来的 ${...} 静态扫不了，跳过）
    const hrefRe = /(?:href=|href:\s*)['"]([^'"]*)['"]/g;
    let checked = 0;
    for (const f of SCRIPTS.filter((x) => x.startsWith('js/'))) {
      const src = await readFile(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(hrefRe)) {
        const raw = m[1];
        if (!raw.startsWith('#/') || raw.includes('${')) continue;
        checked++;
        ok('站内链接可解析 ' + raw + '（' + f + '）', resolves(raw), '路由表和内容索引里都没有它');
      }
    }
    ok('站内链接扫描覆盖到写死的链接', checked >= 15, '只扫到 ' + checked + ' 条');

    // 时代横轴：每个节点的链接都要能解析
    const eraHrefs = sandbox.EraTimeline.DEFAULT_BANDS.flatMap((b) => b.eras.map((e) => e.href));
    ok('时代横轴有 10 个节点', eraHrefs.length === 10, '实际 ' + eraHrefs.length);
    for (const href of eraHrefs) {
      ok('时代横轴链接可解析 ' + href, resolves(href), '这条点了只会「没找到这篇文章」');
    }
    // 渲染出来的锚点也要一样
    const eraHtml = getElementById('home-era').innerHTML;
    const rendered = [...eraHtml.matchAll(/href="(#\/[^"]+)"/g)].map((m) => m[1]);
    ok('时代横轴渲染出了链接', rendered.length === eraHrefs.length, '实际 ' + rendered.length);
    for (const href of rendered) ok('时代横轴渲染出的链接可解析 ' + href, resolves(href));
  }

  /* ---- 10. 速查表：窄屏没有表头，列名必须带在每个单元格上 ---- */
  {
    const css = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
    ok('速查表：窄屏用 data-label 显示列名', /\.ds td::before\s*\{[^}]*attr\(data-label\)/.test(css));
    for (const c of sandbox.TermView.CATS) {
      sandbox.TermView.renderDataSheet(view(), { cat: c.id });
      const h = view().innerHTML;
      const cols = sandbox.TermView.SHEET_COLS[c.id];
      const tbody = (h.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
      const labels = [...tbody.matchAll(/data-label="([^"]*)"/g)].map((m) => m[1]);
      ok('速查表 ' + c.id + '：每个单元格都带列名', labels.length > 0 && labels.length % 3 === 0,
        '扫到 ' + labels.length + ' 个 data-label');
      ok('速查表 ' + c.id + '：列名等于该分类的列标题',
        cols.every((col) => labels.includes(col)) && labels.every((l, i) => l === cols[i % 3]),
        '表头 ' + cols.join(' / ') + '，单元格 ' + [...new Set(labels)].join(' / '));
    }
  }

  /* ---- 11. 回放器：停掉之后必须彻底退出（不然方向键会在别的页面被吞） ---- */
  {
    const p = await sandbox.History.crisis('1987');
    ok('危机包可加载 1987（用于生命周期测试）', !!p);
    if (p) {
      sandbox.ReplayPlayer.render(getElementById('replay-life'), p);
      ok('回放器挂上后是激活的', sandbox.ReplayPlayer.isActive() === true);
      sandbox.ReplayPlayer.stop();
      ok('回放器停止后不再激活', sandbox.ReplayPlayer.isActive() === false);
      // 路由把视图整块换掉之后，宿主脱离文档：这时也不算还挂着
      sandbox.ReplayPlayer.render(getElementById('replay-life'), p);
      getElementById('replay-life').isConnected = false;
      ok('宿主脱离文档后不再激活', sandbox.ReplayPlayer.isActive() === false);
      ok('宿主脱离文档后方向键不再被拦截', (() => {
        let prevented = false;
        sandbox.ReplayPlayer.onKey({ key: 'ArrowRight', target: { tagName: 'BODY' }, preventDefault() { prevented = true; } });
        return !prevented;
      })());
    }
  }

  /* ---- 12. 今日一词：同一天必须是同一个词 ---- */
  {
    const ids = Object.keys(sandbox.Content.glossary());
    const d1 = new Date(2026, 9, 21);
    ok('今日一词：取词逻辑是纯函数', typeof sandbox.HomeView.pickTodayTerm === 'function');
    ok('今日一词：同一天取到同一个词',
      sandbox.HomeView.pickTodayTerm(ids, d1) === sandbox.HomeView.pickTodayTerm(ids, d1));
    ok('今日一词：取到的词在术语库里', ids.indexOf(sandbox.HomeView.pickTodayTerm(ids, d1)) >= 0);
    // 连着渲染两次，读者看到的词不能变
    sandbox.HomeView.render(view());
    const homeA = view().innerHTML;
    sandbox.HomeView.render(view());
    const homeB = view().innerHTML;
    ok('首页：两次渲染结果一致（今日一词不会在眼前自己换）', homeA === homeB);
    const titleOf = (h) => (h.match(/class="tt">([^<]*)</) || [])[1] || '';
    ok('首页：今日一词两次渲染是同一个词', !!titleOf(homeA) && titleOf(homeA) === titleOf(homeB),
      titleOf(homeA) + ' vs ' + titleOf(homeB));
    // 「第 N 天」按当年算，不能写死某一年
    ok('首页：第 N 天按当前年份算', sandbox.HomeView.dayOfYear(new Date(2027, 0, 1)) === 1
      && sandbox.HomeView.dayOfYear(new Date(2026, 0, 1)) === 1
      && sandbox.HomeView.dayOfYear(new Date(2026, 11, 31)) === 365);
  }

  /* ---- 13. 危机空态：说了「回放数据已经有了」就得真挂上回放器 ---- */
  {
    await sandbox.CrisisView.renderDetail(view(), '2013');   // 没有这一篇复盘
    const h = view().innerHTML;
    has('危机空态：写明还没写', h, '这场复盘还没写');
    ok('危机空态：回放器容器还在', h.includes('id="crisis-replay"'));
  }

  /* ---- 14. 抽屉：关着时必须退出可聚焦序列 ---- */
  {
    const css = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
    ok('抽屉：关着时 visibility:hidden', /\.drawer\s*\{[^}]*visibility:\s*hidden/.test(css));
    const drawerEl = getElementById('drawer');
    sandbox.TermDrawer.init();
    sandbox.TermDrawer.close();          // 先确保是关着的状态
    ok('抽屉关着时没有 role=dialog', drawerEl.getAttribute('role') !== 'dialog');
    ok('抽屉关着时标记为 inert', drawerEl.getAttribute('inert') !== null);
    sandbox.TermDrawer.open('gold');
    ok('抽屉打开时有 role=dialog', drawerEl.getAttribute('role') === 'dialog');
    ok('抽屉打开时不再是 inert', drawerEl.getAttribute('inert') === null);
    sandbox.TermDrawer.close();
    ok('抽屉关掉后 role=dialog 被摘掉', drawerEl.getAttribute('role') !== 'dialog');
    ok('抽屉关掉后 inert 回来了', drawerEl.getAttribute('inert') !== null);
  }

  /* ---- 15. 文章页：标签配平 + 命中区够大 ---- */
  {
    const css = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
    sandbox.ArticleView.render(view(), 'concepts', 'inflation');
    const h = view().innerHTML;
    const openTag = (h.match(/<section/g) || []).length;
    const closeTag = (h.match(/<\/section>/g) || []).length;
    ok('文章页：section 标签配平', openTag === closeTag, '开 ' + openTag + ' 个，关 ' + closeTag + ' 个');
    ok('文章页：书签按钮命中区 ≥24px', /id="art-bookmark"[^>]*height:24px/.test(h),
      (h.match(/id="art-bookmark"[^>]*/) || [])[0] || '(没找到)');
    ok('开关命中区 ≥24px', /\.switch::before\s*\{[^}]*top:\s*-\d/.test(css));
    ok('回放器刻度命中区 ≥24px', /\.rp-mark::before\s*\{[^}]*top:\s*-\d/.test(css));
  }

  /* ---- 16. 时代横轴：CSS 类名要和 JS 输出对上 ---- */
  {
    const css = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
    const eraSrc = await readFile(path.join(ROOT, 'js/components/era-timeline.js'), 'utf8');
    ok('时代横轴：JS 输出的容器类名有对应的 CSS',
      /\.era-band\s*\{/.test(css) && eraSrc.includes('class="era-band"'));
    ok('时代横轴：没有只写 CSS 不生效的 .era 选择器', !/(^|[^-\w])\.era\s*\{/.test(css));
    ok('时代横轴：提示卡不会再被容器裁掉',
      /\.era-node \.en-tip\s*\{[^}]*--tip-w/.test(css) && /\.panel\.flush\.open\s*\{/.test(css));
  }

  /* ---- 17. 读者路径：新手路径 8 课、搜索结果、首页入口都得真能走 ----
     这几页以前全是「看着像入口、点不动」的地方：
     8 课渲染成 <div>，搜索结果也是 <div>，今日一词是一张读得懂却点不动的卡片。 */
  {
    const glossaryIds = new Set(Object.keys(sandbox.Content.glossary()));
    const contentIds = new Set(sandbox.Content.list().map((a) => a.section + '/' + a.id));

    /* ① 新手路径：每课都有 target，而且 target 真的解析得到 */
    const plan = sandbox.Content.pathPlan();
    ok('新手路径：8 课都有 target',
      !!plan && plan.lessons.length === 8 && plan.lessons.every((l) => !!l.target),
      '没写 target 的课：' + (plan ? plan.lessons.filter((l) => !l.target).map((l) => l.id).join(' ') : '(读不到)'));
    for (const l of (plan ? plan.lessons : [])) {
      const t = String(l.target || '');
      let hit = false;
      const m = /^#\/term\/(.+)$/.exec(t);
      if (m) hit = glossaryIds.has(decodeURIComponent(m[1]));
      const a = /^#\/([^/]+)\/([^/]+)$/.exec(t);
      if (a && a[1] !== 'term') hit = contentIds.has(a[1] + '/' + a[2]);
      ok('新手路径：' + l.id + ' 的 target 解析得到 ' + t, hit, '这个 id 站内不存在');
    }
    // 渲染出来的那一页：整行是链接，打勾按钮在链接外面
    sandbox.PathView.render(view());
    const pathHtml = view().innerHTML;
    const links = [...pathHtml.matchAll(/<a class="entry" href="([^"]+)">/g)].map((m) => m[1]);
    ok('新手路径：8 课都是可点的链接', links.length === 8, '实际 ' + links.length + ' 个');
    for (const href of links) {
      const segs = href.slice(2).split('/').filter(Boolean);
      ok('新手路径：链接能解析 ' + href, !!sandbox.Router.match(segs), '路由表里没有这条');
    }
    const anchors = [...pathHtml.matchAll(/<a class="entry"[\s\S]*?<\/a>/g)].map((m) => m[0]);
    ok('新手路径：打勾按钮不在链接里面（链接里套按钮是无效 HTML）',
      anchors.length === 8 && anchors.every((h) => h.indexOf('data-lesson') < 0));
    ok('新手路径：打勾按钮有 aria-label', (pathHtml.match(/aria-label="[^"]*已学[^"]*"/g) || []).length === 8,
      '实际 ' + (pathHtml.match(/aria-label="[^"]*已学[^"]*"/g) || []).length + ' 个');
    ok('新手路径：打勾按钮是状态按钮（aria-pressed）', (pathHtml.match(/aria-pressed="/g) || []).length === 8);

    /* ② 搜索：命中与排序（读者第一眼看到的必须是最准的那条） */
    const S = sandbox.SearchView.search;
    const first = (q) => { const r = S(q); return r.terms[0] || null; };
    const firstAsset = (q) => { const r = S(q); return r.assets[0] || null; };

    ok('搜「市盈率」：第一条就是市盈率', !!first('市盈率') && first('市盈率').id === 'pe-ratio',
      '实际 ' + (first('市盈率') || {}).term);
    ok('搜「PE」：第一条就是市盈率', !!first('PE') && first('PE').id === 'pe-ratio',
      '实际 ' + (first('PE') || {}).term);
    ok('搜「RSI」：第一条就是 RSI 相对强弱指标', !!first('RSI') && first('RSI').id === 'rsi',
      '实际 ' + (first('RSI') || {}).term);
    ok('搜「ETF」：第一条就是 ETF', !!first('ETF') && first('ETF').id === 'etf',
      '实际 ' + (first('ETF') || {}).term);
    ok('搜「基金」：第一条是基金类词，不是噪音', !!first('基金') && first('基金').term.indexOf('基金') >= 0,
      '实际 ' + (first('基金') || {}).term);
    ok('搜「降息」：搜得到（口语黑话在词条的关键词里）', first('降息') !== null);

    ok('搜「600519」：第一条是贵州茅台', !!firstAsset('600519') && firstAsset('600519').symbol === 'sh600519',
      '实际 ' + JSON.stringify(firstAsset('600519')));
    ok('搜「00700」：第一条是腾讯控股', !!firstAsset('00700') && firstAsset('00700').symbol === 'hk00700');
    ok('搜「AAPL」：第一条是苹果', !!firstAsset('AAPL') && firstAsset('AAPL').symbol === 'usAAPL');
    ok('搜「NVDA」：第一条是英伟达', !!firstAsset('NVDA') && firstAsset('NVDA').symbol === 'usNVDA');
    ok('搜「sh600519」：站内 id 也搜得到', !!firstAsset('sh600519'));
    const icbc = S('工商银行');
    ok('搜「工商银行」：A 股与港股两只都搜得到', icbc.assets.length >= 2,
      '实际 ' + icbc.assets.length + ' 只');
    ok('搜「工商银行」：A 股那只排前面（601398）',
      !!icbc.assets[0] && icbc.assets[0].code === '601398',
      '实际 ' + JSON.stringify(icbc.assets[0] || {}));
    // 代码前缀：读者只记得住前几位
    ok('搜「60051」：代码前缀也找得到', S('60051').assets.length >= 1);

    /* ③ 搜索结果必须是真链接（以前是 div，读者以为页面坏了） */
    sandbox.SearchView.render(view(), '市盈率');
    const sh = view().innerHTML;
    ok('搜索结果：术语是可分享的词条页链接', sh.includes('href="#/term/pe-ratio"'));
    ok('搜索结果：不再走抽屉（data-term-go 全部去掉）', sh.indexOf('data-term-go') < 0);
    ok('搜索结果：没有点不动的 div 条目', !/<div class="entry"/.test(sh));
    sandbox.SearchView.render(view(), '600519');
    const ah = view().innerHTML;
    ok('搜索结果：标的是标的页链接', ah.includes('href="#/assets/sh600519"'));
    ok('搜索结果：标的结果没有点不动的 div 条目', !/<div class="entry"/.test(ah));
    // 渲染出来的每一条站内链接都得能被路由解析
    for (const q of ['市盈率', '600519', '工商银行', '降息', 'ETF', '黄金']) {
      sandbox.SearchView.render(view(), q);
      const hrefs = [...view().innerHTML.matchAll(/href="(#\/[^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) {
        const segs = href.slice(2).split('/').filter(Boolean);
        ok('搜索「' + q + '」的链接可解析 ' + href, !!sandbox.Router.match(segs), '路由表里没有这条');
      }
    }
    // 搜不到时给一条诚实的出路
    sandbox.SearchView.render(view(), '不存在的词xyz');
    ok('搜索无结果：指向新手路径', view().innerHTML.includes('href="#/path"'));
    ok('搜索无结果：说清还没有这个词', view().innerHTML.includes('还没有这个词'));

    /* ④ 首页：今日一词能点，家庭理财有入口 */
    sandbox.HomeView.render(view());
    const home = view().innerHTML;
    ok('首页：今日一词是可点的词条页链接', /<a class="term-link" href="#\/term\/[^"]+"/.test(home));
    ok('首页：家庭理财直接链到那一篇文章', home.includes('href="#/family/money-jar"'),
      '首页没有家庭理财的入口');
    ok('首页：家庭理财链到的是真文章', contentIds.has('family/money-jar'));

    /* ⑤ 速查表：窄屏保住表格语义（表头视觉隐藏 + 每格带 aria-label） */
    const css = await readFile(path.join(ROOT, 'css/components.css'), 'utf8');
    ok('速查表：窄屏不再 display:none 掉表头', !/\.ds thead\s*\{\s*display:\s*none/.test(css));
    ok('速查表：窄屏表头改成视觉隐藏', /\.ds thead\s*\{[^}]*clip-path:\s*inset\(50%\)/.test(css));
    sandbox.TermView.renderDataSheet(view(), { cat: 'macro' });
    const sheet = view().innerHTML;
    const tds = [...sheet.matchAll(/<td[^>]*>/g)].map((m) => m[0]);
    ok('速查表：每个单元格都带 aria-label', tds.length > 0 && tds.every((t) => t.indexOf('aria-label="') >= 0),
      '实际 ' + tds.length + ' 个 td');
    ok('速查表：aria-label 以本列的列名开头', tds.every((t) => {
      const dl = (t.match(/data-label="([^"]*)"/) || [])[1] || '';
      const al = (t.match(/aria-label="([^"]*)"/) || [])[1] || '';
      return !!dl && al.indexOf(dl + '：') === 0;
    }), tds[0] || '(没扫到 td)');

    /* ⑥ 免责声明：写作指南要求「文首、文末、每页页脚」三处。
       以前只有文章页、危机页、词条页有，索引 / 标的 / 产业链页一个都没有。 */
    const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
    ok('全站页脚存在', html.includes('<footer class="footer">'));
    ok('全站页脚写了不构成投资建议', /不构成投资建议/.test(html));
    ok('全站页脚写了不预测市场', /不预测市场走势/.test(html));

    sandbox.HomeView.render(view());
    has('首页：有免责声明', view().innerHTML, 'class="disclaimer"');
    sandbox.ListView.render(view(), 'concepts');
    has('栏目索引：有免责声明', view().innerHTML, 'class="disclaimer"');
    sandbox.AssetsView.renderIndex(view());
    has('标的索引：有免责声明', view().innerHTML, 'class="disclaimer"');
    await sandbox.AssetsView.renderDetail(view(), 'usAAPL');
    has('标的详情：有免责声明', view().innerHTML, 'class="disclaimer"');
    sandbox.ChainView.renderList(view());
    has('产业链列表：有免责声明', view().innerHTML, 'class="disclaimer"');
    await sandbox.ChainView.renderDetail(view(), 'ai');
    has('产业链详情：有免责声明', view().innerHTML, 'class="disclaimer"');
  }

  console.log('');
  console.log(`渲染测试：通过 ${pass} 条，失败 ${fail} 条`);
  if (failures.length) {
    console.log('');
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('渲染测试崩溃：', e); process.exit(1); });
