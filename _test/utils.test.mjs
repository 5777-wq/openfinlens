#!/usr/bin/env node
/* utils.test.mjs —— 格式化器的边界（node 直跑，零依赖）
 * 用法：node _test/utils.test.mjs
 *
 * 锁死的是"没有数据"这件事的口径：空串、纯空白、NaN、±Infinity 一律显示 '--'，
 * 绝不能显示成 0.00 —— 一个没填的格子显示 0.00 是在编数字，用户会以为
 * "今天涨跌幅是 0"（实测过的坑：接口字段缺失 → 空串 → isNaN('') === false
 * → Number('') === 0 → 显示 0.00）。 */

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

/* ---- 最小环境：只为了把真的 js/utils.js 跑起来 ---- */
const ctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
  setTimeout, clearTimeout, TextDecoder, RegExp, Error, Promise, Map, Set,
  document: {
    documentElement: {}, body: {},
    createElement: () => ({ style: {}, remove() { }, addEventListener() { } }),
    head: { appendChild() { } }, querySelectorAll: () => [], addEventListener() { },
  },
  localStorage: (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  })(),
});
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/utils.js'), 'utf8'), ctx, { filename: 'js/utils.js' });

const U = ctx.window.U;
const { fmt, fmtPct, fmtChg, fmtVol, fmtPrice, num, isMissing } = U;

/* ---------------- 缺失值：空串 / 纯空白 ---------------- */

test('fmt：空串与纯空白算缺失（不是 0.00）', () => {
  assert.equal(fmt(''), '--', "空串不该显示 0.00");
  assert.equal(fmt('   '), '--', '纯空白不该显示 0.00');
  assert.equal(fmt('\t\n '), '--');
});

test('fmtPct / fmtChg / fmtVol：空串与纯空白算缺失', () => {
  assert.equal(fmtPct(''), '--');
  assert.equal(fmtPct('  '), '--');
  assert.equal(fmtChg(''), '--');
  assert.equal(fmtVol(''), '--');
  assert.equal(fmtVol('   '), '--');
});

test('num：空串与纯空白算缺失（以前 Number(\' \') === 0，会当成真 0）', () => {
  assert.equal(num(''), null);
  assert.equal(num('   '), null);
  assert.equal(num('\t'), null);
});

/* ---------------- 缺失值：NaN / ±Infinity ---------------- */

test('fmt：NaN 与 ±Infinity 算缺失（JSON.parse(\'1e400\') 就会得到 Infinity）', () => {
  assert.equal(fmt(NaN), '--');
  assert.equal(fmt(Infinity), '--');
  assert.equal(fmt(-Infinity), '--');
  assert.equal(fmt('Infinity'), '--');
});

test('fmtPct / fmtChg / fmtVol：NaN 与 ±Infinity 算缺失', () => {
  assert.equal(fmtPct(NaN), '--');
  assert.equal(fmtPct(Infinity), '--');
  assert.equal(fmtPct(-Infinity), '--');
  assert.equal(fmtChg(Infinity), '--');
  assert.equal(fmtVol(NaN), '--');
  assert.equal(fmtVol(Infinity), '--');
  assert.equal(fmtVol(-Infinity), '--');
});

test('num：NaN 与 ±Infinity 算缺失', () => {
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num(-Infinity), null);
});

/* ---------------- 真正的 0 仍然是 0 ---------------- */

test('真正的 0 不是缺失（0.00% 与 0 都是有效值）', () => {
  assert.equal(fmt(0), '0.00');
  assert.equal(fmtPct(0), '0.00%');
  assert.equal(fmtChg(0), '0.00');
  assert.equal(fmtVol(0), '0');
  assert.equal(num(0), 0);
});

test('null / undefined 仍然是缺失（老口径不变）', () => {
  assert.equal(fmt(null), '--');
  assert.equal(fmt(undefined), '--');
  assert.equal(fmtPct(null), '--');
  assert.equal(fmtVol(null), '--');
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
});

/* ---------------- 正常值不许被改坏 ---------------- */

test('正常数字的显示不变', () => {
  assert.equal(fmt(1.005, 2), '1.00');
  assert.equal(fmt(1234.5678, 2), '1234.57');
  assert.equal(fmtPct(0.5), '+0.50%');
  assert.equal(fmtPct(-1.234), '-1.23%');
  assert.equal(fmtChg(-1.234), '-1.23');
  assert.equal(fmtVol(464117264), '4.64亿');
  assert.equal(fmtVol(21111), '2万');
  assert.equal(fmtVol(500), '500');
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('-'), null, "'-' 仍是占位符");
});

test('数字字符串照常解析（接口给字符串是常态）', () => {
  assert.equal(fmt('3.5'), '3.50');
  assert.equal(fmtPct('2.5'), '+2.50%');
  assert.equal(num(' 3.5 '), 3.5);
});

test('isMissing 覆盖空串/空白/NaN/±Infinity，放过真数字与 0', () => {
  assert.equal(isMissing(''), true);
  assert.equal(isMissing('  '), true);
  assert.equal(isMissing(NaN), true);
  assert.equal(isMissing(Infinity), true);
  assert.equal(isMissing(-Infinity), true);
  assert.equal(isMissing(null), true);
  assert.equal(isMissing(undefined), true);
  assert.equal(isMissing(0), false);
  assert.equal(isMissing('0'), false);
  assert.equal(isMissing(12.5), false);
});

test('fmtPrice 同样走缺失口径（空串不再显示 0.00）', () => {
  assert.equal(fmtPrice(''), '--');
  assert.equal(fmtPrice(null), '--');
  assert.equal(fmtPrice(Infinity), '--');
  assert.equal(fmtPrice(7.28), '7.28');
});

/* ---------------- 折叠状态持久化：sanitizeFolds ----------------
   localStorage 里读回来的折叠表可能是任何脏值（手改、旧版本结构、
   JSON 损坏之外的合法垃圾），恢复前必须净化——只留「值为 true 且
   id 在现存分区名单里」的键，其余一律回落展开。
   注意：utils.js 在 vm 沙箱里跑，返回对象的原型来自沙箱 realm，
   deepStrictEqual 会因跨 realm 原型不同而误报，所以用 JSON 串比较。 */

test('sanitizeFolds：非对象脏值（null/数字/数组/字符串/undefined）一律收敛成 {}', () => {
  assert.equal(JSON.stringify(U.sanitizeFolds(null, ['a'])), '{}');
  assert.equal(JSON.stringify(U.sanitizeFolds(42, ['a'])), '{}');
  assert.equal(JSON.stringify(U.sanitizeFolds(['a'], ['a'])), '{}', '数组不是合法的折叠表');
  assert.equal(JSON.stringify(U.sanitizeFolds('a', ['a'])), '{}');
  assert.equal(JSON.stringify(U.sanitizeFolds(undefined, ['a'])), '{}');
});

test('sanitizeFolds：只留「值为 true 且 id 现存」的键（脏 id、非 true 值全丢）', () => {
  const raw = { keep: true, stale: true, notTrue: 'yes', one: 1, zero: 0 };
  assert.equal(JSON.stringify(U.sanitizeFolds(raw, ['keep'])), '{"keep":true}',
    'stale 不在现存名单里、notTrue/one/zero 不是严格 true');
});

test('sanitizeFolds：大小写敏感；validIds 缺省按空名单处理（全部丢弃）', () => {
  assert.equal(JSON.stringify(U.sanitizeFolds({ A: true }, ['a'])), '{}');
  assert.equal(JSON.stringify(U.sanitizeFolds({ a: true })), '{}');
});

test('sanitizeFolds：全部合法时原样保留（不丢合法的折叠记忆，键序随原表）', () => {
  const raw = { heatSection: true, moodPanel: true };
  assert.equal(JSON.stringify(U.sanitizeFolds(raw, ['heatSection', 'moodPanel', 'seatSection'])),
    '{"heatSection":true,"moodPanel":true}');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
