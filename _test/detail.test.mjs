/* 详情页数据链路校验（Node 直跑，覆盖浏览器点击之外的全部取数与变换逻辑）：
   分时 / 日K / 周K 三周期 × A股·港股·美股·加密，MA 与行情软件口径核对，secid↔腾讯代码互转。
   用法：node _test/detail.test.mjs */

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

/* ---- 在 Node 里加载真实适配器（提供最小 window/fetch 环境） ---- */
function makeCtx() {
  const ctx = {
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, TextDecoder, Promise, Error, RegExp, Map, Set, encodeURIComponent, URL, URLSearchParams, AbortSignal,
    AbortController,
    fetch: (url, opts = {}) => fetch(url, {
      ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000),
    }),
    document: { documentElement: {}, body: {}, createElement: () => ({ style: {}, remove() {}, addEventListener() {} }), head: { appendChild() {} }, querySelectorAll: () => [], addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  return vm.createContext(ctx);
}
const ctx = makeCtx();
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
load('js/utils.js'); load('js/store.js'); load('js/proxy.js');
load('js/sources/tencent.js'); load('js/sources/eastmoney.js'); load('js/sources/binance.js'); load('js/sources/okx.js');
load('js/sources/worldbank.js');
const W = vm.runInContext('window', ctx);

/* ---- 从 app.js / charts.js 抽取"真函数"在测（旧写法是手工复刻副本，
   已发生一次真实漂移：app.js 的 tencentOfSecid 加了北交所 bj 分支，副本没有，
   测试全绿但验证的不是线上代码） ---- */
const APP_SRC = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const CHARTS_SRC = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
const grabFn = (src, name) => {
  const m = src.match(new RegExp('function ' + name + '\\([\\w, ]*\\) \\{[\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('源码中找不到函数 ' + name);
  return new Function('return (' + m[0].replace(/^function \w+/, 'function') + ');')();
};
const toSecid = grabFn(APP_SRC, 'toSecid');
const tencentOfSecid = grabFn(APP_SRC, 'tencentOfSecid');
const calcMA = grabFn(CHARTS_SRC, 'calcMA');

/* ================= 代码互转 ================= */
await test('代码互转：腾讯 symbol ↔ 东财 secid 双向一致（含北交所 bj）', () => {
  const pairs = [['sh600519', '1.600519'], ['sz300750', '0.300750'], ['hk00700', '116.00700'],
    ['usAAPL', '105.AAPL'], ['bj920001', '0.920001'], ['sz000858', '0.000858']];
  pairs.forEach(([sym, secid]) => {
    assert.equal(toSecid(sym), secid, sym + ' → secid');
    assert.equal(tencentOfSecid(secid), sym, secid + ' → symbol');
  });
});

/* ================= 成交额单位与行情时间（P0-1 回归） ================= */
await test('成交额单位分流：A股/A股指数 ×1e4，港/美股及其指数 ×1', () => {
  assert.equal(W.TencentSource.amountScale('sh600519'), 1e4);
  assert.equal(W.TencentSource.amountScale('sh000001'), 1e4);
  assert.equal(W.TencentSource.amountScale('sz300750'), 1e4);
  assert.equal(W.TencentSource.amountScale('bj920001'), 1e4);
  assert.equal(W.TencentSource.amountScale('hk00700'), 1);
  assert.equal(W.TencentSource.amountScale('hkHSI'), 1);
  assert.equal(W.TencentSource.amountScale('usAAPL'), 1);
  assert.equal(W.TencentSource.amountScale('usINX'), 1);
});

await test('行情时间解析：北京域市场按 +8 折算，美股显式 null（时区诚实）', () => {
  // 2026-09-13 15:00:01 北京时间 = 07:00:01 UTC
  assert.equal(W.TencentSource.quoteTimeOf('20260913150001'), Date.UTC(2026, 8, 13, 7, 0, 1));
  assert.equal(W.TencentSource.quoteTimeOf('20260913 15:00:01'), Date.UTC(2026, 8, 13, 7, 0, 1));
  assert.equal(W.TencentSource.quoteTimeOf(''), null);
});

await test('实数据量级：港/美股成交额是元级（旧 bug 曾放大 1 万倍显示 66.7 万亿）', async () => {
  const qs = await W.TencentSource.getQuotes(['sh600519', 'sh000001', 'hk00700', 'usAAPL']);
  const by = Object.fromEntries(qs.map(q => [q.symbol, q]));
  // A股：f[37] 单位是万，×1e4 后为元级（茅台日成交通常数十亿元）
  assert.ok(by['sh600519'] && by['sh600519'].amount > 1e8 && by['sh600519'].amount < 1e12,
    '茅台成交额应在亿~千亿级: ' + (by['sh600519'] || {}).amount);
  assert.ok(by['sh000001'] && by['sh000001'].amount > 1e9 && by['sh000001'].amount < 5e13,
    '上证成交额应在百亿~万亿级: ' + (by['sh000001'] || {}).amount);
  // 港/美股：接口已是元，×1（旧 bug 值 6.7e13 必然越界）
  assert.ok(by['hk00700'] && by['hk00700'].amount > 1e7 && by['hk00700'].amount < 5e11,
    '腾讯控股成交额应约数十亿港元级: ' + (by['hk00700'] || {}).amount);
  assert.ok(by['usAAPL'] && by['usAAPL'].amount > 1e7 && by['usAAPL'].amount < 5e11,
    '苹果成交额应约数十亿美元级: ' + (by['usAAPL'] || {}).amount);
});

await test('世界银行：8 国 ×6 指标 ≥32 非空（P0-2 回归：码位错位时为 0）', async () => {
  const data = await W.WorldBankSource.getMacro();
  assert.ok(data, 'getMacro 不应返回 null（全部为空=索引键仍错位）');
  const filled = data.rows.reduce((s, r) => s + Object.values(r.values).filter(Boolean).length, 0);
  assert.ok(filled >= 32, '非空指标仅 ' + filled + ' / 48（应 ≥32，错位时为 0）');
});

/* ================= 三周期 K线（真实数据） ================= */
await test('日K：茅台收盘价与行情源一致，OHLC 逻辑自洽', async () => {
  const kl = await W.TencentSource.getKline('sh600519', 'day', 60);
  assert.ok(kl.length >= 30, '仅 ' + kl.length + ' 根');
  kl.forEach(k => {
    assert.match(k.time, /^\d{4}-\d{2}-\d{2}$/, '时间格式 ' + k.time);
    ['open', 'close', 'high', 'low'].forEach(f => assert.equal(typeof k[f], 'number', f + ' 非数字'));
    assert.ok(k.high >= Math.max(k.open, k.close) - 0.01, '最高价 < 开收');
    assert.ok(k.low <= Math.min(k.open, k.close) + 0.01, '最低价 > 开收');
    assert.ok(k.volume >= 0, '成交量为负');
  });
  // 与实时行情交叉核对：最后一根收盘价 == 当前价
  const [q] = await W.TencentSource.getQuotes(['sh600519']);
  const last = kl[kl.length - 1];
  assert.ok(Math.abs(last.close - q.price) < 0.02,
    `日K最后收盘 ${last.close} 与实时价 ${q.price} 不一致`);
  console.log(`   （茅台最新日K ${last.time} 收 ${last.close}，实时价 ${q.price}）`);
});

await test('周K：区间高低价覆盖对应日K（口径正确）', async () => {
  const wk = await W.TencentSource.getKline('sh600519', 'week', 12);
  assert.ok(wk.length >= 6, '周K仅 ' + wk.length + ' 根');
  wk.forEach(k => {
    assert.ok(k.high >= Math.max(k.open, k.close) - 0.01, '周K高价异常');
    assert.ok(k.low <= Math.min(k.open, k.close) + 0.01, '周K低价异常');
  });
  const day = await W.TencentSource.getKline('sh600519', 'day', 60);
  const lastWeek = wk[wk.length - 1];
  // 腾讯周K的 time 是"本周最后一个交易日"（未收完的当周= 今天），
  // 因此本周区间 = [上一根周K日期之后, 本根周K日期]，不能用 time >= lastWeek.time。
  const prevWeek = wk[wk.length - 2];
  const inWeek = day.filter(d => d.time > prevWeek.time && d.time <= lastWeek.time);
  assert.ok(inWeek.length >= 1, '找不到本周日K');
  const dayHigh = Math.max(...inWeek.map(d => d.high));
  const dayLow = Math.min(...inWeek.map(d => d.low));
  assert.ok(Math.abs(lastWeek.high - dayHigh) < 0.05, `周K高 ${lastWeek.high} vs 日K高 ${dayHigh}`);
  assert.ok(Math.abs(lastWeek.low - dayLow) < 0.05, `周K低 ${lastWeek.low} vs 日K低 ${dayLow}`);
});

await test('分时：A股/港股 时间递增、价格合理、成交量非负；美股非交易时段允许为空', async () => {
  for (const sym of ['sh600519', 'hk00700', 'usAAPL']) {
    const pts = await W.TencentSource.getMinute(sym);
    // 美股盘后实测只回 1 个点且 date 为空 → 适配器现在返回 []（走日K兜底，不再错标日期/巨量柱）
    if (sym === 'usAAPL' && pts.length === 0) { console.log('   （usAAPL 当前无分时（盘后），走日K兜底 ✓）'); continue; }
    assert.ok(pts.length >= 1, sym + ' 无分时点');
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].time > pts[i - 1].time, sym + ' 时间未递增');
    }
    pts.forEach(p => {
      assert.ok(p.value > 0, sym + ' 分时价格 ' + p.value);
      assert.ok(p.volume >= 0, sym + ' 分时量为负（累计量差值计算错误）');
    });
    const [q] = await W.TencentSource.getQuotes([sym]);
    const last = pts[pts.length - 1].value;
    const dev = Math.abs(last - q.price) / q.price;
    assert.ok(dev < 0.05, `${sym} 分时末值 ${last} 偏离现价 ${q.price} 超 5%`);
    console.log(`   （${sym} ${pts.length} 个分时点，末值 ${last}）`);
  }
});

await test('加密K线：日/周用日期字符串、5分钟用墙钟伪UTC（与图表时区口径一致）', async () => {
  for (const [iv, label] of [['1d', '日K'], ['1w', '周K']]) {
    const kl = await W.BinanceSource.getKline('BTCUSDT', iv, 30);
    assert.ok(kl.length >= 10, label + ' 仅 ' + kl.length + ' 根');
    kl.forEach(k => {
      assert.equal(typeof k.time, 'string', label + ' 时间应为日期字符串');
      assert.match(k.time, /^\d{4}-\d{2}-\d{2}$/, label + ' 日期格式 ' + k.time);
      assert.ok(k.high >= Math.max(k.open, k.close), label + ' 高价异常');
      assert.ok(k.low <= Math.min(k.open, k.close), label + ' 低价异常');
    });
    for (let i = 1; i < kl.length; i++) assert.ok(kl[i].time > kl[i - 1].time, label + ' 日期未递增');
  }
  const m5 = await W.BinanceSource.getKline('BTCUSDT', '5m', 20);
  assert.ok(m5.length >= 10, '5m 仅 ' + m5.length + ' 根');
  m5.forEach(k => {
    assert.equal(typeof k.time, 'number', '5m 时间应为伪UTC秒');
    assert.ok(k.time > 1e9 && k.time < 1e11, '5m 时间戳范围异常: ' + k.time);
  });
  for (let i = 1; i < m5.length; i++) assert.ok(m5[i].time > m5[i - 1].time, '5m 时间未递增');
});

/* ================= MA 与真实数据核对 ================= */
await test('MA5/MA20：用真实日K手算核对，末值逐项一致', async () => {
  const kl = await W.TencentSource.getKline('sh600519', 'day', 60);
  const ma5 = calcMA(kl, 5);
  const ma20 = calcMA(kl, 20);
  assert.equal(ma5.length, kl.length, 'MA 长度应与K线一致');
  assert.equal(ma5[3].value, null, 'MA5 第 4 项应为 null');
  assert.ok(ma5[4].value !== null, 'MA5 第 5 项应有值');
  assert.equal(ma20[18].value, null, 'MA20 第 19 项应为 null');

  const n = kl.length;
  const manual5 = kl.slice(n - 5).reduce((s, k) => s + k.close, 0) / 5;
  const manual20 = kl.slice(n - 20).reduce((s, k) => s + k.close, 0) / 20;
  assert.ok(Math.abs(ma5[n - 1].value - manual5) < 0.01, `MA5 ${ma5[n-1].value} vs 手算 ${manual5.toFixed(3)}`);
  assert.ok(Math.abs(ma20[n - 1].value - manual20) < 0.01, `MA20 ${ma20[n-1].value} vs 手算 ${manual20.toFixed(3)}`);
  console.log(`   （MA5=${ma5[n-1].value} MA20=${ma20[n-1].value}，手算一致）`);
});

await test('MA：滑动窗口与朴素实现在整条序列上完全相同', async () => {
  const kl = await W.TencentSource.getKline('sz300750', 'day', 120);
  const naive = (arr, n) => arr.map((k, i) => {
    if (i < n - 1) return null;
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j].close;
    return +(s / n).toFixed(3);
  });
  [5, 20].forEach(n => {
    const fast = calcMA(kl, n).map(x => x.value);
    const slow = naive(kl, n);
    for (let i = 0; i < kl.length; i++) {
      if (fast[i] === null || slow[i] === null) {
        assert.equal(fast[i], slow[i], `MA${n} 第 ${i} 项 null 位置不一致`);
        continue;
      }
      // 滑动窗口累加与逐段求和的浮点累积误差不同，容差取 0.002（远小于 1 分钱显示精度）
      assert.ok(Math.abs(fast[i] - slow[i]) <= 0.002,
        `MA${n} 第 ${i} 项偏差过大: ${fast[i]} vs ${slow[i]}`);
    }
  });
});

/* ================= 详情页取数：四类标的都能拿到数据 ================= */
await test('详情取数：A股/港股/美股/指数/加密 全部有报价+图表数据', async () => {
  const cases = [
    { label: 'A股', tencent: 'sh600519', secid: '1.600519' },
    { label: '港股', tencent: 'hk00700', secid: '116.00700' },
    { label: '美股', tencent: 'usAAPL', secid: '105.AAPL' },
    { label: '指数', tencent: 'sh000001', secid: '1.000001' },
  ];
  for (const c of cases) {
    const [q] = await W.TencentSource.getQuotes([c.tencent]);
    assert.ok(q && q.price > 0, c.label + ' 报价失败');
    const day = await W.TencentSource.getKline(c.tencent, 'day', 30);
    assert.ok(day.length > 5, c.label + ' 日K为空');
    const wk = await W.TencentSource.getKline(c.tencent, 'week', 12);
    assert.ok(wk.length > 3, c.label + ' 周K为空');
    const min = await W.TencentSource.getMinute(c.tencent);
    // 美股盘后单点分时按新契约返回 []，界面走日K兜底
    if (!(c.label === '美股' && min.length === 0)) {
      assert.ok(min.length >= 1, c.label + ' 分时为空');
    }
  }
  const [btc] = await W.BinanceSource.getQuotes(['BTCUSDT']);
  assert.ok(btc && btc.price > 0, '加密报价失败');
  assert.ok((await W.BinanceSource.getKline('BTCUSDT', '1d', 30)).length > 5, '加密日K为空');
});

/* ================= 降级与容错 ================= */
await test('容错：坏 URL / 空输入 一律返回空数组不抛异常', async () => {
  const badCtx = makeCtx();
  const badLoad = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), badCtx, { filename: rel });
  badLoad('js/utils.js'); badLoad('js/store.js'); badLoad('js/proxy.js');
  // 用不可解析域名模拟主源全挂
  vm.runInContext('window.fetch = () => Promise.reject(new Error("ENOTFOUND"))', badCtx);
  badLoad('js/sources/tencent.js'); badLoad('js/sources/eastmoney.js'); badLoad('js/sources/binance.js'); badLoad('js/sources/okx.js');
  const BW = vm.runInContext('window', badCtx);

  const r1 = await BW.TencentSource.getQuotes(['sh600519']);
  assert.equal(r1.length, 0, '腾讯挂了应返回空数组');
  const r2 = await BW.EastmoneySource.getQuotes(['1.600519']);
  assert.equal(r2.length, 0, '东财挂了应返回空数组');
  const r3 = await BW.EastmoneySource.getFullMarket();
  assert.equal(r3.length, 0, '全市场挂了应返回空数组');
  const r4 = await BW.BinanceSource.getQuotes(['BTCUSDT']);
  assert.equal(r4.length, 0, '币安挂了应返回空数组');
  const r5 = await BW.OkxSource.getQuotes(['BTCUSDT']);
  assert.equal(r5.length, 0, 'OKX 挂了应返回空数组');
  assert.equal((await BW.TencentSource.getKline('sh600519', 'day')).length, 0, 'K线挂了应返回空数组');
  assert.equal((await BW.TencentSource.getMinute('sh600519')).length, 0, '分时挂了应返回空数组');

  // 状态被正确标记为失败（页面据此显示降级角标）
  assert.equal(BW.SourceState.get('tencent').ok, false, '未登记 tencent 失败状态');
  assert.equal(BW.SourceState.get('binance').ok, false, '未登记 binance 失败状态');

  // 空输入
  assert.equal((await W.TencentSource.getQuotes([])).length, 0);
  assert.equal((await W.EastmoneySource.getQuotes([])).length, 0);
});

await test('容错：Quote 字段类型严格（Number 或 null，无字符串数字）', async () => {
  const qs = [
    ...await W.TencentSource.getQuotes(['sh600519', 'hk00700', 'usAAPL', 'sh000001']),
    ...await W.EastmoneySource.getQuotes(['119.EURUSD', '101.GC00Y', '171.US10Y']),
    ...await W.BinanceSource.getQuotes(['BTCUSDT', 'ETHUSDT']),
  ];
  assert.ok(qs.length >= 8, '只取到 ' + qs.length + ' 条');
  const numFields = ['price', 'prevClose', 'open', 'high', 'low', 'change', 'changePct', 'volume'];
  qs.forEach(q => {
    numFields.forEach(f => {
      const v = q[f];
      assert.ok(v === null || v === undefined || typeof v === 'number',
        `${q.symbol}.${f} 类型=${typeof v} 值=${v}`);
    });
    assert.equal(typeof q.name, 'string', q.symbol + ' name 非字符串');
    assert.ok(q.name.length > 0, q.symbol + ' name 为空');
    assert.equal(typeof q.updatedAt, 'number', q.symbol + ' updatedAt 非时间戳');
  });
  console.log('   （已校验 ' + qs.length + ' 条 Quote 的字段类型）');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
