/* auniverse.test.mjs —— A股全市场行分类：纯离线单测（node _test/auniverse.test.mjs）
   覆盖：指数识别（代码段 / 名称前缀 / 名称后缀）/ 个股不误伤 /
   名称前缀只对沪深行生效（美股 MSCI Inc 是股票，不是指数）/ 列表过滤。
   这层判错的后果不对称：漏判 → 指数继续占热力图面积、继续被算进涨跌家数；
   误判 → 真股票被踢出全市场。所以两类反例都要钉死。 */

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

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, RegExp, Set, Map, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/auniverse.js'), 'utf8'), ctx, { filename: 'js/auniverse.js' });
const AU = ctx.window.AUniverse;

await test('isIndexRow：各板块的头条指数都要判出来', () => {
  const rows = [
    { code: '000001', market: 1, name: '上证指数' },
    { code: '399001', market: 0, name: '深证成指' },
    { code: '399006', market: 0, name: '创业板指' },
    { code: '000688', market: 1, name: '科创50' },
    { code: '899050', market: 0, name: '北证50' },
    { code: '000300', market: 1, name: '沪深300' },
    { code: '000905', market: 1, name: '中证500' },
    { code: '000852', market: 1, name: '中证1000' },
    { code: '000016', market: 1, name: '上证50' },
    { code: '399317', market: 0, name: '国证A指' },
  ];
  rows.forEach(r => {
    assert.equal(AU.isIndexRow(r), true, `${r.name}(${r.code}) 应判为指数`);
  });
});

await test('isIndexRow：个股不能被误判（含"开头像指数"的边缘情况）', () => {
  const rows = [
    { code: '600519', market: 1, name: '贵州茅台' },
    { code: '000002', market: 0, name: '万科A' },
    { code: '300750', market: 0, name: '宁德时代' },
    { code: '601318', market: 1, name: '中国平安' },
    { code: '601988', market: 1, name: '中国银行' },
    { code: '600050', market: 1, name: '中国联通' },
    { code: '300059', market: 0, name: '东方财富' },
    { code: '002594', market: 0, name: '比亚迪' },
    { code: '688981', market: 1, name: '中芯国际' },
    { code: '600018', market: 1, name: '上港集团' },   // "上港"不是"上证"
    { code: '000058', market: 0, name: '深赛格' },     // "深赛格"不是"深证"
    { code: '601336', market: 1, name: '新华保险' },   // "新华"不能进指数前缀表（新华银行同理）
    { code: '600088', market: 1, name: '中视传媒' },
  ];
  rows.forEach(r => {
    assert.equal(AU.isIndexRow(r), false, `${r.name}(${r.code}) 是个股，不该被判成指数`);
  });
});

await test('isIndexRow：名称前缀只对沪深行生效——美股 MSCI Inc 是股票', () => {
  // MSCI Inc 是纳斯达克上市公司，名字正好以 MSCI 开头 → 不能当指数
  assert.equal(AU.isIndexRow({ code: 'MSCI', market: 105, name: 'MSCI' }), false);
  assert.equal(AU.isIndexRow({ code: 'MSCI', market: 105, name: 'MSCI Inc.' }), false);
  // 港股同理：名字以"沪深"开头也不会被误伤（市场码不是 0/1）
  assert.equal(AU.isIndexRow({ code: '00700', market: 116, name: '沪深港通' }), false);
});

await test('isIndexRow：399/899 代码段无个股占用（与名称规则互相独立）', () => {
  // 就算名字被改得不认识，代码段也能兜住
  assert.equal(AU.isIndexRow({ code: '399999', market: 0, name: '某未知指数' }), true);
  assert.equal(AU.isIndexRow({ code: '899999', market: 0, name: '某未知指数' }), true);
  // 399/899 之外的深市个股不受影响
  assert.equal(AU.isIndexRow({ code: '300999', market: 0, name: '某某股份' }), false);
  assert.equal(AU.isIndexRow({ code: '002999', market: 0, name: '某某股份' }), false);
});

await test('isIndexRow：容错——空行、缺字段不崩', () => {
  assert.equal(AU.isIndexRow(null), false);
  assert.equal(AU.isIndexRow(undefined), false);
  assert.equal(AU.isIndexRow({}), false);
  assert.equal(AU.isIndexRow({ code: '', market: null, name: '' }), false);
  // f13 原始字段名也认
  assert.equal(AU.isIndexRow({ f12: '000001', f13: 1, f14: '上证指数' }), true);
});

await test('isIndexRow：东财兜底路径的行（只有 secid 没有 market）也要判出指数', () => {
  // 主源东财挂掉时走腾讯精选兜底，行形状是 { code: symbol, name, secid }，没有 market 字段。
  // 上证指数/深证成指/创业板指/科创50 的 secid 是 1./0. 开头 → 必须从 secid 反推市场。
  const backup = [
    { code: 'sh000001', name: '上证指数', secid: '1.000001' },
    { code: 'sz399001', name: '深证成指', secid: '0.399001' },
    { code: 'sz399006', name: '创业板指', secid: '0.399006' },
    { code: 'sh000688', name: '科创50', secid: '1.000688' },
  ];
  backup.forEach(r => {
    assert.equal(AU.isIndexRow(r), true, `${r.name} 在兜底路径上也应判为指数`);
  });
  // 同一路径下的个股/港股不能被误伤
  assert.equal(AU.isIndexRow({ code: 'sh600519', name: '贵州茅台', secid: '1.600519' }), false);
  assert.equal(AU.isIndexRow({ code: 'sz000002', name: '万科A', secid: '0.000002' }), false);
  assert.equal(AU.isIndexRow({ code: 'hk00700', name: '腾讯控股', secid: '116.00700' }), false);
});

await test('marketFromSecid：只有 1.(沪) / 0.(深) 能反推出市场', () => {
  assert.equal(AU.marketFromSecid('1.000001'), 1);
  assert.equal(AU.marketFromSecid('0.399001'), 0);
  assert.equal(AU.marketFromSecid('116.00700'), null);
  assert.equal(AU.marketFromSecid('5.000001'), null);
  assert.equal(AU.marketFromSecid(''), null);
  assert.equal(AU.marketFromSecid(null), null);
});

await test('withoutIndices：过滤出指数行，且不改原数组', () => {
  const rows = [
    { code: '000001', market: 1, name: '上证指数' },
    { code: '600519', market: 1, name: '贵州茅台' },
    { code: '399001', market: 0, name: '深证成指' },
    { code: '000002', market: 0, name: '万科A' },
  ];
  const out = AU.withoutIndices(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.code), ['600519', '000002']);
  assert.equal(rows.length, 4, '原数组不能被就地改写');
  assert.equal(AU.withoutIndices(null).length, 0);
  assert.equal(AU.withoutIndices('junk').length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
