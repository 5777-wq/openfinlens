#!/usr/bin/env node
/* charts.test.mjs —— charts.js 纯函数口径（vm 沙箱载真实源码，零 DOM 零网络）
 * 用法：node _test/charts.test.mjs
 *
 * 覆盖三块：
 *   · legendBadge：图表角落「代码 · 周期」徽标的拼接口径（空段剔除）；
 *   · slotStyles：主图指标槽位的取色下标/线宽归一（BOLL 三轨顺延、非法值回退）；
 *   · calcMA：均线口径（正常窗口 / null 收盘断线 / n 大于序列长度）——
 *     calcMA 在 charts.js 导出多年但从未有单测，本轮一并钉死。
 * 载入方式照 utils.test.mjs 的 vm 沙箱先例：charts.js 顶层只定义函数 +
 * window.Charts 赋值，无 DOM / LightweightCharts 访问，可离线加载。
 * 跨 realm 数组不能 deepStrictEqual（原型不同），统一 JSON.stringify 串比较。 */

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

/* ---- 最小环境：charts.js 顶层无 DOM 依赖，window 自引用即可跑起来 ---- */
const ctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  isFinite, Infinity, RegExp, Error, Promise, Map, Set, setTimeout, clearTimeout,
});
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8'), ctx, { filename: 'js/charts.js' });

const C = ctx.window.Charts;
const J = (v) => JSON.stringify(v);

/* ---------------- legendBadge：角落常显徽标 ---------------- */

test('legendBadge：双段拼接「代码 · 周期」', () => {
  assert.equal(C.legendBadge({ code: '600519', period: '日K' }), '600519 · 日K');
});

test('legendBadge：任一为空只显示另一段', () => {
  assert.equal(C.legendBadge({ code: '600519' }), '600519');
  assert.equal(C.legendBadge({ period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: '', period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: 'AAPL', period: '' }), 'AAPL');
});

test('legendBadge：null / undefined / 空对象 → 空串', () => {
  assert.equal(C.legendBadge(null), '');
  assert.equal(C.legendBadge(undefined), '');
  assert.equal(C.legendBadge({}), '');
  assert.equal(C.legendBadge('600519'), '');   // 非对象一律空串
});

test('legendBadge：纯空白段剔除 + 两端 trim', () => {
  assert.equal(C.legendBadge({ code: '   ', period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: ' 600519 ', period: ' 日K ' }), '600519 · 日K');
  assert.equal(C.legendBadge({ code: '  ', period: '  ' }), '');
});

/* ---------------- slotStyles：槽位取色/线宽 ---------------- */

test('slotStyles：默认（无 ci/w）→ 回退槽位序号 + 1px，与改造前行为一致', () => {
  assert.equal(J(C.slotStyles([{ type: 'ma', n: 5 }])), J([{ ci: null, w: 1 }]));
  assert.equal(J(C.slotStyles([{ type: 'ma', n: 5 }], 6)), J([{ ci: null, w: 1 }]));   // paletteN 缺省 6
});

test('slotStyles：BOLL 三轨从 ci 起顺延取色（一条配置多轨取色连续）', () => {
  assert.equal(J(C.slotStyles([{ type: 'boll', n: 20, ci: 4 }])),
    J([{ ci: 4, w: 1 }, { ci: 5, w: 1 }, { ci: 0, w: 1 }]));
  assert.equal(J(C.slotStyles([{ type: 'boll', n: 20, ci: 5 }])),
    J([{ ci: 5, w: 1 }, { ci: 0, w: 1 }, { ci: 1, w: 1 }]));
});

test('slotStyles：线宽仅 1/2/3 合法，其余一律 1（容忍 DOM 来的字符串）', () => {
  const w = (cfg) => C.slotStyles([cfg])[0].w;
  assert.equal(w({ type: 'ma', w: 3 }), 3);
  assert.equal(w({ type: 'ma', w: '2' }), 2);
  assert.equal(w({ type: 'ma', w: 0 }), 1);
  assert.equal(w({ type: 'ma', w: 9 }), 1);
  assert.equal(w({ type: 'ma', w: -1 }), 1);
  assert.equal(w({ type: 'ma' }), 1);
});

test('slotStyles：ci 归一（负数/越界取模，非法 → null 回退槽位序号）', () => {
  const ci = (cfg) => C.slotStyles([cfg])[0].ci;
  assert.equal(ci({ type: 'ma', ci: -1 }), 5);
  assert.equal(ci({ type: 'ma', ci: 99 }), 3);
  assert.equal(ci({ type: 'ma', ci: '3' }), 3);
  assert.equal(ci({ type: 'ma', ci: 'abc' }), null);
  assert.equal(ci({ type: 'ma', ci: 0 }), 0);   // 0 是合法下标，不能当「缺失」
  assert.equal(ci({ type: 'ma' }), null);
  assert.equal(ci({ type: 'ma', ci: '' }), null);
});

test('slotStyles：paletteN 非 6 时按其取模（BOLL 三轨照样顺延）', () => {
  assert.equal(J(C.slotStyles([{ type: 'boll', ci: 5 }], 4)),
    J([{ ci: 1, w: 1 }, { ci: 2, w: 1 }, { ci: 3, w: 1 }]));
});

test('slotStyles：多条混合 → 输出长度与展开后槽位一一对应', () => {
  const out = C.slotStyles([
    { type: 'ma', n: 5 },
    { type: 'ema', n: 12, w: 2 },
    { type: 'boll', n: 20, ci: 5 },
  ]);
  assert.equal(out.length, 5);
  assert.equal(J(out[0]), J({ ci: null, w: 1 }));
  assert.equal(J(out[1]), J({ ci: null, w: 2 }));
  assert.equal(J(out[2]), J({ ci: 5, w: 1 }));
  assert.equal(J(out[3]), J({ ci: 0, w: 1 }));
  assert.equal(J(out[4]), J({ ci: 1, w: 1 }));
});

test('slotStyles：非对象/脏元素被跳过（不产生槽位、不抛错）', () => {
  const out = C.slotStyles([null, 'x', { type: 'ma', n: 5 }, 42]);
  assert.equal(out.length, 1);
  assert.equal(J(out[0]), J({ ci: null, w: 1 }));
  assert.equal(C.slotStyles('not-an-array').length, 0);
});

/* ---------------- calcMA：均线口径（导出多年但此前从未有单测） ---------------- */

test('calcMA：正常窗口 SMA（手算核对）', () => {
  const kl = [1, 2, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  const out = C.calcMA(kl, 2);
  assert.equal(J(out.map(p => p.value)), J([null, 1.5, 2.5, 3.5, 4.5]));
  assert.equal(out[2].time, 'd2');   // time 原样透传（含 null 值点）
});

test('calcMA：窗口含 null 收盘该点为 null（断线不假平均）', () => {
  const kl = [1, null, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  const out = C.calcMA(kl, 2);
  // i=1 窗口 [1,null]、i=2 窗口 [null,3] 都被污染 → 断线；i=3 起窗口干净恢复读数
  assert.equal(J(out.map(p => p.value)), J([null, null, null, 3.5, 4.5]));
});

test('calcMA：n 大于序列长度 → 全 null（不虚报）', () => {
  const kl = [1, 2, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  assert.equal(J(C.calcMA(kl, 6).map(p => p.value)), J([null, null, null, null, null]));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
