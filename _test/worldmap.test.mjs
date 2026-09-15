/* worldmap.js 平面世界地图：纯几何离线单测（node _test/worldmap.test.mjs）
   覆盖：底图与事件点必须共用同一投影（曾因底图写成 lng+360 而整体东移 180°）、
   d3-geo 接管后的跨 180° 切割与孔洞绕序、缩放→聚类粒度阈值、
   模块加载形状（window.WorldMapView API 表面）。 */

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

// 记录型 Path2D 替身：让 buildLandPath 可以在无 DOM 环境下被断言
class FakePath2D {
  constructor() { this.cmds = []; }
  moveTo(x, y) { this.cmds.push(['M', x, y]); }
  lineTo(x, y) { this.cmds.push(['L', x, y]); }
  closePath() { this.cmds.push(['Z']); }
  points() { return this.cmds.filter(c => c[0] !== 'Z'); }
}

function baseCtx(extra = {}) {
  return {
    console, Math, Date, Number, String, Array, Object, isNaN, RegExp, Set, Map, Symbol, JSON,
    Error, TypeError, RangeError, parseFloat, parseInt, isFinite,
    Float64Array, Int32Array, Uint8Array, Uint16Array, ArrayBuffer,
    ...extra,
  };
}

function loadModule(rel, globalName, extraCtx = {}, libs = []) {
  const ctx = vm.createContext(baseCtx(extraCtx));
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  // 与浏览器同一套加载方式：UMD 挂到 self.d3 / self.topojson 上
  for (const lib of libs) {
    vm.runInContext(readFileSync(path.join(ROOT, lib), 'utf8'), ctx, { filename: lib });
  }
  vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return ctx.window[globalName];
}

// 与页面同序：d3-array 必须先于 d3-geo（后者对外部依赖 d3-array）
const WM = loadModule('js/worldmap.js', 'WorldMapView', {
  U: { escapeHTML: (s) => String(s == null ? '' : s) },   // utils.js 的最小 stub
  Path2D: FakePath2D,
}, ['lib/d3-array.min.js', 'lib/d3-geo.min.js']);

// 真实 atlas → Feature[]（topojson 在浏览器里是全局库，这里单独起一个上下文取）
let _feats = null;
function realFeatures() {
  if (_feats) return _feats;
  const topo = JSON.parse(readFileSync(path.join(ROOT, 'assets/globe/countries-110m.json'), 'utf8'));
  const ctx = vm.createContext(baseCtx());
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.runInContext(readFileSync(path.join(ROOT, 'lib/topojson-client.min.js'), 'utf8'), ctx, { filename: 'topojson' });
  _feats = ctx.topojson.feature(topo, topo.objects.countries).features;
  return _feats;
}

await test('d3 投影参数与 wx/wy 恒等（1 rad = 180/π 世界单位，原点在左上）', () => {
  const proj = WM.geo.d3Proj();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const [lng, lat] of [[0, 0], [-180, 0], [180, 0], [0, 90], [0, -90], [116.4, 39.9], [-74, 40.7]]) {
    const p = proj([lng, lat]);
    assert.ok(near(p[0], WM.geo.wx(lng)), `x 不一致 @(${lng},${lat}): ${p[0]} vs ${WM.geo.wx(lng)}`);
    assert.ok(near(p[1], WM.geo.wy(lat)), `y 不一致 @(${lng},${lat}): ${p[1]} vs ${WM.geo.wy(lat)}`);
  }
  assert.ok(near(WM.geo.wx(0), 180), '本初子午线必须在世界正中，而不是右边界');
  assert.ok(near(WM.geo.wy(0), 90));
});

await test('回归：底图顶点落在 wx/wy 定义的位置（曾写成 lng+360，陆地整体东移 180°）', () => {
  // 0°E~10°E / 0°N~10°N 的方块。绕序必须用 d3/TopoJSON/ESRI 约定
  // （小于半球的多边形外环取"从外看顺时针"），否则 d3 会把环读成"整个球面减这块"。
  const square = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] },
  };
  const built = WM.geo.buildLandPath([square]);
  assert.ok(built, '方块必须构建成功');
  assert.equal(built.rings, 1, '绕序正确时应恰好产出 1 个环，实得 ' + built.rings);
  const pts = built.path.points();
  assert.ok(pts.length >= 4, '至少四个角点');
  const xs = pts.map(p => p[1]), ys = pts.map(p => p[2]);
  // 关键不变式：底图包围盒 === 事件点投影的包围盒
  assert.equal(Math.min(...xs), WM.geo.wx(0), '左边界必须是 wx(0)=180，不是 0');
  assert.equal(Math.max(...xs), WM.geo.wx(10));
  assert.equal(Math.min(...ys), WM.geo.wy(10));
  assert.equal(Math.max(...ys), WM.geo.wy(0));
  assert.ok(pts.every(p => p[1] >= 0 && p[1] <= 360 && p[2] >= 0 && p[2] <= 180), '全部落在 0~360 × 0~180 世界域内');
});

await test('d3 接管跨 180°：环被切成两段，坐标不出现 ±180 之外的瞬移', () => {
  // 斐济式跨线环：178E → 179W → 179W → 178E（绕序同 d3/TopoJSON 约定）
  const cross = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[178, -17], [-178, -17], [-178, -18], [178, -18], [178, -17]]] },
  };
  const built = WM.geo.buildLandPath([cross]);
  assert.ok(built && built.rings >= 1, '跨线环必须产出几何');
  assert.equal(built.rings, 2, '±180° 处切开应得到 2 段，实得 ' + built.rings);
  // 逐环检查：环内不得出现"从 x≈359 直接连到 x≈0"的横贯线段
  // （跨环比较会把"第一段结尾→第二段开头"误判成一条横贯线，必须按环切开）
  const rings = [];
  let cur = null;
  for (const c of built.path.cmds) {
    if (c[0] === 'M') { cur = [c]; rings.push(cur); }
    else if (c[0] === 'L') { if (cur) cur.push(c); }
    else if (c[0] === 'Z') { cur = null; }
  }
  assert.equal(rings.length, 2);
  for (const r of rings) {
    for (let i = 1; i < r.length; i++) {
      assert.ok(Math.abs(r[i][1] - r[i - 1][1]) < 90, '环内出现横贯地图的线段（未在 ±180° 切开）');
    }
  }
  // 两段应分别贴在世界的左右两边缘
  assert.ok(rings[0].every(p => p[1] < 5), '左段应贴 x≈0');
  assert.ok(rings[1].every(p => p[1] > 355), '右段应贴 x≈360');
});

await test('底图必须真有点：真实世界 atlas 产出数千顶点，且不落在单一经度带', () => {
  const feats = realFeatures();
  const built = WM.geo.buildLandPath(feats);
  assert.ok(built, '真实 atlas 必须构建成功');
  const pts = built.path.points();
  assert.ok(pts.length > 5000, '顶点数异常偏少：' + pts.length);
  const xs = pts.map(p => p[1]);
  assert.ok(Math.min(...xs) < 20 && Math.max(...xs) > 340, '底图必须横跨整个世界（0~360）');
  // 覆盖七大洋都要有：北美、欧洲、亚洲、大洋洲各自所在经度带内都有顶点
  for (const [lo, hi, name] of [[-125 + 180, -70 + 180, '北美'], [0 + 180, 40 + 180, '欧非'], [100 + 180, 140 + 180, '东亚'], [115 + 180, 150 + 180, '澳洲']]) {
    const band = pts.filter(p => p[1] >= lo && p[1] <= hi);
    assert.ok(band.length > 100, name + ' 经度带内顶点过少：' + band.length);
  }
});

await test('防呆：底图里不得出现「整个球面轮廓」环（绕序被读反的信号）', () => {
  const built = WM.geo.buildLandPath(realFeatures());
  // 把指令切成一个个环，检查是否有一环的包围盒铺满整个世界
  const rings = [];
  let cur = null;
  for (const c of built.path.cmds) {
    if (c[0] === 'M') { if (!cur) { cur = []; rings.push(cur); } cur.push(c); }
    else if (c[0] === 'L') { if (cur) cur.push(c); }
    else if (c[0] === 'Z') { cur = null; }
  }
  for (const r of rings) {
    const w = Math.max(...r.map(p => p[1])) - Math.min(...r.map(p => p[1]));
    const h = Math.max(...r.map(p => p[2])) - Math.min(...r.map(p => p[2]));
    assert.ok(!(w > 359 && h > 179), '出现铺满世界的轮廓环——绕序反了，整张图会被填成"陆地以外的全球"');
  }
  // RFC 7946（逆时针外环）确实会被读成补集：这是 d3 的约定，写进测试免得后人踩
  const rfc = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
  assert.ok(WM.geo.buildLandPath([rfc]).rings > 1, 'RFC 7946 绕序应被 d3 读成补集（本项目数据用 TopoJSON 绕序）');
});

await test('bucketForZoomAt：缩放阈值决定聚类粒度（10/6/3/0 度）', () => {
  assert.equal(WM.geo.bucketForZoomAt(0.9), 10);   // 远景：10° 粗聚类
  assert.equal(WM.geo.bucketForZoomAt(1.49), 10);
  assert.equal(WM.geo.bucketForZoomAt(1.5), 6);    // 边界：进入 6° 档
  assert.equal(WM.geo.bucketForZoomAt(2.59), 6);
  assert.equal(WM.geo.bucketForZoomAt(2.6), 3);
  assert.equal(WM.geo.bucketForZoomAt(4.99), 3);
  assert.equal(WM.geo.bucketForZoomAt(5), 0);      // 近景：不聚类
  assert.equal(WM.geo.bucketForZoomAt(12), 0);
});

await test('wrapSx：拖过任意多个世界接缝后，点始终规范到离屏心最近的世界副本', () => {
  const span = 646, cw = 897;                     // fit≈1.79 时一个世界副本宽 646px
  const inBand = (sx) => sx >= cw / 2 - span / 2 && sx < cw / 2 + span / 2;
  // 初始视图的真实值域
  assert.ok(inBand(WM.geo.wrapSx(310, span, cw)), '域内点不动');
  // 向左/向右拖出 0.5、1、2.5 个世界后：美国点仍落在屏心附近的正确副本上
  for (const raw of [310 - 0.5 * span, 310 - 1 * span, 310 - 2.5 * span, 310 + 1 * span, 310 + 3 * span]) {
    const sx = WM.geo.wrapSx(raw, span, cw);
    assert.ok(inBand(sx), 'raw=' + raw + ' → ' + sx + ' 出环带');
    // 与未 wrap 的原点必须相差整数个副本（同一经度，不同世界）
    const k = (raw - sx) / span;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, '偏移不是整数个副本');
  }
});

await test('clampTxVal：setCenter 必须用目标缩放比钳制（回归：旧值钳制让首击事件总飞到美国）', () => {
  const near = (v, x) => Math.abs(v - x) < 0.1;
  // 场景复现：容器 1224，fit=3.4；从 fit 态首次 select → 目标缩放 2.2×fit=7.48，
  // 点中国事件（wx=296.4）。钳制若用旧缩放比（span 恰=屏宽 → 返回 0）→ tx=0
  // → 镜头中心 = 世界 x 81.8 = 经度 -98.2（美国中部），"点任何事件都飞到美国"
  const tx = WM.geo.clampTxVal(1224 / 2 - 296.4 * 7.48, 1224, 7.48);
  assert.ok(near(tx, -1468.8), '应钳到下界 cw-span=-1468.8，实得 ' + tx);
  const centerLng = (1224 / 2 - tx) / 7.48 - 180;
  assert.ok(centerLng > 0, '中国事件的镜头中心应在东经（旧 bug 是 -98.2 美国中部），实得 ' + centerLng);
  // 美国事件（wx=103）：无钳制，居中经度 = 事件自身经度 -77 ✓ 本来就对
  const txUs = WM.geo.clampTxVal(1224 / 2 - 103 * 7.48, 1224, 7.48);
  assert.ok(near((1224 / 2 - txUs) / 7.48 - 180, -77), '美国事件应居中 -77，实得 ' + ((1224 / 2 - txUs) / 7.48 - 180));
});

await test('clampTyVal：纵向拖不露出界，缩得比容器小时锁垂直居中', () => {
  const S = 1.794;                     // 世界高 180*1.794 ≈ 322.9
  const near = (v, x) => Math.abs(v - x) < 0.1;
  // 容器 300 < 世界 322.9 → ty ∈ [300-322.9, 0] = [-22.9, 0]
  assert.ok(near(WM.geo.clampTyVal(-200, 300, S), -22.9), '下界 -22.9');
  assert.ok(near(WM.geo.clampTyVal(50, 300, S), 0), '上界 0');
  assert.ok(near(WM.geo.clampTyVal(-10, 300, S), -10), '界内不动');
  // 世界高恰与容器相等（322.9 vs 323，世界略矮 0.08）→ 锁垂直居中 ≈ 0.04
  assert.ok(near(WM.geo.clampTyVal(-40, 323, S), 0.04), '略矮锁居中');
  assert.ok(near(WM.geo.clampTyVal(500, 323, S), 0.04), '大幅越界仍居中');
  // 世界比容器矮得多（世界高 100 < 容器 500）→ 恒等于垂直居中 200
  assert.ok(near(WM.geo.clampTyVal(-300, 500, 100 / 180), 200), '缩太小锁垂直居中');
  assert.ok(near(WM.geo.clampTyVal(900, 500, 100 / 180), 200), '缩太小锁垂直居中(2)');
});

await test('featureAt：空白点选的点在多边形国家命中（修复"点新疆判给巴基斯坦"）', () => {
  const feats = realFeatures();
  // 中国内陆（乌鲁木齐）必须命中 id=156 的 feature（world-atlas ISO numeric），海面为 null
  const cn = WM.geo.featureAt(feats, 87.6, 43.8);
  assert.ok(cn, '乌鲁木齐应命中陆地多边形');
  assert.equal(cn.id, '156', '应命中中国 feature（id=156），实得 ' + JSON.stringify(cn));
  const jp = WM.geo.featureAt(feats, 139.69, 35.68);
  assert.ok(jp && jp.id === '392', '东京应命中日本（392）');
  assert.equal(WM.geo.featureAt(feats, 0, 0), null, '大西洋几内亚湾 (0,0) 是海面');
  assert.equal(WM.geo.featureAt(null, 116, 40), null, '无 feature 列表时无害返回 null');
});

await test('模块形状：API 表面与 GlobeView 同形，初始未就绪', () => {
  for (const k of ['create', 'setEvents', 'select', 'focus', 'resize', 'dispose', 'isReady']) {
    assert.equal(typeof WM[k], 'function', 'missing api: ' + k);
  }
  assert.equal(WM.isReady(), false);   // 测试环境无 DOM，create 不可调，但模块须无害加载
});

console.log(`\nworldmap: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
