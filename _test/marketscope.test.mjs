/* marketscope.test.mjs —— 市场维度归属：纯离线单测（node _test/marketscope.test.mjs）
 *   覆盖：市场归一级 tab 所有 / 切换器与标签互斥 / 加密档随合规开关消失。
 *
 * 这组断言盯的是一个具体的事故模式：市场维度在界面上被表达过两次
 * （一级 tab + 热力图工具栏自己的市场按钮），两处都能改，于是打架——
 * 在「A股」tab 下点出美股热力图，标题写着「A股市场」画布却是美股。
 * 规则读错的后果不是报错，而是"内容跟标题对不上"，肉眼极难当场发现。 */

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
vm.runInContext(readFileSync(path.join(ROOT, 'js/marketscope.js'), 'utf8'), ctx, { filename: 'js/marketscope.js' });
const M = ctx.window.MarketScope;

await test('具体市场 tab 各自绑定自己的市场（市场只由一级 tab 表达）', () => {
  assert.equal(M.heatMarketOf('cn', true), 'cn');
  assert.equal(M.heatMarketOf('hk', true), 'hk');
  assert.equal(M.heatMarketOf('us', true), 'us');
  assert.equal(M.heatMarketOf('crypto', true), 'crypto');
});

await test('「全部」页没有单一市场归属（市场由用户自己选）', () => {
  assert.equal(M.heatMarketOf('all', true), null);
});

await test('与行情无关的 tab 不绑市场', () => {
  for (const t of ['fxmacro', 'events', 'chain', 'watch', 'portfolio', 'compare']) {
    assert.equal(M.heatMarketOf(t, true), null, `${t} 不该绑市场`);
  }
});

await test('切换器与市场标签互斥：具体市场页只显示标签，不显示切换器', () => {
  // 切换器可见 = 允许用户在这一屏选市场。具体市场页的市场已由 tab 定死，
  // 此时再给切换器就是"表达两次"，用户能切出与标题不符的画布。
  assert.equal(M.showsMarketSwitcher('cn', true), false, 'A股页不该有市场切换器');
  assert.equal(M.showsMarketSwitcher('hk', true), false);
  assert.equal(M.showsMarketSwitcher('us', true), false);
  assert.equal(M.showsMarketSwitcher('crypto', true), false);
  // 「全部」页没有自己的市场归属，那里切换器是唯一的市场选择入口，必须留着
  assert.equal(M.showsMarketSwitcher('all', true), true, '「全部」页应保留市场切换器');
});

await test('热力图区显隐：行情 tab 有，与行情无关的 tab 没有', () => {
  assert.equal(M.showsHeat('cn', true), true);
  assert.equal(M.showsHeat('all', true), true);
  assert.equal(M.showsHeat('fxmacro', true), false, '宏观页是世行年度指标，不该有热力图');
  assert.equal(M.showsHeat('events', true), false);
  assert.equal(M.showsHeat('portfolio', true), false);
});

await test('加密合规开关关闭时，加密档整体消失', () => {
  assert.equal(M.heatMarketOf('crypto', false), null, '合规关闭时加密页没有市场归属');
  assert.equal(M.showsHeat('crypto', false), false, '合规关闭时不该显示加密热力图');
  assert.equal(M.showsHeat('cn', false), true, '合规关闭不影响其它市场');
});

await test('市场称谓齐全（副标题/标签要用）', () => {
  assert.equal(M.marketTitle('cn'), 'A股全市场');
  assert.equal(M.marketTitle('hk'), '港股全市场');
  assert.equal(M.marketTitle('us'), '美股全市场');
  assert.equal(M.marketTitle('crypto'), '加密市值');
  assert.equal(M.marketLabel('cn'), 'A股');
  assert.equal(M.marketLabel('unknown'), '', '未知市场该回空串而不是 undefined');
});

await test('守卫：市场切换的判定不得读 DOM（纯函数才能单测）', () => {
  const src = readFileSync(path.join(ROOT, 'js/marketscope.js'), 'utf8');
  const body = src.slice(src.indexOf('function heatMarketOf'));
  assert.doesNotMatch(body, /document|querySelector|classList/, '判定不该碰 DOM');
});

/* ---- 源码级回归：防止"市场维度"在别处被重新表达出来 ---- */

const APP = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

await test('app.js 的 switchHeat 必须区分"程序化切换"与"用户手动切换"', () => {
  // 用户手动切换要带 byUser 标记，并在不允许切换的 tab 上被挡下。
  assert.match(APP, /function switchHeat\(mode, byUser\)/, 'switchHeat 应带 byUser 参数');
  assert.match(APP, /byUser && !window\.MarketScope\.showsMarketSwitcher/, '手动切换必须做归属校验');
});

await test('点击工具栏市场按钮必须标记为用户手动切换', () => {
  assert.match(APP, /switchHeat\(heatBtn\.dataset\.heat, true\)/,
    'data-heat 点击必须传 byUser=true');
});

await test('index.html 的热力图市场按钮组必须包在 heatMktSwitch 容器里', () => {
  // 有了容器，app.js 才能在具体市场页把整组撤掉——否则只能逐个按钮禁用，
  // 用户仍会看到一排"不能按/能按"的半吊子按钮。
  assert.match(HTML, /id="heatMktSwitch"/, '缺少市场切换组容器');
  const i = HTML.indexOf('id="heatMktSwitch"');
  const block = HTML.slice(i, HTML.indexOf('</span>', i));
  for (const m of ['cn', 'hk', 'us', 'crypto']) {
    assert.match(block, new RegExp(`data-heat="${m}"`), `切换组里应有 ${m}`);
  }
});

await test('setTab 必须用 MarketScope 决定热力图显隐（不得再写死 tab 列表）', () => {
  assert.match(APP, /MarketScope\.showsHeat\(tab, CRYPTO_ON\)/, '热力图显隐应走 MarketScope');
  assert.match(APP, /MarketScope\.heatMarketOf\(tab, CRYPTO_ON\)/, '热力图市场应走 MarketScope');
  // 旧的写死列表必须消失：它就是"市场维度表达两次"的源头
  assert.doesNotMatch(APP, /!\[.all., .cn., .hk., .us., .crypto.\]\.includes\(tab\)/,
    'setTab 里不该再写死热力图的 tab 列表');
});

await test('具体市场页必须显示市场标签（说明"这张热力图是谁的"）', () => {
  assert.match(HTML, /id="heatMktTag"/, '缺少市场标签元素');
  assert.match(APP, /heatMktTag\.textContent = heatMkt/, '市场标签应写入当前市场名');
});

/* ---- 数据源告警的相关性 ----
   事故模式：页脚告警统计**所有**源的失败，于是产业链页数据完全正常、
   只因 A 股全市场源降级就飘一条红字。与眼前数据无关的告警是噪音，
   真出事时反而被稀释。 */

await test('告警只报与当前页相关的源（产业链页不该被 A 股全市场源的降级打扰）', () => {
  const items = [
    ['tencent', { ok: true }],
    ['em-clist', { ok: false, msg: 'x' }],   // A 股全市场降级
    ['em-board', { ok: true }],
  ];
  // 产业链页只用 em-board/tencent/eastmoney → em-clist 与本页无关，不该报
  assert.deepEqual(Array.from(M.failingSources(items, 'chain')), []);
  // A 股页用了 em-clist → 该报
  assert.deepEqual(Array.from(M.failingSources(items, 'cn')), ['em-clist']);
});

await test('告警：正常源不报，失败的相关源要报', () => {
  const items = [
    ['tencent', { ok: true }],
    ['eastmoney', { ok: false }],
    ['lhb', { ok: false }],
  ];
  assert.deepEqual(Array.from(M.failingSources(items, 'cn')), ['eastmoney', 'lhb']);
  assert.deepEqual(Array.from(M.failingSources(items, 'hk')), ['eastmoney'],
    '港股页不用 lhb，不该报龙虎榜');
});

await test('告警：搜索是全局源，任何页坏了都该提示', () => {
  const items = [['em-search', { ok: false }]];
  for (const tab of ['cn', 'chain', 'events', 'compare', 'watch']) {
    assert.deepEqual(Array.from(M.failingSources(items, tab)), ['em-search'],
      `${tab} 页应提示搜索源异常`);
  }
});

await test('告警：未知 tab 不筛（宁可多报不漏报）', () => {
  const items = [['whatever', { ok: false }]];
  assert.deepEqual(Array.from(M.failingSources(items, '不存在的tab')), ['whatever']);
});

await test('告警：空条目/空数组不崩', () => {
  assert.deepEqual(Array.from(M.failingSources(null, 'cn')), []);
  assert.deepEqual(Array.from(M.failingSources([], 'cn')), []);
  assert.deepEqual(Array.from(M.failingSources([['x', null]], 'cn')), [],
    '状态为 null 不该当成失败');
});

await test('告警：renderStatus 必须用相关源判定（不得再统计全部源）', () => {
  assert.match(APP, /MarketScope\.failingSources\(items, state\.tab\)/,
    'renderStatus 应按当前 tab 过滤失败源');
  assert.doesNotMatch(APP, /const bad = items\.filter\(\(\[, v\]\) => !v\.ok\)/,
    '不该再统计全部源的失败');
});

await test('健壮性：renderStatus 挂了不许中断 setTab（曾把标题与内容搞成对不上）', () => {
  // 真实事故：MarketScope 缺一个函数 → renderStatus 抛错 → setTab 在设置标题之前就断了，
  // 结果"点了 A股 tab 但页面标题还是全球市场"，整屏对不上。
  // renderStatus 是纯展示层，必须自己吞掉异常。
  const body = APP.slice(APP.indexOf('function renderStatus'));
  const fn = body.slice(0, body.indexOf('\n  }'));
  assert.match(fn, /try\s*\{/, 'renderStatus 内部要有 try 保护');
  assert.match(fn, /catch\s*\{/, 'renderStatus 内部要吞掉异常');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
