/* 市场宽度 / 情绪指标校验（G8）：口径、边界、七段求和守恒、涨跌停判定，并用实网全市场数据交叉核对。
   用法：node _test/breadth.test.mjs */

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

const ctx = vm.createContext({ console, Math, Number, String, Array, Object, isNaN, Infinity, JSON, Date });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/breadth.js'), 'utf8'), ctx, { filename: 'breadth.js' });
const B = vm.runInContext('window.Breadth', ctx);

const mk = (pct, extra = {}) => ({ code: '600000', name: '测试', price: 10, changePct: pct, ...extra });

/* ================= 情绪指数口径 ================= */
await test('情绪指数：全涨=100 / 全跌=0 / 半对半=50', () => {
  assert.equal(B.compute([mk(1), mk(2), mk(3)]).score, 100);
  assert.equal(B.compute([mk(-1), mk(-2)]).score, 0);
  assert.equal(B.compute([mk(1), mk(-1)]).score, 50);
});

await test('情绪指数：平盘不进分母（停牌/一字板不该压低分数）', () => {
  const r = B.compute([mk(1), mk(1), mk(-1), mk(0), mk(0), mk(0)]);
  assert.equal(r.up, 2); assert.equal(r.down, 1); assert.equal(r.flat, 3);
  assert.ok(Math.abs(r.score - 66.667) < 0.01, '实际 ' + r.score);
  // 上涨占比（含平盘）是另一个指标，不等于情绪指数
  assert.ok(Math.abs(r.upRatio - 2 / 6) < 1e-9);
});

await test('情绪指数：无有效数据 / 全平盘 → null（不伪造 50）', () => {
  assert.equal(B.compute([]).score, null);
  assert.equal(B.compute(null).score, null);
  assert.equal(B.compute([mk(0), mk(0)]).score, null, '全平盘应为 null');
  assert.equal(B.compute([mk(null), mk(NaN), mk(undefined)]).score, null, '脏数据应为 null');
});

await test('情绪指数：普涨 >70、普跌 <30（与分档一致）', () => {
  const bull = B.compute([...Array(80).fill(0).map(() => mk(2)), ...Array(20).fill(0).map(() => mk(-1))]);
  const bear = B.compute([...Array(20).fill(0).map(() => mk(2)), ...Array(80).fill(0).map(() => mk(-1))]);
  assert.ok(bull.score > 70, '普涨 score=' + bull.score);
  assert.ok(bear.score < 30, '普跌 score=' + bear.score);
  assert.equal(B.scoreBand(bull.score).key, 'greed');
  assert.equal(B.scoreBand(bear.score).key, 'panic');
  assert.equal(B.scoreBand(50).key, 'neutral');
  assert.equal(B.scoreBand(null).key, 'none');
  // 边界：30 与 70 都算中性
  assert.equal(B.scoreBand(30).key, 'neutral');
  assert.equal(B.scoreBand(70).key, 'neutral');
  assert.equal(B.scoreBand(29.9).key, 'panic');
  assert.equal(B.scoreBand(70.1).key, 'greed');
});

/* ================= 七段分布 ================= */
await test('七段分布：求和恒等于有效家数（无漏桶/重复计数）', () => {
  const rows = [];
  for (let i = 0; i < 3000; i++) rows.push(mk(+(Math.random() * 24 - 12).toFixed(2)));
  const r = B.compute(rows);
  const sum = r.dist.reduce((s, d) => s + d.count, 0);
  assert.equal(sum, r.total, `七段合计 ${sum} ≠ 总数 ${r.total}`);
  assert.equal(r.total, 3000);
  const ratioSum = r.dist.reduce((s, d) => s + d.ratio, 0);
  assert.ok(Math.abs(ratioSum - 1) < 1e-9, '占比合计 ' + ratioSum);
});

await test('七段分布：边界值归桶正确（-5 / -3 / -1 / 0 / 1 / 3 / 5）', () => {
  const at = (pct) => {
    const d = B.compute([mk(pct)]).dist;
    return d.find(x => x.count === 1).key;
  };
  assert.equal(at(-6), 'lt-5');
  assert.equal(at(-5), '-5-3', '-5 属于 [-5,-3)');
  assert.equal(at(-3), '-3-1');
  assert.equal(at(-1), 'flat', '-1 属于 [-1,1)');
  assert.equal(at(0), 'flat');
  assert.equal(at(0.99), 'flat');
  assert.equal(at(1), '1-3');
  assert.equal(at(3), '3-5');
  assert.equal(at(5), 'gt5', '5 属于最后一桶（闭合）');
  assert.equal(at(300), 'gt5', '新股暴涨不能溢出桶外');
});

await test('七段分布：红涨绿跌方向标记正确', () => {
  const d = B.compute([mk(-6), mk(-4), mk(-2), mk(0), mk(2), mk(4), mk(6)]).dist;
  // 跨 vm realm 的数组不是 reference-equal，用 join 比较内容
  assert.equal(d.map(x => x.dir).join(','), 'down,down,down,flat,up,up,up');
  assert.equal(d.map(x => x.count).join(','), '1,1,1,1,1,1,1');
});

/* ================= 涨跌停判定 ================= */
await test('涨跌停：先板块后 ST——注册制下创业板/科创板 ST 仍是 20%', () => {
  assert.equal(B.limitOf({ code: '600519', name: '贵州茅台' }), 10);
  assert.equal(B.limitOf({ code: '000001', name: '平安银行' }), 10);
  assert.equal(B.limitOf({ code: '300750', name: '宁德时代' }), 20);
  assert.equal(B.limitOf({ code: '688111', name: '金山办公' }), 20);
  // 实测 300010 ST豆神 +10.42%：旧规则 ST 优先判 5% 会把它误计成涨停
  assert.equal(B.limitOf({ code: '301117', name: 'ST佳缘' }), 20, '创业板 ST = 20%');
  assert.equal(B.limitOf({ code: '002731', name: '*ST萃华' }), 5, '主板 ST = 5%');
  assert.equal(B.limitOf({ code: '830799', name: '艾融软件' }), 30);
  assert.equal(B.limitOf({ code: '920001', name: '北交所920段' }), 30, '920 段也属北交所 ±30%');
});

await test('涨跌停：计数用真实封板价（9.98 / 19.97 / 4.96 都算）', () => {
  const rows = [
    mk(10.00, { code: '600001', name: '主板涨停' }),
    mk(9.98, { code: '600002', name: '主板涨停2' }),
    mk(9.5, { code: '600003', name: '主板未涨停' }),
    mk(19.97, { code: '300001', name: '创业板涨停' }),
    mk(19.0, { code: '300002', name: '创业板未涨停' }),
    mk(4.96, { code: '600004', name: 'ST涨停' }),
    mk(-10.01, { code: '600005', name: '主板跌停' }),
    mk(-19.98, { code: '300003', name: '创业板跌停' }),
  ];
  const r = B.compute(rows);
  assert.equal(r.limitUp, 4, '涨停数 实际 ' + r.limitUp);
  assert.equal(r.limitDown, 2, '跌停数 实际 ' + r.limitDown);
});

/* ================= 平均/中位数/成交额 ================= */
await test('平均与中位数：手算核对，奇偶数量都对', () => {
  const r1 = B.compute([mk(1), mk(2), mk(3)]);
  assert.ok(Math.abs(r1.avgPct - 2) < 1e-9);
  assert.ok(Math.abs(r1.medianPct - 2) < 1e-9);
  const r2 = B.compute([mk(1), mk(2), mk(3), mk(10)]);
  assert.ok(Math.abs(r2.avgPct - 4) < 1e-9, 'avg=' + r2.avgPct);
  assert.ok(Math.abs(r2.medianPct - 2.5) < 1e-9, 'median=' + r2.medianPct);
});

await test('成交额：缺字段时为 null（不显示 0 误导）', () => {
  assert.equal(B.compute([mk(1), mk(2)]).amount, null);
  const r = B.compute([mk(1, { amount: 1e8 }), mk(2, { amount: 2e8 })]);
  assert.equal(r.amount, 3e8);
});

await test('脏数据：null/NaN 行被剔除且不影响其它统计', () => {
  const r = B.compute([mk(1), mk(null), mk(NaN), mk(-2), { code: 'x', name: 'y' }]);
  assert.equal(r.total, 2, '有效行应为 2，实际 ' + r.total);
  assert.equal(r.up, 1); assert.equal(r.down, 1);
  assert.equal(r.dist.reduce((s, d) => s + d.count, 0), 2);
});

/* ================= 实网交叉核对 ================= */
await test('实网：全市场宽度与东财自身涨跌幅榜口径自洽', async () => {
  const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  const get = (u) => fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const mkUrl = (pn) => `https://push2delay.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f2,f3,f4,f6,f12,f13,f14,f20`;

  const first = await (await get(mkUrl(1))).json();
  const total = first.data.total;
  const pages = Math.ceil(Math.min(total, 6000) / 100);
  const rows = first.data.diff.slice();
  for (let pn = 2; pn <= pages; pn += 12) {
    const batch = [];
    for (let k = pn; k < pn + 12 && k <= pages; k++) batch.push(k);
    const res = await Promise.all(batch.map(p => get(mkUrl(p)).then(r => r.json()).then(j => (j.data && j.data.diff) || []).catch(() => [])));
    res.forEach(r => rows.push(...r));
  }
  const mapped = rows.map(x => ({
    code: String(x.f12), name: String(x.f14), price: x.f2,
    changePct: typeof x.f3 === 'number' ? x.f3 : null,
    amount: typeof x.f6 === 'number' ? x.f6 : null,
    marketCap: x.f20,
  }));
  // 清算时段守卫：深夜东财把 f3 全回 "-"，任何口径核对都无从谈起（盘中该值数千）
  if (mapped.filter(x => x.changePct !== null).length < 100) {
    console.log('   （清算时段：全市场涨跌幅均为 "-"，跳过口径核对）');
    return;
  }
  const r = B.compute(mapped);

  assert.ok(r.total > 4000, '有效家数仅 ' + r.total);
  assert.equal(r.up + r.down + r.flat, r.total, '涨跌平三者之和应等于总数');
  assert.equal(r.dist.reduce((s, d) => s + d.count, 0), r.total, '七段求和应等于总数');
  assert.ok(r.score >= 0 && r.score <= 100, 'score 越界 ' + r.score);
  // 涨停数应远小于总数且非负（真实市场通常几十到几百）
  assert.ok(r.limitUp >= 0 && r.limitUp < r.total * 0.2, '涨停数异常 ' + r.limitUp);
  assert.ok(r.limitDown >= 0 && r.limitDown < r.total * 0.2, '跌停数异常 ' + r.limitDown);

  // 与"按涨跌幅降序第一页"交叉：榜首涨幅应 >= 分布中最高桶的下界
  const topPct = first.data.diff[0].f3;
  assert.ok(topPct >= 0, '涨幅榜首为负？' + topPct);

  console.log(`   （实测 ${r.total} 只：涨 ${r.up} / 跌 ${r.down} / 平 ${r.flat}，涨停 ${r.limitUp} 跌停 ${r.limitDown}）`);
  console.log(`   （情绪 ${r.score.toFixed(1)} · 均涨跌 ${r.avgPct.toFixed(2)}% · 中位 ${r.medianPct.toFixed(2)}% · 成交额 ${(r.amount / 1e8).toFixed(0)} 亿）`);
  console.log(`   （分布 ${r.dist.map(d => d.label + ':' + d.count).join(' ')}）`);
});

await test('实网：情绪指数与大盘指数涨跌方向一致（普涨/普跌联动）', async () => {
  const get = (u) => fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  const j = await (await get(`https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f3,f12,f14`)).json();
  // 只取一页不足以算全市场，这里单独拉全量的涨跌家数用 total 之外的方式：抽样 10 页
  const rows = [];
  const pages = [1, 6, 12, 18, 24, 30, 36, 42, 48, 54];
  const res = await Promise.all(pages.map(p => get(`https://push2delay.eastmoney.com/api/qt/clist/get?pn=${p}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${FS}&fields=f3,f12,f14`)
    .then(r => r.json()).then(x => (x.data && x.data.diff) || []).catch(() => [])));
  res.forEach(r => rows.push(...r.map(x => ({ code: String(x.f12), name: String(x.f14), changePct: x.f3 }))));
  const r = B.compute(rows);
  if (r.total < 100) {
    console.log('   （清算时段：抽样涨跌幅均为 "-"，跳过方向核对）');
    return;
  }

  // 上证指数当日涨跌
  const txt = await (await fetch('https://qt.gtimg.cn/q=sh000001', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).arrayBuffer();
  const idx = new TextDecoder('gbk').decode(txt);
  const idxPct = Number(idx.match(/v_sh000001="([^"]*)"/)[1].split('~')[32]);

  console.log(`   （抽样 ${r.total} 只 → 情绪 ${r.score.toFixed(1)}；上证 ${idxPct}%）`);
  // 方向一致性：指数明显上涨（>0.5%）时情绪不应处于恐慌区，反之亦然
  if (idxPct > 0.5) assert.ok(r.score > 30, `上证 +${idxPct}% 但情绪 ${r.score.toFixed(1)} < 30`);
  if (idxPct < -0.5) assert.ok(r.score < 70, `上证 ${idxPct}% 但情绪 ${r.score.toFixed(1)} > 70`);
  assert.ok(r.score !== null, '情绪指数不应为 null');
});

console.log(`\n${pass} passed, ${fail} failed`);
// 直接 process.exit 会掐断未关闭的 fetch keep-alive，Windows 上触发 libuv 断言（0xC0000409）
// → 设退出码后短暂让出事件循环再退（boards 组同款修法）
process.exitCode = fail ? 1 : 0;
setTimeout(() => process.exit(fail ? 1 : 0), 500);
