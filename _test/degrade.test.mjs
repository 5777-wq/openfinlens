/* 降级链实测（QA 协议 D1）：逐条把主源 URL 改坏，验证 → 备源接管 / 缓存兜底 / 状态登记为降级。
   做法：拦截 vm 上下文里的 fetch，按主机名黑名单模拟"该主源挂了"，其余照常走真实网络。
   用法：node _test/degrade.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

// blockHosts: 命中即抛错（模拟主源不可达 / URL 改坏）
function makeEnv(blockHosts = []) {
  const blocked = [];
  const ctx = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, TextDecoder, Promise, Error, RegExp, Map, Set, encodeURIComponent,
    URL, URLSearchParams, AbortController, AbortSignal, performance,
    fetch: (url, opts = {}) => {
      const u = String(url);
      if (blockHosts.some(h => u.includes(h))) {
        blocked.push(u.slice(0, 60));
        return Promise.reject(new Error('simulated failure: ' + h));
      }
      return fetch(u, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
    },
    document: {
      documentElement: {}, body: {},
      createElement: () => ({ style: {}, remove() {}, addEventListener() {} }),
      head: { appendChild() {} }, querySelectorAll: () => [], addEventListener() {},
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  ['js/utils.js', 'js/store.js', 'js/proxy.js', 'js/breadth.js',
    'js/data/universe.js', 'js/data/industry-chains.js',
    'js/sources/tencent.js', 'js/sources/sina.js', 'js/sources/eastmoney.js',
    'js/sources/okx.js', 'js/sources/binance.js', 'js/sources/fred.js',
    'js/sources/news.js', 'js/sources/report.js',
  ].forEach(f => vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const W = vm.runInContext('window', ctx);
  return { W, blocked };
}

const toSecid = (s) => /^sh/.test(s) ? '1.' + s.slice(2)
  : /^(sz|bj)/.test(s) ? '0.' + s.slice(2)
    : /^hk/.test(s) ? '116.' + s.slice(2)
      : /^us/.test(s) ? '105.' + s.slice(2) : null;

/* ---------- 链 1：A股/港股/美股/指数  tencent → eastmoney secid ---------- */
await test('降级链1：腾讯挂 → 东财 secid 接管同一批标的', async () => {
  const { W, blocked } = makeEnv(['qt.gtimg.cn', 'ifzq.gtimg.cn']);
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
  console.log('   （备源取到：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
});

/* ---------- 链 2：A股全市场  eastmoney clist → tencent 精选兜底 ---------- */
await test('降级链2：东财全市场挂 → 腾讯精选兜底（热力图不空）', async () => {
  const { W } = makeEnv(['push2delay.eastmoney.com']);
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

/* ---------- 链 3：加密  binance → okx ---------- */
await test('降级链3：币安挂 → OKX 接管（本网 OKX 不可达则确认双挂后走缓存）', async () => {
  const { W } = makeEnv(['binance.vision', 'api.binance.com', 'api1.binance.com']);
  const primary = await W.BinanceSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
  assert.equal(primary.length, 0, '主源应失败');
  assert.equal(W.SourceState.get('binance').ok, false, '未登记 binance 降级');

  const backup = await W.OkxSource.getQuotes(['BTCUSDT', 'ETHUSDT']);
  if (backup.length) {
    backup.forEach(q => assert.ok(q.price > 0, 'OKX 价格无效'));
    console.log('   （OKX 接管成功：' + backup.map(q => q.name + ' ' + q.price).join(' / ') + '）');
  } else {
    // 本机网络 OKX 不可达属已知情况：此时必须双双登记失败，交由缓存兜底
    assert.equal(W.OkxSource ? W.SourceState.get('okx').ok : false, false, 'OKX 失败未登记');
    console.log('   （本网 OKX 不可达 → 双源失败已登记，界面走缓存兜底）');
  }
});

/* ---------- 链 4：外汇/商品/宏观  eastmoney → sina(需代理) ---------- */
await test('降级链4：东财报价挂 → 无代理时新浪按预期拒绝（返回空数组不抛）', async () => {
  const { W } = makeEnv(['push2delay.eastmoney.com']);
  const primary = await W.EastmoneySource.getQuotes(['119.EURUSD', '101.GC00Y', '171.US10Y']);
  assert.equal(primary.length, 0, '主源应失败');

  // 未配 PROXY 时 sina.js 直接返回空数组（不发注定 403 的请求）
  const sina = await W.SinaSource.getQuotes(['fx_seurusd', 'hf_GC']);
  assert.equal(sina.length, 0, '无代理时应返回空数组');
  assert.equal(W.SourceState.get('sina').ok, false, '未登记 sina 降级');
  assert.match(W.SourceState.get('sina').msg, /proxy/i, '降级原因应说明需要代理');
  console.log('   （无代理 → sina 明确拒绝："' + W.SourceState.get('sina').msg + '"，界面走缓存）');
});

/* ---------- 链 5：新闻  sina roll → eastmoney news ---------- */
await test('降级链5：新浪滚动挂 → 东财新闻接管', async () => {
  const { W } = makeEnv(['feed.mix.sina.com.cn']);
  const r = await W.NewsSource.getNews();
  assert.ok(r.list.length > 0, '备源也没数据');
  assert.equal(r.via, 'eastmoney', '应标记为备源，实际 ' + r.via);
  r.list.slice(0, 5).forEach(it => {
    assert.ok(it.title.length > 0, '标题为空');
    assert.ok(/^https?:\/\//.test(it.url), 'URL 非法');
    assert.ok(it.time > 0, '时间戳无效');
  });
  console.log('   （东财接管 ' + r.list.length + ' 条，首条："' + r.list[0].title.slice(0, 24) + '..."）');
});

await test('降级链5b：新闻双源全挂 → 用缓存 + 标记 cache（不白屏）', async () => {
  const { W } = makeEnv([]);
  const first = await W.NewsSource.getNews();      // 先成功一次，写入缓存
  assert.ok(first.list.length > 0, '首次抓取失败，无法验证缓存');

  // 复用同一 W 的缓存，但让两个源都挂：直接替换 fetch 与 JSONP
  W.fetch = () => Promise.reject(new Error('down'));
  W.U.fetchJSONP = () => Promise.reject(new Error('down'));
  const second = await W.NewsSource.getNews();
  assert.equal(second.via, 'cache', '应回落到缓存，实际 ' + second.via);
  assert.ok(second.list.length > 0, '缓存为空');
  assert.ok(second.cachedAt > 0, '缺缓存时间戳（界面要显示 · 缓存 HH:MM:SS）');
  console.log('   （双挂 → 缓存 ' + second.list.length + ' 条，时间戳 ' + new Date(second.cachedAt).toLocaleTimeString('zh-CN') + '）');
});

/* ---------- 链 6：研报  eastmoney reportapi → 缓存 → 隐藏 ---------- */
await test('降级链6：研报源挂 → 无缓存时返回空并标记 none（界面隐藏研报区）', async () => {
  const { W } = makeEnv(['reportapi.eastmoney.com']);
  const r = await W.ReportSource.getReports({ code: '*' });
  assert.equal(r.list.length, 0, '应无数据');
  assert.equal(r.via, 'none', '应标记 none，实际 ' + r.via);
  assert.equal(W.SourceState.get('report').ok, false, '未登记 report 降级');
});

await test('降级链6b：研报源先成功再挂 → 走缓存并带时间戳', async () => {
  const { W } = makeEnv([]);
  const ok = await W.ReportSource.getReports({ code: '*', pageSize: 10 });
  assert.ok(ok.list.length > 0, '首次抓取失败');
  W.fetch = () => Promise.reject(new Error('down'));
  const cached = await W.ReportSource.getReports({ code: '*', pageSize: 10 });
  assert.equal(cached.via, 'cache', '应走缓存，实际 ' + cached.via);
  assert.equal(cached.list.length, ok.list.length, '缓存条数不一致');
  assert.ok(cached.cachedAt > 0, '缺缓存时间戳');
});

/* ---------- 链 7：K线降级 ---------- */
await test('降级链7：腾讯K线挂 → 东财 kline 备源（不可达时返回空不抛）', async () => {
  const { W } = makeEnv(['ifzq.gtimg.cn']);
  const primary = await W.TencentSource.getKline('sh600519', 'day', 60);
  assert.equal(primary.length, 0, '主源应失败');
  const backup = await W.EastmoneySource.getKline('1.600519', 101, 60);
  // 本网 push2his 不可达 → 允许为空，但必须是空数组而非抛异常
  assert.ok(Array.isArray(backup), '备源应返回数组');
  console.log('   （东财K线备源返回 ' + backup.length + ' 根' + (backup.length ? '' : '：本网 push2his 不可达，界面显示空态提示') + '）');
});

/* ---------- 全站最坏情况 ---------- */
await test('最坏情况：所有源全挂 → 全部返回空数组、零异常、状态全标降级', async () => {
  const { W } = makeEnv([
    'qt.gtimg.cn', 'ifzq.gtimg.cn', 'eastmoney.com', 'binance', 'okx.com',
    'sinajs.cn', 'feed.mix.sina.com.cn', 'stlouisfed.org',
  ]);
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
  const news = await W.NewsSource.getNews();
  assert.equal(news.list.length, 0);
  assert.equal(news.via, 'none');
  const rep = await W.ReportSource.getReports({ code: '*' });
  assert.equal(rep.list.length, 0);
  assert.equal(rep.via, 'none');
  // 宽度计算对空数据也不能崩
  const b = W.Breadth.compute([]);
  assert.equal(b.score, null);
  assert.equal(b.total, 0);
  console.log('   （11 个取数入口 + 新闻 + 研报 + 宽度全部安全降级，无一抛异常）');
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
