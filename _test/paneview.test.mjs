/* paneview.test.mjs —— 副图指标窗几何：纯离线单测（node _test/paneview.test.mjs）
 *
 * 盯的是一个具体的退化：副图与主图横向错位。
 * 两块各自算自己的 x，一旦宽度差几像素，"副图上 10-20 的 RSI"就落在
 * "主图上 10-18 的 K 线"旁边 —— 读数全废，而且界面上完全看不出来（只是"看着有点怪"）。
 * 所以这里直接断言坐标数值。 */

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

const ctx = vm.createContext({ console, Math, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity, isFinite, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/paneview.js'), 'utf8'), ctx, { filename: 'js/paneview.js' });
const V = ctx.window.PaneView;

await test('axis：按数据范围自适应，含 0，上下留余量', () => {
  const a = V.axis([10, 20, 30], { includeZero: true });
  assert.ok(a, '应返回纵轴域');
  assert.ok(a.min < 0, '含 0 → 下界应为负（留白）');
  assert.ok(a.max > 30, '上界应高于最大值');
  assert.ok(a.max > a.min);
});

await test('axis：刻度是好读的数（0.5/1/2/5 步长）', () => {
  const a = V.axis([0, 100], { includeZero: true });
  assert.ok(a.ticks.length >= 3, '刻度不应太少');
  a.ticks.forEach(t => {
    const step = a.ticks.length > 1 ? a.ticks[1] - a.ticks[0] : 1;
    const ratio = step / Math.pow(10, Math.floor(Math.log10(step)));
    assert.ok([1, 2, 2.5, 5, 10].some(m => Math.abs(ratio - m) < 1e-6), `步长 ${step} 不是好读的数`);
  });
});

await test('axis：无数据 → null（不画，不猜）', () => {
  assert.equal(V.axis([], {}), null);
  assert.equal(V.axis(null, {}), null);
  assert.equal(V.axis([NaN, Infinity], {}), null);
});

await test('points：y 与值反向（值越大越靠上），x 原样保留', () => {
  const dom = { min: 0, max: 100 };
  const pts = V.points([{ time: 't1', value: 0, x: 0 }, { time: 't2', value: 100, x: 200 }], dom, 200, 40, 4);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].y, 36, '最小值贴下沿（h - pad）');
  assert.equal(pts[1].y, 4, '最大值贴上沿（pad）');
  assert.equal(pts[1].x, 200, 'x 不该被改写');
});

await test('points：缺测点不产出点（调用方据此断线）', () => {
  const dom = { min: 0, max: 100 };
  const pts = V.points([{ time: 'a', value: 10, x: 0 }, { time: 'b', value: null, x: 10 }, { time: 'c', value: 90, x: 20 }], dom, 200, 40, 4);
  assert.equal(pts.length, 2, 'null 值应被跳过');
  assert.ok(pts.every(p => Number.isFinite(p.y)));
});

await test('layout：横轴按时间序列等分（首尾贴边）', () => {
  const times = ['t1', 't2', 't3', 't4'];
  const dom = { min: 0, max: 100 };
  const m = V.layout([{ name: 'RSI', color: '#f00', data: [{ time: 't1', value: 0 }, { time: 't4', value: 100 }] }],
    times, dom, 300, 40, 4);
  assert.equal(m.lines.length, 1);
  const pts = m.lines[0].pts;
  assert.equal(pts[0].x, 0, '首点贴左');
  assert.equal(pts[pts.length - 1].x, 300, '末点贴右');
});

await test('layout：时间对不上的点被丢弃（不画到别的时间上）', () => {
  const times = ['t1', 't2'];
  const dom = { min: 0, max: 100 };
  const m = V.layout([{ name: 'X', color: '#f00', data: [{ time: 't1', value: 10 }, { time: '不存在', value: 90 }] }],
    times, dom, 200, 40, 4);
  assert.equal(m.lines[0].pts.length, 1, '不在时间轴上的点应被丢掉');
});

await test('layout：给了 xMap 就用主图的真实坐标（不等分）', () => {
  // 主图 fitContent 后首尾 bar 各留半个 bar 间距，等分会整体偏半格
  const times = ['t1', 't2', 't3', 't4'];
  const dom = { min: 0, max: 100 };
  const xMap = new Map([['t1', 6.5], ['t2', 19.5], ['t3', 32.5], ['t4', 45.5]]);
  const m = V.layout([{ name: 'RSI', color: '#f00', data: [{ time: 't1', value: 0 }, { time: 't4', value: 100 }] }],
    times, dom, 300, 40, 4, xMap);
  const pts = m.lines[0].pts;
  assert.equal(pts[0].x, 6.5, '首点应取主图给的坐标');
  assert.equal(pts[pts.length - 1].x, 45.5, '末点应取主图给的坐标');
});

await test('layout：xMap 里缺的时间点回退等分（不丢数据）', () => {
  const times = ['t1', 't2', 't3'];
  const dom = { min: 0, max: 100 };
  const xMap = new Map([['t1', 10], ['t3', 210]]);
  const m = V.layout([{ name: 'RSI', color: '#f00', data: [{ time: 't1', value: 0 }, { time: 't2', value: 50 }, { time: 't3', value: 100 }] }],
    times, dom, 200, 40, 4, xMap);
  const pts = m.lines[0].pts;
  assert.equal(pts.length, 3, '三个点都要在');
  assert.equal(pts[1].x, 100, '缺坐标的时间点按等分落位');
});

await test('layout：bar 与 line 分开归类', () => {
  const times = ['t1', 't2'];
  const dom = { min: 0, max: 100 };
  const m = V.layout([
    { name: 'DIF', color: '#f00', data: [{ time: 't1', value: 1 }] },
    { name: 'MACD', color: '#0f0', data: [{ time: 't1', value: 2 }], kind: 'bar' },
  ], times, dom, 200, 40, 4);
  assert.equal(m.lines.length, 1);
  assert.equal(m.bars.length, 1);
  assert.equal(m.bars[0].name, 'MACD');
});

await test('segments：中间缺交易日就断开（不连成一条假连续线）', () => {
  // 步长 10；中间跳过一段（x 从 10 跳到 40）→ 应断成两段
  const segs = V.segments([{ x: 0 }, { x: 10 }, { x: 40 }, { x: 50 }], 10);
  assert.equal(segs.length, 2, '缺口处应断开');
  assert.equal(segs[0].length, 2);
  assert.equal(segs[1].length, 2);
});

await test('segments：连续点不断开', () => {
  const segs = V.segments([{ x: 0 }, { x: 10 }, { x: 20 }], 10);
  assert.equal(segs.length, 1);
});

await test('fmtTick：刻度文本好读（不留长小数）', () => {
  assert.equal(V.fmtTick(0), '0');
  assert.equal(V.fmtTick(50), '50');
  assert.equal(V.fmtTick(2.5), '2.5');
  assert.ok(V.fmtTick(1234.56).length <= 5, '大数不应带小数');
});

/* ---------- affineX：平移/缩放后的坐标补全（2026-10-21 适配修复） ---------- */

await test('affineX：稀疏可见点 → 全量映射（不可见点外推出画布外，不落回可见区）', () => {
  const times = ['a', 'b', 'c', 'd', 'e'];
  // 用户往右平移一格：a 不可见（timeToCoordinate 回 null），b..e 可见
  const sparse = new Map([['b', 5], ['c', 15], ['d', 25], ['e', 35]]);
  const m = V.affineX(times, sparse, 300);
  assert.ok(m, '应返回完整映射');
  assert.equal(m.get('b'), 5);
  assert.equal(m.get('e'), 35);
  assert.ok(m.get('a') < 0, '画布外的点应外推为负 x（被 canvas 裁掉），等分回退会把它摆进可见区成幽灵柱');
});

await test('affineX：缩放后间距变了照样线性（斜率取自可见点）', () => {
  const times = ['a', 'b', 'c', 'd'];
  const sparse = new Map([['b', 0], ['c', 50], ['d', 100]]);   // barSpacing 50（放大）
  const m = V.affineX(times, sparse, 300);
  assert.equal(m.get('a'), -50, '首点外推到画布左侧外');
  assert.equal(m.get('d'), 100);
});

await test('affineX：可见点不足两个 / 斜率非正 / 超出绘图区 → null（调用方回退等分）', () => {
  const times = ['a', 'b', 'c'];
  assert.equal(V.affineX(times, new Map([['a', 5]]), 300), null, '单点无法拟合');
  assert.equal(V.affineX(times, new Map([['a', 50], ['b', 40]]), 300), null, '斜率非正说明数据乱序');
  assert.equal(V.affineX(times, new Map([['a', 200], ['b', 500]]), 300), null, '右缘超出绘图区 1.25 倍：换算基准不是绘图区');
  assert.equal(V.affineX(times, null, 300), null, '没有稀疏点');
});

await test('affineX：右拖出空白边距（x1 < plotW）是合法视野，不该判失败', () => {
  const times = ['a', 'b', 'c'];
  const sparse = new Map([['a', 10], ['b', 20], ['c', 30]]);
  const m = V.affineX(times, sparse, 300);
  assert.ok(m, '右缘留白是真实视野，仿射依旧正确');
});

/* ---------- draw：标题 + 十字竖线（与主图联动） ---------- */

function drawStub(capture) {
  return {
    clientWidth: 200, clientHeight: 40, width: 0, height: 0,
    getContext: () => ({
      setTransform() { }, clearRect() { }, beginPath() { }, closePath() { },
      stroke() { }, fill() { }, fillRect() { }, arc() { }, save() { }, restore() { },
      setLineDash() { },
      moveTo(x, y) { (capture.moves = capture.moves || []).push({ x, y }); },
      lineTo(x, y) { (capture.lines = capture.lines || []).push({ x, y }); },
      set textAlign(v) { capture.align = v; }, get textAlign() { return capture.align; },
      set textBaseline(v) { capture.baseline = v; }, get textBaseline() { return capture.baseline; },
      fillText(t) { (capture.texts = capture.texts || []).push(String(t)); },
    }),
  };
}

await test('draw：标题画在左上（TradingView 副图的指标名）', () => {
  const cap = {};
  V.draw(drawStub(cap), { lines: [], bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 1, ticks: [] }, title: 'RSI(14)',
  });
  assert.ok((cap.texts || []).some(t => /RSI\(14\)/.test(t)), '标题应被画出来');
});

await test('draw：crossX 画竖线，标题附光标处的当前值', () => {
  const cap = {};
  // 一条单点 RSI 线：x=50 处 value=63.4（layout 落位后进 draw）
  const m = V.layout([{ name: 'RSI', color: '#f00', data: [{ time: 't1', value: 63.4 }] }],
    ['t1'], { min: 0, max: 100 }, 160, 40, 4, new Map([['t1', 50]]));
  V.draw(drawStub(cap), { lines: m.lines, bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 100, ticks: [50] }, crossX: 50, title: 'RSI(14)',
  });
  assert.ok((cap.moves || []).some(p => p.x === 50.5 && p.y === 0), '十字竖线应落在 crossX（+0.5 半像素对齐）');
  assert.ok((cap.texts || []).some(t => /RSI\(14\)\s+63\.4/.test(t)), '标题应带光标处读数');
});

await test('draw：crossX 离任何点都远时标题不带读数（不给假读数）', () => {
  const cap = {};
  const m = V.layout([{ name: 'RSI', color: '#f00', data: [{ time: 't1', value: 63.4 }] }],
    ['t1'], { min: 0, max: 100 }, 160, 40, 4, new Map([['t1', 50]]));
  V.draw(drawStub(cap), { lines: m.lines, bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 100, ticks: [] }, crossX: 140, title: 'RSI(14)',
  });
  assert.ok((cap.texts || []).some(t => /^RSI\(14\)$/.test(t)), '远处只画指标名');
  assert.ok((cap.texts || []).every(t => !/63\.4/.test(t)), '不该出现吸附假读数');
});

await test('draw：无数据/无 canvas 时不抛（调用方保持空白）', () => {
  assert.equal(V.draw(null, { lines: [], bars: [] }, {}), false);
  assert.equal(V.draw({}, { lines: [], bars: [] }, {}), false);
  const stub = { clientWidth: 200, clientHeight: 40, getContext: () => null };
  assert.equal(V.draw(stub, { lines: [], bars: [] }, { domain: { min: 0, max: 1, ticks: [] } }), false);
});

await test('draw：正常绘制返回 true 且调用了 canvas API', () => {
  const calls = [];
  const stub = {
    clientWidth: 200, clientHeight: 40, width: 0, height: 0,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, stroke() {}, fill() {}, fillRect() {}, arc() {}, save() {}, restore() {},
      setLineDash() {}, fillText(t) { calls.push(String(t)); },
    }),
  };
  const ok = V.draw(stub, { lines: [], bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 100, ticks: [0, 50, 100] },
  });
  assert.equal(ok, true);
  assert.ok(calls.length >= 3, '刻度文字应被画出来，实际 ' + calls.length);
});

await test('draw：副图刻度右对齐到画布右缘（与主图价格轴同一条边）', () => {
  const texts = [];
  let align = null;
  const stub = {
    clientWidth: 200, clientHeight: 40, width: 0, height: 0,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, stroke() {}, fill() {}, fillRect() {}, arc() {}, save() {}, restore() {},
      setLineDash() {},
      set textAlign(v) { align = v; },
      get textAlign() { return align; },
      fillText(t, x) { texts.push({ t: String(t), x }); },
    }),
  };
  V.draw(stub, { lines: [], bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 100, ticks: [0, 50, 100] },
  });
  assert.ok(texts.length >= 3, '刻度文字应被画出来');
  assert.equal(align, 'right', '刻度文字应右对齐');
  texts.forEach(t => assert.equal(t.x, 196, '刻度应贴在画布右缘（w - 4）'));
});

await test('draw：柱按调用方给的 up 染色（不给才按值的正负）', () => {
  const rects = [];
  let color = '';
  const stub = {
    clientWidth: 200, clientHeight: 40, width: 0, height: 0,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, stroke() {}, fill() {}, arc() {}, save() {}, restore() {},
      setLineDash() {}, fillText() {}, globalAlpha: 1,
      set fillStyle(v) { color = v; },
      get fillStyle() { return color; },
      fillRect(x, y, w, h) { rects.push({ color, x, y, w, h }); },
    }),
  };
  V.draw(stub, {
    lines: [],
    bars: [{ name: '成交量', pts: [
      { x: 10, y: 5, value: 100, up: true },
      { x: 20, y: 30, value: 50, up: false },
    ] }],
  }, { w: 200, axisRight: 40, domain: { min: 0, max: 100, ticks: [0, 50, 100] }, upColor: 'RED', downColor: 'GREEN' });
  assert.equal(rects.length, 2, '两根柱都要画出来');
  assert.equal(rects[0].color, 'RED', 'up=true 的柱用涨色');
  assert.equal(rects[1].color, 'GREEN', 'up=false 的柱用跌色');
});

await test('charts.js：柱必须进 layout 的入参（否则"有刻度没柱子"）', () => {
  // 回归：柱只参与纵轴取值、没进 layout → 纵轴有刻度但图上一根柱都没有
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const i = src.indexOf('PaneView.layout(');
  assert.ok(i > 0, '没找到 PaneView.layout 调用');
  const call = src.slice(i, i + 600);
  assert.ok(/bars/.test(call), 'layout 的入参里必须带上 bars（成交量 / MACD 柱）');
  assert.ok(/bars:\s*model\.bars/.test(src), '绘制时必须用 model.bars（layout 落位后的柱）');
});

await test('charts.js：主图平移/缩放副图必须跟随（订阅 visible range）', () => {
  // 回归（2026-10-21 适配复查）：副图只在 setData/切指标时重画，
  // 拖动主图后副图停在旧视野，"逐像素对齐"第一次拖动就断了
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  assert.ok(/subscribeVisibleLogicalRangeChange/.test(src), '必须订阅主图可见区变化');
  assert.ok(/unsubscribeVisibleLogicalRangeChange/.test(src), 'remove() 时必须解绑');
});

await test('charts.js：setPane 参数变化也要重画（RSI 14→6 图不能不动）', () => {
  // 回归（2026-10-21 适配复查）：只判 key 变化 → 改 RSI 周期/MACD 快慢线后副图不刷新
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const i = src.indexOf('function setPane(');
  assert.ok(i > 0, '没找到 setPane');
  const body = src.slice(i, i + 700);
  assert.ok(/JSON\.stringify\(paneParams/.test(body), 'changed 判定必须包含 params 对比');
});

await test('charts.js：副图宽度监听用 ResizeObserver（布局变化不止 window.resize）', () => {
  // 折叠面板展开/换肤侧栏等不改窗口尺寸的布局变化，window.resize 接不住
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  assert.ok(/ResizeObserver/.test(src), '必须用 ResizeObserver 观察副图自身');
  assert.ok(/disconnect/.test(src), 'remove() 时必须 disconnect');
});

await test('draw：刻度文案可用调用方指定的格式化（成交量显示亿/万）', () => {
  const texts = [];
  const stub = {
    clientWidth: 200, clientHeight: 40, width: 0, height: 0,
    getContext: () => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, stroke() {}, fill() {}, fillRect() {}, arc() {}, save() {}, restore() {},
      setLineDash() {},
      set textAlign(v) {}, get textAlign() { return ''; },
      fillText(t) { texts.push(String(t)); },
    }),
  };
  V.draw(stub, { lines: [], bars: [] }, {
    w: 200, axisRight: 40, domain: { min: 0, max: 1e9, ticks: [0, 5e8, 1e9] },
    fmtTick: (v) => (v >= 1e8 ? (v / 1e8) + '亿' : String(v)),
  });
  assert.ok(texts.includes('5亿'), '自定义格式化要生效，实际 ' + texts.join(','));
  assert.ok(!texts.includes('500000000'), '不该再出现原始大数');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
