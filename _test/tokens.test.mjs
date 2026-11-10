#!/usr/bin/env node
/* tokens.test.mjs —— 设计令牌与发布卫生守卫（纯文本解析，不依赖网络、不依赖浏览器）
 *
 * 为什么需要这一组：css 里的颜色令牌是"人肉维护 + 多份副本"的结构——
 *   · --accent-signature（hex，给 CSS/JS 直接用）与 --accent-rgb（裸三元组，给 rgba() 合成）
 *     必须同值，但它们写在两行里，改一处漏一处不会有任何报错；
 *   · 均线调色板同一份颜色曾分别在 css/charts.js/index.html 各写一遍，改色必然漂移；
 *   · 测试里若用自造的假 CSS 值，就永远测不出上面两件事（历史缺口）。
 * 因此这里直接读真实源文件，把"不可能漂"变成"漂了就红"。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};
const assert = {
  ok: (v, m) => { if (!v) throw new Error(m || '断言失败'); },
  equal: (a, b, m) => { if (a !== b) throw new Error((m || '不相等') + `：${a} !== ${b}`); },
};

/* v2：设计语言分层在 css/ui/ 下（tokens 仍在 style.css，是令牌单一事实源）。
   本组断言一律扫「style.css + css/ui/*.css」全量，否则新层的规则逃出守卫。 */
const CSS_DIR = path.join(ROOT, 'css');
const uiDir = path.join(CSS_DIR, 'ui');
const uiFiles = readdirSync(uiDir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.css')).map(e => 'css/ui/' + e.name).sort();
const CSS = [readFileSync(path.join(CSS_DIR, 'style.css'), 'utf8'),
  ...uiFiles.map(f => readFileSync(path.join(ROOT, f), 'utf8'))].join('\u000a');;
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const cssVar = (name, src = CSS) => {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(src);
  return m ? m[1].trim() : null;
};
const hex2rgb = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) throw new Error('不是 #rrggbb 形式: ' + h);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ---------------- 强调色双令牌一致性 ---------------- */

test('--accent-rgb 是裸三元组（否则 rgba(var(--accent-rgb),α) 会静默失效）', () => {
  const v = cssVar('accent-rgb');
  assert.ok(v, 'css 缺少 --accent-rgb');
  assert.ok(/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v), `应为 "r,g,b"，实际 "${v}"`);
  const parts = v.split(',').map(s => +s.trim());
  parts.forEach(p => assert.ok(p >= 0 && p <= 255, '分量越界: ' + p));
});

test('--accent-signature 与 --accent-rgb 必须同值', () => {
  const hex = cssVar('accent-signature');
  const rgb = cssVar('accent-rgb');
  const want = hex2rgb(hex).join(',');
  const got = rgb.split(',').map(s => +s.trim()).join(',');
  assert.equal(got, want, `--accent-rgb 与 --accent-signature(${hex}) 不同步`);
});

test('--accent-signature 不得是 Claude/Anthropic 品牌赭橙 #D97757', () => {
  const hex = cssVar('accent-signature').toLowerCase();
  assert.ok(hex !== '#d97757', '又用回了 #D97757（这是"AI 生成"辨识度最高的信号）');
});

/* ---------------- 均线调色板 ---------------- */

const MA = [0, 1, 2, 3, 4, 5].map(i => cssVar('ma-' + i));
const MA_HEX = /^#[0-9a-f]{6}$/i;

test('6 个均线槽位令牌都存在且是 hex', () => {
  MA.forEach((v, i) => assert.ok(MA_HEX.test(v || ''), `--ma-${i} 缺失或格式不对: ${v}`));
});

test('--ma-0 跟随交互强调色（历史约定：槽位 0 = 品牌色）', () => {
  assert.equal(MA[0].toLowerCase(), cssVar('accent-signature').toLowerCase(), '--ma-0 应与 --accent-signature 同值');
});

test('6 个均线槽位两两不同色', () => {
  const uniq = new Set(MA.map(c => c.toLowerCase()));
  assert.equal(uniq.size, 6, '存在重复槽位色: ' + MA.join(' '));
});

/* CIEDE2000：把"两条线人眼看着像不像"变成可断言的数字。
   阈值 15 是本调色板改动前就存在的下限（--ma-2 绿 vs --ma-5 青 = 15.2），
   任何新配色都不该低于它。 */
const srgb2lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb2lab = ([r, g, b]) => {
  const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047);
  const fy = f(R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const fz = f((R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
function dE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (y, x) => { const v = Math.atan2(y, x) * 180 / Math.PI; return v < 0 ? v + 360 : v; };
  const H1 = h(b1, a1p), H2 = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = H2 - H1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let Hbp;
  if (C1p * C2p === 0) Hbp = H1 + H2;
  else { const d = Math.abs(H1 - H2); Hbp = d <= 180 ? (H1 + H2) / 2 : (H1 + H2 < 360 ? (H1 + H2 + 360) / 2 : (H1 + H2 - 360) / 2); }
  const T = 1 - 0.17 * Math.cos((Hbp - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * Hbp * Math.PI / 180)
    + 0.32 * Math.cos((3 * Hbp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * Hbp - 63) * Math.PI / 180);
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * 30 * Math.exp(-Math.pow((Hbp - 275) / 25, 2)) * Math.PI / 180) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}
const dE = (a, b) => dE2000(rgb2lab(hex2rgb(a)), rgb2lab(hex2rgb(b)));

test('均线槽位之间的最小色距 ≥ 15（低于即两条线人眼难分）', () => {
  let min = Infinity, who = '';
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const d = dE(MA[i], MA[j]);
    if (d < min) { min = d; who = `--ma-${i}(${MA[i]}) vs --ma-${j}(${MA[j]})`; }
  }
  assert.ok(min >= 15, `最小色距 ${min.toFixed(1)} < 15：${who}`);
});

test('均线槽位不得与涨跌色混淆（ΔE ≥ 15）', () => {
  const up = cssVar('up'), down = cssVar('down');
  MA.forEach((c, i) => {
    assert.ok(dE(c, up) >= 15, `--ma-${i}(${c}) 与涨色 ${up} 色距仅 ${dE(c, up).toFixed(1)}`);
    assert.ok(dE(c, down) >= 15, `--ma-${i}(${c}) 与跌色 ${down} 色距仅 ${dE(c, down).toFixed(1)}`);
  });
});

/* ---------------- 单一来源：不许有第二份字面量 ---------------- */

test('指标菜单色块必须用 var(--ma-N)，不得写死 hex', () => {
  // 2026-10-20 起指标菜单改成动态渲染（可增删指标），色块不再静态写在 index.html 里，
  // 而是由 app.js 按槽位序号生成。断言的**意图**不变：色板只能来自 CSS 令牌，
  // 不许出现第二份字面量（改了 --ma-N 而菜单不变，就是两处漂移）。
  // 2026-10-31 行内色点升级为 6 色取色板（当前指派用 .on 标记）：
  // 守卫放宽为 /var\(--ma-\$\{/——色板与画图仍全部取令牌，不限定下标表达式形态。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/id="maMenu"/.test(HTML), '找不到指标菜单');
  const gen = app.slice(app.indexOf('function renderMaMenu'));
  const block = gen.slice(0, gen.indexOf('\n  }'));
  assert.ok(/var\(--ma-\$\{/.test(block), '色板/色点必须取 var(--ma-N) 令牌');
  assert.ok(/data-macolor=/.test(block), '取色色板（data-macolor）不见了');
  assert.ok(/data-maw=/.test(block), '线宽控件（data-maw）不见了');
  // 菜单与图表两处都不许写死 hex 色值
  const hexInMenu = block.match(/#[0-9a-f]{3,8}\b/gi);
  assert.equal(hexInMenu, null, '指标菜单里出现了写死的 hex 色值: ' + (hexInMenu || []).join(','));
});

test('index.html 必须保留指标面板的一键重置入口（id="maReset"）', () => {
  assert.ok(/id="maReset"/.test(HTML), '指标菜单的「恢复默认」按钮被删了（一键重置入口不许被误删）');
});

test('index.html 必须保留 6 个 data-draw 画线按钮（title/aria 齐全）', () => {
  // 画线工具入口与图表白名单的一致性由 charts.test.mjs 卡（data-draw ∈ DRAW_TOOLS）；
  // 这里只卡「入口不许被误删/缺无障碍标注」：6 件工具（趋势线/水平线/垂直线/矩形/
  // 斐波那契回撤/文字标注）少一个，用户就少一件画具且不会有任何报错。
  const tags = HTML.match(/<button[^>]*data-draw="[^"]*"[^>]*>/g) || [];
  assert.equal(tags.length, 6, `画线按钮应为 6 个，实际 ${tags.length}`);
  tags.forEach(b => {
    assert.ok(/title="[^"]+"/.test(b), '画线按钮缺 title：' + b);
    assert.ok(/aria-label="[^"]+"/.test(b), '画线按钮缺 aria-label：' + b);
  });
});

test('index.html 必须保留「隐藏全部画线」入口（id="drawHide" 且带 aria-pressed）', () => {
  // 画线交互轮的隐藏开关：不带 data-draw（不进工具白名单，由 charts.test.mjs 按
  // 属性计数守卫 6 件）。按钮被误删后「隐藏全部画线」整个失联且不会有任何报错；
  // aria-pressed 让读屏用户知道当前是隐藏态还是显示态（不能只活在 CSS 类里）。
  const m = HTML.match(/<button[^>]*id="drawHide"[^>]*>/);
  assert.ok(m, 'index.html 找不到 id="drawHide" 按钮');
  assert.ok(/aria-pressed="/.test(m[0]), 'drawHide 按钮缺 aria-pressed：' + m[0]);
  assert.ok(/title="[^"]+"/.test(m[0]) && /aria-label="[^"]+"/.test(m[0]),
    'drawHide 按钮缺 title/aria-label');
});

test('js/app.js 必须保留 drawHideV1 持久化与 setHidden 接线（防隐藏态静默失效）', () => {
  // 隐藏态走 localStorage（drawHideV1）：两处断言缺一不可——
  // 缺持久化则刷新即丢；缺 setHidden 接线则按钮点了图不隐藏（状态改了、图表不知道）。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/drawHideV1/.test(app), 'app.js 缺 drawHideV1 持久化键（隐藏态刷新即丢）');
  assert.ok(/setHidden\(/.test(app), 'app.js 没有接线 chart.setHidden（按钮点了图不隐藏）');
});

test('index.html 必须保留标尺与对比入口（scaleToggle/kcmpToggle + 三档 data-scale + 清除/状态行）', () => {
  // 「标尺与对比」条目（TV-ROADMAP P0 图表核心第 4 条）的入口守卫：按钮被误删后
  // 功能失联且不会有任何报错。title 必须含中文（红线 1）；data-scale 三档
  // ∈ {normal,log,pct} 且互不重复（sanitizeScale 只认 'log'/'pct'，档位对不上等于切不中）。
  const st = HTML.match(/<button[^>]*id="scaleToggle"[^>]*>/);
  const kt = HTML.match(/<button[^>]*id="kcmpToggle"[^>]*>/);
  assert.ok(st, 'index.html 找不到 id="scaleToggle" 按钮（标尺入口被误删）');
  assert.ok(kt, 'index.html 找不到 id="kcmpToggle" 按钮（对比入口被误删）');
  assert.ok(/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(st[0]), 'scaleToggle 缺中文 title：' + st[0]);
  assert.ok(/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(kt[0]), 'kcmpToggle 缺中文 title：' + kt[0]);
  const scales = [...HTML.matchAll(/data-scale="([^"]+)"/g)].map(m => m[1]);
  assert.equal(JSON.stringify([...new Set(scales)].sort()), JSON.stringify(['log', 'normal', 'pct']),
    'data-scale 三档必须恰为 normal/log/pct 各一（缺档/重复都会让标尺菜单切不中）：' + scales.join(','));
  assert.ok(/id="kcmpClear"/.test(HTML), 'index.html 找不到 id="kcmpClear"（清除对比入口被误删）');
  assert.ok(/id="kcmpStatus"/.test(HTML), 'index.html 找不到 id="kcmpStatus"（对比状态行被误删）');
});

test('js/app.js 必须接线标尺与对比（chartScaleV1 持久化 + setScale/rebaseCompare 调用 + klineFor 复用）', () => {
  // 跨文件守卫（照 drawHideV1 先例）：缺持久化标尺刷新即丢；缺 setScale 接线
  // 按钮点了图不变；缺 rebaseCompare 对比线没数据；缺 klineFor 复用则另起炉灶
  // 破坏「详情页取数一律走分源管线 + in-flight 去重」的取数纪律。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/chartScaleV1/.test(app), 'app.js 缺 chartScaleV1 持久化键（标尺刷新即丢）');
  assert.ok(/setScale\(/.test(app), 'app.js 没有接线 chart.setScale（按钮点了图不变）');
  assert.ok(/rebaseCompare\(/.test(app), 'app.js 没有调用 rebaseCompare（对比线没数据）');
  assert.ok(/klineFor\(state\.cmpTarget/.test(app), 'app.js 对比取数必须复用 klineFor（不得另起炉灶）');
});

test('index.html 必须保留图表类型入口（ktypeToggle + 五档 data-ktype）', () => {
  // 「图表类型」条目（TV-ROADMAP P0 图表核心第 5 条）的入口守卫：按钮被误删后
  // 功能失联且不会有任何报错。title 必须含中文（红线 1）；data-ktype 五档
  // ∈ {candle,bar,line,area,ha} 且互不重复（sanitizeChartType 只认五字面量，
  // 档位对不上等于切不中）。
  const kt = HTML.match(/<button[^>]*id="ktypeToggle"[^>]*>/);
  assert.ok(kt, 'index.html 找不到 id="ktypeToggle" 按钮（图表类型入口被误删）');
  assert.ok(/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(kt[0]), 'ktypeToggle 缺中文 title：' + kt[0]);
  const kinds = [...HTML.matchAll(/data-ktype="([^"]+)"/g)].map(m => m[1]);
  assert.equal(JSON.stringify([...new Set(kinds)].sort()), JSON.stringify(['area', 'bar', 'candle', 'ha', 'line']),
    'data-ktype 五档必须恰为 candle/bar/line/area/ha 各一（缺档/重复都会让类型菜单切不中）：' + kinds.join(','));
});

test('js/app.js 必须接线图表类型（chartTypeV1 持久化 + setType 调用 + sanitizeChartType 消费）', () => {
  // 跨文件守卫（照 chartScaleV1 先例）：缺持久化类型刷新即丢；缺 setType 接线
  // 按钮点了图不变；缺 sanitizeChartType 消费则 localStorage 脏值直灌图表侧。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/chartTypeV1/.test(app), 'app.js 缺 chartTypeV1 持久化键（图表类型刷新即丢）');
  assert.ok(/setType\(/.test(app), 'app.js 没有接线 chart.setType（按钮点了图不变）');
  assert.ok(/sanitizeChartType\(/.test(app), 'app.js 没有消费 sanitizeChartType（脏值直灌图表侧）');
});

test('index.html 必须保留多图布局与联动入口（layoutToggle/layoutMenu + 三档 data-layout + syncToggle）', () => {
  // 「多图布局」条目（TV-ROADMAP P1 第 1 条）的入口守卫：按钮被误删后功能失联且不会有
  // 任何报错。title 必须含中文（红线 1）；data-layout 三档 ∈ {1x1,1x2,2x2} 且互不重复
  // （sanitizeMultiLayout 只认三字面量，档位对不上等于切不中）；syncToggle 带 aria-pressed
  // （读屏用户要知道联动开没开，drawHide 同款）。
  const lt = HTML.match(/<button[^>]*id="layoutToggle"[^>]*>/);
  const st = HTML.match(/<button[^>]*id="syncToggle"[^>]*>/);
  assert.ok(lt, 'index.html 找不到 id="layoutToggle" 按钮（多图布局入口被误删）');
  assert.ok(st, 'index.html 找不到 id="syncToggle" 按钮（联动入口被误删）');
  assert.ok(/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(lt[0]), 'layoutToggle 缺中文 title：' + lt[0]);
  assert.ok(/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(st[0]), 'syncToggle 缺中文 title：' + st[0]);
  assert.ok(/aria-pressed="/.test(st[0]), 'syncToggle 缺 aria-pressed');
  const layouts = [...HTML.matchAll(/data-layout="([^"]+)"/g)].map(m => m[1]);
  assert.equal(JSON.stringify([...new Set(layouts)].sort()), JSON.stringify(['1x1', '1x2', '2x2']),
    'data-layout 三档必须恰为 1x1/1x2/2x2 各一（缺档/重复都会让布局菜单切不中）：' + layouts.join(','));
});

test('index.html 的 #klineChart 必须被 class=kcell 的主格包装（paneStack 不进 grid 子元素）', () => {
  // 多图网格的 grid 子元素是 .kcell：#klineChart 的 paneStack（js/charts.js 挂在
  // el.parentElement）落进主格包装内，chartBox 的直接子元素才干净——包装被误删时
  // 副格 stack 会混进 grid，1×2/2×2 布局被撑破且不会有任何报错。
  const m = HTML.match(/<div class="kcell" id="kcellMain">\s*<div id="klineChart">/);
  assert.ok(m, '#klineChart 必须包在 <div class="kcell" id="kcellMain"> 内');
});

test('js/app.js 必须接线多图布局（三持久化键 + 纯函数消费 + loadMultiCells + 副格关 MA + kind 守卫 + 同步订阅）', () => {
  // 跨文件守卫（照 chartTypeV1 先例）：缺持久化刷新即丢；缺纯函数消费则脏值直灌；
  // 缺 setMAVisible(false) 则副格带默认三条均线（「轻量 K 线」声明失效）；
  // 缺 chartKind==='kline' 守卫则分时主图也会建副格（分钟下标广播给日K副格错乱）。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  ['multiLayoutV1', 'multiSyncV1', 'multiCellsV1'].forEach(k =>
    assert.ok(app.includes(k), 'app.js 缺 ' + k + ' 持久化键（刷新即丢）'));
  ['sanitizeMultiLayout', 'pickCellSymbols', 'crossAt'].forEach(k =>
    assert.ok(app.includes(k), 'app.js 没有消费 Charts.' + k));
  assert.ok(/loadMultiCells/.test(app), 'app.js 缺 loadMultiCells 接线（副格不建）');
  assert.ok(/setMAVisible\(false\)/.test(app), 'app.js 副格必须 setMAVisible(false)（副格不得带默认均线）');
  assert.ok(/chartKind !== 'kline'/.test(app), 'app.js 缺 kind===kline 守卫（分时下建副格会错乱）');
  assert.ok(/subscribeCrosshairMove/.test(app), 'app.js 缺十字线同步订阅');
  assert.ok(/subscribeVisibleLogicalRangeChange/.test(app), 'app.js 缺缩放范围同步订阅');
});

test('js/charts.js 必须保留多副图管理核心（setPanes 导出 + k-pane-div 拖拽条 + sanitizePaneList 消费 + onPanesChange 回调）', () => {
  // 跨文件守卫（照 chartTypeV1 先例）：缺 setPanes 菜单点了图不变；缺 k-pane-div
  // 分隔条则拖拽调高失效；缺 sanitizePaneList 消费则脏配置毒化渲染；
  // 缺 onPanesChange 回调则拖高后 app 层不落盘、刷新即丢。
  const charts = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  assert.ok(/setPanes,/.test(charts), 'charts.js 导出面缺 setPanes（菜单点了图不变）');
  assert.ok(/k-pane-div/.test(charts), 'charts.js 缺 k-pane-div 分隔条（拖拽调高失效）');
  assert.ok(/sanitizePaneList/.test(charts), 'charts.js 没有消费 sanitizePaneList（脏配置毒化渲染）');
  assert.ok(/onPanesChange/.test(charts), 'charts.js 缺 onPanesChange 回调（拖高后 app 层不落盘）');
});

test('js/app.js 必须接线副图清单管理（maCfg panes 持久化 + setPanes 调用 + sanitizePaneList 消费 + paneup/panedown 接线 + onPanesChange 落 Store）', () => {
  // 跨文件守卫（照 chartTypeV1 先例）：缺持久化清单刷新即丢；缺 setPanes 调用
  // 菜单点了图不变；缺 sanitizePaneList 消费则 localStorage 脏清单直灌图表侧；
  // 缺 paneup/panedown 接线则重排按钮失联；缺 onPanesChange→Store 则拖高刷新即丢。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/state\.detailMACfg = \{ lines, panes/.test(app), 'app.js 缺 maCfg panes 持久化（副图清单刷新即丢）');
  assert.ok(/setPanes\(/.test(app), 'app.js 没有接线 chart.setPanes（菜单点了图不变）');
  assert.ok(/sanitizePaneList/.test(app), 'app.js 没有消费 sanitizePaneList（脏清单直灌图表侧）');
  assert.ok(/data-paneup/.test(app), 'app.js 缺 data-paneup 接线（上移按钮失联）');
  assert.ok(/data-panedown/.test(app), 'app.js 缺 data-panedown 接线（下移按钮失联）');
  assert.ok(/onPanesChange[\s\S]{0,400}Store\.set\('maCfg'/.test(app), 'app.js 缺 onPanesChange→Store.set 落盘（拖高刷新即丢）');
});

test('charts.js 不得再自带一份均线调色板字面量', () => {
  const charts = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  assert.ok(!/LINE_COLORS\s*=\s*\[/.test(charts), 'charts.js 又出现了 LINE_COLORS 字面量数组');
  assert.ok(charts.includes("varOf('--ma-'"), 'charts.js 应通过 --ma-N 令牌取色');
});

/* ---------------- 发布卫生 ---------------- */

test('index.html 的业务资源 ?v= 必须全部同版本（防缓存穿透失效）', () => {
  const vers = [...HTML.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  // v3.3：业务脚本打成一个 bundle 后，业务资源的 ?v= 只剩 5 个 CSS + 1 个 JS。
  // 断言意图不变：扫到的每一个都必须同版本。
  assert.ok(vers.length >= 5, '没扫到预期的 ?v=，选择器可能失效');
  const uniq = [...new Set(vers)];
  assert.equal(uniq.length, 1, `版本号不统一（漏 bump 会导致用户看到旧缓存）：${uniq.join(' ')}`);
});

test('vendor 库的 ?v= 必须是锁定的语义化版本，不被业务版本号覆盖', () => {
  const vendor = [...HTML.matchAll(/lib\/[^"?]+\?v=([^"&]+)/g)].map(m => m[1]);
  assert.ok(vendor.length >= 3, '没扫到 vendor 资源');
  vendor.forEach(v => assert.ok(/^\d+\.\d+\.\d+$/.test(v), `vendor 版本应形如 1.2.3，实际 "${v}"`));
});

test('index.html 每个 data-fold 折叠分区都必须带 id（折叠状态持久化按 id 记忆）', () => {
  // 折叠态持久化的键是分区 id：无 id 的分区点了也不记、刷新恢复不了，
  // 而且新增分区时漏写 id 不会有任何报错——所以钉成断言。
  const tags = HTML.match(/<div class="section"[^>]*data-fold[^>]*>/g) || [];
  assert.ok(tags.length >= 13, '没扫到预期的折叠分区数量，选择器可能失效');
  const noId = tags.filter(t => !/\sid="[^"]+"/.test(t));
  assert.equal(noId.length, 0, '这些折叠分区缺 id，折叠态持久化会跳过它们：' + noId.join(' | '));
});

test('开屏 splash 的所有形态都不得复活（解释性注释不计）', () => {
  const files = ['index.html', 'css/style.css', 'js/app.js'];
  const bad = [];
  const PAT = /id="spFill"|id="spStatus"|id="splash"|\.sp-fill|\.sp-track|splash-on|revealSplash|splashProgress|SPLASH_MIN|splashReady/;
  files.forEach(f => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    // 逐行扫描并跟踪块注释/HTML 注释状态：只在"代码行"上报错，避免说明文字里的标识符误报
    let inBlock = false, inHtml = false;
    src.split('\n').forEach((line, n) => {
      const wasCommented = inBlock || inHtml;
      // 更新状态（同一行内的开关按出现顺序粗略处理，足够这类源文件使用）
      let rest = line;
      if (inHtml) { if (rest.includes('-->')) { inHtml = false; rest = rest.slice(rest.indexOf('-->') + 3); } else return; }
      if (inBlock) { if (rest.includes('*/')) { inBlock = false; rest = rest.slice(rest.indexOf('*/') + 2); } else return; }
      const lc = rest.indexOf('//');
      const bc = rest.indexOf('/*');
      const hc = rest.indexOf('<!--');
      if (hc >= 0 && (bc < 0 || hc < bc) && (lc < 0 || hc < lc)) {
        if (!rest.slice(hc).includes('-->')) inHtml = true;
        rest = rest.slice(0, hc);
      } else if (bc >= 0 && (lc < 0 || bc < lc)) {
        if (!rest.slice(bc).includes('*/')) inBlock = true;
        rest = rest.slice(0, bc);
      } else if (lc >= 0) {
        rest = rest.slice(0, lc);
      }
      if (!wasCommented && PAT.test(rest)) bad.push(`${f}:${n + 1}`);
    });
  });
  assert.equal(bad.length, 0, '发现开屏残留: ' + bad.join(', '));
});

test('js/ 全部脚本必须可解析（块注释里写 */ 会让整个文件静默变 undefined）', () => {
  // 真实事故：gdelt.js 头注释里写了"*/5 cron"，*/ 提前终结块注释 → 整个文件 SyntaxError，
  // script 标签不报加载失败、window.EventsSource 变 undefined、事件页永远"数据更新中"。
  // 本项目全部是经典脚本（IIFE），new Function 即可当解析器用。
  const walk = (d) => readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => {
    const p = path.join(ROOT, d, e.name);
    return e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith('.js') ? [p] : []);
  });
  const files = walk('js');
  assert.ok(files.length > 30, 'js 文件数异常，walk 选择器可能失效');
  const bad = [];
  files.forEach(f => {
    try { new Function(readFileSync(f, 'utf8')); }
    catch (e) { bad.push(path.relative(ROOT, f) + ' → ' + e.message.split('\n')[0]); }
  });
  assert.equal(bad.length, 0, '存在语法错误的脚本: ' + bad.join(' | '));
});

/* ---------------- 标签控件的可读性守卫 ----------------
   "tag 逼仄"是一类看不见的回归：padding 少 4px 不会有任何报错，
   只在页面上表现为文字贴着边框。所以把它钉成断言。 */

test('视图切换 .pill 必须有自己的内边距（文字不能贴框线）', () => {
  // v2 新语言里 pill 一律带 1px 描边。下划线型 pill 可以很薄，
  // 一旦套上边框，薄内边距会让文字压在框上——用户反馈"tag 太逼仄"的根因。
  const m = CSS.match(/\n\.pill \{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到基础 .pill 规则');
  const pad = /padding:\s*([^;]+);/.exec(m[1]);
  assert.ok(pad, '.pill 没有显式内边距');
  const parts = pad[1].trim().split(/\s+/);
  assert.ok(parts.length >= 2, '.pill 内边距应写"上下 左右"两段，实际 "' + pad[1] + '"');
  const left = parts[1];
  const px = /^([\d.]+)px$/.exec(left);
  const spVar = /^var\(--sp-(\d+)\)$/.exec(left);
  const val = px ? parseFloat(px[1]) : (spVar ? parseFloat(spVar[1]) : NaN);
  assert.ok(!Number.isNaN(val) && val >= 8, '.pill 左右内边距只有 ' + left + '，文字会贴住边框');
});

test('.chip 筛选器与 .pill 视图切换必须是两套独立的视觉', () => {
  // 混用会让用户读不出层级：筛选器是信息单元（带计数/色点），
  // 视图切换是导航。两者同款时，页面上两行 tag 看起来是一回事。
  assert.ok(/\.chip \{[^}]*border:/.test(CSS), '.chip 应有自己的边框');
  assert.ok(/\.chip \{[^}]*display: inline-flex/.test(CSS), '.chip 应为 inline-flex（色点+文字+计数要能对齐）');
  assert.ok(/\.chip b \{/.test(CSS), '.chip 的计数应有独立样式');
});

test('不许用 *{border-radius:0!important} 统一改圆角（语义圆点会被压成方块）', () => {
  // 旧的四套"设计语言皮肤"曾用它一次性清零圆角，代价是 .ev-dot（事件类型色点）
  // 变成方块、"这是一个点"的读感消失。v2 只有一套形状令牌，不需要这种通配改法。
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\*\s*\{[^}]*border-radius:\s*0\s*!important/.test(stripped),
    '又出现了 * { border-radius: 0 !important } 通配清零');
  const dots = stripped.match(/\.ev-dot[^{]*\{[^}]*\}/g) || [];
  assert.ok(dots.length, '找不到 .ev-dot 规则');
  assert.ok(dots.some(r => /border-radius:\s*(50%|999px|var\(--r-pill\))/.test(r)),
    '.ev-dot 丢了圆形（事件类型色点应是圆点）');
});

/* ---------------- 浅色皮肤下的可读性守卫 ----------------
   "看不见"是一类不会报错的回归：5% 白叠在白底上等于什么都没发生，
   键盘选中的那一行直接在 日光模式里消失。这里把它变成可断言的数字。 */

/* v2（2026-11）推倒重来：旧 两套模式删除，只剩一套设计语言的两个模式。
     ':root' = 深空（nexus），'daylight' = 日光（2026-11-09 起为默认）。对比度守卫对两套都要成立。 */
const THEMES = [':root', 'daylight'];
function themeBlock(name) {
  const re = name === ':root'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : new RegExp('html\\[data-theme="' + name + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}');
  const m = CSS.match(re);
  assert.ok(m, '找不到 ' + name + ' 的主题块');
  return m[1];
}
function themeVar(name, block) {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(block);
  return m ? m[1].trim() : null;
}
const srgb2linRel = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relLum = ([r, g, b]) => 0.2126 * srgb2linRel(r) + 0.7152 * srgb2linRel(g) + 0.0722 * srgb2linRel(b);
const contrast = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

test('两套模式都定义了选中/悬停要用到的令牌（--accent-rgb / --bg-hover）', () => {
  THEMES.forEach(t => {
    const b = themeBlock(t);
    assert.ok(themeVar('accent-rgb', b), t + ' 缺 --accent-rgb');
    assert.ok(themeVar('bg-hover', b), t + ' 缺 --bg-hover');
    assert.ok(themeVar('bg-elevated', b), t + ' 缺 --bg-elevated');
  });
});

test('搜索下拉的悬停/选中行不许再写死白色透明层（5% 白叠白底 = 看不见）', () => {
  const rules = CSS.match(/\.sr-item[^{]*\{[^}]*\}/g) || [];
  const joined = rules.join('\n');
  assert.ok(rules.length >= 2, '没扫到 .sr-item 的规则（选择器可能失效）');
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(joined),
    '还在用写死的白色透明层：' + joined.replace(/\s+/g, ' '));
  assert.ok(/var\(--accent-rgb\)/.test(joined), '选中/悬停行没有用主题强调色');
});

test('搜索下拉选中行在 两套模式下都看得见（与面板底色有可辨的色差）', () => {
  THEMES.forEach(t => {
    const b = themeBlock(t);
    const bg = themeVar('bg-elevated', b);
    const rgb = themeVar('accent-rgb', b).split(',').map(s => parseInt(s, 10));
    assert.ok(/^#[0-9a-f]{6}$/i.test(bg), t + ' 的 --bg-elevated 不是 hex：' + bg);
    const base = [1, 3, 5].map(i => parseInt(bg.substr(i, 2), 16));
    const alpha = 0.20;   // .sr-item.sel 的蒙版浓度
    const over = base.map((c, i) => c + (rgb[i] - c) * alpha);
    const ratio = contrast(over, base);
    assert.ok(ratio >= 1.15,
      t + ' 皮肤的选中行与面板底色色差只有 ' + ratio.toFixed(2) + ':1（看得见才算数）');
  });
});

test('「?」按钮桌面端可点区 ≥24×24，字色用 --text-tertiary（浅色皮肤下 --text-faint 太淡）', () => {
  const m = CSS.match(/\n\.ask \{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到桌面端的 .ask 规则');
  const block = m[1];
  assert.ok(/position:\s*relative/.test(block), '没有定位基准，外扩的可点区放不下');
  assert.ok(/var\(--text-tertiary\)/.test(block), '问号字色还是 --text-faint（浅色皮肤下几乎看不见）');
  const after = CSS.match(/\.ask::after \{([^}]*)\}/);
  assert.ok(after, '没有外扩的可点区（.ask::after）');
  const w = /width:\s*(\d+(?:\.\d+)?)px/.exec(after[1]);
  const h = /height:\s*(\d+(?:\.\d+)?)px/.exec(after[1]);
  assert.ok(w && h, '可点区没有写明宽高');
  assert.ok(parseFloat(w[1]) >= 24 && parseFloat(h[1]) >= 24,
    `可点区只有 ${w[1]}×${h[1]}px（要 ≥24×24）`);
});

test('窄屏的「?」仍要保持 26×26（那段是手指头能点到的尺寸，别改坏）', () => {
  const re = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g;
  let m, narrow = null;
  while ((m = re.exec(CSS))) { if (/\.ask \{/.test(m[1])) { narrow = m[1]; break; } }
  assert.ok(narrow, '窄屏媒体查询里没有 .ask 规则');
  const rule = narrow.match(/\.ask \{([\s\S]*?)\}/);
  assert.ok(rule, '窄屏里没有 .ask 规则');
  assert.ok(/width:\s*26px/.test(rule[1]) && /height:\s*26px/.test(rule[1]), '窄屏的可点区不是 26×26');
});

/* ============================================================
   可访问性守卫（2026-10-22）
   ------------------------------------------------------------
   上面那些是"看起来对不对"，这一组是"看不见的回归"：
   涨跌文字对比度、焦点环宽度、焦点环被关掉——三者都不会报错，
   只在页面上表现为低视力用户看不清涨跌、键盘用户不知道焦点在哪。
   全部按 WCAG 相对亮度公式实算（不做目测），逐皮肤给数字。
   ============================================================ */

const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, '');   // 去掉注释再扫规则

// 某个主题的令牌；主题没定义就回落 :root（深色皮肤共用根令牌）
function themeVarOrRoot(name, theme) {
  const v = themeVar(name, themeBlock(theme));
  if (v) return v;
  return themeVar(name, themeBlock(':root'));
}

test('两套模式下涨/跌**文字色**对各自底色都 ≥4.5:1（AA 正文）', () => {
  // 浅色 5 套（paper/swiss/bauhaus/clay/memphis）原来直接用亮色
  // #ff5c5c / #2ebd85，实测只有 2.22~3.03:1 —— AA 正文要 4.5:1。
  // 现在每套浅色皮肤各自覆写 --text-rise / --text-fall（文字专用色），
  // 色块/图形仍然是原来的亮色 --up / --down。
  THEMES.forEach(t => {
    const rise = themeVarOrRoot('text-rise', t);
    const fall = themeVarOrRoot('text-fall', t);
    assert.ok(/^#[0-9a-f]{6}$/i.test(rise), t + ' 的 --text-rise 不是 #rrggbb：' + rise);
    assert.ok(/^#[0-9a-f]{6}$/i.test(fall), t + ' 的 --text-fall 不是 #rrggbb：' + fall);
    const b = themeBlock(t);
    ['bg', 'bg-elevated', 'bg-card'].forEach(surface => {
      const bgHex = themeVar(surface, b);
      assert.ok(/^#[0-9a-f]{6}$/i.test(bgHex), t + ' 的 --' + surface + ' 不是 hex：' + bgHex);
      const bg = hex2rgb(bgHex);
      const up = contrast(hex2rgb(rise), bg);
      const down = contrast(hex2rgb(fall), bg);
      assert.ok(up >= 4.5, `${t} 的涨字色 ${rise} 对 --${surface}(${bgHex}) 只有 ${up.toFixed(2)}:1`);
      assert.ok(down >= 4.5, `${t} 的跌字色 ${fall} 对 --${surface}(${bgHex}) 只有 ${down.toFixed(2)}:1`);
    });
  });
});

test('涨跌文字走 --up-text/--down-text，色块仍走亮色 --up/--down', () => {
  const up = CSS.match(/^\.up\s*\{([^}]*)\}/m);
  assert.ok(up, '找不到 .up 规则');
  assert.ok(/var\(--up-text\)/.test(up[1]), '.up 文字没有走 --up-text：' + up[1]);
  const down = CSS.match(/^\.down\s*\{([^}]*)\}/m);
  assert.ok(down, '找不到 .down 规则');
  assert.ok(/var\(--down-text\)/.test(down[1]), '.down 文字没有走 --down-text：' + down[1]);
  // 图形色块（振幅条游标）是图形不是文字：必须还是亮色，否则整块图形会塌成灰
  const bar = CSS.match(/\.rbar \.rb-track > b\s*\{([^}]*)\}/);
  assert.ok(bar && /var\(--up\)/.test(bar[1]), '图形色块不该换成文字色（应用 --up，不是 --up-text）');
});

test('全局焦点环宽度 ≥2px（WCAG 2.2 SC 2.4.11）', () => {
  const m = CSS_NC.match(/^:focus-visible\s*\{([^}]*)\}/m);
  assert.ok(m, '找不到全局 :focus-visible 规则');
  const w = /outline:\s*(\d+(?:\.\d+)?)px/.exec(m[1]);
  assert.ok(w, '全局 :focus-visible 的 outline 没写像素宽度：' + m[1].replace(/\s+/g, ' '));
  assert.ok(parseFloat(w[1]) >= 2, `全局焦点环只有 ${w[1]}px（SC 2.4.11 要求 ≥2px）`);
});

test('.bchip:focus-visible 的焦点环不能是 none（产业链概念条）', () => {
  const m = CSS_NC.match(/\.bchip:focus-visible\s*\{([^}]*)\}/);
  assert.ok(m, '找不到 .bchip:focus-visible 规则');
  assert.ok(!/outline:\s*none/.test(m[1]),
    '.bchip 的焦点环被关掉了（合成到浅色皮肤白底只有 1.00:1）：' + m[1].replace(/\s+/g, ' '));
  const w = /outline:\s*(\d+(?:\.\d+)?)px/.exec(m[1]);
  assert.ok(w && parseFloat(w[1]) >= 2, '.bchip 的焦点环宽度不足 2px：' + m[1].replace(/\s+/g, ' '));
});

test('不许用 :focus{outline:none} 把焦点环整个关掉', () => {
  // :focus 的特异性高于全局的 :focus-visible，写了 outline:none 焦点环就没了。
  // 到价提醒弹层的「触发价」输入框原来就是这样——键盘用户看不到自己在哪一格。
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  const bad = rules.filter(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i);
    const body = r.slice(i);
    return /:focus(?![-\w])/.test(sel) && /outline:\s*none/.test(body);
  });
  assert.equal(bad.length, 0, '这些规则把焦点指示关掉了：' +
    bad.map(s => s.replace(/\s+/g, ' ')).join(' | '));
});

test('折叠标题的焦点环要用焦点环专用色（原来的 --border-hover 合成到白底只有 1.90:1）', () => {
  const m = CSS_NC.match(/\[data-fold\][^{]*\.section-head:focus-visible\s*\{([^}]*)\}/);
  assert.ok(m, '找不到折叠标题的焦点环规则');
  assert.ok(/var\(--focus-ring\)/.test(m[1]), '折叠标题的焦点环没有用 --focus-ring：' + m[1]);
});

test('焦点环颜色在 两套模式下都对底色 ≥3:1（WCAG 1.4.11 非文本对比）', () => {
  // clay 的主强调橙压自己的底色只有 2.78:1、memphis 的粉只有 2.86:1，
  // 所以这两套皮肤把焦点环换成同色系深一档的 --focus-ring。
  THEMES.forEach(t => {
    let ring = themeVarOrRoot('focus-ring', t);
    if (ring === 'var(--accent-signature)') ring = themeVarOrRoot('accent-signature', t);
    assert.ok(/^#[0-9a-f]{6}$/i.test(ring), t + ' 的 --focus-ring 不是 hex：' + ring);
    const b = themeBlock(t);
    ['bg', 'bg-elevated'].forEach(surface => {
      const bg = hex2rgb(themeVar(surface, b));
      const r = contrast(hex2rgb(ring), bg);
      assert.ok(r >= 3, `${t} 的焦点环 ${ring} 对 --${surface} 只有 ${r.toFixed(2)}:1（要 ≥3:1）`);
    });
  });
});

test('三个分段控件的按钮都有 aria-pressed（选中态不能只活在 CSS 类里）', () => {
  ['segTheme', 'segUpdown', 'segRefresh'].forEach(id => {
    const m = HTML.match(new RegExp('id="' + id + '"[\\s\\S]*?</div>'));
    assert.ok(m, 'index.html 里找不到 ' + id);
    const buttons = m[0].match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length >= 2, id + ' 里没有按钮');
    buttons.filter(b => !/data-theme="random"/.test(b)).forEach(b => {
      assert.ok(/aria-pressed=/.test(b), id + ' 里的按钮缺 aria-pressed：' + b);
    });
  });
});

test('搜索框要是 combobox（searchbox 角色不支持 aria-expanded / aria-autocomplete）', () => {
  const m = HTML.match(/<input[^>]*id="searchInput"[^>]*>/);
  assert.ok(m, '找不到搜索输入框');
  assert.ok(/role="combobox"/.test(m[0]), '搜索框缺 role="combobox"');
  assert.ok(/aria-autocomplete="list"/.test(m[0]), '搜索框缺 aria-autocomplete="list"');
  assert.ok(/aria-controls="searchResults"/.test(m[0]), '搜索框缺 aria-controls');
  assert.ok(/aria-activedescendant/.test(m[0]), '搜索框缺 aria-activedescendant');
});

test('热力图画布要可聚焦（tabindex="0"）+ 有表格视图兜底', () => {
  const m = HTML.match(/<canvas[^>]*id="heatCanvas"[^>]*>/);
  assert.ok(m, '找不到热力图画布');
  assert.ok(/tabindex="0"/.test(m[0]), '热力图画布不可聚焦，键盘用户拿不到全市场涨跌分布');
  assert.ok(/id="heatTable"/.test(HTML), '没有热力图表格视图（读屏用户的等价入口）');
  assert.ok(/id="heatCursorLive"/.test(HTML), '没有热力图游标播报区');
});

test('三个弹层都接了公共焦点陷阱（js/focus-trap.js）', () => {
  const trap = readFileSync(path.join(ROOT, 'js/focus-trap.js'), 'utf8');
  assert.ok(/summary/.test(trap),
    '焦点陷阱的候选里必须有 <summary>——设置弹层的「数据源自检」是 <details>，漏了它永远拿不到焦点');
  ['js/app.js', 'js/alerts.js', 'js/pmshare.js'].forEach(f => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/FocusTrap/.test(src), f + ' 没有接公共焦点陷阱（Tab 会跑出弹层 / 关掉后焦点丢失）');
  });
  /* v3.3：业务脚本打成一个 bundle 后，index.html 不再有单独的 focus-trap 标签。
     判据改成「加载清单里有它」——打包或未打包都成立。 */
  const bundleFiles = JSON.parse(readFileSync(path.join(ROOT, '_scripts/js-bundle.manifest.json'), 'utf8')).files;
  assert.ok(bundleFiles.includes('js/focus-trap.js') || HTML.includes('js/focus-trap.js'),
    '没有加载 js/focus-trap.js（bundle 清单与 index.html 都没有）');
});

test('一级 tab 是 roving tabindex（同一时刻只占一个 Tab 位）', () => {
  const m = HTML.match(/<nav[^>]*id="tabs"[\s\S]*?<\/nav>/);
  assert.ok(m, '找不到顶栏 tablist');
  const tabs = m[0].match(/<button[^>]*role="tab"[^>]*>/g) || [];
  assert.ok(tabs.length >= 10, '顶栏 tab 数量异常');
  const zero = tabs.filter(t => /tabindex="0"/.test(t)).length;
  const minus = tabs.filter(t => /tabindex="-1"/.test(t)).length;
  assert.equal(zero, 1, `有 ${zero} 个 tab 在 Tab 序里（roving tabindex 只允许 1 个）`);
  assert.equal(minus, tabs.length - 1, '其余 tab 应当是 tabindex="-1"');
  // 每个 tab 都要有 id：面板用 aria-labelledby 指向当前那个 tab
  tabs.forEach(t => assert.ok(/\sid="tab-/.test(t), 'tab 缺 id（面板名会一直停在"全球市场"）：' + t));
  assert.ok(/id="view-market"[^>]*aria-labelledby="tab-all"/.test(HTML), '市场面板没有用 aria-labelledby 指向当前 tab');
});

/* ============================================================
   语义色收敛守卫（2026-10-31 · 路线图 P0★ 第 1 条）
   ------------------------------------------------------------
   路线图裁定："红/绿只许表示涨跌"。三道闸：
   一、--warn 与涨跌色解耦且 两套模式可读（警示用橙，对比度同 AA 正文标准）；
   二、非涨跌元素禁用 var(--up*)/var(--down*)（规则级方向语义白名单，只减不增）；
   三、CSS 全文涨跌色硬编码字面量清零（剥令牌声明后无豁免——死令牌 --ok 已删除）。
   JS 画布 fallback 里的红绿属方向色语义，不在二、三的扫描范围（两者只扫 CSS）。
   ============================================================ */

test('警示色 --warn 与涨跌色解耦且 两套模式对三表面都 ≥4.5:1', () => {
  // --warn 曾直接取涨红 #ff5c5c：红涨模式下"警示"与"涨"同色，违反"红只表示涨跌"。
  // 收敛后深色皮肤用警示橙 #ff8f3d，日光模式各自覆写深琥珀 #a04c05
  // （对最差表面 paper --bg-elevated #edebe4 实测 4.99:1，对白底 5.95:1）。
  // 绿涨模式只是 --up/--down 两个字面量互换，下面照两种模式的取值各查一遍。
  const dirVals = [cssVar('up'), cssVar('down'),
    (CSS.match(/data-updown="green"\s*\{[^}]*--up:\s*([^;]+);/) || [])[1],
    (CSS.match(/data-updown="green"\s*\{[^}]*--down:\s*([^;]+);/) || [])[1]]
    .filter(Boolean).map(v => v.trim().toLowerCase());
  THEMES.forEach(t => {
    const warn = themeVarOrRoot('warn', t);
    assert.ok(/^#[0-9a-f]{6}$/i.test(warn), t + ' 的 --warn 缺失或不是 #rrggbb：' + warn);
    dirVals.forEach(v => assert.ok(v !== warn.toLowerCase(),
      `${t} 的 --warn(${warn}) 与涨跌色 ${v} 同值——警示色必须与涨跌色解耦`));
    const b = themeBlock(t);
    ['bg', 'bg-elevated', 'bg-card'].forEach(surface => {
      const bgHex = themeVar(surface, b);
      assert.ok(/^#[0-9a-f]{6}$/i.test(bgHex), t + ' 的 --' + surface + ' 不是 hex：' + bgHex);
      const r = contrast(hex2rgb(warn), hex2rgb(bgHex));
      assert.ok(r >= 4.5,
        `${t} 的警示色 ${warn} 对 --${surface}(${bgHex}) 只有 ${r.toFixed(2)}:1（AA 正文要 4.5:1）`);
    });
  });
});

test('非涨跌元素禁用涨跌色（规则级方向语义白名单，只减不增）', () => {
  // 任何规则体里消费 var(--up*)/var(--down*) 八形态的（--up/--down/--up-text/
  // --up-bg/--up-rgb 及 --down 对应四个），其选择器必须命中方向语义白名单。
  // 白名单由 2026-10-31 全站排查得出（评审核实恰穷尽剩余方向色规则），
  // **只减不增**：再往里加条目等于给"红绿非涨跌语义"开新口子，必须走路线图评审。
  // --up-rgb/--down-rgb 目前在 CSS 无 var() 消费（只有 JS 价格闪烁在用）。
  const WL = ['.up', '.down', '.hero-chg', '.sb-panic', '.sb-greed', '.thermo-track',
    '.ts-', '.tc-bias', '.imp-dir', '.pm-chg', '.brk-chg', '.rbar'];
  const DIR = /var\(--(up|down)(-text|-bg|-rgb)?\s*[),]/;
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = rules.filter(r => {
    if (!DIR.test(r)) return false;
    const sel = r.slice(0, r.indexOf('{')).trim();
    return !WL.some(w => sel.includes(w));
  });
  assert.equal(bad.length, 0,
    '这些规则在非方向语义元素上消费涨跌色（白名单只减不增，新增须走评审）：\n    ' +
    bad.map(s => s.replace(/\s+/g, ' ').trim()).join('\n    '));
});

test('涨跌色硬编码字面量清零（无豁免——剥令牌声明后 CSS 全文不得再现）', () => {
  // 语义收敛的最后一道闸：--up/--down/--text-rise/--text-fall 令牌声明本身合法，
  // 但除此之外 CSS 里不许再出现这些色值字面量（否则改涨跌色时漏改一处就是两份漂移）。
  // 曾计划给 --ok: #2ebd85 留豁免，实查（ae3768e 已删最后消费者 .status-ok、全仓零
  // var(--ok) 消费）为死令牌，2026-10-31 直接删除——从此无任何具名豁免，本断言
  // 是无豁免绝对禁令。JS 画布 fallback 的红绿属方向色语义，不在扫描范围（只扫 CSS）。
  const stripped = CSS_NC.replace(/--(up|down|text-rise|text-fall)[a-z-]*\s*:\s*[^;]+;/g, '');
  const BANNED = [
    [/#ff5c5c/i, '#ff5c5c（涨红）'],
    [/#2ebd85/i, '#2ebd85（跌绿）'],
    [/#f6465d/i, '#f6465d'],
    [/rgba\(\s*255\s*,\s*92\s*,\s*92\s*,/i, 'rgba(255,92,92,·)（涨红系）'],
    [/rgba\(\s*46\s*,\s*189\s*,\s*133\s*,/i, 'rgba(46,189,133,·)（跌绿系）'],
    [/rgba\(\s*246\s*,\s*70\s*,\s*93\s*,/i, 'rgba(246,70,93,·)'],
  ];
  const hits = BANNED.filter(([re]) => re.test(stripped)).map(([, label]) => label);
  assert.equal(hits.length, 0,
    'CSS 里残留涨跌色硬编码字面量（无豁免，改走令牌或 color-mix）：' + hits.join('、'));
});

/* ============================================================
   页头与分隔线守卫（2026-10-31 · 路线图 P0★ 第 2 条）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶二）：巨型 tab 标题（clamp 到 64~72px 的
   报纸头版语言）吃掉 1/8 屏幕但零信息；2~4px 粗黑规则线与 10 秒轮询的
   终端数据密度打架。处方：页头降级成小节头（12px 大写字距标签 +
   一行元数据），水平分隔线家族统一 1px。这两件事都不会报错，只在
   页面上表现为"头版"与"终端"两种性格互相打架，所以钉成断言。
   范围边界：卡片左竖条 / 色带 accent 边（.pm-sec-head、.pm-card、
   #heroStrip 等）属形状令牌（下一轮）；选中下划线（.tab.active::after）
   属选中态语言——均不在本组扫描范围。
   ============================================================ */

test('页头是小节头：所有皮肤的 h1.page-title 都不得回到巨型字号', () => {
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  const hits = rules.filter(r => /page-title/.test(r.slice(0, r.indexOf('{'))));
  assert.ok(hits.length >= 1, '没扫到 page-title 规则，选择器可能失效');
  hits.forEach(r => {
    const sel = r.slice(0, r.indexOf('{')).replace(/\s+/g, ' ').trim();
    const body = r.slice(r.indexOf('{'));
    assert.ok(!/clamp\(/.test(body), '页头又用了响应式巨型字号（clamp）：' + sel);
    const fs = /font-size:\s*([\d.]+)px/.exec(body);
    if (fs) assert.ok(parseFloat(fs[1]) <= 13,
      `${sel} 的字号 ${fs[1]}px 超过小节头上限 13px（页头降级不许回退）`);
  });
  // ③c 字号接线后 12px 以 var(--fs-12) 落地（令牌值恰 12px，由字号五档组钉死），
  // 两种形态同义接受——断言语义不变：基础页头必须落在 12px 小节头档。
  const small = hits.some(r => /font-size:\s*(12px|var\(--fs-12\))/.test(r.slice(r.indexOf('{'))));
  assert.ok(small, '基础 h1.page-title 应是 12px 小节头标签（一行元数据语言）');
});

test('水平分隔线家族统一 1px（.section/.pm-sec/.pm-overview/.sec-line/.topbar）', () => {
  // 词边界用 (?![\w-])：.section-head / .pm-sec-head / .topbar-actions 等
  // 同前缀子元素各有自己的语言（卡片左竖条等留给形状令牌轮），不在此列。
  const SEL = /\.section(?![\w-])|\.pm-sec(?![\w-])|\.pm-overview(?![\w-])|\.sec-line(?![\w-])|\.topbar(?![\w-])/;
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const selRaw = r.slice(0, i);
    if (!SEL.test(selRaw)) return;
    const sel = selRaw.replace(/\s+/g, ' ').trim();
    const body = r.slice(i);
    if (/double/.test(body)) bad.push(sel + ' 仍用 double 报头双线');
    const bds = body.match(/\bborder(?!-radius)(?:-[a-z]+)?\s*:\s*[^;}]+/g) || [];
    bds.forEach(d => {
      const px = /(\d+(?:\.\d+)?)px/.exec(d);
      if (px && parseFloat(px[1]) > 1) bad.push(sel + ' → ' + d.replace(/\s+/g, ' ').trim());
    });
    if (/\.sec-line(?![\w-])/.test(selRaw)) {
      const h = /(?:^|[;{\s])height:\s*(\d+(?:\.\d+)?)px/.exec(body);
      if (h && parseFloat(h[1]) > 1) bad.push(sel + ' 分隔线高度 ' + h[1] + 'px 超过 1px');
    }
  });
  assert.equal(bad.length, 0, '分隔线家族仍有粗线（应统一 1px）：\n    ' + bad.join('\n    '));
});

/* ============================================================
   形状令牌守卫（2026-11-01 · 路线图 P0★ 第 3 条）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶三）：卡片语言三种以上并存——圆角、
   描边、阴影各成体系，此前 tokens.test 管住了颜色令牌、没管形状令牌。
   处方：radius 三档（4/8/14）+ 描边一档（1px）+ 阴影两档进 tokens，
   卡片收敛为三模板：
     · 大卡/浮层 = --r-lg + --shadow-2（modal、aurora 玻璃面板）
     · 标准卡   = --r-md + 1px 描边（pm-card/fq-card/event-detail 等）
     · 迷你卡/行内控件 = --r-sm 无阴影（qrow/chip/徽章/取色块）
     · 条形轨道 = 999px 胶囊；方角(0)/圆(50%)是 paper 皮肤与
       几何图形（圆点/问号）的身份层，不属于档位体系。
   形状漂了不会报错，只在页面上表现为"每个组件自说自话"，钉成断言。
   ============================================================ */

/* 六形态 + var(--r-pill)：胶囊档既有令牌（--r-pill: 999px），写令牌比写字面量更该被鼓励 */
const RADIUS_OK = new Set(['var(--r-sm)', 'var(--r-md)', 'var(--r-lg)', 'var(--r-pill)', '0', '50%', '999px']);

test('radius 三档令牌：全站 border-radius 收敛六形态 + --r-sm/md/lg 恰为 4/8/14px', () => {
  // 先扫违规（红的时候给出完整清单），再卡令牌定义本身。
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const body = r.slice(i);
    if (!/border-radius\s*:/.test(body)) return;
    const sel = r.slice(0, i).replace(/\s+/g, ' ').trim();
    const val = (/border-radius\s*:\s*([^;}]+)/.exec(body))[1]
      .replace(/!important/g, '').trim();
    // 多值形态（如 "0 var(--r-sm) var(--r-sm) 0"）逐分量验收
    val.split(/\s+/).forEach(part => {
      if (!RADIUS_OK.has(part)) bad.push(sel + ': ' + val);
    });
  });
  assert.equal(bad.length, 0,
    'border-radius 出现六形态之外的档位（大卡 r-lg / 标准卡 r-md / 迷你件 r-sm）：\n    ' +
    [...new Set(bad)].join('\n    '));
  assert.equal(cssVar('r-sm'), '4px', '--r-sm 应恰为 4px');
  assert.equal(cssVar('r-md'), '8px', '--r-md 应恰为 8px');
  assert.equal(cssVar('r-lg'), '14px', '--r-lg 应恰为 14px');
});

test('阴影两档令牌：全站 box-shadow 收敛 + 暗色禁阴影(none) + 浅色亮影覆盖', () => {
  // 海拔只许两档：--shadow-1（浮出菜单/提示浮层/悬停浮起）、--shadow-2（模态/大浮层）。
  // 豁免三类：none（关闭海拔）、inset 开头（选中/下划线指示条，不是海拔）、
  // 0 0 0 2px 开头（focus 焦点环复合，不是海拔）。
  // 2026-11-01（P0★ 病灶五）：:root 暗色默认 = none（黑影叠黑底不可见），
  // 浅色 5 套皮肤块各自覆写 --shadow-1 亮影承接海拔。
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i).replace(/\s+/g, ' ').trim();
    const re = /box-shadow\s*:\s*([^;}]+)/g;
    let m;
    while ((m = re.exec(r.slice(i)))) {
      const v = m[1].trim();
      const okVal = ['var(--shadow-1)', 'var(--shadow-2)', 'none'].includes(v)
        || v.startsWith('inset')
        || /^0\s+0\s+0\s+2px/.test(v);
      if (!okVal) bad.push(sel + ': ' + v);
    }
  });
  assert.equal(bad.length, 0,
    'box-shadow 海拔值超出两档（--shadow-1 / --shadow-2）：\n    ' +
    [...new Set(bad)].join('\n    '));
  // 2026-11-01（P0★ 病灶五·暗色对比度）：:root 暗色默认两档改为 none——
  // rgba(0,0,0,…) 黑影叠 #0a0a0b/#000 底 1:1 不可见，卡片边界交给 1px 描边
  // （--border 已提亮，守卫见下方「暗色 1px 描边可见度」组）。
  assert.equal(cssVar('shadow-1'), 'none', '--shadow-1（暗色默认）应禁阴影：' + cssVar('shadow-1'));
  assert.equal(cssVar('shadow-2'), 'none', '--shadow-2（暗色默认）应禁阴影：' + cssVar('shadow-2'));
  // 海拔交给浅色承接：日光模式块各自覆写 --shadow-1 亮影
  // （paper 原有，swiss/bauhaus/clay/memphis 四套本轮补——:root 变 none 后
  // 浅色悬停浮起/浮层拿到的会是 none，等于海拔消失）。
  // 海拔交给日光模式承接：daylight 必须覆写 --shadow-1/2 亮影，否则卡片浮不起来。
  const dayBlock = themeBlock('daylight');
  ['shadow-1', 'shadow-2'].forEach(tok => {
    const v = themeVar(tok, dayBlock);
    assert.ok(v && /rgba\(/.test(v), 'daylight 缺 --' + tok + ' 亮色覆盖（rgba 阴影）：' + v);
  });
});

test('描边一档：可见描边只许 1px、标记条统一 2px', () => {
  // 方向边（border-left/top/bottom/right）2px = 标记条（卡片左竖条/色带），合法；
  // 全边 border: 2px（描边框）禁止——描边只许 1px 一档；
  // ≥3px 的可见边一律违规。放行后随 solid transparent 的滚动条 thumb：
  // 那是"透明边框 + padding-box 裁剪"做内边距的技巧，不是可见描边。
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i).replace(/\s+/g, ' ').trim();
    const bds = r.slice(i).match(/\bborder(?!-radius)(?:-(?:left|right|top|bottom))?(?:-width)?\s*:\s*[^;}]+/g) || [];
    bds.forEach(d => {
      if (/transparent/.test(d)) return;   // 滚动条内边距技巧，非可见描边
      if (/^\s*border\s*:\s*[2-9]/.test(d)) { bad.push(sel + ' → ' + d.trim()); return; }
      const pxs = (d.match(/(\d+(?:\.\d+)?)px/g) || []).map(parseFloat);
      if (pxs.some(n => n >= 3)) bad.push(sel + ' → ' + d.trim());
    });
  });
  assert.equal(bad.length, 0,
    '描边宽度越档（可见描边 1px 一档、方向边标记条 2px 一档）：\n    ' +
    [...new Set(bad)].join('\n    '));
});

/* ============================================================
   暗色对比度守卫（2026-11-01 · 路线图 P0★ 第 6 条）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶五）：OLED/暗色纯黑下对比度塌——
   文字灰对最差表面仅 2.75~2.95:1（.brief-c 计数/图例刻度等信息性
   文字正用 --text-faint，不是"仅装饰"），卡片边界 rgba 白/靛
   0.06~0.10 合成后对 --bg 仅 1.10~1.15:1 形同不存在；阴影
   rgba(0,0,0,0.5) 叠 #0a0a0b/#000 底 1:1 不可见。
   处方：暗色 3 套（:root/aurora/oled）文字灰阶提亮至对全部四表面
   ≥4.5:1；描边提亮（--border 合成后 ≥1.25:1、--border-hover ≥1.7:1）；
   阴影一律禁用改 1px 描边（守卫在上一组阴影令牌内）。日光模式
   块各自覆写 --text-* 不受影响，本组只扫暗色三套。对比度按 WCAG
   相对亮度公式实算，rgba 描边先按 alpha 合成到底色再算。
   ============================================================ */

test('深空模式文字灰阶对全部四表面 ≥4.5:1（:root）', () => {
  // .brief-c 计数、图例刻度等信息性文字用的正是 --text-faint——旧注释
  // "仅装饰符号不承载信息"不成立，旧值 #5c5c63 对最差表面只有 2.75:1。
  // 新值三档各提亮约三档灰阶：:root #b4b4bc/#a0a0a8/#8a8a92（最差表面
  // 8.85/7.02/5.32），aurora 自有 #aeb7cf/#96a0bc/#7e88a6（8.53/6.56/4.86），
  // oled 不覆写灰阶、继承 :root（9.08/7.21/5.46）。
  [':root'].forEach(t => {
    ['text-secondary', 'text-tertiary', 'text-faint'].forEach(tok => {
      const v = themeVarOrRoot(tok, t);
      assert.ok(/^#[0-9a-f]{6}$/i.test(v), t + ' 的 --' + tok + ' 不是 #rrggbb：' + v);
      const b = themeBlock(t);
      ['bg', 'bg-elevated', 'bg-card', 'bg-hover'].forEach(surface => {
        const bgHex = themeVar(surface, b);
        assert.ok(/^#[0-9a-f]{6}$/i.test(bgHex), t + ' 的 --' + surface + ' 不是 hex：' + bgHex);
        const r = contrast(hex2rgb(v), hex2rgb(bgHex));
        assert.ok(r >= 4.5,
          `${t} 的 --${tok}(${v}) 对 --${surface}(${bgHex}) 只有 ${r.toFixed(2)}:1（AA 正文要 4.5:1）`);
      });
    });
  });
});

const rgbaOver = (rgba, bg) => {
  // rgba 前景按 alpha 合成到 bg 上：描边是半透明白/靛，直接拿 rgba 值算对比度
  // 会失真——卡片边界"看得见与否"取决于合成后的实色。
  const m = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/.exec(String(rgba).trim());
  assert.ok(m, '不是 rgba(r,g,b,a) 形式：' + rgba);
  const a = parseFloat(m[4]);
  return [1, 2, 3].map(i => Math.round(parseInt(m[i], 10) * a + bg[i - 1] * (1 - a)));
};

test('暗色 1px 描边可见度：--border 合成后对 --bg ≥1.25:1、--border-hover ≥1.7:1', () => {
  // 旧值 0.06~0.10 alpha 合成后只有 1.10~1.15:1——卡片与背景失去边界，
  // 禁阴影后这就是唯一的分界线。新值：:root 0.15/0.26（1.47/2.22）、
  // aurora 0.17/0.32（1.30/1.81）、oled 0.15/0.26（1.39/2.10）。
  [':root'].forEach(t => {
    const b = themeBlock(t);
    const bgHex = themeVar('bg', b);
    assert.ok(/^#[0-9a-f]{6}$/i.test(bgHex), t + ' 的 --bg 不是 hex：' + bgHex);
    const bg = hex2rgb(bgHex);
    const border = themeVar('border', b);
    const hover = themeVar('border-hover', b);
    const rb = contrast(rgbaOver(border, bg), bg);
    const rh = contrast(rgbaOver(hover, bg), bg);
    assert.ok(rb >= 1.25,
      `${t} 的 --border(${border}) 对 --bg(${bgHex}) 合成后只有 ${rb.toFixed(2)}:1（卡片边界看不见）`);
    assert.ok(rh >= 1.7,
      `${t} 的 --border-hover(${hover}) 对 --bg(${bgHex}) 合成后只有 ${rh.toFixed(2)}:1`);
  });
});

/* ============================================================
   移动端修急守卫（2026-11-01 · 路线图 P0★ 第 7 条）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶六）：390px 下情绪条行溢出——
   "3 涨…"数字被裁。病根不是缺规则而是级联序事故：窄屏堆叠规则
   （grid-template-columns: 1fr 等）写在文件前部的 640px 媒体块，
   被 .brief-row/.brief-v 基础规则（文件更后位置、同特异性后者胜）
   静默覆盖，三列网格 170+140+间距已 326px，390px 屏可用 ~358px，
   第三列只剩十几像素。修法＝堆叠规则搬到基础规则之后；顶栏重排
   （logo 缩图标、搜索占满中段）。钉成断言防再次被后置规则覆盖。
   ============================================================ */

test('移动端修急：小节头不竖排 + 顶栏搜索占中（390px 守卫）', () => {
  // 断言 A（v3 改）：简报带已整块下线，改为守卫它的替代问题——
  // 长副标题不许把小节标题压成竖排（390px 下曾出现"热力图"竖排三个字）。
  const shAll = CSS_NC.match(/\.section-head\s*\{[^}]*\}/g) || [];
  assert.ok(shAll.length, '找不到 .section-head 规则');
  assert.ok(shAll.some(r => /flex-wrap:\s*wrap/.test(r)),
    '.section-head 缺 flex-wrap: wrap（长副标题会把标题压成竖排）');
  assert.ok(/\.section-head \.section-title\s*\{[^}]*flex:\s*none/.test(CSS_NC),
    '.section-title 缺 flex: none（会被副标题挤扁）');
  // 断言 B：顶栏重排——logo 缩图标、搜索占满中段（手机端顶栏两行化块内）。
  assert.ok(/\.logo span:not\(\.logo-dot\)\s*\{\s*display:\s*none;\s*\}/.test(CSS_NC),
    'logo 未缩为图标（顶栏文字未隐藏）');
  const tb = CSS_NC.indexOf('.topbar-actions { flex: 1');
  assert.ok(tb > -1, '手机端顶栏 .topbar-actions 未改 flex: 1（搜索占不进中段）');
  // 搜索相关断言锚定在 .topbar-actions 所在的媒体块内，避免被
  // 全站其它 .search-input 规则（如 .cmp-search 的 width:100%）误判为已修。
  const mstart = CSS_NC.lastIndexOf('@media', tb);
  const block = CSS_NC.slice(mstart, CSS_NC.indexOf('\n}', tb));
  assert.ok(/\.search-wrap\s*\{\s*flex:\s*1/.test(block), '手机端顶栏块缺 .search-wrap { flex: 1 }（搜索占中）');
  assert.ok(/\.search-input\s*\{\s*width:\s*100%;\s*\}/.test(block), '手机端搜索框未撑满中段（width: 100%）');
  assert.ok(!/\.search-input\s*\{\s*width:\s*138px/.test(CSS_NC), '手机端搜索框仍是 138px 定宽');
});

/* ============================================================
   间距骨架守卫（2026-11-01 · 路线图 P0★ 第 4 条）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶四）：间距无骨架——margin/padding/gap
   里的 px 字面量 4~48px 十几种档位并存，节奏靠手感不靠系统。
   处方：--sp-4/8/12/16/24/32/48 七档进 tokens（映射规则：就近取档、
   平局向上——6px→--sp-8、10px→--sp-12），已转换的离格值清零钉成断言。
   进度：骨架①（01:51）清零 6px/10px 共 172 处；骨架②（02:36）把剩余
   全部离格档位清零、禁用集补至穷尽（20 组映射：5→4、7/9→8、11/13→12、
   14~19→16、20/22/26→24、28/30/34→32、40/44/56/72→48）；③a/③b/③c
   字号音阶五档收敛完毕；④a（06:52）在档接线第一半——4/8/12 三档
   199 处接归 var(--sp-4/8/12)；④b（本轮·收尾）接线剩余 16/24/32/48
   共 52 处（16px×41、24px×8、32px×3、48px×0），calc() 内 32/24/16px
   与同声明裸 16px 一并接线——④a「不碰 calc」的例外至此到期，calc
   内不再有任何在档字面量；同轮恢复 ae3768e 误删的 .chain-flow 规则头
   （gap 6px→--sp-8、padding-bottom 4px→--sp-4 按②轮映射令牌化，
   守卫见下一组）。间距音阶全量收口、条目可勾选。禁用集只增不减
   （上一版组头笔误写反成「只减不增」，本轮更正）。
   ============================================================ */

test('间距七档令牌：--sp-4…48 进 tokens 且值恰为 4/8/12/16/24/32/48px', () => {
  // 2026-11-01 ④b：七档全部接线完毕——4/8/12 三档 199 处（④a）+
  // 16/24/32/48 四档 52 处（本轮）；消费总量由下一组断言 B 卡下限，
  // 这里只钉"七档都在、值不漂"。
  [['sp-4', '4px'], ['sp-8', '8px'], ['sp-12', '12px'], ['sp-16', '16px'],
   ['sp-24', '24px'], ['sp-32', '32px'], ['sp-48', '48px']].forEach(([n, v]) => {
    assert.equal(cssVar(n), v, `--${n} 应恰为 ${v}`);
  });
});

test('间距离格值清零 + ④b 在档接线（16/24/32/48 清零、calc 内一并接线、var(--sp-) ≥600）', () => {
  // 断言 A：规则体内间距家族声明（margin/padding/gap 家族，含方向与
  // 逻辑变体）不得再现禁用档位的 px 字面量。禁用集**只增不减**：
  // 骨架①清零 6px/10px（172 处）；骨架②补至穷尽——剩余全部离格档位
  // 5/7/9/11/13/14/15/17/18/19/20/22/26/28/30/34/40/44/56/72；
  // ④a 接线 4/8/12 三档（199 处清零）；④b（本轮）追加 16/24/32/48
  // 四档——52 处在档字面量（16px×41、24px×8、32px×3，含 calc() 内
  // 32/24/16px 与同声明裸 16px）接线归 var(--sp-4…48) 后清零。
  // 永久豁免（合计 62）：<4px 发丝级 1/2/3px×60（1px×12、2px×32、
  // 3px×16，多为描边/微调）与负值 margin -1px/-3.5px 两处。
  const BANNED = new Set([
    '6', '10',                                  // 骨架①（只增不减）
    '5', '7', '9', '11', '13', '14', '15', '17', '18', '19',
    '20', '22', '26', '28', '30', '34', '40', '44', '56', '72', // 骨架②补至穷尽
    '4', '8', '12',                             // ④a 接线后清零（只增不减）
    '16', '24', '32', '48',                     // ④b 接线后清零（只增不减）
  ]);
  const SP = /^(margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block|start|end|inline-start|inline-end|block-start|block-end))?$/;
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i).replace(/\s+/g, ' ').trim();
    r.slice(i).split(';').forEach(piece => {
      const ci = piece.indexOf(':');
      if (ci < 0) return;
      const prop = piece.slice(0, ci).replace(/[{}]/g, ' ').trim();
      if (!SP.test(prop)) return;
      const val = piece.slice(ci + 1);
      (val.match(/(?<![\d.])(\d+(?:\.\d+)?)px/g) || []).forEach(px => {
        const n = parseFloat(px);
        if (n >= 4 && BANNED.has(String(parseInt(n, 10))))
          bad.push(`${sel || '(无名规则)'} → ${prop}: ${val.trim()}`);
      });
    });
  });
  assert.equal(bad.length, 0,
    '间距家族声明仍含禁用档位字面量（禁用集只增不减，新档位须走评审）：\n    ' +
    [...new Set(bad)].join('\n    '));
  // 断言 B：令牌必须真实消费——防"骨架先行"退化成"令牌摆设"。
  // 骨架① 172 处 + 骨架② 全量离格清零，消费实测 398；④a 接线
  // 4/8/12 三档 199 处后实测 597；④b（本轮）接线 16/24/32/48 共
  // 52 处 + .chain-flow 规则头恢复（gap/padding-bottom 令牌化 2 处），
  // 实测 651（=597+52+2），下限卡 600（余量 51）。
  const used = (CSS_NC.match(/var\(--sp-/g) || []).length;
  assert.ok(used >= 600, `var(--sp-) 消费只有 ${used} 处（应 ≥600，防令牌摆设化）`);
});

/* ============================================================
   结构守卫：CSS 花括号配平（2026-11-01 · 间距骨架④a 引入）
   ------------------------------------------------------------
   ae3768e（2026-10-20）误删 .chain-flow 规则头后，文件里残留孤儿
   尾行（`  padding-bottom: 4px; scrollbar-width: thin; }`），全文
   花括号配平 -1：规则切分器遇到孤儿片段会静默跳过（该行不进任何
   规则体断言、其声明从此无人看守），宽松恢复还可能吞掉后续规则——
   这种结构损伤不会报错，钉成断言。断言写等式不硬编码计数：计数随
   行数演化，配平关系才是不变量。④a 清孤儿后实测：去注释口径 1271 对、
   全文口径 1272 对（清账前 CSS_NC 为 '{'=1271/'}'=1272，差 1 来自
   孤儿行那枚 '}'）。
   ============================================================ */

test('CSS 花括号配平：去注释后 { 与 } 计数相等（孤儿规则片段守卫）', () => {
  const open = (CSS_NC.match(/\{/g) || []).length;
  const close = (CSS_NC.match(/\}/g) || []).length;
  assert.equal(open, close,
    `花括号不配平：{=${open} vs }=${close}（多出的闭括号意味着存在孤儿片段，规则切分器会静默跳过它）`);
});

/* ============================================================
   结构守卫：.chain-flow 规则头恢复（2026-11-01 · 间距骨架④b 引入）
   ------------------------------------------------------------
   ae3768e（2026-10-20）误删 .chain-flow 规则头，产业链展开态弹性
   布局失效：app.js:4005 仍产出该容器，.link-node（flex: 1 1 0）/
   .chain-arrow（flex-shrink: 0）弹性子项属性落空，且不报任何错——
   容器还在、只是没了布局。孤儿尾行已由 ④a 清账（上一组配平守卫），
   ④b 恢复规则头并把两处间距令牌化（gap 6px→--sp-8、
   padding-bottom 4px→--sp-4，按②轮映射）。两道断言缺一不可：
   缺 CSS 规则则展开态布局静默失效（ae3768e 事故形态——规则头被删、
   孤儿尾行残留、花括号配平破裂，上一组只防结构破裂、本组防规则
   缺失）；缺 app.js 产出则 CSS 规则成无人消费的死代码（照
   drawHideV1 跨文件守卫先例）。
   ============================================================ */

test('.chain-flow 规则头存在且弹性布局属性齐全（ae3768e 误删守卫）', () => {
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  const hit = rules.find(r => r.slice(0, r.indexOf('{')).trim() === '.chain-flow');
  assert.ok(hit, 'CSS 找不到选择器恰为 .chain-flow 的规则（规则头被误删会让产业链展开态弹性布局静默失效）');
  ['display: flex', 'align-items: stretch', 'overflow-x: auto', 'gap: var(--sp-8)'].forEach(k => {
    assert.ok(hit.includes(k), '.chain-flow 规则体缺「' + k + '」：' + hit.replace(/\s+/g, ' '));
  });
});

test('js/app.js 必须仍产出 class="chain-flow" 容器（防 CSS 死代码）', () => {
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/class="chain-flow"/.test(app),
    'app.js 不再产出 <div class="chain-flow"> 容器（.chain-flow CSS 规则将成无人消费的死代码）');
});

/* ============================================================
   字号音阶守卫（2026-11-01 · 路线图 P0★ 第 4 条 · 骨架③a）
   ------------------------------------------------------------
   诊断（docs/UI-AUDIT.md 病灶五）：font-size 全站 24 种档位并存
   （8~56px），正文/标签/标题的层级靠手感不靠系统。
   处方：--fs-12/13/15/20/32 五档进 tokens，映射规则与间距同款
   「就近取档、平局向上」（12.5→13；14/16/17→15；18/19/21/22/24→20；
   28/30/34/56→32；Floor=12px 可读性下限；展示层大数字一并归 32 档，
   音阶落差由字重与 tabular-nums 承担）。
   进度：③a 清零 >12px 的 raw（67 处归档接线）+ font 简写清账；
   ③b 接线 10px×86+11px×87=173 处；③c（本轮·收尾）接线剩余
   8/9/9.5/10.5/11.5/12px 共 111 处 → var(--fs-12)（12px×86 为纯令牌
   改名零视觉变化，其余 25 处升档至 Floor=12），过渡白名单清空，
   字号音阶五档收敛**全部完成**。唯一永久豁免：font-size: 0（.ask
   触达区文字隐藏技巧：640px 媒体查询内 0 隐藏原文字、::before 以
   var(--fs-12)/16px 重绘问号，桌面 9.5→12 接线后与移动端自然对齐；
   非排版档位）。字号部分已收口；spacing 在档字面量 ④a（本轮）已接线
   4/8/12 三档 199 处，16/24/32/48 共 52 处留 ④b 收尾。
   ============================================================ */

test('字号五档令牌：--fs-12/13/15/20/32 进 tokens 且值恰为 12/13/15/20/32px', () => {
  // 与间距组一同款：只钉"五档都在、值不漂"，消费总量由下一组断言 C 卡下限。
  [['fs-12', '12px'], ['fs-13', '13px'], ['fs-15', '15px'], ['fs-20', '20px'],
   ['fs-32', '32px']].forEach(([n, v]) => {
    assert.equal(cssVar(n), v, `--${n} 应恰为 ${v}`);
  });
});

test('font-size 收敛五档·终（12 档白名单清空、font 简写清零、var(--fs-) ≥340）', () => {
  // 断言 A：规则体内 font-size 声明值只许落在两类集合——
  //   · 五档令牌 var(--fs-12/13/15/20/32)：③a 67 处 + ③b 173 处 +
  //     ③c 111 处（8/9/9.5/10.5/11.5/12px 全归 --fs-12，就近取档
  //     Floor=12），过渡白名单已清空，raw 字面量档位**不再存在**；
  //   · '0'：.ask 触达区文字隐藏技巧，永久豁免（见上）。
  const ALLOWED = new Set([
    'var(--fs-12)', 'var(--fs-13)', 'var(--fs-15)', 'var(--fs-20)', 'var(--fs-32)',
    '0',
  ]);
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  assert.ok(rules.length > 300, '规则切分数异常，选择器可能失效');
  const bad = [];
  rules.forEach(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i).replace(/\s+/g, ' ').trim();
    (r.slice(i).match(/\bfont-size\s*:\s*[^;}]+/g) || []).forEach(d => {
      const val = d.slice(d.indexOf(':') + 1).trim();
      if (!ALLOWED.has(val)) bad.push(`${sel || '(无名规则)'} → font-size: ${val}`);
    });
  });
  assert.equal(bad.length, 0,
    'font-size 越档（白名单已清空，raw 档位只许 var(--fs-五档) ∪ {0}，新档位须走评审）：\n    ' +
    [...new Set(bad)].join('\n    '));
  // 断言 B：font 简写带 px 字号防绕过——font: 10px/15px 把字号藏进简写
  // 同样越档（font-family/font-weight 冒号前有后缀，天然不匹配本模式）。
  const shorthand = CSS_NC.match(/\bfont\s*:\s*[\d.][^;}]*/g) || [];
  assert.equal(shorthand.length, 0,
    'font 简写仍带 px 字号（字号须走 var(--fs-*)、行高单独声明）：\n    ' +
    shorthand.join('\n    '));
  // 断言 C：令牌必须真实消费——防"五档进 tokens"退化成"令牌摆设"。
  // ③a 68 + ③b 173 + ③c 111，实测 352，下限卡 340（留 12 余量）。
  const used = (CSS_NC.match(/var\(--fs-/g) || []).length;
  assert.ok(used >= 340, `var(--fs-) 消费只有 ${used} 处（应 ≥340，防令牌摆设化）`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
