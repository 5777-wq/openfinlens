/* polymarket.test.mjs —— 预测市场概率模型：纯离线单测（node _test/polymarket.test.mjs）
   覆盖：标题白名单闸门/黑名单/政治风险闸门/模板题拼合/二元市场解析（Gamma 的字符串编码 JSON）/
   互斥事件（negRisk）判定/占位档位与已结算档位剔除/rest 聚合/事件级选样/清洗与字段白名单/
   历史网格（bin 对齐 + 缺测为 null + 序列还原）。
   合规口径回归：产物里绝不允许出现 slug/URL/tokenId 类字段（无外链可能）。 */

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
  active: true, closed: false, archived: false, negRisk: true,
  volume: '1234567.89', volume24hr: '548087.99', liquidity: '245064.23',
  endDate: '2026-09-17T18:00:00Z', updatedAt: '2026-09-15T10:00:00Z',
  markets: [
    { id: '59001', groupItemTitle: 'No change', outcomes: '["Yes", "No"]', outcomePrices: '["0.49", "0.51"]',
      oneDayPriceChange: '0.007', volume24hr: '210000', closed: false, clobTokenIds: '["tok1", "tok2"]' },
    { id: '59002', groupItemTitle: '25 bps decrease', outcomes: '["Yes", "No"]', outcomePrices: '["0.46", "0.54"]',
      oneDayPriceChange: '-0.0042', volume24hr: '180000', closed: false, clobTokenIds: '["tok3", "tok4"]' },
    { id: '59003', groupItemTitle: '25 bps increase', outcomes: '["Yes", "No"]', outcomePrices: '["0.04", "0.96"]',
      oneDayPriceChange: '0', volume24hr: '90000', closed: false, clobTokenIds: '["tok5", "tok6"]' },
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
  { id: '600100', title: 'Russia-Ukraine ceasefire agreement in 2026?', active: true, closed: false, negRisk: false,
    volume: '900000', volume24hr: '85000', liquidity: '50000', endDate: '2026-12-31T00:00:00Z',
    markets: [{ id: '60001', outcomes: '["Yes", "No"]', outcomePrices: '["0.12", "0.88"]',
      oneDayPriceChange: '-0.01', closed: false }],
    tags: [{ id: '1', label: 'Geopolitics', slug: 'geopolitics' }, { id: '2', label: 'Ukraine', slug: 'ukraine' }] },
  { id: '600200', title: 'Republicans win 2026 House majority?', active: true, closed: false, negRisk: false,
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

await test('catOf：按标题判定类别，央行优先于选举', () => {
  assert.equal(PM.catOf('Will the Fed cut rates?'), 'central_bank');
  assert.equal(PM.catOf('Fed Decision in September?'), 'central_bank');
  assert.equal(PM.catOf('Republicans win 2026 House majority?'), 'election');
  assert.equal(PM.catOf('Russia-Ukraine ceasefire agreement in 2026?'), 'geopolitics');
  assert.equal(PM.catOf('What will WTI Crude Oil hit in October 2026?'), 'energy');
  assert.equal(PM.catOf('Will the Lakers win the NBA championship?'), null);
  assert.equal(PM.catOf(''), null);
});

await test('parseEvent：事件主体 + 档位列表，字段与量纲正确', () => {
  const e = PM.parseEvent(fedEvent);
  assert.ok(e, 'Fed 事件应入榜');
  assert.equal(e.id, 'ev:481717');
  assert.equal(e.title, 'Fed Decision in September?');
  assert.equal(e.category, 'central_bank');
  assert.equal(e.partition, true);              // negRisk → 互斥，环图成立
  assert.equal(e.outcomes.length, 3);
  assert.equal(e.outcomes[0].label, 'No change');
  assert.equal(e.outcomes[0].probability, 0.49);
  assert.equal(e.outcomes[0].change24h, 0.7);   // oneDayPriceChange 0.007 → +0.7pp
  assert.equal(e.outcomes[1].change24h, -0.4);
  assert.equal(e.outcomes[0].q, 'Fed Decision in September? · No change');
  assert.equal(e.volume24hr, 548088);
  assert.equal(e.endDate, Date.parse('2026-09-17T18:00:00Z'));
  assert.equal(e.outcomeCount, 3);
});

await test('composeQuestion：模板题把档位填回省略号，拼不出就不收录', () => {
  assert.equal(PM.composeQuestion('US-Iran ceasefire continues through...?', 'October 31'),
    'US-Iran ceasefire continues through October 31?');
  assert.equal(PM.composeQuestion('Fed Decision in September?', 'No change'),
    'Fed Decision in September? · No change');
  assert.equal(PM.composeQuestion('Plain title question?', 'Yes'), 'Plain title question?');
  // 档位没给出关键信息（只有 Yes）→ 拼不出完整问句
  assert.equal(PM.composeQuestion('Israel closes its airspace by...?', 'Yes'), null);
  assert.equal(PM.titleStem('US-Iran ceasefire continues through...?'), 'US-Iran ceasefire continues through');
  assert.equal(PM.titleStem('Fed Decision in September?'), 'Fed Decision in September?');
});

await test('parseEvent：模板题事件不再被整族误杀（省略号被档位填回）', () => {
  const ev = {
    id: '700100', title: 'US-Iran ceasefire continues through...?', active: true, closed: false, negRisk: false,
    volume: '500000', volume24hr: '50000',
    markets: [
      { id: '70001', groupItemTitle: 'September 20', outcomes: '["Yes", "No"]', outcomePrices: '["0.97", "0.03"]', closed: false },
      { id: '70002', groupItemTitle: 'September 25', outcomes: '["Yes", "No"]', outcomePrices: '["0.83", "0.17"]', closed: false },
      { id: '70003', groupItemTitle: 'October 31', outcomes: '["Yes", "No"]', outcomePrices: '["0.61", "0.39"]', closed: false },
    ],
    tags: [{ id: '1', label: 'Geopolitics', slug: 'geopolitics' }],
  };
  const e = PM.parseEvent(ev);
  assert.ok(e, '停火族事件应入榜');
  assert.equal(e.outcomes.length, 3);
  assert.equal(e.outcomes[0].q, 'US-Iran ceasefire continues through September 20?');
  assert.ok(!e.outcomes.some(o => /\.\.\.|…/.test(o.q)), '问句里不允许残留省略号');
  assert.equal(e.stem, 'US-Iran ceasefire continues through');
  // 单市场题原文自带省略号且无档名可填 → 关键信息缺失，不收录
  const lone = PM.parseEvent({
    id: '700200', title: 'Israel closes its airspace by...?', active: true, closed: false,
    volume: '300000', volume24hr: '20000',
    markets: [{ id: '70004', outcomes: '["Yes", "No"]', outcomePrices: '["0.1", "0.9"]', closed: false }],
    tags: [{ id: '2', label: 'Israel', slug: 'israel' }],
  });
  assert.equal(lone, null);
});

await test('标题白名单闸门：只挂宽标签的杂题进不来（外星人/电竞/中国台湾）', () => {
  const mk = (id, title, extra) => ({
    id, title, active: true, closed: false, negRisk: false,
    volume: '900000', volume24hr: '85000', liquidity: '50000',
    markets: [{ id: 'm' + id, outcomes: '["Yes", "No"]', outcomePrices: '["0.3", "0.7"]', closed: false }],
    tags: [{ id: '9', label: 'Politics', slug: 'politics' }],
    ...(extra || {}),
  });
  // 标题完全不沾类别，只靠 Politics 标签混进来 —— 必须拒
  assert.equal(PM.parseEvent(mk('700001', 'Will the US confirm that aliens exist by December 31?')), null);
  assert.equal(PM.parseEvent(mk('700002', 'Dota 2: Team Resilience vs Xtreme Gaming (BO3) - BLAST Slam China Closed Qualifier')), null);
  // 政治风险闸门：中国主权/领导人/台湾
  assert.equal(PM.parseEvent(mk('700003', 'Will China invade Taiwan by end of 2026?')), null);
  assert.equal(PM.parseEvent(mk('700004', 'Xi Jinping out before 2027?')), null);
  // 正常地缘问句照常入榜
  assert.ok(PM.parseEvent(mk('700005', 'Will the US open a dialogue with Iran this year?')), '地缘问句应入榜');
});

await test('黑名单：US Open 专名大小写敏感，"the US open + 动词"不误杀（20260921）', () => {
  const mk = (id, title) => ({
    id, title, active: true, closed: false, negRisk: false,
    volume: '900000', volume24hr: '85000', liquidity: '50000',
    markets: [{ id: 'm' + id, outcomes: '["Yes", "No"]', outcomePrices: '["0.3", "0.7"]', closed: false }],
    tags: [{ id: '9', label: 'Geopolitics', slug: 'geopolitics' }],
  });
  assert.equal(PM.parseEvent(mk('700001', 'Will Alcaraz win the US Open this year?')), null);
  assert.ok(PM.parseEvent(mk('700002', 'Will the US open a dialogue with Iran this year?')));
});

await test('档位卫生：占位槽位、已结算档位剔除，概率质量进 rest 不消失', () => {
  const ev = {
    id: '800100', title: 'Balance of Power: 2026 Midterms', active: true, closed: false, negRisk: true,
    volume: '900000', volume24hr: '85000',
    markets: [
      { id: '80001', groupItemTitle: 'Democrats Sweep', outcomes: '["Yes", "No"]', outcomePrices: '["0.625", "0.375"]', closed: false, volume24hr: '90000' },
      { id: '80002', groupItemTitle: 'R Senate, D House', outcomes: '["Yes", "No"]', outcomePrices: '["0.275", "0.725"]', closed: false, volume24hr: '70000' },
      { id: '80003', groupItemTitle: 'Republicans Sweep', outcomes: '["Yes", "No"]', outcomePrices: '["0.085", "0.915"]', closed: false, volume24hr: '50000' },
      { id: '80004', groupItemTitle: 'Other', outcomes: '["Yes", "No"]', outcomePrices: '["0.0015", "0.9985"]', closed: false, volume24hr: '10000' },
      { id: '80005', groupItemTitle: 'Person ZZZ', outcomes: '["Yes", "No"]', outcomePrices: '["0.5", "0.5"]', closed: false, volume24hr: '0', liquidity: '0' },
      { id: '80006', groupItemTitle: 'Ghost', outcomes: '["Yes", "No"]', outcomePrices: '["0", "1"]', closed: false, volume24hr: '5' },
    ],
    tags: [{ id: '1', label: 'Midterms', slug: 'midterms' }],
  };
  const e = PM.parseEvent(ev);
  assert.ok(e);
  assert.equal(e.partition, true);
  const labels = e.outcomes.map(o => o.label);
  assert.ok(!labels.includes('Person ZZZ'), '零成交零流动性的占位槽位要剔除');
  assert.ok(!labels.includes('Ghost'), 'p=0 的已结算档位要剔除');
  // 档位合计（含 rest）应守恒在 1 附近
  const sum = e.outcomes.reduce((s, o) => s + o.probability, 0) + e.rest.probability;
  assert.ok(Math.abs(sum - 1) < 0.02, `概率和应≈1，实际 ${sum}`);
});

await test('normalize：事件级选样（不拦腰截断一个事件）、去重、cap', () => {
  const evs = PM.normalize(events, 20);
  const ids = evs.map(e => e.id).join('|');
  assert.equal(ids, 'ev:481717|ev:600100|ev:600200');
  assert.equal(evs[0].category, 'central_bank');
  assert.equal(evs[1].category, 'geopolitics');
  assert.equal(evs[2].category, 'election');
  assert.ok(evs[0].volume24hr >= evs[1].volume24hr && evs[1].volume24hr >= evs[2].volume24hr);
  // 去重：同标题只留一条
  const dup = JSON.parse(JSON.stringify(events));
  dup.push({ ...fedEvent, id: '481718', markets: [{ ...fedEvent.markets[0], id: '59009' }] });
  assert.equal(PM.normalize(dup, 10).length, 3);
  // cap 按事件数截断
  assert.equal(PM.normalize(dup, 2).length, 2);
});

await test('sanitizeEvent：坏档位剔除、字段白名单、rest 归一', () => {
  const clean = PM.sanitizeEvent({
    id: 'x', title: 'Fed Decision in October?', category: 'central_bank', partition: true,
    volume24hr: '1000', outcomes: [
      { id: 'a', label: 'No change', probability: 0.8, change24h: 1 },
      { id: 'b', label: 'Bad', probability: 1.5 },                      // 概率越界 → 剔
      { id: 'c', label: '   ', probability: 0.1 },                       // 空档名 → 剔
      { id: 'd', label: 'Ellipsis...', probability: 0.1 },               // 拼不出问句 → 剔
    ],
    rest: { probability: '0.2', count: '3' },
  });
  assert.equal(clean.outcomes.length, 1);
  assert.equal(clean.outcomes[0].probability, 0.8);
  assert.equal(clean.rest.probability, 0.2);
  assert.equal(clean.rest.count, 3);
  assert.equal(clean.partition, true);
  assert.equal(PM.sanitizeEvent(null), null);
  assert.equal(PM.sanitizeEvent({ title: 'X', category: 'sports' }), null);
  assert.equal(PM.sanitizeEvents(null).length, 0);
  assert.equal(PM.sanitizeEvents('junk').length, 0);
});

await test('合规回归：产物只有白名单字段，绝无 slug/URL/tokenId/交易入口', () => {
  const clean = PM.sanitizeEvents(PM.normalize(events));
  const EV_ALLOW = new Set(['id', 'title', 'stem', 'titleZh', 'stemZh', 'category', 'partition',
    'volume24hr', 'liquidity', 'endDate', 'updatedAt', 'outcomes', 'rest', 'outcomeCount']);
  const OUT_ALLOW = new Set(['id', 'label', 'q', 'labelZh', 'probability', 'change24h',
    'volume24hr', 'liquidity']);
  clean.forEach(e => {
    Object.keys(e).forEach(k => assert.ok(EV_ALLOW.has(k), `事件出现越界字段 ${k}`));
    e.outcomes.forEach(o => {
      Object.keys(o).forEach(k => assert.ok(OUT_ALLOW.has(k), `档位出现越界字段 ${k}`));
    });
    const s = JSON.stringify(e);
    assert.ok(!/slug|https?:|tokenid|clobtoken|outcomeprices/i.test(s), '产物里不允许出现链接或交易标识');
  });
  // 原始解析结果里的 tokenId 只在内存里给采集端用，绝不能进产物
  const raw = PM.normalize(events);
  assert.ok(raw[0].outcomes[0].tokenId === 'tok1', '采集侧应能拿到 tokenId 用于回填历史');
  assert.ok(!/tokenId/.test(JSON.stringify(PM.sanitizeEvents(raw))), '清洗后必须剥掉 tokenId');
});

await test('groupByCategory：按类别分区，区内按 24h 成交降序', () => {
  const groups = PM.groupByCategory(PM.sanitizeEvents(PM.normalize(events)));
  const cats = groups.map(g => g.cat);
  assert.ok(cats.includes('central_bank') && cats.includes('geopolitics') && cats.includes('election'));
  assert.equal(groups[0].cat, 'central_bank');   // 成交最高（548088）
});

await test('历史网格：4h 对齐、缺测为 null、序列还原丢弃空洞', () => {
  const now = 1792400000000;
  const bin = PM.HIST_BIN_MS;
  // 先建网格拿到 from，再用 from 定位点位（from 由 now 推算，测试不假设它的具体值）
  const grid0 = PM.buildHistoryGrid([], now, bin, 6);
  const from = grid0.from;
  const grid = PM.buildHistoryGrid([
    { id: 'pm:1', points: [[(from + bin) / 1000, 0.5], [(from + 3 * bin) / 1000, 0.7]] },
    { id: 'pm:2', points: [[(from + 2 * bin) / 1000, 0.25]] },
  ], now, bin, 6);
  assert.equal(grid.binMs, bin);
  assert.equal(grid.count, 6);
  assert.equal(grid.from % bin, 0, '网格起点必须对齐绝对时间轴');
  assert.equal(grid.series['pm:1'][0], null, '缺测格必须是 null 而不是 0');
  assert.equal(grid.series['pm:1'][1], 500, '概率按 ×1000 存整数');
  assert.equal(grid.series['pm:1'][3], 700);
  assert.equal(grid.series['pm:2'][2], 250);
  // 还原：null 直接丢掉，剩下点的时间戳由 from + i*bin 还原
  const s = PM.seriesFromGrid(grid, 'pm:1');
  assert.equal(s.length, 2);
  assert.equal(s[0].t, from + bin);
  assert.equal(s[0].p, 0.5);
  assert.equal(s[1].p, 0.7);
  assert.equal(PM.seriesFromGrid(grid, 'pm:nope').length, 0);
  assert.equal(PM.seriesFromGrid(null, 'pm:1').length, 0);
  // 越界点（超出窗口）不进网格
  const g2 = PM.buildHistoryGrid([{ id: 'pm:x', points: [[(now + 999 * 3600 * 1000) / 1000, 0.5]] }], now, bin, 6);
  assert.ok(g2.series['pm:x'].every(v => v === null));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
