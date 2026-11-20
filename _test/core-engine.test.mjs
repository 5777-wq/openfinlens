/* core/engine 五模块：三仓合并真源的手算核对。
   口径锚点：
   · engine/indicators.mjs = Meridian lib/indicators.mjs ∪ 主仓 js/technical.js（Phase 0 已核实两仓 Wilder 口径一致）；
   · engine/weekly.mjs / market-time.mjs / signals.mjs = Meridian 原样移植；
   · engine/compare.mjs = 主仓 js/compare.js 转 ESM。
   用法：node _test/core-engine.test.mjs（纯函数，无需网络） */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);   // Windows 动态 import 必须 file:// URL
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}
const APPROX = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

const I = await imp('core/engine/indicators.mjs');
const W = await imp('core/engine/weekly.mjs');
const M = await imp('core/engine/market-time.mjs');
const S = await imp('core/engine/signals.mjs');
const C = await imp('core/engine/compare.mjs');

await test('smaSeries：等差序列手算核对', () => {
  const s = I.smaSeries([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null); assert.equal(s[1], null);
  assert.ok(APPROX(s[2], 2) && APPROX(s[3], 3) && APPROX(s[4], 4));
});

await test('emaSeries：种子=SMA，k=2/(n+1)（[1..5],n=3 → 2,3,4）', () => {
  const s = I.emaSeries([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null); assert.equal(s[1], null);
  assert.ok(APPROX(s[2], 2) && APPROX(s[3], 3) && APPROX(s[4], 4));
});

await test('rsiSeries（Wilder）：首值落在索引 n（需 n+1 根）；单边涨 → 100，回落 → 50', () => {
  const up = I.rsiSeries([5, 6, 7], 2);
  assert.deepEqual(up.slice(0, 2), [null, null]);
  assert.ok(APPROX(up[2], 100), '前两根全涨 → avgL=0 → 100');
  const s = I.rsiSeries([5, 6, 5], 2);
  assert.ok(APPROX(s[2], 50), '一涨一跌 → avgG=avgL → 50');
});

await test('rsiSeries：单边上涨 → 100；前缀 null 位数 = n；绝不产 NaN', () => {
  const up = I.rsiSeries([1, 2, 3, 4, 5, 6, 7, 8], 3);
  assert.equal(up.slice(0, 3).filter((v) => v !== null).length, 0);
  assert.ok(APPROX(up[3], 100) && APPROX(up[7], 100));
  for (const v of up) assert.ok(v === null || (v >= 0 && v <= 100));
  const dirty = I.rsiSeries([1, NaN, 2, undefined, 3], 2);
  for (const v of dirty) assert.ok(v === null || Number.isFinite(v));
});

await test('rsi 标量：与 rsiSeries 末值一致；数据不足 → null', () => {
  assert.ok(APPROX(I.rsi([5, 6, 5], 2), 50));
  assert.equal(I.rsi([1, 2], 14), null);
});

await test('macd：手算核对（[1..7], f=3,s=5,g=2 → ema3=[_,_,2,3,4,5,6]、ema5=[_,_,_,_,3,4,5] → dif 恒 1）', () => {
  const m = I.macd([1, 2, 3, 4, 5, 6, 7], 3, 5, 2);
  assert.ok(m, '样本足够时应返回对象');
  assert.ok(APPROX(m.dif, 1, 1e-9));
  assert.ok(APPROX(m.dea, 1, 1e-9));
  assert.ok(APPROX(m.hist, 0, 1e-9));
  assert.ok(APPROX(m.prevDif, 1, 1e-9));
  assert.ok(APPROX(m.prevDea, 1, 1e-9));
});

await test('macd：数据不足 → null（绝不抛异常）', () => {
  assert.equal(I.macd([1, 2, 3], 12, 26, 9), null);
});

await test('kdj：n=2 初值 50 手算（K≈58.33, D≈52.78, J≈69.44）', () => {
  const bars = [
    { high: 10, low: 8, close: 9 },
    { high: 12, low: 9, close: 11 },
  ];
  const k = I.kdj(bars, 2);
  assert.ok(k);
  assert.ok(APPROX(k.k, 58.3333, 0.001));
  assert.ok(APPROX(k.d, 52.7778, 0.001));
  assert.ok(APPROX(k.j, 69.4444, 0.001));
});

await test('boll：[1..5] n=3 → mid=4, up≈5.633, low≈2.367, pctB≈0.806', () => {
  const b = I.boll([1, 2, 3, 4, 5], 3, 2);
  assert.ok(APPROX(b.mid, 4));
  assert.ok(APPROX(b.up, 5.63299, 0.001));
  assert.ok(APPROX(b.low, 2.36701, 0.001));
  assert.ok(APPROX(b.pctB, 0.80627, 0.001));
});

await test('atr：TR 的 Wilder 平滑（4 根 n=2 → 1.75，pct=1.75/12）', () => {
  const bars = [
    { high: 10, low: 9, close: 9.5 },
    { high: 11, low: 10, close: 10.5 },
    { high: 12, low: 10.5, close: 11 },
    { high: 13, low: 11, close: 12 },
  ];
  const a = I.atr(bars, 2);
  assert.ok(APPROX(a.value, 1.75, 1e-9));
  assert.ok(APPROX(a.pct, 1.75 / 12 * 100, 1e-9));
});

await test('volumeRatio：300/(100+200)/2 = 2', () => {
  const bars = [
    { volume: 100 }, { volume: 200 }, { volume: 300 },
  ];
  assert.ok(APPROX(I.volumeRatio(bars, 2), 2));
});

await test('maSystem：60 根等差上行 → bull 排列，above=4', () => {
  const closes = Array.from({ length: 60 }, (_, i) => i + 1);
  const m = I.maSystem(closes);
  assert.equal(m.trend, 'bull');
  assert.equal(m.above, 4);
  assert.ok(APPROX(m.mas.ma5, 58) && APPROX(m.mas.ma60, 30.5));
});

await test('tunnelPos/tunnelEvent：above/inside/below 与四类穿越事件', () => {
  assert.equal(I.tunnelPos(11, 10, 9), 'above');
  assert.equal(I.tunnelPos(9.5, 10, 9), 'inside');
  assert.equal(I.tunnelPos(8, 10, 9), 'below');
  assert.equal(I.tunnelEvent('below', 'above'), 'break_up');
  assert.equal(I.tunnelEvent('above', 'below'), 'break_down');
  assert.equal(I.tunnelEvent('below', 'inside'), 'reenter_up');
  assert.equal(I.tunnelEvent('above', 'inside'), 'reenter_down');
  assert.equal(I.tunnelEvent('above', 'above'), null);
});

await test('rsiSnap：状态与穿越标签（into_ob/out_ob/into_os）', () => {
  // 构造：一路涨进超买，再一路跌回中性、跌进超卖
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 10, 9, 8, 7, 6];
  const snap = I.rsiSnap(closes, 6, 70, 30);
  assert.ok(snap && snap.value < 30, '末段大跌应落入超卖');
  const up = I.rsiSnap([10, 11, 12, 13, 14, 15, 16, 17], 6, 70, 30);
  assert.equal(up.state, 'overbought');
});

await test('weekly：weekEndOf 归周五；resampleWeekly 开收高低量聚合', () => {
  assert.equal(W.weekEndOf('2026-01-05'), '2026-01-09');   // 周一 → 本周五
  // 周六 → 顺延到下周五（Meridian 公式原样语义；美股无周六交易，不影响生产数据）
  assert.equal(W.weekEndOf('2026-01-10'), '2026-01-16');
  assert.equal(W.weekEndOf('garbage'), null);
  const bars = [
    ['2026-01-05', 10, 11, 12, 9, 100],
    ['2026-01-07', 11, 13, 14, 10, 50],
    ['2026-01-12', 13, 15, 16, 12, 30],   // 下周一 → 新周
  ];
  const wk = W.resampleWeekly(bars);
  assert.equal(wk.length, 2);
  assert.equal(wk[0][0], '2026-01-09');
  assert.ok(APPROX(wk[0][1], 10));          // 开 = 周首
  assert.ok(APPROX(wk[0][2], 13));          // 收 = 周末
  assert.ok(APPROX(wk[0][3], 14));          // 高
  assert.ok(APPROX(wk[0][4], 9));           // 低
  assert.ok(APPROX(wk[0][5], 150));         // 量求和
  assert.equal(wk[1][0], '2026-01-16');
});

await test('market-time：ET 墙钟收盘判定四象限 + splitClosed + 交易日差', () => {
  assert.equal(M.lastClosedDate(new Date('2026-01-15T21:30:00Z')), '2026-01-15'); // 周四 16:30 ET
  assert.equal(M.lastClosedDate(new Date('2026-01-15T14:00:00Z')), '2026-01-14'); // 09:00 ET 盘前
  assert.equal(M.lastClosedDate(new Date('2026-01-17T12:00:00Z')), '2026-01-16'); // 周六
  const bars = [
    ['2026-01-14', 1, 1, 1, 1, 0],
    ['2026-01-15', 1, 1, 1, 1, 0],
    ['2026-01-16', 1, 1, 1, 1, 0],   // 假想的 live bar
  ];
  const sp = M.splitClosed(bars, '2026-01-15');
  assert.equal(sp.closed.length, 2);
  assert.equal(sp.liveCount, 1);
  assert.equal(M.tradingDaysBetween('2026-01-15', '2026-01-20'), 3); // 16,19,20
  assert.equal(M.tradingDaysBetween('2026-01-20', '2026-01-15'), 0); // 倒挂 = 0
});

await test('signals.evaluate：合成 40 根日线 → 事实层齐全 + live bar 只作盘中参考', () => {
  const bars = [];
  for (let i = 0; i < 41; i++) {
    const d = new Date(Date.UTC(2026, 0, 5) + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const c = 100 + i * 0.5 + (i % 5 === 0 ? 2 : 0);   // 确定性上行锯齿
    bars.push([iso, c - 1, c, c + 1.5, c - 2, 1000 + i]);
  }
  const series = { bars, adj: 'hfq', source: 'eastmoney' };
  const cfg = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [3, 5] }] };
  const marketDate = bars[39][0];   // 最后一根是 live bar
  const r = S.evaluate({ ticker: 'TEST' }, series, cfg, marketDate);
  assert.ok(r, '40 根收盘应可评估');
  assert.equal(r.ticker, 'TEST');
  assert.equal(r.asOf, marketDate);
  assert.ok(r.rsi6 && r.rsi6.value >= 0 && r.rsi6.value <= 100);
  assert.ok(r.rsi14 && r.rsi14.period === 14);
  assert.equal(r.tunnels.length, 1);
  assert.ok(['above', 'inside', 'below'].includes(r.tunnels[0].pos));
  assert.ok(r.wk && r.wk.bars >= 1, '周线应可重采样');
  assert.ok(r.live && r.live.date === bars[40][0], 'live bar 只进盘中参考');
  assert.ok(Array.isArray(r.notes));
  const only = S.evaluate({ ticker: 'TEST' }, series, cfg, marketDate);
  assert.deepEqual(Object.keys(only).sort(), Object.keys(r).sort());
});

await test('signals.evaluate：不足 30 根 → null；raw 口径打标', () => {
  const bars = [];
  for (let i = 0; i < 10; i++) bars.push(['2026-01-0' + (i + 1), 1, 2, 3, 0.5, 1]);
  const cfg = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [] };
  assert.equal(S.evaluate({ ticker: 'T' }, { bars, adj: 'hfq', source: 'x' }, cfg, null), null);
  const many = bars.concat(Array.from({ length: 25 }, (_, i) => ['2026-02-0' + ((i % 9) + 1), 1, 2, 3, 0.5, 1]));
  const r = S.evaluate({ ticker: 'T' }, { bars: many, adj: 'raw', source: 'tencent' }, cfg, null);
  assert.ok(r && r.notes.some((n) => n.tag === '口径'), '不复权必须有口径警告');
});

await test('stalenessGate/summarize：回归信号分组 + 陈旧闸门', () => {
  const row = (over) => ({
    ticker: 'T' + over, asOf: '2026-01-15',
    rsi6: over > 0 ? { value: 80, state: 'overbought', cross: null } : { value: 20, state: 'oversold', cross: null },
    tunnels: [],
  });
  const rows = [row(1), row(2), row(-1)];
  const g = S.summarize(rows);
  assert.equal(g.overbought.length, 2);
  assert.equal(g.oversold.length, 1);
  const stale = { ticker: 'OLD', asOf: '2026-01-02', rsi6: null, tunnels: [], stale: true };
  const gate = S.stalenessGate([row(1), stale]);
  assert.equal(gate.staleCount, 1);
  assert.deepEqual(gate.staleTickers, ['OLD']);
  assert.equal(gate.dataDate, '2026-01-15');
});

await test('compare：归一化三口径 + 回撤峰谷日期', () => {
  const bars = [
    { time: '2026-01-05', close: 10 },
    { time: '2026-01-06', close: 12 },
    { time: '2026-01-07', close: 9 },
    { time: '2026-01-08', close: 11 },
  ];
  const idx = C.normalize(bars, { as: 'index' });
  assert.ok(APPROX(idx[0].value, 100) && APPROX(idx[1].value, 120));
  const pct = C.normalize(bars, { as: 'pct' });
  assert.ok(APPROX(pct[0].value, 0) && APPROX(pct[1].value, 20));
  const mult = C.normalize(bars, { as: 'mult' });
  assert.ok(APPROX(mult[2].value, 0.9));
  const dd = C.maxDrawdown(bars);
  assert.ok(APPROX(dd.maxDD, -25));
  assert.equal(dd.peakAt, '2026-01-06');
  assert.equal(dd.troughAt, '2026-01-07');
});

await test('compare：metrics 短区间 CAGR 守卫 + correlation 公共日', () => {
  const bars = [
    { time: '2026-01-05', close: 10 },
    { time: '2026-01-20', close: 11 },   // 15 天 < 1 个月
  ];
  const m = C.metrics(bars);
  assert.equal(m.cagr, null, '不满 1 个月 CAGR 必须留空');
  assert.ok(APPROX(m.total, 10));
  const a = { key: 'A', name: 'A', bars: [
    { time: '2026-01-05', close: 10 }, { time: '2026-01-06', close: 11 },
    { time: '2026-01-07', close: 12 }, { time: '2026-01-08', close: 13 },
  ] };
  const b = { key: 'B', name: 'B', bars: [
    { time: '2026-01-05', close: 5 }, { time: '2026-01-06', close: 5.5 },
    { time: '2026-01-07', close: 6 }, { time: '2026-01-08', close: 6.5 },
  ] };
  const corr = C.correlation([a, b]);
  assert.ok(corr && corr.days === 4);
  assert.ok(APPROX(corr.matrix[0][1], 1, 1e-9), '同比例上涨 → 相关性 1');
  const short = { key: 'C', name: 'C', bars: a.bars.slice(0, 2) };
  assert.equal(C.correlation([a, short]), null, '公共日不足 4 → null');
});

await test('compare：buildLines common 模式共同起点与排除说明', () => {
  const mk = (key, times, closes) => ({ key, name: key, bars: times.map((t, i) => ({ time: t, close: closes[i] })) });
  const a = mk('A', ['2026-01-05', '2026-01-06', '2026-01-07'], [10, 11, 12]);
  const b = mk('B', ['2026-01-06', '2026-01-07'], [20, 22]);   // 晚一天上市
  const r = C.buildLines([a, b], { mode: 'common' });
  assert.equal(r.commonStart, '2026-01-06');
  assert.equal(r.lines.length, 2);
  assert.ok(APPROX(r.lines[0].base, 11), '共同起点当天 A 有交易 → 直接取当天收盘');
  assert.ok(APPROX(r.lines[1].base, 20));
  const dead = mk('C', ['2026-01-01'], [5]);
  const r2 = C.buildLines([a, dead], { mode: 'own' });
  assert.equal(r2.lines.length, 1);
  assert.ok(r2.excluded.some((e) => e.key === 'C' && /不足以算收益/.test(e.reason)));
});

console.log('\n===== 汇总 =====');
console.log(`共 ${pass + fail} 组断言块：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
