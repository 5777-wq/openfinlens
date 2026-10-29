/* us-indexes.test.mjs —— 美股三大指数成分表：纯离线单测（node _test/us-indexes.test.mjs）
   覆盖：清单规模与格式 / 去重 / 归一化匹配（BRK.B ↔ BRKB）/ filter·includes 行为 /
   LABELS 键完整性 / 结构事实（道指30 ⊂ 标普500，2026-10 复核时成立）。
   这层数据错了的症状是"指数里缺了一只票"——用户看不出缺，但图和事实不符，
   所以规模用精确值钉死：刷新清单时必须连本文件一起改。 */

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

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, RegExp, Set, Map, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/us-indexes.js'), 'utf8'), ctx, { filename: 'js/data/us-indexes.js' });
const U = ctx.window.US_INDEXES;

const SYM_RE = /^[A-Z][A-Z0-9.\-]{0,6}$/;

await test('清单规模：标普500=503 / 道指30=30 / 纳指100=101（刷新数据必须连测试一起改）', () => {
  assert.equal(U.LISTS.sp500.length, 503, '标普500 应为 503 只（多类股计多行）');
  assert.equal(U.LISTS.dj30.length, 30, '道指应恰好 30 只');
  assert.equal(U.LISTS.ndx100.length, 101, '纳指100 应为 101 只');
});

await test('清单格式：全部是合法美股代码（A-Z 开头，≤7 位，可含点和横线）', () => {
  for (const key of ['sp500', 'dj30', 'ndx100']) {
    U.LISTS[key].forEach(s => {
      assert.ok(SYM_RE.test(s), `${key} 里的「${s}」不是合法代码格式`);
    });
  }
});

await test('清单去重：三张表内部均无重复代码', () => {
  for (const key of ['sp500', 'dj30', 'ndx100']) {
    const uniq = new Set(U.LISTS[key]);
    assert.equal(uniq.size, U.LISTS[key].length, `${key} 存在重复代码`);
  }
});

await test('归一化：去点去横线、统一大写（BRK.B ↔ BRK-B ↔ brk.b → BRKB）', () => {
  assert.equal(U.norm('BRK.B'), 'BRKB');
  assert.equal(U.norm('BRK-B'), 'BRKB');
  assert.equal(U.norm('brk.b'), 'BRKB');
  assert.equal(U.norm(''), '');
  assert.equal(U.norm(null), '');
  assert.equal(U.norm(undefined), '');
});

await test('includes：多类股写法互认（sp500 认 BRK.B 也认 BRKB）', () => {
  assert.equal(U.includes('sp500', 'BRK.B'), true, 'BRK.B 应在标普500');
  assert.equal(U.includes('sp500', 'BRKB'), true, '归一化后的 BRKB 也应命中');
  assert.equal(U.includes('dj30', 'NVDA'), true, 'NVDA 应在道指');
  assert.equal(U.includes('dj30', 'TSLA'), false, 'TSLA 不在道指');
  assert.equal(U.includes('all', 'ANYTHING'), true, 'all 恒不过滤');
  assert.equal(U.includes('no-such-key', 'AAPL'), true, '未知 key 不过滤');
});

await test('filter：按归一化键过滤行、保留行对象引用（东财行原样传递）', () => {
  const rows = [
    { code: 'AAPL', name: '苹果' },
    { code: 'brk.b', name: '伯克希尔B' },
    { code: '600519', name: '贵州茅台' },
    { code: '', name: '空代码' },
    null,
  ];
  const out = U.filter(rows, 'dj30');
  assert.equal(out.length, 1, '道指只应命中 AAPL');
  assert.equal(out[0].name, '苹果', '命中的应是原行对象');
  const out2 = U.filter(rows, 'sp500');
  assert.equal(out2.length, 2, '标普应命中 AAPL + brk.b（写法差异互认）');
  assert.equal(U.filter(rows, 'all').length, 5, 'all 原样返回（含 null）');
});

await test('LABELS：键与 LISTS 对齐，且多一个 all', () => {
  assert.equal(U.LABELS.all, '全部');
  assert.equal(U.LABELS.sp500, '标普500');
  assert.equal(U.LABELS.dj30, '道指30');
  assert.equal(U.LABELS.ndx100, '纳指100');
  assert.equal(Object.keys(U.LABELS).length, 4, '恰好 4 个键');
});

await test('结构事实：道指30 全部在标普500 里（2026-10 复核成立，被打破=数据有误）', () => {
  const sp = new Set(U.LISTS.sp500.map(U.norm));
  const missing = U.LISTS.dj30.filter(s => !sp.has(U.norm(s)));
  assert.equal(missing.join(','), '', `道指成员不在标普500：${missing.join(',')}`);
});

await test('抽查：纳指100 含双类股（GOOGL+GOOG）与新面孔（SPCX/HONA/HON），不含 NYSE 老牌（KO/JNJ）', () => {
  const ndx = new Set(U.LISTS.ndx100.map(U.norm));
  for (const s of ['GOOGL', 'GOOG', 'SPCX', 'HONA', 'HON', 'MSTR']) {
    assert.ok(ndx.has(U.norm(s)), `纳指100 应含 ${s}`);
  }
  for (const s of ['KO', 'JNJ', 'PG']) {
    assert.equal(ndx.has(U.norm(s)), false, `纳指100 不应含 NYSE 的 ${s}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
