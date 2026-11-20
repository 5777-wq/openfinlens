/* engine/event-engine.js —— 把"新闻"变成"事件"
   聚类策略（规则优先，AI 不参与主路径）：
     1. 地理桶：20° 网格（同桶=可能同事件；无坐标新闻归 'global' 桶）
     2. 类别细分：同桶内再按 category 分组（加息和地震不该是一件事）
     3. 时间窗：窗内两两标题相似度 ≥ TITLE_JACCARD 才合并（union-find 合并传递簇）
     4. 每簇产出 Event：标题取权威源最长标题，severity=类别基线×来源数加成，
        confidence 随独立来源数上升；timeline 按时间排列
   依赖：EngineTypes、EngineGeo、NewsEngine。node 可测。 */

/* global EngineTypes, EngineGeo, NewsEngine */

const EventEngine = (() => {
  const { CATEGORY_SEVERITY, TOP_SOURCES, STATUS_UPDATING_H, STATUS_RESOLVED_H, CLUSTER } = EngineTypes;

  /** 相似度缓存 key（无状态调用间不共享，一次聚类内共享） */
  function cluster(newsItems, now, opts) {
    const opt = Object.assign({}, CLUSTER, opts || {});
    const nowMs = now || Date.now();
    const items = (newsItems || []).slice().sort((a, b) => a.publishedAt - b.publishedAt);
    const winMs = opt.TIME_WINDOW_H * 3600 * 1000;

    /* 1. 分桶：地理网格 + 类别（阶段一），global 兜底桶走相似度 */
    const buckets = new Map();
    items.forEach((n, idx) => {
      const lat = n.lat != null ? n.lat : null, lng = n.lng != null ? n.lng : null;
      const grid = lat == null ? 'global'
        : Math.floor(lat / opt.GRID_DEG) + ':' + Math.floor(lng / opt.GRID_DEG);
      const key = grid + '|' + n.category;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(idx);
    });

    /* 2. 桶内合并：
       - 地理桶：同格同类 + 时间窗内 → 合并，但同语言对要求标题相似度 ≥ GEO_TITLE_MIN
         （WM DomainAdapter 的 geographic 模式：空间+时间为主，措辞差异大不阻断；
         下限只拦"词面零交集"的同语言两件事——空袭和换俘同格同类同窗时曾被揉成一团。
         跨语言对（日经中文稿+路透英文稿报同一央行决议）词面必然零交集，不下限，
         保持空间+时间合并语义。实测同事件中文 0.13/英文 0.33，异事件 ≤0.08）
       - global 桶：无地理约束，必须标题相似度达标（否则全世界快讯会糊成一团） */
    const parent = items.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
    const scriptOf = (t) => {
      const s = String(t || '');
      const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
      return cjk * 2 >= s.replace(/\s+/g, '').length ? 'cjk' : 'latin';
    };

    for (const [key, members] of buckets) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = items[members[i]], b = items[members[j]];
          if (Math.abs(a.publishedAt - b.publishedAt) > winMs) continue;
          if (key.startsWith('global|')) {
            if (NewsEngine.titleSimilarity(a.title, b.title) >= opt.TITLE_JACCARD) union(members[i], members[j]);
          } else {
            const sameLang = scriptOf(a.title) === scriptOf(b.title);
            const sim = sameLang ? NewsEngine.titleSimilarity(a.title, b.title) : 1;
            if (sim >= opt.GEO_TITLE_MIN) union(members[i], members[j]);
          }
        }
      }
    }

    /* 2.5 市场跟随吸附：markets/energy/commodities 类的簇，若国家与某个
       非市场簇重合且时间窗重叠 → 并入该簇（油市反应天然属于地缘事件）。 */
    const FOLLOW_CATS = new Set(['markets', 'energy', 'commodities']);
    const groupsByRoot = new Map();
    items.forEach((n, i) => {
      const r = find(i);
      if (!groupsByRoot.has(r)) groupsByRoot.set(r, []);
      groupsByRoot.get(r).push({ n, i });
    });
    const info = (r) => {
      const g = groupsByRoot.get(r);
      return {
        countries: new Set(g.map(x => x.n.country).filter(Boolean)),
        cat: g[0].n.category,
        minT: Math.min(...g.map(x => x.n.publishedAt)),
        maxT: Math.max(...g.map(x => x.n.publishedAt)),
      };
    };
    for (const r of [...groupsByRoot.keys()]) {
      const me = info(r);
      if (!FOLLOW_CATS.has(me.cat) || !me.countries.size) continue;
      let best = null, bestMaxT = -1;
      for (const other of groupsByRoot.keys()) {
        if (find(other) === find(r)) continue;
        const oi = info(other);
        if (FOLLOW_CATS.has(oi.cat) || !oi.countries.size) continue;
        if (![...me.countries].some(c => oi.countries.has(c))) continue;
        // 市场报道常发生在事件之后（不与事件时间区间重叠），允许"间隔 ≤ 窗"
        const gap = Math.max(me.minT - oi.maxT, oi.minT - me.maxT);
        if (gap > winMs) continue;
        if (oi.maxT > bestMaxT) { best = other; bestMaxT = oi.maxT; }
      }
      if (best !== null) union(r, best);
    }

    /* 3. 簇 → Event */
    const groups = new Map();
    items.forEach((_, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    });

    const events = [];
    for (const members of groups.values()) {
      const ns = members.map(i => items[i]).sort((a, b) => a.publishedAt - b.publishedAt);
      const createdAt = ns[0].publishedAt;
      const updatedAt = ns[ns.length - 1].publishedAt;
      const sources = [...new Set(ns.map(n => n.source))];
      const countries = [...new Set(ns.map(n => n.country).filter(Boolean))];
      const categories = [...new Set(ns.map(n => n.category))];
      const withGeo = ns.find(n => n.lat != null);

      /* 标题：权威源优先，其次最长（信息量） */
      let title = ns[0].title;
      for (const n of ns) {
        if (TOP_SOURCES.test(n.source)) { title = n.title; break; }
        if (n.title.length > title.length) title = n.title;
      }

      const base = CATEGORY_SEVERITY[ns[0].category] || 45;
      const freshness = Math.max(0, 1 - (nowMs - updatedAt) / (7 * 24 * 3600 * 1000));
      const severity = Math.min(100, Math.round(base + Math.min(18, (ns.length - 1) * 6)
        + (TOP_SOURCES.test(ns[0].source) ? 8 : 0) + freshness * 8));
      const confidence = Math.min(1, +(0.4 + 0.18 * (sources.length - 1) + 0.04 * (ns.length - 1)).toFixed(2));

      const ageMs = nowMs - updatedAt;
      const status = ageMs <= STATUS_UPDATING_H * 3600 * 1000 ? 'updating'
        : ageMs <= STATUS_RESOLVED_H * 3600 * 1000 ? 'active' : 'resolved';

      events.push({
        id: 'EV' + NewsEngine.hash(ns.map(n => n.id).join(',')),
        title,
        createdAt, updatedAt,
        location: withGeo ? { lat: withGeo.lat, lng: withGeo.lng } : null,
        countries,
        categories,
        entities: [],
        severity,
        confidence,
        status,
        relatedAssets: [],
        newsIds: ns.map(n => n.id),
        timeline: ns.map(n => ({ t: n.publishedAt, kind: 'news', note: n.title, newsId: n.id })),
      });
    }

    /* 严重度降序（地图/面板默认顺序） */
    return events.sort((a, b) => b.severity - a.severity || b.updatedAt - a.updatedAt);
  }

  /**
   * AI 闸门：只有"低置信或高严重且来源不足"的事件值得调模型（WM 三闸门思想）。
   * @param {Event} ev
   * @returns {boolean}
   */
  function needsAiReview(ev) {
    return ev.confidence < 0.5
      || (ev.severity >= EngineTypes.AI_SCORE_THRESHOLD && ev.newsIds.length < 3);
  }

  return { cluster, needsAiReview };
})();

if (typeof window !== 'undefined') window.EventEngine = EventEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = EventEngine;
