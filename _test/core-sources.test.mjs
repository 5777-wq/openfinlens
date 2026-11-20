/* core/sources/history.mjs：三级降级链离线核对（注入假传输层，全程零网络）。
   覆盖：解析器黄金值（东财/雅虎/腾讯报价）、降级链东财→雅虎→腾讯、
   东财熔断状态机、后复权锚定、缓存合并与新鲜度。
   用法：node _test/core-sources.test.mjs */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}
const APPROX = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const ENC = (s) => Buffer.from(s, 'utf8');

const H = await imp('core/sources/history.mjs');

/* 假传输层：URL 前缀 → 响应；throw 路由模拟网络故障 */
function makeTransport(routes) {
  return async (url) => {
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url);
    }
    throw new Error('transport: 未注册的 URL ' + url.slice(0, 80));
  };
}

const EAST_FIXTURE = JSON.stringify({
  data: { name: '苹果公司', klines: [
    '2026-01-05,180.0,182.5,183.0,179.0,12345678',
    '2026-01-06,182.5,181.0,184.0,180.5,12000000',
    '2026-01-07,181.0,185.2,186.0,180.9,13000000',   // close=0 行会被过滤：下面再造一行脏数据
  ] },
});

const YAHOO_FIXTURE = JSON.stringify({
  chart: { result: [{
    timestamp: [1767225600, 1767312000, 1767398400],   // 2026-01-01..03 UTC → ET 日期
    indicators: {
      quote: [{ open: [10, 11, 12], close: [10.5, 11.5, 12.5], high: [11, 12, 13], low: [9.5, 10.5, 11.5] }],
      adjclose: [{ adjclose: [10.0, 11.0, 12.0] }],
    },
  }] },
});

/* 腾讯报价 fixture：字段串按位构造（f[1] 名称 / f[2] 代码 / f[3] 现价 / f[4] 昨收 / f[45] 总市值亿美元） */
function txQuote(price, prev, name, code, mcap) {
  const f = new Array(50).fill('');
  f[1] = name; f[2] = code; f[3] = price; f[4] = prev; f[45] = mcap;
  return 'v_usAAPL="' + f.join('~') + '";';
}

const TX_KLINE_FIXTURE = JSON.stringify({
  data: { usAAPL: { day: [
    ['2026-01-05', '180.0', '182.5', '183.0', '179.0', '12345678'],
    ['2026-01-06', '182.5', '181.0', '184.0', '180.5', '12000000'],
  ] } },
});

await test('parseEast：klines 行解析 + 脏行过滤', () => {
  const r = H.parseEast(EAST_FIXTURE);
  assert.equal(r.name, '苹果公司');
  assert.equal(r.bars.length, 3);
  assert.ok(APPROX(r.bars[0][2], 182.5));
  assert.equal(r.bars[0][0], '2026-01-05');
});

await test('parseYahoo：复权收盘 + 开高低按比例拉回复权口径 + ET 日期', () => {
  const bars = H.parseYahoo(YAHOO_FIXTURE);
  assert.equal(bars.length, 3);
  assert.ok(APPROX(bars[0][2], 10.0));                    // 收 = adjclose
  assert.match(bars[0][0], /^\d{4}-\d{2}-\d{2}$/);
  const o0 = bars[0][1];
  assert.ok(APPROX(o0, 9.5238, 1e-4), '开按当根比例缩放：rawO × (adj/rawC) = 10×(10/10.5)，toFixed(4) 舍入');
});

await test('parseQuotes：字段表解析 + 0 价故障行剔除', () => {
  const good = H.parseQuotes(txQuote('185.50', '184.00', '苹果', 'AAPL.OQ', '45678901234'));
  assert.equal(good.length, 1);
  assert.equal(good[0].code, 'AAPL.OQ');
  assert.equal(good[0].name, '苹果');
  assert.ok(APPROX(good[0].price, 185.5));
  const zero = H.parseQuotes(txQuote('0', '184.00', '苹果', 'AAPL.OQ', '1'));
  assert.equal(zero.length, 0, '0 价 = 上游故障行，必须剔除');
});

await test('getSeries 降级链：东财可达 → eastmoney/hfq', async () => {
  H.__resetState();
  H.__setEastGapMs(0);
  H.__setHttpTransport(makeTransport([
    ['https://push2his.eastmoney.com', () => ENC(EAST_FIXTURE)],
  ]));
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-core-'));
  try {
    const s = await H.getSeries('AAPL', { cacheDir: dir, bootstrapLmt: 100 });
    assert.ok(s && s.source === 'eastmoney' && s.adj === 'hfq');
    assert.equal(s.ticker, 'AAPL');
    assert.equal(s.name, '苹果公司');
    assert.equal(s.bars.length, 3);
    assert.ok(APPROX(s.bars[2][2], 185.2));
  } finally {
    H.__setHttpTransport(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('getSeries 降级链：东财熔断 → Yahoo 顶上（仍 hfq）', async () => {
  H.__resetState();
  H.__setEastGapMs(0);
  H.__setHttpTransport(makeTransport([
    ['https://push2his.eastmoney.com', () => { throw new Error('WAF 拒连'); }],
    ['https://push2delay.eastmoney.com', () => { throw new Error('WAF 拒连'); }],
    ['https://query1.finance.yahoo.com', () => ENC(YAHOO_FIXTURE)],
  ]));
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-core-'));
  try {
    const s1 = await H.getSeries('AAPL', { cacheDir: dir, bootstrapLmt: 100 });
    assert.ok(s1 && s1.source === 'yahoo' && s1.adj === 'hfq', '东财挂 → 第一轮先落 Yahoo');
    assert.equal(H.eastStatus().disabled, false, 'Meridian 口径：一次 eastKline 调用（6 个 URL 尝试）只记 1 次失败');
    const s2 = await H.getSeries('AAPL', { cacheDir: dir, bootstrapLmt: 100 });
    assert.equal(H.eastStatus().disabled, true, '第二轮再败 → fails=2 → 熔断');
    assert.ok(s2 && s2.source === 'yahoo', '熔断不影响本轮降级链继续走');
  } finally {
    H.__setHttpTransport(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('getSeries 降级链：东财+雅虎双挂 → 腾讯兜底 adj=raw', async () => {
  H.__resetState();
  H.__setEastGapMs(0);
  H.__setHttpTransport(makeTransport([
    ['https://push2his.eastmoney.com', () => { throw new Error('WAF'); }],
    ['https://push2delay.eastmoney.com', () => { throw new Error('WAF'); }],
    ['https://query1.finance.yahoo.com', () => { throw new Error('403'); }],
    ['https://query2.finance.yahoo.com', () => { throw new Error('403'); }],
    ['https://qt.gtimg.cn/', () => ENC(txQuote('185.50', '184.00', '苹果', 'AAPL.OQ', '1'))],
    ['https://web.ifzq.gtimg.cn/', () => ENC(TX_KLINE_FIXTURE)],
  ]));
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-core-'));
  try {
    const s = await H.getSeries('AAPL', { cacheDir: dir, bootstrapLmt: 100 });
    assert.ok(s && s.source === 'tencent' && s.adj === 'raw', '兜底必须是不复权口径并打 raw 标');
    assert.equal(s.bars.length, 2);
  } finally {
    H.__setHttpTransport(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('getSeries：全链皆挂 → null（绝不抛异常、绝不编造数据）', async () => {
  H.__resetState();
  H.__setEastGapMs(0);
  H.__setHttpTransport(async () => { throw new Error('全网断'); });
  const dir = mkdtempSync(path.join(tmpdir(), 'ofl-core-'));
  try {
    const s = await H.getSeries('AAPL', { cacheDir: dir, bootstrapLmt: 100 });
    assert.equal(s, null);
  } finally {
    H.__setHttpTransport(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('anchorSeries：hfq 序列按现价等比锚定，末根收盘 = 现价', () => {
  const series = { adj: 'hfq', bars: [['2026-01-05', 10, 11, 12, 9, 0], ['2026-01-06', 11, 12, 13, 10, 0]] };
  const a = H.anchorSeries(series, 100);
  assert.equal(a.anchored, true);
  assert.ok(APPROX(a.bars[1][2], 100));
  assert.ok(APPROX(a.bars[0][2], 100 * 11 / 12));
  assert.equal(H.anchorSeries({ adj: 'raw', bars: series.bars }, 100).anchored, undefined, 'raw 不锚定');
});

await test('mergeBars/cacheFreshEnough：按日期去重合并 + 新鲜度判定', () => {
  const old = [['2026-01-05', 1, 1, 1, 1, 0], ['2026-01-06', 1, 1, 1, 1, 0]];
  const neu = [['2026-01-06', 1, 9, 1, 1, 0], ['2026-01-07', 1, 1, 1, 1, 0]];
  const m = H.mergeBars(old, neu);
  assert.equal(m.length, 3);
  assert.ok(APPROX(m[1][2], 9), '新数据覆盖同日');
  assert.ok(m[0][0] < m[2][0], '升序');
  assert.equal(H.cacheFreshEnough([['2026-01-15', 1, 1, 1, 1, 0]], '2026-01-16'), true);
  assert.equal(H.cacheFreshEnough([['2026-01-02', 1, 1, 1, 1, 0]], '2026-01-16'), false, '落后 >1 个交易日 = 不新鲜');
  assert.equal(H.cacheFreshEnough([['not-a-date', 1, 1, 1, 1, 0]], '2026-01-16'), false, '非法日期一律不新鲜');
});

console.log('\n===== 汇总 =====');
console.log(`共 ${pass + fail} 组断言块：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
