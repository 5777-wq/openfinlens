#!/usr/bin/env node
/* compare.test.mjs —— 基金对比纯计算层单测（Node 直跑，不依赖网络/浏览器）
 * 用法：node _test/compare.test.mjs
 *
 * 这些数字都是手算可复现的：归一化基准、CAGR、最大回撤峰谷日期、自然年收益、
 * 相关系数符号。指标算错在这类工具里不会报错，只会安静地给用户一个错的年化。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};

const ctx = vm.createContext({ console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, isFinite });
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/compare.js'), 'utf8'), ctx, { filename: 'js/compare.js' });
const C = vm.runInContext('window.CompareMath', ctx);

/* 造序列：[['2020-01-01',100], ...] → [{time, close}] */
const bars = (...rows) => rows.map(([time, close]) => ({ time, close }));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} 期望 ${b}±${eps}，实际 ${a}`);

/* ---------------- 归一化 / 切片 ---------------- */

test('normalize: 基准恒为首日（100 / 0% / 倍数 三种口径）', () => {
  const b = bars(['2020-01-01', 50], ['2020-06-01', 75], ['2021-01-01', 100]);
  const v = C.normalize(b, { as: 'index' });
  assert.deepEqual([...v.map(p => p.value)], [100, 150, 200]);
  const p = C.normalize(b, { as: 'pct' });
  assert.deepEqual([...p.map(x => x.value)], [0, 50, 100]);
  const m = C.normalize(b, { as: 'mult' });
  assert.deepEqual([...m.map(x => x.value)], [1, 1.5, 2]);
  // 未知口径一律退回 index（不许把值算成 0 或 NaN）
  assert.deepEqual([...C.normalize(b, { as: 'oops' }).map(x => x.value)], [100, 150, 200]);
});

test('normalize: 基准价缺失/为 0 时返回空数组（不产生 NaN 曲线）', () => {
  assert.equal(C.normalize([], {}).length, 0);
  assert.equal(C.normalize(bars(['2020-01-01', 0], ['2020-01-02', 5]), {}).length, 0);
});

test('sliceRange: 首末日期都含在内（边界不丢一天）', () => {
  const b = bars(['2019-12-31', 1], ['2020-01-01', 2], ['2020-06-30', 3], ['2020-07-01', 4]);
  assert.deepEqual([...C.sliceRange(b, '2020-01-01', '2020-06-30').map(x => x.time)], ['2020-01-01', '2020-06-30']);
  assert.equal(C.sliceRange(b, null, null).length, 4);
  assert.deepEqual([...C.sliceRange(b, '2020-01-01', null).map(x => x.time)], ['2020-01-01', '2020-06-30', '2020-07-01']);
});

/* ---------------- 区间指标 ---------------- */

test('metrics: 总收益与 CAGR（两年翻倍 → 年化 ≈ 41.4%）', () => {
  const m = C.metrics(bars(['2020-01-01', 100], ['2021-01-01', 141.42], ['2022-01-01', 200]));
  near(m.total, 100, 1e-9, '总收益');
  near(m.cagr, 41.42, 0.05, 'CAGR');      // 2^0.5 - 1 = 41.42%
  near(m.years, 2.001, 0.01, '年数');
});

test('metrics: 区间过短（不满 1 个月）不给年化，避免把 3 天涨 2% 说成年化 1000%', () => {
  const m = C.metrics(bars(['2026-09-01', 100], ['2026-09-03', 102]));
  assert.equal(m.cagr, null);
  assert.equal(m.calmar, null);
  near(m.total, 2, 1e-9, '总收益照给');
});

test('metrics: 最大回撤取峰谷幅度并记住峰/谷日期', () => {
  const m = C.metrics(bars(
    ['2020-01-02', 100], ['2020-02-19', 120], ['2020-03-23', 60],
    ['2020-06-01', 90], ['2020-09-01', 150]));
  near(m.maxDD, -50, 1e-9, '最大回撤');
  assert.equal(m.peakAt, '2020-02-19');
  assert.equal(m.troughAt, '2020-03-23');
});

test('metrics: 单调上涨序列回撤为 0（不是 null，也不是正值）', () => {
  const m = C.metrics(bars(['2020-01-01', 10], ['2020-06-01', 12], ['2021-01-01', 15]));
  assert.equal(m.maxDD, 0);
  assert.equal(m.calmar, null, '回撤为 0 时卡玛无意义（除零），必须留空');
});

test('metrics: 年化波动 = 收益率样本标准差 × √年频', () => {
  const b = bars(['2020-01-01', 100], ['2020-01-02', 110], ['2020-01-03', 99], ['2020-01-06', 108]);
  const r = [0.1, -0.1, 108 / 99 - 1];
  const mu = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mu) ** 2, 0) / (r.length - 1));
  near(C.metrics(b, { periodsPerYear: 252 }).vol, sd * Math.sqrt(252) * 100, 1e-6, '年化波动');
});

test('metrics: 样本不足返回 null（空态交给界面，不猜）', () => {
  assert.equal(C.metrics([]), null);
  assert.equal(C.metrics(bars(['2020-01-01', 100])), null);
  assert.equal(C.metrics(bars(['2020-01-01', -5], ['2020-01-02', 10])), null);
});

/* ---------------- 年度收益 ---------------- */

test('yearlyReturns: 自然年收益以"上一年最后一根"为基准（跨年连续）', () => {
  const ys = C.yearlyReturns(bars(
    ['2019-01-02', 80], ['2019-12-31', 100],      // 2019：80 → 100
    ['2020-01-02', 105], ['2020-12-31', 120],     // 2020：基准是 2019-12-31 的 100
    ['2021-12-31', 90]));                          // 2021：基准 120
  assert.deepEqual([...ys.map(y => y.year)], ['2019', '2020', '2021']);
  near(ys[0].pct, 25, 1e-9, '2019');
  near(ys[1].pct, 20, 1e-9, '2020');
  near(ys[2].pct, -25, 1e-9, '2021');
});

test('yearlyReturns: 首末年份不满整年标 partial（半年报数不会被读成全年）', () => {
  const ys = C.yearlyReturns(bars(
    ['2020-07-01', 100], ['2020-12-31', 130],     // 首年从 7 月开始
    ['2021-06-30', 140]));                         // 末年只到 6 月
  assert.equal(ys[0].partial, true, '2020 是半年');
  assert.equal(ys[1].partial, true, '2021 只到 6 月');
});

test('yearlyReturns: 完整年份不标 partial（12 月末结束视为整年）', () => {
  const ys = C.yearlyReturns(bars(['2019-12-31', 100], ['2020-12-31', 110], ['2021-12-31', 121]));
  assert.equal(ys.find(y => y.year === '2020').partial, false);
  assert.equal(ys.find(y => y.year === '2019').partial, true, '2019 只有一天数据');
});

test('metrics: 最好/最差年只统计完整年份（半年的 +100% 不该当"最佳年"）', () => {
  const m = C.metrics(bars(
    ['2020-07-01', 100], ['2020-12-31', 200],     // 半年 +100%（不参与最佳/最差年）
    ['2021-12-31', 180],                          // 2021：-10%
    ['2022-12-31', 216]));                        // 2022：+20%
  assert.equal(m.yearCount, 2, '完整年份 2021/2022');
  assert.equal(m.best.year, '2022');
  assert.equal(m.worst.year, '2021');
  assert.equal(m.upYears, 1);
});

/* ---------------- 对齐方式 ---------------- */

test('buildLines(own): 各自起点归一，晚上市的基金从自己的第一天算 100', () => {
  const funds = [
    { key: 'A', name: '早', bars: bars(['2020-01-01', 10], ['2021-01-01', 20]) },
    { key: 'B', name: '晚', bars: bars(['2020-07-01', 50], ['2021-01-01', 40]) },
  ];
  const { lines, excluded } = C.buildLines(funds, { mode: 'own', start: '2020-01-01', end: '2021-01-01' });
  assert.equal(excluded.length, 0);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].points[0].value, 100, 'B 的第一点是 100');
  near(lines[1].points[1].value, 80, 1e-9, 'B 区间收益 −20%');
  near(lines[0].points[1].value, 200, 1e-9, 'A 区间收益 +100%');
});

test('buildLines(common): 共同起点取各标的区间起点的最晚者，起点之前的标的明示排除', () => {
  const funds = [
    { key: 'A', name: '早', bars: bars(['2020-01-01', 10], ['2020-07-15', 11], ['2021-01-01', 20]) },
    { key: 'B', name: '早退', bars: bars(['2020-01-01', 5], ['2020-03-31', 6]) },
    { key: 'C', name: '晚', bars: bars(['2020-07-01', 50], ['2020-12-31', 60], ['2021-01-01', 75]) },
  ];
  const { lines, excluded, commonStart } = C.buildLines(funds, { mode: 'common', start: '2020-01-01', end: '2021-01-01' });
  assert.equal(commonStart, '2020-07-01', '共同起点 = C 的起点');
  assert.deepEqual([...lines.map(l => l.key)], ['A', 'C']);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].key, 'B');
  assert.match(excluded[0].reason, /早于共同起点/);
  // 基准必须落在共同起点那天：C 该日有 bar（50），A 该日没有 → 用 07-01 之前最后一根（10）
  const A = lines.find(l => l.key === 'A'), Cc = lines.find(l => l.key === 'C');
  assert.equal(Cc.points[0].value, 100, 'C 在共同起点当天 = 100');
  near(A.points[0].value, 110, 1e-9, 'A 自共同起点已涨 10%（基准用 07-01 之前最后一根，不是它自己的首根）');
  lines.forEach(l => {
    assert.ok(l.points[0].time >= commonStart, l.key + ' 首点日期不得早于共同起点');
    assert.equal(l.points[0].time, l.bars[0].time, l.key + ' 首点日期必须等于参与计算的第一根 bar');
  });
  assert.equal(A.base, 10, 'A 的基准是 2020-01-01 的 10（前向填充）');
  assert.equal(Cc.base, 50, 'C 的基准是 2020-07-01 的 50');
});

test('buildLines: 只有 1 根 bar 的区间一律排除（否则下游 metrics 返回 null 直接把界面算崩）', () => {
  const funds = [
    { key: 'A', name: 'A', bars: bars(['2020-01-01', 10]) },
    { key: 'B', name: 'B', bars: bars(['2020-01-01', 5], ['2020-01-02', 6]) },
  ];
  const { lines, excluded } = C.buildLines(funds, { mode: 'own', start: '2020-01-01', end: '2020-01-02' });
  assert.deepEqual([...lines.map(l => l.key)], ['B'], 'own 模式也要挡住单根 bar 的标的');
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].key, 'A');
  assert.match(excluded[0].reason, /只有 1 个交易日/);
});

test('buildLines: 区间内没数据的标的给理由，不静默丢弃', () => {
  const funds = [{ key: 'A', name: 'A', bars: bars(['2010-01-01', 10]) }];
  const { lines, excluded } = C.buildLines(funds, { mode: 'own', start: '2020-01-01', end: '2021-01-01' });
  assert.equal(lines.length, 0);
  assert.equal(excluded.length, 1);
  assert.match(excluded[0].reason, /没有数据/);
});

test('buildLines: 共同起点下所有曲线首点都是 100（图能直接读相对强弱）', () => {
  const funds = [
    { key: 'A', name: 'A', bars: bars(['2020-01-01', 10], ['2020-05-01', 12], ['2021-01-01', 20]) },
    { key: 'B', name: 'B', bars: bars(['2020-01-01', 7], ['2020-05-01', 7.7], ['2021-01-01', 14]) },
  ];
  const { lines } = C.buildLines(funds, { mode: 'common', start: '2020-01-01', end: '2021-01-01' });
  lines.forEach(l => assert.equal(l.points[0].value, 100, l.key + ' 首点'));
  near(lines[0].points[1].value, 120, 1e-9, 'A 5 月');
  near(lines[1].points[1].value, 110, 1e-9, 'B 5 月');
});

/* ---------------- 相关性 ---------------- */

test('correlation: 完全同向 = 1，完全反向 = −1', () => {
  // 收益率互为相反数 → 相关系数恰好 ±1（价格等比例缩放不影响相关性，所以 B 用 0.5 倍价）
  const up = bars(['2020-01-01', 100], ['2020-01-02', 110], ['2020-01-03', 99], ['2020-01-06', 108.9]);
  const same = bars(['2020-01-01', 50], ['2020-01-02', 55], ['2020-01-03', 49.5], ['2020-01-06', 54.45]);
  const down = bars(['2020-01-01', 100], ['2020-01-02', 90], ['2020-01-03', 99], ['2020-01-06', 89.1]);
  const c1 = C.correlation([{ key: 'A', name: 'A', bars: up }, { key: 'B', name: 'B', bars: same }]);
  near(c1.matrix[0][1], 1, 1e-9, '同向');
  assert.equal(c1.matrix[0][0], 1, '对角线恒为 1');
  assert.equal(c1.matrix[1][0], c1.matrix[0][1], '矩阵对称');
  const c2 = C.correlation([{ key: 'A', name: 'A', bars: up }, { key: 'C', name: 'C', bars: down }]);
  near(c2.matrix[0][1], -1, 1e-9, '反向');
});

test('correlation: 恒定收益率序列方差为 0 → 相关无定义（返回 null，不硬给 1）', () => {
  const a = bars(['2020-01-01', 100], ['2020-01-02', 110], ['2020-01-03', 121], ['2020-01-06', 133.1]);
  const b = bars(['2020-01-01', 100], ['2020-01-02', 90], ['2020-01-03', 81], ['2020-01-06', 72.9]);
  const c = C.correlation([{ key: 'A', name: 'A', bars: a }, { key: 'B', name: 'B', bars: b }]);
  assert.equal(c.matrix[0][1], null, '每天恰好 ±10%，相关系数没有定义');
});

test('correlation: 只在公共交易日上算（A股/美股的错位休市日不得当成 0 收益）', () => {
  const a = bars(['2020-01-01', 100], ['2020-01-02', 110], ['2020-01-03', 121], ['2020-01-06', 121],
    ['2020-01-07', 133.1], ['2020-01-08', 146.41]);
  // B 在公共交易日上是 A 的 0.1 倍（收益率完全相同），但缺 01-02、多 01-09：
  // 若把错位日期按 0 收益计入，相关系数会从 1 掉下来
  const b = bars(['2020-01-01', 10], ['2020-01-03', 12.1], ['2020-01-06', 12.1], ['2020-01-07', 13.31],
    ['2020-01-08', 14.641], ['2020-01-09', 16]);
  const c = C.correlation([{ key: 'A', name: 'A', bars: a }, { key: 'B', name: 'B', bars: b }]);
  assert.equal(c.days, 5, '公共交易日 5 天（01-02 不在交集里）');
  near(c.matrix[0][1], 1, 1e-9, '公共日上同向');
});

test('correlation: 样本不足返回 null（不硬凑一个数）', () => {
  const a = bars(['2020-01-01', 100], ['2020-01-02', 110]);
  const b = bars(['2020-01-01', 10], ['2020-01-02', 11]);
  assert.equal(C.correlation([{ key: 'A', bars: a }, { key: 'B', bars: b }]), null);
  assert.equal(C.correlation([{ key: 'A', bars: a }]), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
