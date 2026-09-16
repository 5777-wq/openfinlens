#!/usr/bin/env node
/* history.test.mjs —— 基金对比的长历史数据源实网校验（Node 直跑，需要联网）
 * 用法：node _test/history.test.mjs
 *
 * 这组测试锁的是"浏览器真的能拿到含分红的长历史"这件事本身，每一句都对应一个实测结论：
 *   · push2his 必须带 CORS 头（Node 的 fetch 不看 CORS，浏览器看——这里不测就等着线上白屏）；
 *   · fqt=2（后复权）才含分红且恒正；fqt=1（前复权）在 A股长窗口会算出负价（加性口径）；
 *   · 后复权比值必须与取数窗口无关（否则"2010 年至今"和"2015 年至今"会算出两套收益）；
 *   · 预设的常用标的代码必须全部解析得到（界面上给用户的快捷按钮不能有一半是死的）。
 *
 * 东财对短时间大量长历史请求会按 IP 临时封禁（实测整段 "other side closed"，curl/node 同时挂）。
 * 封禁期间依赖它的断言**报"跳过"而不是记成通过**，也不让整组变红——跳过数单独统计并在汇总里打印。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
let pass = 0, fail = 0, skip = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}
let EAST_OK = true, EAST_ERR = '';
async function testEast(name, fn) {
  if (!EAST_OK) { skip++; console.log('⊘ 跳过 ' + name + '（东财 push2his 本机不可达：' + EAST_ERR + '）'); return; }
  await test(name, fn);
}

/* ---- 用最小浏览器环境加载真实模块（history.js 走真网络） ---- */
function makeCtx() {
  const ctx = {
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat,
    Infinity, isFinite, Map, Set, Promise, Error, RegExp, Symbol,
    setTimeout, clearTimeout, TextDecoder, URL, AbortController, AbortSignal,
    fetch: (u, o) => fetch(u, o),
    window: null, globalThis: null,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  const c = vm.createContext(ctx);
  vm.runInContext(`
    window.U = {
      num: (v) => { if (v === null || v === undefined || v === '' || v === '-') return null;
        const n = Number(v); return Number.isFinite(n) ? n : null; },
      request: async (url, opts) => {
        const r = await fetch(url, { headers: { 'User-Agent': ${JSON.stringify(UA)} }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // 腾讯行情是 GBK：必须与原版 U.request 一样支持 gbk 解码，
        // 否则"腾讯兜底"在测试里永远失败（假红），测不出真实行为
        if (opts && opts.gbk) return new TextDecoder('gbk').decode(await r.arrayBuffer());
        return r.json();
      },
      /* 浏览器里走 <script> 注入；Node 里该接口不带 callback 参数时直接回 JSON（实测），
         所以这里不必伪造 JSONP，取同一份数据即可 —— 解析逻辑（市场位→secid）保持一致 */
      fetchJSONP: async (url) => {
        const r = await fetch(url, { headers: { 'User-Agent': ${JSON.stringify(UA)} }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      },
      Cache: { get: () => null, set: () => {}, raw: () => null },
    };
    window.SourceState = { ok() {}, fail() {}, all: () => [] };
  `, c);
  vm.runInContext(readFileSync(path.join(ROOT, 'js/sources/history.js'), 'utf8'), c, { filename: 'history.js' });
  vm.runInContext(readFileSync(path.join(ROOT, 'js/compare.js'), 'utf8'), c, { filename: 'compare.js' });
  return c;
}
const ctx = makeCtx();
const H = vm.runInContext('window.HistorySource', ctx);
const C = vm.runInContext('window.CompareMath', ctx);

const rawKline = async (secid, { klt = 101, lmt = 5000, fqt = 2 } = {}) => {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    `&klt=${klt}&fqt=${fqt}&lmt=${lmt}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  return (j.data && j.data.klines) || [];
};
const closesOf = (kl) => kl.map(r => +String(r).split(',')[2]);
const ratio = (a) => a[a.length - 1] / a[0];

/* ---------- 0. 探测东财可达性（决定后面哪些断言可执行） ---------- */
try {
  const r = await fetch('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=107.SPY&klt=101&fqt=2&lmt=2&end=20500101&fields1=f1&fields2=f51,f52,f53',
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { EAST_OK = false; EAST_ERR = 'HTTP ' + r.status; }
  else await r.json();
} catch (e) {
  EAST_OK = false;
  EAST_ERR = (e.cause && e.cause.message) || e.message;
}
console.log(EAST_OK ? '· 东财 push2his 可达：含分红断言全部执行' : '· 东财 push2his 不可达（' + EAST_ERR + '）：含分红断言将标记为跳过\n');

/* ---------- 1. 浏览器可达性：CORS 头 ---------- */

await testEast('push2his K线接口回 CORS 头（浏览器直连的前提，Node 测不出来）', async () => {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=107.SPY&klt=101&fqt=2&lmt=5&end=20500101&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Origin: 'https://5777-wq.github.io' }, signal: AbortSignal.timeout(20000) });
  assert.ok(r.ok, 'HTTP ' + r.status);
  const acao = r.headers.get('access-control-allow-origin');
  assert.ok(acao, '缺少 access-control-allow-origin，浏览器会直接 CORS 失败');
});

/* ---------- 2. 深度与恒正 ---------- */

await testEast('5000 根上限内取满长历史，且后复权价恒正（含分红口径）', async () => {
  for (const [secid, minBars, expectStart] of [['107.SPY', 4900, '2006'], ['1.510300', 3000, '2012'], ['116.02800', 4900, '2006']]) {
    const kl = await rawKline(secid, { lmt: 5000 });
    assert.ok(kl.length >= minBars, `${secid} 只有 ${kl.length} 根（期望 ≥ ${minBars}）`);
    const mn = Math.min(...closesOf(kl));
    assert.ok(mn > 0, `${secid} 后复权出现非正价 ${mn}（fqt=2 应当是恒正乘性口径）`);
    assert.ok(String(kl[0]).startsWith(expectStart), `${secid} 起点 ${kl[0]} 不在 ${expectStart} 年`);
  }
});

await testEast('fqt=1（前复权）在 A股长窗口是加性口径、会算出负价 —— 这就是本功能必须用 fqt=2 的原因', async () => {
  const kl = await rawKline('1.600900', { lmt: 5000, fqt: 1 });
  const mn = Math.min(...closesOf(kl));
  assert.ok(mn < 0, `长江电力前复权最小收盘 ${mn}（若已转正，说明东财换了口径，可以重新评估 fqt）`);
});

await testEast('分红必须真的算进去：长江电力后复权收益显著高于不复权价格收益', async () => {
  const [hfq, raw] = await Promise.all([rawKline('1.600900', { lmt: 5000, fqt: 2 }), rawKline('1.600900', { lmt: 5000, fqt: 0 })]);
  const rHfq = ratio(closesOf(hfq)), rRaw = ratio(closesOf(raw));
  assert.ok(rHfq > rRaw * 1.4, `后复权 ${rHfq.toFixed(2)}x 未显著高于不复权 ${rRaw.toFixed(2)}x，分红可能没进去`);
});

await testEast('美股 fqt=1 与 fqt=2 同比值（乘性复权自证：两条口径不该给出两套收益）', async () => {
  for (const secid of ['107.SPY', '105.QQQ']) {
    const [a, b] = await Promise.all([rawKline(secid, { lmt: 3000, fqt: 1 }), rawKline(secid, { lmt: 3000, fqt: 2 })]);
    const ra = ratio(closesOf(a)), rb = ratio(closesOf(b));
    assert.ok(Math.abs(ra - rb) / rb < 0.01, `${secid} 两口径比值差 ${(Math.abs(ra - rb) / rb * 100).toFixed(2)}%（${ra.toFixed(3)} vs ${rb.toFixed(3)}）`);
  }
});

await testEast('后复权比值与取数窗口无关（5000 根 vs 1300 根，重叠区间收益必须一致）', async () => {
  const [long, short] = await Promise.all([rawKline('107.SPY', { lmt: 5000 }), rawKline('107.SPY', { lmt: 1300 })]);
  const start = String(short[0]).split(',')[0];
  const from = long.map(r => String(r).split(',')).filter(p => p[0] >= start).map(p => +p[2]);
  const rFull = ratio(closesOf(short)), rSliced = ratio(from);
  assert.ok(Math.abs(rFull - rSliced) / rFull < 0.005, `窗口比值不一致：${rFull.toFixed(4)} vs ${rSliced.toFixed(4)}`);
});

/* ---------- 3. 腾讯兜底的能力边界（这条边界是 P0 级的：标错口径 = 总收益虚高 30 倍） ---------- */

await test('腾讯兜底一律"价格收益"：A股的 qfq 是加性口径，绝不能当含分红用', async () => {
  const cn = await H.fetchTencent('1.600900', { granularity: 'week', limit: 2000 });
  assert.ok(cn && cn.bars.length >= 400, 'A股腾讯兜底数据不足：' + (cn ? cn.bars.length : 'null'));
  assert.equal(cn.adj, 'none', 'A股腾讯兜底必须标 none（加性前复权，见下一条证据），不得标 qfq/hfq');
  const us = await H.fetchTencent('107.SPY', { granularity: 'week', limit: 2000 });
  assert.ok(us && us.bars.length >= 500, '美股腾讯兜底数据不足：' + (us ? us.bars.length : 'null'));
  assert.equal(us.adj, 'none', '美股腾讯 qfq 参数被忽略（返回不复权价），口径必须是 none');
});

await test('证据：腾讯 A股 qfq 是"减去累计分红"的加性口径（raw−qfq 阶梯式变化、比例不恒定）', async () => {
  // 直连 fqkline（含 qfq）与不复权接口做对照。fqkline 实测会 501 + JS 挑战页，
  // 那种情况下这条证据无法复核 → 明确跳过，而不是假装通过。
  const fetchSeries = async (fq) => {
    const base = fq ? 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='
      : 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=';
    const param = fq ? ['sh600900', 'week', '', '', 300, 'qfq'].join(',') : ['sh600900', 'week', '', '', 300].join(',');
    const r = await fetch(base + encodeURIComponent(param), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    if (!t.startsWith('{')) return { blocked: true };        // 501 挑战页：无法复核
    const j = JSON.parse(t);
    const node = j.data && (j.data.sh600900 || Object.values(j.data || {})[0]);
    const rows = node ? (node.qfqweek || node.week || []) : [];
    return { rows: rows.map(x => [String(x[0]), +x[2]]) };
  };
  const [raw, qfq] = await Promise.all([fetchSeries(false), fetchSeries(true)]);
  if (qfq.blocked) { skip++; console.log('⊘ 跳过（fqkline 返回挑战页，无法复核加性口径）'); return; }
  const m = new Map(qfq.rows);
  const both = raw.rows.filter(r => m.has(r[0]) && m.get(r[0]) > 0);
  assert.ok(both.length >= 100, '可比样本 ' + both.length);
  const diffs = both.map(([d, r]) => +(r - m.get(d)).toFixed(3));
  const ratios = both.map(([d, r]) => r / m.get(d));
  const uniqDiff = new Set(diffs).size, uniqRatio = new Set(ratios.map(x => +x.toFixed(3))).size;
  // 乘性复权：比例恒定、差值随价格漂移；加性复权：差值只在除息日跳变、比例一直变
  assert.ok(uniqDiff < uniqRatio, `raw−qfq 的取值数（${uniqDiff}）应少于 raw/qfq 的取值数（${uniqRatio}）——` +
    '若相反说明腾讯已改口径，需要重新评估能不能当总收益用');
  assert.ok(Math.max(...diffs) - Math.min(...diffs) > 0.5, '差值幅度应显著变化（实测 5.099 → 0.000）');
});

await test('A股兜底收益落在合理量级（若有人把加性 qfq 当总收益，这里会飙到 9000%+）', async () => {
  const s = await H.load('600900', { granularity: 'week', days: 7000 });
  assert.ok(s, '600900 未取到');
  const bars = C.sliceRange(s.bars, '2010-01-01', '2026-09-10');
  const m = C.metrics(bars, { periodsPerYear: 52 });
  assert.ok(m && m.total > 50 && m.total < 700,
    `长江电力区间总收益 ${m && m.total.toFixed(1)}% 不合理（价格口径约 +200~400%，含分红约 +800~1200%；` +
    '落到 +9000% 说明把加性前复权当成了复权收益）');
});

await testEast('周线/月线可取到 2001 年（跨 20 年对比不必退回日线）', async () => {
  for (const [klt, minBars] of [[102, 1200], [103, 280]]) {
    const kl = await rawKline('107.SPY', { klt, lmt: 5000 });
    assert.ok(kl.length >= minBars, `klt=${klt} 只有 ${kl.length} 根`);
    assert.ok(Math.min(...closesOf(kl)) > 0, `klt=${klt} 出现非正价`);
  }
});

/* ---------- 3b. 解析守卫（纯离线：两个接口都桩掉，只问"会不会串标的"） ---------- */

await test('解析守卫：搜索接口把无关标的排首位时，仍必须只认"代码完全一致"的行', async () => {
  // 东财 suggest 对 "SPY" 的真实返回里混着"远东股份 600869"；这里把那份 payload 固定下来，
  // 并让"猜市场位"失效（东财不可达），验证 load('SPY') 仍落到 107.SPY 而不是 1.600869
  const ctx2 = makeCtx();
  vm.runInContext(`
    window.U.fetchJSONP = async () => ({ QuotationCodeTable: { Data: [
      { Code: '600869', MktNum: 1, Name: '远东股份', SecurityTypeName: '沪A' },
      { Code: 'SPY', MktNum: 107, Name: '标普500ETF-SPDR', SecurityTypeName: '美股' },
    ] } });
    window.U.request = async (url) => {
      if (/push2his/.test(url)) throw new Error('east blocked');
      if (/qt[.]gtimg[.]cn/.test(url)) return 'v_usSPY="1~标普500指数ETF-SPDR~SPY.AM~757.39"';
      if (/fqkline/.test(url)) {
        const code = decodeURIComponent(/param=([^&]*)/.exec(url)[1]).split(',')[0];
        return { data: { [code]: { week: [['2020-01-03', '1', '100', '1', '1', '1'], ['2020-01-10', '1', '101', '1', '1', '1']] } } };
      }
      throw new Error('unexpected ' + url);
    };
  `, ctx2);
  const H2 = vm.runInContext('window.HistorySource', ctx2);
  const got = await H2.load('SPY', { granularity: 'week', days: 365 });
  assert.ok(got, 'SPY 没解析出序列');
  assert.equal(got.secid, '107.SPY', '必须取搜索接口里"代码完全一致"的那一行，实际取到 ' + got.secid);
  const cn = await H2.load('远东股份', { granularity: 'week', days: 365 });
  assert.equal(cn.secid, '1.600869', '中文名输入应按接口相关度取首行');
});

await test('解析守卫：同一串数字必须总是同一个标的（不因"当时哪个源能通"而变）', () => {
  // 6 位代码按号段定市场位（6/9→沪 1.，0/3/4/8→深北 0.），只有 000xxx 段因为
  // 1.000001 上证指数 / 0.000001 平安银行 撞号而保留 amb=1（要权威来源裁决）
  const cases = [
    ['600519', '1.600519', 0], ['688981', '1.688981', 0], ['900901', '1.900901', 0],
    ['000002', '0.000002', 1], ['000001', '0.000001', 1],
    ['300750', '0.300750', 0], ['159915', '0.159915', 0], ['830799', '0.830799', 0],
    ['sh600519', '1.600519', 0], ['sz000002', '0.000002', 0], ['02800', '116.02800', 0],
  ];
  for (const [input, secid, amb] of cases) {
    const c = H.candidatesOf(input);
    assert.equal(c.length, 1, input + ' 应只给一个候选，实际 ' + JSON.stringify(c.map(x => x.secid)));
    assert.equal(c[0].secid, secid, input + ' → ' + c[0].secid);
    assert.equal(c[0].amb, amb, input + ' 的歧义级别应为 amb=' + amb);
  }
  // 美股：三种市场位都是同一只标的（标签级歧义 amb=2），可以都试
  const us = H.candidatesOf('SPY');
  assert.deepEqual([...us.map(x => x.secid)], ['105.SPY', '107.SPY', '106.SPY']);
  us.forEach(x => assert.equal(x.amb, 2, '美股候选是标签级歧义'));
});

await test('解析守卫：编号段候选不依赖搜索接口（搜索挂了 600519 仍能取到）', async () => {
  const ctx4 = makeCtx();
  vm.runInContext(`
    window.U.fetchJSONP = async () => { throw new Error('search down'); };
    window.U.request = async (url) => {
      if (/push2his/.test(url)) throw new Error('east blocked');
      if (/fqkline|kline/.test(url)) {
        const code = decodeURIComponent(/param=([^&]*)/.exec(url)[1]).split(',')[0];
        if (code !== 'sh600519') return { data: {} };
        return { data: { sh600519: { week: [['2020-01-03', '1', '1000', '1', '1', '1'], ['2020-01-10', '1', '1010', '1', '1', '1']] } } };
      }
      throw new Error('unexpected ' + url);
    };
  `, ctx4);
  const H4 = vm.runInContext('window.HistorySource', ctx4);
  const r = await H4.load('600519', { granularity: 'week', days: 365 });
  assert.ok(r && r.secid === '1.600519', '600519 应命中 sh600519，实际 ' + (r && r.secid));
  // 而 000002 属于标的级歧义：搜索不可用就必须给 null（不能猜成 1.000002 Ａ股指数）
  assert.equal(await H4.load('000002', { granularity: 'week', days: 365 }), null);
});

const PRESETS = [
  ['SPY', '107.SPY'], ['QQQ', '105.QQQ'], ['DIA', '107.DIA'], ['IWM', '107.IWM'], ['VTI', '107.VTI'],
  ['SCHD', '107.SCHD'], ['SPMO', '107.SPMO'], ['SCHG', '107.SCHG'], ['SPLV', '107.SPLV'], ['VYM', '107.VYM'],
  ['510300', '1.510300'], ['510500', '1.510500'], ['159915', '0.159915'], ['510050', '1.510050'], ['588000', '1.588000'],
  ['512880', '1.512880'], ['512480', '1.512480'], ['513050', '1.513050'], ['513100', '1.513100'], ['159941', '0.159941'],
  ['02800', '116.02800'], ['03033', '116.03033'], ['sh600519', '1.600519'], ['hk00700', '116.00700'], ['usAAPL', '105.AAPL'],
];

await test('预设标的代码全部解析到预期 secid（顺带证明"能解析 ≠ 有数据"）', async () => {
  for (const [input, expect] of PRESETS) {
    const got = await H.load(input, { granularity: 'week', days: 365 });
    assert.ok(got, `${input} 没解析出序列`);
    assert.equal(got.secid, expect, `${input} 解析成 ${got.secid}，期望 ${expect}`);
    assert.ok(got.bars.length >= 3, `${input} 只有 ${got.bars.length} 根`);
    assert.ok(['hfq', 'none'].includes(got.adj), `${input} 复权口径异常：${got.adj}（只有东财后复权算含分红）`);
    // 主源可用时必须是含分红的后复权；兜底源一律价格收益（腾讯 qfq 是加性口径，不能当含分红）
    if (got.via === 'eastmoney') assert.equal(got.adj, 'hfq', `${input} 主源应给后复权`);
    if (got.via === 'tencent') assert.equal(got.adj, 'none', `${input} 腾讯兜底必须标价格收益`);
  }
});

await test('解析不会串标的：SPY/QQQ 不得被模糊搜索带偏到无关证券', async () => {
  // 东财 suggest 接口对 "SPY" 会返回"远东股份 600869"这类无关行（实测）——
  // 代码类输入必须只认代码完全一致的结果，否则用户加的是 SPY、图上画的是别的票
  for (const [input, expectCode] of [['SPY', 'SPY'], ['QQQ', 'QQQ'], ['510300', '510300']]) {
    const got = await H.load(input, { granularity: 'week', days: 365 });
    assert.ok(got, input + ' 没解析出序列');
    assert.equal(got.secid.split('.')[1].toUpperCase(), expectCode, `${input} 串到了 ${got.secid}`);
  }
});

await test('未知代码返回 null（空态交给界面，不抛错、不返回半条脏序列）', async () => {
  assert.equal(await H.load('ZZZZZZ9', { granularity: 'week', days: 365 }), null);
});

await test('secid 白名单：非法输入不发请求', async () => {
  assert.equal(await H.fetchEast('107.SPY&x=1', { granularity: 'day', limit: 5 }), null);
  assert.equal(await H.fetchEast('../../../etc/passwd', { granularity: 'day', limit: 5 }), null);
  assert.equal(H.SECID_RE.test('107.SPY'), true);
  assert.equal(H.SECID_RE.test('107.SPY/../x'), false);
});

/* ---------- 5. 指标口径的实网锚点（对源不敏感：含分红与价格收益都该落在合理区间） ---------- */

await test('SPY 2010 至今：总收益/年化/回撤落在合理区间（价格列取错会明显越界）', async () => {
  const s = await H.load('SPY', { granularity: 'week', days: 7000 });
  assert.ok(s, 'SPY 未取到');
  const bars = C.sliceRange(s.bars, '2010-01-01', '2026-09-10');
  assert.ok(bars.length > 700, '周线样本 ' + bars.length);
  const m = C.metrics(bars, { periodsPerYear: 52 });
  assert.ok(m.total > 300 && m.total < 1400, `SPY 总收益 ${m.total.toFixed(0)}% 不合理`);
  assert.ok(m.cagr > 8 && m.cagr < 20, `SPY 年化 ${m.cagr.toFixed(2)}% 不合理`);
  assert.ok(m.maxDD < -10, `SPY 最大回撤 ${m.maxDD.toFixed(1)}% 不合理（这段区间不该没有回撤）`);
});

await testEast('六只美股 ETF 共同起点对齐后，曲线首点全为 100 且读数可复现', async () => {
  const funds = [];
  for (const [code, secid] of [['QQQ', '105.QQQ'], ['SPY', '107.SPY'], ['DIA', '107.DIA'], ['SCHD', '107.SCHD'], ['SPMO', '107.SPMO'], ['SCHG', '107.SCHG']]) {
    const s = await H.load(code, { granularity: 'month', days: 7000 });
    assert.ok(s, code + ' 未取到');
    assert.equal(s.secid, secid);
    funds.push({ key: code, name: s.name, bars: s.bars });
  }
  // SPMO 2015-10 才上市 → 月线共同起点应当是它
  const cut = C.buildLines(funds, { mode: 'common', start: '2010-01-01', end: '2026-09-10' });
  assert.equal(cut.commonStart, '2015-10-01', '共同起点应受 SPMO 上市日限制，实际 ' + cut.commonStart);
  assert.equal(cut.lines.length, 6, '6 只都该进图');
  cut.lines.forEach(l => assert.equal(l.points[0].value, 100, l.key + ' 首点不是 100'));
  const qqq = C.metrics(cut.lines.find(l => l.key === 'QQQ').bars, { periodsPerYear: 12 });
  assert.ok(qqq.cagr > 8 && qqq.cagr < 30, 'QQQ 共同区间年化 ' + qqq.cagr);
});

console.log(`\n${pass} passed, ${fail} failed${skip ? '，' + skip + ' skipped（东财不可达）' : ''}`);
process.exit(fail ? 1 : 0);
