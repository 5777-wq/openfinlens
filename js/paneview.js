/* js/paneview.js —— 副图指标窗（独立 canvas，自绘）——TradingView 的"副图"模型
 *
 * 为什么自己画，不用 lightweight-charts 的第二条 priceScale：
 *   vendor 是 lightweight-charts 4.2.3，**没有 addPane**（多窗格要 v5），
 *   而 4.x 的 priceScale 只能挂在 left/right 两侧 —— 副图刻度会和主图价格轴
 *   挤在同一边，读数互相干扰。实测把 RSI 挂在 'vol' 这条隐藏 scale 上时，
 *   lightweight-charts 会把 0~100 的值映射到**主价格轴**，于是 RSI 线直接画进了
 *   价格区（3400~4500），完全没有"独立指标窗"的意思。
 *   所以副图自己画：独立 canvas、独立纵轴刻度、横向与主图等宽对齐。
 *
 * 几何计算是纯函数（可单测），canvas 只负责描。
 *
 * 口径：纵轴按数据自适应，刻度取 3~5 条；缺测点断开不连直线（与页内其它图形一致）。 */

(function (global) {
  'use strict';

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* 纵轴域：按数据范围自适应，留 6% 余量，恒含 0（指标值都有 0 基准的意义）。
     返回 { min, max, ticks: [...] }；无数据 → null。 */
  function axis(values, opts) {
    const o = opts || {};
    const vals = (values || []).filter(isNum);
    if (!vals.length) return null;
    let lo = Math.min.apply(null, vals);
    let hi = Math.max.apply(null, vals);
    if (o.includeZero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad; hi += pad;
    // 刻度：等分 4 段（5 条线），取整到"好读"的步长
    const raw = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return { min: lo, max: hi, ticks };
  }

  /* 数据点 → 画布坐标。
     横坐标由 layout() 按时间序列统一分配（主图与副图必须共用同一套 x），
     这里只负责纵坐标。 */
  function points(pts, domain, w, h, pad) {
    if (!domain || !(w > 0) || !(h > 0)) return [];
    const span = domain.max - domain.min;
    if (!(span > 0)) return [];
    const innerH = h - pad * 2;
    const out = [];
    (pts || []).forEach(p => {
      if (!p || !isNum(p.value)) return;
      out.push({
        x: isNum(p.x) ? +p.x.toFixed(2) : 0,
        y: +(pad + innerH * (1 - (p.value - domain.min) / span)).toFixed(2),
        value: p.value,
        time: p.time,
      });
    });
    return out;
  }

  /* 把「时间 → 值」的序列摆到画布上：按 x 比例把时间映射到宽度。
     times: 全部时间点的有序数组（用来定 x）；series: [{ name, color, data:[{time,value}] }]。
     xMap: 可选，{ time -> x 像素 }。调用方（charts.js）会把它从**主图**的
           timeToCoordinate 取来 —— 按序号等分会让副图整体偏半个 bar 间距
           （主图 fitContent 后首尾 bar 各留半格），而且等分画不出
           「中间休市」的缺口，休市日会被连成一条假连续线。
           传了 xMap 就优先用它，取不到的那几个时间点才回退等分。
     返回 { lines: [{ name, color, pts }], bars: [...] } */
  function layout(series, times, domain, w, h, pad, xMap) {
    const t = (times || []).filter(x => x != null);
    if (!t.length) return { lines: [], bars: [] };
    const n = t.length;
    const xOf = new Map();
    t.forEach((tv, i) => {
      const x = (xMap && xMap.has(tv)) ? xMap.get(tv) : (i / (n - 1)) * w;
      xOf.set(tv, x);
    });
    const lines = [];
    const bars = [];
    (series || []).forEach(s => {
      if (!s) return;
      const arr = (s.data || []).filter(p => p && p.value != null && isNum(p.value));
      const pts = arr.map(p => {
        const x = xOf.get(p.time);
        if (x == null) return null;
        const y = +(pad + (h - pad * 2) * (1 - (p.value - domain.min) / (domain.max - domain.min))).toFixed(2);
        // up 要透传：成交量柱按**当天 K 线**的涨跌染色，
        // MACD 柱按正负染色 —— 两种柱子的颜色依据不一样，不能在绘制层猜。
        return { x: +x.toFixed(2), y, value: p.value, time: p.time, up: p.up };
      }).filter(Boolean);
      const item = { name: s.name, color: s.color, pts, kind: s.kind || 'line' };
      if (item.kind === 'bar') bars.push(item); else lines.push(item);
    });
    return { lines, bars };
  }

  /* 断线：相邻两点的 x 间距明显大于"正常步长"（中间缺了交易日）就不连。
     step 用整体步长（times 长度）估算，不用本序列点数。 */
  function segments(pts, step) {
    const segs = [];
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && step > 0 && pts[i].x - pts[i - 1].x > step * 1.6) {
        if (cur.length) segs.push(cur);
        cur = [];
      }
      cur.push(pts[i]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  /* 画副图。canvas/getContext 由调用方给（可测）。
     o.w = canvas 内部总宽；o.axisRight = 右侧刻度区宽度（绘图区 = w - axisRight）。
     两块（主图/副图）横向对齐靠调用方把 axisRight 设成主图价格轴宽度。 */
  function draw(canvas, model, opts) {
    const o = opts || {};
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const w = o.w || canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (!w || !h) return false;
    const dpr = Math.min((global.devicePixelRatio || 1), 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = o.pad == null ? 6 : o.pad;
    const axisR = o.axisRight == null ? 44 : o.axisRight;   // 右侧留给刻度
    const plotW = Math.max(10, w - axisR);
    const domain = o.domain;
    if (!domain) return false;

    // 网格 + 刻度
    ctx.font = '10px ' + (o.font || 'ui-monospace, monospace');
    ctx.textBaseline = 'middle';
    // 刻度文案可由调用方指定（成交量要显示「亿/万」而不是 1000000000）
    const fmtLabel = typeof o.fmtTick === 'function' ? o.fmtTick : fmtTick;
    for (const t of (domain.ticks || [])) {
      const y = +(pad + (h - pad * 2) * (1 - (t - domain.min) / (domain.max - domain.min))).toFixed(2);
      if (y < pad - 1 || y > h - pad + 1) continue;
      ctx.strokeStyle = o.gridColor || 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(plotW, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = o.textColor || '#8a8a92';
      // 右对齐到画布右缘：主图的价格刻度也是右对齐的，
      // 两边不贴同一条边，副图看上去就像"另画的一块"。
      ctx.textAlign = 'right';
      ctx.fillText(fmtLabel(t), w - 4, y);
    }
    // 零轴（MACD 的多空分界）
    if (domain.min < 0 && domain.max > 0) {
      const y0 = +(pad + (h - pad * 2) * (1 - (0 - domain.min) / (domain.max - domain.min))).toFixed(2);
      ctx.strokeStyle = o.zeroColor || 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y0 + 0.5);
      ctx.lineTo(plotW, y0 + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const step = o.step || 0;
    // 柱（成交量 / MACD 柱）
    for (const b of (model.bars || [])) {
      const bw = Math.max(1, Math.min(6, (plotW / Math.max(1, o.barCount || 60)) * 0.7));
      for (const p of b.pts) {
        const y0 = +(pad + (h - pad * 2) * (1 - (0 - domain.min) / (domain.max - domain.min))).toFixed(2);
        // 染色优先用调用方给的 up（成交量按当天 K 线涨跌、MACD 按正负），
        // 没给才退回"按值的正负"（MACD 的天然口径）
        const isUp = (p.up === undefined || p.up === null) ? p.value >= 0 : !!p.up;
        ctx.fillStyle = isUp ? (o.upColor || '#e05252') : (o.downColor || '#2ebd85');
        const top = Math.min(y0, p.y), hh = Math.max(1, Math.abs(p.y - y0));
        ctx.globalAlpha = 0.65;
        ctx.fillRect(p.x - bw / 2, top, bw, hh);
        ctx.globalAlpha = 1;
      }
    }
    // 线
    for (const l of (model.lines || [])) {
      ctx.strokeStyle = l.color || '#5b8def';
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const seg of segments(l.pts, step)) {
        if (seg.length < 2) {
          if (seg.length === 1) {   // 孤立点也标出来（不然那一条数据凭空消失）
            ctx.beginPath();
            ctx.arc(seg[0].x, seg[0].y, 1.4, 0, Math.PI * 2);
            ctx.fillStyle = l.color;
            ctx.fill();
          }
          continue;
        }
        ctx.beginPath();
        seg.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }
    return true;
  }

  // 刻度取整：0.5 / 1 / 2 / 5 这类"好读"的数
  function fmtTick(v) {
    if (!isNum(v)) return '--';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(a % 1 === 0 ? 0 : 1);
    if (a >= 1) return v.toFixed(a % 1 === 0 ? 0 : 1);
    return v.toFixed(2);
  }

  global.PaneView = { axis, points, layout, segments, draw, fmtTick };
})(typeof window !== 'undefined' ? window : globalThis);
