#!/usr/bin/env node
/* portfoliomath.test.mjs —— 持仓跟踪纯计算单测（Node 直跑，不依赖网络/浏览器）
 * 用法：node _test/portfoliomath.test.mjs
 *
 * 持仓估值/多币种折算是"用户账本"级别的数字：市值、盈亏、当日盈亏、人民币合计
 * 每一项都手算可复核；缺价/缺汇率的行为（-- 而不是硬算）也一并锁死。 */

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

const ctx = vm.createContext({ console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, isFinite });
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/portfoliomath.js'), 'utf8'), ctx, { filename: 'js/portfoliomath.js' });
const PM = vm.runInContext('window.PortfolioMath', ctx);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} 期望 ${b}±${eps}，实际 ${a}`);

const HOLD = (symbol, market, shares, cost) => ({ id: 'x_' + symbol, symbol, name: symbol, code: symbol, market, shares, cost });

/* ---------------- 币种 ---------------- */

test('currencyOf: 四类市场映射齐全，未知市场为 null（不许猜币种）', () => {
  assert.equal(PM.currencyOf('cn'), 'CNY');
  assert.equal(PM.currencyOf('hk'), 'HKD');
  assert.equal(PM.currencyOf('us'), 'USD');
  assert.equal(PM.currencyOf('crypto'), 'USD');   // USDT 按 ≈USD 口径
  assert.equal(PM.currencyOf('other'), null);
});

/* ---------------- 估值 ---------------- */

test('valuation: A股 100 股 @10 成本、现价 12、昨收 11.5 → 全套手算值', () => {
  const { rows } = PM.valuation([HOLD('sh600519', 'cn', 100, 10)],
    () => ({ price: 12, prevClose: 11.5, changePct: 4.35 }), { USD: null, HKD: null });
  const r = rows[0];
  assert.equal(r.currency, 'CNY');
  assert.equal(r.value, 1200);
  assert.equal(r.costBasis, 1000);
  assert.equal(r.pnl, 200);
  near(r.pnlPct, 20, 1e-9);
  near(r.dayPnl, 50, 1e-9);           // (12 − 11.5) × 100
  assert.equal(r.valueCny, 1200);     // 本币即人民币，汇率 1
});

test('valuation: 美股按 fx.USD 折算人民币；港股用传入的 HKD 交叉价', () => {
  const { rows, totals } = PM.valuation(
    [HOLD('usAAPL', 'us', 10, 100), HOLD('hk00700', 'hk', 100, 300)],
    (sym) => sym === 'usAAPL' ? { price: 150, prevClose: 145, changePct: 3.45 } : { price: 400, prevClose: 390, changePct: 2.56 },
    { USD: 7.2, HKD: 0.92 });
  const [us, hk] = rows;
  near(us.valueCny, 150 * 10 * 7.2, 1e-9);
  near(hk.valueCny, 400 * 100 * 0.92, 1e-9);
  near(totals.cny.value, 10800 + 36800, 1e-9);
  assert.equal(totals.cny.converted, true);
  near(totals.byCur.USD.value, 1500, 1e-9);
  near(totals.byCur.HKD.value, 40000, 1e-9);
});

test('valuation: 昨收缺失时当日盈亏按涨跌幅反推（value − value/(1+r)）', () => {
  const { rows } = PM.valuation([HOLD('sh600519', 'cn', 100, 10)],
    () => ({ price: 12, prevClose: null, changePct: 4 }), { USD: null, HKD: null });
  near(rows[0].dayPnl, 1200 - 1200 / 1.04, 1e-9);
});

test('valuation: 没填成本价 → pnl/pnlPct 为 null，市值照算', () => {
  const { rows } = PM.valuation([HOLD('BTCUSDT', 'crypto', 0.5, null)],
    () => ({ price: 60000, prevClose: 59000, changePct: 1.69 }), { USD: 7.2, HKD: null });
  const r = rows[0];
  assert.equal(r.value, 30000);
  assert.equal(r.pnl, null);
  assert.equal(r.pnlPct, null);
  assert.ok(r.dayPnl !== null);       // 当日盈亏不依赖成本
});

test('valuation: 缺汇率档 → 该行折算为 null，人民币合计整体拒绝（converted=false）', () => {
  const { rows, totals } = PM.valuation(
    [HOLD('sh600519', 'cn', 100, 10), HOLD('usAAPL', 'us', 10, 100)],
    (sym) => ({ price: 12, prevClose: 11.5, changePct: 4 }),
    { USD: null, HKD: null });
  assert.equal(rows[0].valueCny, 1200);    // CNY 不需要汇率
  assert.equal(rows[1].valueCny, null);
  assert.equal(totals.cny.converted, false);
  assert.equal(totals.cny.value, null);    // 宁可 --，不拼一个半折算的假总数
});

test('valuation: 价格缺失（停牌/未拉到）→ 金额全 null、不计入分币种合计', () => {
  const { rows, totals } = PM.valuation([HOLD('sh600519', 'cn', 100, 10)],
    () => undefined, { USD: null, HKD: null });
  const r = rows[0];
  assert.equal(r.price, null);
  assert.equal(r.value, null);
  assert.equal(r.dayPnl, null);
  assert.equal(Object.keys(totals.byCur).length, 0);
});

test('valuation: 空持仓 → converted=false 且合计为 null（不产生 0 假象）', () => {
  const { totals } = PM.valuation([], () => null, { USD: 7.2, HKD: 0.92 });
  assert.equal(totals.cny.converted, false);
  assert.equal(totals.cny.value, null);
});

/* ---------------- 汇率组装 ---------------- */

test('fxFromQuotes: USD=USDCNH，HKD=USDCNH÷USDHKD 交叉价；缺腿为 null', () => {
  const fx = PM.fxFromQuotes({ 'EM:133.USDCNH': { price: 7.2 }, 'EM:119.USDHKD': { price: 7.8 } });
  near(fx.USD, 7.2, 1e-9);
  near(fx.HKD, 7.2 / 7.8, 1e-9);
  const noHkd = PM.fxFromQuotes({ 'EM:133.USDCNH': { price: 7.2 } });
  assert.equal(noHkd.HKD, null);
  assert.equal(PM.fxFromQuotes({}).USD, null);
});

test('fxFromQuotes: Map 形态可用', () => {
  const fx = PM.fxFromQuotes(new Map([['EM:133.USDCNH', { price: 7.1 }], ['EM:119.USDHKD', { price: 7.8 }]]));
  near(fx.USD, 7.1, 1e-9);
});

/* ---------------- 快照 ---------------- */

test('snapshotPush: 同日覆盖、按日期升序、上限 400', () => {
  let hist = [];
  hist = PM.snapshotPush(hist, '2026-10-16', 100000);
  hist = PM.snapshotPush(hist, '2026-10-17', 101000);
  hist = PM.snapshotPush(hist, '2026-10-16', 100500);   // 同日覆盖，不重复计天
  assert.equal(hist.map(x => x.d).join('|'), '2026-10-16|2026-10-17');
  assert.equal(hist[0].v, 100500);
  for (let i = 0; i < 450; i++) {
    const day = String(i % 28 + 1).padStart(2, '0');
    const mon = String(Math.floor(i / 28) + 1).padStart(2, '0');   // 月递增，保证 450 个日期互不相同
    hist = PM.snapshotPush(hist, '2027-' + mon + '-' + day, 100000 + i);
  }
  assert.equal(hist.length, 400);
});

test('snapshotPush: 脏数据（缺日期/非数值）被丢弃，不污染曲线', () => {
  const hist = PM.snapshotPush([{ d: 'bad' }, { d: '2026-10-15' }, { v: 1 }, 'junk', { d: '2026-10-15', v: 9 }], '2026-10-16', 10);
  assert.deepEqual(hist.map(x => x.d), ['2026-10-15', '2026-10-16']);
});

test('localDateStr: 本地墙钟日期（补零）', () => {
  assert.equal(PM.localDateStr(new Date(2026, 9, 8, 7, 30).getTime()), '2026-10-08');
});

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
