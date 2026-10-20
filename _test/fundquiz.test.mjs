/* fundquiz.test.mjs —— 投资风格测评：纯离线单测（node _test/fundquiz.test.mjs）
   覆盖：评分单调性 / **风险闸门（硬规则）** / 投资期限上限 / 风格匹配 /
   候选池完整性（代码格式、风险提示齐全）/ 合规回归（结果里不得出现承诺性用语）。

   这一组最要紧的是"漏判"方向的断言：保守用户绝不能看到行业主题基金。
   判错的后果不对称——多推一只高波动的，是把用户推向亏损；少推一只，只是少一个选项。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

/* 沙箱：fundquiz.js 只依赖 window.U.escapeHTML 与 window.Store（存答案） */
const ctx = vm.createContext({
  console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, Set, Map, JSON,
});
ctx.window = ctx; ctx.globalThis = ctx;
ctx.U = { escapeHTML: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
const store = new Map();
ctx.Store = {
  get: (k, d) => (store.has(k) ? store.get(k) : d),
  set: (k, v) => { store.set(k, v); },
};
vm.runInContext(readFileSync(path.join(ROOT, 'js/fundquiz.js'), 'utf8'), ctx, { filename: 'js/fundquiz.js' });
const Q = ctx.window.FundQuiz;

const N = Q.QUESTIONS.length;
/* 每题选项序号：0=最保守 3=最激进 */
const pick = (i) => { const a = {}; for (let k = 0; k < N; k++) a[k] = i; return a; };

await test('题目结构：每题都有选项，选项带 r/s 分值', () => {
  assert.ok(N >= 5, '题目数不能太少');
  Q.QUESTIONS.forEach((q, i) => {
    assert.ok(q.q && q.q.length > 4, `第 ${i + 1} 题缺题干`);
    assert.ok(Array.isArray(q.options) && q.options.length >= 3, `第 ${i + 1} 题选项太少`);
    q.options.forEach(o => {
      assert.ok(typeof o.t === 'string' && o.t.length > 1, '选项缺文案');
      assert.equal(typeof o.r, 'number', '选项缺风险分值');
      assert.equal(typeof o.s, 'number', '选项缺风格分值');
    });
  });
});

await test('评分：全选最保守 → 风险档 1；全选最激进 → 风险档 5', () => {
  const lo = Q.score(pick(0));
  const hi = Q.score(pick(3));
  assert.equal(lo.risk, 1, `最保守应为 R1，实际 ${lo.risk}`);
  assert.equal(hi.risk, 5, `最激进应为 R5，实际 ${hi.risk}`);
  assert.ok(lo.style === '防守', '最保守应是防守型');
  assert.ok(hi.style === '进攻', '最激进应是进取型');
});

await test('评分：中间选项 → 中等风险档（3 附近）', () => {
  const mid = Q.score({ 0: 2, 1: 2, 2: 1, 3: 2, 4: 1, 5: 2 });
  assert.ok(mid.risk >= 2 && mid.risk <= 4, `中间档风险应落在 2~4，实际 ${mid.risk}`);
});

await test('风险闸门（硬规则）：推荐里的波动档必须 ≤ 用户风险档', () => {
  for (let r = 1; r <= 5; r++) {
    const res = { risk: r, style: '平衡' };
    const recs = Q.recommend(res);
    recs.forEach(c => {
      assert.ok(c.tier <= r, `R${r} 用户不该看到波动档 ${c.tier} 的 ${c.name}`);
    });
  }
});

await test('风险闸门：投资期限短时上限更低（3 个月内 → 只能 R1 品类）', () => {
  // 第 1 题选"3 个月内"（cap=1），其余全选最激进
  const a = { 0: 0, 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 };
  const res = Q.score(a);
  assert.equal(res.risk, 1, `3 个月内要用的钱应被压到 R1，实际 ${res.risk}`);
  const recs = Q.recommend(res);
  assert.ok(recs.length > 0, 'R1 也该有推荐');
  recs.forEach(c => assert.ok(c.tier <= 1, `R1 用户不该看到波动档 ${c.tier} 的 ${c.name}`));
  // 且清单里只该出现现金管理 / 短债这类
  assert.ok(recs.every(c => c.cat === '货币' || c.cat.includes('国债')), 'R1 清单只该是货币与短债');
});

await test('风险闸门：保守用户绝不会看到行业主题基金', () => {
  const res = { risk: 1, style: '防守' };
  const recs = Q.recommend(res);
  const themeCats = ['半导体', '新能源', '新能源车', '科创', '旅游', '白酒', '电力'];
  recs.forEach(c => {
    assert.ok(!themeCats.includes(c.cat), `保守用户不该看到主题品类「${c.cat}」`);
  });
});

await test('风格匹配：进取型用户的清单里必须有进攻风格项', () => {
  const recs = Q.recommend({ risk: 5, style: '进攻' });
  assert.ok(recs.some(c => c.style === '进攻'), 'R5 进取型应至少有一只进攻风格');
});

await test('候选池完整性：代码格式合法、无重复、每只都有理由与风险提示', () => {
  const seen = new Set();
  Q.CANDIDATES.forEach(c => {
    assert.match(c.code, /^\d{6}$/, `基金代码格式异常：${c.code}`);
    assert.ok(!seen.has(c.code), `基金代码重复：${c.code}`);
    seen.add(c.code);
    assert.ok(c.name && c.name.length > 1, `${c.code} 缺名称`);
    assert.ok(c.cat && c.cat.length > 1, `${c.code} 缺类别`);
    assert.ok(c.tier >= 1 && c.tier <= 5, `${c.code} 波动档越界`);
    assert.ok(c.why && c.why.length > 6, `${c.code} 缺"为什么给你"`);
    assert.ok(c.risk && c.risk.length > 8, `${c.code} 缺"主要风险"——风险提示不能少`);
  });
  assert.ok(Q.CANDIDATES.length >= 15, '候选池太小');
});

await test('候选池每个波动档都有货（低档别断档，否则保守用户没得选）', () => {
  for (let t = 1; t <= 5; t++) {
    const n = Q.CANDIDATES.filter(c => c.tier === t).length;
    assert.ok(n >= 1, `波动档 ${t} 没有任何候选`);
  }
});

await test('合规回归：结果文案不得出现买入/收益承诺类用语', () => {
  const banned = /建议买入|推荐买入|必涨|稳赚|保本|保证收益|一定能|翻倍|无风险/;
  const res = Q.score(pick(3));
  const text = Q.profileText(res);
  assert.ok(!banned.test(text), `结果解读出现承诺性用语：${text}`);
  Q.CANDIDATES.forEach(c => {
    assert.ok(!banned.test(c.why), `${c.code} 的推荐理由出现承诺性用语`);
    assert.ok(!banned.test(c.risk), `${c.code} 的风险提示出现承诺性用语`);
  });
});

await test('容错：空答案/半截答案不崩', () => {
  assert.doesNotThrow(() => Q.score(null));
  assert.doesNotThrow(() => Q.score({}));
  assert.doesNotThrow(() => Q.score({ 0: 99, 1: -1 }));
  assert.doesNotThrow(() => Q.recommend(null));
  assert.doesNotThrow(() => Q.recommend({ risk: 99, style: '不存在' }));
  assert.equal(Q.score({}).answered, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
