/* site/content.js —— 内容加载（MD 编译产物 data/content/*.json）
   首屏只拉**轻量四件**：index.json（目录）、path.json（新手路径）、asset-ids.json（标的清单）、asset-notes.json（标的短注）。
   术语库 glossary.json（全站最大单项，300KB+）不在首屏并行组里：boot 先画页面，
   术语库挂 requestIdleCallback（无则 setTimeout 0）空闲拉取，消费方按 glossaryLoaded()
   降级（骨架 / 「加载中」提示），数据一到经 onGlossary 自动补上。
   文章正文各自按需拉：打开哪篇才拉哪篇，拉过就缓存。
   标的的维基百科深链（asset-wiki.json）也按需拉：只有标的页会用到。 */
(function () {
  'use strict';

  const BASE = 'data/content/';
  const idx = { list: null, byId: new Map(), articles: new Map(), glossary: null, path: null, assetIds: null, assetNotes: null, assetWiki: null };
  const inflight = new Map();   // id → 正在进行的请求：同一篇别重复拉
  const warned = new Set();     // 已经提醒过的 id：正文没到时别刷屏

  async function loadJSON(path) {
    // 带超时：任何一个请求卡住都不允许让整页空白
    // 用默认缓存（走 HTTP 缓存 + ETag 协商），不要 no-cache：
    // no-cache 会强制每次都回源校验，9 个内容文件就是 9 个额外往返，首屏明显变慢
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await window.SafeNet.fetch(path, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  /* ---------- 术语库：空闲档加载 ----------
     glossaryLoaded：terms 对象**存在**即算就绪——拉失败也按 { terms: {} } 落地，
     所以「未就绪」只发生在还没拉完的窗口里，不会把失败者永远锁在骨架里。
     onGlossary：就绪（含失败落地）后同步回调；否则登记，到点统一叫醒。 */
  let glossaryP = null;
  const glossaryWaiters = [];

  function glossaryLoaded() { return !!(idx.glossary && idx.glossary.terms); }

  function notifyGlossary() {
    const fns = glossaryWaiters.splice(0, glossaryWaiters.length);
    for (const fn of fns) { try { fn(); } catch (e) { console.warn('[content] onGlossary 回调失败', e); } }
  }

  function ensureGlossary() {
    if (idx.glossary) return Promise.resolve(idx.glossary);
    if (!glossaryP) {
      glossaryP = loadJSON(BASE + 'glossary.json')
        .then((j) => { idx.glossary = j || { terms: {} }; notifyGlossary(); return idx.glossary; })
        .catch(() => { idx.glossary = { terms: {} }; notifyGlossary(); return idx.glossary; });
    }
    return glossaryP;
  }

  /** 首屏不背术语库：壳文件就绪后把它排进空闲档 */
  function scheduleGlossary() {
    if (idx.glossary || glossaryP) return;
    const idle = (typeof window.requestIdleCallback === 'function')
      ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
      : (fn) => setTimeout(fn, 0);
    idle(() => { ensureGlossary(); });
  }

  /** 术语库就绪后回调（已就绪则立刻执行）；返回退订函数 */
  function onGlossary(fn) {
    if (typeof fn !== 'function') return () => {};
    if (glossaryLoaded()) { try { fn(); } catch (e) { /* 回调自己的事 */ } return () => {}; }
    glossaryWaiters.push(fn);
    return () => {
      const i = glossaryWaiters.indexOf(fn);
      if (i >= 0) glossaryWaiters.splice(i, 1);
    };
  }

  /** 载入索引 + 三份轻量附属文件（**不含正文、不含术语库**）——boot 首屏等的就是它 */
  async function loadShell() {
    if (!idx.list) {
      const index = await loadJSON(BASE + 'index.json');
      idx.list = index;
      (index.items || []).forEach((it) => idx.byId.set(it.id, it));

      // 三份轻量附属文件互相不依赖，一起拉完，谁先到谁先算。
      // 标的清单（94 个终端标的在本站有对应标的页）：search 要用它们的名字和代码做匹配，
      // 否则「工商银行」「600519」这类词永远搜不到。
      const [path, assetIds, assetNotes] = await Promise.all([
        loadJSON(BASE + 'path.json').catch(() => null),
        loadJSON(BASE + 'asset-ids.json').catch(() => null),
        loadJSON(BASE + 'asset-notes.json').catch(() => null),
      ]);
      idx.path = path;
      idx.assetIds = assetIds;
      idx.assetNotes = assetNotes;
      scheduleGlossary();
    }
    return idx;
  }

  /** 全量加载：壳 + 术语库。await 返回后 glossary() 一定可同步读
      （vm 直跑测试 / status 页用这个契约；浏览器 boot 只等 loadShell）。 */
  async function loadAll() {
    await loadShell();
    await ensureGlossary();
    return idx;
  }

  /**
   * 按需取正文：返回 Promise，拿到的是这一篇的完整内容。
   * 同一篇并发调用只会发一次请求；取过一次就进缓存，之后同步读得到。
   * 取不到（文件不存在 / 网络失败）返回 null，**不抛**——调用方自己决定怎么兜底。
   */
  function ensureArticle(id) {
    const key = String(id || '');
    if (!key) return Promise.resolve(null);
    if (idx.articles.has(key)) return Promise.resolve(idx.articles.get(key));
    if (inflight.has(key)) return inflight.get(key);
    // id 来自路由参数（用户可控），不直接拼进请求路径。
    // 索引还没加载完就先等索引——见 app.js 的 boot，正常情况下这一步不会走。
    if (!idx.list) return loadShell().then(() => ensureArticle(id)).catch(() => null);
    // 用遍历比较而不是 Map.get：请求路径只由 index.json（服务端数据）里的字段拼出，
    // 入参除了参与 === 比较外不进入任何数据流。索引里没有的 id，站内就没有对应文件。
    const items = idx.list.items || [];
    let hit = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === key) { hit = items[i]; break; }
    }
    if (!hit) return Promise.resolve(null);
    const p = loadJSON(BASE + hit.id + '.json')
      .then((full) => {
        idx.articles.set(key, full);
        inflight.delete(key);
        return full;
      })
      .catch((e) => {
        console.warn('[content] 缺正文', key);
        inflight.delete(key);
        return null;
      });
    inflight.set(key, p);
    return p;
  }

  /** 站内标的页清单：[{symbol, label}]（symbol 就是 #/assets/<symbol> 里的那一段） */
  function assetPages() {
    const d = (idx.assetIds && idx.assetIds.detail) || {};
    return Object.keys(d).map((symbol) => ({ symbol, label: d[symbol].label || symbol }));
  }

  function list() { return (idx.list && idx.list.items) || []; }
  function meta(id) { return idx.byId.get(id) || null; }

  /**
   * 同步读正文。
   * 正文还没拉到时退回索引里的那一条（标题、简介都在），
   * 这样「这一篇到底存不存在」仍然答得上来，但**只有标题，没有 body**。
   * 要 body 就先 await ensureArticle(id)。
   */
  function article(id) {
    const full = idx.articles.get(id);
    if (full) return full;
    const m = idx.byId.get(id);
    if (m && !warned.has(id)) {
      warned.add(id);
      console.warn('[content] 正文还没到，article() 只能给索引信息：', id);
    }
    return m || null;
  }

  function glossary() { return (idx.glossary && idx.glossary.terms) || {}; }
  function term(id) { return glossary()[id] || null; }
  function pathPlan() { return idx.path; }

  /** 按栏目分组 */
  function bySection(section) {
    return list().filter((x) => x.section === section);
  }

  /** 标的三段短注（没有专文的标的页用）：symbol → { what, moves, trap } */
  function assetNotes() { return (idx.assetNotes && idx.assetNotes.symbols) || null; }

  /** 标的的维基百科深链：symbol → { zh?, en? }（标题都经 API 确认存在，见 asset-wiki.json 的 note） */
  function assetWiki() { return (idx.assetWiki && idx.assetWiki.symbols) || null; }

  /** 按需拉维基深链表（只有标的页用它，不进首屏预算）：失败按空表处理，页面就不挂链接。 */
  let wikiP = null;
  function ensureWiki() {
    if (idx.assetWiki) return Promise.resolve(idx.assetWiki);
    if (!wikiP) {
      wikiP = loadJSON(BASE + 'asset-wiki.json')
        .then((j) => { idx.assetWiki = j || { symbols: null }; return idx.assetWiki; })
        .catch(() => { idx.assetWiki = { symbols: null }; return idx.assetWiki; });
    }
    return wikiP;
  }

  window.Content = { BASE, loadAll, loadShell, ensureGlossary, glossaryLoaded, onGlossary, ensureArticle, list, meta, article, glossary, term, bySection, pathPlan, assetPages, assetNotes, assetWiki, ensureWiki, idx };
})();
