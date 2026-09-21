/* events.js —— 全球事件数据模型（纯函数，无 DOM / 无网络，可直接单测）
   GlobalEvent 统一结构（前端与采集脚本共用同一份定义）：
   { id, type, title, source, sourceUrl, publishedAt(ms), lat, lng, country,
     importance: 'high'|'med'|'low', relatedSymbols: [内部 symbol] }
   铁律：拿不到的坐标就是 null（列表可见、地球上不画点），绝不编造位置；
   relatedSymbols 只做"标题里明确提到"的映射，不做因果推断。 */

const Events = (() => {

  /* 事件类型 → 终端配色（少量颜色帮分类识别，不搞几十色） */
  const TYPE_META = {
    central_bank: { label: '央行', color: '#5b8def' },
    policy:       { label: '政策', color: '#5b8def' },
    macro:        { label: '宏观', color: '#e0a83c' },
    trade:        { label: '贸易', color: '#D97757' },
    conflict:     { label: '冲突', color: '#e05252' },
    geopolitics:  { label: '地缘', color: '#8a93a6' },
    market:       { label: '市场', color: '#b06ad4' },
    company:      { label: '公司', color: '#4db6ac' },
    disaster:     { label: '灾害', color: '#c97b4a' },
  };

  /* relatedSymbols 字符串 / 标题关键词 → 看板内部 symbol（只映射真实存在的标的） */
  const SYMBOL_ALIASES = [
    { re: /\b(s&p\s*500|spx|sp500)\b/i, sym: 'usINX' },
    { re: /\b(nasdaq|ndx|ixic)\b/i, sym: 'usIXIC' },
    { re: /\b(dow|dji)\b/i, sym: 'usDJI' },
    { re: /\b(hang\s*seng|hsi)\b/i, sym: 'hkHSI' },
    { re: /\b(shanghai\s*composite|sse\s*composite|shcomp)\b|上证指数/i, sym: 'sh000001' },
    { re: /\b(bitcoin|btc)\b/i, sym: 'BTCUSDT' },
    { re: /\b(ethereum|eth)\b/i, sym: 'ETHUSDT' },
    { re: /\b(usdcnh|usdcny|yuan|renminbi)\b|人民币/i, sym: 'EM:133.USDCNH' },
    { re: /\b(gold|xau)\b/i, sym: 'EM:101.GC00Y' },
    { re: /\b(crude|wti|brent|oil\s*price)\b/i, sym: 'EM:102.CL00Y' },
    { re: /\b(10\s*-?\s*year|treasury\s*yield|us10y)\b/i, sym: 'EM:171.US10Y' },
  ];
  // 国家级关联（仅三个有对应指数的市场；标题明确提到国家才挂，不做推断）。
  // US 缩写走大小写敏感校验（与 geo.js 同款教训）：/i 的 \bus\b 会命中小写代词
  // us（"give us a warning"）；带点缩写 u.s. 无歧义，留在 /i 部分。
  const COUNTRY_ALIASES = [
    { re: /\b(china|chinese|beijing|prc)\b/i, sym: 'sh000001' },
    { re: /\b(u\.s|united states|america|washington)\b/i, cs: /\bUS\b|\bUSA\b/, sym: 'usINX' },
    { re: /\b(hong kong)\b/i, sym: 'hkHSI' },
  ];

  function matchSymbols(text) {
    const s = String(text || '');
    if (!s) return [];
    const out = new Set();
    SYMBOL_ALIASES.forEach(a => { if (a.re.test(s)) out.add(a.sym); });
    COUNTRY_ALIASES.forEach(a => { if (a.cs ? (a.cs.test(s) || a.re.test(s)) : a.re.test(s)) out.add(a.sym); });
    return Array.from(out);
  }

  function resolveRelated(list) {
    return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
  }

  /* 标题去重键：小写 + 去符号 + 前 10 词 + 全部数字。
     前 8 词曾把"词尾不同"的两条新闻并成一条（"…despite OPEC cuts" vs
     "…despite OPEC output boost" 第 9-10 词才分岔）；数字后缀兜住更长的标题——
     加息 25 还是 50、伤亡 10 还是 100，数字不同就不是同一件事。 */
  function dedupeKey(title) {
    const norm = String(title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
    if (!norm) return '';
    const words = norm.split(/\s+/);
    const nums = [...new Set(words.filter(w => /^\d+$/.test(w)))].sort().join(',');
    return words.slice(0, 10).join(' ') + '|' + nums;
  }

  /* ISO / 'YYYYMMDDTHHMMSSZ' → ms；解析失败返回 null（绝不返回 NaN） */
  function toMs(t) {
    if (t === null || t === undefined || t === '') return null;
    if (typeof t === 'number') return isFinite(t) ? t : null;
    const s = String(t);
    if (/^\d{8}T\d{6}Z$/.test(s)) {
      const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
      const h = +s.slice(9, 11), mi = +s.slice(11, 13), se = +s.slice(13, 15);
      return Date.UTC(y, mo - 1, d, h, mi, se);
    }
    const ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
  }

  /* 'YYYY-MM-DD'（UTC 日期）——日K marker 对齐用 */
  function dayOf(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }

  /* 宏观主体 → 相关资产（spec: AssetRelation）。映射是"相关"不是"因果"，
     一律标 RELATED，UI 与直接提及分开渲染。只映射看板里真实存在的标的。 */
  const ENTITY_MAP = [
    { re: /\b(fed|fomc|federal reserve|powell)\b/i, syms: ['usINX', 'usIXIC', 'usDJI', 'EM:171.US10Y', 'EM:101.GC00Y', 'BTCUSDT'] },
    { re: /\b(ecb|european central bank|lagarde)\b/i, syms: ['EM:119.EURUSD'] },
    { re: /\b(pboc|people'?s bank of china)\b/i, syms: ['sh000001', 'EM:133.USDCNH'] },
    { re: /\b(boj|bank of japan)\b/i, syms: [] },
    { re: /\bopec\b/i, syms: ['EM:102.CL00Y'] },
    { re: /\btariff(s)?\b/i, syms: ['sh000001', 'EM:133.USDCNH'] },
  ];

  function matchRelated(text) {
    const s = String(text || '');
    const out = [];
    ENTITY_MAP.forEach(e => { if (e.re.test(s)) e.syms.forEach(sym => { if (!out.includes(sym)) out.push(sym); }); });
    return out.map(sym => ({ sym, rel: 'RELATED' }));
  }

  /* 清洗 + 去重 + 按时间倒序。无效坐标置 null，不猜测。 */
  function normalize(rawList, cap = 260) {
    const seen = new Set();
    const out = [];
    (Array.isArray(rawList) ? rawList : []).forEach(raw => {
      if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return;
      const publishedAt = toMs(raw.publishedAt);
      if (publishedAt === null) return;
      const key = dedupeKey(raw.title);
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      // 注意 +null === 0：字面 null 必须显式排除，否则"无坐标"会被算成 (0,0) 落在 Null Island
      const hasGeo = raw.lat !== null && raw.lat !== undefined && raw.lat !== '' &&
        raw.lng !== null && raw.lng !== undefined && raw.lng !== '';
      const lat = hasGeo && isFinite(+raw.lat) ? +raw.lat : null;
      const lng = hasGeo && isFinite(+raw.lng) ? +raw.lng : null;
      out.push({
        id: typeof raw.id === 'string' && raw.id ? raw.id : key + '|' + publishedAt,
        type: TYPE_META[raw.type] ? raw.type : 'market',
        title: raw.title.trim(),
        source: typeof raw.source === 'string' ? raw.source : '',
        sourceUrl: /^https?:\/\//i.test(raw.sourceUrl || '') ? raw.sourceUrl : '',
        publishedAt,
        lat, lng,
        country: typeof raw.country === 'string' ? raw.country : null,
        importance: ['high', 'med', 'low'].includes(raw.importance) ? raw.importance : 'med',
        relatedSymbols: resolveRelated(raw.relatedSymbols).concat(
          matchSymbols(raw.title + ' ' + (raw.extra || ''))),
        // 宏观映射（RELATED）：采集层已给的直接采信，否则按标题现算
        relatedAssets: Array.isArray(raw.relatedAssets) && raw.relatedAssets.length
          ? raw.relatedAssets.filter(x => x && typeof x.sym === 'string')
          : matchRelated(raw.title),
      });
    });
    out.sort((a, b) => b.publishedAt - a.publishedAt);
    return out.slice(0, cap);
  }

  /* 地理聚类：bucketDeg ≤ 0 不聚类。同格合并为一个聚合点，
     count = 事件数，代表事件取重要度最高（并列取最新）。 */
  function cluster(events, bucketDeg) {
    const pts = events.filter(e => e.lat !== null && e.lng !== null);
    if (!bucketDeg || bucketDeg <= 0) {
      return pts.map(e => ({ lat: e.lat, lng: e.lng, count: 1, evs: [e], importance: impRank(e.importance), color: typeColor(e.type) }));
    }
    const b = bucketDeg;
    const grid = new Map();
    pts.forEach(e => {
      const k = Math.round(e.lat / b) + ':' + Math.round(e.lng / b);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
    });
    const out = [];
    grid.forEach(list => {
      list.sort((x, y) => impRank(y.importance) - impRank(x.importance) || y.publishedAt - x.publishedAt);
      const top = list[0];
      out.push({
        lat: top.lat, lng: top.lng, count: list.length, evs: list.slice(0, 12),
        importance: impRank(top.importance), color: typeColor(top.type),
      });
    });
    return out.sort((a, b) => b.count - a.count || b.importance - a.importance);
  }

  function impRank(i) { return i === 'high' ? 3 : i === 'med' ? 2 : 1; }
  function typeColor(t) { return (TYPE_META[t] || TYPE_META.market).color; }
  function typeLabel(t) { return (TYPE_META[t] || TYPE_META.market).label; }

  /* 事件与标的匹配：relatedSymbols 已在 normalize 时解析 */
  function eventsForSymbol(events, symbol) {
    return (events || []).filter(e => e.relatedSymbols.includes(symbol));
  }

  /* K线 marker：日频，时间取 UTC 日期（publishedAt 语义 = 报道见闻时间） */
  function toChartEvent(ev) {
    const time = dayOf(ev.publishedAt);
    if (!time) return null;
    return { time, color: typeColor(ev.type), text: typeLabel(ev.type), ev };
  }

  /* 龙虎榜披露日（上海时区，17:00 后算当日，否则回退到上一个工作日）。
     纯 UTC 数学，不依赖本机时区。 */
  function latestLhbDate(nowMs) {
    const SH = 8 * 3600 * 1000;
    const base = (nowMs === undefined ? Date.now() : nowMs) + SH;
    for (let i = 0; i < 7; i++) {
      const d = new Date(base - i * 86400000);
      const wd = d.getUTCDay();
      if (wd >= 1 && wd <= 5 && (i > 0 || d.getUTCHours() >= 17)) {
        return d.toISOString().slice(0, 10);
      }
    }
    return null;
  }

  /* 数据新鲜度：generatedAt 距今超过 maxAge 视为滞后（UI 显示"滞后"角标，不装实时） */
  function isStale(generatedAtMs, maxAgeMs, nowMs) {
    if (!generatedAtMs) return true;
    return ((nowMs === undefined ? Date.now() : nowMs) - generatedAtMs) > maxAgeMs;
  }

  return { TYPE_META, SYMBOL_ALIASES, ENTITY_MAP, matchSymbols, matchRelated, dedupeKey, toMs, dayOf, normalize,
    cluster, impRank, typeColor, typeLabel, eventsForSymbol, toChartEvent,
    latestLhbDate, isStale };
})();

if (typeof window !== 'undefined') window.Events = Events;
if (typeof module !== 'undefined' && module.exports) module.exports = Events;
