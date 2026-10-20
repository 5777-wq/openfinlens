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

/* ---------------- 多序列对齐（全球指数并排） ----------------
   盯的是一个具体事故：hero 上四条全球指数并排，各按自己的 min-max 缩放，
   结果 ① 幅度全丢（每条都填满高度，"谁涨得多"看不出来）
        ② x 轴是"第几根"不是日期——实测各市场交易日集合只重合 54/60 天、
           末点还差一天（上证 10-20 / 标普 10-19），同屏并列看着像同一条时间轴。
   用户反馈"上证怎么还感觉和标普不对齐"。 */

const D = (s) => s;   // 日期键就是 'YYYY-MM-DD' 字符串

test('alignSeries：共享日期轴是各序列日期的并集（升序去重）', () => {
  const a = S.alignSeries([
    { key: 'cn', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 101 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-20'), close: 202 }] },
  ]);
  assert.deepEqual(Array.from(a.axis), ['2026-10-16', '2026-10-19', '2026-10-20'],
    '日期轴应是并集——某市场休市那天也要在轴上占位，否则 x 就对不上');
  assert.equal(a.series.length, 2);
});

test('alignSeries：缺交易日的位置是 null（不插值、不连直线）', () => {
  const a = S.alignSeries([
    { key: 'cn', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 101 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-19'), close: 201 }, { time: D('2026-10-20'), close: 202 }] },
  ]);
  const cn = a.series[0];
  assert.equal(cn.values.length, 3, '长度等于共享轴长度');
  assert.equal(cn.values[2], null, '10-20 美股有、A股没有 → 留 null');
  assert.ok(cn.values[0] === 0, '首日相对自身首日 = 0%');
});

test('alignSeries：涨跌幅以各自的第一个有效点为基准（不是共享轴的第一天）', () => {
  // 上证可能缺共享轴的头几天：若用轴首日当基准，会算出一个虚假的巨幅涨跌幅。
  // 基准 = 该序列自己的首个有效点 → 那个位置的涨跌幅是 0%。
  const a = S.alignSeries([
    { key: 'cn', rows: [{ time: D('2026-10-19'), close: 100 }, { time: D('2026-10-20'), close: 102 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-19'), close: 210 }, { time: D('2026-10-20'), close: 220 }] },
  ]);
  const axis = Array.from(a.axis);
  const cn = a.series[0];
  const cnBase = axis.indexOf('2026-10-19');
  assert.equal(cn.values[cnBase], 0, '上证在自己首个有效点处 = 0%');
  assert.equal(cn.values[cnBase + 1], 2, '100 → 102 = +2%');
  assert.equal(cn.values[0], null, '共享轴首日上证没数据 → null（不编造）');
  const us = a.series[1];
  assert.equal(us.values[0], 0, '标普从 200 起算 = 0%');
  assert.equal(us.values[2], 10, '200 → 220 = +10%');
});

test('alignedScale：全体共用一套上下限且关于 0 对称（0% 基线在正中）', () => {
  const a = S.alignSeries([
    { key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 110 }] },  // +10%
    { key: 'b', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 95 }] },   // -5%
  ]);
  const s = S.alignedScale(a);
  assert.ok(s.max >= 10, '最大绝对涨跌幅应被覆盖，实际 ' + s.max);
  assert.ok(Math.abs(s.max + s.min) < 1e-6, '上下限应对称，实际 ' + s.min + ' ~ ' + s.max);
  assert.ok(s.min < 0 && s.max > 0);
});

test('alignedScale：全平序列时给一个非零标尺（否则除零）', () => {
  const a = S.alignSeries([{ key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 100 }] }]);
  const s = S.alignedScale(a);
  assert.ok(s.max > s.min, '标尺不能塌成一个点');
});

test('alignedPoints：同一日期在所有序列里落在同一个 x（这才是"对齐"）', () => {
  const rows = [
    { key: 'cn', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 101 }, { time: D('2026-10-20'), close: 102 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-19'), close: 201 }, { time: D('2026-10-20'), close: 201 }] },
  ];
  const a = S.alignSeries(rows);
  const s = S.alignedScale(a);
  const p1 = S.alignedPoints(rows[0].rows, a.axis, s, 100, 40);
  const p2 = S.alignedPoints(rows[1].rows, a.axis, s, 100, 40);
  assert.equal(p1.length, 3);
  assert.equal(p2.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(p1[i].x, p2[i].x, `第 ${i} 个点（${a.axis[i]}）两条线的 x 必须相同`);
  }
});

test('alignedPoints：缺交易日不产出点（画线时要断开，不能接直线）', () => {
  const rows = [
    { key: 'cn', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-20'), close: 102 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-19'), close: 201 }, { time: D('2026-10-20'), close: 202 }] },
  ];
  const a = S.alignSeries(rows);
  const s = S.alignedScale(a);
  const p = S.alignedPoints(rows[0].rows, a.axis, s, 100, 40);
  assert.equal(p.length, 2, '缺 10-19 → 只有 2 个点');
  assert.equal(p[0].x, 0, '10-16 在轴首');
  assert.equal(p[1].x, 100, '10-20 在轴尾（x 按轴下标，不是按自己的点数）');
});

test('alignedPoints：涨得多的线在更高的位置（纵轴幅度可比）', () => {
  const rows = [
    { key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 120 }] },  // +20%
    { key: 'b', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 90 }] },   // -10%
  ];
  const a = S.alignSeries(rows);
  const s = S.alignedScale(a);
  const pa = S.alignedPoints(rows[0].rows, a.axis, s, 100, 40);
  const pb = S.alignedPoints(rows[1].rows, a.axis, s, 100, 40);
  assert.ok(pa[1].y < pb[1].y, '涨 20% 的线末点必须比跌 10% 的线末点更高（y 向下）');
});

test('alignedPoints：首日落在 0% 基线上（共享标尺的中线附近）', () => {
  const rows = [{ key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 110 }] }];
  const a = S.alignSeries(rows);
  const s = S.alignedScale(a);
  const p = S.alignedPoints(rows[0].rows, a.axis, s, 100, 40);
  // 0% 在对称标尺里对应中线（h/2 = 20）
  assert.ok(Math.abs(p[0].y - 20) < 0.5, '首日 0% 应落在中线附近，实际 y=' + p[0].y);
});

test('alignedPoints：数据不足或尺寸非法返回 null（不画）', () => {
  const a = S.alignSeries([{ key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 110 }] }]);
  const s = S.alignedScale(a);
  assert.equal(S.alignedPoints([{ time: D('2026-10-16'), close: 100 }], a.axis, s, 100, 40), null, '单点不画');
  assert.equal(S.alignedPoints([], a.axis, s, 100, 40), null);
  assert.equal(S.alignedPoints(null, a.axis, s, 100, 40), null);
  assert.equal(S.alignedPoints([{ time: D('2026-10-16'), close: 1 }], a.axis, s, 0, 40), null, '宽度为 0 不画');
  assert.equal(S.alignedPoints([{ time: D('2026-10-16'), close: 1 }], [], s, 100, 40), null, '空轴不画');
});

test('alignedPoints：某序列在共享轴上完全没有点 → null（不画）', () => {
  const a = S.alignSeries([
    { key: 'cn', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 101 }] },
    { key: 'us', rows: [{ time: D('2026-10-16'), close: 200 }, { time: D('2026-10-19'), close: 201 }] },
  ]);
  const s = S.alignedScale(a);
  assert.equal(S.alignedPoints([{ time: D('2026-01-01'), close: 5 }], a.axis, s, 100, 40), null,
    '日期完全不在轴上的序列不该画出东西');
});

test('drawAligned：缺口处的两点之间不连线（避免画出根本不存在的走势）', () => {
  const segs = [];
  const stub = {
    clientWidth: 100, clientHeight: 30,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {},
      moveTo(x, y) { segs.push(['move', x]); },
      lineTo(x, y) { segs.push(['line', x]); },
      closePath() {}, stroke() { segs.push(['stroke']); }, fill() {},
    }),
  };
  // 共享轴长 11 天，本序列只有首尾两天 → x 从 0 跳到 100，中间缺了 9 天
  const ok = S.drawAligned(stub, [{ x: 0, y: 10 }, { x: 100, y: 20 }], { color: '#fff', axisLen: 11 });
  assert.equal(ok, true);
  const strokes = segs.filter(s => s[0] === 'stroke').length;
  assert.equal(strokes, 2, '缺口两侧应分成两段（两次 stroke），实际 ' + strokes);
});

test('drawAligned：相邻点（无缺口）应连成一段', () => {
  const segs = [];
  const stub = {
    clientWidth: 100, clientHeight: 30,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {},
      moveTo(x, y) { segs.push(['move', x]); },
      lineTo(x, y) { segs.push(['line', x]); },
      closePath() {}, stroke() { segs.push(['stroke']); }, fill() {},
    }),
  };
  // 共享轴 11 天 → 正常步长 = 100/10 = 10；连续三天（10-16/17/18）间距正好是步长
  const ok = S.drawAligned(stub, [{ x: 0, y: 10 }, { x: 10, y: 12 }, { x: 20, y: 8 }],
    { color: '#fff', axisLen: 11 });
  assert.equal(ok, true);
  const strokes = segs.filter(s => s[0] === 'stroke').length;
  assert.equal(strokes, 1, '连续点只画一段，实际 ' + strokes);
  const lines = segs.filter(s => s[0] === 'line').length;
  assert.equal(lines, 2, '三个点 = 两条连线');
});

test('alignSeries：传入非数组（缓存包装对象等）不崩，返回空结构', () => {
  // 真实事故：Cache.get 返回 { val, at } 包装，直接传进去会在这里炸
  // "object is not iterable"，整个 hero 走势图全部画不出来。
  const a = S.alignSeries({ val: [{ time: D('2026-10-16'), close: 1 }] });
  assert.equal(a.axis.length, 0);
  assert.equal(a.series.length, 0);
  assert.deepEqual(S.alignSeries(null).axis, []);
  assert.deepEqual(S.alignSeries(undefined).axis, []);
});

test('alignSeries：单条序列也能工作（不因只有一条就拒绝）', () => {
  const a = S.alignSeries([{ key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 110 }] }]);
  assert.equal(a.axis.length, 2);
  assert.equal(a.series.length, 1);
  assert.equal(a.series[0].values[0], 0);
});

test('drawAligned：跨过一个休市日（缺 1 天）仍连成一段 —— 那是真实的"这天没开盘"', () => {
  const segs = [];
  const stub = {
    clientWidth: 100, clientHeight: 30,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {},
      moveTo(x, y) { segs.push(['move', x]); },
      lineTo(x, y) { segs.push(['line', x]); },
      closePath() {}, stroke() { segs.push(['stroke']); }, fill() {},
      save() {}, restore() {}, setLineDash() {},
    }),
  };
  // 共享轴 11 天（步长 10），本序列缺 10-17 一天 → 两点间距 20（= 2 步）
  const ok = S.drawAligned(stub, [{ x: 0, y: 10 }, { x: 20, y: 12 }], { color: '#fff', axisLen: 11 });
  assert.equal(ok, true);
  const strokes = segs.filter(s => s[0] === 'stroke').length;
  assert.equal(strokes, 1, '缺 1 个休市日不该断线（时间上确实隔了一天），实际 ' + strokes);
});

test('drawAligned：空出一整段（> 4 步）才断线（长假/长时间无数据）', () => {
  const segs = [];
  const stub = {
    clientWidth: 100, clientHeight: 30,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {},
      moveTo(x, y) { segs.push(['move', x]); },
      lineTo(x, y) { segs.push(['line', x]); },
      closePath() {}, stroke() { segs.push(['stroke']); }, fill() {},
      save() {}, restore() {}, setLineDash() {},
    }),
  };
  // 共享轴 11 天（步长 10），两点间距 100 → 中间空了 9 天
  const ok = S.drawAligned(stub, [{ x: 0, y: 10 }, { x: 100, y: 20 }], { color: '#fff', axisLen: 11 });
  assert.equal(ok, true);
  const strokes = segs.filter(s => s[0] === 'stroke').length;
  assert.equal(strokes, 2, '空出一整段应断成两段，实际 ' + strokes);
});

test('zeroLineY：0% 基准线在对称标尺的正中', () => {
  const a = S.alignSeries([
    { key: 'a', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 120 }] },
    { key: 'b', rows: [{ time: D('2026-10-16'), close: 100 }, { time: D('2026-10-19'), close: 90 }] },
  ]);
  const s = S.alignedScale(a);
  const y = S.zeroLineY(s, 40);
  assert.ok(Math.abs(y - 20) < 0.01, '0% 应在中线 y=20，实际 ' + y);
  assert.equal(S.zeroLineY(null, 40), null);
  assert.equal(S.zeroLineY({ min: 0, max: 0 }, 40), null, '标尺塌了不给基准线');
});

test('alignedPoints：各格宽度差 1~2px 时，同一日期的相对位置仍一致（栅格分数分配的固有误差）', () => {
  // 线上实测 hero 四格画布宽 478/476/478/476（1fr 不除尽的分数分配）。
  // 对齐的标准是"相对位置一致"（同一日期占同一比例），不是绝对像素相同。
  const rows = [
    { time: D('2026-10-16'), close: 100 },
    { time: D('2026-10-19'), close: 101 },
    { time: D('2026-10-20'), close: 102 },
  ];
  const a = S.alignSeries([{ key: 'a', rows }]);
  const s = S.alignedScale(a);
  const pA = S.alignedPoints(rows, a.axis, s, 478, 40);
  const pB = S.alignedPoints(rows, a.axis, s, 476, 40);
  assert.equal(pA.length, 3);
  assert.equal(pB.length, 3);
  for (let i = 0; i < 3; i++) {
    const rA = pA[i].x / 478, rB = pB[i].x / 476;
    assert.ok(Math.abs(rA - rB) < 1e-6, `第 ${i} 点相对位置应相同：${rA} vs ${rB}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
