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

  /* 指标扩充五件（VWAP / ATR / StochRSI / CCI / DMI·ADX）：Wilder 平滑与 technical.js 同款（种子 = 前 n 项 SMA、此后加权递推）；
     系列与输入等长、脏 bar / 预热段为 null，绝不产出 NaN。 */

  /* VWAP 会话锚：字符串取前 10 位（日 K 串，js/sources/eastmoney.js:205）；伪 UTC 秒取 UTC 日期（分钟 K 墙钟日，:226）。 */
  function dayAnchor(t) {
    if (typeof t === 'string') return t.slice(0, 10);
    if (typeof t !== 'number' || !isFinite(t)) return null;
    const d = new Date(t * 1000), p2 = (x) => (x < 10 ? '0' + x : '' + x);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  }

  /* VWAP：tp=(h+l+c)/3，Σ(tp×v)/Σv 跨日重置（TradingView Session 锚口径）。量仅作权重、展示的是价格；无量/脏 bar 该点不画。 */
  function vwapSeries(klines) {
    const src = Array.isArray(klines) ? klines : [], out = new Array(src.length).fill(null);
    let pv = 0, vv = 0, cur = null;
    for (let i = 0; i < src.length; i++) {
      const k = src[i];
      if (!k || !isNum(k.high) || !isNum(k.low) || !isNum(k.close) || !isNum(k.volume) || k.volume <= 0) continue;
      const a = dayAnchor(k.time);
      if (a !== cur) { cur = a; pv = 0; vv = 0; }
      const tp = (k.high + k.low + k.close) / 3;
      pv += tp * k.volume; vv += k.volume;
      out[i] = pv / vv;
    }
    return out;
  }

  /* ATR(n)：TR 自第 1 根起、种子 = 前 n 根 TR 的 SMA、此后 Wilder 递推（technical.atr 同口径）；值按有效 bar 原始下标落位。 */
  function atrSeries(klines, n = 14) {
    const src = Array.isArray(klines) ? klines : [], out = new Array(src.length).fill(null);
    const ks = [], at = [];
    src.forEach((k, i) => { if (k && isNum(k.high) && isNum(k.low) && isNum(k.close)) { ks.push(k); at.push(i); } });
    if (!(n >= 1) || ks.length < n + 1) return out;
    const trs = [];
    for (let i = 1; i < ks.length; i++) trs.push(Math.max(ks[i].high - ks[i].low, Math.abs(ks[i].high - ks[i - 1].close), Math.abs(ks[i].low - ks[i - 1].close)));
    let v = 0;
    for (let i = 0; i < n; i++) v += trs[i];
    out[at[n]] = v /= n;                      // 种子落在第 n+1 个有效 bar
    for (let i = n; i < trs.length; i++) { v = (v * (n - 1) + trs[i]) / n; out[at[i + 1]] = v; }
    return out;
  }

  /* 带 null 的 SMA：窗内全有效才算，否则该点 null（预热段自然为 null）。逐窗直加：滑动加减有浮点漂移（可溢出值域一个 ε）。 */
  function smaPadded(series, w) {
    const len = Array.isArray(series) ? series.length : 0, out = new Array(len).fill(null);
    if (!len || !(w >= 1)) return out;
    for (let i = w - 1; i < len; i++) {
      let sum = 0, ok = true;
      for (let j = i - w + 1; j <= i; j++) {
        if (!isNum(series[j])) { ok = false; break; }
        sum += series[j];
      }
      if (ok) out[i] = sum / w;
    }
    return out;
  }

  /* StochRSI(n,kS,dS)：RSI 的 n 窗随机化 raw=(rsi-最低)/(最高-最低)×100（平窗=50），K=raw 的 SMA(kS)、D=K 的 SMA(dS)。 */
  function stochRsiSeries(closes, n = 14, kS = 3, dS = 3) {
    const c = Array.isArray(closes) ? closes : [];
    if (c.length < n * 2 + kS + dS - 2) return { k: [], d: [] };   // K/D 预热链放不下 → 空结构
    const rsi = rsiSeries(c, n), raw = new Array(c.length).fill(null);
    for (let i = n * 2 - 1; i < c.length; i++) {
      let hh = -Infinity, ll = Infinity, ok = true;
      for (let j = i - n + 1; j <= i; j++) {
        if (!isNum(rsi[j])) { ok = false; break; }
        if (rsi[j] > hh) hh = rsi[j]; if (rsi[j] < ll) ll = rsi[j];
      }
      if (ok) raw[i] = hh === ll ? 50 : (rsi[i] - ll) / (hh - ll) * 100;
    }
    const k = smaPadded(raw, kS);
    return { k, d: smaPadded(k, dS) };
  }

  /* CCI(n)：tp 的 n 窗 SMA 与平均绝对偏差，cci=(tp-sma)/(0.015×md)；md=0 → 0。 */
  function cciSeries(klines, n = 20) {
    const src = Array.isArray(klines) ? klines : [], out = new Array(src.length).fill(null);
    if (!(n >= 1)) return out;
    const tp = src.map((k) => (k && isNum(k.high) && isNum(k.low) && isNum(k.close)) ? (k.high + k.low + k.close) / 3 : null);
    for (let i = n - 1; i < src.length; i++) {
      let sum = 0, ok = true;
      for (let j = i - n + 1; j <= i; j++) {
        if (!isNum(tp[j])) { ok = false; break; }
        sum += tp[j];
      }
      if (!ok) continue;
      const sma = sum / n; let dev = 0;
      for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - sma);
      const md = dev / n;
      out[i] = md === 0 ? 0 : (tp[i] - sma) / (0.015 * md);
    }
    return out;
  }

  /* DMI(n,m)：+DM/-DM/TR 的 Wilder 平滑 → +DI/-DI 自第 n 个有效 bar 起效；DX 再平滑 → ADX 自第 n+m-1 个有效 bar 起效。 */
  function dmiSeries(klines, n = 14, m = 14) {
    const src = Array.isArray(klines) ? klines : [];
    const out = { pdi: new Array(src.length).fill(null), mdi: new Array(src.length).fill(null), adx: new Array(src.length).fill(null) };
    const ks = [], at = [];
    src.forEach((k, i) => { if (k && isNum(k.high) && isNum(k.low) && isNum(k.close)) { ks.push(k); at.push(i); } });
    if (!(n >= 1) || ks.length < n + 1) return out;   // ks.length < n+1 早退，ADX 由 dxs.length≥m 自守
    const wilder = (arr, w) => {
      const o = new Array(arr.length).fill(null);
      if (!(w >= 1) || arr.length < w) return o;
      let s = 0;
      for (let i = 0; i < w; i++) s += arr[i];
      let v = s / w;
      o[w - 1] = v;
      for (let i = w; i < arr.length; i++) { v = (v * (w - 1) + arr[i]) / w; o[i] = v; }
      return o;
    };
    const trs = [], pds = [], mds = [];
    for (let i = 1; i < ks.length; i++) {
      const up = ks[i].high - ks[i - 1].high, dn = ks[i - 1].low - ks[i].low;
      trs.push(Math.max(ks[i].high - ks[i].low, Math.abs(ks[i].high - ks[i - 1].close), Math.abs(ks[i].low - ks[i - 1].close)));
      pds.push(up > dn && up > 0 ? up : 0); mds.push(dn > up && dn > 0 ? dn : 0);
    }
    const st = wilder(trs, n), sp = wilder(pds, n), sm = wilder(mds, n), dxs = [];
    for (let i = 0; i < trs.length; i++) {
      if (st[i] === null) continue;
      const pdi = st[i] === 0 ? 0 : 100 * sp[i] / st[i], mdi = st[i] === 0 ? 0 : 100 * sm[i] / st[i];
      out.pdi[at[i + 1]] = pdi; out.mdi[at[i + 1]] = mdi;
      dxs.push(pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi));
    }
    const adx = wilder(dxs, m);
    for (let j = 0; j < adx.length; j++) { if (adx[j] !== null) out.adx[at[n + j]] = adx[j]; }   // dxs[j] ↔ 第 n+j 个有效 bar
    return out;
  }

  /* 副图指标清单：给设置项用（键 = 类型，label = 显示名，参数 = 可调周期） */
  const PANE_DEFS = [
    { key: 'vol', label: '成交量', params: [] },
    { key: 'rsi', label: 'RSI', range: 'pct', params: [{ key: 'n', label: '周期', def: 14, min: 2, max: 100 }] },
    { key: 'macd', label: 'MACD', params: [
      { key: 'fast', label: '快', def: 12, min: 2, max: 200 },
      { key: 'slow', label: '慢', def: 26, min: 3, max: 400 },
      { key: 'signal', label: '信号', def: 9, min: 2, max: 100 },
    ] },
    { key: 'vwap', label: 'VWAP', range: 'free', params: [] },
    { key: 'atr', label: 'ATR', params: [{ key: 'n', label: '周期', def: 14, min: 2, max: 100 }] },
    { key: 'stochrsi', label: 'StochRSI', range: 'pct', params: [
      { key: 'n', label: '周期', def: 14, min: 2, max: 100 },
      { key: 'k', label: 'K平滑', def: 3, min: 1, max: 100 }, { key: 'd', label: 'D平滑', def: 3, min: 1, max: 100 },
    ] },
    { key: 'cci', label: 'CCI', params: [{ key: 'n', label: '周期', def: 20, min: 2, max: 200 }] },
    { key: 'dmi', label: 'DMI', params: [
      { key: 'n', label: '周期', def: 14, min: 2, max: 100 }, { key: 'm', label: 'ADX平滑', def: 14, min: 1, max: 100 },
    ] },
  ];

  function paneDef(key) {
    for (const d of PANE_DEFS) if (d.key === key) return d;
    return null;
  }

  /* 副图管理（≤3 实例）的清单净化：用户/存储侧输入一律不可信——
     脏键剔除、同名键去重只留首个、超上限截断、高度与参数钳制。
     空清单合法（用户可移除全部副图，主图独占）。
     ⚠ 全程不用 Set/Map：与文件内其余纯函数同一朴素数组风格，vm 单测上下文零依赖。 */
  const PANES_MAX = 3;
  const PANE_H_DEF = 110;
  const PANE_H_MIN = 60;
  const PANE_H_MAX = 220;

  function sanitizePaneList(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (let i = 0; i < raw.length && out.length < PANES_MAX; i++) {
      const item = raw[i];
      if (!item || typeof item !== 'object') continue;
      const def = paneDef(item.key);
      if (!def) continue;                          // 键不在 PANE_DEFS 白名单 → 剔
      let dup = false;
      for (let k = 0; k < out.length; k++) { if (out[k].key === item.key) { dup = true; break; } }
      if (dup) continue;                           // 同名键去重只留首个
      const params = {};
      (def.params || []).forEach((p) => {
        const v = item.params ? item.params[p.key] : undefined;
        if (!isNum(v)) return;                     // 非数丢（computePane 内部自钳制不变，这里是双保险）
        params[p.key] = Math.max(p.min, Math.min(p.max, Math.round(v)));
      });
      let h = Math.round(+item.h);
      if (!isFinite(h)) h = PANE_H_DEF;            // 缺省/非数 → 110
      out.push({ key: item.key, params, h: Math.max(PANE_H_MIN, Math.min(PANE_H_MAX, h)) });
    }
    return out;
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
    // 等长序列配 time：closes 对齐的序列用 idx 反查原下标，klines 对齐的直接用 timeAt
    const pick = (arr, tAt) => (arr || []).map((v, i) => ({ v, t: tAt(i) }))
      .filter((x) => x.v != null && x.t != null).map((x) => ({ time: x.t, value: x.v }));

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
    if (key === 'vwap') { out.lines.push({ name: 'VWAP', data: pick(vwapSeries(klines), timeAt) }); return out; }
    if (key === 'atr') {
      const n = Math.max(2, Math.min(100, Math.round(+p.n || 14)));
      out.lines.push({ name: 'ATR' + n, data: pick(atrSeries(klines, n), timeAt) });
      return out;
    }
    if (key === 'stochrsi') {
      const n = Math.max(2, Math.min(100, Math.round(+p.n || 14)));
      const s = stochRsiSeries(closes, n, Math.max(1, Math.min(100, Math.round(+p.k || 3))), Math.max(1, Math.min(100, Math.round(+p.d || 3))));
      out.lines.push({ name: 'K', data: pick(s.k, (i) => timeAt(idx[i])) });
      out.lines.push({ name: 'D', data: pick(s.d, (i) => timeAt(idx[i])) });
      return out;
    }
    if (key === 'cci') {
      const n = Math.max(2, Math.min(200, Math.round(+p.n || 20)));
      out.lines.push({ name: 'CCI' + n, data: pick(cciSeries(klines, n), timeAt) });
      return out;
    }
    if (key === 'dmi') {
      const n = Math.max(2, Math.min(100, Math.round(+p.n || 14)));
      const s = dmiSeries(klines, n, Math.max(1, Math.min(100, Math.round(+p.m || 14))));
      out.lines.push({ name: '+DI', data: pick(s.pdi, timeAt) });
      out.lines.push({ name: '-DI', data: pick(s.mdi, timeAt) });
      out.lines.push({ name: 'ADX', data: pick(s.adx, timeAt) });
      return out;
    }
    return out;
  }

  /* 副图纵轴范围（给 priceScale 的 scaleMargins 用）。
     返回 { min, max } —— RSI 固定 0~100；MACD 按数据自适应并含 0 轴；成交量 0 起。
     没有数据 → null（调用方用默认边距）。 */
  function paneRange(key, pane) {
    if (!pane) return null;
    const mode = (paneDef(key) || {}).range;   // 'pct' 固定 0~100（RSI/StochRSI）
    if (key === 'rsi' || mode === 'pct') return { min: 0, max: 100 };
    const vals = [];
    (pane.lines || []).forEach(l => (l.data || []).forEach(d => { if (isNum(d.value)) vals.push(d.value); }));
    (pane.bars || []).forEach(l => (l.data || []).forEach(d => { if (isNum(d.value)) vals.push(d.value); }));
    if (!vals.length) return null;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (key === 'macd') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }   // 含零轴
    else if (mode !== 'free') lo = Math.min(lo, 0);                     // 成交量/非负指标含 0；vwap(free) 纯自适应
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    return { min: lo - pad, max: hi + pad };
  }

  global.Panes = {
    PANE_DEFS, paneDef, cleanCloses, emaSeries, rsiSeries, macdSeries, computePane, paneRange,
    vwapSeries, atrSeries, stochRsiSeries, cciSeries, dmiSeries,
    PANES_MAX, PANE_H_DEF, PANE_H_MIN, PANE_H_MAX, sanitizePaneList,
  };
})(typeof window !== 'undefined' ? window : globalThis);
