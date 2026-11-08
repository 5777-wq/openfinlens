/* live-sources.mjs —— 实时数据入口（零依赖，仅用 Node 内置能力）
 *
 * 职责：把 js/sources/*.js 的公开方法与解析口径原样复用给 MCP server 与构建脚本。
 *   - 行情：腾讯（A股/港股/美股/全球指数）→ 东财（外汇/商品/国债收益率）→ 币安（加密）
 *   - K 线：腾讯（日/周/月）、东财（secid 兜底）、币安（加密）
 *   - 基金画像：天天基金 pingzhongdata（公开脚本）+ fundmobapi 重仓股
 *
 * 三个原则：
 *   1. 不复制解析代码：全部走 js/sources/ 里的适配器；
 *   2. 网络失败不抛栈给调用方：返回 { rows/quotes, errors }，由上层决定降级；
 *   3. 输出只保留展示口径需要的字段——价格与涨跌，不含交易活跃度字段。
 */

import { loadWindowModules, runScriptText } from './window-env.mjs';

const BASE_SCRIPTS = ['js/utils.js', 'js/data/universe.js'];
const QUOTE_SCRIPTS = [...BASE_SCRIPTS, 'js/sources/tencent.js', 'js/sources/eastmoney.js', 'js/sources/binance.js'];

const cache = new Map();

function envFor(key, files, timeoutMs) {
  const hit = cache.get(key);
  if (hit && hit.timeoutMs === timeoutMs) return hit.ctx;
  const ctx = loadWindowModules(files, { timeoutMs });
  cache.set(key, { ctx, timeoutMs });
  return ctx;
}

/* 标的表：与页面共用 js/data/universe.js（8 大品类常量表） */
export function loadUniverse() {
  if (!cache.has('universe')) {
    const ctx = loadWindowModules(BASE_SCRIPTS);
    cache.set('universe', {
      timeoutMs: 0,
      ctx,
      data: {
        tencent: Array.from(ctx.TENCENT_UNIVERSE || []),
        em: Array.from(ctx.EM_UNIVERSE || []),
        globalIndex: Array.from(ctx.GLOBAL_INDEX || []),
        cryptoUniverse: Array.from(ctx.CRYPTO_UNIVERSE || []),
        cryptoFeatured: Array.from(ctx.CRYPTO_FEATURED || []),
        groupMeta: Array.from(ctx.GROUP_META || []),
      },
    });
  }
  return cache.get('universe').data;
}

/* 世界银行指标与国家的常量表（构建宏观序列时复用，避免另抄一份代码） */
export function loadWorldBankMeta() {
  if (!cache.has('worldbankMeta')) {
    const ctx = loadWindowModules([...BASE_SCRIPTS, 'js/sources/worldbank.js']);
    cache.set('worldbankMeta', {
      timeoutMs: 0,
      ctx,
      data: {
        indicators: { ...ctx.WorldBankSource.INDICATORS },
        countries: Array.from(ctx.WorldBankSource.COUNTRIES || []),
      },
    });
  }
  return cache.get('worldbankMeta').data;
}

export function sources(timeoutMs = 12000) {
  return envFor('sources', QUOTE_SCRIPTS, timeoutMs);
}

/* 输出字段白名单：只保留价格/涨跌口径，交易活跃度字段一律不进入 API */
const QUOTE_KEYS = [
  'symbol', 'name', 'code', 'market',
  'price', 'prevClose', 'open', 'high', 'low',
  'change', 'changePct', 'quoteAt', 'updatedAt', 'source',
];

function cleanQuote(q) {
  const out = {};
  for (const k of QUOTE_KEYS) {
    if (q[k] !== undefined) out[k] = q[k];
  }
  out.quoteAt = Number.isFinite(q.quoteAt) ? q.quoteAt : null;
  out.updatedAt = Number.isFinite(q.updatedAt) ? q.updatedAt : null;
  return out;
}

function splitSymbols(list) {
  const tencent = [];
  const em = [];
  const crypto = [];
  for (const raw of list) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (/^EM:/i.test(s)) em.push(s.slice(3));
    // 币安交易对（BTCUSDT / ETHUSDT），也接受 BTC-USDT 写法
    else if (/^[A-Za-z0-9]{2,12}-?USDT$/i.test(s)) crypto.push(s.toUpperCase().replace('-', ''));
    else tencent.push(s);
  }
  return { tencent, em, crypto };
}

/* 批量行情：三路并发，任何一路失败只记录错误，不影响其它源。
   返回 { quotes, errors, via }；via = live / fail / offline / empty */
export async function fetchQuotes(symbols, { offline = false, timeoutMs = 12000 } = {}) {
  const list = (Array.isArray(symbols) ? symbols : []).map(String).filter(Boolean);
  if (offline) {
    return { quotes: [], errors: [{ source: 'network', message: '离线模式：跳过实时行情抓取' }], via: 'offline' };
  }
  if (!list.length) return { quotes: [], errors: [], via: 'empty' };

  const { tencent, em, crypto } = splitSymbols(list);
  const W = sources(timeoutMs);
  const jobs = [];

  if (tencent.length) {
    jobs.push(
      W.TencentSource.getQuotes(tencent)
        .then((rows) => ({ source: 'tencent', rows }))
        .catch((e) => ({ source: 'tencent', error: String(e && e.message || e) }))
    );
  }
  if (em.length) {
    jobs.push(
      W.EastmoneySource.getQuotes(em)
        .then((rows) => ({ source: 'eastmoney', rows }))
        .catch((e) => ({ source: 'eastmoney', error: String(e && e.message || e) }))
    );
  }
  if (crypto.length) {
    jobs.push(
      W.BinanceSource.getQuotes(crypto)
        .then((rows) => ({ source: 'binance', rows }))
        .catch((e) => ({ source: 'binance', error: String(e && e.message || e) }))
    );
  }

  const settled = await Promise.all(jobs);
  const quotes = [];
  const errors = [];
  for (const job of settled) {
    if (job.error) {
      errors.push({ source: job.source, message: job.error });
      continue;
    }
    for (const row of job.rows || []) {
      if (!row || !Number.isFinite(row.price)) continue;
      quotes.push(cleanQuote(row));
    }
    if (!job.rows || !job.rows.length) errors.push({ source: job.source, message: '上游返回空结果' });
  }
  return { quotes, errors, via: quotes.length ? 'live' : 'fail' };
}

const PERIODS = {
  day: { tencent: 'day', eastmoney: 101, binance: '1d' },
  week: { tencent: 'week', eastmoney: 102, binance: '1w' },
  month: { tencent: 'month', eastmoney: 103, binance: '1M' },
};

/* 东财 secid 映射：K 线兜底用。规则与 js/sources/history.js、FIELD-NOTES 的号段结论一致：
   A股 1.沪 / 0.深（含指数与场内基金号段）；港股 116.；美股个股 105.；美股指数与港股指数走 100.。 */
const HK_INDEX_SECID = { HSI: '100.HSI', HSTECH: '124.HSTECH', HSCEI: '124.HSCEI' };
const US_INDEX_SECID = { DJI: '100.DJIA', IXIC: '100.NDX', INX: '100.SPX', VIX: '100.VIX' };

function emSecidFor(symbol) {
  if (/^sh/i.test(symbol)) return '1.' + symbol.slice(2);
  if (/^(sz|bj)/i.test(symbol)) return '0.' + symbol.slice(2);
  const hkIdx = /^hk(HSI|HSTECH|HSCEI)$/i.exec(symbol);
  if (hkIdx) return HK_INDEX_SECID[hkIdx[1].toUpperCase()] || null;
  if (/^hk\d/i.test(symbol)) return '116.' + symbol.slice(2);
  const usIdx = /^us(DJI|IXIC|INX|VIX)$/i.exec(symbol);
  if (usIdx) return US_INDEX_SECID[usIdx[1].toUpperCase()] || null;
  if (/^us[A-Za-z]/i.test(symbol)) return '105.' + symbol.slice(2);
  return null;
}

/* 腾讯 fqkline 的裸域兜底：web.ifzq 子域被 WAF 挑战时（FIELD-NOTES 有记录），
   同一后端的 ifzq.gtimg.cn 仍可用。解析口径与 js/sources/tencent.js 的 getKline 完全一致：
   data[code]['qfq'+period] || data[code][period]，行序 [time, open, close, high, low, ...]。 */
async function tencentKlineBare(symbol, period, limit, timeoutMs) {
  const tryOnce = async (code) => {
    const url = 'https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
      encodeURIComponent([code, period, '', '', limit, 'qfq'].join(','));
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const node = j && j.data && (j.data[code] || j.data[symbol]);
    const rows = (node && (node['qfq' + period] || node[period])) || [];
    const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    return rows.map((r) => ({
      time: r[0], open: num(r[1]), close: num(r[2]), high: num(r[3]), low: num(r[4]),
    })).filter((k) => k.open !== null && k.close !== null);
  };
  let rows = await tryOnce(symbol);
  // 美股裸代码只回 2 根脏数据，必须补交易所后缀（后缀取自 qt.gtimg.cn 的 f[2]，与 tencent.js 同法）
  if (rows.length < 5 && /^us/i.test(symbol)) {
    try {
      const r = await fetch('https://qt.gtimg.cn/q=' + symbol, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const buf = await r.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buf);
      const m = /v_[A-Za-z0-9._]+="([^"]*)"/.exec(text);
      const full = m ? String(m[1].split('~')[2] || '').trim() : '';
      if (/\./.test(full)) {
        const retry = await tryOnce('us' + full);
        if (retry.length > rows.length) rows = retry;
      }
    } catch { /* 后缀拿不到就保留原结果 */ }
  }
  return rows;
}


/* 单标的 K 线。返回 { rows, via, error }，行只含 time/open/high/low/close。 */
export async function fetchKlines(symbol, period = 'day', limit = 160, { offline = false, timeoutMs = 12000 } = {}) {
  const spec = PERIODS[period];
  if (!spec) throw new Error('period 只支持 day / week / month');
  if (offline) return { rows: [], via: 'offline', error: '离线模式：跳过实时 K 线抓取' };
  const sym = String(symbol || '').trim();
  if (!sym) throw new Error('symbol 不能为空');
  const W = sources(timeoutMs);
  let rows = [];
  let via = null;
  let error = null;
  try {
    if (/^EM:/i.test(sym)) {
      via = 'eastmoney';
      rows = await W.EastmoneySource.getKline(sym.slice(3), spec.eastmoney, limit);
    } else if (/USDT$/i.test(sym)) {
      via = 'binance';
      rows = await W.BinanceSource.getKline(sym, spec.binance, limit);
    } else {
      via = 'tencent';
      try {
        rows = await W.TencentSource.getKline(sym, spec.tencent, limit);
      } catch (e) {
        error = String(e && e.message || e);
      }
      // web.ifzq 被 WAF 挑战时，用同一后端的裸域重试（解析口径一致）
      if (!rows.length) {
        try {
          rows = await tencentKlineBare(sym, spec.tencent, limit, timeoutMs);
          if (rows.length) via = 'tencent:ifzq';
        } catch (e) {
          error = error || String(e && e.message || e);
        }
      }
      // 腾讯全挂时用东财 push2his 兜底（secid 按号段/市场映射）
      if (!rows.length) {
        const secid = emSecidFor(sym);
        if (secid) {
          try {
            rows = await W.EastmoneySource.getKline(secid, spec.eastmoney, limit);
            if (rows.length) via = 'eastmoney';
          } catch (e) {
            error = error || String(e && e.message || e);
          }
        }
      }
    }
  } catch (e) {
    error = String(e && e.message || e);
  }
  const clean = (rows || [])
    .map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close }))
    .filter((r) => r.time !== null && r.time !== undefined && r.open !== null && r.close !== null);
  return { rows: clean, via, error };
}

/* 基金画像：pingzhongdata 是公开 JS（不是 JSON），在独立 vm 上下文里执行后读变量。
   解析交给 js/fundparse.js 的 normalizePingzhong，与页面完全同一套归一化。 */
const PZ_GLOBALS = [
  'fS_name', 'fS_code', 'fund_sourceRate', 'fund_Rate', 'fund_minsg',
  'syl_1n', 'syl_6y', 'syl_3y', 'syl_1y', 'stockCodes', 'Data_fundSharesPositions',
  'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_grandTotal', 'Data_rateInSimilarType',
  'Data_rateInSimilarPersent', 'Data_fluctuationScale', 'Data_holderStructure',
  'Data_assetAllocation', 'Data_performanceEvaluation', 'Data_currentFundManager',
  'Data_buySedemption',
];

export async function fetchFundProfile(rawCode, { offline = false, timeoutMs = 12000 } = {}) {
  const m = String(rawCode == null ? '' : rawCode).trim().match(/^(\d{5,6})$/);
  if (!m) throw new Error('基金代码必须是 5~6 位数字');
  if (offline) throw new Error('离线模式：基金画像没有静态快照，请在联网环境调用');
  const code = m[1];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(3000, timeoutMs));
  let text;
  try {
    const res = await fetch('https://fund.eastmoney.com/pingzhongdata/' + code + '.js', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenFinLens-MCP/1.0)' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error('基金档案接口 HTTP ' + res.status);
    text = await res.text();
  } catch (e) {
    throw new Error('基金档案不可达：' + String(e && e.message || e));
  } finally {
    clearTimeout(timer);
  }

  let profile = null;
  let got = {};
  try {
    const pzCtx = runScriptText(text, { timeoutMs });
    for (const k of PZ_GLOBALS) got[k] = pzCtx[k];
    const parseCtx = loadWindowModules(['js/fundparse.js'], { timeoutMs });
    profile = parseCtx.FundParse.normalizePingzhong(got);
    if (!profile) throw new Error('结构无法识别');
  } catch (e) {
    throw new Error('基金档案解析失败：' + String(e && e.message || e));
  }

  let stocks = null;
  try {
    const res = await fetch(
      'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=' + code +
      '&deviceid=wap&plat=Wap&product=EFund&version=6.2.8',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenFinLens-MCP/1.0)' }, signal: AbortSignal.timeout(timeoutMs) }
    );
    if (res.ok) {
      const j = await res.json();
      const parseCtx = loadWindowModules(['js/fundparse.js'], { timeoutMs });
      stocks = parseCtx.FundParse.normalizeInverst(j && j.Datas);
    }
  } catch {
    stocks = null;
  }
  if (!stocks) {
    try {
      const parseCtx = loadWindowModules(['js/fundparse.js'], { timeoutMs });
      stocks = parseCtx.FundParse.parseStockCodes(got.stockCodes);
    } catch {
      stocks = null;
    }
  }

  return { profile, stocks: stocks || [], fetchedAt: Date.now() };
}
