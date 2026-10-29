/* option.js —— 期权数据源（中金所股指期权 IO/MO/HO + 加密 BTC/ETH 期权），挂 window.OptionSource
 *
 * 数据面与实测依据（两批来源，日期分别标注）：
 *   · A股侧事实引自 docs/research/options-sources.md（2026-10-22 实测）：
 *     - clist 对期权市场位（m:221）一律 HTTP 000 拒连 → **clist 绝对禁用**，链发现只有
 *       命名规则枚举一条路（`IO2612-C-4000`，品种×YYMM×C/P×行权价网格）；
 *     - push2delay ulist 批量报价对 m:221 有实时价且回显 CORS；一次可带 40+ secid
 *       （实测 ≥41），本文件 ULIST_BATCH=40 严格落在已证包络内；
 *     - 闭市/无成交时 f2 可以是 "-"（eastmoney.js:297-298 同款教训）→ 保留判据不按 f2。
 *     2026-10-23 复核：本机处于 EM WAF 的 IP 级封禁窗口（push2delay 全部 /api/qt/* 对本机
 *     HTTP 000 连接重置，与 history.js:21-24 文档的封禁同形态），EM 侧当日未能复测——
 *     正因如此这里照抄 history.js:66-74 的 EM 专用熔断（失败 1 次等 30s，指数退避至
 *     10min 封顶，成功清零），轮询硬打只会延长封禁。
 *   · 加密侧事实为本机 2026-10-23 实测：
 *     - OKX instruments（uly=BTC-USD）：code:0、1316 行，其中 598 行是 `BTC-USD_UM-*`
 *       组合保证金变体且 uly 参数层分不开 → OKX_INSTID_RE 客户端二次过滤不可省；
 *     - OKX tickers（带 uly 过滤）：过滤有效（1316 行只含 BTC-USD 家族），但过滤集内
 *       仍混 _UM 行；字段清单 instType,instId,last,lastSz,askPx,askSz,bidPx,bidSz,
 *       open24h,high24h,low24h,volCcy24h,vol24h,ts,sodUtc0,sodUtc8；深度虚值合约
 *       last 为空串 ""；**OKX 全家没有 mark/IV 字段（逐字段核验，含 ATM 合约与
 *       opt-summary）→ OKX 路径 mark 恒 null，不许拿 mid 价冒充 mark**；
 *     - OKX 标的现价走 /api/v5/market/ticker?instId=BTC-USDT（HTTP 200）；注意
 *       /api/v5/market/index 三种参数今日全部 404，不可用；
 *     - Deribit book_summary（currency=BTC&kind=option）：930 行，含 mark_price/OI/IV/
 *       underlying_price，instrument_name 形如 `BTC-24OCT26-81000-C`（DDMMMYY）。
 *       只配兜底：国内裸直连可达性无法证明（本机流量经隧道），直连失败且配了
 *       window.PROXY 时 request() 自动走 Worker（utils.js:44-48）。
 *
 * 合规口径：纯结构化行情返回、无外链字段、uly 白名单写死只有 BTC-USD/ETH-USD；
 * 开关/风险文案/全中文展示是 UI 层职责（渲染层接入时统一处理）。
 *
 * 缓存语义：'opt:' 前缀不在 Cache._persist（js/utils.js:146-147）→ 全部内存缓存，
 * 刷新页面即失。期权是实时报价，跨会话兜底价值低，接受此语义（不得为持久化改 utils.js）。
 */

const OptionSource = (() => {
  const { request, num, Cache } = window.U;

  /* ==================== 0. 常量与白名单正则（测试锁行为用，全部导出） ==================== */
  const KINDS = Object.freeze(['IO', 'MO', 'HO']);
  const UNDERLYING = Object.freeze({ IO: '1.000300', MO: '1.000852', HO: '1.000016' });
  const KIND_RE = /^(IO|MO|HO)$/;
  const MONTH_RE = /^\d{2}(0[1-9]|1[0-2])$/;                    // YYMM；年份窗口见 monthInWindow
  const CFFEX_SECID_RE = /^221\.(IO|MO|HO)\d{4}-[CP]-\d{1,6}$/; // 拼进 secids 前逐个校验（同 history.js:31 惯例）
  const IDX_SECID_RE = /^\d{1,3}\.\d{6}$/;                      // UNDERLYING 值都过它
  const ULY_RE = /^(BTC|ETH)-USD$/;                             // UI 合同只有这两个标的，写死
  /* 白名单成员 → 常量映射（纵深防御第二层，与入口正则闸门互为独立防线）：
     入参不透传进 URL/secid 拼接——白名单成员映射为模块常量，月份经 parseInt 数字重建，
     拼接的每一节都来自常量表或数字，不来自调用方字符串本体。 */
  const KIND_TOKEN = { IO: 'IO', MO: 'MO', HO: 'HO' };
  const ULY_TOKEN = { 'BTC-USD': 'BTC-USD', 'ETH-USD': 'ETH-USD' };
  const SPOT_TOKEN = { 'BTC-USD': 'BTC-USDT', 'ETH-USD': 'ETH-USDT' };
  /* ⚠️ 显式排除 `_UM` 变体：BTC-USD_UM-261024-81000-C 这种组合保证金变体的 uly 参数
     同样是 'BTC-USD'，参数层分不开（2026-10-23 实测 598/1316 行），客户端二次过滤必须做 */
  const OKX_INSTID_RE = /^(BTC|ETH)-USD-\d{6}-\d+-[CP]$/;
  /* Deribit 命名：DDMMMYY（24OCT26），与 OKX 的 YYMMDD（261024）不同 */
  const DERIBIT_NAME_RE = /^(BTC|ETH)-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})-(\d+)-([CP])$/;
  const EM_HOST = 'https://push2delay.eastmoney.com';           // 只此一台；clist 路径永不出现
  const OKX_HOST = 'https://www.okx.com';
  const DERIBIT_HOST = 'https://www.deribit.com';
  // URL 对象组装（同 tencent.getMinute 惯例：参数值不进入地址字符串拼接）
  const okxURL = (path, params) => {
    const u = new URL(OKX_HOST + path);
    for (const k of Object.keys(params)) u.searchParams.set(k, params[k]);
    return u.href;
  };
  const ULIST_FIELDS = 'f2,f3,f5,f6,f12,f14';                   // 字段白名单，写死
  const ULIST_BATCH = 40;                                       // 调研实测 ≥41；40 严格落在已证包络内
  const PROBE_PCT = 0.15, STEP_NEAR = 25, STEP_FAR = 50;
  const MON = Object.freeze({ JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' });

  /* ==================== 1. 纯函数 ==================== */

  // 北京墙钟分量（y/m/d/hour）。hour 个别环境会给 "24"（sessions.js:29 同款修正）。
  function shParts(now) {
    const map = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hour12: false,
    }).formatToParts(now).forEach(p => { map[p.type] = p.value; });
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    return { y: parseInt(map.year, 10), m: parseInt(map.month, 10), d: parseInt(map.day, 10), hour };
  }
  const mm2 = (v) => String(v).padStart(2, '0');
  const tagOf = (y, m) => mm2(y % 100) + mm2(m);

  // 中金所到期月：当月/下月/随后两个季月，共 4 个，'YYMM'。now 可选参数只为测试确定性。
  // ⚠️ 规格注释里的示例向量「2026-12-20 → ['2612',…]」是日历错位（2026-12 第 3 个周五
  // 实为 18 日，2612 已于当天到期摘牌）——以本函数的滚动公式为准：
  // 2026-12-20 → ['2701','2702','2703','2706']（_test/option.test.mjs T1 按公式断言）。
  function monthsOf(kind, now = new Date()) {
    if (!KIND_RE.test(String(kind || ''))) return [];
    const p = shParts(now);
    // 第 3 个周五：dowOf 用 UTC 口径直取星期，避开本地时区漂移（T1 边界向量依赖）
    const dowOf = new Date(Date.UTC(p.y, p.m - 1, 1)).getUTCDay();
    const thirdFri = 1 + ((5 - dowOf + 7) % 7) + 14;
    // 交割日 15:00 收盘后（或已过）→ 基准月滚动到下月（跨年进位）
    let y = p.y, m = p.m;
    if (p.d > thirdFri || (p.d === thirdFri && p.hour >= 15)) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    const m1 = tagOf(y, m);
    let y2 = y, m2c = m + 1;
    if (m2c > 12) { m2c = 1; y2 += 1; }
    const m2 = tagOf(y2, m2c);
    // q1/q2：严格晚于 m2 的前两个季月 ∈ {03,06,09,12}
    const qs = [];
    let qy = y2, qm = m2c;
    while (qs.length < 2) {
      qm += 1;
      if (qm > 12) { qm = 1; qy += 1; }
      if (qm === 3 || qm === 6 || qm === 9 || qm === 12) qs.push(tagOf(qy, qm));
    }
    return [m1, m2, qs[0], qs[1]];
  }

  // 行权价候选网格：围绕 spot ±15%，step ∈ {25,50} 整数档，升序。
  function strikeGrid(spot, step) {
    const s = Number(spot);
    if (!Number.isFinite(s) || s <= 0) return [];
    if (step !== STEP_NEAR && step !== STEP_FAR) return [];
    const lo = Math.ceil((s * (1 - PROBE_PCT)) / step) * step;
    const hi = Math.floor((s * (1 + PROBE_PCT)) / step) * step;
    const out = [];
    for (let k = lo; k <= hi; k += step) out.push(k);
    return out;
  }

  // 步长选择：month ∈ monthsOf(kind)[0..1]（当月/下月）→ 25，否则 50。
  // 探针保留后不假设实际档距（调研 §2.1：分红除息后档距可能不均匀）。
  function stepOf(kind, month) {
    return monthsOf(kind).indexOf(month) < 2 ? STEP_NEAR : STEP_FAR;
  }

  // TTL 分档：'open' → 30s，否则 10min。
  function ttlOf(sessionCode) { return sessionCode === 'open' ? 30000 : 600000; }

  // A股是否盘中。Sessions 缺失/异常 → 兜底 true = 按盘中（30s）算：
  // 宁可多请求，不拿旧数据当实时。crypto 无闭市，恒 ttlOf('open')。
  function cnOpen() {
    try { return window.Sessions.statusOf('cn').code === 'open'; }
    catch { return true; }
  }
  // cnOpen() 返回布尔，ttlOf() 收 'open'/'closed' 字符串——调用点统一在这里换算
  const cnTTL = () => ttlOf(cnOpen() ? 'open' : 'closed');

  /* ==================== 2. EM 专用熔断（照抄 history.js:66-74 的机制） ====================
     只在「请求本身失败」（网络错/HTTP 非 2xx）时烧熔断——EM 的 WAF 封禁表现为连接重置；
     「应答健康但没有保留档」（全空）是正常数据条件，不该拦 30s 重试。 */
  let eastDownUntil = 0;
  let eastFails = 0;
  const eastOK = () => Date.now() >= eastDownUntil;
  function eastFailed() {
    eastFails++;
    // 1 次失败等 30s，连续失败指数退避到最多 10 分钟——别把 WAF 惹得更久
    eastDownUntil = Date.now() + Math.min(600000, 30000 * Math.pow(2, eastFails - 1));
  }
  function eastSucceeded() { eastFails = 0; eastDownUntil = 0; }

  /* ==================== 3. EM ulist 批量报价 ==================== */

  function ulistURL(secs) {
    // URL 对象组装（同 tencent.getMinute 惯例：参数值不进入地址字符串拼接）
    const u = new URL(EM_HOST + '/api/qt/ulist.np/get');
    u.searchParams.set('fltt', '2');
    u.searchParams.set('invt', '2');
    u.searchParams.set('secids', secs.join(','));
    u.searchParams.set('fields', ULIST_FIELDS);
    return u.href;
  }
  const secidOK = (s) => CFFEX_SECID_RE.test(s) || IDX_SECID_RE.test(s);

  // 白名单逐个校验 + 批量上限（拼 URL 前的最后闸门），返回 diff 数组；空集合不发请求
  async function fetchUlist(secs) {
    const ok = (Array.isArray(secs) ? secs : []).filter(secidOK).slice(0, ULIST_BATCH);
    if (!ok.length) return [];
    const j = await request(ulistURL(ok));
    const diff = j && j.data && j.data.diff;
    return Array.isArray(diff) ? diff : [];
  }

  // f14 有效名（非空、非 '-'）：上市即有名字，闭市/无成交时 f2 才是 '-'
  const hasName = (row) => {
    const n = row && row.f14;
    return n !== undefined && n !== null && String(n).trim() !== '' && String(n) !== '-';
  };

  /* ---------- 中金所期权链 cffexChain({kind, month}) ----------
     返回 { rows:[{strike, call, put}], underlying:{name, price}, via:'eastmoney', updatedAt }
     入参不合法 / 全空 / 请求失败 → null（全空与失败都登记 SourceState.fail）。 */
  async function cffexChain({ kind, month } = {}) {
    /* 入参闸门（两层）：正则白名单 → 查表/数字重建。
       ⚠️ month 必须显式要求字符串：MONTH_RE.test(2611) 会被隐式 String 化放过去。
       k/m 是后续拼接唯一允许的来源：k 来自 KIND_TOKEN 常量表，m 由 parseInt 重建。 */
    if (typeof kind !== 'string' || typeof month !== 'string') return null;
    const k = KIND_TOKEN[kind];
    if (!k) return null;
    const m = String(parseInt(month, 10));           // 数字重建：丢弃一切非数字形态
    if (!MONTH_RE.test(m)) return null;
    const curYY = shParts(new Date()).y % 100;
    const yy = parseInt(m.slice(0, 2), 10);
    if (yy < curYY - 1 || yy > curYY + 2) return null;   // 年份窗口 yy ∈ [当前YY-1, 当前YY+2]

    const chainKey = 'opt:cffex:' + k + ':' + m;
    const gridKey = 'opt:grid:' + k + ':' + m;

    // ① 缓存读：命中直接返回存值（updatedAt 即原抓取时刻，fmtAgo 显示的年龄就是缓存年龄）
    const hit = Cache.get(chainKey, cnTTL());
    if (hit) return hit.val;

    // ② 熔断检查（EM 专用）：窗口内不打 EM，直接走缓存兜底
    if (!eastOK()) {
      const raw = Cache.raw(chainKey);
      if (raw && raw.val) return raw.val;
      window.SourceState.fail('option', 'eastmoney: 熔断窗口内跳过请求（WAF 退避）');
      return null;
    }

    // ③ 请求集合：网格缓存（24h，键含 month，换月自然失效）命中 → 只刷保留档；
    //    未命中 → 探测（先取标的 spot，再按 ±15% 网格 × [C,P] 全量枚举）
    const gridHit = Cache.get(gridKey, 24 * 3600000);
    let candSecids = gridHit ? gridHit.val : null;   // null = 探测路径，数组 = 保留档刷新路径

    const want = new Map();                // 期望 code → secid（保留判据 + 网格回写用）
    const rowsByStrike = new Map();        // strike → { strike, call, put }
    let uName = null, uPrice = null;       // 标的名称/现价（honest null）
    const ulySecid = UNDERLYING[k];
    const ulyCode = ulySecid.split('.')[1];
    const reserved = [];                   // 保留档 secids（成功后写网格缓存）

    try {
      if (!candSecids) {
        // 探测路径：1 个单 secid ulist 取标的 spot。无 spot → 探测无从谈起。
        const spotDiff = await fetchUlist([ulySecid]);
        const spotRow = spotDiff.find(r => String(r.f12 || '') === ulyCode);
        const spot = num(spotRow && spotRow.f2);
        if (spot === null) {
          window.SourceState.fail('option', 'eastmoney: 标的现价缺失，无法探测网格');
          return null;
        }
        if (hasName(spotRow)) uName = String(spotRow.f14);
        uPrice = spot;
        const step = stepOf(k, m);
        const secids = [];
        for (const st of strikeGrid(spot, step)) {
          for (const side of ['C', 'P']) {
            const secid = '221.' + k + m + '-' + side + '-' + st;
            if (CFFEX_SECID_RE.test(secid)) secids.push(secid);
          }
        }
        candSecids = secids;
      }
      for (const c of candSecids) {
        if (CFFEX_SECID_RE.test(c)) want.set(c.split('.')[1], c);   // '221.IO2611-C-4100' → 'IO2611-C-4100'
      }

      // ④ 分批串行请求（对 WAF 客气）。首个批次把标的 secid 放最前（underlying 同批刷新）。
      const reqAll = [ulySecid].concat(candSecids);
      for (let i = 0; i < reqAll.length; i += ULIST_BATCH) {
        const chunk = reqAll.slice(i, i + ULIST_BATCH);
        const diff = await fetchUlist(chunk);
        for (const row of diff) {
          const code = String(row.f12 || '');
          if (code === ulyCode) {                    // 标的行：last-write-wins
            if (hasName(row)) uName = String(row.f14);
            uPrice = num(row.f2);
            continue;
          }
          const secid = want.get(code);
          if (!secid) continue;                      // 请求集合之外的 code 一律丢弃
          if (!hasName(row)) continue;               // 保留判据：f12 精确匹配 && f14 有效名
          // 合约 code 自带语义：IO2612-C-4000 → IO / 2612 / 认购(C) / 行权价 4000
          const dash = code.lastIndexOf('-');
          const strike = Number(code.slice(dash + 1));
          if (!Number.isFinite(strike)) continue;
          const side = code.charAt(dash - 1) === 'C' ? 'call' : 'put';
          let r = rowsByStrike.get(strike);
          if (!r) { r = { strike, call: null, put: null }; rowsByStrike.set(strike, r); }
          r[side] = { price: num(row.f2), chgPct: num(row.f3), volume: num(row.f5), name: String(row.f14) };
          reserved.push(secid);
        }
      }
    } catch (e) {
      eastFailed();                                  // 请求失败才烧熔断（全空不算）
      window.SourceState.fail('option', 'eastmoney: ' + (e && e.message ? e.message : '请求失败'));
      return null;
    }

    // ⑤ 组装：任一侧保留的 strike 成行；全空 → 诚实空态
    if (!rowsByStrike.size) {
      window.SourceState.fail('option', 'eastmoney: 全空（' + k + m + ' 无保留档）');
      return null;
    }
    const rows = Array.from(rowsByStrike.values()).sort((a, b) => b.strike - a.strike);
    const val = {
      rows,
      underlying: { name: uName, price: uPrice },
      via: 'eastmoney',
      updatedAt: Date.now(),
    };
    // ⑥ 成功：熔断清零 + 状态登记 + 链值/网格双写（opt:* 不持久化，见文件头）
    eastSucceeded();
    window.SourceState.ok('option', 'eastmoney');
    Cache.set(chainKey, val);
    Cache.set(gridKey, reserved);
    return val;
  }

  /* ==================== 4. 加密期权链 cryptoChain({uly}) ==================== */

  // OKX 主路径：instruments（合约表，24h）→ tickers（报价）→ ticker（标的现价）
  // 参数 u/ccy/spotId 由 cryptoChain 查表传入（模块常量派生），非调用方字符串本体
  async function okxPath(u, ccy, spotId) {
    // ① 合约表：OKX_INSTID_RE 过滤（弃 _UM）；过滤后为空 → 交回 null 跳 Deribit
    let inst = Cache.get('opt:inst:' + u, 24 * 3600000);
    if (!inst) {
      const j = await request(okxURL('/api/v5/public/instruments', { instType: 'OPTION', uly: u }));
      if (!j || j.code !== '0' || !Array.isArray(j.data)) throw new Error('okx instruments bad payload');
      const ids = j.data.map(x => String(x.instId || '')).filter(id => OKX_INSTID_RE.test(id));
      if (!ids.length) return null;
      inst = {
        ids,
        expiries: Array.from(new Set(ids.map(id => id.split('-')[2].slice(0, 4)))).sort(),
      };
      Cache.set('opt:inst:' + u, inst);
    } else {
      inst = inst.val;
    }

    // ② tickers：map instId → {price, volume}。last 可以是 ""（深度虚值实测）→ price null 仍保留；
    //    过滤集内仍混 _UM 行，OKX_INSTID_RE 二次过滤不可省。
    const t = await request(okxURL('/api/v5/market/tickers', { instType: 'OPTION', uly: u }));
    if (!t || t.code !== '0' || !Array.isArray(t.data)) throw new Error('okx tickers bad payload');
    const tm = new Map();
    for (const r of t.data) {
      if (!OKX_INSTID_RE.test(String(r.instId || ''))) continue;
      tm.set(String(r.instId), { price: num(r.last), volume: num(r.vol24h) });
    }

    // ③ 标的现价（/api/v5/market/index 三种参数实测 404，不可用）；spotId 查表自 SPOT_TOKEN
    const s = await request(okxURL('/api/v5/market/ticker', { instId: spotId }));
    if (!s || s.code !== '0' || !Array.isArray(s.data) || !s.data.length) {
      throw new Error('okx spot ticker bad payload');
    }
    const spot = num(s.data[0].last);

    // ④ 组装：候选 = 合约表 instId 集合；保留 (expiry,strike) 当且仅当任一侧在 tickers 有行。
    //    mark 恒 null——OKX 全家没有 mark 字段（2026-10-23 逐字段核验），不许拿 mid 冒充。
    const byKey = new Map();
    for (const id of inst.ids) {
      const q = tm.get(id);
      if (!q) continue;
      const p = id.split('-');                       // [BTC, USD, YYMMDD, strike, C/P]
      const expiry = p[2].slice(0, 4);
      const strike = Number(p[3]);
      const key = expiry + '|' + strike;
      let row = byKey.get(key);
      if (!row) { row = { expiry, strike, call: null, put: null }; byKey.set(key, row); }
      row[p[4] === 'C' ? 'call' : 'put'] =
        { price: q.price, mark: null, volume: q.volume, name: id };
    }
    if (!byKey.size) return null;
    const rows = Array.from(byKey.values()).sort((a, b) =>
      a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : b.strike - a.strike);
    return {
      rows,
      underlying: { name: ccy, price: spot },
      via: 'okx',
      updatedAt: Date.now(),
    };
  }

  // Deribit 兜底路径：book_summary 一包全给（mark_price/OI/IV 都有，OKX 没有）
  async function deribitPath(ccy) {
    const du = new URL(DERIBIT_HOST + '/api/v2/public/get_book_summary_by_currency');
    du.searchParams.set('currency', ccy);            // URL 对象组装，同 tencent.getMinute 惯例
    du.searchParams.set('kind', 'option');
    const j = await request(du.href);
    const list = (j && Array.isArray(j.result)) ? j.result : [];
    const byKey = new Map();
    let spot = null;                                 // num(任一行的 underlying_price)
    for (const r of list) {
      if (spot === null) spot = num(r.underlying_price);
      const m = DERIBIT_NAME_RE.exec(String(r.instrument_name || ''));
      if (!m) continue;
      const expiry = m[4] + MON[m[3]];               // '24OCT26' → '26' + '10' = '2610'
      const strike = Number(m[5]);
      const key = expiry + '|' + strike;
      let row = byKey.get(key);
      if (!row) { row = { expiry, strike, call: null, put: null }; byKey.set(key, row); }
      row[m[6] === 'C' ? 'call' : 'put'] = {
        price: num(r.last), mark: num(r.mark_price),
        volume: num(r.volume), name: String(r.instrument_name),
      };
    }
    if (!byKey.size) return null;
    const rows = Array.from(byKey.values()).sort((a, b) =>
      a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : b.strike - a.strike);
    return {
      rows,
      underlying: { name: ccy, price: spot },
      via: 'deribit',
      updatedAt: Date.now(),
    };
  }

  async function cryptoChain({ uly } = {}) {
    /* 入参闸门（两层）：ULY_RE 白名单 → 查表取常量。u/spotId/ccy 全部来自模块常量表，
       后续 URL 拼接不出现调用方字符串本体（同 cffexChain 的纵深防御说明）。 */
    const u = ULY_TOKEN[uly === undefined || uly === null ? '' : uly];
    if (!u) return null;                              // 非白名单成员：null 且零请求
    const spotId = SPOT_TOKEN[u];                     // 'BTC-USD' → 'BTC-USDT'
    const ccy = u.split('-')[0];                      // 常量的派生值
    const key = 'opt:crypto:' + u;

    const hit = Cache.get(key, ttlOf('open'));       // crypto 无闭市，恒 30s
    if (hit) return hit.val;

    let val = null;
    try { val = await okxPath(u, ccy, spotId); } catch { val = null; }   // OKX 网络失败 → 兜底
    if (!val) {
      try { val = await deribitPath(ccy); } catch { val = null; }
    }
    if (val) {
      Cache.set(key, val);
      window.SourceState.ok('option', val.via);
      return val;
    }
    // 两源皆败：缓存兜底（同会话内存），再不行诚实空态
    const raw = Cache.raw(key);
    if (raw && raw.val) return raw.val;
    window.SourceState.fail('option', 'okx+deribit: ' + u + ' 双源失败');
    return null;
  }

  /* ==================== 5. 统一入口 chain({kind, month}) ====================
     UI 只认这一个入口：kind 是加密 uly（BTC-USD/ETH-USD）走 cryptoChain，
     否则按中金所品种走 cffexChain。分流在这里做，UI 不再各自直连两条链
     （同 tencent.getKline 的编排层惯例：入口只做分流与兜底，请求细节在里层）。 */
  async function chain({ kind, month } = {}) {
    const k = String(kind === undefined || kind === null ? '' : kind);
    if (ULY_RE.test(k)) return cryptoChain({ uly: k });
    return cffexChain({ kind: k, month });
  }

  return {
    // 常量与白名单正则
    KINDS, UNDERLYING, KIND_RE, MONTH_RE, CFFEX_SECID_RE, IDX_SECID_RE, ULY_RE,
    OKX_INSTID_RE, DERIBIT_NAME_RE, EM_HOST, ULIST_FIELDS, ULIST_BATCH,
    PROBE_PCT, STEP_NEAR, STEP_FAR, MON,
    // 纯函数
    monthsOf, strikeGrid, stepOf, ttlOf, cnOpen,
    // 熔断探针（T11 用；与 history.js:325 的 eastHealthy 同款）
    eastHealthy: eastOK,
    // 唯一链入口（UI/测试都用它；cffexChain/cryptoChain 是模块私有实现——
    // 导出面最小化：外部拿不到任何直接含网络请求的函数）
    chain,
  };
})();

window.OptionSource = OptionSource;
