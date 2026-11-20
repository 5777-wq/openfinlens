/* actors.js Actor/Activity 数据模型：纯离线单测（node _test/actors.test.mjs）
   覆盖：明细行清洗 / 买卖同席同股同日合并 / 席位聚合统计与排序 /
   席位历史近N次 + 3日上涨概率均值 / activity→chart marker / 席位≠自然人口径。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'apps', 'terminal');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, isFinite, Set, Map });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/actors.js'), 'utf8'), ctx, { filename: 'js/actors.js' });
const A = ctx.window.Actors;

const buyRow = (seat, seatName, code, buy, extra = {}) => ({
  OPERATEDEPT_CODE: seat, OPERATEDEPT_NAME: seatName, SECURITY_CODE: code,
  SECUCODE: code + (/^6/.test(code) ? '.SH' : '.SZ'),
  TRADE_DATE: '2026-09-09 00:00:00', BUY: buy, SELL: null, NET: buy,
  EXPLANATION: '日涨幅偏离值达到7%的前5只证券', RISE_PROBABILITY_3DAY: 50, ...extra,
});
const sellRow = (seat, seatName, code, sell, extra = {}) => ({
  OPERATEDEPT_CODE: seat, OPERATEDEPT_NAME: seatName, SECURITY_CODE: code,
  SECUCODE: code + (/^6/.test(code) ? '.SH' : '.SZ'),
  TRADE_DATE: '2026-09-09 00:00:00', BUY: null, SELL: sell, NET: -sell,
  EXPLANATION: '日跌幅偏离值达到7%的前5只证券', RISE_PROBABILITY_3DAY: 40, ...extra,
});

await test('activityFromRow：字段清洗，缺关键字段丢弃，symbol 沪深前缀正确', () => {
  const a = A.activityFromRow(buyRow('1001', '某证券营业部', '603186', 1e8));
  assert.equal(a.symbol, 'EM:1.603186');
  assert.equal(a.action, 'BUY');
  assert.equal(a.confidence, 'CONFIRMED');
  assert.equal(A.activityFromRow({ OPERATEDEPT_NAME: 'no code' }), null);
  assert.equal(A.secidSymbol('000620', '000620.SZ'), 'EM:0.000620');
});

await test('mergeRows：同席位同股同日买卖合并为一条，方向按净额', () => {
  const merged = A.mergeRows(
    [buyRow('1001', '甲营业部', '603186', 1.2e8), buyRow('1002', '乙营业部', '000620', 5e7)],
    [sellRow('1001', '甲营业部', '603186', 3e7)],
  );
  assert.equal(merged.length, 2);
  const a = merged.find(x => x.seatCode === '1001');
  assert.equal(a.action, 'BUY');
  assert.equal(a.buy, 1.2e8);
  assert.equal(a.sell, 3e7);
  assert.equal(a.net, 9e7);
});

await test('buildSeatActors：按席位聚合统计并按|净额|降序', () => {
  const actors = A.buildSeatActors(
    [buyRow('1001', '甲营业部', '603186', 2e8), buyRow('1002', '乙营业部', '000620', 5e7), buyRow('1001', '甲营业部', '000333', 8e7)],
    [sellRow('1002', '乙营业部', '600108', 9e8)],
  );
  assert.equal(actors.length, 2);
  assert.equal(actors[0].name, '乙营业部');   // |−8.5e8| > |2.8e8|
  assert.equal(actors[0].stats.net, -8.5e8);
  const jia = actors.find(a => a.seatCodeFallback = a.name === '甲营业部' ? a : null) || actors[1];
  assert.equal(jia.stats.activityCount, 2);
  assert.equal(jia.stats.stockCount, 2);
  assert.equal(jia.stats.buy, 2.8e8);
});

await test('buildSeatHistory：倒序截断 + 概率均值 + 买卖笔数', () => {
  const buys = [], sells = [];
  for (let d = 1; d <= 5; d++) {
    buys.push(buyRow('1001', '甲营业部', '60010' + d, 1e7, { TRADE_DATE: `2026-09-0${d} 00:00:00` }));
  }
  sells.push(sellRow('1001', '甲营业部', '600101', 5e6, { TRADE_DATE: '2026-09-03 00:00:00' }));
  const h = A.buildSeatHistory(buys, sells, 4);
  assert.equal(h.total, 6);
  assert.equal(h.activities.length, 4);
  assert.equal(h.activities[0].tradeDate, '2026-09-05');   // 最新在前
  assert.equal(h.stats.stockCount, 5);
  assert.equal(h.stats.avgRiseProb3d > 40 && h.stats.avgRiseProb3d < 51, true);
});

await test('activityToChartEvent：marker 时间=交易日（日频披露，不造盘中时间）', () => {
  const a = A.activityFromRow(buyRow('1001', '甲', '603186', 1e8));
  const ce = A.activityToChartEvent(a, { up: '#ff5c5c', down: '#2ebd85' });
  assert.equal(ce.time, '2026-09-09');
  assert.equal(ce.text, '席位买');
  assert.equal(ce.color, '#ff5c5c');
  const cs = A.activityToChartEvent({ ...a, action: 'SELL' }, { up: '#ff5c5c', down: '#2ebd85' });
  assert.equal(cs.color, '#2ebd85');
});

await test('stockName：披露行的证券简称直接透传（档案页不靠行情补名字）', () => {
  const a = A.activityFromRow(buyRow('1001', '甲营业部', '603186', 1e8, { SECURITY_NAME_ABBR: '建设工业' }));
  assert.equal(a.stockName, '建设工业');
  // 同席同股同日合并：名字在任一侧出现都保留
  const merged = A.mergeRows(
    [buyRow('1001', '甲营业部', '603186', 1e8)],
    [sellRow('1001', '甲营业部', '603186', 5e6, { SECURITY_NAME_ABBR: '建设工业' })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stockName, '建设工业');
  // 缺失时为空串（渲染层回退 code），绝不造名字
  assert.equal(A.activityFromRow(buyRow('1002', '乙营业部', '000620', 1e8)).stockName, '');
});

await test('口径铁律：席位模型无"游资本人"推断字段、无收益预测用语', () => {
  const src = readFileSync(path.join(ROOT, 'js/actors.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(src, /游资本人|胜率|收益率|建议买入|建议卖出/);
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
}, 50);
