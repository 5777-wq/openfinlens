/* us-schema.mjs —— data/us-signals.json 产物协议（构建器 + 校验器）
 *
 * 设计约束（Gemini 裁定，2026-11-20）：
 *   · 字段自包含且轻量：终端「美股信号」Tab 直接消费，不依赖其他产物也能渲染；
 *   · 体积红线：严禁把 200+ 只票的全量 2400 根 K 线塞进来（完整 K 线由增量缓存承载，
 *     终端单票详情按需拉取或复用其既有 K 线能力），产物控制在几百 KB 内；
 *   · summary 给超买/超卖/回归/通道事件的计数 + 名单，前端不用自己再算分组。
 *
 * buildUsSignals(data)：monitor 内部形态 {meta, cfg, spmo, rows, summary, failed}
 *   → 协议对象。validateUsSignals(obj) → {ok, errors[]}：结构断言 + 体积红线
 *   （>900KB 视为违约——K 线数组混进来的典型症状）。
 */

const SCHEMA_VERSION = 1;
const SIZE_LIMIT_BYTES = 900 * 1024;   // 体积红线（"几百 KB 内"的上界护栏）

const vegasOf = (tunnels) => (tunnels || []).map((t) => ({
  key: t.key, n: t.n,
  pos: t.pos ?? null, event: t.event ?? null,
  insufficient: !!t.insufficient, widthPct: t.widthPct ?? null,
}));

const revertOf = (rsi) => !!(rsi && (rsi.cross === 'out_ob' || rsi.cross === 'out_os'));

function itemOf(r) {
  return {
    symbol: r.ticker,
    name: r.name || r.ticker,
    rank: r.rank ?? null,
    mcapUsd: r.mcapUsd ?? null,
    spmoWeight: r.spmoPct ?? null,
    price: r.close,
    changePct: r.chgPct ?? null,
    adj: r.adj,
    anchored: !!r.anchored,
    source: r.source || null,
    bars: r.bars ?? null,
    asOf: r.asOf,
    tags: {
      sp500: !!r.sp500,
      ndx100: !!r.ndx,
      watch: !!r.watch,
      watchNote: r.note || null,
      tvSymbol: r.tvSymbol || r.ticker,
    },
    daily: {
      rsi6: r.rsi6 || null,
      rsi14: r.rsi14 || null,
      revert: revertOf(r.rsi6),
      vegas: vegasOf(r.tunnels),
    },
    weekly: r.wk ? {
      asOf: r.wk.asOf,
      bars: r.wk.bars,
      rsi6: r.wk.rsi6 || null,
      rsi14: r.wk.rsi14 || null,
      revert: revertOf(r.wk.rsi6),
      vegas: vegasOf(r.wk.tunnels),
      live: r.wk.live || null,
    } : null,
    live: r.live || null,
    context: {
      obDays: r.obDays ?? null,
      aboveDays: r.aboveDays ?? null,
      extPct: r.extPct ?? null,
      volRatio: r.volRatio ?? null,
      sigHist: r.sigHist || null,
    },
    warnings: (r.notes || []).map((n) => ({ tag: n.tag, level: n.level, text: n.text })),
  };
}

export function buildUsSignals(data) {
  const { meta, cfg, spmo, rows, summary, failed } = data;
  const all = [spmo, ...rows].filter(Boolean);
  const wAll = all.filter((r) => r.wk && r.wk.rsi6);
  const slimCfg = { rsi: cfg.rsi, tunnels: (cfg.tunnels || []).map((t) => ({ key: t.key, n: t.n })) };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    strategy: 'SPMO 攒股 + SP500 前 150 增强 · 日线+周线 RSI6 超买超卖 + Vegas 三通道',
    marketClock: {
      etDate: meta.etDate ?? null,
      etTime: meta.etTime ?? null,
      runAtEt: meta.runAtEt,
      marketDate: meta.marketDate,
      dataDate: meta.dataDate,
      liveCount: meta.liveCount ?? 0,
      isLive: (meta.liveCount ?? 0) > 0,
    },
    meta: {
      topN: meta.topN,
      extraNote: meta.extraNote || null,
      candidatesAsOf: meta.candidatesAsOf || null,
      ndxAsOf: meta.ndxAsOf || null,
      universeNote: meta.universeNote || null,
      srcEast: meta.srcEast ?? 0,
      srcYahoo: meta.srcYahoo ?? 0,
      srcTx: meta.srcTx ?? 0,
      srcFail: meta.srcFail ?? 0,
      eastError: meta.eastError || null,
      yahooError: meta.yahooError || null,
      staleCount: meta.staleCount ?? 0,
      staleTickers: meta.staleTickers || [],
      watchCount: meta.watchCount ?? 0,
      breadth: meta.breadth || null,
      sigStats: meta.sigStats || null,
      mock: meta.mock || undefined,
    },
    cfg: slimCfg,
    summary: {
      counts: {
        ob: summary.overbought.length,
        os: summary.oversold.length,
        obr: summary.obReturn.length,
        osr: summary.osReturn.length,
        events: summary.events.length,
        wob: wAll.filter((r) => r.wk.rsi6.state === 'overbought').length,
        wos: wAll.filter((r) => r.wk.rsi6.state === 'oversold').length,
        wret: wAll.filter((r) => r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os').length,
      },
      overbought: summary.overbought.map((r) => r.ticker),
      oversold: summary.oversold.map((r) => r.ticker),
      obReturn: summary.obReturn.map((r) => r.ticker),
      osReturn: summary.osReturn.map((r) => r.ticker),
      events: summary.events.map((r) => r.ticker),
      weekOverbought: wAll.filter((r) => r.wk.rsi6.state === 'overbought').map((r) => r.ticker),
      weekOversold: wAll.filter((r) => r.wk.rsi6.state === 'oversold').map((r) => r.ticker),
      weekReturn: wAll.filter((r) => r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os').map((r) => r.ticker),
      watch: [...(spmo && spmo.watch ? [spmo.ticker] : []), ...rows.filter((r) => r.watch).map((r) => r.ticker)],
    },
    spmo: spmo ? itemOf(spmo) : null,
    items: rows.map(itemOf),
    failed: (failed || []).map((f) => ({ ticker: f.ticker, name: f.name || null, reason: f.reason })),
  };
}

/* 结构校验（采集闸门与测试共用）：任何一项不过都算违约，宁可红也不发残次品 */
export function validateUsSignals(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['顶层不是对象'] };
  if (obj.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion 必须 = ' + SCHEMA_VERSION);
  if (!Number.isFinite(Date.parse(obj.generatedAt))) errors.push('generatedAt 不是合法时间');
  const mc = obj.marketClock || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mc.marketDate || '')) errors.push('marketClock.marketDate 缺失或格式非法');
  if (typeof mc.isLive !== 'boolean') errors.push('marketClock.isLive 必须是布尔');
  if (!obj.summary || !obj.summary.counts || typeof obj.summary.counts.ob !== 'number') errors.push('summary.counts 缺失');
  if (!Array.isArray(obj.items)) errors.push('items 不是数组');
  const warn = (cond, msg) => { if (!cond) errors.push(msg); };
  for (const it of obj.items || []) {
    warn(typeof it.symbol === 'string' && it.symbol, 'item.symbol 缺失');
    const r6 = it.daily && it.daily.rsi6;
    warn(r6 === null || (r6 && typeof r6 === 'object' && Number.isFinite(r6.value) && typeof r6.state === 'string'),
      it.symbol + ' daily.rsi6 结构非法');
    warn(it.daily && Array.isArray(it.daily.vegas), it.symbol + ' daily.vegas 不是数组');
    warn(it.weekly === null || (it.weekly && typeof it.weekly.asOf === 'string'), it.symbol + ' weekly 结构非法');
    warn(it.tags && typeof it.tags.sp500 === 'boolean', it.symbol + ' tags.sp500 必须是布尔');
    warn(!('k' in (it || {})) && !(it.weekly && 'k' in it.weekly), it.symbol + ' 混入了 K 线数组（体积红线违约）');
  }
  // 体积红线：>900KB 视为 K 线混入的典型症状
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(obj)); } catch { /* 循环引用等极端情况交给上面的结构断言 */ }
  if (size > SIZE_LIMIT_BYTES) errors.push('产物 ' + (size / 1024).toFixed(0) + 'KB 超体积红线（' + (SIZE_LIMIT_BYTES / 1024) + 'KB）——疑似全量 K 线混入');
  return { ok: errors.length === 0, errors, sizeBytes: size };
}
