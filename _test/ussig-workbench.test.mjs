#!/usr/bin/env node
/* ussig-workbench.test.mjs —— Sprint2 切片 S1「美股信号工作台」针对性回归（2026-11-21）
 * 覆盖五块（只碰 window.UsSignals 的纯函数导出 + us-signals.js 源静态钉线，不触 DOM/网络）：
 *   ① 导出面齐全：renderCard / buildRadar / buildMarkdown / buildCSV
 *   ② buildRadar：今日异动雷达三组提炼（回归 / Vegas 穿线 / 自选异动）——
 *      rank 升序、每组上限 2、回归组筛选键 'revert' 直筛（混 cross 不丢成员）、
 *      自选组必须 watchSet 命中且带信号、输入不被突变、空输入诚实回空
 *   ③ buildMarkdown：结构化摘要（头部口径/计数/免责句/Markdown 转义）
 *   ④ buildCSV：UTF-8 BOM + 固定 9 列表头 + 逗号/引号转义 + CRLF
 *   ⑤ renderCard 不回归（Wave 1 协议对象口径）+ render/bind 挂点静态钉线
 * 用法：node _test/ussig-workbench.test.mjs（注册进 run-all.mjs 由主 agent 统一收口） */

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

/* ---- us-signals.js 真实加载（最小环境；boot 依赖 DOM 事件，四个导出均为纯函数）---- */
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
// us-signals.js 消费 utils.js 的 helper（window.U.normUsSymbol 同 ctx 链）
vm.runInContext(readFileSync(path.join(SITE, 'js', 'utils.js'), 'utf8'), usctx, { filename: 'js/utils.js' });
vm.runInContext(readFileSync(path.join(SITE, 'js', 'us-signals.js'), 'utf8'), usctx, { filename: 'js/us-signals.js' });
const UsSignals = usctx.window.UsSignals;
const U = usctx.window.U;

/* ---- 协议夹具：us-signals.json items[] 形态（协议见 pipelines/meridian/us-schema.mjs）---- */
const MK = (o) => Object.assign({
  symbol: 'X', name: '', rank: 99, price: 100, changePct: 0, adj: '', stale: false,
  tags: { sp500: false, ndx100: false, watch: false, tvSymbol: '' },
  daily: { rsi6: { value: 50, state: 'neutral' }, rsi14: { value: 50, state: 'neutral' }, revert: false, vegas: [] },
  weekly: { rsi6: { value: 50, state: 'neutral' }, rsi14: { value: 50, state: 'neutral' }, revert: false, vegas: [] },
  spmoWeight: null, warnings: [],
}, o);

const FIX = [
  MK({
    symbol: 'MSFT', name: '微软', rank: 1, price: 512.4, changePct: 1.23,
    tags: { sp500: true, ndx100: true, watch: false, tvSymbol: 'NASDAQ:MSFT' },
    daily: {
      rsi6: { value: 78.2, state: 'overbought', cross: 'out_ob' }, rsi14: { value: 66, state: 'neutral' },
      revert: true,
      vegas: [
        { key: '短通道', n: [144, 169], pos: 'above', event: null, insufficient: false },
        { key: '中通道', n: [288, 338], pos: 'above', event: 'break_up', insufficient: false },
      ],
    },
    weekly: { rsi6: { value: 61.2, state: 'neutral' }, rsi14: { value: 55.1, state: 'neutral' }, revert: false, vegas: [] },
  }),
  MK({
    symbol: 'AAPL', name: '苹果', rank: 2, price: 349.21, changePct: -0.89,
    tags: { sp500: true, ndx100: false, watch: false, tvSymbol: 'NASDAQ:AAPL' },
    daily: {
      rsi6: { value: 27.5, state: 'oversold', cross: 'out_os' }, rsi14: { value: 39.5, state: 'neutral' },
      revert: true,
      vegas: [{ key: '短通道', n: [144, 169], pos: 'below', event: null, insufficient: false }],
    },
    weekly: { rsi6: { value: 11.6, state: 'oversold' }, rsi14: { value: 19.6, state: 'neutral' }, revert: false, vegas: [] },
  }),
  MK({
    symbol: 'NVDA', name: '英伟达', rank: 3, price: 180.5, changePct: -2.4,
    daily: {
      rsi6: { value: 24.1, state: 'oversold' }, rsi14: { value: 35, state: 'neutral' },
      revert: false,
      vegas: [{ key: '短通道', n: [144, 169], pos: 'below', event: 'break_down', insufficient: false }],
    },
  }),
  MK({
    symbol: 'TSLA', name: '特斯拉', rank: 4, price: 402.8, changePct: 0.3,
    daily: { rsi6: { value: 51.2, state: 'neutral' }, rsi14: { value: 48, state: 'neutral' }, revert: false, vegas: [] },
  }),
];
const WATCH_SET = { usNVDA: true, usTSLA: true };   // 键与星标同一把 usAAPL 钥匙

/* ============ ① 导出面 ============ */

test('导出面：renderCard + buildRadar + buildMarkdown + buildCSV 全部可调', () => {
  assert.ok(UsSignals, 'window.UsSignals 未挂载');
  for (const k of ['renderCard', 'buildRadar', 'buildMarkdown', 'buildCSV']) {
    assert.equal(typeof UsSignals[k], 'function', '缺导出 ' + k);
  }
});

/* ============ ② buildRadar：今日异动雷达 ============ */

test('buildRadar：三组提炼 + rank 升序 + 组筛选键（回归/穿线/自选）', () => {
  const r = UsSignals.buildRadar(FIX, WATCH_SET, U.normUsSymbol);
  // 回归组：MSFT(1) AAPL(2) daily.revert=true → 统一 'revert' 直筛（组内混 out_ob/out_os 两种 cross）
  assert.equal(JSON.stringify(r.revert.syms), JSON.stringify(['MSFT', 'AAPL']));
  assert.equal(r.revert.filterKey, 'revert');
  // 穿线组：MSFT 中通道 break_up(1)、NVDA 短通道 break_down(3)；TSLA 无事件不进
  assert.equal(JSON.stringify(r.vegas.syms), JSON.stringify(['MSFT', 'NVDA']));
  assert.equal(r.vegas.filterKey, 'ev');
  // 自选组：NVDA 被自选且 RSI6 超卖 → 进；TSLA 被自选但中性/无回归/无穿线 → 不进
  assert.equal(JSON.stringify(r.watch.syms), JSON.stringify(['NVDA']));
  assert.equal(r.watch.filterKey, 'watch');
});

test('buildRadar：每组上限 2 枚 + 无 rank（如 SPMO）排末尾', () => {
  const v = (event) => [{ key: '短通道', n: [144, 169], pos: 'inside', event, insufficient: false }];
  const fix = [
    MK({ symbol: 'AAAA', rank: 7, daily: { rsi6: { value: 72, state: 'overbought' }, revert: true, vegas: v('break_up') } }),
    MK({ symbol: 'BBBB', rank: 2, daily: { rsi6: { value: 25, state: 'oversold', cross: 'out_os' }, revert: true, vegas: v('break_down') } }),
    MK({ symbol: 'CCCC', rank: 9, daily: { rsi6: { value: 51, state: 'neutral' }, revert: true, vegas: v('break_up') } }),
    MK({ symbol: 'DDDD', rank: null, daily: { rsi6: { value: 51, state: 'neutral' }, revert: false, vegas: v('break_down') } }),
  ];
  const all = { usAAAA: true, usBBBB: true, usCCCC: true, usDDDD: true };
  const r = UsSignals.buildRadar(fix, all, U.normUsSymbol);
  // 回归候选 AAAA(7)/BBBB(2)/CCCC(9) → 只取 rank 最小两枚；filterKey 统一 'revert'
  assert.equal(JSON.stringify(r.revert.syms), JSON.stringify(['BBBB', 'AAAA']));
  assert.equal(r.revert.filterKey, 'revert');
  // 穿线候选 4 枚（含无 rank 的 DDDD）→ rank 2/7 两枚，CCCC(9) 与 DDDD(null) 被上限吃掉
  assert.equal(JSON.stringify(r.vegas.syms), JSON.stringify(['BBBB', 'AAAA']));
  // 自选候选 AAAA(超买)/BBBB(超卖)/CCCC(回归) 三枚 → 上限 2；DDDD 自选但无任何信号 → 本就不进
  assert.equal(JSON.stringify(r.watch.syms), JSON.stringify(['BBBB', 'AAAA']));
});

test('buildRadar：watchSet 未命中 / 无信号一律不进自选组；normUs 参与键归一', () => {
  const r0 = UsSignals.buildRadar(FIX, {}, U.normUsSymbol);
  assert.equal(r0.watch.syms.length, 0, '空自选集合 → 自选组为空');
  const oversoldOnly = [MK({ symbol: 'NVDA', rank: 1, daily: { rsi6: { value: 24.1, state: 'oversold' }, revert: false, vegas: [] } })];
  assert.equal(UsSignals.buildRadar(oversoldOnly, {}, U.normUsSymbol).watch.syms.length, 0, '有信号但未自选 → 不进');
  // 键必须经 normUs 归一（usNVDA）：传恒等 normUs 时键对不上 → 不进
  const keyed = UsSignals.buildRadar(oversoldOnly, { usNVDA: true }, (s) => s);
  assert.equal(keyed.watch.syms.length, 0, 'normUs 缺位时 usAAPL 钥匙对不上 → 不进（防假阳性）');
});

test('buildRadar：空输入诚实回空 + 输入数组不被突变', () => {
  const before = JSON.stringify(FIX);
  const r = UsSignals.buildRadar([], {}, U.normUsSymbol);
  assert.equal(JSON.stringify(r), JSON.stringify({
    revert: { filterKey: null, syms: [] }, vegas: { filterKey: 'ev', syms: [] }, watch: { filterKey: 'watch', syms: [] },
  }));
  assert.equal(JSON.stringify(FIX), before, 'buildRadar 不得重排/突变入参');
  const r2 = UsSignals.buildRadar(FIX, WATCH_SET, U.normUsSymbol);
  assert.equal(JSON.stringify(FIX), before, '带数据调用同样不得突变入参');
  assert.ok(r2.revert.syms.length > 0);
});

/* ============ ③ buildMarkdown：AI 播报摘要 ============ */

const META = { cycle: 'daily', period: '6', date: '2026-11-21', filter: 'os', filterLabel: '超卖' };

test('buildMarkdown：头部口径/计数/逐条事实/免责句齐备', () => {
  const md = UsSignals.buildMarkdown([FIX[1]], META);   // AAPL
  assert.ok(md.startsWith('## 美股信号摘要（日RSI6 · 2026-11-21）'), '标题带周期口径与日期');
  assert.match(md, /共 1 只 · 筛选：超卖/, '计数行带筛选标签');
  assert.match(md, /- \*\*AAPL 苹果\*\*：日RSI6 27\.5（超卖）/, '逐条行 = 代码 名称 + RSI 值与状态');
  assert.match(md, /Vegas 短通道下方/, 'Vegas 事实段');
  assert.match(md, /RSI 回归/, '回归事实段');
  assert.match(md, /标普500/, '成分段');
  assert.match(md, /仅供研究参考，不构成投资建议/, '免责句（合规红线）');
});

test('buildMarkdown：周线口径、事件标注、Markdown 转义、空匹配诚实提示', () => {
  const w = UsSignals.buildMarkdown([FIX[0]], { cycle: 'weekly', period: '14', date: '', filterLabel: '全部' });
  assert.ok(w.startsWith('## 美股信号摘要（周RSI14）'), '周线 + RSI14 口径，无日期不带占位');
  assert.match(w, /周RSI14 55\.1（中性）/, '取的是周 RSI14 数值');
  assert.ok(!/break_up/.test(w), '周线口径只取 weekly.vegas（事件在日线）——周期感知提炼');
  const d = UsSignals.buildMarkdown([FIX[0]], META);
  assert.match(d, /中通道上方（break_up）/, '日线口径透出穿线事件事实键');
  const evil = [MK({ symbol: 'A*B', name: 'X_Y [Z]', rank: 1 })];
  const md = UsSignals.buildMarkdown(evil, META);
  assert.match(md, /\\\*/, 'Markdown 专用字符必须转义');
  assert.match(md, /\\_/, '下划线转义');
  const empty = UsSignals.buildMarkdown([], META);
  assert.match(empty, /共 0 只/, '空匹配计数为 0');
  assert.match(empty, /当前筛选没有匹配标的/, '空匹配诚实提示');
  assert.match(empty, /仅供研究参考，不构成投资建议/);
});

/* ============ ④ buildCSV：BOM + 固定表头 + 转义 ============ */

test('buildCSV：UTF-8 BOM 打头 + 固定 9 列表头 + CRLF 行尾', () => {
  const csv = UsSignals.buildCSV([FIX[1]], META);
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 BOM（Excel 直开不乱码）');
  assert.ok(csv.includes('代码,名称,收盘,涨跌幅,日RSI6,日RSI14,周RSI6,信号,成分'), '表头与规格逐字一致');
  assert.ok(csv.includes('\r\n'), 'CRLF 行尾');
  assert.ok(csv.includes('AAPL,苹果,349.21,-0.89,27.5,39.5,11.6,'), '数据行数值列');
  assert.ok(csv.includes('超卖 · Vegas 短通道下方 · RSI 回归,标普500'), '信号/成分列');
});

test('buildCSV：逗号/引号/换行转义 + 缺值空格', () => {
  const evil = MK({
    symbol: 'EVIL', name: 'Foo, "Inc"\n第2行', rank: 1, price: 10, changePct: 1,
    daily: { rsi6: { value: 51, state: 'neutral' }, rsi14: { value: 50, state: 'neutral' }, revert: false, vegas: [] },
  });
  const csv = UsSignals.buildCSV([evil], META);
  assert.ok(csv.includes('"Foo, ""Inc""\n第2行"'), '名称含逗号/引号/换行 → 加引号且内部引号翻倍');
  assert.ok(csv.includes('EVIL,"Foo'), '引号包裹从名称字段起效');
  const bare = UsSignals.buildCSV([MK({ symbol: 'PLAIN', rank: 1 })], META);
  assert.ok(bare.includes('PLAIN,,'), '缺名称 → 空单元格，普通名称不加引号');
  assert.ok(/50\.0,50\.0,50\.0,,(\r\n)?$/.test(bare), '无信号/成分 → 行尾连续空单元格');
});

/* ============ ⑤ renderCard 不回归 + 挂点静态钉线 ============ */

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

test('renderCard：Wave 1 协议对象口径不回归', () => {
  const html = UsSignals.renderCard(SAMPLE);
  assert.match(html, /Meridian 信号/);
  assert.match(html, /27\.5/);                       // 日 RSI6
  assert.match(html, /11\.6/);                       // 周 RSI6
  assert.match(html, /RSI 回归/);
  assert.match(html, /通道下方/);
  assert.match(html, /EMA144\/169/);
  assert.match(html, /out_up/);
  assert.match(html, /2\.4%/);
  assert.match(html, /不复权/);
  assert.match(html, /2026-11-18/);
  const evil = JSON.parse(JSON.stringify(SAMPLE));
  evil.warnings = [{ tag: '数据', text: '<img src=x onerror=alert(1)>' }];
  const guarded = UsSignals.renderCard(evil);
  assert.ok(!/<img /.test(guarded), '警告文本必须被转义');
  assert.match(guarded, /&lt;img/);
});

test('us-signals.js 源：render/bind 挂点钉线（雷达带/导出/温度条/三点矩阵）', () => {
  const js = read(path.join(SITE, 'js', 'us-signals.js'));
  assert.match(js, /buildRadar\(all, state\.watchSet \|\| \{\}, normUsKey\)/, 'render 必须调 buildRadar 提炼雷达');
  assert.match(js, /data-radar-f=/, '雷达胶囊点击锚 data-radar-f');
  assert.match(js, /\[data-radar-f\]/, 'bind 委托必须处理雷达胶囊点击');
  assert.match(js, /data-ussig-copy="1"/, '复制摘要按钮挂点');
  assert.match(js, /data-ussig-csv="1"/, '导出 CSV 按钮挂点');
  assert.match(js, /navigator\.clipboard\.writeText/, '复制走 clipboard API');
  assert.match(js, /execCommand\('copy'\)/, '复制失败回退 execCommand');
  assert.match(js, /'\\ufeff' \+ rows\.join/, 'CSV 文本以 BOM 前缀组装');
  assert.match(js, /us-signals-.*\.csv/, '下载文件名带日期戳');
  assert.match(js, /class="rsi-bar/, 'RSI 温度条已进 RSI 单元格');
  assert.match(js, /rsi-tick t30/, '30 阈值刻度竖线');
  assert.match(js, /rsi-tick t70/, '70 阈值刻度竖线');
  assert.match(js, /class="vdot/, 'Vegas 三点矩阵已进信号列');
  assert.match(js, /v-ev/, '穿线事件描边类');
  assert.match(js, /aria-hidden="true"/, '温度条为纯装饰（aria-hidden）');
  const css = read(path.join(SITE, 'css', 'ussig.css'));
  assert.match(css, /\.ussig-radar-band/, '雷达带样式');
  assert.match(css, /\.rsi-bar[\s\S]*?48px/, '温度条 48px 规格');
  assert.match(css, /\.vdot\.v-ev/, '三点矩阵事件描边样式');
  assert.match(css, /\.ussig-chips \.ussig-act/, '导出工具按钮样式');
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}, 0);
