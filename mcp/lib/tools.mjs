/* tools.mjs —— MCP 工具定义与实现（零依赖）
 *
 * 每个工具都遵循同一返回形状：
 *   { ok: true, meta: {...}, count, ...业务字段 }
 * 失败时由 callTool 统一转成 MCP 的 isError 语义，绝不把异常栈丢给客户端。
 *
 * 设计取向（给 Agent 用）：
 *   - 参数尽量少，常用路径一个必填参数即可（search_symbols / get_klines / get_fund_profile）；
 *   - 所有列表都带 count，所有响应都带 meta（asof / stale / source / note），让 Agent 能判断可信度；
 *   - 实时抓取失败自动回退静态快照，并在 meta.stale 与 via 里诚实标注。
 */

import {
  readEnvelope, readJson, slimMeta, universeSymbols,
  searchSymbols, resolveSymbol,
} from './api-store.mjs';
import { fetchQuotes, fetchKlines, fetchFundProfile } from './live-sources.mjs';

const CN_NUM = {
  type: 'integer',
  description: '返回条数上限',
};

const LIMIT = (def, max = 200) => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
  default: def,
  description: '返回条数上限，默认 ' + def + '，最大 ' + max,
});

const LIVE = {
  type: 'boolean',
  default: true,
  description: '是否优先实时抓取公开接口；false 时只读 api/v1 静态快照',
};

const stringArray = {
  type: 'array',
  items: { type: 'string' },
  description: '标的列表，可写标准代码（sh600519）、纯代码（600519）、中文名（贵州茅台）或拼音首字母（gzmt）',
};

/* ---------------- 小工具 ---------------- */

function asInt(v, def, min, max) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('参数必须是数字：' + v);
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function asBool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return def;
}

function asStr(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function asList(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  return s.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
}

function iso(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function lastTimeOf(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const t = rows[rows.length - 1].time;
  if (typeof t === 'number') return new Date(t * 1000).toISOString();
  return t ? String(t) : null;
}

function matchMarket(entry, market) {
  if (!market) return true;
  return String(entry.market || '').toLowerCase() === String(market).toLowerCase();
}

function metaOf(env, extra = {}) {
  return { ...slimMeta(env.meta), ...extra };
}

/* ---------------- 工具实现 ---------------- */

const DEFAULT_QUOTE_SYMBOLS = [
  'sh000001', 'sz399001', 'sz399006', 'hkHSI', 'hkHSTECH',
  'usDJI', 'usIXIC', 'usINX', 'usAAPL', 'usNVDA', 'usTSLA',
  'sh600519', 'hk00700', 'BTCUSDT', 'EM:101.GC00Y', 'EM:171.US10Y',
];

async function tListDatasets(args) {
  const env = readEnvelope('api/v1/index.json');
  const keyword = asStr(args.keyword).toLowerCase();
  const staleOnly = asBool(args.stale_only, false);
  let rows = Array.isArray(env.data.datasets) ? env.data.datasets : [];
  if (staleOnly) rows = rows.filter((d) => d.stale === true);
  if (keyword) {
    rows = rows.filter((d) =>
      [d.id, d.title, d.description, d.path].some((v) => String(v || '').toLowerCase().includes(keyword)));
  }
  return {
    ok: true,
    meta: metaOf(env),
    count: rows.length,
    datasets: rows.map((d) => ({
      id: d.id, title: d.title, path: d.path, kind: d.kind,
      asof: d.asof, stale: d.stale, count: d.count !== undefined ? d.count : null,
      updatedAt: d.updatedAt, description: d.description,
    })),
  };
}

async function tGetManifest(args) {
  const env = readEnvelope('api/v1/manifest.json');
  const datasets = Array.isArray(env.data.datasets) ? env.data.datasets : [];
  const id = asStr(args.dataset);
  if (id) {
    const hit = datasets.find((d) => d.id === id) ||
      datasets.find((d) => d.id.toLowerCase().includes(id.toLowerCase()));
    if (!hit) throw new Error('清单里没有这个数据集：' + id);
    return { ok: true, meta: metaOf(env), dataset: hit };
  }
  return {
    ok: true,
    meta: metaOf(env),
    version: env.data.version,
    base: env.data.base,
    count: datasets.length,
    datasets: datasets.map((d) => ({
      id: d.id, title: d.title, path: d.path, kind: d.kind,
      asof: d.asof, stale: d.stale, count: d.count !== undefined ? d.count : null,
      fieldCount: Array.isArray(d.fields) ? d.fields.length : 0,
      description: d.description,
    })),
    usage: '需要字段定义与样例时再调用 get_manifest({dataset:"<id>"})',
  };
}

async function tGetHealth() {
  const env = readEnvelope('api/v1/health.json');
  return { ok: true, meta: metaOf(env), ...env.data };
}

async function tSearchSymbols(args) {
  const query = asStr(args.query);
  if (!query) throw new Error('query 不能为空，例如 "茅台" / "gzmt" / "600519" / "AAPL"');
  const limit = asInt(args.limit, 10, 1, 50);
  const market = asStr(args.market);
  let matches = searchSymbols(query, 50);
  if (market) matches = matches.filter((m) => matchMarket(m, market));
  matches = matches.slice(0, limit);
  return {
    ok: true,
    query,
    count: matches.length,
    matches,
    note: matches.length
      ? 'symbol 字段就是其它工具的标准入参；命中分数越高越可信。'
      : '没有匹配。可以换用代码、中文全名或拼音首字母再试。',
  };
}

async function tGetQuotes(args, ctx) {
  const offline = ctx.offline;
  const liveAllowed = !offline && asBool(args.live, true);
  const market = asStr(args.market);
  let wanted = asList(args.symbols);

  if (!wanted.length) {
    if (market) {
      wanted = universeSymbols()
        .filter((s) => matchMarket(s, market))
        .map((s) => s.symbol)
        .slice(0, asInt(args.limit, 40, 1, 200));
    } else {
      wanted = DEFAULT_QUOTE_SYMBOLS.slice();
    }
  }

  const resolved = [];
  const unknown = [];
  for (const raw of wanted) {
    const hit = resolveSymbol(raw);
    if (hit) resolved.push(hit);
    else unknown.push(raw);
  }
  if (!resolved.length) {
    throw new Error('没有识别出任何标的：' + wanted.join('、') + '。先用 search_symbols 确认代码。');
  }

  const limit = asInt(args.limit, 40, 1, 200);
  const target = [];
  const seen = new Set();
  for (const entry of resolved) {
    if (seen.has(entry.symbol)) continue;
    seen.add(entry.symbol);
    target.push(entry);
    if (target.length >= limit) break;
  }

  let live = { quotes: [], errors: [], via: 'offline' };
  if (liveAllowed) {
    try {
      live = await fetchQuotes(target.map((t) => t.symbol), { offline: false });
    } catch (e) {
      live = { quotes: [], errors: [{ source: 'network', message: String(e && e.message || e) }], via: 'fail' };
    }
  }

  const liveMap = new Map();
  for (const q of live.quotes || []) if (!liveMap.has(q.symbol)) liveMap.set(q.symbol, q);

  let staticEnv = null;
  let staticMap = new Map();
  if (liveMap.size < target.length) {
    try {
      staticEnv = readEnvelope('api/v1/quotes/latest.json');
      const rows = staticEnv.data && Array.isArray(staticEnv.data.quotes) ? staticEnv.data.quotes : [];
      staticMap = new Map(rows.map((q) => [q.symbol, q]));
    } catch {
      // 静态快照缺失不该拖垮已经拿到的实时行情
      staticEnv = null;
      staticMap = new Map();
    }
  }

  const quotes = [];
  let via = liveMap.size ? 'live' : 'static';
  let usedStatic = 0;
  for (const entry of target) {
    const liveRow = liveMap.get(entry.symbol);
    if (liveRow) {
      quotes.push({ ...liveRow, market: entry.market, kind: entry.kind });
      continue;
    }
    const staticRow = staticMap.get(entry.symbol);
    if (staticRow) {
      usedStatic++;
      quotes.push({ ...staticRow, market: entry.market, kind: entry.kind });
    }
  }
  if (!staticEnv) {
    try { staticEnv = readEnvelope('api/v1/quotes/latest.json'); } catch { staticEnv = null; }
  }
  if (liveMap.size && usedStatic) via = 'mixed';
  if (!quotes.length) {
    throw new Error('实时与静态快照都没有这批标的的行情：' + target.map((t) => t.symbol).join('、'));
  }

  const asofList = quotes.map((q) => q.quoteAt || q.updatedAt).filter((v) => Number.isFinite(v));
  const asof = asofList.length ? new Date(Math.max(...asofList)).toISOString() : (staticEnv ? staticEnv.meta.asof : null);
  const stale = via === 'live' ? false : (staticEnv ? staticEnv.meta.stale : true);
  const notes = [];
  if (via === 'static') notes.push('实时抓取不可用，已回退 api/v1 静态快照。');
  if (via === 'mixed') notes.push('部分标的实时抓取失败，已用静态快照补齐。');
  if (offline) notes.push('服务运行在离线模式，只读静态快照。');
  if (unknown.length) notes.push('未识别标的：' + unknown.join('、'));

  return {
    ok: true,
    meta: {
      dataset: 'quotes.latest',
      asof,
      generatedAt: nowIso(),
      source: via === 'live' ? '公开行情接口（腾讯 / 东方财富 / 币安）' : (staticEnv ? staticEnv.meta.source : '实时抓取不可用'),
      stale,
      license: staticEnv ? staticEnv.meta.license : '',
      note: notes.join(' '),
    },
    via,
    count: quotes.length,
    requested: target.length,
    quotes,
    errors: live.errors || [],
  };
}

async function tGetKlines(args, ctx) {
  const rawSymbol = asStr(args.symbol);
  if (!rawSymbol) throw new Error('symbol 不能为空，例如 sh600519 / 600519 / 贵州茅台 / AAPL');
  const entry = resolveSymbol(rawSymbol);
  if (!entry) throw new Error('无法识别标的：' + rawSymbol + '，请先用 search_symbols 查询。');
  if (!/^[A-Za-z0-9.]{2,16}$/.test(entry.symbol)) throw new Error('标的代码格式不合法：' + entry.symbol);

  const period = asStr(args.period) || 'day';
  if (!['day', 'week', 'month'].includes(period)) throw new Error('period 只支持 day / week / month');
  const limit = asInt(args.limit, 120, 1, 400);
  const liveAllowed = !ctx.offline && asBool(args.live, true);

  let rows = [];
  let via = 'static';
  let error = null;
  if (liveAllowed) {
    try {
      const live = await fetchKlines(entry.symbol, period, limit, { offline: false });
      rows = live.rows || [];
      if (rows.length) via = 'live:' + (live.via || 'unknown');
      if (live.error) error = live.error;
    } catch (e) {
      error = String(e && e.message || e);
    }
  }

  let staticEnv = null;
  if (rows.length < 1) {
    const rel = 'api/v1/klines/' + entry.symbol + '.json';
    try {
      staticEnv = readEnvelope(rel);
      const block = staticEnv.data && staticEnv.data.periods && staticEnv.data.periods[period];
      const staticRows = block && Array.isArray(block.rows) ? block.rows : [];
      rows = staticRows.slice(-limit);
      via = 'static';
      if (block && block.stale) error = error || '静态快照标记为 stale';
    } catch (e) {
      throw new Error('实时 K 线取不到，且没有该标的的静态快照：' + entry.symbol + '（' + (error || e.message) + '）');
    }
  }
  if (!rows.length) throw new Error('该标的在 ' + period + ' 周期没有可用 K 线数据。');
  rows = rows.slice(-limit);

  if (!staticEnv) {
    try { staticEnv = readEnvelope('api/v1/klines/' + entry.symbol + '.json'); } catch { staticEnv = readEnvelope('api/v1/markets/klines.json'); }
  }
  const asof = lastTimeOf(rows);
  const stale = via === 'static' ? !!(staticEnv.meta && staticEnv.meta.stale) : false;
  return {
    ok: true,
    meta: {
      dataset: 'klines.symbol',
      asof,
      generatedAt: nowIso(),
      source: via.startsWith('live') ? '公开行情接口（腾讯 / 东方财富 / 币安）' : (staticEnv.meta.source || '静态快照'),
      stale,
      license: staticEnv.meta.license || '',
      note: via.startsWith('live')
        ? 'K 线只含时间与开高低收；' + (error ? '部分周期实时抓取异常：' + error : '')
        : '实时抓取不可用，已回退静态快照。',
    },
    symbol: entry.symbol,
    name: entry.name,
    market: entry.market,
    period,
    count: rows.length,
    via,
    rows,
  };
}

async function tGetEvents(args) {
  const env = readEnvelope('api/v1/events/global.json');
  const category = asStr(args.category).toLowerCase();
  const country = asStr(args.country);
  const keyword = asStr(args.keyword).toLowerCase();
  const sinceRaw = asStr(args.since);
  const since = sinceRaw
    ? (/^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw))
    : null;
  if (sinceRaw && !Number.isFinite(since)) throw new Error('since 需要 ISO 时间或毫秒时间戳');
  const limit = asInt(args.limit, 50, 1, 200);

  let items = Array.isArray(env.data.events) ? env.data.events : [];
  if (category) items = items.filter((e) => String(e.category || '').toLowerCase() === category);
  if (country) items = items.filter((e) => String(e.country || '').includes(country));
  if (keyword) {
    items = items.filter((e) => [e.title, e.country, e.category, ...(e.relatedSymbols || [])]
      .some((v) => String(v || '').toLowerCase().includes(keyword)));
  }
  if (Number.isFinite(since)) {
    items = items.filter((e) => {
      const t = Date.parse(e.publishedAt);
      return Number.isFinite(t) && t >= since;
    });
  }
  items = items.slice(0, limit);
  return {
    ok: true,
    meta: metaOf(env),
    count: items.length,
    filters: { category: category || null, country: country || null, since: sinceRaw || null, keyword: keyword || null },
    events: items,
    note: 'severity 是本项目把上游 importance 映射出的 0-100 口径，不是上游原始字段；坐标为关键词地理定位，精度为国家/地区级。',
  };
}

async function tGetPredictionMarkets(args) {
  const env = readEnvelope('api/v1/prediction/markets.json');
  const category = asStr(args.category).toLowerCase();
  const keyword = asStr(args.keyword).toLowerCase();
  const minP = asInt(args.min_percent, 0, 0, 100) / 100;
  const limit = asInt(args.limit, 20, 1, 100);

  let items = Array.isArray(env.data.events) ? env.data.events : [];
  if (category) items = items.filter((e) => String(e.category || '').toLowerCase() === category);
  if (keyword) {
    items = items.filter((e) => {
      const hay = [e.title, e.titleZh, e.category, ...(e.outcomes || []).map((o) => o.label + ' ' + (o.labelZh || ''))];
      return hay.some((v) => String(v || '').toLowerCase().includes(keyword));
    });
  }
  if (minP > 0) {
    items = items.filter((e) => (e.outcomes || []).some((o) => Number(o.probability) >= minP));
  }
  items = items.slice(0, limit).map((e) => ({
    ...e,
    outcomes: (e.outcomes || [])
      .slice()
      .sort((a, b) => Number(b.probability) - Number(a.probability))
      .slice(0, 8),
  }));
  return {
    ok: true,
    meta: metaOf(env),
    count: items.length,
    filters: { category: category || null, keyword: keyword || null, min_percent: Number.isFinite(minP) ? Math.round(minP * 100) : 0 },
    events: items,
    note: 'probability 是公开市场报价隐含的 0-1 事件概率，只读、仅供参考，不构成预测或投资建议；不含平台标识与链接。',
  };
}

function quarterMatch(reportDate, quarter) {
  const q = String(quarter || '').trim();
  if (!q) return true;
  const d = String(reportDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return d.startsWith(q);
  const m = /^(\d{4})[Qq]([1-4])$/.exec(q);
  if (m) {
    const month = ['03-31', '06-30', '09-30', '12-31'][Number(m[2]) - 1];
    return d === m[1] + '-' + month;
  }
  return d.includes(q);
}

async function tGetInstitutionHoldings(args) {
  const env = readEnvelope('api/v1/institutions/holdings.json');
  const kind = (asStr(args.kind) || '13f').toLowerCase();
  const institution = asStr(args.institution).toLowerCase();
  const quarter = asStr(args.quarter);
  const limit = asInt(args.limit, 50, 1, 200);
  const data = env.data || {};

  if (kind === 'etf') {
    const etf = data.etf || {};
    let funds = Array.isArray(etf.funds) ? etf.funds : [];
    if (institution) {
      funds = funds.filter((f) => [f.key, f.ticker, f.zh, f.name]
        .some((v) => String(v || '').toLowerCase().includes(institution)));
    }
    funds = funds.map((f) => ({ ...f, holdings: (f.holdings || []).slice(0, limit) }));
    return {
      ok: true,
      meta: metaOf(env),
      kind, count: funds.length,
      etf: { asOf: etf.asOf, published: etf.published, lagDays: etf.lagDays, funds, overlap: etf.overlap },
      note: 'ETF 持仓是发行方公开的全量持仓（规则化因子产品），不是基金经理主观判断。',
    };
  }

  if (kind === 'fund') {
    const fh = data.fundHoldings || {};
    const out = {
      reportDate: fh.reportDate,
      reportDateName: fh.reportDateName,
      lagDays: fh.lagDays,
      fundsReporting: fh.fundsReporting,
      topAdd: (Array.isArray(fh.topAdd) ? fh.topAdd : []).slice(0, limit),
      topTrim: (Array.isArray(fh.topTrim) ? fh.topTrim : []).slice(0, limit),
    };
    return {
      ok: true,
      meta: metaOf(env),
      kind, count: out.topAdd.length + out.topTrim.length,
      fundHoldings: out,
      note: '这是基金合计持仓（含 ETF/指数基金），被动申赎也会体现为加仓/减仓，不能读成主动基金经理的单边判断。',
    };
  }

  let institutions = Array.isArray(data.institutions) ? data.institutions : [];
  if (institution) {
    institutions = institutions.filter((x) => [x.slug, x.name, x.cik]
      .some((v) => String(v || '').toLowerCase().includes(institution)));
  }
  if (quarter) institutions = institutions.filter((x) => quarterMatch(x.reportDate, quarter));
  institutions = institutions.slice(0, 20).map((x) => ({
    ...x,
    holdings: (x.holdings || []).slice(0, limit),
    exits: (x.exits || []).slice(0, limit),
  }));
  return {
    ok: true,
    meta: metaOf(env),
    kind: '13f',
    count: institutions.length,
    filters: { institution: institution || null, quarter: quarter || null },
    institutions,
    note: '13F 为季度披露的美股多头持仓，含看涨/看跌期权；报告期末到提交日有滞后，lagDays 已单列。',
  };
}

function pickPoints(points, from, to, limit) {
  let rows = Array.isArray(points) ? points : [];
  if (from) rows = rows.filter((p) => String(p.date) >= String(from));
  if (to) rows = rows.filter((p) => String(p.date) <= String(to));
  if (limit && rows.length > limit) rows = rows.slice(-limit);
  return rows;
}

async function tGetMacroSeries(args) {
  const env = readEnvelope('api/v1/macro/series.json');
  const id = asStr(args.series_id);
  const country = asStr(args.country).toLowerCase();
  const indicator = asStr(args.indicator).toLowerCase();
  const from = asStr(args.from);
  const to = asStr(args.to);
  const limit = asInt(args.limit, 120, 1, 500);
  let series = Array.isArray(env.data.series) ? env.data.series : [];

  if (id) series = series.filter((s) => String(s.id).toLowerCase() === id.toLowerCase() || String(s.id).toLowerCase().includes(id.toLowerCase()));
  if (country) {
    series = series.filter((s) => [s.country, s.iso, s.name]
      .some((v) => String(v || '').toLowerCase().includes(country)));
  }
  if (indicator) series = series.filter((s) => String(s.indicator || '').toLowerCase() === indicator);

  series = series.slice(0, 50).map((s) => ({
    ...s,
    points: pickPoints(s.points, from, to, limit),
  }));
  return {
    ok: true,
    meta: metaOf(env),
    count: series.length,
    filters: { series_id: id || null, country: country || null, indicator: indicator || null, from: from || null, to: to || null },
    series,
    catalog: env.data.catalog || null,
    note: '世界银行指标为年度数据，最新非空年份为准；FRED 序列因前端不内置访问密钥默认未启用，只给出口径说明。',
  };
}

async function tGetFundProfile(args, ctx) {
  const code = asStr(args.code);
  if (!code) throw new Error('code 不能为空，例如 005827');
  const got = await fetchFundProfile(code, { offline: ctx.offline });
  const p = got.profile || {};
  const netWorth = (p.netWorth || []).slice(-60).map((row) => ({
    date: new Date(row.t).toISOString(),
    value: row.v,
    returnPct: row.r,
  }));
  const asof = netWorth.length ? netWorth[netWorth.length - 1].date : null;
  return {
    ok: true,
    meta: {
      dataset: 'fund.profile',
      asof,
      generatedAt: new Date(got.fetchedAt).toISOString(),
      source: '天天基金公开披露（pingzhongdata / fundmobapi）',
      stale: false,
      license: '公开披露的基金历史数据，仅用于信息展示；不构成投资建议。',
      note: '净值序列只返回最近 60 个点；其它卡片字段缺失表示上游未披露。',
    },
    fund: {
      name: p.name,
      code: p.code,
      rates: { old: p.rateOld, now: p.rateNew, minBuy: p.minBuy },
      returns: p.returns,
      position: p.position,
      rank: p.rank,
      scale: p.scale,
      holders: p.holders,
      allocation: p.alloc,
      performance: p.perfEval,
      managers: p.managers,
      netWorth,
      topStocks: (got.stocks || []).slice(0, 10),
    },
    note: '基金画像来自公开披露，历史业绩不代表未来；本站只展示统计事实，不给出操作建议。',
  };
}

/* ---------------- 工具清单（顺序即 tools/list 返回顺序） ---------------- */

export const TOOLS = [
  {
    name: 'list_datasets',
    description: '列出 OpenFinLens 数据 API 的全部数据集，附各自的更新时间（asof）、是否滞后（stale）与条数。Agent 应先调用它确认有哪些数据可用。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '按数据集 id/标题/路径做关键词过滤，可省略' },
        stale_only: { type: 'boolean', default: false, description: '只列出 stale=true 的滞后数据集' },
      },
      additionalProperties: false,
    },
    handler: tListDatasets,
  },
  {
    name: 'get_manifest',
    description: '读取机器可读清单：每个数据集的 id、路径、字段定义（名称/类型/单位/说明）、样例与数据截止时间。不传 dataset 时返回摘要；传 dataset 时返回该数据集完整定义。',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: '数据集 id，例如 quotes.latest、events.global、prediction.markets；省略则返回全部摘要' },
      },
      additionalProperties: false,
    },
    handler: tGetManifest,
  },
  {
    name: 'get_health',
    description: '链路自检：返回每个数据集最近一次构建时间、条数、耗时与 stale 状态，用于判断 API 是否新鲜、是否降级。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: tGetHealth,
  },
  {
    name: 'search_symbols',
    description: '标的模糊搜索：支持中文名、拼音首字母、标准代码、纯数字代码与常见别名。返回的 symbol 可直接作为 get_quotes / get_klines 的入参。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，例如 贵州茅台 / gzmt / 600519 / AAPL / 比特币' },
        market: { type: 'string', enum: ['cn', 'hk', 'us', 'global', 'crypto', 'fx', 'commodity', 'macro'], description: '限定市场，可省略' },
        limit: { ...CN_NUM, minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: tSearchSymbols,
  },
  {
    name: 'get_quotes',
    description: '获取行情快照。优先实时抓取腾讯/东方财富/币安公开接口（与页面同一套 URL 与解析口径），失败或离线时回退 api/v1 静态快照，并在 via 与 meta.stale 里如实标注。',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: stringArray,
        market: { type: 'string', enum: ['cn', 'hk', 'us', 'global', 'crypto', 'fx', 'commodity', 'macro'], description: '不传 symbols 时按市场返回该市场全部标的，可省略' },
        limit: LIMIT(40, 200),
        live: LIVE,
      },
      additionalProperties: false,
    },
    handler: tGetQuotes,
  },
  {
    name: 'get_klines',
    description: '获取日/周/月 K 线（时间 + 开盘/最高/最低/收盘）。实时抓取失败时回退 api/v1/klines 静态快照；结果只含价格序列。',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '标的，例如 sh600519 / 600519 / 贵州茅台 / AAPL / BTCUSDT' },
        period: { type: 'string', enum: ['day', 'week', 'month'], default: 'day', description: 'K 线周期，默认日线' },
        limit: LIMIT(120, 400),
        live: LIVE,
      },
      required: ['symbol'],
      additionalProperties: false,
    },
    handler: tGetKlines,
  },
  {
    name: 'get_events',
    description: '查询全球事件（来自 data/events/global-events.json）：可按分类、国家、起始时间和关键词过滤，每条含分类、国家、重要性映射出的 0-100 严重度与关联标的。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '分类：central_bank / macro / trade / conflict / geopolitics 等' },
        country: { type: 'string', description: '国家或地区中文名，例如 美国 / 中国 / 欧元区' },
        since: { type: 'string', description: '起始时间，ISO 字符串或毫秒时间戳' },
        keyword: { type: 'string', description: '标题/分类/关联标的中的关键词' },
        limit: LIMIT(50, 200),
      },
      additionalProperties: false,
    },
    handler: tGetEvents,
  },
  {
    name: 'get_prediction_markets',
    description: '查询预测市场概率（事件 + 档位两层）：可按类别、关键词、最低概率过滤。probability 为 0-1 的隐含概率，只读、不构成预测或投资建议。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '事件类别，例如 election / geopolitics / crypto / economy' },
        keyword: { type: 'string', description: '事件标题或档位名称中的关键词' },
        min_percent: { type: 'integer', minimum: 0, maximum: 100, default: 0, description: '只保留存在概率不低于该百分数档位的事件' },
        limit: LIMIT(20, 100),
      },
      additionalProperties: false,
    },
    handler: tGetPredictionMarkets,
  },
  {
    name: 'get_institution_holdings',
    description: '查询机构持仓：kind=13f 返回 SEC 13F 机构季度持仓；kind=etf 返回规则化因子 ETF 全量持仓；kind=fund 返回基金合计持仓的加仓/减仓榜。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['13f', 'etf', 'fund'], default: '13f', description: '持仓口径，默认 13f' },
        institution: { type: 'string', description: '机构名/代号（如 berkshire / 伯克希尔）或 ETF 代码（如 SPMO）' },
        quarter: { type: 'string', description: '报告期，支持 2026-06-30 或 2026Q2' },
        limit: LIMIT(50, 200),
      },
      additionalProperties: false,
    },
    handler: tGetInstitutionHoldings,
  },
  {
    name: 'get_macro_series',
    description: '查询宏观序列（世界银行年度指标，附 FRED 口径目录）：可按 series_id、国家、指标与年份区间过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        series_id: { type: 'string', description: '序列 id，例如 WB:US:gdp、WB:CN:cpi' },
        country: { type: 'string', description: '国家中文名或 ISO2 代码，例如 美国 / US' },
        indicator: { type: 'string', enum: ['gdp', 'growth', 'cpi', 'unemp', 'debt', 'cab'], description: '指标键名' },
        from: { type: 'string', description: '起始年份，例如 2015' },
        to: { type: 'string', description: '结束年份，例如 2025' },
        limit: LIMIT(120, 500),
      },
      additionalProperties: false,
    },
    handler: tGetMacroSeries,
  },
  {
    name: 'get_fund_profile',
    description: '查询公募基金画像（代码入参）：名称、费率、近 1 年/6 月/3 月/1 月收益、净值走势、规模、持有人结构、资产配置、经理与重仓股。数据来自公开披露。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '5~6 位数字基金代码，例如 005827' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    handler: tGetFundProfile,
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

/* ---------------- 调用入口 ---------------- */

export function failureResult(message, code = 'TOOL_ERROR') {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: false, error: { code, message: String(message || '未知错误') } }, null, 2),
    }],
    isError: true,
  };
}

export function successResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export async function callTool(name, args, ctx = {}) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return failureResult('未知工具：' + name + '。可用工具见 tools/list。', 'UNKNOWN_TOOL');
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  try {
    const payload = await def.handler(safeArgs, {
      offline: !!ctx.offline,
      timeoutMs: ctx.timeoutMs || 12000,
    });
    return successResult(payload);
  } catch (e) {
    return failureResult(e && e.message ? e.message : String(e));
  }
}
