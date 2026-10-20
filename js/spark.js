/* spark.js —— 首屏与自选卡的图形层（迷你走势线 + 当日振幅条）
 *
 * 为什么单独一层：这两样东西都要"把数字变成几何"，而几何算错在界面上不会报错、只会画歪
 * （走势线全平/振幅点跑到轨道外）。所以坐标计算是**纯函数**，单测直接断言坐标数值；
 * canvas 只负责按坐标描线，不参与计算。
 *
 * 约定：
 *   · sparkPoints 返回 0..w × 0..h 的坐标，y 轴向下（canvas 习惯），1=最高价对应最小 y；
 *   · rangePos 返回现价在当日 [low, high] 中的相对位置（0..1，且**夹紧**——停牌/数据异常时
 *     price 可能落在区间外，画到轨道外就是错误的视觉断言）；
 *   · 两者数据不足（<2 点 / high≤low / 含 null）一律返回 null，由调用方决定不画（不画 = 诚实）。
 *
 * ★ 对齐模式（alignedPoints / axisOf / alignedSeries）：
 *   并排的全球指数走势线如果各按自己的 min-max 缩放，会出两个问题：
 *     ① 每条线都填满画布高度 → 幅度全丢了，"谁涨得多"看不出来；
 *     ② x 轴是"第几根"而不是日期 → 不同市场的第 N 根本来就不是同一天
 *        （实测：上证末点 10-20、标普末点 10-19；两者交易日集合只重合 54/60 天），
 *        同屏并列看着像同一条时间轴，实际错开了好几天。
 *   所以多序列并排时改用：**共享日期轴**（按日期定位 x）+ **共享 y 标尺**
 *   （相对各自首日的涨跌幅 %，全体共用一套上下限）。这样同一个 x 就是同一天，
 *   纵��高度也可直接比较——"上证这 60 天跌了 3%、标普涨了 4%"一眼可读。
 *   单序列（自选卡）不受影响，继续用 sparkPoints 即可。 */

const Spark = (() => {
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* 现价在当日区间中的位置：0 = 最低，1 = 最高。
     数据异常（缺值 / high ≤ low / 停牌价超出区间）返回 null，绝不返回一个越界值。 */
  function rangePos(price, low, high) {
    if (!isNum(price) || !isNum(low) || !isNum(high)) return null;
    if (high <= low) return null;
    return Math.max(0, Math.min(1, (price - low) / (high - low)));
  }

  /* 收盘序列 → 画布坐标。pad 是上下留白（线宽的一半多一点，免得最高/最低点贴边被裁）。 */
  function sparkPoints(closes, w, h, pad = 2) {
    const vals = (Array.isArray(closes) ? closes : []).filter(isNum);
    if (vals.length < 2 || !(w > 0) || !(h > pad * 2)) return null;
    let min = vals[0], max = vals[0];
    for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
    const span = max - min;
    const innerH = h - pad * 2;
    return vals.map((v, i) => ({
      x: +((i / (vals.length - 1)) * w).toFixed(2),
      // 全平序列（span=0）画在中线：画成贴顶或贴底会误导成"涨到最高/跌到最低"
      y: +(span === 0 ? pad + innerH / 2 : pad + innerH * (1 - (v - min) / span)).toFixed(2),
    }));
  }

  /* 把走势线描到 canvas 上。colours 由调用方传入（主题令牌在 charts.js/app.js 里取，保持单一来源）。
     width 可调；fill 传空串则不画面积——迷你走势线用"线"不用"块"：
     面积填充在并排的卡片里会连成一片色块墙（2026-10-20 用户反馈"很突兀"）。 */
  function draw(canvas, closes, { color = '#86868b', fill = '', width = 1.5 } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = sparkPoints(closes, w, h);
    if (!pts) return false;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    if (fill) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineTo(pts[pts.length - 1].x, h);
      ctx.lineTo(pts[0].x, h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    return true;
  }

  /* 日内区间条：**左端=今日最低、右端=今日最高**，点上的是现价位置，两端标出数值。
     第一版只画了轨道 + 一个圆点，界面上没有任何说明——用户直接问"这个点是啥意思"
     （2026-09-16）。所以现在把两端数值和 title 都带上：图形自己说清自己，
     而不是指望用户猜到。落点仍是算出来的百分比（0.1% 精度，注入面为零）。 */
  function rangeBarHTML(pos, opts = {}) {
    if (!isNum(pos)) return '';
    const pct = (Math.max(0, Math.min(1, pos)) * 100).toFixed(1);
    const { low, high, digits = 2, label = '日内', color = '' } = opts;
    const fmtV = (v) => (isNum(v) ? v.toFixed(digits) : '');
    const hasEnds = isNum(low) && isNum(high);
    const title = hasEnds
      ? `${label}区间 ${fmtV(low)} ~ ${fmtV(high)} · 现价位于 ${pct}%`
      : `现价位于${label}区间的 ${pct}%`;
    const ends = hasEnds
      ? `<i class="rb-lo num">${fmtV(low)}</i><i class="rb-hi num">${fmtV(high)}</i>`
      : '';
    // 标记点用当日方向色（涨红跌绿），不用主题强调色：固定红点压在灰轨上，
    // 在 Swiss 这类红色强调的皮肤里看着像报错标记（2026-10-20 用户反馈"很突兀"）。
    const mark = color ? ` style="background:${color}"` : '';
    return `<span class="rbar" title="${title}" aria-label="${title}">${ends}` +
      `<span class="rb-track"><b style="left:${pct}%"${mark}></b></span></span>`;
  }

  /* 迷你走势图的容器（canvas 由调用方在插入 DOM 后 draw——canvas 必须先有尺寸才能画） */
  function sparkBoxHTML(key) {
    return `<canvas class="spark" data-spark="${escapeKey(key)}" aria-hidden="true"></canvas>`;
  }

  const escapeKey = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._:-]/g, '');

  /* 按坐标描线（对齐模式用）。
   * pts 是按 x 升序的坐标数组。
   *
   * 什么时候该断线？x 是按「日期在共享轴上的下标」定位的，所以某市场休市一天，
   * 它的点会跳过那个下标 → 相邻两点间距是 2 步而不是 1 步。
   * 这**不是**数据缺失，而是那天的真实情况（这天它没开盘），
   * 连起来是对的：时间上确实隔了一天。
   * 只有当缺口大到"中间可能有整段没交易"（如国庆长假）时才断线，
   * 避免把两个时点之间的空白期画成一条连续走势。
   *
   * axisLen 是共享日期轴的长度：x 按轴下标定位，所以"正常步长"
   * = 总宽 / (axisLen - 1)。用本序列自己的点数算会错——缺交易日的市场
   * 点数少，步长被算大，缺口就检测不出来。 */
  const MAX_GAP_STEPS = 4;   // 允许跨过 3 个休市日（一个长周末）；再多就断开
  function drawAligned(canvas, pts, { color = '#86868b', width = 1.8, axisLen = 0, zeroY = null, zeroColor = '' } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    if (!Array.isArray(pts) || pts.length < 2) return false;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 0% 基准线：共享标尺的中线。画出来读者才知道"线在中线附近"是横盘，
    // 而不是"涨了一点"或"跌了一点"。
    if (zeroY != null && isNum(zeroY) && zeroColor) {
      ctx.save();
      ctx.strokeStyle = zeroColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
      ctx.stroke();
      ctx.restore();
    }
    // 常规步长：优先用共享轴长度（正确口径）；拿不到就退回按点数估算
    const n = axisLen > 1 ? axisLen : pts.length;
    const step = w / Math.max(1, n - 1);
    const maxGap = step * MAX_GAP_STEPS;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let started = false;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!started) { ctx.moveTo(p.x, p.y); started = true; continue; }
      if (p.x - pts[i - 1].x > maxGap + 0.5) {   // 中间空了一整段 → 断线另起
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    return true;
  }

  /* ==================== 多序列对齐（全球指数并排） ==================== */

  /* 把若干条「日期 → 收盘价」的序列整理成对齐用的结构。
   * series: [{ key, rows: [{ time, close }] }]，time 是 'YYYY-MM-DD' 字符串。
   * 返回 { axis, series }：
   *   axis   —— 共享日期轴（升序去重后的全部日期）
   *   series —— 每条序列在 axis 上的取值与相对首日的涨跌幅 %，缺数据处为 null
   *
   * 为什么按日期而不是按序号：实测各市场的 60 根日线覆盖的日历区间并不相同
   * （上证 07-21 起、标普 07-27 起），交易日集合只重合 54 天，末点也差一天
   * （上证 10-20 / 标普 10-19）。按序号对齐等于把不同的日子画到同一个 x 上。 */
  function alignSeries(series) {
    const list = (Array.isArray(series) ? series : []).filter(s => s && Array.isArray(s.rows));
    const dates = new Set();
    for (const s of list) {
      for (const r of s.rows) {
        if (r && typeof r.time === 'string' && r.time && isNum(r.close)) dates.add(r.time);
      }
    }
    const axis = Array.from(dates).sort();
    const out = list.map(s => {
      const map = new Map();
      for (const r of (s && s.rows) || []) {
        if (r && typeof r.time === 'string' && r.time && isNum(r.close)) map.set(r.time, r.close);
      }
      // 相对**该序列自己的首个有效点**（而非 axis 的第一天）：某市场可能缺前几天，
      // 用 axis 起点会算出一个虚假的巨幅涨跌幅。
      const first = axis.find(d => map.has(d));
      const base = first != null ? map.get(first) : null;
      const values = axis.map(d => {
        const v = map.has(d) ? map.get(d) : null;
        if (v == null || !base) return null;
        return +(((v / base) - 1) * 100).toFixed(4);
      });
      return { key: s && s.key, values };
    });
    return { axis, series: out };
  }

  /* 共享 y 标尺：全体序列的涨跌幅极值合成一套上下限。
   * 上下限对称（±maxAbs），这样 0% 基线固定在正中，
   * 涨在上一半、跌在下一半，读起来像"相对首日的偏离"而不是"某条线的形状"。 */
  function alignedScale(aligned) {
    let maxAbs = 0;
    for (const s of (aligned && aligned.series) || []) {
      for (const v of s.values) {
        if (v == null || !isNum(v)) continue;
        const a = Math.abs(v);
        if (a > maxAbs) maxAbs = a;
      }
    }
    if (!(maxAbs > 0)) return { maxAbs: 0, min: -1, max: 1 };
    // 留 8% 余量，免得最高/最低点顶到画布边缘被裁
    const pad = maxAbs * 0.08;
    return { maxAbs, min: -(maxAbs + pad), max: maxAbs + pad };
  }

  /* 对齐模式的坐标计算。
   * rows: [{ time, close }]，axis: 共享日期轴，scale: alignedScale 的结果。
   * 返回 [{ x, y }]，缺数据的日子**不产出点**（调用方据此断线，
   * 而不是拿前后两天连一条直线——那是假的连续走势）。
   * 若该序列在 axis 上一个点都没有，返回 null（不画）。
   *
   * x 按**日期在 axis 上的下标**定位，不是按本序列自己的有效点数——
   * 后者会让缺交易日的市场"挤"到右边，与别的市场不在同一时间轴上。 */
  function alignedPoints(rows, axis, scale, w, h, pad = 2) {
    if (!Array.isArray(rows) || !Array.isArray(axis) || axis.length < 2) return null;
    if (!scale || !isNum(scale.min) || !isNum(scale.max) || !(w > 0) || !(h > pad * 2)) return null;
    const map = new Map();
    for (const r of rows) {
      if (r && typeof r.time === 'string' && r.time && isNum(r.close)) map.set(r.time, r.close);
    }
    if (!map.size) return null;
    const first = axis.find(d => map.has(d));
    if (first == null) return null;
    const base = map.get(first);
    if (!base) return null;
    const innerH = h - pad * 2;
    const span = scale.max - scale.min;
    const last = axis.length - 1;
    const pts = [];
    for (let i = 0; i <= last; i++) {
      const d = axis[i];
      if (!map.has(d)) continue;            // 该市场这天休市 → 断点，不连线
      const pct = ((map.get(d) / base) - 1) * 100;
      const x = +((i / last) * w).toFixed(2);
      const y = +(pad + innerH * (1 - (pct - scale.min) / span)).toFixed(2);
      pts.push({ x, y });
    }
    return pts.length >= 2 ? pts : null;
  }

  /* 对齐模式的 0% 基准线位置（y 坐标）。
   * 共享标尺关于 0 对称，所以 0% 恒在中线。没有这条基准线，
   * 读者看到四条线挤在中间，看不出"纳指涨 6%、恒指跌 5%"——
   * 只知道它们都在一条看不见的中线附近波动。 */
  function zeroLineY(scale, h, pad = 2) {
    if (!scale || !isNum(scale.min) || !isNum(scale.max)) return null;
    const span = scale.max - scale.min;
    if (!(span > 0)) return null;
    const innerH = h - pad * 2;
    return +(pad + innerH * (1 - (0 - scale.min) / span)).toFixed(2);
  }

  return {
    rangePos, sparkPoints, draw, drawAligned, rangeBarHTML, sparkBoxHTML,
    alignSeries, alignedScale, alignedPoints, zeroLineY,
  };
})();

window.Spark = Spark;
