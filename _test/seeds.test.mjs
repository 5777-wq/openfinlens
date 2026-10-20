/* seeds.test.mjs —— 采集产物的数据体检（纯离线，读仓库内静态 JSON）
   全球事件种子与伯克希尔 13F 种子必须满足结构完整 + 数量级合理；
   数据缺失（文件不存在）不算失败，但已有文件绝不能是脏数据。 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

await test('global-events.json：结构完整，坐标只允许 null 或有限数，标题非空', async () => {
  const f = path.join(ROOT, 'data/events/global-events.json');
  if (!existsSync(f)) { console.log('   （种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(Array.isArray(d.events), true);
  assert.equal(typeof d.generatedAt, 'string');
  assert.ok(d.count === d.events.length, 'count 字段与实际条数一致');
  assert.ok(d.events.length <= 260, '不超过 CAP');
  for (const e of d.events) {
    assert.ok(typeof e.title === 'string' && e.title.length > 4);
    assert.ok(['high', 'med', 'low'].includes(e.importance));
    assert.equal(Number.isFinite(Date.parse(e.publishedAt)), true, 'publishedAt 可解析');
    if (e.lat !== null) {
      assert.ok(Number.isFinite(e.lat) && Math.abs(e.lat) <= 90, '纬度有限');
      assert.ok(Number.isFinite(e.lng) && Math.abs(e.lng) <= 180, '经度有限');
    }
    assert.equal(Array.isArray(e.relatedSymbols), true);
  }
});

await test('13f.json：每家机构量级/占比/环比合法，期权单列且滞后天数可信', async () => {
  const f = path.join(ROOT, 'data/actors/13f.json');
  if (!existsSync(f)) { console.log('   （种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(d.institutions) && d.institutions.length > 0, 'institutions 应非空');
  for (const inst of d.institutions) {
    assert.equal(typeof inst.reportDate, 'string', `${inst.slug} reportDate`);
    assert.equal(typeof inst.filedAt, 'string', `${inst.slug} filedAt`);
    assert.ok(inst.totalValueUsd >= 1e8 && inst.totalValueUsd <= 1e13,
      `${inst.slug} 组合合计 ${inst.totalValueUsd} 超出合理量级（value 口径 2023 起为整美元）`);
    assert.ok(inst.holdings.length > 0, `${inst.slug} 应有持仓行`);
    // 滞后天数必须存在且在合理区间（13F 法定截止 = 季末后 45 天；不该小到像实时、大到像坏数据）
    assert.ok(Number.isFinite(inst.lagDays) && inst.lagDays >= 20 && inst.lagDays <= 120,
      `${inst.slug} lagDays=${inst.lagDays} 不合理`);
    let pctSum = 0;
    for (const h of inst.holdings) {
      assert.ok(typeof h.issuer === 'string' && h.issuer.length > 1, 'issuer 非空');
      assert.ok(h.valueUsd >= 0 && h.valueUsd <= inst.totalValueUsd, '单行市值不超过组合合计');
      assert.ok(['SH', 'CALL', 'PUT'].includes(h.kind), `${inst.slug} kind 非法: ${h.kind}`);
      pctSum += h.pctOfTotal || 0;
      // UNKNOWN：上期 13F 没取到 → 环比无法判断（2026-10-20 加；以前这种情况被标成 NEW，
      // 界面于是断言"全部新进"，是假的）
      assert.ok(['NEW', 'ADD', 'TRIM', 'HOLD', 'EXIT', 'UNKNOWN'].includes(h.change), '环比标签合法');
    }
    assert.ok(pctSum <= 100.5, `${inst.slug} 占比合计 ${pctSum}% 不该超过 100%`);
    // 同一 CUSIP 允许多行，但只能因"正股 + 期权"这种不同 kind 而重复；
    // 同 kind 重复即说明聚合键退回了纯 CUSIP（历史 bug：ARK 的 00214Q104 正股+Call 被并成一行）
    const byCusip = new Map();
    inst.holdings.forEach(h => {
      if (!byCusip.has(h.cusip)) byCusip.set(h.cusip, []);
      byCusip.get(h.cusip).push(h.kind);
    });
    byCusip.forEach((kinds, cusip) => {
      assert.equal(new Set(kinds).size, kinds.length,
        `${inst.slug} 的 ${cusip} 出现同 kind 重复行（聚合未按 CUSIP+kind 拆分）`);
    });
    // 环比可信度标记（2026-10-20 加）：上期取不到时必须是 priorAvailable:false +
    // 全部 change='UNKNOWN' + priorReportDate=null —— 绝不能照抄一个正常日期骗人，
    // 更不能把"取不到"显示成"全部新进"。
    assert.equal(typeof inst.priorAvailable, 'boolean', `${inst.slug} 缺 priorAvailable 标记`);
    if (inst.priorAvailable === false) {
      assert.equal(inst.priorReportDate, null, `${inst.slug} 上期不可用时 priorReportDate 应为 null`);
      assert.ok(inst.holdings.every(h => h.change === 'UNKNOWN'),
        `${inst.slug} 上期不可用时所有档位必须是 UNKNOWN，不得出现 NEW/ADD/TRIM/HOLD`);
      assert.ok(!inst.exits || inst.exits.length === 0, `${inst.slug} 上期不可用时不该有 exits`);
    } else {
      assert.ok(typeof inst.priorReportDate === 'string' && inst.priorReportDate.length === 10,
        `${inst.slug} 上期可用时 priorReportDate 应是 YYYY-MM-DD`);
      assert.ok(!inst.holdings.some(h => h.change === 'UNKNOWN'),
        `${inst.slug} 上期可用时不该出现 UNKNOWN`);
    }
  }
});

await test('fundholds.json：报告期/滞后合理，增仓为正、减仓为负，变动金额量级可信', async () => {
  const f = path.join(ROOT, 'data/actors/fundholds.json');
  if (!existsSync(f)) { console.log('   （种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(typeof d.reportDate, 'string', 'reportDate');
  assert.ok(Number.isFinite(d.lagDays) && d.lagDays >= 15 && d.lagDays <= 200,
    `lagDays=${d.lagDays} 不合理（季度披露，实测约 78 天）`);
  assert.ok(Array.isArray(d.topAdd) && d.topAdd.length > 0, 'topAdd 应非空');
  assert.ok(Array.isArray(d.topTrim) && d.topTrim.length > 0, 'topTrim 应非空');
  for (const x of d.topAdd) {
    assert.ok(x.code && x.name, '代码与名称非空');
    assert.ok(x.chgShares > 0, `增仓榜出现非正变动: ${x.name} ${x.chgShares}`);
    assert.ok(x.chgValue > 0, `增仓榜变动金额应为正: ${x.name} ${x.chgValue}`);
    assert.equal(x.reportDate, d.reportDate, '增仓榜应全是同一报告期');
  }
  for (const x of d.topTrim) {
    assert.ok(x.chgShares < 0, `减仓榜出现非负变动: ${x.name} ${x.chgShares}`);
    assert.ok(x.chgValue < 0, `减仓榜变动金额应为负: ${x.name} ${x.chgValue}`);
    assert.equal(x.reportDate, d.reportDate, '减仓榜应全是同一报告期');
  }
  // 排序契约：榜内按 |变动金额| 非递增（前端不再排序，直接渲染）
  const desc = (arr) => arr.every((x, i) => i === 0 || Math.abs(arr[i - 1].chgValue) >= Math.abs(x.chgValue) - 1);
  assert.ok(desc(d.topAdd), '增仓榜应按 |变动金额| 降序');
  assert.ok(desc(d.topTrim), '减仓榜应按 |变动金额| 降序');
});

await test('etf.json：因子 ETF 持仓——只含股票行、占净值降序、交集与基金清单互恰', async () => {
  const f = path.join(ROOT, 'data/actors/etf.json');
  if (!existsSync(f)) { console.log('   （种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(typeof d.asOf, 'string', 'asOf（持仓基准日）');
  assert.ok(Number.isFinite(d.lagDays) && d.lagDays >= 0 && d.lagDays <= 10,
    `lagDays=${d.lagDays} 不合理（日更披露，超过 10 天说明产物过期）`);
  assert.ok(Array.isArray(d.funds) && d.funds.length >= 2, '至少两只因子 ETF 才能算交集');
  const keys = new Set();
  for (const fd of d.funds) {
    keys.add(fd.key);
    assert.ok(fd.ticker && fd.cusip, `${fd.key} ticker/cusip`);
    // 官方 feed 里的现金/货币基金/期货（AGPXX、USD、USDPDV、IFUT/SYN…）必须在采集层被滤掉
    const JUNK = /^(AGPXX|USD|USDPDV|CURRCOL|UCURR)$/i;
    assert.ok(fd.holdings.length > 0, `${fd.ticker} 持仓应非空`);
    assert.ok(fd.holdings.length <= fd.equityCount, '展示行数不超过股票总数');
    assert.ok(fd.shownPct > 0 && fd.shownPct <= 100, `${fd.ticker} Top 占净值 ${fd.shownPct}%`);
    let sum = 0;
    fd.holdings.forEach((h, i) => {
      assert.ok(!JUNK.test(h.ticker), `${fd.ticker} 混入非股票行 ${h.ticker}`);
      assert.ok(h.pct > 0, `${fd.ticker} ${h.ticker} 占净值应为正`);
      assert.ok(h.sym && h.sym.startsWith('us'), `${h.ticker} sym 应是腾讯美股代码`);
      if (i > 0) assert.ok(fd.holdings[i - 1].pct >= h.pct, `${fd.ticker} 应按占净值降序`);
      sum += h.pct;
    });
    // shownPct 与逐行求和一致（±0.5% 容浮点）
    assert.ok(Math.abs(sum - fd.shownPct) < 0.5, `${fd.ticker} shownPct=${fd.shownPct} 与逐行和 ${sum.toFixed(2)} 不符`);
  }
  // 交集：键与基金清单互恰，两两占净值都为正，且按合计降序
  assert.ok(Array.isArray(d.overlap.rows), 'overlap.rows');
  for (const k of d.overlap.keys) assert.ok(keys.has(k), `overlap 引用了未知基金 ${k}`);
  let prev = Infinity;
  for (const r of d.overlap.rows) {
    const a = r.pcts[d.overlap.keys[0]], b = r.pcts[d.overlap.keys[1]];
    assert.ok(a > 0 && b > 0, `${r.ticker} 交集行两侧占净值都应为正`);
    const s = a + b;
    assert.ok(prev >= s - 1e-9, '交集应按合计占净值降序');
    prev = s;
  }
  // 中文名覆盖率（腾讯批量补名，偶尔失败可容忍，但大面积缺失说明补名链路断了）
  const all = d.funds.flatMap(fd => fd.holdings).concat(d.overlap.rows);
  const named = all.filter(h => h.zh && h.zh.length).length;
  assert.ok(named >= all.length * 0.8, `中文名覆盖 ${named}/${all.length} 过低`);
});

await test('polymarket.json：事件+档位结构、概率合法、绝无 slug/URL（合规回归）', async () => {
  const f = path.join(ROOT, 'data/events/polymarket.json');
  if (!existsSync(f)) { console.log('   （种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(Array.isArray(d.events), true);
  if (!d.events.length) {
    // 占位文件（采集还没跑过）必须没有 generatedAt，前端据此走"诚实空态"而非假数据
    assert.equal(d.generatedAt, null, '空产物不得伪造 generatedAt');
    return;
  }
  assert.equal(typeof d.generatedAt, 'string');
  assert.ok(d.count === d.events.length, 'count 字段与实际条数一致');
  assert.ok(d.events.length <= 30, '不超过 CAP');
  const CATS = ['central_bank', 'macro', 'trade', 'geopolitics', 'election', 'energy'];
  for (const e of d.events) {
    assert.ok(typeof e.title === 'string' && e.title.length > 4, `事件标题异常: ${e.title}`);
    assert.ok(CATS.includes(e.category), `类别越界 ${e.category}`);
    assert.ok(typeof e.partition === 'boolean', 'partition 必须是布尔（决定能不能画环图）');
    assert.ok(Array.isArray(e.outcomes) && e.outcomes.length > 0, '事件必须至少有一个档位');
    for (const o of e.outcomes) {
      assert.ok(typeof o.label === 'string' && o.label.length > 0, `档位名异常: ${o.label}`);
      assert.ok(o.probability >= 0 && o.probability <= 1, `概率越界 ${o.probability}`);
      assert.ok(typeof o.q === 'string' && !/\.\.\.|…/.test(o.q), `问句不完整: ${o.q}`);
      // 中文标签：要么没有（翻译失败保留英文），要么是与原文不同的非空字符串
      if (o.labelZh !== null && o.labelZh !== undefined) {
        assert.ok(typeof o.labelZh === 'string' && o.labelZh.length > 0 && o.labelZh !== o.label,
          `labelZh 非法: ${o.labelZh}`);
      }
    }
    // 档位按概率降序（环图扇区顺序依赖它）
    for (let i = 1; i < e.outcomes.length; i++) {
      assert.ok(e.outcomes[i - 1].probability >= e.outcomes[i].probability, '档位应按概率降序');
    }
    // rest 聚合：概率质量不许凭空多出或少掉
    assert.ok(e.rest && e.rest.probability >= 0 && e.rest.count >= 0, 'rest 聚合字段异常');
    // 互斥事件的档位报价合计应接近 100%（环图成立的前提）
    if (e.partition) {
      const sum = e.outcomes.reduce((s, o) => s + o.probability, 0) + e.rest.probability;
      assert.ok(sum > 0.5 && sum < 1.5, `互斥事件报价合计 ${sum.toFixed(3)} 偏离 100% 过多`);
    }
    // 合规铁律：产物里不允许出现 slug / 链接 / tokenId / 交易平台入口
    assert.ok(!/slug|href|https?:|tokenid|clobtoken/i.test(JSON.stringify(e)), '事件里出现 slug/链接/交易标识');
  }
});

await test('polymarket-history.json：网格对齐、概率合法、绝无链接（合规回归）', async () => {
  const f = path.join(ROOT, 'data/events/polymarket-history.json');
  if (!existsSync(f)) { console.log('   （历史种子尚未生成，跳过）'); return; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(typeof d.generatedAt, 'string');
  assert.ok(Number.isFinite(d.binMs) && d.binMs > 0, 'binMs 非法');
  assert.ok(Number.isFinite(d.from) && d.from % d.binMs === 0, '网格起点必须对齐 bin');
  assert.ok(Number.isFinite(d.count) && d.count > 0, 'count 非法');
  assert.equal(typeof d.series, 'object');
  const ids = Object.keys(d.series);
  assert.ok(ids.length > 0, '历史序列为空');
  for (const id of ids) {
    assert.match(id, /^pm:\d+$/, `档位 id 形态异常: ${id}`);
    const arr = d.series[id];
    assert.equal(Array.isArray(arr), true);
    assert.ok(arr.length <= d.count, '序列长度不得超过格数');
    for (const v of arr) {
      if (v === null) continue;                       // 缺测格 = null（不插值）
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1000, `序列值非法: ${v}`);
    }
  }
  assert.ok(!/slug|href|https?:|tokenid|clobtoken/i.test(JSON.stringify(d)), '历史里出现 slug/链接/交易标识');
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
}, 50);
