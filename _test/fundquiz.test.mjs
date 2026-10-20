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

/* 禁用词表要避开否定式：免责声明里写的是"不推荐买入"，
   直接用 /推荐买入/ 匹配会把免责声明自己判成违规。
   所以命中处的前一个字若是"不/非/未/别/勿"，算否定句，不算违规。 */
const BANNED = ['建议买入', '推荐买入', '必涨', '稳赚', '保本', '保证收益', '一定能', '翻倍', '无风险'];
function bannedHits(text) {
  const hits = [];
  for (const w of BANNED) {
    let i = String(text).indexOf(w);
    while (i >= 0) {
      const prev = i > 0 ? String(text)[i - 1] : '';
      if ('不非未别勿'.indexOf(prev) < 0) {
        hits.push(w + '←「' + String(text).slice(Math.max(0, i - 10), i + w.length + 4) + '」');
      }
      i = String(text).indexOf(w, i + 1);
    }
  }
  return hits;
}

await test('合规回归：结果文案不得出现买入/收益承诺类用语', () => {
  const res = Q.score(pick(3));
  const text = Q.profileText(res);
  assert.deepEqual(bannedHits(text), [], `结果解读出现承诺性用语：${text}`);
  Q.CANDIDATES.forEach(c => {
    assert.deepEqual(bannedHits(c.why), [], `${c.code} 的推荐理由出现承诺性用语`);
    assert.deepEqual(bannedHits(c.risk), [], `${c.code} 的风险提示出现承诺性用语`);
  });
});

await test('适当性分级：对齐中基协 C1–C5 / R1–R5，且 C 级与可买产品上限一一对应', () => {
  for (let r = 1; r <= 5; r++) {
    const c = Q.abilityLevel(r);
    const rc = Q.productCap(r);
    assert.equal(c.code, 'C' + r, `风险档 ${r} 的投资者分级不是 C${r}`);
    assert.equal(rc.code, 'R' + r, `风险档 ${r} 的产品上限不是 R${r}`);
    assert.ok(c.name, `C${r} 缺名称`);
    assert.ok(rc.name, `R${r} 缺名称`);
  }
  // 越界不崩，落到最低档
  assert.equal(Q.abilityLevel(0).code, 'C1');
  assert.equal(Q.abilityLevel(99).code, 'C1');
  assert.equal(Q.productCap(0).code, 'R1');
});

await test('适当性分级：C 级与 R 级同档（Cn 可买 Rn 及以下），不允许出现"C 能买更高 R"的错配', () => {
  for (let r = 1; r <= 5; r++) {
    const cN = parseInt(Q.abilityLevel(r).code.slice(1), 10);
    const rN = parseInt(Q.productCap(r).code.slice(1), 10);
    assert.equal(cN, rN, `C${cN} 的产品上限应是 R${cN} 及以下，实际给了 R${rN}`);
  }
});

await test('判断依据：score 给出逐题拆解，每题都能对上原答案', () => {
  const res = Q.score(pick(2));
  assert.equal(res.breakdown.length, N, '逐题拆解条数应等于题数');
  res.breakdown.forEach((b, i) => {
    assert.equal(b.qi, i, '拆解顺序应与题序一致');
    assert.equal(b.opt, Q.QUESTIONS[i].options[2].t, `第 ${i + 1} 题选项对不上`);
    assert.equal(b.r, Q.QUESTIONS[i].options[2].r, `第 ${i + 1} 题承受度分值对不上`);
  });
  assert.equal(res.rawRisk, res.breakdown.reduce((s, b) => s + b.r, 0), '承受度合计应等于逐题之和');
  assert.equal(res.styleScore, res.breakdown.reduce((s, b) => s + b.s, 0), '风格合计应等于逐题之和');
  assert.equal(res.maxRisk, N * 3, '满分应是题数 × 3');
});

await test('判断依据：只答了一题也能给出拆解（不崩、不虚报题数）', () => {
  const res = Q.score({ 0: 1 });
  assert.equal(res.breakdown.length, 1);
  assert.equal(res.answered, 1);
  assert.ok(res.risk >= 1 && res.risk <= 5);
});

await test('复评：一年的测评到期要提示，没到期不提示', () => {
  const now = Date.now();
  const day = 86400000;
  const fresh = Q.ageInfo(now - 10 * day);
  assert.equal(fresh.stale, false, '10 天前不该提示复评');
  assert.ok(fresh.days >= 9 && fresh.days <= 10, '天数算错');
  const old = Q.ageInfo(now - 400 * day);
  assert.equal(old.stale, true, '400 天前该提示复评');
  assert.ok(old.days >= 399, '天数算错');
  // 没记录时间（老版本存的数据）不提示，但也不能崩
  const none = Q.ageInfo(0);
  assert.equal(none.stale, false);
  assert.equal(none.days, null);
});

await test('复评周期：明确写成一年（与行业里定期重评的常见做法一致）', () => {
  assert.equal(Q.REVALIDATE_DAYS, 365);
});

await test('结果面板：C/R 双分级与推导链都要出现在 HTML 里', () => {
  const res = Q.score(pick(3));
  const html = Q.resultHTML(res);
  assert.match(html, /fq-levels/, '缺 C/R 双分级区块');
  assert.match(html, /你的风险承受能力/, '缺投资者分级标签');
  assert.match(html, /可买的产品风险上限/, '缺产品风险上限标签');
  assert.match(html, /C\d/, '没出现 C 级编号');
  assert.match(html, /R\d/, '没出现 R 级编号');
  assert.match(html, /fq-chain/, '缺判断依据链');
  assert.match(html, /这份清单是怎么算出来的/, '缺推导链标题');
  // 推导链里要逐题列出（6 题都有行）
  const rows = (html.match(/fq-chain-row/g) || []).length;
  assert.equal(rows, N, `推导链应有 ${N} 行，实际 ${rows}`);
  // 推导链的汇总要把承受度合计与闸门命中数说清楚
  assert.match(html, /承受度合计/, '缺承受度合计');
  assert.match(html, /闸门/, '缺闸门说明');
});

await test('结果面板：C 级与 R 级必须成对出现且同档（不允许 C3 配 R4 这种错配）', () => {
  for (let r = 1; r <= 5; r++) {
    const res = Q.score(pick(r === 5 ? 3 : 0));
    const html = Q.resultHTML(res);
    const c = html.match(/你的风险承受能力<\/span>\s*<span class="fq-lv-v"><b>(C\d)<\/b>/);
    const rr = html.match(/可买的产品风险上限<\/span>\s*<span class="fq-lv-v"><b>(R\d)<\/b>/);
    assert.ok(c && rr, `风险档 ${r}：C/R 没成对出现`);
    assert.equal(c[1].slice(1), rr[1].slice(1), `C${c[1]} 配了 ${rr[1]}，应同档`);
  }
});

await test('合规回归：新增的 C/R 说明与推导链也不能出现买入/收益承诺类用语', () => {
  for (let i = 0; i <= 3; i++) {
    const html = Q.resultHTML(Q.score(pick(i)));
    assert.deepEqual(bannedHits(html), [], `选项 ${i} 的结果面板出现承诺性用语`);
  }
  const chain = Q.chainHTML(Q.score(pick(2)), 8, 6);
  assert.deepEqual(bannedHits(chain), [], '推导链出现承诺性用语');
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
