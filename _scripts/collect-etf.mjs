#!/usr/bin/env node
/* collect-etf.mjs —— 美股 因子 ETF 持仓采集（Invesco 官网持仓接口，免密钥）
   产物 data/actors/etf.json（随仓库提交，前端只读这份静态 JSON）。

   为什么是这个口径：美股没有"某只主动基金持有什么"的免费实时源，13F 是季度、滞后一个多月；
   但**规则化的因子 ETF 是每日公布全量持仓**的，而且它本身就是一个有信息量的答案——
   动量 ETF 现在持有什么，等于"趋势资金集中在哪"；低波 ETF 持有什么，等于"防御资金在哪"。
   两只都拿，还能算出**交集**（同时被动量与低波选中 = 兼具趋势与防御）。

   口径陷阱（实测，必须过滤，否则界面会混进假"持仓"行）：
   · 官方 feed 里 holdings 混着非股票行：AGPXX（货币基金）、USD/USDPDV/CURRCOL（现金）、
     UCURR「Uninvestible Cash」、IFUT（指数期货）、SYN「Synthetic Cash」（**负值**，与 IFUT 对冲）。
     这些行没有 ticker（或被当成代码），USDPDV 的 pct 甚至是 null —— 只保留 COM（普通股）与
     REIT（不动产信托，是上市股权），其余全部丢弃。不做这一步，表格里会出现 "USD 0.00%"。
   · 代码里的斜杠要转成点：腾讯美股代码用 BRK.B，Invesco 给的是 BRK/B，
     原样拼 `usBRK/B` 腾讯返回 pv_none_match（实测），所以 sym 在采集层就归一化好。

   取数：GET shareclasses/{cusip}/holdings/fund?idType=cusip&productType=ETF（请求头见 HEADERS 注释）。
   CUSIP 无法按 ticker 反查（idType=ticker 实测 500），
   所以基金清单在下面硬编码——这是配置不是逻辑，新增基金改这张表即可。
   中文名来自腾讯批量行情（一次可查上百个 symbol），只取名称：持仓是静态披露，
   配实时价格会在两次采集之间变成过期数据，宁可不显示。
   原则：宁缺毋假——任一只基金取不到就不写文件、保留旧产物。 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'actors', 'etf.json');
const API = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
/* 406 之谜（实测结论：**是软限流，不是请求头问题**）：这套 CDN 对密集请求返回 406（空 body、
   无 Retry-After、无 429），冷却后自愈——实测连续探测把它打限流后，curl / node / http1.1 三种
   客户端**同一秒都是 406**，静置 100s 后单次请求又是 200。先怀疑过 Accept、Origin、UA、
   Accept-Language，逐个加头看似有效其实是巧合（同一分钟里时好时坏），所以对策是
   **稀疏请求 + 长退避重试 + 拿不到就不写文件**，而不是伪造浏览器头。 */
const HEADERS = { 'User-Agent': UA, Accept: 'application/json' };
// 只要规则化、持仓可解释的宽基因子 ETF：动量 / 低波。主题类 ETF 的 CUSIP 无法反查（见头注），
// 想扩表就补一条 CUSIP 并实测（拿到的是 `[ ]` 说明该 CUSIP 不在缓存路径上）。
const FUNDS = [
  { key: 'spmo', ticker: 'SPMO', cusip: '46138E339', zh: '标普500动量', name: 'Invesco S&P 500 Momentum ETF', indexName: 'S&P 500 Momentum' },
  { key: 'splv', ticker: 'SPLV', cusip: '46138E354', zh: '标普500低波', name: 'Invesco S&P 500 Low Volatility ETF', indexName: 'S&P 500 Low Volatility' },
];
const KEEP_TYPES = new Set(['COM', 'REIT']);   // 普通股 / 不动产信托（上市股权）；其余是现金类，丢弃
const SHOW = 40;                               // 单只基金展示条数上限
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
// 本机当天（本地日历）的 UTC 三元组，给日期差用
const todayUTC = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth(), d.getDate()];
};

// 406（软限流，实测冷却约 100s 自愈）与 429/5xx 都长退避重试：正常一次采集只有 2 个请求，
// 走到这里说明已经撞上限流，等够时间比换头有用
const RETRY_WAITS = [15000, 45000, 90000, 120000];

/* --offline <dir>：从 dir/<cusip>.json 读**原始响应**再生产物（本地开发/回填用）。
   背景：该接口对密集请求回 406（见上），本地反复重试不可靠；CI 永远走网络路径。
   缓存文件就是 GET 拿到的原始 JSON，字段与线上一致，产物可复现。 */
const offlineDir = (() => {
  const i = process.argv.indexOf('--offline');
  return (i > -1 && process.argv[i + 1]) ? path.resolve(process.argv[i + 1]) : null;
})();

async function getJson(url, attempt = 0) {
  if (offlineDir) {
    const cusip = String(url.match(/shareclasses\/([^/]+)\//)[1]);
    console.log(`  （offline：读 ${cusip}.json）`);
    return JSON.parse(readFileSync(path.join(offlineDir, cusip + '.json'), 'utf8'));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: HEADERS });
    if ((res.status === 406 || res.status === 429 || res.status >= 500) && attempt < RETRY_WAITS.length) {
      const wait = RETRY_WAITS[attempt];
      console.log(`  HTTP ${res.status}，${wait / 1000}s 后重试（第 ${attempt + 1}/${RETRY_WAITS.length} 次）…`);
      await sleep(wait);
      return getJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// BRK/B → usBRK.B（腾讯美股代码用点，斜杠形式实测返回 pv_none_match）
const symOf = (ticker) => 'us' + String(ticker).replace(/\//g, '.');

/* 腾讯批量行情只用来补中文名：一次请求上百个 symbol，取 v_xxx 行的 [1] 字段（名称）。
   GBK 接口，Node 的 fetch 不自带解码，用 TextDecoder('gbk')。 */
async function zhNames(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 60) {
    const chunk = symbols.slice(i, i + 60);
    try {
      const res = await fetch('https://qt.gtimg.cn/q=' + chunk.join(','), {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
      });
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buf);
      for (const m of text.matchAll(/v_([A-Za-z0-9._]+)="([^"]*)"/g)) {
        const name = (m[2].split('~')[1] || '').trim();
        // m[1] 已经是带 us 前缀的完整 symbol（v_usMU=），不要再拼一次
        if (name) out[m[1]] = name;
      }
    } catch { /* 名称是锦上添花，拿不到就退回英文名，不影响主数据 */ }
    if (i + 60 < symbols.length) await sleep(300);
  }
  return out;
}

function equityRows(fund, payload) {
  const raw = Array.isArray(payload) ? [] : payload.holdings;
  if (!Array.isArray(raw)) throw new Error(fund.ticker + ' holdings 不是数组');
  const rows = raw.filter(h => h
    && KEEP_TYPES.has(String(h.securityTypeCode || ''))
    && h.ticker && /^[A-Z0-9./\-]{1,8}$/i.test(String(h.ticker))
    && typeof h.percentageOfTotalNetAssets === 'number'
    && h.percentageOfTotalNetAssets > 0);
  if (!rows.length) throw new Error(fund.ticker + ' 过滤后没有股票行——feed 结构可能变了');
  const dropped = raw.length - rows.length;
  return {
    rows: rows.map(h => ({
      ticker: String(h.ticker),
      sym: symOf(h.ticker),
      cusip: String(h.cusip || ''),
      type: String(h.securityTypeCode),
      pct: num(h.percentageOfTotalNetAssets),
      valueUsd: num(h.marketValueBase),
      units: num(h.units),
    })).sort((a, b) => b.pct - a.pct),
    dropped,
  };
}

async function main() {
  const funds = [];
  for (const f of FUNDS) {
    console.log(`拉取 ${f.ticker}（${f.cusip}）…`);
    const payload = await getJson(`${API}/${f.cusip}/holdings/fund?idType=cusip&productType=ETF`);
    const { rows, dropped } = equityRows(f, payload);
    const shown = rows.slice(0, SHOW);
    const shownPct = shown.reduce((s, x) => s + x.pct, 0);
    console.log(`  ${payload.effectiveDate} 基准 ${payload.effectiveBusinessDate}：`
      + `官方 ${payload.totalNumberOfHoldings} 行 → 股票 ${rows.length} 行（丢弃非股票 ${dropped} 行）`
      + ` · Top${shown.length} 占净值 ${shownPct.toFixed(1)}% · 首行 ${shown[0].ticker} ${shown[0].pct.toFixed(2)}%`);
    funds.push({ fund: f, payload, rows, shown, shownPct });
    await sleep(4000);   // 两只基金之间留间隔：密集请求会撞上 406 软限流（见 HEADERS 注释）
  }

  // 交集按**全量**股票池算（不能被展示截断影响），持仓数取交集后通常只有二三十只，全部保留
  const [a, b] = funds;
  const bByTicker = new Map(b.rows.map(r => [r.ticker, r]));
  const overlap = a.rows
    .filter(r => bByTicker.has(r.ticker))
    .map(r => {
      const other = bByTicker.get(r.ticker);
      return { ticker: r.ticker, sym: r.sym, cusip: r.cusip, type: r.type, pcts: { [a.fund.key]: r.pct, [b.fund.key]: other.pct } };
    })
    .sort((x, y) => (y.pcts[a.fund.key] + y.pcts[b.fund.key]) - (x.pcts[a.fund.key] + x.pcts[b.fund.key]));
  console.log(`交集（${a.fund.ticker} ∩ ${b.fund.ticker}）：${overlap.length} 只`);

  const syms = [...new Set([
    ...funds.flatMap(f => f.shown.map(r => r.sym)),
    ...overlap.map(r => r.sym),
  ])];
  const zh = await zhNames(syms);
  const named = syms.filter(s => zh[s]).length;
  console.log(`中文名：${named}/${syms.length} 个 symbol 命中腾讯`);
  const withZh = (r) => Object.assign({ zh: zh[r.sym] || '' }, r);

  const asOf = String(a.payload.effectiveBusinessDate || a.payload.effectiveDate || '');
  // 用**日历天**而不是毫秒差：毫秒差会被机器时钟的时区/偏移放大一天（实测本机比北京时间快 12h，
  // 同一份数据显示"5 天"而实际是 4 天）。持仓是日更的，这里只是如实标注新鲜度。
  const lagDays = asOf ? Math.round((Date.UTC(...todayUTC()) - Date.parse(asOf + 'T00:00:00Z')) / 86400000) : null;

  const payloadOut = {
    generatedAt: new Date().toISOString(),
    source: 'Invesco 官网持仓接口（日更，免密钥）',
    confidence: 'REPORTED',
    asOf,
    published: String(a.payload.effectiveDate || ''),
    lagDays,
    note: '规则化因子 ETF 的**每日全量持仓**（官方发布，非申赎推算）：动量 ETF 的持仓回答'
      + '"趋势资金集中在哪"，低波 ETF 回答"防御资金在哪"，交集是同时被两类因子选中的股票。'
      + '这是编制规则定期调整（动量/低波指数半年或季度调仓）后的被动持仓，'
      + '**不是某位基金经理的主观判断**，也不代表机构观点。持仓基准日到官网发布日有一到两天延迟。'
      + '已剔除官方 feed 里的现金/货币基金/指数期货等非股票行。全部为历史事实陈述，不构成任何建议。',
    funds: funds.map(f => ({
      key: f.fund.key,
      ticker: f.fund.ticker,
      zh: f.fund.zh,
      name: f.fund.name,
      indexName: f.fund.indexName,
      cusip: f.fund.cusip,
      effectiveDate: String(f.payload.effectiveDate || ''),
      total: num(f.payload.totalNumberOfHoldings),
      equityCount: f.rows.length,
      shownCount: f.shown.length,
      shownPct: +f.shownPct.toFixed(2),
      holdings: f.shown.map(withZh),
    })),
    overlap: {
      keys: [a.fund.key, b.fund.key],
      labels: { [a.fund.key]: a.fund.zh, [b.fund.key]: b.fund.zh },
      rows: overlap.map(withZh),
    },
  };

  const body = JSON.stringify(payloadOut, null, 1);
  if (body.length > 2 * 1024 * 1024) {
    console.error('产物体积异常（' + body.length + 'B），拒绝写入');
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body + '\n') { console.log('内容无变化，不写文件'); return; }
  writeFileSync(OUT, body + '\n');
  console.log(`写入 ${OUT}：基准 ${asOf}（距今天 ${lagDays} 天）· `
    + funds.map(f => `${f.fund.ticker} ${f.shown.length} 条`).join(' / ') + ` · 交集 ${overlap.length} 条`);
}

main().catch(e => { console.error(e); process.exit(1); });
