/* zones.test.mjs —— 二级分区判定：纯离线单测（node _test/zones.test.mjs）
   覆盖：可用分区计算 / 导航条显隐阈值 / 分区回落 / 自锁防护。

   这组断言盯的是一个具体的事故模式：分区可见性由两组正交规则决定
   （tab 维度的 hidden + 分区维度的 zone-off）。规则读错一个，症状是
   "分区栏不见了"或"热力图切过去是黑的"，而不是报错，很难在页面上看出来。 */

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

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/zones.js'), 'utf8'), ctx, { filename: 'js/zones.js' });
const Z = ctx.window.Zones;

/* 节点简化成 { zone, hidden }，只带判定需要的两个字段 */
const n = (zone, hidden) => ({ zone, hidden });

await test('可用分区：只看 tab 维度的 hidden，隐藏的块不算这个分区有内容', () => {
  const avail = Z.availability([
    n('overview', false), n('overview', true),
    n('heat', false),
    n('mood', true),
  ]);
  assert.equal(avail.overview, true, '有一个可见块就该算有内容');
  assert.equal(avail.heat, true);
  // 全隐藏的分区要显式记成 false（而不是缺席）——
  // 这样"这个分区存在但当前市场没有"和"这个分区根本不存在"两种情况能分开
  assert.equal(avail.mood, false, '全隐藏的分区该记为 false');
});

await test('可用分区：同名块全隐藏时该分区算不可用', () => {
  const avail = Z.availability([n('disclosure', true), n('disclosure', true)]);
  assert.equal(avail.disclosure, false, '全隐藏的分区必须算不可用');
});

await test('可用分区顺序：按定义顺序排，不按节点出现顺序', () => {
  const keys = Z.keysOf(Z.availability([n('heat', false), n('overview', false)]));
  assert.deepEqual(Array.from(keys), ['overview', 'heat'], '概览必须排第一');
});

await test('导航条：分区少于两个就不显示（一条只有一个选项的导航是噪音）', () => {
  assert.equal(Z.shouldShowBar(['overview']), false);
  assert.equal(Z.shouldShowBar([]), false);
  assert.equal(Z.shouldShowBar(['overview', 'heat']), true);
  assert.equal(Z.shouldShowBar(['overview', 'heat', 'focus']), true);
});

await test('回落：当前分区在新集合里没了就回落到第一个', () => {
  assert.equal(Z.resolveZone(['overview', 'heat'], 'heat'), 'heat', '还在就该保持');
  assert.equal(Z.resolveZone(['overview', 'heat'], 'sentiment'), 'overview', '失效要回落');
  assert.equal(Z.resolveZone([], 'heat'), null, '没有分区时返回 null');
  assert.equal(Z.resolveZone(['focus'], null), 'focus', '没选过时取第一个');
});

await test('自锁防护：可用性判定只读 tab 维度，不读分区维度', () => {
  // 模拟最危险的一种实现：把分区维度也混进 hidden 判定。
  // 若 availability 读了 zone-off 的隐藏态，上一轮分区藏起来的元素
  // 下一轮就会被判成"这个分区没内容"，分区栏随之消失。
  const src = readFileSync(path.join(ROOT, 'js/zones.js'), 'utf8');
  const body = src.slice(src.indexOf('function availability'));
  const fn = body.slice(0, body.indexOf('\n  }'));
  assert.doesNotMatch(fn, /zone-off|zoneIn|classList/, 'availability 不该碰分区维度的 class');
});

await test('定义完整性：五个分区都有标签与提示', () => {
  const keys = Z.ZONE_DEFS.map(d => d.key);
  assert.deepEqual(Array.from(keys), ['overview', 'focus', 'heat', 'sentiment', 'disclosure']);
  for (const d of Z.ZONE_DEFS) {
    assert.ok(d.label, `${d.key} 缺标签`);
    assert.ok(Z.ZONE_HINTS[d.key], `${d.key} 缺提示文案`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
