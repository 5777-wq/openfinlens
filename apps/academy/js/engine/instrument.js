/* engine/instrument.js —— 标的的历史读数（纯函数，node 可测）
   输入一条月线序列，输出读者真正关心的几个数：现在多少、历史最高多少、历史最低多少、
   最大回撤是多少（从高点跌下来的那一次）、近一年涨跌。
   这些数全部由数据算出，页面里不手写——手写的数字会悄悄过期。 */
(function () {
  'use strict';

  /** 往前推 n 个月的日期键 */
  function monthsBefore(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 10);
  }

  /** 某年某月的最后一个自然日（2026-10 → 2026-10-31） */
  function naturalMonthEnd(ym) {
    const y = Number(String(ym).slice(0, 4));
    const m = Number(String(ym).slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }

  /**
   * 最后一点是不是「当月还没走完」的盘中值？
   *
   * 采集器每个月只写一个点：月中的时候写的是当天盘中价，月过完了才变成当月月末价。
   * 所以序列的最后一点**往往不是月末**——页面把它标成「最新月末」就是在撒谎。
   *
   * 判据按可靠度依次排：
   * 1. 采集器在数据里打了 partial 标记 —— 以标记为准；
   * 2. 数据的生成时间与最后一点同月 —— 采集时当月还没走完；
   * 3. 兜底：最后一点比序列里所有月末点都靠前 —— 更像月中快照。
   */
  function detectPartial(series) {
    const pts = series && series.points;
    if (!pts || !pts.length) return false;
    const last = pts[pts.length - 1];

    if (typeof series.partial === 'boolean') return series.partial;
    if (typeof last.partial === 'boolean') return last.partial;

    const gen = String(series.generatedAt || '');
    if (/^\d{4}-\d{2}/.test(gen) && gen.slice(0, 7) === String(last.t).slice(0, 7)) return true;

    const day = Number(String(last.t).slice(8, 10));
    if (day >= 28) return false;              // 28 号以后：大概率就是月末交易日
    const others = pts.slice(0, -1)
      .map((p) => Number(String(p.t).slice(8, 10)))
      .filter((d) => d > 0);
    if (!others.length) return false;
    return day < Math.min.apply(null, others);
  }

  /** 序列 → 关键读数 */
  function stats(series) {
    if (!series || !Array.isArray(series.points) || !series.points.length) return null;
    const pts = series.points;
    const first = pts[0];
    const last = pts[pts.length - 1];

    /* 历史最高 / 历史最低：全样本极值。
       这两个数没有先后顺序问题——它们各自就是一条记录，不做比值。 */
    let peak = first, trough = first;
    for (const p of pts) {
      if (p.v > peak.v) peak = p;
      if (p.v < trough.v) trough = p;
    }

    /* 最大回撤：**谷底必须发生在峰值之后**。
       以前这里直接拿全样本的 max 和 min 相除，于是谷底在峰值之前时
       （历史早期的低点 ÷ 近期的高点，几乎每条序列都是）算出来 -95%、-99% 这种荒谬值。
       读者在数据卡上一对就发现是假的——那比不给数更糟。
       现在交给 engine/drawdown.js 的标准实现：边扫边记住到目前为止的最高点。 */
    const dd = (window.Engine && window.Engine.drawdown)
      ? window.Engine.drawdown.maxDrawdown(pts)
      : null;
    const mddPeak = dd && dd.peak ? dd.peak : peak;
    const mddTrough = dd && dd.trough ? dd.trough : peak;

    // 近一年：取「一年前那个月」的点
    const key1y = monthsBefore(last.t, 12);
    let y1 = null;
    for (const p of pts) { if (p.t <= key1y) y1 = p; else break; }

    // 近三年
    const key3y = monthsBefore(last.t,  36);
    let y3 = null;
    for (const p of pts) { if (p.t <= key3y) y3 = p; else break; }

    const pct = (a, b) => (a && b ? (a.v / b.v - 1) * 100 : null);

    // 收益率类序列：单位是 %。
    // 收益率的「涨跌」不能按百分比算——从 5% 跌到 2% 是跌了 60%（百分比），
    // 但读者要看的是「跌了 3 个百分点」。口径写错，数字就骗人。
    // 回放器早就分开了（js/components/replay-player.js 的 isYield），这里跟它同一把尺子。
    const isRate = String(series.unit || '') === '%';

    /* 当前读数在历史样本里的分位。
       这是小白最需要的一句判断：「现在这个数，在历史上算高还是算低」。
       它只陈述事实（当前值在历史分布里的位置），不预测、不建议。
       分位高不等于该卖，分位低也不等于该买——文案里不这么说。 */
    const vals = pts.map((p) => p.v).filter((v) => typeof v === 'number' && isFinite(v));
    const hasPctl = !!(window.Engine && window.Engine.percentile);
    const pctl = hasPctl ? window.Engine.percentile.percentile(vals, last.v) : null;
    const band = (hasPctl && pctl !== null) ? window.Engine.percentile.band(pctl) : null;

    return {
      from: first.t,
      to: last.t,
      count: pts.length,
      last: last,
      peak: peak,
      trough: trough,
      isRate: isRate,
      // 价格类：真正的最大回撤（负数 %）。收益率类不用百分比讲，改看 spreadPp。
      dropPct: dd ? dd.signed : 0,
      mddPeak: mddPeak,
      mddTrough: mddTrough,
      mddFrom: dd ? dd.from : null,
      mddTo: dd ? dd.to : null,
      // 收益率类：历史最高到历史最低差多少个百分点。
      // 这是**区间跨度**，不涉及先后顺序，所以用全样本 max/min 是对的。
      spreadPp: isRate ? peak.v - trough.v : null,
      chg1y: pct(last, y1),
      chg1yBp: isRate && y1 ? (last.v - y1.v) * 100 : null,    // 近一年变动（基点）
      chg3y: pct(last, y3),
      chgAll: pct(last, first),
      unadj: /未复权/.test(String(series.kind || '')) || /未复权/.test(String(series.source || '')),
      partial: detectPartial(series),   // 最后一点是不是当月未收的盘中值
      pctl: pctl,                        // 当前读数的历史分位（0-100）
      band: band,                        // 分位档位 {label, tone}
    };
  }

  window.Engine = window.Engine || {};
  window.Engine.instrument = { stats, monthsBefore, detectPartial, naturalMonthEnd };
})();
