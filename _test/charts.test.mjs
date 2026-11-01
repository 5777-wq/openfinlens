#!/usr/bin/env node
/* charts.test.mjs —— charts.js 纯函数口径（vm 沙箱载真实源码，零 DOM 零网络）
 * 用法：node _test/charts.test.mjs
 *
 * 覆盖三块：
 *   · legendBadge：图表角落「代码 · 周期」徽标的拼接口径（空段剔除）；
 *   · slotStyles：主图指标槽位的取色下标/线宽归一（BOLL 三轨顺延、非法值回退）；
 *   · calcMA：均线口径（正常窗口 / null 收盘断线 / n 大于序列长度）——
 *     calcMA 在 charts.js 导出多年但从未有单测，本轮一并钉死。
 * 载入方式照 utils.test.mjs 的 vm 沙箱先例：charts.js 顶层只定义函数 +
 * window.Charts 赋值，无 DOM / LightweightCharts 访问，可离线加载。
 * 跨 realm 数组不能 deepStrictEqual（原型不同），统一 JSON.stringify 串比较。 */

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

/* ---- 最小环境：charts.js 顶层无 DOM 依赖，window 自引用即可跑起来 ---- */
const ctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
  isFinite, Infinity, RegExp, Error, Promise, Map, Set, setTimeout, clearTimeout,
});
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8'), ctx, { filename: 'js/charts.js' });

const C = ctx.window.Charts;
const J = (v) => JSON.stringify(v);

/* ---------------- legendBadge：角落常显徽标 ---------------- */

test('legendBadge：双段拼接「代码 · 周期」', () => {
  assert.equal(C.legendBadge({ code: '600519', period: '日K' }), '600519 · 日K');
});

test('legendBadge：任一为空只显示另一段', () => {
  assert.equal(C.legendBadge({ code: '600519' }), '600519');
  assert.equal(C.legendBadge({ period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: '', period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: 'AAPL', period: '' }), 'AAPL');
});

test('legendBadge：null / undefined / 空对象 → 空串', () => {
  assert.equal(C.legendBadge(null), '');
  assert.equal(C.legendBadge(undefined), '');
  assert.equal(C.legendBadge({}), '');
  assert.equal(C.legendBadge('600519'), '');   // 非对象一律空串
});

test('legendBadge：纯空白段剔除 + 两端 trim', () => {
  assert.equal(C.legendBadge({ code: '   ', period: '日K' }), '日K');
  assert.equal(C.legendBadge({ code: ' 600519 ', period: ' 日K ' }), '600519 · 日K');
  assert.equal(C.legendBadge({ code: '  ', period: '  ' }), '');
});

/* ---------------- slotStyles：槽位取色/线宽 ---------------- */

test('slotStyles：默认（无 ci/w）→ 回退槽位序号 + 1px，与改造前行为一致', () => {
  assert.equal(J(C.slotStyles([{ type: 'ma', n: 5 }])), J([{ ci: null, w: 1 }]));
  assert.equal(J(C.slotStyles([{ type: 'ma', n: 5 }], 6)), J([{ ci: null, w: 1 }]));   // paletteN 缺省 6
});

test('slotStyles：BOLL 三轨从 ci 起顺延取色（一条配置多轨取色连续）', () => {
  assert.equal(J(C.slotStyles([{ type: 'boll', n: 20, ci: 4 }])),
    J([{ ci: 4, w: 1 }, { ci: 5, w: 1 }, { ci: 0, w: 1 }]));
  assert.equal(J(C.slotStyles([{ type: 'boll', n: 20, ci: 5 }])),
    J([{ ci: 5, w: 1 }, { ci: 0, w: 1 }, { ci: 1, w: 1 }]));
});

test('slotStyles：线宽仅 1/2/3 合法，其余一律 1（容忍 DOM 来的字符串）', () => {
  const w = (cfg) => C.slotStyles([cfg])[0].w;
  assert.equal(w({ type: 'ma', w: 3 }), 3);
  assert.equal(w({ type: 'ma', w: '2' }), 2);
  assert.equal(w({ type: 'ma', w: 0 }), 1);
  assert.equal(w({ type: 'ma', w: 9 }), 1);
  assert.equal(w({ type: 'ma', w: -1 }), 1);
  assert.equal(w({ type: 'ma' }), 1);
});

test('slotStyles：ci 归一（负数/越界取模，非法 → null 回退槽位序号）', () => {
  const ci = (cfg) => C.slotStyles([cfg])[0].ci;
  assert.equal(ci({ type: 'ma', ci: -1 }), 5);
  assert.equal(ci({ type: 'ma', ci: 99 }), 3);
  assert.equal(ci({ type: 'ma', ci: '3' }), 3);
  assert.equal(ci({ type: 'ma', ci: 'abc' }), null);
  assert.equal(ci({ type: 'ma', ci: 0 }), 0);   // 0 是合法下标，不能当「缺失」
  assert.equal(ci({ type: 'ma' }), null);
  assert.equal(ci({ type: 'ma', ci: '' }), null);
});

test('slotStyles：paletteN 非 6 时按其取模（BOLL 三轨照样顺延）', () => {
  assert.equal(J(C.slotStyles([{ type: 'boll', ci: 5 }], 4)),
    J([{ ci: 1, w: 1 }, { ci: 2, w: 1 }, { ci: 3, w: 1 }]));
});

test('slotStyles：多条混合 → 输出长度与展开后槽位一一对应', () => {
  const out = C.slotStyles([
    { type: 'ma', n: 5 },
    { type: 'ema', n: 12, w: 2 },
    { type: 'boll', n: 20, ci: 5 },
  ]);
  assert.equal(out.length, 5);
  assert.equal(J(out[0]), J({ ci: null, w: 1 }));
  assert.equal(J(out[1]), J({ ci: null, w: 2 }));
  assert.equal(J(out[2]), J({ ci: 5, w: 1 }));
  assert.equal(J(out[3]), J({ ci: 0, w: 1 }));
  assert.equal(J(out[4]), J({ ci: 1, w: 1 }));
});

test('slotStyles：非对象/脏元素被跳过（不产生槽位、不抛错）', () => {
  const out = C.slotStyles([null, 'x', { type: 'ma', n: 5 }, 42]);
  assert.equal(out.length, 1);
  assert.equal(J(out[0]), J({ ci: null, w: 1 }));
  assert.equal(C.slotStyles('not-an-array').length, 0);
});

/* ---------------- calcMA：均线口径（导出多年但此前从未有单测） ---------------- */

test('calcMA：正常窗口 SMA（手算核对）', () => {
  const kl = [1, 2, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  const out = C.calcMA(kl, 2);
  assert.equal(J(out.map(p => p.value)), J([null, 1.5, 2.5, 3.5, 4.5]));
  assert.equal(out[2].time, 'd2');   // time 原样透传（含 null 值点）
});

test('calcMA：窗口含 null 收盘该点为 null（断线不假平均）', () => {
  const kl = [1, null, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  const out = C.calcMA(kl, 2);
  // i=1 窗口 [1,null]、i=2 窗口 [null,3] 都被污染 → 断线；i=3 起窗口干净恢复读数
  assert.equal(J(out.map(p => p.value)), J([null, null, null, 3.5, 4.5]));
});

test('calcMA：n 大于序列长度 → 全 null（不虚报）', () => {
  const kl = [1, 2, 3, 4, 5].map((c, i) => ({ time: 'd' + i, close: c }));
  assert.equal(J(C.calcMA(kl, 6).map(p => p.value)), J([null, null, null, null, null]));
});

/* ---------------- sanitizeDrawing：画线对象净化（存储口径） ---------------- */

test('sanitizeDrawing：合法 trend 往返（字段收敛、多余字段丢弃）', () => {
  assert.equal(J(C.sanitizeDrawing({ tool: 'trend', k1: '2026-09-16', p1: '1.5', k2: '2026-10-20', p2: 9.8, ci: 2, junk: 1 })),
    J({ tool: 'trend', k1: '2026-09-16', p1: 1.5, k2: '2026-10-20', p2: 9.8, ci: 2 }));
});

test('sanitizeDrawing：tool 白名单（缺失/未知/大写 → null）', () => {
  assert.equal(C.sanitizeDrawing({ k1: '2026-09-16', p1: 1 }), null);                    // 缺 tool
  assert.equal(C.sanitizeDrawing({ tool: 'arrow', k1: '2026-09-16', p1: 1 }), null);     // 未知
  assert.equal(C.sanitizeDrawing({ tool: 'TEXT', k1: '2026-09-16', p1: 1, text: 'x' }), null);   // 大写不认
});

test('sanitizeDrawing：k1 格式守卫（tKey 两种产物通过；非串/脏串/数字 → null）', () => {
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: 1 }).k1, '2026-09-16');
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '1726454400', p1: 1 }).k1, '1726454400');   // 分钟K秒串
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: 'abc', p1: 1 }), null);
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: 1726454400, p1: 1 }), null);       // 必须是字符串
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '', p1: 1 }), null);
});

test('sanitizeDrawing：p1 强转与有限性（\'1.5\'→1.5；NaN/Infinity/null → null）', () => {
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: '1.5' }).p1, 1.5);
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: 'NaN' }), null);
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: Infinity }), null);
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: null }), null);
  assert.equal(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: '' }), null);
});

test('sanitizeDrawing：两点工具必须有合法 k2/p2；单点工具忽略 k2/p2 仍合法', () => {
  assert.equal(C.sanitizeDrawing({ tool: 'trend', k1: '2026-09-16', p1: 1 }), null);                       // 缺 k2/p2
  assert.equal(C.sanitizeDrawing({ tool: 'rect', k1: '2026-09-16', p1: 1, k2: '2026-09-20', p2: 'bad' }), null);
  assert.equal(J(C.sanitizeDrawing({ tool: 'fib', k1: '2026-09-16', p1: 1, k2: '2026-09-20', p2: 2 })),
    J({ tool: 'fib', k1: '2026-09-16', p1: 1, k2: '2026-09-20', p2: 2, ci: null }));
  // 单点工具：k2/p2 是脏值也照收（忽略不进输出）
  assert.equal(J(C.sanitizeDrawing({ tool: 'hline', k1: '2026-09-16', p1: 1, k2: 'junk', p2: 'junk' })),
    J({ tool: 'hline', k1: '2026-09-16', p1: 1, ci: null }));
});

test('sanitizeDrawing：text 工具——空 trim/缺失 → null；超长截断 40 字符', () => {
  assert.equal(C.sanitizeDrawing({ tool: 'text', k1: '2026-09-16', p1: 1, text: '   ' }), null);
  assert.equal(C.sanitizeDrawing({ tool: 'text', k1: '2026-09-16', p1: 1 }), null);
  const long = C.sanitizeDrawing({ tool: 'text', k1: '2026-09-16', p1: 1, text: '好'.repeat(45) });
  assert.equal(long.text.length, 40);
  assert.equal(C.sanitizeDrawing({ tool: 'text', k1: '2026-09-16', p1: 1, text: '  支撑位  ' }).text, '支撑位');
});

test('sanitizeDrawing：ci 归一（\'3\'→3、-1→5、非法/缺失 → null，与 slotStyles 同口径）', () => {
  const ci = (d) => C.sanitizeDrawing(d).ci;
  assert.equal(ci({ tool: 'hline', k1: '2026-09-16', p1: 1, ci: '3' }), 3);
  assert.equal(ci({ tool: 'hline', k1: '2026-09-16', p1: 1, ci: -1 }), 5);
  assert.equal(ci({ tool: 'hline', k1: '2026-09-16', p1: 1, ci: 'abc' }), null);
  assert.equal(ci({ tool: 'hline', k1: '2026-09-16', p1: 1 }), null);
});

test('sanitizeDrawing：非对象（null/数字/数组/字符串）→ null', () => {
  assert.equal(C.sanitizeDrawing(null), null);
  assert.equal(C.sanitizeDrawing(42), null);
  assert.equal(C.sanitizeDrawing(['trend']), null);
  assert.equal(C.sanitizeDrawing('trend'), null);
});

/* ---------------- sanitizeDrawings：数组级净化 ---------------- */

test('sanitizeDrawings：非数组 → []；脏元素被过滤', () => {
  assert.equal(J(C.sanitizeDrawings('nope')), J([]));
  assert.equal(C.sanitizeDrawings(null).length, 0);
  const out = C.sanitizeDrawings([
    null, 42,
    { tool: 'hline', k1: '2026-09-16', p1: 1 },
    { tool: 'nope', k1: '2026-09-16', p1: 1 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, 'hline');
});

test('sanitizeDrawings：200 条上限（201 条 → 前 200）', () => {
  const raw = Array.from({ length: 201 }, () => ({ tool: 'hline', k1: '2026-09-16', p1: 1 }));
  assert.equal(C.sanitizeDrawings(raw).length, 200);
});

/* ---------------- sanitizeDrawStore：存储表级净化 ---------------- */

test('sanitizeDrawStore：坏键（纯数字键/超长键/空白键）与坏值（非数组/全 null 项）收敛剔除', () => {
  const bad = C.sanitizeDrawStore({
    '123': [{ tool: 'hline', k1: '2026-09-16', p1: 1 }],            // 纯数字键：真符号必带市场前缀/字母
    ['x'.repeat(30)]: [{ tool: 'hline', k1: '2026-09-16', p1: 1 }],   // 超长键
    '   ': [{ tool: 'hline', k1: '2026-09-16', p1: 1 }],            // 空白键
    'sh600519': null,                                               // 值非数组
    'usAAPL': [{ tool: 'nope', k1: '2026-09-16', p1: 1 }],          // 逐项全 null → 空数组剔除
  });
  assert.equal(J(bad), J({}));
});

test('sanitizeDrawStore：非对象 → {}；合法结构保留且逐项过 sanitizeDrawing', () => {
  assert.equal(J(C.sanitizeDrawStore(42)), J({}));
  assert.equal(J(C.sanitizeDrawStore([1, 2])), J({}));
  const good = C.sanitizeDrawStore({
    'sh600519': [{ tool: 'trend', k1: '2026-09-16', p1: 1, k2: '2026-09-20', p2: 2, ci: 3, junk: true }],
    'BTCUSDT': [],        // 空数组：剔除（留它没有意义）
  });
  assert.equal(J(good),
    J({ sh600519: [{ tool: 'trend', k1: '2026-09-16', p1: 1, k2: '2026-09-20', p2: 2, ci: 3 }] }));
});

/* ---------------- fibLevels：斐波那契档位（纯算术、方向无关） ---------------- */

test('fibLevels：p1=10 p2=20 的七档价位（0.5 档=15，首尾=锚点）', () => {
  const out = C.fibLevels(10, 20);
  assert.equal(out.length, 7);
  assert.equal(J(out.map(x => x.lv)), J([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]));
  assert.equal(out[0].p, 10);
  assert.equal(out[3].p, 15);
  assert.equal(out[6].p, 20);
});

test('fibLevels：反向 p1=20 p2=10（0.618 档=13.82）；p1=p2 全档同价', () => {
  const rev = C.fibLevels(20, 10);
  assert.ok(Math.abs(rev[4].p - 13.82) < 1e-9, '反向 0.618 档应为 13.82，实际 ' + rev[4].p);
  const same = C.fibLevels(7.5, 7.5);
  assert.equal(J(same.map(x => x.p)), J([7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5]));
});

/* ---------------- 白名单一致性：UI 入口与 DRAW_TOOLS 不许漂移 ---------------- */

test('data-draw 按钮：index.html 的入口全部 ∈ Charts.DRAW_TOOLS 且恰好 6 个互不重复', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-draw="([^"]+)"/g)].map(m => m[1]);
  assert.equal(used.length, 6, '画线按钮应为 6 个，实际 ' + used.length);
  used.forEach(t => assert.ok(C.DRAW_TOOLS.indexOf(t) >= 0, 'data-draw="' + t + '" 不在 DRAW_TOOLS 白名单'));
  assert.equal(new Set(used).size, 6, '画线按钮的 tool 值互不重复');
});

/* ---------------- 画线交互纯函数（命中/移动/钳制） ---------------- */

test('segDist：水平/垂直/斜线三向距离（端点外投影钳到端点）', () => {
  assert.equal(C.segDist(5, 10, 0, 10, 20, 10), 0);            // 水平线上
  assert.equal(C.segDist(5, 4, 0, 10, 20, 10), 6);             // 水平线垂直距 6
  assert.equal(C.segDist(10, 5, 10, 0, 10, 20), 0);            // 垂直线上
  assert.equal(C.segDist(4, 5, 10, 0, 10, 20), 6);             // 垂直线水平距 6
  assert.equal(C.segDist(10, 10, 0, 0, 20, 20), 0);            // 斜线中点
  // 端点外投影钳到端点：距 (30,30) 最近点是 (20,20)，距离 √200
  assert.ok(Math.abs(C.segDist(30, 30, 0, 0, 20, 20) - Math.sqrt(200)) < 1e-9,
    '端点外应钳到端点取距离');
});

test('drawTextBox：ASCII 与 CJK 宽度分档、框尺寸确定性（不依赖 measureText）', () => {
  // 6.6/11 的浮点和有二进制误差，数值字段用容差比较（确定性=同输入同输出）
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const boxOf = (t, x, y) => C.drawTextBox(t, x, y);
  let b = boxOf('abc', 100, 50);                       // ASCII 3×6.6
  assert.ok(b.x === 98 && b.y === 34 && b.h === 20 && near(b.w, 25.8), 'ASCII 框: ' + J(b));
  b = boxOf('好', 100, 50);                            // CJK 全角 11
  assert.ok(b.x === 98 && b.y === 34 && b.h === 20 && near(b.w, 17), 'CJK 框: ' + J(b));
  b = boxOf('支撑a', 0, 0);                            // 2×11+6.6 字宽 + 6 余量
  assert.ok(near(b.w, 34.6), '混合框: ' + J(b));
  b = boxOf('', 0, 0);                                 // 空串只剩余量
  assert.equal(J(b), J({ x: -2, y: -16, w: 6, h: 20 }));
  assert.equal(J(C.drawTextBox(null, 3, 4)), J(C.drawTextBox('', 3, 4)));   // null 收敛空串
  // 确定性：同输入两次调用逐字段全等（含浮点表示）
  assert.equal(J(boxOf('支撑a', 7, 8)), J(boxOf('支撑a', 7, 8)));
});

test('hitDrawing：trend 线上/端点命中、离线不命中（默认容差 8px）', () => {
  const d = { tool: 'trend', k1: 'a', p1: 1, k2: 'b', p2: 2 };
  const c = { x1: 0, y1: 100, x2: 100, y2: 0 };
  assert.equal(C.hitDrawing(d, c, 50, 50, {}), true);          // 线上
  assert.equal(C.hitDrawing(d, c, 0, 100, {}), true);          // 端点
  assert.equal(C.hitDrawing(d, c, 50, 58, {}), true);          // 距线 ~5.7px，容差内
  assert.equal(C.hitDrawing(d, c, 50, 70, {}), false);         // 距线 ~14px > 8
});

test('hitDrawing：hline 容差内命中、x 越过价格轴不命中', () => {
  const d = { tool: 'hline', k1: 'a', p1: 1 };
  const c = { x1: 100, y1: 50, x2: null, y2: null };
  assert.equal(C.hitDrawing(d, c, 200, 52, { w: 400, axisW: 44 }), true);   // |dy|=2 且在绘图区
  assert.equal(C.hitDrawing(d, c, 200, 62, { w: 400, axisW: 44 }), false);  // |dy|=12 > 8
  assert.equal(C.hitDrawing(d, c, 364, 50, { w: 400, axisW: 44 }), true);   // 恰在右缘（w-axisW+tol）
  assert.equal(C.hitDrawing(d, c, 380, 50, { w: 400, axisW: 44 }), false);  // 越过价格轴
});

test('hitDrawing：vline x 命中（纵向全高，y 任意）', () => {
  const d = { tool: 'vline', k1: 'a', p1: 1 };
  const c = { x1: 120, y1: 30, x2: null, y2: null };
  assert.equal(C.hitDrawing(d, c, 122, 999, {}), true);
  assert.equal(C.hitDrawing(d, c, 130, 5, {}), false);         // |dx|=10 > 8
});

test('hitDrawing：rect 内部与边缘容差内命中、外 8px 外不命中（含内部，TradingView 同行为）', () => {
  const d = { tool: 'rect', k1: 'a', p1: 1, k2: 'b', p2: 2 };
  const c = { x1: 10, y1: 10, x2: 100, y2: 60 };
  assert.equal(C.hitDrawing(d, c, 50, 30, {}), true);          // 内部
  assert.equal(C.hitDrawing(d, c, 55, 10, {}), true);          // 边缘上
  assert.equal(C.hitDrawing(d, c, 106, 30, {}), true);         // 边缘外 6px（容差内）
  assert.equal(C.hitDrawing(d, c, 120, 30, {}), false);        // 边缘外 20px
});

test('hitDrawing：fib 某档命中、x 出跨度不命中、null 档与缺失 fibYs 跳过', () => {
  const d = { tool: 'fib', k1: 'a', p1: 1, k2: 'b', p2: 2 };
  const c = { x1: 0, y1: 0, x2: 100, y2: 0, fibYs: [10, null, 50, 90, 130, 170, 200] };
  assert.equal(C.hitDrawing(d, c, 50, 52, {}), true);          // 50 档 |dy|=2
  assert.equal(C.hitDrawing(d, c, 50, 20, {}), false);         // 档间（距 10/50 均 > 8）
  assert.equal(C.hitDrawing(d, c, 120, 50, {}), false);        // x 出跨度
  assert.equal(C.hitDrawing(d, c, 50, 30, {}), false);         // 30 落在 null 档附近不命中
  assert.equal(C.hitDrawing(d, { x1: 0, y1: 0, x2: 100, y2: 0 }, 50, 50, {}), false);  // 无 fibYs
});

test('hitDrawing：text 档内命中、档外不命中', () => {
  const d = { tool: 'text', k1: 'a', p1: 1, text: '支撑' };
  const c = { x1: 100, y1: 100, x2: null, y2: null };
  const b = C.drawTextBox('支撑', 100, 100);                   // 2×11+6=28 宽
  assert.equal(C.hitDrawing(d, c, 100, 95, {}), true);         // 框内
  assert.equal(C.hitDrawing(d, c, b.x + b.w + 10, b.y + 10, {}), false);   // 框外
  assert.equal(C.hitDrawing(d, c, 99, 60, {}), false);         // 基线上方 16px 外
});

test('hitDrawing / hitTestDrawings：null 输入不命中、空表 -1；重叠取最上层、null coords 跳过回退下层', () => {
  const d = { tool: 'hline', k1: 'a', p1: 1 };
  const c = { x1: 100, y1: 50, x2: null, y2: null };
  assert.equal(C.hitDrawing(null, c, 100, 50, {}), false);
  assert.equal(C.hitDrawing(d, null, 100, 50, {}), false);
  assert.equal(C.hitTestDrawings([], [], 100, 50, {}), -1);
  assert.equal(C.hitTestDrawings(null, null, 100, 50, {}), -1);
  assert.equal(C.hitTestDrawings([d], [c], 100, 50, { w: 400, axisW: 44 }), 0);
  const list = [
    { tool: 'hline', k1: 'a', p1: 1 },
    { tool: 'hline', k1: 'a', p1: 2 },
  ];
  const coords = [
    { x1: 100, y1: 50, x2: null, y2: null },
    { x1: 100, y1: 52, x2: null, y2: null },     // 两条几乎重叠
  ];
  assert.equal(C.hitTestDrawings(list, coords, 100, 51, { w: 400, axisW: 44 }), 1);   // 尾部（最上层）优先
  assert.equal(C.hitTestDrawings(list, [coords[0], null], 100, 50, { w: 400, axisW: 44 }), 0,
    '上层锚点不可见（null coords）应跳过并命中下层');
});

test('moveDrawing：两点整体平移、hline 只动价 / vline 只动时 / text 双动；越界/锚缺/非数一律 null', () => {
  const keys = ['d0', 'd1', 'd2', 'd3', 'd4'];
  assert.equal(J(C.moveDrawing(
    { tool: 'trend', k1: 'd0', p1: 10, k2: 'd1', p2: 12, ci: 2 }, 2, -1, keys)),
    J({ tool: 'trend', k1: 'd2', p1: 9, k2: 'd3', p2: 11, ci: 2 }));   // k1/k2 同步 +2 档、p1/p2 同步
  assert.equal(J(C.moveDrawing({ tool: 'hline', k1: 'd1', p1: 10 }, 0, 1.5, keys)),
    J({ tool: 'hline', k1: 'd1', p1: 11.5 }));                          // k1 不动
  assert.equal(J(C.moveDrawing({ tool: 'vline', k1: 'd1', p1: 10 }, 1, 5, keys)),
    J({ tool: 'vline', k1: 'd2', p1: 10 }));                            // p1 不动
  assert.equal(J(C.moveDrawing({ tool: 'text', k1: 'd1', p1: 10, text: 'x' }, -1, -0.5, keys)),
    J({ tool: 'text', k1: 'd0', p1: 9.5, text: 'x' }));
  assert.equal(C.moveDrawing({ tool: 'hline', k1: 'd1', p1: 1 }, 0, '1.5', keys).p1, 2.5,
    'pDelta 字符串经 + 强转');
  // 守卫面：越界换锚 / 锚不在 keys / 非数位移 / 脏输入 / keys 缺失 → null（不写回 drawings）
  const k3 = ['d0', 'd1', 'd2'];
  assert.equal(C.moveDrawing({ tool: 'vline', k1: 'd2', p1: 1 }, 1, 0, k3), null);            // 右越界
  assert.equal(C.moveDrawing({ tool: 'vline', k1: 'd0', p1: 1 }, -1, 0, k3), null);           // 左越界
  assert.equal(C.moveDrawing({ tool: 'vline', k1: 'dX', p1: 1 }, 1, 0, k3), null);            // 锚不在序列
  assert.equal(C.moveDrawing({ tool: 'trend', k1: 'd0', p1: 1, k2: 'd2', p2: 2 }, 1, 0, k3), null);  // k2 越界
  assert.equal(C.moveDrawing({ tool: 'text', k1: 'd1', p1: 1, text: 'x' }, 0, NaN, k3), null);       // 非数位移
  assert.equal(C.moveDrawing(null, 0, 0, k3), null);                                          // 脏输入
  assert.equal(C.moveDrawing({ tool: 'hline', k1: 'd1', p1: 1 }, 0, 0, null), null);          // keys 缺失
});

test('clampBox：负坐标归 0、右下越界钳制、框大于区域归 0', () => {
  assert.equal(J(C.clampBox(-5, -5, 100, 30, 400, 300)), J({ x: 0, y: 0 }));
  assert.equal(J(C.clampBox(500, 400, 100, 30, 400, 300)), J({ x: 300, y: 270 }));
  assert.equal(J(C.clampBox(50, 50, 100, 30, 400, 300)), J({ x: 50, y: 50 }));   // 区间内不动
  assert.equal(J(C.clampBox(10, 10, 500, 400, 400, 300)), J({ x: 0, y: 0 }));    // 框大于区域
  assert.equal(J(C.clampBox(5, 5, 0, 0, 0, 0)), J({ x: 0, y: 0 }));              // 空区域不抛错
});

/* ---------------- sanitizeScale：价格标尺档位归一（K线「标尺与对比」条目） ---------------- */

test('sanitizeScale：合法值原样往返（log/pct/normal）', () => {
  assert.equal(C.sanitizeScale('log'), 'log');
  assert.equal(C.sanitizeScale('pct'), 'pct');
  assert.equal(C.sanitizeScale('normal'), 'normal');
});

test('sanitizeScale：脏值一律收敛 normal（数字/undefined/null/大写/空串/中文）', () => {
  // localStorage 读回的脏值进不了图表侧：只认 'log'/'pct' 字面量，大写也不静默 toLowerCase
  [1, 0, undefined, null, 'LOG', '', '百分比'].forEach(v => assert.equal(C.sanitizeScale(v), 'normal'));
});

/* ---------------- rebaseCompare：双标的归一化叠加的核心口径（重定基到主图价格单位、交集口径防幽灵 bar） ---------------- */

test('rebaseCompare：同涨幅两序列重合（factor=2，末值=110 落在主图价格单位）', () => {
  const main = [{ time: 'd1', close: 100 }, { time: 'd2', close: 105 }, { time: 'd3', close: 110 }];
  const cmp = [{ time: 'd1', close: 50 }, { time: 'd2', close: 52.5 }, { time: 'd3', close: 55 }];
  const r = C.rebaseCompare(main, cmp);
  assert.equal(r.factor, 2);
  assert.equal(r.base, 100);   // base = 主图基准 close（首个共同日）
  assert.equal(J(r.points.map(p => p.time)), J(['d1', 'd2', 'd3']));
  assert.equal(J(r.points.map(p => p.value)), J([100, 105, 110]));
});

test('rebaseCompare：差异走势（cmp 翻倍、main 1.5 倍 → 末值 200 反映在主图价格单位）', () => {
  const main = [{ time: 'd1', close: 100 }, { time: 'd3', close: 150 }];
  const cmp = [{ time: 'd1', close: 50 }, { time: 'd3', close: 100 }];
  const r = C.rebaseCompare(main, cmp);
  assert.equal(r.factor, 2);
  assert.equal(J(r.points.map(p => p.value)), J([100, 200]));
});

test('rebaseCompare：首个共同时间为基准（main 自 t0、cmp 自 t1 → t1 是首点、t0 不入 points、factor 按该日算）', () => {
  const main = [{ time: 'd1', close: 100 }, { time: 'd2', close: 110 }, { time: 'd3', close: 121 }];
  const cmp = [{ time: 'd2', close: 50 }, { time: 'd3', close: 55 }];
  const r = C.rebaseCompare(main, cmp);
  assert.equal(r.factor, 110 / 50);   // 按首个共同日 d2 定基：主 110 / 对比 50
  assert.equal(J(r.points.map(p => p.time)), J(['d2', 'd3']));
  assert.equal(J(r.points.map(p => p.value)), J([110, 121]));   // 同涨幅 → 与主图重合
});

test('rebaseCompare：cmp 独有时间点剔除（交集口径防幽灵 bar）', () => {
  const main = [{ time: 'd1', close: 100 }, { time: 'd2', close: 105 }];
  const cmp = [
    { time: 'd0', close: 40 },    // cmp 更早的上市段：主图没有 → 剔
    { time: 'd1', close: 50 },
    { time: 'd2', close: 55 },
    { time: 'd9', close: 70 },    // 停牌差异日：主图没有 → 剔
  ];
  const r = C.rebaseCompare(main, cmp);
  assert.equal(J(r.points.map(p => p.time)), J(['d1', 'd2']));
  assert.equal(J(r.points.map(p => p.value)), J([100, 110]));
});

test('rebaseCompare：脏数据收敛（非数组/交集空/close 非有限/基准 ≤0 → points 空；中段非正 close 跳点）', () => {
  const main = [{ time: 'd1', close: 100 }, { time: 'd2', close: 110 }];
  assert.equal(C.rebaseCompare('not-array', []).points.length, 0);        // 主图非数组
  assert.equal(C.rebaseCompare(main, 'not-array').points.length, 0);      // 对比非数组
  assert.equal(C.rebaseCompare([], []).points.length, 0);                 // 交集为空
  assert.equal(C.rebaseCompare(main, [{ time: 'd1' }]).points.length, 0);           // 基准 close 非有限
  assert.equal(C.rebaseCompare(main, [{ time: 'd1', close: 0 }]).points.length, 0); // 对比基准 ≤0
  assert.equal(C.rebaseCompare(   // 主图基准 close ≤0：无从定基 → 整体空
    [{ time: 'd1', close: 0 }, { time: 'd2', close: 1 }],
    [{ time: 'd1', close: 5 }, { time: 'd2', close: 5 }]).points.length, 0);
  const r = C.rebaseCompare(   // 中段非正 close：该点跳过、其余照常（0 是脏价不是"归零"）
    [{ time: 'd1', close: 100 }, { time: 'd2', close: 110 }, { time: 'd3', close: 120 }],
    [{ time: 'd1', close: 50 }, { time: 'd2', close: 0 }, { time: 'd3', close: 60 }]);
  assert.equal(J(r.points.map(p => p.time)), J(['d1', 'd3']));
  assert.equal(J(r.points.map(p => p.value)), J([100, 120]));
});

test('导出守卫：sanitizeScale / rebaseCompare 必须挂到 Charts 导出面（对比叠加的纯函数口径）', () => {
  assert.equal(typeof C.sanitizeScale, 'function', 'Charts 缺少导出 sanitizeScale');
  assert.equal(typeof C.rebaseCompare, 'function', 'Charts 缺少导出 rebaseCompare');
});

test('导出守卫：画线交互纯函数必须全部挂到 Charts 导出面（含 DRAW_HIT_TOL=8）', () => {
  ['DRAW_HIT_TOL', 'segDist', 'drawTextBox', 'hitDrawing', 'hitTestDrawings', 'moveDrawing', 'clampBox']
    .forEach(k => assert.ok(k in C, 'Charts 缺少导出 ' + k));
  assert.equal(C.DRAW_HIT_TOL, 8);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
