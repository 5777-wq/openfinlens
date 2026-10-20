/* js/panes.js —— 副图指标的纯计算（无 DOM 无网络，可单测）
 *
 * 为什么单独一层：副图指标是"把数字变成几何"，算错了界面上不会报错，
 * 只会画歪（RSI 越出 0~100、MACD 柱子在零轴方向反了）。
 * 所以计算必须是纯函数、单测直接断言数值。
 *
 * 背景（用户 2026-10-20）："所有图表的 ema/ma 设置的逻辑还是不够好
 * 无法自定义 ema/ma 或者主图副图其他指标等等 这点重点参考 tv"。
 * TradingView 的模型是「主图叠加指标」+「副图独立指标窗」：
 *   主图：K线 + 任意多条 MA/EMA/BOLL
 *   副图：成交量 / RSI / MACD …（一个独立的小窗）
 * 本项目的副图原先**只有成交量且写死**，主图指标固定 6 槽不能增删。
 * 本模块提供副图那半边：把 RSI / MACD 算成可绘制的序列。
 *
 * 口径与 js/technical.js 一致（同一套算法、同一个"事实不荐股"口径）：
 * 数据不足或脏数据一律返回 null / 空数组，绝不产出 NaN 毒化渲染。 */

(function (global) {
  'use strict';

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* 清洗收盘序列：剔掉 null/NaN（腾讯日K 盘后会出现 null 收盘 bar）。
     返回 { closes, idx } —— idx 记每个有效值在原序列中的位置，
     画图时要用**原 K 线的 time**，不能错位。 */
  function cleanCloses(klines) {
    const closes = [];
    const idx = [];
    (klines || []).forEach((k, i) => {
      if (k && isNum(k.close)) { closes.push(k.close); idx.push(i); }
    });
    return { closes, idx };
  }

  /* EMA 序列（与 technical.js 同口径：种子 = 前 n 项 SMA，k = 2/(n+1)）。
     返回与 closes 等长的数组，前 n-1 项为 null。 */
  function emaSeries(closes, n) {
    if (!Array.isArray(closes) || closes.length < n) return closes.map(() => null);
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

  /* RSI(n) 序列（Wilder 平滑，与 technical.js 的 rsi() 同一算法）。
     返回与 closes 等长的数组，不足 n+1 项处为 null。
     数据不够（< n+1）→ 返回空数组（不画，别画半条线）。 */
  function rsiSeries(closes, n = 14) {
    if (!Array.isArray(closes) || closes.length < n + 1) return [];
    const out = new Array(closes.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgG = gain / n, avgL = loss / n;
    const put = (i) => {
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    };
    put(n);
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
      avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
      put(i);
    }
    return out;
  }

  /* MACD(fast, slow, signal)：返回三条序列 { dif, dea, hist }，与 closes 等长。
     hist = dif - dea（与 js/technical.js 的 macd() **同一口径**：那边算末值、
     这边画整条线，差一个系数就会出现"文字说的 MACD 柱"和"图上画的柱子"对不上）。
     数据不够（< slow + signal）→ 空对象（不画）。 */
  function macdSeries(closes, fast = 12, slow = 26, signal = 9) {
    if (!Array.isArray(closes) || closes.length < slow + signal) return { dif: [], dea: [], hist: [] };
    const ef = emaSeries(closes, fast);
    const es = emaSeries(closes, slow);
    const dif = closes.map((_, i) => (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
    // DEA 是 DIF 的 EMA：DIF 前段有 null，先取有效段算 EMA，再拼回原位
    const difValid = dif.filter(v => v !== null);
    const deaValid = emaSeries(difValid, signal);
    const dea = new Array(closes.length).fill(null);
    let vi = 0;
    for (let i = 0; i < closes.length; i++) {
      if (dif[i] !== null) { dea[i] = deaValid[vi]; vi++; }
    }
    const hist = closes.map((_, i) => (dif[i] !== null && dea[i] !== null) ? dif[i] - dea[i] : null);
    return { dif, dea, hist };
  }

  /* 副图指标清单：给设置项用（键 = 类型，label = 显示名，参数 = 可调周期） */
  const PANE_DEFS = [
    { key: 'vol', label: '成交量', params: [] },
    { key: 'rsi', label: 'RSI', params: [{ key: 'n', label: '周期', def: 14, min: 2, max: 100 }] },
    { key: 'macd', label: 'MACD', params: [
      { key: 'fast', label: '快', def: 12, min: 2, max: 200 },
      { key: 'slow', label: '慢', def: 26, min: 3, max: 400 },
      { key: 'signal', label: '信号', def: 9, min: 2, max: 100 },
    ] },
  ];

  function paneDef(key) {
    for (const d of PANE_DEFS) if (d.key === key) return d;
    return null;
  }

  /* 副图指标 → 可绘制的序列组。
     klines: 原始 K 线数组（要带 time）
     返回 { lines: [{ name, color, data:[{time,value}] }], bars: [{time,value,color}] }
     —— lines 画线（RSI/MACD 的 DIF/DEA），bars 画柱（成交量/MACD 的 hist）。
     数据不足 → 返回空结构（调用方不画）。 */
  function computePane(key, klines, params) {
    const p = params || {};
    const { closes, idx } = cleanCloses(klines);
    const out = { lines: [], bars: [] };
    if (!closes.length) return out;
    const timeAt = (i) => (klines[i] && klines[i].time != null ? klines[i].time : null);

    if (key === 'vol') {
      const data = [];
      (klines || []).forEach((k) => {
        if (k && isNum(k.volume) && k.time != null) data.push({ time: k.time, value: k.volume });
      });
      out.bars.push({ name: '成交量', data });
      return out;
    }
    if (key === 'rsi') {
      const n = Math.max(2, Math.min(100, Math.round(+p.n || 14)));
      const series = rsiSeries(closes, n);
      const data = [];
      series.forEach((v, i) => {
        if (v === null) return;
        const t = timeAt(idx[i]);
        if (t !== null) data.push({ time: t, value: v });
      });
      out.lines.push({ name: 'RSI' + n, data });
      return out;
    }
    if (key === 'macd') {
      const fast = Math.max(2, Math.min(200, Math.round(+p.fast || 12)));
      const slow = Math.max(3, Math.min(400, Math.round(+p.slow || 26)));
      const signal = Math.max(2, Math.min(100, Math.round(+p.signal || 9)));
      const m = macdSeries(closes, fast, slow, signal);
      const pick = (arr) => {
        const data = [];
        arr.forEach((v, i) => {
          if (v === null) return;
          const t = timeAt(idx[i]);
          if (t !== null) data.push({ time: t, value: v });
        });
        return data;
      };
      out.lines.push({ name: 'DIF', data: pick(m.dif) });
      out.lines.push({ name: 'DEA', data: pick(m.dea) });
      out.bars.push({ name: 'MACD', data: pick(m.hist) });
      return out;
    }
    return out;
  }

  /* 副图纵轴范围（给 priceScale 的 scaleMargins 用）。
     返回 { min, max } —— RSI 固定 0~100；MACD 按数据自适应并含 0 轴；成交量 0 起。
     没有数据 → null（调用方用默认边距）。 */
  function paneRange(key, pane) {
    if (!pane) return null;
    if (key === 'rsi') return { min: 0, max: 100 };
    const vals = [];
    (pane.lines || []).forEach(l => (l.data || []).forEach(d => { if (isNum(d.value)) vals.push(d.value); }));
    (pane.bars || []).forEach(l => (l.data || []).forEach(d => { if (isNum(d.value)) vals.push(d.value); }));
    if (!vals.length) return null;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (key === 'macd') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }   // 含零轴
    else lo = 0;                                                        // 成交量从 0 起
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    return { min: lo - pad, max: hi + pad };
  }

  global.Panes = {
    PANE_DEFS, paneDef, cleanCloses, emaSeries, rsiSeries, macdSeries, computePane, paneRange,
  };
})(typeof window !== 'undefined' ? window : globalThis);
