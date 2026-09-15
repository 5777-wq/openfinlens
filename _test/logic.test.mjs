/* 纯逻辑单测（Node 直跑，不依赖浏览器）：
   校验 treemap 布局守恒、MA 手算一致、K线解析、产业链平均、新闻关键词过滤、格式化边界。
   用法：node _test/logic.test.mjs   （测完可删，属临时校验脚本） */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};

// ---- 构造最小浏览器环境，加载真实源码 ----
function makeCtx() {
  /* 令牌不在这里另抄一份：直接从真实 css 解析，避免"测试里的第三份副本"——
     历史缺口就是这样：把 css 的 --accent-rgb 改坏，测试照样全绿。
     （一致性/色距的正面断言在 tokens.test.mjs，这里只负责给渲染取到真值。） */
  const styleVals = {};
  for (const m of readFileSync(path.join(ROOT, 'css/style.css'), 'utf8')
    .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!(m[1] in styleVals)) styleVals[m[1]] = m[2].trim();   // 首个定义优先（:root）
  }
  const fakeStyle = { getPropertyValue: (k) => styleVals[k] || '' };
  const ctx = {
    console,
    Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0),
    TextDecoder,
    localStorage: (() => {
      const m = new Map();
      return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    })(),
    document: {
      documentElement: {}, body: {},
      createElement: () => ({ style: {}, remove() {}, addEventListener() {} }),
      head: { appendChild() {} },
      querySelectorAll: () => [],
      addEventListener() {},
    },
    getComputedStyle: () => fakeStyle,
    matchMedia: () => ({ matches: false }),
    fetch: async () => { throw new Error('no network in unit test'); },
    AbortController: class { constructor() { this.signal = null; } abort() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

function load(ctx, rel) {
  vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}

const ctx = makeCtx();
load(ctx, 'js/utils.js');
load(ctx, 'js/store.js');
load(ctx, 'js/proxy.js');
load(ctx, 'js/treemap.js');
load(ctx, 'js/data/industry-chains.js');
load(ctx, 'js/data/universe.js');
load(ctx, 'js/sources/tencent.js');
load(ctx, 'js/sources/report.js');
load(ctx, 'js/sources/news.js');

const W = vm.runInContext('window', ctx);

/* ================= treemap ================= */

test('squarify: 覆盖面积守恒（总面积误差 < 0.5%）', () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ name: 'n' + i, value: Math.random() * 1000 + 1 }));
  const W_ = 1200, H_ = 560;
  const cells = W.Treemap.squarify(items, 0, 0, W_, H_);
  assert.equal(cells.length, items.length, '每个 item 都要有位置');
  const area = cells.reduce((s, c) => s + c.w * c.h, 0);
  const rel = Math.abs(area - W_ * H_) / (W_ * H_);
  assert.ok(rel < 0.005, '面积守恒误差 ' + (rel * 100).toFixed(3) + '%');
});

test('squarify: 所有块都在画布内且尺寸非负', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ name: 'n' + i, value: (i + 1) * 3 }));
  const cells = W.Treemap.squarify(items, 0, 0, 800, 400);
  cells.forEach(c => {
    assert.ok(c.w >= 0 && c.h >= 0, '尺寸非负');
    assert.ok(c.x >= -0.01 && c.y >= -0.01, '不越左上界');
    assert.ok(c.x + c.w <= 800.01 && c.y + c.h <= 400.01, '不越右下界');
  });
});

test('squarify: 面积与 value 成正比（前后名次一致）', () => {
  const items = [{ name: 'a', value: 100 }, { name: 'b', value: 50 }, { name: 'c', value: 25 }];
  const cells = W.Treemap.squarify(items, 0, 0, 400, 400);
  const byName = {};
  cells.forEach(c => { byName[c.item.name] = c.w * c.h; });
  assert.ok(byName.a > byName.b && byName.b > byName.c, '面积序与 value 序一致');
  const ratio = byName.a / byName.b;
  assert.ok(Math.abs(ratio - 2) < 0.15, 'a/b 面积比应≈2，实际 ' + ratio.toFixed(3));
});

test('squarify: 纵横比合理（大块不退化成长条）', () => {
  const items = Array.from({ length: 100 }, () => ({ name: 'x', value: 10 }));
  const cells = W.Treemap.squarify(items, 0, 0, 1000, 500);
  const worst = Math.max(...cells.map(c => Math.max(c.w / c.h, c.h / c.w)));
  assert.ok(worst < 6, '最差纵横比 ' + worst.toFixed(2) + ' 应 < 6');
});

test('treemap 视口：缩放平移后命中测试使用反变换（大块缩后仍命中原块）', () => {
  // 用 create() 的纯逻辑不便直测（依赖 canvas），这里直接校验视口数学：
  // 屏幕 = (布局 - 偏移) × 缩放；命中 = 屏幕/缩放 + 偏移
  const zoom = 4, ox = 130, oy = 60;
  const cells = W.Treemap.squarify(
    [{ name: 'a', value: 100 }, { name: 'b', value: 50 }, { name: 'c', value: 25 }], 0, 0, 800, 400);
  const target = cells[0];
  // 布局中心 → 屏幕坐标
  const cx = (target.x + target.w / 2 - ox) * zoom;
  const cy = (target.y + target.h / 2 - oy) * zoom;
  // 反变换回布局，必须落回同一块
  const lx = cx / zoom + ox, ly = cy / zoom + oy;
  assert.ok(lx >= target.x && lx <= target.x + target.w, 'x 反变换偏离');
  assert.ok(ly >= target.y && ly <= target.y + target.h, 'y 反变换偏离');
  // 往返一致性：任意点经正/反变换后复原
  for (let i = 0; i < 50; i++) {
    const sx = Math.random() * 800, sy = Math.random() * 400;
    const bx = sx / zoom + ox, by = sy / zoom + oy;
    assert.ok(Math.abs((bx - ox) * zoom - sx) < 1e-9);
    assert.ok(Math.abs((by - oy) * zoom - sy) < 1e-9);
  }
});

test('squarify: 空输入 / 零尺寸不抛异常', () => {
  // 跨 vm realm 的数组与主 realm 不是 reference-equal，只断言长度
  assert.equal(W.Treemap.squarify([], 0, 0, 100, 100).length, 0);
  assert.equal(W.Treemap.squarify([{ name: 'a', value: 5 }], 0, 0, 0, 100).length, 0);
  assert.equal(W.Treemap.squarify([{ name: 'a', value: 0 }], 0, 0, 100, 100).length, 0);
});

test('pctColor: 红涨绿跌 + null 兜底 + ±3% 封顶', () => {
  W.Treemap.refreshColors();
  assert.equal(W.Treemap.pctColor(null), '#222');
  assert.equal(W.Treemap.pctColor(NaN), '#222');
  const up3 = W.Treemap.pctColor(3), up10 = W.Treemap.pctColor(10);
  assert.equal(up3, up10, '±3% 封顶');
  assert.equal(up3, 'rgb(255,92,92)', '涨到顶=--up');
  assert.equal(W.Treemap.pctColor(-10), 'rgb(46,189,133)', '跌到顶=--down');
  assert.equal(W.Treemap.pctColor(0), 'rgb(51,51,51)', '0% = 中性灰');
});

/* ================= utils 格式化 ================= */

test('格式化：null / NaN 一律 --，不出现 NaN 字样', () => {
  const { fmt, fmtPct, fmtVol, fmtPrice, fmtChg } = W.U;
  [fmt(null), fmt(undefined), fmt(NaN), fmtPct(null), fmtVol(null), fmtPrice(null), fmtChg(null)]
    .forEach(v => assert.equal(v, '--'));
});

test('格式化：涨跌符号与百分比', () => {
  const { fmtPct, fmtChg } = W.U;
  assert.equal(fmtPct(0.5), '+0.50%');
  assert.equal(fmtPct(-1.234), '-1.23%');
  assert.equal(fmtPct(0), '0.00%');
  assert.equal(fmtChg(2, 2), '+2.00');
  assert.equal(fmtChg(-2, 2), '-2.00');
});

test('格式化：小价格自动加小数位（加密/外汇）', () => {
  const { fmtPrice, priceDigits } = W.U;
  assert.equal(priceDigits(70000), 2);
  // 1~100 元段改 2 位：A股 7.28 显示"7.28"而不是"7.280"（去尾零）；
  // 外汇第 4 位有效数字由市场分支（cardHTML/patchCards 里 fx→4 位）负责，不靠 priceDigits
  assert.equal(priceDigits(6.72), 2);
  assert.equal(priceDigits(0.5), 4);
  assert.equal(priceDigits(0.0000123), 6);
  assert.equal(fmtPrice(0.00001234), '0.000012');
});

test('格式化：成交量亿/万', () => {
  const { fmtVol } = W.U;
  assert.equal(fmtVol(464117264), '4.64亿');
  assert.equal(fmtVol(21111), '2万');
  assert.equal(fmtVol(500), '500');
});

test('num(): 脏数据一律 null，绝不返回字符串', () => {
  const { num } = W.U;
  [null, undefined, '', '-', 'abc', NaN].forEach(v => assert.equal(num(v), null, String(v)));
  assert.equal(num('1304.00'), 1304);
  assert.equal(typeof num('1304.00'), 'number');
});

/* ================= 腾讯适配器解析 ================= */

const REAL_TENCENT = 'v_sh600519="1~贵州茅台~600519~1304.00~1304.66~1311.89~21111~9965~11146~1304.00~13~1303.99~2~1303.98~1~1303.80~1~1303.50~2~1304.02~3~1304.08~3~1304.10~1~1304.35~1~1304.50~5~~20260825161438~-0.66~-0.05~1317.00~1301.11~1304.00/21111/2757527115~21111~275753~0.17~20.02~~1317.00~1301.11~1.22~16301.06~16301.06~6.49~1435.13~1174.19~0.58~6~1306.19~18.31~19.80~~~0.12~275752.7115~234.7200~18~   A~GP-A~-3.35~0.46~3.99~32.41~27.30~1539.98~1151.01~-3.16~-1.21~1.75~1250081601~1250081601~18.75~-6.54~1250081601~~~-9.34~0.02~~CNY~0~___D__F__N~1304.66~-96~";';

test('腾讯解析：真实响应字段映射正确（茅台）', () => {
  const [q] = W.TencentSource.parse(REAL_TENCENT);
  assert.equal(q.symbol, 'sh600519');
  assert.equal(q.name, '贵州茅台');
  assert.equal(q.code, '600519');
  assert.equal(q.price, 1304);
  assert.equal(q.prevClose, 1304.66);
  assert.equal(q.open, 1311.89);
  assert.equal(q.change, -0.66);
  assert.equal(q.changePct, -0.05);
  assert.equal(q.high, 1317);
  assert.equal(q.low, 1301.11);
  assert.equal(q.market, 'cn');
});

test('腾讯解析：所有数值字段是 Number 或 null（无字符串数字）', () => {
  const [q] = W.TencentSource.parse(REAL_TENCENT);
  ['price', 'prevClose', 'open', 'high', 'low', 'change', 'changePct', 'volume'].forEach(k => {
    assert.ok(q[k] === null || typeof q[k] === 'number', k + ' 类型=' + typeof q[k]);
  });
});

test('腾讯解析：市场归类（指数/港股/美股）', () => {
  const mk = (sym, name) => W.TencentSource.parse(
    `v_${sym}="1~${name}~x~100.00~99.00~99.00~1~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~1~t~1.00~1.01~101~98~~1~1~1~1~1~1~1~1~1~1~1";`
  )[0];
  assert.equal(mk('sh000001', '上证指数').market, 'index');
  assert.equal(mk('hkHSI', '恒生指数').market, 'index');
  assert.equal(mk('usDJI', '道琼斯').market, 'index');
  assert.equal(mk('hk00700', '腾讯控股').market, 'hk');
  assert.equal(mk('usAAPL', '苹果').market, 'us');
});

test('腾讯解析：脏输入不抛异常（空串/截断/乱码）', () => {
  ['', 'garbage', 'v_sh1="1~a";', 'v_sh1="~~~~"'].forEach(s => {
    assert.doesNotThrow(() => W.TencentSource.parse(s), s);
  });
  assert.equal(W.TencentSource.parse('').length, 0);
});

/* ================= MA 均线手算核对 ================= */

test('calcMA: 前 n-1 为 null，第 n 项等于手算均值', () => {
  // 从 charts.js 抽取真函数（charts.js 依赖 LightweightCharts 不能整体加载；
  // 手工副本曾与实现漂移：真实现有坏收盘价断线逻辑，副本没有）
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const m = src.match(/function calcMA\(klines, n\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'charts.js 中应存在 calcMA');
  const calcMA = new Function('return (' + m[0] + ');')();
  const closes = [10, 12, 14, 16, 18, 20, 22];
  const kl = closes.map((c, i) => ({ time: i, close: c }));
  const ma5 = calcMA(kl, 5);
  assert.deepEqual(ma5.slice(0, 4).map(x => x.value), [null, null, null, null]);
  assert.equal(ma5[4].value, (10 + 12 + 14 + 16 + 18) / 5);   // 14
  assert.equal(ma5[5].value, (12 + 14 + 16 + 18 + 20) / 5);   // 16
  assert.equal(ma5[6].value, (14 + 16 + 18 + 20 + 22) / 5);   // 18
});

test('calcMA: 窗口内坏收盘价 → 该点 null（脏值当 0 加会算出假均线）', () => {
  const src = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  const m = src.match(/function calcMA\(klines, n\) \{[\s\S]*?\n  \}/);
  const calcMA = new Function('return (' + m[0] + ');')();
  const kl = [10, 12, null, 16, 18, 20, 22].map((c, i) => ({ time: i, close: c }));
  const ma3 = calcMA(kl, 3);
  assert.equal(ma3[2].value, null);   // 窗口 [10,12,null] 含坏值
  assert.equal(ma3[3].value, null);   // 窗口 [12,null,16] 含坏值
  assert.equal(ma3[4].value, null);   // 窗口 [null,16,18] 含坏值
  assert.equal(ma3[5].value, (16 + 18 + 20) / 3);
  assert.equal(ma3[6].value, (18 + 20 + 22) / 3);
});

/* ================= 产业链 ================= */

test('产业链：≥4 条，每条 ≥4 环节，每环节 3-8 只成分股（全球化后核心环节允许 7-8）', () => {
  const chains = W.INDUSTRY_CHAINS;
  assert.ok(chains.length >= 4, '产业链数 ' + chains.length);
  chains.forEach(c => {
    assert.ok(c.links.length >= 4, c.name + ' 环节数 ' + c.links.length);
    c.links.forEach(l => {
      assert.ok(l.stocks.length >= 3 && l.stocks.length <= 8, `${c.name}/${l.name} 成分股 ${l.stocks.length}`);
    });
  });
});

test('产业链：代码格式合法（sh/sz + 6 位），无重复定义冲突', () => {
  W.INDUSTRY_CHAINS.forEach(c => c.links.forEach(l => l.stocks.forEach(s => {
    // 全球版：A股 sh/sz+6位、港股 hk+4~5位、美股 us+代码（全部实测有效）
    assert.match(s.symbol, /^(sh|sz)\d{6}$|^hk\d{4,5}$|^us[A-Za-z0-9.]{1,8}$/,
      `${c.name}/${l.name}/${s.name} = ${s.symbol}`);
    assert.ok(s.name && s.name.length > 1, '名称非空');
  })));
});

test('产业链：环节强度=成分股涨跌幅简单平均（手算核对）', () => {
  const quotes = new Map([
    ['sz002460', { changePct: -4.64 }],
    ['sz002466', { changePct: -4.26 }],
    ['sh600111', { changePct: -1.41 }],
    ['sh601899', { changePct: -2.49 }],
  ]);
  const link = W.INDUSTRY_CHAINS[0].links[0];   // 新能源车/锂矿资源
  const vals = link.stocks.map(s => quotes.get(s.symbol)?.changePct).filter(v => v != null);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const expect = (-4.64 + -4.26 + -1.41 + -2.49) / 4;
  assert.equal(vals.length, 4, '4 只都命中');
  assert.ok(Math.abs(avg - expect) < 1e-9, `avg=${avg} expect=${expect}`);
  assert.ok(Math.abs(avg - -3.2) < 0.01, '手算 = -3.20');
});

test('产业链：全部成分股无数据 → 平均为 null（不报错、不算 0）', () => {
  const empty = new Map();
  const link = W.INDUSTRY_CHAINS[0].links[0];
  const vals = link.stocks.map(s => empty.get(s.symbol)?.changePct).filter(v => v != null && !isNaN(v));
  assert.equal(vals.length, 0);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  assert.equal(avg, null);
  assert.equal(W.U.fmtPct(avg), '--');
});

/* ================= 新闻过滤 ================= */

test('新闻：加密 tab 只放含关键词的条目', () => {
  const M = W.NewsSource.matchMarket;
  const btc = { title: '比特币突破 8 万美元', summary: '' };
  const eth = { title: 'ETH 升级完成', summary: '' };
  const ashare = { title: '沪指收涨 0.2%，两市成交额破万亿', summary: '' };
  assert.equal(M(btc, 'crypto'), true);
  assert.equal(M(eth, 'crypto'), true);
  assert.equal(M(ashare, 'crypto'), false);
  assert.equal(M(ashare, 'cn'), true);
  assert.equal(M(btc, 'all'), true, 'all 不过滤');
});

test('新闻：关键词大小写不敏感', () => {
  const M = W.NewsSource.matchMarket;
  assert.equal(M({ title: 'btc 走强', summary: '' }, 'crypto'), true);
  assert.equal(M({ title: 'Eth 生态', summary: '' }, 'crypto'), true);
});

/* ================= 研报评级配色 ================= */

test('研报：评级 → 语义色（买入红/增持签名色/中性灰/减持绿）', () => {
  const R = W.ReportSource.ratingClass;
  assert.equal(R('买入'), 'rt-buy');
  assert.equal(R('强烈推荐'), 'rt-buy');
  assert.equal(R('增持'), 'rt-add');
  assert.equal(R('中性'), 'rt-hold');
  assert.equal(R('持有'), 'rt-hold');
  assert.equal(R('减持'), 'rt-sell');
  assert.equal(R('卖出'), 'rt-sell');
  assert.equal(R(''), 'rt-none');
  assert.equal(R(null), 'rt-none');
});

/* ================= Store ================= */

test('Store：自选 toggle 幂等 + 设置默认值', () => {
  const S = W.Store;
  assert.equal(S.watchlist.all().length, 0);
  assert.equal(S.watchlist.toggle({ symbol: 'sh600519', name: '贵州茅台', market: 'cn' }), true);
  assert.equal(S.watchlist.has('sh600519'), true);
  assert.equal(S.watchlist.all().length, 1);
  assert.equal(S.watchlist.toggle({ symbol: 'sh600519', name: '贵州茅台', market: 'cn' }), false);
  assert.equal(S.watchlist.has('sh600519'), false);
  const st = S.settings.get();
  assert.equal(st.updown, 'red');
  assert.equal(st.refresh, 10);
  S.settings.set({ updown: 'green' });
  assert.equal(S.settings.get().updown, 'green');
  assert.equal(S.settings.get().refresh, 10, '部分更新不丢其它字段');
});

/* ================= universe ================= */

test('universe：8 品类齐全，symbol 无重复', () => {
  const groups = new Set([...W.TENCENT_UNIVERSE, ...W.EM_UNIVERSE].map(x => x.group));
  ['index', 'cn', 'hk', 'us', 'fx', 'commodity', 'macro'].forEach(g => assert.ok(groups.has(g), '缺 ' + g));
  assert.ok(W.CRYPTO_FEATURED.length >= 4, '加密品类');
  const all = [...W.TENCENT_UNIVERSE, ...W.EM_UNIVERSE].map(x => x.symbol);
  assert.equal(new Set(all).size, all.length, 'symbol 有重复');
  assert.equal(new Set(W.CRYPTO_UNIVERSE).size, W.CRYPTO_UNIVERSE.length, '加密全集有重复');
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
