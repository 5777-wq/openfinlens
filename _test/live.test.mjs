/* 实网集成校验（Node 直跑）：逐项验证降级链上每个数据源真实可用 + 产业链代码全部有效
   用法：node _test/live.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); results.push([name, true]); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); results.push([name, false, e.message]); }
}
const get = (url, opts = {}) => fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });

/* ---------- 1. 腾讯：A股/港股/美股/指数 ---------- */
await test('腾讯行情：上证/茅台/腾讯/苹果 全部返回有效价格', async () => {
  const res = await get('https://qt.gtimg.cn/q=sh000001,sh600519,hk00700,usAAPL');
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
  const lines = text.split(';').filter(l => l.includes('v_'));
  assert.ok(lines.length >= 4, '返回 ' + lines.length + ' 条');
  lines.forEach(l => {
    const m = l.match(/v_([A-Za-z0-9._]+)="(.*)"/);
    const f = m[2].split('~');
    const price = Number(f[3]);
    assert.ok(Number.isFinite(price) && price > 0, m[1] + ' 价格无效: ' + f[3]);
    assert.ok(f[1] && !/^\?+$/.test(f[1]), m[1] + ' 名称乱码: ' + f[1]);
  });
});

await test('腾讯K线：日K/周K 结构正确（开收高低成交量）', async () => {
  for (const period of ['day', 'week']) {
    const r = await get(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,${period},,,10,qfq`);
    const j = await r.json();
    const rows = j.data.sh600519['qfq' + period] || j.data.sh600519[period];
    assert.ok(rows && rows.length >= 3, period + ' 数据不足');
    rows.forEach(row => {
      assert.match(row[0], /^\d{4}-\d{2}-\d{2}$/, period + ' 日期格式');
      [1, 2, 3, 4].forEach(i => assert.ok(Number.isFinite(Number(row[i])), period + ' OHLC 非数字'));
      const [o, c, h, l] = [1, 2, 3, 4].map(i => Number(row[i]));
      assert.ok(h >= Math.max(o, c) - 0.01 && l <= Math.min(o, c) + 0.01, period + ' 高低价逻辑错误');
    });
  }
});

await test('腾讯分时：A股/港股/美股 均返回分钟点', async () => {
  for (const sym of ['sh600519', 'hk00700', 'usAAPL']) {
    const r = await get('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + sym);
    const j = await r.json();
    const rows = j?.data?.[sym]?.data?.data;
    assert.ok(Array.isArray(rows) && rows.length >= 1, sym + ' 无分时数据');
    const p = rows[0].split(/\s+/);
    assert.match(p[0], /^\d{4}$/, sym + ' 时间格式 ' + p[0]);
    assert.ok(Number.isFinite(Number(p[1])), sym + ' 价格非数字');
  }
});

/* ---------- 2. 东财：全市场 / 通用报价 / 搜索 / 研报 ---------- */
// 港股/美股的市场过滤常量（热力图与美股宽度共用）：裸 m:116 会混进 1.7 万条权证/牛熊证，
// 必须带 t: 类型位。同时验证"按市值排序取 Top"这条路径——热力图的市值 Top 500 就靠它。
await test('东财港股/美股市场过滤：Top 段都是有市值的正股，可按市值排序取 Top', async () => {
  const cases = [
    { name: '港股', fs: 'm:116+t:3,m:116+t:4', minTotal: 1000 },
    { name: '美股', fs: 'm:105,m:106,m:107', minTotal: 3000 },
  ];
  for (const c of cases) {
    const mk = (fid) => `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=${fid}&fs=${c.fs}&fields=f2,f3,f12,f13,f14,f20`;
    const byCap = await (await get(mk('f20'))).json();
    const rows = byCap && byCap.data && byCap.data.diff;
    assert.ok(rows && rows.length === 100, c.name + '：按市值排序首屏应 100 条');
    assert.ok(byCap.data.total > c.minTotal, c.name + '：总数 ' + byCap.data.total + ' 低于预期（过滤值可能已失效）');
    // 权证/牛熊证没有市值，按市值排序会落到末尾；Top20 必须全部有市值
    const noCap = rows.slice(0, 20).filter(x => !(typeof x.f20 === 'number' && x.f20 > 0));
    assert.equal(noCap.length, 0, c.name + '：Top20 里混进无市值条目 ' + noCap.map(x => x.f14).join(','));
    const first = rows[0];
    assert.ok(first.f14 && String(first.f14).length > 0, c.name + '：首条名称为空');
    console.log(`   （${c.name} 全市场 ${byCap.data.total} 只，市值第一 ${first.f14}）`);
  }
});

await test('东财全市场：分页可取满 5000+ 且字段完整', async () => {
  const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  const mk = (pn) => `https://push2delay.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f2,f3,f4,f12,f13,f14,f20`;
  const first = await (await get(mk(1))).json();
  const total = first.data.total;
  assert.ok(total > 4000, '总数仅 ' + total);
  assert.equal(first.data.diff.length, 100, '单页应 100 条');
  const pages = await Promise.all([2, 3, 30, 55].map(async p => (await (await get(mk(p))).json()).data.diff));
  pages.forEach((d, i) => assert.ok(d && d.length > 0, '第 ' + [2, 3, 30, 55][i] + ' 页为空'));
  // 清算时段守卫：深夜东财把 f2/f3 回 "-"，数值断言只在盘中有效
  if (first.data.diff.filter(x => typeof x.f3 === 'number').length < 5) {
    console.log('   （清算时段：f2/f3 全为 "-"，跳过数值形态断言）');
  } else {
    first.data.diff.slice(0, 20).forEach(x => {
      assert.ok(/^\d{6}$/.test(x.f12), '代码格式 ' + x.f12);
      assert.ok(typeof x.f3 === 'number', '涨跌幅应为 number（fltt=2）');
      assert.ok(x.f14 && x.f14.length > 0, '名称为空');
    });
  }
});

await test('东财报价：外汇 / 商品 / 国债收益率 secid 全部有效', async () => {
  const secids = ['133.USDCNH', '119.EURUSD', '119.GBPUSD', '119.USDJPY', '119.USDHKD', '100.UDI',
    '101.GC00Y', '101.SI00Y', '101.HG00Y', '102.CL00Y', '102.NG00Y', '103.ZC00Y',
    '171.US10Y', '171.US2Y', '171.US30Y', '171.CN10Y', '171.DE10Y', '171.JP10Y'];
  const r = await get('https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=' +
    secids.join(',') + '&fields=f1,f2,f3,f4,f12,f13,f14');
  const j = await r.json();
  const got = j.data.diff.map(x => x.f13 + '.' + x.f12);
  const missing = secids.filter(s => !got.includes(s));
  assert.equal(missing.length, 0, '这些 secid 无数据: ' + missing.join(','));
  j.data.diff.forEach(x => {
    // 周末/换月时上游对无数据合约返回字符串 "-"（前端 num() 转 null 显示 --，属正确降级）
    const okPrice = (typeof x.f2 === 'number' && x.f2 !== 0) || x.f2 === '-';
    assert.ok(okPrice, x.f14 + ' 价格无效 ' + x.f2);
    assert.ok(x.f14 && x.f14.length > 1, '名称缺失');
  });
});

await test('东财搜索：中文 / 代码 / 拼音 三种输入都有结果', async () => {
  const j1 = await (await get('https://searchapi.eastmoney.com/api/suggest/get?input=' + encodeURIComponent('茅台') + '&type=14&count=5')).json();
  assert.ok(j1.QuotationCodeTable.Data?.length > 0, '中文搜索无结果');
  assert.equal(j1.QuotationCodeTable.Data[0].Code, '600519');

  const j2 = await (await get('https://searchapi.eastmoney.com/api/suggest/get?input=600519&type=14&count=5')).json();
  assert.ok(j2.QuotationCodeTable.Data?.length > 0, '代码搜索无结果');

  // 拼音走 codetable（suggest 不支持拼音，实测 Data:null）
  const j3 = await (await get('https://search-codetable.eastmoney.com/codetable/search/web?client=web&keyword=maotai&pageIndex=1&pageSize=5')).json();
  assert.ok(j3.result?.length > 0, '拼音搜索无结果');
  assert.ok(j3.result.some(x => x.code === '600519'), '拼音 maotai 应命中 600519');
});

await test('东财搜索：JSONP 回调可用（浏览器端无 CORS 头时的通路）', async () => {
  const t = await (await get('https://searchapi.eastmoney.com/api/suggest/get?input=' + encodeURIComponent('茅台') + '&type=14&count=3&cb=__cbtest')).text();
  assert.ok(t.startsWith('__cbtest('), 'JSONP 未生效: ' + t.slice(0, 40));
  const t2 = await (await get('https://search-codetable.eastmoney.com/codetable/search/web?client=web&keyword=maotai&pageIndex=1&pageSize=3&cb=__cbtest')).text();
  assert.ok(t2.startsWith('__cbtest('), 'codetable JSONP 未生效');
});

await test('东财研报：全市场 + 个股，字段与评级齐全', async () => {
  const base = 'https://reportapi.eastmoney.com/report/list?industryCode=*&industry=*&rating=*&ratingChange=*' +
    '&beginTime=2025-01-01&endTime=2027-12-31&pageNo=1&fields=&qType=0&orgCode=&rcode=&p=1&pageNum=1';
  const all = await (await get(base + '&pageSize=20&code=*')).json();
  assert.ok(all.data?.length > 0, '全市场研报为空');
  all.data.forEach(x => {
    assert.ok(x.title?.length > 0, '标题为空');
    assert.ok(x.orgSName?.length > 0, '机构为空');
    assert.match(x.publishDate, /^\d{4}-\d{2}-\d{2}/, '日期格式 ' + x.publishDate);
  });
  const one = await (await get(base + '&pageSize=10&code=600519')).json();
  assert.ok(one.data?.length > 0, '个股研报为空');
  assert.ok(one.data.every(x => x.stockCode === '600519'), '个股研报串码');
  assert.ok(one.data.some(x => x.emRatingName), '无评级字段');
});

/* ---------- 3. 加密 ---------- */
await test('币安：精选币种行情 + K线（日/周/5分钟）', async () => {
  const syms = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
  const r = await get('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(syms)));
  const j = await r.json();
  assert.equal(j.length, syms.length, '返回 ' + j.length + ' 条');
  j.forEach(x => {
    assert.ok(Number(x.lastPrice) > 0, x.symbol + ' 价格无效');
    assert.ok(Number.isFinite(Number(x.priceChangePercent)), x.symbol + ' 涨跌幅无效');
    assert.ok(Number(x.quoteVolume) > 0, x.symbol + ' 成交额无效');
  });
  for (const iv of ['1d', '1w', '5m']) {
    const k = await (await get(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=5`)).json();
    assert.ok(k.length >= 3, iv + ' K线不足');
    k.forEach(row => {
      assert.ok(Number.isFinite(row[0]) && row[0] > 1e12, iv + ' 时间戳异常');
      [1, 2, 3, 4].forEach(i => assert.ok(Number(row[i]) > 0, iv + ' OHLC 无效'));
    });
  }
});

await test('加密热力图：全集 80 币可取（分批不被截断）', async () => {
  const src = readFileSync(path.join(ROOT, 'js/data/universe.js'), 'utf8');
  const list = JSON.parse(src.match(/const CRYPTO_UNIVERSE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,(\s*\])/, '$1'));
  assert.ok(list.length >= 60, '全集仅 ' + list.length);
  let ok = 0;
  for (let i = 0; i < list.length; i += 60) {
    const part = list.slice(i, i + 60);
    const r = await get('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(part)));
    if (!r.ok) throw new Error('批次 ' + i + ' HTTP ' + r.status + '（存在无效交易对）');
    const j = await r.json();
    ok += j.length;
  }
  assert.ok(ok >= 60, '有效币种仅 ' + ok + '/' + list.length);
  console.log('   （加密全集有效 ' + ok + ' / ' + list.length + '）');
});

/* ---------- 4. 新闻 ---------- */
await test('新闻主源（新浪滚动 JSONP）可用且字段完整', async () => {
  // 回调名不能以下划线开头（实测 "_cb"/"__cb" 均返回 callback illegal character）
  const t = await (await get('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num=20&page=1&callback=gfdcbprobe')).text();
  assert.ok(t.includes('gfdcbprobe('), '新浪 JSONP 未生效: ' + t.slice(0, 40));
  // 新浪返回 try{cb({...});}catch(e){}; —— 与浏览器 <script> 执行路径一致
  let payload = null;
  new Function('gfdcbprobe', t)(d => { payload = d; });
  assert.ok(payload, 'JSONP 回调未触发');
  const list = payload.result.data;
  assert.ok(list.length >= 10, '新闻仅 ' + list.length + ' 条');
  list.slice(0, 10).forEach(it => {
    assert.ok(it.title?.length > 0, '标题为空');
    assert.ok(/^https?:\/\//.test(it.url), 'URL 非法 ' + it.url);
    assert.ok(Number(it.ctime) > 1e9, '时间戳异常 ' + it.ctime);
  });
});

await test('新闻备源（东财）可用：req_trace 必填已处理', async () => {
  const bad = await (await get('https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=348&order=1&page_index=1&page_size=3')).json();
  assert.ok(String(bad.message || '').includes('req_trace'), '备源不再要求 req_trace？实际: ' + bad.message);
  const good = await (await get('https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=348&order=1&needInteractData=0&page_index=1&page_size=10&req_trace=t' + Date.now())).json();
  const list = good.data?.list || [];
  assert.ok(list.length >= 5, '备源新闻仅 ' + list.length + ' 条');
  list.forEach(it => {
    assert.ok(it.title?.length > 0, '标题为空');
    assert.match(it.showTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, '时间格式 ' + it.showTime);
    assert.ok(/^https?:\/\//.test(it.uniqueUrl || it.url || ''), 'URL 非法');
  });
});

/* ---------- 5. 产业链成分股：逐一实测 ---------- */
await test('产业链：全部成分股代码真实有效（价格非 0、名称匹配）', async () => {
  const src = readFileSync(path.join(ROOT, 'js/data/industry-chains.js'), 'utf8');
  const stocks = [...src.matchAll(/\{\s*name:\s*'([^']+)',\s*symbol:\s*'([A-Za-z0-9.]{4,12})'\s*\}/g)]
    .map(m => ({ name: m[1], symbol: m[2] }));
  assert.ok(stocks.length >= 120, '全球版成分股应 ≥120 只，仅解析到 ' + stocks.length + ' 只');

  const quotes = new Map();
  for (let i = 0; i < stocks.length; i += 50) {
    const part = stocks.slice(i, i + 50);
    const res = await get('https://qt.gtimg.cn/q=' + part.map(s => s.symbol).join(','));
    const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
    text.split(';').forEach(line => {
      const m = line.match(/v_([A-Za-z0-9.]+)="(.*)"/);
      if (!m) return;
      const f = m[2].split('~');
      quotes.set(m[1], { name: f[1], price: Number(f[3]) });
    });
  }

  const bad = [];
  stocks.forEach(s => {
    const q = quotes.get(s.symbol);
    if (!q) { bad.push(`${s.name}(${s.symbol}) 无行情`); return; }
    if (!(q.price > 0)) { bad.push(`${s.name}(${s.symbol}) 价格=${q.price}`); return; }
    // 剥离空格、-W/-U 后缀、*ST 标记，以及 XD/XR/DR/N 等除权除息/新股临时前缀
    const norm = (x) => x.replace(/\s|-W$|-U$|\*|ST/g, '').replace(/^(XD|XR|DR|N)/, '');
    // 带前缀时上游可能截断简称（"传音控股"→"XD传音控"），按双向包含判定
    const a = norm(q.name), b = norm(s.name);
    if (!(a.includes(b) || b.includes(a))) bad.push(`${s.symbol} 名称不符：定义"${s.name}" 实际"${q.name}"`);
  });
  assert.equal(bad.length, 0, '\n     ' + bad.join('\n     '));
  console.log('   （已核对 ' + stocks.length + ' 只成分股，全部有效）');
});

/* ---------- 6. universe 全量校验 ---------- */
await test('universe：腾讯侧 24 个代码全部返回有效行情', async () => {
  const src = readFileSync(path.join(ROOT, 'js/data/universe.js'), 'utf8');
  const block = src.slice(src.indexOf('TENCENT_UNIVERSE'), src.indexOf('EM_UNIVERSE'));
  const syms = [...block.matchAll(/symbol:\s*'([A-Za-z0-9]+)'/g)].map(m => m[1]);
  assert.ok(syms.length >= 20, '仅 ' + syms.length + ' 个');
  const res = await get('https://qt.gtimg.cn/q=' + syms.join(','));
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
  const bad = [];
  syms.forEach(s => {
    const m = text.match(new RegExp('v_' + s + '="([^"]*)"'));
    if (!m) { bad.push(s + ' 无返回'); return; }
    const f = m[1].split('~');
    if (!(Number(f[3]) > 0)) bad.push(s + ' 价格=' + f[3]);
  });
  assert.equal(bad.length, 0, bad.join(', '));
  console.log('   （已核对 ' + syms.length + ' 个 universe 代码）');
});

/* ---------- 7. 降级链：主源失效时备源接管 ---------- */
await test('降级链：腾讯挂了 → 东财 secid 能补齐同一批标的', async () => {
  // 模拟：把 A股/港股/美股 映射成东财 secid 再取
  const map = { 'sh600519': '1.600519', 'sz300750': '0.300750', 'hk00700': '116.00700', 'usAAPL': '105.AAPL' };
  const r = await get('https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=' +
    Object.values(map).join(',') + '&fields=f2,f3,f4,f12,f13,f14');
  const j = await r.json();
  assert.equal(j.data.diff.length, 4, '备源只返回 ' + j.data.diff.length + '/4');
  // 清算时段 f2/f3 为 "-"（字符串），只断言"备源有数据"；数值形态盘中另测
  j.data.diff.forEach(x => {
    const ok = (typeof x.f2 === 'number' && x.f2 > 0 && typeof x.f3 === 'number') || x.f2 === '-';
    assert.ok(ok, x.f14 + ' 备源数据无效: ' + x.f2 + '/' + x.f3);
  });
});

await test('降级链：新浪直连需 Referer（无代理必然 403 → 走备源符合预期）', async () => {
  const r = await fetch('https://hq.sinajs.cn/list=sh600519', {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(r.status, 403, '新浪直连状态 ' + r.status + '（若已变 200，可把外汇主源切回新浪）');
  const r2 = await fetch('https://hq.sinajs.cn/list=sh600519', {
    headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(r2.status, 200, '带 Referer 应 200（代理层可用）');
  const t = new TextDecoder('gbk').decode(await r2.arrayBuffer());
  assert.ok(t.includes('贵州茅台'), '代理路径数据异常');
});

await test('CORS：浏览器端直连所需的响应头齐全（含 file:// 的 Origin: null）', async () => {
  const checks = [
    ['qt.gtimg.cn', 'https://qt.gtimg.cn/q=sh000001'],
    ['web.ifzq.gtimg.cn', 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,2,qfq'],
    ['push2delay', 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=1.600519&fields=f2,f12'],
    ['reportapi', 'https://reportapi.eastmoney.com/report/list?industryCode=*&industry=*&rating=*&ratingChange=*&beginTime=2025-01-01&endTime=2027-12-31&pageNo=1&qType=0&code=*&p=1&pageNum=1&pageSize=1'],
    ['np-listapi', 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=348&order=1&page_index=1&page_size=1&req_trace=t1'],
    ['binance.vision', 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT'],
  ];
  const bad = [];
  for (const [name, url] of checks) {
    const r = await get(url, { headers: { Origin: 'null' } });
    const acao = r.headers.get('access-control-allow-origin');
    if (!acao) bad.push(name + ' 缺 ACAO 头');
  }
  assert.equal(bad.length, 0, bad.join(', '));
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
