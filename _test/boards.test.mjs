/* 今日热门概念层校验：
   1) matchChain：板块名 → 人工产业链的关键词匹配（直接抽取 app.js 真源码测，防两处漂移）；
   2) 东财板块榜 / 成分股接口：真实可用、黑名单过滤、入参白名单、降级不抛。
   用法：node _test/boards.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'apps', 'terminal');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

function makeCtx() {
  const ctx = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
    setTimeout, clearTimeout, TextDecoder, Promise, Error, RegExp, Map, Set, encodeURIComponent,
    URL, URLSearchParams, AbortController, AbortSignal, performance,
    fetch: (url, opts = {}) => fetch(url, {
      ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000),
    }),
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
  return ctx;
}
const ctx = makeCtx();
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
load('js/utils.js'); load('js/proxy.js');
load('js/data/industry-chains.js');
load('js/sources/eastmoney.js');
const W = vm.runInContext('window', ctx);

// matchChain 定义在 app.js（依赖完整 DOM 无法整文件加载）→ 截取真源码在独立上下文求值
const appSrc = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const m = appSrc.match(/const CHAIN_HINTS = \{[\s\S]*?\r?\n  \};\r?\n  function matchChain\(name\) \{[\s\S]*?\r?\n  \}/);
assert.ok(m, 'app.js 中应能截取到 CHAIN_HINTS + matchChain 源码');
vm.runInContext(m[0] + '\nwindow.matchChain = matchChain;', ctx, { filename: 'app.js#matchChain' });
const matchChain = W.matchChain;

/* ================= matchChain：榜单名 → 人工链条 ================= */
await test('matchChain：典型概念板块命中对应链条', () => {
  const cases = [
    ['动力电池', 'nev'], ['锂矿', 'nev'], ['智能驾驶', 'nev'],
    ['存储芯片', 'semicon'], ['第三代半导体', 'semicon'], ['光刻胶', 'semicon'],
    ['算力租赁', 'ai'], ['CPO', 'ai'], ['AIGC', 'ai'],
    ['钙钛矿电池', 'pv'], ['光伏组件', 'pv'],
    ['消费电子', 'consumer'], ['OLED面板', 'consumer'], ['折叠屏', 'consumer'],
    ['创新药', 'pharma'], ['CXO', 'pharma'], ['中药', 'pharma'],
    ['大飞机', 'defense'], ['商业航天', 'defense'], ['无人机', 'defense'],
    ['人形机器人', 'robot'], ['减速器', 'robot'],
    ['虚拟电厂', 'storage'], ['特高压', 'storage'], ['储能', 'storage'],
    ['华为概念', 'xinchuang'], ['国产软件', 'xinchuang'], ['数据要素', 'xinchuang'],
  ];
  const bad = [];
  cases.forEach(([board, want]) => {
    const got = matchChain(board);
    if (got !== want) bad.push(`${board}→${got}(期望${want})`);
  });
  assert.equal(bad.length, 0, '匹配错误: ' + bad.join('; '));
});

await test('matchChain：无关板块返回 null，结果必为真实链条 id，空入参安全', () => {
  assert.equal(matchChain('代糖概念'), null, '代糖不应硬凑');
  assert.equal(matchChain('草甘膦'), null);
  assert.equal(matchChain(''), null);
  assert.equal(matchChain(null), null);
  const ids = new Set(W.INDUSTRY_CHAINS.map(c => c.id));
  ['半导体', '华为', '机器人', '储能'].forEach(b => assert.ok(ids.has(matchChain(b)), b + ' 命中了不存在的链'));
});

/* ================= 东财板块榜 / 成分股（真实接口） ================= */
await test('getBoardRank：真实榜单 ≥10 条，黑名单已过滤，字段完整', async () => {
  const list = await W.EastmoneySource.getBoardRank('concept', 24);
  assert.ok(list.length >= 10, '仅 ' + list.length + ' 条');
  const badRe = /昨日|连板|打板|题材|次新/;
  const dirty = list.filter(x => badRe.test(x.name));
  assert.equal(dirty.length, 0, '混入技术分类: ' + dirty.map(x => x.name).join(','));
  list.forEach(x => {
    assert.ok(/^BK\d{4,6}$/.test(x.bk), 'bk 非法: ' + x.bk);
    assert.ok(x.name && typeof x.changePct === 'number', '字段缺失: ' + x.name);
  });
  // 按涨跌幅降序（前三条不应乱序）
  for (let i = 1; i < Math.min(3, list.length); i++) {
    assert.ok(list[i - 1].changePct >= list[i].changePct, '排序错乱 @' + i);
  }
  console.log(`   （榜首 ${list[0].name} ${list[0].changePct > 0 ? '+' : ''}${list[0].changePct}%，领涨 ${list[0].leadName || '--'}）`);
});

await test('getBoardStocks：真实成分股 ≥3 条，secid 合法（清算时段允许涨跌幅缺失）', async () => {
  const rank = await W.EastmoneySource.getBoardRank('concept', 5);
  assert.ok(rank.length >= 1, '榜单不可用，无法测成分股');
  const stocks = await W.EastmoneySource.getBoardStocks(rank[0].bk, 12);
  assert.ok(stocks.length >= 3, '仅 ' + stocks.length + ' 条');
  stocks.forEach(s => {
    assert.match(s.secid, /^\d+\.\d{6}$/, 'secid 非法: ' + s.secid);
    assert.ok(s.name, '缺名称');
    assert.ok(s.changePct === null || typeof s.changePct === 'number', 'changePct 只能是数值或 null');
  });
  // 盘中（数值齐全）才断言降序；深夜清算时段 f3 全为 "-"，跳过
  const numeric = stocks.filter(s => s.changePct !== null);
  if (numeric.length === stocks.length) {
    for (let i = 1; i < numeric.length; i++) {
      assert.ok(numeric[i - 1].changePct >= numeric[i].changePct, '成分股排序错乱 @' + i);
    }
  } else {
    console.log('   （清算时段：' + (stocks.length - numeric.length) + '/' + stocks.length + ' 条涨跌幅缺失，跳过排序断言）');
  }
});

await test('getBoardStocks：入参白名单——非 BK 代码 / 空串一律返回空数组', async () => {
  // 跨 vm 上下文数组不参与 deepEqual 引用比较，用长度断言（insight 组同款教训）
  assert.equal((await W.EastmoneySource.getBoardStocks('DROP TABLE', 12)).length, 0);
  assert.equal((await W.EastmoneySource.getBoardStocks('', 12)).length, 0);
  assert.equal((await W.EastmoneySource.getBoardStocks(null, 12)).length, 0);
  assert.equal((await W.EastmoneySource.getBoardStocks('BK0938;alert(1)', 12)).length, 0);
});

await test('getBoardRank：未知 kind 回落概念榜不抛异常', async () => {
  const list = await W.EastmoneySource.getBoardRank('bogus-kind', 5);
  assert.ok(Array.isArray(list));
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（exit 0xC0000409）
// → 设退出码后短暂让出事件循环再退
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
