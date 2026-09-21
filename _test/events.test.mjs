/* events.js 事件数据模型 + bus.js 事件总线：纯离线单测（node _test/events.test.mjs）
   覆盖：去重键稳定性 / normalize 清洗与排序 / 地理聚类 / 标的映射 / 时间语义
   (publishedAt→日K日期、龙虎榜披露日) / 新鲜度 / Bus on-emit-off。 */

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

function loadModule(rel, globalName) {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, RegExp, Set, Map });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return ctx.window[globalName];
}

const EV = loadModule('js/events.js', 'Events');
const BUS = loadModule('js/bus.js', 'Bus');

const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 8, 9, 8, 0, 0);   // 2026-09-09 08:00 UTC

await test('dedupeKey：不同媒体对同一事件的标题归一为同键', () => {
  const a = EV.dedupeKey('Fed cuts rates by 25bps, signals more to come!');
  const b = EV.dedupeKey('FED CUTS RATES BY 25BPS, SIGNALS MORE TO COME');
  assert.equal(a, b);
  assert.notEqual(a, EV.dedupeKey('totally different headline'));
  assert.equal(EV.dedupeKey(''), '');
});

await test('dedupeKey：第 9-10 词分岔或数字不同的两条新闻不得同键（20260921）', () => {
  // 前 8 词相同、词尾事实相反的实例（旧键会把增产说成减产、整条误删）
  assert.notEqual(
    EV.dedupeKey('Oil falls as demand worries grow despite OPEC cuts'),
    EV.dedupeKey('Oil falls as demand worries grow despite OPEC output boost'),
  );
  // 数字进键：加息幅度不同的两条不是同一件事
  assert.notEqual(
    EV.dedupeKey('Fed hikes rates by 25 basis points'),
    EV.dedupeKey('Fed hikes rates by 50 basis points'),
  );
});

await test('normalize：清洗无效条目、去重、按时间倒序、坏坐标置 null', () => {
  const raw = [
    { type: 'macro', title: 'Inflation cools in US', publishedAt: T0 - HOUR, lat: 38.9, lng: -77.04, source: 'reuters.com', importance: 'high', relatedSymbols: ['usINX'] },
    { type: 'macro', title: 'INFLATION COOLS IN US', publishedAt: T0 - 2 * HOUR },                       // 重复 → 丢弃
    { type: 'unknown', title: 'no time entry', publishedAt: '' },                                        // 无时间 → 丢弃
    { type: 'trade', title: 'Tariffs on China chips', publishedAt: T0, lat: 'not-a-number', lng: null }, // 坐标坏 → null
    { type: 'market', title: 'Quake hits nowhere', publishedAt: T0, lat: null, lng: null },              // 字面 null → null（+null===0 陷阱）
    { type: 'trade', title: 'Old news', publishedAt: T0 - 5 * HOUR },
  ];
  const out = EV.normalize(raw);
  assert.equal(out.length, 4);
  assert.equal(out[0].title, 'Tariffs on China chips');        // 最新在前（同刻保持稳定序）
  assert.equal(out[1].title, 'Quake hits nowhere');
  assert.equal(out[1].lat, null);                              // 字面 null 不许变 (0,0)
  assert.equal(out[1].lng, null);
  assert.equal(out[0].lat, null);                              // 坏坐标不猜测
  assert.equal(out[0].type, 'trade');
  assert.equal(EV.normalize(null).length, 0);
});

await test('cluster：远处聚合、bucket=0 不聚合、代表事件取重要度最高', () => {
  const evs = EV.normalize([
    { type: 'macro', title: 'beijing a', publishedAt: T0, lat: 39.9, lng: 116.4, importance: 'low' },
    { type: 'trade', title: 'beijing b', publishedAt: T0 - HOUR, lat: 40.1, lng: 116.6, importance: 'high' },
    { type: 'market', title: 'london c', publishedAt: T0 - HOUR, lat: 51.5, lng: -0.1, importance: 'med' },
  ]);
  const merged = EV.cluster(evs, 12);
  assert.equal(merged.length, 2);
  const bj = merged.find(c => c.count === 2);
  assert.ok(bj, '北京两事件应聚合');
  assert.equal(bj.evs[0].importance, 'high');   // high 者为代表
  const raw0 = EV.cluster(evs, 0);
  assert.equal(raw0.length, 3);
});

await test('matchSymbols：标题关键词 → 内部标的（只映射真实存在的）', () => {
  assert.ok(EV.matchSymbols('Fed decision hits S&P 500 futures').includes('usINX'));
  assert.ok(EV.matchSymbols('Tariffs on China exports').includes('sh000001'));
  assert.ok(EV.matchSymbols('Bitcoin ETF inflows').includes('BTCUSDT'));
  assert.ok(EV.matchSymbols('USDCNH steady as PBOC sets fix').includes('EM:133.USDCNH'));
  assert.deepEqual(EV.matchSymbols('Random local news about cats'), []);
  // US 缩写大小写敏感（20260921）：小写代词 us 不误挂美股，U.S. 与大写 US 照常
  assert.ok(!EV.matchSymbols('Markets give us a warning on inflation').includes('usINX'));
  assert.ok(EV.matchSymbols('U.S. futures edge higher').includes('usINX'));
  assert.ok(EV.matchSymbols('US futures edge higher').includes('usINX'));
});

await test('时间语义：publishedAt → UTC 日期；龙虎榜披露日按上海 17:00 界', () => {
  assert.equal(EV.dayOf(Date.UTC(2026, 8, 9, 23, 30)), '2026-09-09');
  assert.equal(EV.dayOf(null), null);
  // 2026-09-11 是周五：上海 18:00 → 当日；周六 → 回退周五；周三 10:00 → 回退周二
  assert.equal(EV.latestLhbDate(Date.UTC(2026, 8, 11, 10, 0)), '2026-09-11');
  assert.equal(EV.latestLhbDate(Date.UTC(2026, 8, 12, 3, 0)), '2026-09-11');
  assert.equal(EV.latestLhbDate(Date.UTC(2026, 8, 9, 2, 0)), '2026-09-08');
  assert.equal(EV.latestLhbDate(Date.UTC(2026, 8, 13, 5, 0)), '2026-09-11');   // 周日 → 周五
});

await test('toChartEvent：marker 带类型色与短标签，坏时间返回 null', () => {
  const ev = EV.normalize([{ type: 'central_bank', title: 'FOMC day', publishedAt: T0 }])[0];
  const ce = EV.toChartEvent(ev);
  assert.equal(ce.time, '2026-09-09');
  assert.equal(ce.text, '央行');
  assert.ok(ce.color && ce.color.startsWith('#'));
  assert.equal(EV.toChartEvent({ publishedAt: null }), null);
});

await test('isStale：无 generatedAt 即滞后，超龄滞后', () => {
  assert.equal(EV.isStale(null, 1000, T0), true);
  assert.equal(EV.isStale(T0 - 500, 1000, T0), false);
  assert.equal(EV.isStale(T0 - 5000, 1000, T0), true);
});

await test('bus：on/emit/off，监听器抛错不炸其他监听器', () => {
  let hits = 0;
  const inc = () => { hits++; };
  BUS.on('t', () => { throw new Error('boom'); });   // 坏监听器先注册
  const offInc = BUS.on('t', inc);
  BUS.emit('t', {});
  assert.equal(hits, 1);        // 抛错的被吞掉，计数器照常跑
  offInc();
  BUS.emit('t', {});
  assert.equal(hits, 1);        // off 生效，不再计数
});

await test('宏观映射 matchRelated：Fed→美股/美债/黄金/BTC 全部标 RELATED（相关≠因果）', () => {
  const rel = EV.matchRelated('Fed signals rate cut in September');
  assert.ok(rel.some(r => r.sym === 'usINX'));
  assert.ok(rel.some(r => r.sym === 'EM:101.GC00Y'));
  assert.ok(rel.some(r => r.sym === 'BTCUSDT'));
  rel.forEach(r => assert.equal(r.rel, 'RELATED'));
  assert.equal(EV.matchRelated('local bakery opens new branch').length, 0);
  // normalize：relatedAssets 采集层直采优先，否则按标题现算
  const ev = EV.normalize([{ type: 'macro', title: 'ECB meeting', publishedAt: T0 }])[0];
  assert.ok(ev.relatedAssets.some(r => r.sym === 'EM:119.EURUSD'));
});

await test('龙虎榜行映射：secidOf 沪深前缀正确（镜像 tencentOfSecid）', async () => {  const src = readFileSync(path.join(ROOT, 'js/sources/lhb.js'), 'utf8');
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, URLSearchParams, RegExp, Set });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx, { filename: 'js/sources/lhb.js' });
  const Lhb = ctx.window.LhbSource;
  assert.equal(Lhb.secidOf({ MARKET: 'SH', SECURITY_CODE: '600519' }), '1.600519');
  assert.equal(Lhb.secidOf({ MARKET: 'SZ', SECURITY_CODE: '000620' }), '0.000620');
});

await test('events.js 无建议性用语、无 NaN 毒化（铁律正则）', () => {
  const src = readFileSync(path.join(ROOT, 'js/events.js'), 'utf8');
  assert.doesNotMatch(src, /建议买入|建议卖出|买入评级|卖出评级/);
  const ev = EV.normalize([{ type: 'macro', title: 'x', publishedAt: T0, lat: NaN, lng: Infinity }])[0];
  assert.equal(ev.lat, null);
  assert.equal(ev.lng, null);
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  // Windows 下给 libuv 留出清理 keep-alive socket 的时间，避免退出时 libuv 断言
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
}, 50);
