/* engine/similarity.js —— 历史对照仪（纯函数）
   思路：把每个指标的当前值转成 z 分数（相对该指标自身历史），
        再在历史上逐点算欧氏距离，取最近的 K 个窗口。
   ⚠ 输出的是「历史上类似处境之后发生了什么」，不是预测。 */
(function () {
  'use strict';

  /** 指标的 z 分数：v 相对 mean/std */
  function zscore(v, mean, std) {
    if (!std) return 0;
    return (v - mean) / std;
  }

  /** 指标历史统计量 */
  function stats(values) {
    const arr = (values || []).filter((x) => typeof x === 'number' && isFinite(x));
    if (!arr.length) return { n: 0, mean: null, std: null, min: null, max: null };
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const varr = arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / arr.length;
    return {
      n: arr.length, mean,
      std: Math.sqrt(varr),
      min: Math.min.apply(null, arr),
      max: Math.max.apply(null, arr),
    };
  }

  /**
   * 找相似历史窗口
   * @param {Array} seriesList  [{ key, points:[{t,v}] }]
   * @param {Object} atDate     对照基准日 'YYYY-MM-DD'
   * @param {Object} opts       { topK=5, lookbackMonths=6 }
   * @returns {Array} [{ date, distance, similarity, values:{key:v} }]
   */
  function findSimilar(seriesList, atDate, opts) {
    const o = Object.assign({ topK: 5, lookbackMonths: 6 }, opts || {});
    if (!seriesList || seriesList.length < 2) return [];

    // 1) 各指标在自己的历史里算出 z 分数
    const cur = {};     // key → { v, z }
    const stat = {};    // key → stats
    seriesList.forEach((s) => {
      const vals = s.points.map((p) => p.v).filter((x) => typeof x === 'number');
      const st = stats(vals);
      stat[s.key] = st;
      const v = lastOnOrBefore(s.points, atDate);
      cur[s.key] = { v, z: zscore(v, st.mean, st.std) };
    });

    // 2) 候选日：所有序列在该日都有值，且往前留出 lookbackMonths 的历史用于算"当时的处境"
    const dates = commonDates(seriesList);
    const cands = [];
    dates.forEach((d) => {
      if (d >= atDate) return;
      const w = windowBefore(seriesList, d, o.lookbackMonths);
      if (!w) return;
      const zs = [];
      let ok = true;
      seriesList.forEach((s) => {
        const z = w[s.key];
        if (z === null || z === undefined) { ok = false; return; }
        zs.push(z);
      });
      if (!ok) return;
      const curZs = seriesList.map((s) => cur[s.key].z);
      const dist = Math.sqrt(zs.reduce((sum, z, i) => sum + (z - curZs[i]) ** 2, 0) / zs.length);
      cands.push({ date: d, distance: dist, values: {} });
      seriesList.forEach((s) => { cands[cands.length - 1].values[s.key] = w.raw[s.key]; });
    });

    if (!cands.length) return [];
    cands.sort((a, b) => a.distance - b.distance);

    // 相似度：距离 → 0-100（用候选集里的最小/最大距离做尺度）
    const ds = cands.map((c) => c.distance);
    const dMin = Math.min.apply(null, ds);
    const dMax = Math.max.apply(null, ds);
    return cands.slice(0, o.topK).map((c) => ({
      date: c.date,
      distance: c.distance,
      similarity: dMax === dMin ? 100 : Math.round((1 - (c.distance - dMin) / (dMax - dMin)) * 100),
      values: c.values,
    }));
  }

  /** 某序列在 date 当日或之前最近的值 */
  function lastOnOrBefore(points, date) {
    if (!points || !points.length) return null;
    const d = String(date);
    let v = null;
    for (let i = 0; i < points.length; i++) {
      if (String(points[i].t) <= d) v = points[i].v; else break;
    }
    return v;
  }

  /** 所有序列共有的日期 */
  function commonDates(seriesList) {
    let acc = null;
    seriesList.forEach((s) => {
      const set = new Set(s.points.map((p) => String(p.t)));
      if (acc === null) acc = set;
      else acc = new Set([...acc].filter((d) => set.has(d)));
    });
    return acc ? [...acc].sort() : [];
  }

  /** 截止 date、往前 lookbackMonths 个月窗口内，各指标相对其"更早历史"的 z 分数 */
  function windowBefore(seriesList, date, months) {
    const cutoff = shiftMonths(date, -months);
    const out = { raw: {} };
    for (const s of seriesList) {
      const inWin = s.points.filter((p) => String(p.t) <= date && String(p.t) >= cutoff);
      if (!inWin.length) return null;
      const before = s.points.filter((p) => String(p.t) < cutoff);
      const all = before.map((p) => p.v).filter((x) => typeof x === 'number');
      if (all.length < 8) return null;   // 样本太少不可靠，宁可不匹配
      const st = stats(all);
      const v = inWin[inWin.length - 1].v;
      if (v === null || v === undefined) return null;
      out[s.key] = zscore(v, st.mean, st.std);
      out.raw[s.key] = v;
    }
    return out;
  }

  /** 日期加减月份（保守：按 30 天近似，够用） */
  function shiftMonths(date, months) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
    if (!m) return date;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  window.Engine = window.Engine || {};
  window.Engine.similarity = { findSimilar, stats, zscore, shiftMonths };
})();
