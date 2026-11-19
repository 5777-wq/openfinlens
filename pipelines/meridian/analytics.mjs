/* analytics.mjs —— 专业级信号上下文与历史统计（纯函数，零依赖，Node 20+）
 * 移植自 Meridian lib/analytics.mjs，指标原语改引 core/engine 唯一真源。
 * 输入已收盘 bars/closes，输出只描述事实：
 *   · 钝化背景：连续超买天数、短通道上方连续天数——超买/趋势持续越久，信号越"钝化"；
 *   · 扩展度：收盘距短通道上轨的百分比（>0=上方偏离，<0=通道内）；
 *   · 量能：末根成交量 / 前 20 根均量（数据源无量能字段时为 null，如实降级）；
 *   · 历史验证：三大核心信号（超买回落/超卖回升/通道回落）在全历史上每次出现后
 *     horizon 日的收益分布（样本数/均值/中位/上涨占比）——给信号一个统计背景，
 *     不预测未来，不构成建议。 */

import { rsiSeries, emaSeries } from '../../core/engine/indicators.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => (isNum(v) ? +v.toFixed(1) : null);
const round2 = (v) => (isNum(v) ? +v.toFixed(2) : null);

/* 连续超买天数：从末根往回数 rsi > ob 的连续根数（末根不超买 = 0） */
export function obDaysRun(closes, period, ob) {
  const rsi = rsiSeries(closes, period);
  let n = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (isNum(rsi[i]) && rsi[i] > ob) n++;
    else break;
  }
  return n;
}

/* 连续位于通道上方天数（同法，用收盘 vs 两 EMA 的 max） */
export function aboveDaysRun(closes, [nA, nB]) {
  const a = emaSeries(closes, nA), b = emaSeries(closes, nB);
  let n = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (isNum(a[i]) && isNum(b[i]) && closes[i] > Math.max(a[i], b[i])) n++;
    else break;
  }
  return n;
}

/* 扩展度：收盘距通道上轨 %（(close/upper-1)*100；数据不足 null） */
export function extensionPct(closes, [nA, nB]) {
  const a = emaSeries(closes, nA), b = emaSeries(closes, nB);
  const i = closes.length - 1;
  if (!isNum(a[i]) || !isNum(b[i]) || !closes[i]) return null;
  return round2((closes[i] / Math.max(a[i], b[i]) - 1) * 100);
}

/* 量比：末根量 / 前 20 根均量。bars=[date,o,c,h,l,v]；v<=0 视为该源无量能 → null */
export function volumeRatio(bars, window = 20) {
  if (!Array.isArray(bars) || bars.length < window + 1) return null;
  const lastBar = bars[bars.length - 1][5];
  if (!isNum(lastBar) || lastBar <= 0) return null;
  let sum = 0, cnt = 0;
  for (let i = bars.length - 1 - window; i < bars.length - 1; i++) {
    const v = bars[i][5];
    if (isNum(v) && v > 0) { sum += v; cnt++; }
  }
  if (!cnt || sum <= 0) return null;
  return round2(lastBar / (sum / cnt));
}

/* ---------- 历史信号扫描 ---------- */

/* 三大信号在全历史每次出现处的 horizon 日前向收益（%）。返回原始数组供汇总：
 *   obr = RSI 自超买回落（prev>ob 且 cur<=ob，与 signals.rsiSnap 的 out_ob 同口径）
 *   osr = RSI 自超卖回升（prev<os 且 cur>=os，同 out_os）
 *   ret = 通道回落（任一通道：前根收盘在其上轨之上、本根回到轨内；同日多通道只记一次）
 * 末根信号无前向数据，自然不入样。 */
export function signalHistory(closes, cfg, horizon = 5) {
  const c = closes, n = c.length;
  const ob = cfg.rsi.overbought, os = cfg.rsi.oversold;
  const rsi = rsiSeries(c, cfg.rsi.period);
  const tuns = (cfg.tunnels || []).map((t) => ({ a: emaSeries(c, t.n[0]), b: emaSeries(c, t.n[1]) }));
  const out = { obr: [], osr: [], ret: [] };
  const push = (arr, i) => {
    if (i + horizon < n && isNum(c[i]) && c[i] > 0 && isNum(c[i + horizon]) && c[i + horizon] > 0) {
      arr.push((c[i + horizon] / c[i] - 1) * 100);
    }
  };
  for (let i = 1; i < n; i++) {
    const r = rsi[i], p = rsi[i - 1];
    if (isNum(r) && isNum(p)) {
      if (p > ob && r <= ob) push(out.obr, i);
      if (p < os && r >= os) push(out.osr, i);
    }
    for (const t of tuns) {
      const a0 = t.a[i - 1], b0 = t.b[i - 1], a1 = t.a[i], b1 = t.b[i];
      if (isNum(a0) && isNum(b0) && isNum(a1) && isNum(b1)) {
        const hi0 = Math.max(a0, b0), hi1 = Math.max(a1, b1), lo1 = Math.min(a1, b1);
        if (c[i - 1] > hi0 && c[i] <= hi1 && c[i] >= lo1) { push(out.ret, i); break; }
      }
    }
  }
  return out;
}

/* 原始收益数组 → 统计摘要 {n, up%（上涨占比）, avg, med}；空样本 up/avg/med = null */
export function statsOf(raw) {
  const a = (raw || []).filter(isNum);
  if (!a.length) return { n: 0, up: null, avg: null, med: null };
  const sorted = [...a].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: a.length,
    up: round1((a.filter((x) => x > 0).length / a.length) * 100),
    avg: round2(a.reduce((s, x) => s + x, 0) / a.length),
    med: round2(med),
  };
}

/* 行级上下文一次性打包（monitor 主循环用） */
export function rowContext(bars, cfg) {
  const closes = bars.map((b) => b[2]);
  const short = (cfg.tunnels && cfg.tunnels[0] && cfg.tunnels[0].n) || [144, 169];
  return {
    obDays: obDaysRun(closes, cfg.rsi.period, cfg.rsi.overbought),
    aboveDays: aboveDaysRun(closes, short),
    extPct: extensionPct(closes, short),
    volRatio: volumeRatio(bars),
  };
}
