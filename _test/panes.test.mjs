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

await test('指标清单完整：八键有序互不重复、range 标注与参数定义齐全', () => {
  const keys = P.PANE_DEFS.map(d => d.key);
  assert.deepEqual(Array.from(keys), ['vol', 'rsi', 'macd', 'vwap', 'atr', 'stochrsi', 'cci', 'dmi']);
  assert.equal(new Set(Array.from(keys)).size, 8, '键互不重复');
  P.PANE_DEFS.forEach((d) => {
    assert.ok(d.label, d.key + ' label 非空');
    assert.ok(d.range === undefined || d.range === 'pct' || d.range === 'free', d.key + ' range 档位不认识');
    (d.params || []).forEach((p) => {
      assert.ok(p.key && p.label && isFinite(p.def) && isFinite(p.min) && isFinite(p.max), d.key + '.' + p.key + ' 参数定义不全');
      assert.ok(p.min <= p.def && p.def <= p.max, d.key + '.' + p.key + ' def 应落在 min~max 内');
    });
  });
  assert.equal(P.PANE_DEFS.find(d => d.key === 'rsi').range, 'pct', 'rsi 标注 pct');
  assert.equal(P.PANE_DEFS.find(d => d.key === 'vwap').range, 'free', 'vwap 标注 free');
  ['vwap', 'atr', 'stochrsi', 'cci', 'dmi'].forEach(k => assert.ok(P.paneDef(k), '新键 ' + k + ' 可达'));
  assert.equal(P.paneDef('不存在'), null);
  assert.equal(P.paneDef('obv'), null, 'OBV 未入选（量纲待红线裁决）');
});

await test('未知副图类型 → 空结构（不画，不报错）', () => {
  const pane = P.computePane('不存在的指标', mkKlines([1, 2, 3]), {});
  assert.equal(pane.lines.length, 0);
  assert.equal(pane.bars.length, 0);
});


/* ---------- 指标扩充五件：VWAP / ATR / StochRSI / CCI / DMI·ADX ---------- */

/* 分钟 K 夹具：time 是 Date.UTC 伪 UTC 秒（与东财 getMinuteKline 同法，UTC 日期即交易所墙钟日），
   h=l=c=px（doji），v 为量 */
function mkMinute(base, i, px, vol) {
  return { time: base + i * 60, open: px, high: px, low: px, close: px, volume: vol };
}
const DAY1 = Date.UTC(2026, 0, 5, 9, 30) / 1000;
const DAY2 = Date.UTC(2026, 0, 6, 9, 30) / 1000;

await test('vwapSeries：恒定 h/l/c/v 单日 → VWAP 恒等于 tp=(h+l+c)/3', () => {
  const ks = Array.from({ length: 20 }, (_, i) => mkMinute(DAY1, i, 100, 500));
  const s = P.vwapSeries(ks);
  assert.equal(s.length, ks.length, '与输入等长');
  s.forEach((v, i) => assert.ok(Math.abs(v - 100) < 1e-9, '第 ' + i + ' 点应恒为 tp=100'));
});

await test('vwapSeries：跨日重置（Session 锚）——第二日首根=该根 tp、旧累计不带入', () => {
  const ks = [10, 11, 12, 13].map((px, i) => mkMinute(DAY1, i, px, 1000))
    .concat([mkMinute(DAY2, 0, 20, 1000)]);
  const s = P.vwapSeries(ks);
  assert.ok(Math.abs(s[0] - 10) < 1e-9, '首根=首根 tp');
  assert.ok(Math.abs(s[3] - 11.5) < 1e-9, '日界前=(10+11+12+13)/4=11.5');
  assert.ok(Math.abs(s[4] - 20) < 1e-9, '第二日首根应=该根 tp=20（旧累计不带入）');
  assert.ok(Math.abs(s[3] - s[4]) > 1, '日界前后值不同（重置发生）');
});

await test('vwapSeries：脏输入——非数组全空、无量/脏 bar 该点 null 且不进累计', () => {
  assert.deepEqual(Array.from(P.vwapSeries(null)), []);
  assert.deepEqual(Array.from(P.vwapSeries('no')), []);
  const s = P.vwapSeries([mkMinute(DAY1, 0, 10, 1000), mkMinute(DAY1, 1, 11, 0), mkMinute(DAY1, 2, 12, 1000)]);
  assert.equal(s[1], null, '无量 bar 该点 null');
  assert.ok(Math.abs(s[2] - 11) < 1e-9, '无量 bar 不进累计');
  const sd = P.vwapSeries([mkMinute(DAY1, 0, 10, 1000),
    { time: DAY1 + 60, open: 11, high: null, low: 11, close: 11, volume: 5 }, mkMinute(DAY1, 2, 12, 1000)]);
  assert.equal(sd[1], null, '脏 bar 该点 null');
  assert.ok(Math.abs(sd[2] - 11) < 1e-9, '脏 bar 不进累计');
});

await test('atrSeries：恒定 TR——预热段 null、种子落位后恒定、数据不足全 null、脏 bar 原位落值', () => {
  const ks = Array.from({ length: 20 }, (_, i) => {
    const c = 100 + i;   // 每根涨 1，h=c+0.5、l=c-0.5 → TR 恒 1.5
    return { time: 1700000000 + i * 86400, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 100 };
  });
  const s = P.atrSeries(ks, 3);
  assert.equal(s.length, ks.length);
  [0, 1, 2].forEach(i => assert.equal(s[i], null, '预热段第 ' + i + ' 根应为 null'));
  for (let i = 3; i < ks.length; i++) assert.ok(Math.abs(s[i] - 1.5) < 1e-9, '第 ' + i + ' 根 ATR=TR=1.5');
  assert.deepEqual(Array.from(P.atrSeries(ks.slice(0, 3), 3)), [null, null, null], '数据不足全 null');
  assert.deepEqual(Array.from(P.atrSeries(null, 14)), []);
  const kd = ks.slice(0, 8);
  kd[3].close = null;
  const sdp = P.atrSeries(kd, 3);
  assert.equal(sdp[3], null, '脏 bar 位 null');
  assert.ok(Math.abs(sdp[4] - 5.5 / 3) < 1e-9, '值按有效 bar 原始下标落位（TR 跨脏 bar 桥接=2.5）');
});

await test('atrSeries：Wilder 递推手算逐步核对（doji 构造 TR=[2,4,6,8,10,12]，n=3）', () => {
  const p = [0, 2, 6, 12, 20, 30, 42];
  const ks = p.map((v, i) => ({ time: 1700000000 + i * 86400, open: v, high: v, low: v, close: v, volume: 100 }));
  const s = P.atrSeries(ks, 3);
  [0, 1, 2].forEach(i => assert.equal(s[i], null));
  assert.ok(Math.abs(s[3] - 4) < 1e-9, '种子=(2+4+6)/3=4');
  assert.ok(Math.abs(s[4] - 16 / 3) < 1e-9, '递推=(4×2+8)/3=16/3');
  assert.ok(Math.abs(s[5] - 62 / 9) < 1e-9, '=(16/3×2+10)/3=62/9');
  assert.ok(Math.abs(s[6] - 232 / 27) < 1e-9, '=(62/9×2+12)/3=232/27');
});

await test('stochRsiSeries：单调上涨 → RSI 恒 100 → 窗口平 → raw=50 → K=D=50、预热段 null、不足空结构', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  const s = P.stochRsiSeries(closes, 14, 3, 3);
  assert.equal(s.k.length, 40);
  assert.equal(s.d.length, 40);
  assert.equal(s.k[27], null, 'raw 未起效 → K null');
  assert.equal(s.k[28], null, 'K 的 kS 窗未满 → null');
  assert.ok(Math.abs(s.k[29] - 50) < 1e-9, 'K=50');
  assert.equal(s.d[30], null, 'D 的 dS 窗未满 → null');
  assert.ok(Math.abs(s.d[31] - 50) < 1e-9, 'D=K 的 SMA=50');
  s.k.slice(29).forEach(v => assert.equal(v, 50));
  s.d.slice(31).forEach(v => assert.equal(v, 50));
  const short = P.stochRsiSeries(closes.slice(0, 31), 14, 3, 3);
  assert.deepEqual(Array.from(short.k), [], '数据不足 → 空结构');
  assert.deepEqual(Array.from(short.d), []);
  assert.deepEqual(Array.from(P.stochRsiSeries(null, 14, 3, 3).k), []);
});

await test('stochRsiSeries：随机序列——值域恒 [0,100]，K 恰为 raw 的 kS 窗 SMA、D 恰为 K 的 dS 窗 SMA', () => {
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(100 + Math.sin(i / 3) * 15 + (i % 5) * 2);
  const n = 4, kS = 2, dS = 2;
  const s = P.stochRsiSeries(closes, n, kS, dS);
  const rsi = P.rsiSeries(closes, n);
  const raw = closes.map((_, i) => {
    if (i < n * 2 - 1) return null;
    let hh = -Infinity, ll = Infinity, ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      if (rsi[j] === null) { ok = false; break; }
      hh = Math.max(hh, rsi[j]); ll = Math.min(ll, rsi[j]);
    }
    return ok ? (hh === ll ? 50 : (rsi[i] - ll) / (hh - ll) * 100) : null;
  });
  const sma = (arr, w, i) => {
    if (i < w - 1) return null;
    let sum = 0;
    for (let j = i - w + 1; j <= i; j++) { if (arr[j] === null) return null; sum += arr[j]; }
    return sum / w;
  };
  const exK = closes.map((_, i) => sma(raw, kS, i)), exD = closes.map((_, i) => sma(exK, dS, i));
  for (let i = 0; i < closes.length; i++) {
    if (exK[i] === null) assert.equal(s.k[i], null, '第 ' + i + ' 点 K 应为 null');
    else assert.ok(Math.abs(s.k[i] - exK[i]) < 1e-9, '第 ' + i + ' 点 K 应为 raw 的 SMA');
    if (exD[i] === null) assert.equal(s.d[i], null, '第 ' + i + ' 点 D 应为 null');
    else assert.ok(Math.abs(s.d[i] - exD[i]) < 1e-9, '第 ' + i + ' 点 D 应为 K 的 SMA');
  }
  s.k.concat(s.d).forEach((v) => { if (v !== null) assert.ok(v >= 0 && v <= 100, '越界 ' + v); });
});

await test('cciSeries：恒定 tp→0、持续上行→正、预热段 null、n 大于序列长全 null', () => {
  const mk = (c) => ({ time: 1700000000 + c * 86400, open: c, high: c, low: c, close: c, volume: 100 });
  const s0 = P.cciSeries(Array.from({ length: 30 }, (_, i) => mk(100)), 5);
  for (let i = 0; i < 30; i++) {
    if (i < 4) assert.equal(s0[i], null, '预热段 ' + i);
    else assert.equal(s0[i], 0, '恒定 tp → md=0 → CCI=0（第 ' + i + ' 点）');
  }
  const s1 = P.cciSeries(Array.from({ length: 30 }, (_, i) => mk(100 + i)), 5);
  [0, 1, 2, 3].forEach(i => assert.equal(s1[i], null));
  for (let i = 4; i < 30; i++) assert.ok(s1[i] > 0, '持续上行 → CCI 为正（第 ' + i + ' 点）');
  const s2 = P.cciSeries(Array.from({ length: 30 }, (_, i) => mk(100 + i)), 50);
  assert.equal(s2.length, 30, '长度保持');
  s2.forEach(v => assert.equal(v, null, 'n 大于序列长全 null'));
});

await test('dmiSeries：单边上涨 +DI>-DI 恒成立、值域 [0,100]、+DI 第 n 个有效 bar 起效而 ADX 第 n+m-1 个起效、不足全 null', () => {
  const ks = Array.from({ length: 40 }, (_, i) => {
    const c = 100 + i;
    return { time: 1700000000 + i * 86400, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 100 };
  });
  const n = 5, m = 3;
  const s = P.dmiSeries(ks, n, m);
  ['pdi', 'mdi', 'adx'].forEach(k => assert.equal(s[k].length, 40, k + ' 与输入等长'));
  assert.equal(s.pdi[n - 1], null, '预热段 null');
  assert.ok(s.pdi[n] !== null, '+DI 自第 ' + n + ' 个有效 bar 起效');
  assert.equal(s.adx[n + m - 2], null, 'ADX 预热段 null');
  assert.ok(s.adx[n + m - 1] !== null, 'ADX 自第 ' + (n + m - 1) + ' 个有效 bar 起效');
  for (let i = 0; i < 40; i++) {
    if (s.pdi[i] === null) continue;
    assert.ok(s.pdi[i] > s.mdi[i], '单边上涨 → +DI>-DI（第 ' + i + ' 点）');
    assert.ok(s.pdi[i] >= 0 && s.pdi[i] <= 100 && s.mdi[i] >= 0 && s.mdi[i] <= 100, 'DI 值域');
    if (s.adx[i] !== null) assert.ok(s.adx[i] >= 0 && s.adx[i] <= 100, 'ADX 值域');
  }
  const short = P.dmiSeries(ks.slice(0, n), n, m);
  short.pdi.concat(short.mdi, short.adx).forEach(v => assert.equal(v, null, '数据不足全 null'));
});

await test('computePane 集成：五个新键各出正确条数的线、time 对齐原 K 线、脏 bar 不出现、未知键空结构', () => {
  const ks = mkKlines(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 15));
  ks[3].close = null;   // 脏 bar（与既有 RSI 脏 bar 组同法）
  const dirtyTime = ks[3].time;
  const allTimes = new Set(ks.map(k => k.time));
  const spec = { vwap: 1, atr: 1, stochrsi: 2, cci: 1, dmi: 3 };
  for (const key of Object.keys(spec)) {
    const pane = P.computePane(key, ks, {});
    assert.equal(pane.lines.length, spec[key], key + ' 应出 ' + spec[key] + ' 条线');
    assert.equal(pane.bars.length, 0, key + ' 无柱');
    pane.lines.forEach((l) => {
      assert.ok(l.data.length > 0, key + ' 线 ' + l.name + ' 应有数据');
      l.data.forEach((pt) => {
        assert.ok(allTimes.has(pt.time) && pt.time !== dirtyTime, 'time 来自原 K 线且脏 bar 不出现');
      });
    });
  }
  assert.deepEqual(Array.from(P.computePane('dmi', ks, {}).lines.map(l => l.name)), ['+DI', '-DI', 'ADX']);
  assert.deepEqual(Array.from(P.computePane('stochrsi', ks, {}).lines.map(l => l.name)), ['K', 'D']);
  assert.equal(P.computePane('不存在的指标', ks, {}).lines.length, 0, '未知键仍空结构');
});

await test('paneRange：stochrsi 固定 0~100、vwap 为 free（正值域不强制含零）、cci 负值不裁剪、atr 含零', () => {
  const sr = P.paneRange('stochrsi', { lines: [{ data: [{ value: 88 }] }], bars: [] });
  assert.equal(sr.min, 0);
  assert.equal(sr.max, 100);
  const vw = P.paneRange('vwap', { lines: [{ data: [{ value: 10 }, { value: 12 }] }], bars: [] });
  assert.ok(vw.min > 0, 'free：正值域不强制含 0');
  const cc = P.paneRange('cci', { lines: [{ data: [{ value: -100 }, { value: 50 }] }], bars: [] });
  assert.ok(cc.min < 0, 'cci 负值不被裁剪');
  const at = P.paneRange('atr', { lines: [{ data: [{ value: 3.2 }] }], bars: [] });
  assert.ok(at.min <= 0, 'atr 非负指标含 0（等价旧口径）');
});

await test('跨文件守卫：charts.js 的 PANE_LINE_SLOTS 必须覆盖 PANE_DEFS 全部八键（防绘制层漏接线）', () => {
  const chartsSrc = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const m = /PANE_LINE_SLOTS\s*=\s*\{([\s\S]*?)\};/.exec(chartsSrc);
  assert.ok(m, 'charts.js 缺 PANE_LINE_SLOTS 槽位表');
  P.PANE_DEFS.forEach((d) => {
    assert.ok(new RegExp('\\b' + d.key + '\\s*:').test(m[1]), '槽位表缺 ' + d.key + '（加 PANE_DEF 不接线 = 画不出来）');
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
