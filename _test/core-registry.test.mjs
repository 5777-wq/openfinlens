/* core/registry + core/vendor：唯一真源一致性核对。
   红线（手册 §4）：产业链以 academy 较新的 10 链·49 环节·177 股为准，映射零缺口；
   全仓 lightweight-charts 收敛 v4.2.3。双份并存期（Phase 2~4）用本测试防漂移。
   用法：node _test/core-registry.test.mjs（纯离线） */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const R = await imp('core/registry/index.mjs');

await test('产业链唯一真源：10 链 · 49 环节 · 177 只去重成分股（手册红线口径）', () => {
  const chains = R.loadChains();
  assert.equal(chains.length, 10);
  const links = chains.reduce((s, c) => s + (c.links ? c.links.length : 0), 0);
  assert.equal(links, 49);
  const syms = R.chainStockSymbols(chains);
  assert.equal(syms.size, 177);
  const bad = [...syms].filter((s) => !/^(sh|sz|hk|us)/i.test(s));
  assert.deepEqual(bad, [], 'symbol 必须是腾讯格式（sh/sz/hk/us 前缀），异常: ' + bad.slice(0, 3).join(','));
});

await test('产业链与旧路径零漂移：core JSON === js/data/industry-chains.js 语义内容', () => {
  // vm 抽取旧路径的 window.INDUSTRY_CHAINS（vm 沙箱数组过不了 deepStrictEqual，用 JSON 串比较）
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(read('js/data/industry-chains.js'), ctx, { filename: 'js/data/industry-chains.js' });
  const legacy = ctx.window.INDUSTRY_CHAINS;
  assert.ok(Array.isArray(legacy) && legacy.length > 0);
  assert.equal(JSON.stringify(R.loadChains()), JSON.stringify(legacy));
});

await test('候选池三件：可解析、结构完整（sp500/ndx/spmo，Meridian 快照口径）', () => {
  const rowsOf = (j, keys) => (Array.isArray(j) ? j : keys.map((k) => j[k]).find(Array.isArray));
  const sp = R.loadCandidates('sp500');
  assert.ok(sp.asOf, 'sp500 快照必须带 asOf（来源可溯源）');
  const spRows = rowsOf(sp, ['tickers', 'rows', 'list']);
  assert.ok(spRows && spRows.length >= 150, 'SP500 候选池应有 ≥150 只（快照口径 220，实测 ' + (spRows && spRows.length) + '）');
  const ndx = R.loadCandidates('ndx');
  const nRows = rowsOf(ndx, ['tickers', 'rows', 'list']);
  assert.ok(nRows && nRows.length >= 80, 'NDX 候选池应有 ≥80 只（快照口径 103）');
  const spmo = R.loadCandidates('spmo');
  const sRows = rowsOf(spmo, ['holdings', 'rows', 'tickers', 'list']);
  assert.ok(sRows && sRows.length >= 30, 'SPMO 持仓快照应有 ≥30 行（快照口径 40）');
  assert.throws(() => R.loadCandidates('nonsense'), /未知候选池类型/);
});

await test('series-map：可解析且非空（当前快照来自 academy 编译产物）', () => {
  const m = R.loadSeriesMap();
  assert.ok(m && (typeof m === 'object'));
  const n = Object.keys(m).length;
  assert.ok(n > 0, 'series-map 不应为空对象');
});

await test('vendor：lightweight-charts 唯一 canonical = v4.2.3，与 lib/ 现役字节一致', () => {
  const core = read('core/vendor/lightweight-charts.standalone.production.js');
  assert.match(core.slice(0, 200), /Lightweight Charts.*v4\.2\.3/, '头注必须是 v4.2.3');
  assert.equal(core, read('lib/lightweight-charts.standalone.production.js'),
    '过渡期 lib/ 与 core/vendor 必须逐字节一致（Phase 4 切换引用后此断言随旧路径退役）');
});

await test('vendor：d3-geo/d3-array/topojson/THIRD_PARTY 就位', () => {
  for (const f of ['core/vendor/d3-geo.min.js', 'core/vendor/d3-array.min.js',
    'core/vendor/topojson-client.min.js', 'core/vendor/THIRD_PARTY.md']) {
    assert.ok(existsSync(path.join(ROOT, f)), f + ' 缺失');
  }
});

await test('engine/sources 不依赖 window（ESM 纯净性：直接 import 不炸）', () => {
  // 本测试文件能 import 到它们本身就是「无 window 也能加载」的证明；
  // 这里再对源码做静态检查：剥掉注释后不允许出现裸 window/document 引用
  // （桥接 iife.mjs 的注释里提到 window 是合法文档，不算使用）。
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['core/engine/indicators.mjs', 'core/engine/weekly.mjs', 'core/engine/market-time.mjs',
    'core/engine/signals.mjs', 'core/engine/compare.mjs', 'core/bridge/iife.mjs', 'core/bridge/auto.mjs']) {
    const src = stripComments(read(f));
    assert.ok(!/\bwindow\b/.test(src), f + ' 出现裸 window 引用（应通过 installOn(target) 注入）');
    assert.ok(!/\bdocument\b/.test(src), f + ' 出现裸 document 引用');
  }
});

console.log('\n===== 汇总 =====');
console.log(`共 ${pass + fail} 组断言块：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
