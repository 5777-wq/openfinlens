/* treemap.test.mjs —— 热力图：色带区间与取色（纯离线单测）
   覆盖：区间边界归属 / 区间连续无缝 / 无涨跌幅不算入区间 / 图例取色。

   为什么盯边界：图例是筛选器，区间归属差 0.01% 就会把"刚好 2% 的票"
   归错档，用户点掉一段却发现少了几只说不清的票。边界值（-3 / -2 / -1 / 0 / 1 / 2 / 3）
   的归属必须钉死。 */

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

const ctx = vm.createContext({
  console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array,
  // treemap 的 refreshColors 读 CSS 变量，Node 里没有，给个最小桩
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  document: { documentElement: {}, body: {} },
});
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/treemap.js'), 'utf8'), ctx, { filename: 'js/treemap.js' });
const T = ctx.window.Treemap;

const B = T.PCT_BANDS;

await test('色带：8 档，覆盖 -3% 到 +3% 且两端为开区间', () => {
  assert.equal(B.length, 8, '应为 8 段');
  assert.equal(B[0].lo, -Infinity, '第一段应从 -∞ 开始');
  assert.equal(B[B.length - 1].hi, Infinity, '最后一段应到 +∞');
  assert.equal(B[0].hi, -3);
  assert.equal(B[B.length - 1].lo, 3);
});

await test('色带：相邻区间首尾相接（无缝隙、无重叠）', () => {
  for (let i = 0; i < B.length - 1; i++) {
    assert.equal(B[i].hi, B[i + 1].lo, `第 ${i} 段的上界应等于第 ${i + 1} 段的下界`);
  }
});

await test('色带：边界值归属明确（-3 归第二段，0 归第五段，3 归最后一段）', () => {
  const key = (p) => B[T.bandOf(p)].key;
  assert.equal(key(-3.01), 'b0', '-3.01% 应在 ≤-3% 段');
  assert.equal(key(-3), 'b1', '-3% 应归 -3~-2% 段（左闭右开）');
  assert.equal(key(-2.5), 'b1');
  assert.equal(key(-2), 'b2', '-2% 应归 -2~-1% 段');
  assert.equal(key(-0.01), 'b3', '-0.01% 应归 -1~0% 段');
  assert.equal(key(0), 'b4', '0% 应归 0~+1% 段');
  assert.equal(key(0.01), 'b4');
  assert.equal(key(2.99), 'b6');
  assert.equal(key(3), 'b7', '3% 应归 ≥+3% 段');
  assert.equal(key(3.01), 'b7');
});

await test('色带：极端涨跌幅（涨跌停、暴涨暴跌）都落在两端', () => {
  assert.equal(B[T.bandOf(-10)].key, 'b0');
  assert.equal(B[T.bandOf(10)].key, 'b7');
  assert.equal(B[T.bandOf(-100)].key, 'b0');
  assert.equal(B[T.bandOf(100)].key, 'b7');
});

await test('色带：没有涨跌幅的不算入任何一段（停牌/缺数据）', () => {
  assert.equal(T.bandOf(null), null);
  assert.equal(T.bandOf(undefined), null);
  assert.equal(T.bandOf(NaN), null);
  assert.equal(T.bandOf('abc'), null);
});

await test('色带：全量扫描不落空（-50% 到 +50% 每个点都有归属）', () => {
  for (let p = -50; p <= 50; p += 0.13) {
    const i = T.bandOf(p);
    assert.ok(i !== null && i >= 0 && i < B.length, `${p}% 没有落到任何一段`);
  }
});

await test('取色：colorAt 返回可用的 CSS 颜色（不抛）', () => {
  const c = T.colorAt(1.5);
  assert.ok(typeof c === 'string' && c.length > 0, '没拿到颜色');
  assert.match(c, /^(rgb|#)/, '颜色格式不对：' + c);
  // 边界也要能取到色（两端是开区间，用代表值取）
  assert.ok(T.colorAt(B[0].rep), '第一段代表值取不到色');
  assert.ok(T.colorAt(B[B.length - 1].rep), '最后一段代表值取不到色');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
