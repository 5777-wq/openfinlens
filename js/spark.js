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
 */

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

  /* 把走势线描到 canvas 上。colours 由调用方传入（主题令牌在 charts.js/app.js 里取，保持单一来源）。 */
  function draw(canvas, closes, { color = '#86868b', fill = '' } = {}) {
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
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    if (fill) {
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
    const { low, high, digits = 2, label = '日内' } = opts;
    const fmtV = (v) => (isNum(v) ? v.toFixed(digits) : '');
    const hasEnds = isNum(low) && isNum(high);
    const title = hasEnds
      ? `${label}区间 ${fmtV(low)} ~ ${fmtV(high)} · 现价位于 ${pct}%`
      : `现价位于${label}区间的 ${pct}%`;
    const ends = hasEnds
      ? `<i class="rb-lo num">${fmtV(low)}</i><i class="rb-hi num">${fmtV(high)}</i>`
      : '';
    return `<span class="rbar" title="${title}" aria-label="${title}">${ends}` +
      `<span class="rb-track"><b style="left:${pct}%"></b></span></span>`;
  }

  /* 迷你走势图的容器（canvas 由调用方在插入 DOM 后 draw——canvas 必须先有尺寸才能画） */
  function sparkBoxHTML(key) {
    return `<canvas class="spark" data-spark="${escapeKey(key)}" aria-hidden="true"></canvas>`;
  }

  const escapeKey = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._:-]/g, '');

  return { rangePos, sparkPoints, draw, rangeBarHTML, sparkBoxHTML };
})();

window.Spark = Spark;
