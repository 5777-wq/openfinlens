/* engine/drawdown.js —— 回撤（纯函数） */
(function () {
  'use strict';

  /**
   * 最大回撤（%，正数表示回撤幅度）
   *
   * 关键：**峰值必须先于谷底**。
   * 「最大回撤」讲的是「从高点跌下来」，所以谷底只能取在峰值之后的点。
   * 以前有些地方图省事，直接拿全样本的 max 和 min 相除——
   * 只要最低点发生在最高点之前（历史早期低点 + 近期高点，是绝大多数序列的常态），
   * 就算出一个「两个不相干时刻的比值」，动辄 -95%、-99%，读者一对照就发现是假的。
   *
   * 这里的写法是标准做法：一边往前扫，一边记住「到目前为止的最高点」，
   * 每个点都跟它比，取最深的一次。
   */
  function maxDrawdown(points) {
    if (!points || points.length < 2) return null;
    let peakPt = null;                       // 到目前为止的最高点 {t,v}
    let worst = 0;                            // 最深的回撤（负数）
    let bestPeak = null, bestTrough = null;  // 最深那一次的峰与谷
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = p.v;
      if (v === null || v === undefined) continue;
      if (!peakPt || v > peakPt.v) peakPt = p;
      const dd = peakPt.v ? ((v / peakPt.v) - 1) * 100 : 0;
      if (dd < worst) {
        // 峰与谷必须**同时**存下来：早先只留了谷底，
        // 峰值用了个会被后续迭代覆盖的引用，于是谷底配上了更晚的高点，顺序就反了。
        worst = dd;
        bestPeak = peakPt;
        bestTrough = p;
      }
    }
    return {
      pct: Math.abs(worst),   // 回撤幅度（正数）
      signed: worst,          // 带符号（负数）
      from: bestPeak ? bestPeak.t : null,   // 峰值日期
      to: bestTrough ? bestTrough.t : null, // 谷底日期
      peak: bestPeak,         // 峰值点 {t,v}
      trough: bestTrough,     // 谷底点 {t,v}
    };
  }

  /** 逐点回撤序列（% ≤ 0） */
  function drawdownSeries(points) {
    if (!points) return [];
    let peak = null;
    return points.map((p) => {
      const v = p.v;
      if (v === null || v === undefined) return { t: p.t, v: null };
      if (peak === null || v > peak) peak = v;
      return { t: p.t, v: peak ? ((v / peak) - 1) * 100 : 0 };
    });
  }

  /** 修复（recover）所需涨幅：从最低点回到前高需要涨多少 % */
  function recoverNeeded(points) {
    const md = maxDrawdown(points);
    if (!md) return null;
    const last = points[points.length - 1];
    if (!last || !last.v) return null;
    let peak = null;
    points.forEach((p) => { if (p.v != null && (peak === null || p.v > peak)) peak = p.v; });
    if (!peak) return null;
    return ((peak / last.v) - 1) * 100;
  }

  window.Engine = window.Engine || {};
  window.Engine.drawdown = { maxDrawdown, drawdownSeries, recoverNeeded };
})();
