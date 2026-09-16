#!/usr/bin/env node
/* spark.test.mjs —— 首屏/自选卡的图形层（迷你走势线 + 当日振幅条）纯函数单测
 * 用法：node _test/spark.test.mjs
 *
 * 为什么值得单独测：这两样都是"把数字画成形状"，算错了界面不会报错——
 * 只会画出一条平线、或把指示点画到轨道外面（看起来像"今天跌到最低"，其实只是坐标越界）。
 * 所以这里断言的是**坐标数值**，不是"有没有画出来"。
 */

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

const ctx = vm.createContext({ console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, isFinite, window: null });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/spark.js'), 'utf8'), ctx, { filename: 'js/spark.js' });
const S = vm.runInContext('window.Spark', ctx);

/* ---------------- 当日振幅条的位置 ---------------- */

test('rangePos：区间内按比例定位（0 = 最低，1 = 最高）', () => {
  assert.equal(S.rangePos(100, 90, 110), 0.5);
  assert.equal(S.rangePos(90, 90, 110), 0);
  assert.equal(S.rangePos(110, 90, 110), 1);
  assert.equal(S.rangePos(95, 90, 110), 0.25);
});

test('rangePos：越界值夹紧在 0..1（停牌/异常数据不许把点画到轨道外）', () => {
  assert.equal(S.rangePos(130, 90, 110), 1, '高于最高价 → 夹到 1');
  assert.equal(S.rangePos(80, 90, 110), 0, '低于最低价 → 夹到 0');
});

test('rangePos：数据不可用返回 null（调用方据此不画，而不是画个假位置）', () => {
  assert.equal(S.rangePos(null, 90, 110), null);
  assert.equal(S.rangePos(100, null, 110), null);
  assert.equal(S.rangePos(100, 90, null), null);
  assert.equal(S.rangePos(100, 100, 100), null, 'high == low（一字板/停牌）无区间可言');
  assert.equal(S.rangePos(100, 110, 90), null, '上下颠倒的区间不猜');
  assert.equal(S.rangePos(NaN, 90, 110), null);
});

test('rangeBarHTML：位置只以 0.1% 精度进样式，越界输入不可能注入其它字符', () => {
  const html = S.rangeBarHTML(0.5);
  assert.match(html, /left:50\.0%/, '实际: ' + html);
  assert.match(S.rangeBarHTML(2), /left:100\.0%/, '越界夹到 100%');
  assert.match(S.rangeBarHTML(-1), /left:0\.0%/);
  assert.equal(S.rangeBarHTML(null), '', '无位置 → 不产生空轨道');
  // 注入面：函数只接受数字，非数字一律按 null 处理
  assert.equal(S.rangeBarHTML('0"><script>'), '');
});

test('rangeBarHTML：两端标出当日最低/最高，并有 title 说清那个点是什么', () => {
  // 第一版只有一个孤零零的圆点、界面无任何说明，用户直接问"这个点是啥意思"（2026-09-16）
  const html = S.rangeBarHTML(0.62, { low: 12.34, high: 13.56, digits: 2 });
  assert.match(html, /rb-lo num">12\.34</, '左端 = 今日最低');
  assert.match(html, /rb-hi num">13\.56</, '右端 = 今日最高');
  assert.match(html, /title="日内区间 12\.34 ~ 13\.56 · 现价位于 62\.0%"/, 'title 必须把区间和位置都说出来');
  assert.match(html, /left:62\.0%/, '点仍然落在算出来的位置');
});

test('rangeBarHTML：没有高低价时只画位置点，不编造两端数值', () => {
  const html = S.rangeBarHTML(0.4);
  assert.ok(!/rb-lo|rb-hi/.test(html), '缺 low/high 就不该出现数字');
  assert.match(html, /title="现价位于日内区间的 40\.0%"/);
  const partial = S.rangeBarHTML(0.4, { low: 10, high: null });
  assert.ok(!/rb-lo|rb-hi/.test(partial), '只有一个端点值也算缺，宁可不标');
});

/* ---------------- 迷你走势线的坐标 ---------------- */

test('sparkPoints：首末点贴左右边，最高价在最上、最低价在最下', () => {
  const pts = S.sparkPoints([10, 20, 15], 100, 40, 2);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 0, '第一个点在最左');
  assert.equal(pts[2].x, 100, '最后一个点在最右');
  assert.equal(pts[1].y, 2, '最高价 → y = pad（贴顶）');
  assert.equal(pts[0].y, 38, '最低价 → y = h - pad（贴底）');
  const ys = pts.map(p => p.y);
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 40, 'y 必须落在画布内');
});

test('sparkPoints：全平序列画在中线（贴顶/贴底会被读成"涨到最高/跌到最低"）', () => {
  const pts = S.sparkPoints([5, 5, 5, 5], 100, 40, 2);
  pts.forEach(p => assert.equal(p.y, 20, '中线 = pad + (h-2pad)/2'));
});

test('sparkPoints：样本不足或尺寸非法返回 null（不画，而不是画一条假的线）', () => {
  assert.equal(S.sparkPoints([1], 100, 40), null);
  assert.equal(S.sparkPoints([], 100, 40), null);
  assert.equal(S.sparkPoints(null, 100, 40), null);
  assert.equal(S.sparkPoints([1, 2], 0, 40), null);
  assert.equal(S.sparkPoints([1, 2], 100, 3), null, '高度不足以留白时不画');
  assert.equal(S.sparkPoints([1, null, 3, NaN, 5], 100, 40).length, 3, '脏值被剔除后按有效点画');
});

test('sparkPoints：单调上涨序列的 y 逐点下降（方向不能画反）', () => {
  const pts = S.sparkPoints([1, 2, 3, 4], 90, 40, 2);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].y < pts[i - 1].y, `第 ${i} 点应在更上方`);
});

/* ---------------- canvas 描线（用桩 canvas 验证调用契约） ---------------- */

test('draw：无有效数据时返回 false 且不抛（调用方据此保持空白）', () => {
  const calls = [];
  const stub = {
    clientWidth: 100, clientHeight: 30,
    getContext: () => ({
      setTransform() {}, clearRect() { calls.push('clear'); }, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, stroke() { calls.push('stroke'); }, fill() { calls.push('fill'); },
    }),
  };
  assert.equal(S.draw(stub, [1], {}), false, '单点不画');
  assert.equal(S.draw(null, [1, 2], {}), false, '无 canvas 不抛');
  assert.equal(S.draw(stub, [1, 2, 3], { color: '#fff' }), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
