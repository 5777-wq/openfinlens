/* engine/news-engine.js —— 新闻标准化 / 去重 / 分类 / 地理充实
   纯函数、无 DOM、无网络。依赖：EngineTypes（常量）、EngineGeo（地理编码）。
   node 可测：_test/engine.test.mjs 以 vm 按序加载 types → geo → news-engine。 */

/* global EngineTypes, EngineGeo */

const NewsEngine = (() => {
  const { DEDUPE_JACCARD } = EngineTypes.CLUSTER;

  /* ---------- 基础工具 ---------- */

  /** 稳定字符串 hash（djb2），作 URL 幂等键 */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** 标题词集合（小写、去标点、去停用词、词干化、同义词归并），供 jaccard */
  const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'is', 'are',
    'as', 'at', 'by', 'with', 'after', 'over', 'amid', 'says', 'say', 'new',
    '的', '了', '在', '与', '将', '或', '后', '前', '称', '报', '道']);

  /* 轻量词干化：去复数/动名词后缀（英语新闻跨源措辞差异的主因）。
     -es 只去 s（rates→rate、hikes→hike），保证与单数词干相交——
     旧写法去 es（rates→rat）曾让单复数在 jaccard 里永不相交。 */
  function stem(w) {
    if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('es')) return w.slice(0, -1);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    return w;
  }

  /* 金融/地缘新闻高频同义词组：同组词映射到组代表（首词） */
  const SYNONYM_GROUPS = [
    ['escalate', 'rise', 'surge', 'escalation', 'climb', 'soar'],
    ['fall', 'slide', 'plunge', 'drop', 'decline', 'slump'],
    ['navy', 'naval'],
    ['drill', 'exercise'],
    ['navy_drill', 'gulf_drill'],
    ['stock', 'equity', 'equities', 'stocks'],
    ['global', 'world', 'worldwide'],
    ['oil', 'crude'],
    ['tension', 'standoff'],
  ];
  const SYNONYM_MAP = (() => {
    const m = new Map();
    for (const group of SYNONYM_GROUPS) for (const w of group) m.set(w, group[0]);
    return m;
  })();

  function canon(w) {
    const s = stem(w);
    return SYNONYM_MAP.get(s) || s;
  }

  function tokenize(title) {
    const t = String(title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ');
    const out = new Set();
    for (const w of t.split(/\s+/)) {
      if (!w || STOP.has(w)) continue;
      // CJK 丢单词边界：按双字切分保证中文相似度可比
      if (/[\u4e00-\u9fff]/.test(w) && w.length > 1) {
        for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
      } else if (w.length > 1) {
        out.add(canon(w));
      }
    }
    return out;
  }

  function jaccard(aSet, bSet) {
    if (!aSet.size || !bSet.size) return 0;
    let inter = 0;
    for (const w of aSet) if (bSet.has(w)) inter++;
    return inter / (aSet.size + bSet.size - inter);
  }

  /** 标题相似度（0-1） */
  function titleSimilarity(a, b) {
    return jaccard(tokenize(a), tokenize(b));
  }

  /* ---------- 分类（关键词规则，命中即停，规则序=优先级） ---------- */

  const CATEGORY_RULES = [
    ['war', /开火|空袭|导弹|火箭弹|炮击|入侵|停火协议破裂|宣战|war\b|air ?strikes?|missile strikes?|invasion/i],
    ['natural_disaster', /地震|海啸|台风|飓风|洪水|野火|火山|earthquake|tsunami|hurricane|typhoon|wildfire/i],
    ['central_bank', /央行|中央银行|美联储|FOMC|欧洲央行|日本央行|英格兰银行|加息|降息|利率决议|联邦基金利率|逆回购|存款准备金|powell|central bank|rate hike|rate cut|interest rate/i],
    ['energy', /原油|石油|OPEC|天然气|LNG|油价|减产|输油管|crude oil|natural gas|opec|\boil\b/i],
    ['commodities', /黄金|白银|铜价|铁矿|大豆|小麦|commodity|gold price|silver/i],
    ['trade', /关税|贸易战|贸易谈判|出口管制|制裁|进口配额|tariff|trade war|sanction|export control/i],
    ['markets', /股市|股指|收盘|开盘|暴跌|暴涨|熔断|IPO|债市|汇市|stocks plunge|market rally|selloff/i],
    ['technology', /芯片|半导体|\bAI\b|人工智能|科技公司|反垄断|数据泄露|chip ban|semiconductor|antitrust|data breach/i],
    ['economy', /GDP|CPI|PPI|PMI|失业率|通胀|通缩|衰退|财政|赤字|经济数据|inflation|recession|gdp growth/i],
    ['politics', /大选|选举|总统|首相|内阁|议会|公投|辞职|election|president resign/i],
    ['social', /罢工|抗议|示威|骚乱|罢市|strikes?\b|protest|riot/i],
    ['geopolitics', /地缘|边界|领土|领海|外交|峰会|条约|军事演习|军舰|海军|geopolitic|naval drill|navy|naval|strait|hormuz|diplomat/i],
  ];

  /**
   * 规则分类；无命中给 'markets'（财经快讯的合理兜底，绝不留空）
   * @param {string} title
   * @returns {NewsCategory}
   */
  function classify(title) {
    const t = String(title || '');
    for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
    return 'markets';
  }

  /* ---------- 标准化 ---------- */

  /**
   * 任意来源的一条原始新闻 → 统一 NewsItem
   * @param {{title:string, url:string, source:string, publishedAt:number|string}} raw
   * @returns {NewsItem|null} 无标题/无时间返回 null（宁缺毋假）
   */
  function normalizeNews(raw) {
    if (!raw) return null;
    const title = String(raw.title || '').trim();
    if (!title) return null;
    let ts = raw.publishedAt;
    if (typeof ts === 'string') ts = Date.parse(ts);
    if (!Number.isFinite(ts)) return null;

    const url = String(raw.url || '').trim();
    const source = String(raw.source || '').toLowerCase();
    const geo = EngineGeo.resolveCountry(title);
    /** @type {NewsItem} */
    return {
      // 无 URL 时以「来源+标题」作幂等键：只用标题的话，不同来源的同标题新闻共享 id，
      // 会把事件来源数算少、timeline 出现重复条目
      id: hash(url || (source + '|' + title)),
      title,
      url,
      source,
      publishedAt: ts,
      category: classify(title),
      country: geo ? geo.country : null,
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
    };
  }

  /* ---------- 去重 ---------- */

  /* 两标题的数字集合是否一致。25bp 与 50bp 加息、伤亡 10 人与 100 人，词面高度相似
     但事实不同/递进——数字正是标题的信息量所在，不一致时绝不按相似度合并。 */
  function sameNumbers(a, b) {
    const set = (s) => {
      const m = String(s || '').match(/\d+(?:\.\d+)?/g);
      return m ? [...new Set(m)].sort().join(',') : '';
    };
    return set(a) === set(b);
  }

  /**
   * URL 精确去重 + 标题相似度去重（DEDUPE_JACCARD），保留最早一条（首发源）。
   * @param {NewsItem[]} items  已按 publishedAt 升序更稳；乱序也可（内部处理）
   * @returns {{items:NewsItem[], dropped:number}}
   */
  function dedupeNews(items) {
    const sorted = [...(items || [])].sort((a, b) => a.publishedAt - b.publishedAt);
    const seenUrl = new Set();
    const kept = [];
    let dropped = 0;
    for (const it of sorted) {
      if (it.url && seenUrl.has(it.url)) { dropped++; continue; }
      if (it.url) seenUrl.add(it.url);
      let dup = false;
      for (const k of kept) {
        if (k.country !== null && it.country !== null && k.country !== it.country) continue; // 同国才可能同事件
        if (!sameNumbers(k.title, it.title)) continue;   // 数字不同：不是同一条新闻
        if (titleSimilarity(k.title, it.title) >= (DEDUPE_JACCARD || 0.62)) { dup = true; break; }
      }
      if (dup) { dropped++; continue; }
      kept.push(it);
    }
    return { items: kept, dropped };
  }

  return { hash, tokenize, titleSimilarity, sameNumbers, classify, normalizeNews, dedupeNews, CATEGORY_RULES };
})();

if (typeof window !== 'undefined') window.NewsEngine = NewsEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = NewsEngine;
