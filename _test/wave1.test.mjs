#!/usr/bin/env node
/* wave1.test.mjs —— 深度融合 Wave 1 的针对性回归（2026-11-21，Gemini 施工单验收项）
 * 覆盖五块：
 *   ① 美股代码规范化 helper（裸 ticker ↔ usAAPL 终端命名空间）
 *   ② 自选老数据幂等迁移（裸 AAPL → usAAPL、双记录去重、反复执行稳定）
 *   ③ Meridian 信号胶囊卡（renderCard 纯函数：真实协议对象 → 结构化 HTML）
 *   ④ 接线静态断言（hash 修复 / #ussig 深链 / usSignals 消费 / Vegas 叠线 /
 *      desktop.js 图表销毁配对 / 跨站主题同步双向）
 *   ⑤ 跨站主题映射（nexus/daylight ↔ night/day）
 * 用法：node _test/wave1.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'apps', 'terminal');
const read = (p) => readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};

/* ---- utils.js 真实加载（最小环境，与 utils.test 同法）---- */
const ctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
  setTimeout, clearTimeout, TextDecoder, RegExp, Error, Promise, Map, Set,
  document: {
    documentElement: {}, body: {},
    createElement: () => ({ style: {}, remove() { }, addEventListener() { } }),
    head: { appendChild() { } }, querySelectorAll: () => [], addEventListener() { },
  },
  localStorage: (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  })(),
});
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(SITE, 'js', 'utils.js'), 'utf8'), ctx, { filename: 'js/utils.js' });
const U = ctx.window.U;

/* ---- us-signals.js 真实加载（boot 只碰 DOM 事件，renderCard 是纯函数）---- */
const usctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, isFinite, isNaN,
  setTimeout, clearTimeout, RegExp, Error, Promise, Map, Set,
  document: { readyState: 'loading', addEventListener() { }, getElementById: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
});
usctx.window = usctx;
usctx.globalThis = usctx;
usctx.window.Bus = { on() { }, off() { }, emit() { } };
usctx.window.Store = { watchlist: { all: () => [], has: () => false, toggle: () => false } };
// us-signals.js 消费 utils.js 的 helper（window.U 同 ctx 链）
vm.runInContext(readFileSync(path.join(SITE, 'js', 'utils.js'), 'utf8'), usctx, { filename: 'js/utils.js' });
vm.runInContext(readFileSync(path.join(SITE, 'js', 'us-signals.js'), 'utf8'), usctx, { filename: 'js/us-signals.js' });
const UsSignals = usctx.window.UsSignals;

/* ============ ① 美股代码规范化 ============ */

test('normUsSymbol：裸 ticker → 终端命名空间 usAAPL', () => {
  assert.equal(U.normUsSymbol('AAPL'), 'usAAPL');
  assert.equal(U.normUsSymbol(' BRK.B '), 'usBRK.B');       // 多类股带点
  assert.equal(U.normUsSymbol('usAAPL'), 'usAAPL');          // 已是终端形态：原样
  assert.equal(U.normUsSymbol('usTSLA'), 'usTSLA');
});

test('normUsSymbol：非美股形态一律拒绝（不误伤加密/外汇/港股）', () => {
  assert.equal(U.normUsSymbol('BTCUSDT'), '');
  assert.equal(U.normUsSymbol('EM:171.US10Y'), '');
  assert.equal(U.normUsSymbol('hk00700'), '');
  assert.equal(U.normUsSymbol('sh600519'), '');
  assert.equal(U.normUsSymbol(''), '');
  assert.equal(U.normUsSymbol(null), '');
});

test('isBareUsTicker：hash/迁移共用的裸代码判定', () => {
  assert.equal(U.isBareUsTicker('AAPL'), true);
  assert.equal(U.isBareUsTicker('BRK.B'), true);
  assert.equal(U.isBareUsTicker('usAAPL'), false);
  assert.equal(U.isBareUsTicker('BTCUSDT'), false);
});

/* ============ ② 自选老数据幂等迁移 ============ */

test('migrateWatchlist：裸 ticker 转 usAAPL 且 market 归位', () => {
  const r = U.migrateWatchlist([
    { symbol: 'AAPL', name: 'Apple', market: '' },
    { symbol: 'sh600519', name: '贵州茅台', market: 'cn' },
    { symbol: 'BRK.B', name: 'Berkshire', market: '' },
  ]);
  assert.equal(r.changed, true);
  // vm 沙箱数组过不了 deepStrictEqual（跨 realm 原型不同）——序列化比较
  assert.equal(JSON.stringify(r.list.map(x => x.symbol)), JSON.stringify(['usAAPL', 'sh600519', 'usBRK.B']));
  assert.equal(r.list[0].market, 'us');
  assert.equal(r.list[0].name, 'Apple');     // 其他字段保留
});

test('migrateWatchlist：双记录去重（归一后撞键保留第一条）', () => {
  const r = U.migrateWatchlist([
    { symbol: 'usAAPL', name: 'Apple', market: 'us' },
    { symbol: 'AAPL', name: 'AAPL', market: '' },
  ]);
  assert.equal(r.changed, true);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].name, 'Apple');     // 规范记录胜出
});

test('migrateWatchlist：幂等——迁过的清单再跑一遍零变化', () => {
  const clean = [
    { symbol: 'usAAPL', name: 'Apple', market: 'us' },
    { symbol: 'sh600519', name: '贵州茅台', market: 'cn' },
    { symbol: 'BTCUSDT', name: 'BTC', market: 'crypto' },
  ];
  const r1 = U.migrateWatchlist(clean);
  assert.equal(r1.changed, false);
  assert.equal(JSON.stringify(r1.list), JSON.stringify(clean));   // 跨 realm 序列化比较
  const r2 = U.migrateWatchlist(r1.list);
  assert.equal(r2.changed, false);
  assert.equal(JSON.stringify(r2.list), JSON.stringify(clean));
});

/* ============ ③ Meridian 信号胶囊卡 ============ */

const SAMPLE = {
  symbol: 'AAPL', rank: 1, price: 349.21, changePct: -0.89, adj: 'raw', spmoWeight: 2.4,
  tags: { sp500: true, ndx100: true, watch: false, tvSymbol: 'NASDAQ:AAPL' },
  daily: {
    rsi6: { value: 27.5, state: 'oversold' }, rsi14: { value: 39.5, state: 'neutral' },
    revert: true,
    vegas: [
      { key: '短通道', n: [144, 169], pos: 'below', event: null, insufficient: false },
      { key: '中通道', n: [288, 338], pos: 'above', event: 'out_up', insufficient: false },
    ],
  },
  weekly: { rsi6: { value: 11.6, state: 'oversold' }, rsi14: { value: 19.6, state: 'neutral' } },
  warnings: [{ tag: '数据', text: '最后一根收盘 bar 为 2026-11-18，指标不是当期值' }],
};

test('renderCard：真实协议对象 → 结构化 HTML（RSI/回归/通道/SPMO/警告全呈现）', () => {
  assert.ok(UsSignals && typeof UsSignals.renderCard === 'function', 'window.UsSignals.renderCard 未导出');
  const html = UsSignals.renderCard(SAMPLE);
  assert.match(html, /Meridian 信号/);
  assert.match(html, /27\.5/);                       // 日 RSI6 数值
  assert.match(html, /11\.6/);                       // 周 RSI6 数值
  assert.match(html, /RSI 回归/);                    // 回归态
  assert.match(html, /通道下方/);                    // vegas 位置
  assert.match(html, /EMA144\/169/);                 // 通道参数
  assert.match(html, /out_up/);                      // 穿线事件
  assert.match(html, /2\.4%/);                       // SPMO 权重
  assert.match(html, /不复权/);                      // 口径徽标
  assert.match(html, /2026-11-18/);                  // 警告透出
  assert.ok(!/javascript:/i.test(html), '卡片内不允许脚本链');
});

test('renderCard：脏输入不炸（null / 空对象 / 缺 daily）', () => {
  assert.equal(UsSignals.renderCard(null), '');
  assert.equal(UsSignals.renderCard('x'), '');
  const html = UsSignals.renderCard({});
  assert.match(html, /Meridian 信号/);               // 空对象也出卡壳，格子显示 --
  assert.match(html, /--/);
});

test('renderCard：HTML 注入防线（title/name 类文本过 esc）', () => {
  const evil = JSON.parse(JSON.stringify(SAMPLE));
  evil.warnings = [{ tag: '数据', text: '<img src=x onerror=alert(1)>' }];
  const html = UsSignals.renderCard(evil);
  assert.ok(!/<img /.test(html), '警告文本必须被转义');
  assert.match(html, /&lt;img/);
});

/* ============ ④ 接线静态断言（IIFE 内部行为不可直测，钉关键路径） ============ */

test('app.js：hash 解析修复（裸美股不再误判加密）', () => {
  const js = read(path.join(SITE, 'js', 'app.js'));
  assert.match(js, /isBareUsTicker\(sym\)/, 'hash 重建必须先过裸美股判定');
  assert.match(js, /USDT\$\/i\.test\(sym\)\) return \{ symbol: sym, name: sym, code: sym, market: 'crypto'/,
    '加密判定收紧为 USDT 结尾');
  assert.match(js, /#ussig/, 'Meridian 迁移深链 #ussig 必须被终端识别');
});

test('app.js：usSignals 正式消费 + 信号卡插入技术面', () => {
  const js = read(path.join(SITE, 'js', 'app.js'));
  assert.match(js, /t\.usSignals && window\.UsSignals/, 'loadTechnical 必须消费 usSignals');
  assert.match(js, /UsSignals\.renderCard/, '渲染口走 us-signals.js 的纯函数');
  assert.match(js, /migrateWatchlist\(window\.Store\.watchlist\.all\(\)\)/, 'init 先行迁移老自选');
  assert.match(js, /ensureUsSigMap/, '自选信号雷达数据源已接');
  assert.match(js, /data-ussig=/, '自选行挂信号数据属性');
});

test('charts.js + app.js：Vegas 主图叠线链路', () => {
  const charts = read(path.join(SITE, 'js', 'charts.js'));
  const app = read(path.join(SITE, 'js', 'app.js'));
  assert.match(charts, /function setOverlays\(list\)/, 'charts.js 缺 setOverlays');
  assert.match(charts, /renderOverlays\(\);[\s\S]*?paintLegend/, 'setData 必须同步重算叠加层');
  assert.match(charts, /setOverlays,/, '返回面必须暴露 setOverlays');
  assert.match(app, /applyVegasOverlay/, 'app.js 缺 Vegas 叠线接线');
  assert.match(app, /vegasToggle/, '详情工具条缺一键开关按钮');
});

test('desktop.js：图表实例销毁配对（防泄漏）', () => {
  const js = read(path.join(SITE, 'js', 'desktop.js'));
  assert.match(js, /destroyChart: function[\s\S]{0,400}?\.remove\(\)/, 'destroyChart 必须调 charts.remove 全量清理');
  // show 的两个出口（空态 / 重建）都必须先销毁旧实例（容忍行尾注释）
  assert.match(js, /self\.destroyChart\(\);[^\n]*\n\s*host\.innerHTML = '<div class="dt-empty">该周期暂无数据/, '空态出口未销毁旧实例');
  assert.match(js, /self\.destroyChart\(\);[^\n]*\n\s*host\.innerHTML = ''/, '重建出口未销毁旧实例');
});

test('desktop.js：ussig 面板接通 Bus/星标/筛选 chips', () => {
  const js = read(path.join(SITE, 'js', 'desktop.js'));
  assert.match(js, /data-us-star=/, '信号表缺星标列');
  assert.match(js, /Bus\.emit\('watchlist'\)/, '星标点击必须广播 watchlist');
  assert.match(js, /data-us-f=/, '筛选 chips 必须可点');
  assert.match(js, /Bus\.on\('watchlist'/, '必须监听跨面板星标同步');
});

test('跨站主题同步：两端接线 + 映射函数', () => {
  assert.equal(U.themeToAcademy('nexus'), 'night');
  assert.equal(U.themeToAcademy('daylight'), 'day');
  assert.equal(U.themeToLens('night'), 'nexus');
  assert.equal(U.themeToLens('day'), 'daylight');
  const app = read(path.join(SITE, 'js', 'app.js'));
  const academy = read(path.join(ROOT, 'apps', 'academy', 'js', 'app.js'));
  assert.match(app, /syncAcademyTheme\(t\)/, '终端 applyTheme 必须镜像 academy');
  assert.match(app, /addEventListener\('storage'[\s\S]{0,200}ofa_state/, '终端缺 academy 回流监听');
  assert.match(academy, /themeToLens|nexus/, 'academy 必须镜像终端 gfd_settings');
  assert.match(academy, /addEventListener\('storage'[\s\S]{0,200}gfd_settings/, 'academy 缺终端回流监听');
});

test('command.js：Meridian 美股词典异步补装', () => {
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.match(js, /usSignalsItems/, '缺美股标的缓存位');
  assert.match(js, /fetchUsSignalsIntoLocal/, '缺异步补装函数');
  assert.match(js, /normUsSymbol\(it\.symbol\)/, '词典条目必须走终端命名空间');
});

test('command.js：⌘K 接入 Academy 术语（Wave 3 切片 B）', () => {
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.match(js, /data\/academy-terms\.json/, '缺术语清单懒拉地址');
  assert.match(js, /function fetchTermsIntoLocal/, '缺术语懒拉函数');
  assert.match(js, /kind: 'term'/, '术语条目必须是独立 kind，不混进 symbol 词典');
  assert.match(js, /group: '术语'/, '术语条目必须有自己的分组');
  assert.match(js, /item\.kind === 'term'\)[\s\S]{0,120}openTerm\(item\.id\)/, '选中行为必须打开术语页');
  // 相对路径 + 单源 BASE（AcademyGloss），禁写死域名
  assert.match(js, /\(global\.AcademyGloss && global\.AcademyGloss\.BASE\) \|\| 'academy\/'/, '术语链接必须复用 AcademyGloss.BASE 单源');
  assert.match(js, /'#\/term\/' \+ encodeURIComponent/, '术语 id 必须编码后拼进 hash 路由');
  assert.match(js, /\?from=lens/, '术语链接必须带来源标记');
  assert.ok(!/5777-wq\.github\.io/.test(js), 'command.js 不允许写死科普站域名');
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}, 0);
