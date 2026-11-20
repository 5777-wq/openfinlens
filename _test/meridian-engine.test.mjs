/* meridian-engine.test.mjs —— Meridian 引擎套件移植（原 us-stock-monitor test.mjs 前 14 个 suite）
 * 黄金值全部手算对账保留；import 改指 core/ 唯一真源（Phase 3 迁移的口径不变性证明——
 * core 与旧仓实现逐点一致才配当唯一真源）。
 * 用法：node _test/meridian-engine.test.mjs（纯离线） */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = import.meta.dirname + '/..';
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, eps, name) => ok(a !== null && Math.abs(a - b) <= eps, name, a);
const suite = (t) => console.log('\n◆ ' + t);

const I = await imp('core/engine/indicators.mjs');
const M = await imp('core/engine/market-time.mjs');
const H = await imp('core/sources/history.mjs');
const W = await imp('core/engine/weekly.mjs');
const S = await imp('core/engine/signals.mjs');
const UNI = await imp('pipelines/meridian/universe.mjs');
const A = await imp('pipelines/meridian/analytics.mjs');
const { emaSeries, rsiSeries, tunnelSnap, rsiSnap, tunnelPos, tunnelEvent } = I;
const { lastClosedDate, splitClosed, etNow, tradingDaysBetween } = M;
const { mergeBars, anchorSeries, parseYahoo, cacheFreshEnough } = H;
const { rankUniverse, normalizeWatchlist, splitWatchlist, watchTargetOf, loadNdx } = UNI;
const { resampleWeekly, weekEndOf } = W;
const { evaluate, summarize, stalenessGate } = S;
const { obDaysRun, aboveDaysRun, extensionPct, volumeRatio, signalHistory, statsOf } = A;

/* ---------- EMA ---------- */
suite('EMA：SMA 种子 + 递推（手算黄金值）');
{
  const c = [1, 2, 3, 4, 5];
  const e = emaSeries(c, 3);
  ok(e[0] === null && e[1] === null, '前 n-1 位为 null', e);
  near(e[2], 2, 1e-12, '种子 = SMA(1,2,3) = 2');
  near(e[3], 3, 1e-12, 'bar4: 2+(4-2)*0.5 = 3');
  near(e[4], 4, 1e-12, 'bar5: 3+(5-3)*0.5 = 4');
  const short = emaSeries([1, 2], 3);
  ok(short.every((v) => v === null), '数据不足全 null');
}

/* ---------- RSI ---------- */
suite('RSI(6)：Wilder 平滑（手算黄金值）');
{
  // 差分：d1..d6=+1,+1,-1,+1,+1,+1（种子）→ RSI=83.333；d7=-1 → 69.444；d8=+2 → 78.174
  const c = [10, 11, 12, 11, 12, 13, 14, 13, 15];
  const r = rsiSeries(c, 6);
  ok(r.slice(0, 6).every((v) => v === null), '前 n 位为 null');
  near(r[6], 83.333, 1e-3, 'RSI[6] = 83.333（RS=5）', r[6]);
  near(r[7], 69.444, 1e-3, 'RSI[7] = 69.444（RS=25/11）', r[7]);
  near(r[8], 78.174, 1e-3, 'RSI[8] = 78.174（RS=197/55）', r[8]);
}
suite('RSI：极端序列 + 独立转录逐点对账');
{
  // 独立转录（点值版）与 core 实现互证：随机游走 20 条 × 200 根，n=6 与 n=14 逐点对账
  const rsiPoint = (closes, n) => {
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
    let avgG = gain / n, avgL = loss / n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
      avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  };
  let rnd = 12345;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
  let maxDiff = 0;
  for (let t = 0; t < 20; t++) {
    const c = [100];
    for (let i = 1; i < 200; i++) c.push(c[i - 1] + (rand() - 0.48) * 3);
    const seq = rsiSeries(c, 6);
    maxDiff = Math.max(maxDiff, Math.abs(seq[199] - rsiPoint(c, 6)));
    const seq14 = rsiSeries(c, 14);
    maxDiff = Math.max(maxDiff, Math.abs(seq14[199] - rsiPoint(c, 14)));
  }
  ok(maxDiff < 1e-9, '随机序列 40 组逐点一致（max|Δ|=' + maxDiff.toExponential(2) + '）');

  const up = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i), 6);
  near(up[29], 100, 1e-9, '全涨 → RSI=100');
  const dn = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 - i), 6);
  near(dn[29], 0, 1e-9, '全跌 → RSI=0');
}

/* ---------- 通道 ---------- */
suite('Vegas 通道：位置与穿越事件');
{
  const flat = Array(60).fill(100);
  const s1 = tunnelSnap([...flat, 120], 12, 36);
  ok(s1.pos === 'above', '跳空收盘在双 EMA 上方 → above', s1.pos);
  ok(s1.event === 'break_up', '前根在内(=轨)→本根在上 → break_up', s1.event);
  const s2 = tunnelSnap([...flat, 80], 12, 36);
  ok(s2.pos === 'below' && s2.event === 'break_down', '跌破 → below + break_down');
  const s3 = tunnelSnap(flat, 12, 36);
  ok(s3.pos === 'inside' && s3.event === null, '平价贴轨 → inside，无事件');
  ok(tunnelEvent('above', 'inside') === 'reenter_down' && tunnelEvent('below', 'inside') === 'reenter_up', '回入事件命名');
  near(s1.widthPct, 1.9552, 1e-3, '跳空后轨宽（20·(2/13-2/37) 口径）', s1.widthPct);
  ok(tunnelSnap([1, 2, 3], 12, 36) === null, '数据不足 → null');
  ok(tunnelPos(101, 100.5, 99.5) === 'above' && tunnelPos(100, 100.5, 99.5) === 'inside', 'tunnelPos 边界');
}

/* ---------- RSI 状态与穿越 ---------- */
suite('RSI 状态机：超买回落 / 超卖回升');
{
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const a = rsiSnap(rising, 6, 70, 30);
  ok(a.state === 'overbought' && a.value === 100, '连涨 → 超买');
  const drop = [...rising, 137, 135];
  const b = rsiSnap(drop, 6, 70, 30);
  ok(b.prevState === 'overbought' && b.state === 'neutral' && b.cross === 'out_ob', '连续回落 → out_ob 穿越事件', b);
  near(b.prev, 71.429, 0.01, '回落前值 71.43', b.prev);
  near(b.value, 53.191, 0.01, '回落后 53.19', b.value);
  const wick = [100];
  for (let k = 1; k <= 14; k++) wick.push(100 - k);
  wick.push(87, 86, 85, 86, 87);
  const c2 = rsiSnap(wick, 6, 70, 30);
  ok(c2.state === 'neutral' && c2.cross === 'out_os', '超卖回升 → out_os', c2);
  near(c2.prev, 26.313, 0.05, '前值 26.31（超卖）', c2.prev);
  near(c2.value, 38.598, 0.05, '现值 38.60（中性）', c2.value);
}

/* ---------- 交易日时钟（含 DST 边界） ---------- */
suite('market-time：ET 收盘判定（2026-09 为 EDT=UTC-4，2026-01 为 EST=UTC-5）');
{
  const at = (iso) => new Date(iso);
  ok(lastClosedDate(at('2026-09-23T21:00:00Z')) === '2026-09-23', '周三 17:00 EDT → 当日');
  ok(lastClosedDate(at('2026-09-23T19:59:00Z')) === '2026-09-22', '周三 15:59 EDT → 前一日');
  ok(lastClosedDate(at('2026-09-23T13:00:00Z')) === '2026-09-22', '周三 09:00 EDT 盘前 → 前一日');
  ok(lastClosedDate(at('2026-09-23T14:30:00Z')) === '2026-09-22', '周三 10:30 EDT 盘中 → 前一日');
  ok(lastClosedDate(at('2026-09-26T21:00:00Z')) === '2026-09-25', '周六 → 周五');
  ok(lastClosedDate(at('2026-09-27T03:00:00Z')) === '2026-09-25', '周日 → 周五');
  ok(lastClosedDate(at('2026-01-14T21:00:00Z')) === '2026-01-14', '冬令时 16:00 EST → 当日');
  ok(lastClosedDate(at('2026-01-14T20:59:00Z')) === '2026-01-13', '冬令时 15:59 EST → 前一日');
  ok(lastClosedDate(at('2026-01-17T12:00:00Z')) === '2026-01-16', '1月周六 → 周五');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(etNow().date), 'etNow 格式');
  const bars = [['2026-09-21'], ['2026-09-22'], ['2026-09-23'], ['2026-09-24']];
  ok(splitClosed(bars, '2026-09-23').closed.length === 3, 'splitClosed 按日切分');
  ok(splitClosed(bars, '2026-09-24').liveCount === 0, '全收盘 → live=0');
  ok(splitClosed(bars, '2026-09-22').liveCount === 2, '两根 live（模拟盘中）');
}

/* ---------- 缓存合并 / 排名 ---------- */
suite('sources.mergeBars / anchorSeries / parseYahoo / universe.rankUniverse / loadNdx');
{
  const sample = JSON.stringify({
    chart: { result: [{
      timestamp: [1758648000, 1758734400, 1758820800, 1758907200],
      indicators: {
        quote: [{ open: [1, 2, 3, 4], high: [1.5, 2.5, 3.5, 4.5], low: [0.9, 1.9, 2.9, 3.9], close: [1, null, 3, 4] }],
        adjclose: [{ adjclose: [10, 20, 30, 40] }],
      },
    }] },
  });
  const yb = parseYahoo(sample);
  ok(yb[0][1] === 10 && yb[0][3] === 15 && yb[0][4] === 9, '首根 o/h/l 按 adjclose/close 比例缩放', yb[0]);
  ok(yb.some((b) => b[3] > b[4]), '存在真实高低差（不再全是横线）');
  ok(yb.every((b) => b[3] >= b[2] && b[4] <= b[2]), 'high≥close≥low 恒成立');
  ok(yb.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b[0])), 'ET 日期格式');
  ok(yb.every((b, i) => i === 0 || yb[i - 1][0] <= b[0]), '升序');
  ok(yb[0][2] === 10, 'adjclose 优先于 close', yb[0][2]);
  // hfq 序列锚定：整条序列等比缩放，RSI/EMA 比值不变
  const scale = 77621.28 / 335.92;
  const hfqBars = Array.from({ length: 30 }, (_, i) => ['h' + String(i).padStart(2, '0'), 0, (100 + Math.sin(i / 5) * 6 + i * 0.8) * scale, 0, 0, 0]);
  hfqBars[29][2] = 77621.28;
  const hfq = { adj: 'hfq', bars: hfqBars };
  const a = anchorSeries(hfq, 335.92);
  near(a.bars[29][2], 335.92, 1e-6, '锚定后末值 = 现价', a.bars[29][2]);
  ok(a.anchored === true && a.adj === 'hfq', 'anchored 标记');
  const r_before = rsiSeries(hfqBars.map((b) => b[2]), 6)[29];
  const r_after = rsiSeries(a.bars.map((b) => b[2]), 6)[29];
  ok(r_before !== null && Math.abs(r_after - r_before) < 1e-9, 'RSI 尺度不变', { r_before, r_after });
  ok(anchorSeries({ adj: 'raw', bars: [['x', 0, 1, 0, 0, 0]] }, 100).adj === 'raw', 'raw 序列不锚定');
  ok(anchorSeries(hfq, null) === hfq, '无报价不锚定');
  const m = mergeBars([['2026-09-22', 1, 1, 1, 1, 1], ['2026-09-23', 1, 2, 2, 2, 2]], [['2026-09-23', 1, 9, 9, 9, 9], ['2026-09-24', 1, 3, 3, 3, 3]]);
  ok(m.length === 3 && m[2][0] === '2026-09-24' && m[1][2] === 9, '新覆盖同日 + 升序', m);
  const cands = [{ ticker: 'A' }, { ticker: 'BRK.B' }, { ticker: 'C' }];
  const quotes = [
    { query: 'usA', code: 'A.OQ', mcapUsd: 100 },
    { query: 'usBRK.B', code: 'BRK.B.N', mcapUsd: 300 },
    { query: 'usC', code: 'C.N', mcapUsd: null },
  ];
  const ranked = rankUniverse(cands, quotes, 2);
  ok(ranked[0].ticker === 'BRK.B' && ranked[0].rank === 1, '按实时市值排序，BRK.B 键对齐', ranked.map((r) => r.ticker));
  ok(ranked[1].ticker === 'A' && ranked[1].rank === 2, '第二位');
  ok(rankUniverse(cands, [], 3)[0].rank === 1, '报价全挂 → 静态序兜底，不崩');
  const rankedNdx = rankUniverse(cands, quotes, 3, new Set(['A', 'BRK.B']));
  ok(rankedNdx[0].ndx === true && rankedNdx[1].ndx === true && rankedNdx[2].ndx === false, 'rankUniverse 纳指100 成员标注', rankedNdx.map((r) => r.ndx));
  ok(rankUniverse(cands, quotes, 2)[0].ndx === null && rankUniverse(cands, quotes, 2)[0].ndx !== undefined, '不传 NDX 集合 → ndx=null（向后兼容）');
  const ndxSnap = loadNdx();
  ok(ndxSnap.set.size >= 95 && ndxSnap.set.has('AAPL') && ndxSnap.set.has('ASML') && !ndxSnap.set.has('TSM'), 'loadNdx 快照（core/registry）：ASML 在列、TSM 不在', ndxSnap.set.size);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ndxSnap.asOf), 'NDX 快照带 asOf', ndxSnap.asOf);
}

/* ---------- 周线重采样 ---------- */
suite('weekly：weekEndOf 周五标签 + 日线→周线聚合');
{
  ok(weekEndOf('2026-09-23') === '2026-09-25', '周三 → 本周周五 09-25', weekEndOf('2026-09-23'));
  ok(weekEndOf('2026-09-25') === '2026-09-25', '周五 → 当天');
  ok(weekEndOf('2026-09-28') === '2026-10-02', '周一 → 当周周五（跨月）', weekEndOf('2026-09-28'));
  ok(weekEndOf('2026-01-01') === '2026-01-02', '元旦周四 → 周五（闭市日也作标签）');
  ok(weekEndOf('垃圾') === null, '非法日期 → null');
  const bars = [
    ['2026-09-21', 10, 11, 12, 9, 100],
    ['2026-09-22', 11, 13, 14, 10, 200],
    ['2026-09-23', 13, 12, 15, 8, 300],
    ['2026-09-28', 12, 11, 13, 10, 400],
    ['2026-09-29', 11, 10, 12, 9, 500],
    ['2026-10-05', 10, 12, 12, 10, 600],
  ];
  const w = resampleWeekly(bars);
  ok(w.length === 3, '3 个自然周 → 3 根周线', w.map((x) => x[0]));
  ok(w[0][0] === '2026-09-25' && w[1][0] === '2026-10-02' && w[2][0] === '2026-10-09', '周标签 = 各周周五', w.map((x) => x[0]));
  ok(w[0][1] === 10 && w[0][2] === 12 && w[0][3] === 15 && w[0][4] === 8, '首周 O=10 C=12 H=15 L=8', w[0]);
  ok(w[0][5] === 600, '首周量求和 100+200+300', w[0][5]);
  ok(w[1][2] === 10 && w[1][1] === 12, '次周开=周首 12 收=周末 10', w[1]);
  ok(resampleWeekly([]).length === 0 && resampleWeekly(null).length === 0, '空输入 → 空');
  const one = resampleWeekly([['2026-09-24', 5, 6, 7, 4, 10]]);
  ok(one.length === 1 && one[0][0] === '2026-09-25', '单根成周');
}

/* ---------- 自选/持仓清单 ---------- */
suite('universe：watchlist 归一化 / 池内外拆分 / 池外目标构造');
{
  const wl = normalizeWatchlist({
    tickers: ['NVDA', { ticker: 'qqq', note: '池外ETF' }, { ticker: 'SPMO' }, 'nvda', { ticker: 'BRK.B', note: '  现金替代  ' }, { note: '没有代码' }, '', { ticker: 'XLK', note: 42 }],
  });
  ok(wl.length === 5, '字符串/对象混合，去重（大小写不敏感）、跳过空与缺代码', wl.map((x) => x.ticker));
  ok(wl[0].ticker === 'NVDA' && wl[0].note === '', '纯字符串 → 无备注');
  ok(wl[1].ticker === 'QQQ' && wl[1].note === '池外ETF', '对象形态，代码大写 + 备注');
  ok(wl[4].note === '42', '备注数字转字符串', wl[4].note);
  ok(normalizeWatchlist(undefined).length === 0 && normalizeWatchlist({}).length === 0, '未配置/空配置 → 空清单');
  ok(normalizeWatchlist({ tickers: 'NVDA' }).length === 0, 'tickers 非数组 → 空清单（容错）');

  const targets = [
    { ticker: 'SPMO', name: '标普500动量ETF', rank: null },
    { ticker: 'NVDA', name: '英伟达', rank: 1 },
    { ticker: 'AAPL', name: '苹果', rank: 2 },
  ];
  const { extra } = splitWatchlist(targets, [{ ticker: 'NVDA', note: '' }, { ticker: 'QQQ', note: '池外ETF' }, { ticker: 'SPMO', note: '核心' }]);
  ok(extra.length === 1 && extra[0].ticker === 'QQQ' && extra[0].note === '池外ETF', '只有池外标的进 extra', extra);
  const nvda = targets.find((t) => t.ticker === 'NVDA');
  const spmo = targets.find((t) => t.ticker === 'SPMO');
  ok(nvda.watch === true && nvda.watchNote === '', '池内标的就地打 watch 标');
  ok(spmo.watch === true && spmo.watchNote === '核心', 'SPMO 命中同样打标');
  ok(targets.find((t) => t.ticker === 'AAPL').watch === undefined, '未命中不受影响');

  const wt = watchTargetOf({ ticker: 'QQQ', note: '池外ETF' }, { query: 'usQQQ', code: 'QQQ.OQ', name: '纳指100ETF', price: 512.3 });
  ok(wt.ticker === 'QQQ' && wt.rank === null && wt.spmoPct === null, '池外目标：无排名无 SPMO 权重');
  ok(wt.name === '纳指100ETF' && wt.quotePrice === 512.3, '报价补名称 + 现价锚');
  ok(wt.tvSymbol === 'NASDAQ:QQQ', '报价后缀 → TradingView 交易所前缀', wt.tvSymbol);
  ok(wt.watch === true && wt.watchNote === '池外ETF', '带 watch 标与备注');
  const wt2 = watchTargetOf({ ticker: 'QQQ', note: '' }, null);
  ok(wt2.name === 'QQQ' && wt2.quotePrice === null && wt2.tvSymbol === 'QQQ', '报价缺失 → 退回裸代码，仍可跑');
}

/* ---------- evaluate / summarize ---------- */
suite('signals.evaluate：live 剔除 / raw 标记 / 汇总分组');
{
  const cfg = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [12, 36] }] };
  const up = Array.from({ length: 60 }, (_, i) => ['d' + String(i).padStart(3, '0'), 0, 100 + i, 0, 0, 0]);
  const meta = { ticker: 'TEST', name: '测试', rank: 1, mcapUsd: 1e12, spmoPct: 2.5 };
  const r1 = evaluate(meta, { bars: up, adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r1 && r1.asOf === 'd059', 'marketDate 之内全收盘');
  const r2 = evaluate(meta, { bars: [...up, ['d060', 0, 160, 0, 0, 0]], adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r2.close === 159 && r2.live && r2.live.close === 160, 'live bar 剔除后信号用 d059，live 记录 d060', { close: r2.close, live: r2.live });
  ok(r2.rsi6.state === 'overbought', '连涨超买');
  ok(r2.rsi14 && r2.rsi14.period === 14, 'evaluate 带 rsi14（period 14）', r2.rsi14 && r2.rsi14.period);
  ok(r2.rsi14.value > 70 && r2.rsi14.state === 'overbought', '连涨序列 RSI14 也超买', r2.rsi14 && +r2.rsi14.value.toFixed(1));
  ok(r2.rsi14.value <= r2.rsi6.value || r2.rsi14.value === 100, 'RSI14 平滑更慢（不超前 RSI6）', { r6: r2.rsi6.value, r14: r2.rsi14.value });
  const r3 = evaluate(meta, { bars: up, adj: 'raw', source: 'tencent' }, cfg, 'd059');
  ok(r3.notes.some((n) => n.tag === '口径'), '不复权 → 口径警告');
  const s = summarize([r2]);
  ok(s.overbought.length === 1 && s.oversold.length === 0, 'summarize 超买分组');
  ok(s.obReturn.length === 0 && s.osReturn.length === 0, '无回归事件时不误报');
  const mk = (cross, tunnelEvent) => ({ ticker: 'X' + cross + (tunnelEvent || ''), rsi6: { state: 'neutral', cross }, tunnels: tunnelEvent ? [{ key: '主通道', event: tunnelEvent }] : [] });
  const s3 = summarize([mk('out_ob'), mk('out_os'), mk(null, 'break_up'), mk(null)]);
  ok(s3.obReturn.length === 1 && s3.osReturn.length === 1, 'summarize 回归信号分组', { ob: s3.obReturn.length, os: s3.osReturn.length });
  ok(s3.events.length === 1, 'events 只留通道穿越');
  const down = Array.from({ length: 60 }, (_, i) => ['e' + String(i).padStart(3, '0'), 0, 300 - i, 0, 0, 0]);
  const s2 = summarize([evaluate(meta, { bars: down, adj: 'hfq', source: 'eastmoney' }, cfg, 'e059')]);
  ok(s2.oversold.length === 1, 'summarize 超卖分组');
  ok(evaluate(meta, { bars: up.slice(0, 10), adj: 'hfq', source: 'x' }, cfg, 'd009') === null, 'bars<30 → null');
  const young = Array.from({ length: 650 }, (_, i) => ['y' + String(i).padStart(4, '0'), 0, 100 + i, 0, 0, 0]);
  const cfg3 = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [144, 169] }, { key: '长通道', n: [576, 676] }] };
  const ry = evaluate(meta, { bars: young, adj: 'hfq', source: 'eastmoney' }, cfg3, 'y0649');
  ok(ry.tunnels.length === 2 && ry.tunnels[0].pos === 'above' && ry.tunnels[1].insufficient === true, '650根 → 主通道可算 + 长通道 insufficient', ry.tunnels);
  ok(ry.notes.some((n) => n.tag === '通道' && /676/.test(n.text)), '带数据不足说明', ry.notes.map((n) => n.tag));
  ok(ry.wk === null && r2.wk === null, '假日期序列 → wk=null（容错）', { ry: ry.wk, r2: r2.wk });
}

/* ---------- 周线 evaluate（真实日期） ---------- */
suite('signals.evaluate 周线块：40 周真实日历日线 → 周RSI/周通道/周标签');
{
  const metaW = { ticker: 'WKLY', name: '周线测试', rank: 1, sp500: true, ndx: true };
  const cfgW = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [12, 36] }, { key: '长通道', n: [576, 676] }] };
  const wbars = [];
  for (let wi = 0; wi < 40; wi++) for (let d = 0; d < 5; d++) {
    const iso = new Date(Date.UTC(2026, 0, 5 + wi * 7 + d)).toISOString().slice(0, 10);
    wbars.push([iso, 0, 100 + wi * 5 + d, 0, 0, 0]);
  }
  const rw = evaluate(metaW, { bars: wbars, adj: 'hfq', source: 'eastmoney' }, cfgW, wbars[wbars.length - 1][0]);
  ok(rw && rw.wk && rw.wk.bars === 40, '40 周日线 → 40 根周线', rw.wk && rw.wk.bars);
  ok(rw.wk.rsi6 && rw.wk.rsi6.state === 'overbought', '周线RSI6 超买（逐周上涨）', rw.wk.rsi6);
  ok(rw.wk.rsi14 && rw.wk.rsi14.period === 14 && rw.wk.rsi14.state === 'overbought', '周线RSI14 同参同判（超买）', rw.wk.rsi14);
  ok(rw.wk.tunnels[0].pos === 'above' && rw.wk.tunnels[0].insufficient === undefined, '周线短通道可算 → above', rw.wk.tunnels[0]);
  ok(rw.wk.tunnels[1].insufficient === true, '周线长通道(576/676周) → insufficient');
  ok(rw.wk.asOf === weekEndOf(wbars[199][0]) && rw.wk.asOf === rw.asOf, '周线 asOf = 本周周五标签', rw.wk.asOf);
  ok(rw.sp500 === true && rw.ndx === true, '成分标志透传到行');
  ok(rw.notes.some((n) => n.tag === '周RSI6' && /超买/.test(n.text)), '周线超买 notes 在场', rw.notes.map((n) => n.tag));
}

/* ---------- 数据新鲜度：stale 标记 + 发布闸门 ---------- */
suite('signals/market：数据陈旧标记（stale）与发布闸门（stalenessGate）');
{
  ok(tradingDaysBetween('2026-10-02', '2026-10-05') === 1, '周五→下周一 = 1 个交易日', tradingDaysBetween('2026-10-02', '2026-10-05'));
  ok(tradingDaysBetween('2026-10-02', '2026-10-09') === 5, '周五→下周五 = 5 个交易日', tradingDaysBetween('2026-10-02', '2026-10-09'));
  ok(tradingDaysBetween('2026-10-09', '2026-10-02') === 0, '日期倒挂返回 0');
  ok(tradingDaysBetween('d059', '2026-10-02') === 0, '非法日期返回 0（假日期 fixture 不误标）');
  const days = [];
  for (let t = Date.UTC(2026, 0, 13); days.length < 60; t -= 86400000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) days.push(new Date(t).toISOString().slice(0, 10));
  }
  days.reverse();
  const sBars = days.map((d, i) => [d, 0, 100 + i, 0, 0, 0]);
  const cfgS = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [12, 36] }] };
  const metaS = { ticker: 'STALE', name: '陈旧测试', rank: 1 };
  const rStale = evaluate(metaS, { bars: sBars, adj: 'hfq', source: 'eastmoney' }, cfgS, '2026-10-02');
  ok(rStale.stale === true && rStale.staleDays > 100, '最后一根 2026-01-13 vs 报告日 2026-10-02 → stale', { stale: rStale.stale, staleDays: rStale.staleDays });
  ok(rStale.notes.some((n) => n.tag === '数据' && /数据陈旧/.test(n.text)), '陈旧行带「数据陈旧」note');
  const rFresh = evaluate(metaS, { bars: sBars, adj: 'hfq', source: 'eastmoney' }, cfgS, '2026-01-13');
  ok(rFresh.stale === undefined, '最后一根 == 报告日 → 不标 stale');
  const rLag1 = evaluate(metaS, { bars: sBars, adj: 'hfq', source: 'eastmoney' }, cfgS, '2026-01-14');
  ok(rLag1.stale === undefined, '落后 1 个交易日 → 不标（正常延迟容忍）');
  const rFake = evaluate(metaS, { bars: sBars.map((b, i) => ['f' + i, 0, 100 + i, 0, 0, 0]), adj: 'hfq', source: 'eastmoney' }, cfgS, 'z999');
  ok(rFake.stale === undefined, '假日期（解析失败）不误标 stale');
  const mkRow = (t, asOf, stale) => ({ ticker: t, asOf, stale: stale || undefined });
  const rows30 = Array.from({ length: 30 }, (_, i) => mkRow('N' + i, '2026-10-02'));
  ok(stalenessGate(rows30).blocked === false, '1/30 陈旧（3.3% ≤ 5%）→ 放行', stalenessGate(rows30).staleRatio);
  const rows30b = [...rows30.slice(0, 29), mkRow('X1', '2026-01-13', true), mkRow('X2', '2026-01-13', true)];
  const g2 = stalenessGate(rows30b);
  ok(g2.blocked === true && g2.staleCount === 2 && g2.staleTickers.join(',') === 'X1,X2', '2/30 陈旧（6.7% > 5%）→ 拦截且列出标的', g2);
  ok(stalenessGate(rows30b).dataDate === '2026-10-02', 'dataDate = 行内最大 asOf');
  ok(stalenessGate([]).blocked === false, '空行集不拦截');
  ok(cacheFreshEnough([['2026-10-02', 0, 1, 0, 0, 0]], '2026-10-05') === true, '缓存落后 1 交易日 → 新鲜可用');
  ok(cacheFreshEnough([['2026-10-02', 0, 1, 0, 0, 0]], '2026-10-06') === false, '缓存落后 2 个交易日 → 不可用');
  ok(cacheFreshEnough([['f59', 0, 1, 0, 0, 0]], '2026-10-06') === false, '假日期缓存 → 不可用');
  ok(cacheFreshEnough([], '2026-10-06') === false && cacheFreshEnough(null, 'x') === false, '空/无效缓存 → 不可用');
}

/* ---------- 专业级分析层 ---------- */
suite('analytics：obDaysRun / aboveDaysRun / extensionPct / volumeRatio');
{
  const rise = Array.from({ length: 26 }, (_, i) => 100 + i);
  const fall = Array.from({ length: 26 }, (_, i) => 200 - i);
  ok(obDaysRun(rise, 6, 70) === 20, '连涨序列末尾连续超买 20 天', obDaysRun(rise, 6, 70));
  ok(obDaysRun(fall, 6, 70) === 0, '连跌序列不超买 → 0');
  const trend = Array.from({ length: 200 }, (_, i) => 100 + i);
  ok(aboveDaysRun(trend, [12, 36]) === 165, '线性上扬 → 末尾连续在通道上方 165 天', aboveDaysRun(trend, [12, 36]));
  const ext = extensionPct(trend, [12, 36]);
  ok(ext !== null && ext > 0 && ext < 20, '扩展度为正且量级合理', ext);
  const vbars = (v) => Array.from({ length: 25 }, (_, i) => ['2026-01-' + String(i + 1).padStart(2, '0'), 0, 100, 0, 0, v]);
  ok(volumeRatio(vbars(100).slice(0, 24).concat([['2026-01-25', 0, 100, 0, 0, 300]])) === 3.0, '量比 300/100 = 3.0');
  ok(volumeRatio(vbars(0)) === null, '零成交量数据源 → null（如实降级）');
  ok(volumeRatio(vbars(100).slice(0, 10)) === null, 'bars 不足 21 根 → null');
}
suite('analytics：signalHistory 三大信号历史扫描（黄金值）');
{
  const cfgA = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [10, 30] }] };
  const obr = [...Array.from({ length: 40 }, (_, i) => 100 + i), 130, 130, 130, 130, 130, 130];
  const h1 = signalHistory(obr, cfgA, 5);
  ok(h1.obr.length === 1 && h1.obr[0] === 0, '超买回落捕获 1 次，5 日后收益 %（走平）', h1.obr);
  ok(h1.ret.length === 1 && h1.ret[0] === 0, '同日构成通道回落', h1.ret);
  const s1 = statsOf(h1.obr);
  ok(s1.n === 1 && s1.up === 0 && s1.avg === 0 && s1.med === 0, 'statsOf 摘要正确', s1);
  const osr = [...Array.from({ length: 40 }, (_, i) => 200 - i), 170, 170, 170, 170, 170, 170];
  const h2 = signalHistory(osr, cfgA, 5);
  ok(h2.osr.length === 1 && h2.osr[0] === 0, '超卖回升捕获 1 次（镜像黄金值）', h2.osr);
  const flatOb = Array.from({ length: 45 }, (_, i) => 100 + i);
  const h3 = signalHistory(flatOb, cfgA, 5);
  ok(h3.obr.length === 0 && h3.osr.length === 0, '持续超买无回落穿越 → obr/osr 零样本');
  ok(statsOf([]).n === 0 && statsOf([]).up === null, '空样本 → n=0 且统计位 null');
  const s4 = statsOf([1, -2, 3, 4]);
  ok(s4.n === 4 && s4.up === 75 && s4.avg === 1.5 && s4.med === 2, '偶数样本中位 = 中间两值均值', s4);
}

console.log(`\n${'═'.repeat(50)}\n通过 ${pass} · 失败 ${fail}${fail ? '  ✗✗✗' : '  ✓✓✓'}`);
process.exit(fail ? 1 : 0);
