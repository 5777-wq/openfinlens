/* engine 引擎测试：新闻标准化 / 去重 / 分类 / 地理编码 / 事件聚类 / AI 闸门 / 影响边
   覆盖 directive 的验收用例：
   - 伊朗四家外媒四条报道 → 聚为 1 个 Event（newsIds=4）
   - URL 去重、标题相似度去重
   - "日本央行加息" → central_bank 类 → JPY↑/JGB↑/Nikkei↓ 影响链，证据分级 DATA/CORRELATION
   - AI 闸门：低置信事件 needsAiReview；闸门/缓存/并发
   用法：node _test/engine.test.mjs */

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

function makeCtx() {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, RegExp, Set, Map, isNaN, isFinite, Promise, Error, JSON });
  ctx.window = ctx; ctx.globalThis = ctx;
  return ctx;
}
const ctx = makeCtx();
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
load('js/engine/types.js');
load('js/engine/geo.js');
load('js/engine/news-engine.js');
load('js/engine/event-engine.js');
load('js/engine/llm-provider.js');
load('js/engine/impact-engine.js');
load('js/engine/mock-data.js');
const W = vm.runInContext('window', ctx);
const NOW = Date.UTC(2026, 8, 10, 12);   // 固定"当前时间"消除状态机抖动

/* ================= 标准化与分类 ================= */

await test('normalizeNews：字段标准化、分类、地理编码一次完成', () => {
  const n = W.NewsEngine.normalizeNews({ title: '日本央行加息25个基点', url: 'https://x/n1', source: 'Nikkei', publishedAt: '2026-09-10T01:00:00Z' });
  assert.equal(n.category, 'central_bank');
  assert.equal(n.country, 'JP');
  assert.equal(n.source, 'nikkei');
  assert.equal(n.publishedAt, Date.UTC(2026, 8, 10, 1));
  assert.equal(n.id.length > 0, true);
});

await test('normalizeNews：无标题/无时间 → null（宁缺毋假）', () => {
  assert.equal(W.NewsEngine.normalizeNews({ title: '', url: 'x', publishedAt: 1 }), null);
  assert.equal(W.NewsEngine.normalizeNews({ title: 't', url: 'x', publishedAt: 'not-a-date' }), null);
});

await test('classify：12 类规则命中抽查', () => {
  const cases = [
    ['俄乌边境爆发激烈炮击', 'war'],
    ['美联储FOMC宣布加息25基点', 'central_bank'],
    ['美国宣布对芯片设备实施出口管制', 'trade'],
    ['土耳其7.8级地震造成大范围破坏', 'natural_disaster'],
    ['国际油价突破100美元 OPEC宣布减产', 'energy'],
    ['全国范围爆发大规模罢工', 'social'],
  ];
  for (const [title, cat] of cases) assert.equal(W.NewsEngine.classify(title), cat, title);
});

/* ================= 去重 ================= */

await test('dedupeNews：URL 精确去重', () => {
  const a = { title: 'Iran tensions rise', url: 'u1', source: 'reuters.com', publishedAt: 1000, category: 'geopolitics', country: 'IR', lat: 1, lng: 1 };
  const b = { title: 'Completely different story about oil', url: 'u1', source: 'ap.com', publishedAt: 2000, category: 'energy', country: 'SA', lat: 2, lng: 2 };
  const r = W.NewsEngine.dedupeNews([a, b]);
  assert.equal(r.items.length, 1);
  assert.equal(r.dropped, 1);
});

await test('dedupeNews：标题相似度去重（同事件不同措辞）', () => {
  const mk = (title, t, src) => ({ title, url: src, source: src, publishedAt: t, category: 'geopolitics', country: 'IR', lat: 1, lng: 1 });
  const r = W.NewsEngine.dedupeNews([
    mk('Iran tensions rise as navy holds Gulf drill', 1000, 'reuters.com'),
    mk('Iran tensions rise as navy holds Gulf exercises', 2000, 'bbc.com'),
    mk('Iran tensions escalate after Gulf naval exercise', 3000, 'ap.com'),
  ]);
  assert.equal(r.items.length, 1, '同事件三条应去为一条，实际 ' + r.items.length);
});

await test('dedupeNews：不同国家/不同事件不误杀', () => {
  const mk = (title, country, url) => ({ title, url, source: 's', publishedAt: 1000, category: 'geopolitics', country, lat: 1, lng: 1 });
  const r = W.NewsEngine.dedupeNews([mk('Japan and Korea hold talks', 'JP', 'a'), mk('Japan and Korea hold talks', 'KR', 'b')]);
  assert.equal(r.items.length, 2);
});

/* ================= 聚类（核心验收用例） ================= */

await test('聚类：伊朗四家外媒四条报道 → 1 个 Event，newsIds=4', () => {
  const news = W.EngineMockData.iranTension().map(W.NewsEngine.normalizeNews);
  assert.equal(news.length, 4);
  const evs = W.EventEngine.cluster(news, NOW);
  assert.equal(evs.length, 1, '应聚为 1 个事件，实际 ' + evs.length + '：' + evs.map(e => e.title).join(' | '));
  const ev = evs[0];
  assert.equal(ev.newsIds.length, 4);
  assert.equal(ev.countries[0], 'IR');
  assert.equal(ev.categories.includes('geopolitics'), true);
  assert.equal(ev.location.lat, 35.69);
  assert.ok(ev.confidence > 0.5, '四来源置信应 >0.5，实际 ' + ev.confidence);
  assert.ok(ev.severity >= 70, '地缘+多源严重度应 ≥70');
  assert.equal(ev.status, 'updating');                 // 最新新闻距 NOW < 24h
  assert.equal(ev.timeline.length, 4);                 // 时间线按时间排列
  assert.ok(ev.timeline[0].t <= ev.timeline[1].t);
  assert.ok(ev.createdAt < ev.updatedAt);
});

await test('聚类：不同类别不同地理不相吸（加息 vs 地震）', () => {
  const news = [...W.EngineMockData.bojHike(), ...W.EngineMockData.earthquake(), ...W.EngineMockData.globalMarket()]
    .map(W.NewsEngine.normalizeNews);
  const evs = W.EventEngine.cluster(news, NOW);
  assert.equal(evs.length, 3, '应聚为 3 个事件（BOJ/地震/全球股市），实际 ' + evs.length);
});

await test('聚类：global 桶（无坐标新闻）也能聚类', () => {
  const news = W.EngineMockData.globalMarket().map(W.NewsEngine.normalizeNews);
  const evs = W.EventEngine.cluster(news, NOW);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].location, null);
  assert.equal(evs[0].countries.length, 0);
});

await test('聚类：地理桶相似度下限——词面零交集的两件事不再被格子揉成一团（20260921）', () => {
  const mk = (title, source, hoursAgo) => W.NewsEngine.normalizeNews({
    title, url: 'https://' + source + '/x', source, publishedAt: NOW - hoursAgo * 3600000,
  });
  const strike1 = mk('Russia launches massive missile strike on Kyiv', 'reuters.com', 3);
  const strike2 = mk('Missile strike hits Kyiv amid Russian barrage', 'apnews.com', 2);
  const swap = mk('Russia denies invasion as prisoner swap completes', 'bbc.com', 1);
  const evs = W.EventEngine.cluster([strike1, strike2, swap], NOW);
  assert.equal(evs.length, 2, '空袭与换俘应各自成事件，实际 ' + evs.length + '：' + evs.map(e => e.title).join(' | '));
  const big = evs.find(e => e.newsIds.length === 2);
  assert.ok(big, '同一空袭的两篇报道（同格同类同窗+词面重叠）仍应合并');
  assert.ok(big.newsIds.includes(strike1.id) && big.newsIds.includes(strike2.id));
});

await test('状态机：陈旧事件 → resolved', () => {
  const news = W.EngineMockData.iranTension().map(W.NewsEngine.normalizeNews);
  const future = Date.UTC(2026, 11, 31);              // 一个多月后
  const evs = W.EventEngine.cluster(news, future);
  assert.equal(evs[0].status, 'resolved');
});

await test('状态机：3 天前的事件 → active（回归：旧代码时间单位错 1000 倍，全永远 updating）', () => {
  const mk = (title, url, hoursAgo) => ({
    title, url, source: 'reuters.com', publishedAt: NOW - hoursAgo * 3600000,
    category: 'geopolitics', country: 'IR', lat: 35.69, lng: 51.39,
  });
  // 最新报道距 NOW 72h：> 24h 不再 updating，< 168h 尚未 resolved
  const evs = W.EventEngine.cluster(
    [mk('Iran nuclear talks stall in Vienna', 'a', 74), mk('Iran nuclear talks resume briefly', 'b', 72)], NOW);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].status, 'active', '72h 前的事件应为 active，实得 ' + evs[0].status);
});

await test('aiGate 与 needsAiReview 同一谓词（防两处阈值漂移）', () => {
  const cases = [
    { confidence: 0.9, severity: 80, newsIds: ['a', 'b', 'c'] },   // 高置信高严重多源
    { confidence: 0.4, severity: 80, newsIds: ['a', 'b', 'c'] },   // 低置信
    { confidence: 0.9, severity: 80, newsIds: ['a'] },             // 高严重单源
    { confidence: 0.9, severity: 40, newsIds: ['a', 'b', 'c'] },   // 低严重高置信
  ];
  for (const ev of cases) {
    assert.equal(W.LLMProvider.aiGate(ev), W.EventEngine.needsAiReview(ev), JSON.stringify(ev));
  }
});

await test('needsAiReview：低置信/高严重来源不足才需要 AI', () => {
  const base = { confidence: 0.9, severity: 80, newsIds: ['a', 'b', 'c'] };
  assert.equal(W.EventEngine.needsAiReview(base), false, '高置信高严重多源 → 不需要');
  assert.equal(W.EventEngine.needsAiReview({ ...base, confidence: 0.4 }), true, '低置信 → 需要');
  assert.equal(W.EventEngine.needsAiReview({ ...base, newsIds: ['a'] }), true, '高严重单源 → 需要');
});

/* ================= AI 闸门与 Provider ================= */

await test('summarizeWithGate：闸门不过返回 null；通过则走 provider 并缓存', async () => {
  W.LLMProvider.resetCache();
  const hi = { id: 'e1', severity: 80, confidence: 0.6, newsIds: ['a', 'b'], countries: ['IR'], categories: ['geopolitics'], timeline: [{ note: 'x' }] };
  const lo = { id: 'e2', severity: 30, confidence: 0.9, newsIds: ['a', 'b'], countries: [], categories: ['markets'], timeline: [] };
  const calls = [];
  const provider = { name: 'mock', summarize: (ev) => { calls.push(ev.id); return Promise.resolve({ text: 'T', provider: 'mock', model: 'm', tokens: 0 }); } };
  assert.equal(await W.LLMProvider.summarizeWithGate(lo, provider), null, '低严重高置信 → 不调模型');
  const r1 = await W.LLMProvider.summarizeWithGate(hi, provider);
  assert.equal(calls.length, 1);
  const r2 = await W.LLMProvider.summarizeWithGate(hi, provider);
  assert.equal(calls.length, 1, '缓存命中不得再次调用 provider');
  assert.equal(r2.text, 'T');
  assert.ok(r2.cachedAt > 0);
});

await test('MockProvider：摘要含国家/类别，结构即契约', async () => {
  const news = W.EngineMockData.iranTension().map(W.NewsEngine.normalizeNews);
  const ev = W.EventEngine.cluster(news, NOW)[0];
  const r = await W.LLMProvider.mockProvider.summarize(ev);
  assert.equal(r.provider, 'mock');
  assert.ok(r.text.includes('伊朗'), '应含国家名：' + r.text);
  assert.ok(r.text.includes('地缘政治'));
});

await test('AnthropicProvider：浏览器上下文拒绝调用（前端无密钥铁律）', async () => {
  await assert.rejects(() => W.LLMProvider.anthropicProvider({ apiKey: 'sk-x' }).summarize({}),
    /服务端/);
});

/* ================= Asset Impact Engine ================= */

await test('impact：日本央行加息 → USDJPY↓（USD 基准对已折算）/ 日债↑ / 日经↓，证据分级', () => {
  const ev = { title: '日本央行加息25个基点', countries: ['JP'], categories: ['central_bank'] };
  assert.equal(W.ImpactEngine.eventKind(ev), 'CENTRAL_BANK_HIKE');
  const edges = W.ImpactEngine.inferImpacts(ev);
  const byAsset = Object.fromEntries(edges.map(e => [e.assetSymbol, e]));
  const fx = byAsset['EM:119.USDJPY'];
  assert.ok(fx, '应有 USDJPY 边（universe symbol，可直接查行情）');
  // 加息 → 日元升值；USDJPY 以美元为基准，日元升值意味着报价下跌。
  // 旧实现 direction:'up' 把"本币方向"当成了"报价方向"，语义颠倒且被本测试锁死
  assert.equal(fx.direction, 'down');
  assert.equal(fx.evidence.kind, 'DATA');
  const bond = byAsset['EM:171.JP10Y'];
  assert.ok(bond && bond.direction === 'up' && bond.evidence.kind === 'DATA');
  const eq = byAsset['nikkei'];
  assert.ok(eq && eq.direction === 'down' && eq.confidence < 0.7);
  assert.equal(eq.evidence.kind, 'CORRELATION');       // 概率性结论必须标 CORRELATION，不冒充事实
  assert.ok(eq.evidence.historicalCases || eq.historicalCases.length, 'CORRELATION 应带历史案例');
});

await test('impact：美联储加息 → USDCNH↑（美元自身是基准，方向不翻）；同 symbol 对 CN 方向必须翻转', () => {
  const us = W.ImpactEngine.inferImpacts({ title: '美联储加息50个基点', countries: ['US'], categories: ['central_bank'] });
  const usFx = us.find(e => e.assetSymbol === 'EM:133.USDCNH');
  assert.ok(usFx && usFx.direction === 'up', '美元强 → USDCNH（USD/CNH）上涨');
  const cn = W.ImpactEngine.inferImpacts({ title: '中国央行加息10个基点', countries: ['CN'], categories: ['central_bank'] });
  const cnFx = cn.find(e => e.assetSymbol === 'EM:133.USDCNH');
  assert.ok(cnFx && cnFx.direction === 'down', '人民币强 → USDCNH（USD/CNH）下跌');
});

await test('impact：按兵不动无机制性方向 → 显式 0 边（宁缺毋假；旧兜底指向不存在的规则静默空转）', () => {
  const edges = W.ImpactEngine.inferImpacts({ title: '美联储按兵不动维持利率不变', countries: ['US'], categories: ['central_bank'] });
  assert.equal(edges.length, 0, '按兵不动应 0 边，实得 ' + edges.length);
  // central_bank 类别兜底同样落到显式空规则，不再引用未定义 key
  const fb = W.ImpactEngine.inferImpacts({ title: '央行发布三季度政策执行报告', countries: ['CN'], categories: ['central_bank'] });
  assert.equal(fb.length, 0, '类别兜底同样应 0 边');
});

await test('geo：词表边界修复（won/real/dow 不再误报；比索/卢比/克朗按国家限定）', () => {
  assert.notEqual(W.EngineGeo.resolveCountry('Ukraine won backing from NATO allies')?.country, 'KR');
  assert.notEqual(W.EngineGeo.resolveCountry('US real estate prices cool further')?.country, 'BR');
  assert.equal(W.EngineGeo.resolveCountry('US real estate prices cool further')?.country, 'US');
  assert.notEqual(W.EngineGeo.resolveCountry('Windows outage disrupts factories')?.country, 'US');
  assert.equal(W.EngineGeo.resolveCountry('Dow Jones futures slip ahead of open')?.country, 'US');
  assert.equal(W.EngineGeo.resolveCountry('墨西哥比索走弱')?.country, 'MX');
  assert.equal(W.EngineGeo.resolveCountry('菲律宾比索企稳')?.country, 'PH');
  assert.equal(W.EngineGeo.resolveCountry('巴基斯坦卢比承压')?.country, 'PK');
  assert.equal(W.EngineGeo.resolveCountry('印度卢比走低')?.country, 'IN');
  assert.equal(W.EngineGeo.resolveCountry('挪威克朗上涨')?.country, 'NO');
  assert.equal(W.EngineGeo.resolveCountry('瑞典克朗下跌')?.country, 'SE');
});

await test('geo：20260921 词边界补课（rial/franc/indiana/guangdong/durban/New Mexico/小写 us）', () => {
  // rial 曾命中 industr*ial* → 伊朗（美国工业数据是财经高频题材）
  assert.equal(W.EngineGeo.resolveCountry('US industrial output slows sharply')?.country, 'US');
  assert.notEqual(W.EngineGeo.resolveCountry('Industrial output rises in Germany')?.country, 'IR');
  // franc 曾命中 San *Franc*isco → 瑞士
  assert.equal(W.EngineGeo.resolveCountry('San Francisco Fed president speaks on rates')?.country, 'US');
  // india(?!nesia) 防不了 Ind*iana*
  assert.notEqual(W.EngineGeo.resolveCountry('Chip plant to be built in Indiana')?.country, 'IN');
  // dong\b 挡得住 Guan*dong*（\b 前导缺失）；拼音广东应归中国
  assert.equal(W.EngineGeo.resolveCountry('Guangdong exports rise 5% in August')?.country, 'CN');
  // RBA 曾命中 Du*rba*n → 澳大利亚
  assert.notEqual(W.EngineGeo.resolveCountry('Durban port reopens after floods')?.country, 'AU');
  // mexico 是完整词，\b 挡不住 New Mexico，靠 (?<!new )
  assert.notEqual(W.EngineGeo.resolveCountry('Wildfires spread in New Mexico')?.country, 'MX');
  assert.equal(W.EngineGeo.resolveCountry('Mexico peso drops after rate decision')?.country, 'MX');
  // \b 不许打断 demonym：Iranian/Japanese/Australian 仍要归位
  assert.equal(W.EngineGeo.resolveCountry('Iranian oil exports fall')?.country, 'IR');
  assert.equal(W.EngineGeo.resolveCountry('Japanese yen slides past 150')?.country, 'JP');
  assert.equal(W.EngineGeo.resolveCountry('Australian inflation cools')?.country, 'AU');
  // Canadian 不是 canada 的子串，需显式收录（否则经 dollar 兜底错判美国）
  assert.equal(W.EngineGeo.resolveCountry('Canadian dollar slides after BoC decision')?.country, 'CA');
  // US 缩写大小写敏感：小写代词 us 不再判美国
  assert.notEqual(W.EngineGeo.resolveCountry('Markets give us a warning on inflation')?.country, 'US');
});

await test('news-engine：数字不同的标题不按相似度合并（25bp vs 50bp）；词边界分类', () => {
  const NE = W.NewsEngine;
  const mk = (title, min, url) => ({ title, url: url || ('u' + min), source: 'x', publishedAt: min * 60000 });
  const r = NE.dedupeNews([
    mk('Fed hikes rates by 25 basis points', 1),
    mk('Fed hikes rates by 50 basis points', 2),
    mk('Fed hikes rates by 25 basis points', 3),
  ]);
  assert.equal(r.items.length, 2, '25/50 是两个事件，25 的重复报道才合并');
  assert.notEqual(NE.classify('Dubai ruler unveils new plan'), 'technology', 'Dubai 不含 AI 误命中');
  assert.notEqual(NE.classify('Thai baht slides to record low'), 'technology');
  assert.equal(NE.classify('Air strikes hit Yemen port'), 'war', 'air strikes 分写也要进 war');
  assert.equal(NE.classify('Workers strikes spread across factories'), 'social');
  const a = NE.normalizeNews({ title: 'Big news', url: '', source: 'a.com', publishedAt: 1 });
  const b = NE.normalizeNews({ title: 'Big news', url: '', source: 'b.com', publishedAt: 1 });
  assert.notEqual(a.id, b.id, '无 URL 时同标题不同来源不得共享幂等键');
});

await test('impact：BANK_STRESS 有机制边、ELECTION 显式 0 边（宁缺毋假）', () => {
  const bank = W.ImpactEngine.inferImpacts({ title: 'Bank run hits regional lender', countries: ['US'], categories: ['economy'] });
  assert.ok(bank.length > 0, '银行挤兑不应再静默 0 边');
  const el = W.ImpactEngine.inferImpacts({ title: 'US election results shock markets', countries: ['US'], categories: ['politics'] });
  assert.equal(el.length, 0, '大选方向取决于候选人，显式 0 边');
});

await test('geo：110m feature.id（ISO numeric）→ ISO2 映射（地图点在多边形接线用）', () => {
  assert.equal(W.EngineGeo.iso2OfNumeric('156'), 'CN');
  assert.equal(W.EngineGeo.iso2OfNumeric('840'), 'US');
  assert.equal(W.EngineGeo.iso2OfNumeric('0408'), 'KP');      // 零填充形态
  assert.equal(W.EngineGeo.iso2OfNumeric(null), null);
  assert.equal(W.EngineGeo.iso2OfNumeric('999'), null);       // 未收录（无独立多边形/不在引擎表）
});

await test('impact：未命中 kind → 类别兜底产出；资产缺失的边整条跳过（不显示原始 token）', () => {
  // 已知国家：earthquake → equity_local → 日经边（CORRELATION）
  const jp = W.ImpactEngine.inferImpacts({ title: '某地发生强烈地震', countries: ['JP'], categories: ['natural_disaster'] });
  assert.ok(jp.some(e => e.assetSymbol === 'nikkei'), '已知国家应有日经边');
  // 未知国家：equity_local/insurance 都解析不出 symbol → 边整条跳过（旧版显示"equity 行情未接入"是噪音）
  const xx = W.ImpactEngine.inferImpacts({ title: '某地发生强烈地震', countries: ['XX'], categories: ['natural_disaster'] });
  assert.equal(xx.length, 0, '未知国家的地震不应产出 equity/insurance 原始 token 边');
});

await test('impact：geopolitics 不再兜底 SANCTIONS——军演 0 边、真制裁标题仍命中（20260921）', () => {
  // 军演/峰会/外交声明曾被一律套成"制裁"边，把推测包装成机制事实
  const drill = W.ImpactEngine.inferImpacts({ title: 'Naval drill near strait raises tensions', countries: ['KR'], categories: ['geopolitics'] });
  assert.equal(drill.length, 0, '军演不是制裁，宁缺毋假 0 边');
  // 真制裁新闻的标题必含 sanctions/制裁/禁运，走 KIND_RULES 直达，不依赖类别兜底
  const sanc = W.ImpactEngine.inferImpacts({ title: 'US announces new sanctions on oil exports', countries: ['US'], categories: ['geopolitics'] });
  assert.ok(sanc.length > 0, '标题含 sanctions 应命中 SANCTIONS 规则产出边');
});

await test('impact：冲突 → 黄金 risk_off；保险资产暂缺显式 null 不硬造', () => {
  const edges = W.ImpactEngine.inferImpacts({ title: '跨境导弹袭击升级', countries: ['IL'], categories: ['war'] });
  const gold = edges.find(e => e.assetSymbol === 'EM:101.GC00Y');   // universe symbol，可直接查行情
  assert.ok(gold, '应有黄金边（EM:101.GC00Y）');
  assert.ok(gold && gold.direction === 'up');
});

await test('impact：低相关边 confidence 显著低于机制边（不确定性诚实）', () => {
  const edges = W.ImpactEngine.inferImpacts({ title: '央行加息', countries: ['US'], categories: ['central_bank'] });
  const data = edges.filter(e => e.evidence.kind === 'DATA');
  const corr = edges.filter(e => e.evidence.kind === 'CORRELATION');
  const minData = Math.min(...data.map(e => e.confidence));
  const maxCorr = Math.max(...corr.map(e => e.confidence));
  assert.ok(minData > maxCorr, 'DATA 置信下限应高于 CORRELATION 上限');
});

console.log(`\nengine: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
