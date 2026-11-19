/* engine/series.js —— 序列对齐与切片（纯函数，无 DOM 无网络） */
(function () {
  'use strict';

  /** points: [{t:'2024-01-31', v:123.45}, ...] 升序 */
  function toMap(points) {
    const m = new Map();
    (points || []).forEach((p) => { if (p && p.t != null) m.set(String(p.t), p.v); });
    return m;
  }

  /** 取 <= date 的最后一个值（step-hold，不插值） */
  function valueAt(points, date) {
    if (!points || !points.length) return null;
    const d = String(date);
    let lo = 0, hi = points.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (String(points[mid].t) <= d) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best < 0) return null;
    return points[best].v;
  }

  /** 取 >= date 的第一个值 */
  function valueFrom(points, date) {
    if (!points || !points.length) return null;
    const d = String(date);
    for (let i = 0; i < points.length; i++) if (String(points[i].t) >= d) return points[i].v;
    return null;
  }

  /** 按 [from, to] 切片（含端点） */
  function slice(points, from, to) {
    if (!points) return [];
    const a = from ? String(from) : null;
    const b = to ? String(to) : null;
    return points.filter((p) => {
      const t = String(p.t);
      if (a && t < a) return false;
      if (b && t > b) return false;
      return true;
    });
  }

  /** 对齐两条序列到公共日期集合（交集，保留各自原值） */
  function align(a, b) {
    const ma = toMap(a), mb = toMap(b);
    const keys = [];
    ma.forEach((v, k) => { if (mb.has(k)) keys.push(k); });
    keys.sort();
    return {
      dates: keys,
      a: keys.map((k) => ma.get(k)),
      b: keys.map((k) => mb.get(k)),
    };
  }

  /** 归一化到起点 = 100 */
  function normalize(points) {
    if (!points || !points.length) return [];
    const base = points[0].v;
    if (!base) return points.map((p) => Object.assign({}, p, { v: null }));
    return points.map((p) => Object.assign({}, p, { v: (p.v / base) * 100 }));
  }

  /** 把不同频率的序列换算到同一日期轴上（step-hold） */
  function resample(points, dates) {
    if (!points || !dates) return [];
    return dates.map((d) => ({ t: d, v: valueAt(points, d) }));
  }

  /** 变动率：末值 / 首值 - 1 */
  function change(points) {
    if (!points || points.length < 2) return null;
    const a = points[0].v, b = points[points.length - 1].v;
    if (!a || !b) return null;
    return (b / a - 1) * 100;
  }

  /** 年化波动率（对数收益标准差 × √periodsPerYear） */
  function volatility(points, periodsPerYear) {
    if (!points || points.length < 3) return null;
    const rets = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1].v, b = points[i].v;
      if (!a || !b || a <= 0 || b <= 0) continue;
      rets.push(Math.log(b / a));
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const varr = rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (rets.length - 1);
    return Math.sqrt(varr) * Math.sqrt(periodsPerYear) * 100;
  }

  window.Engine = window.Engine || {};
  window.Engine.series = {
    toMap, valueAt, valueFrom, slice, align, normalize, resample, change, volatility,
  };
})();
