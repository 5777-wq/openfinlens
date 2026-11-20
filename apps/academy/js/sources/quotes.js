/* sources/quotes.js —— 实时行情（东财批量接口，免密钥 CORS 直连）
   主源失败 → localStorage 缓存 → 标注"降级"角标，绝不白屏 */
(function () {
  'use strict';

  const HOST = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
  const CACHE_KEY = 'ofa_quotes_cache';

  /** 报价条关注的品种（secid 与 OpenFinLens 的 universe 同源）
      ⚠ 东财的 secid 叫「100.NDX」，但它**返回的是纳斯达克综合指数**（与腾讯源 usIXIC
      在 234 个重叠交易日里数值一致到 ±0.27% 以内；真正的纳指100 应高 4—5%）。
      所以这里的 key 与名称一律写综合指数，别再标成「纳斯达克100」。 */
  const INSTRUMENTS = [
    { secid: '1.000001',  key: 'sh000001',  name: '上证指数',   digits: 2, unit: '' },
    { secid: '0.399001',  key: 'sz399001',  name: '深证成指',   digits: 2, unit: '' },
    { secid: '100.NDX',   key: 'usIXIC',    name: '纳斯达克综合指数', digits: 2, unit: '' },
    { secid: '100.SPX',   key: 'usINX',     name: '标普500',    digits: 2, unit: '' },
    { secid: '101.GC00Y', key: 'EM:101.GC00Y', name: 'COMEX黄金', digits: 1, unit: '美元/盎司' },
    { secid: '102.CL00Y', key: 'EM:102.CL00Y', name: 'NYMEX原油', digits: 2, unit: '美元/桶' },
    { secid: '171.US10Y', key: 'EM:171.US10Y', name: '美债10Y',  digits: 2, unit: '%' },
    { secid: '171.CN10Y', key: 'EM:171.CN10Y', name: '中债10Y',  digits: 2, unit: '%' },
    { secid: '100.UDI',   key: 'EM:100.UDI',   name: '美元指数', digits: 2, unit: '' },
    { secid: '119.EURUSD', key: 'EM:119.EURUSD', name: '欧元美元', digits: 4, unit: '' },
  ];

  const state = { quotes: new Map(), updatedAt: 0, degraded: false, fromCache: false, source: '' };

  function cachePut(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
  }
  function cacheGet() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function buildUrl(list) {
    const secids = list.map((x) => x.secid).join(',');
    const u = new URL(HOST);
    u.searchParams.set('fields', 'f1,f2,f3,f4,f12,f13,f14');
    u.searchParams.set('secids', secids);
    return u.toString();
  }

  function parseJson(j, list) {
    const diff = (j && j.data && j.data.diff) || [];
    const out = [];
    diff.forEach((d) => {
      const meta = list.find((x) => x.secid === `${d.f13}.${d.f12}`);
      if (!meta) return;
      const scale = Math.pow(10, d.f1);
      const price = d.f2 === undefined ? null : d.f2 / scale;
      const chg = d.f4 === undefined ? null : d.f4 / scale;
      const pct = d.f3 === undefined ? null : d.f3 / 100;
      out.push({
        key: meta.key, secid: meta.secid, name: meta.name,
        price, chg, pct, digits: meta.digits, unit: meta.unit,
      });
    });
    return out;
  }

  async function fetchQuotes(list) {
    const url = buildUrl(list);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await window.SafeNet.fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return parseJson(await res.json(), list);
    } finally { clearTimeout(timer); }
  }

  /** 拉取全部报价；失败走缓存 */
  async function load() {
    try {
      const rows = await fetchQuotes(INSTRUMENTS);
      if (rows.length) {
        rows.forEach((r) => state.quotes.set(r.key, r));
        state.updatedAt = Date.now();
        state.degraded = false;
        state.fromCache = false;
        state.source = '东方财富';
        cachePut({ at: state.updatedAt, rows });
        return state;
      }
      throw new Error('空响应');
    } catch (e) {
      const c = cacheGet();
      if (c && c.rows && c.rows.length) {
        c.rows.forEach((r) => state.quotes.set(r.key, r));
        state.updatedAt = c.at;
        state.degraded = true;
        state.fromCache = true;
        state.source = '本地缓存';
      } else {
        state.degraded = true;
        state.fromCache = false;
        state.source = '不可用';
      }
      return state;
    }
  }

  function get(key) { return state.quotes.get(key) || null; }
  function all() { return Array.from(state.quotes.values()); }

  /** 行情新鲜度：给页面上「来源 xxx · ?」那一行用。
      「降级：缓存数据」原来在**根本没有缓存**时也写出来——那是句假话。
      现在只有真的读到本地缓存才说缓存，否则直说「暂时连不上」。 */
  function freshness() {
    if (state.fromCache) return '缓存数据';
    if (state.degraded) return '暂时连不上';
    return '实时';
  }

  window.Quotes = { INSTRUMENTS, load, get, all, state, freshness };
})();
