/* technical.js —— 技术面指标库（纯函数，无 DOM / 无网络，可直接单测）
   对标 TradingView 常用指标中"免费日K就能算"的一批：
   均线系统(MA5/10/20/60) · EMA(12/26) · MACD(12,26,9) · RSI(14) · KDJ(9,3,3)
   · BOLL(20,2) · ATR(14) · 量比(5日)。
   铁律：只描述事实与常用读法（"超买""金叉""多头排列"），绝不说"建议买入/卖出"；
   数据不足/脏数据一律返回 null，绝不抛异常、绝不产出 NaN 毒化渲染。 */

const Technical = (() => {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const clean = (arr) => (Array.isArray(arr) ? arr.filter(isNum) : []);
  const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

  /* ---------- 基础序列 ---------- */
  // 简单均线序列（与 charts.calcMA 同口径：不足 n 处为 null）
  function smaSeries(closes, n) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= n) sum -= closes[i - n];
      out.push(i < n - 1 ? null : sum / n);
    }
    return out;
  }

  // EMA 序列：种子 = 前 n 项 SMA，此后 ema = prev + (close - prev) * k, k=2/(n+1)
  function emaSeries(closes, n) {
    if (closes.length < n) return closes.map(() => null);
    const k = 2 / (n + 1);
    const out = [];
    let seed = 0;
    for (let i = 0; i < n; i++) { seed += closes[i]; out.push(null); }
    let prev = seed / n;
    out[n - 1] = prev;
    for (let i = n; i < closes.length; i++) {
      prev = prev + (closes[i] - prev) * k;
      out.push(prev);
    }
    return out;
  }

  /* ---------- 指标 ---------- */
  // RSI(n)：Wilder 平滑
  function rsi(closes, n = 14) {
    const c = clean(closes);
    if (c.length < n + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = c[i] - c[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgG = gain / n, avgL = loss / n;
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
      avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  }

  // MACD(12,26,9)：返回末值 dif/dea/hist + 前值（判金叉死叉）
  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const c = clean(closes);
    if (c.length < slow + signal) return null;
    const ef = emaSeries(c, fast);
    const es = emaSeries(c, slow);
    const dif = c.map((_, i) => (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
    const difValid = dif.filter(v => v !== null);
    const deaSeq = emaSeries(difValid, signal);
    const pad = dif.length - deaSeq.length;
    const dea = dif.map((_, i) => (i < pad ? null : deaSeq[i - pad]));
    const lastDif = last(dif.filter(v => v !== null));
    const lastDea = last(dea.filter(v => v !== null));
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

  // KDJ(9,3,3)：RSV→K→D，J=3K-2D，初值 50
  function kdj(klines, n = 9) {
    if (!Array.isArray(klines) || klines.length < n) return null;
    const ks = klines.filter(k => isNum(k.close) && isNum(k.high) && isNum(k.low));
    if (ks.length < n) return null;
    let K = 50, D = 50;
    let prevK = null, prevD = null;
    for (let i = 0; i < ks.length; i++) {
      if (i < n - 1) continue;
      const win = ks.slice(i - n + 1, i + 1);
      const hh = Math.max(...win.map(x => x.high));
      const ll = Math.min(...win.map(x => x.low));
      const rsv = hh === ll ? 50 : (ks[i].close - ll) / (hh - ll) * 100;
      K = (2 * K + rsv) / 3;
      D = (2 * D + K) / 3;
      if (i === ks.length - 2) { prevK = K; prevD = D; }
    }
    return { k: K, d: D, j: 3 * K - 2 * D, prevK, prevD };
  }

  // BOLL(20,2)：中轨 SMA + 总体标准差；%B = 现价在带内位置(0=下轨 1=上轨，可越界)
  function boll(closes, n = 20, k = 2) {
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

  // ATR(14)：TR 的 Wilder 平滑，返回绝对值与占现价百分比
  function atr(klines, n = 14) {
    if (!Array.isArray(klines) || klines.length < n + 1) return null;
    const ks = klines.filter(k => isNum(k.high) && isNum(k.low) && isNum(k.close));
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

  // 量比 = 最新成交量 ÷ 前 n 根均量
  function volumeRatio(klines, n = 5) {
    if (!Array.isArray(klines) || klines.length < n + 1) return null;
    const ks = klines.filter(k => isNum(k.volume) && k.volume > 0);
    if (ks.length < n + 1) return null;
    const prevAvg = ks.slice(-(n + 1), -1).reduce((s, k) => s + k.volume, 0) / n;
    return prevAvg > 0 ? ks[ks.length - 1].volume / prevAvg : null;
  }

  // 均线系统：MA5/10/20/60 末值 + 现价与均线关系 + 排列判断
  function maSystem(closes) {
    const c = clean(closes);
    if (c.length < 60) return null;
    const price = last(c);
    const mas = {};
    [5, 10, 20, 60].forEach(n => {
      const seq = smaSeries(c, n);
      mas['ma' + n] = last(seq);
    });
    const above = [5, 10, 20, 60].filter(n => price > mas['ma' + n]).length;
    const bull = mas.ma5 > mas.ma10 && mas.ma10 > mas.ma20 && mas.ma20 > mas.ma60;
    const bear = mas.ma5 < mas.ma10 && mas.ma10 < mas.ma20 && mas.ma20 < mas.ma60;
    return { price, mas, above, trend: bull ? 'bull' : bear ? 'bear' : 'mix' };
  }

  /* ---------- 汇总：事实 + 信号（描述性，不荐股） ---------- */
  // signals: [{ tag, text, bias }] bias: 'up'|'down'|'flat'
  function analyze(klines) {
    if (!Array.isArray(klines) || klines.length < 60) return null;
    const closes = klines.map(k => k.close);
    const price = last(clean(closes));
    const out = { price, signals: [] };

    // 均线系统
    const ma = maSystem(closes);
    out.ma = ma;
    if (ma) {
      out.signals.push(ma.trend === 'bull'
        ? { tag: '均线', text: `多头排列：5>10>20>60 日线自上而下张开，现价站上全部 4 条均线。常用读法：趋势市，回踩均线是观察点。`, bias: 'up' }
        : ma.trend === 'bear'
          ? { tag: '均线', text: `空头排列：5<10<20<60 日线自上而下压住，现价低于全部 4 条均线。常用读法：弱势市，反弹到均线处常见抛压。`, bias: 'down' }
          : { tag: '均线', text: `均线纠缠：现价处于 ${ma.above}/4 条均线上方，短中期方向不一致。常用读法：震荡市，等排列重新张开。`, bias: 'flat' });
    }

    // MACD
    const md = macd(closes);
    out.macd = md;
    if (md) {
      const cross = (md.prevDif !== null && md.prevDea !== null)
        ? (md.prevDif <= md.prevDea && md.dif > md.dea ? 'golden'
          : md.prevDif >= md.prevDea && md.dif < md.dea ? 'dead' : null) : null;
      out.signals.push(cross === 'golden'
        ? { tag: 'MACD', text: `金叉：DIF(${md.dif.toFixed(3)}) 刚上穿 DEA(${md.dea.toFixed(3)})。常用读法：下跌动能衰竭的信号，但在零轴下方出现时可靠性打折。`, bias: 'up' }
        : cross === 'dead'
          ? { tag: 'MACD', text: `死叉：DIF(${md.dif.toFixed(3)}) 刚下穿 DEA(${md.dea.toFixed(3)})。常用读法：上涨动能衰竭的信号，零轴上方出现时同样打折。`, bias: 'down' }
          : md.dif > 0 && md.dea > 0
            ? { tag: 'MACD', text: `零轴上方运行：DIF ${md.dif.toFixed(3)} / DEA ${md.dea.toFixed(3)}，多头市场环境未破坏。`, bias: 'up' }
            : md.dif < 0 && md.dea < 0
              ? { tag: 'MACD', text: `零轴下方运行：DIF ${md.dif.toFixed(3)} / DEA ${md.dea.toFixed(3)}，空头市场环境未改变。`, bias: 'down' }
              : { tag: 'MACD', text: `围绕零轴反复：DIF ${md.dif.toFixed(3)} / DEA ${md.dea.toFixed(3)}，动能方向不明确。`, bias: 'flat' });
    }

    // RSI
    const r = rsi(closes, 14);
    out.rsi = r;
    if (r !== null) {
      out.signals.push(r >= 70
        ? { tag: 'RSI', text: `RSI(14) = ${r.toFixed(0)}：进入通常定义的"超买区"（≥70）。注意：强趋势里 RSI 可以长期停在 70 上方，超买≠马上下跌。`, bias: 'down' }
        : r <= 30
          ? { tag: 'RSI', text: `RSI(14) = ${r.toFixed(0)}：进入通常定义的"超卖区"（≤30）。同理：弱势里可以持续钝化，超卖≠马上反弹。`, bias: 'up' }
          : { tag: 'RSI', text: `RSI(14) = ${r.toFixed(0)}：处于中性区（30-70），${r > 50 ? '偏强半区' : '偏弱半区'}。`, bias: r > 50 ? 'up' : r < 50 ? 'down' : 'flat' });
    }

    // KDJ
    const j = kdj(klines);
    out.kdj = j;
    if (j) {
      out.signals.push(j.j > 100
        ? { tag: 'KDJ', text: `J 值 ${j.j.toFixed(0)} > 100：短线情绪过热，K=${j.k.toFixed(0)} / D=${j.d.toFixed(0)}。J 值对短线拐点敏感，但大涨行情里会连续钝化。`, bias: 'down' }
        : j.j < 0
          ? { tag: 'KDJ', text: `J 值 ${j.j.toFixed(0)} < 0：短线情绪过冷，K=${j.k.toFixed(0)} / D=${j.d.toFixed(0)}。恐慌末段常见，但阴跌里也会反复钝化。`, bias: 'up' }
          : { tag: 'KDJ', text: `K=${j.k.toFixed(0)} / D=${j.d.toFixed(0)} / J=${j.j.toFixed(0)}：${j.k > j.d ? 'K 在 D 上方，短线动能偏向上' : 'K 在 D 下方，短线动能偏向下'}。`, bias: j.k > j.d ? 'up' : 'down' });
    }

    // BOLL
    const b = boll(closes);
    out.boll = b;
    if (b) {
      out.signals.push(b.pctB > 1
        ? { tag: 'BOLL', text: `收盘价突破布林上轨（%B=${b.pctB.toFixed(2)}，带宽 ${b.width.toFixed(1)}%）。常用读法：强势突破或短期过热，看量能是否配合。`, bias: 'up' }
        : b.pctB < 0
          ? { tag: 'BOLL', text: `收盘价跌破布林下轨（%B=${b.pctB.toFixed(2)}）。常用读法：超跌或破位下行，等缩口企稳再判断。`, bias: 'down' }
          : { tag: 'BOLL', text: `价格在带内 %B=${b.pctB.toFixed(2)} 位置（0=下轨 1=上轨），带宽 ${b.width.toFixed(1)}%。带宽收窄常预示变盘临近。`, bias: 'flat' });
    }

    // ATR + 量比（事实条目）
    const a = atr(klines);
    out.atr = a;
    if (a && a.pct !== null) {
      out.signals.push({ tag: 'ATR', text: `ATR(14) = ${a.value.toFixed(2)}（日均波动约 ${a.pct.toFixed(1)}%）。它不是方向指标：止损宽度、仓位大小常用它来定标。`, bias: 'flat' });
    }
    const vr = volumeRatio(klines);
    out.volRatio = vr;
    if (vr !== null) {
      out.signals.push(vr >= 1.5
        ? { tag: '量能', text: `量比 ${vr.toFixed(2)}（vs 5 日均量）：明显放量，价格方向的"认可度"提高，假突破概率下降。`, bias: 'flat' }
        : vr <= 0.7
          ? { tag: '量能', text: `量比 ${vr.toFixed(2)}（vs 5 日均量）：明显缩量，涨跌都缺乏增量资金确认，突破易失败。`, bias: 'flat' }
          : { tag: '量能', text: `量比 ${vr.toFixed(2)}（vs 5 日均量）：量能平常。`, bias: 'flat' });
    }

    // 综合计票（描述性统计，不是评级）
    const up = out.signals.filter(s => s.bias === 'up').length;
    const down = out.signals.filter(s => s.bias === 'down').length;
    out.bias = { up, down, flat: out.signals.length - up - down };
    return out;
  }

  /* ---------- 日K画像（原大师模块的纯数据部分，随板块更名迁入） ----------
     近一年涨跌 / 距 52 周高低点 / 年化波动 / 最大回撤 / 均线偏离：详情页事实弹药 */
  function computeProfile(klines) {
    if (!Array.isArray(klines) || klines.length < 30) return null;
    const closes = klines.map(k => k.close).filter(c => isNum(c) && c > 0);
    if (closes.length < 30) return null;
    const lastClose = closes[closes.length - 1];
    const win = closes.slice(-Math.min(243, closes.length));
    const yearAgo = win[0];
    const high = Math.max(...win);
    const low = Math.min(...win);

    let vol = null;
    if (win.length >= 31) {
      const rets = [];
      for (let i = 1; i < win.length; i++) rets.push(Math.log(win[i] / win[i - 1]));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varr = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / rets.length;
      vol = Math.sqrt(varr) * Math.sqrt(243) * 100;
    }

    let peak = win[0], maxDD = 0, hiIdx = 0;
    for (let i = 0; i < win.length; i++) {
      if (win[i] > peak) { peak = win[i]; hiIdx = i; }
      const dd = win[i] / peak - 1;
      if (dd < maxDD) maxDD = dd;
    }

    const ma = (n) => {
      if (closes.length < n) return null;
      const arr = closes.slice(-n);
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    return {
      points: closes.length,
      yearChangePct: (lastClose / yearAgo - 1) * 100,
      offHighPct: (lastClose / high - 1) * 100,
      offLowPct: (lastClose / low - 1) * 100,
      volAnnual: vol,
      maxDDPct: maxDD * 100,                       // 窗口内最大峰谷回撤（≤0）
      barsSinceHigh: win.length - 1 - hiIdx,       // 距 52 周高点过了多少个交易日
      mom20Pct: closes.length > 20 ? (lastClose / closes[closes.length - 21] - 1) * 100 : null,
      ma20: ma(20), ma60: ma(60),
      ma20OffPct: ma(20) !== null ? (lastClose / ma(20) - 1) * 100 : null,
      ma60OffPct: ma(60) !== null ? (lastClose / ma(60) - 1) * 100 : null,
      aboveMA20: ma(20) !== null ? lastClose > ma(20) : null,
      aboveMA60: ma(60) !== null ? lastClose > ma(60) : null,
      high52w: high, low52w: low,
    };
  }

  return { smaSeries, emaSeries, rsi, macd, kdj, boll, atr, volumeRatio, maSystem, analyze, computeProfile };
})();

window.Technical = Technical;
