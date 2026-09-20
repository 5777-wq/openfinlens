/* polymarket.js —— 预测市场"事件概率"数据模型（纯函数，无 DOM / 无网络，可直接单测）
   前端、采集脚本（_scripts/collect-polymarket.mjs）与离线单测共用同一份定义。

   合规口径（强约束，与 gdelt.js 同级架构约束）：
   - 只接 Polymarket Gamma 公开只读接口，只提取"市场隐含概率"这一个数字（Yes 价格）；
   - 产物不存 slug/URL，前端渲染层不可能外链到交易平台；本站不提供、不引导任何下单功能；
   - 只保留可能影响市场的类别（央行/宏观/贸易/地缘/选举/能源），文体、娱乐、crypto 价格
     类问题在模型层就剔除——白名单闸门 + 黑名单一票否决双保险；
   - 概率是市场定价的隐含值，不是本站预测；展示层必须带"仅供参考"口径标注。

   行结构（采集产物 / 前端共用）：
   { id, question, questionZh(采集端翻译，可 null), category, probability(0~1),
     change24h(百分点), volume24hr, liquidity, endDate(ms|null), updatedAt(ms|null) } */

const Polymarket = (() => {

  /* 类别 → 展示元数据（配色沿用终端盘：央行蓝/宏观金/贸易橙/地缘灰/选举紫/能源棕） */
  const CAT_META = {
    central_bank: { label: '央行',   en: 'Central Banks', color: '#5b8def' },
    macro:        { label: '宏观',   en: 'Macro',         color: '#e0a83c' },
    trade:        { label: '贸易',   en: 'Trade',         color: '#D97757' },
    geopolitics:  { label: '地缘',   en: 'Geopolitics',   color: '#8a93a6' },
    election:     { label: '选举',   en: 'Elections',     color: '#b06ad4' },
    energy:       { label: '能源',   en: 'Energy',        color: '#c97b4a' },
  };

  /* 类别白名单：先后即优先级（美联储的问题常同时挂 Politics 标签，必须先判央行）。
     依次对"标签串"与"标题"匹配；标签命中或标题命中任一即可入榜。 */
  const CAT_RULES = [
    { cat: 'central_bank', re: /\b(fed|fomc|fed rates|federal reserve|jerome powell|interest rates?|rate cuts?|rate hikes?|ecb|european central bank|bank of japan|pboc|people'?s bank of china|monetary policy|central bank)\b/i },
    { cat: 'macro', re: /\b(economy|economic policy|economics|inflation|cpi|jobs report|recession|gdp|unemployment|government shutdown|debt limit|debt ceiling|us debt)\b/i },
    { cat: 'trade', re: /\b(tariffs?|trade war|trade policy|trade deal|import dut)\b/i },
    { cat: 'geopolitics', re: /\b(geopolitics|geo politics|ukraine|russia|israel|iran|gaza|china|taiwan|north korea|middle east|venezuela|nato|nuclear|war|ceasefire|military|defense|sanctions?)\b/i },
    { cat: 'election', re: /\b(politics|us politics|elections?|congress|midterms?|senate|house of representatives|presidential)\b/i },
    { cat: 'energy', re: /\b(oil|opec|crude|natural gas|energy|gasoline)\b/i },
  ];

  /* 黑名单一票否决：文体/娱乐/名人/crypto 价格/社媒杂谈。白名单已拦掉大头，
     这里拦"挂了 Politics 之类宽标签的杂题"（如"Trump 本周会不会发帖"）。 */
  const BLACKLIST_RE = /\b(nfl|nba|mlb|nhl|ufc|wwe|fifa|uefa|premier league|la liga|serie a|bundesliga|mls|cricket|formula 1|grand prix|nascar|olympics?|wimbledon|us open|french open|australian open|super bowl|world cup|champions league|europa league|fa cup|copa america|grand slam|boxing|oscar|academy award|grammy|emmy|golden globe|eurovision|album|box office|met gala|celebrit|kardashian|taylor swift|nobel prize|bitcoin|btc|ethereum|eth price|solana|xrp|dogecoin|memecoin|stablecoin|crypto|tweets?|truth social|post on|posting on|posts? a (photo|video|statement)|time person of the year|pope|papa|rumor|dating|divorce|netflix show|stranger things|squid game|minecraft|grand theft auto|gta 6)\b/i;

  /* 量级门槛：任一达标即视为"有人在认真交易这个问题"（防杂题污染榜单） */
  const MIN_VOLUME_24H = 3000;   // 24h 成交 $3k
  const MIN_VOLUME = 50000;      // 累计成交 $50k

  const CAP = 60;                // 产物上限：榜单足够，体积可控

  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('[')) { try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch { return []; } }
    }
    return [];
  }

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function round(n, d) { const m = Math.pow(10, d); return Math.round(n * m) / m; }

  /* ISO 时间 → ms；解析失败返回 null（与 events.toMs 同语义，自身内联以免跨模块耦合） */
  function toMs(t) {
    if (t === null || t === undefined || t === '') return null;
    if (typeof t === 'number') return isFinite(t) ? t : null;
    const ms = Date.parse(String(t));
    return isNaN(ms) ? null : ms;
  }

  /* 标题归一去重键：小写 + 去符号 + 前 8 词（同 events.dedupeKey 语义） */
  function dedupeKey(q) {
    return String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(/\s+/).slice(0, 8).join(' ');
  }

  function catOf(text) {
    const s = String(text || '');
    if (!s) return null;
    for (const r of CAT_RULES) { if (r.re.test(s)) return r.cat; }
    return null;
  }

  /* 单个 Gamma event → 0~2 行。规则：
     - 只认二元 Yes/No 市场（outcomes 恰为 ["Yes","No"]），概率 = outcomePrices[0]；
     - 单市场事件 → 一行，问题用事件标题；
     - 多结果事件（如美联储决议一行多档）→ 只取概率最高的两档（合计≈全部概率质量），
       问题 = "事件标题 · 档名"；
     - 类别闸门（标签或标题命中白名单）不过 / 命中黑名单 / 量级不够 → 空数组。 */
  function rowsForEvent(ev) {
    if (!ev || typeof ev !== 'object') return [];
    if (ev.closed === true || ev.active === false || ev.archived === true) return [];
    const title = String(ev.title || '').trim();
    if (!title) return [];

    const binary = parseList(ev.markets).map(m => {
      if (!m || typeof m !== 'object' || m.closed === true) return null;
      const outcomes = parseList(m.outcomes).map(o => String(o).toLowerCase());
      if (outcomes.length !== 2 || outcomes[0] !== 'yes' || outcomes[1] !== 'no') return null;
      const p = num(parseList(m.outcomePrices)[0]);
      if (p === null || p < 0 || p > 1) return null;
      return { m, p };
    }).filter(Boolean);
    if (!binary.length) return [];

    const tagText = parseList(ev.tags)
      .map(t => (t && typeof t === 'object') ? (t.slug || '') + ' ' + (t.label || '') : '')
      .join(' ');
    const cat = catOf(tagText) || catOf(title);
    if (!cat) return [];
    if (BLACKLIST_RE.test(title)) return [];

    const vol24 = num(ev.volume24hr);
    const total = num(ev.volume);
    const liq = num(ev.liquidity);
    if (!((vol24 !== null && vol24 >= MIN_VOLUME_24H) || (total !== null && total >= MIN_VOLUME))) return [];

    let picks;
    if (binary.length === 1) {
      picks = [{ q: title, p: binary[0].p, m: binary[0].m }];
    } else {
      picks = binary.slice().sort((a, b) => b.p - a.p).slice(0, 2).map(b => {
        const item = String(b.m.groupItemTitle || '').trim();
        return { q: item ? title + ' · ' + item : title, p: b.p, m: b.m };
      });
    }

    const end = toMs(ev.endDate);
    const updated = toMs(ev.updatedAt);
    return picks.map(({ q, p, m }) => ({
      id: 'pm:' + (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : dedupeKey(q)),
      question: q,
      category: cat,
      probability: round(p, 3),
      change24h: num(m.oneDayPriceChange) === null ? null : round(num(m.oneDayPriceChange) * 100, 1),
      volume24hr: vol24 === null ? null : Math.round(vol24),
      liquidity: liq === null ? null : Math.round(liq),
      endDate: end,
      updatedAt: updated,
    }));
  }

  /* 采集侧入口：Gamma /events 原始数组 → 过滤、清洗、去重、按 24h 热度排序、截断 */
  function normalize(rawEvents, cap) {
    const seen = new Set();
    const rows = [];
    (Array.isArray(rawEvents) ? rawEvents : []).forEach(ev => {
      rowsForEvent(ev).forEach(r => {
        const key = dedupeKey(r.question);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        rows.push(r);
      });
    });
    rows.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
    return rows.slice(0, cap || CAP);
  }

  /* 前端入口：静态 JSON 里的行数组 → 结构校验（坏行剔除）、按热度排序。
     采集与前端共用行定义，这里只做防御性清洗，不做语义改写。 */
  function sanitize(rawRows, cap) {
    const out = [];
    (Array.isArray(rawRows) ? rawRows : []).forEach(r => {
      if (!r || typeof r.question !== 'string' || !r.question.trim()) return;
      const p = num(r.probability);
      if (p === null || p < 0 || p > 1) return;
      const cat = CAT_META[r.category] ? r.category : null;
      if (!cat) return;
      out.push({
        id: typeof r.id === 'string' && r.id ? r.id : 'pm:' + dedupeKey(r.question),
        question: r.question.trim(),
        // 中文标题：采集端翻译（collect-polymarket.mjs），翻译失败的行这里是 null，
        // 前端按 questionZh || question 展示——宁缺毋假，绝不拿机翻失败兜底成乱码
        questionZh: (typeof r.questionZh === 'string' && r.questionZh.trim() &&
          r.questionZh.trim() !== r.question.trim()) ? r.questionZh.trim() : null,
        category: cat,
        probability: round(p, 3),
        change24h: r.change24h === null || r.change24h === undefined ? null : num(r.change24h),
        volume24hr: num(r.volume24hr) === null ? null : Math.round(num(r.volume24hr)),
        liquidity: num(r.liquidity) === null ? null : Math.round(num(r.liquidity)),
        endDate: toMs(r.endDate),
        updatedAt: toMs(r.updatedAt),
      });
    });
    out.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
    return out.slice(0, cap || CAP);
  }

  return { CAT_META, CAT_RULES, BLACKLIST_RE, MIN_VOLUME_24H, MIN_VOLUME, CAP,
    parseList, num, dedupeKey, catOf, rowsForEvent, normalize, sanitize };
})();

if (typeof window !== 'undefined') window.Polymarket = Polymarket;
if (typeof module !== 'undefined' && module.exports) module.exports = Polymarket;
