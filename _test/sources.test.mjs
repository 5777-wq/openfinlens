#!/usr/bin/env node
/* sources.test.mjs —— 三个源适配器的边界（node 直跑，零网络）
 * 用法：node _test/sources.test.mjs
 *
 * 这一组测的是"契约"而不是"行情"：
 *   · 币安：传空数组 = "我一只也不要"，不是"给我全市场"（整个加密市场 1.9MB）；
 *   · 龙虎榜：6 次回退机会必须覆盖 6 个**不同的工作日**——latestLhbDate 内部
 *     会自己退回上一个工作日（周末 + 上海 17:00 才披露两条规则），外层再按
 *     "往前挪 i 天"算，相邻两次会落到同一天上，6 次机会实际只覆盖 4 个工作日；
 *   · 南向：回退的**请求次数**要有上限（原来那个计数器写在请求之后，永远触发不了）。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};

/* 固定"现在"：2026-10-21（周三）18:00 上海 = 10:00 UTC */
const NOW = Date.parse('2026-10-21T10:00:00Z');

/* ---- 最小环境：只把真的适配器跑起来，行情全部用假响应 ---- */
function boot(nowMs = NOW) {
  const reqs = [];
  class FixedDate extends Date { static now() { return nowMs; } }
  const ctx = {
    console, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    isFinite, Date: FixedDate, RegExp, Error, Promise, Map, Set, URL, URLSearchParams,
    encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.U = {
    num: (v) => {
      if (v === null || v === undefined || v === '' || v === '-') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },
    fmtDay: (ms) => {
      if (!ms) return '--';
      const d = new Date(ms);
      const p = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    request: async (url) => {
      reqs.push(String(url));
      return { success: true, result: { pages: 1, data: [] } };   // 默认"这天没有数据"
    },
    Cache: { set() { }, raw() { return null; } },
  };
  ctx.SourceState = { ok() { }, fail() { } };
  const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return { ctx, reqs, load };
}

/* 从请求 URL 里取出东财的 TRADE_DATE / HOLD_DATE */
function dateOf(url) {
  const q = String(url).split('?')[1] || '';
  const params = new URLSearchParams(q);
  const f = params.get('filter') || '';
  const m = /'([0-9]{4}-[0-9]{2}-[0-9]{2})'/.exec(f);
  return m ? m[1] : null;
}
const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();   // 1..5 = 工作日

/* ==================== 币安：空数组的契约 ==================== */

test('币安：getQuotes([]) 返回空数组（不是"全市场"）', async () => {
  const { ctx, reqs, load } = boot();
  load('js/data/universe.js');     // CRYPTO_UNIVERSE 必须是满的，否则这条断言没有意义
  assert.ok((ctx.CRYPTO_UNIVERSE || []).length > 0, 'crypto universe 是空的');
  load('js/sources/binance.js');
  const out = await ctx.BinanceSource.getQuotes([]);
  assert.deepEqual(out, [], '空数组应当原样返回空数组');
  assert.equal(reqs.length, 0, '空数组不该发出任何请求（否则就是拉整个加密市场）');
});

test('币安：getQuotes(不传参数) 仍然走默认 universe（回退只对"没传"生效）', async () => {
  const { ctx, reqs, load } = boot();
  load('js/data/universe.js');
  load('js/sources/binance.js');
  const out = await ctx.BinanceSource.getQuotes();
  assert.ok(reqs.length > 0, '不传参数时应当去取默认 universe');
  assert.ok(Array.isArray(out));
});

/* ==================== 龙虎榜：回退必须覆盖 6 个不同工作日 ==================== */

test('龙虎榜：6 次回退机会覆盖 6 个不同的工作日（相邻两次不许落在同一天）', async () => {
  const { ctx, reqs, load } = boot();
  load('js/events.js');            // 真的 latestLhbDate（周末 + 上海 17:00 两条规则）
  load('js/sources/lhb.js');
  const r = await ctx.LhbSource.getLhb();
  assert.equal(r.rows.length, 0, '没有数据时应是诚实空态');
  const dates = reqs.map(dateOf).filter(Boolean);
  assert.equal(new Set(dates).size, dates.length, '同一天被重复请求了：' + dates.join(' '));
  assert.equal(dates.length, 6, '6 次机会应覆盖 6 个工作日，实际：' + dates.join(' '));
  dates.forEach(d => assert.ok(weekdayOf(d) >= 1 && weekdayOf(d) <= 5, '请求了非工作日：' + d));
  // 逐个往前：相邻两个之间不许隔掉工作日
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(dates[i - 1] + 'T00:00:00Z');
    const cur = Date.parse(dates[i] + 'T00:00:00Z');
    const gap = Math.round((prev - cur) / 86400000);
    assert.ok(gap >= 1 && gap <= 3, dates[i - 1] + ' → ' + dates[i] + ' 之间隔了 ' + gap + ' 天（工作日被跳过了）');
  }
});

test('龙虎榜：这一天有数据时，第一个工作日就命中（不多发请求）', async () => {
  const { ctx, reqs, load } = boot();
  load('js/events.js');
  load('js/sources/lhb.js');
  const orig = ctx.U.request;
  ctx.U.request = async (url) => {
    reqs.push(String(url));
    if (dateOf(url) === '2026-10-21') {
      return {
        success: true, result: { data: [{
          SECURITY_CODE: '600519', SECURITY_NAME_ABBR: 'StubLhb', SECUCODE: '600519.SH',
          CHANGE_RATE: 3.3, BILLBOARD_NET_AMT: 1e7, BILLBOARD_BUY_AMT: 2e7, BILLBOARD_SELL_AMT: 1e7,
          BILLBOARD_DEAL_AMT: 3e7, DEAL_NET_RATIO: 1.5, EXPLANATION: 'stub',
          TRADE_DATE: '2026-10-21 00:00:00', MARKET: 'SH', D1_CLOSE_ADJCHRATE: 1.1,
          D5_CLOSE_ADJCHRATE: 2.2, CLOSE_PRICE: 100,
        }] },
      };
    }
    return orig(url);
  };
  const r = await ctx.LhbSource.getLhb();
  assert.equal(r.via, 'em');
  assert.equal(r.tradeDate, '2026-10-21');
  assert.equal(reqs.length, 1, '第一个工作日就命中，不该继续回退');
});

/* ==================== 南向：请求次数要有上限 ==================== */

test('南向：回退的请求次数有上限（最多 8 次），且每天不重复', async () => {
  const { ctx, reqs, load } = boot();
  load('js/sources/southbound.js');
  const r = await ctx.SouthboundSource.latest();
  assert.equal(r.rows.length, 0);
  assert.equal(r.date, null);
  assert.equal(reqs.length, 8, '请求次数应封顶在 8 次，实际 ' + reqs.length);
  const dates = reqs.map(dateOf).filter(Boolean);
  assert.equal(new Set(dates).size, dates.length, '同一天被重复请求了：' + dates.join(' '));
  dates.forEach(d => assert.ok(weekdayOf(d) >= 1 && weekdayOf(d) <= 5, '请求了非工作日：' + d));
});

test('南向：抓到数据就停（不多发请求）', async () => {
  const { ctx, reqs, load } = boot();
  load('js/sources/southbound.js');
  const orig = ctx.U.request;
  ctx.U.request = async (url) => {
    reqs.push(String(url));
    if (dateOf(url) === ctx.U.fmtDay(NOW)) {
      return {
        success: true, result: { pages: 1, data: [{
          SECURITY_CODE: '00700', SECURITY_NAME: 'StubHK', HOLD_DATE: ctx.U.fmtDay(NOW),
          HOLD_SHARES: 1000, HOLD_MARKET_CAP: 1e8, HOLD_SHARES_RATIO: 1.2, HOLD_SHARES_CHANGE: 100,
          ADD_SHARES_AMP: 0.5, PARTICIPANT_NUM: 5, CLOSE_PRICE: 300, CHANGE_RATE: 1.1, INDUSTRY: 'Stub',
        }] },
      };
    }
    return orig(url);
  };
  const r = await ctx.SouthboundSource.latest();
  assert.equal(r.rows.length, 1);
  assert.equal(reqs.length, 1, '当天有数据就该停');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
