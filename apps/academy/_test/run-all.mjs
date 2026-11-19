#!/usr/bin/env node
/* run-all.mjs —— node 直跑测试（无浏览器、无网络依赖）
   用法：node _test/run-all.mjs */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? '  →  ' + extra : '')); }
}

function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function near(name, actual, expected, tol = 1e-6) {
  ok(name, typeof actual === 'number' && Math.abs(actual - expected) <= tol,
    `期望 ≈${expected}，实际 ${actual}`);
}

/* ---------- 在 vm 里加载浏览器侧模块（它们是 window 风格的 IIFE） ---------- */
function loadScripts(files) {
  const sandbox = { window: {}, console, Math, Date, JSON, Map, Set, Number, String, Array, Object };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    const code = readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return sandbox.window;
}

/* ============================================================
   1. 纯函数引擎层
   ============================================================ */
{
  const W = loadScripts([
    'js/engine/series.js',
    'js/engine/percentile.js',
    'js/engine/drawdown.js',
    'js/engine/spread.js',
    'js/engine/similarity.js',
    'js/engine/analogy.js',
  ]);
  const S = W.Engine.series, P = W.Engine.percentile, D = W.Engine.drawdown;
  const SP = W.Engine.spread, SIM = W.Engine.similarity, AN = W.Engine.analogy;

  // --- series ---
  const pts = [
    { t: '2024-01-31', v: 100 }, { t: '2024-02-29', v: 110 },
    { t: '2024-03-31', v: 90 }, { t: '2024-04-30', v: 120 },
  ];
  eq('series.valueAt 命中精确日期', S.valueAt(pts, '2024-03-31'), 90);
  eq('series.valueAt 取最近的前值（step-hold）', S.valueAt(pts, '2024-03-15'), 110);
  eq('series.valueAt 早于全部数据返回 null', S.valueAt(pts, '2023-01-01'), null);
  eq('series.valueFrom 取最近的后值', S.valueFrom(pts, '2024-03-15'), 90);
  eq('series.slice 区间切片', S.slice(pts, '2024-02-01', '2024-03-31').length, 2);
  eq('series.normalize 起点=100', S.normalize(pts)[0].v, 100);
  near('series.normalize 末点=120%', S.normalize(pts)[3].v, 120, 1e-9);
  near('series.change 区间涨跌', S.change(pts), 20, 1e-9);

  const al = S.align(pts, [{ t: '2024-01-31', v: 1 }, { t: '2024-04-30', v: 2 }]);
  eq('series.align 公共日期数', al.dates.length, 2);
  eq('series.align 保留各自原值', al.a[1], 120);

  // --- percentile ---
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  near('percentile 中位数的分位是 50', P.percentile(vals, 5.5), 50, 1e-9);
  near('percentile 最小值的分位是 10', P.percentile(vals, 1), 10, 1e-9);
  near('percentile 最大值的分位是 100', P.percentile(vals, 10), 100, 1e-9);
  eq('percentile 空数组返回 null', P.percentile([], 5), null);
  eq('percentile.band 极高位', P.band(95).label, '历史极高位');
  eq('percentile.band 极低位', P.band(5).label, '历史极低位');

  // --- drawdown ---
  const ddPts = [
    { t: '1', v: 100 }, { t: '2', v: 120 }, { t: '3', v: 60 }, { t: '4', v: 90 },
  ];
  const md = D.maxDrawdown(ddPts);
  near('drawdown.maxDrawdown = 50%', md.pct, 50, 1e-9);
  eq('drawdown.maxDrawdown 起点', md.from, '2');
  eq('drawdown.maxDrawdown 终点', md.to, '3');
  const ds = D.drawdownSeries(ddPts);
  eq('drawdown.drawdownSeries 峰值处为 0', ds[1].v, 0);
  near('drawdown.drawdownSeries 谷底为 -50%', ds[2].v, -50, 1e-9);

  // --- spread ---
  const curve = [
    { y: 0.25, label: '3月', value: 4.7 }, { y: 2, label: '2年', value: 4.2 },
    { y: 10, label: '10年', value: 4.4 }, { y: 30, label: '30年', value: 4.6 },
  ];
  const sh = SP.curveShape(curve);
  eq('spread.curveShape 识别倒挂', sh.shape, 'inverted');
  ok('spread.curveShape 倒挂时 inverted=true', sh.inverted === true);
  const flatCurve = [{ y: 0.25, value: 4.0 }, { y: 10, value: 4.5 }];
  eq('spread.curveShape 识别正常', SP.curveShape(flatCurve).shape, 'normal');
  const trulyFlat = [{ y: 0.25, value: 4.0 }, { y: 10, value: 4.05 }];
  eq('spread.curveShape 识别平坦（利差<15bp）', SP.curveShape(trulyFlat).shape, 'flat');
  const sp = SP.spread(curve, 10, 2);
  near('spread.spread 10年-2年 = 20bp', sp.bp, 20, 1e-9);
  near('spread.goldOilRatio', SP.goldOilRatio(2000, 50), 40, 1e-9);
  near('spread.realRate', SP.realRate(4, 3), 1, 1e-9);

  // --- similarity ---
  const st = SIM.stats([1, 2, 3, 4, 5]);
  near('similarity.stats mean', st.mean, 3, 1e-9);
  near('similarity.stats std', st.std, Math.sqrt(2), 1e-9);
  eq('similarity.zscore 均值处为 0', SIM.zscore(3, 3, 1.4142), 0);

  // --- analogy ---
  const cmp = AN.compare(
    { valuation: 80, liquidity: 60, narrative: 90, profit: 40, breadth: 30, structure: 50 },
    { valuation: 75, liquidity: 55, narrative: 95, profit: 35, breadth: 25, structure: 70 },
  );
  eq('analogy.compare 用了全部六个维度', cmp.usedDimensions, 6);
  ok('analogy.compare 相似度在 0-100', cmp.similarity >= 0 && cmp.similarity <= 100);
  const diffs = AN.differences(cmp);
  eq('analogy.differences 覆盖全部维度', diffs.length, 6);
  ok('analogy.differences 按差异降序', diffs[0].diff >= diffs[diffs.length - 1].diff);
  const partial = AN.compare({ valuation: 50 }, { valuation: 50 });
  eq('analogy.compare 缺数据时只算已有维度', partial.usedDimensions, 1);
  eq('analogy.compare 缺数据时 similarity 仍有值', partial.similarity, 100);
}

/* ============================================================
   1b. 标的读数：收益率与价格两套口径
   ============================================================ */
{
  const W = loadScripts(['js/engine/percentile.js', 'js/engine/drawdown.js', 'js/engine/instrument.js']);
  const I = W.Engine.instrument;
  const price = {
    unit: '点', kind: '月收盘价',
    points: [{ t: '2024-01-31', v: 100 }, { t: '2024-02-29', v: 120 }, { t: '2024-03-29', v: 60 }],
  };
  const rate = {
    unit: '%', kind: '月末值',
    points: [{ t: '2024-01-31', v: 5 }, { t: '2024-02-29', v: 2 }, { t: '2024-03-29', v: 3.5 }],
  };
  const sp = I.stats(price);
  const sr = I.stats(rate);
  eq('价格序列：峰谷跌幅按百分比', Math.round(sp.dropPct), -50);
  eq('价格序列：不是收益率口径', sp.isRate, false);
  eq('收益率序列：认得出是收益率', sr.isRate, true);
  // 从 5% 跌到 2% 是「跌了 3 个百分点」，不是「跌了 60%」——
  // 百分比那套算法对收益率是错的（页面里也照它渲染过）。
  eq('收益率序列：峰谷变动用个百分点', sr.spreadPp, 3);
  ok('收益率序列：不给百分比跌幅', sr.dropPct < 0 && sr.spreadPp !== sr.dropPct, `dropPct=${sr.dropPct} spreadPp=${sr.spreadPp}`);
  ok('收益率序列：近一年用基点', sr.chg1yBp === null || typeof sr.chg1yBp === 'number', String(sr.chg1yBp));

  /* --- 回撤的先后顺序：谷底必须在峰值之后 ---
     以前的算法拿全样本 max / min 直接相除。谷底早于峰值时，
     算出来的是两个不相干日期的比值（-95%、-99% 这种），读者一对就发现是假的。 */
  const midPeak = {
    unit: '点', kind: '月收盘价',
    points: [
      { t: '2020-01-31', v: 80 },
      { t: '2020-02-29', v: 120 },   // 峰值在中间
      { t: '2020-03-31', v: 60 },
      { t: '2020-04-30', v: 40 },
    ],
  };
  const mp = I.stats(midPeak);
  eq('峰谷跌幅：谷底必须在峰值之后', Math.round(mp.dropPct), -67);   // 120 → 40
  ok('谷底时间晚于峰值时间', mp.mddTrough.t > mp.mddPeak.t, mp.mddPeak.t + ' / ' + mp.mddTrough.t);

  // 反向夹具：低点在前、高点在后，不能被算成回撤
  const lowFirst = {
    unit: '点', kind: '月收盘价',
    points: [
      { t: '2020-01-31', v: 40 },
      { t: '2020-02-29', v: 120 },
    ],
  };
  const lf = I.stats(lowFirst);
  eq('低点在前时不能报出巨大的负回撤', Math.round(lf.dropPct), 0);
  ok('低点在前时谷底不能早于峰值', lf.mddTrough.t >= lf.mddPeak.t, lf.mddPeak.t + ' / ' + lf.mddTrough.t);

  // 历史最高 / 历史最低仍然各自独立：不受回撤口径影响
  eq('历史最高仍取全样本最高点', mp.peak.v, 120);
  eq('历史最低仍取全样本最低点', mp.trough.v, 40);
  eq('历史最低的时间不受回撤口径影响', mp.trough.t, '2020-04-30');

  /* --- 最后一点是不是「当月未收」的盘中值 ---
     采集器月中的时候写的是当天盘中价，页面把它标成「最新月末」就是在撒谎。 */
  const monthEnd = {
    unit: '点', kind: '月收盘价',
    points: [{ t: '2024-01-31', v: 100 }, { t: '2024-02-29', v: 110 }, { t: '2024-03-29', v: 90 }],
  };
  eq('月末序列：最后一点不算未收', I.stats(monthEnd).partial, false);
  const midMonth = {
    unit: '点', kind: '月收盘价',
    points: [{ t: '2024-01-31', v: 100 }, { t: '2024-02-29', v: 110 }, { t: '2024-03-21', v: 90 }],
  };
  eq('月中快照：标记为当月未收', I.stats(midMonth).partial, true);
  eq('采集器打了 partial 标记就听标记的', I.stats({
    unit: '点', kind: '月收盘价',
    points: [{ t: '2024-01-31', v: 100 }, { t: '2024-02-29', v: 110 }],
    partial: true,
  }).partial, true);
}

/* ============================================================
   1c. 全部历史序列：回撤口径 + 末点口径
   ============================================================ */
{
  const W = loadScripts(['js/engine/percentile.js', 'js/engine/drawdown.js', 'js/engine/instrument.js']);
  const I = W.Engine.instrument;
  const dir = path.join(ROOT, 'data', 'history');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('crisis'));
  let mddOrder = 0, mddAbsurd = 0, partialMarked = 0, lastNotMonth = 0;
  const absurd = [], badOrder = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const st = I.stats(j);
    if (!st) continue;
    if (st.mddTrough.t < st.mddPeak.t) { mddOrder++; badOrder.push(f); }
    // 价格类序列不可能跌 95% 以上还叫「最大回撤」——那说明谷底取错了位置
    if (!st.isRate && st.dropPct < -95) { mddAbsurd++; absurd.push(f + ' ' + st.dropPct.toFixed(1)); }
    if (st.partial) partialMarked++;
    const d = new Date(st.to + 'T00:00:00Z');
    const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (st.to !== eom) lastNotMonth++;
  }
  ok('每条序列的谷底都不早于峰值', mddOrder === 0, badOrder.join(' '));
  ok('没有序列算出 -95% 以下的假回撤', mddAbsurd === 0, absurd.join(' '));
  ok('末点不是自然月末的序列都被标成「当月未收」', partialMarked === lastNotMonth,
    `标了 ${partialMarked} 条 / 实际 ${lastNotMonth} 条`);
}

/* ============================================================
   1d. 视图不许用全局查找找自己的节点
   ============================================================ */
{
  /* document.getElementById 是在**整个文档**里找同名节点。
     视图渲染是异步的：旧页面 await 回来时，新页面已经有同名节点了，
     旧数据就会被写进新页面——URL 显示 A，图上画的却是 B。
     所以这些文件里找渲染节点只许用容器作用域（view.querySelector / host.querySelector）。
     唯一豁免：六视图共享的 <style id="entry-cards-css"> 单例的存在性检查
     （if (document.getElementById(ENTRY_CSS_ID)) return;）——注入发生在任何
     await 之前、样式内容是常量、命中即 return，旧数据写不进任何节点，
     竞态不成立；list/path 两文件同款不受限。豁免凭证：ENTRY_CSS_ID 必须
     逐字定义为 'entry-cards-css'，且只放行这一种语句形态，其余照旧命中。 */
  const scoped = ['js/views/crisis.js', 'js/views/chain.js', 'js/components/replay-player.js'];
  for (const f of scoped) {
    const src = readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 注释里写的反例不算
      .replace(/^\s*\/\/.*$/gm, '');
    const cssIdOk = /const\s+ENTRY_CSS_ID\s*=\s*['"]entry-cards-css['"]\s*;/.test(src);
    const body = cssIdOk
      ? src.replace(/if\s*\(\s*document\.getElementById\s*\(\s*ENTRY_CSS_ID\s*\)\s*\)\s*return\s*;/g, '')
      : src;
    ok(f + '：不许用 document.getElementById 找自己的节点',
      !/document\.getElementById\s*\(/.test(body),
      '命中：' + (body.match(/document\.getElementById\s*\([^)]*\)/g) || []).join(' '));
  }
}

/* ============================================================
   1e. 文档承诺与实现一致
   ============================================================ */
{
  const appSrc = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  ok('file:// 打开有明确提示', /location\.protocol\s*===\s*['"]file:['"]/.test(appSrc),
    'app.js 里没有 file:// 守卫');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok('README 不再承诺「双击就能用」',
    !/双击[^。\n]*就能用/.test(readme) && !/clone 下来双击/.test(readme),
    'README 里还有「双击就能用」');
  ok('README 说清了用本地服务器打开', /scripts\/serve\.mjs/.test(readme));
}

/* ============================================================
   1f. 内容里的数字不许悄悄过期
   ============================================================ */
{
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const contentFiles = walk(path.join(ROOT, 'content')).filter((f) => /\.(md|json)$/.test(f));

  /* ① U+FFFD 乱码：已经出过一次（富时100 那条「英国」），还会再犯。
        乱码一旦进术语库，抽屉、速查表、搜索三处一起坏。 */
  const bad = contentFiles.filter((f) => readFileSync(f, 'utf8').includes('\uFFFD'));
  ok('内容里没有 U+FFFD 乱码', bad.length === 0, bad.join(' '));

  /* ② 「今天 + 数字」：这类句子发布第二天就过期。
        「今天的100块」是讲概念，豁免；「今天 393.80」是报价，不许出现。 */
  const todayHits = [];
  for (const f of contentFiles.filter((x) => x.endsWith('.md'))) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/今天\s*[\d.]/.test(l)) todayHits.push(path.relative(ROOT, f) + ':' + (i + 1));
    });
  }
  ok('正文里不许出现「今天 + 数字」', todayHits.length === 0, todayHits.join(' '));

  /* ③ 手写价格必须还能在站内序列里对上。
        「最疯 / 最惨」那几行写的是月末价，序列每刷新一次就可能变——
        写死的数字会悄悄过期，读者对着数据卡一对就发现对不上，整站失信。 */
  const assetsSrc = readFileSync(path.join(ROOT, 'js/views/assets.js'), 'utf8');
  const so = /const SERIES_OF = \{([\s\S]*?)\n  \};/.exec(assetsSrc);
  const SERIES_OF = {};
  if (so) {
    for (const line of so[1].split('\n')) {
      const kv = /^\s*'?([^':]+)'?\s*:\s*'([^']+)'/.exec(line);
      if (kv) SERIES_OF[kv[1]] = kv[2];
    }
  }
  const priceMiss = [];
  for (const f of readdirSync(path.join(ROOT, 'content/assets')).filter((x) => x.endsWith('.md'))) {
    const id = f.replace(/\.md$/, '');
    const sid = SERIES_OF[id] || id;
    const sp = path.join(ROOT, 'data/history', sid + '.json');
    if (!existsSync(sp)) continue;
    const j = JSON.parse(readFileSync(sp, 'utf8'));
    const vals = new Set((j.points || []).map((x) => Number(x.v).toFixed(2)));
    const text = readFileSync(path.join(ROOT, 'content/assets', f), 'utf8');
    const nums = [];
    for (const re of [/月末价\s*([\d.]+)/g, /从\s*([\d.]+)\s*到\s*([\d.]+)/g]) {
      let hit;
      while ((hit = re.exec(text))) {
        nums.push(hit[1]);
        if (hit.length === 3) nums.push(hit[2]);
      }
    }
    for (const v of nums) {
      if (!vals.has(Number(v).toFixed(2))) priceMiss.push(f + ' 的 ' + v);
    }
  }
  ok('标的文里手写的价格都能在站内序列里对上', priceMiss.length === 0, priceMiss.join(' / '));
}

/* ============================================================
   2. 格式化层
   ============================================================ */
{
  const W = loadScripts(['js/site/format.js']);
  const F = W.Fmt;
  eq('fmt.cnDate', F.cnDate('2026-10-21'), '2026年10月21日');
  eq('fmt.cnDateShort', F.cnDateShort('2026-10-21'), '10月21日');
  eq('fmt.cnDateWithWeek', F.cnDateWithWeek('2026-10-21'), '10月21日 周三');
  eq('fmt.num null → --', F.num(null), '--');
  eq('fmt.num 千分位', F.num(12345.678, 2), '12,345.68');
  eq('fmt.pct 正号', F.pct(1.234), '+1.23%');
  eq('fmt.pct 负号', F.pct(-1.234), '-1.23%');
  eq('fmt.dir 上升', F.dir(0.1), 'up');
  eq('fmt.dir 下降', F.dir(-0.1), 'down');
  eq('fmt.dir 持平', F.dir(0), 'flat');
  eq('fmt.esc 转义尖括号', F.esc('<b>'), '&lt;b&gt;');
  ok('fmt.md 生成段落', F.md('第一段\n\n第二段').includes('<p>第二段</p>'));
  ok('fmt.md 生成标题', F.md('## 标题').includes('<h2>标题</h2>'));
  ok('fmt.md 生成列表', F.md('- 甲\n- 乙').includes('<li>甲</li>'));

  // 链接协议白名单：正文里的链接不许变成 javascript: 这种可点的注入面
  ok('fmt.md 不给 javascript: 链接生成 <a>', !F.md('[x](javascript:alert(1))').includes('<a'),
    F.md('[x](javascript:alert(1))'));
  ok('fmt.md 不给 data: 链接生成 <a>', !F.md('[x](data:text/html,x)').includes('<a'));
  ok('fmt.md 正常外链照样生成', F.md('[x](https://example.com)').includes('<a href="https://example.com"'));
  ok('fmt.md 外链带 noopener', F.md('[x](https://example.com)').includes('rel="noopener noreferrer"'));
  ok('fmt.md 站内锚点保留', F.md('[x](#/terms)').includes('<a href="#/terms"'));

  // 多行引用：以前先 join('<br>') 再转义，页面上直接显示「&lt;br&gt;」
  const quote = F.md('> 第一行\n> 第二行');
  ok('fmt.md 多行引用有真正的 <br>', quote.includes('<br>'), quote);
  ok('fmt.md 多行引用不出现 &lt;br&gt;', !quote.includes('&lt;br&gt;'), quote);
}

/* ============================================================
   3. 术语卡：正文标记注入
   ============================================================ */
{
  const W = loadScripts(['js/site/format.js', 'js/components/term-card.js']);
  const glossary = { 'risk-free-rate': { term: '无风险利率', one: '尺子' } };
  const marked = W.TermCard.markTerms('参见[[risk-free-rate|无风险利率]]与[[unknown-x]]。', glossary);
  ok('term-card 已知术语渲染成可点锚点', marked.includes('data-term="risk-free-rate"'));
  ok('term-card 显示文本被保留', marked.includes('>无风险利率</span>'));
  ok('term-card 未知术语不注入', !marked.includes('data-term="unknown-x"'));
  const card = W.TermCard.render({ term: 'X', one: '一句话', metaphor: '比喻', number: '数字', pit: '坑' });
  ok('term-card 四段齐全', card.includes('一句话') && card.includes('比喻') && card.includes('数字') && card.includes('坑'));
}

/* ============================================================
   4. 数据契约：注册表与产物必须一致
   ============================================================ */
{
  const mapPath = path.join(ROOT, 'data', 'series-map.json');
  if (existsSync(mapPath)) {
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    ok('series-map 至少登记 8 条序列', (map.series || []).length >= 8, `实际 ${(map.series || []).length}`);
    for (const s of map.series || []) {
      const p = path.join(ROOT, 'data', 'history', s.id + '.json');
      ok(`series-map 的 ${s.id} 有对应产物文件`, existsSync(p));
      if (existsSync(p)) {
        const j = JSON.parse(await readFile(p, 'utf8'));
        ok(`${s.id} 产物点数与注册表一致`, j.points.length === s.count,
          `产物 ${j.points.length} vs 注册表 ${s.count}`);
        ok(`${s.id} 产物有来源标注`, !!j.source);
        ok(`${s.id} 序列首末日期合法`, /^\d{4}-\d{2}-\d{2}$/.test(j.points[0].t) && /^\d{4}-\d{2}-\d{2}$/.test(j.points[j.points.length - 1].t));
      }
    }
  } else {
    ok('series-map 存在', false, 'data/series-map.json 不存在，先跑 collect-history.mjs');
  }

  // 复权完整性：价格类序列不该出现"拆股断崖"（单月腰斩以上且不伴随拆股）
  // 不复权价里的十拆一会在月线上留下一道 10 倍断崖，读数全错——所以这条得钉死。
  {
    const dir = path.join(ROOT, 'data', 'history');
    const priceLike = (j) => !/国债收益率|国库券/.test(j.name || '') && !/收益率/.test(j.kind || '');
    let checked = 0, cliffs = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json') || f.startsWith('crisis') || f === 'series-map.json') continue;
      const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      if (!j.points || j.points.length < 3 || !priceLike(j)) continue;
      checked++;
      for (let i = 1; i < j.points.length; i++) {
        const ch = (j.points[i].v / j.points[i - 1].v - 1) * 100;
        // 原油 2020-03 那种 -55% 是真崩盘，Yahoo 复权后仍会保留
        if (ch < -70) cliffs.push(`${j.name} ${j.points[i].t} ${ch.toFixed(1)}%`);
      }
    }
    ok('价格类序列已检查拆股断崖', checked > 50, `只检查了 ${checked} 条`);
    ok('没有未复权造成的假断崖（单月跌超70%）', cliffs.length === 0, cliffs.join(' | '));
  }

  /* 「名字与数据对不上」的兜底：两条序列如果数值几乎一样，那它们其实是同一条线。
     这本身不一定有问题——**同一条指数、两个来源、不同历史段**是合法的（下面的白名单）。
     有问题的是：一条登记成「指数A」、装的却是「指数B」的数据。
     （踩过的坑：东财的 secid「100.NDX」返回的其实是纳斯达克综合指数，
       却被登记成「纳斯达克100」，而首页实时仪表也用它——等于把综合指数的数
       标成纳指100 给用户看。真正的纳指100 应比综合指数高 4—5%。） */
  {
    // 已知的「同一条线、两个来源」：登记在这里并写清为什么，白名单才不是掩盖
    const ALLOWED_TWINS = [
      ['IXIC', 'usIXIC', '同一个纳斯达克综合指数：IXIC 是东财源（1991 年起的长历史），usIXIC 是腾讯源（2007 年起）'],
    ];
    const dir = path.join(ROOT, 'data', 'history');
    const list = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json') || f.startsWith('crisis')) continue;
      const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      if (!j.points || j.points.length < 4) continue;
      list.push({ id: j.id || f.replace('.json', ''), name: j.name || '', p: j.points });
    }
    const twins = [];
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) {
        const A = list[i], B = list[k];
        const bm = new Map(B.p.map((x) => [x.t, x.v]));
        const ratios = [];
        for (const x of A.p) {
          const y = bm.get(x.t);
          if (y === undefined || !isFinite(x.v) || !isFinite(y) || y === 0) continue;
          ratios.push(x.v / y);
        }
        if (ratios.length < 8) continue;
        const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
        const sd = Math.sqrt(ratios.reduce((s, v) => s + (v - mean) ** 2, 0) / ratios.length);
        const near1 = ratios.filter((r) => r > 0.99 && r < 1.01).length / ratios.length;
        if (near1 > 0.6 && Math.abs(mean - 1) < 0.02 && sd < 0.01) {
          const allowed = ALLOWED_TWINS.some(([x, y]) => (x === A.id && y === B.id) || (x === B.id && y === A.id));
          if (!allowed) {
            twins.push(`${A.id}(${A.name}) ≈ ${B.id}(${B.name})：重叠 ${ratios.length} 点，比值 ${mean.toFixed(4)}`);
          }
        }
      }
    }
    ok('不同名字的序列没有其实是同一条线的', twins.length === 0, twins.join(' | '));
  }

  /* 危机包是**一组**序列：回放器把它们对齐到同一条日期轴上，缺一条图就是残的。
     上游抖一下 → 恒指没了 → 包被写成残缺版，而索引还会悄悄换一条资产当头条。
     所以：包必须含全部声明的序列；索引的头条必须真的在包里。 */
  {
    const dir = path.join(ROOT, 'data', 'history');
    const files = (await readdir(dir)).filter((f) => /^crisis-\d{4}\.json$/.test(f));
    const pkgs = [];
    for (const f of files) {
      const pkg = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      pkgs.push(pkg);
      const have = (pkg.series || []).map((s) => s.key);
      const want = pkg.expectedSeries || [];
      const missing = want.filter((k) => !have.includes(k));
      ok(`危机包 ${f.replace('.json', '')} 含全部声明的序列`, missing.length === 0,
        missing.length ? '缺 ' + missing.join('、') : '');
    }
    const idxPath = path.join(dir, 'crisis-index.json');
    if (existsSync(idxPath)) {
      const ix = JSON.parse(await readFile(idxPath, 'utf8'));
      const bad = [];
      for (const it of ix.items || []) {
        const pkg = pkgs.find((p) => p.id === it.id);
        if (!pkg) { bad.push(`${it.id}：索引里有，产物里没有`); continue; }
        const hk = it.headline && it.headline.key;
        if (hk && !(pkg.series || []).some((s) => s.key === hk)) {
          bad.push(`${it.id}：头条 ${hk} 不在包内`);
        }
      }
      ok('危机索引的头条都真的在对应的包里（没被悄悄换掉）', bad.length === 0, bad.join(' | '));
    }
  }

  /* 标的页不许有「孤儿」：asset-ids 里有的每个标的，都得在标的百科索引里列得出来。
     （之前 GLOBAL_INDEX 没进 universe()，6 只全球指数有页面却翻不到。） */
  {
    const idsPath = path.join(ROOT, 'data', 'content', 'asset-ids.json');
    if (existsSync(idsPath)) {
      const ids = JSON.parse(await readFile(idsPath, 'utf8'));
      const W = loadScripts(['vendor/core/universe.js', 'js/views/assets.js']);
      const uni = (W.AssetsView && W.AssetsView.universe) ? W.AssetsView.universe() : [];
      const listed = new Set(uni.map((u) => u.symbol));
      const orphan = (ids.symbols || []).filter((s) => !listed.has(s));
      ok('每个有标的页的标的都出现在标的百科索引里（没有孤儿页）', orphan.length === 0,
        orphan.length ? '索引里没有：' + orphan.join('、') : '');
      const noLabel = uni.filter((u) => !u.label).map((u) => u.symbol);
      ok('索引里每条都有可显示的名字（不能是 undefined）', noLabel.length === 0, noLabel.join('、'));
      ok('标的页数与清单一致', (ids.symbols || []).length === ids.count,
        `清单 ${(ids.symbols || []).length} vs count ${ids.count}`);
    }
  }

  /* 标的短注契约：素材表（stats.json）里每个待写标的，短注库里都必须有——
     守住「标的页不再只有一张数据表」；多余/超长/禁用词由 merge 脚本在写盘前拦截。 */
  {
    const statsPath = path.join(ROOT, 'drafts', 'asset-notes', 'stats.json');
    const notesPath = path.join(ROOT, 'content', '_meta', 'asset-notes.json');
    if (existsSync(statsPath)) {
      const stats = JSON.parse(await readFile(statsPath, 'utf8'));
      if (!existsSync(notesPath)) {
        ok('asset-notes.json 已生成（node _scripts/merge-asset-notes.mjs）', false, '文件不存在');
      } else {
        const notes = JSON.parse(await readFile(notesPath, 'utf8'));
        const have = new Set(Object.keys(notes.symbols || {}));
        const missing = Object.keys(stats.symbols).filter((s) => !have.has(s));
        ok('每个没有专文的标的页都有三段短注（不再只有一张数据表）', missing.length === 0,
          missing.map((s) => s + '·' + stats.symbols[s].label).join('、'));
        const extra = [...have].filter((s) => !stats.symbols[s]);
        ok('短注库里没有待写清单之外的标的', extra.length === 0, extra.join('、'));
        const prodPath = path.join(ROOT, 'data', 'content', 'asset-notes.json');
        if (existsSync(prodPath)) {
          const prod = JSON.parse(await readFile(prodPath, 'utf8'));
          ok('asset-notes 源与产物一致（跑 node _scripts/build-content.mjs）',
            JSON.stringify(prod.symbols) === JSON.stringify(notes.symbols));
        }
      }
    }
  }

  /* 维基深链契约：标的清单里的每个标的，要么有确认过的词条链接，要么在豁免表里
     （汇率对 / 国债收益率没有单一词条）。豁免表由 resolve-asset-wiki.mjs 写进 JSON，
     页面和测试读同一份，防止新增标的悄悄漏挂链接。 */
  {
    const wikiSrcPath = path.join(ROOT, 'content', '_meta', 'asset-wiki.json');
    const idsPath = path.join(ROOT, 'data', 'content', 'asset-ids.json');
    if (existsSync(idsPath)) {
      if (!existsSync(wikiSrcPath)) {
        ok('asset-wiki.json 已生成（node _scripts/resolve-asset-wiki.mjs）', false, '文件不存在');
      } else {
        const wiki = JSON.parse(await readFile(wikiSrcPath, 'utf8'));
        const ids = JSON.parse(await readFile(idsPath, 'utf8'));
        const linked = new Set(Object.keys(wiki.symbols || {}));
        const exempt = new Set(wiki.exempt || []);
        const missing = (ids.symbols || []).filter((s) => !linked.has(s) && !exempt.has(s));
        ok('每个标的都有维基深链或在豁免表里（没有悄悄漏挂的）', missing.length === 0,
          missing.join('、'));
        const stale = [...linked].filter((s) => !(ids.symbols || []).includes(s));
        ok('维基深链里没有标的清单之外的残留', stale.length === 0, stale.join('、'));
        const badUrl = Object.entries(wiki.symbols || {})
          .filter(([, v]) => !v || (!String(v.zh || '').startsWith('https://zh.wikipedia.org/wiki/')
            && !String(v.en || '').startsWith('https://en.wikipedia.org/wiki/')))
          .map(([s]) => s);
        ok('深链 URL 只指向 zh/en 维基百科的词条页', badUrl.length === 0, badUrl.join('、'));
        const prodPath2 = path.join(ROOT, 'data', 'content', 'asset-wiki.json');
        if (existsSync(prodPath2)) {
          const prod = JSON.parse(await readFile(prodPath2, 'utf8'));
          ok('asset-wiki 源与产物一致（跑 node _scripts/build-content.mjs）',
            JSON.stringify(prod.symbols) === JSON.stringify(wiki.symbols));
        }
      }
    }
  }

  /* 数据契约：三条踩过的坑，各钉一条断言，别再复发。
       1. 财政部 CSV 的**空单元格**曾被写成 0.00% 收益率（Number('') === 0，
          Number.isFinite(0) 也是 true）——美国30年期在 2002 年从 5.40%
          垂直掉到 0 并横躺十个月，读者看到的是错数据不是「缺数据」。
       2. 财政部 CSV 是倒序，同月多行依次覆盖同一个 key → 拿到的是**月初**值，
          而注册表和页面全写「月末」，画在同一条 SPX 月末图上整体错开约一个月。
       3. 复权口径自相矛盾：kind 写「已按拆股复权」、source 写「未复权」，
          两句话并排摆在读者面前。 */
  {
    const dir = path.join(ROOT, 'data', 'history');
    const monthly = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json') || f.startsWith('crisis') || f === 'series-map.json') continue;
      monthly.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
    }

    // ① 收益率不得出现**连续**为 0 的点。
    //    单个 0 可能是真的（2015-09-30 的 3 个月期国债收益率确实是 0.00%），
    //    但连成一片一定是被当成 0 的空单元格。
    const zeroRuns = [];
    for (const id of ['US3M', 'US2Y', 'US10Y', 'US30Y']) {
      const j = monthly.find((x) => (x.id || '') === id);
      if (!j || !j.points) continue;
      let run = 0, maxRun = 0;
      for (const pt of j.points) {
        if (!(pt.v > 0)) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
      }
      if (maxRun >= 2) zeroRuns.push(`${id} 连续 ${maxRun} 个 0`);
    }
    ok('收益率序列没有连续为 0 的点（空单元格曾被写成 0.00%）', zeroRuns.length === 0, zeroRuns.join(' | '));

    // ② 标着「月末」的月度序列，日期不能集中在每月头几天。
    const early = [];
    for (const j of monthly) {
      if (!j.points || j.points.length < 12) continue;
      const ratio = j.points.filter((p) => ['01', '02', '03', '04'].includes(p.t.slice(8, 10))).length / j.points.length;
      if (ratio > 0.2) early.push(`${j.id} 有 ${(ratio * 100).toFixed(0)}% 的点落在月初`);
    }
    ok('月度序列的日期确实落在月末（不是月初）', early.length === 0, early.join(' | '));

    // ③ 复权口径不得自相矛盾。
    const contra = [];
    for (const j of monthly) {
      const kind = j.kind || '', source = j.source || '';
      if (/(?<!未)复权/.test(kind) && /未复权/.test(source)) contra.push(`${j.id}: ${kind} | ${source}`);
    }
    ok('复权口径不自相矛盾', contra.length === 0, contra.join(' | '));

    // ④ 月线与危机包日频必须对得上：同一个月的月末值 = 日频最后一条观测。
    //    这条一钉，「月初冒充月末」立刻现形。
    const m = monthly.find((x) => (x.id || '') === 'US10Y');
    const m1994 = m && m.points.find((p) => p.t.startsWith('1994-12'));
    let c1994 = null;
    const cPath = path.join(dir, 'crisis-1994.json');
    if (existsSync(cPath)) {
      const c = JSON.parse(await readFile(cPath, 'utf8'));
      const s = (c.series || []).find((x) => x.key === 'US10Y');
      const d = ((s && s.points) || []).filter((p) => p.t.startsWith('1994-12'));
      c1994 = d[d.length - 1];
    }
    ok('美债月线与危机包日频的月末值一致',
      !!(m1994 && c1994 && m1994.t === c1994.t && m1994.v === c1994.v),
      `月线 ${m1994 && m1994.t}=${m1994 && m1994.v} / 日频 ${c1994 && c1994.t}=${c1994 && c1994.v}`);
  }

  // 危机回放包
  const crisisPath = path.join(ROOT, 'data', 'history', 'crisis-2008.json');
  if (existsSync(crisisPath)) {
    const c = JSON.parse(await readFile(crisisPath, 'utf8'));
    ok('crisis-2008 至少 4 条序列', c.series.length >= 4, `实际 ${c.series.length}`);
    ok('crisis-2008 事件标注非空', (c.events || []).length >= 8);
    ok('crisis-2008 每条序列都有数据点', c.series.every((s) => s.points && s.points.length > 0));
    const keys = c.series.map((s) => s.key);
    ok('crisis-2008 含标普500', keys.includes('SPX'));
    ok('crisis-2008 含黄金', keys.includes('GC00Y'));
    ok('crisis-2008 含原油', keys.includes('CL00Y'));
    ok('crisis-2008 含美债10Y', keys.includes('US10Y'));
    ok('crisis-2008 含 VIX', keys.includes('VIX'));
    // 事件日期必须落在时间轴内
    const first = c.dates[0], last = c.dates[c.dates.length - 1];
    ok('crisis-2008 所有事件日期在时间轴范围内',
      c.events.every((e) => e.t >= first.slice(0, 7) && e.t.slice(0, 7) <= last.slice(0, 7)),
      `轴 ${first} → ${last}`);
  }
}

/* ============================================================
   5. 内容契约：索引与正文必须一致
   ============================================================ */
{
  const idxPath = path.join(ROOT, 'data', 'content', 'index.json');
  if (existsSync(idxPath)) {
    const idx = JSON.parse(await readFile(idxPath, 'utf8'));
    ok('内容索引至少 6 篇', (idx.items || []).length >= 6, `实际 ${(idx.items || []).length}`);
    for (const it of idx.items || []) {
      const p = path.join(ROOT, 'data', 'content', it.id + '.json');
      ok(`内容 ${it.id} 有正文产物`, existsSync(p));
      if (existsSync(p)) {
        const a = JSON.parse(await readFile(p, 'utf8'));
        ok(`${it.id} 正文非空`, (a.body || '').length > 200);
        ok(`${it.id} 有 title`, !!a.title);
        ok(`${it.id} 有 dataAsOf`, !!a.dataAsOf);
      }
    }
    // 术语库
    const gPath = path.join(ROOT, 'data', 'content', 'glossary.json');
    if (existsSync(gPath)) {
      const g = JSON.parse(await readFile(gPath, 'utf8'));
      const terms = Object.keys(g.terms || {});
      ok('术语库至少 12 条', terms.length >= 12, `实际 ${terms.length}`);
      for (const [id, t] of Object.entries(g.terms || {})) {
        ok(`术语 ${id} 有 term`, !!t.term);
        ok(`术语 ${id} 有 one`, !!t.one);
        ok(`术语 ${id} 有 pit`, !!t.pit);
        // 四段式是硬要求：一句话 / 比喻 / 数字 / 坑，一段都不能少
        ok(`术语 ${id} 有 metaphor`, !!t.metaphor);
        ok(`术语 ${id} 有 number`, !!t.number);
        ok(`术语 ${id} 有 cat`, !!t.cat);
        // 「一句话」是读者扫一眼就带走的那句，写作指南定了 40 字上限。
        // 超了不是小事：它会把比喻和数字挤下去，也会让索引页每行都在换行。
        const oneLen = [...String(t.one || '')].length;
        ok(`术语 ${id} 的一句话不超过 40 字`, oneLen > 0 && oneLen <= 40, `实际 ${oneLen} 字`);
        // term 必须是中文词名，不能是英文 id。
        // （踩过的坑：merge-terms 的 patch 模式会把没写的 term 冲成 id，
        //   于是「上证指数」的词条页标题变成 sse-index，而终端链过去的正是这批。）
        ok(`术语 ${id} 的 term 不是英文 id`, t.term !== id, `term=${t.term}`);
      }
      // 源与产物必须一致：审的是源、读者看的是产物，两者漂了就会「审的不是上线的」
      {
        const src = JSON.parse(await readFile(path.join(ROOT, 'content', '_meta', 'glossary.json'), 'utf8'));
        const built = JSON.parse(await readFile(gPath, 'utf8'));
        const srcIds = Object.keys(src.terms || {}).sort();
        const builtIds = Object.keys(built.terms || {}).sort();
        ok('术语库源与产物的 id 集合一致', JSON.stringify(srcIds) === JSON.stringify(builtIds),
          `源 ${srcIds.length} 条 / 产物 ${builtIds.length} 条`);
        let drift = 0;
        for (const id of srcIds) {
          if (JSON.stringify(src.terms[id]) !== JSON.stringify(built.terms[id])) drift++;
        }
        ok('术语库源与产物逐字段一致', drift === 0, `${drift} 条字段不一致（请跑 build-content 后提交）`);
      }
      // 十个分类都必须有词，否则速查页的分类切换会开天窗
      const CATS = ['data', 'fund', 'asset', 'option', 'macro', 'basic', 'micro', 'player', 'risk', 'tech'];
      const byCat = {};
      Object.values(g.terms || {}).forEach((t) => { byCat[t.cat] = (byCat[t.cat] || 0) + 1; });
      for (const c of CATS) {
        ok(`术语库分类 ${c} 有词`, (byCat[c] || 0) > 0, `实际 ${byCat[c] || 0}`);
      }
      // 禁用表达：写研报口径不许出现的话
      const BAN = ['据说', '业内普遍认为', '必将', '稳赚不赔', '建议买入', '一定能涨'];
      for (const [id, t] of Object.entries(g.terms || {})) {
        const s = JSON.stringify(t);
        for (const b of BAN) {
          ok(`术语 ${id} 不含禁用表达「${b}」`, !s.includes(b));
        }
      }      // 正文里引用的术语必须存在
      for (const it of idx.items || []) {
        const a = JSON.parse(await readFile(path.join(ROOT, 'data', 'content', it.id + '.json'), 'utf8'));
        const refs = [...String(a.body || '').matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]);
        for (const r of refs) {
          ok(`${it.id} 引用的术语「${r}」在术语库中`, !!(g.terms || {})[r]);
        }
      }
    }
  }
}

/* ============================================================
   5.1 「接着读」的 related 契约
   ------------------------------------------------------------
   related 里混着两种 id：文章 id 和术语 id。编译期若把数字强转成 Number，
   页面按字符串查索引就查不到，整块「接着读」会无声消失——页面上没有任何报错，
   只是那一段不见了。所以产物里的 id 必须：
   ① 全是字符串；② 每个都能在文章索引或术语库里找到。 */
{
  const idxPath = path.join(ROOT, 'data', 'content', 'index.json');
  const gPath = path.join(ROOT, 'data', 'content', 'glossary.json');
  if (existsSync(idxPath) && existsSync(gPath)) {
    const idx = JSON.parse(await readFile(idxPath, 'utf8'));
    const g = JSON.parse(await readFile(gPath, 'utf8'));
    const terms = g.terms || {};
    const artIds = new Set((idx.items || []).map((it) => String(it.id)));
    let withRelated = 0, termOnly = 0, total = 0;

    for (const it of idx.items || []) {
      const a = JSON.parse(await readFile(path.join(ROOT, 'data', 'content', it.id + '.json'), 'utf8'));
      const rel = a.related || [];
      if (!rel.length) continue;
      withRelated++;
      total += rel.length;
      const bad = rel.filter((r) => typeof r !== 'string');
      ok(`${it.id} 的 related 全是字符串`, bad.length === 0,
        `非字符串元素：${JSON.stringify(bad)}`);
      for (const r of rel) {
        const id = String(r);
        ok(`${it.id} 的 related「${id}」在文章索引或术语库里`, artIds.has(id) || !!terms[id]);
      }
      if (rel.some((r) => !artIds.has(String(r)) && terms[String(r)])) termOnly++;
    }
    ok('有 related 的文章不为空', withRelated > 0, `实际 ${withRelated} 篇`);
    ok('related 的条目总数不为空', total >= 40, `实际 ${total} 条`);
    ok('至少有一篇文章的 related 只含术语 id', termOnly > 0, `实际 ${termOnly} 篇`);

    // 年份型 id（「1990」）编译后必须还是字符串，不能变成 Number
    const c1987 = JSON.parse(await readFile(path.join(ROOT, 'data', 'content', '1987.json'), 'utf8'));
    eq('1987 的 related 编译成字符串数组',
      JSON.stringify(c1987.related), JSON.stringify(['1990', '2008', 'liquidity']));
  }
}

/* ============================================================
   5.2 术语稿合并：引号成对、patch 不冲掉 term
   ------------------------------------------------------------
   这两处各坏过一次：引号替换的第二个正则与第一个一模一样（都是 /"/g），
   所有直引号都变成孤立的「；patch 稿只写一个字段，却把老词条的中文名冲成英文 id。 */
{
  const { smartQuotes, parseDraft, buildRec, mergeTerm } = await import('../_scripts/merge-terms.mjs');

  eq('merge-terms 成对直引号 → 成对中文引号',
    smartQuotes('他说"这是股债跷跷板"'), '他说「这是股债跷跷板」');
  eq('merge-terms 多个引号各自成对',
    smartQuotes('"一"和"二"'), '「一」和「二」');
  eq('merge-terms 奇数引号不产生半边（落单的半个去掉）',
    smartQuotes('他说"这是半句'), '他说这是半句');
  ok('merge-terms 奇数引号不留任何半边引号',
    !/[「」]/.test(smartQuotes('他说"这是半句')), smartQuotes('他说"这是半句'));
  eq('merge-terms 没有引号时原样返回', smartQuotes('没有引号的句子'), '没有引号的句子');

  // 稿子没写 term 就不带 term（老词条的中文名不能被冲成 id）
  const rec = buildRec({ id: 'pe-ratio', _links: [] });
  ok('merge-terms 稿子没写 term 就不带 term', !('term' in rec));
  ok('merge-terms 稿子没写 alias 就不带 alias', !('alias' in rec));

  // patch：只写一句话，老词条的 term / alias / cat 都不能被冲掉
  const terms = {
    'pe-ratio': {
      term: '市盈率', alias: 'PE / P/E', cat: 'data',
      one: '旧一句话', metaphor: '旧比喻', number: '旧数字', pit: '旧坑',
    },
  };
  const d = parseDraft('@@ pe-ratio\npatch: yes\none: 新一句话\n')[0];
  const merged = mergeTerm(terms, d);
  eq('patch 合并后 term 不被冲成 id', merged.term, '市盈率');
  eq('patch 合并后 alias 保留', merged.alias, 'PE / P/E');
  eq('patch 合并后 cat 保留', merged.cat, 'data');
  eq('patch 合并后写了的字段被更新', merged.one, '新一句话');
  eq('patch 合并后没写的字段保留', merged.metaphor, '旧比喻');
  eq('patch 合并后 number 保留', merged.number, '旧数字');
  eq('patch 合并后 pit 保留', merged.pit, '旧坑');

  // 非 patch 的全量写入：新词条没写 term 时按老规矩用 id 兜底
  const fresh = mergeTerm({}, parseDraft('@@ new-term\ncat: basic\none: 一句话\n')[0]);
  eq('新词条没写 term 时用 id 兜底', fresh.term, 'new-term');
  eq('新词条没写 cat 时兜底 basic', fresh.cat, 'basic');
}

/* ============================================================
   5.45 发布卫生：业务资源的 ?v= 必须同版本
   ------------------------------------------------------------
   静态托管给 js/css 设了缓存头，发布之后用户可能拿到旧文件——
   页面看着对，行为却是旧的（分类数、词条顺序这类改动尤其难察觉）。
   所以每个业务资源挂 ?v=；但版本号必须**全部一样**：
   不统一就等于有的文件刷新了有的没刷新，比不打版本号还难查。 */
{
  const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const vers = [...indexHtml.matchAll(/\?v=([0-9a-z]+)/g)].map((m) => m[1]);
  ok('index.html 的业务资源都带了 ?v=', vers.length >= 20, `实际 ${vers.length} 个`);
  const uniq = [...new Set(vers)];
  ok('业务资源 ?v= 全部同版本', uniq.length === 1, `版本号不统一：${uniq.join(' ')}`);
  // vendor/core 是从 OpenFinLens 同步来的**代码副本**，它会随同步改动，
  // 所以必须跟着版本号走（不然改了 vendor 却让浏览器吃缓存）。
  // 真正的第三方库（本仓没有）才不该被业务版本号覆盖。
  ok('vendor/core 同步副本带上了版本号',
    /vendor\/core\/[^"?]+\?v=/.test(indexHtml), 'vendor/core 没带 ?v=，同步后浏览器会吃旧缓存');
  ok('没有资源漏掉版本号',
    ![...indexHtml.matchAll(/(?:href|src)="((?:css|js|vendor\/core)\/[^"]+)"/g)]
      .some((m) => m[1].indexOf('?v=') < 0), '有 css/js 资源没带 ?v=');
}

/* ============================================================
   5.5 口径一致性：文章与术语库里的历史数字必须对得上站内数据
   —— 防止"凭印象写数字"（2008 黄金 880.8→718.2、倒挂时点等）
   ============================================================ */
{
  const crisisPath = path.join(ROOT, 'data', 'history', 'crisis-2008.json');
  const gPath = path.join(ROOT, 'data', 'content', 'glossary.json');
  if (existsSync(crisisPath) && existsSync(gPath)) {
    const c = JSON.parse(await readFile(crisisPath, 'utf8'));
    const g = JSON.parse(await readFile(gPath, 'utf8'));
    const gold = c.series.find((s) => s.key === 'GC00Y');

    if (gold) {
      const at = (d) => {
        const p = gold.points.find((x) => x.t === d);
        return p ? p.v : null;
      };
      // 日频口径：直接取当天的收盘价
      ok('危机包 2008-09-30 黄金收盘 = 880.8', at('2008-09-30') === 880.8, `实际 ${at('2008-09-30')}`);
      ok('危机包 2008-10-31 黄金收盘 = 718.2', at('2008-10-31') === 718.2, `实际 ${at('2008-10-31')}`);

      // 术语库与正文引用的数字必须与数据一致
      const goldTerm = (g.terms || {}).gold;
      ok('术语库 gold 引用了 880.8（与数据一致）', !!goldTerm && goldTerm.number.includes('880.8'));
      ok('术语库 gold 引用了 718.2（与数据一致）', !!goldTerm && goldTerm.number.includes('718.2'));
    }

    // 美债 10Y：倒挂时点必须与财政部数据一致
    const yPath = path.join(ROOT, 'data', 'history', 'US10Y.json');
    const mPath = path.join(ROOT, 'data', 'history', 'US3M.json');
    if (existsSync(yPath) && existsSync(mPath)) {
      const y = JSON.parse(await readFile(yPath, 'utf8'));
      const m = JSON.parse(await readFile(mPath, 'utf8'));
      const at = (s, k) => {
        const p = s.points.find((x) => x.t.slice(0, 7) === k);
        return p ? p.v : null;
      };
      const gap = at(m, '2006-12') - at(y, '2006-12');
      // 月线是**月末**值（财政部 CSV 倒序，所以取每月最晚的那一天）。
      // 2006-12-29 当天 3M 是 5.02、10Y 是 4.71，倒挂 31 个基点。
      // 60 个基点是 12 月**初**（12-01）那天的读数，曲线随后一路收窄——
      // 之前月线取的是月初，断言跟着写成了 60，看起来"对"，其实是把月初当成了月末。
      ok('2006-12 美债 3M−10Y 差约 31 个基点（月末口径）', Math.abs(gap - 0.31) < 0.02, `实际 ${gap}`);
      ok('2006-12 美债曲线是倒挂的（3M 高于 10Y）', gap > 0, `实际 ${gap}`);
      const inv = (g.terms || {}).inversion;
      ok('术语库 inversion 写的是 2006 年倒挂（与数据一致）',
        !!inv && inv.number.includes('2006') && !inv.number.includes('2007年8月'));
      ok('术语库 inversion 不把 12 月初的读数当成月末',
        !!inv && inv.number.includes('31个基点'), inv && inv.number);
    }
  }
}

/* ============================================================
   5.6 全部危机包：日频 + 关键数字必须与数据一致
   —— 锁死「文章里写的数字」与「回放器里能拖出来的数字」是同一个
   ============================================================ */
{
  const CHECKS = [
    { id: '1987', key: 'SPX', date: '1987-10-19', expect: 224.84, label: '黑色星期一标普收盘' },
    { id: '1987', key: 'SPX', date: '1987-10-16', expect: 282.70, label: '崩盘前一日标普收盘' },
    { id: '1990', key: 'N225', date: '1989-12-29', expect: 38915.87, label: '日经见顶点' },
    { id: '1990', key: 'N225', date: '1992-08-18', expect: 14309.41, label: '日经见底' },
    { id: '1994', key: 'US10Y', date: '1994-12-30', expect: 7.84, label: '1994 年末 10Y' },
    { id: '1998', key: 'HSI', date: '1997-10-28', expect: 9059.89, label: '恒指黑色星期五收盘' },
    { id: '1998', key: 'HSI', date: '1998-08-13', expect: 6660.41, label: '恒指见底' },
    { id: '2008', key: 'SPX', date: '2009-03-09', expect: 676.53, label: '标普见底' },
  ];
  const DROPS = [
    { id: '1990', key: 'N225', expect: -63.2, tol: 0.3, label: '日经峰谷跌幅' },
    { id: '1998', key: 'HSI', expect: -60.1, tol: 0.3, label: '恒指峰谷跌幅' },
    { id: '2008', key: 'SPX', expect: -56.8, tol: 0.3, label: '标普峰谷跌幅' },
  ];
  const SERIES = {
    '1987': ['SPX', 'CL00Y'],
    '1990': ['N225', 'SPX', 'HSI', 'GC00Y', 'CL00Y', 'US10Y'],
    '1994': ['SPX', 'US10Y', 'GC00Y', 'CL00Y', 'HSI'],
    '1998': ['HSI', 'N225', 'SPX', 'GC00Y', 'US10Y', 'VIX'],
    '2008': ['SPX', 'GC00Y', 'CL00Y', 'US10Y', 'VIX'],
  };

  for (const id of Object.keys(SERIES)) {
    const p = path.join(ROOT, 'data', 'history', 'crisis-' + id + '.json');
    if (!existsSync(p)) { ok('危机包存在 crisis-' + id, false, '文件缺失'); continue; }
    const pkg = JSON.parse(await readFile(p, 'utf8'));
    ok('危机包 ' + id + ' 是日频', pkg.freq === 'D', '实际 ' + pkg.freq);
    ok('危机包 ' + id + ' 有事件标注', (pkg.events || []).length >= 3);
    const keys = (pkg.series || []).map((s) => s.key);
    for (const k of SERIES[id]) {
      ok('危机包 ' + id + ' 含序列 ' + k, keys.indexOf(k) >= 0, '实际有 ' + keys.join(','));
    }
    // 事件日期必须落在时间轴内
    const first = pkg.dates[0], last = pkg.dates[pkg.dates.length - 1];
    ok('危机包 ' + id + ' 事件日期在时间轴内',
      pkg.events.every((e) => e.t >= first && e.t <= last),
      `轴 ${first} → ${last}`);

    for (const c of CHECKS.filter((x) => x.id === id)) {
      const s = pkg.series.find((x) => x.key === c.key);
      if (!s) continue;
      const p2 = s.points.find((x) => x.t === c.date);
      ok(c.label, !!p2 && Math.abs(p2.v - c.expect) < 0.01,
        '期望 ' + c.expect + '，实际 ' + (p2 ? p2.v : '无此日期'));
    }
    for (const c of DROPS.filter((x) => x.id === id)) {
      const s = pkg.series.find((x) => x.key === c.key);
      if (!s) continue;
      let peak = null, trough = null;
      s.points.forEach((x) => {
        if (!peak || x.v > peak.v) peak = x;
        if (!trough || x.v < trough.v) trough = x;
      });
      const drop = (trough.v / peak.v - 1) * 100;
      ok(c.label, Math.abs(drop - c.expect) < c.tol, '期望 ' + c.expect + '%，实际 ' + drop.toFixed(1) + '%');
    }
  }

  // 单日最大跌幅：1998 恒指 -13.70%，1990 日经仅 -6.60%
  {
    const p98 = JSON.parse(await readFile(path.join(ROOT, 'data', 'history', 'crisis-1998.json'), 'utf8'));
    const hsi = p98.series.find((s) => s.key === 'HSI');
    // 包里缺序列时要说清楚是「缺」，不是崩在这里（崩了会掩盖真正的失败原因）
    ok('crisis-1998 含恒指序列', !!hsi, '包内序列：' + p98.series.map((s) => s.key).join('、'));
    let worst = { pct: 0, t: '' };
    if (hsi) {
      for (let i = 1; i < hsi.points.length; i++) {
        const pct = (hsi.points[i].v / hsi.points[i - 1].v - 1) * 100;
        if (pct < worst.pct) worst = { pct, t: hsi.points[i].t };
      }
    }
    ok('恒指单日最大跌幅 = -13.70%（1997-10-28）',
      !!hsi && Math.abs(worst.pct + 13.70) < 0.01 && worst.t === '1997-10-28',
      '实际 ' + worst.pct.toFixed(2) + '% @ ' + worst.t);

    const p90 = JSON.parse(await readFile(path.join(ROOT, 'data', 'history', 'crisis-1990.json'), 'utf8'));
    const n225 = p90.series.find((s) => s.key === 'N225');
    ok('crisis-1990 含日经序列', !!n225, '包内序列：' + p90.series.map((s) => s.key).join('、'));
    let worst2 = { pct: 0, t: '' };
    if (n225) {
      for (let i = 1; i < n225.points.length; i++) {
        const pct = (n225.points[i].v / n225.points[i - 1].v - 1) * 100;
        if (pct < worst2.pct) worst2 = { pct, t: n225.points[i].t };
      }
    }
    ok('日经区间最大单日跌幅 = -14.90%（1987-10-20）',
      Math.abs(worst2.pct + 14.90) < 0.01 && worst2.t === '1987-10-20',
      '实际 ' + worst2.pct.toFixed(2) + '% @ ' + worst2.t);
    // 但 1990 年之内（不含 1987），最大单日跌幅只有 -6.60%：慢刀子，不是崩盘
    let worst3 = { pct: 0, t: '' };
    for (let i = 1; i < n225.points.length; i++) {
      const p = n225.points[i];
      if (p.t < '1990-01-01' || p.t > '1990-12-31') continue;
      const pct = (p.v / n225.points[i - 1].v - 1) * 100;
      if (pct < worst3.pct) worst3 = { pct, t: p.t };
    }
    ok('日经 1990 年内最大单日跌幅 = -6.60%（1990-04-02）',
      Math.abs(worst3.pct + 6.60) < 0.01 && worst3.t === '1990-04-02',
      '实际 ' + worst3.pct.toFixed(2) + '% @ ' + worst3.t);
  }
}

/* ============================================================
   6. vendor 契约
   ============================================================ */
{
  const headPath = path.join(ROOT, 'vendor', 'HEAD');
  ok('vendor/HEAD 存在', existsSync(headPath));
  if (existsSync(headPath)) {
    const h = await readFile(headPath, 'utf8');
    ok('vendor/HEAD 记录了上游 commit', /# commit: [0-9a-f]{7,}/.test(h), h.slice(0, 120));
  }
  for (const f of ['core/utils.js', 'core/universe.js', 'core/explain.js', 'core/industry-chains.js']) {
    ok(`vendor/${f} 已同步`, existsSync(path.join(ROOT, 'vendor', f)));
  }
}

/* ---------- 汇总 ---------- */
console.log('');
console.log(`通过 ${pass} 条，失败 ${fail} 条`);
if (failures.length) {
  console.log('');
  failures.forEach((f) => console.log('  ✗ ' + f));
}
process.exit(fail ? 1 : 0);
