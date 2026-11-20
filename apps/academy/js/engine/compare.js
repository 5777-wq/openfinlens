/* engine/compare.js —— 资产对比器的纯计算层（无 DOM 无网络，node 可测）
 *
 * 口径先说清楚，页面上的每个数都要能对回这里：
 *   · 区间涨跌：末值 / 首值 - 1，价格类用百分比（%）。
 *   · 年化（CAGR）：按首末日期之间的实际年数折算；不满一个月不给年化，
 *     否则「三天涨 2%」会变成一个漂亮但没意义的年化大数。
 *   · 年化波动：月度对数收益的样本标准差 × √12 × 100。
 *   · 最大回撤：复用 engine/drawdown.js 的标准实现；峰值必须先于谷底。
 *     返回正数幅度（例如 50 表示从高点跌了 50%），不是带符号的数。
 *   · 收益率序列（unit 为 %）：view 另调 rateStats，把涨跌与波动换算成
 *     「个百分点」。从 5% 跌到 2% 是跌了 3 个百分点，不是跌了 60%。
 *
 * alignSeries 用 step-hold：取「当日或之前最近一个真实值」，不插值。
 * 序列起点之前给 null；序列结束之后沿用最后值，避免在区间尾部凭空断线。
 */
(function () {
  'use strict';

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /** 只保留有日期、有有限数值的点；按日期升序复制一份，不修改调用方数组。 */
  function cleanPoints(points) {
    if (!Array.isArray(points)) return [];
    return points
      .filter((p) => p && p.t !== null && p.t !== undefined && isNum(p.v))
      .map((p) => ({ t: String(p.t), v: Number(p.v) }))
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  }

  /** 数值或 {v} 都接受，统一取有限数字。 */
  function valueOf(x) {
    if (isNum(x)) return x;
    if (x && isNum(x.v)) return x.v;
    return null;
  }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /** 样本标准差（n-1）。收益率的波动率用总体口径会把小样本估小。 */
  function stdev(arr) {
    if (!arr || arr.length < 2) return null;
    const m = mean(arr);
    let ss = 0;
    for (const v of arr) ss += (v - m) * (v - m);
    return Math.sqrt(ss / (arr.length - 1));
  }

  /** 两个 ISO 日期之间的年数；解析失败返回 null。 */
  function yearsBetween(a, b) {
    if (!a || !b) return null;
    const t1 = Date.parse(String(a) + 'T00:00:00Z');
    const t2 = Date.parse(String(b) + 'T00:00:00Z');
    if (!isFinite(t1) || !isFinite(t2) || t2 <= t1) return null;
    return (t2 - t1) / 86400000 / 365.25;
  }

  /**
   * 最大回撤。优先用站内 engine/drawdown.js；它不存在时用同一套扫描：
   * 一边往前走，一边记住「到目前为止的最高点」，每个点只跟它比。
   * 绝不能拿全样本 max / min 直接相除——低点在前的序列会被算成假回撤。
   */
  function drawdownOf(points) {
    if (!points || points.length < 2) return null;
    const D = window.Engine && window.Engine.drawdown;
    if (D && typeof D.maxDrawdown === 'function') {
      const dd = D.maxDrawdown(points);
      if (dd) return dd;
    }
    let peak = null;
    let worst = 0;
    let bestPeak = null;
    let bestTrough = null;
    for (const p of points) {
      if (!peak || p.v > peak.v) peak = p;
      const dd = peak.v ? (p.v / peak.v - 1) * 100 : 0;
      if (dd < worst) {
        worst = dd;
        bestPeak = peak;
        bestTrough = p;
      }
    }
    return {
      pct: Math.abs(worst),
      signed: worst,
      from: bestPeak ? bestPeak.t : null,
      to: bestTrough ? bestTrough.t : null,
      peak: bestPeak,
      trough: bestTrough,
    };
  }

  /** 所有相邻有效点的涨跌幅，用于最好 / 最差单期。 */
  function bestWorst(points) {
    let best = null;
    let worst = null;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a.v || !b.v) continue;
      const pct = (b.v / a.v - 1) * 100;
      if (!isFinite(pct)) continue;
      const row = { t: b.t, pct, from: a.v, to: b.v };
      if (!best || pct > best.pct) best = row;
      if (!worst || pct < worst.pct) worst = row;
    }
    return { best, worst };
  }

  /**
   * 单条序列的区间统计。
   * first / last 返回真实点 {t, v}，这样页面能同时读到日期和值；
   * 空序列返回全 null 的对象，调用方不用先判断再取字段。
   */
  function seriesStats(points) {
    const pts = cleanPoints(points);
    if (!pts.length) {
      return {
        first: null, last: null, changePct: null, cagr: null,
        vol: null, mdd: null, bestDay: null, worstDay: null,
      };
    }

    const first = pts[0];
    const last = pts[pts.length - 1];

    // 价格类才有「百分比涨跌」；首值为 0 时除法无意义，返回 null 而不是 Infinity。
    const changePct = first.v ? (last.v / first.v - 1) * 100 : null;

    // CAGR：不满一个月不给。短区间的年化会把噪声放大成误导性的大数。
    let cagr = null;
    const years = yearsBetween(first.t, last.t);
    if (years !== null && years >= 1 / 12 && first.v > 0 && last.v > 0) {
      cagr = (Math.pow(last.v / first.v, 1 / years) - 1) * 100;
    }

    // 月度对数收益：至少两个收益样本（三个点）才能估标准差。
    const logRets = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].v;
      const b = pts[i].v;
      if (a > 0 && b > 0) logRets.push(Math.log(b / a));
    }
    const sd = stdev(logRets);
    const vol = sd === null ? null : sd * Math.sqrt(12) * 100;

    const dd = drawdownOf(pts);
    const bw = bestWorst(pts);

    return {
      first,
      last,
      changePct,
      cagr,
      vol,
      mdd: dd ? dd.pct : null,
      bestDay: bw.best,
      worstDay: bw.worst,
    };
  }

  /**
   * 收益率序列的专用读数（unit 为 % 时用）。
   * 收益率不能按百分比讲涨跌：5% → 2% 是 -3 个百分点。
   * volPp 是「月度变动（百分点）的样本标准差 × √12」，单位仍是百分点。
   * mddPp 是峰值在前、谷底在后的百分点跨度，正数。
   */
  function rateStats(points) {
    const pts = cleanPoints(points);
    if (!pts.length) {
      return { first: null, last: null, changePp: null, volPp: null, mddPp: null, rangePp: null };
    }
    const first = pts[0];
    const last = pts[pts.length - 1];

    let hi = pts[0].v;
    let lo = pts[0].v;
    for (const p of pts) {
      if (p.v > hi) hi = p.v;
      if (p.v < lo) lo = p.v;
    }

    // 月度变动（百分点）；至少两个变动样本才估波动。
    const diffs = [];
    for (let i = 1; i < pts.length; i++) diffs.push(pts[i].v - pts[i - 1].v);
    const sd = stdev(diffs);
    const volPp = sd === null ? null : sd * Math.sqrt(12);

    // 峰谷跨度：同 drawdown 的「先峰后谷」口径，但单位是百分点。
    let peak = null;
    let worst = 0;
    let peakAt = null;
    let troughAt = null;
    for (const p of pts) {
      if (!peak || p.v > peak.v) peak = p;
      const dd = peak.v - p.v;
      if (dd > worst) {
        worst = dd;
        peakAt = peak.t;
        troughAt = p.t;
      }
    }

    return {
      first,
      last,
      changePp: last.v - first.v,
      volPp,
      mddPp: pts.length >= 2 ? worst : null,
      rangePp: hi - lo,
      peakAt,
      troughAt,
    };
  }

  /** YYYY-MM → 合法月份字符串；不合法返回 null。 */
  function validMonth(s) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(s === null || s === undefined ? '' : s));
    return m ? m[1] + '-' + m[2] : null;
  }

  /** 月份平移：2026-10 往前 120 个月 → 2016-10。 */
  function monthShift(ym, n) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(ym || ''));
    if (!m) return null;
    const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + Number(n || 0);
    const y = Math.floor(total / 12);
    const mo = ((total % 12) + 12) % 12;
    return String(y).padStart(4, '0') + '-' + String(mo + 1).padStart(2, '0');
  }

  /** 某个月的最后一个自然日：2024-02 → 2024-02-29。 */
  function monthEnd(ym) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(ym || ''));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  }

  /** 某个月的起点：2024-02 → 2024-02-01。 */
  function monthStart(ym) {
    const v = validMonth(ym);
    return v ? v + '-01' : null;
  }

  /** from / to 支持 YYYY-MM 或 YYYY-MM-DD；返回展开后的日期边界。 */
  function boundsOf(from, to) {
    let a = null;
    let b = null;
    if (from) {
      const s = String(from);
      a = /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? monthStart(s) : s;
    }
    if (to) {
      const s = String(to);
      b = /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? monthEnd(s) : s;
    }
    if (a && b && a > b) return { from: a, to: b, empty: true };
    return { from: a, to: b, empty: false };
  }

  /** 取 <= date 的最后一个有效值（step-hold，不插值）。 */
  function valueAtOrBefore(points, date) {
    if (!points || !points.length) return null;
    const d = String(date);
    let lo = 0;
    let hi = points.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= d) {
        hit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return hit >= 0 ? points[hit].v : null;
  }

  /** 按 [from, to] 切片（含端点）。日期都是 ISO 字符串，直接按字典序比。 */
  function slicePoints(points, from, to) {
    const pts = cleanPoints(points);
    const b = boundsOf(from, to);
    if (b.empty) return [];
    return pts.filter((p) => {
      if (b.from && p.t < b.from) return false;
      if (b.to && p.t > b.to) return false;
      return true;
    });
  }

  /**
   * 多条序列对齐到同一条日期轴。
   * 日期轴 = 各序列在区间内出现过的真实日期并集（不造日期）。
   * 每个值取「该日或之前最近一个真实值」；某条序列第一个点之前为 null。
   */
  function alignSeries(list, from, to) {
    const items = Array.isArray(list) ? list : [];
    const bounds = boundsOf(from, to);

    const dateSet = new Set();
    const prepared = items.map((item) => {
      // 接受 {points} 或 {series:{points}} 两种形状：视图从 History.series() 拿到的是后者。
      const raw = item && Array.isArray(item.points) ? item.points : (item && item.series && item.series.points);
      const points = cleanPoints(raw);
      if (bounds.empty) return { item, points, inRange: [] };
      const inRange = points.filter((p) => {
        if (bounds.from && p.t < bounds.from) return false;
        if (bounds.to && p.t > bounds.to) return false;
        return true;
      });
      inRange.forEach((p) => dateSet.add(p.t));
      return { item, points, inRange };
    });

    const dates = Array.from(dateSet).sort();
    const rows = prepared.map(({ item, points, inRange }, i) => {
      const rawKey = item && (item.key !== undefined ? item.key : item.id);
      const key = rawKey !== undefined && rawKey !== null ? String(rawKey) : String(i);
      /* 序列起点之前为 null（要求如此）；序列终点之后也为 null——
         退市/断更的序列如果一路平着延到最后一天，图上会凭空多出一段假历史。
         区间开始前已有的真实值仍然参与 step-hold：那是「当日或之前最近值」，
         不是插值，也不是编造。 */
      const firstT = points.length ? points[0].t : null;
      const lastT = points.length ? points[points.length - 1].t : null;
      return {
        key,
        name: item && item.name ? String(item.name) : key,
        unit: item && item.unit ? String(item.unit) : '',
        digits: item && isNum(item.digits) ? item.digits : 2,
        values: dates.map((d) => {
          if (!firstT || d < firstT || d > lastT) return null;
          return valueAtOrBefore(points, d);
        }),
      };
    });

    return { dates, rows };
  }

  /**
   * 归一化：首个非空值 = base（默认 100），空值保持 null。
   * 首值为 0 或全为空时返回全 null —— 不能拿 0 做除数造出 Infinity。
   */
  function normalize(values, base) {
    if (!Array.isArray(values)) return [];
    const b = isNum(base) && base !== 0 ? base : 100;
    let first = null;
    for (const v of values) {
      if (isNum(v)) { first = v; break; }
    }
    if (first === null || first === 0) return values.map(() => null);
    return values.map((v) => (isNum(v) ? (v / first) * b : null));
  }

  /**
   * 皮尔逊相关。
   * 默认用月度简单收益率（相邻两期 v[i]/v[i-1]-1）；opts.diff=true 时用
   * 百分点差（收益率序列用这个口径）。样本少于 6 个收益、或任一序列方差为 0，
   * 返回 null —— 不硬凑一个数。opts.diffA / opts.diffB 可分别指定两边的口径。
   */
  function correlation(a, b, opts) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const o = opts || {};
    // 价格类与收益率类混着比较时，两边必须各用各的口径（一个按收益率，一个按百分点差）。
    const diffA = o.diffA !== undefined ? !!o.diffA : !!o.diff;
    const diffB = o.diffB !== undefined ? !!o.diffB : !!o.diff;
    const n = Math.min(a.length, b.length);
    const xs = [];
    const ys = [];
    for (let i = 1; i < n; i++) {
      const a0 = valueOf(a[i - 1]);
      const a1 = valueOf(a[i]);
      const b0 = valueOf(b[i - 1]);
      const b1 = valueOf(b[i]);
      if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
      let x;
      let y;
      if (diffA) {
        x = a1 - a0;
      } else {
        if (!a0) continue;
        x = a1 / a0 - 1;
      }
      if (diffB) {
        y = b1 - b0;
      } else {
        if (!b0) continue;
        y = b1 / b0 - 1;
      }
      if (isFinite(x) && isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    }
    if (xs.length < 6) return null;

    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] - mx;
      const y = ys[i] - my;
      num += x * y;
      dx += x * x;
      dy += y * y;
    }
    if (!(dx > 0 && dy > 0)) return null;
    const r = num / Math.sqrt(dx * dy);
    if (!isFinite(r)) return null;
    // 浮点误差可能给出 1.0000000000000002；夹回合法区间。
    return Math.max(-1, Math.min(1, r));
  }

  window.Engine = window.Engine || {};
  window.Engine.compare = {
    seriesStats,
    rateStats,
    alignSeries,
    slicePoints,
    normalize,
    correlation,
    validMonth,
    monthShift,
    monthEnd,
    monthStart,
    boundsOf,
  };
})();
