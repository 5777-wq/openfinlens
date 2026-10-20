/* pmview.test.mjs —— 市场预测面板视图层：纯离线单测（node _test/pmview.test.mjs）
   覆盖：类别分布总览环图 / 互斥事件出环图 + 独立事件不出环图 / 档位行与"其他 N 项"/
   概率走势跟的是选中的档位（切换选择要换序列）/ 无历史时诚实空态 / 折叠按钮 /
   合规回归：渲染结果里不出现任何链接。
   这一层是"数据 → HTML"的确定性映射，结构错了界面上不会报错、只会画错。 */

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

/* 三个模块共用一个沙箱（视图层要用到模型层与几何层） */
const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, RegExp, Set, Map, JSON });
ctx.window = ctx; ctx.globalThis = ctx;
for (const f of ['js/polymarket.js', 'js/pmcharts.js', 'js/pmview.js']) {
  vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const PM = ctx.window.Polymarket;
const V = ctx.window.PMView;

const META = PM.CAT_META;

/* 两个事件：一个互斥（negRisk，能画环图），一个独立问句（画环图就是范畴错误） */
const partitionEvent = {
  id: 'ev:1', title: 'Fed Decision in October?', stem: 'Fed Decision in October?',
  titleZh: '美联储10月决议？', category: 'central_bank', partition: true,
  volume24hr: 3907906, liquidity: 6155497, endDate: 1793246340000, updatedAt: 1792305086462,
  outcomes: [
    { id: 'pm:1', label: 'No change', q: 'Fed Decision in October? · No change', labelZh: '维持不变', probability: 0.845, change24h: -3, volume24hr: 200000, liquidity: 1000 },
    { id: 'pm:2', label: '25 bps increase', q: 'Fed Decision in October? · 25 bps increase', labelZh: '加息25个基点', probability: 0.145, change24h: 2, volume24hr: 90000, liquidity: 900 },
    { id: 'pm:3', label: '25 bps decrease', q: 'Fed Decision in October? · 25 bps decrease', labelZh: '降息25个基点', probability: 0.008, change24h: 0.1, volume24hr: 5000, liquidity: 50 },
  ],
  rest: { probability: 0.002, count: 2 },
  outcomeCount: 5,
};

const independentEvent = {
  id: 'ev:2', title: 'US-Iran ceasefire continues through...?', stem: 'US-Iran ceasefire continues through',
  titleZh: '美伊停火持续到…', category: 'geopolitics', partition: false,
  volume24hr: 1156925, liquidity: 1012142, endDate: 1793491140000, updatedAt: 1792305086462,
  outcomes: [
    { id: 'pm:4', label: 'October 22', q: 'US-Iran ceasefire continues through October 22?', probability: 0.906, change24h: 2.9, volume24hr: 80000, liquidity: 100 },
    { id: 'pm:5', label: 'October 24', q: 'US-Iran ceasefire continues through October 24?', probability: 0.87, change24h: 4, volume24hr: 70000, liquidity: 90 },
  ],
  rest: { probability: 1.9, count: 7 },
  outcomeCount: 9,
};

await test('overviewHTML：类别分布环图 + 图例 + 互斥/独立事件计数', () => {
  const html = V.overviewHTML([partitionEvent, independentEvent]);
  assert.match(html, /pm-donut/, '总览应有环图');
  assert.match(html, /pm-ov-leg/, '应有图例');
  assert.match(html, /央行/, '图例应出现类别中文名');
  assert.match(html, /1 个互斥事件可看档位分布环图/, '应说明哪些事件能看环图');
  assert.match(html, /1 个独立问句事件只给概率条/);
  assert.equal(V.overviewHTML([]), '', '空列表不画总览');
});

await test('cardHTML（互斥事件）：有环图，档位行带真实报价，"其他 N 项"单列', () => {
  const html = V.cardHTML(partitionEvent, META.central_bank, {});
  assert.match(html, /pm-donut/, '互斥事件应出环图');
  assert.match(html, /class="pm-out[^"]*"/, '应有档位行');
  assert.match(html, /维持不变/, '优先展示中文档位名');
  assert.match(html, />85%</, '图例数字是真实报价（84.5% → 85%）');
  assert.match(html, /其他 2 项/, '未展开档位要单列');
  assert.match(html, /互斥档位/, '应标注档位互斥');
  assert.match(html, /pm-trend/);
});

await test('cardHTML（独立问句事件）：不出环图，标"不可相加"', () => {
  const html = V.cardHTML(independentEvent, META.geopolitics, {});
  assert.ok(!/pm-donut/.test(html), '独立问句事件绝不能画环图（暗示了不存在的互斥关系）');
  assert.match(html, /独立问句/);
  assert.match(html, /不可相加/, '各问句概率不可加总，必须说清');
  assert.ok(!/pm-viz/.test(html));
});

await test('cardHTML：走势图跟的是选中的档位，切选择就换序列', () => {
  const bin = PM.HIST_BIN_MS;
  const from = 1792400000000 - 6 * bin;
  const grid = {
    binMs: bin, from, count: 6,
    series: { 'pm:1': [800, 820, 840, 845, 845, 845], 'pm:2': [100, 110, 130, 140, 145, 145] },
  };
  const a = V.cardHTML(partitionEvent, META.central_bank, { history: grid, sel: { 'ev:1': 'pm:1' } });
  const b = V.cardHTML(partitionEvent, META.central_bank, { history: grid, sel: { 'ev:1': 'pm:2' } });
  assert.match(a, /pm-trend-line/, '有历史应画走势线');
  assert.match(a, /80\.0% ~ 84\.5%/, '纵轴范围应取所选档位的历史高低点');
  assert.match(b, /10\.0% ~ 14\.5%/, '切到别的档位，范围要跟着换');
  assert.match(a, /pm-trend-cur[^>]*>维持不变</, '标题应显示当前跟的是哪个档位');
  assert.match(b, /pm-trend-cur[^>]*>加息25个基点</);
  // 选中的那一行要带 .on
  assert.match(a, /class="pm-out on"[^>]*data-pmout="pm:1"/);
  assert.match(b, /class="pm-out on"[^>]*data-pmout="pm:2"/);
});

await test('cardHTML：没有历史序列时给诚实空态，不画假线', () => {
  const html = V.cardHTML(partitionEvent, META.central_bank, { history: null });
  assert.ok(!/pm-trend-line/.test(html), '没有历史不能画线');
  assert.match(html, /pm-trend-empty/, '应显示空态说明');
  assert.match(html, /历史序列积累中/);
});

await test('sectionsHTML：按分类分区，超过 6 个出折叠按钮', () => {
  const many = [];
  for (let i = 0; i < 8; i++) {
    many.push({ ...partitionEvent, id: 'ev:x' + i, title: 'Event ' + i, stem: 'Event ' + i, titleZh: null });
  }
  const groups = PM.groupByCategory(many);
  const html = V.sectionsHTML(groups, {});
  assert.match(html, /pm-sec-head/, '应有分类头');
  assert.match(html, /展开其余 2 个事件/, '超过 6 个要能展开');
  assert.match(html, /pm-cards/, '卡片容器');
  // 展开态
  const open = V.sectionsHTML(groups, { expand: { central_bank: true } });
  assert.match(open, /收起/, '展开后按钮变成收起');
  assert.equal((open.match(/class="pm-card"/g) || []).length, 8, '展开后 8 张卡都在');
});

await test('cardHTML：概率条与走势线跟档位同色（图例↔扇区↔条↔线一个色）', () => {
  const bin = PM.HIST_BIN_MS;
  const from = 1792400000000 - 6 * bin;
  const grid = { binMs: bin, from, count: 6, series: { 'pm:1': [800, 820, 840, 845, 845, 845] } };
  const html = V.cardHTML(partitionEvent, META.central_bank, { history: grid, sel: { 'ev:1': 'pm:1' } });
  const C = ctx.window.PMCharts;
  // 第一档的色 = 调色板第 0 号
  assert.match(html, new RegExp(`--pm-bar-c:${C.PALETTE[0]}`), '概率条应取档位色');
  assert.match(html, new RegExp(`--pm-trend-c:${C.PALETTE[0]}`), '走势线应取当前档位色');
  // 切到第二档，走势线必须换成第二档的颜色
  const html2 = V.cardHTML(partitionEvent, META.central_bank, { history: grid, sel: { 'ev:1': 'pm:2' } });
  assert.match(html2, new RegExp(`--pm-trend-c:${C.PALETTE[1]}`), '切换档位后走势线换色');
  // 概率条不能借用主题强调色（Swiss 主题的强调色是红的，红/绿在本项目是涨跌语义）
  assert.ok(!/--pm-bar-c:var\(--accent/.test(html), '概率条不得用主题强调色');
  assert.ok(!/--pm-trend-c:var\(--accent/.test(html), '走势线不得用主题强调色');
});

await test('合规回归：渲染结果里不出现任何链接/交易入口', () => {
  const html = V.cardHTML(partitionEvent, META.central_bank, {}) + V.overviewHTML([partitionEvent]);
  assert.ok(!/https?:|slug|polymarket\.com|clob/i.test(html), '渲染结果里不允许出现链接或平台名');
});

await test('真实产物：polymarket.json 渲染出环图 + 档位行 + 走势图', () => {
  const f = path.join(ROOT, 'data/events/polymarket.json');
  if (!readFileSync) return;
  let d;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { console.log('   （产物尚未生成，跳过）'); return; }
  const events = PM.sanitizeEvents(d.events);
  assert.ok(events.length > 0, '产物应有事件');
  const groups = PM.groupByCategory(events);
  const html = V.sectionsHTML(groups, {});
  assert.match(html, /pm-donut/, '真实数据里应有互斥事件出环图');
  assert.match(html, /pm-out/, '应有档位行');
  assert.match(html, /pm-trend/, '应有走势区');
  // 独立事件必须一条环图都没有（逐个断言，不能只看整体）
  const indep = events.filter(e => !e.partition);
  indep.forEach(e => {
    const h = V.cardHTML(e, PM.CAT_META[e.category], {});
    assert.ok(!/pm-donut/.test(h), `独立事件「${e.title}」不该有环图`);
  });
});
