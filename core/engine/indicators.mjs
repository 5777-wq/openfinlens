/* indicators.mjs —— 三仓合并后的技术指标唯一真源（core/engine，纯函数：零 DOM / 零网络）
 *
 * 合并自两份已对过账的实现（口径天然一致，Phase 0 审计核实）：
 *   · us-stock-monitor lib/indicators.mjs：EMA、RSI（Wilder）、Vegas 三通道位置/事件/快照；
 *   · openfinlens js/technical.js：SMA、RSI（Wilder 标量）、MACD(12,26,9)、KDJ(9,3,3)、
 *     BOLL(20,2)、ATR(14)、量比(5)、均线系统。
 * 口径约定：
 *   · EMA：种子 = 前 n 项 SMA，此后 ema = prev + (close - prev) * 2/(n+1)；
 *   · RSI：Wilder 平滑（与通达信 SMA(X,N,1)、TradingView RMA 同口径）；
 *   · Vegas 三通道：上下轨 = 两条 EMA 的 max/min（趋势向上时 144 在 169 上方，
 *     不固定谁是上轨，按当根比较取）。
 * 铁律：数据不足/脏数据一律返回 null，绝不抛异常、绝不产出 NaN 毒化渲染；
 *       只描述事实与常用读法，绝不说"建议买入/卖出"。
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (arr) => (Array.isArray(arr) ? arr.filter(isNum) : []);
const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

/* ---------- 基础序列 ---------- */

/* 简单均线序列（与 charts.calcMA 同口径：不足 n 处为 null） */
export function smaSeries(closes, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    out.push(i < n - 1 ? null : sum / n);
  }
  return out;
}

/* EMA 序列：与 closes 对齐，前 n-1 位为 null。closes 至少 n 项才有值。 */
export function emaSeries(closes, n) {
  const c = clean(closes);
  if (!Number.isFinite(n) || n < 1 || c.length < n) return c.map(() => null);
  const k = 2 / (n + 1);
  const out = new Array(c.length).fill(null);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += c[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < c.length; i++) {
    prev = prev + (c[i] - prev) * k;
    out[i] = prev;
  }
  return out;
}

/* RSI 序列（Wilder）：与 closes 对齐，前 n 位为 null。
 * 递推：首窗口 avgG/avgL = 前 n 个涨/跌幅的简单均值；
 * 此后 avg = (avg*(n-1) + 当期) / n。avgL=0 → 100，avgG=0 → 0。 */
export function rsiSeries(closes, n = 6) {
  const c = clean(closes);
  const out = new Array(c.length).fill(null);
  if (!Number.isFinite(n) || n < 1 || c.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

/* RSI 末值（标量）：js/technical.js 原签名。数据不足返回 null。 */
export function rsi(closes, n = 14) {
  const seq = rsiSeries(closes, n);
  return last(seq.filter((v) => v !== null));
}

/* MACD(12,26,9)：返回末值 dif/dea/hist + 前值（判金叉死叉） */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const c = clean(closes);
  if (c.length < slow + signal) return null;
  const ef = emaSeries(c, fast);
  const es = emaSeries(c, slow);
  const dif = c.map((_, i) => (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
  const difValid = dif.filter((v) => v !== null);
  const deaSeq = emaSeries(difValid, signal);
  const pad = dif.length - deaSeq.length;
  const dea = dif.map((_, i) => (i < pad ? null : deaSeq[i - pad]));
  const lastDif = last(dif.filter((v) => v !== null));
  const lastDea = last(dea.filter((v) => v !== null));
  if (!isNum(lastDif) || !isNum(lastDea)) return null;
  // 前值：倒数第二个有效对
  let prevDif = null, prevDea = null, seen = 0;
  for (let i = dif.length - 1; i >= 0; i--) {
    if (dif[i] !== null && dea[i] !== null) {
      seen++;
      if (seen === 2) { prevDif = dif[i]; prevDea = dea[i]; break; }
    }
  }
  return { dif: lastDif, dea: lastDea, hist: lastDif - lastDea, prevDif, prevDea };
}

/* KDJ(9,3,3)：RSV→K→D，J=3K-2D，初值 50 */
export function kdj(klines, n = 9) {
  if (!Array.isArray(klines) || klines.length < n) return null;
  const ks = klines.filter((k) => isNum(k.close) && isNum(k.high) && isNum(k.low));
  if (ks.length < n) return null;
  let K = 50, D = 50;
  let prevK = null, prevD = null;
  for (let i = 0; i < ks.length; i++) {
    if (i < n - 1) continue;
    const win = ks.slice(i - n + 1, i + 1);
    const hh = Math.max(...win.map((x) => x.high));
    const ll = Math.min(...win.map((x) => x.low));
    const rsv = hh === ll ? 50 : (ks[i].close - ll) / (hh - ll) * 100;
    K = (2 * K + rsv) / 3;
    D = (2 * D + K) / 3;
    if (i === ks.length - 2) { prevK = K; prevD = D; }
  }
  return { k: K, d: D, j: 3 * K - 2 * D, prevK, prevD };
}

/* BOLL(20,2)：中轨 SMA + 总体标准差；%B = 现价在带内位置(0=下轨 1=上轨，可越界) */
export function boll(closes, n = 20, k = 2) {
  const c = clean(closes);
  if (c.length < n) return null;
  const win = c.slice(-n);
  const mid = win.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(win.reduce((s, v) => s + (v - mid) * (v - mid), 0) / n);
  const up = mid + k * sd, low = mid - k * sd;
  const price = last(c);
  return {
    mid, up, low,
    pctB: up === low ? 0.5 : (price - low) / (up - low),
    width: mid !== 0 ? (up - low) / mid * 100 : null,   // 带宽（%价格）
  };
}

/* ATR(14)：TR 的 Wilder 平滑，返回绝对值与占现价百分比 */
export function atr(klines, n = 14) {
  if (!Array.isArray(klines) || klines.length < n + 1) return null;
  const ks = klines.filter((k) => isNum(k.high) && isNum(k.low) && isNum(k.close));
  if (ks.length < n + 1) return null;
  const trs = [];
  for (let i = 1; i < ks.length; i++) {
    trs.push(Math.max(
      ks[i].high - ks[i].low,
      Math.abs(ks[i].high - ks[i - 1].close),
      Math.abs(ks[i].low - ks[i - 1].close),
    ));
  }
  let v = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < trs.length; i++) v = (v * (n - 1) + trs[i]) / n;
  const price = ks[ks.length - 1].close;
  return { value: v, pct: price !== 0 ? v / price * 100 : null };
}

/* 量比 = 最新成交量 ÷ 前 n 根均量 */
export function volumeRatio(klines, n = 5) {
  if (!Array.isArray(klines) || klines.length < n + 1) return null;
  const ks = klines.filter((k) => isNum(k.volume) && k.volume > 0);
  if (ks.length < n + 1) return null;
  const prevAvg = ks.slice(-(n + 1), -1).reduce((s, k) => s + k.volume, 0) / n;
  return prevAvg > 0 ? ks[ks.length - 1].volume / prevAvg : null;
}

/* 均线系统：MA5/10/20/60 末值 + 现价与均线关系 + 排列判断 */
export function maSystem(closes) {
  const c = clean(closes);
  if (c.length < 60) return null;
  const price = last(c);
  const mas = {};
  [5, 10, 20, 60].forEach((n) => {
    const seq = smaSeries(c, n);
    mas['ma' + n] = last(seq);
  });
  const above = [5, 10, 20, 60].filter((n) => price > mas['ma' + n]).length;
  const bull = mas.ma5 > mas.ma10 && mas.ma10 > mas.ma20 && mas.ma20 > mas.ma60;
  const bear = mas.ma5 < mas.ma10 && mas.ma10 < mas.ma20 && mas.ma20 < mas.ma60;
  return { price, mas, above, trend: bull ? 'bull' : bear ? 'bear' : 'mix' };
}

/* ---------- Vegas 三通道 ---------- */

/* 价格相对一条通道（两条 EMA 围成的带）的位置：
 *   above = 收盘在两线之上（趋势市多头侧）；below = 之下；inside = 带内。
 * prev 同法用前一根收盘判，供穿越事件判定。 */
export function tunnelPos(close, emaA, emaB) {
  if (!isNum(close) || !isNum(emaA) || !isNum(emaB)) return null;
  const hi = Math.max(emaA, emaB), lo = Math.min(emaA, emaB);
  if (close > hi) return 'above';
  if (close < lo) return 'below';
  return 'inside';
}

/* pos 上一根 → pos 本根 的事件名：null = 无事件 */
export function tunnelEvent(prevPos, pos) {
  if (!prevPos || !pos || prevPos === pos) return null;
  const rank = { below: 0, inside: 1, above: 2 };
  return rank[pos] > rank[prevPos]
    ? (pos === 'above' ? 'break_up' : 'reenter_up')
    : (pos === 'below' ? 'break_down' : 'reenter_down');
}

/* 一根通道的完整快照（末根 + 前根，供事件判定） */
export function tunnelSnap(closes, nA, nB) {
  const c = clean(closes);
  const eA = emaSeries(c, nA), eB = emaSeries(c, nB);
  const lastI = c.length - 1, prevI = lastI - 1;
  const lastBar = { a: eA[lastI], b: eB[lastI], pos: tunnelPos(c[lastI], eA[lastI], eB[lastI]) };
  const prev = { a: eA[prevI], b: eB[prevI], pos: tunnelPos(c[prevI], eA[prevI], eB[prevI]) };
  if (!lastBar.pos) return null;
  lastBar.event = tunnelEvent(prev.pos, lastBar.pos);
  lastBar.widthPct = lastBar.a !== null && lastBar.b !== null && (lastBar.a + lastBar.b) / 2 !== 0
    ? Math.abs(lastBar.a - lastBar.b) / ((lastBar.a + lastBar.b) / 2) * 100
    : null;
  return lastBar;
}

/* RSI 末值 + 前值 + 状态 + 穿越（阈值严格 > / <，与目标描述一致） */
export function rsiSnap(closes, n, ob, os) {
  const c = clean(closes);
  const seq = rsiSeries(c, n);
  const lastI = c.length - 1;
  const v = seq[lastI], prev = lastI >= 1 ? seq[lastI - 1] : null;
  if (!isNum(v)) return null;
  const state = v > ob ? 'overbought' : v < os ? 'oversold' : 'neutral';
  const prevState = isNum(prev) ? (prev > ob ? 'overbought' : prev < os ? 'oversold' : 'neutral') : null;
  const cross = prevState && prevState !== state
    ? (state === 'overbought' ? 'into_ob'
      : state === 'oversold' ? 'into_os'
        : prevState === 'overbought' ? 'out_ob' : 'out_os')
    : null;
  return { value: v, prev, state, prevState, cross };
}
