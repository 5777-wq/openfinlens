/* app.js —— 入口：调度器 / 视图路由 / 渲染 / 降级链
   降级链（按实测可用性适配后的实际链路）：
     A股·港股·美股·全球指数 : tencent → eastmoney(secid) → 缓存
     A股全市场（热力图）      : eastmoney clist → tencent(精选兜底) → 缓存
     加密                    : binance(data-api.binance.vision) → okx → 缓存
     外汇 / 商品 / 宏观利率   : eastmoney secid → sina(需代理) → 缓存
     新闻                    : sina roll(JSONP) → eastmoney news → 缓存(60s)
     研报                    : eastmoney reportapi → 缓存(10min) → 隐藏研报区
   轮询一律用 setTimeout 链 + visibilitychange 暂停，动画一律 rAF。
*/

(function () {
  'use strict';

  const U = window.U;
  const { fmt, fmtPct, fmtChg, fmtPrice, fmtVol, fmtTime, fmtAgo, escapeHTML, num, Cache, debounce } = U;

  /* 品牌强调色的 RGB 分量（= css 的 --accent-rgb，供需要 alpha 合成的内联样式用）。
     不要在业务代码里再写字面量 rgba(…)：改色时它一定会漂。 */
  const ACCENT_RGB = (getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb') || '').trim() || '232,163,61';

  const state = {
    tab: 'all',
    view: 'market',
    prevView: 'market',
    quotes: new Map(),        // symbol → quote
    degraded: new Map(),      // symbol → 'backup' | 'cache'
    heatMode: 'cn',
    heatSize: 'cap',
    heatTopMode: 'top',    // A股热力图范围：top=市值 Top500（默认）| all=全市场
    // 每个市场的全量行：hk/us 同时供"热力图"与"市场宽度"共用（us 原本就为宽度而抓）
    heatItems: { cn: [], hk: [], us: [], crypto: [] },
    // 按视图分开记录来源状态：单槽位会被后加载的源覆盖，导致来源标注张冠李戴
    heatVia: { cn: null, hk: null, us: null, crypto: null },
    heatCachedAt: { cn: null, hk: null, us: null, crypto: null },
    heat: null,
    heatFetchedAt: 0,         // 全市场最近一次成功抓取时间（情绪页保活判断用）
    news: [],
    newsMkt: 'all',
    newsCat: 'all',            // 新闻产业链板块过滤（链 id / macro / all）
    watchSort: 'default',      // 自选排序：default | pctDesc | pctAsc
    newsVia: null,
    newsCachedAt: null,
    newsLoadedAt: 0,
    reports: [],
    chainQuotes: new Map(),
    watchQuotes: new Map(),   // 自选里"轮询全集之外"的标的行情（自选孤岛修复）
    openLinks: new Set(),
    openChains: new Set(),   // 热度表中展开的板块
    breadth: null,
    breadthAt: null,
    breadthHist: [],          // 情绪逐日快照（localStorage 持久化，来源 Store.breadthHist）
    pushed: 0,                // 本会话 pushState 次数（详情返回按钮判断能否 history.back）
    hashLock: false,          // 编程式改 hash 时抑制一次 hashchange（pushState 不可用的回退路径）
    detail: null,             // { symbol, name, code, market, secid, tencent, binance }
    chartGen: 0,              // 图表请求代号（防慢响应覆盖新图）
    searchGen: 0,             // 搜索请求代号（同理，防旧关键词结果覆盖新输入）
    detailPeriod: 'day',       // 用户要求：默认打开日K
    detailMACfg: null,         // 均线配置 {ma5,ma10,ma20,ma60,ema12,ema26}，init 时从 localStorage 读
    chart: null,
    chartKind: null,
    searchSel: -1,
    searchItems: [],
    searchKw: null,           // 与 searchItems 对应的关键词（Enter 防旧词选错）
    newsFilterKey: null,      // 上次新闻渲染的过滤键（增量插入判断用）
    boardItems: [], boardLoadedAt: 0, boardVia: null,
    boardOpenBk: null, boardStocks: [], boardGen: 0,
    voices: null, voicesAt: 0, voicesGen: 0, globeQuotes: null,
    events: null, eventsVia: null, eventsGenAt: null, eventsStale: true, eventsLoadedAt: 0,
    eventsSub: Store.get('evMode', 'map'),     // 事件页子视图：map（平面地图）| news（实时快讯）；存量 'globe' 由 setEventsSub 归一
    eventsType: 'all',         // 事件类型过滤（all / macro / central_bank / …）
    eventsSource: '',          // 数据源名（状态行合成用）
    mapStatusPts: null,        // 平面地图点数状态（onStatus 回调），与数据源状态行合并显示
    selEvent: null,            // 当前选中的全球事件
    mapReady: false,           // 平面地图实例化完成标记
    mapFailed: false,          // 地图数据/Canvas 不可用：不再反复初始化
    countryFocus: null,        // { iso2, name }——平面地图点空白命中的国家（右侧国家详情）
    lhb: null, lhbAt: 0,       // A股龙虎榜（东财直连，日频披露）
    actors: null, actorsAt: 0, actorsDate: null,   // 席位目录（当日 LHB 明细聚合）
    actor: null, actorGen: 0,  // 当前打开的席位档案
    pendingActivity: null,     // 从席位档案点进个股时携带的活动（K线上画席位标记）
    stockNames: (function () { try { return window.Store.get('stockNames', {}) || {}; } catch { return {}; } })(),
    brk: null, brkAt: 0,       // 多家机构 13F 持仓（SEC 采集静态 JSON，季度）
    brkIdx: 0,                 // 13F 当前选中的机构下标（面板上的机构按钮）
    // 港股通（南向）持有个股：日频，浏览器直连（datacenter 带 CORS，无需采集层）
    southbound: null, southboundDate: null, southboundAt: 0,
    // A股 基金持仓变动（东财采集静态 JSON，季度）：fundDir = add | trim
    fundHolds: null, fundHoldsAt: 0, fundDir: 'add',
    // 美股 因子 ETF 持仓（Invesco 采集静态 JSON，日更）：etfSub = spmo | splv | both
    etf: null, etfAt: 0, etfSub: 'spmo',
    chartEventsOn: true,       // 详情页 K 线事件标记开关
    // Movers 三榜的行载荷（data-symbol → 全市场行）：行不在 universe 轮询全集里，
    // 点击进详情需要 secid/market 映射，渲染时顺手登记
    moversRows: new Map(),
    lastUpdate: null,
    timers: {},
    stopped: false,
  };

  const $ = (id) => document.getElementById(id);
  const el = {};
  const DOM_IDS = ['tabs', 'cardWall', 'watchWall', 'marketSub', 'selftestOut', 'selftest',
    // 吸顶跑马条 + Movers 三榜（2026-09-17）
    'tape', 'moversSection', 'moversGrid', 'moversTitle', 'moversSub',
    // 首屏下方的「我的自选」块与全球涨跌概览条
    'watchSection', 'watchGrid', 'watchSub', 'watchMore', 'globeSum',
    'heatCanvas', 'heatTip', 'heatWrap', 'heatSection', 'heatSub', 'heatSizeToggle', 'heatTopToggle',
    'heatReset', 'heatZoom', 'heatHint',
    'newsList', 'newsSub', 'chainList', 'chainSub',
    'boardStrip', 'boardVia', 'boardDrawer',
    'moodSub', 'moodScore', 'moodBand', 'moodFill', 'breadthGrid', 'distWrap', 'distSub', 'moodSpark', 'heroStrip', 'moodCrypto', 'moodUS',
    'searchInput', 'searchResults', 'settingsBtn', 'settingsModal', 'settingsClose',
    'segUpdown', 'segRefresh', 'swDegraded', 'sourceStatus', 'updatedLine',
    'detailName', 'detailCode', 'detailPrice', 'detailChg', 'detailStar', 'detailStats',
    'detailBack', 'klineChart', 'chartBox', 'detailInsight', 'maToggle', 'intradaySeg',
    'globeBar', 'macroBox', 'voicesList', 'voicesSub', 'newsCatBar',
    'eventsSub', 'globeStatus', 'mapLegend',
    'evGlobePane', 'evNewsPane', 'evTypeBar', 'eventList', 'eventDetail', 'mapStage',
    'mapLayers', 'countryDetail',
    'lhbBox', 'lhbVia', 'evtToggle', 'chartEventCard',
    'seatDir', 'seatDirVia',
    'brkBox', 'brkVia', 'marketTitle', 'globalOverview', 'moodPanel',
    'aFundsPanel', 'usFundsPanel', 'hkFundsPanel', 'sbBox', 'sbVia',
    'cryptoMoodPanel', 'usMoodPanel', 'fundBox', 'fundVia', 'etfBox', 'etfVia',
    'actorBack', 'actorName', 'actorType', 'actorMeta', 'actorStats', 'actorStatsSub', 'actorTimeline',
    // 基金对比：视图模块自己持有这些节点的引用（app.js 只负责在 init 时把节点交出去）
    'cmpBar', 'cmpInput', 'cmpResults', 'cmpAdd', 'cmpStatus', 'cmpRetry', 'cmpPresets',
    'cmpChips', 'cmpChipsSub', 'cmpSub', 'cmpStart', 'cmpEnd', 'cmpQuick', 'cmpLog', 'cmpNormHint',
    'cmpChartBox', 'cmpChart', 'cmpLegend', 'cmpMetrics', 'cmpMetricsSub', 'cmpYearly', 'cmpCorr', 'cmpNote',
    // 到价提醒（AlertCenter 视图模块，alerts.js）
    'alertBell', 'alertPanel', 'alertBadge', 'alertPerm', 'alertList', 'alertHint',
    'alertModal', 'alertModalTarget', 'alertDir', 'alertPrice', 'alertNote',
    'alertCancel', 'alertSave', 'alertDetailBtn'];

  const pctClass = (p) => (p === null || p === undefined || isNaN(p)) ? 'flat' : (p > 0 ? 'up' : p < 0 ? 'down' : 'flat');
  // 缓存 matchMedia 结果：渲染期每张卡片查 2 次，整墙渲染就是上百次 matchMedia 调用
  const _rmMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let _rmVal = _rmMQ.matches;
  if (_rmMQ.addEventListener) _rmMQ.addEventListener('change', (e) => { _rmVal = e.matches; });
  const reduceMotion = () => _rmVal;

  /* ---- 加密内容内部开关（界面上没有任何入口；为微信小程序合规预留）----
     默认开。联调/合规场景：URL 带 ?crypto=off 关闭（写入本机记住），?crypto=on 重新打开，
     或直接 localStorage['ofl:crypto']='off'。关闭后加密 tab/卡片/热力图/宽度/新闻/详情
     全部隐藏，其余功能不受影响；界面上不出现任何开关入口。 */
  const CRYPTO_ON = (() => {
    try {
      const q = location.search || '';
      if (/[?&]crypto=off/.test(q)) localStorage.setItem('ofl:crypto', 'off');
      if (/[?&]crypto=on/.test(q)) localStorage.removeItem('ofl:crypto');
      return localStorage.getItem('ofl:crypto') !== 'off';
    } catch { return true; }
  })();
  if (!CRYPTO_ON) document.body.classList.add('no-crypto');

  // 自选 symbol 集合：渲染一批卡片前取一次，避免每卡 has() → JSON.parse(localStorage)
  let watchSet = new Set();
  function refreshWatchSet() {
    watchSet = new Set(window.Store.watchlist.all().map(x => x.symbol));
  }

  /* ---- LOGO：加密=本地化开源图标集(MIT)；美股=域名 favicon(免密钥)；A股无稳定免费源，不造假 ---- */
  const US_DOMAINS = {
    'usAAPL': 'apple.com', 'usNVDA': 'nvidia.com', 'usMSFT': 'microsoft.com', 'usTSLA': 'tesla.com',
    'usAMZN': 'amazon.com', 'usGOOG': 'google.com', 'usMETA': 'meta.com', 'usAVGO': 'broadcom.com',
    'usAMD': 'amd.com', 'usQCOM': 'qualcomm.com', 'usINTC': 'intel.com', 'usTSM': 'tsmc.com',
    'usASML': 'asml.com', 'usAMAT': 'appliedmaterials.com', 'usLRCX': 'lnvtx.com', 'usPLTR': 'palantir.com',
    'usENPH': 'enphase.com', 'usFSLR': 'firstsolar.com', 'usSEDG': 'solaredge.com', 'usFLNC': 'fluenceenergy.com',
    'usPFE': 'pfizer.com', 'usMRK': 'msd.com', 'usJNJ': 'jnj.com', 'usLMT': 'lockheedmartin.com',
    'usRTX': 'rtx.com', 'usNOC': 'northropgrumman.com', 'usCHPT': 'chargepoint.com',
    'usNIO': 'nio.com', 'usXPEV': 'xiaopeng.com', 'usLI': 'lixiang.com',
  };
  function logoURL(q) {
    if (!q) return null;
    if (q.market === 'crypto') {
      const base = String(q.code || q.symbol || '').replace(/USDT$/i, '').toLowerCase();
      return base ? 'assets/icons/crypto/' + base + '.svg' : null;
    }
    if (/^us/i.test(q.symbol || '') && US_DOMAINS[q.symbol]) {
      return 'https://www.google.com/s2/favicons?domain=' + US_DOMAINS[q.symbol] + '&sz=64';
    }
    return null;
  }
  function logoImg(q, cls) {
    const url = logoURL(q);
    return url ? `<img class="${cls}" src="${escapeHTML(url)}" alt="" loading="lazy"
      onerror="this.remove()">` : '';
  }

  /* ==================== 行情抓取（含降级链） ==================== */

  const TENCENT_SYMS = window.TENCENT_UNIVERSE.map(x => x.symbol);
  const EM_SECIDS = window.EM_UNIVERSE.map(x => x.secid);
  const LABELS = new Map();
  window.TENCENT_UNIVERSE.forEach(x => LABELS.set(x.symbol, x));
  window.EM_UNIVERSE.forEach(x => LABELS.set(x.symbol, x));

  // 腾讯 symbol → 东财 secid（备源）
  function toSecid(sym) {
    if (/^sh/.test(sym)) return '1.' + sym.slice(2);
    if (/^(sz|bj)/.test(sym)) return '0.' + sym.slice(2);
    if (/^hk/.test(sym)) return '116.' + sym.slice(2);
    if (/^us/.test(sym)) return '105.' + sym.slice(2);
    return null;
  }

  function mergeQuotes(list, { via }) {
    list.forEach(q => {
      const meta = LABELS.get(q.symbol);
      if (meta && meta.group) q.group = meta.group;
      else q.group = q.group || q.market;
      if (meta && meta.label) q.name = meta.label;
      state.quotes.set(q.symbol, q);
      Cache.set('q:' + q.symbol, q);
      if (via === 'primary') state.degraded.delete(q.symbol);
      else state.degraded.set(q.symbol, via);
    });
  }

  // 缓存兜底：把还没有数据的 symbol 用缓存补上，并打 cache 角标
  function fillFromCache(symbols) {
    symbols.forEach(sym => {
      if (state.quotes.has(sym)) return;
      const c = Cache.raw('q:' + sym);
      if (!c) return;
      const q = Object.assign({}, c.val, { cachedAt: c.at });
      state.quotes.set(sym, q);
      state.degraded.set(sym, 'cache');
    });
  }

  async function fetchStocks() {
    let list = await window.TencentSource.getQuotes(TENCENT_SYMS);
    if (list.length) {
      mergeQuotes(list, { via: 'primary' });
      const missing = TENCENT_SYMS.filter(s => !list.some(q => q.symbol === s));
      if (missing.length) await fetchStocksBackup(missing);
    } else {
      await fetchStocksBackup(TENCENT_SYMS);
    }
    fillFromCache(TENCENT_SYMS);
  }

  async function fetchStocksBackup(symbols) {
    const map = new Map();
    symbols.forEach(s => { const id = toSecid(s); if (id) map.set(id, s); });
    if (!map.size) return;
    const backup = await window.EastmoneySource.getQuotes(Array.from(map.keys()));
    if (!backup.length) return;
    // 把东财结果映射回统一 symbol
    const remapped = backup.map(q => Object.assign({}, q, { symbol: map.get(q.secid) || q.symbol }));
    mergeQuotes(remapped, { via: 'backup' });
  }

  async function fetchEmGroups() {
    const list = await window.EastmoneySource.getQuotes(EM_SECIDS);
    if (list.length) mergeQuotes(list, { via: 'primary' });
    else {
      // 备源：新浪（需代理）。新浪的 symbol 空间（fx_susdcny/hf_GC…）与 EM 卡片完全不同，
      // 必须重映射到统一 symbol，否则会生成内容重复的"孤儿卡"且 EM 卡片永远只能靠缓存
      const sina = await window.SinaSource.getQuotes(['fx_susdcny', 'fx_seurusd', 'fx_sgbpusd', 'hf_GC', 'hf_CL', 'hf_SI']);
      const SINA_TO_EM = {
        fx_susdcny: 'EM:133.USDCNH', fx_seurusd: 'EM:119.EURUSD', fx_sgbpusd: 'EM:119.GBPUSD',
        hf_GC: 'EM:101.GC00Y', hf_CL: 'EM:102.CL00Y', hf_SI: 'EM:101.SI00Y',
      };
      const remapped = sina
        .map(q => SINA_TO_EM[q.symbol] ? Object.assign({}, q, { symbol: SINA_TO_EM[q.symbol] }) : null)
        .filter(Boolean);
      if (remapped.length) mergeQuotes(remapped, { via: 'backup' });
    }
    fillFromCache(window.EM_UNIVERSE.map(x => x.symbol));
  }

  async function fetchCrypto() {
    if (!CRYPTO_ON) return;   // 合规开关关闭：不轮询币安/OKX
    const want = window.CRYPTO_FEATURED;
    let list = await window.BinanceSource.getQuotes(want);
    let via = 'primary';
    if (!list.length) {
      list = await window.OkxSource.getQuotes(want);
      via = 'backup';
    }
    if (list.length) mergeQuotes(list, { via });
    fillFromCache(want);
  }

  // 自选里不在轮询全集（TENCENT_SYMS / EM_SECIDS / CRYPTO_FEATURED）内的标的：
  // 从搜索加入自选的冷门股、从加密热力图加自选的非精选币，否则自选页永远显示 --（"自选孤岛"）
  async function fetchWatchQuotes() {
    const polled = new Set([...TENCENT_SYMS, ...EM_SECIDS, ...window.CRYPTO_FEATURED]);
    const extras = window.Store.watchlist.all()
      .map(w => w.symbol)
      .filter(s => s && !polled.has(s));
    if (!extras.length) { state.watchQuotes.clear(); return; }
    const emIds = extras.filter(s => s.startsWith('EM:')).map(s => s.slice(3));
    const tencentSyms = extras.filter(s => /^(sh|sz|bj|hk|us)/.test(s));
    const cryptoSyms = CRYPTO_ON ? extras.filter(s => /USDT$/i.test(s)) : [];
    const [em, tc, cc] = await Promise.all([
      emIds.length ? window.EastmoneySource.getQuotes(emIds).catch(() => []) : [],
      tencentSyms.length ? window.TencentSource.getQuotes(tencentSyms).catch(() => []) : [],
      cryptoSyms.length ? window.BinanceSource.getQuotes(cryptoSyms).catch(() => []) : [],
    ]);
    const m = new Map();
    [...em, ...tc, ...cc].forEach(q => {
      if (!q) return;
      m.set(q.symbol, q);
      Cache.set('q:' + q.symbol, q);   // 顺手进缓存，下次打开自选页有兜底
    });
    state.watchQuotes = m;
  }

  // in-flight 去重：调度器 tick 与 visibilitychange 回前台可能重叠触发，合并为一轮
  let _faq = null;
  function fetchAllQuotes() {
    if (_faq) return _faq;
    _faq = (async () => {
      await Promise.all([fetchStocks(), fetchEmGroups(), fetchCrypto(), fetchWatchQuotes()]);
      // 全部失败时不动 lastUpdate——"最后更新"不能说谎
      if (state.quotes.size) state.lastUpdate = Date.now();
    })().finally(() => { _faq = null; });
    return _faq;
  }

  // 时段徽章保活：跨过开收盘/午休/零点边界后原地重算，不等整墙重建
  function refreshSesChips() {
    document.querySelectorAll('.ses-chip[data-ses]').forEach(ch => {
      const s = window.Sessions.now(ch.dataset.ses);
      ch.className = 'ses-chip ' + window.Sessions.codeClass(s.code);
      ch.textContent = s.label;
    });
  }

  // 行情轮询单次 tick（startScheduler 与"设置-刷新间隔"两处共用，改间隔不丢行为）
  async function quotesTick() {
    await fetchAllQuotes();
    patchHero();
    patchTape();
    // 到价提醒判定（读缓存行情，不发请求）
    if (window.AlertCenter) window.AlertCenter.check();
    if (state.view === 'market') { patchCards(el.cardWall); refreshSesChips(); }
    if (state.view === 'watch') patchCards(el.watchWall);
    if (state.view === 'detail') {
      refreshDetailQuote();
      // 停在分时页时分钟线跟着刷新（chartGen 守卫保证不与手动切换打架）
      if (state.detailPeriod === 'min') loadDetailChart();
    }
    renderStatus();
  }

  /* ==================== 卡片渲染 ==================== */

  function groupsForTab(tab) {
    const map = {
      // "全部"只做总览：指数 + 热力图 + 情绪。各市场的 4~6 行残桩在"全部"页没有操作价值
      // （用户反馈"这些其实在全部没必要显示"），每个市场都有自己的 tab 给全量列表。
      all: ['index'],
      cn: ['index', 'cn'],
      hk: ['index', 'hk'],
      us: ['index', 'us'],
      crypto: CRYPTO_ON ? ['crypto'] : [],
      fxmacro: ['fx', 'commodity', 'macro'],
    };
    return map[tab] || map.all;
  }

  /* index 组的行本来就是按市场归的（universe.js 里的注释即"A股指数"/"美股指数"），
     只有"全部" tab 才配得上"全球指数"这个标题。分市场 tab 上沿用全球指数既名不副实，
     又让人以为混进了别市场的数据（用户反馈）。 */
  function groupLabel(g, tab) {
    if (g.key === 'index') {
      if (tab === 'cn') return 'A股指数';
      if (tab === 'hk') return '港股指数';
      if (tab === 'us') return '美股指数';
    }
    return g.label;
  }

  // 行式行情表（去 AI 卡片墙的核心动作）：hairline 行 + 右对齐 mono 数字
  function rowHTML(q, animate = true, idx = 0) {
    const starred = watchSet.has(q.symbol);
    const deg = state.degraded.get(q.symbol);
    const showDeg = window.Store.settings.get().showDegraded && deg;
    const cls = pctClass(q.changePct);
    const isFxMacro = q.market === 'macro' || q.market === 'fx';
    const digits = isFxMacro ? 4 : U.priceDigits(q.price);
    const price = fmt(q.price, digits);
    const chgTxt = fmtChg(q.change, digits);
    const pctTxt = fmtPct(q.changePct);
    const degTitle = deg === 'cache'
      ? '数据来自缓存 · ' + fmtTime(q.cachedAt || q.updatedAt)
      : '数据来自备用源';
    const amt = q.amount ? fmtVol(q.amount) : '--';   // 成交额缺失显示 --，不用成交量顶替（量纲不同）
    const delay = (!animate || reduceMotion()) ? 0 : Math.min(idx, 12) * 60;
    return `<div class="qrow${animate && !reduceMotion() ? ' stagger-in' : ''}" data-symbol="${escapeHTML(q.symbol)}"
        tabindex="0" role="button" aria-label="${escapeHTML(q.name)} 详情"
        style="animation-delay:${delay}ms">
        <div class="qr-name-wrap" style="min-width:0">
          <div class="qr-name">${logoImg(q, 'qlogo')}${showDeg ? '<span class="qc-flag" title="' + escapeHTML(degTitle) + '">' + (deg === 'cache' ? '缓存' : '备源') + '</span>' : ''}${escapeHTML(q.name)}</div>
          <div class="qr-code">${escapeHTML(q.code || q.symbol)}</div>
        </div>
        <span class="qr-price num" data-price="${escapeHTML(q.symbol)}">${price}</span>
        <span class="qr-chg num ${cls}">${chgTxt}</span>
        <span class="qr-pct num ${cls}">${pctTxt}</span>
        <span class="qr-amt num">${amt}</span>
        <button class="star${starred ? ' on' : ''}" data-star="${escapeHTML(q.symbol)}"
          title="${starred ? '取消自选' : '加入自选'}" aria-label="${starred ? '取消自选' : '加入自选'}"
          aria-pressed="${starred}">${starred ? '★' : '☆'}</button>
      </div>`;
  }

  const QROW_HEAD = '<div class="qrow-head" aria-hidden="true">' +
    '<span class="qh-name">名称 / 代码</span><span>现价</span><span>涨跌</span><span>涨跌幅</span><span>成交额</span><span></span></div>';

  function renderCardWall(animate = true) {
    const tab = state.tab;
    refreshWatchSet();
    const groups = groupsForTab(tab);
    const tabFilter = { cn: 'cn', hk: 'hk', us: 'us', crypto: 'crypto', fxmacro: 'fxmacro' }[tab];
    let html = '';
    let secNo = 0;

    window.GROUP_META.forEach(g => {
      if (!groups.includes(g.key)) return;
      let items = Array.from(state.quotes.values()).filter(q => (q.group || q.market) === g.key);
      if (tabFilter) {
        // 严格归属过滤：A股 tab 只见 universe 里 tab:'cn' 的行（修复"全球指数粘在每个板块"）；
        // 加密组本身全是币安标的（无 universe 元数据），整组天然纯净，直接放行
        items = items.filter(q => {
          if (g.key === 'crypto') return true;
          const meta = LABELS.get(q.symbol);
          return !!meta && meta.tab === tabFilter;
        });
      }
      if (!items.length) return;
      items.sort((a, b) => orderOf(a) - orderOf(b));
      // 开闭市徽章（session clock）——解释"为什么这个市场不刷新"
      // index 组混着沪/港/美指数，单一徽章必然张冠李戴 → 不显示
      const sesMkt = { cn: 'cn', hk: 'hk', us: 'us', crypto: 'crypto' }[g.key];
      const ses = sesMkt ? window.Sessions.now(sesMkt) : null;
      const sesHtml = ses
        ? `<span class="ses-chip ${window.Sessions.codeClass(ses.code)}" data-ses="${sesMkt}" title="按交易所常规时段计算，不含节假日休市">${ses.label}</span>`
        : '';
      secNo += 1;
      html += `<div class="section"><div class="section-head">
          <span class="sec-no">0${secNo}</span>
          <h2 class="section-title">${groupLabel(g, tab)}</h2>
          <span class="sec-line"></span>
          ${sesHtml}
          <span class="section-sub">${items.length}</span>
        </div><div class="card-grid">${QROW_HEAD}${items.map((q, i) => rowHTML(q, animate, i)).join('')}</div></div>`;
    });

    if (!html) html = '<div class="empty">数据加载中，或该分类数据源维护中…</div>';
    el.cardWall.innerHTML = html;
    // 两栏只在板块够多时才划算：本波起"全部"tab 只剩指数块，A股/港股/美股/宏观 各 2~3 块，
    // 兜两栏会让矮的那块独占一栏、另一侧整片留白（实测 A股 tab）。≥4 块才开两栏。
    el.cardWall.dataset.cols = secNo >= 4 ? '2' : '1';
    if (animate) clearStagger(el.cardWall);
  }

  /* ---- hero：一屏唯一的大数字 = **全球核心指数**（上证 / 纳斯达克 / 标普500 / 恒生）。
     历史：2026-09-15 曾按"归属操盘手"把 hero 让给自选（用户反馈①第二小波）；
     2026-09-16 用户改主意——"全球 tag 下应该先显示上证、纳斯达克等全球指数，在下面再显示我的自选，
     怎么有自选就不显示全球指数了"。于是自选移到下面的独立板块（#watchSection），hero 固定为指数。
     BTC 不进 hero：加密有自己的 tab，且合规开关关闭时首屏不该残留加密内容。 */
  const HERO_KEYS = ['sh000001', 'usIXIC', 'usINX', 'hkHSI'];
  const HERO_SLOTS = 4;
  const HERO_FLAG = { 'sh000001': 'cn', 'usIXIC': 'us', 'usINX': 'us', 'hkHSI': 'hk' };
  // 等待数据时也显示中文名：裸 symbol（SH000001）是数据源内部代号，不该抛给用户
  const HERO_LABEL = { 'sh000001': '上证指数', 'usIXIC': '纳斯达克', 'usINX': '标普500', 'hkHSI': '恒生指数', 'BTCUSDT': '比特币' };

  /* symbol/market → 旗标代码。Flags.flag 对未知代码返回空串，所以不必穷举市场。 */
  function heroFlagCode(sym, market) {
    if (market === 'cn' || market === 'hk' || market === 'us') return market;
    if (/^(sh|sz)/i.test(sym)) return 'cn';
    if (/^hk/i.test(sym)) return 'hk';
    if (/^us/i.test(sym)) return 'us';
    return '';
  }

  function heroKeys() {
    return HERO_KEYS.slice(0, HERO_SLOTS);
  }

  function heroCellHTML(sym) {
    const q = findQuote(sym);
    const flag = window.Flags ? window.Flags.flag(heroFlagCode(sym, q && q.market)) : '';
    const label = (q && q.name) || HERO_LABEL[sym] || sym;
    if (!q) {
      return `<div class="hero-cell" data-symbol="${escapeHTML(sym)}"><div class="hero-label"><span>${flag}${escapeHTML(label)}</span></div>
        <div class="hero-value">——</div><div class="hero-chg">等待数据</div></div>`;
    }
    const digits = U.priceDigits(q.price);
    const cls = pctClass(q.changePct);
    const code = sym.startsWith('EM:') ? '' : escapeHTML(q.code || sym);
    const pos = window.Spark ? window.Spark.rangePos(q.price, q.low, q.high) : null;
    return `<div class="hero-cell" data-symbol="${escapeHTML(sym)}" tabindex="0" role="button" aria-label="${escapeHTML(q.name)} 详情">
      <div class="hero-label"><span>${flag}${logoImg(q, 'hero-logo-img')}${escapeHTML(q.name)}</span><span>${code}</span></div>
      <div class="hero-value" data-price="${escapeHTML(sym)}">${fmt(q.price, digits)}</div>
      <div class="hero-chg ${cls}"><span data-hero-chg>${fmtChg(q.change, digits)}  ${fmtPct(q.changePct)}</span></div>
      ${window.Spark ? window.Spark.sparkBoxHTML(sym) : ''}
      <span data-hero-range>${window.Spark ? window.Spark.rangeBarHTML(pos, { low: q.low, high: q.high, digits }) : ''}</span>
    </div>`;
  }

  function renderHero() {
    const box = el.heroStrip;
    if (!box) return;
    const keys = heroKeys();
    const cap = document.getElementById('heroCap');
    if (cap) {
      cap.hidden = false;
      cap.textContent = '全球核心指数 · 点击进详情 · 曲线为近 60 个交易日';
    }
    box.innerHTML = keys.map(heroCellHTML).join('');
    hydrateSparks(box);
  }

  function patchHero() {
    if (!el.heroStrip) return;
    el.heroStrip.querySelectorAll('.hero-cell[data-symbol]').forEach(cell => {
      const sym = cell.getAttribute('data-symbol');
      const q = findQuote(sym);
      if (!q || q.price === null) return;
      const digits = U.priceDigits(q.price);
      const v = cell.querySelector('.hero-value');
      const txt = fmt(q.price, digits);
      if (v && v.textContent !== txt) v.textContent = txt;
      const c = cell.querySelector('[data-hero-chg]');
      const cls = pctClass(q.changePct);
      const cTxt = `${fmtChg(q.change, digits)}  ${fmtPct(q.changePct)}`;
      if (c) {
        if (c.textContent !== cTxt) c.textContent = cTxt;
        c.className = cls;
      }
      // 当日振幅条的指示点跟着现价走（否则它停在开盘那一刻的位置）
      const r = cell.querySelector('[data-hero-range]');
      if (r && window.Spark) r.innerHTML = window.Spark.rangeBarHTML(window.Spark.rangePos(q.price, q.low, q.high), { low: q.low, high: q.high, digits });
    });
  }

  /* ==================== 我的自选（首屏下方独立板块） ====================
     用户 2026-09-16："全球 tag 下应该先显示上证、纳斯达克等全球指数，在下面再显示我的自选"。
     所以首屏 hero 归指数，自选在这里成块出现——卡片式（走势线 + 当日振幅条），
     而不是只留一行小字。空自选时给引导，不整块消失（避免"这一块没了"的错觉）。

     走势线要 60 根日线：A股/港股/美股走腾讯（一个 ~4KB 的小请求），加密走币安；
     宏观/外汇（EM: 前缀）没有免费日线源 → 不画线（画不出来就不画，不占位不报错）。
     结果进内存缓存 10 分钟，并发限 3（腾讯对突发请求会回 501 挑战页）。 */
  const SPARK_TTL = 10 * 60 * 1000;
  const SPARK_BARS = 60;

  async function sparkCloses(sym, market) {
    const key = 'spark:' + sym;
    const hit = Cache.get(key, SPARK_TTL);
    if (hit) return hit.val;
    let closes = null;
    try {
      if (market === 'crypto') {
        const rows = await window.BinanceSource.getKline(sym, '1d', SPARK_BARS);
        closes = (rows || []).map(k => k && k.close);
      } else if (!/^EM:/.test(sym)) {
        const rows = await window.TencentSource.getKline(sym, 'day', SPARK_BARS);
        closes = (rows || []).map(k => k && k.close);
      }
    } catch { closes = null; }
    const ok = Array.isArray(closes) && closes.filter(v => typeof v === 'number' && isFinite(v)).length >= 2;
    if (ok) { Cache.set(key, closes); return closes; }
    return null;
  }

  async function loadSparks(items, max = 3) {
    const todo = items.filter(it => it && it.sym && !Cache.get('spark:' + it.sym, SPARK_TTL));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const it = todo[next++];
        await sparkCloses(it.sym, it.market);
      }
    };
    await Promise.all(Array.from({ length: Math.min(max, todo.length) }, worker));
  }

  /* 把已经在缓存里的走势线画到容器内的 canvas 上（先插 DOM 再画：canvas 得有尺寸） */
  function hydrateSparks(root) {
    if (!root || !window.Spark) return;
    const up = getComputedStyle(document.body).getPropertyValue('--up').trim() || '#ff5c5c';
    const down = getComputedStyle(document.body).getPropertyValue('--down').trim() || '#2ebd85';
    root.querySelectorAll('canvas[data-spark]').forEach(cv => {
      const sym = cv.getAttribute('data-spark');
      const hit = Cache.get('spark:' + sym, SPARK_TTL);
      // 没有日线源（宏观/外汇）或数据不够：整块收起，不留一个 34px 的空白槽
      if (!hit) { cv.hidden = true; return; }
      const closes = hit.val;
      const q = findQuote(sym);
      const rising = (q && typeof q.changePct === 'number') ? q.changePct >= 0
        : closes[closes.length - 1] >= closes[0];
      const color = rising ? up : down;
      const ok = window.Spark.draw(cv, closes, { color, fill: color + '18' });
      cv.hidden = !ok;
      if (ok) cv.removeAttribute('hidden');
    });
  }

  function homeWatchItems() {
    return window.Store.watchlist.all()
      .filter(it => CRYPTO_ON || !/USDT$/i.test(it.symbol))
      .map(it => {
        let q = state.quotes.get(it.symbol) || state.watchQuotes.get(it.symbol) || state.chainQuotes.get(it.symbol);
        if (!q) {
          const c = Cache.raw('q:' + it.symbol);
          if (c) q = Object.assign({}, c.val, { cachedAt: c.at });
        }
        return { item: it, q };
      });
  }

  function renderHomeWatch() {
    const box = el.watchGrid;
    if (!box) return;
    if (el.watchSection) el.watchSection.hidden = false;
    const list = homeWatchItems();
    const items = list.filter(x => x.q && x.q.price !== null);
    const valid = items.filter(x => typeof x.q.changePct === 'number' && !isNaN(x.q.changePct));
    if (el.watchSub) {
      if (!list.length) el.watchSub.textContent = '还没有自选';
      else if (!valid.length) el.watchSub.textContent = list.length + ' 只 · 等待行情';
      else {
        const avg = valid.reduce((s, x) => s + x.q.changePct, 0) / valid.length;
        const up = valid.filter(x => x.q.changePct > 0).length;
        const down = valid.filter(x => x.q.changePct < 0).length;
        el.watchSub.innerHTML = `<span class="num ${pctClass(avg)}">${fmtPct(avg)}</span> 等权平均 · <span class="up num">${up}</span> 涨 / <span class="down num">${down}</span> 跌 · ${items.length}/${list.length} 只有行情`;
      }
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty">在任意卡片右上角点 ★ 收藏，这里就会出现你的自选（带走势图）</div>';
      return;
    }
    box.innerHTML = list.map(({ item, q }) => wcardHTML(item, q)).join('');
    hydrateSparks(box);
  }

  function wcardHTML(item, q) {
    const sym = item.symbol;
    const name = (q && q.name) || item.name || sym;
    const mkt = (q && q.market) || item.market || '';
    const flag = window.Flags ? window.Flags.flag(heroFlagCode(sym, mkt)) : '';
    const code = escapeHTML((q && q.code) || (sym.startsWith('EM:') ? sym.slice(3).split('.')[1] : sym.replace(/^(sh|sz|bj|hk|us)/i, '')));
    if (!q || q.price === null) {
      return `<div class="wcard" data-symbol="${escapeHTML(sym)}" tabindex="0" role="button" aria-label="${escapeHTML(name)} 详情">
        <div class="hero-label"><span>${flag}${escapeHTML(name)}</span><span>${code}</span></div>
        <div class="hero-value">——</div><div class="hero-chg">等待数据</div>
        ${window.Spark ? window.Spark.sparkBoxHTML(sym) : ''}</div>`;
    }
    const digits = U.priceDigits(q.price);
    const cls = pctClass(q.changePct);
    const pos = window.Spark ? window.Spark.rangePos(q.price, q.low, q.high) : null;
    return `<div class="wcard" data-symbol="${escapeHTML(sym)}" tabindex="0" role="button" aria-label="${escapeHTML(name)} 详情">
      <div class="hero-label"><span>${flag}${escapeHTML(name)}</span><span>${code}</span></div>
      <div class="hero-value">${fmt(q.price, digits)}</div>
      <div class="hero-chg ${cls}"><span>${fmtChg(q.change, digits)}  ${fmtPct(q.changePct)}</span></div>
      ${window.Spark ? window.Spark.sparkBoxHTML(sym) : ''}
      ${window.Spark ? window.Spark.rangeBarHTML(pos, { low: q.low, high: q.high, digits }) : ''}
    </div>`;
  }

  /* 拉一遍首屏 + 自选的走势线（进「全部」tab 时懒加载，失败静默） */
  async function ensureSparks() {
    const items = HERO_KEYS.map(sym => {
      const q = findQuote(sym);
      return { sym, market: (q && q.market) || (sym === 'BTCUSDT' ? 'crypto' : '') };
    }).concat(homeWatchItems().map(x => ({ sym: x.item.symbol, market: (x.q && x.q.market) || x.item.market })));
    if (!items.length) return;
    await loadSparks(items).catch(() => { /* 画不出就不画 */ });
    hydrateSparks(el.heroStrip);
    hydrateSparks(el.watchGrid);
    renderGlobeSum();
  }

  /* 全球指数涨跌概览：一条堆叠条 + 平均涨跌（零请求，用已加载的指数行情）。
     首屏除了四张卡就是表格会显得干，这条给"今天全球几涨几跌"一个一眼可读的形状。 */
  function renderGlobeSum() {
    if (!el.globeSum) return;
    const qs = heroKeys().map(findQuote).concat(state.globeQuotes ? [...state.globeQuotes.values()] : []);
    const valid = qs.filter(q => q && typeof q.changePct === 'number' && !isNaN(q.changePct));
    if (!valid.length) { el.globeSum.innerHTML = ''; return; }
    const up = valid.filter(q => q.changePct > 0).length;
    const flat = valid.filter(q => q.changePct === 0).length;
    const down = valid.length - up - flat;
    const avg = valid.reduce((s, q) => s + q.changePct, 0) / valid.length;
    const pc = (n) => (n / valid.length * 100).toFixed(1);
    el.globeSum.innerHTML = `<span class="gs-bar" role="img" aria-label="${up} 涨 / ${flat} 平 / ${down} 跌">
        <i class="gs-up" style="width:${pc(up)}%"></i><i class="gs-flat" style="width:${pc(flat)}%"></i><i class="gs-down" style="width:${pc(down)}%"></i>
      </span>
      <span class="gs-avg num ${pctClass(avg)}">${fmtPct(avg)}</span>
      <span class="gs-txt"><span class="up num">${up}</span> 涨 · <span class="down num">${down}</span> 跌 · 共 ${valid.length} 个全球指数</span>`;
  }

  /* ==================== 吸顶指数跑马条（2026-09-17） ====================
     TradingView ticker tape 的终端版：常驻顶栏下方，一屏扫全球。数据零额外请求——
     全部来自已轮询 universe（指数/汇率/黄金/原油/BTC）；点击任一格进该标的详情。 */
  const TAPE_KEYS = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'hkHSI', 'hkHSTECH',
    'usDJI', 'usIXIC', 'usINX', 'EM:100.UDI', 'EM:133.USDCNH', 'EM:101.GC00Y', 'EM:102.CL00Y']
    .concat(CRYPTO_ON ? ['BTCUSDT'] : []);

  function tapeLabel(sym) {
    const u = [...window.TENCENT_UNIVERSE, ...window.EM_UNIVERSE].find(x => x.symbol === sym);
    return u ? u.label : sym;
  }

  function renderTape() {
    if (!el.tape) return;
    el.tape.innerHTML = TAPE_KEYS.map(sym =>
      `<button class="tape-cell" data-symbol="${escapeHTML(sym)}" aria-label="${escapeHTML(tapeLabel(sym))} 详情">
        <span class="tp-name">${escapeHTML(tapeLabel(sym))}</span>
        <span class="tp-price num" data-tape-price="${escapeHTML(sym)}">--</span>
        <span class="tp-pct num flat" data-tape-pct="${escapeHTML(sym)}">--</span>
      </button>`).join('');
    patchTape();
  }

  function patchTape() {
    if (!el.tape) return;
    TAPE_KEYS.forEach(sym => {
      const q = findQuote(sym);
      if (!q) return;
      const isFxMacro = q.market === 'macro' || q.market === 'fx';
      const digits = isFxMacro ? 4 : U.priceDigits(q.price);
      const price = fmt(q.price, digits);
      const pct = fmtPct(q.changePct);
      const cls = pctClass(q.changePct);
      const p = el.tape.querySelector('[data-tape-price="' + sym + '"]');
      const pc = el.tape.querySelector('[data-tape-pct="' + sym + '"]');
      if (p && p.textContent !== price) {
        const oldNum = parseFloat(p.textContent.replace(/,/g, ''));
        // 首次填充（占位 "--" → 数字）不算涨跌，不闪
        if (!isNaN(oldNum)) flashPrice(p, q.price >= oldNum ? 'up' : 'down');
        p.textContent = price;
      }
      if (pc && (pc.textContent !== pct || !pc.classList.contains(cls))) {
        pc.textContent = pct;
        pc.classList.remove('up', 'down', 'flat');
        pc.classList.add(cls);
      }
    });
  }

  /* 价格闪烁（TradingView 的"数字会呼吸"）：涨/跌时给格子一次背景色淡出。
     用 Web Animations API 而不是类名开关——不需要 void offsetWidth 强制重排，
     动画结束即自动释放，重复触发天然重启。 */
  function flashPrice(node, dir) {
    if (!node || reduceMotion() || typeof node.animate !== 'function') return;
    const rgb = (getComputedStyle(document.body).getPropertyValue(dir === 'up' ? '--up-rgb' : '--down-rgb') || '').trim();
    if (!rgb) return;
    node.animate(
      [{ backgroundColor: 'rgba(' + rgb + ', 0.20)' }, { backgroundColor: 'rgba(0,0,0,0)' }],
      { duration: 900, easing: 'ease-out' }
    );
  }

  /* ==================== Movers 三榜（2026-09-17） ====================
     涨幅榜/跌幅榜/成交额榜：TradingView 式"零配置预设"。数据复用热力图的全市场行
     （state.heatItems，A股权重由情绪调度器保活、港/美为会话级缓存），零额外网络请求；
     只在 A股/港股/美股 tab 显示。 */
  const MOVERS_DEFS = {
    cn: { title: 'A股焦点', loader: () => loadHeatCN(), rows: () => state.heatItems.cn },
    hk: { title: '港股焦点', loader: () => ensureHKRows(), rows: () => state.heatItems.hk },
    us: { title: '美股焦点', loader: () => ensureUSRows(), rows: () => state.heatItems.us },
  };

  function validMoverRows(rows) {
    return (rows || []).filter(r => r && r.name && typeof r.changePct === 'number' &&
      !isNaN(r.changePct) && r.price !== null && r.price !== undefined && isFinite(r.price));
  }

  function moversBoardHTML(list, label, metric) {
    const rows = list.map((r, i) => {
      const sym = 'EM:' + r.secid;
      state.moversRows.set(sym, r);
      const cls = pctClass(r.changePct);
      const metricTxt = metric === 'amount' ? fmtVol(r.amount || 0) : fmtPct(r.changePct);
      return `<button class="mv-row" data-mv="${escapeHTML(sym)}" title="${escapeHTML(r.name)}（${escapeHTML(r.code)}）">
        <span class="mv-rank num">${i + 1}</span>
        <span class="mv-name"><span class="mv-nm">${escapeHTML(r.name)}</span><span class="mv-code num">${escapeHTML(r.code)}</span></span>
        <span class="mv-price num">${fmt(r.price, U.priceDigits(r.price))}</span>
        <span class="mv-metric num ${cls}">${metricTxt}</span>
      </button>`;
    }).join('');
    return `<div class="mv-col"><div class="mv-col-head"><b>${label}</b></div>${rows}</div>`;
  }

  function renderMovers() {
    if (!el.moversSection || !el.moversGrid) return;
    const def = MOVERS_DEFS[state.tab];
    if (!def) { el.moversSection.hidden = true; return; }
    el.moversSection.hidden = false;
    el.moversTitle.textContent = def.title;
    const rows = validMoverRows(def.rows());
    if (rows.length < 5) {
      el.moversGrid.innerHTML = '<div class="sk sk-row"></div>';
      el.moversSub.textContent = '等待全市场行情…';
      return;
    }
    const byPct = rows.slice().sort((a, b) => b.changePct - a.changePct);
    // 成交额榜按活跃度排（指标本身就是成交额），主列给成交额、涨跌幅保留颜色扫读
    const active = rows.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 10);
    el.moversSub.innerHTML = `全市场 ${rows.length} 只 · 今日涨跌幅 / 成交额 · 60s 重排`;
    el.moversGrid.innerHTML =
      moversBoardHTML(byPct.slice(0, 10), '涨幅榜', 'pct') +
      moversBoardHTML(byPct.slice(-10).reverse(), '跌幅榜', 'pct') +
      moversBoardHTML(active, '成交额榜', 'amount');
  }

  /* 只补空缓存，不做周期抓取（A股权重由情绪调度器保活、港/美会话级缓存）——
     Movers 的刷新是纯重排（schedule('movers')），不放大对上游的请求量 */
  async function loadMovers() {
    const def = MOVERS_DEFS[state.tab];
    if (!def) return;
    if (validMoverRows(def.rows()).length >= 5) { renderMovers(); return; }
    try { await def.loader(); } catch { /* 降级：下面用已缓存行渲染 */ }
    if (state.view === 'market' && MOVERS_DEFS[state.tab]) renderMovers();
  }

  // 入场动画结束后摘掉 stagger 类与 delay：
  // 否则元素长期带 animation-delay，浏览器/辅助工具会一直认为它"未稳定"，点击与命中测试受影响。
  function clearStagger(root) {
    if (!root) return;
    const nodes = root.querySelectorAll('.stagger-in');
    if (!nodes.length) return;
    nodes.forEach(n => {
      const done = () => {
        n.classList.remove('stagger-in');
        n.style.animationDelay = '';
      };
      n.addEventListener('animationend', done, { once: true });
    });
    // 兜底：动画被跳过（后台标签页 / reduce-motion）时也要清理
    setTimeout(() => nodes.forEach(n => {
      n.classList.remove('stagger-in');
      n.style.animationDelay = '';
    }), 1600);
  }

  const ORDER = new Map();
  [...window.TENCENT_UNIVERSE, ...window.EM_UNIVERSE].forEach((x, i) => ORDER.set(x.symbol, i));
  window.CRYPTO_FEATURED.forEach((s, i) => ORDER.set(s, 1000 + i));
  const orderOf = (q) => ORDER.has(q.symbol) ? ORDER.get(q.symbol) : 9999;

  // 增量更新：只改数字与颜色，避免整墙重排（刷新无跳动）
  function patchCards(root) {
    (root || document).querySelectorAll('.qrow[data-symbol]').forEach(row => {
      const sym = row.getAttribute('data-symbol');
      const q = findQuote(sym);
      if (!q) return;
      const isFxMacro = q.market === 'macro' || q.market === 'fx';
      const digits = isFxMacro ? 4 : U.priceDigits(q.price);
      const priceNode = row.querySelector('.qr-price');
      const txt = fmt(q.price, digits);
      if (priceNode && priceNode.textContent !== txt) {
        const oldNum = parseFloat(priceNode.textContent.replace(/,/g, ''));
        if (!isNaN(oldNum)) flashPrice(priceNode, q.price >= oldNum ? 'up' : 'down');
        priceNode.textContent = txt;
      }
      const cls = pctClass(q.changePct);
      const chgNode = row.querySelector('.qr-chg');
      if (chgNode) {
        const chgTxt = fmtChg(q.change, digits);
        if (chgNode.textContent !== chgTxt) chgNode.textContent = chgTxt;
        if (!chgNode.classList.contains(cls)) {
          chgNode.classList.remove('up', 'down', 'flat');
          chgNode.classList.add(cls);
        }
      }
      const pctNode = row.querySelector('.qr-pct');
      if (pctNode) {
        const pctTxt = fmtPct(q.changePct);
        if (pctNode.textContent !== pctTxt) pctNode.textContent = pctTxt;
        if (!pctNode.classList.contains(cls)) {
          pctNode.classList.remove('up', 'down', 'flat');
          pctNode.classList.add(cls);
        }
      }
      const amtNode = row.querySelector('.qr-amt');
      if (amtNode) {
        const amt = q.amount ? fmtVol(q.amount) : '--';   // 成交额缺失显示 --，不用成交量顶替（量纲不同）
        if (amtNode.textContent !== amt) amtNode.textContent = amt;
      }
    });
  }

  function renderWatchlist(noAnim) {
    // 合规开关关闭：加密标的从列表隐藏（自选数据本身保留，开关打开即恢复）
    const items = window.Store.watchlist.all().filter(it => CRYPTO_ON || !/USDT$/i.test(it.symbol));
    if (!items.length) {
      el.watchWall.innerHTML = '<div class="empty">点击卡片右上角 ★ 添加自选</div>';
      return;
    }
    refreshWatchSet();
    const quotes = items.map(it => {
      let q = state.quotes.get(it.symbol) || state.watchQuotes.get(it.symbol) ||
        state.chainQuotes.get(it.symbol);
      if (!q) {
        const c = Cache.raw('q:' + it.symbol);
        // 缓存兜底必须带时间戳与降级标记，否则陈旧价会冒充实价
        if (c) {
          q = Object.assign({}, c.val, { cachedAt: c.at });
          state.degraded.set(it.symbol, 'cache');
        }
      }
      return q || { symbol: it.symbol, name: it.name, code: it.symbol, market: it.market, price: null, change: null, changePct: null };
    });
    // 排序（TradingView 自选表习惯：涨跌幅榜最常用）；默认保持收藏顺序
    if (state.watchSort === 'pctDesc') quotes.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
    if (state.watchSort === 'pctAsc') quotes.sort((a, b) => (a.changePct ?? 999) - (b.changePct ?? 999));
    // 组合概览：等权平均涨跌 + 内部涨跌家数（有数据的才算，防止 null 拉低均值）
    const valid = quotes.filter(q => q.changePct !== null && q.changePct !== undefined && !isNaN(q.changePct));
    let summary = '';
    if (valid.length) {
      const avg = valid.reduce((s, q) => s + q.changePct, 0) / valid.length;
      const up = valid.filter(q => q.changePct > 0).length;
      const down = valid.filter(q => q.changePct < 0).length;
      summary = `<div class="watch-summary">
        <span class="ws-label">组合概览</span>
        <span class="num ${pctClass(avg)}">${fmtPct(avg)}</span>
        <span class="num"><span class="up">${up}</span> 涨 / <span class="down">${down}</span> 跌</span>
        <span class="ws-dim">等权平均 · ${valid.length}/${quotes.length} 只有行情</span>
      </div>`;
    }
    const sorts = [['default', '收藏顺序'], ['pctDesc', '涨幅↓'], ['pctAsc', '涨幅↑']];
    const sortBar = `<div class="watch-sortbar">${sorts.map(([k, label]) =>
      `<button class="pill${state.watchSort === k ? ' active' : ''}" data-wsort="${k}">${label}</button>`).join('')}</div>`;
    el.watchWall.innerHTML = sortBar + summary +
      `<div class="card-grid">${quotes.map((q, i) => rowHTML(q, !noAnim, i)).join('')}</div>`;
    if (!noAnim) clearStagger(el.watchWall);
  }

  /* ==================== 热力图 ==================== */

  function heatValue(row) {
    if (state.heatSize === 'cap' && row.marketCap) return row.marketCap;
    return Math.abs(row.changePct || 0) + 0.1;   // 保底面积，避免 0 面积块
  }

  async function loadHeatCN() {
    let rows = await window.EastmoneySource.getFullMarket();
    let via = 'primary';
    if (!rows.length) {
      // 兜底：腾讯精选（universe 里的 A 股 + 产业链成分股）
      const syms = Array.from(new Set([
        ...window.TENCENT_UNIVERSE.filter(x => x.group === 'cn' || x.group === 'index').map(x => x.symbol),
        ...chainSymbols(),
      ]));
      const qs = await window.TencentSource.getQuotes(syms);
      rows = qs.map(q => ({
        code: q.code || q.symbol, name: q.name, secid: toSecid(q.symbol),
        price: q.price, changePct: q.changePct, change: q.change, marketCap: q.marketCap,
      }));
      via = rows.length ? 'backup' : 'none';
    }
    if (rows.length) {
      Cache.set('heat:cn', rows);
      state.heatItems.cn = rows;
      state.heatVia.cn = via;
      state.heatFetchedAt = Date.now();
    } else {
      const c = Cache.raw('heat:cn');
      if (c) { state.heatItems.cn = c.val; state.heatVia.cn = 'cache'; state.heatCachedAt.cn = c.at; }
    }
  }

  async function loadHeatCrypto() {
    if (!CRYPTO_ON) return;   // 合规开关关闭：不抓加密全市场
    let rows = await window.BinanceSource.getTop(80);
    let via = 'primary';
    if (!rows.length) { rows = await window.OkxSource.getTop(80); via = 'backup'; }
    if (rows.length) {
      const mapped = rows.map(q => ({
        code: q.symbol, name: q.name, price: q.price, changePct: q.changePct,
        change: q.change, marketCap: q.amount, binance: q.symbol, market: 'crypto',
      }));
      Cache.set('heat:crypto', mapped);
      state.heatItems.crypto = mapped;
      state.heatVia.crypto = via;
      state.heatFetchedAt = Date.now();
    } else {
      const c = Cache.raw('heat:crypto');
      if (c) { state.heatItems.crypto = c.val; state.heatVia.crypto = 'cache'; state.heatCachedAt.crypto = c.at; }
    }
  }

  /* 只有 A股 提供"全市场"探索（5500 行尚可承受）；港股 2900、美股 13800 一律取市值 Top 500
     ——1.38 万块塞进一屏平均每块不到 3×3px，物理上放不下任何文字。
     加密只有 80 个币，不切片。切片只影响"画出来的块"，宽度/情绪统计始终用全量数据。 */
  const HEAT_RANGE_MODES = { cn: true };
  // 各市场的取数入口（函数声明已提升，这里只是把它们收成一张表，避免 switchHeat 里堆三元）
  const HEAT_LOADERS = { cn: loadHeatCN, crypto: loadHeatCrypto, hk: ensureHKRows, us: ensureUSRows };

  function heatItemsForRender() {
    let rows = state.heatItems[state.heatMode] || [];
    const sliceTop = state.heatMode !== 'crypto' &&
      (HEAT_RANGE_MODES[state.heatMode] ? state.heatTopMode !== 'all' : true);
    if (sliceTop && rows.length > 500) {
      rows = rows.slice().sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 500);
    }
    return rows.map(r => ({
      name: r.name, code: r.code, pct: r.changePct, price: r.price,
      value: heatValue(r), payload: r,
    }));
  }

  function ensureHeat() {
    if (state.heat) return state.heat;
    state.heat = window.Treemap.create(el.heatCanvas, {
      onClick: (item) => {
        const p = item.payload;
        if (state.heatMode === 'crypto') openDetail({ symbol: p.code, name: p.name, code: p.code, market: 'crypto', binance: p.binance || p.code });
        else openDetail({
          symbol: p.secid ? 'EM:' + p.secid : p.code, name: p.name, code: p.code,
          // 市场按 secid 反查，不再写死 'cn'——港股/美股热力图点进去必须落到正确市场
          // （market 决定币种与成交额单位分档、以及详情页的"交易时段"口径）
          market: marketFromSecid(p.secid) || 'cn',
          secid: p.secid, tencent: tencentOfSecid(p.secid),
        });
      },
      // 加密热力图 tile 印 LOGO（本地化图标集）；A 股无免费 logo 源，维持文字
      iconFor: (item) => (item.payload && item.payload.market === 'crypto')
        ? logoURL({ market: 'crypto', code: item.payload.code }) : null,
      // 缩放/平移时同步"复位 ×N"按钮，首次交互后淡出提示
      onViewportChange: (v) => {
        el.heatReset.hidden = v.zoom <= 1.001;
        el.heatZoom.textContent = v.zoom.toFixed(1);
        el.heatHint.classList.add('faded');
      },
    });
    bindHeatHover();
    return state.heat;
  }

  function drawHeat() {
    // 板块不可见时布局/绘制无意义（treemap 内部也会跳过），避免留下 1×1 空图与错位布局
    const rect = el.heatCanvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const heat = ensureHeat();
    heat.resize();
    heat.setData(heatItemsForRender());
    el.heatTip.classList.remove('active');   // 重排后旧浮层会钉在错误的块上
    const sk = document.getElementById('heatSk');
    if (sk) sk.remove();                     // 首次出图后摘掉骨架
    renderHeatSub();
  }

  function renderHeatSub() {
    const rows = state.heatItems[state.heatMode] || [];
    const n = rows.length;
    const via = state.heatVia[state.heatMode];
    const viaTxt = via === 'cache'
      ? '缓存 · ' + fmtTime(state.heatCachedAt[state.heatMode])
      : via === 'backup' ? '备用源' : via ? '主源直连' : '等待数据';
    const rangeTxt = state.heatMode === 'cn'
      ? (state.heatTopMode === 'top' ? ' · 市值 Top 500（宽度统计仍用全量）' : ' · 全市场')
      : (state.heatMode === 'hk' || state.heatMode === 'us')
        ? ' · 市值 Top 500（全市场共 ' + n + ' 只）' : '';
    el.heatSub.textContent = `${n} 个标的 · 面积=${state.heatMode === 'crypto' && state.heatSize === 'cap' ? '24h成交额' : state.heatSize === 'cap' ? '市值' : '涨跌幅'}${rangeTxt} · ${viaTxt}`;
    // 空态：全源失败时给明确文案，而不是黑画布 + "0 个标的 · 等待数据"
    let empty = document.getElementById('heatEmpty');
    if (!n) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'heatEmpty';
        empty.className = 'heat-empty';
        empty.textContent = '数据源暂不可用，将自动重试';
        el.heatWrap.appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function bindHeatHover() {
    const canvas = el.heatCanvas;
    const tip = el.heatTip;
    const move = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const i = state.heat.hitTest(x, y);
      state.heat.setHover(i);
      if (i < 0) { tip.classList.remove('active'); return; }
      const it = state.heat.cellAt(i).item;
      tip.innerHTML = `<div class="ht-inner">
        <div class="ht-name">${escapeHTML(it.name)}</div>
        <div class="ht-row num">${escapeHTML(it.code)}</div>
        <div class="ht-row num">价 ${fmtPrice(it.price)}</div>
        <div class="ht-row num ${pctClass(it.pct)}">${fmtPct(it.pct)}</div>
      </div>`;
      tip.classList.add('active');
      const wrapRect = el.heatWrap.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = clientX - wrapRect.left + 14;
      let top = clientY - wrapRect.top + 14;
      if (left + tw > wrapRect.width) left = clientX - wrapRect.left - tw - 14;
      if (top + th > wrapRect.height) top = clientY - wrapRect.top - th - 14;
      // 只写位置变量，transform 由 CSS 统一处理（不覆盖入场动效）
      tip.style.setProperty('--tip-x', Math.max(0, left) + 'px');
      tip.style.setProperty('--tip-y', Math.max(0, top) + 'px');
    };
    const onMove = U.throttle((e) => move(e.clientX, e.clientY), 16);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => {
      state.heat.setHover(-1);
      el.heatTip.classList.remove('active');
    });
    // 触屏长按出浮层（手指开始拖动平移/捏合时必须取消，否则拖到一半浮层弹出且指向起始点）
    let lp = null;
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      lp = setTimeout(() => move(t.clientX, t.clientY), 350);
    }, { passive: true });
    canvas.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
    canvas.addEventListener('touchend', () => {
      clearTimeout(lp);
      setTimeout(() => el.heatTip.classList.remove('active'), 1600);
    });
  }

  function tencentOfSecid(secid) {
    if (!secid) return null;
    const [m, code] = String(secid).split('.');
    if (m === '1') return 'sh' + code;
    // 东财 m:0 涵盖深市与北交所：920 段（及 4/8 开头）属北交所，腾讯前缀是 bj 不是 sz
    if (m === '0') return (/^(92|8|4)/.test(code) ? 'bj' : 'sz') + code;
    if (m === '116') return 'hk' + code;
    if (m === '105' || m === '106' || m === '107') return 'us' + code;
    return null;
  }

  /* ---- 加密宽度：与 A 股同一套口径（上涨占比 = 上涨对 ÷ (上涨+下跌对)）---- */
  async function ensureCryptoRows() {
    if (state.heatItems.crypto && state.heatItems.crypto.length) return state.heatItems.crypto;
    await loadHeatCrypto();
    return state.heatItems.crypto || [];
  }

  function renderMoodCrypto(rows) {
    const box = el.moodCrypto;
    if (!box) return;
    if (!CRYPTO_ON) { box.innerHTML = ''; return; }   // 合规开关关闭：加密宽度整块不出
    const valid = (rows || []).filter(r => r.changePct !== null && r.changePct !== undefined && !isNaN(r.changePct));
    if (!valid.length) {
      box.innerHTML = '';
      return;
    }
    const up = valid.filter(r => r.changePct > 0).length;
    const down = valid.filter(r => r.changePct < 0).length;
    const decisive = up + down;
    const score = decisive ? (up / decisive) * 100 : null;
    const avg = valid.reduce((s2, r) => s2 + r.changePct, 0) / valid.length;
    const amount = valid.reduce((s2, r) => s2 + (r.amount || 0), 0);
    const band = window.Breadth.scoreBand(score);
    const cls = pctClass(avg);
    const maxAbs = Math.max(...valid.map(r => Math.abs(r.changePct)), 0.0001);
    const movers = valid.slice().sort((a, b) => b.changePct - a.changePct);
    const heat = (v) => Math.min(1, Math.abs(v) / maxAbs).toFixed(3);
    box.innerHTML = `<div class="section-head">
        <h2 class="section-title">加密宽度</h2>
        <span class="sec-line"></span>
        <span class="section-sub">${valid.length} 个 USDT 交易对 · 币安 · 每 ${window.Store.settings.get().refresh}s 刷新</span>
      </div>
      <div class="mood-top">
        <div class="thermo-card">
          <div class="thermo-label">加密情绪指数</div>
          <div class="thermo-score num" id="cryptoScore">${score === null ? '--' : Math.round(score)}</div>
          <div class="thermo-band ${band.cls}">${band.label} · 上涨占比 ${score === null ? '--' : score.toFixed(1) + '%'}</div>
          <div class="thermo-track" aria-hidden="true"><span class="thermo-fill" style="transform:scaleX(${(score / 100).toFixed(4)})"></span></div>
          <div class="thermo-scale" aria-hidden="true"><span>0 恐慌</span><span>50</span><span>100 亢奋</span></div>
          <div class="thermo-note">上涨对 ÷ (上涨 + 下跌对) × 100，剔除平盘对</div>
        </div>
        <div class="breadth-grid">
          <div class="bd-cell"><div class="bd-label">上涨 / 下跌对</div>
            <div class="bd-value num"><span class="up">${up}</span> / <span class="down">${down}</span></div>
            <div class="bd-sub num">平盘 ${valid.length - up - down}</div></div>
          <div class="bd-cell"><div class="bd-label">24h 涨跌王</div>
            <div class="bd-value num ${pctClass(movers[0].changePct)}">${escapeHTML(movers[0].name)}</div>
            <div class="bd-sub num">${fmtPct(movers[0].changePct)} · 热度 ${heat(movers[0].changePct)}</div></div>
          <div class="bd-cell"><div class="bd-label">24h 跌幅王</div>
            <div class="bd-value num ${pctClass(movers[movers.length - 1].changePct)}">${escapeHTML(movers[movers.length - 1].name)}</div>
            <div class="bd-sub num">${fmtPct(movers[movers.length - 1].changePct)} · 热度 ${heat(movers[movers.length - 1].changePct)}</div></div>
          <div class="bd-cell"><div class="bd-label">平均涨跌 / 24h 额</div>
            <div class="bd-value num ${cls}">${fmtPct(avg)}</div>
            <div class="bd-sub num">成交额 ${amount ? fmtVol(amount) : '--'}</div></div>
        </div>
      </div>`;
  }

  /* ==================== 市场宽度 / 情绪 ==================== */

  // 复用 G3 热力图的全市场 diff；热力图还没初始化时才自己拉一次（30s 内不重复）
  async function ensureBreadthRows() {
    const rows = state.heatItems.cn;
    if (rows && rows.length) return rows;
    const c = Cache.raw('heat:cn');
    if (c && Date.now() - c.at < 30000) return c.val;
    await loadHeatCN();
    return state.heatItems.cn || [];
  }

  async function loadMood() {
    const rows = await ensureBreadthRows();
    state.breadth = window.Breadth.compute(rows);
    state.breadthAt = Date.now();
    // 情绪历史（方法论：market-breadth 的宽度时间序列）：逐日快照存本机，
    // 全市场样本不足 3000 只不入库（腾讯兜底样本会算出假情绪）
    state.breadthHist = window.Breadth.recordHistory(
      window.Store.get('breadthHist', []), state.breadth.score, state.breadth.total);
    window.Store.set('breadthHist', state.breadthHist);
    renderMood();
    // 加密宽度与美股宽度**不在这里拉**：它们与 A股 无关，挂在 A股 tab 的"情绪与市场宽度"里
    // 既文不对题，又让 A股 tab 白跑一次美股全市场（139 页）。各自归位到 加密/美股 tab，
    // 由那边的 setTab 触发（见 renderMoodCrypto/renderMoodUS 的调用点）。
  }

  /* ---- 港股全市场（东财 主板+GEM ≈ 2900 只）----
     与美股同一套影子：一次全量抓取，同时供"港股热力图"（未来也可供港股宽度）使用，缓存 5 分钟。
     市场过滤常量在 sources/eastmoney.js（FS_HK）——裸 m:116 会混进 1.7 万条权证。 */
  async function ensureHKRows() {
    if (state.heatItems.hk && state.heatItems.hk.length) return state.heatItems.hk;
    const c = Cache.raw('heat:hk');
    if (c && Date.now() - c.at < 300000) {
      state.heatItems.hk = c.val; state.heatVia.hk = 'cache'; state.heatCachedAt.hk = c.at;
      return c.val;
    }
    const rows = await window.EastmoneySource.getFullMarket({
      fs: window.EastmoneySource.FS_HK, maxCount: 3000, concurrency: 12,
    });
    if (rows.length) {
      state.heatItems.hk = rows; state.heatVia.hk = 'primary';
      Cache.set('heat:hk', rows);
    } else {
      const cc = Cache.raw('heat:hk');
      if (cc) { state.heatItems.hk = cc.val; state.heatVia.hk = 'cache'; state.heatCachedAt.hk = cc.at; }
    }
    return state.heatItems.hk;
  }

  /* ---- 美股宽度（东财美股全市场 m:105,106,107 ≈ 1.38 万只，全量抓避免排序偏差）----
     与加密宽度同构的独立卡片；无涨跌停概念，不展示 limit 口径。缓存 5 分钟。
     同一份行数据也供"美股热力图"使用（按市值取 Top 500 后画）。 */
  async function ensureUSRows() {
    if (state.heatItems.us && state.heatItems.us.length) return state.heatItems.us;
    const c = Cache.raw('heat:us');
    if (c && Date.now() - c.at < 300000) {
      state.heatItems.us = c.val; state.heatVia.us = 'cache'; state.heatCachedAt.us = c.at;
      return c.val;
    }
    const rows = await window.EastmoneySource.getFullMarket({
      fs: window.EastmoneySource.FS_US, maxCount: 13800, concurrency: 16,
    });
    if (rows.length) {
      state.heatItems.us = rows; state.heatVia.us = 'primary';
      Cache.set('heat:us', rows);
    } else {
      const cc = Cache.raw('heat:us');
      if (cc) { state.heatItems.us = cc.val; state.heatVia.us = 'cache'; state.heatCachedAt.us = cc.at; }
    }
    return state.heatItems.us;
  }

  function renderMoodUS(rows) {
    const box = el.moodUS;
    if (!box) return;
    const valid = (rows || []).filter(r => r.changePct !== null && r.changePct !== undefined && !isNaN(r.changePct));
    if (!valid.length) {
      box.innerHTML = '';
      return;
    }
    const up = valid.filter(r => r.changePct > 0).length;
    const down = valid.filter(r => r.changePct < 0).length;
    const decisive = up + down;
    const score = decisive ? (up / decisive) * 100 : null;
    const avg = valid.reduce((s2, r) => s2 + r.changePct, 0) / valid.length;
    const band = window.Breadth.scoreBand(score);
    const cls = pctClass(avg);
    const maxAbs = Math.max(...valid.map(r => Math.abs(r.changePct)), 0.0001);
    const movers = valid.slice().sort((a, b) => b.changePct - a.changePct);
    const heat = (v) => Math.min(1, Math.abs(v) / maxAbs).toFixed(3);
    box.innerHTML = `<div class="section-head">
        <h2 class="section-title">美股宽度</h2>
        <span class="sec-line"></span>
        <span class="section-sub">${valid.length} 只 · NYSE/NASDAQ/AMEX 全市场 · 东财 · 缓存 5 分钟</span>
      </div>
      <div class="mood-top">
        <div class="thermo-card">
          <div class="thermo-label">美股情绪指数</div>
          <div class="thermo-score num">${score === null ? '--' : Math.round(score)}</div>
          <div class="thermo-band ${band.cls}">${band.label} · 上涨占比 ${score === null ? '--' : score.toFixed(1) + '%'}</div>
          <div class="thermo-track" aria-hidden="true"><span class="thermo-fill" style="transform:scaleX(${(score / 100).toFixed(4)})"></span></div>
          <div class="thermo-scale" aria-hidden="true"><span>0 恐慌</span><span>50</span><span>100 亢奋</span></div>
          <div class="thermo-note">上涨家数 ÷ (上涨 + 下跌) × 100，剔除平盘；无涨跌停概念</div>
        </div>
        <div class="breadth-grid">
          <div class="bd-cell"><div class="bd-label">上涨 / 下跌</div>
            <div class="bd-value num"><span class="up">${up}</span> / <span class="down">${down}</span></div>
            <div class="bd-sub num">平盘 ${valid.length - up - down}</div></div>
          <div class="bd-cell"><div class="bd-label">涨幅王</div>
            <div class="bd-value num ${pctClass(movers[0].changePct)}">${escapeHTML(movers[0].name)}</div>
            <div class="bd-sub num">${fmtPct(movers[0].changePct)} · 热度 ${heat(movers[0].changePct)}</div></div>
          <div class="bd-cell"><div class="bd-label">跌幅王</div>
            <div class="bd-value num ${pctClass(movers[movers.length - 1].changePct)}">${escapeHTML(movers[movers.length - 1].name)}</div>
            <div class="bd-sub num">${fmtPct(movers[movers.length - 1].changePct)} · 热度 ${heat(movers[movers.length - 1].changePct)}</div></div>
          <div class="bd-cell"><div class="bd-label">平均涨跌</div>
            <div class="bd-value num ${cls}">${fmtPct(avg)}</div>
            <div class="bd-sub num">全市场口径</div></div>
        </div>
      </div>`;
  }

  function renderMood() {
    const b = state.breadth;
    if (!b || !b.total) {
      el.moodSub.textContent = '数据源暂不可用，稍后自动重试';
      el.breadthGrid.innerHTML = '<div class="empty">暂无市场宽度数据</div>';
      el.distWrap.innerHTML = '';
      return;
    }
    // 情绪页数据来自 A 股全市场（cn），读 cn 槽位，不被加密热力图的加载状态污染
    const cnVia = state.heatVia.cn;
    const viaTxt = cnVia === 'cache' ? '缓存 · ' + fmtTime(state.heatCachedAt.cn)
      : cnVia === 'backup' ? '备用源' : '东方财富全市场';
    el.moodSub.textContent = `${b.total} 只 A 股 · ${viaTxt} · 每 ${window.Store.settings.get().refresh}s 刷新`;

    // 温度计（"上涨占比"与情绪指数同口径：up/(up+down)，剔除平盘，避免同屏两个口径）
    const band = window.Breadth.scoreBand(b.score);
    animateScore(b.score);
    el.moodBand.textContent = band.label + (b.score === null ? '' : ` · 上涨占比 ${b.score.toFixed(1)}%`);
    el.moodBand.className = 'thermo-band ' + band.cls;
    el.moodFill.style.transform = `scaleX(${b.score === null ? 0 : (b.score / 100).toFixed(4)})`;

    // 宽度指标
    const cells = [
      { label: '上涨 / 下跌', value: `<span class="up">${b.up}</span> / <span class="down">${b.down}</span>`, sub: `平盘 ${b.flat}` },
      { label: '涨停 / 跌停', value: `<span class="up">${b.limitUp}</span> / <span class="down">${b.limitDown}</span>`, sub: '含 ST 与 20% 板' },
      { label: '平均涨跌幅', value: `<span class="${pctClass(b.avgPct)}">${fmtPct(b.avgPct)}</span>`, sub: `中位数 ${fmtPct(b.medianPct)}` },
      { label: '两市成交额', value: b.amount ? (b.amount >= 1e12 ? fmt(b.amount / 1e12, 2) + ' 万亿' : fmtVol(b.amount)) : '--', sub: b.amount ? '沪深京合计' : '该源未返回成交额' },
    ];
    el.breadthGrid.innerHTML = cells.map(c => `<div class="bd-cell">
        <div class="bd-label">${c.label}</div>
        <div class="bd-value num">${c.value}</div>
        <div class="bd-sub num">${c.sub}</div>
      </div>`).join('');

    // 七段分布
    const maxRatio = Math.max(...b.dist.map(d => d.ratio), 0.0001);
    el.distSub.textContent = `七段合计 ${b.dist.reduce((s, d) => s + d.count, 0)} 只`;
    el.distWrap.innerHTML = b.dist.map(d => {
      const h = (d.ratio / maxRatio).toFixed(3);
      const color = d.dir === 'up' ? 'var(--up)' : d.dir === 'down' ? 'var(--down)' : 'var(--text-tertiary)';
      return `<div class="dist-col" title="${d.label}：${d.count} 只（${(d.ratio * 100).toFixed(1)}%）">
        <div class="dist-count num">${d.count}</div>
        <div class="dist-bar-area">
          <span class="dist-bar" style="transform:scaleY(${h});background:${color}"></span>
        </div>
        <div class="dist-label">${d.label}</div>
      </div>`;
    }).join('');

    renderMoodSpark();
  }

  // 情绪走势 sparkline：手写 SVG 折线（不引新库），数据来自本机逐日快照
  function renderMoodSpark() {
    const box = el.moodSpark;
    if (!box) return;
    const hist = state.breadthHist || window.Store.get('breadthHist', []);
    const { pts, norm } = window.Breadth.sparkPoints(hist, 30);
    if (norm.length < 2) {
      box.innerHTML = `<div class="spark-empty">情绪走势需积累 ≥2 个交易日的本机快照（当前 ${pts.filter(v => v !== null).length} 天），每天打开看板会自动记录</div>`;
      return;
    }
    const W = 100, H = 32, PAD = 2;
    const step = (W - PAD * 2) / (norm.length - 1);
    const y = (v) => PAD + (1 - v) * (H - PAD * 2);
    let d = '';
    let started = false;
    norm.forEach((v, i) => {
      if (v === null) { started = false; return; }   // 缺日断线，不硬连
      d += (started ? ' L' : ' M') + (PAD + i * step).toFixed(1) + ',' + y(v).toFixed(1);
      started = true;
    });
    const validPts = pts.filter(v => v !== null);
    const first = validPts[0], last = validPts[validPts.length - 1];   // 末点可能是 null（脏数据），直接取会 TypeError
    const rising = last >= first;
    const col = rising ? 'var(--up)' : 'var(--down)';
    box.innerHTML = `<div class="spark-head">
        <span class="spark-title">近 ${norm.length} 日情绪走势</span>
        <span class="spark-range num">${first.toFixed(0)} → <b class="${pctClass(last - first)}">${last.toFixed(0)}</b>
        <span class="ws-dim">（本机记录 · ${rising ? '回暖' : '转冷'}）</span></span>
      </div>
      <svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
        aria-label="最近 ${norm.length} 日情绪指数走势，从 ${first.toFixed(0)} 到 ${last.toFixed(0)}">
        <line x1="${PAD}" y1="${y(0.5)}" x2="${W - PAD}" y2="${y(0.5)}" class="spark-mid"></line>
        <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
      </svg>`;
  }

  // 情绪指数 count-up（rAF 驱动，reduce-motion 下直接给终值）
  function animateScore(score) {
    const node = el.moodScore;
    if (score === null || score === undefined || isNaN(score)) { node.textContent = '--'; return; }
    const target = Math.round(score);
    const from = parseInt(node.textContent, 10);
    const start = Number.isFinite(from) ? from : 0;
    // 先写终值：rAF 在后台标签页/隐藏视图里可能永远不触发，
    // 数值正确性不能依赖动画是否跑起来（原实现此时会一直停在 "--"）。
    node.textContent = String(target);
    if (reduceMotion() || start === target) return;
    const t0 = performance.now();
    const dur = 600;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ==================== 技术面板块（替换原"大师视角"） ==================== */

  // 打开详情时与图表并行取一次日K → Technical.analyze → 渲染指标卡
  async function loadTechnical() {
    const t = state.detail;
    const box = el.detailInsight;
    if (!t || !box) return;
    box.innerHTML = '';

    const ex = window.Explain.of(t);
    // 加密没有腾讯/东财 secid，画像用币安日K（klineFor 有同参去重，与图表并行时只发一次）
    const klines = t.market === 'crypto'
      ? await window.BinanceSource.getKline(t.binance || t.code, '1d', 320)
      : await klineFor(t, 'day');
    // 竞态守卫：等待期间用户可能已切到别的标的
    if (state.detail !== t || !box) return;
    const an = window.Technical.analyze(klines);

    const what = ex ? `<div class="explain-box">
        <p class="explain-what"><span class="explain-kind">这是什么</span>${escapeHTML(ex.text)}</p>
      </div>` : '';

    if (!an) {
      box.innerHTML = `<div class="section-head">
          <h2 class="section-title">技术面 · 「${escapeHTML(t.name || t.code || '')}」</h2>
          <span class="section-sub">日K 数据不足（需要 60 根以上），指标暂无法计算</span>
        </div>${what}`;
      return;
    }

    // 信号速览：偏多/偏空计票（描述性统计，不是评级）
    const summary = `<div class="tech-summary">
        <span class="ts-up num">偏多信号 ${an.bias.up}</span>
        <span class="ts-dash">·</span>
        <span class="ts-down num">偏空信号 ${an.bias.down}</span>
        <span class="ts-dash">·</span>
        <span class="ts-flat num">中性 ${an.bias.flat}</span>
        <span class="ts-note">指标间互相矛盾是常态——它们量的是不同维度</span>
      </div>`;

    const cards = an.signals.map(s => `<div class="tech-card">
        <div class="tc-head"><span class="tc-tag">${escapeHTML(s.tag)}</span><span class="tc-bias ${s.bias === 'up' ? 'up' : s.bias === 'down' ? 'down' : ''}">${s.bias === 'up' ? '偏多读法' : s.bias === 'down' ? '偏空读法' : '中性事实'}</span></div>
        <p class="tc-text">${escapeHTML(s.text)}</p>
      </div>`).join('');

    box.innerHTML = `<div class="section-head">
        <h2 class="section-title">技术面 · 「${escapeHTML(t.name || t.code || '')}」</h2>
        <span class="section-sub">基于日K 的常用指标读数 · 只描述事实与常用读法 · 不构成投资建议</span>
      </div>
      ${summary}${what}
      <div class="tech-grid">${cards}</div>`;
  }

  /* ==================== 详情页 + K线 ==================== */

  // 分钟级周期只对有数据源的市场开放（2026-09-17 实测：腾讯 mkline 仅 A股/A股指数；
  // 加密走币安分钟K。港股/美股的该端点为空，按钮按市场隐藏）
  const INTRADAY_PERIODS = ['m5', 'm15', 'm60'];
  function intradayAvailable(t) {
    if (!t) return false;
    if (t.market === 'crypto') return true;
    if (t.market === 'cn') return true;
    return t.market === 'index' && /^(sh|sz|bj)/.test(t.symbol || '');
  }

  async function openDetail(target, opts) {
    if (target && target.market === 'crypto' && !CRYPTO_ON) return;   // 合规开关：加密标的详情不放行
    // 防御：hashchange/popstate 曾在 IIFE 顶层注册（早于 init 填充 el），
    // 窗口期内的深链导航会命中空 el 直接 TypeError。真深链由 init 尾部的 renderFromHash 兜底
    if (!el.detailName) return;
    state.prevView = state.view === 'detail' ? state.prevView : state.tab;
    state.detail = target;
    // 上个标的留下的分钟级周期在新市场没有数据源时回退日K，避免按钮亮着却白屏
    if (!intradayAvailable(target) && INTRADAY_PERIODS.includes(state.detailPeriod)) state.detailPeriod = 'day';
    if (el.intradaySeg) el.intradaySeg.hidden = !intradayAvailable(target);
    setView('detail');
    if (!opts || opts.push !== false) navigate('#symbol=' + encodeURIComponent(target.symbol));
    el.detailName.textContent = target.name || target.code || '--';
    el.detailCode.textContent = target.code || '';
    el.detailPrice.textContent = '--';
    el.detailChg.textContent = '--';
    el.detailStats.innerHTML = '';
    document.title = (target.name || target.code || '详情') + ' · OpenFinLens';
    updateStar();
    // 周期按钮 active 与 state 同步（detailPeriod 跨详情保留上次选择）
    document.querySelectorAll('[data-period]').forEach(b =>
      b.classList.toggle('active', b.dataset.period === state.detailPeriod));
    // allSettled：任一 loader 抛错不拖垮其余三路，也不再产生 unhandled rejection
    await Promise.allSettled([refreshDetailQuote(), loadDetailChart(), loadTechnical()]);
  }

  async function refreshDetailQuote() {
    const t = state.detail;
    if (!t) return;
    let q = null;
    if (t.market === 'crypto') {
      q = (await window.BinanceSource.getQuotes([t.binance || t.code]))[0]
        || (await window.OkxSource.getQuotes([t.binance || t.code]))[0];
    } else if (t.tencent) {
      q = (await window.TencentSource.getQuotes([t.tencent]))[0];
      if (!q && t.secid) q = (await window.EastmoneySource.getQuotes([t.secid]))[0];
    } else if (t.secid) {
      q = (await window.EastmoneySource.getQuotes([t.secid]))[0];
    }
    if (!q) {
      const c = Cache.raw('q:' + t.symbol);
      if (c) q = c.val;
    }
    // 竞态守卫：等待期间用户可能已切到别的标的，慢响应不得写进新详情页
    if (state.detail !== t) return;
    if (!q) return;
    Cache.set('q:' + t.symbol, q);   // 详情页取到的行情也进缓存，自选/重开有兜底
    state.detail.quote = q;
    if (q.name && !/^\d+$/.test(q.name)) el.detailName.textContent = q.name;
    // 宏观利率与外汇（国债收益率/汇率）固定 4 位小数，与卡片墙同口径
    const digits = (q.market === 'macro' || q.market === 'fx') ? 4 : U.priceDigits(q.price);
    const cls = pctClass(q.changePct);
    el.detailPrice.textContent = fmt(q.price, digits);
    el.detailPrice.className = 'detail-price num ' + cls;
    el.detailChg.innerHTML = `<span class="num">${fmtChg(q.change, digits)}</span><span class="num">${fmtPct(q.changePct)}</span>`;
    el.detailChg.className = 'detail-chg num ' + cls;
    // 港/美指数的成交量与成交额同源（腾讯 f[36]≈f[37]），同屏两个一样的数是假象；
    // A股指数成交量是真实手数，保留
    const volIsFake = t.market === 'index' && !/^(sh|sz|bj)/.test(t.symbol || '');
    el.detailStats.innerHTML = [
      ['今开', fmt(q.open, digits)], ['昨收', fmt(q.prevClose, digits)],
      ['最高', fmt(q.high, digits)], ['最低', fmt(q.low, digits)],
      volIsFake ? null : ['成交量', fmtVol(q.volume)],
      q.amount ? ['成交额', fmtVol(q.amount)] : null,
      ['更新', fmtTime(q.updatedAt)],
    ].filter(Boolean).map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
  }

  function disposeChart() {
    if (state.chart) { state.chart.remove(); state.chart = null; state.chartKind = null; }
    // 提醒价格线挂在旧图表系列上，图表销毁必须解绑
    if (window.AlertCenter) window.AlertCenter.attachChart(null);
    el.klineChart.innerHTML = '';
  }

  async function loadDetailChart() {
    const t = state.detail;
    if (!t) return;
    const period = state.detailPeriod;
    // 竞态守卫：快速切周期/换标的时，慢的旧请求回来不许覆盖新图
    const gen = ++state.chartGen;
    const stale = () => gen !== state.chartGen || state.detail !== t;
    el.chartBox.classList.remove('off');
    let data = [];
    let kind = period === 'min' ? 'trend' : 'kline';

    if (t.market === 'crypto') {
      const CRYPTO_IV = { min: '5m', m5: '5m', m15: '15m', m60: '1h', week: '1w', month: '1M' };
      const iv = CRYPTO_IV[period] || '1d';
      data = await window.BinanceSource.getKline(t.binance || t.code, iv, period === 'min' ? 288 : 320);
      kind = 'kline';   // 加密 24h 交易，分时用 5 分钟 K 更可读
    } else if (period === 'min') {
      const sym = t.tencent || tencentOfSecid(t.secid);
      // 入参白名单校验后再发起网络请求（防 URL 注入 / SSRF 污点）
      const symSafe = /^[a-z]{2}[0-9a-z.]{1,12}$/i.test(String(sym)) ? sym : '';
      if (symSafe) data = await window.TencentSource.getMinute(symSafe);
      if (data.length < 2) {
        // 分时拿不到/只有单点（美股盘后）→ 用日K兜底，不白屏
        kind = 'kline';
        data = await klineFor(t, 'day');
      }
    } else {
      data = await klineFor(t, period);
    }

    if (stale()) return;            // 期间用户又切了周期/退出了详情

    if (!data.length) {
      // 该周期真的没数据：整块收起，不留占位文案（用户明确要求）
      disposeChart();
      el.chartBox.classList.add('off');
      return;
    }

    if (state.chartKind !== kind) {
      disposeChart();
      state.chart = kind === 'trend' ? window.Charts.createTrend(el.klineChart) : window.Charts.createKline(el.klineChart);
      state.chartKind = kind;
    }
    if (!state.chart) { el.chartBox.classList.add('off'); return; }
    if (kind === 'trend') {
      // prevClose 优先用卡片/缓存里同步可得的报价，避免与 refreshDetailQuote 的竞态
      // （四路并行时 quote 常常未到，null 会让 charts 把收跌日整条染成涨色）
      const cached = findQuote(t.symbol);
      const prev = (state.detail.quote && state.detail.quote.prevClose !== null) ? state.detail.quote.prevClose
        : (cached && cached.prevClose !== null && cached.prevClose !== undefined) ? cached.prevClose : null;
      state.chart.setData(data, prev);
    } else {
      state.chart.setData(data);
      state.chart.setMAVisible(state.detailMACfg.lines);
    }
    // 事件标记层：全球事件 + 龙虎榜按 symbol 落位（分时为 no-op）
    applyDetailEvents();
    // 提醒价格线：只有 K 线（有 candle 系列）能画；分时图不画
    if (window.AlertCenter) window.AlertCenter.attachChart(kind === 'kline' ? state.chart : null, t);
    // 分时下 MA 无意义（加密的 5 分钟 K 除外），禁用开关以免"看起来坏了"
    if (el.maToggle) el.maToggle.disabled = (kind === 'trend' && t.market !== 'crypto');
  }

  // in-flight 去重：详情页 loadDetailChart 与 loadTechnical 并行时会同参请求两次日K，
  // 以 symbol+period 为 key 共享同一个 Promise，省一半请求
  const klineInflight = new Map();
  function klineFor(t, period) {
    const key = (t.tencent || t.secid || t.binance || t.symbol) + '|' + period;
    if (!klineInflight.has(key)) {
      klineInflight.set(key, klineForRaw(t, period).finally(() => klineInflight.delete(key)));
    }
    return klineInflight.get(key);
  }

  async function klineForRaw(t, period) {
    const sym = t.tencent || tencentOfSecid(t.secid);
    if (INTRADAY_PERIODS.includes(period)) {
      // 分钟级K：腾讯 mkline 仅 A股/A股指数（openDetail 已按市场挡掉港美，加密走币安分支）
      if (t.market === 'crypto' || !sym) return [];
      return window.TencentSource.getMinuteKline(sym, period, 320);
    }
    if (sym) {
      const d = await window.TencentSource.getKline(sym, period);
      if (d.length) return d;
    }
    if (t.secid) {
      const klt = period === 'week' ? 102 : period === 'month' ? 103 : 101;
      const d = await window.EastmoneySource.getKline(t.secid, klt);
      if (d.length) return d;
    }
    return [];
  }


  function updateStar() {
    const t = state.detail;
    if (!t) return;
    const on = window.Store.watchlist.has(t.symbol);
    el.detailStar.textContent = on ? '★' : '☆';
    el.detailStar.classList.toggle('on', on);
    // 读屏器需要知道按钮身份与收藏状态（卡片墙星标有，详情页这颗曾漏掉）
    el.detailStar.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    el.detailStar.setAttribute('aria-pressed', String(on));
  }

  /* ==================== 新闻流 ==================== */

  async function loadNews() {
    const { list, via, cachedAt } = await window.NewsSource.getNews();
    const known = new Set(state.news.map(x => x.id));
    state.news = list;
    state.newsVia = via;
    state.newsCachedAt = cachedAt;
    state.newsLoadedAt = Date.now();   // 进入新闻 tab 时据此判断要不要立刻重拉
    renderNews(known);
  }

  function newsFiltered() {
    const kw = (el.searchInput.value || '').trim();
    const isNewsView = state.tab === 'events' && state.eventsSub === 'news';
    return state.news.filter(it => {
      if (!CRYPTO_ON && window.NewsSource.matchMarket(it, 'crypto')) return false;   // 合规开关：加密快讯不放行
      if (!window.NewsSource.matchMarket(it, state.newsMkt)) return false;
      if (state.newsCat !== 'all' && window.NewsSource.classify(it) !== state.newsCat) return false;
      if (isNewsView && kw) return (it.title + ' ' + (it.summary || '')).toLowerCase().includes(kw.toLowerCase());
      return true;
    });
  }

  // 新闻板块 pill：由当前新闻池动态生成（有内容的板块才显示），横滚
  function renderNewsCatBar() {
    if (!el.newsCatBar) return;
    const counts = {};
    state.news.forEach(it => {
      const c = window.NewsSource.classify(it);
      if (c) counts[c] = (counts[c] || 0) + 1;
    });
    const chainNames = {};
    window.INDUSTRY_CHAINS.forEach(c => { chainNames[c.id] = c.name; });
    chainNames.macro = '宏观';
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (!cats.length) { el.newsCatBar.innerHTML = ''; return; }
    el.newsCatBar.innerHTML = ['all'].concat(cats).map(c =>
      `<button class="pill${state.newsCat === c ? ' active' : ''}" data-newscat="${c}">${c === 'all' ? '全部板块' : escapeHTML(chainNames[c] || c)}<b class="num">${c === 'all' ? state.news.length : counts[c]}</b></button>`
    ).join('');
  }

  // 新闻时间：绝对时刻（mono），比相对时间"X 分钟前"更符合终端/报刊排版
  function fmtNewsTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? p(d.getHours()) + ':' + p(d.getMinutes())
      : (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  const newsItemHTML = (it, isNew) => {
    // 只放行 http(s)，防 javascript: 之类 scheme（escapeHTML 挡不住协议层）
    const safeUrl = /^https?:\/\//i.test(it.url || '') ? it.url : '';
    const tag = safeUrl ? 'a' : 'div';
    const href = safeUrl ? ` href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener"` : '';
    return `<${tag} class="news-item${isNew ? ' news-new' : ''}" data-id="${escapeHTML(it.id)}"${href}>
        <div class="news-meta">
          <span class="num">${escapeHTML(fmtNewsTime(it.time))}</span>
          <span class="news-src">${escapeHTML(it.source)}</span>
        </div>
        <div class="news-title">${escapeHTML(it.title)}</div>
        ${it.summary ? `<div class="news-summary">${escapeHTML(it.summary)}</div>` : ''}
      </${tag}>`;
  };

  function renderNews(knownIds) {
    renderNewsCatBar();
    const list = newsFiltered();
    const viaTxt = state.newsVia === 'cache' ? '缓存 · ' + fmtTime(state.newsCachedAt)
      : state.newsVia === 'eastmoney' ? '备用源 · 东方财富'
        : state.newsVia === 'sina' ? '新浪滚动' : '暂无数据源';
    const shown = Math.min(list.length, 120);
    el.newsSub.textContent = `${viaTxt} · 显示 ${shown} / 共 ${list.length} 条 · 60s 自动刷新`;
    if (!list.length) {
      el.newsList.innerHTML = '<div class="empty">暂无相关新闻</div>';
      state.newsFilterKey = null;
      return;
    }

    // 过滤键没变且是"纯顶部插入"（旧条目无删除、相对顺序不变）→ 只插新条目、
    // 原地刷新时间文案；过滤/搜索变化才整体重建
    // 搜索词只在事件页快讯面板参与过滤（与 newsFiltered 的 isNewsView 同口径），
    // 旧代码判断的 state.view === 'news' 是永假死条件，搜索词永远进不了过滤键
    const isNewsSearch = state.tab === 'events' && state.eventsSub === 'news';
    const filterKey = state.newsMkt + '|' + state.newsCat + '|' +
      (isNewsSearch ? (el.searchInput.value || '').trim().toLowerCase() : '');
    const domSeq = Array.from(el.newsList.querySelectorAll('.news-item')).map(n => n.dataset.id);
    const newList = list.slice(0, shown);
    const domSet = new Set(domSeq);
    const fresh = newList.filter(it => !domSet.has(it.id));
    const kept = newList.filter(it => domSet.has(it.id)).map(it => it.id);
    const removed = domSeq.filter(id => !newList.some(it => it.id === id));
    const purePrepend = state.newsFilterKey === filterKey && domSeq.length > 0 &&
      removed.length === 0 && kept.join('') === domSeq.join('');
    const anim = !reduceMotion() && knownIds && knownIds.size;

    if (purePrepend) {
      if (fresh.length) {
        const frag = document.createElement('template');
        frag.innerHTML = fresh.map(it => newsItemHTML(it, anim && !knownIds.has(it.id))).join('');
        el.newsList.prepend(frag.content);
      }
      // 超出 120 条的旧节点从尾部裁掉；时间文案原地刷新（"X 分钟前"随时间走）
      const nodes = el.newsList.querySelectorAll('.news-item');
      for (let i = nodes.length - 1; i >= shown; i--) nodes[i].remove();
      const byId = new Map(state.news.map(x => [x.id, x]));
      el.newsList.querySelectorAll('.news-item').forEach(n => {
        const it = byId.get(n.dataset.id);
        if (!it) return;
        const t = n.querySelector('.news-meta .num');
        const txt = fmtNewsTime(it.time);
        if (t && t.textContent !== txt) t.textContent = txt;
      });
      state.newsFilterKey = filterKey;
      return;
    }

    el.newsList.innerHTML = list.slice(0, 120).map(it => newsItemHTML(it, anim && knownIds && !knownIds.has(it.id))).join('');
    state.newsFilterKey = filterKey;
  }

  /* ==================== 大V喊单（新闻聚合口径） ==================== */
  // 免费无推特 API：用新浪+东财新闻池按人名关键词聚合"关于他们的发言/动作"，诚实标注口径。
  async function loadVoices() {
    const gen = ++state.voicesGen;
    el.voicesList.innerHTML = '<div class="sk sk-row"></div>'.repeat(4);
    const pool = await window.NewsSource.getNewsPool(60);
    if (gen !== state.voicesGen) return;
    state.voices = pool.filter(it => window.NewsSource.matchVoices(it).length);
    state.voicesAt = Date.now();
    renderVoices();
  }

  function renderVoices() {
    if (!el.voicesList) return;
    const list = state.voices || [];
    el.voicesSub.textContent = list.length
      ? `${list.length} 条 · 新浪+东财新闻聚合 · 60s 刷新 · 非原始推文`
      : '新闻池里暂时没有相关发言（口径：新闻聚合，非原始推文）';
    if (!list.length) {
      el.voicesList.innerHTML = '<div class="empty">暂无相关新闻</div>';
      return;
    }
    el.voicesList.innerHTML = list.slice(0, 60).map(it => {
      const people = window.NewsSource.matchVoices(it);
      const badges = people.map(p => `<span class="vb"><span class="vb-en">${escapeHTML(p.en)}</span>${escapeHTML(p.name)}<span class="vb-title">${escapeHTML(p.title)}</span></span>`).join('');
      const safeUrl = /^https?:\/\//i.test(it.url || '') ? it.url : '';
      const tag = safeUrl ? 'a' : 'div';
      const href = safeUrl ? ` href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener"` : '';
      return `<${tag} class="news-item voice-item"${href}>
        <div class="news-meta"><span class="num">${escapeHTML(fmtNewsTime(it.time))}</span><span class="news-src">${escapeHTML(it.source)}</span></div>
        <div class="voice-badges">${badges}</div>
        <div class="news-title">${escapeHTML(it.title)}</div>
        ${it.summary ? `<div class="news-summary">${escapeHTML(it.summary)}</div>` : ''}
      </${tag}>`;
    }).join('');
  }

  /* ==================== 全球指数 ticker（日/德/英/法/韩/印） ==================== */
  const GLOBAL_IDX = [
    { secid: '100.N225', flag: 'jp', name: '日经225' },
    { secid: '100.GDAXI', flag: 'de', name: '德国DAX' },
    { secid: '100.FTSE', flag: 'gb', name: '英国富时100' },
    { secid: '100.FCHI', flag: 'fr', name: '法国CAC40' },
    { secid: '100.KS11', flag: 'kr', name: '韩国KOSPI' },
    { secid: '100.SENSEX', flag: 'in', name: '印度SENSEX' },
  ];
  async function loadGlobe() {
    const qs = await window.EastmoneySource.getQuotes(GLOBAL_IDX.map(x => x.secid));
    if (qs.length) {
      state.globeQuotes = new Map(qs.map(q => [q.secid, q]));
      renderGlobe();
    }
  }

  function renderGlobe() {
    if (!el.globeBar || !state.globeQuotes) return;
    renderGlobeSum();   // 概览条与指数卡共用同一批数据，一起刷新
    const cells = GLOBAL_IDX.map(x => {
      const q = state.globeQuotes.get(x.secid);
      if (!q) return '';
      const cls = pctClass(q.changePct);
      const digits = U.priceDigits(q.price);
      // 与 hero-cell 同构：国旗+名称 / 大数字 / 涨跌行——六大市场与中美平级，不再挤成一行小字
      // 纯展示卡：全球指数的详情页 K 线免费源不稳，不提供点击进详情
      return `<div class="gcard">
        <div class="hero-label"><span>${window.Flags.flag(x.flag)}${escapeHTML(x.name)}</span></div>
        <div class="hero-value">${fmt(q.price, digits)}</div>
        <div class="hero-chg ${cls}"><span>${fmtChg(q.change, digits)}  ${fmtPct(q.changePct)}</span></div>
      </div>`;
    }).join('');
    el.globeBar.innerHTML = cells || '<span class="empty">全球指数暂不可用</span>';
  }

  /* ==================== 全球事件（GDELT 采集 JSON → 地球 / 列表 / K线标记） ==================== */

  function eventsFiltered() {
    if (state.eventsType === 'all') return state.events || [];
    return (state.events || []).filter(e => e.type === state.eventsType);
  }

  async function loadEvents() {
    const { events, via, generatedAt, stale, source } = await window.EventsSource.getEvents();
    state.events = events;
    state.eventsVia = via;
    state.eventsGenAt = generatedAt;
    state.eventsStale = stale;
    state.eventsSource = source;
    state.eventsLoadedAt = Date.now();
    renderGlobeStatus();
    renderEvTypeBar();
    renderEventList();
    renderGlobeLegend();
    applyDetailEvents();   // 新事件可能补上 K 线标记
    syncGeoViews();
  }

  // 状态行：新鲜度看"最新事件的年龄"而不是文件生成时间——
  // "2 小时没有新事件"是世界太平，不是数据坏了；只有最新事件本身变旧才是真滞后。
  // （旧逻辑按 generatedAt+30min 判滞后，采集节奏一慢就永久亮"滞后"吓人）
  function renderGlobeStatus() {
    if (!el.globeStatus) return;
    if (!state.eventsVia) {
      el.globeStatus.classList.add('warn');
      el.globeStatus.textContent = '数据更新中，请稍候 · 通常几分钟内自动恢复';
      return;
    }
    const evs = state.events || [];
    const newest = evs.reduce((m, e) => Math.max(m, e.publishedAt || 0), 0);
    const ageMs = newest ? Date.now() - newest : 0;
    const stale = !newest || ageMs > 2 * 3600 * 1000;   // 最新事件也老过 2 小时 = 上游真停了
    el.globeStatus.classList.toggle('warn', stale);
    const ageTxt = newest ? fmtAgo(newest) : '时间未知';
    const src = (state.eventsVia === 'cache' ? '缓存 · ' : '') + (state.eventsSource || '') +
      ' · 最新事件 ' + ageTxt +
      (stale ? ' · 上游疑似停更' : '');
    el.globeStatus.textContent = state.mapStatusPts ? src + ' · ' + state.mapStatusPts : src;
  }

  function renderEvTypeBar() {
    if (!el.evTypeBar) return;
    const list = state.events || [];
    if (!list.length) { el.evTypeBar.innerHTML = ''; return; }
    const counts = {};
    list.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    el.evTypeBar.innerHTML = ['all'].concat(types).map(t => {
      const meta = window.Events.TYPE_META[t];
      const dot = meta ? `<i class="ev-dot" style="background:${meta.color}"></i>` : '';
      const label = t === 'all' ? '全部类型' : window.Events.typeLabel(t);
      return `<button class="pill${state.eventsType === t ? ' active' : ''}" data-evtype="${t}">${dot}${label}<b class="num">${t === 'all' ? list.length : counts[t]}</b></button>`;
    }).join('');
  }

  function renderGlobeLegend() {
    const html = Array.from(new Set(eventsFiltered().map(e => e.type))).slice(0, 6).map(t =>
      `<span class="gl-item"><i class="ev-dot" style="background:${window.Events.typeColor(t)}"></i>${escapeHTML(window.Events.typeLabel(t))}</span>`).join('');
    if (el.mapLegend) el.mapLegend.innerHTML = html;
  }

  function renderEventList() {
    if (!el.eventList) return;
    const list = eventsFiltered();
    if (!list.length) {
      el.eventList.innerHTML = '<div class="empty">暂无事件数据 · 数据更新中，稍后自动出现</div>';
      return;
    }
    // 列表截断到 80 条要有明示：否则"列表 80 条 vs 统计 102 条"看起来像丢了数据
    const sliced = list.slice(0, 80);
    el.eventList.innerHTML = sliced.map(ev => {
      const sel = state.selEvent && state.selEvent.id === ev.id;
      return `<div class="news-item event-row${sel ? ' sel' : ''}" data-ev="${escapeHTML(ev.id)}" tabindex="0" role="button"
          aria-label="${escapeHTML(ev.title)}">
        <div class="news-meta">
          <span class="ev-dot" style="background:${window.Events.typeColor(ev.type)}"></span>
          <span>${escapeHTML(window.Events.typeLabel(ev.type))}</span>
          <span class="num">${escapeHTML(fmtNewsTime(ev.publishedAt))}</span>
          <span class="news-src">${escapeHTML(ev.source || '')}</span>
          ${ev.importance === 'high' ? '<span class="ev-imp">重要</span>' : ''}
        </div>
        <div class="news-title">${escapeHTML(ev.title)}</div>
      </div>`;
    }).join('') + (list.length > 80 ? `<div class="empty">共 ${list.length} 条 · 仅显示最近 80 条</div>` : '');
  }

  function renderEventDetail(ev) {
    if (!el.eventDetail) return;
    if (!ev) { el.eventDetail.hidden = true; el.eventDetail.innerHTML = ''; return; }
    const meta = window.Events.TYPE_META[ev.type] || {};
    const isCryptoSym = (s) => /USDT$/i.test(s);
    const rel = ev.relatedSymbols.filter(s => CRYPTO_ON || !isCryptoSym(s)).map(sym => {
      const q = findQuote(sym);
      return { sym, name: q ? q.name : sym };
    });
    const safeUrl = /^https?:\/\//i.test(ev.sourceUrl || '') ? ev.sourceUrl : '';
    el.eventDetail.hidden = false;
    el.eventDetail.innerHTML = `<div class="evd-head" style="border-left-color:${meta.color || '#8a93a6'}">
        <span class="evd-type" style="color:${meta.color || '#8a93a6'}">${escapeHTML(window.Events.typeLabel(ev.type))}</span>
        ${ev.importance === 'high' ? '<span class="ev-imp">重要</span>' : ''}
        <span class="num evd-time">${escapeHTML(fmtNewsTime(ev.publishedAt))}</span>
        <button class="evd-close" data-evclose aria-label="关闭事件详情">×</button>
      </div>
      <div class="evd-title">${escapeHTML(ev.title)}</div>
      <div class="evd-meta num">来源 ${escapeHTML(ev.source || '--')}${safeUrl ? ` · <a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener">原文链接</a>` : ''}${ev.country ? ' · ' + escapeHTML(ev.country) : ''}</div>
      ${rel.length ? `<div class="evd-rel"><span class="evd-rel-label">直接关联</span>${rel.map(r =>
        `<button class="rel-chip num" data-relsym="${escapeHTML(r.sym)}">${escapeHTML(r.name)}</button>`).join('')}</div>` : ''}
      ${(ev.relatedAssets && ev.relatedAssets.length) ? `<div class="evd-rel"><span class="evd-rel-label">宏观相关</span>${ev.relatedAssets.filter(r => CRYPTO_ON || !isCryptoSym(r.sym)).map(r => {
        const q = findQuote(r.sym);
        return `<button class="rel-chip rel-soft num" data-relsym="${escapeHTML(r.sym)}" title="宏观映射口径（相关≠因果）">${escapeHTML(q ? q.name : r.sym)}</button>`;
      }).join('')}</div>` : ''}
      ${renderImpactEdges(ev)}`;
  }

  /* ================= 影响边 / 时间轴 / 国家详情（engine 接线） ================= */

  // 采集侧事件类型 → engine 的 NewsCategory（近似映射，推断用）
  const TYPE2CAT = {
    central_bank: 'central_bank', policy: 'trade', macro: 'economy', trade: 'trade',
    conflict: 'war', geopolitics: 'geopolitics', market: 'markets',
    company: 'economy', disaster: 'natural_disaster',
  };
  const IMPACT_KIND_META = {
    DATA: { label: '机制事实', cls: 'k-data' },
    CORRELATION: { label: '历史相关', cls: 'k-corr' },
    AI: { label: 'AI 分析', cls: 'k-ai' },
  };
  const DIR_ARROW = { up: '↑', down: '↓', flat: '→' };
  // relationship 的人话：机制/历史口径认为这个事件对资产是利好还是利空
  const DIR_TEXT = { positive: '利好', inverse: '利空', risk_off: '避险', risk_on: '风偏' };
  // 事件种类的一句话机制综述：给用户"分析"的第一眼（口径描述，不是预测）
  const KIND_SUMMARY = {
    CENTRAL_BANK_HIKE: '政策利率上行 → 国债收益率与本币汇率倾向上行，股票估值与无息资产承压',
    CENTRAL_BANK_CUT: '政策利率下行 → 收益率回落、估值受益；本币倾向走弱、黄金受益',
    RATE_DECISION_HOLD: '利率不变没有机制性方向，各资产按决议后的政策措辞波动',
    ARMED_CONFLICT: '风险偏好受挫 → 避险资产受益、股指承压；冲突未扩散时快速修复',
    OIL_SUPPLY_SHOCK: '供给收缩推高油价 → 进口型经济体成本与通胀上升',
    SANCTIONS: '资本外流与融资受限 → 被制裁方货币承压，避险资产受益',
    TRADE_TARIFF: '贸易条件恶化 → 出口方货币与股市承压',
    EARTHQUAKE: '生产中断与重建支出并存 → 本地股市短期承压为主',
  };

  // 单条事件的资产影响边（News → Event → Impact → Asset 的"Impact"段）
  function renderImpactEdges(ev) {
    if (!window.ImpactEngine || !window.EngineGeo) return '';
    const iso = EngineGeo.iso2OfName(ev.country || '') ||
      (EngineGeo.resolveCountry(ev.title) || {}).country || null;
    const cat = TYPE2CAT[ev.type] || 'economy';
    const edges = window.ImpactEngine.inferImpacts({ title: ev.title, countries: iso ? [iso] : [], categories: [cat] });
    if (!edges.length) return '';
    const groups = { DATA: [], CORRELATION: [], AI: [] };
    edges.forEach(e => { (groups[e.evidence.kind] || (groups[e.evidence.kind] = [])).push(e); });
    const quoteOf = (sym) => {
      const q = findQuote(sym);
      if (!q) return '<span class="imp-q imp-q-na num">行情未接入</span>';
      const pct = q.changePct;
      // 名称已在 chip 上，这里只报"现价"：现价是此刻实际行情，可以和预期方向相反
      return `<span class="imp-q num" title="该资产此刻的实际行情">现 ${fmtPrice(q.price)} <b class="${pctClass(pct)}">${fmtPct(pct)}</b></span>`;
    };
    // 实时对照：当前涨跌与预期方向是否一致（按符号判定，纯描述不做评级）
    const trackOf = (e) => {
      const q = findQuote(e.assetSymbol);
      if (!q || e.direction === 'flat' || q.changePct === null || q.changePct === undefined || isNaN(q.changePct) || q.changePct === 0) return '';
      const same = (e.direction === 'up') === (q.changePct > 0);
      return same ? '<span class="imp-track">与预期同向</span>'
        : '<span class="imp-track rev" title="当前走势与该类事件的机制/历史方向相反——反向不代表会回转，只是如实标注">与预期相反</span>';
    };
    const section = (kind) => {
      const meta = IMPACT_KIND_META[kind];
      const list = groups[kind] || [];
      if (!list.length) return '';   // 空数组也是真值：曾渲染出光秃秃的"AI 分析"标签
      return `<div class="imp-group"><span class="imp-kind ${meta.cls}">${meta.label}</span>` +
        list.map(e => {
          const q = findQuote(e.assetSymbol);
          const chipLabel = (q && q.name) || e.assetSymbol;
          const relTxt = DIR_TEXT[e.relationship] ? ' ' + DIR_TEXT[e.relationship] : '';
          return `<div class="imp-edge">
          <span class="imp-dir ${e.direction} num" title="这类事件对该资产的预期方向（规则/历史口径，非实时预测）">预期${DIR_ARROW[e.direction] || '→'}${relTxt}</span>
          <button class="rel-chip num" data-relsym="${escapeHTML(e.assetSymbol)}" title="${escapeHTML(e.assetSymbol)}">${escapeHTML(chipLabel)}</button>
          <span class="imp-live">${quoteOf(e.assetSymbol)}${trackOf(e)}</span>
          <span class="imp-conf num" title="该条影响的置信度（机制事实高于历史相关）">${Math.round(e.confidence * 100)}%</span>
          <div class="imp-note">${escapeHTML(e.evidence.note)}${e.historicalCases.length ? ' · 案例：' + escapeHTML(e.historicalCases.map(c => c.label + '（' + c.move + '）').join('；')) : ''}</div>
        </div>`;
        }).join('') + '</div>';
    };
    const kind = edges[0].eventKind;
    return `<div class="evd-impacts"><div class="evd-rel-label">资产影响（证据分级）</div>
      ${KIND_SUMMARY[kind] ? `<div class="imp-sum">${KIND_SUMMARY[kind]}</div>` : ''}
      ${section('DATA')}${section('CORRELATION')}${section('AI')}
      <div class="imp-disclaim">「预期」= 这类事件对该资产的机制/历史口径方向；「现」= 该资产此刻的实际行情，两者可以相反（如预期避险涨、现价暂跌）。非投资建议；点击资产查看行情。</div>
    </div>`;
  }

  /* 72h 时间轴已按用户决策移除（"这个表没用"）：无新事件时它几乎全空，
     滞后信息由状态行的"最新事件 N 前"承担 */
  /* 平面地图图层开关条 */
  function renderMapLayers() {
    if (!el.mapLayers || !window.WorldMapView) return;
    const st = window.WorldMapView.layerState();
    const defs = [['points', '事件点'], ['grid', '网格']];
    el.mapLayers.innerHTML = defs.map(([id, label]) =>
      `<button class="pill${st[id] ? ' active' : ''}" data-maplayer="${id}">${label}</button>`).join('');
  }

  /* 国家详情（平面地图点空白 / 后续可从列表国家 chip 进入） */
  function renderCountryDetail(iso2, name) {
    if (!el.countryDetail) return;
    const evs = (state.events || []).filter(e => e.country === name);
    const impRank = { high: 80, med: 60, low: 40 };
    const sev = evs.length ? Math.round(evs.reduce((s, e) => s + (impRank[e.importance] || 40), 0) / evs.length) : 0;
    const assets = window.ImpactEngine ? window.ImpactEngine.countryAssets(iso2) : {};
    const assetRow = ([kind, sym]) => {
      if (!sym) return '';
      const q = findQuote(sym);
      // 涨跌幅读 changePct（q.pct 不存在，曾恒显示 "--" 并恒标跌色）
      const pct = q ? q.changePct : null;
      return `<div class="cd-asset"><span class="cd-kind">${kind === 'fx' ? '汇率' : kind === 'equity' ? '股市' : '国债'}</span>
        <button class="rel-chip num" data-relsym="${escapeHTML(sym)}">${escapeHTML(q ? q.name : sym)}</button>
        ${q ? `<span class="num">${fmtPrice(q.price)} <b class="${pctClass(pct)}">${fmtPct(pct)}</b></span>` : '<span class="num imp-q-na">行情未接入</span>'}</div>`;
    };
    el.countryDetail.hidden = false;
    el.eventDetail.hidden = true;      // 右侧同一时刻二选一：事件详情 or 国家详情
    el.countryDetail.innerHTML = `<div class="evd-head">
        <span class="evd-type">${escapeHTML(name)}</span>
        <span class="num evd-time">近窗事件 ${evs.length} 条 · 事件热度 ${sev}/100</span>
        <button class="evd-close" data-cdclose aria-label="关闭国家详情">×</button>
      </div>
      <div class="evd-title">${escapeHTML(name)} · 国家视图</div>
      ${Object.entries(assets).length ? '<div class="cd-assets">' + Object.entries(assets).map(assetRow).join('') + '</div>'
        : '<div class="empty">该国代表性资产暂未接入行情</div>'}
      <div class="evd-rel-label" style="margin-top:10px">该国最新事件与新闻</div>
      ${evs.length ? evs.slice(0, 6).map(e => `<div class="evd-item" data-ev="${escapeHTML(e.id)}" tabindex="0" role="button">
          <span class="ev-dot" style="background:${window.Events.typeColor(e.type)}"></span>
          <span class="evd-item-t">${escapeHTML(e.title.slice(0, 56))}</span>
          <span class="num evd-item-s">${escapeHTML(fmtNewsTime(e.publishedAt))}</span></div>`).join('')
        : '<div class="empty">窗口内暂无该国事件</div>'}`;
  }

  // 地球聚合点（● N EVENTS）点击 → 展开该区域事件清单
  function showCluster(d) {
    if (!el.eventDetail) return;
    el.eventDetail.hidden = false;
    el.eventDetail.innerHTML = `<div class="evd-head">
        <span class="evd-type num">${d.count} EVENTS</span>
        ${d.evs[0].country ? `<span class="num evd-time">${escapeHTML(d.evs[0].country)}</span>` : ''}
        <button class="evd-close" data-evclose aria-label="关闭事件详情">×</button>
      </div>` +
      d.evs.map(ev => `<div class="evd-item" data-ev="${escapeHTML(ev.id)}" tabindex="0" role="button">
        <span class="ev-dot" style="background:${window.Events.typeColor(ev.type)}"></span>
        <span class="evd-item-t">${escapeHTML(ev.title.slice(0, 64))}</span>
        <span class="num evd-item-s">${escapeHTML(fmtNewsTime(ev.publishedAt))}</span>
      </div>`).join('');
  }

  function selectGlobalEvent(ev) {
    state.selEvent = ev;
    state.countryFocus = null;          // 右侧切回事件详情，退出国家视图
    if (el.countryDetail) el.countryDetail.hidden = true;
    renderEventList();
    renderEventDetail(ev);
    if (window.WorldMapView && state.mapReady) window.WorldMapView.select(ev);   // 平移居中 + 脉冲环
  }

  function syncGeoViews() {   // 事件数据/筛选变化：刷新平面地图（唯一地理视图）
    const evs = eventsFiltered();
    if (state.mapReady && window.WorldMapView) window.WorldMapView.setEvents(evs);
  }

  function ensureWorldMap() {
    if (state.mapReady || state.mapFailed || !el.mapStage) return Promise.resolve(null);
    return window.WorldMapView.create(el.mapStage, {
      onSelect: selectGlobalEvent,
      onCluster: showCluster,
      onStatus: (t) => { state.mapStatusPts = t; if (state.eventsSub === 'map') renderGlobeStatus(); },
      onCountryPick: ({ lat, lng, land }) => {
        // 平面地图空白点击：优先用 countries-110m 点在多边形（精确国界命中，
        // 修复"点新疆判给巴基斯坦"的最近首都算法），海面/无多边形国家再退
        // 最近首都（25° 容差）兜底 → 右侧切国家详情
        let hit = null;
        if (land && land.id && window.EngineGeo) {
          const iso2 = window.EngineGeo.iso2OfNumeric(land.id);
          if (iso2) hit = { country: iso2, name: window.EngineGeo.ISO2_NAME[iso2] || land.name || iso2 };
        }
        if (!hit && window.EngineGeo) hit = window.EngineGeo.nearestCountry(lat, lng, 25);
        if (hit) { state.countryFocus = hit; renderCountryDetail(hit.country, hit.name); }
      },
    }).then(ok => {
      if (ok) {
        state.mapReady = true;
        window.WorldMapView.setEvents(eventsFiltered());
        renderGlobeStatus();
      } else {
        state.mapFailed = true;   // 地图数据不可用：不再反复尝试（事件列表/快讯仍可用）
      }
      return ok;
    });
  }

  function refreshEventsData() {
    if (!state.events || Date.now() - state.eventsLoadedAt > 70000) {
      return loadEvents().catch(() => { /* 降级角标已表达 */ });
    }
    return Promise.resolve();
  }

  function setEventsSub(sub) {
    // 'globe' 存量值归一为 'map'：3D 地球已按用户决策移除，平面地图是唯一地理视图
    if (sub !== 'news' && sub !== 'map') sub = 'map';
    state.eventsSub = sub;
    Store.set('evMode', sub);                 // 记住上次用的视图（平面 / 快讯）
    document.querySelectorAll('[data-evsub]').forEach(b =>
      b.classList.toggle('active', b.dataset.evsub === state.eventsSub));
    const newsMode = sub === 'news';
    if (el.evGlobePane) el.evGlobePane.hidden = newsMode;   // 面板宿主（现仅平面地图）
    if (el.evNewsPane) el.evNewsPane.hidden = !newsMode;
    if (!newsMode) {
      ensureWorldMap();
      refreshEventsData();
      renderMapLayers();
    } else if (!state.news.length) {
      state.newsCat = 'all';   // 进快讯面板重置板块过滤（旧新闻 tab 行为）
      el.newsList.innerHTML = '<div class="sk sk-row"></div>'.repeat(6);
      loadNews();
    } else if (Date.now() - (state.newsLoadedAt || 0) > 55000) {
      loadNews();
    } else {
      renderNews();
    }
  }

  /* ==================== 资金动向（A股龙虎榜 + 公开言论） ==================== */

  async function loadLhb() {
    const res = await window.LhbSource.getLhb();
    state.lhb = res;
    state.lhbAt = Date.now();
    renderLhb();
    applyDetailEvents();   // A 股详情页可能因此补上"龙虎榜"标记
    // 席位目录跟龙虎榜同源（披露日后有数据就拉一次，10 分钟缓存窗口）
    if (!state.actors || Date.now() - state.actorsAt > 600000) {
      loadSeatActors().catch(() => { renderSeatDirectory(); });
    }
  }

  function fmtAmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return String(Math.round(v));
  }

  function renderLhb() {
    if (!el.lhbBox) return;
    const res = state.lhb;
    if (!res || !res.rows.length) {
      el.lhbBox.innerHTML = '<div class="empty">龙虎榜暂不可用，稍后自动重试</div>';
      if (el.lhbVia) el.lhbVia.textContent = '';
      return;
    }
    // 条数写死在文案里会跟着取数上限漂（曾写"前 60"而实际已是 73 行）——用真实行数
    if (el.lhbVia) el.lhbVia.textContent =
      res.tradeDate + ' 披露 · 东财数据中心 · 按净买额降序 ' + res.rows.length + ' 只 · 点击行进K线';
    el.lhbBox.innerHTML = `<div class="lrow-head" aria-hidden="true">
        <span>#</span><span>股票 / 代码</span><span>涨跌幅</span><span>龙虎榜净买</span><span>榜上成交</span><span title="上榜后第一个交易日的涨跌幅，T+1 收盘后才由数据源补齐；最新披露日必然为空">次日</span><span title="上榜后第 5 个交易日的涨跌幅，T+5 收盘后才有值；最新约 5 个披露日都会是空">5日</span><span>上榜原因</span>
      </div>` + res.rows.map((r, i) => `<div class="lrow" data-lhb="${escapeHTML(r.symbol)}" tabindex="0" role="button"
        aria-label="${escapeHTML(r.name)} 龙虎榜净买 ${fmtAmt(r.netAmt)}">
      <span class="lr-no num">${String(i + 1).padStart(2, '0')}</span>
      <span class="lr-name">${escapeHTML(r.name)}<span class="lr-code num">${escapeHTML(r.code)}</span></span>
      <span class="lr-pct num ${pctClass(r.changePct)}">${fmtPct(r.changePct)}</span>
      <span class="lr-net num ${pctClass(r.netAmt)}">${fmtAmt(r.netAmt)}</span>
      <span class="lr-deal num">${fmtAmt(r.dealAmt)}</span>
      <span class="lr-d num">${r.d1 === null ? '--' : fmtPct(r.d1)}</span>
      <span class="lr-d num">${r.d5 === null ? '--' : fmtPct(r.d5)}</span>
      <span class="lr-tag" title="${escapeHTML(r.reason)}">${escapeHTML(r.reason)}</span>
    </div>`).join('');
  }

  /* ==================== 席位动向（Actor Directory / Actor Profile） ==================== */

  async function loadSeatActors() {
    const date = (state.lhb && state.lhb.tradeDate) || window.Events.latestLhbDate();
    if (!date) return;
    const { buyRows, sellRows } = await window.LhbSource.getDayDetails(date);
    const actors = window.Actors.buildSeatActors(buyRows, sellRows);
    state.actors = actors;
    state.actorsDate = date;
    state.actorsAt = Date.now();
    renderSeatDirectory();
  }

  function nameOfStockCode(code) {
    const sym = code.length === 6 && /^6/.test(code) ? 'EM:1.' + code : 'EM:0.' + code;
    const q = findQuote(sym);
    return (q && q.name) || code;
  }

  /* ---- 证券名字解析层 ----
     实测：东财龙虎榜"席位明细"报表（RPT_BILLBOARD_DAILYDETAILSBUY/SELL）不含证券简称，
     档案页"上榜记录"里的股票名必须由解析层补齐：先查本机缓存（localStorage 持久化），
     缺的批量走东财 quote 接口（f14，50 个/请求），仍拿不到就显示代码——绝不造名字。 */
  function stockDisplayName(a) {
    return (a && a.stockName) || state.stockNames[a && a.code] || nameOfStockCode(a && a.code);
  }

  async function ensureStockNames(codes) {
    const missing = [...new Set((codes || []).filter(c => c && !state.stockNames[c]))];
    if (!missing.length) return;
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const secids = chunk.map(c => (/^6/.test(c) ? '1.' : '0.') + c);
      const quotes = await window.EastmoneySource.getQuotes(secids).catch(() => []);
      quotes.forEach(q => {
        if (q && q.name && q.code) state.stockNames[String(q.code)] = q.name;
      });
    }
    try { window.Store.set('stockNames', state.stockNames); } catch { /* 存储满不致命 */ }
  }

  /* ---- 港股通（南向）持有个股（日频）----
     与"席位/龙虎榜"并列的第三类披露口径：这是**通道合计**（内地资金经港股通合计持有多少），
     不是可识别机构——港股没有美股 13F 那种可按机构拆分的免费结构化披露（HKEX 权益披露只有
     HTML 交互、CCASS 条款明文禁止程序化访问），所以到这一层为止，界面上必须这么标。 */
  async function loadSouthbound() {
    try {
      const { date, rows } = await window.SouthboundSource.latest();
      if (rows.length) {
        state.southbound = rows; state.southboundDate = date; state.southboundAt = Date.now();
        Cache.set('sb', { date, rows });
        return;
      }
    } catch (e) { /* 落到缓存 */ }
    const c = Cache.raw('sb');
    if (c && c.val) { state.southbound = c.val.rows; state.southboundDate = c.val.date; }
  }

  function renderSouthbound() {
    if (!el.sbBox) return;
    const list = state.southbound || [];
    if (!list.length) {
      el.sbBox.innerHTML = '<div class="empty">南向持仓暂不可用，稍后自动重试</div>';
      if (el.sbVia) el.sbVia.textContent = '';
      return;
    }
    // 排序用"当日持仓市值变动"（股数 × 收盘价）而不是持股比：比的是**今天动了多少钱**，
    // 否则一个持仓占比极小、但当日翻倍的票会挤掉真正的大额增减。
    const ranked = list
      .map(x => Object.assign({}, x, {
        chgValue: (x.changeShares !== null && x.price !== null) ? x.changeShares * x.price : null,
      }))
      .filter(x => x.chgValue !== null)
      .sort((a, b) => Math.abs(b.chgValue) - Math.abs(a.chgValue));
    if (el.sbVia) el.sbVia.textContent =
      state.southboundDate + ' 持仓 · 共 ' + list.length + ' 只 · 按当日持仓市值变动 Top 30 · 点击进 K 线';
    el.sbBox.innerHTML = `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>股票 / 代码</span><span>南向持股比</span><span>持股市值</span><span>当日增减</span><span>参与券商</span><span></span>
      </div>` + ranked.slice(0, 30).map((x, i) => {
      const cls = pctClass(x.chgValue);
      return `<div class="srow" data-sb="${escapeHTML(x.code)}" data-sb-name="${escapeHTML(x.name)}"
          tabindex="0" role="button" aria-label="${escapeHTML(x.name)} 南向持股 ${x.ratio === null ? '未知' : x.ratio + '%'} 当日增减 ${fmtAmt(x.chgValue)}">
        <span class="sr-no num">${String(i + 1).padStart(2, '0')}</span>
        <span class="sr-name" title="${escapeHTML(x.name)}">${escapeHTML(x.name)}</span>
        <span class="sr-net num">${x.ratio === null ? '--' : x.ratio.toFixed(2) + '%'}</span>
        <span class="sr-buy num">${fmtAmt(x.marketCap)}</span>
        <span class="sr-sell num ${cls}">${fmtAmt(x.chgValue)}</span>
        <span class="sr-count num">${x.participants === null ? '--' : x.participants}</span>
        <span class="sr-arrow">▸</span>
      </div>`;
    }).join('');
  }

  /* ---- A股 基金持仓变动（季度，采集静态 JSON）----
     口径必须随数据一起讲清楚：这是**基金合计**（含 ETF/指数基金），被动申赎也体现为加仓/减仓，
     榜单前列常是宽基权重股——不能读成"主动基金经理在买"。 */
  async function loadFundHolds() {
    try {
      const d = await window.FundHoldsSource.getFundHolds();
      state.fundHolds = d;
      state.fundHoldsAt = Date.now();
      Cache.set('fundholds', d);
    } catch {
      const c = Cache.raw('fundholds');
      if (c && c.val) state.fundHolds = c.val;
    }
    renderFundHolds();
  }

  function renderFundHolds() {
    if (!el.fundBox) return;
    const d = state.fundHolds;
    if (!d) {
      el.fundBox.innerHTML = '<div class="empty">基金持仓暂不可用，稍后自动重试</div>';
      if (el.fundVia) el.fundVia.textContent = '';
      return;
    }
    const isAdd = state.fundDir !== 'trim';
    const rows = (isAdd ? d.topAdd : d.topTrim) || [];
    document.querySelectorAll('[data-funddir]').forEach(b => {
      const on = b.getAttribute('data-funddir') === (isAdd ? 'add' : 'trim');
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (el.fundVia) {
      el.fundVia.textContent = (d.reportDate || '?') + (d.reportDateName ? ' ' + d.reportDateName : '') +
        (d.lagDays === null || d.lagDays === undefined ? '' : '（距期末 ' + d.lagDays + ' 天）') +
        ' · 基金合计口径（含 ETF）· 按变动金额 Top ' + rows.length;
    }
    el.fundBox.innerHTML = `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>股票 / 代码</span><span>基金占流通</span><span>持仓市值</span><span>变动金额</span><span>变动幅度</span><span></span>
      </div>` + rows.slice(0, 40).map((x, i) => {
      // 用东财 secucode（300308.SZ）反推腾讯 symbol（sz300308），走详情页已有的 A股 路径
      const [code, ex] = String(x.secucode || '').split('.');
      const sym = code ? ((ex === 'SH' ? 'sh' : 'sz') + code) : '';
      return `<div class="srow" ${sym ? `data-fundsym="${escapeHTML(sym)}"` : ''} data-fundname="${escapeHTML(x.name)}"
          tabindex="0" role="button" aria-label="${escapeHTML(x.name)} 基金${isAdd ? '增持' : '减持'} ${fmtAmt(x.chgValue)}">
        <span class="sr-no num">${String(i + 1).padStart(2, '0')}</span>
        <span class="sr-name" title="${escapeHTML(x.name)}">${escapeHTML(x.name)}</span>
        <span class="sr-net num">${x.freeRatio === null ? '--' : x.freeRatio.toFixed(2) + '%'}</span>
        <span class="sr-buy num">${fmtAmt(x.holdValue)}</span>
        <span class="sr-sell num ${pctClass(x.chgValue)}">${fmtAmt(x.chgValue)}</span>
        <span class="sr-count num">${x.chgRatio === null ? '--' : fmtPct(x.chgRatio)}</span>
        <span class="sr-arrow">${sym ? '▸' : ''}</span>
      </div>`;
    }).join('');
  }

  /* ---- 美股 因子 ETF 持仓（Invesco 官方日更持仓，采集静态 JSON）----
     动量 ETF 的持仓回答"趋势资金集中在哪"，低波 ETF 回答"防御资金在哪"，
     交集是同时被两类因子选中的股票。这是编制规则调仓后的被动持仓，不是基金经理的主观判断。 */
  async function loadEtf() {
    try {
      const d = await window.EtfSource.getEtfHoldings();
      state.etf = d;
      state.etfAt = Date.now();
      Cache.set('etf', d);
    } catch {
      const c = Cache.raw('etf');
      if (c && c.val) state.etf = c.val;
    }
    renderEtf();
  }

  function renderEtf() {
    if (!el.etfBox) return;
    const d = state.etf;
    if (!d) {
      el.etfBox.innerHTML = '<div class="empty">因子 ETF 持仓暂不可用，稍后自动重试</div>';
      if (el.etfVia) el.etfVia.textContent = '';
      return;
    }
    document.querySelectorAll('[data-etfsub]').forEach(b => {
      const on = b.getAttribute('data-etfsub') === state.etfSub;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    // 三个子视图共用一套 7 列网格（与基金持仓行同款）；三列数值的格式由调用方定死——
    // 交集视图三列都是百分比，单基金视图是 占净值% / 市值 / 股数，不能在行内按列号猜格式
    const rowHtml = (x, i, cells, tag) => {
      const nm = x.zh || x.ticker;
      return `<div class="srow" ${x.sym ? `data-etfsym="${escapeHTML(x.sym)}"` : ''} data-etfname="${escapeHTML(nm)}"
          tabindex="0" role="button" aria-label="${escapeHTML(nm)} ${cells.join(' ')}">
        <span class="sr-no num">${String(i + 1).padStart(2, '0')}</span>
        <span class="sr-name" title="${escapeHTML(x.zh || x.ticker)}">${escapeHTML(nm)}<span class="lr-code num">${escapeHTML(x.ticker || '')}</span></span>
        ${cells.map(c => `<span class="sr-net num">${c}</span>`).join('')}
        <span class="sr-count">${tag || ''}</span>
        <span class="sr-arrow">${x.sym ? '▸' : ''}</span>
      </div>`;
    };
    const pctCell = (v) => (v === null || v === undefined || isNaN(v)) ? '--' : v.toFixed(2) + '%';
    let head, rowsHtml, via;
    if (state.etfSub === 'both') {
      const ov = d.overlap || { keys: [], labels: {}, rows: [] };
      const k = ov.keys || [];
      head = `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>股票 / 代码</span><span>${escapeHTML((ov.labels || {})[k[0]] || '动量')}占净值</span><span>${escapeHTML((ov.labels || {})[k[1]] || '低波')}占净值</span><span>合计</span><span>类型</span><span></span>
      </div>`;
      rowsHtml = ov.rows.map((x, i) => rowHtml(x, i, [
        pctCell(x.pcts[k[0]]), pctCell(x.pcts[k[1]]),
        pctCell((x.pcts[k[0]] || 0) + (x.pcts[k[1]] || 0)),
      ], x.type === 'REIT' ? 'REIT' : '')).join('');
      via = d.asOf + ' 持仓基准 · 同时被动量与低波 ETF 持有 ' + ov.rows.length + ' 只 · 按两者占净值合计排序';
    } else {
      const f = d.funds.find(x => x.key === state.etfSub) || d.funds[0];
      head = `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>股票 / 代码</span><span>占净值</span><span>持仓市值</span><span>持股数</span><span>类型</span><span></span>
      </div>`;
      rowsHtml = f.holdings.map((x, i) => rowHtml(x, i, [
        pctCell(x.pct), fmtUsd(x.valueUsd), x.units === null || x.units === undefined ? '--' : fmtVol(x.units),
      ], x.type === 'REIT' ? 'REIT' : '')).join('');
      // Top 覆盖度必须显示：低波近乎等权，Top40 只占约一半净值，不写会误读成"前 40 = 主力"
      via = d.asOf + ' 持仓基准 · 官网发布 ' + d.published + ' · ' + f.zh + '（' + f.ticker +
        '）Top' + f.shownCount + ' 占净值 ' + f.shownPct.toFixed(1) + '%（共 ' + f.equityCount + ' 只股票）';
    }
    if (el.etfVia) el.etfVia.textContent = via + ' · 点击行进 K 线';
    el.etfBox.innerHTML = head + rowsHtml;
  }

  /* 披露面板的子页切换：按钮 data-fundssub="<key>" ↔ 内容 data-fundspane="<key>"。
     加基金持仓后 A股 面板有三块，竖排会让这一屏越滚越长（用户要求"别都堆在一起"）。 */
  function switchFundsSub(bar, key) {
    const panel = bar.parentElement;
    if (!panel) return;
    bar.querySelectorAll('[data-fundssub]').forEach(b => {
      const on = b.getAttribute('data-fundssub') === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    panel.querySelectorAll('[data-fundspane]').forEach(p => {
      p.hidden = p.getAttribute('data-fundspane') !== key;
    });
  }

  function renderSeatDirectory() {
    if (!el.seatDir) return;
    const list = state.actors || [];
    if (!list.length) {
      el.seatDir.innerHTML = '<div class="empty">席位明细暂不可用，稍后自动重试</div>';
      if (el.seatDirVia) el.seatDirVia.textContent = '';
      return;
    }
    // 深股通专用 / 沪股通专用 / 机构专用不是"可识别的营业部席位"，而是通道合计：
    // 实测单日 深股通专用 买 39.2 亿 / 卖 30.8 亿，净额只 +8.4 亿——把两个方向的巨额对冲
    // 压成一个数字排在真实营业部榜的前列（实测它常占第 1、第 2 名），读者会误读成
    // "某个聪明钱席位在大举买入"。拆成独立分组：既不丢信息，也不再冒充席位。
    const isChannel = (a) => /专用$/.test(a.name);
    const channels = list.filter(isChannel);
    const seats = list.filter(a => !isChannel(a));
    if (el.seatDirVia) el.seatDirVia.textContent =
      state.actorsDate + ' · 按净额绝对值 Top 30 · 可识别席位 ' + seats.length + ' 个' +
      (channels.length ? ' + 通道合计 ' + channels.length + ' 个' : '') + ' · 点击进席位档案';
    const rowOf = (a, i, mode) => {
      const cls = pctClass(a.stats.net);
      const lastCol = mode === 'channel'
        ? '<span class="sr-count num">全市场汇总</span>'
        : `<span class="sr-count num">${a.stats.stockCount} 股 / ${a.stats.activityCount} 次</span>`;
      // 通道行不给 data-actor：通道没有"席位档案"（90 天轨迹对聚合口径无意义），避免点进空档案
      const attrs = mode === 'channel'
        ? 'aria-label="' + escapeHTML(a.name) + ' 净额 ' + fmtAmt(a.stats.net) + '（通道合计）"'
        : 'data-actor="' + escapeHTML(a.id) + '" tabindex="0" role="button" aria-label="' + escapeHTML(a.name) + ' 净买 ' + fmtAmt(a.stats.net) + '"';
      return `<div class="srow" ${attrs}>
        <span class="sr-no num">${String(i + 1).padStart(2, '0')}</span>
        <span class="sr-name" title="${escapeHTML(a.name)}">${escapeHTML(a.name)}</span>
        <span class="sr-net num ${cls}">${fmtAmt(a.stats.net)}</span>
        <span class="sr-buy num up">${fmtAmt(a.stats.buy)}</span>
        <span class="sr-sell num down">${fmtAmt(a.stats.sell)}</span>
        ${lastCol}
        <span class="sr-arrow">${mode === 'channel' ? '' : '▸'}</span>
      </div>`;
    };
    const chanHtml = channels.length ? `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>通道合计（不是可识别席位）</span><span>净额</span><span>买入</span><span>卖出</span><span>口径</span><span></span>
      </div>` + channels.map((a, i) => rowOf(a, i, 'channel')).join('') + '<div class="srow-gap" aria-hidden="true"></div>' : '';
    el.seatDir.innerHTML = chanHtml + `<div class="srow-head" aria-hidden="true">
        <span>#</span><span>席位（营业部）</span><span>净额</span><span>买入</span><span>卖出</span><span>动向</span><span></span>
      </div>` + seats.slice(0, 30).map((a, i) => rowOf(a, i, 'seat')).join('');
  }

  /* ---- 席位档案（#actor=seat:CODE 深链，一级视图） ---- */

  async function openActor(id, opts) {
    state.prevView = state.view === 'actor' ? state.prevView : state.tab;
    state.view = 'actor';
    setView('actor');
    if (!opts || opts.push !== false) navigate('#actor=' + encodeURIComponent(id));
    const gen = ++state.actorGen;
    state.actor = { id };
    const code = String(id).replace(/^seat:/, '');
    // 首屏：先给目录里已知的基本信息，历史明细异步补
    const known = (state.actors || []).find(a => a.id === id);
    el.actorName.textContent = known ? known.name : '席位 ' + code;
    document.title = (known ? known.name : '席位档案') + ' · OpenFinLens';
    el.actorMeta.innerHTML = '';
    el.actorStats.innerHTML = '';
    el.actorTimeline.innerHTML = '<div class="sk sk-row"></div>';
    if (known) renderActorStats(known.stats, known.stats);

    let hist;
    try {
      const raw = await window.LhbSource.getSeatRawHistory(code, 90);
      if (gen !== state.actorGen) return;   // 等待期间用户已离开/切换席位
      hist = window.Actors.buildSeatHistory(raw.buyRows, raw.sellRows, 24);
    } catch {
      if (gen !== state.actorGen) return;
      el.actorTimeline.innerHTML = '<div class="empty">席位历史明细暂不可用（东财数据中心未响应）</div>';
      return;
    }
    state.actor = { id, code, name: known ? known.name : null, hist };
    renderActorStats(known ? known.stats : null, hist.stats);
    renderActorTimeline(hist, code);
    // 明细报表不带证券简称：异步补齐后原地重渲（名称先出结构，名字随后跟上）
    ensureStockNames(hist.activities.map(a => a.code)).then(() => {
      if (state.actor && state.actor.id === id && state.actor.hist) {
        renderActorTimeline(state.actor.hist, state.actor.code);
      }
    });
  }

  function renderActorStats(todayStats, histStats) {
    if (!el.actorStats) return;
    const cells = [
      { label: '近90天上榜', value: histStats.activityCount + ' 次' },
      { label: '买入 / 卖出笔数', value: `<span class="up">${histStats.buyCount}</span> / <span class="down">${histStats.sellCount}</span>` },
      { label: '涉及股票', value: histStats.stockCount + ' 只' },
      { label: '上榜股 3 日上涨概率(历史)', value: (histStats.avgRiseProb3d === null || histStats.avgRiseProb3d === undefined) ? '--' : histStats.avgRiseProb3d.toFixed(1) + '%' },
    ];
    if (todayStats) {
      cells.push(
        { label: '今日买入', value: `<span class="up">${fmtAmt(todayStats.buy)}</span>` },
        { label: '今日卖出', value: `<span class="down">${fmtAmt(todayStats.sell)}</span>` },
        { label: '今日净额', value: `<span class="${pctClass(todayStats.net)}">${fmtAmt(todayStats.net)}</span>` },
        { label: '今日涉及', value: todayStats.stockCount + ' 只' },
      );
    }
    el.actorStats.innerHTML = cells.map(c => `<div class="bd-cell">
        <div class="bd-label">${c.label}</div>
        <div class="bd-value num">${c.value}</div>
      </div>`).join('');
    if (el.actorStatsSub) el.actorStatsSub.textContent = window.Actors.SOURCE;
    if (el.actorMeta) el.actorMeta.innerHTML =
      `<div>口径<b>营业部席位（非个人账户）</b></div><div>披露<b>交易所龙虎榜 · 日频</b></div><div>可信度<b>${window.Actors.CONFIDENCE}</b></div>`;
  }

  function renderActorTimeline(hist, seatCode) {
    if (!el.actorTimeline) return;
    if (!hist.activities.length) {
      el.actorTimeline.innerHTML = '<div class="empty">近 90 天无龙虎榜上榜记录</div>';
      return;
    }
    el.actorTimeline.innerHTML = `<div class="srow-head" aria-hidden="true">
        <span>日期</span><span>股票</span><span>方向</span><span>净额</span><span>买入</span><span>卖出</span><span>上榜原因</span>
      </div>` + hist.activities.map(a => {
      const cls = pctClass(a.net);
      return `<div class="srow" data-activity="${escapeHTML(a.id)}" tabindex="0" role="button"
          aria-label="${a.tradeDate} ${escapeHTML(a.code)} ${a.action}">
        <span class="sr-date num">${escapeHTML(a.tradeDate.slice(5))}</span>
        <span class="sr-stock">${escapeHTML(stockDisplayName(a))}<span class="lr-code num">${escapeHTML(a.code)}</span></span>
        <span class="sr-act num ${a.action === 'BUY' ? 'up' : 'down'}">${a.action === 'BUY' ? '买入' : '卖出'}</span>
        <span class="sr-net num ${cls}">${fmtAmt(a.net)}</span>
        <span class="sr-buy num up">${a.buy === null ? '--' : fmtAmt(a.buy)}</span>
        <span class="sr-sell num down">${a.sell === null ? '--' : fmtAmt(a.sell)}</span>
        <span class="sr-tag" title="${escapeHTML(a.explanation)}">${escapeHTML(a.explanation)}</span>
      </div>`;
    }).join('');
    el.actorTimeline.querySelectorAll('[data-activity]').forEach((row, i) => {
      row.addEventListener('click', () => {
        const a = hist.activities[i];
        state.pendingActivity = a;   // K 线加载后叠"席位买/卖"标记
        openDetail({ symbol: a.symbol, name: stockDisplayName(a), code: a.code, market: 'cn', secid: a.symbol.slice(3), tencent: tencentOfSecid(a.symbol.slice(3)) });
      });
    });
    void seatCode;
  }

  function leaveActor() {
    state.actor = null;
    state.actorGen++;
    document.title = 'OpenFinLens · 全球金融看板';
  }

  /* ==================== 机构持仓 · 13F（SEC → 静态 JSON，多家机构） ====================
     采集脚本 _scripts/collect-13f.mjs 跑在本地/Actions，浏览器只读静态文件。
     口径诚实：13F 是季度披露的多头持仓；**报告期末到提交日实测滞后 34~45 天**，
     所以标题里必须写天数——否则会被当成"最近持仓"。期权行单列（kind=CALL/PUT），
     其"股数"是名义合约股数，不是持股。 */

  function fmtUsd(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    // 分级到"万"：13F 里期权行的市值常在百万美元级，只按"亿美元"取一位小数会显示成
    // "0.0 亿美元"——比不显示更误导（实测 ARK 那张 Call = $71.9 万）。
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + ' 万亿美元';
    if (a >= 1e8) return (v / 1e8).toFixed(1) + ' 亿美元';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + ' 万美元';
    return v.toFixed(0) + ' 美元';
  }
  const BRK_CHANGE_META = {
    NEW:  { label: '新进', cls: 'up' },
    ADD:  { label: '增持', cls: 'up' },
    TRIM: { label: '减持', cls: 'down' },
    HOLD: { label: '不变', cls: 'flat' },
    EXIT: { label: '退出', cls: 'down' },
  };

  async function loadBrk() {
    let d;
    try {
      d = await window.SecSource.get13F();   // 采集静态 JSON（sources/sec.js）
      window.SourceState.ok('brk');
    } catch {
      const c = Cache.raw('brk');
      if (c && c.val && Array.isArray(c.val.institutions) && c.val.institutions.length) {
        d = Object.assign({}, c.val, { via: 'cache' });
      } else {
        window.SourceState.fail('brk', 'SEC 13F 采集不可用');
        renderBrkEmpty();
        return;
      }
    }
    state.brk = d;
    state.brkAt = Date.now();
    if (d.via !== 'cache') Cache.set('brk', d);
    renderBrk();
  }

  function renderBrkEmpty() {
    if (!el.brkBox) return;
    el.brkBox.innerHTML = '<div class="empty">暂无 13F 持仓数据 · 数据来自 SEC 官方季度披露，更新中</div>';
    if (el.brkVia) el.brkVia.textContent = '';
  }

  function renderBrk() {
    if (!el.brkBox) return;
    const d = state.brk;
    const list = (d && Array.isArray(d.institutions)) ? d.institutions : [];
    if (!list.length) { renderBrkEmpty(); return; }
    const idx = Math.min(Math.max(state.brkIdx || 0, 0), list.length - 1);
    state.brkIdx = idx;
    const cur = list[idx];
    if (el.brkVia) {
      // 滞后天数必须显示：13F 是季度披露，实测报告期末→提交日滞后 34~45 天，
      // 不写天数用户会把它当成"最近持仓"。
      el.brkVia.textContent = (d.via === 'cache' ? '缓存 · ' : '') +
        cur.reportDate + ' 报告期 · 提交 ' + (cur.filedAt || '?') +
        (cur.lagDays === null || cur.lagDays === undefined ? '' : '（滞后 ' + cur.lagDays + ' 天）') +
        ' · 组合 ' + fmtUsd(cur.totalValueUsd) +
        (cur.optionRows ? ' · 含 ' + cur.optionRows + ' 项期权' : '');
    }
    const changeChip = (h) => {
      const m = BRK_CHANGE_META[h.change] || { label: '--', cls: 'flat' };
      // 不变/新进不带百分比（HOLD 的 0.00% 是噪音）
      const pctTxt = (h.change === 'ADD' || h.change === 'TRIM') && h.sharesChangePct !== null && h.sharesChangePct !== undefined && !isNaN(h.sharesChangePct)
        ? ' ' + fmtPct(h.sharesChangePct) : '';
      return `<span class="brk-chg ${m.cls}">${m.label}${pctTxt}</span>`;
    };
    // 期权行必须与现货分开标注：kind=CALL/PUT 的"股数"是名义合约股数，不是持股
    const kindTag = (h) => h.kind === 'CALL' ? '<span class="qc-flag">看涨期权</span>'
      : h.kind === 'PUT' ? '<span class="qc-flag">看跌期权</span>' : '';
    // 期权行**必须**出现在可见列表里：它们按市值排序常排到 Top40 之外（实测 ARK 那张 Call 就是），
    // 但期权恰恰是"这家机构在做什么方向"最该看的东西。所以先取 Top40，再把漏掉的期权行补进来。
    const top40 = cur.holdings.slice(0, 40);
    const missingOpts = cur.holdings.filter(h => h.kind !== 'SH' && !top40.includes(h));
    const shown = top40.concat(missingOpts);
    el.brkBox.innerHTML = `<div class="heat-toolbar" role="tablist" aria-label="13F 申报机构">` +
        list.map((x, i) => `<button class="pill ${i === idx ? 'active' : ''}" data-brk-idx="${i}"
          role="tab" aria-selected="${i === idx}" title="${escapeHTML(x.reportDate + ' 报告期' + (x.viaNtAccession ? ' · 经 13F-NT 顺藤申报主体' : ''))}"
          >${escapeHTML(x.name)}</button>`).join('') +
      `</div><div class="brow-head" aria-hidden="true">
        <span>发行公司</span><span>持仓市值</span><span>持股数</span><span>占比</span><span>环比</span>
      </div>` + shown.map(h => `
      <div class="brow" tabindex="0" role="button"
        aria-label="${escapeHTML(h.issuer)}${h.kind === 'SH' ? '' : h.kind === 'CALL' ? ' 看涨期权' : ' 看跌期权'} 持仓 ${fmtUsd(h.valueUsd)}">
        <span class="br-name">${kindTag(h)}${escapeHTML(h.issuer)}<span class="lr-code num">${escapeHTML(h.cusip || '')}</span></span>
        <span class="br-val num">${fmtUsd(h.valueUsd)}</span>
        <span class="br-shares num">${h.shares === null ? '--' : fmtVol(h.shares) + (h.kind === 'SH' ? ' 股' : ' 张')}</span>
        <span class="br-pct num">${h.pctOfTotal === null || h.pctOfTotal === undefined ? '--' : h.pctOfTotal.toFixed(1) + '%'}</span>
        <span class="br-chg-cell">${changeChip(h)}</span>
      </div>`).join('') +
      (cur.exits && cur.exits.length
        ? `<div class="brk-exits">上期持有、本期已退出：${cur.exits.map(x => escapeHTML(x.issuer)).join('、')}</div>`
        : '');
  }

  /* ==================== Event-on-Chart：详情页 K 线事件标记（全球事件 + 龙虎榜） ==================== */

  function chartEventsFor(t) {
    if (!t) return [];
    const out = [];
    (state.events || []).forEach(ev => {
      if (window.Events.eventsForSymbol([ev], t.symbol).length) {
        const ce = window.Events.toChartEvent(ev);
        if (ce) out.push(ce);
      }
    });
    if (state.lhb && state.lhb.rows.length) {
      state.lhb.rows.forEach(r => {
        if (r.symbol === t.symbol && r.tradeDate) {
          out.push({ time: r.tradeDate, color: 'rgb(' + ACCENT_RGB + ')', text: '龙虎榜', ev: { kind: 'lhb', row: r } });
        }
      });
    }
    // 从席位档案点进来的活动：该股 K 线上叠"席位买/卖"标记（颜色跟红涨绿跌主题）
    const pa = state.pendingActivity;
    if (pa && pa.symbol === t.symbol) {
      const ce = window.Actors.activityToChartEvent(pa, window.Charts.themeColors());
      if (ce) out.push(ce);
    }
    out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return out.slice(0, 40);
  }

  function applyDetailEvents() {
    if (!state.chart || state.chartKind !== 'kline') return;
    const evs = state.chartEventsOn ? chartEventsFor(state.detail) : [];
    state.chart.setEvents(evs);
    if (el.evtToggle) {
      el.evtToggle.textContent = '事件 ' + (evs.length ? '●' + evs.length : '○0');
      el.evtToggle.classList.toggle('active', state.chartEventsOn);
    }
  }

  function renderChartEventCard(m) {
    if (!el.chartEventCard) return;
    const first = m && m.events && m.events[0];
    if (!first) return;
    if (first.ev && first.ev.kind === 'seat') {
      const a = first.ev.activity;
      const isBuy = a.action === 'BUY';
      el.chartEventCard.hidden = false;
      el.chartEventCard.innerHTML = `<div class="ce-head">
          <span class="ce-tag num" style="color:${isBuy ? 'var(--up)' : 'var(--down)'}">席位${isBuy ? '买' : '卖'} · ${escapeHTML(a.tradeDate)}</span>
          <button class="ce-link" data-actor="${escapeHTML(a.actorId)}">查看席位档案</button>
          <button class="evd-close" data-ceclose aria-label="关闭">×</button></div>
        <div class="ce-line">${escapeHTML(a.seatName || '席位')}</div>
        <div class="ce-line num">净 <b class="${pctClass(a.net)}">${fmtAmt(a.net)}</b>${a.buy !== null ? ` · 买 ${fmtAmt(a.buy)}` : ''}${a.sell !== null ? ` · 卖 ${fmtAmt(a.sell)}` : ''} · ${escapeHTML(a.explanation || '')}</div>
        <div class="ce-line">交易所龙虎榜公开披露（日频）· 营业部口径，非个人账户实时交易</div>`;
      return;
    }
    if (first.ev && first.ev.kind === 'lhb') {
      const r = first.ev.row;
      el.chartEventCard.hidden = false;
      el.chartEventCard.innerHTML = `<div class="ce-head"><span class="ce-tag" style="color:var(--accent-signature)">龙虎榜 · ${escapeHTML(r.tradeDate)}</span>
          <button class="evd-close" data-ceclose aria-label="关闭">×</button></div>
        <div class="ce-line num">净买 <b class="${pctClass(r.netAmt)}">${fmtAmt(r.netAmt)}</b> · 榜上成交 ${fmtAmt(r.dealAmt)}` +
        (r.d1 !== null ? ` · 次日 <b class="${pctClass(r.d1)}">${fmtPct(r.d1)}</b>` : '') +
        (r.d5 !== null ? ` · 5日 <b class="${pctClass(r.d5)}">${fmtPct(r.d5)}</b>` : '') + `</div>
        <div class="ce-line">上榜原因：${escapeHTML(r.reason || '--')} · 交易所公开披露（日频），非实时交易</div>`;
      return;
    }
    const ev = first.ev;
    const meta = window.Events.TYPE_META[ev.type] || {};
    const safeUrl = /^https?:\/\//i.test(ev.sourceUrl || '') ? ev.sourceUrl : '';
    el.chartEventCard.hidden = false;
    el.chartEventCard.innerHTML = `<div class="ce-head"><span class="ce-tag" style="color:${meta.color || '#8a93a6'}">${escapeHTML(window.Events.typeLabel(ev.type))} · <span class="num">${escapeHTML(first.time)}</span></span>
        <button class="evd-close" data-ceclose aria-label="关闭">×</button></div>
      <div class="ce-line">${escapeHTML(ev.title)}</div>
      <div class="ce-line num">来源 ${escapeHTML(ev.source || '--')}${safeUrl ? ` · <a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener">原文</a>` : ''} · 按报道日期落位，非成交时间</div>`;
  }

  /* ==================== 世界经济仪表盘（世界银行，免密钥） ==================== */
  async function loadMacro() {
    if (!el.macroBox) return;
    const c = Cache.raw('wbmacro');
    if (c && Date.now() - c.at < 86400000) { renderMacro(c.val, 'cache'); return; }   // 年度数据缓存 24h
    el.macroBox.innerHTML = '<div class="sk sk-row"></div>';
    const data = await window.WorldBankSource.getMacro();
    if (data) {
      Cache.set('wbmacro', data);
      renderMacro(data, 'live');
    } else if (c) {
      // 上游失败：展示上次成功值并标注缓存时间，不再与实时数据混为一谈
      renderMacro(c.val, 'cache');
    } else {
      el.macroBox.innerHTML = '<div class="empty">世界银行数据暂不可用（年度指标，每日更新）</div>';
    }
  }

  function renderMacro(data, via) {
    if (!el.macroBox || !data) return;
    const inds = data.indicators;
    const keys = Object.keys(inds);
    const fmtVal = (k, cell) => {
      if (!cell) return '<span class="num mv">--</span>';
      const v = cell.v;
      const txt = k === 'gdp' ? (v / 1e12).toFixed(2) + 'T' : v.toFixed(v >= 100 ? 0 : 1) + '%';
      return `<span class="num mv">${txt}</span><span class="num my">${escapeHTML(cell.date)}</span>`;
    };
    // 色阶：只在"同年份"的国家之间归一（GDP 列量纲不同不着色）。
    // 旧实现把整列所有年份混进一个 min-max：拿 1990 年的德国和 2024 年的美国比
    // 债务率没有意义，颜色深浅会误导出假结论（四轮审核 N-2）
    const colRange = {};
    const colYear = {};
    keys.forEach(k => {
      const cells = data.rows.map(r => r.values[k]).filter(Boolean);
      const byYear = {};
      cells.forEach(c => { (byYear[c.date] = byYear[c.date] || []).push(c.v); });
      let bestYear = null, bestList = [];
      Object.keys(byYear).forEach(y => {
        if (byYear[y].length > bestList.length) { bestYear = y; bestList = byYear[y]; }
      });
      colYear[k] = bestYear;
      colRange[k] = bestList.length ? { min: Math.min(...bestList), max: Math.max(...bestList) } : null;
    });
    const shade = (k, cell) => {
      const rg = colRange[k];
      if (k === 'gdp' || !rg || !cell || rg.max === rg.min) return '';
      const yr = String(cell.date || '');
      if (yr !== colYear[k]) {
        // 非基准年份：中性底、不参与横比；特别老的年份标"数据陈旧"
        const old = parseInt(yr.slice(0, 4), 10) < 2000;
        return ` title="数据年份 ${escapeHTML(yr)}，${old ? '数据陈旧，' : ''}不参与同列色阶横比" style="background:rgba(255,255,255,0.04)"`;
      }
      const t = (cell.v - rg.min) / (rg.max - rg.min);
      const warm = ['cpi', 'debt', 'unemp'].includes(k);
      const alpha = (0.08 + t * 0.30).toFixed(2);
      return ` style="background:${warm ? `rgba(${ACCENT_RGB},${alpha})` : `rgba(77,182,172,${alpha})`}"`;
    };
    el.macroBox.innerHTML = `<div class="section-head">
        <h2 class="section-title">世界经济仪表盘</h2>
        <span class="section-sub">世界银行年度指标（每国最新值）· 免密钥数据源${via === 'cache' && data.updatedAt ? ' · 缓存于 ' + fmtTime(data.updatedAt) : ''}</span>
      </div>
      <div class="macro-table">
        <div class="mrow mhead"><span class="mcell mname">国家 / 指标</span>${keys.map(k => `<span class="mcell" title="${escapeHTML(inds[k].hint)}">${escapeHTML(inds[k].label)}</span>`).join('')}</div>
        ${data.rows.map(r => `<div class="mrow"><span class="mcell mname">${window.Flags.flag(r.flag)}${escapeHTML(r.name)}</span>${keys.map(k => `<span class="mcell"${shade(k, r.values[k])}>${fmtVal(k, r.values[k])}</span>`).join('')}</div>`).join('')}
      </div>
      <p class="insight-disclaimer">GDP 为总量（万亿美元）；增长/通胀/失业为百分比；政府债务为中央政府口径占 GDP 比重（部分国家无此口径，恒为 --）。缺失分两种：指标级（该国无此口径，等不来）与年份级（该年尚未发布）；跨年份的数字不参与同列色阶横比。</p>`;
  }

  /* ==================== 产业链 ==================== */

  function chainSymbols() {
    const out = [];
    window.INDUSTRY_CHAINS.forEach(c => c.links.forEach(l => l.stocks.forEach(s => out.push(s.symbol))));
    return Array.from(new Set(out));
  }

  /* ==================== 今日热门概念（东财板块榜 → 人工产业链） ==================== */
  // 两层拼接：榜单实时（东财概念板块涨跌幅排行，免密钥），图谱静态（INDUSTRY_CHAINS 人工维护）。
  // chip 点击：能对上人工链条 → 展开该链并滚动定位；对不上 → 拉成分股抽屉兜底，股可进详情。
  const CHAIN_HINTS = {
    nev: ['新能源车', '汽车整车', '汽车零部件', '充电桩', '动力电池', '锂电池', '锂矿', '盐湖提锂', '固态电池', '无人驾驶', '智能驾驶', '汽车'],
    semicon: ['半导体', '芯片', '光刻', '集成电路', '晶圆', '存储器', '封测', '电子化学品'],
    ai: ['算力', '人工智能', 'AIGC', 'ChatGPT', 'AI', '光模块', 'CPO', '数据中心', 'IDC', '液冷', '英伟达'],
    pv: ['光伏', '太阳能', '钙钛矿', '硅料', '硅片', '异质结', 'TOPCon'],
    consumer: ['消费电子', '苹果概念', '智能手机', '面板', 'OLED', '折叠屏', '无线耳机', 'VR', 'AR', 'MR'],
    pharma: ['创新药', 'CXO', 'CRO', '医药', '疫苗', '医疗器械', '中药', '减肥药', 'GLP'],
    defense: ['军工', '航天', '卫星', '大飞机', '船舶', '兵器', '无人机', '核聚变'],
    robot: ['机器人', '减速器', '人形', '伺服', '执行器', '机床'],
    storage: ['储能', '虚拟电厂', '特高压', '电网', '电力', '核电'],
    xinchuang: ['信创', '国产软件', '操作系统', '数据库', '网络安全', '华为', '鸿蒙', 'ERP', '国资云', '数据要素'],
  };
  function matchChain(name) {
    const s = String(name || '');
    if (!s) return null;
    for (const c of window.INDUSTRY_CHAINS) {
      const kws = CHAIN_HINTS[c.id] || [];
      if (kws.some(k => s.includes(k) || k.includes(s))) return c.id;
    }
    return null;
  }

  async function loadBoards() {
    const gen = ++state.boardGen;
    const list = await window.EastmoneySource.getBoardRank('concept', 24);
    if (gen !== state.boardGen) return;
    state.boardItems = list;
    state.boardLoadedAt = Date.now();
    state.boardVia = list.length ? 'em' : null;
    renderBoards();
  }

  function renderBoards() {
    if (!el.boardStrip) return;
    if (!state.boardItems.length) {
      // 降级：榜单拿不到时只藏这一小块，产业链表照常工作，绝不弹错误
      el.boardStrip.innerHTML = '<span class="board-empty">热门概念暂不可用，稍后自动重试</span>';
      el.boardVia.textContent = '';
      return;
    }
    el.boardVia.textContent = '东财概念榜 · ' + fmtTime(state.boardLoadedAt);
    el.boardStrip.innerHTML = state.boardItems.map((b, i) => {
      const chainId = matchChain(b.name);
      const chainName = chainId ? (window.INDUSTRY_CHAINS.find(c => c.id === chainId) || {}).name : null;
      return `<button class="bchip" data-bk="${b.bk}" data-i="${i}"${chainName ? ` title="属产业链：${chainName}"` : ''}>
        <span class="bc-name">${escapeHTML(b.name)}</span>
        <span class="bc-pct num ${pctClass(b.changePct)}">${fmtPct(b.changePct)}</span>
        <span class="bc-lead">${b.leadName ? escapeHTML(b.leadName) : ''}</span>
      </button>`;
    }).join('');
    if (state.boardOpenBk) {
      const cur = el.boardStrip.querySelector(`[data-bk="${state.boardOpenBk}"]`);
      if (cur) cur.classList.add('open');
    }
  }

  function closeBoardDrawer() {
    state.boardOpenBk = null;
    state.boardStocks = [];
    if (el.boardDrawer) { el.boardDrawer.hidden = true; el.boardDrawer.innerHTML = ''; }
    el.boardStrip.querySelectorAll('.bchip.open').forEach(x => x.classList.remove('open'));
  }

  async function toggleBoard(bk, i) {
    if (state.boardOpenBk === bk) { closeBoardDrawer(); return; }
    state.boardOpenBk = bk;
    const b = state.boardItems[i];
    const chainId = b ? matchChain(b.name) : null;
    renderBoards();
    if (chainId) {
      // 命中人工产业链：展开该链，滚动定位并短暂闪烁
      closeBoardDrawer();
      state.openChains.add(chainId);
      renderChains();
      const row = el.chainList.querySelector(`[data-chain="${chainId}"]`);
      if (row) {
        try { row.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' }); } catch { /* 旧浏览器 */ }
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1600);
      }
      return;
    }
    // 未命中人工链：成分股抽屉兜底（榜单层是全网 500+ 概念，图谱层只人工维护了 10 条）
    el.boardDrawer.hidden = false;
    el.boardDrawer.innerHTML = '<div class="sk sk-row"></div>';
    const stocks = await window.EastmoneySource.getBoardStocks(bk, 12);
    if (state.boardOpenBk !== bk) return;   // 等待期间用户点了别的板块
    if (!stocks.length) {
      el.boardDrawer.innerHTML = '<span class="board-empty">成分股列表暂不可用</span>';
      return;
    }
    state.boardStocks = stocks;
    el.boardDrawer.innerHTML = `<div class="bd-head">${b ? escapeHTML(b.name) + ' · ' : ''}领涨成分股<span class="bd-hint">点击进详情</span></div>` +
      stocks.map(s => `<button class="bs-row" data-symbol="EM:${s.secid}">
          <span class="bs-name">${escapeHTML(s.name)}</span>
          <span class="bs-code num">${escapeHTML(s.code)}</span>
          <span class="bs-pct num ${pctClass(s.changePct)}">${fmtPct(s.changePct)}</span>
        </button>`).join('');
  }

  async function loadChainQuotes() {
    const syms = chainSymbols();
    let list = await window.TencentSource.getQuotes(syms);
    let via = 'primary';
    if (!list.length) {
      const map = new Map();
      syms.forEach(s => map.set(toSecid(s), s));
      const em = await window.EastmoneySource.getQuotes(Array.from(map.keys()));
      list = em.map(q => Object.assign({}, q, { symbol: map.get(q.secid) || q.symbol }));
      via = 'backup';
    }
    list.forEach(q => {
      state.chainQuotes.set(q.symbol, q);
      Cache.set('q:' + q.symbol, q);
      if (via !== 'primary') state.degraded.set(q.symbol, via);
    });
    syms.forEach(s => {
      if (state.chainQuotes.has(s)) return;
      const c = Cache.raw('q:' + s);
      if (c) { state.chainQuotes.set(s, c.val); state.degraded.set(s, 'cache'); }
    });
  }

  function linkAvg(link) {
    const vals = link.stocks
      .map(s => { const q = state.chainQuotes.get(s.symbol); return q ? q.changePct : null; })
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // 热度条刻度：按当日各板块平均涨跌幅的极值归一。renderChains（初始渲染）与
  // patchChains（10s 增量刷新）必须同源——旧 patchChains 写死 maxAbs=3，
  // 极端行情日两套刻度会让条长跳变
  function chainHeatMaxAbs() {
    const avgs = window.INDUSTRY_CHAINS.map(chain => {
      const vals = chain.links.flatMap(l => l.stocks)
        .map(sk => { const q = state.chainQuotes.get(sk.symbol); return q ? q.changePct : null; })
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      return Math.abs(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
    });
    return Math.max(0.5, ...avgs);
  }

  function renderChains() {
    const stats = window.INDUSTRY_CHAINS.map(chain => {
      const all = chain.links.flatMap(l => l.stocks);
      const vals = all.map(sk => { const q = state.chainQuotes.get(sk.symbol); return q ? q.changePct : null; })
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      let best = null, worst = null;
      all.forEach(sk => {
        const q = state.chainQuotes.get(sk.symbol);
        if (!q || q.changePct === null || q.changePct === undefined || isNaN(q.changePct)) return;
        if (!best || q.changePct > best.pct) best = { name: sk.name, pct: q.changePct };
        if (!worst || q.changePct < worst.pct) worst = { name: sk.name, pct: q.changePct };
      });
      const mix = { A: 0, H: 0, US: 0 };
      all.forEach(sk => {
        if (/^hk/.test(sk.symbol)) mix.H++;
        else if (/^us/i.test(sk.symbol)) mix.US++;
        else mix.A++;
      });
      return { chain, avg, best, worst, mix, total: all.length };
    }).sort((a, b) => (b.avg ?? -99) - (a.avg ?? -99));

    const maxAbs = chainHeatMaxAbs();
    const rows = stats.map((st, i) => {
      const open = state.openChains.has(st.chain.id);
      const cls = pctClass(st.avg);
      const ratio = st.avg === null ? 0 : Math.min(1, Math.abs(st.avg) / maxAbs);
      // "15A · 2US"是维护口径；用户语言是"17 只（含港美股 2 只）"，明细放 title
      const overseas = st.mix.H + st.mix.US;
      const mixDetail = ['A ' + st.mix.A, st.mix.H ? 'H ' + st.mix.H : '', st.mix.US ? '美股 ' + st.mix.US : '']
        .filter(Boolean).join(' · ');
      const mixTxt = st.total + ' 只' + (overseas ? `（含港美股 ${overseas} 只）` : '');
      return `<div class="crow${open ? ' open' : ''}" data-chain="${st.chain.id}" tabindex="0" role="button"
          aria-expanded="${open}">
        <span class="cr-no num">${String(i + 1).padStart(2, '0')}</span>
        <span class="cr-name">${escapeHTML(st.chain.name)}</span>
        <span class="cr-mix num" title="市场分布：${escapeHTML(mixDetail)}">${escapeHTML(mixTxt)}</span>
        <span class="cr-avg num ${cls}">${fmtPct(st.avg)}</span>
        <span class="cr-best num" title="领涨">${st.best ? escapeHTML(st.best.name) + ' <b class="up">' + fmtPct(st.best.pct) + '</b>' : '--'}</span>
        <span class="cr-worst num" title="领跌">${st.worst ? escapeHTML(st.worst.name) + ' <b class="down">' + fmtPct(st.worst.pct) + '</b>' : '--'}</span>
        <span class="cr-heat"><span class="cr-heat-bar" style="transform:scaleX(${ratio.toFixed(3)})"></span></span>
        <span class="cr-arrow">${open ? '▾' : '▸'}</span>
      </div>` +
      (open ? renderChainOpen(st.chain) : '');
    }).join('');
    // 热度条图例：说明归一口径，用户才知道长条代表几个点
    el.chainList.innerHTML = `<div class="chain-legend">板块平均涨跌幅 · 热度条按当日最强板块（${fmtPct(maxAbs)}）归一</div>` +
      `<div class="chain-table">${rows || '<div class="empty">板块数据加载中…</div>'}</div>`;
  }

  // 展开的单个板块：环节流程条 + 已展开环节的成分股
  function renderChainOpen(chain) {
    const nodes = chain.links.map((link, i) => {
      const key = chain.id + ':' + i;
      const open = state.openLinks.has(key);
      const avg = linkAvg(link);
      const cls = pctClass(avg);
      return `<div class="link-node${open ? ' open' : ''}" data-link="${key}" tabindex="0" role="button"
          title="${escapeHTML(link.name)} ${fmtPct(avg)} · ${escapeHTML(link.desc || '')}">
        <div class="link-name">${escapeHTML(link.name)}</div>
        <div class="link-pct num ${cls}">${fmtPct(avg)}</div>
        <div class="link-bar-track"><span class="link-bar"></span></div>
        <div class="link-count">${link.stocks.length} 只成分股</div>
      </div>`;
    }).join('<span class="chain-arrow" aria-hidden="true">→</span>');
    const details = chain.links.map((link, i) => {
      const key = chain.id + ':' + i;
      if (!state.openLinks.has(key)) return '';
      const cards = link.stocks.map(sj => {
        const q = state.chainQuotes.get(sj.symbol) ||
          { symbol: sj.symbol, name: sj.name, code: sj.symbol.replace(/^[a-z]{2}/i, ''), market: 'cn', price: null, change: null, changePct: null };
        return rowHTML(q, false);
      }).join('');
      return `<div class="link-detail open">
        <div class="section-head"><h3 class="section-title">${escapeHTML(link.name)} · 全球成分股</h3></div>
        <div class="card-grid">${cards}</div></div>`;
    }).join('');
    return `<div class="chain-open"><div class="chain-flow">${nodes}</div>${details}</div>`;
  }

  // 增量更新：只改数字/条形/颜色，不重建 DOM（否则展开态、hover、焦点每 10s 丢一次）
  function patchChains() {
    const heatMaxAbs = chainHeatMaxAbs();
    window.INDUSTRY_CHAINS.forEach(chain => {
      // 热度表行
      const row = el.chainList.querySelector(`[data-chain="${chain.id}"]`);
      if (row) {
        const avgs = chain.links.map(linkAvg);
        const valid = avgs.filter(v => v !== null);
        const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
        let best = null, worst = null;
        chain.links.flatMap(l => l.stocks).forEach(sk => {
          const q = state.chainQuotes.get(sk.symbol);
          if (!q || q.changePct === null || q.changePct === undefined || isNaN(q.changePct)) return;
          if (!best || q.changePct > best.pct) best = { name: sk.name, pct: q.changePct };
          if (!worst || q.changePct < worst.pct) worst = { name: sk.name, pct: q.changePct };
        });
        const cls = pctClass(avg);
        const avgEl = row.querySelector('.cr-avg');
        if (avgEl) {
          avgEl.textContent = fmtPct(avg);
          avgEl.className = 'cr-avg num ' + cls;
        }
        const bestEl = row.querySelector('.cr-best');
        if (bestEl && best) bestEl.innerHTML = escapeHTML(best.name) + ' <b class="up">' + fmtPct(best.pct) + '</b>';
        const worstEl = row.querySelector('.cr-worst');
        if (worstEl && worst) worstEl.innerHTML = escapeHTML(worst.name) + ' <b class="down">' + fmtPct(worst.pct) + '</b>';
        const bar = row.querySelector('.cr-heat-bar');
        if (bar && avg !== null) {
          bar.style.transform = 'scaleX(' + Math.min(1, Math.abs(avg) / heatMaxAbs).toFixed(3) + ')';
        }
      }
      // 环节节点
      chain.links.forEach((link, i) => {
        const node = el.chainList.querySelector(`[data-link="${chain.id}:${i}"]`);
        if (!node) return;
        const avg = linkAvg(link);
        const pctEl = node.querySelector('.link-pct');
        if (pctEl) {
          pctEl.textContent = fmtPct(avg);
          pctEl.className = 'link-pct num ' + pctClass(avg);
        }
        const bar = node.querySelector('.link-bar');
        if (bar) {
          const avgAbs = Math.abs(link.stocks.reduce((acc, sk) => {
            const q = state.chainQuotes.get(sk.symbol);
            return acc + (q && q.changePct !== null && q.changePct !== undefined ? q.changePct : 0);
          }, 0) / Math.max(1, link.stocks.length));
          bar.style.transform = 'scaleX(' + Math.min(1, avgAbs / 3).toFixed(3) + ')';
          bar.style.background = avg === null ? 'rgba(255,255,255,0.15)'
            : `var(--${avg > 0 ? 'up' : avg < 0 ? 'down' : 'text-tertiary'})`;
        }
      });
    });
    patchCards(el.chainList);
  }

  /* ==================== 视图路由 ==================== */

  const VIEW_OF_TAB = {
    all: 'market', cn: 'market', hk: 'market', us: 'market', crypto: 'market', fxmacro: 'market',
    events: 'events', chain: 'chain', watch: 'watch',
    compare: 'compare',   // 基金对比：独立视图（跨市场，不挂在任何单一市场 tab 下）
    mood: 'market',   // 旧 hash：情绪已并入 A股板块
    // 旧快捷方式/hash 兼容：新闻→事件页，喊单→事件页的公开言论，资金页→A股（席位/龙虎榜已归位到 A股）
    news: 'events', voices: 'events', funds: 'market',
  };
  /* 旧 hash → 现有 tab。资金页拆掉了：龙虎榜/席位动向 归 A股 tab，伯克希尔归美股 tab，
     公开言论归事件页——所以 #tab=funds 落到 A股，用户要找的东西就在那一屏。 */
  const TAB_ALIAS = { news: 'events', voices: 'events', funds: 'cn', mood: 'cn' };

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const node = $('view-' + view);
    if (node) node.classList.add('active');
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  /* ---- hash 路由（方法论：MarketAtlas 等仪表盘的深链/导航）----
     #tab=mood / #symbol=sh600519。浏览器后退/前进可用；file:// 下 pushState
     若被安全策略拒绝，退回 location.hash（原生进历史，靠 hashLock 防重入）。 */
  function navigate(hash) {
    try {
      if (location.hash === hash) return;
      history.pushState(null, '', hash);
      state.pushed++;
    } catch {
      state.hashLock = true;
      location.hash = hash;
    }
  }

  // 由 hash 还原视图；symbol 不在缓存里时按前缀规则重建详情目标（name 会被报价补上）
  function targetFromHashSymbol(sym) {
    if (/^[A-Z0-9]{4,12}$/.test(sym)) return { symbol: sym, name: sym, code: sym, market: 'crypto', binance: sym };
    if (sym.startsWith('EM:')) {
      const secid = sym.slice(3);
      return { symbol: sym, name: secid.split('.')[1], code: secid.split('.')[1], market: window.EastmoneySource.marketOfSecid(secid), secid, tencent: tencentOfSecid(secid) };
    }
    const mkt = /^[a-z]{2}/.test(sym) ? sym.slice(0, 2) : '';
    return { symbol: sym, name: sym.slice(2), code: sym.slice(2), market: mkt === 'hk' ? 'hk' : mkt === 'us' ? 'us' : mkt === 'sh' || mkt === 'sz' || mkt === 'bj' ? 'cn' : 'other', tencent: sym, secid: toSecid(sym) };
  }

  function renderFromHash() {
    // 畸形 hash（如未编码完的 % 序列）会让 decodeURIComponent 抛 URIError → 按空 hash 处理
    let h = '';
    try { h = decodeURIComponent(location.hash || ''); } catch { h = ''; }
    const mSym = h.match(/#symbol=([^&]+)/);
    if (mSym) {
      const t = targetFromHashSymbol(mSym[1]);
      // 只有真在详情视图里且同一标的才跳过（避免"切走后后退死点"）
      if (state.view === 'detail' && state.detail && state.detail.symbol === t.symbol) return;
      openDetail(t, { push: false });
      return;
    }
    const mTab = h.match(/#tab=([a-z]+)/);
    if (mTab && VIEW_OF_TAB[mTab[1]]) {
      // 基金对比的深链带自己的参数（f/start/end/g/n/a/log）→ 交给视图自己解析后取数，
      // 直接 setTab 会按"上次选择"渲染，用户点开分享链接看到的就不是那条曲线了
      if (mTab[1] === 'compare') {
        if (state.view !== 'compare') { if (state.view === 'actor') leaveActor(); leaveDetail(); }
        el.tabs.querySelectorAll('.tab').forEach(b => {
          const on = b.dataset.tab === 'compare';
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', String(on));
        });
        state.tab = 'compare';
        setView('compare');
        window.CompareView.applyHash(h);
        renderStatus();
        return;
      }
      if (state.view !== 'detail' && state.tab === mTab[1]) return;
      if (state.view === 'actor') leaveActor();
      leaveDetail();
      setTab(mTab[1], { push: false });
      return;
    }
    const mActor = h.match(/#actor=([^&]+)/);
    if (mActor) {
      if (state.view === 'actor' && state.actor && state.actor.id === decodeURIComponent(mActor[1])) return;
      if (state.view === 'detail') { disposeChart(); state.detail = null; }
      openActor(decodeURIComponent(mActor[1]), { push: false });
      return;
    }
    if (!h || h === '#') {
      if (state.view === 'detail') { leaveDetail(); setTab(state.prevView || 'all', { push: false }); }
    }
  }

  // 离开详情的统一清理（图表实例、详情态、标题、事件卡、席位活动上下文）
  function leaveDetail() {
    disposeChart();
    state.detail = null;
    state.pendingActivity = null;
    if (el.chartEventCard) el.chartEventCard.hidden = true;
    document.title = 'OpenFinLens · 全球金融看板';
  }

  function setTab(tab, opts) {
    // 旧 tab 名兼容：新闻/喊单→事件页的快讯子面板（公开言论已并入该页），情绪→A股(已并入)，
    // 资金页→A股（聪明钱 tab 已拆解：席位/龙虎榜归 A股、13F 归美股、公开言论归事件页）
    if (TAB_ALIAS[tab]) {
      if (tab === 'news' || tab === 'voices') state.eventsSub = 'news';
      tab = TAB_ALIAS[tab];
    }
    if (tab === 'crypto' && !CRYPTO_ON) tab = 'all';   // 合规开关：加密深链/快捷键归位「全部」
    const animate = !opts || opts.animate !== false;   // 返回详情/改设置时不重播入场动画
    // 重复点击同一 tab：短路，避免整墙重建 + stagger 重播 + 焦点丢失
    if (tab === state.tab && state.view === (VIEW_OF_TAB[tab] || 'market')) return;
    // 从详情/席位档案直接切走（数字键/点 tab）：清理详情态，否则标题残留、后退出现"死点"
    if (state.view === 'detail' && (VIEW_OF_TAB[tab] || 'market') !== 'detail') {
      disposeChart();
      state.detail = null;
      document.title = 'OpenFinLens · 全球金融看板';
    }
    if (state.view === 'actor' && (VIEW_OF_TAB[tab] || 'market') !== 'actor') leaveActor();
    state.tab = tab;
    el.tabs.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));   // 屏幕阅读器需要知道当前选中项
    });
    // 移动端 10 个 tab 横向滚动，程序化切换后把激活项滚回视野内
    const activeBtn = el.tabs.querySelector('.tab.active');
    if (activeBtn && activeBtn.scrollIntoView) {
      try { activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }); }
      catch { /* 旧浏览器不支持 options 形参 */ }
    }
    const view = VIEW_OF_TAB[tab] || 'market';
    setView(view);
    // 标的计数跟随 tab：renderStatus 平时只在轮询 tick 里跑，不补这次的话
    // 切板块后"47 个标的"要等下一个刷新周期才变
    renderStatus();
    // 「全球市场」总览（hero + 全球指数条）只在「全部」出现；各板块用自己的标题（用户反馈：别到处粘）
    const MKT_TITLE = { all: '全球市场', cn: 'A股市场', hk: '港股市场', us: '美股市场', crypto: '加密市场', fxmacro: '世界经济' };
    if (el.marketTitle) el.marketTitle.textContent = MKT_TITLE[tab] || '全球市场';
    if (el.globalOverview) el.globalOverview.hidden = tab !== 'all';
    // 宏观 tab 只看世界经济仪表盘，不再叠一墙行情卡
    if (el.cardWall) el.cardWall.hidden = tab === 'fxmacro';
    // 情绪与市场宽度：A股板块底部的小节
    if (el.moodPanel) el.moodPanel.hidden = tab !== 'cn';
    // 披露类区块按市场归位（原"聪明钱"tab）：席位/龙虎榜 在 A股，13F 在美股
    if (el.aFundsPanel) el.aFundsPanel.hidden = tab !== 'cn';
    if (el.usFundsPanel) el.usFundsPanel.hidden = tab !== 'us';
    if (el.hkFundsPanel) el.hkFundsPanel.hidden = tab !== 'hk';
    // 各市场的"情绪与宽度"只在各自的 tab 上出现（原本加密/美股宽度都塞在 A股 页里）
    if (el.cryptoMoodPanel) el.cryptoMoodPanel.hidden = tab !== 'crypto';
    if (el.usMoodPanel) el.usMoodPanel.hidden = tab !== 'us';
    // 市场视图：热力图只在"全部/A股/加密"下有意义
    const heatWasHidden = el.heatSection.hidden;
    // 热力图在 全部/A股/港股/美股/加密 下有意义（宏观 tab 是世行年度指标，不放热力图）
    el.heatSection.hidden = !['all', 'cn', 'hk', 'us', 'crypto'].includes(tab);
    // Movers 三榜：只对有全市场行情的市场 tab 显示（2026-09-17）
    if (MOVERS_DEFS[tab]) {
      renderMovers();
      if (validMoverRows(MOVERS_DEFS[tab].rows()).length < 5) loadMovers();
    } else if (el.moversSection) {
      el.moversSection.hidden = true;
    }
    // 进哪个市场 tab 就自动切到该市场的热力图，不用手点
    if (['cn', 'hk', 'us', 'crypto'].includes(tab)) switchHeat(tab);
    // 世界经济仪表盘只在外汇宏观 tab 显示；全球指数条首次进市场视图时加载
    if (el.macroBox) el.macroBox.hidden = tab !== 'fxmacro';
    if (tab === 'fxmacro') loadMacro();
    if (tab === 'all' && !state.globeQuotes) loadGlobe();
    // 「全部」是唯一显示首屏指数 + 我的自选的板块：进页即渲染，并懒加载走势线（失败静默）
    if (tab === 'all') {
      renderHero();
      renderHomeWatch();
      renderGlobeSum();
      ensureSparks();
    }
    // hidden→visible 时之前所有 drawHeat 都被可见性守卫跳过了，回视图必须补一次，
    // 否则画布停留在旧尺寸/旧布局（黑屏或命中错位）
    if (heatWasHidden && !el.heatSection.hidden) drawHeat();
    // hash 深链：除非本次切换本身由"后退/前进"触发（push=false），否则写入历史。
    // 基金对比把自己的选择（标的/区间/口径）写进 hash，复制地址就是把这个对比分享出去。
    if (!opts || opts.push !== false) {
      navigate(view === 'compare' && window.CompareView ? window.CompareView.hashFor() : '#tab=' + tab);
    }

    if (view === 'market') renderCardWall(animate);
    if (view === 'watch') renderWatchlist();
    if (view === 'events') setEventsSub(state.eventsSub);
    if (view === 'compare' && window.CompareView) window.CompareView.onEnter();
    if (tab === 'cn') {
      if (state.breadth) renderMood();
      loadMood();
      // 席位动向 + 今日龙虎榜（原"聪明钱"tab，按市场归位到 A股）：龙虎榜 4 分钟过期；
      // 席位目录随 loadLhb 一起拉。注意：这块历史上曾重复出现两次（进页全链路双请求），只保留一份。
      if (!state.lhb || Date.now() - state.lhbAt > 240000) loadLhb().catch(() => { /* 降级角标 */ });
      else {
        renderLhb();
        if (!state.actors || Date.now() - state.actorsAt > 600000) loadSeatActors().catch(() => renderSeatDirectory());
        else renderSeatDirectory();
      }
      // 状态行的"龙虎榜 N 只上榜"要等数据到了才准，否则首次进页永远是旧值
      renderStatus();
      // 基金持仓（采集静态 JSON，季度）：入页时过期(>6h)才重拉
      if (!state.fundHolds || Date.now() - (state.fundHoldsAt || 0) > 6 * 3600000) loadFundHolds();
      else renderFundHolds();
    }
    if (tab === 'us') {
      // 伯克希尔 13F（原"聪明钱"tab，归位到美股）：季度数据，入页时过期(>6h)才拉
      if (!state.brk || Date.now() - (state.brkAt || 0) > 6 * 3600000) loadBrk().then(renderStatus).catch(() => {});
      else renderBrk();
      // 因子 ETF 持仓（Invesco 采集静态 JSON，日更）：入页时过期(>12h)才重拉
      if (!state.etf || Date.now() - (state.etfAt || 0) > 12 * 3600000) loadEtf();
      else renderEtf();
      // 美股宽度（原挂在 A股 页，现归位）
      ensureUSRows().then(renderMoodUS);
    }
    if (tab === 'crypto' && CRYPTO_ON) {
      // 加密宽度（原挂在 A股 页，现归位）
      ensureCryptoRows().then(renderMoodCrypto);
    }
    if (tab === 'hk') {
      // 南向持股（港股口径的"聪明钱"）：日频、当日收盘后才发布，过期(>6h)才重拉
      if (!state.southbound || Date.now() - (state.southboundAt || 0) > 6 * 3600000) {
        loadSouthbound().then(() => { renderSouthbound(); renderStatus(); });
      } else renderSouthbound();
    }
    if (view === 'events') {
      // 公开言论（原"聪明钱"tab 第 4 块）：本质是"新闻流里出现人名"，与事件页同源，55s 过期重拉
      if (!state.voices || Date.now() - (state.voicesAt || 0) > 55000) loadVoices();
      else renderVoices();
    }
    if (view === 'chain') {
      renderChains();
      // 概念榜单懒加载：无数据立即拉，过期(>55s)重拉，否则直接渲染缓存
      if (!state.boardItems.length || Date.now() - state.boardLoadedAt > 55000) loadBoards();
      else renderBoards();
      // 定时器只在 chain 视图内轮询，所以每次进入都主动补一轮，避免展示过期行情
      loadChainQuotes().then(() => patchChains());
    }
  }

  function switchHeat(mode) {
    if (state.heatMode === mode) return;
    state.heatMode = mode;
    document.querySelectorAll('[data-heat]').forEach(b => b.classList.toggle('active', b.dataset.heat === mode));
    // 范围开关只对 A股有意义：加密只有 80 个币（块块有字），港股/美股一律按市值取 Top 500
    if (el.heatTopToggle) el.heatTopToggle.hidden = !HEAT_RANGE_MODES[mode];
    // 换视图重置视口：否则从 ×6 的 A股视图切到加密，进来是一个陌生的放大视图
    if (state.heat) state.heat.resetView();
    if (!state.heatItems[mode].length) {
      HEAT_LOADERS[mode]().then(drawHeat);
    } else drawHeat();
  }

  /* ==================== 搜索 ==================== */

  function marketFromSecid(secid) {
    return window.EastmoneySource.marketOfSecid(secid);
  }

  async function runSearch(kw) {
    if (state.tab === 'events' && state.eventsSub === 'news') { state.searchKw = kw; renderNews(); return; }
    if (!kw) { hideSearch(); return; }
    // 竞态守卫：快速连续输入时，慢的旧响应不得覆盖新关键词的结果（与 chartGen 同理）
    const gen = ++state.searchGen;
    const list = await window.EastmoneySource.search(kw);
    if (gen !== state.searchGen) return;
    state.searchKw = kw;   // 结果与关键词对上号（Enter 判断用）
    state.searchItems = list;
    state.searchSel = -1;
    el.searchInput.setAttribute('aria-expanded', 'true');
    if (!list.length) {
      el.searchResults.innerHTML = '<div class="sr-empty">没有匹配的标的</div>';
      el.searchResults.classList.add('active');
      return;
    }
    el.searchResults.innerHTML = list.map((x, i) => `<div class="sr-item" data-idx="${i}" role="option">
        <span class="sr-name">${escapeHTML(x.name)}</span>
        <span class="sr-code num">${escapeHTML(x.code)}</span>
        <span class="sr-mkt">${escapeHTML(x.marketName || '')}</span>
      </div>`).join('');
    el.searchResults.classList.add('active');
  }
  const doSearch = debounce(runSearch, 250);

  function hideSearch() {
    el.searchResults.classList.remove('active');
    el.searchInput.setAttribute('aria-expanded', 'false');
    state.searchSel = -1;
  }

  function pickSearch(i) {
    const x = state.searchItems[i];
    if (!x) return;
    hideSearch();
    el.searchInput.value = '';
    openDetail({
      symbol: 'EM:' + x.secid, name: x.name, code: x.code,
      market: marketFromSecid(x.secid), secid: x.secid, tencent: tencentOfSecid(x.secid),
    });
  }

  /* ==================== 设置 ==================== */

  function applySettings() {
    const s = window.Store.settings.get();
    document.body.dataset.updown = s.updown === 'green' ? 'green' : 'red';
    el.segUpdown.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.updown === s.updown));
    el.segRefresh.querySelectorAll('button').forEach(b => b.classList.toggle('active', +b.dataset.refresh === s.refresh));
    el.swDegraded.classList.toggle('on', !!s.showDegraded);
    el.swDegraded.setAttribute('aria-checked', String(!!s.showDegraded));
  }

  function onUpdownChanged() {
    applySettings();
    // 卡片/链路颜色全走 CSS 变量，body 换 data-updown 即全量生效，无需重建 DOM；
    // 只需重绘不吃变量的两处：热力图（canvas）与 K线（series 颜色）
    window.Treemap.refreshColors();
    if (state.heat) drawHeat();
    if (state.chart) state.chart.applyTheme();
    if (state.view === 'watch') renderWatchlist();
    if (state.view === 'chain') renderChains();
    if (state.tab === 'cn') renderMood();   // 情绪小节在 A股板块内，色带跟随红绿模式
  }

  let modalLastFocus = null;
  function openModal() {
    modalLastFocus = document.activeElement;
    el.settingsModal.classList.add('active');
    document.body.classList.add('modal-open');
    el.settingsClose.focus();
  }
  function closeModal() {
    if (!el.settingsModal.classList.contains('active')) return;
    el.settingsModal.classList.remove('active');
    document.body.classList.remove('modal-open');
    if (modalLastFocus && modalLastFocus.focus) modalLastFocus.focus();   // 焦点归还触发点
    modalLastFocus = null;
  }

  /* ==================== 调度器（setTimeout 链 + 隐藏暂停） ==================== */

  function schedule(name, fn, ms) {
    clearTimeout(state.timers[name]);
    const tick = async () => {
      if (document.hidden) {                 // 隐藏时暂停：延后重试，不抓取
        state.timers[name] = setTimeout(tick, 1000);
        return;
      }
      try { await fn(); } catch (e) { /* 永不抛到页面 */ }
      state.timers[name] = setTimeout(tick, typeof ms === 'function' ? ms() : ms);
    };
    state.timers[name] = setTimeout(tick, typeof ms === 'function' ? ms() : ms);
  }

  const refreshMs = () => Math.max(5, window.Store.settings.get().refresh || 10) * 1000;

  function scheduleMood() {
    schedule('mood', async () => {
      if (state.tab !== 'cn') return;
      // 情绪小节并入 A股板块后，保活条件跟着 tab 走；数据超过 30s 就重拉，
      // 否则情绪指数/宽度指标会一直冻结在进入该页时的数值
      if (Date.now() - (state.heatFetchedAt || 0) > 30000) await loadHeatCN();
      await loadMood();
    }, refreshMs);
  }

  function startScheduler() {
    schedule('quotes', quotesTick, refreshMs);

    schedule('heat', async () => {
      if (state.view !== 'market' || el.heatSection.hidden) return;
      if (HEAT_LOADERS[state.heatMode]) await HEAT_LOADERS[state.heatMode]();
      const rows = state.heatItems[state.heatMode] || [];
      if (!state.heat) return;
      // 数量对比必须用"当前渲染子集"的块数：A股默认 Top500 只画 500 块，
      // 拿全市场 5500 行对比恒不相等，会每 30s 白做一次全量重排（"只换色不闪白"失效）
      const renderCount = heatItemsForRender().length;
      if (renderCount === state.heat.count) {
        // 数量没变（常规情况）：换色换价不重排；updatePct 按 code 匹配，直接吃全量行
        state.heat.updatePct(rows);
        renderHeatSub();
      } else {
        // 新股上市/停牌等结构性变化：全量重排，否则新增标的永远进不了图
        drawHeat();
      }
    }, 30000);

    // 市场宽度：跟随设置的刷新间隔，复用热力图已抓到的全市场数据（不额外发请求）
    scheduleMood();

    // 新闻 / 研报 / 产业链行情只在用户处于对应视图时轮询（进入 tab 时 setTab 会立即补一次），
    // 否则 163 只成分股每 10s、新闻每 60s 白跑请求，浪费配额还提高被上游限流的风险
    schedule('news', async () => {
      if (!(state.view === 'events' && state.eventsSub === 'news')) return;
      await loadNews();
    }, 60000);
    schedule('chain', async () => {
      if (state.view !== 'chain') return;
      await loadChainQuotes();
      // 增量更新，不重建 DOM：否则每 10s 会吞掉已展开的环节、hover 与键盘焦点
      patchChains();
    }, 10000);
    // 概念榜单 60s 一轮（同样只在 chain 视图内）；chip 量少，直接重渲染
    schedule('boards', async () => {
      if (state.view !== 'chain') return;
      await loadBoards();
    }, 60000);
    // 公开言论 60s（现住事件页的快讯子页）；全球指数条 60s（仅市场视图）
    schedule('voices', async () => {
      if (state.view !== 'events') return;
      await loadVoices();
    }, 60000);
    // 全球事件 JSON：采集任务 5 分钟一轮，页面停留时 60s 拉一次（用户要求的分钟级新鲜度）
    // globe 与 map 两个子视图都依赖事件数据，只有快讯子面板不需要
    schedule('events', async () => {
      if (state.view !== 'events' || state.eventsSub === 'news') return;
      await loadEvents();
    }, 60000);
    // 龙虎榜：日频披露 + 当日 17:00 后陆续更新，5 分钟轮询足够（现住 A股 tab）
    schedule('lhb', async () => {
      if (state.tab !== 'cn') return;
      await loadLhb();
    }, 300000);
    // 南向持股：同样日频、当日收盘后发布，10 分钟轮询足够（现住 港股 tab）
    schedule('southbound', async () => {
      if (state.tab !== 'hk') return;
      await loadSouthbound();
      renderSouthbound();
    }, 600000);
    schedule('globe', async () => {
      if (state.view !== 'market' || !state.globeQuotes) return;
      await loadGlobe();
    }, 60000);
    // Movers 三榜：60s 纯重排（读 state.heatItems 缓存行，不新增网络请求）；
    // 行数不足说明首拉还没到，补一次 loadMovers
    schedule('movers', async () => {
      if (state.view !== 'market' || !MOVERS_DEFS[state.tab]) return;
      if (validMoverRows(MOVERS_DEFS[state.tab].rows()).length < 5) { await loadMovers(); return; }
      renderMovers();
    }, 60000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // 回到前台立刻补一次（fetchAllQuotes 有 in-flight 去重，与调度器重叠也只跑一轮）
      quotesTick();
    }
  });

  // 浏览器后退/前进 → 按 hash 恢复视图；编程式改 hash（pushState 不可用的回退）时跳过一次
  function onHashNav() {
    if (state.hashLock) { state.hashLock = false; return; }
    renderFromHash();
  }
  // 监听器注册放在 init 内：IIFE 顶层注册曾早于 el 填充，窗口期内的 hashchange
  // 会带着未初始化的 el 走进 openDetail（偶发 TypeError，详情页整条变空）
  function bindHashNav() {
    window.addEventListener('popstate', onHashNav);
    window.addEventListener('hashchange', onHashNav);
  }

  /* ==================== 状态栏 / 自检 ==================== */

  // 当前 tab 实际可见的标的数：状态栏的"47 个标的"曾取全局池大小，
  // 在 A股/港股/美股等板块下与所见行数对不上，用户以为没加载完
  function visibleQuoteCount() {
    const groups = new Set(groupsForTab(state.tab));
    const tabFilter = { cn: 'cn', hk: 'hk', us: 'us', crypto: 'crypto', fxmacro: 'fxmacro' }[state.tab];
    let n = 0;
    state.quotes.forEach(q => {
      const g = q.group || q.market;
      if (!groups.has(g)) return;
      if (tabFilter && g !== 'crypto') {
        const meta = LABELS.get(q.symbol);
        if (!meta || meta.tab !== tabFilter) return;
      }
      n++;
    });
    return n;
  }

  // 源返回的最新行情时刻（腾讯 quoteAt，沪深/港与北京同域）：与"抓取时间"分开标注，
  // 休市日不再把"上周五收盘"伪装成"刚刚的实时行情"
  function latestQuoteAt() {
    let max = 0;
    state.quotes.forEach(q => { if (q.quoteAt && q.quoteAt > max) max = q.quoteAt; });
    return max;
  }

  // 状态栏副标题按 tab 取材：卡片墙隐藏的板块（宏观/事件/聪明钱/产业链/自选）
  // 没有可见行情行，硬填一个"47 个标的"是用户看不见的数字——改给该页面自己的摘要
  function marketSubFor(tab) {
    const fetchTxt = '抓取 ' + (state.lastUpdate ? fmtTime(state.lastUpdate) : '--');
    if (VIEW_OF_TAB[tab] !== 'market') {
      if (tab === 'events') return `全球事件 ${(state.events || []).length} 条 · ${fetchTxt}`;
      if (tab === 'chain') return `${(window.INDUSTRY_CHAINS || []).length} 条产业链 · ${fetchTxt}`;
      if (tab === 'watch') return `自选 ${window.Store.watchlist.all().length} 只 · ${fetchTxt}`;
      return fetchTxt;
    }
    if (tab === 'fxmacro') {
      const n = window.WorldBankSource ? window.WorldBankSource.COUNTRIES.length : 8;
      return `世界经济 · ${n} 国年度指标 · ${fetchTxt}`;
    }
    // 归位到市场 tab 的披露类数据也报个数（原"聪明钱"tab 的状态行）
    if (tab === 'cn') {
      return `${visibleQuoteCount()} 个标的 · 龙虎榜 ${(state.lhb && state.lhb.rows.length) || 0} 只上榜 · 席位 ${(state.actors || []).length} 个 · ${fetchTxt}`;
    }
    if (tab === 'us') {
      const brkN = state.brk && state.brk.holdings ? state.brk.holdings.length : 0;
      return `${visibleQuoteCount()} 个标的${brkN ? ' · 13F ' + brkN + ' 项持仓' : ''} · ${fetchTxt}`;
    }
    if (tab === 'hk') {
      const sbN = (state.southbound || []).length;
      return `${visibleQuoteCount()} 个标的${sbN ? ' · 南向持仓 ' + sbN + ' 只' : ''} · ${fetchTxt}`;
    }
    return `${visibleQuoteCount()} 个标的 · 每 ${window.Store.settings.get().refresh}s 刷新 · ${fetchTxt}`;
  }

  function renderStatus() {
    // 数据源状态说人话：逐源代号对用户是噪音（细节保留在"开发者自检"区）
    const items = window.SourceState.all();
    const bad = items.filter(([, v]) => !v.ok);
    el.sourceStatus.textContent = bad.length
      ? '部分数据源响应异常 · 已自动切换备用源，数据仍在刷新'
      : '数据源全部正常';
    el.sourceStatus.classList.toggle('warn', bad.length > 0);
    const degCount = state.degraded.size;
    const quoteAt = latestQuoteAt();
    const fetchAt = state.lastUpdate;
    el.updatedLine.textContent = '行情 ' + (quoteAt ? fmtNewsTime(quoteAt) : '--') +
      ' · 抓取 ' + (fetchAt ? fmtTime(fetchAt) : '--') +
      (degCount ? ` · ${degCount} 个标的使用备源/缓存` : '');
    el.marketSub.textContent = marketSubFor(state.tab);
  }

  function renderSelfTest() {
    const probes = [
      ['上证指数', 'sh000001'], ['贵州茅台', 'sh600519'], ['腾讯控股', 'hk00700'],
      ['苹果', 'usAAPL'],
      ['美元离岸人民币', 'EM:133.USDCNH'], ['COMEX黄金', 'EM:101.GC00Y'], ['美债10年', 'EM:171.US10Y'],
    ].concat(CRYPTO_ON ? [['BTC', 'BTCUSDT'], ['ETH', 'ETHUSDT']] : []);
    const lines = probes.map(([label, sym]) => {
      const q = state.quotes.get(sym);
      if (!q) return `✗ ${label} 无数据`;
      const flags = [];
      if (typeof q.price !== 'number' && q.price !== null) flags.push('price 非 Number');
      if (typeof q.changePct !== 'number' && q.changePct !== null) flags.push('changePct 非 Number');
      const deg = state.degraded.get(sym);
      return `✓ ${label} ${q.name} 价 ${fmtPrice(q.price)} ${fmtPct(q.changePct)}` +
        (deg ? ` [${deg === 'cache' ? '缓存' : '备源'}]` : '') + (flags.length ? ' ⚠ ' + flags.join(',') : '');
    });
    lines.push('', '数据源：' + window.SourceState.all().map(([k, v]) => k + '=' + (v.ok ? 'ok' : 'fail')).join(' '));
    lines.push('热力图：A股 ' + state.heatItems.cn.length + ' 块 / 加密 ' + state.heatItems.crypto.length + ' 块');
    const viaName = { sina: '新浪', eastmoney: '东财', cache: '缓存' }[state.newsVia] || '未加载';
    lines.push('新闻 ' + state.news.length + ' 条(' + viaName + ')');
    const b = state.breadth;
    lines.push(b && b.total
      ? `市场宽度：${b.total} 只 · 涨 ${b.up} 跌 ${b.down} 平 ${b.flat} · 涨停 ${b.limitUp} 跌停 ${b.limitDown}` +
        ` · 情绪 ${b.score === null ? '--' : b.score.toFixed(1)} · 均涨跌 ${fmtPct(b.avgPct)}`
      : '市场宽度：无数据');
    lines.push('PROXY=' + (window.PROXY || '(直连)'));
    const ses = ['cn', 'hk', 'us', 'crypto'].map(k => {
      const s = window.Sessions.now(k);
      return window.Sessions.MARKETS[k].name + ' ' + s.label;
    }).join(' · ');
    lines.push('市场时段：' + ses + '（按常规时段，不含节假日）');
    lines.push('情绪快照：本机已积累 ' + (window.Store.get('breadthHist', [])).length + ' 天');
    el.selftestOut.textContent = lines.join('\n');
  }

  /* ==================== 事件绑定 ==================== */

  function findQuote(sym) {
    return state.quotes.get(sym) || state.watchQuotes.get(sym) ||
      state.chainQuotes.get(sym) || (Cache.raw('q:' + sym) || {}).val || null;
  }

  function targetFromSymbol(sym) {
    let q = findQuote(sym);
    if (!q) {
      // 自选里刚加入、行情还没抓到的标的：用自选条目兜底，保证卡片可点进详情
      const w = window.Store.watchlist.all().find(x => x.symbol === sym);
      if (!w) return null;
      q = { symbol: sym, name: w.name, code: sym, market: w.market };
    }
    if (q.market === 'crypto') return { symbol: sym, name: q.name, code: q.code || sym, market: 'crypto', binance: sym };
    if (sym.startsWith('EM:')) {
      const secid = q.secid || sym.slice(3);
      return { symbol: sym, name: q.name, code: q.code, market: q.market, secid, tencent: tencentOfSecid(secid) };
    }
    return { symbol: sym, name: q.name, code: q.code || sym, market: q.market, tencent: sym, secid: toSecid(sym) };
  }

  function bindEvents() {
    // 板块折叠：点标题收起/展开正文（聪明钱/情绪/热力图等长板块，按需收纳）
    document.addEventListener('click', (e) => {
      const head = e.target.closest('[data-fold] > .section-head');
      if (!head || e.target.closest('button, a, input, .pill, .ses-chip')) return;
      const sec = head.parentElement;
      const folded = sec.classList.toggle('folded');
      head.setAttribute('aria-expanded', String(!folded));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const head = e.target.closest && e.target.closest('[data-fold] > .section-head');
      if (!head) return;
      e.preventDefault();
      head.click();
    });
    // 可折叠标题的可访问性：按钮角色 + 初始展开态
    document.querySelectorAll('[data-fold] > .section-head').forEach(h => {
      h.setAttribute('role', 'button');
      h.setAttribute('tabindex', '0');
      h.setAttribute('aria-expanded', 'true');
    });

    // tab
    el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab);
    });

    // 首屏「我的自选」块右上角的「全部自选 →」：去自选页（排序/管理都在那儿）
    if (el.watchMore) el.watchMore.addEventListener('click', () => setTab('watch'));

    // 卡片：点击进详情 / 星标收藏（事件委托，覆盖卡片墙+自选+产业链）
    document.addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) {
        e.stopPropagation();
        const sym = star.getAttribute('data-star');
        const q = findQuote(sym) || { symbol: sym, name: sym, market: '' };
        const on = window.Store.watchlist.toggle({ symbol: sym, name: q.name, market: q.market });
        star.textContent = on ? '★' : '☆';
        star.classList.toggle('on', on);
        star.title = on ? '取消自选' : '加入自选';
        // 新增的自选可能是轮询全集外的标的，立刻补抓一轮，避免自选页长时间 --
        if (on) fetchWatchQuotes().then(() => { if (state.view === 'watch') patchCards(el.watchWall); });
        if (state.view === 'watch') renderWatchlist(true);   // 收/取星不重播入场动画
        if (state.detail && state.detail.symbol === sym) updateStar();
        // 首屏指数固定，但下面的「我的自选」块要跟着收藏状态变
        renderHomeWatch();
        if (on) ensureSparks();                              // 新收藏的标的补一条走势线
        return;
      }
      // Movers 三榜行：全市场行不在 universe 轮询全集里，按渲染时登记的载荷进详情
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const p = state.moversRows.get(mv.getAttribute('data-mv'));
        if (p && p.secid) {
          openDetail({
            symbol: 'EM:' + p.secid, name: p.name, code: p.code,
            // 市场按 secid 反查（与热力图点击同一套口径），决定币种与成交额单位
            market: marketFromSecid(p.secid) || 'cn',
            secid: p.secid, tencent: tencentOfSecid(p.secid),
          });
        }
        return;
      }
      const card = e.target.closest('.qrow, .hero-cell, .wcard, .quote-card, .tape-cell');
      if (card) {
        const t = targetFromSymbol(card.getAttribute('data-symbol'));
        if (t) openDetail(t);
        return;
      }
      const bchip = e.target.closest('[data-bk]');
      if (bchip) { toggleBoard(bchip.getAttribute('data-bk'), +bchip.dataset.i); return; }
      const bsRow = e.target.closest('.bs-row');
      if (bsRow) {
        const t = targetFromHashSymbol(bsRow.getAttribute('data-symbol'));
        if (t) openDetail(t);
        return;
      }
      const crow = e.target.closest('[data-chain]');
      if (crow) {
        const id = crow.getAttribute('data-chain');
        if (state.openChains.has(id)) state.openChains.delete(id);
        else state.openChains.add(id);
        renderChains();
        return;
      }
      const link = e.target.closest('[data-link]');
      if (link) {
        const key = link.getAttribute('data-link');
        if (state.openLinks.has(key)) state.openLinks.delete(key);
        else state.openLinks.add(key);
        renderChains();
        return;
      }
      const heatBtn = e.target.closest('[data-heat]');
      if (heatBtn) { switchHeat(heatBtn.dataset.heat); return; }
      const periodBtn = e.target.closest('[data-period]');
      if (periodBtn) {
        state.detailPeriod = periodBtn.dataset.period;
        document.querySelectorAll('[data-period]').forEach(b => b.classList.toggle('active', b === periodBtn));
        loadDetailChart();
        return;
      }
      const newsBtn = e.target.closest('[data-newsmkt]');
      if (newsBtn) {
        state.newsMkt = newsBtn.dataset.newsmkt;
        document.querySelectorAll('[data-newsmkt]').forEach(b => b.classList.toggle('active', b === newsBtn));
        renderNews();
        return;
      }
      const newsCatBtn = e.target.closest('[data-newscat]');
      if (newsCatBtn) {
        state.newsCat = newsCatBtn.dataset.newscat;
        renderNewsCatBar();
        renderNews();
        return;
      }
      const wsortBtn = e.target.closest('[data-wsort]');
      if (wsortBtn) { state.watchSort = wsortBtn.dataset.wsort; renderWatchlist(true); return; }
      // ---- 事件页：子面板切换 / 类型过滤 / 事件行 / 关联资产 / 聚合清单 / 详情卡 ----
      const evsub = e.target.closest('[data-evsub]');
      if (evsub) { setEventsSub(evsub.dataset.evsub); return; }
      const maplayer = e.target.closest('[data-maplayer]');
      if (maplayer && window.WorldMapView) {
        const id = maplayer.dataset.maplayer;
        window.WorldMapView.setLayerVisible(id, !window.WorldMapView.layerState()[id]);
        renderMapLayers();
        return;
      }
      if (e.target.closest('[data-cdclose]')) {
        if (el.countryDetail) el.countryDetail.hidden = true;
        state.countryFocus = null;
        return;
      }
      const evtype = e.target.closest('[data-evtype]');
      if (evtype) {
        state.eventsType = evtype.dataset.evtype;
        renderEvTypeBar();
        renderEventList();
        renderGlobeLegend();
        syncGeoViews();
        return;
      }
      const evRow = e.target.closest('[data-ev]');
      if (evRow) {
        const ev = (state.events || []).find(x => x.id === evRow.getAttribute('data-ev'));
        if (ev) selectGlobalEvent(ev);
        return;
      }
      if (e.target.closest('[data-evclose]')) { renderEventDetail(null); return; }
      const relChip = e.target.closest('[data-relsym]');
      if (relChip) {
        const sym = relChip.getAttribute('data-relsym');
        const t = targetFromSymbol(sym) || targetFromHashSymbol(sym);
        if (t) openDetail(t);
        return;
      }
      // ---- 资金页：龙虎榜行进详情（K 线会自动叠加"龙虎榜"标记） ----
      const lhbRow = e.target.closest('[data-lhb]');
      if (lhbRow) {
        const t = targetFromHashSymbol(lhbRow.getAttribute('data-lhb'));
        if (t) openDetail(t);
        return;
      }
      if (e.target.closest('[data-ceclose]')) { if (el.chartEventCard) el.chartEventCard.hidden = true; return; }
      // ---- 席位档案：目录行 / 事件卡里的"查看席位档案" ----
      // ---- 披露面板的子页按钮 / 基金持仓方向 / 基金持仓行 ----
      const subBtn = e.target.closest('[data-fundssub]');
      if (subBtn) {
        const bar = subBtn.closest('.heat-toolbar');
        if (bar) switchFundsSub(bar, subBtn.getAttribute('data-fundssub'));
        return;
      }
      const dirBtn = e.target.closest('[data-funddir]');
      if (dirBtn) {
        state.fundDir = dirBtn.getAttribute('data-funddir') === 'trim' ? 'trim' : 'add';
        renderFundHolds();
        return;
      }
      const etfBtn = e.target.closest('[data-etfsub]');
      if (etfBtn) {
        state.etfSub = etfBtn.getAttribute('data-etfsub') || 'spmo';
        renderEtf();
        return;
      }
      const etfRow = e.target.closest('[data-etfsym]');
      if (etfRow) {
        const sym = etfRow.getAttribute('data-etfsym');
        openDetail({ symbol: sym, name: etfRow.getAttribute('data-etfname') || sym,
          code: sym.slice(2), market: 'us', tencent: sym });
        return;
      }
      const fundRow = e.target.closest('[data-fundsym]');
      if (fundRow) {
        const sym = fundRow.getAttribute('data-fundsym');
        openDetail({ symbol: sym, name: fundRow.getAttribute('data-fundname') || sym,
          code: sym.slice(2), market: 'cn' });
        return;
      }
      const brkBtn = e.target.closest('[data-brk-idx]');
      if (brkBtn) {
        state.brkIdx = +brkBtn.getAttribute('data-brk-idx') || 0;
        renderBrk();
        return;
      }
      const sbRow = e.target.closest('[data-sb]');
      if (sbRow) {
        // 南向名单里多数股票不在 universe 内，走东财 secid（116.xxxxx = 港股）而不是腾讯 symbol
        const code = sbRow.getAttribute('data-sb');
        const secid = '116.' + code;
        openDetail({ symbol: 'EM:' + secid, name: sbRow.getAttribute('data-sb-name') || code,
          code, market: 'hk', secid, tencent: tencentOfSecid(secid) });
        return;
      }
      const actorRow = e.target.closest('[data-actor]');
      if (actorRow) { openActor(actorRow.getAttribute('data-actor')); return; }
      const sr = e.target.closest('.sr-item');
      if (sr) { pickSearch(+sr.dataset.idx); return; }
      if (!e.target.closest('.search-wrap')) hideSearch();
    });

    // 键盘可达：卡片/环节 Enter 触发
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // 焦点在卡片内星标上时走按钮原生激活，否则会被下面的卡片 click 劫持成"进详情"
      if (e.target.closest('[data-star]')) return;
      const node = e.target.closest('.qrow, .hero-cell, .quote-card, .link-node, .crow');
      if (!node) return;
      e.preventDefault();
      node.click();
    });

    // 终端式快捷键（方法论：OpenTerminalUI 的 GO bar / 快捷键导航）：
    // 1-9/0 切 tab，/ 聚焦搜索，详情页 Backspace 返回。输入框内不劫持。
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        // 顺序直接读 DOM 里**可见**的 tab（加密 tab 是合规开关下的 crypto-only，
        // 关掉时不可见；写死数组会和实际可见数错位、导致数字键选错板块）。
        const order = [...document.querySelectorAll('#tabs .tab')]
          .filter(b => b.offsetParent !== null)
          .map(b => b.dataset.tab);
        const tab = order[+e.key === 0 ? 9 : +e.key - 1];
        if (tab) { setTab(tab); e.preventDefault(); }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
        return;
      }
      if ((state.view === 'detail' || state.view === 'actor') && (e.key === 'Backspace' || (e.key === 'Escape' &&
          !el.settingsModal.classList.contains('active') && !el.searchResults.classList.contains('active')))) {
        e.preventDefault();
        (state.view === 'detail' ? el.detailBack : el.actorBack).click();
      }
    });

    el.heatSizeToggle.addEventListener('click', () => {
      state.heatSize = state.heatSize === 'cap' ? 'pct' : 'cap';
      el.heatSizeToggle.textContent = '面积：' + (state.heatSize === 'cap' ? '市值' : '涨跌幅');
      el.heatSizeToggle.dataset.size = state.heatSize;   // 原先只写内存不改 dataset（死属性）
      drawHeat();
    });

    // A股热力图范围：市值 Top 500（默认，块块有字）⇄ 全市场（放大探索用）
    el.heatTopToggle.addEventListener('click', () => {
      state.heatTopMode = state.heatTopMode === 'top' ? 'all' : 'top';
      el.heatTopToggle.textContent = state.heatTopMode === 'top' ? '范围：市值 Top 500' : '范围：全市场';
      drawHeat();
    });

    el.heatReset.addEventListener('click', () => {
      if (state.heat) state.heat.resetView();
      el.heatReset.hidden = true;
    });

    el.detailBack.addEventListener('click', () => {
      // 有本会话推入的历史 → 走浏览器后退（后退栈里的 tab hash 会经 renderFromHash 恢复视图）；
      // 深链直达（无历史）→ 退回进入前的 tab
      if (state.pushed > 0) history.back();
      else {
        leaveDetail();
        setTab(state.prevView || 'all', { animate: false });
      }
    });
    el.detailStar.addEventListener('click', () => {
      const t = state.detail;
      if (!t) return;
      const on = window.Store.watchlist.toggle({ symbol: t.symbol, name: t.name, market: t.market });
      updateStar();
      if (on) fetchWatchQuotes();
      renderHomeWatch();   // 首屏指数固定，「我的自选」块跟着收藏状态变（详情页加星也要同步）
    });
    // 均线菜单：打开时按真实配置回显勾选与周期数值（否则菜单全空、用户以为"都关了"图上还有线）
    el.maToggle.addEventListener('click', () => {
      const menu = document.getElementById('maMenu');
      if (!menu) return;
      const open = menu.hidden;
      if (open) {
        (state.detailMACfg.lines || []).forEach((l, i) => {
          const cb = menu.querySelector(`[data-maline="${i}"]`);
          const num = menu.querySelector(`[data-man="${i}"]`);
          if (cb) cb.checked = !!l.on;
          if (num) num.value = l.n;
        });
      }
      menu.hidden = !open;
      el.maToggle.classList.toggle('active', open);
    });
    // 勾选/改周期 → 立即应用并存 localStorage（周期 clamp 到 2~500）
    const applyMaLine = (i, patch) => {
      const lines = state.detailMACfg.lines || [];
      if (!lines[i]) return;
      state.detailMACfg = { lines: lines.map((l, k) => k === i ? Object.assign({}, l, patch) : l) };
      window.Store.set('maCfg', state.detailMACfg);
      if (state.chart) state.chart.setMAVisible(state.detailMACfg.lines);
    };
    document.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-maline]');
      if (cb) { applyMaLine(+cb.dataset.maline, { on: cb.checked }); return; }
      const num = e.target.closest('[data-man]');
      if (num) {
        const n = Math.max(2, Math.min(500, Math.round(+num.value || 5)));
        num.value = n;
        applyMaLine(+num.dataset.man, { n });
      }
    });

    // 席位档案返回：有本会话历史走浏览器后退（#tab= / #symbol= hash 会被还原），深链直达退回之前 tab
    if (el.actorBack) {
      el.actorBack.addEventListener('click', () => {
        if (state.pushed > 0) history.back();
        else { leaveActor(); setTab(state.prevView || 'all', { animate: false }); }
      });
    }

    // K 线事件标记开关（全球事件 + 龙虎榜）
    if (el.evtToggle) {
      el.evtToggle.addEventListener('click', () => {
        state.chartEventsOn = !state.chartEventsOn;
        applyDetailEvents();
      });
    }

    // 搜索
    el.searchInput.addEventListener('input', (e) => doSearch(e.target.value.trim()));
    el.searchInput.addEventListener('keydown', (e) => {
      if (state.tab === 'events' && state.eventsSub === 'news') return;
      const n = state.searchItems.length;
      if (e.key === 'ArrowDown' && n) {
        e.preventDefault();
        state.searchSel = (state.searchSel + 1) % n;
      } else if (e.key === 'ArrowUp' && n) {
        e.preventDefault();
        state.searchSel = (state.searchSel - 1 + n) % n;
      } else if (e.key === 'Enter') {
        // 250ms 防抖窗口内回车：state.searchItems 还是上一个词的结果，选了必错 → 先立即搜
        if (state.searchKw !== el.searchInput.value.trim()) { runSearch(el.searchInput.value.trim()); return; }
        pickSearch(state.searchSel >= 0 ? state.searchSel : 0);
        return;
      } else if (e.key === 'Escape') {
        hideSearch();
        return;
      } else return;
      el.searchResults.querySelectorAll('.sr-item').forEach((x, i) => x.classList.toggle('sel', i === state.searchSel));
    });

    // 设置
    el.settingsBtn.addEventListener('click', openModal);
    el.settingsClose.addEventListener('click', closeModal);
    el.settingsModal.addEventListener('click', (e) => { if (e.target === el.settingsModal) closeModal(); });
    // Esc：优先关搜索下拉，其次关弹层（避免一次 Esc 把两个都关掉）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && el.settingsModal.classList.contains('active')) {
        // 焦点陷阱：Tab/Shift+Tab 在弹层内循环
        const f = el.settingsModal.querySelectorAll('button, [href], input, select, textarea');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key !== 'Escape') return;
      if (el.searchResults.classList.contains('active')) { hideSearch(); return; }
      closeModal();
    });
    el.segUpdown.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      window.Store.settings.set({ updown: b.dataset.updown });
      onUpdownChanged();
    });
    el.segRefresh.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      window.Store.settings.set({ refresh: +b.dataset.refresh });
      applySettings();
      schedule('quotes', quotesTick, refreshMs);
      scheduleMood();   // 情绪页刷新间隔同步生效，否则要重开页面才变
      renderStatus();
    });
    el.swDegraded.addEventListener('click', () => {
      const cur = window.Store.settings.get().showDegraded;
      window.Store.settings.set({ showDegraded: !cur });
      applySettings();
      if (state.view === 'market') renderCardWall(false);
      if (state.view === 'watch') renderWatchlist();
    });

    // 窗口尺寸变化 → 热力图重排（rAF 节流）
    let rz = 0;
    window.addEventListener('resize', () => {
      if (rz) return;
      rz = requestAnimationFrame(() => { rz = 0; if (state.heat && !el.heatSection.hidden) drawHeat(); });
    });
  }

  /* ==================== 启动 ==================== */

  /* 开屏（splash）2026-09-15 整体移除：进度条 + 里程碑文案属于落地页语法，
     对数据终端只是把首屏数据推迟 0.6~2.6s。现在 .sk 骨架直接可见，行情到位即渲染。
     相关 DOM（#splash / #spFill / #spStatus）、CSS（.sp-* / .splash-on）与内联脚本同步删除。 */

  async function init() {
    DOM_IDS.forEach(id => { el[id] = $(id); });
    bindHashNav();
    applySettings();
    bindEvents();
    renderStatus();
    // 触屏/无悬停设备上"滚轮/右键"全是错词，且复位入口要默认可见
    //（否则触屏用户可能永远找不到复位）；坐标仍由 onViewportChange 维护
    const touchLike = window.matchMedia('(pointer: coarse), (hover: none)').matches;
    if (el.heatHint && touchLike) {
      el.heatHint.textContent = '单指拖动 · 双指缩放 · 长按查看 · 点「复位」回初始视图';
    }
    if (el.heatReset && touchLike) el.heatReset.hidden = false;

    // 首屏骨架：数据到达前先给结构（opacity 呼吸），不白屏
    el.cardWall.innerHTML = '<div class="section"><div class="card-grid">' +
      '<div class="sk sk-card"></div>'.repeat(8) + '</div></div>';

    // 首屏只等行情（47 标的，数百毫秒级）；全市场热力图（56 页并发）走后台加载——
    // 它曾把首屏阻塞 1-3 秒，是"打开变慢"的主因。到位后补画热力图并计算市场宽度。
    const heatBg = loadHeatCN().then(() => {
      drawHeat();
      return loadMood();   // 市场宽度/情绪历史/加密宽度一并在后台算好
    }).catch(() => {});
    await fetchAllQuotes();
    renderTape();
    renderHero();
    renderCardWall();
    // 「全部」是默认 tab，而 setTab 对"已在的 tab"会早退（首屏就是 all 时那个分支根本不跑），
    // 所以首屏专属的两块（我的自选 / 全球涨跌概览）与走势线必须在 init 里自己来一遍
    if (state.tab === 'all') {
      renderHomeWatch();
      renderGlobeSum();
      ensureSparks();
    }
    renderStatus();
    drawHeat();
    void heatBg;

    // 新闻/研报不再启动即抓：首次进入对应 tab 时懒加载（setTab 分支），避免白跑请求
    // 首屏就把产业链渲染好，切到该 tab 时不会先看到空白
    loadChainQuotes().then(renderChains);
    loadGlobe();
    if (CRYPTO_ON) loadHeatCrypto();

    // 基金对比：把节点交给视图模块（它自己绑定控件、自己取数）。
    // 不在这里预取：这页一次要拉 6 条十几年长历史，进页面才拉（onEnter 首次触发）。
    if (window.CompareView) {
      window.CompareView.mount({
        wrap: el.cmpBar, input: el.cmpInput, results: el.cmpResults, add: el.cmpAdd,
        status: el.cmpStatus, retry: el.cmpRetry, presets: el.cmpPresets,
        chips: el.cmpChips, chipsSub: el.cmpChipsSub, sub: el.cmpSub,
        start: el.cmpStart, end: el.cmpEnd, quick: el.cmpQuick,
        log: el.cmpLog, normHint: el.cmpNormHint,
        chartBox: el.cmpChartBox, chart: el.cmpChart, legend: el.cmpLegend,
        metrics: el.cmpMetrics, metricsSub: el.cmpMetricsSub,
        yearly: el.cmpYearly, corr: el.cmpCorr, note: el.cmpNote,
      }, {
        openDetail,
        tencentOfSecid,
      });
    }

    // 到价提醒：节点与依赖交给视图模块（规则存 Store.alerts，tick 里判定）
    if (window.AlertCenter) {
      window.AlertCenter.mount({
        bell: el.alertBell, panel: el.alertPanel, badge: el.alertBadge,
        perm: el.alertPerm, list: el.alertList, hint: el.alertHint,
        modal: el.alertModal, target: el.alertModalTarget, dir: el.alertDir,
        price: el.alertPrice, note: el.alertNote,
        cancel: el.alertCancel, save: el.alertSave, detailBtn: el.alertDetailBtn,
        toastRoot: document.body,
      }, { findQuote, openDetail, targetFromSymbol, getDetail: () => state.detail });
    }

    // 全球事件 + 龙虎榜：开屏后后台预取（K 线事件标记要用，事件页/资金页进来秒显）
    loadEvents().catch(() => { /* 无数据时 UI 显示"采集任务未运行" */ });
    loadLhb().catch(() => { /* 同上 */ });
    loadBrk().catch(() => { /* 13F 静态 JSON 不可用时资金页显示诚实空态 */ });
    // K 线 marker 点击 → 事件卡（charts.js 抛出，详情页渲染）
    window.Bus.on('chart:event', renderChartEventCard);

    startScheduler();
    // 自检区也走 setTimeout 链（禁令 3：不许用 setInterval）
    setTimeout(renderSelfTest, 1500);
    schedule('selftest', async () => { renderSelfTest(); }, 15000);

    // 深链还原：带 #tab= / #symbol= 打开时直达对应视图（此时数据调度已起，详情会自行拉数）
    // 默认均线配置（6 槽：MA 5/10/20/60 + EMA 12/26，默认开 MA5/MA20/EMA26）
    const MA_CFG_DEFAULT = { lines: [
      { type: 'ma', n: 5, on: true },
      { type: 'ma', n: 10, on: false },
      { type: 'ma', n: 20, on: true },
      { type: 'ma', n: 60, on: false },
      { type: 'ema', n: 12, on: false },
      { type: 'ema', n: 26, on: true },
    ] };
    const storedCfg = window.Store.get('maCfg', null);
    state.detailMACfg = (storedCfg && Array.isArray(storedCfg.lines) && storedCfg.lines.length)
      ? storedCfg : MA_CFG_DEFAULT;
    state.breadthHist = window.Store.get('breadthHist', []);
    if (location.hash && location.hash !== '#') renderFromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
