/* history.js —— 长历史序列（基金对比用；含分红口径优先）
 *
 * 为什么要单独一个源：详情页的 getKline 只取 320 根、且以东财 push2delay 打头（它不存历史 K 线）。
 * 基金对比要"2010 年至今"这种十几年、几千根的序列，参数与降级链都不一样。
 *
 * 实测结论（2026-09-16 逐个接口 curl/node 验过，_test/history.test.mjs 里锁住）：
 *   · 只有东财 push2his 能同时给"长 + 含分红"：
 *       - lmt 上限 5000 根（再大整个返回空）；
 *       - fqt 必须用 2（后复权）：**fqt=1 前复权在东财是加性口径**，长窗口会算出负价——
 *         长江电力最小收盘 -7.58、盈富基金 -1.67、腾讯 -39.33，收益比值直接是负的。
 *         后复权是乘性口径且与美股前复权同比值（SPY/QQQ 两口径比值完全一致）。
 *       - 直连可用且回 CORS 头（回显任意 Origin），浏览器能直接取。
 *   · 腾讯 fqkline 是**兜底**，能力边界实测如下，别指望它更多：
 *       - A股：qfq 真的含分红，但日/周都只给 640 根（≈2.5 年）；
 *       - 港/美股：qfq 参数被忽略，返回的就是**不复权价**（SPY 1993 年首根 43.94，
 *         与不带 qfq 的原始接口逐字相同）→ 只能算价格收益，界面必须标注；
 *       - 美股深度反而最好（周线回到 1993），但同样是不复权。
 *   · 新浪美股日线深到 2001 年，同样不复权 → 不作为源引入（多一份口径不同的副本不值得）。
 *   · 场外基金（天天基金 6 位基金代码）在该接口取不到历史 → 诚实空态，不假装支持。
 *
 * 东财有 WAF：短时间内连续拉大响应会被整段拒连（实测一次"other side closed"持续十几分钟，
 * curl 与 node 同时挂 → 是 IP 级封禁，不是客户端问题）。因此这里做了三件事：
 *   ① 取数按需分档（BUCKETS）而不是一律 5000 根；② 失败记熔断窗口，窗口内不再打东财；
 *   ③ 熔断期间自动走腾讯兜底并在返回值里标明 adj='none'（价格收益），由界面如实标注。
 */

const HistorySource = (() => {
  const { request, num, Cache } = window.U;

  /* 只允许"数字市场位 + 代码"，拼 URL 前先收敛注入面（与 tencent.js getMinute 同款守卫） */
  const SECID_RE = /^\d{1,3}\.[A-Za-z0-9._-]{1,14}$/;
  const EAST_HOST = 'https://push2his.eastmoney.com';
  /* 腾讯兜底走**不复权**接口（`/appstock/app/kline/kline`）。不用 `fqkline` 的三个理由：
     ① 口径：A股 qfq 是加性（见下方注释），港美股 qfq 被忽略——反正都不能当含分红用；
     ② 可用性：实测 `fqkline` 在 web 主机上会返回 501 + JS 挑战页；
     ③ 深度：不复权接口反而更好（A股周线 1084 根回到 2003-11，fqkline 只有 640 根）。
     两个主机都实测能答不复权接口（`ifzq` 与 `web.ifzq`），所以按 host 做故障切换，
     而不是留一个"第二个接口"——实测不带 qfq 的 fqkline 根本不返回任何 bar，那是死路。 */
  const TENCENT_HOSTS = ['https://web.ifzq.gtimg.cn', 'https://ifzq.gtimg.cn'];
  const TENCENT_PATH = '/appstock/app/kline/kline';

  const KLT = { day: 101, week: 102, month: 103 };
  const MAX_BARS = 5000;                   // 东财实测上限：请求 5000 给满，>5000 返回空
  /* 一根 bar 的响应约 68B（SPY 5000 根 ≈ 338KB）→ 按需分档：1 年日线只要 24KB。
     少拉一次大响应，就少一次被 WAF 掐断的机会。 */
  const BUCKETS = [130, 260, 520, 780, 1300, 2600, MAX_BARS];
  const PER_YEAR = { day: 252, week: 52, month: 12 };
  const MARKET_OF = { 1: 'cn', 0: 'cn', 105: 'us', 106: 'us', 107: 'us', 116: 'hk' };

  const MARKET_CN = { cn: 'A股', hk: '港股', us: '美股' };

  function estimateBars(days, granularity) {
    const n = Math.max(1, days) * PER_YEAR[granularity] / 365.25;
    return Math.max(30, Math.ceil(n) + 12);
  }
  function bucketFor(n) {
    for (const b of BUCKETS) if (n <= b) return b;
    return MAX_BARS;
  }

  function marketOfSecid(secid) {
    return MARKET_OF[String(secid).split('.')[0]] || null;
  }

  /* ---------- 降级状态：东财熔断窗口（只在本会话内存里，刷新即重试） ---------- */
  let eastDownUntil = 0;
  let eastFails = 0;
  const eastOK = () => Date.now() >= eastDownUntil;
  function eastFailed() {
    eastFails++;
    // 1 次失败等 30s，连续失败指数退避到最多 10 分钟——别把 WAF 惹得更久
    eastDownUntil = Date.now() + Math.min(600000, 30000 * Math.pow(2, eastFails - 1));
  }
  function eastSucceeded() { eastFails = 0; eastDownUntil = 0; }

  /* ---------- 东财：含分红（后复权） ---------- */
  function eastURL(secid, klt, lmt, fqt) {
    return EAST_HOST + '/api/qt/stock/kline/get?secid=' + secid +
      '&klt=' + klt + '&fqt=' + fqt + '&lmt=' + lmt + '&end=20500101' +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
  }

  function parseEast(json) {
    const d = (json && json.data) || {};
    const out = [];
    for (const row of d.klines || []) {
      const p = String(row).split(',');
      const close = num(p[2]);
      // 开/收任一缺失或非正的脏 bar 直接丢：归一化曲线的分母可能就是它
      if (close === null || close <= 0 || num(p[1]) === null) continue;
      out.push({ time: p[0].length > 10 ? p[0].slice(0, 10) : p[0], close });
    }
    return { name: d.name || '', bars: out };
  }

  async function fetchEast(secid, { granularity, limit }) {
    if (!eastOK()) return null;
    const klt = KLT[granularity];
    const lmt = Math.min(MAX_BARS, Math.max(2, Math.round(limit)));
    /* 只认 fqt=2。fqt=1 不做重试：东财前复权是加性口径（见文件头实测），
       拿它当"含分红"喂进收益计算会得到 3~30 倍虚高的年化——
       宁可这一路失败走兜底（并如实标注价格收益），也不给一个错的"总收益"。 */
    try {
      const r = parseEast(await request(eastURL(secid, klt, lmt, 2)));
      if (r.bars.length) {
        eastSucceeded();
        window.SourceState && window.SourceState.ok('history', 'eastmoney');
        return { bars: r.bars, name: r.name, adj: 'hfq', via: 'eastmoney', limit: lmt };
      }
    } catch { /* 交给外层熔断 */ }
    eastFailed();
    window.SourceState && window.SourceState.fail('history', 'eastmoney');
    return null;
  }

  /* ---------- 腾讯兜底：**只有不复权价，任何市场都不含分红** ----------
     2026-09-16 复核推翻了自己上一版结论：腾讯 A股的 qfq 同样是**加性**口径
     （原始价 − 前复权价 在除息日阶梯式变化，实测 sh600900：5.099 → 4.399 → 2.763 → 1.000 → 0.000，
     比例 1.368 → 1.248 → 1.142 → 1.036 → 1.000，不是乘性因子）。用它的比值当总收益，
     长江电力 2010 至今会算成 +9324% / 年化 46.8%（真值约 +317% / 12.8%），510300 也虚高 60%。
     所以兜底一律标 adj='none'（价格收益），由界面如实标注"未含分红"，绝不再冒充总收益。 */
  const usCodeCache = new Map();                // usSPY → SPY.AM（腾讯美股要带交易所后缀）
  async function tencentSymbol(secid) {
    const [m, code] = String(secid).split('.');
    if (m === '1') return 'sh' + code;
    if (m === '0') return (/^(92|8|4)/.test(code) ? 'bj' : 'sz') + code;
    if (m === '116') return 'hk' + code;
    if (m === '105' || m === '106' || m === '107') {
      const k = 'us' + code;
      if (usCodeCache.has(k)) return usCodeCache.get(k);
      let sym = k;
      try {
        const txt = await request('https://qt.gtimg.cn/q=' + k, { gbk: true });
        const f = String(txt).match(/="([^"]*)"/);
        const full = f ? (f[1].split('~')[2] || '').trim() : '';
        if (/^[A-Za-z.]{1,14}$/.test(full)) sym = 'us' + full;
      } catch { /* 取不到就用裸代码试一次 */ }
      usCodeCache.set(k, sym);
      return sym;
    }
    return null;
  }

  async function fetchTencent(secid, { granularity, limit }) {
    const sym = await tencentSymbol(secid);
    if (!sym) return null;
    const period = granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'day';
    const lmt = Math.min(2000, Math.max(2, Math.round(limit)));
    for (const code of [sym, sym.replace(/\.(AM|OQ|N)$/, '')]) {
      for (const host of TENCENT_HOSTS) {
        try {
          const url = host + TENCENT_PATH + '?param=' + encodeURIComponent([code, period, '', '', lmt].join(','));
          const j = await request(url);
          const node = j && j.data && (j.data[code] || Object.values(j.data || {})[0]);
          const rows = node ? (node[period] || []) : [];
          const bars = rows.map(r => ({ time: String(r[0]), close: num(r[2]) }))
            .filter(b => b.close !== null && b.close > 0);
          if (!bars.length) continue;
          window.SourceState && window.SourceState.ok('history', 'tencent');
          return { bars, name: '', adj: 'none', via: 'tencent', limit: lmt };
        } catch { /* 换主机 / 裸代码 */ }
      }
    }
    return null;
  }

  /* ---------- 取数（带内存缓存；东财 → 腾讯；两者都挂才返回 null） ----------
     fresh=true 跳过缓存读（"重新取数"按钮用）：缓存键里没有数据源成分，东财恢复后
     6 小时内的缓存条目仍然是兜底源的价格收益——不绕过缓存的话，界面上那句
     "稍等一两分钟再点重新取数"就是一句空话。 */
  async function series(secid, { granularity = 'day', days = 3650, allowFallback = true, fresh = false } = {}) {
    if (!SECID_RE.test(String(secid))) return null;
    const want = bucketFor(estimateBars(days, granularity));
    const key = 'hist:' + granularity + ':' + want + ':' + secid;
    if (!fresh) {
      const hit = Cache.get(key, 6 * 3600000);
      if (hit) return hit.val;
    }
    let got = await fetchEast(secid, { granularity, limit: want });
    if (!got && allowFallback) got = await fetchTencent(secid, { granularity, limit: want });
    if (got) {
      const val = { secid, granularity, ...got };
      Cache.set(key, val);
      return val;
    }
    window.SourceState && window.SourceState.fail('history', 'all-sources');
    return null;
  }

  /* ---------- 标的解析：把"用户输入的代码/名称"变成能取到历史的 secid ---------- */
  /* 东财美股市场位不可推断（SPY/SCHD 在 107=ARCA、QQQ 在 105=NASDAQ），猜错返回空；
     所以纯字母代码把三个市场位都试一遍，再用搜索接口兜底。 */
  /* 输入 → secid 候选。歧义分三级，处理方式不同：
     · amb=0 无歧义：显式 secid / sh|sz|bj|hk 前缀 / 5 位港股 / **6 位 A股代码按号段约定**推出来的市场位
     · amb=2 **标签级**歧义：美股 105/106/107 只是东财的市场位标签，腾讯按代码查，
       三种位都是同一只标的（SPY.AM）→ 兜底源认它不算串标的，可以用（secid 记为 provisional）
     · amb=1 **标的级**歧义：同一串数字在沪深两边都存在**且是不同标的**时，只有权威来源能定
     6 位代码按号段定市场：6/9 开头与 688 → 沪(1.)，0/3 开头、4/8/92 → 深/北(0.)。
     实测反例正是 000001/000002：1.000001 是上证指数、0.000001 是平安银行（不同标的！），
     所以 000xxx 段保留 amb=1（要权威确认），其余号段直接定死——否则同一串输入会因
     "当时哪个源能通"而落到不同标的上（复核实测：搜索不可用 + 东财可用时 000002 变成 Ａ股指数）。 */
  function candidatesOf(input) {
    const s = String(input || '').trim();
    if (!s) return [];
    if (SECID_RE.test(s)) return [{ secid: s, via: 'secid', amb: 0 }];
    const low = s.toLowerCase();
    if (/^sh\d{6}$/.test(low)) return [{ secid: '1.' + low.slice(2), via: 'prefix', amb: 0 }];
    if (/^(sz|bj)\d{6}$/.test(low)) return [{ secid: '0.' + low.slice(2), via: 'prefix', amb: 0 }];
    if (/^hk\d{5}$/.test(low)) return [{ secid: '116.' + low.slice(2), via: 'prefix', amb: 0 }];
    if (/^\d{5}$/.test(s)) return [{ secid: '116.' + s, via: 'guess', amb: 0 }];
    const us = (code) => ['105', '107', '106'].map(m => ({ secid: m + '.' + code, via: 'guess', amb: 2 }));
    if (/^us[A-Za-z0-9._-]{1,10}$/.test(s)) return us(s.slice(2).toUpperCase());
    if (/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(s)) return us(s.toUpperCase());
    if (/^\d{6}$/.test(s)) {
      /* 沪市：6/5 开头（600/601/603/605/688 股票与 51x/56x/58x ETF）、9 开头（900 B股）
         但 920xxx 是北交所（深/北那侧）。深市/北交所：0/1/2/3/4/8 开头
         （000/001/002/003 股票、300/301 创业板、15x/16x/18x 基金、4x/8x 与 920 北交所）。
         ⚠️ ETF 代码段是最容易搞错的地方：510300 在沪（1.）、159915 在深（0.），
         只按"6 沪 0 深"判断会把一半场内基金指到错的市场位（实测被测试挡下）。 */
      const sh = /^(6|5)/.test(s) || (/^9/.test(s) && !/^920/.test(s));
      const code = (sh ? '1.' : '0.') + s;
      // 000xxx 段（平安银行/万科A 与 上证指数/Ａ股指数 撞号）留给权威来源裁决
      const amb = /^000\d{3}$/.test(s) ? 1 : 0;
      return [{ secid: code, via: 'guess', amb }];
    }
    return [];
  }

  /* 搜索接口（东财 searchapi，JSONP）：给出权威 MktNum。
     ⚠️ 它按名称模糊召回，**输入 SPY 会返回"远东股份 600869"这类无关行**（实测），
     所以代码类输入只认"代码完全一致"的行；只有输入本身是中文名时才按接口相关度取。 */
  async function searchCandidates(kw) {
    const raw = String(kw || '').trim();
    /* 带前缀的输入（usAAPL / sh600519）直接丢给搜索接口多半召回为空 →
       再拿去掉前缀的关键词问一次（只有在第一次没结果时才多发这一次请求） */
    const probeKey = raw.replace(/^(sh|sz|bj|hk|us)/i, '');
    const ask = async (q) => {
      try {
        const j = await window.U.fetchJSONP('https://searchapi.eastmoney.com/api/suggest/get?input=' +
          encodeURIComponent(q) + '&type=14&count=10');
        const arr = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
        return arr
          .map(x => ({ secid: x.QuoteID || (x.MktNum + '.' + x.Code), code: String(x.Code || ''), name: x.Name, via: 'search' }))
          .filter(x => SECID_RE.test(x.secid) && marketOfSecid(x.secid));
      } catch { return []; }
    };
    let rows = await ask(raw);
    if (!rows.length && probeKey && probeKey !== raw) rows = await ask(probeKey);
    if (/[\u4e00-\u9fa5]/.test(raw)) return rows;        // 中文名：按接口自己的相关度
    // 代码类输入只认"代码完全一致"的行：接口是名称模糊召回（输入 SPY 会返回"远东股份 600869"）
    const want = probeKey.toUpperCase();
    return rows.filter(x => x.code.toUpperCase() === want);
  }

  async function load(input, opts = {}) {
    const cands = candidatesOf(input);
    const certain = cands.filter(x => x.amb === 0);
    const labelOnly = cands.filter(x => x.amb === 2);
    const ambiguous = cands.filter(x => x.amb === 1);
    const memo = new Map();               // 同一 secid 只取一次（后面几步会重复探同一个 secid）
    const probe = async (c) => {
      if (!c || !marketOfSecid(c.secid)) return null;
      if (memo.has(c.secid)) {
        const r = memo.get(c.secid);
        return r ? { ...r, name: r.name || c.name } : null;
      }
      const s = await series(c.secid, opts);
      const r = (s && s.bars.length)
        ? { ...s, name: s.name || c.name || c.secid.split('.').pop(), market: marketOfSecid(c.secid) } : null;
      memo.set(c.secid, r);
      return r;
    };
    // 兜底源给出的"猜出来的市场位"只是临时标签，不能写进记忆（否则东财恢复后拿着错标签取空）
    const tag = (r, c) => (r && r.via !== 'eastmoney' && (c.amb === 2 || c.amb === 1)) ? { ...r, provisional: true } : r;

    // ① 无歧义候选（显式 secid / 前缀 / 号段定死的 6 位 A股 / 5 位港股）：任何源认它都算数
    for (const c of certain) {
      const r = await probe(c);
      if (r) return r;
    }

    // ② 权威来源：搜索接口给出的真实 MktNum（含"代码完全一致"过滤）
    for (const c of await searchCandidates(input)) {
      const r = await probe(c);
      if (r) return r;
    }

    /* ③ 标的级歧义（000xxx 段：1.000001 上证指数 vs 0.000001 平安银行）：权威来源没给答案就到此为止。
       注意**不能用主源东财来"确认"**——东财对 1.000002 与 0.000002 都有数据（一个是Ａ股指数、
       一个是万科A），所以"东财认它"并不证明市场位对，只有搜索接口的 MktNum 是权威的。 */
    if (ambiguous.length) return null;

    /* ④ 标签级歧义（美股 105/106/107）：三种市场位在腾讯那边是同一只标的，兜底源认它也不串标的
       → 可以用，但 secid 只是临时标签（provisional），不写进记忆，免得东财恢复后拿着错标签取空 */
    for (const c of labelOnly) {
      const r = await probe(c);
      if (r) return tag(r, c);
    }

    /* ⑤ 都不行：返回 null 让界面说"取数失败"。
       绝不在最后"退回猜到的那个"——上一版这样做过，实测在搜索接口不通时把 000002(万科A)
       解析成 1.000002(Ａ股指数) 并静默画到图上（名字还是裸代码，用户看不出来）。 */
    return null;
  }

  /* 并发闸门：6 只标的一次性打出去会同时命中 WAF，实测就是被封的原因之一。
     限流到 max 并发，顺序稳定（结果按输入顺序返回）。 */
  async function loadMany(inputs, { max = 3, ...opts } = {}) {
    const out = new Array(inputs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const i = next++;
        out[i] = await load(inputs[i], opts);
      }
    };
    await Promise.all(Array.from({ length: Math.min(max, inputs.length) }, worker));
    return out;
  }

  return { series, load, loadMany, fetchEast, fetchTencent, candidatesOf, marketOfSecid,
    estimateBars, bucketFor, KLT, MAX_BARS, BUCKETS, MARKET_CN, SECID_RE,
    eastHealthy: eastOK };
})();

window.HistorySource = HistorySource;
