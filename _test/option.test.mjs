/* option.test.mjs —— 期权数据源（js/sources/option.js）行为锁（离线组，零外网）
   沙箱模式照抄 degrade.test.mjs：假上游形状照抄真接口字段位（字段清单来自
   2026-10-23 OKX/Deribit 实测与调研报告 2026-10-22 的 EM ulist 实测），跑的是
   js/sources/option.js 的真实适配器 + 真实的 js/utils.js 缓存。

   与 degrade.test.mjs 的三点差异：
   · SCRIPTS 只装 utils/store/proxy + option.js（期权源只依赖这三个）；
   · Date 注入可控行 FakeDate（T11 熔断窗口要推时钟；静态方法 UTC 经类继承照常可用）；
   · 假中文名一律 ASCII（沙箱无 GBK 编码器，degrade.test.mjs:44-45 原注）——
     EM f14 的真名是中文（品种+购/沽+行权价），这里用同构的 ASCII 合约名锁语义。
   沙箱无 window.Sessions → 顺带锁死 cnOpen 兜底=true（按盘中 30s 算）。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

let pass = 0, fail = 0;
const netLeaks = [];      // 离线组里漏到真实网络的请求（应恒为空，T12 守卫）
// vm 沙箱产物自带沙箱侧原型，跨 realm 的 deepStrictEqual 会因 prototype 不同误报——
// 统一走 JSON 字符串比较（纯数据对象，键序由构造顺序决定，两侧一致）
const jeq = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

/* ==================== 可控时钟（T11 熔断退避需要推时间） ==================== */
class FakeDate extends Date {
  static _now = Date.now();
  static now() { return FakeDate._now; }
  constructor(...a) { if (a.length === 0) super(FakeDate._now); else super(...a); }
}

/* ==================== 假上游：形状照抄真接口 ==================== */

// 三个标的指数（ASCII 假名；真名应回 沪深300/中证1000/上证50，见 option.js 文件头）
const IDX_META = {
  '1.000300': { code: '000300', name: 'STUB_HS300', price: 4600 },
  '1.000852': { code: '000852', name: 'STUB_CSI1000', price: 7100 },
  '1.000016': { code: '000016', name: 'STUB_SSE50', price: 3050 },
};

// cffex 探测计划：kept 行权价 × [C,P] 假网格表（code → ulist 行）
function makeCffexPlan({ kind, month, spot = 4600, quirks = false, empty = false }) {
  const rowsByCode = new Map();
  const kept = [-100, -75, -50, -25, 0, 25, 50, 75, 100].map(d => spot + d);   // 9 档，25 的倍数
  if (!empty) {
    for (const st of kept) {
      for (const side of ['C', 'P']) {
        rowsByCode.set(kind + month + '-' + side + '-' + st, {
          f2: (st / 10).toFixed(1), f3: '1.23', f5: String(100 + (st % 97)), f6: '123456', f14: kind + month + '-' + side + '-' + st,
        });
      }
    }
  }
  if (quirks) {
    const atmP = rowsByCode.get(kind + month + '-P-' + spot);
    if (atmP) atmP.f14 = '-';                                  // 空名档：请求内但被保留判据剔除
    const lowC = rowsByCode.get(kind + month + '-C-' + (spot - 100));
    if (lowC) lowC.f2 = '-';                                   // 无价档：闭市形态，f2='-' 但有名字 → 保留
  }
  return { kind, month, spot, rowsByCode, quirks };
}

// 东财 ulist（期权版）：按 secids 参数查假网格表；quirks 时混一条请求外的 code
function fakeEmUlistOption(u, plan) {
  const diff = [];
  for (const s of (u.searchParams.get('secids') || '').split(',').filter(Boolean)) {
    const dot = s.indexOf('.');
    const mkt = s.slice(0, dot), code = s.slice(dot + 1);
    if (mkt === '221') {
      const row = plan.rowsByCode.get(code);
      if (row) diff.push({ f2: row.f2, f3: row.f3, f5: row.f5, f6: row.f6, f12: code, f14: row.f14 });
    } else {
      const meta = IDX_META[s];
      if (meta) diff.push({ f2: meta.price, f3: '0.50', f5: '12345', f6: '987654321', f12: meta.code, f14: meta.name });
    }
  }
  if (plan.quirks) {
    // 请求集合之外的 code（9999 在 ±15% 网格之外，不可能被请求）→ 必须被丢弃
    diff.push({ f2: '9.9', f3: '0.1', f5: '1', f6: '1', f12: plan.kind + plan.month + '-C-9999', f14: 'STUB_ROGUE_9999' });
  }
  return { rc: 0, data: { total: diff.length, diff } };
}

// OKX instruments（合约表）：纯合约 + 3 条 _UM 变体（2026-10-23 实测 1316 行里 598 条 _UM）
function fakeOkxInstruments(u) {
  const uly = u.searchParams.get('uly') || '';
  if (uly !== 'BTC-USD') return { code: '0', data: [] };
  const ids = [
    'BTC-USD-261024-76000-C', 'BTC-USD-261024-76000-P', 'BTC-USD-261024-81000-C',
    'BTC-USD-261127-90000-C', 'BTC-USD-261127-95000-P',
    'BTC-USD_UM-261024-81000-C', 'BTC-USD_UM-261027-90000-C', 'BTC-USD_UM-261127-90000-P',
  ];
  return { code: '0', data: ids.map(instId =>
    ({ instType: 'OPTION', uly, instId, ctVal: '0.01', settleCcy: 'BTC', state: 'live' })) };
}

// OKX tickers（instType=OPTION）：字段位照抄 2026-10-23 实测清单；过滤集内仍混 _UM 行
function fakeOkxTickers(u) {
  const uly = u.searchParams.get('uly') || '';
  if (uly !== 'BTC-USD') return { code: '0', data: [] };
  const mk = (instId, last, vol) => ({
    instType: 'OPTION', instId, last, lastSz: '10',
    askPx: '0.009', askSz: '100', bidPx: '0.0085', bidSz: '100',
    open24h: '0.008', high24h: '0.0100', low24h: '0.0070',
    volCcy24h: '4.67', vol24h: vol, ts: '1792765974265', sodUtc0: '0.0085', sodUtc8: '0.0125',
  });
  return { code: '0', data: [
    mk('BTC-USD-261024-76000-C', '0.0120', '4675'),
    mk('BTC-USD-261024-76000-P', '0.0011', '120'),
    mk('BTC-USD-261024-81000-C', '', '0'),           // last 空串（深度虚值实测形态）→ price null 仍保留
    mk('BTC-USD-261127-90000-C', '0.0050', '88'),
    mk('BTC-USD-261127-95000-P', '0.0030', '45'),
    mk('BTC-USD_UM-261024-81000-C', '0.007', '999'), // _UM 混进过滤集（实测如此）→ 必须被二次过滤
    mk('BTC-USD_UM-261027-90000-C', '0.006', '999'), // 合约表没有它 → 不能被它带出行
  ] };
}

// OKX 标的现价（/api/v5/market/ticker）：2026-10-23 实测 HTTP 200、BTC-USDT last≈81515
function fakeOkxSpot(u) {
  const id = u.searchParams.get('instId') || '';
  const last = id === 'BTC-USDT' ? '81515.3' : id === 'ETH-USDT' ? '3050.1' : null;
  if (last === null) return { code: '1', msg: 'bad instId', data: [] };
  return { code: '0', data: [{ instType: 'SPOT', instId: id, last, open24h: '81733', vol24h: '3691.7' }] };
}

// Deribit book_summary：字段位照抄 2026-10-23 实测（mark_price/underlying_price 都有）
function fakeDeribit(u) {
  const ccy = u.searchParams.get('currency') || '';
  if (ccy !== 'BTC') return { result: [] };
  return { result: [
    { instrument_name: 'BTC-24OCT26-81000-C', mark_price: 0.00876726, last: 0.0065, volume: 1.2, underlying_price: 81415.59, bid_price: 0.006, ask_price: 0.007 },
    { instrument_name: 'BTC-24OCT26-81000-P', mark_price: 0.0044, last: '', volume: 0, underlying_price: 81415.59 },
    { instrument_name: 'BTC-26JUN27-90000-C', mark_price: 0.02, last: 0.015, volume: 3, underlying_price: 81415.59 },
    { instrument_name: 'BTC-PERPETUAL', mark_price: 1, last: 1, volume: 9, underlying_price: 81415.59 },   // 非期权命名 → 正则跳过
  ] };
}

/* ==================== 沙箱（照抄 degrade.test.mjs 骨架） ==================== */

const SCRIPTS = ['js/utils.js', 'js/store.js', 'js/proxy.js', 'js/sources/option.js'];

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

function makeRes(status, buf, type) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => type },
    json: async () => JSON.parse(buf.toString('utf8')),
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

/* makeEnv 选项：
     blockHosts  创建起即不可达的主机
     emPlan      cffex 假网格计划（makeCffexPlan 产物；不给则 EM 假上游缺位→离线泄漏）
     storage     共享 localStorage */
function makeEnv(opts = {}) {
  const o = {
    hosts: new Set(opts.blockHosts || []),
    emPlan: opts.emPlan || null,
    storage: opts.storage || makeStorage(),
    requests: [],                     // 本次 env 发出的全部请求 URL
  };
  FakeDate._now = Date.now();         // 每个 env 重置时钟（T11 自己往前推）

  const fetchShim = async (url) => {
    const abs = new URL(String(url));
    o.requests.push(abs.href);
    if (o.hosts.has(abs.host)) throw new Error('simulated failure: ' + abs.host);
    const h = abs.host, p = abs.pathname;
    const json = (payload) => makeRes(200, Buffer.from(JSON.stringify(payload), 'utf8'), 'application/json');
    if (h === 'push2delay.eastmoney.com' && p === '/api/qt/ulist.np/get') {
      if (!o.emPlan) { netLeaks.push(abs.href); throw new Error('offline: no emPlan'); }
      return json(fakeEmUlistOption(abs, o.emPlan));
    }
    if (h === 'www.okx.com' && p === '/api/v5/public/instruments') return json(fakeOkxInstruments(abs));
    if (h === 'www.okx.com' && p === '/api/v5/market/tickers') {
      // instType 分岔：OPTION 是期权语义，SPOT 是 degrade.test.mjs fakeOkx 占用的现货语义
      if ((abs.searchParams.get('instType') || '') === 'OPTION') return json(fakeOkxTickers(abs));
      return json({ code: '0', data: [] });
    }
    if (h === 'www.okx.com' && p === '/api/v5/market/ticker') return json(fakeOkxSpot(abs));
    if (h === 'www.deribit.com' && p === '/api/v2/public/get_book_summary_by_currency') return json(fakeDeribit(abs));
    netLeaks.push(abs.href);
    throw new Error('offline: ' + abs.href);
  };

  const documentShim = {
    documentElement: { style: {} },
    body: { style: {}, appendChild() { }, removeChild() { } },
    createElement: () => ({ style: {}, remove() { }, addEventListener() { }, setAttribute() { } }),
    head: { appendChild() { } },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() { },
  };

  const ctx = vm.createContext({
    console, Math, Date: FakeDate, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, Promise, Error, RegExp, Map, Set,
    encodeURIComponent, decodeURIComponent, URL, URLSearchParams, AbortController, AbortSignal,
    performance,
    fetch: fetchShim,
    document: documentShim,
    localStorage: o.storage,
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  SCRIPTS.forEach(f => vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return {
    W: vm.runInContext('window', ctx),
    requests: o.requests,
    storage: o.storage,
    kill: (host) => o.hosts.add(host),   // 运行中打挂某主机（T10 用）
  };
}

/* ==================== T1–T12 ==================== */

// 测试用月份：取真实时钟下 monthsOf 的第一个月（与实现同一口径，跨日期运行不出锚）
const { W: W0 } = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: '2611' }) });
const OS = W0.OptionSource;
const MONTH = OS.monthsOf('IO')[0];

await test('T1 monthsOf 确定性（now 注入；第三个周五 15:00 收盘为滚动边界）', async () => {
  const at = (s) => new Date(s);
  // 2026-10-16 是第 3 个周五（thirdFri 公式实测 = 16）：盘内不滚动
  jeq(OS.monthsOf('IO', at('2026-10-16T14:00:00+08:00')), ['2610', '2611', '2612', '2703']);
  // 收盘后（≥15:00）滚动到下月
  jeq(OS.monthsOf('IO', at('2026-10-16T16:00:00+08:00')), ['2611', '2612', '2703', '2706']);
  // 2026-12-20（周日）已过 12 月第 3 个周五（18 日）→ 滚动到 2701，随后两个季月 2703/2706。
  // ⚠️ 规格示例向量 ['2612',…] 是日历错位（2612 已于 12-18 到期摘牌），按滚动公式断言——
  // 澄清结论（本会话 escalate）：以公式为准。
  jeq(OS.monthsOf('IO', at('2026-12-20T12:00:00+08:00')), ['2701', '2702', '2703', '2706']);
  // 跨年进位本身：12 月第 3 个周五盘内 → 当月 2612、下月 2701
  jeq(OS.monthsOf('IO', at('2026-12-18T14:00:00+08:00')), ['2612', '2701', '2703', '2706']);
  jeq(OS.monthsOf('XX'), [], '白名单外品种 → 空数组');
  jeq(OS.monthsOf(''), []);
  for (const k of ['IO', 'MO', 'HO']) {
    const ms = OS.monthsOf(k);
    assert.equal(ms.length, 4, k + ' 应给 4 个月');
    ms.forEach(m => assert.match(m, OS.MONTH_RE, k + ' 的月份 ' + m + ' 不合 YYMM'));
  }
});

await test('T2 strikeGrid：±15% 网格边界与档距', async () => {
  const g25 = OS.strikeGrid(4600, 25);
  assert.equal(g25.length, 55, '(4600,25) 应 55 档，实际 ' + g25.length);
  assert.equal(g25[0], 3925); assert.equal(g25[g25.length - 1], 5275);
  assert.ok(g25.every(k => k % 25 === 0), '全为 25 的倍数');
  jeq(g25, [...g25].sort((a, b) => a - b), '升序');
  const g50 = OS.strikeGrid(4600, 50);
  assert.equal(g50[0], 3950); assert.equal(g50[g50.length - 1], 5250);
  assert.ok(g50.every(k => k % 50 === 0));
  jeq(OS.strikeGrid(null, 25), []);
  jeq(OS.strikeGrid(0, 25), []);
  jeq(OS.strikeGrid(NaN, 25), []);
  jeq(OS.strikeGrid(4600, 30), [], '档距白名单外 → 空数组');
});

await test('T3 入参闸门：坏输入 → null 且零请求', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH }) });
  const W = env.W;
  const curYY = new Date().getFullYear() % 100;
  const cases = [
    () => W.OptionSource.chain({ kind: 'XX', month: MONTH }),            // 品种白名单外
    () => W.OptionSource.chain({ kind: 'IO', month: 'abc' }),            // 月份格式坏
    () => W.OptionSource.chain({ kind: 'IO', month: 2611 }),             // 数字月份（类型不对）
    () => W.OptionSource.chain({ kind: 'IO' }),                          // 缺 month
    () => W.OptionSource.chain({ month: MONTH }),                        // 缺 kind
    () => W.OptionSource.chain(),                                        // 全缺
    () => W.OptionSource.chain({ kind: 'IO', month: String((curYY + 3) % 100).padStart(2, '0') + '03' }),  // 年份窗口外（未来）
    () => W.OptionSource.chain({ kind: 'IO', month: String((curYY + 98) % 100).padStart(2, '0') + '01' }), // 年份窗口外（过去）
    () => W.OptionSource.chain({ kind: 'BTC-USDT' }),                    // uly 白名单外（UI 合同只有 -USD）
    () => W.OptionSource.chain({ kind: 'SOL-USD' }),
    () => W.OptionSource.chain({ uly: 'BTC-USD' }),                        // 非合同字段名（应被忽略 → 走 cffex 闸门拒掉）
  ];
  for (const c of cases) assert.equal(await c(), null, '坏输入应返回 null');
  assert.equal(env.requests.length, 0, '坏输入不得发出任何请求，实际发了 ' + env.requests.length);
});

await test('T4 cffex 正常链：保留判据/降序/无侧 null/secid 白名单/名称解析', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH, quirks: true }) });
  const W = env.W;
  const r = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  assert.ok(r, '正常链应成功');
  assert.equal(r.via, 'eastmoney');
  assert.equal(r.updatedAt > 0 && r.updatedAt <= Date.now(), true, 'updatedAt 应为抓取时刻');
  jeq(r.underlying, { name: 'STUB_HS300', price: 4600 });
  // strike 降序
  const strikes = r.rows.map(x => x.strike);
  jeq(strikes, [...strikes].sort((a, b) => b - a), 'strike 应降序');
  assert.equal(strikes.length, 9, '9 个保留 strike');
  // f14='-' 的档被剔（ATM 认沽侧）：无侧 → null
  const atm = r.rows.find(x => x.strike === 4600);
  assert.ok(atm && atm.call, 'ATM 认购应保留');
  assert.equal(atm.put, null, "f14='-' 的认沽档应剔除（无侧 null）");
  // f2='-' 但有名字的档保留（闭市形态不按有价判定）：price 为 null
  const low = r.rows.find(x => x.strike === 4500);
  assert.ok(low && low.call, "f2='-' 的档应保留（上市即有名字）");
  assert.equal(low.call.price, null, 'f2=- 时 price 应诚实 null');
  assert.equal(low.call.name, 'IO' + MONTH + '-C-4500');
  assert.equal(low.put.price, (4500 / 10).toFixed(1) * 1, '认沽侧价格照常解析');
  // 请求外的 code（ROGUE/9999）被丢弃
  const flat = JSON.stringify(r.rows);
  assert.ok(!/9999|ROGUE/.test(flat), '请求外的 code 不得出现在结果里');
  // 合约 code 自带语义（名称解析）：品种+YYMM+C/P+行权价 → 认购、行权价 4600 语义
  // （真 EM 的 f14 是中文名「沪深300购…」；沙箱无 GBK 用同构 ASCII 名锁解析方向）
  const m = /^(\w{2})(\d{4})-([CP])-(\d+)$/.exec(atm.call.name);
  assert.ok(m, '合约名应可解析：' + atm.call.name);
  assert.equal(m[3], 'C', 'C 侧 = 认购');
  assert.equal(Number(m[4]), 4600, '行权价 4600');
  // 单元格形状契约：{price, chgPct, volume, name}
  jeq(Object.keys(atm.call).sort(), ['chgPct', 'name', 'price', 'volume']);
  assert.equal(atm.call.chgPct, 1.23);
  // SourceState 登记成功
  assert.equal(W.SourceState.get('option').ok, true);
  assert.equal(W.SourceState.get('option').via, 'eastmoney');
  // 请求预算：1 次 spot + 3 批（110 候选 + 1 标的 = 111 → 40/40/31）
  assert.equal(env.requests.length, 4, '应 1 spot + 3 批，实际 ' + env.requests.length);
  // 每个 URL 的 secids 逐项过白名单、单批 ≤ 40、首批标的在最前
  const RE_C = W.OptionSource.CFFEX_SECID_RE, RE_I = W.OptionSource.IDX_SECID_RE;
  env.requests.forEach((href, i) => {
    const u = new URL(href);
    assert.equal(u.host, 'push2delay.eastmoney.com', '只许 push2delay 这一台');
    assert.equal(u.pathname, '/api/qt/ulist.np/get', 'clist 路径永不出现');
    const secs = (u.searchParams.get('secids') || '').split(',').filter(Boolean);
    assert.ok(secs.length > 0 && secs.length <= 40, '批次大小 1~40，实际 ' + secs.length);
    secs.forEach(s => assert.ok(RE_C.test(s) || RE_I.test(s), 'secid 未过白名单：' + s));
    if (i === 1) assert.equal(secs[0], '1.000300', '首个批次标的 secid 应在最前');
  });
  assert.equal(env.requests.filter(h => new URL(h).searchParams.get('secids') === '1.000300').length, 1,
    'spot 探测恰 1 次单 secid 请求');
});

await test('T5 全空：只回标的行 → null + fail（诚实空态，不烧熔断）', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH, empty: true }) });
  const W = env.W;
  const r = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  assert.equal(r, null, '全空应返回 null');
  const st = W.SourceState.get('option');
  assert.equal(st.ok, false);
  assert.match(st.msg, /eastmoney/, '降级原因应说明是 eastmoney 路径');
  assert.equal(W.OptionSource.eastHealthy(), true, '应答健康但没有保留档 ≠ WAF 封禁，不烧熔断');
  assert.ok(env.requests.length >= 4, '全网格探测应已发出（spot+批）');
});

await test('T6 缓存：TTL 内二次调用零请求、结果全等；ttlOf 分档；无 Sessions 时 cnOpen 兜底 true', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH }) });
  const W = env.W;
  const r1 = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  const n1 = env.requests.length;
  const r2 = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  assert.equal(env.requests.length, n1, 'TTL 内二次调用不得新增请求');
  assert.equal(r2, r1, '应返回同一份缓存值');
  assert.equal(r2.updatedAt, r1.updatedAt, 'updatedAt 即原抓取时刻（缓存年龄诚实）');
  assert.equal(W.OptionSource.ttlOf('open'), 30000);
  assert.equal(W.OptionSource.ttlOf('closed'), 600000);
  assert.equal(W.OptionSource.cnOpen(), true, '沙箱无 Sessions → 按盘中兜底（30s）');
});

await test('T7 网格缓存：清链缓存留网格 → 二次调用只刷保留档（1 批），不再全网格探测', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH }) });
  const W = env.W;
  const r1 = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  const probeRequests = env.requests.length;
  W.U.Cache._m.delete('opt:cffex:IO:' + MONTH);        // 只清链值，网格缓存留 24h
  const n = env.requests.length;
  const keptSecids = 9 * 2;                             // 保留档 18 个 secid
  const r2 = await W.OptionSource.chain({ kind: 'IO', month: MONTH });
  const delta = env.requests.length - n;
  assert.ok(delta >= 1, '保留档刷新至少 1 批');
  assert.ok(delta <= Math.ceil((keptSecids * 2 + 1) / 40), '批次数 ≤ ceil((保留档×2+1)/40)，实际 ' + delta);
  assert.equal(delta, 1, '18 保留档 + 1 标的 = 19 ≤ 40 → 恰 1 批');
  assert.ok(delta < probeRequests, '不再全网格探测（首建 ' + probeRequests + ' 个请求）');
  assert.deepEqual(JSON.parse(JSON.stringify(r2.rows)), JSON.parse(JSON.stringify(r1.rows)), '保留档内容与首建一致');
});

await test('T8 crypto OKX 路径：_UM 过滤/expiry 升序/strike 降序/last 空串保留/mark 恒 null', async () => {
  const env = makeEnv({});
  const W = env.W;
  const r = await W.OptionSource.chain({ kind: 'BTC-USD' });
  assert.ok(r, 'OKX 主路径应成功');
  assert.equal(r.via, 'okx');
  assert.ok(!/_UM/.test(JSON.stringify(r)), '结果零 _UM 变体');
  // expiry 升序（近月在前）
  const expiries = [...new Set(r.rows.map(x => x.expiry))];
  jeq(expiries, ['2610', '2611']);
  for (const e of expiries) {
    const st = r.rows.filter(x => x.expiry === e).map(x => x.strike);
    jeq(st, [...st].sort((a, b) => b - a), e + ' 内 strike 应降序');
  }
  // last:"" 的合约仍保留、price 诚实 null（2610 / 81000 只有认沽侧无报价…此处只有 call 一侧）
  const empty = r.rows.find(x => x.expiry === '2610' && x.strike === 81000);
  assert.ok(empty && empty.call, "last='' 的档应保留");
  assert.equal(empty.call.price, null, "last='' → price null");
  assert.equal(empty.call.name, 'BTC-USD-261024-81000-C');
  assert.equal(empty.put, null, '合约表里没有它的认沽 → 无侧 null');
  // _UM-261027 行不能被带出行（合约表没有 (2610,90000)）
  assert.equal(r.rows.find(x => x.expiry === '2610' && x.strike === 90000), undefined);
  // mark 恒 null（OKX 全家没有 mark 字段，2026-10-23 逐字段核验）
  for (const row of r.rows) {
    for (const cell of [row.call, row.put]) {
      if (!cell) continue;
      assert.equal(cell.mark, null, 'OKX 路径 mark 应恒 null');
      jeq(Object.keys(cell).sort(), ['mark', 'name', 'price', 'volume']);
    }
  }
  jeq(r.underlying, { name: 'BTC', price: 81515.3 }, '标的现价来自 spot ticker');
  // 请求预算：合约表 1 + tickers 1 + spot 1 = 3
  assert.equal(env.requests.length, 3);
  assert.equal(W.SourceState.get('option').ok, true);
  assert.equal(W.SourceState.get('option').via, 'okx');
});

await test('T9 降级 Deribit：OKX 挂 → book_summary 接管（mark/命名解析/underlying）', async () => {
  const env = makeEnv({ blockHosts: ['www.okx.com'] });
  const W = env.W;
  const r = await W.OptionSource.chain({ kind: 'BTC-USD' });
  assert.ok(r, 'Deribit 兜底应成功');
  assert.equal(r.via, 'deribit');
  // env.requests 记录含被拦截的尝试：Deribit 恰 1 次成功路径请求；OKX 只试了 instruments 就放弃
  assert.equal(env.requests.filter(h => /deribit\.com/.test(h)).length, 1, '兜底路径恰 1 请求');
  assert.ok(env.requests.filter(h => /okx\.com/.test(h)).every(h => h.includes('/api/v5/public/instruments')),
    'OKX 只应尝试合约表（后续路径不再打）');
  assert.ok(env.requests.some(h => /deribit\.com/.test(h)), '应打 Deribit');
  const atm = r.rows.find(x => x.expiry === '2610' && x.strike === 81000);
  assert.ok(atm && atm.call, 'ATM 合约应保留');
  assert.equal(atm.call.mark, 0.00876726, 'mark 来自 mark_price');
  assert.equal(atm.call.price, 0.0065, 'price 来自 last');
  assert.equal(atm.put.mark, 0.0044);
  assert.equal(atm.put.price, null, "last='' → price null（mark 仍在）");
  // 'BTC-24OCT26-81000-C'（DDMMMYY）解析出 expiry '2610'
  assert.equal(atm.call.name, 'BTC-24OCT26-81000-C');
  assert.equal(r.rows.find(x => x.expiry === '2706' && x.strike === 90000).call.mark, 0.02, '26JUN27 → 2706');
  assert.ok(!/PERPETUAL/.test(JSON.stringify(r)), '非期权命名被正则跳过');
  assert.equal(r.underlying.price, 81415.59, 'underlying.price 取自 underlying_price');
  assert.equal(W.SourceState.get('option').via, 'deribit');
});

await test('T10 双挂：有缓存 → 返回缓存；冷启动 → null + fail（msg 含两源标识）', async () => {
  const env = makeEnv({});
  const W = env.W;
  const r1 = await W.OptionSource.chain({ kind: 'BTC-USD' });
  assert.equal(r1.via, 'okx');
  env.kill('www.okx.com');
  env.kill('www.deribit.com');
  const r2 = await W.OptionSource.chain({ kind: 'BTC-USD' });
  assert.equal(r2, r1, '双挂且有缓存 → 返回缓存值');
  // 冷启动（全新沙箱）：两源皆败 + 无缓存 → 诚实空态
  const env2 = makeEnv({ blockHosts: ['www.okx.com', 'www.deribit.com'] });
  const r3 = await env2.W.OptionSource.chain({ kind: 'BTC-USD' });
  assert.equal(r3, null);
  const st = env2.W.SourceState.get('option');
  assert.equal(st.ok, false);
  assert.match(st.msg, /okx/, 'msg 应含 OKX 标识');
  assert.match(st.msg, /deribit/, 'msg 应含 Deribit 标识');
});

await test('T11 熔断：连续两次 EM 失败后，窗口内第三次调用零 EM 请求', async () => {
  const env = makeEnv({ emPlan: makeCffexPlan({ kind: 'IO', month: MONTH }), blockHosts: ['push2delay.eastmoney.com'] });
  const W = env.W;
  const emAttempts = () => env.requests.filter(h => h.includes('push2delay')).length;
  assert.equal(W.OptionSource.eastHealthy(), true, '首次调用前是健康态');
  // 第 1 次失败：spot 请求被拒 → 烧熔断（30s）
  assert.equal(await W.OptionSource.chain({ kind: 'IO', month: MONTH }), null);
  assert.equal(emAttempts(), 1);
  assert.equal(W.OptionSource.eastHealthy(), false, '失败即进入熔断窗口');
  // 推进 31s（越过第 1 次的 30s 退避）→ 第 2 次失败（退避翻倍到 60s）
  FakeDate._now += 31000;
  assert.equal(await W.OptionSource.chain({ kind: 'IO', month: MONTH }), null);
  assert.equal(emAttempts(), 2, '连续第二次失败应真实打到 EM');
  // 窗口内第三次调用：不打 EM，直接缓存（无）→ null
  FakeDate._now += 1000;
  assert.equal(await W.OptionSource.chain({ kind: 'IO', month: MONTH }), null);
  assert.equal(emAttempts(), 2, '熔断窗口内不得新增 EM 请求');
  assert.equal(W.OptionSource.eastHealthy(), false, '熔断探针应为 false');
  const st = W.SourceState.get('option');
  assert.equal(st.ok, false);
  assert.match(st.msg, /eastmoney/);
});

await test('T12 离线零泄漏：全程零真实网络请求', async () => {
  assert.equal(netLeaks.length, 0, '有请求漏到真实网络：' + (netLeaks[0] || ''));
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（degrade.test.mjs 同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
