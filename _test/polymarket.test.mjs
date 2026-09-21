/* polymarket.test.mjs —— 预测市场概率模型：纯离线单测（node _test/polymarket.test.mjs）
   覆盖：类别白名单/黑名单闸门 / 二元市场解析（Gamma 的字符串编码 JSON）/
   多结果事件取前两档 / 量级门槛 / normalize 排序与去重 / sanitize 防御性清洗。
   合规口径回归：产物行里绝不允许出现 slug/URL 类字段（无外链可能）。 */

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

const PM = loadModule('js/polymarket.js', 'Polymarket');

/* 真实 Gamma /events 形状的 fixture（字段名与字符串编码与线上接口一致） */
const fedEvent = {
  id: '481717', slug: 'fed-decision-in-september-762', title: 'Fed Decision in September?',
  active: true, closed: false, archived: false,
  volume: '1234567.89', volume24hr: '548087.99', liquidity: '245064.23',
  endDate: '2026-09-17T18:00:00Z', updatedAt: '2026-09-15T10:00:00Z',
  markets: [
    { id: '59001', groupItemTitle: 'No change', outcomes: '["Yes", "No"]', outcomePrices: '["0.49", "0.51"]',
      oneDayPriceChange: '0.007', volume24hr: '210000', closed: false },
    { id: '59002', groupItemTitle: '25 bps decrease', outcomes: '["Yes", "No"]', outcomePrices: '["0.46", "0.54"]',
      oneDayPriceChange: '-0.0042', volume24hr: '180000', closed: false },
    { id: '59003', groupItemTitle: '25 bps increase', outcomes: '["Yes", "No"]', outcomePrices: '["0.04", "0.96"]',
      oneDayPriceChange: '0', volume24hr: '90000', closed: false },
  ],
  tags: [
    { id: '100633', label: 'Fed Rates', slug: 'fed-rates' },
    { id: '100637', label: 'FOMC', slug: 'fomc' },
    { id: '100755', label: 'Economic Policy', slug: 'economic-policy' },
    { id: '100081', label: 'Jerome Powell', slug: 'jerome-powell' },
    { id: '100105', label: 'Politics', slug: 'politics' },
  ],
};

const events = [
  fedEvent,
  { id: '600100', title: 'Russia-Ukraine ceasefire agreement in 2026?', active: true, closed: false,
    volume: '900000', volume24hr: '85000', liquidity: '50000', endDate: '2026-12-31T00:00:00Z',
    markets: [{ id: '60001', outcomes: '["Yes", "No"]', outcomePrices: '["0.12", "0.88"]',
      oneDayPriceChange: '-0.01', closed: false }],
    tags: [{ id: '1', label: 'Geopolitics', slug: 'geopolitics' }, { id: '2', label: 'Ukraine', slug: 'ukraine' }] },
  { id: '600200', title: 'Republicans win 2026 House majority?', active: true, closed: false,
    volume: '400000', volume24hr: '42000', liquidity: '80000',
    markets: [{ id: '60002', outcomes: '["Yes", "No"]', outcomePrices: '["0.62", "0.38"]',
      oneDayPriceChange: '0.003', closed: false }],
    tags: [{ id: '3', label: 'Elections', slug: 'elections' }, { id: '4', label: 'US Politics', slug: 'us-politics' }] },
  // 以下都是必须被闸门拦掉的
  { id: '600300', title: 'Will the Lakers win the NBA championship?', active: true, closed: false,
    volume: '5000000', volume24hr: '900000',
    markets: [{ id: '60003', outcomes: '["Yes", "No"]', outcomePrices: '["0.3", "0.7"]', closed: false }],
    tags: [{ id: '5', label: 'Sports', slug: 'sports' }] },
  { id: '600400', title: 'Bitcoin above $200K in 2026?', active: true, closed: false,
    volume: '8000000', volume24hr: '700000',
    markets: [{ id: '60004', outcomes: '["Yes", "No"]', outcomePrices: '["0.25", "0.75"]', closed: false }],
    tags: [{ id: '6', label: 'Crypto', slug: 'crypto' }] },
  { id: '600500', title: 'Will Trump post on X about the Fed this week?', active: true, closed: false,
    volume: '300000', volume24hr: '15000',
    markets: [{ id: '60005', outcomes: '["Yes", "No"]', outcomePrices: '["0.4", "0.6"]', closed: false }],
    tags: [{ id: '7', label: 'Politics', slug: 'politics' }] },
  { id: '600600', title: 'Will OPEC announce production cut in Q4?', active: true, closed: false,
    volume: '30000', volume24hr: '500',
    markets: [{ id: '60006', outcomes: '["Yes", "No"]', outcomePrices: '["0.55", "0.45"]', closed: false }],
    tags: [{ id: '8', label: 'Oil', slug: 'oil' }] },
  { id: '600700', title: 'US CPI YoY for September 2026?', active: true, closed: false,
    volume: '200000', volume24hr: '10000',
    markets: [{ id: '60007', outcomes: '["Over 3.0%", "2.5-3.0%", "Under 2.5%"]',
      outcomePrices: '["0.1", "0.6", "0.3"]', closed: false }],
    tags: [{ id: '9', label: 'CPI Release', slug: 'cpi-release' }] },
  { id: '600800', title: 'Resolved old event', active: true, closed: true, volume: '999999',
    markets: [{ id: '60008', outcomes: '["Yes", "No"]', outcomePrices: '["1", "0"]', closed: false }],
    tags: [{ id: '10', label: 'Economy', slug: 'economy' }] },
];

await test('catOf：标签命中白名单，优先级央行 > 选举（Fed 问题同时挂 Politics）', () => {
  assert.equal(PM.catOf('fomc fed-rates economic-policy politics'), 'central_bank');
  assert.equal(PM.catOf('politics us-politics elections'), 'election');
  assert.equal(PM.catOf('sports crypto'), null);
  assert.equal(PM.catOf(''), null);
  assert.equal(PM.catOf('Will the Fed cut rates?'), 'central_bank');   // 标题兜底也走同一份规则
});

await test('rowsForEvent：多结果事件只取概率前两档，问题 = 标题 · 档名', () => {
  const rows = PM.rowsForEvent(fedEvent);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].question, 'Fed Decision in September? · No change');
  assert.equal(rows[1].question, 'Fed Decision in September? · 25 bps decrease');
  assert.equal(rows[0].probability, 0.49);
  assert.equal(rows[0].category, 'central_bank');
  assert.equal(rows[0].change24h, 0.7);          // oneDayPriceChange 0.007 → +0.7pp
  assert.equal(rows[1].change24h, -0.4);         // -0.0042 → -0.4pp
  assert.equal(rows[0].volume24hr, 548088);
  assert.ok(rows[0].id.startsWith('pm:59001'));
  assert.equal(rows[0].endDate, Date.parse('2026-09-17T18:00:00Z'));
});

await test('rowsForEvent：模板题省略号填档名合成完整问句（不再出现"..."）', () => {
  const ev = {
    id: '700100', title: 'US-Iran ceasefire continues through...?', active: true, closed: false,
    volume: '500000', volume24hr: '50000',
    markets: [
      { id: '70001', groupItemTitle: 'September 20', outcomes: '["Yes", "No"]', outcomePrices: '["0.97", "0.03"]', closed: false },
      { id: '70002', groupItemTitle: 'September 25', outcomes: '["Yes", "No"]', outcomePrices: '["0.83", "0.17"]', closed: false },
      { id: '70003', groupItemTitle: 'October 31', outcomes: '["Yes", "No"]', outcomePrices: '["0.61", "0.39"]', closed: false },
    ],
    tags: [{ id: '1', label: 'Geopolitics', slug: 'geopolitics' }],
  };
  const rows = PM.rowsForEvent(ev);
  assert.equal(rows.length, 2);
  // "…continues through...?" + "September 20" → "continues through September 20?"（前两档按概率取）
  assert.equal(rows[0].question, 'US-Iran ceasefire continues through September 20?');
  assert.equal(rows[1].question, 'US-Iran ceasefire continues through September 25?');
  assert.ok(!rows.some(r => /\.\.\.|…/.test(r.question)), '问句里不允许残留省略号');
  // 无省略号的模板题仍走"标题 · 档名"
  const fed = PM.rowsForEvent(fedEvent);
  assert.equal(fed[0].question, 'Fed Decision in September? · No change');
  // 单市场题原文自带省略号且无档名可填 → 关键信息缺失，整行不收录
  const lone = PM.rowsForEvent({
    id: '700200', title: 'Israel closes its airspace by...?', active: true, closed: false,
    volume: '300000', volume24hr: '20000',
    markets: [{ id: '70004', outcomes: '["Yes", "No"]', outcomePrices: '["0.1", "0.9"]', closed: false }],
    tags: [{ id: '2', label: 'Israel', slug: 'israel' }],
  });
  assert.equal(lone.length, 0);
});

await test('rowsForEvent：单市场事件一行、黑名单/量级/非二元/已关闭全拦下', () => {
  const rows = PM.normalize(events, 20);
  // 保留：Fed×2（548088）→ 乌克兰停火（85000）→ 众议院（42000）
  // join 比较：vm 沙箱 realm 的数组原型与宿主不同，deepStrictEqual 会误判"同构不引用相等"
  assert.equal(rows.map(r => r.id).join('|'), 'pm:59001|pm:59002|pm:60001|pm:60002');
  assert.equal(rows[2].category, 'geopolitics');
  assert.equal(rows[3].category, 'election');
  assert.equal(rows[2].question, 'Russia-Ukraine ceasefire agreement in 2026?');
  // 按 24h 热度降序
  assert.ok(rows[0].volume24hr >= rows[2].volume24hr && rows[2].volume24hr >= rows[3].volume24hr);
});

await test('normalize：去重、cap 截断、closed/archived 事件剔除', () => {
  const dup = JSON.parse(JSON.stringify(events));
  dup.push({ ...fedEvent, id: '481718', markets: [{ ...fedEvent.markets[0], id: '59009' }] });
  const rows = PM.normalize(dup, 3);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.probability >= 0 && r.probability <= 1));
});

await test('合规回归：产物行只有白名单字段，绝无 slug/URL/交易入口', () => {
  const rows = PM.normalize(events);
  const ALLOW = new Set(['id', 'question', 'questionZh', 'category', 'probability', 'change24h', 'volume24hr', 'liquidity', 'endDate', 'updatedAt']);
  rows.forEach(r => {
    Object.keys(r).forEach(k => assert.ok(ALLOW.has(k), `行出现越界字段 ${k}`));
    assert.ok(!/slughref|https?:/i.test(JSON.stringify(r)), '行里不允许出现链接');
  });
});

await test('黑名单：US Open 专名大小写敏感，"the US open + 动词"不误杀（20260921）', () => {
  const mk = (id, title) => ({
    id, title, active: true, closed: false,
    volume: '900000', volume24hr: '85000', liquidity: '50000',
    markets: [{ id: 'm' + id, outcomes: '["Yes", "No"]', outcomePrices: '["0.3", "0.7"]', closed: false }],
    tags: [{ id: '9', label: 'Geopolitics', slug: 'geopolitics' }],
  });
  // 体育赛事专名（两词都大写）仍拦
  assert.equal(PM.rowsForEvent(mk('700001', 'Will Alcaraz win the US Open this year?')).length, 0);
  // 小写动词 open 的地缘问句不得被 "us open" 误杀
  assert.equal(PM.rowsForEvent(mk('700002', 'Will the US open a dialogue with Iran this year?')).length, 1);
});

await test('sanitize：坏行剔除（无问题/概率越界/类别非法）、排序、cap', () => {
  const raw = [
    { id: 'a', question: 'Q1', questionZh: '问题一', category: 'macro', probability: 0.5, volume24hr: 100 },
    { id: 'b', question: '   ', category: 'macro', probability: 0.5 },          // 空问题 → 剔
    { id: 'c', question: 'Q3', category: 'macro', probability: 1.5 },           // 概率越界 → 剔
    { id: 'd', question: 'Q4', category: 'sports', probability: 0.3 },          // 类别非法 → 剔
    { question: 'Q5', category: 'trade', probability: '0.22', volume24hr: '900' },
    { id: 'e', question: '以...?', questionZh: '以……？', category: 'macro', probability: 0.4, volume24hr: 500 }, // 省略号 → 剔
    { id: 'f', question: 'Q6', questionZh: 'Q6', category: 'energy', probability: 0.1, volume24hr: 9999 },
  ];
  const rows = PM.sanitize(raw, 4);
  // 按 24h 热度取前 2：f(9999) > 无 id 的 Q5 行(900，问题键兜底 id) > a(100)
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'f');
  assert.equal(rows[0].questionZh, null);        // 中文与原文相同 → 不算翻译，置 null
  assert.equal(rows[1].id, 'pm:q5');
  assert.equal(rows[2].questionZh, '问题一');     // 有效中文标题透传
  assert.equal(rows[1].probability, 0.22);       // 字符串数值也接受
  assert.equal(PM.sanitize(null).length, 0);
  assert.equal(PM.sanitize('junk').length, 0);
});
