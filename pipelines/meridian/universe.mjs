/* universe.mjs —— 监控池构建（移植自 Meridian lib/universe.mjs，快照源改接 core/registry）
 * 候选池（SP500 成分快照）→ 腾讯实时总市值重排 → 取前 topN。
 * 成员资格看快照文件，排名看实时市值：前者防"漏"，后者防"序旧"。
 * SPMO 不参与排名，由 monitor 固定加入。
 * 路径变更（2026-11-20 monorepo Phase 3）：快照真源在 core/registry/（sp500/ndx/spmo 三件
 * 已随 Phase 2 入册）；SPMO 持仓优先取主仓 data/actors/etf.json（随 collect 链保持新鲜），
 * 回退 core/registry 快照。 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tencentQuotes } from '../../core/sources/history.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// pipelines/meridian/ → 仓库根
export const REPO_ROOT = path.resolve(HERE, '..', '..');

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

/* SP500 候选快照：默认 core/registry/sp500-candidates.json；显式传 file 时相对仓库根解析 */
export function loadCandidates(file) {
  const p = file ? path.resolve(REPO_ROOT, file) : path.join(REPO_ROOT, 'core', 'registry', 'sp500-candidates.json');
  const j = readJson(p);
  return { file: p, tickers: j.tickers.map(([t, n]) => ({ ticker: t, name: n })), meta: { asOf: j.asOf, note: j.note }, set: new Set(j.tickers.map(([t]) => t)) };
}

/* 纳指100（QQQ 成分）快照：core/registry/ndx-candidates.json。
 * 读取失败静默降级为空集合——成员徽标缺席不挡监控主流程。 */
export function loadNdx() {
  try {
    const j = readJson(path.join(REPO_ROOT, 'core', 'registry', 'ndx-candidates.json'));
    return { asOf: j.asOf, note: j.note, set: new Set(j.tickers.map(([t]) => t)) };
  } catch { return { asOf: null, note: null, set: new Set() }; }
}

/* SPMO 持仓（Invesco 官方披露快照，只展示前 ~40 大）。
 * 取数顺序：主仓 data/actors/etf.json（随 collect 链保持新鲜）
 * → core/registry/spmo-holdings.json（打包快照）。都读不到就静默跳过。 */
export function loadSpmoHoldings() {
  const tryRead = (p) => {
    try {
      if (!existsSync(p)) return null;
      const j = readJson(p);
      const fund = j.funds ? (j.funds || []).find((f) => f.ticker === 'SPMO') : { holdings: j.holdings, effectiveDate: j.effectiveDate };
      const map = {};
      for (const h of (fund && fund.holdings) || []) {
        const t = String(h.ticker || '').toUpperCase();
        if (t) map[t] = typeof h.pct === 'number' ? h.pct : null;
      }
      return { asOf: (fund && (fund.effectiveDate || j.asOf)) || null, map };
    } catch { return null; }
  };
  return tryRead(path.join(REPO_ROOT, 'data', 'actors', 'etf.json'))
    || tryRead(path.join(REPO_ROOT, 'core', 'registry', 'spmo-holdings.json'))
    || { asOf: null, map: {} };
}

/* quotes: tencentQuotes 的返回。按实时市值降序排前 topN；
 * 市值缺失的排末尾（保持快照序），且打 warned 标记。 */
/* 腾讯报价完整代码后缀 → TradingView 交易所前缀（嵌入日K widget 用）：
 * AAPL.OQ→NASDAQ:AAPL · BRK.B.N→NYSE:BRK.B · SPMO.AM→AMEX:SPMO。
 * 无后缀时退回裸 ticker（TradingView 会自行搜索解析美股代码）。 */
const TV_EXCHANGE = { OQ: 'NASDAQ', N: 'NYSE', AM: 'AMEX' };
export function tvSymbolOf(code, ticker) {
  const T = String(ticker).toUpperCase();
  const m = /\.([A-Z]{2})$/.exec(String(code || '').toUpperCase());
  return m && TV_EXCHANGE[m[1]] ? TV_EXCHANGE[m[1]] + ':' + T : T;
}

/* ---------- 自选/持仓清单（config.watchlist.tickers） ----------
 * 两种写法："NVDA"（池内/池外均可，无备注）或 {"ticker":"QQQ","note":"池外ETF"}。
 * 池内标的：不重复取数，在既有目标上打 watch 标（全表里多一枚「自选」徽标）；
 * 池外标的：作为新目标追加取数评估，全表排在末尾（排名位显示★）。 */
export function normalizeWatchlist(watchCfg) {
  const items = watchCfg && Array.isArray(watchCfg.tickers) ? watchCfg.tickers : [];
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const t = String((it && typeof it === 'object' ? it.ticker : it) || '').toUpperCase().trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const note = it && typeof it === 'object' && it.note != null ? String(it.note).trim() : '';
    out.push({ ticker: t, note });
  }
  return out;
}

/* 池内命中：就地打标（复用该标的已排好的取数目标）；返回需要新增取数的池外清单 */
export function splitWatchlist(targets, watchlist) {
  const map = new Map(targets.map((t) => [t.ticker, t]));
  const extra = [];
  for (const wl of watchlist) {
    const hit = map.get(wl.ticker);
    if (hit) { hit.watch = true; hit.watchNote = wl.note || ''; }
    else extra.push(wl);
  }
  return { extra };
}

/* 池外标的 → 取数目标（报价补中文名/现价锚/TradingView 代码；报价缺了也能跑，名字退回代码） */
export function watchTargetOf(watchItem, quote) {
  return {
    ticker: watchItem.ticker, rank: null, mcapUsd: null, spmoPct: null,
    name: (quote && quote.name) || watchItem.ticker,
    quotePrice: quote ? quote.price : null,
    tvSymbol: tvSymbolOf(quote && quote.code, watchItem.ticker),
    watch: true,
    watchNote: watchItem.note || '',
  };
}

export function rankUniverse(candidates, quotes, topN, ndxSet) {
  // 用报价回显的查询键（usBRK.B → BRK.B）对齐，别用 code（BRK.B.N 按点切会错）
  const qmap = new Map();
  for (const q of quotes) {
    const key = String(q.query || '').replace(/^us/i, '').toUpperCase();
    if (key) qmap.set(key, q);
  }
  const rows = candidates.map((c, i) => {
    const q = qmap.get(c.ticker);
    return {
      ticker: c.ticker,
      name: (q && q.name) || c.name,
      mcapUsd: q ? q.mcapUsd : null,
      quotePrice: q ? q.price : null,
      tvSymbol: tvSymbolOf(q && q.code, c.ticker),
      ndx: ndxSet ? ndxSet.has(c.ticker) : null,
      staticIndex: i,
    };
  });
  rows.sort((a, b) => {
    const am = a.mcapUsd ?? -1, bm = b.mcapUsd ?? -1;
    if (am !== bm) return bm - am;
    return a.staticIndex - b.staticIndex;
  });
  return rows.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1, mcapMissing: r.mcapUsd === null }));
}

export async function buildUniverse({ topN, candidatesFile, quoteBatch }) {
  const candidates = loadCandidates(candidatesFile);
  const ndx = loadNdx();
  // SPMO 一起报价：拿中文名 + 现价（后复权序列锚定用）
  const quotes = await tencentQuotes([...candidates.tickers.map((t) => t.ticker), 'SPMO'], { batch: quoteBatch || 60 });
  const spmoQuote = quotes.find((q) => String(q.query || '').toUpperCase() === 'USSPMO') || null;
  const universe = rankUniverse(candidates.tickers, quotes, topN, ndx.set);
  const spmo = loadSpmoHoldings();
  for (const r of universe) r.spmoPct = spmo.map[r.ticker] ?? null;
  return { universe, candidatesMeta: candidates.meta, spmoHoldings: spmo, spmoQuote, ndxMeta: { asOf: ndx.asOf, note: ndx.note }, sp500Set: candidates.set, ndxSet: ndx.set };
}
