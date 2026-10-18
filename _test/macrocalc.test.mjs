#!/usr/bin/env node
/* macrocalc.test.mjs —— 宏观策略纯计算单测（Node 直跑，不依赖网络/浏览器）
 * 用法：node _test/macrocalc.test.mjs
 *
 * 这些数字都手算可复核：利差的 bp 换算、倒挂判定、金油比、矩阵分组过滤。
 * 宏观读数算错不会报错，只会安静地给用户一个错的方向感——所以锁死。 */

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
vm.runInContext(readFileSync(path.join(ROOT, 'js/macrocalc.js'), 'utf8'), ctx, { filename: 'js/macrocalc.js' });
const MC = vm.runInContext('window.MacroCalc', ctx);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} 期望 ${b}±${eps}，实际 ${a}`);

// 造行情：对象形态（getter 两条路都要测）
const Q = (price, change, changePct) => ({ price, change, changePct });
const quotes = {
  'EM:171.US3M': Q(4.17, -0.02, -0.48),
  'EM:171.US2Y': Q(4.20, 0.01, 0.24),
  'EM:171.US5Y': Q(4.30, null, null),
  'EM:171.US10Y': Q(4.50, 0.03, 0.67),
  'EM:171.US30Y': Q(4.70, null, null),
  'EM:171.CN2Y': Q(1.2318, -0.0036, -0.29),
  'EM:171.CN5Y': Q(1.55, null, null),
  'EM:171.CN10Y': Q(1.80, 0.002, 0.11),
  'EM:171.CN30Y': Q(2.15, null, null),
  'EM:101.GC00Y': Q(2650.5, 12.3, 0.47),
  'EM:102.CL00Y': Q(71.2, -0.8, -1.11),
  'EM:100.UDI': Q(103.5, 0.35, 0.34),
  'sh000001': Q(3250.11, 12.4, 0.38),
};

/* ---------------- 收益率曲线 ---------------- */

test('yieldCurve: 按期限升序装配，缺行情的期限直接跳过', () => {
  const us = MC.yieldCurve(quotes, 'us');
  assert.equal(us.map(p => p.label).join('|'), '3月|2年|5年|10年|30年');
  assert.equal(us.map(p => p.y).join('|'), '0.25|2|5|10|30');
  const cn = MC.yieldCurve(quotes, 'cn');
  assert.equal(cn.length, 4);   // CN 没有 3月，天然缺席
  // price 为 null 的点不进曲线
  const broken = Object.assign({}, quotes, { 'EM:171.US2Y': Q(null, null, null) });
  assert.equal(MC.yieldCurve(broken, 'us').length, 4);
});

test('yieldCurve: chg 携带收益率绝对变动（×100 = bp，视图用）', () => {
  const us = MC.yieldCurve(quotes, 'us');
  const p10 = us.find(p => p.y === 10);
  near(p10.chg, 0.03, 1e-9);
});

test('yieldCurve: Map 形态的行情池同样可用（app state.quotes 路径）', () => {
  const m = new Map(Object.entries(quotes));
  assert.equal(MC.yieldCurve(m, 'cn').length, 4);
});

/* ---------------- 利差 ---------------- */

test('spread: 10Y−2Y = +0.30 个百分点，未倒挂', () => {
  const us = MC.yieldCurve(quotes, 'us');
  const s = MC.spread(us, 10, 2);
  near(s.value, 0.30, 1e-9);
  assert.equal(s.inverted, false);
});

test('spread: 短端高于长端 → inverted=true（倒挂）', () => {
  const inv = { 'EM:171.US2Y': Q(4.80, null, null), 'EM:171.US10Y': Q(4.50, null, null) };
  const s = MC.spread(MC.yieldCurve(inv, 'us'), 10, 2);
  near(s.value, -0.30, 1e-9);
  assert.equal(s.inverted, true);
});

test('spread: 任一端缺行情 → null（视图渲染 --，不许拿 0 冒充）', () => {
  const partial = { 'EM:171.US10Y': Q(4.5, null, null) };
  assert.equal(MC.spread(MC.yieldCurve(partial, 'us'), 10, 2), null);
});

test('spreads: 美债固定输出 10−2 与 10−3月 两组', () => {
  const list = MC.spreads(MC.yieldCurve(quotes, 'us'));
  assert.equal(list.map(x => x.id).join('|'), 'us-10-2|us-10-3m');
  near(list[1].s.value, 4.50 - 4.17, 1e-9);
});

/* ---------------- 大类资产矩阵 ---------------- */

test('crossAssetRows: 分组输出，缺行情的标的与空组都被过滤', () => {
  const groups = MC.crossAssetRows(quotes);
  const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
  // quotes 里没有 hkHSI / fx 直盘等 → 它们所在的组要么缺席要么少成员
  assert.ok(!byKey.eq.items.some(i => i.symbol === 'hkHSI'));
  assert.ok(byKey.eq.items.some(i => i.symbol === 'sh000001'));
  assert.ok(byKey.cmd.items.some(i => i.symbol === 'EM:101.GC00Y'));
  assert.equal(byKey.crypto, undefined);   // 没喂加密行情 → 整组消失
  const item = byKey.eq.items.find(i => i.symbol === 'sh000001');
  assert.equal(item.name, 'sh000001');     // 无 label 时回退 symbol，不造假名
});

/* ---------------- 宏观读数 ---------------- */

test('signals: 美债利差换算成 bp，倒挂打标', () => {
  const sigs = MC.signals(quotes);
  const s102 = sigs.find(s => s.id === 'us-10-2');
  near(s102.value, 30, 1e-6);
  assert.equal(s102.inverted, false);
  assert.equal(s102.unit, 'bp');

  const invQ = Object.assign({}, quotes, { 'EM:171.US2Y': Q(4.9, null, null) });
  const inv = MC.signals(invQ).find(s => s.id === 'us-10-2');
  near(inv.value, -40, 1e-6);
  assert.equal(inv.inverted, true);
});

test('signals: 中美 10 年利差 = 中债 − 美债（bp）', () => {
  const s = MC.signals(quotes).find(x => x.id === 'cn-us-10');
  near(s.value, (1.80 - 4.50) * 100, 1e-6);
});

test('signals: 金油比 = 黄金价 ÷ 原油价（桶/盎司），油价为 0 时不除', () => {
  const s = MC.signals(quotes).find(x => x.id === 'gold-oil');
  near(s.value, 2650.5 / 71.2, 1e-9);
  const zeroOil = Object.assign({}, quotes, { 'EM:102.CL00Y': Q(0, null, null) });
  assert.equal(MC.signals(zeroOil).find(x => x.id === 'gold-oil').value, null);
});

test('signals: 美元指数带当日涨跌；整体缺行情时各项为 null 不抛错', () => {
  const udi = MC.signals(quotes).find(x => x.id === 'udi');
  assert.equal(udi.value, 103.5);
  assert.equal(udi.changePct, 0.34);
  const empty = MC.signals({});
  assert.ok(empty.length >= 4);
  empty.forEach(s => assert.equal(s.value, null));
});

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
