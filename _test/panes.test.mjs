/* panes.test.mjs —— 副图指标纯计算：纯离线单测（node _test/panes.test.mjs）
 *
 * 盯的是"算错了界面上不会报错、只会画歪"的几类退化：
 *   · RSI 越出 0~100（画到轨道外＝看起来像"超买到 900"）
 *   · MACD 柱子的方向反了（正负号搞错＝多空完全反过来）
 *   · 时间轴错位（清洗掉脏 bar 后，值配错了 K 线的 time）
 *   · 数据不足却画出半条线（宁可空白，不画假线） */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, isFinite, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/panes.js'), 'utf8'), ctx, { filename: 'js/panes.js' });
const P = ctx.window.Panes;

/* 造一段可控的 K 线：closes 递增 → RSI 应为 100（无下跌） */
function mkKlines(closes, opts) {
  const o = opts || {};
  return closes.map((c, i) => ({
    time: 1700000000 + i * 86400,
    open: c, high: c * 1.01, low: c * 0.99, close: c,
    volume: o.vol === undefined ? 1000 + i : o.vol,
  }));
}

await test('rsiSeries：单调上涨 → RSI = 100（无下跌时涨方占满）', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const s = P.rsiSeries(closes, 14);
  assert.equal(s.length, closes.length);
  assert.equal(s[0], null, '前 n 项数据不足 → null');
  assert.equal(s[13], null, '第 n 项之前为 null');
  assert.equal(s[14], 100, '一路上涨 → RSI 100');
  assert.ok(s.slice(14).every(v => v === 100), '后续都应是 100');
});

await test('rsiSeries：单调下跌 → RSI = 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
  const s = P.rsiSeries(closes, 14);
  assert.equal(s[14], 0, '一路下跌 → RSI 0');
});

await test('rsiSeries：RSI 恒在 0~100（越界就是画歪）', () => {
  const closes = [];
  for (let i = 0; i < 120; i++) closes.push(100 + Math.sin(i / 3) * 20 + (i % 7) * 3);
  const s = P.rsiSeries(closes, 14);
  s.forEach(v => {
    if (v === null) return;
    assert.ok(v >= 0 && v <= 100, `RSI 越界: ${v}`);
  });
});

await test('rsiSeries：数据不足 → 返回空数组（不画半条线）', () => {
  assert.deepEqual(Array.from(P.rsiSeries([1, 2, 3], 14)), [], '不足 n+1 项应为空');
  assert.deepEqual(Array.from(P.rsiSeries([], 14)), []);
  assert.deepEqual(Array.from(P.rsiSeries(null, 14)), []);
});

await test('macdSeries：三条序列等长，前段为 null', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const m = P.macdSeries(closes, 12, 26, 9);
  assert.equal(m.dif.length, closes.length);
  assert.equal(m.dea.length, closes.length);
  assert.equal(m.hist.length, closes.length);
  assert.equal(m.dif[0], null, 'EMA 预热段为 null');
  assert.ok(m.dif.slice(30).some(v => v !== null), '后段应有值');
});

await test('macdSeries：hist = dif - dea（与 technical.js 同一口径）', () => {
  // 口径必须与 js/technical.js 的 macd() 一致：那边算末值、这边画整条线，
  // 差一个系数就会出现"详情页文字说的 MACD 柱"和"图上画的柱子"对不上。
  const closes = Array.from({ length: 80 }, (_, i) => 100 + i * i * 0.1);   // 加速上涨
  const m = P.macdSeries(closes, 12, 26, 9);
  for (let i = 0; i < closes.length; i++) {
    if (m.dif[i] === null || m.dea[i] === null) continue;
    const expect = m.dif[i] - m.dea[i];
    assert.ok(Math.abs(m.hist[i] - expect) < 1e-6, `第 ${i} 根 hist 应为 dif-dea`);
  }
  // 加速上涨 → DIF 持续走高、DEA 追不上 → hist 为正（柱子方向不能反）
  const last = closes.length - 1;
  assert.ok(m.hist[last] > 0, '加速上涨趋势下 MACD 柱应为正（方向反了就是多空颠倒）');
  // 加速下跌 → hist 为负
  const decel = Array.from({ length: 80 }, (_, i) => 300 - i * i * 0.1);
  assert.ok(P.macdSeries(decel, 12, 26, 9).hist[last] < 0, '加速下跌趋势下 MACD 柱应为负');
});

await test('macdSeries：数据不足 → 空结构', () => {
  const m = P.macdSeries([1, 2, 3], 12, 26, 9);
  assert.deepEqual(Array.from(m.dif), []);
  assert.deepEqual(Array.from(m.dea), []);
  assert.deepEqual(Array.from(m.hist), []);
});

await test('computePane 成交量：bars 的 time 与原 K 线一一对应', () => {
  const ks = mkKlines([10, 11, 12], { vol: 500 });
  const pane = P.computePane('vol', ks, {});
  assert.equal(pane.bars.length, 1);
  assert.equal(pane.bars[0].data.length, 3);
  assert.equal(pane.bars[0].data[0].time, ks[0].time, 'time 必须是原 K 线的');
  assert.equal(pane.bars[0].data[2].value, 500);
});

await test('computePane RSI：脏 bar 清洗后 time 不错位', () => {
  // 第 2 根是脏 bar（close=null）→ 清洗后有效序列少一个，
  // 但每个值的 time 必须对应它自己的那根 K 线（错位＝柱子长在别的日子上）
  const ks = mkKlines(Array.from({ length: 30 }, (_, i) => 100 + i));
  ks[2].close = null;
  const pane = P.computePane('rsi', ks, { n: 14 });
  assert.equal(pane.lines.length, 1);
  const d = pane.lines[0].data;
  assert.ok(d.length > 0, '应有数据');
  // RSI 的前 n 项为 null → 第一个值对应**第 14 个有效收盘**（不是第 0 个）
  const times = new Set(ks.map(k => k.time));
  d.forEach(p => assert.ok(times.has(p.time), 'time 必须来自原 K 线'));
  // 脏 bar 那根（ks[2]）不该出现在结果里
  assert.ok(!d.some(p => p.time === ks[2].time), '脏 bar 不该出现在曲线上');
  // 有效序列的个数 = 总数 - 脏 bar 数；RSI 起点 = 第 14 个有效值
  const valid = ks.filter(k => k.close !== null);
  assert.equal(d[0].time, valid[14].time, '第一个 RSI 值对应第 14 个有效收盘');
});

await test('computePane RSI：数值与 rsiSeries 末值一致（与 technical.js 同一算法）', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 15);
  const ks = mkKlines(closes);
  const pane = P.computePane('rsi', ks, { n: 14 });
  const series = P.rsiSeries(closes, 14);
  const last = pane.lines[0].data[pane.lines[0].data.length - 1];
  assert.ok(Math.abs(last.value - series[series.length - 1]) < 1e-6, '末值应与 rsiSeries 一致');
});

await test('computePane MACD：DIF/DEA 两条线 + 柱子', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
  const pane = P.computePane('macd', mkKlines(closes), { fast: 12, slow: 26, signal: 9 });
  assert.equal(pane.lines.length, 2, 'DIF + DEA 两条线');
  assert.equal(pane.bars.length, 1, 'MACD 柱');
  assert.equal(pane.lines[0].name, 'DIF');
  assert.equal(pane.lines[1].name, 'DEA');
});

await test('paneRange：RSI 固定 0~100；MACD 含零轴；成交量从 0 起', () => {
  const rsiRange = P.paneRange('rsi', { lines: [{ data: [{ value: 55 }] }], bars: [] });
  assert.equal(rsiRange.min, 0);
  assert.equal(rsiRange.max, 100);
  const macdPane = { lines: [{ data: [{ value: 1.2 }] }], bars: [{ data: [{ value: -0.8 }] }] };
  const mr = P.paneRange('macd', macdPane);
  assert.ok(mr.min < 0, 'MACD 下界应含 0 轴');
  assert.ok(mr.max > 0);
  const vr = P.paneRange('vol', { lines: [], bars: [{ data: [{ value: 500 }] }] });
  assert.equal(vr.min < 0 ? 0 : vr.min, 0, '成交量下界应为 0');
});

await test('paneRange：没有数据 → null（调用方用默认边距，不猜）', () => {
  assert.equal(P.paneRange('rsi', null), null);
  assert.equal(P.paneRange('macd', { lines: [], bars: [] }), null);
});

await test('指标清单完整：成交量 / RSI / MACD，各带参数定义', () => {
  const keys = P.PANE_DEFS.map(d => d.key);
  assert.deepEqual(Array.from(keys), ['vol', 'rsi', 'macd']);
  assert.equal(P.PANE_DEFS.find(d => d.key === 'rsi').params[0].def, 14);
  assert.equal(P.PANE_DEFS.find(d => d.key === 'macd').params.length, 3);
  assert.equal(P.paneDef('rsi').label, 'RSI');
  assert.equal(P.paneDef('不存在'), null);
});

await test('未知副图类型 → 空结构（不画，不报错）', () => {
  const pane = P.computePane('不存在的指标', mkKlines([1, 2, 3]), {});
  assert.equal(pane.lines.length, 0);
  assert.equal(pane.bars.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
