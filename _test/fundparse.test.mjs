#!/usr/bin/env node
/* fundparse.test.mjs —— 基金画像解析单测（Node 直跑，不依赖网络/浏览器）
 * 用法：node _test/fundparse.test.mjs
 *
 * fixture 按真实接口形状抄（2026-10 逐字段实测 005827 的返回）：
 *   ① normalizePingzhong 吃的是 script 注入后 window 上的值；
 *   ② parseJjcc 吃的是 FundArchivesDatas apidata.content 的 HTML 字符串。
 * 解析器对上游改版必须"缺就降级、绝不炸整页"——这些用例锁的就是这个行为。 */

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
vm.runInContext(readFileSync(path.join(ROOT, 'js/fundparse.js'), 'utf8'), ctx, { filename: 'js/fundparse.js' });
const FP = vm.runInContext('window.FundParse', ctx);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} 期望 ${b}±${eps}，实际 ${a}`);

/* 按 005827 实测形状造的值（数字换过，结构一致） */
const G = {
  fS_name: '测试蓝筹混合',
  fS_code: '005827',
  fund_sourceRate: '1.50',
  fund_Rate: '0.15',
  fund_minsg: '10',
  syl_1n: '-29.32', syl_6y: '-20.9', syl_3y: '-7.81', syl_1y: '-4.88',
  Data_fundSharesPositions: [[1789660800000, 95.67], [1790524800000, 99.61]],
  Data_netWorthTrend: [
    { x: 1536076800000, y: 1.0, equityReturn: 0, unitMoney: '' },
    { x: 1536249600000, y: 0.9986, equityReturn: -0.14, unitMoney: '' },
    { x: 1536854400000, y: 'bad' },                      // 脏点，应被滤掉
    null,
  ],
  Data_ACWorthTrend: [[1536076800000, 1.0], [1536249600000, 1.02], ['x', 2]],
  Data_rateInSimilarType: [{ x: 1543939200000, y: 122, sc: '603' }, { x: 1790006400000, y: 88, sc: '611' }],
  Data_rateInSimilarPersent: [[1543939200000, 79.77], [1790006400000, 14.4]],
  Data_fluctuationScale: { categories: ['2026-03-31', '2026-06-30'], series: [{ y: 267.93, mom: '-13.63%' }, { y: 204.16, mom: '-23.80%' }] },
  Data_holderStructure: { categories: ['2025-12-31', '2026-06-30'], series: [
    { name: '机构持有比例', data: [0.7, 0.67] }, { name: '个人持有比例', data: [99.3, 99.33] },
    { name: '内部持有比例', data: [0.0867, 0.0639] }] },
  Data_assetAllocation: { categories: ['2026-03-31', '2026-06-30'], series: [
    { name: '股票占净比', data: [93.81, 76.43] }, { name: '债券占净比', data: [0, 0] },
    { name: '现金占净比', data: [6.37, 25.17] }, { name: '净资产', type: 'line', data: [267.93, 204.16] }] },
  Data_performanceEvaluation: { avr: '63.25', categories: ['选证能力', '收益率', '抗风险', '稳定性', '择时能力'], data: [60, 55, 70, 80, 65] },
  Data_currentFundManager: [{ id: '30189744', name: '张三', star: 4, workTime: '14年又23天', fundSize: '307.94亿(3只基金)' }],
  Data_buySedemption: { categories: ['2026-03-31', '2026-06-30'], series: [
    { name: '期间申购', data: [4.31, 4.97] }, { name: '期间赎回', data: [19.16, 23.02] },
    { name: '总份额', data: [151.72, 133.67] }] },
};

/* ---------------- normalizePingzhong ---------------- */

test('normalize: 全字段装配（收益/仓位/净值/排名/规模/申赎/结构/配置/评价/经理）', () => {
  const d = FP.normalizePingzhong(G);
  assert.equal(d.name, '测试蓝筹混合');
  assert.equal(d.code, '005827');
  near(d.rateOld, 1.5, 1e-9);
  near(d.rateNew, 0.15, 1e-9);
  near(d.returns.y1, -29.32, 1e-9);
  near(d.returns.m1, -4.88, 1e-9);
  near(d.position.pct, 99.61, 1e-9);                       // 取最新一期
  assert.equal(d.netWorth.length, 2);                       // 脏点/ null 被滤掉
  near(d.netWorth[1].r, -0.14, 1e-9);
  assert.equal(d.acWorth.length, 2);
  assert.equal(d.rank.rank, 88);                            // sc 是字符串，要转数
  assert.equal(d.rank.total, 611);
  near(d.rank.percent, 14.4, 1e-9);
  near(d.scale.vals[1], 204.16, 1e-9);
  assert.equal(d.scale.mom[1], '-23.80%');
  near(d.buyRedeem.shares[1], 133.67, 1e-9);
  near(d.holders.inst[1], 0.67, 1e-9);
  near(d.alloc.stock[1], 76.43, 1e-9);
  near(d.perfEval.avr, 63.25, 1e-9);
  assert.deepEqual(d.perfEval.categories.join('|'), '选证能力|收益率|抗风险|稳定性|择时能力');
  assert.equal(d.perfEval.scores.join('|'), '60|55|70|80|65');
  assert.equal(d.managers[0].name, '张三');
  assert.equal(d.managers[0].fundSize, '307.94亿(3只基金)');
});

test('normalize: 连名字/代码都没有 → 整体 null（不是这份脚本的形状）', () => {
  assert.equal(FP.normalizePingzhong({}), null);
  assert.equal(FP.normalizePingzhong(null), null);
  assert.equal(FP.normalizePingzhong({ fS_name: 'x' }), null);
});

test('normalize: 单块字段坏掉只降级该块，不拖垮其他字段', () => {
  const broken = Object.assign({}, G, {
    Data_netWorthTrend: 'junk',
    Data_holderStructure: { series: 'not-array' },
    Data_performanceEvaluation: { avr: '1' },               // 缺 categories/data
  });
  const d = FP.normalizePingzhong(broken);
  assert.equal(d.netWorth, null);
  assert.equal(d.holders, null);
  assert.equal(d.perfEval, null);
  assert.equal(d.rank.rank, 88);                            // 其余照常
  assert.equal(d.buyRedeem.cats.length, 2);
});

/* ---- normalizeInverst（重仓股，fundmobapi Datas.fundStocks 实测形状） ---- */

test('normalizeInverst: GPDM/GPJC/JZBL/NEWTEXCH → secid 口径统一，变动方向带出', () => {
  const stocks = FP.normalizeInverst({ fundStocks: [
    { GPDM: '00700', GPJC: '腾讯控股', JZBL: '5.72', NEWTEXCH: '116', PCTNVCHGTYPE: '减持', PCTNVCHG: '-3.88' },
    { GPDM: '600519', GPJC: '贵州茅台', JZBL: '5.62', NEWTEXCH: '1', PCTNVCHGTYPE: '减持', PCTNVCHG: '-4.2' },
    { GPDM: '000858', GPJC: '五粮液', JZBL: '--', NEWTEXCH: '0', PCTNVCHGTYPE: '', PCTNVCHG: '' },
  ] });
  assert.equal(stocks.length, 3);
  assert.equal(stocks[0].secid, '116.00700');   // 与热力图/详情同一套 secid 口径
  assert.equal(stocks[0].code, '00700');
  near(stocks[0].pct, 5.72, 1e-9);
  assert.equal(stocks[0].chgType, '减持');
  near(stocks[0].chg, -3.88, 1e-9);
  assert.equal(stocks[2].pct, null);            // '--' → null，不出 NaN
  assert.equal(stocks[2].chgType, null);
});

test('normalizeInverst: 空/缺字段整体 null（视图隐藏重仓股卡）', () => {
  assert.equal(FP.normalizeInverst(null), null);
  assert.equal(FP.normalizeInverst({}), null);
  assert.equal(FP.normalizeInverst({ fundStocks: [] }), null);
  assert.equal(FP.normalizeInverst({ fundStocks: [{ GPDM: 'x' }] }), null);   // 缺名称/市场号
});

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
