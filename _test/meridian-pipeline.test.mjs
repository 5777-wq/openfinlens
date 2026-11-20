/* meridian-pipeline.test.mjs —— Meridian 管线层：us-signals.json 协议校验、CSV（BOM/固定名）、
 * 原子写出守卫、mock 离线试跑护栏（绝不触碰正式 data/ 产物）、check-fresh 心跳。
 * 取代旧仓 test.mjs 的 report.html/PWA 套件（HTML 报告由终端信号 Tab 替代，不迁）。
 * 用法：node _test/meridian-pipeline.test.mjs（纯离线：monitor 走 OFL_MOCK_HTTP 注入路由） */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')); }
};
const suite = (t) => console.log('\n◆ ' + t);

const { buildUsSignals, validateUsSignals } = await imp('pipelines/meridian/us-schema.mjs');
const { writeOutputs, csvPayload } = await imp('pipelines/meridian/report.mjs');
const { lastClosedDate } = await imp('core/engine/market-time.mjs');

/* ---------- 造数工具：与 monitor 内部形态一致的最小 data ---------- */
const cfgT = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [12, 36] }, { key: '中通道', n: [144, 169] }, { key: '长通道', n: [576, 676] }] };
const mkRow = (ticker, rank, over) => ({
  ticker, name: '测试' + ticker, rank, mcapUsd: 1e12, spmoPct: rank % 3 === 0 ? 5.5 : null,
  asOf: '2026-09-24', close: 100 + rank, chgPct: 1.23,
  rsi6: over ? { value: 82.5, prev: 75.1, state: 'overbought', cross: null, period: 6 } : { value: 42.5, prev: 55.1, state: 'neutral', cross: null, period: 6 },
  rsi14: { value: 63.4, prev: 60.2, state: 'neutral', cross: null, period: 14 },
  tunnels: [
    { key: '短通道', n: [12, 36], upper: 101, lower: 99, pos: 'above', event: null, widthPct: 2 },
    { key: '中通道', n: [144, 169], upper: 102, lower: 98, pos: 'above', event: 'break_up', widthPct: 4 },
    { key: '长通道', n: [576, 676], pos: null, event: null, insufficient: true },
  ],
  live: null, adj: 'hfq', source: 'eastmoney', bars: 2000,
  wk: { asOf: '2026-09-25', bars: 260, rsi6: { value: 55.5, prev: 61.2, state: 'neutral', cross: null, period: 6 }, rsi14: { value: 48.2, prev: 51.0, state: 'neutral', cross: null, period: 14 }, tunnels: [{ key: '短通道', n: [144, 169], pos: 'above', event: null, widthPct: 3 }, { key: '中通道', n: [288, 338], pos: 'inside', event: null }, { key: '长通道', n: [576, 676], pos: null, event: null, insufficient: true }], live: null },
  sp500: ticker !== 'QQQ', ndx: ticker === 'AAA',
  notes: [{ tag: 'RSI6', level: 'warn', text: 'RSI6=82.5 超买（>70）。' }],
  obDays: 3, aboveDays: 7, extPct: 1.8, volRatio: 1.4,
  sigHist: { obr: { n: 12, up: 44.2, avg: -1.15, med: -0.8 }, osr: { n: 0, up: null, avg: null, med: null }, ret: { n: 8, up: 46.5, avg: -0.7, med: -0.4 } },
});
const mkData = (over = true) => ({
  meta: { marketDate: '2026-09-24', dataDate: '2026-09-24', staleCount: 0, staleTickers: [], generatedAt: '2026-09-25T01:00:00.000Z', generatedAtLocal: '2026/9/25 09:00:00', runAtEt: '2026-09-24 20:00 ET', etDate: '2026-09-24', etTime: '20:00', topN: 150, extraNote: ' + SPMO', candidatesAsOf: '2026-09-01', ndxAsOf: '2025-12-19', universeNote: 'x', srcEast: 3, srcYahoo: 0, srcTx: 0, srcFail: 0, eastError: null, yahooError: null, liveCount: 0, watchCount: 1, breadth: { up: 2, down: 1, upPct: 67, rsiMed: 61.5 }, sigStats: { obr: { n: 1240, up: 44.2, avg: -1.15, med: -0.8 }, osr: { n: 210, up: 57.1, avg: 1.9, med: 1.2 }, ret: { n: 890, up: 46.5, avg: -0.7, med: -0.4 }, horizonDays: 5, tickers: 153 } },
  cfg: cfgT,
  spmo: mkRow('SPMO', null, over),
  rows: [mkRow('AAA', 1, over), mkRow('BBB', 2, !over)],
  summary: { overbought: over ? [mkRow('AAA', 1, over)] : [], oversold: over ? [] : [mkRow('BBB', 2, over)], obReturn: [mkRow('BBB', 2)], osReturn: [], events: [mkRow('AAA', 1)] },
  failed: [{ ticker: 'QQQ', name: '池外ETF', reason: '取数失败' }],
  outputs: [],
});

/* ---------- Schema 构建 + 校验 ---------- */
suite('us-schema：buildUsSignals 协议形态 + validateUsSignals 通过');
{
  const j = buildUsSignals(mkData(true));
  const v = validateUsSignals(j);
  ok(v.ok, '合法 data → 校验通过', v.errors);
  ok(j.schemaVersion === 1, 'schemaVersion = 1');
  ok(j.marketClock.marketDate === '2026-09-24' && j.marketClock.isLive === false, 'marketClock 自包含');
  ok(j.summary.counts.ob === 1 && j.summary.counts.events === 1, 'summary.counts 计数');
  ok(j.summary.watch.length === 0 && j.items.length === 2, 'items = 股票行（SPMO 单列 spmo）');
  const a = j.items.find((x) => x.symbol === 'AAA');
  ok(a.daily.rsi6.value === 82.5 && a.daily.revert === false, 'daily.rsi6 透传 + revert 判定');
  ok(a.daily.vegas.length === 3 && a.daily.vegas[1].event === 'break_up' && a.daily.vegas[2].insufficient === true, 'vegas 三通道含 insufficient');
  ok(a.weekly && a.weekly.asOf === '2026-09-25' && a.weekly.revert === false, 'weekly 自包含');
  ok(a.tags.sp500 === true && a.tags.ndx100 === true && a.tags.tvSymbol === 'AAA', 'tags 成员/自选/TradingView 代码');
  ok(a.warnings.length === 1 && a.warnings[0].tag === 'RSI6', 'notes → warnings 转写');
  ok(a.context.obDays === 3 && a.context.sigHist.obr.n === 12, 'context 上下文透传');
  ok(j.spmo && j.spmo.symbol === 'SPMO' && j.spmo.rank === null, 'SPMO 单列（rank=null）');
  ok(j.failed.length === 1 && j.failed[0].reason === '取数失败', 'failed 保留原因');
  ok(!JSON.stringify(j).includes('"k":'), '体积红线：无 K 线数组字段');
}

suite('us-schema：违约拦截（K 线混入 / 超体积 / 坏结构）');
{
  const j = buildUsSignals(mkData(true));
  const bad = JSON.parse(JSON.stringify(j));
  bad.items[0].k = { d: ['2026-09-24'], c: [1] };                       // K 线数组混入
  let v = validateUsSignals(bad);
  ok(!v.ok && v.errors.some((e) => /K 线/.test(e)), 'item 混入 K 线 → 违约', v.errors);
  const big = buildUsSignals(mkData(true));
  big.items = big.items.concat(Array.from({ length: 4000 }, (_, i) => ({ ...big.items[0], symbol: 'X' + i })));
  v = validateUsSignals(big);
  ok(!v.ok && v.errors.some((e) => /体积红线|超/.test(e)), '超 900KB → 违约（体积护栏）', v.sizeBytes);
  const broken = { schemaVersion: 2, generatedAt: 'not-a-date', marketClock: {}, summary: null, items: [{ daily: {} }] };
  v = validateUsSignals(broken);
  ok(!v.ok && v.errors.length >= 4, '坏结构多错齐报（version/时间/marketDate/summary）', v.errors);
}

/* ---------- writeOutputs：固定名 + BOM + 原子 + Schema 闸门 ---------- */
suite('report.writeOutputs：us-signals.json + us-signals-latest.csv 固定名原子写出');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-mer-'));
  const dataW = mkData(true);
  dataW.rows[1].watch = true; dataW.rows[1].note = '池外ETF';   // 自选备注列（沿旧仓用例）
  const files = writeOutputs(dataW, dir, {});
  ok(files.some((f) => f.endsWith('us-signals.json')), 'JSON 固定名 us-signals.json', files);
  ok(files.some((f) => f.endsWith('us-signals-latest.csv')), 'CSV 固定覆盖名（不按日期堆积）', files);
  ok(!files.some((f) => f.endsWith('.html')) && !files.some((f) => f.includes('klines')), 'HTML/klines 不再产出（终端 Tab 替代）');
  const json = JSON.parse(readFileSync(path.join(dir, 'us-signals.json'), 'utf8'));
  ok(json.schemaVersion === 1 && json.items.length === 2, '落盘 JSON 可解析且过协议');
  ok(validateUsSignals(json).ok, '落盘 JSON 复检通过');
  const csv = readFileSync(path.join(dir, 'us-signals-latest.csv'), 'utf8');
  ok(csv.charCodeAt(0) === 0xFEFF, 'CSV 带 UTF-8 BOM（Excel 直开）');
  ok(csv.includes('自选备注') && csv.includes('周RSI6') && csv.includes('SPMO持仓%'), 'CSV 表头列在场');
  ok(/BBB,[^]*池外ETF/.test(csv), 'CSV 行带自选备注');
  ok(readdirSync(dir).every((f) => !f.endsWith('.tmp')), '落盘原子：无 .tmp 残留');
  // 空报告守卫
  let threw = null;
  try { writeOutputs({ ...mkData(true), spmo: null, rows: [] }, dir, {}); } catch (e) { threw = e; }
  ok(threw && /拒绝写出/.test(threw.message), '空报告 → writeOutputs 抛错');
  // Schema 闸门：违约的 data 拒绝写出（现实场景：生成时间戳坏掉——闸门对程序员错误兜底）
  const badData = mkData(true);
  badData.meta.generatedAt = 'not-a-date';
  threw = null;
  try { writeOutputs(badData, dir, {}); } catch (e) { threw = e; }
  ok(threw && /Schema 校验失败/.test(threw.message), '坏 generatedAt → Schema 闸门拒绝写出');
}

/* ---------- monitor 离线 mock 端到端（OFL_MOCK_HTTP + --limit 5） ---------- */
suite('monitor.mjs 离线 mock 端到端：--limit 5 产出合法 us-signals.json + BOM CSV，绝不触碰 data/');
{
  // 动态造 K 线：60 个工作日、末日 = 最近已收盘交易日（保证不触发陈旧闸门）
  const md = lastClosedDate();
  const days = [];
  for (let t = Date.parse(md + 'T00:00:00Z'); days.length < 60; t -= 86400000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) days.push(new Date(t).toISOString().slice(0, 10));
  }
  days.reverse();
  const eastKlines = (base) => JSON.stringify({
    data: { name: 'MockStock', klines: days.map((d, i) => d + ',' + (base + i) + ',' + (base + i + 1) + ',' + (base + i + 2) + ',' + (base + i - 1) + ',1000') },
  });
  // 报价：只给 6 只市值（SPMO + 5 只），rankUniverse 的 top5 就确定了
  const txQuote = (ticker, name, price, prev, code, mcapYi) => {
    const f = new Array(50).fill('');
    f[1] = name; f[2] = code; f[3] = String(price); f[4] = String(prev); f[45] = String(mcapYi);
    return 'v_us' + ticker + '="' + f.join('~') + '";';
  };
  const quotes = [
    txQuote('AAPL', '苹果', 200, 198, 'AAPL.OQ', 30000),
    txQuote('MSFT', '微软', 400, 402, 'MSFT.OQ', 28000),
    txQuote('NVDA', '英伟达', 150, 147, 'NVDA.OQ', 22000),
    txQuote('AMZN', '亚马逊', 180, 182, 'AMZN.OQ', 20000),
    txQuote('META', 'Meta', 500, 495, 'META.OQ', 15000),
    txQuote('SPMO', '标普500动量ETF', 50, 49.5, 'SPMO.AM', 200),
  ].join('');
  const routes = [
    ['https://push2his.eastmoney.com', eastKlines(100)],
    ['https://push2delay.eastmoney.com', eastKlines(100)],
    ['https://qt.gtimg.cn/', quotes],
  ];
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'ofl-mer-fx-'));
  const fixturePath = path.join(fixtureDir, 'routes.json');
  writeFileSync(fixturePath, JSON.stringify(routes));
  // 最小配置：空自选清单（真实 config.json 自带 NVDA/ASML/QQQ 会引入池外补拉，干扰条数断言）
  const cfgPath = path.join(fixtureDir, 'test-config.json');
  writeFileSync(cfgPath, JSON.stringify({ universe: { topN: 150, candidatesFile: 'core/registry/sp500-candidates.json' }, watchlist: { tickers: [] } }));

  const dataBefore = existsSync(path.join(ROOT, 'data', 'us-signals.json'))
    ? readFileSync(path.join(ROOT, 'data', 'us-signals.json'), 'utf8') : null;
  const outDir = mkdtempSync(path.join(tmpdir(), 'ofl-mer-out-'));
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'ofl-mer-cache-'));
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'pipelines', 'meridian', 'monitor.mjs'),
    '--limit', '5', '--out', outDir, '--cache-dir', cacheDir,
    '--config', cfgPath, '--quiet',
  ], {
    encoding: 'utf8',
    env: { ...process.env, OFL_MOCK_HTTP: fixturePath },
    timeout: 120000,
  });
  ok(r.status === 0, 'mock + --limit 5 → 退出 0', (r.stderr || '').slice(-300));
  ok(/离线 mock 模式/.test(r.stderr || ''), 'mock 模式显眼日志在场');
  const sigPath = path.join(outDir, 'us-signals.json');
  ok(existsSync(sigPath), '产物 us-signals.json 落在 --out（试跑不触碰 data/）');
  const sig = JSON.parse(readFileSync(sigPath, 'utf8'));
  const v = validateUsSignals(sig);
  ok(v.ok, 'mock 产物过 Schema 校验（含体积红线）', v.errors);
  ok(sig.meta.mock === true, 'meta.mock=true（假数据标识随产物走）');
  ok(sig.items.length === 5 && sig.spmo && sig.spmo.symbol === 'SPMO', 'SPMO + 前 5 只', sig.items.map((x) => x.symbol));
  ok(sig.items[0].symbol === 'AAPL' && sig.items[0].rank === 1, '按 mock 市值排序 AAPL 第一', sig.items.map((x) => x.symbol));
  const csvPath = path.join(outDir, 'us-signals-latest.csv');
  ok(existsSync(csvPath) && readFileSync(csvPath, 'utf8').charCodeAt(0) === 0xFEFF, 'CSV 落盘且带 BOM');
  const dataAfter = existsSync(path.join(ROOT, 'data', 'us-signals.json'))
    ? readFileSync(path.join(ROOT, 'data', 'us-signals.json'), 'utf8') : null;
  ok(dataBefore === dataAfter, '正式 data/us-signals.json 分毫未动（试跑护栏）');
  ok(!existsSync(path.join(ROOT, 'data', 'us-signals-latest.csv')) || dataBefore !== null, '正式 CSV 未被 mock 创建');
}

/* ---------- check-fresh 心跳 ---------- */
suite('tools/check-fresh：陈旧报告非 0 退出，新鲜报告放行');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-mer-fresh-'));
  const tool = path.join(ROOT, 'pipelines', 'meridian', 'tools', 'check-fresh.mjs');
  const fresh = path.join(dir, 'us-signals.json');
  writeFileSync(fresh, JSON.stringify({ marketClock: { marketDate: lastClosedDate() } }));
  const r1 = spawnSync(process.execPath, [tool, fresh], { encoding: 'utf8' });
  ok(r1.status === 0, '报告日 == 最近收盘日 → 放行', (r1.stdout + r1.stderr).trim());
  const staleF = path.join(dir, 'us-stale.json');
  writeFileSync(staleF, JSON.stringify({ marketClock: { marketDate: '2026-01-13' } }));
  const r2 = spawnSync(process.execPath, [tool, staleF], { encoding: 'utf8' });
  ok(r2.status === 1 && /落后/.test(r2.stderr), '报告停在 2026-01-13 → 非 0 退出且报「落后」', { status: r2.status, err: (r2.stderr || '').slice(0, 80) });
  const r3 = spawnSync(process.execPath, [tool, path.join(dir, 'nope.json')], { encoding: 'utf8' });
  ok(r3.status === 1 && /缺失/.test(r3.stderr), 'us-signals.json 缺失 → 非 0 退出');
}

console.log(`\n${'═'.repeat(50)}\n通过 ${pass} · 失败 ${fail}${fail ? '  ✗✗✗' : '  ✓✓✓'}`);
process.exit(fail ? 1 : 0);
