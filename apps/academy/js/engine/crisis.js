/* engine/crisis.js —— 危机包摘要（纯函数，node 可测）
   头条数字一律从包内数据算出来，不手写——避免"文章说跌 63%、数据其实是 60%"。 */
(function () {
  'use strict';

  /**
   * 单条序列在区间内的峰值与谷底。
   *
   * 峰谷必须是**有先后的那一对**：谷底在峰值之后，才谈得上「从高点跌下来」。
   * 以前直接拿全样本的 max 和 min —— 谷底早于峰值时（1998 那场的标普就是），
   * 算出来的是两个不相干日期的比值，页面上会挂出一个假的跌幅。
   *
   * 另外保留全样本的 maxRange（区间跨度）：收益率序列讲「区间变动」时用它——
   * 那是个跨度，不涉及先后，取全局 max/min 恰恰是对的。
   */
  function extremes(points) {
    if (!points || !points.length) return null;
    let hi = null, lo = null;
    for (const p of points) {
      if (p.v === null || p.v === undefined) continue;
      if (!hi || p.v > hi.v) hi = p;
      if (!lo || p.v < lo.v) lo = p;
    }
    if (!hi || !lo) return null;

    const dd = (window.Engine && window.Engine.drawdown)
      ? window.Engine.drawdown.maxDrawdown(points)
      : null;
    const peak = dd && dd.peak ? dd.peak : hi;
    const trough = dd && dd.trough ? dd.trough : lo;

    return {
      peak, trough,
      dropPct: dd ? dd.signed : (trough.v / peak.v - 1) * 100,
      rangePp: hi.v - lo.v,      // 区间跨度（最高 - 最低）
      high: hi,
      low: lo,
    };
  }

  /** 单日最大跌幅 */
  function worstDay(points) {
    if (!points || points.length < 2) return null;
    let worst = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1].v, b = points[i].v;
      if (!a || !b) continue;
      const pct = (b / a - 1) * 100;
      if (!worst || pct < worst.pct) worst = { t: points[i].t, pct, from: a, to: b };
    }
    return worst;
  }

  /**
   * 危机包摘要
   * @returns {Object} { id, title, from, to, days, seriesCount, headlines:[{key,name,dropPct,peak,trough,worstDay}] }
   */
  function summarize(pkg) {
    if (!pkg) return null;
    const headlines = (pkg.series || []).map((s) => {
      const ex = extremes(s.points);
      return {
        key: s.key, name: s.name, unit: s.unit,
        peak: ex ? ex.peak : null,
        trough: ex ? ex.trough : null,
        dropPct: ex ? ex.dropPct : null,
        worstDay: worstDay(s.points),
      };
    });
    // 跌幅最大的排前面（股票类优先：排除收益率类）
    const equityLike = headlines.filter((h) => h.key !== 'US10Y' && h.key !== 'US2Y' && h.key !== 'US3M' && h.key !== 'US30Y');
    equityLike.sort((a, b) => (a.dropPct || 0) - (b.dropPct || 0));
    return {
      id: pkg.id, title: pkg.title,
      from: pkg.dates[0] || pkg.from, to: pkg.dates[pkg.dates.length - 1] || pkg.to,
      days: (pkg.dates || []).length,
      seriesCount: (pkg.series || []).length,
      events: (pkg.events || []).length,
      freq: pkg.freq,
      headline: equityLike[0] || headlines[0] || null,
      headlines,
      note: pkg.note || '',
    };
  }

  window.Engine = window.Engine || {};
  window.Engine.crisis = { extremes, worstDay, summarize };
})();
