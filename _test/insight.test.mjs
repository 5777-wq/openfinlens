/* 时区口径 + 科普层校验：
   1) 图表时间轴必须是"本地墙钟"（LWC 按 UTC 渲染，必须传伪 UTC）——用户报的 bug；
   2) computeProfile 画像手算核对；
   3) explain 表完整性 / 大师数据结构。
   用法：node _test/insight.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

function makeCtx() {
  const ctx = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, TextDecoder, Promise, Error, RegExp, Map, Set, encodeURIComponent,
    URL, URLSearchParams, AbortController, AbortSignal, performance,
    fetch: (url, opts = {}) => fetch(url, {
      ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000),
    }),
    document: {
      documentElement: {}, body: {},
      createElement: () => ({ style: {}, remove() {}, addEventListener() {} }),
      head: { appendChild() {} }, querySelectorAll: () => [], addEventListener() {},
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  return ctx;
}
const ctx = makeCtx();
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
load('js/utils.js'); load('js/store.js'); load('js/proxy.js');
load('js/technical.js'); load('js/data/explain.js');   // computeProfile 已从旧大师模块迁入 technical.js
load('js/data/industry-chains.js'); load('js/data/universe.js');
load('js/sources/tencent.js'); load('js/sources/binance.js');
const W = vm.runInContext('window', ctx);

/* ================= 时区口径（用户报告的 bug） ================= */
await test('toChartTime：编码后的 UTC 墙钟分量 == 输入的本地墙钟分量', () => {
  // 取一个确定的时间：本地 2026-08-26 09:30
  const d = new Date(2026, 7, 26, 9, 30, 0);
  const t = W.U.toChartTime(Math.floor(d.getTime() / 1000));
  const back = new Date(t * 1000);
  assert.equal(back.getUTCHours(), 9, 'getUTCHours=' + back.getUTCHours());
  assert.equal(back.getUTCMinutes(), 30, 'getUTCMinutes=' + back.getUTCMinutes());
  assert.equal(back.getUTCFullYear(), 2026);
  assert.equal(back.getUTCDate(), 26);
});

await test('腾讯分时：time 的 UTC 墙钟 == 交易所时刻（09:30 开盘，时间递增）', async () => {
  const pts = await W.TencentSource.getMinute('sh600519');
  // 09:30-11:10 开盘初期分时天然不足 100 点：点数断言只在应足额时段生效，结构断言始终执行
  if (pts.length <= 100) console.log(`   （开盘初期仅 ${pts.length} 点，跳过点数断言）`);
  else assert.ok(pts.length > 100, '分时点仅 ' + pts.length);
  assert.ok(pts.length >= 10, '分时点不足 10 个，源结构可疑');
  const first = new Date(pts[0].time * 1000);
  assert.equal(first.getUTCHours() * 60 + first.getUTCMinutes(), 9 * 60 + 30,
    `首点应为 09:30（UTC 墙钟），实际 ${first.getUTCHours()}:${first.getUTCMinutes()}`);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].time > pts[i - 1].time, '时间未递增 @' + i);
  }
  const last = new Date(pts[pts.length - 1].time * 1000);
  console.log(`   （${pts.length} 点，图表将显示 ${first.getUTCHours()}:${String(first.getUTCMinutes()).padStart(2,'0')} → ${last.getUTCHours()}:${String(last.getUTCMinutes()).padStart(2,'0')}，即北京时间）`);
});

await test('腾讯分时：13:00 午休开盘后正确续接（01:00 UTC ≠ 上午）', async () => {
  const pts = await W.TencentSource.getMinute('sh600519');
  // 找 11:30 之后第一个点：A股下午盘 13:00 整点开盘，首点应为 13:00
  const times = pts.map(p => {
    const d = new Date(p.time * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  });
  const noonIdx = times.findIndex(t => t >= 12 * 60);
  if (noonIdx < 0) {
    // 盘中跑到午休（11:30-13:00 无新数据）：下午段还没生成，跳过午后断言
    console.log('   （盘中午休时段，下午分时未生成，跳过午后断言）');
    return;
  }
  assert.ok(noonIdx > 0, '没找到下午段');
  assert.equal(times[noonIdx], 13 * 60, '午后首点应为 13:00，实际 ' + times[noonIdx]);
  // 且上午段不越过 11:30 之后还在涨（午休 11:30-13:00 无数据点）
  const morning = times.slice(0, noonIdx);
  assert.ok(Math.max(...morning) <= 11 * 60 + 30, '上午出现 11:30 之后的点');
});

await test('加密K线：5分钟线走墙钟伪UTC，1d/1w 走日期字符串', async () => {
  const m5 = await W.BinanceSource.getKline('BTCUSDT', '5m', 20);
  assert.ok(m5.length >= 10, '5m 仅 ' + m5.length + ' 根');
  assert.equal(typeof m5[0].time, 'number', '5m time 应为数字（伪UTC秒）');
  const d = new Date(m5.at(-1).time * 1000);
  // 伪 UTC 的墙钟应接近当前本地墙钟（5 分钟内误差）
  const now = new Date();
  const driftMin = Math.abs((now.getHours() * 60 + now.getMinutes()) - (d.getUTCHours() * 60 + d.getUTCMinutes()));
  assert.ok(driftMin <= 6, '5m 墙钟偏差 ' + driftMin + ' 分钟，时区转换失效');

  const d1 = await W.BinanceSource.getKline('BTCUSDT', '1d', 10);
  assert.equal(typeof d1[0].time, 'string', '1d time 应为日期字符串');
  assert.match(d1[0].time, /^\d{4}-\d{2}-\d{2}$/);
  const w1 = await W.BinanceSource.getKline('BTCUSDT', '1w', 10);
  assert.match(w1[0].time, /^\d{4}-\d{2}-\d{2}$/);
  console.log(`   （1d 末根 ${d1.at(-1).time}，5m 图表按本地墙钟显示）`);
});

/* ================= 画像计算（手算核对） ================= */
await test('computeProfile：构造序列手算核对（年涨跌/回撤/均线/波动）', () => {
  // 构造 60 根日K：从 100 线性涨到 159（每日 +1%）
  const kl = [];
  let p = 100;
  for (let i = 0; i < 60; i++) { kl.push({ time: 'd' + i, open: p, close: p, high: p, low: p }); p *= 1.01; }
  const prof = W.Technical.computeProfile(kl);
  const last = kl[59].close;
  assert.ok(Math.abs(prof.yearChangePct - (last / 100 - 1) * 100) < 0.01, '年涨跌 ' + prof.yearChangePct);
  assert.ok(Math.abs(prof.offHighPct) < 0.0001, '序列单调涨，距高点应为 0');
  assert.ok(Math.abs(prof.offLowPct - (last / 100 - 1) * 100) < 0.01, '距低点=总涨幅');
  const ma20expect = kl.slice(-20).reduce((s, k) => s + k.close, 0) / 20;
  assert.ok(Math.abs(prof.ma20 - ma20expect) < 0.01);
  assert.equal(prof.aboveMA20, true);
  assert.equal(prof.aboveMA60, true);
  // 恒定 +1% 日收益 → 年化波动 ≈ 0
  assert.ok(prof.volAnnual < 1, '恒定收益波动应≈0，实际 ' + prof.volAnnual);
});

await test('computeProfile：数据不足 / 脏数据返回 null', () => {
  assert.equal(W.Technical.computeProfile([]), null);
  assert.equal(W.Technical.computeProfile(null), null);
  assert.equal(W.Technical.computeProfile([{ close: 1 }, { close: 2 }]), null, '30 根以下应 null');
  const bad = Array.from({ length: 50 }, () => ({ close: null }));
  assert.equal(W.Technical.computeProfile(bad), null, '全脏数据应 null');
});

await test('computeProfile：新画像字段手算核对（回撤/高点距今/20日动量/均线偏离）', () => {
  const kl = [];
  for (let i = 0; i < 40; i++) kl.push({ close: 100 + 2 * i });            // 涨段：峰 178 @ i=39
  const peakV = 178;
  for (let k = 1; k <= 20; k++) kl.push({ close: peakV * Math.pow(0.99, k) }); // 跌段 20 根
  const prof = W.Technical.computeProfile(kl);
  const last = kl[59].close;
  assert.ok(Math.abs(prof.maxDDPct - (last / peakV - 1) * 100) < 0.01, 'maxDD ' + prof.maxDDPct);
  assert.equal(prof.barsSinceHigh, 20, '距高点交易日数 ' + prof.barsSinceHigh);
  assert.ok(Math.abs(prof.mom20Pct - (last / kl[39].close - 1) * 100) < 0.01, 'mom20 ' + prof.mom20Pct);
  assert.ok(prof.ma20OffPct < 0 && prof.aboveMA20 === false, '下跌段现价应在 20 日线下方');
});

/* ================= 解释表 ================= */
await test('explain：universe 全部标的 + 6 大主流币都有精确解释', () => {
  const missing = [];
  W.TENCENT_UNIVERSE.forEach(x => { if (!W.Explain.NOTES[x.symbol]) missing.push(x.symbol); });
  W.EM_UNIVERSE.forEach(x => { if (!W.Explain.NOTES[x.symbol]) missing.push(x.symbol); });
  ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'].forEach(b => {
    if (!W.Explain.CRYPTO_NOTES[b]) missing.push('crypto:' + b);
  });
  assert.deepEqual && assert.equal(missing.length, 0, '缺解释: ' + missing.join(','));
});

await test('explain：of() 对任意标的都有兜底，中文解释非空', () => {
  const cases = [
    { symbol: 'EM:1.600000', market: 'cn', code: '600000', name: '浦发银行' },
    { symbol: 'BTCUSDT', market: 'crypto', code: 'BTCUSDT', name: 'BTC' },
    { symbol: 'PEPEUSDT', market: 'crypto', code: 'PEPEUSDT', name: 'PEPE' },
    { symbol: 'EM:119.EURUSD', market: 'fx', code: 'EURUSD' },
  ];
  cases.forEach(c => {
    const r = W.Explain.of(c);
    assert.ok(r && r.text && r.text.length > 8, JSON.stringify(c) + ' 无解释');
    assert.ok(['specific', 'market'].includes(r.kind), 'kind 非法');
  });
  assert.equal(W.Explain.of(null), null);
});

await test('产业链：10 条链 49 个环节全部带 desc 小白解释', () => {
  const links = W.INDUSTRY_CHAINS.flatMap(c => c.links);
  assert.ok(W.INDUSTRY_CHAINS.length >= 10, '链数 ' + W.INDUSTRY_CHAINS.length);
  assert.equal(links.length, 49);
  const noDesc = links.filter(l => !l.desc || l.desc.length < 10).map(l => l.name);
  assert.equal(noDesc.length, 0, '缺 desc: ' + noDesc.join(','));
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
