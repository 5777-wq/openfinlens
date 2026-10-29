/* tabscope.test.mjs —— 顶栏板块顺序/显隐：纯离线单测（node _test/tabscope.test.mjs）
 *
 * 盯的是一个具体的退化模式：用户把顶栏改到只剩一个板块、
 * 或者把「全部」藏了/挪走了 —— 那时顶栏要么退化成单按钮（导航没意义），
 * 要么"总览"这个唯一的入口消失了（用户找不到回来的路）。
 * 这些约束必须在纯函数里钉住，不能靠 DOM 兜底。 */

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

const ctx = vm.createContext({ console, Math, JSON, Array, Object, Set, Map, isNaN, parseInt, String, Number });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/tabscope.js'), 'utf8'), ctx, { filename: 'js/tabscope.js' });
const T = ctx.window.TabScope;

await test('默认：全部板块可见且「全部」在最前', () => {
  const keys = T.visibleTabs(null, true);
  assert.equal(keys[0], 'all', '「全部」必须排第一');
  assert.equal(keys.length, T.TAB_DEFS.length, '默认应全部可见');
});

await test('加密板块受合规开关控制：关掉后既不可见也不在顺序里', () => {
  const withCrypto = T.visibleTabs(null, true);
  assert.ok(withCrypto.includes('crypto'), '合规开着时加密可见');
  const noCrypto = T.visibleTabs(null, false);
  assert.ok(!noCrypto.includes('crypto'), '合规关掉时加密不可见');
  assert.ok(!T.normalize(null, false).order.includes('crypto'), '合规关掉时加密连顺序里都没有');
});

await test('顺序：按用户配置排，未列出的按默认顺序追加在后面', () => {
  const keys = T.visibleTabs({ order: ['us', 'cn'] }, true);
  // 「全部」强制置顶，其余按用户顺序
  assert.equal(keys[0], 'all', '「全部」必须被强制置顶');
  assert.equal(keys[1], 'us', '用户排的第一项应紧随「全部」');
  assert.equal(keys[2], 'cn', '用户排的第二项在其次');
  assert.equal(keys[3], 'hk', '未列出的按默认顺序追加在后面');
});

await test('「全部」永远可见且永远第一位（用户不能藏它、也不能把它挪走）', () => {
  const n = T.normalize({ order: ['us', 'cn', 'all'], hidden: ['all'] }, true);
  assert.equal(n.order[0], 'all', '「全部」被强制置顶');
  assert.ok(n.hidden.indexOf('all') < 0, '「全部」不可隐藏');
  assert.equal(T.visibleTabs({ hidden: ['all'] }, true)[0], 'all');
});

await test('隐藏：按配置过滤，其余照常', () => {
  const keys = T.visibleTabs({ hidden: ['fxmacro', 'chain'] }, true);
  assert.ok(!keys.includes('fxmacro'));
  assert.ok(!keys.includes('chain'));
  assert.ok(keys.includes('events'));
  assert.equal(keys.length, T.TAB_DEFS.length - 2);
});

await test('隐藏到只剩一个可见板块时拒绝（单按钮顶栏没有导航意义）', () => {
  const n = T.normalize({ hidden: ['cn', 'hk', 'us', 'crypto', 'fxmacro', 'option', 'events', 'chain', 'watch', 'portfolio', 'compare'] }, true);
  assert.equal(n.hidden.length, 0, '不该允许藏到只剩「全部」');
  assert.equal(T.visibleTabs({ hidden: ['cn', 'hk', 'us', 'crypto', 'fxmacro', 'option', 'events', 'chain', 'watch', 'portfolio', 'compare'] }, true).length, T.TAB_DEFS.length);
});

await test('非法配置被清理：未知 key 丢弃、重复去重', () => {
  const n = T.normalize({ order: ['us', 'us', '不存在的tab', 'cn'], hidden: ['假的tab', 'us'] }, true);
  assert.equal(n.order.filter(k => k === 'us').length, 1, '重复 key 只留一个');
  assert.ok(!n.order.includes('不存在的tab'), '未知 key 丢掉');
  assert.ok(!n.hidden.includes('假的tab'), '隐藏集合里的未知 key 丢掉');
  assert.ok(n.hidden.includes('us'), '合法的隐藏项保留');
});

await test('移动：上移/下移相邻位，「全部」不被越过', () => {
  const order = T.DEFAULT_ORDER.slice();       // [all, cn, hk, us, crypto, ...]
  const up = T.move(order, 'us', -1);           // us 从 index3 上移到 index2
  assert.equal(up.indexOf('us'), 2, 'us 上移一位');
  assert.equal(up.indexOf('hk'), 3, 'hk 被挤后一位');
  const down = T.move(order, 'cn', 1);          // cn 从 index1 下移到 index2
  assert.equal(down.indexOf('cn'), 2, 'cn 下移一位');
  // 「全部」在 0 位，谁都不许越过它
  const tryFirst = T.move(order, 'cn', -1);
  assert.equal(tryFirst.indexOf('all'), 0, '「全部」仍在首位');
  assert.equal(tryFirst.indexOf('cn'), 1, 'cn 移到第 2 位（紧邻「全部」），不被越到首位');
});

await test('移动：已在首位/末位时不动', () => {
  const order = T.DEFAULT_ORDER.slice();
  assert.deepEqual(Array.from(T.move(order, 'all', -1)), Array.from(order), '「全部」不可上移');
  const last = order[order.length - 1];
  assert.deepEqual(Array.from(T.move(order, last, 1)), Array.from(order), '末位不可下移');
});

await test('切换显隐：可来回切换；「全部」不可藏', () => {
  let hidden = [];
  hidden = T.toggleHidden({ order: [], hidden }, 'fxmacro', true);
  assert.ok(hidden.includes('fxmacro'), '第一次点击应隐藏');
  hidden = T.toggleHidden({ order: [], hidden }, 'fxmacro', true);
  assert.ok(!hidden.includes('fxmacro'), '第二次点击应恢复');
  const h2 = T.toggleHidden({ order: [], hidden: [] }, 'all', true);
  assert.ok(!h2.includes('all'), '「全部」不可隐藏');
});

await test('切换显隐：藏到不足两个可见时拒绝', () => {
  const base = { order: T.DEFAULT_ORDER.slice(), hidden: [] };
  const many = ['cn', 'hk', 'us', 'crypto', 'fxmacro', 'option', 'events', 'chain', 'watch', 'portfolio', 'compare'];
  let hidden = [];
  for (const k of many) hidden = T.toggleHidden({ order: base.order, hidden }, k, true);
  // 逐步藏，最后一次应该被拒（只剩「全部」）
  assert.ok(hidden.length < many.length, '应该有某一步被拒绝');
  assert.ok(hidden.length <= many.length - 1);
});

await test('每个板块都有中文标签（设置项里显示）', () => {
  for (const d of T.TAB_DEFS) {
    assert.ok(d.label, `${d.key} 缺标签`);
    assert.equal(T.labelOf(d.key), d.label);
  }
  assert.equal(T.labelOf('不存在'), '不存在', '未知 key 原样返回');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
