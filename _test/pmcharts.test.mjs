/* pmcharts.test.mjs —— 市场预测图形层：纯离线单测（node _test/pmcharts.test.mjs）
   覆盖：环图扇区计算（占比归一 / rest 扇区 / 全零不画）/ 圆环扇形路径几何 /
   走势纵轴域（最小跨度、不越出 0~1）/ 走势坐标（缺测断开、点数不足不画）/
   SVG 输出的必要结构。
   这一层算错在界面上不报错、只会画歪（扇区凑不出一整圈、线跑到轨道外），
   所以坐标和角度全部直接断言数值。 */

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

function loadModule(rel, globalName) {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, RegExp, Set, Map, JSON });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return ctx.window[globalName];
}

const C = loadModule('js/pmcharts.js', 'PMCharts');

await test('donutSlices：占比归一，扇区角度首尾相接铺满一整圈', () => {
  const s = C.donutSlices([
    { id: 'a', label: 'A', probability: 0.6 },
    { id: 'b', label: 'B', probability: 0.4 },
  ], null);
  assert.equal(s.length, 2);
  assert.equal(s[0].share, 0.6);
  assert.equal(s[1].share, 0.4);
  assert.equal(s[0].a0, 0);
  assert.equal(s[1].a0, 0.6);
  assert.ok(Math.abs(s[1].a1 - 1) < 1e-9, '最后一片必须收口到 1');
  assert.equal(s[0].color, C.PALETTE[0]);
  // 合计不足 1（缺了未列出的档位）→ 仍铺满一整圈，按显示总质量归一
  const s2 = C.donutSlices([
    { id: 'a', label: 'A', probability: 0.6 },
    { id: 'b', label: 'B', probability: 0.3 },
  ], null);
  assert.ok(Math.abs(s2[0].share - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s2[1].a1 - 1) < 1e-9);
});

await test('donutSlices：rest 单独成片并标灰，总量守恒', () => {
  const s = C.donutSlices([
    { id: 'a', label: 'A', probability: 0.5 },
    { id: 'b', label: 'B', probability: 0.3 },
  ], { probability: 0.2, count: 3 }, '其他');
  assert.equal(s.length, 3);
  const rest = s[2];
  assert.equal(rest.rest, true);
  assert.equal(rest.label, '其他');
  assert.equal(rest.color, C.REST_COLOR);
  assert.equal(rest.value, 0.2);
  assert.ok(Math.abs(rest.share - 0.2) < 1e-9);
  assert.ok(Math.abs(s[2].a1 - 1) < 1e-9);
  // rest 概率为 0 或 count 为 0 → 不出"其他"扇区
  assert.equal(C.donutSlices([{ id: 'a', label: 'A', probability: 1 }], { probability: 0, count: 0 }).length, 1);
  assert.equal(C.donutSlices([{ id: 'a', label: 'A', probability: 1 }], { probability: 0.1, count: 0 }).length, 1);
});

await test('donutSlices：总量为 0 → 不画（空态不造假图）', () => {
  assert.equal(C.donutSlices([], null).length, 0);
  assert.equal(C.donutSlices([{ id: 'a', label: 'A', probability: 0 }], null).length, 0);
  assert.equal(C.donutSlices(null, null).length, 0);
});

await test('donutSlices：报价合计偏离 100% 时按显示总质量归一（占比形状），数值不篡改', () => {
  // 独立盘口报价合计 1.28：环图按占比画，图例仍是真实报价
  const s = C.donutSlices([
    { id: 'a', label: 'A', probability: 0.8 },
    { id: 'b', label: 'B', probability: 0.48 },
  ], null);
  assert.equal(s[0].value, 0.8, '真实报价不能被归一化改写');
  assert.ok(Math.abs(s[0].share - 0.8 / 1.28) < 1e-9, '占比按显示总质量归一');
  assert.ok(Math.abs(s[1].a1 - 1) < 1e-9, '仍然铺满一整圈');
});

await test('arcPath：扇形几何正确，整圈走环形路径不塌成直线', () => {
  const d = C.arcPath(50, 50, 48, 32, 0, 0.25);
  assert.match(d, /^M/, '必须以 M 开头');
  assert.match(d, /A48 48/, '外圆半径 48');
  assert.match(d, /A32 32/, '内圆半径 32');
  assert.match(d, /Z$/, '必须闭合');
  // 12 点方向的起点：cx + r·cos(-90°)=cx，cy + r·sin(-90°)=cy-r
  assert.ok(d.includes('50 2'), `12 点起点应为 50 2，实际 ${d.slice(0, 40)}`);
  // 整圈（share=1）不能退化成一条线
  const full = C.arcPath(50, 50, 48, 32, 0, 1);
  assert.ok(full.split('Z').length > 3, '整圈应拆成外圆+内圆两条子路径');
  assert.ok(!/^M50 2A48 48 0 0 1 50 2/.test(full), '整圈不能画成同起终点的退化扇形');
});

await test('trendDomain：贴着数据走，但至少留 MIN_SPAN 跨度，且不越出 0~1', () => {
  const wide = C.trendDomain([{ t: 1, p: 0.2 }, { t: 2, p: 0.8 }]);
  assert.equal(wide.lo, 0.2);
  assert.equal(wide.hi, 0.8);
  // 极窄波动：不能被拉成"暴涨"，跨度要撑到 MIN_SPAN
  const flat = C.trendDomain([{ t: 1, p: 0.845 }, { t: 2, p: 0.85 }]);
  assert.ok(Math.abs((flat.hi - flat.lo) - C.MIN_SPAN) < 1e-9, '最小跨度应为 MIN_SPAN');
  assert.ok(flat.lo <= 0.845 && flat.hi >= 0.85, '数据必须落在域内');
  // 上界不能超过 1
  const top = C.trendDomain([{ t: 1, p: 0.9 }, { t: 2, p: 1 }]);
  assert.ok(top.hi <= 1, '纵轴上界不能超过 1');
  assert.ok(top.lo >= 0, '纵轴下界不能低于 0');
  assert.equal(C.trendDomain([]), null);
});

await test('trendPoints：坐标在画布内，y 轴上下翻转（高概率在上）', () => {
  const geo = C.trendPoints([
    { t: 1, p: 0.2 }, { t: 2, p: 0.5 }, { t: 3, p: 0.9 },
  ], 200, 60, 4);
  assert.ok(geo, '点数足够应出坐标');
  const seg = geo.segments[0];
  assert.equal(seg.length, 3);
  assert.equal(seg[0].x, 0);
  assert.equal(seg[2].x, 200);
  assert.ok(seg[0].y > seg[2].y, '概率高的点 y 更小（在上方）');
  seg.forEach(p => {
    assert.ok(p.y >= 4 && p.y <= 56, `y 应落在画布内，实际 ${p.y}`);
    assert.ok(p.x >= 0 && p.x <= 200);
  });
});

await test('trendPoints：时间断档不连线，拆成多段', () => {
  const geo = C.trendPoints([
    { t: 0, p: 0.5 }, { t: 3600000, p: 0.6 },
    { t: 100 * 3600000, p: 0.7 }, { t: 101 * 3600000, p: 0.8 },
  ], 200, 60, 4, 4 * 3600000);
  assert.equal(geo.segments.length, 2, '中间长空档应断开');
  assert.equal(geo.segments[0].length, 2);
  assert.equal(geo.segments[1].length, 2);
});

await test('trendPoints：数据不足/非法一律不画（不画 = 诚实）', () => {
  assert.equal(C.trendPoints([{ t: 1, p: 0.5 }], 200, 60, 4), null, '单点不出图');
  assert.equal(C.trendPoints([], 200, 60, 4), null);
  assert.equal(C.trendPoints([{ t: 1, p: 0.5 }, { t: 2, p: NaN }], 200, 60, 4), null);
  assert.equal(C.trendPoints([{ t: 1, p: 0.5 }, { t: 2, p: 0.6 }], 0, 60, 4), null, '宽为 0 不画');
  assert.equal(C.trendPoints([{ t: 1, p: 0.5 }, { t: 2, p: 0.6 }], 200, 6, 4), null, '高度不足不画');
});

await test('donutSVG / trendSVG：输出结构完整，空数据返回空串', () => {
  const s = C.donutSlices([{ id: 'a', label: 'A', probability: 0.7 }, { id: 'b', label: 'B', probability: 0.3 }], null);
  const svg = C.donutSVG(s, { size: 100, thickness: 14, centerTop: '最高', centerMain: '70.0%', centerSub: 'A' });
  assert.match(svg, /<svg class="pm-donut"/);
  assert.equal((svg.match(/class="pm-slice/g) || []).length, 2, '两个扇区');
  assert.match(svg, /pm-donut-cm num/);
  assert.match(svg, /<title>/, '扇区要带 title 说明');
  assert.equal(C.donutSVG([], {}), '');

  const tsvg = C.trendSVG([{ t: 1, p: 0.5 }, { t: 2, p: 0.7 }], { w: 200, h: 50 });
  assert.match(tsvg, /pm-trend-line/);
  assert.match(tsvg, /pm-trend-area/);
  assert.match(tsvg, /pm-trend-dot/);
  assert.equal(C.trendSVG([{ t: 1, p: 0.5 }], { w: 200, h: 50 }), '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
