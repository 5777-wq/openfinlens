/* router.js —— 哈希路由（纯静态免构建，浏览器前进后退可用） */
(function () {
  'use strict';

  const ROUTES = [
    { id: 'home',    path: '/',                  title: '首页' },
    { id: 'concepts', path: '/concepts',         title: '货币与利率', section: 'concepts' },
    { id: 'concept',  path: '/concepts/:id',     title: '概念详解' },
    { id: 'crisis',   path: '/crisis',           title: '危机复盘', section: 'crisis' },
    { id: 'crisis-one', path: '/crisis/:id',     title: '危机详情' },
    { id: 'assets',   path: '/assets',           title: '标的百科', section: 'assets' },
    { id: 'asset',    path: '/assets/:id',       title: '标的详情' },
    { id: 'chains',   path: '/chains',           title: '产业链图谱', section: 'chains' },
    { id: 'chain',    path: '/chains/:id',       title: '产业链详情' },
    { id: 'cycles',   path: '/cycles',           title: '周期与镜鉴', section: 'cycles' },
    { id: 'cycle',    path: '/cycles/:id',       title: '周期详情' },
    { id: 'family',   path: '/family',           title: '家庭理财', section: 'family' },
    { id: 'family-one', path: '/family/:id',     title: '家庭理财详情' },
    { id: 'reports',  path: '/reports',          title: '读懂财报', section: 'reports' },
    { id: 'report',   path: '/reports/:id',      title: '财报详解' },
    { id: 'path',     path: '/path',             title: '新手路径' },
    { id: 'terms',    path: '/terms',            title: '术语库' },
    { id: 'data',     path: '/data',             title: '速查表' },
    { id: 'term',     path: '/term/:id',         title: '术语' },
    { id: 'search',   path: '/search',           title: '搜索' },
    { id: 'compare',  path: '/compare',          title: '资产对比' },
    { id: 'curve',    path: '/curve',            title: '收益率曲线' },
    { id: 'analogy',  path: '/analogy',          title: '周期对照' },
    { id: 'calc',     path: '/calc',             title: '理财计算器' },
    { id: 'saved',    path: '/saved',            title: '收藏与阅读记录' },
    { id: 'quiz',     path: '/quiz',             title: '术语自测' },
    { id: 'tag',      path: '/tag/:tag',         title: '标签' },
    { id: 'series',   path: '/series/:id',       title: '序列' },
    { id: 'status',   path: '/status',           title: '数据台账' },
  ];

  const scrollMemo = new Map();

  /** 解码失败时退回原串，不抛。
      hash 是用户可控的（手抄、分享、旧链接），一个没编码完的 % 序列
      会让 decodeURIComponent 抛 URIError——那会冲出 hashchange 处理器，
      导航静默失败，页面停在旧内容。 */
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return String(s); }
  }

  function parse(hash) {
    let h = String(hash || '').replace(/^#/, '') || '/';
    const qIdx = h.indexOf('?');
    let query = {};
    if (qIdx >= 0) {
      const qs = h.slice(qIdx + 1);
      h = h.slice(0, qIdx);
      qs.split('&').forEach((kv) => {
        if (!kv) return;
        const i = kv.indexOf('=');
        const k = safeDecode(i < 0 ? kv : kv.slice(0, i));
        const v = i < 0 ? '' : safeDecode(kv.slice(i + 1).replace(/\+/g, ' '));
        query[k] = v;
      });
    }
    const segs = h.split('/').filter(Boolean);
    return { path: '/' + segs.join('/'), segs, query };
  }

  function match(segs) {
    for (const r of ROUTES) {
      const rp = r.path.split('/').filter(Boolean);
      if (rp.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < rp.length; i++) {
        if (rp[i].startsWith(':')) params[rp[i].slice(1)] = safeDecode(segs[i]);
        else if (rp[i] !== segs[i]) { ok = false; break; }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }

  const listeners = [];

  function current() {
    const loc = parse(location.hash);
    const m = match(loc.segs);
    return m ? Object.assign({ query: loc.query }, m) : null;
  }

  function go(path, opts) {
    const o = opts || {};
    if (o.replace) location.replace('#' + path);
    else location.hash = path;
  }

  function emit() {
    const m = current();
    listeners.forEach((fn) => { try { fn(m); } catch (e) { console.error('[router]', e); } });
  }

  function onRoute(fn) { listeners.push(fn); }

  /** 记住滚动位置，返回时恢复 */
  function stashScroll(key) {
    if (key) scrollMemo.set(key, window.scrollY);
  }
  function restoreScroll(key) {
    if (!key) return;
    const y = scrollMemo.get(key);
    if (y !== undefined) window.scrollTo(0, y);
  }

  window.Router = {
    ROUTES, parse, match, current, go, onRoute, emit,
    stashScroll, restoreScroll, scrollMemo,
  };
})();
