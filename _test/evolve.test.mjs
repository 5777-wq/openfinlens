/* 第三轮进化校验：市场时段 / 情绪历史 / sparkline / in-flight 去重。
   用法：node _test/evolve.test.mjs */

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

function makeCtx(extraFetch) {
  const ctx = vm.createContext({
    console, Math, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, Date, JSON, RegExp,
    setTimeout, clearTimeout, Promise, Error, Map, Set, TextDecoder, encodeURIComponent,
    URL, URLSearchParams, AbortController, AbortSignal, performance,
    fetch: extraFetch || ((u, o = {}) => fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) }, signal: AbortSignal.timeout(20000) })),
    Intl,
    document: { documentElement: {}, body: {}, createElement: () => ({ style: {}, remove() {}, addEventListener() {} }), head: { appendChild() {} }, querySelectorAll: () => [], addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  return ctx;
}
const load = (ctx, rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });

/* ================= Sessions：时段纯函数 ================= */
const sctx = makeCtx();
load(sctx, 'js/sessions.js');
const S = vm.runInContext('window.Sessions', sctx);

await test('时段：A股 开盘/午休/收盘/周末 四态', () => {
  // parts: { wd: 1..5 工作日, m: 分钟 }
  assert.equal(S.statusOf('cn', { wd: 3, m: 600 }).code, 'open');     // 周三 10:00
  assert.equal(S.statusOf('cn', { wd: 3, m: 570 }).code, 'open');     // 09:30 边界含
  assert.equal(S.statusOf('cn', { wd: 3, m: 569 }).code, 'closed');   // 09:29
  assert.equal(S.statusOf('cn', { wd: 3, m: 720 }).code, 'lunch');    // 12:00
  assert.equal(S.statusOf('cn', { wd: 3, m: 750 }).label, '午间休市');
  assert.equal(S.statusOf('cn', { wd: 3, m: 779 }).code, 'lunch');    // 12:59
  assert.equal(S.statusOf('cn', { wd: 3, m: 899 }).code, 'open');     // 14:59
  assert.equal(S.statusOf('cn', { wd: 3, m: 900 }).code, 'closed');   // 15:00 收盘含
  assert.equal(S.statusOf('cn', { wd: 0, m: 600 }).code, 'weekend');  // 周日
  assert.equal(S.statusOf('cn', { wd: 6, m: 600 }).code, 'weekend');  // 周六
});

await test('时段：港股午休比A股长；美股无午休；加密全天', () => {
  assert.equal(S.statusOf('hk', { wd: 2, m: 750 }).code, 'lunch');    // 12:30 港股午休
  assert.equal(S.statusOf('us', { wd: 2, m: 750 }).code, 'open');     // 12:30 美股交易中
  assert.equal(S.statusOf('us', { wd: 2, m: 960 }).code, 'closed');   // 16:00 收盘
  assert.equal(S.statusOf('crypto', { wd: 0, m: 100 }).code, 'open'); // 周日凌晨也开
  assert.equal(S.statusOf('crypto', { wd: 0, m: 100 }).label, '24小时');
});

await test('时段：Intl 实时部件 sane（真实时区换算）', () => {
  const cn = S.partsIn('Asia/Shanghai');
  const us = S.partsIn('America/New_York');
  assert.ok(cn && us, 'Intl 部件不可为 null');
  assert.ok(cn.wd >= 0 && cn.wd <= 6 && cn.m >= 0 && cn.m < 1440, 'cn 部件越界');
  assert.ok(us.m >= 0 && us.m < 1440, 'us 部件越界');
  // 上海与纽约的分钟差应反映时区差（12/13 小时，随 DST 浮动）
  const diff = Math.abs(cn.m - us.m);
  const wrapped = Math.min(diff, 1440 - diff);
  assert.ok(wrapped === 12 * 60 || wrapped === 13 * 60, '沪纽时差异常: ' + wrapped / 60 + 'h');
  // 无效 market / null parts → unknown 不抛
  assert.equal(S.statusOf('nope', { wd: 1, m: 600 }).code, 'unknown');
  assert.equal(S.statusOf('cn', null).code, 'unknown');
});

/* ================= Treemap 视口：缩放/拖动数学 ================= */
const tctx = makeCtx();
load(tctx, 'js/treemap.js');
const VP = vm.runInContext('window.Treemap.viewport', tctx);
const VW = 1000, VH = 500;

// 屏↔布局正反演（与 paint/hitTest 同一公式）
const toScreen = (lx, ly, v) => [(lx - v.ox) * v.zoom, (ly - v.oy) * v.zoom];
const toLayout = (sx, sy, v) => [sx / v.zoom + v.ox, sy / v.zoom + v.oy];

await test('拖动：抓取语义——内容跟手（拖右 dx，视口原点左移 dx/zoom）', () => {
  const v = { zoom: 2, ox: 250, oy: 0 };
  VP.applyPan(v, 100, 0, VW, VH);
  assert.equal(v.ox, 200, `拖右 100px @zoom2 应 ox 250→200，实际 ${v.ox}`);
  // 内容确实右移：原先贴左缘的布局点现在应出现在屏幕 x=100
  const lx = toLayout(0, 0, { zoom: 2, ox: 250, oy: 0 })[0];
  const [sx] = toScreen(lx, 0, v);
  assert.equal(sx, 100, '拖右后原左缘内容应出现在屏幕 x=100');
});

await test('缩放：锚点不变性——光标下的布局点缩放前后屏幕位置不动', () => {
  const v0 = { zoom: 1, ox: 0, oy: 0 };
  const px = 700, py = 180;
  const [lx, ly] = toLayout(px, py, v0);
  const v1 = VP.applyZoom({ ...v0 }, px, py, 2, VW, VH);
  const [sx, sy] = toScreen(lx, ly, v1);
  assert.equal(sx, px); assert.equal(sy, py);
  // 已封顶再放大：无效但不 NaN、不移位
  const v2 = { zoom: VP.ZOOM_MAX, ox: 0, oy: 0 };
  VP.applyZoom(v2, px, py, 1.5, VW, VH);
  assert.equal(v2.zoom, VP.ZOOM_MAX);
  assert.ok(Number.isFinite(v2.ox) && Number.isFinite(v2.oy));
});

await test('钳制：ox∈[0, W(1-1/z)]；zoom=1 归零；越界拖动贴边不白屏', () => {
  const v = { zoom: 4, ox: 99999, oy: -50 };
  VP.clamp(v, VW, VH);
  assert.equal(v.ox, VW * (1 - 1 / 4));
  assert.equal(v.oy, 0);
  const v1 = { zoom: 1, ox: 123, oy: 77 };
  VP.clamp(v1, VW, VH);
  assert.equal(v1.ox, 0); assert.equal(v1.oy, 0);
  // 抓取语义：拖右=内容右移=视口看更左边=ox→0；拖左=看更右边=ox→右边界
  const v3 = { zoom: 3, ox: 300, oy: 100 };
  VP.applyPan(v3, 99999, 99999, VW, VH);
  assert.equal(v3.ox, 0); assert.equal(v3.oy, 0);
  const v4 = { zoom: 3, ox: 100, oy: 50 };
  VP.applyPan(v4, -99999, -99999, VW, VH);
  assert.equal(v4.ox, VW * (1 - 1 / 3));
  assert.equal(v4.oy, VH * (1 - 1 / 3));
});

/* ================= Breadth：历史快照 + sparkline ================= */
const bctx = makeCtx();
load(bctx, 'js/breadth.js');
const B = vm.runInContext('window.Breadth', bctx);

await test('情绪历史：逐日 upsert、上限 90、低样本拒收', () => {
  const day = (m, d) => Date.UTC(2026, m, d, 2);   // 2026年m+1月d日 02:00 UTC（本地日期稳定）
  let h = [];
  h = B.recordHistory(h, 50, 5500, day(7, 1));
  h = B.recordHistory(h, 62, 5500, day(7, 1));              // 同日覆盖（收盘后的更准）
  assert.equal(h.length, 1);
  assert.equal(h[0].s, 62);
  assert.equal(h[0].d, '2026-08-01');
  // 用两个自然月推进 120 天，验证封顶与"保留最新"
  for (let i = 0; i < 120; i++) {
    const dt = new Date(day(7, 1) + i * 86400000);
    h = B.recordHistory(h, 30 + (i % 40), 5500, dt.getTime());
  }
  assert.equal(h.length, B.HIST_CAP, '应封顶 ' + B.HIST_CAP + '，实际 ' + h.length);
  assert.equal(h[h.length - 1].d, '2026-11-28');            // 8/1 + 119 天
  assert.equal(h[0].d, '2026-08-31');                       // 最老的被裁掉（8/1+30 天）
  // 低样本拒收：88 只兜底样本不得污染历史
  const h2 = B.recordHistory([{ d: '2026-08-30', s: 40 }], 55, 88, day(7, 31));
  assert.equal(h2.length, 1, '兜底样本不应入库');
  // null score 拒收
  assert.equal(B.recordHistory([], null, 5500, day(7, 1)).length, 0);
  // 传入非数组容错
  assert.equal(B.recordHistory(null, 50, 5500, day(7, 1)).length, 1);
});

await test('sparkline：归一化、缺日断线、<2 点退化', () => {
  const mk = (s) => ({ d: 'x', s });
  const r1 = B.sparkPoints([mk(10), mk(50), mk(90)], 30);
  assert.deepEqual(Array.from(r1.norm, v => +v.toFixed(3)), [0, 0.5, 1]);
  assert.equal(r1.min, 10); assert.equal(r1.max, 90);
  // 中间缺日：null 保留在 pts，norm 同位 null
  const r2 = B.sparkPoints([mk(10), null, mk(30)], 30);
  assert.equal(r2.pts[1], null);
  assert.equal(r2.norm[1], null);
  // 单点 / 空：不渲染
  assert.equal(B.sparkPoints([mk(50)], 30).norm.length, 0);
  assert.equal(B.sparkPoints([], 30).norm.length, 0);
  // 全同值：norm 全 0.5（span 保护）
  const r3 = B.sparkPoints([mk(55), mk(55), mk(55)], 30);
  assert.ok(r3.norm.every(v => Math.abs(v - 0.5) < 1e-9));
  // n 截断：只取最近 n 个
  const long = Array.from({ length: 50 }, (_, i) => mk(i));
  assert.equal(B.sparkPoints(long, 30).pts.length, 30);
  assert.equal(B.sparkPoints(long, 30).min, 20);
});

/* ================= Eastmoney：in-flight 去重 ================= */
await test('全市场去重：并发两次调用只发一轮请求', async () => {
  let clistCalls = 0;
  const ctx = makeCtx((url) => {
    if (String(url).includes('/api/qt/clist/get')) {
      clistCalls++;
      const body = JSON.stringify({
        data: { total: 1, diff: [
          { f2: 10, f3: 1, f4: 0.1, f5: 100, f6: 1e6, f12: '600001', f13: 1, f14: '股', f20: 1e9 },
        ] },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  });
  load(ctx, 'js/utils.js'); load(ctx, 'js/store.js'); load(ctx, 'js/proxy.js'); load(ctx, 'js/sources/eastmoney.js');
  const EM = vm.runInContext('window.EastmoneySource', ctx);

  // total=1 → 单页。无去重时两次并发调用会发 2 次首页请求；去重后只应 1 次。
  const [a, b] = await Promise.all([EM.getFullMarket(), EM.getFullMarket()]);
  assert.equal(a.length, 1);
  assert.deepEqual(a.map(x => x.code), b.map(x => x.code), '两次调用应拿到同一份结果');
  assert.equal(clistCalls, 1, '并发共享同一 Promise，实际发请求 ' + clistCalls + ' 次');
  // 去重后仍要防分页位移重复（用户已加的逻辑不被破坏）
  const c = await EM.getFullMarket();   // inflight 已清空 → 新一轮
  assert.equal(c.length, 1);
  assert.equal(clistCalls, 2, '结束后新调用应发起新请求');
});

await test('全市场去重：失败后 inflight 释放，下次调用重试而不是拿到失败结果', async () => {
  let fail = true;
  const ctx = makeCtx((url) => {
    if (String(url).includes('/api/qt/clist/get')) {
      if (fail) return Promise.reject(new Error('down'));
      return Promise.resolve(new Response(JSON.stringify({ data: { total: 1, diff: [
        { f2: 10, f3: 1, f4: 0.1, f5: 100, f6: 1e6, f12: '600001', f13: 1, f14: '股', f20: 1e9 },
      ] } }), { status: 200 }));
    }
    return Promise.reject(new Error('ignore'));
  });
  load(ctx, 'js/utils.js'); load(ctx, 'js/store.js'); load(ctx, 'js/proxy.js'); load(ctx, 'js/sources/eastmoney.js');
  const EM = vm.runInContext('window.EastmoneySource', ctx);
  const r1 = await EM.getFullMarket();
  assert.equal(r1.length, 0, '失败应返回空数组');
  fail = false;
  const r2 = await EM.getFullMarket();
  assert.equal(r2.length, 1, '恢复后应重新抓取');
});

/* ================= 目标重建：hash → 详情目标 ================= */
await test('targetFromHashSymbol 前缀规则（与适配器对齐）', () => {
  // 从 app.js 提取真函数做同构校验（依赖的互转函数同样抽取真实现，
  // 不再手写副本——副本曾与实现漂移：北交所 bj 分支丢失）
  const src = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const m = src.match(/function targetFromHashSymbol[\s\S]*?\n  \}/);
  assert.ok(m, '函数应存在');
  const fn = new Function('window', 'tencentOfSecid', 'toSecid',
    'return (' + m[0].replace('function targetFromHashSymbol(sym) {', 'function (sym) {') + ');');
  const EM = { marketOfSecid: (s) => { const mm = +String(s).split('.')[0];
    return mm === 171 ? 'macro' : mm === 101 ? 'commodity' : mm === 119 ? 'fx' : mm === 116 ? 'hk' : mm === 105 ? 'us' : mm === 133 ? 'fx' : 'cn'; } };
  const grab = (name) => {
    const mm2 = src.match(new RegExp('function ' + name + '\\([\\w, ]*\\) \\{[\\s\\S]*?\\n  \\}'));
    assert.ok(mm2, 'app.js 中应存在 ' + name);
    return new Function('return (' + mm2[0].replace(/^function \w+/, 'function') + ');')();
  };
  const tencentOfSecid = grab('tencentOfSecid');
  const toSecid = grab('toSecid');

  const call = (sym) => fn({ EastmoneySource: EM }, tencentOfSecid, toSecid)(sym);
  const crypto = call('BTCUSDT');
  assert.equal(crypto.market, 'crypto');
  assert.equal(crypto.binance, 'BTCUSDT');
  const cn = call('sh600519');
  assert.equal(cn.tencent, 'sh600519');
  assert.equal(cn.secid, '1.600519');
  assert.equal(cn.market, 'cn');
  const bj = call('bj920001');
  assert.equal(bj.secid, '0.920001', '北交所 symbol → secid 应走 bj 分支');
  const hk = call('hk00700');
  assert.equal(hk.market, 'hk');
  assert.equal(hk.secid, '116.00700');
  const em = call('EM:171.US10Y');
  assert.equal(em.secid, '171.US10Y');
  assert.equal(em.market, 'macro');
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
