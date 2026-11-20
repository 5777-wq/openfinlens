/* core/bridge/iife.mjs：ESM → window 桥接契约。
   老视图零改动接入的保险丝：契约漂移（改名/缺函数）在这里红，而不是到 Phase 4 才炸。
   用法：node _test/core-bridge.test.mjs（纯离线） */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}
const APPROX = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const B = await imp('core/bridge/iife.mjs');

await test('installOn(普通对象)：挂出 OpenFinCore 与 Technical 两个命名空间', () => {
  const target = {};
  const core = B.installOn(target);
  assert.equal(core, target.OpenFinCore);
  assert.ok(target.OpenFinCore && target.OpenFinCore.engine);
  assert.ok(target.Technical);
  assert.equal(target.OpenFinCore.version, B.BRIDGE_VERSION);
});

await test('契约快照：engine 键集合固定（改名即红，防 Phase 4 接入时静默缺件）', () => {
  const target = {};
  B.installOn(target);
  assert.deepEqual(Object.keys(target.OpenFinCore.engine).sort(), [
    'atr', 'boll', 'emaSeries', 'etNow', 'evaluate', 'kdj', 'lastClosedDate',
    'macd', 'maSystem', 'resampleWeekly', 'rsi', 'rsiSeries', 'rsiSnap',
    'splitClosed', 'stalenessGate', 'summarize',
    'smaSeries', 'tradingDaysBetween', 'tunnelEvent', 'tunnelPos', 'tunnelSnap',
    'volumeRatio', 'weekEndOf',
  ].sort());
  assert.deepEqual(Object.keys(target.Technical).sort(), [
    'atr', 'boll', 'emaSeries', 'kdj', 'macd', 'maSystem', 'rsi', 'smaSeries',
    'volumeRatio',
  ].sort());
});

await test('同口径验证：桥接面的 rsi 与 core 直连结果一致（Wilder）', async () => {
  const target = {};
  B.installOn(target);
  const closes = [5, 6, 5, 6, 7, 6, 7, 8];
  assert.ok(APPROX(target.Technical.rsi(closes, 2), target.OpenFinCore.engine.rsiSeries(closes, 2).at(-1)));
  const core2 = await imp('core/engine/indicators.mjs');
  assert.ok(APPROX(target.Technical.rsi(closes, 2), core2.rsi(closes, 2)));
});

await test('桥接函数真的能算：kdj/boll/resampleWeekly 走一遍', () => {
  const target = {};
  B.installOn(target);
  const k = target.Technical.kdj([{ high: 10, low: 8, close: 9 }, { high: 12, low: 9, close: 11 }], 2);
  assert.ok(APPROX(k.k, 58.3333, 0.001));
  const w = target.OpenFinCore.engine.resampleWeekly([
    ['2026-01-05', 10, 11, 12, 9, 100], ['2026-01-07', 11, 13, 14, 10, 50],
  ]);
  assert.equal(w.length, 1);
  assert.equal(w[0][0], '2026-01-09');
});

await test('幂等：重复 installOn 覆盖同键，不累积不报错', () => {
  const target = {};
  B.installOn(target);
  B.installOn(target);
  assert.deepEqual(Object.keys(target.OpenFinCore.engine).length,
    Object.keys(B.installOn(target).engine).length);
});

console.log('\n===== 汇总 =====');
console.log(`共 ${pass + fail} 组断言块：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
