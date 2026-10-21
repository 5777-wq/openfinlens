/* degrade.test.mjs —— 降级链实测（QA 协议 D1）
   验的是"主源挂了之后到底发生什么"：主源 → 备源 → localStorage 缓存 → 诚实空态
   （不白屏、不造假数据）。这是全站唯一验证降级链的测试组。

   两个分组，同一文件按命令行开关切换：
     node _test/degrade.test.mjs          离线组：零外网、结果确定，CI 跑这组
     node _test/degrade.test.mjs --net    实网组：打真实第三方接口（需外网）

   离线组怎么在"不联网"的前提下测主备切换：
   沙箱把上游换成**形状照抄真接口**的假响应（字段位一致），再用主机名黑名单模拟
   "某个源挂了"。跑的是 js/sources/ 里的真实适配器 + 真实的 js/utils.js 缓存，
   断言的是产品代码的行为，不是假上游的行为。仓库自带的静态产物（data/**）由沙箱
   直接读本地文件——与浏览器里的相对路径一致。

   历史（2026-10-20 修）：本组曾是死代码——引用了已删除的 js/sources/report.js，
   readFileSync 抛 ENOENT 被 try/catch 吞成"用例失败"；又在 run-all.mjs 里被标
   net:true，CI 的 --offline 直接跳过，等于"既坏了又从不执行"。现在拆成离线/实网
   两组，离线组进 CI。 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
const NET = process.argv.includes('--net');
const STATIC_HOST = 'static.gfd.test';          // 仓库静态产物（data/**）的假域名
const STATIC_ORIGIN = 'https://' + STATIC_HOST + '/';

let pass = 0, fail = 0, skip = 0;
const netLeaks = [];      // 离线组里"本该被假上游接住、却漏到真实网络"的请求（应恒为空）
class SkipError extends Error { }                 // 实网组：本机不可达时跳过而非判失败
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) {
    if (e instanceof SkipError) { skip++; console.log('— 跳过 ' + name + '（' + e.message + '）'); return; }
    fail++; console.log('✗ ' + name + '\n   ' + e.message);
  }
}
const skipBecause = (why) => { throw new SkipError(why); };

/* ==================== 假上游：形状照抄真接口 ====================
   字段位/字段名与真接口一致（真接口的解析代码在 js/sources/*.js 里，这里只负责喂对形状）。
   假名用 ASCII：沙箱里没有 GBK 编码器（TextDecoder 只能解码），中文名会变乱码。 */

const chgOf = (i) => ((i % 9) - 4) * 0.37;        // 确定性涨跌：-1.48 ~ +1.48

// 腾讯行情：v_<code>="1~名称~代码~现价~昨收~今开~量~...~时间~涨跌额~涨跌幅~高~低~量~额~换手~...~流通市值~总市值"
function fakeTencentQuotes(pathname) {
  const syms = decodeURIComponent(pathname.replace(/^\/q=/, '')).split(',').filter(Boolean);
  return syms.map((s, i) => {
    const chg = chgOf(i);
    const f = new Array(46).fill('0');
    f[0] = '1';
    f[1] = 'STUB_' + s;
    f[2] = s.replace(/^[a-z]{2}/i, '');
    f[3] = (100 + chg).toFixed(2);   // 现价
    f[4] = '100.00';                 // 昨收
    f[5] = '99.50';                  // 今开
    f[6] = '1000';                   // 成交量(手)
    f[30] = '20260102150000';         // 行情时间
    f[31] = chg.toFixed(2);           // 涨跌额
    f[32] = chg.toFixed(4);           // 涨跌幅%
    f[33] = (101 + chg).toFixed(2);   // 高
    f[34] = (98 + chg).toFixed(2);    // 低
    f[36] = '1000'; f[37] = '1000.00'; f[38] = '0.5';
    f[44] = '100.00'; f[45] = '120.00';
    return 'v_' + s + '="' + f.join('~') + '"';
  }).join(';');
}

// 腾讯日/周 K：{ data: { <code>: { qfqday: [[日期,开,收,高,低,量], ...] } } }
function fakeTencentKline(u) {
  const parts = (u.searchParams.get('param') || '').split(',');
  const code = parts[0] || '';
  const period = parts[1] || 'day';
  const rows = [];
  for (let i = 1; i <= 30; i++) {
    rows.push(['2026-01-' + String(i).padStart(2, '0'), '100.00', '101.00', '102.00', '99.00', '1000']);
  }
  return { data: { [code]: { ['qfq' + period]: rows } } };
}

// 腾讯分时：{ data: { <code>: { data: { date:'YYYYMMDD', data:['0930 价 量', ...] } } } }
function fakeTencentMinute(u) {
  const code = u.searchParams.get('code') || '';
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push('093' + i + ' 100.00 ' + ((i + 1) * 100));
  }
  return { data: { [code]: { data: { date: '20260102', data: rows } } } };
}

// 东财报价行（ulist / clist 共用字段位）
function emRow(secid, i) {
  const [mkt, code] = String(secid).split('.');
  const chg = chgOf(i);
  const price = 100 + chg;
  return {
    f1: '-', f2: price, f3: chg, f4: chg, f5: 1000, f6: 1e8,
    f12: code, f13: Number(mkt) || 0, f14: 'STUB' + code,
    f15: price + 1, f16: price - 1, f17: price, f20: 1e10,
  };
}

// 东财 ulist（通用报价）
function fakeEmUlist(u) {
  const secids = (u.searchParams.get('secids') || '').split(',').filter(Boolean);
  const diff = secids.map((s, i) => emRow(s, i));
  return { rc: 0, data: { total: diff.length, diff } };
}

// 东财 clist（全市场）：分页返回，行里故意混一条指数行（该被 AUniverse 剔掉）
function fakeEmClist(u) {
  const pn = Number(u.searchParams.get('pn') || 1);
  const diff = [];
  for (let i = 0; i < 100; i++) {
    const code = String(600000 + (pn - 1) * 100 + i);
    diff.push(emRow('1.' + code, (pn - 1) * 100 + i));
  }
  if (pn === 1) {
    // 混一条真·指数行：代码段规则抓不到 000001，靠"名称以指数结尾"这条（js/auniverse.js）
    const idx = emRow('1.000001', 500);
    idx.f14 = '上证指数';
    diff.push(idx);
  }
  return { rc: 0, data: { total: 300, diff } };
}

// 东财 K 线：{ data: { klines: ['日期,开,收,高,低,量', ...] } }
// klt 为分钟级（5/15/30/60）时行首带时分（'2026-01-02 09:35'，分钟K的真实形态）
function fakeEmKline(u) {
  const secid = u.searchParams.get('secid') || '';
  const klt = Number(u.searchParams.get('klt') || 101);
  const klines = [];
  for (let i = 1; i <= 30; i++) {
    const day = '2026-01-' + String(i).padStart(2, '0');
    const when = klt === 101 ? day : day + ' 09:' + String(30 + (i % 5) * 5).padStart(2, '0');
    klines.push([when, '100.00', '101.00', '102.00', '99.00', '1000'].join(','));
  }
  return { rc: 0, data: { code: secid, name: 'STUB', klines } };
}

// 东财新闻：{ data: { list: [{title, uniqueUrl, showTime, summary, mediaName, code}] } }
function fakeEmNews() {
  const list = [];
  for (let i = 1; i <= 5; i++) {
    list.push({
      code: 'STUB' + i,
      title: 'Stub headline ' + i,
      uniqueUrl: 'https://finance.eastmoney.com/a/stub' + i + '.html',
      showTime: '2026-01-0' + i + ' 10:00:00',
      summary: 'stub summary ' + i,
      mediaName: 'Stub Media',
    });
  }
  return { code: '1', data: { list } };
}

// 币安 24h 行情
function fakeBinance(u) {
  const raw = u.searchParams.get('symbols');
  const syms = raw ? JSON.parse(raw) : ['BTCUSDT', 'ETHUSDT'];
  return syms.map((s, i) => ({
    symbol: s, lastPrice: String(100 + i), openPrice: String(99 + i), prevClosePrice: String(99 + i),
    highPrice: String(101 + i), lowPrice: String(98 + i),
    priceChange: '1.00', priceChangePercent: '1.0101', volume: '1000', quoteVolume: '100000',
  }));
}

// 币安 K 线：[[开盘ms,开,高,低,收,量], ...]
function fakeBinanceKline() {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push([Date.UTC(2026, 0, 1 + i), '100.0', '102.0', '99.0', '101.0', '1000', 0, 0, 20, '0', '0', '0']);
  }
  return rows;
}

// OKX 行情：{ code:'0', data:[{instId,last,open24h,high24h,low24h,vol24h,volCcy24h}] }
function fakeOkx() {
  return {
    code: '0',
    data: [
      { instId: 'BTC-USDT', last: '100', open24h: '99', high24h: '101', low24h: '98', vol24h: '1000', volCcy24h: '100000' },
      { instId: 'ETH-USDT', last: '50', open24h: '49', high24h: '51', low24h: '48', vol24h: '2000', volCcy24h: '200000' },
    ],
  };
}

// 东财数据中心（龙虎榜 / 港股通南向）
function fakeEmDatacenter(u) {
  const report = u.searchParams.get('reportName') || '';
  if (report === 'RPT_MUTUAL_STOCK_HOLDRANKS') {
    return {
      success: true,
      result: {
        pages: 1,
        data: [{
          SECURITY_CODE: '00700', SECURITY_NAME: 'StubHK', HOLD_DATE: '2026-01-02',
          HOLD_SHARES: 1000, HOLD_MARKET_CAP: 1e8, HOLD_SHARES_RATIO: 1.2, HOLD_SHARES_CHANGE: 100,
          ADD_SHARES_AMP: 0.5, PARTICIPANT_NUM: 5, CLOSE_PRICE: 300, CHANGE_RATE: 1.1, INDUSTRY: 'Stub',
        }],
      },
    };
  }
  return {
    success: true,
    result: {
      pages: 1,
      data: [{
        SECURITY_CODE: '600519', SECURITY_NAME_ABBR: 'StubLhb', SECUCODE: '600519.SH', CHANGE_RATE: 3.3,
        BILLBOARD_NET_AMT: 1e7, BILLBOARD_BUY_AMT: 2e7, BILLBOARD_SELL_AMT: 1e7, BILLBOARD_DEAL_AMT: 3e7,
        DEAL_NET_RATIO: 1.5, EXPLANATION: 'stub', TRADE_DATE: '2026-01-02 00:00:00', MARKET: 'SH',
        D1_CLOSE_ADJCHRATE: 1.1, D5_CLOSE_ADJCHRATE: 2.2, CLOSE_PRICE: 100,
      }],
    },
  };
}

// 新浪滚动新闻（JSONP 载荷）
function fakeSinaRoll() {
  const data = [];
  for (let i = 1; i <= 5; i++) {
    data.push({
      title: 'Stub sina headline ' + i,
      url: 'https://finance.sina.com.cn/stub/' + i + '.shtml',
      ctime: 1767225600 + i * 60,          // unix 秒
      intro: 'stub intro ' + i,
      media_name: 'Stub Sina',
      docid: 'stub' + i,
    });
  }
  return { result: { data } };
}

// 按主机+路径挑假上游；没有对应假上游时返回 null（交回真实网络/失败）
function fakeResponse(absUrl) {
  const u = new URL(absUrl);
  const h = u.host, p = u.pathname;
  if (h === 'qt.gtimg.cn' && p.startsWith('/q=')) return { text: fakeTencentQuotes(p) };
  if (h === 'web.ifzq.gtimg.cn' && p === '/appstock/app/fqkline/get') return { json: fakeTencentKline(u) };
  if (h === 'web.ifzq.gtimg.cn' && p === '/appstock/app/minute/query') return { json: fakeTencentMinute(u) };
  if (h === 'web.ifzq.gtimg.cn' && p === '/appstock/app/usMinute/query') return { json: fakeTencentMinute(u) };
  if (h === 'ifzq.gtimg.cn' && p === '/appstock/app/kline/mkline') return { json: fakeTencentKline(u) };
  if (h === 'push2delay.eastmoney.com' && p === '/api/qt/ulist.np/get') return { json: fakeEmUlist(u) };
  if (h === 'push2delay.eastmoney.com' && p === '/api/qt/clist/get') return { json: fakeEmClist(u) };
  if (h === 'push2delay.eastmoney.com' && p === '/api/qt/stock/kline/get') return { json: fakeEmKline(u) };
  if (h === 'push2his.eastmoney.com' && p === '/api/qt/stock/kline/get') return { json: fakeEmKline(u) };
  if (h === 'np-listapi.eastmoney.com') return { json: fakeEmNews() };
  if (h === 'datacenter-web.eastmoney.com') return { json: fakeEmDatacenter(u) };
  if (/binance/.test(h) && p === '/api/v3/ticker/24hr') return { json: fakeBinance(u) };
  if (/binance/.test(h) && p === '/api/v3/klines') return { json: fakeBinanceKline() };
  if (h === 'www.okx.com' && p === '/api/v5/market/tickers') return { json: fakeOkx() };
  return null;
}

// JSONP 假上游（新浪滚动）：浏览器靠 <script> 注入回调，node 沙箱里用同样的回调名模拟
function fakeJsonp(absUrl) {
  const u = new URL(absUrl);
  if (u.host === 'feed.mix.sina.com.cn') return fakeSinaRoll();
  return null;
}

/* ==================== 沙箱 ==================== */

// 沙箱里加载的脚本（顺序有依赖：utils/store/proxy 在前，源适配器在后）
const SCRIPTS = [
  'js/utils.js', 'js/store.js', 'js/proxy.js', 'js/breadth.js', 'js/auniverse.js',
  'js/events.js', 'js/polymarket.js',
  'js/data/universe.js', 'js/data/industry-chains.js',
  'js/sources/tencent.js', 'js/sources/sina.js', 'js/sources/eastmoney.js',
  'js/sources/okx.js', 'js/sources/binance.js', 'js/sources/fred.js',
  'js/sources/news.js', 'js/sources/lhb.js', 'js/sources/southbound.js',
  'js/sources/gdelt.js', 'js/sources/sec.js', 'js/sources/polymarket.js',
  'js/sources/etf.js', 'js/sources/fundholds.js',
];

// 可持久化的 localStorage（真实 Map 实现：跨"刷新"共享，验证缓存兜底真能活过刷新）
function makeStorage(seed) {
  const m = new Map(seed ? Object.entries(seed) : []);
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
     blockHosts    命中即抛错（模拟该主机不可达）
     fake          是否启用假上游（离线组开、实网组关）
     offline       非假上游、非静态产物的请求一律拒绝（离线组开）
     storage       共享的 localStorage（模拟"刷新页面"）
     staticOverride 静态产物的替身（测占位产物等分支） */
function makeEnv(opts = {}) {
  const o = {
    blockHosts: opts.blockHosts || [],
    fake: opts.fake !== undefined ? opts.fake : !NET,
    offline: opts.offline !== undefined ? opts.offline : !NET,
    staticOverride: opts.staticOverride || {},
    storage: opts.storage || makeStorage(),
    blocked: [],     // 命中黑名单的请求（有意打坏的）
    netErrors: [],   // 真实网络失败（实网组用来判"本机没外网"）
  };

  const fetchShim = async (url, init = {}) => {
    const abs = new URL(String(url), STATIC_ORIGIN);
    const key = abs.pathname.replace(/^\/+/, '');
    // 1) 主机黑名单：模拟"该源挂了"
    if (o.blockHosts.some(h => abs.href.includes(h))) {
      o.blocked.push(abs.href.slice(0, 80));
      throw new Error('simulated failure: ' + abs.host);
    }
    // 2) 仓库静态产物：直接读本地文件（相对路径与浏览器一致）
    if (key.startsWith('data/')) {
      if (Object.prototype.hasOwnProperty.call(o.staticOverride, key)) {
        return makeRes(200, Buffer.from(JSON.stringify(o.staticOverride[key]), 'utf8'), 'application/json');
      }
      const f = path.join(ROOT, key);
      if (!existsSync(f)) throw new Error('404 ' + key);
      return makeRes(200, readFileSync(f), 'application/json');
    }
    // 3) 假上游
    if (o.fake) {
      const r = fakeResponse(abs.href);
      if (r) {
        const body = r.json !== undefined
          ? Buffer.from(JSON.stringify(r.json), 'utf8')
          : Buffer.from(String(r.text), 'utf8');
        return makeRes(200, body, r.json !== undefined ? 'application/json' : 'text/plain');
      }
    }
    // 4) 真实网络
    if (o.offline) {
      // 离线组不该走到这里：说明某个请求没被假上游/静态产物接住（记下来，末尾有守卫用例）
      netLeaks.push(abs.href.slice(0, 100));
      o.netErrors.push(abs.href.slice(0, 80));
      throw new Error('offline: ' + abs.href);
    }
    try {
      return await fetch(abs.href, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      o.netErrors.push(abs.href.slice(0, 60) + ' ' + e.message);
      throw e;
    }
  };

  // document：JSONP 靠 <script> 注入回调——node 里没有 script 标签，这里用同名回调模拟，
  // 命中黑名单/无假上游时立刻 onerror（真实环境是加载失败）
  const documentShim = {
    documentElement: { style: {} },
    body: { style: {}, appendChild() { }, removeChild() { } },
    createElement: () => ({ style: {}, remove() { }, addEventListener() { }, setAttribute() { } }),
    head: {
      appendChild(s) {
        const src = String((s && s.src) || '');
        if (o.blockHosts.some(h => src.includes(h))) {
          o.blocked.push(src.slice(0, 80));
          setTimeout(() => { try { s.onerror && s.onerror(); } catch { } }, 0);
          return;
        }
        const payload = o.fake ? fakeJsonp(src) : null;
        if (payload === null) {
          // node 沙箱没有 <script> 执行环境：JSONP 通道在这里天然不可用（记为不可达，不算外网故障）
          setTimeout(() => { try { s.onerror && s.onerror(); } catch { } }, 0);
          return;
        }
        let cb = null;
        try {
          for (const [, v] of new URL(src).searchParams) if (v.startsWith('gfdcb')) { cb = v; break; }
        } catch { }
        setTimeout(() => { try { if (cb && ctx[cb]) ctx[cb](payload); } catch { } }, 0);
      },
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener() { },
  };

  const ctx = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, Promise, Error, RegExp, Map, Set,
    encodeURIComponent, decodeURIComponent, URL, URLSearchParams, AbortController, AbortSignal,
    performance, title: '',
    fetch: fetchShim,
    document: documentShim,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    localStorage: o.storage,
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  SCRIPTS.forEach(f => vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return { W: vm.runInContext('window', ctx), blocked: o.blocked, netErrors: o.netErrors, storage: o.storage };
}

const toSecid = (s) => /^sh/.test(s) ? '1.' + s.slice(2)
  : /^(sz|bj)/.test(s) ? '0.' + s.slice(2)
    : /^hk/.test(s) ? '116.' + s.slice(2)
      : /^us/.test(s) ? '105.' + s.slice(2) : null;

/* ==================== 离线组（零外网，CI 跑这组） ==================== */
if (!NET) {

  /* ---------- 链 A：gdelt 全球事件（静态 JSON → 缓存 → 诚实空态） ---------- */
  await test('降级链A1：gdelt 静态 JSON 可达 → live（读仓库产物，不联网）', async () => {
    const { W } = makeEnv();
    const r = await W.EventsSource.getEvents();
    assert.equal(r.via, 'live', '静态产物可达应标 live，实际 ' + r.via);
    assert.ok(r.events.length > 0, '事件为空');
    assert.equal(W.SourceState.get('gdelt').ok, true, '未登记 gdelt 成功');
    assert.equal(W.SourceState.get('gdelt').via, 'live');
    assert.ok(r.generatedAt > 0, '缺生成时间戳');
    assert.equal(typeof r.stale, 'boolean', 'stale 应是布尔');
    console.log('   （仓库产物 ' + r.events.length + ' 条，生成于 ' + new Date(r.generatedAt).toISOString() + '）');
  });

  await test('降级链A2：gdelt 静态 JSON 不可达 → 回落缓存并标记 cache（刷新后仍在）', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ storage });
    const first = await e1.W.EventsSource.getEvents();
    assert.equal(first.via, 'live');
    // 模拟"刷新页面"：新沙箱 + 同一份 localStorage（内存缓存已清）
    const e2 = makeEnv({ storage, blockHosts: [STATIC_HOST] });
    const second = await e2.W.EventsSource.getEvents();
    assert.equal(second.via, 'cache', '应回落缓存，实际 ' + second.via);
    assert.equal(second.events.length, first.events.length, '缓存条数与首次一致');
    assert.equal(e2.W.SourceState.get('gdelt').ok, true);
    assert.equal(e2.W.SourceState.get('gdelt').via, 'cache', '状态应标 cache');
  });

  await test('降级链A3：gdelt 静态 JSON 不可达 + 无缓存 → 诚实空态（via=null，不造假事件）', async () => {
    const { W } = makeEnv({ blockHosts: [STATIC_HOST] });
    const r = await W.EventsSource.getEvents();
    assert.equal(r.via, null, '无数据时 via 应为 null，实际 ' + r.via);
    assert.equal(r.events.length, 0, '不该凭空造事件');
    assert.equal(W.SourceState.get('gdelt').ok, false, '未登记降级');
    assert.match(W.SourceState.get('gdelt').msg, /无数据/, '降级原因应说明无数据');
  });

  await test('降级链A4：gdelt 占位产物（events 空且无 generatedAt）→ 不算有效数据 → 诚实空态', async () => {
    const { W } = makeEnv({
      staticOverride: { 'data/events/global-events.json': { events: [], generatedAt: null, count: 0 } },
    });
    const r = await W.EventsSource.getEvents();
    assert.equal(r.via, null, '占位产物不该被当成 live，实际 ' + r.via);
    assert.equal(r.events.length, 0);
    assert.equal(W.SourceState.get('gdelt').ok, false);
  });

  /* ---------- 链 B：polymarket 预测市场（静态 JSON → 缓存 → 诚实空态） ---------- */
  await test('降级链B1：polymarket 静态 JSON 可达 → live（概率与档位合法）', async () => {
    const { W } = makeEnv();
    const r = await W.PmSource.getMarkets();
    assert.equal(r.via, 'live', '应标 live，实际 ' + r.via);
    assert.ok(r.events.length > 0, '预测市场事件为空');
    r.events.forEach(e => {
      assert.ok(e.outcomes && e.outcomes.length > 0, '事件必须至少有一个档位');
      e.outcomes.forEach(o => {
        assert.ok(o.probability >= 0 && o.probability <= 1, '概率越界 ' + o.probability);
        assert.ok(typeof o.label === 'string' && o.label.length > 0, '档位名为空');
      });
    });
    assert.equal(W.SourceState.get('forecast').ok, true, '未登记 forecast 成功');
    assert.equal(W.SourceState.get('forecast').via, 'live');
    console.log('   （仓库产物 ' + r.events.length + ' 个事件 / ' +
      r.events.reduce((n, e) => n + e.outcomes.length, 0) + ' 个档位）');
  });

  await test('降级链B2：polymarket 静态 JSON 不可达 → 回落缓存并标记 cache', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ storage });
    const first = await e1.W.PmSource.getMarkets();
    assert.equal(first.via, 'live');
    const e2 = makeEnv({ storage, blockHosts: [STATIC_HOST] });
    const second = await e2.W.PmSource.getMarkets();
    assert.equal(second.via, 'cache', '应回落缓存，实际 ' + second.via);
    assert.equal(second.events.length, first.events.length);
    assert.equal(e2.W.SourceState.get('forecast').ok, true);
    assert.equal(e2.W.SourceState.get('forecast').via, 'cache');
  });

  await test('降级链B3：polymarket 静态 JSON 不可达 + 无缓存 → 诚实空态（forecast 标降级）', async () => {
    const { W } = makeEnv({ blockHosts: [STATIC_HOST] });
    const r = await W.PmSource.getMarkets();
    assert.equal(r.via, null, '无数据时 via 应为 null，实际 ' + r.via);
    assert.equal(r.events.length, 0, '不该凭空造预测市场事件');
    assert.equal(W.SourceState.get('forecast').ok, false);
    assert.match(W.SourceState.get('forecast').msg, /无数据/);
  });

  await test('降级链B4：概率历史缺失 → grid=null（不画假线）', async () => {
    const { W } = makeEnv({ blockHosts: [STATIC_HOST] });
    const r = await W.PmSource.getHistory();
    assert.equal(r.grid, null, '历史缺失时 grid 应为 null');
    assert.equal(r.via, null);
  });

  /* ---------- 链 C：13F / 因子 ETF / 基金持仓（静态 JSON → 抛错 → 缓存兜底） ---------- */
  await test('降级链C1：13F 静态 JSON 不可达 → 适配器抛错（不返回空壳假数据）', async () => {
    const { W } = makeEnv({ blockHosts: [STATIC_HOST] });
    await assert.rejects(() => W.SecSource.get13F(), '静态产物不可达应抛错（上层才能走缓存兜底）');
  });

  await test('降级链C2：因子 ETF / 基金持仓 静态 JSON 不可达 → 适配器抛错', async () => {
    const { W } = makeEnv({ blockHosts: [STATIC_HOST] });
    await assert.rejects(() => W.EtfSource.getEtfHoldings(), 'ETF 产物不可达应抛错');
    await assert.rejects(() => W.FundHoldsSource.getFundHolds(), '基金持仓产物不可达应抛错');
  });

  await test('降级链C3：静态 JSON 不可达 → 缓存兜底后标 cache（brk/etf/fundholds 持久化）', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ storage });
    const d = await e1.W.SecSource.get13F();
    assert.ok(d.institutions.length > 0, '13F 产物应非空');
    // app.js loadBrk()/loadEtf()/loadFundHolds() 的同一句：成功即落缓存
    e1.W.U.Cache.set('brk', d);
    e1.W.U.Cache.set('etf', await e1.W.EtfSource.getEtfHoldings());
    e1.W.U.Cache.set('fundholds', await e1.W.FundHoldsSource.getFundHolds());
    // 缓存必须持久化（刷新页面后仍在）：白名单前缀见 js/utils.js Cache._persist
    assert.ok(storage.getItem('gfd_cache_brk'), 'brk 缓存未持久化');
    assert.ok(storage.getItem('gfd_cache_etf'), 'etf 缓存未持久化');
    assert.ok(storage.getItem('gfd_cache_fundholds'), 'fundholds 缓存未持久化');

    // 模拟"刷新页面后产物不可达"：适配器抛错 → 上层按缓存键兜底
    const e2 = makeEnv({ storage, blockHosts: [STATIC_HOST] });
    let cached = null;
    try { await e2.W.SecSource.get13F(); } catch { cached = e2.W.U.Cache.raw('brk'); }
    assert.ok(cached && cached.val, '应命中缓存兜底');
    assert.equal(cached.val.institutions.length, d.institutions.length, '缓存内容与首次一致');
    assert.ok(cached.at > 0, '缓存缺时间戳（界面要显示缓存时间）');
  });

  /* ---------- 链 D：新闻 主源(新浪 JSONP) → 备源(东财) → 缓存 → 诚实空态 ---------- */
  await test('降级链D1：新浪主源挂 → 东财备源接管（via=eastmoney）', async () => {
    const { W, blocked } = makeEnv({ blockHosts: ['feed.mix.sina.com.cn'] });
    const r = await W.NewsSource.getNews();
    assert.ok(blocked.length > 0, '未拦截到新浪请求');
    assert.ok(r.list.length > 0, '备源也没数据');
    assert.equal(r.via, 'eastmoney', '应标记为备源，实际 ' + r.via);
    r.list.slice(0, 5).forEach(it => {
      assert.ok(it.title.length > 0, '标题为空');
      assert.ok(/^https?:\/\//.test(it.url), 'URL 非法');
      assert.ok(it.time > 0, '时间戳无效');
    });
    assert.equal(W.SourceState.get('news').ok, true);
    assert.equal(W.SourceState.get('news').via, 'eastmoney');
    console.log('   （东财接管 ' + r.list.length + ' 条，首条："' + r.list[0].title + '")');
  });

  await test('降级链D2：新闻双源全挂 → 走缓存 + 标记 cache（带缓存时间戳）', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ storage });
    const first = await e1.W.NewsSource.getNews();
    assert.ok(first.list.length > 0, '首次抓取失败，无法验证缓存');
    // 复用同一份 localStorage，新沙箱里两个源都挂
    const e2 = makeEnv({ storage, blockHosts: ['feed.mix.sina.com.cn', 'np-listapi.eastmoney.com'] });
    const second = await e2.W.NewsSource.getNews();
    assert.equal(second.via, 'cache', '应回落到缓存，实际 ' + second.via);
    assert.ok(second.list.length > 0, '缓存为空');
    assert.ok(second.cachedAt > 0, '缺缓存时间戳（界面要显示 · 缓存 HH:MM:SS）');
    assert.equal(second.list.length, first.list.length, '缓存条数与首次一致');
    assert.equal(e2.W.SourceState.get('news').ok, false, '双源全挂应登记降级');
  });

  await test('降级链D3：新闻双源全挂 + 无缓存 → via=none，诚实空态（不白屏）', async () => {
    const { W } = makeEnv({ blockHosts: ['feed.mix.sina.com.cn', 'np-listapi.eastmoney.com'] });
    const r = await W.NewsSource.getNews();
    assert.equal(r.via, 'none', '应标 none，实际 ' + r.via);
    assert.equal(r.list.length, 0);
    assert.equal(W.SourceState.get('news').ok, false);
  });

  /* ---------- 链 E：行情 腾讯挂 → 东财 secid 接管 ---------- */
  await test('降级链E1：腾讯挂 → 东财 secid 接管同一批标的', async () => {
    const { W, blocked } = makeEnv({ blockHosts: ['qt.gtimg.cn', 'ifzq.gtimg.cn'] });
    const syms = ['sh600519', 'hk00700', 'usAAPL', 'sh000001'];

    const primary = await W.TencentSource.getQuotes(syms);
    assert.equal(primary.length, 0, '主源应失败');
    assert.ok(blocked.length > 0, '未拦截到腾讯请求');
    assert.equal(W.SourceState.get('tencent').ok, false, '未登记 tencent 降级');

    const map = new Map(syms.map(s => [toSecid(s), s]));
    const backup = await W.EastmoneySource.getQuotes([...map.keys()]);
    assert.ok(backup.length >= 3, '备源只回 ' + backup.length + '/4');
    backup.forEach(q => {
      assert.ok(q.price > 0, q.name + ' 备源价格无效');
      assert.ok(typeof q.changePct === 'number' || q.changePct === null, '涨跌幅类型错');
    });
    assert.equal(W.SourceState.get('eastmoney').ok, true, '备源未登记成功');
    console.log('   （备源取到：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
  });

  /* ---------- 链 F：东财全市场挂 → 腾讯精选兜底（热力图不空） ---------- */
  await test('降级链F1：东财全市场可达 → 行数>0 且指数行已被剔掉', async () => {
    const { W } = makeEnv();
    const rows = await W.EastmoneySource.getFullMarket();
    assert.ok(rows.length > 0, '全市场应非空');
    assert.equal(W.SourceState.get('em-clist').ok, true);
    assert.equal(rows.filter(r => r.code === '000001').length, 0, '指数行没被剔掉（宽度会被污染）');
  });

  await test('降级链F2：东财全市场挂 → 腾讯精选兜底（宽度仍可算）', async () => {
    const { W } = makeEnv({ blockHosts: ['push2delay.eastmoney.com'] });
    const rows = await W.EastmoneySource.getFullMarket();
    assert.equal(rows.length, 0, '主源应失败');
    assert.equal(W.SourceState.get('em-clist').ok, false, '未登记 em-clist 降级');

    // app.js 的兜底逻辑：universe 里的 A 股 + 产业链成分股走腾讯
    const syms = [];
    W.TENCENT_UNIVERSE.forEach(x => { if (x.group === 'cn' || x.group === 'index') syms.push(x.symbol); });
    W.INDUSTRY_CHAINS.forEach(c => c.links.forEach(l => l.stocks.forEach(s => syms.push(s.symbol))));
    const qs = await W.TencentSource.getQuotes([...new Set(syms)]);
    assert.ok(qs.length >= 60, '兜底仅 ' + qs.length + ' 只，热力图会太稀疏');
    const b = W.Breadth.compute(qs.map(q => ({ code: q.code, name: q.name, changePct: q.changePct })));
    assert.ok(b.total >= 60 && b.score !== null, '兜底数据算不出宽度');
    console.log('   （兜底 ' + qs.length + ' 只，仍可算宽度：情绪 ' + b.score.toFixed(1) + '）');
  });

  /* ---------- 链 G：加密 币安挂 → OKX 接管 ---------- */
  await test('降级链G1：币安挂 → OKX 接管', async () => {
    const { W } = makeEnv({ blockHosts: ['binance'] });
    const primary = await W.BinanceSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
    assert.equal(primary.length, 0, '主源应失败');
    assert.equal(W.SourceState.get('binance').ok, false, '未登记 binance 降级');

    const backup = await W.OkxSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
    assert.equal(backup.length, 2, 'OKX 接管数不对，实际 ' + backup.length);
    backup.forEach(q => assert.ok(q.price > 0, 'OKX 价格无效'));
    assert.equal(W.SourceState.get('okx').ok, true, 'OKX 未登记成功');
    console.log('   （OKX 接管成功：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
  });

  await test('降级链G2：币安 OKX 双挂 → 双双登记失败（交给缓存兜底）', async () => {
    const { W } = makeEnv({ blockHosts: ['binance', 'okx.com'] });
    assert.equal((await W.BinanceSource.getQuotes(['BTCUSDT'])).length, 0);
    assert.equal((await W.OkxSource.getQuotes(['BTCUSDT'])).length, 0);
    assert.equal(W.SourceState.get('binance').ok, false);
    assert.equal(W.SourceState.get('okx').ok, false);
  });

  /* ---------- 链 H：外汇/商品 新浪无代理 → 明确拒绝 ---------- */
  await test('降级链H1：无代理时新浪按预期拒绝（返回空数组并登记需代理）', async () => {
    const { W } = makeEnv();
    // 未配 PROXY 时 sina.js 直接返回空数组（不发注定 403 的请求）
    const sina = await W.SinaSource.getQuotes(['fx_seurusd', 'hf_GC']);
    assert.equal(sina.length, 0, '无代理时应返回空数组');
    assert.equal(W.SourceState.get('sina').ok, false, '未登记 sina 降级');
    assert.match(W.SourceState.get('sina').msg, /proxy/i, '降级原因应说明需要代理');
    console.log('   （无代理 → sina 明确拒绝："' + W.SourceState.get('sina').msg + '"，界面走缓存）');
  });

  /* ---------- 链 I：K线 腾讯挂 → 东财 kline 备源 ---------- */
  await test('降级链I1：腾讯K线挂 → 东财 kline 备源接管（字段完整）', async () => {
    const { W } = makeEnv({ blockHosts: ['ifzq.gtimg.cn'] });
    const primary = await W.TencentSource.getKline('sh600519', 'day', 60);
    assert.equal(primary.length, 0, '主源应失败');
    const backup = await W.EastmoneySource.getKline('1.600519', 101, 60);
    assert.ok(Array.isArray(backup), '备源应返回数组');
    assert.ok(backup.length > 0, '东财 K 线备源应接管');
    backup.forEach(k => {
      assert.ok(k.open !== null && k.close !== null && k.high !== null && k.low !== null, 'K线字段缺失会毒化 MA');
      assert.ok(typeof k.time === 'string' && k.time.length === 10, 'K线时间格式异常');
    });
    console.log('   （东财K线备源返回 ' + backup.length + ' 根）');
  });

  /* ---------- 链 O：分钟级数据面（issue #1：分时切换看不到数据，2026-10-21 修复） ---------- */
  await test('链O1：美股分时走 usMinute/query（根因：minute/query 对美股是 200 空壳）', async () => {
    const { W } = makeEnv();
    const rows = await W.TencentSource.getMinute('usAAPL');
    assert.ok(rows.length >= 5, '应解析出分时点，实际 ' + rows.length);
    assert.equal(rows[0].volume, 0, '首点差分无意义，应为 0');
    assert.ok(rows[1].volume > 0, '第二点起是增量');
    const d = new Date(rows[0].time * 1000);
    assert.equal(d.getUTCFullYear(), 2026, '基准日取自 date 字段（伪 UTC 墙钟）');
    assert.equal(d.getUTCHours(), 9, '时分按墙钟数字直取');
  });

  await test('链O2：A股/港股分时仍走 minute/query（不回归）', async () => {
    const { W } = makeEnv();
    for (const code of ['sh600519', 'hk00700']) {
      const rows = await W.TencentSource.getMinute(code);
      assert.ok(rows.length >= 5, code + ' 分时应正常');
    }
  });

  await test('链O3：东财分钟K（港/美股唯一免费直连源）：墙钟 → 伪 UTC，OHLC 完整不接错位', async () => {
    const { W } = makeEnv();
    const rows = await W.EastmoneySource.getMinuteKline('116.00700', 'm5', 30);
    assert.equal(rows.length, 30, '30 根都要解析出来');
    const d = new Date(rows[0].time * 1000);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCHours(), 9, '时分按墙钟数字直取（09:3x）');
    assert.ok(rows.every(k => k.open !== null && k.close !== null && k.high !== null && k.low !== null), 'OHLC 完整');
    assert.ok(rows.every(k => k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close)), 'high/low 字段位不能接错（调研报告的机械验证法）');
  });

  await test('链O4：parseMinuteTime 纯函数：缺时分的行返回 null（日格式混入分钟响应被剔）', async () => {
    const { W } = makeEnv();
    assert.equal(W.EastmoneySource.parseMinuteTime('2026-01-02 09:35'), Date.UTC(2026, 0, 2, 9, 35) / 1000);
    assert.equal(W.EastmoneySource.parseMinuteTime('2026-01-02'), null, '只有日期没有时分 → 不可用');
    assert.equal(W.EastmoneySource.parseMinuteTime(''), null);
    assert.equal(W.EastmoneySource.parseMinuteTime(null), null);
  });

  await test('链O5：东财分钟K：周期白名单外 / 坏 secid → 空数组且不发请求', async () => {
    const { W } = makeEnv();
    assert.equal((await W.EastmoneySource.getMinuteKline('116.00700', 'm3')).length, 0, '未知周期');
    assert.equal((await W.EastmoneySource.getMinuteKline('bad secid', 'm5')).length, 0, '坏 secid（SSRF 入口收敛）');
  });

  /* ---------- 链 J：龙虎榜 / 南向 挂 → 缓存兜底 → 诚实空态 ---------- */
  await test('降级链J1：龙虎榜可达 → 落缓存；不可达 → 走缓存（via=cache）', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ storage });
    const first = await e1.W.LhbSource.getLhb();
    assert.ok(first.rows.length > 0, '龙虎榜应有数据');
    assert.equal(first.via, 'em');

    const e2 = makeEnv({ storage, blockHosts: ['datacenter-web.eastmoney.com'] });
    const second = await e2.W.LhbSource.getLhb();
    assert.equal(second.via, 'cache', '应走缓存，实际 ' + second.via);
    assert.ok(second.rows.length > 0, '缓存为空');
  });

  await test('降级链J2：龙虎榜不可达 + 无缓存 → 诚实空态（rows 空、不抛）', async () => {
    const { W } = makeEnv({ blockHosts: ['datacenter-web.eastmoney.com'] });
    const r = await W.LhbSource.getLhb();
    assert.equal(r.rows.length, 0);
    assert.equal(r.via, null);
    assert.equal(W.SourceState.get('lhb').ok, false, '未登记 lhb 降级');
  });

  await test('降级链J3：港股通南向不可达 → 空行 + 不抛错（不白屏）', async () => {
    const { W } = makeEnv({ blockHosts: ['datacenter-web.eastmoney.com'] });
    const r = await W.SouthboundSource.latest();
    assert.equal(r.rows.length, 0, '不可达时不该有行');
    assert.equal(r.date, null);
  });

  /* ---------- 链 K：全站最坏情况 ---------- */
  await test('降级链K1：所有源全挂 → 全部空数组/诚实空态、零异常', async () => {
    const { W } = makeEnv({
      blockHosts: [
        'qt.gtimg.cn', 'ifzq.gtimg.cn', 'eastmoney.com', 'binance', 'okx.com',
        'sinajs.cn', 'feed.mix.sina.com.cn', 'stlouisfed.org', STATIC_HOST,
      ],
    });
    const results = await Promise.all([
      W.TencentSource.getQuotes(['sh600519']),
      W.TencentSource.getKline('sh600519', 'day'),
      W.TencentSource.getMinute('sh600519'),
      W.EastmoneySource.getQuotes(['1.600519']),
      W.EastmoneySource.getFullMarket(),
      W.EastmoneySource.search('茅台'),
      W.BinanceSource.getQuotes(['BTCUSDT']),
      W.BinanceSource.getKline('BTCUSDT', '1d'),
      W.OkxSource.getQuotes(['BTCUSDT']),
      W.SinaSource.getQuotes(['fx_seurusd']),
      W.FredSource.getQuotes(),
    ]);
    results.forEach((r, i) => {
      assert.ok(Array.isArray(r), '第 ' + i + ' 项不是数组');
      assert.equal(r.length, 0, '第 ' + i + ' 项应为空，实际 ' + r.length);
    });
    // 新闻：双源全挂且无缓存 → none（诚实空态，不白屏）
    const news = await W.NewsSource.getNews();
    assert.equal(news.list.length, 0);
    assert.equal(news.via, 'none');
    // 静态产物源：设计是"抛错"（上层兜底），不是返回空数组
    await assert.rejects(() => W.SecSource.get13F());
    await assert.rejects(() => W.EtfSource.getEtfHoldings());
    await assert.rejects(() => W.FundHoldsSource.getFundHolds());
    // 静态产物源自带兜底的一族：via=null + 空数组
    const ev = await W.EventsSource.getEvents();
    assert.equal(ev.via, null);
    assert.equal(ev.events.length, 0);
    const pm = await W.PmSource.getMarkets();
    assert.equal(pm.via, null);
    assert.equal(pm.events.length, 0);
    // 宽度计算对空数据也不能崩
    const b = W.Breadth.compute([]);
    assert.equal(b.score, null);
    assert.equal(b.total, 0);
    console.log('   （11 个取数入口 + 新闻 + 静态产物源 + 宽度全部安全降级，无一抛异常）');
  });

  /* ---------- 链 L：研报源已下线（用例改写的锚点） ---------- */
  await test('降级链L1：研报源已随 6df7dd1 下线（沙箱里不该再有 ReportSource）', async () => {
    const { W } = makeEnv();
    assert.equal(typeof W.ReportSource, 'undefined', '研报源已下线，别把已删的源写回测试');
  });

  /* ---------- 链 M：离线组自证——零真实网络请求 ---------- */
  await test('降级链M1：离线组全程零真实网络请求（每个请求都被假上游/静态产物接住）', async () => {
    assert.equal(netLeaks.length, 0, '有请求漏到真实网络：' + netLeaks[0]);
  });
}

/* ==================== 实网组（--net，需外网） ==================== */
if (NET) {
  const netEnv = (blockHosts) => makeEnv({ fake: false, offline: false, blockHosts });
  const down = (env) => env.netErrors.length > 0;

  await test('降级链N1：腾讯挂 → 东财 secid 接管同一批标的（实网）', async () => {
    const env = netEnv(['qt.gtimg.cn', 'ifzq.gtimg.cn']);
    const { W } = env;
    const syms = ['sh600519', 'hk00700', 'usAAPL', 'sh000001'];
    const primary = await W.TencentSource.getQuotes(syms);
    assert.equal(primary.length, 0, '主源应失败');
    assert.equal(W.SourceState.get('tencent').ok, false, '未登记 tencent 降级');
    const map = new Map(syms.map(s => [toSecid(s), s]));
    const backup = await W.EastmoneySource.getQuotes([...map.keys()]);
    if (down(env)) skipBecause('本机外网不可达：' + env.netErrors[0]);
    assert.ok(backup.length >= 3, '备源只回 ' + backup.length + '/4');
    backup.forEach(q => assert.ok(q.price > 0, q.name + ' 备源价格无效'));
    console.log('   （备源取到：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
  });

  await test('降级链N2：东财全市场挂 → 腾讯精选兜底（实网）', async () => {
    const env = netEnv(['push2delay.eastmoney.com']);
    const { W } = env;
    const rows = await W.EastmoneySource.getFullMarket();
    assert.equal(rows.length, 0, '主源应失败');
    assert.equal(W.SourceState.get('em-clist').ok, false, '未登记 em-clist 降级');
    const syms = [];
    W.TENCENT_UNIVERSE.forEach(x => { if (x.group === 'cn' || x.group === 'index') syms.push(x.symbol); });
    W.INDUSTRY_CHAINS.forEach(c => c.links.forEach(l => l.stocks.forEach(s => syms.push(s.symbol))));
    const qs = await W.TencentSource.getQuotes([...new Set(syms)]);
    if (down(env)) skipBecause('本机外网不可达：' + env.netErrors[0]);
    assert.ok(qs.length >= 60, '兜底仅 ' + qs.length + ' 只');
    const b = W.Breadth.compute(qs.map(q => ({ code: q.code, name: q.name, changePct: q.changePct })));
    assert.ok(b.total >= 60 && b.score !== null, '兜底数据算不出宽度');
    console.log('   （兜底 ' + qs.length + ' 只，仍可算宽度：情绪 ' + b.score.toFixed(1) + '）');
  });

  await test('降级链N3：币安挂 → OKX 接管（实网；OKX 不可达则确认双挂已登记）', async () => {
    const env = netEnv(['binance.vision', 'api.binance.com', 'api1.binance.com']);
    const { W } = env;
    const primary = await W.BinanceSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
    assert.equal(primary.length, 0, '主源应失败');
    assert.equal(W.SourceState.get('binance').ok, false, '未登记 binance 降级');
    const backup = await W.OkxSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
    if (backup.length) {
      backup.forEach(q => assert.ok(q.price > 0, 'OKX 价格无效'));
      console.log('   （OKX 接管成功：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
    } else {
      // 本机网络 OKX 不可达属已知情况：此时必须双双登记失败，交由缓存兜底
      assert.equal(W.SourceState.get('okx').ok, false, 'OKX 失败未登记');
      console.log('   （本网 OKX 不可达 → 双源失败已登记，界面走缓存兜底）');
    }
  });

  await test('降级链N4：腾讯K线挂 → 东财 kline 备源（实网；不可达时返回空不抛）', async () => {
    const env = netEnv(['ifzq.gtimg.cn']);
    const { W } = env;
    const primary = await W.TencentSource.getKline('sh600519', 'day', 60);
    assert.equal(primary.length, 0, '主源应失败');
    const backup = await W.EastmoneySource.getKline('1.600519', 101, 60);
    assert.ok(Array.isArray(backup), '备源应返回数组');
    console.log('   （东财K线备源返回 ' + backup.length + ' 根' +
      (backup.length ? '' : '：本网 push2his 不可达，界面显示空态提示') + '）');
  });

  await test('降级链N5：新闻主源挂 → 东财备源接管（实网）', async () => {
    const env = netEnv(['feed.mix.sina.com.cn']);
    const { W } = env;
    const r = await W.NewsSource.getNews();
    if (down(env)) skipBecause('本机外网不可达：' + env.netErrors[0]);
    assert.ok(r.list.length > 0, '备源也没数据');
    assert.equal(r.via, 'eastmoney', '应标记为备源，实际 ' + r.via);
    r.list.slice(0, 5).forEach(it => {
      assert.ok(it.title.length > 0, '标题为空');
      assert.ok(/^https?:\/\//.test(it.url), 'URL 非法');
      assert.ok(it.time > 0, '时间戳无效');
    });
    console.log('   （东财接管 ' + r.list.length + ' 条，首条："' + r.list[0].title.slice(0, 24) + '..."）');
  });

  await test('降级链N6：新闻双源全挂 → 用缓存 + 标记 cache（不白屏，实网）', async () => {
    const storage = makeStorage();
    const e1 = makeEnv({ fake: false, offline: false, storage });
    const first = await e1.W.NewsSource.getNews();
    if (e1.netErrors.length) skipBecause('本机外网不可达：' + e1.netErrors[0]);
    assert.ok(first.list.length > 0, '首次抓取失败，无法验证缓存');
    // 复用同一份缓存，但让两个源都挂
    const e2 = makeEnv({ fake: false, offline: false, storage, blockHosts: ['feed.mix.sina.com.cn', 'np-listapi.eastmoney.com'] });
    const second = await e2.W.NewsSource.getNews();
    assert.equal(second.via, 'cache', '应回落到缓存，实际 ' + second.via);
    assert.ok(second.list.length > 0, '缓存为空');
    assert.ok(second.cachedAt > 0, '缺缓存时间戳（界面要显示 · 缓存 HH:MM:SS）');
    console.log('   （双挂 → 缓存 ' + second.list.length + ' 条，时间戳 ' +
      new Date(second.cachedAt).toLocaleTimeString('zh-CN') + '）');
  });
}

console.log(`\n${pass} passed, ${fail} failed` + (skip ? `, ${skip} skipped` : ''));
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
