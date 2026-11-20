/* polymarket.js —— 预测市场"事件概率"数据模型（纯函数，无 DOM / 无网络，可直接单测）
   前端、采集脚本（_scripts/collect-polymarket.mjs）与离线单测共用同一份定义。

   合规口径（强约束，与 gdelt.js 同级架构约束）：
   - 只接 Polymarket Gamma 公开只读接口，只提取"市场隐含概率"这一个数字（Yes 价格）；
   - 产物不存 slug / URL / tokenId，前端渲染层不可能外链到交易平台；本站不提供、不引导任何下单功能；
   - 只保留可能影响市场的类别（央行/宏观/贸易/地缘/选举/能源），文体、娱乐、crypto 价格
     类问题在模型层就剔除——标题白名单闸门 + 黑名单一票否决双保险；
   - 概率是市场定价的隐含值，不是本站预测；展示层必须带"仅供参考"口径标注。

   —— 为什么是"事件 + 档位"两层（2026-10-20 重构）——
   旧模型把每个档位拍平成一行（问题 = "事件标题 · 档名"），带来三个硬伤：
   1) 概率和不可信：采集只留前两档，"Next French Presidential Election"（真实 80 个候选人）
      被截成 0.646，饼图画出来就是假的；
   2) 事件被拦腰截断：行数上限 60 正好切在一个事件中间，父子档位分到两页；
   3) 没有任何"事件"概念，前端做不了饼图/走势这类聚合视图。
   现在改成：事件是主体，outcomes[] 保留具名档位（上限 MAX_OUTCOMES），
   rest{probability,count} 聚合未展开档位的概率质量——饼图 = 具名档位 + "其他"，
   和恒为 1，不会画出一张"概率只占 65%"的残缺饼。

   事件结构（采集产物 / 前端共用）：
   { id, title, titleZh, category, partition, volume24hr, liquidity, endDate, updatedAt,
     outcomes: [ { id, label, labelZh, probability, change24h, volume24hr, liquidity } ],
     rest: { probability, count },    // 未展开档位的概率质量合计（= 饼图的"其他"扇区）
     outcomeCount }                   // 实际有报价的档位数

   —— partition 字段：能不能画饼图，全看它 ——
   Polymarket 的 negRisk 事件（ev.negRisk === true）里各档位**互斥且穷尽**：
   "美联储10月决议"（不加息/加25bp/加50bp…）、"2026中期选举席位"、
   "下任法国总统"——概率加起来 ≈ 1，饼图成立。
   negRisk === false 的事件里各档位是**彼此独立的问句**：
   "停火持续到10月22吗/到10月24吗/到10月28吗"（逐日嵌套）、
   "WTI十月涨到多少：≥$120/≥$130/…"（阈值嵌套）、
   "谁会参加美伊和谈"（可多人出席）——加起来会 >1 或 <1，
   画成饼图就是范畴错误（暗示了并不存在的互斥关系）。所以：
   partition=true → 环图（具名档位 + "其他"）；partition=false → 只给概率条。
   字段取自 Polymarket 自己的元数据，不是本地猜的。

   历史序列（走势图）结构（data/events/polymarket-history.json）：
   { generatedAt, binMs, from, count, series: { "<档位id>": [概率×1000 或 null, ...] } }
   共享时间轴 + 稀疏取值：一条时间轴对所有档位，缺测为 null（不插值、不外推）。 */

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

  /* 类别白名单：先后即优先级。判定只看**标题**——标题是用户真正读到的问句，
     而 Polymarket 的 tag 会把一堆宽标签（Politics/Elections）挂到毫不相干的问题上，
     早期版本"标签命中即可入榜"因此混进了"美国会确认外星人存在吗"这种杂题。
     现在口径是：标题必须命中至少一条类别规则才入榜，分类也以标题为准。 */
  const CAT_RULES = [
    { cat: 'central_bank', re: /\b(fed|fomc|fed rates|federal reserve|jerome powell|powell|interest rates?|rate cuts?|rate hikes?|rate decision|monetary policy|ecb|european central bank|bank of japan|pboc|people'?s bank of china|central bank|policy rate)\b/i },
    { cat: 'macro',        re: /\b(economy|economic policy|economics|inflation|cpi|jobs report|recession|gdp|unemployment|government shutdown|debt limit|debt ceiling|us debt|budget|tax cuts?|spending bill|treasury (yield|sector)|bond yields?)\b/i },
    { cat: 'trade',        re: /\b(tariffs?|trade war|trade policy|trade deal|import dut|exports?|export ban|embargo|sanctions?)\b/i },
    { cat: 'geopolitics',  re: /\b(geopolitics|geo politics|ukraine|russia|israel|israeli|iran|iranian|gaza|china|taiwan|north korea|korea|middle east|venezuela|nato|nuclear|war|ceasefire|military|defense|strait of hormuz|hormuz)\b/i },
    { cat: 'election',     re: /\b(politics|us politics|elections?|elect|congress|midterms?|primaries?|senate|house|house of representatives|presidential|president|governor|mayor|prime minister|chancellor|referendum|ballot|primary|coalition|parliament|parliamentary|cabinet|press secretary|supreme court|justice|politician|vote)\b/i },
    { cat: 'energy',       re: /\b(oil|opec|crude|natural gas|energy|gasoline|brent|wti|pipeline|refinery)\b/i },
  ];

  /* 黑名单一票否决：文体/娱乐/名人/crypto 价格/社媒杂谈/电竞。
     白名单已拦掉大头，这里拦"挂了 Politics 之类宽标签的杂题"
     （如"Trump 本周会不会发帖"）。
     注意 us open 不能放进 /i 的大名单：'the US open a dialogue with Iran'
     （小写动词 open）会被一票否决误杀——赛事专名两词都大写，单独用大小写敏感正则拦。 */
  const BLACKLIST_RE = /\b(nfl|nba|mlb|nhl|ufc|wwe|fifa|uefa|premier league|la liga|serie a|bundesliga|mls|cricket|formula 1|grand prix|nascar|olympics?|olympic|world cup|champions league|europa league|fa cup|copa america|grand slam|boxing|worlds|blast slam|esports?|e-?sports|dota 2?|valorant|counter-?strike|cs2|league of legends|lol|overwatch|rainbow six|rocket league|tennis|wimbledon|french open|australian open|super bowl|netflix show|stranger things|squid game|minecraft|grand theft auto|gta 6|album|box office|met gala|celebrit|kardashian|taylor swift|nobel prize|bitcoin|btc|ethereum|eth price|solana|xrp|dogecoin|memecoin|stablecoin|crypto|bitcoin price|aliens?|alien|ufo|extraterrestrial|tweets?|twitter|truth social|post on|posting on|posts? a (photo|video|statement)|time person of the year|pope|papa|rumor|dating|divorce|grammy|emmy|golden globe|eurovision|oscar|academy award|who will win the ball|ballon d'or)\b/i;
  const BLACKLIST_CS_RE = /\bUS Open\b/;   // 大小写敏感：只拦体育赛事专名，不误杀 "US open + 动词"

  /* 政治风险闸门：涉及中国主权 / 领导人 / 台湾的预测问题一律不收录。
     （原实现放在 js/events.js 里检查 raw.question，但事件行根本没有 question 字段，
       是段永不生效的死代码；这里迁到真正生效的地方。） */
  const POLITICAL_RISK_RE = /\b(china.{0,24}invade.{0,16}taiwan|taiwan.{0,16}independ|xi jinping|taiwan strait|chinese invasion)\b/i;

  /* 量级门槛：任一达标即视为"有人在认真交易这个问题"（防杂题污染榜单） */
  const MIN_VOLUME_24H = 3000;   // 24h 成交 $3k
  const MIN_VOLUME = 50000;      // 累计成交 $50k

  const CAP = 30;                // 事件数上限：榜单足够，体积可控
  const MAX_OUTCOMES = 6;        // 每个事件保留的具名档位上限；其余进 rest 聚合
  const REST_LABEL = '其他档位';   // rest 扇区的中文名

  /* 历史序列网格：4 小时一格，7 天 = 42 格。格子对齐绝对时间轴（不依赖采集时刻），
     这样两次采集产出的网格可以逐格对齐、不会因为跑批时间漂移而错位。 */
  const HIST_BIN_MS = 4 * 3600 * 1000;
  const HIST_BINS = 42;

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

  /* 模板题拼合（纯函数，采集与前端共用）：
     Polymarket 的事件标题常以省略号收尾（"US-Iran ceasefire continues through...?"），
     关键信息在档位名里（"October 22"）。把档位填回省略号处才是完整可读的问句——
     旧模型靠这一步才没把"停火持续到…"整族事件误杀成"信息缺失"。
     拼不出来（没有档位、或档位就是 Yes）→ 返回 null = 问句读不懂，丢弃该档位。 */
  function composeQuestion(title, label) {
    const t = String(title || '').trim();
    const l = String(label || '').trim();
    const m = t.match(/^(.*?)\s*(?:\.\.\.|…)\s*(.*)$/);
    if (m) {
      const stem = m[1].trim(), tail = m[2].trim();
      if (!l || /^yes$/i.test(l)) return null;   // 档位没给出关键信息 → 问句读不懂
      return (stem + ' ' + l + (tail ? ' ' + tail : ''))
        .replace(/\s+([?？])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }
    if (!l || /^yes$/i.test(l)) return t;       // 单一 Yes/No 事件：问题就是标题
    return (t + ' · ' + l).trim();
  }

  /* 事件标题的"词干"：省略号之前的那截（展示用）。
     "US-Iran ceasefire continues through...?" → "US-Iran ceasefire continues through" */
  function titleStem(title) {
    const t = String(title || '').trim();
    const m = t.match(/^(.*?)\s*(?:\.\.\.|…).*$/);
    return m ? m[1].trim() : t;
  }

  /* 占位档位：Polymarket 给"还没人填的槽位"自动建市场（Person A…Person ZZ、List A、
     Candidate A），这些市场 outcomePrices 为空 / 恒为 0.5 且零成交零流动性。
     它们不是真实报价，进饼图会凭空造出 50% 的扇区。 */
  const PLACEHOLDER_RE = /^(person|list|candidate|option|field|group|slot|choice|name|tbd|n\/a|other|field a)\s*([a-z0-9]{1,3})?$/i;

  function isPlaceholderLabel(label) {
    const s = String(label || '').trim();
    if (!s) return true;
    if (PLACEHOLDER_RE.test(s)) return true;
    // "Other" 在多选题里常是真实的兜底桶（且有真实报价），不能一刀切；
    // 真正的判据是"零成交零流动性"，由调用方用 vol/liq 兜住。
    return false;
  }

  /* 单个 Gamma event → 事件对象（可能为 null）。
     规则：
     - 标题必须命中类别白名单（否则是文体/娱乐/杂题），且不得命中黑名单与政治风险闸门；
     - 只认二元 Yes/No 市场（outcomes 恰为 ["Yes","No"]），概率 = outcomePrices[0]；
     - 每个档位按 groupItemTitle 命名；无报价（outcomePrices 空）的市场直接剔除；
     - 档位按概率降序，前 MAX_OUTCOMES 个具名保留，其余概率质量进 rest 聚合。 */
  function parseEvent(ev) {
    if (!ev || typeof ev !== 'object') return null;
    if (ev.closed === true || ev.active === false || ev.archived === true) return null;
    const title = String(ev.title || '').trim();
    if (!title) return null;
    if (BLACKLIST_RE.test(title) || BLACKLIST_CS_RE.test(title)) return null;
    if (POLITICAL_RISK_RE.test(title)) return null;

    const cat = catOf(title);
    if (!cat) return null;   // 标题与市场无关 → 不收录（不看 tag，tag 过宽）

    const vol24 = num(ev.volume24hr);
    const total = num(ev.volume);
    const liq = num(ev.liquidity);
    if (!((vol24 !== null && vol24 >= MIN_VOLUME_24H) || (total !== null && total >= MIN_VOLUME))) return null;

    const outcomes = [];
    parseList(ev.markets).forEach(m => {
      if (!m || typeof m !== 'object' || m.closed === true) return;
      const outs = parseList(m.outcomes).map(o => String(o).toLowerCase());
      if (outs.length !== 2 || outs[0] !== 'yes' || outs[1] !== 'no') return;
      const p = num(parseList(m.outcomePrices)[0]);
      if (p === null || p < 0 || p > 1) return;      // 无报价 = 占位市场，剔除
      const label = String(m.groupItemTitle || '').trim() || 'Yes';
      // 拼不出完整问句（模板题的省略号没被档位填上）= 读不懂，不收录
      const q = composeQuestion(title, label);
      if (!q || /\.\.\.|…/.test(q)) return;
      const mVol = num(m.volume24hr);
      const mLiq = num(m.liquidity);
      // 零成交零流动性的槽位即便有报价也是噪声（Polymarket 默认挂 0.5）
      if (isPlaceholderLabel(label) && !(mVol || mLiq)) return;
      outcomes.push({
        id: 'pm:' + (typeof m.id === 'string' || typeof m.id === 'number' ? m.id : dedupeKey(label)),
        label,
        q,
        probability: round(p, 3),
        change24h: num(m.oneDayPriceChange) === null ? null : round(num(m.oneDayPriceChange) * 100, 1),
        volume24hr: mVol === null ? null : Math.round(mVol),
        liquidity: mLiq === null ? null : Math.round(mLiq),
        tokenId: (typeof m.clobTokenIds === 'string' ? parseList(m.clobTokenIds)[0]
          : Array.isArray(m.clobTokenIds) ? m.clobTokenIds[0]
          : (m.clobTokenIds && typeof m.clobTokenIds === 'object' ? m.clobTokenIds[0] : null)) || null,
      });
    });
    if (!outcomes.length) return null;

    outcomes.sort((a, b) => b.probability - a.probability);
    /* 剔掉"已结算"的档位：Polymarket 对过了日期的档位会留下 p=1 / p=0 的残留报价
       （如"停火持续到9月20吗"=1、"普京10月前下台吗"=0），这些不是当下概率，
       画进饼图会凭空多出一整块 100% 的扇区。
       规则：p=0 一律剔除；p=1 只在同事件还存在 (0,1) 区间的真实档位时剔除
       （否则会把"某档位已 100%"的分区事件整条清空）。被剔除的档位仍计入 rest，
       概率质量不凭空消失。 */
    const hasLive = outcomes.some(o => o.probability > 0 && o.probability < 1);
    const dropped = outcomes.filter(o => o.probability === 0 || (o.probability === 1 && hasLive));
    const live = outcomes.filter(o => !dropped.includes(o));
    if (!live.length) return null;

    const named = live.slice(0, MAX_OUTCOMES);
    const restRows = live.slice(MAX_OUTCOMES);
    const restProb = round(restRows.reduce((s, r) => s + r.probability, 0)
      + dropped.reduce((s, r) => s + r.probability, 0), 3);

    const end = toMs(ev.endDate);
    const updated = toMs(ev.updatedAt);
    return {
      id: 'ev:' + (typeof ev.id === 'string' || typeof ev.id === 'number' ? ev.id : dedupeKey(title)),
      title,
      stem: titleStem(title),      // 省略号之前的词干（模板题的公共部分）
      category: cat,
      // negRisk：Polymarket 官方标记的"档位互斥"事件。决定能不能画环图。
      partition: ev.negRisk === true,
      volume24hr: vol24 === null ? null : Math.round(vol24),
      liquidity: liq === null ? null : Math.round(liq),
      endDate: end,
      updatedAt: updated,
      outcomes: named,
      rest: { probability: restProb, count: restRows.length + dropped.length },
      outcomeCount: live.length,
    };
  }

  /* 采集侧入口：Gamma /events 原始数组 → 过滤、清洗、去重、按 24h 热度排序、截断。
     截断发生在**事件层**（不再拦腰截断一个事件的档位）。 */
  function normalize(rawEvents, cap) {
    const seen = new Set();
    const events = [];
    (Array.isArray(rawEvents) ? rawEvents : []).forEach(ev => {
      const e = parseEvent(ev);
      if (!e) return;
      const key = dedupeKey(e.title);
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      events.push(e);
    });
    events.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
    return events.slice(0, cap || CAP);
  }

  /* 前端 / 采集共用：结构校验（坏行剔除）。只保留白名单字段——
     slug / URL / tokenId / clobTokenIds 等一律不出现在产物里。 */
  function sanitizeEvent(e) {
    if (!e || typeof e.title !== 'string' || !e.title.trim()) return null;
    const cat = CAT_META[e.category] ? e.category : null;
    if (!cat) return null;
    const outs = [];
    (Array.isArray(e.outcomes) ? e.outcomes : []).forEach(o => {
      if (!o || typeof o.label !== 'string' || !o.label.trim()) return;
      const p = num(o.probability);
      if (p === null || p < 0 || p > 1) return;
      // 完整问句：优先用采集端拼好的（模板题把档位填回了省略号处），
      // 没有就用标题+档位现拼。拼不出 / 拼完还有省略号 = 读不懂，剔除该档位。
      const q = (typeof o.q === 'string' && o.q.trim()) ? o.q.trim()
        : composeQuestion(e.title, o.label);
      if (!q || /\.\.\.|…/.test(q)) return;
      outs.push({
        id: typeof o.id === 'string' && o.id ? o.id : 'pm:' + dedupeKey(o.label),
        label: o.label.trim(),
        q,
        labelZh: (typeof o.labelZh === 'string' && o.labelZh.trim()) ? o.labelZh.trim() : null,
        probability: round(p, 3),
        change24h: o.change24h === null || o.change24h === undefined ? null : num(o.change24h),
        volume24hr: num(o.volume24hr) === null ? null : Math.round(num(o.volume24hr)),
        liquidity: num(o.liquidity) === null ? null : Math.round(num(o.liquidity)),
      });
    });
    if (!outs.length) return null;
    outs.sort((a, b) => b.probability - a.probability);
    const restProb = num(e.rest && e.rest.probability);
    const restCount = num(e.rest && e.rest.count);
    return {
      id: typeof e.id === 'string' && e.id ? e.id : 'ev:' + dedupeKey(e.title),
      title: e.title.trim(),
      stem: (typeof e.stem === 'string' && e.stem.trim()) ? e.stem.trim() : titleStem(e.title),
      titleZh: (typeof e.titleZh === 'string' && e.titleZh.trim() &&
        e.titleZh.trim() !== e.title.trim()) ? e.titleZh.trim() : null,
      stemZh: (typeof e.stemZh === 'string' && e.stemZh.trim()) ? e.stemZh.trim() : null,
      category: cat,
      partition: e.partition === true,
      volume24hr: num(e.volume24hr) === null ? null : Math.round(num(e.volume24hr)),
      liquidity: num(e.liquidity) === null ? null : Math.round(num(e.liquidity)),
      endDate: toMs(e.endDate),
      updatedAt: toMs(e.updatedAt),
      outcomes: outs,
      rest: {
        probability: restProb === null ? 0 : Math.max(0, round(restProb, 3)),
        count: restCount === null ? 0 : Math.max(0, Math.round(restCount)),
      },
      outcomeCount: Math.max(outs.length, num(e.outcomeCount) || outs.length),
    };
  }

  function sanitizeEvents(list, cap) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(e => {
      const s = sanitizeEvent(e);
      if (s) out.push(s);
    });
    out.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
    return out.slice(0, cap || CAP);
  }

  /* 前端用：按类别分区（顺序按该类最热事件的 24h 成交降序） */
  function groupByCategory(events) {
    const cats = {};
    (Array.isArray(events) ? events : []).forEach(e => {
      (cats[e.category] = cats[e.category] || []).push(e);
    });
    return Object.keys(cats)
      .map(cat => ({ cat, meta: CAT_META[cat] || {}, items: cats[cat] }))
      .sort((a, b) => Math.max(...b.items.map(x => x.volume24hr || 0))
        - Math.max(...a.items.map(x => x.volume24hr || 0)));
  }

  /* ==================== 历史序列（走势图） ==================== */

  /* 采集侧：把 CLOB 拉到的 [[tSec, prob], ...] 折进共享网格。
     entries: [{ id, points: [[tSec, p], ...] }]
     返回 { binMs, from, count, series: { id: [p×1000 或 null, ...] } }
     同一格内多个点取最后一个（最新价覆盖旧价）；格内无点 = null（缺测不插值）。 */
  function buildHistoryGrid(entries, nowMs, binMs, bins) {
    const bin = binMs || HIST_BIN_MS;
    const n = bins || HIST_BINS;
    const now = nowMs === undefined ? Date.now() : nowMs;
    const from = Math.floor((now - n * bin) / bin) * bin;
    const series = {};
    (Array.isArray(entries) ? entries : []).forEach(en => {
      if (!en || !en.id) return;
      const arr = new Array(n).fill(null);
      (Array.isArray(en.points) ? en.points : []).forEach(pt => {
        if (!Array.isArray(pt) || pt.length < 2) return;
        const tSec = num(pt[0]);
        const p = num(pt[1]);
        if (tSec === null || p === null) return;
        const idx = Math.floor((tSec * 1000 - from) / bin);
        if (idx < 0 || idx >= n) return;
        arr[idx] = Math.round(Math.max(0, Math.min(1, p)) * 1000);
      });
      series[en.id] = arr;
    });
    return { binMs: bin, from, count: n, series };
  }

  /* 前端用：网格 → [{ t, p }]，null 缺测点直接丢弃（不连线跨越空洞）。
     返回空数组 = 无历史，前端据此显示诚实空态。 */
  function seriesFromGrid(grid, id) {
    if (!grid || !grid.series || typeof grid.series !== 'object') return [];
    const arr = grid.series[id];
    if (!Array.isArray(arr)) return [];
    const bin = num(grid.binMs) || HIST_BIN_MS;
    const from = num(grid.from);
    if (from === null) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const v = num(arr[i]);
      if (v === null) continue;
      out.push({ t: from + i * bin, p: v / 1000 });
    }
    return out;
  }

  return { CAT_META, CAT_RULES, BLACKLIST_RE, BLACKLIST_CS_RE, POLITICAL_RISK_RE,
    MIN_VOLUME_24H, MIN_VOLUME, CAP, MAX_OUTCOMES, REST_LABEL, HIST_BIN_MS, HIST_BINS,
    parseList, num, dedupeKey, catOf, composeQuestion, titleStem, isPlaceholderLabel,
    parseEvent, normalize, sanitizeEvent, sanitizeEvents, groupByCategory,
    buildHistoryGrid, seriesFromGrid };
})();

if (typeof window !== 'undefined') window.Polymarket = Polymarket;
if (typeof module !== 'undefined' && module.exports) module.exports = Polymarket;
