/* pmcharts.js —— 市场预测板块的图形层（环图 + 概率走势）
 *
 * 为什么单独一层（与 js/spark.js 同款约定）：
 *   环图的扇区角度、走势线的坐标都是"把数字变成几何"，算错了界面上不会报错，
 *   只会画歪（扇区加起来不是一整圈、走势线跑到轨道外）。
 *   所以坐标计算是**纯函数**，单测直接断言坐标数值；渲染只负责按坐标描。
 *
 * 两张图各有硬约束，不容妥协：
 *   · 环图（donut）：只有互斥事件（Polymarket negRisk）才画。扇区角度按
 *     "显示总质量"归一化，图例里写的是**真实报价**——两件事分开，读者
 *     看到的数字永远是真的，环图只是"占比形状"。
 *   · 走势（trend）：纵轴不固定 0~1，而是贴着数据范围走，但留一条最小跨度
 *     （MIN_SPAN），免得 0.5 个百分点的波动被拉成"暴涨"。轴上标出真实高低点，
 *     拉伸多少读者一眼能看出来。缺测点断开，不跨空洞连线。
 */

const PMCharts = (() => {

  /* 扇区配色：刻意避开 --up/--down 的红绿（涨跌语义色不能被吃掉），
     8 色中等明度，深浅底都可读。 */
  const PALETTE = ['#4c8dff', '#f0a63a', '#a06ce8', '#2fb8a6', '#e0699f', '#9fb03c', '#8a93a6', '#c9834a'];
  const REST_COLOR = '#555b6b';      // "其他"扇区：哑光灰，明确是聚合项
  const MIN_SPAN = 0.04;             // 走势纵轴最小跨度（4 个百分点）
  const SLICE_MIN = 0.0005;         // 小于 0.05% 的扇区不再细分（几何上不可见）

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- 环图 ---------- */

  /* 事件档位 → 扇区列表（纯函数）。
     outcomes: [{ id, label, probability, ... }]；rest: { probability, count }。
     返回每个扇区的 share（占"显示总质量"的比例）与其起止角比例 a0/a1。
     总质量为 0 → 返回空数组（不画）。 */
  function donutSlices(outcomes, rest, restLabel) {
    const items = [];
    (Array.isArray(outcomes) ? outcomes : []).forEach((o, i) => {
      if (!o || !isNum(o.probability) || o.probability <= 0) return;
      items.push({
        key: o.id || ('o' + i),
        label: o.label || '',
        value: o.probability,
        color: PALETTE[i % PALETTE.length],
        rest: false,
      });
    });
    const r = rest && Number(rest.count) > 0 && isNum(rest.probability) && rest.probability > 0
      ? { key: '__rest__', label: restLabel || '其他', value: rest.probability, color: REST_COLOR, rest: true }
      : null;
    if (r) items.push(r);
    const total = items.reduce((s, x) => s + x.value, 0);
    if (!(total > 0)) return [];
    let acc = 0;
    return items.map(x => {
      const share = x.value / total;
      const a0 = acc;
      acc += share;
      return { ...x, share, a0, a1: acc, total };
    });
  }

  /* 极坐标 → 直角（角度从 12 点方向顺时针） */
  function polar(cx, cy, r, turn) {
    const a = turn - Math.PI / 2;
    return { x: +(cx + r * Math.cos(a)).toFixed(2), y: +(cy + r * Math.sin(a)).toFixed(2) };
  }

  /* 圆环扇形路径（纯几何）。整圈（share≥1）单独走环形路径，
     否则首尾同点会退化成一条直线。 */
  function arcPath(cx, cy, rOut, rIn, a0, a1) {
    if (a1 - a0 >= 0.9999) {
      // 整圈：外圆 + 反向内圆
      return `M${cx - rOut} ${cy}a${rOut} ${rOut} 0 1 0 ${rOut * 2} 0a${rOut} ${rOut} 0 1 0 ${-rOut * 2} 0Z`
        + `M${cx - rIn} ${cy}a${rIn} ${rIn} 0 1 1 ${rIn * 2} 0a${rIn} ${rIn} 0 1 1 ${-rIn * 2} 0Z`
        + `M${cx - rOut} ${cy}a${rOut} ${rOut} 0 1 1 ${rOut * 2} 0a${rOut} ${rOut} 0 1 1 ${-rOut * 2} 0Z`;
    }
    const large = (a1 - a0) > 0.5 ? 1 : 0;
    const p0 = polar(cx, cy, rOut, a0 * Math.PI * 2);
    const p1 = polar(cx, cy, rOut, a1 * Math.PI * 2);
    const p2 = polar(cx, cy, rIn, a1 * Math.PI * 2);
    const p3 = polar(cx, cy, rIn, a0 * Math.PI * 2);
    return `M${p0.x} ${p0.y}A${rOut} ${rOut} 0 ${large} 1 ${p1.x} ${p1.y}`
      + `L${p2.x} ${p2.y}A${rIn} ${rIn} 0 ${large} 0 ${p3.x} ${p3.y}Z`;
  }

  /* 环图 SVG。opts: { size, thickness, centerTop, centerMain, centerSub } */
  function donutSVG(slices, opts) {
    const o = opts || {};
    const size = o.size || 128;
    const th = o.thickness || 18;
    const cx = size / 2, cy = size / 2;
    const rOut = size / 2 - 2, rIn = rOut - th;
    if (!Array.isArray(slices) || !slices.length) return '';
    const parts = slices.map(s => {
      const span = s.a1 - s.a0;
      if (span < SLICE_MIN) return '';         // 肉眼不可见的碎屑不画
      const d = arcPath(cx, cy, rOut, rIn, s.a0, s.a1);
      const pctTxt = (s.value * 100).toFixed(s.value >= 0.1 ? 1 : 2) + '%';
      return `<path class="pm-slice${s.rest ? ' pm-slice-rest' : ''}" d="${d}" fill="${s.color}"`
        + ` data-key="${esc(s.key)}"><title>${esc(s.label)} ${pctTxt}</title></path>`;
    }).join('');
    const center = (o.centerTop || o.centerMain || o.centerSub)
      ? `<g class="pm-donut-center">`
      + (o.centerTop ? `<text x="${cx}" y="${cy - 10}" class="pm-donut-ct">${esc(o.centerTop)}</text>` : '')
      + (o.centerMain ? `<text x="${cx}" y="${cy + 8}" class="pm-donut-cm num">${esc(o.centerMain)}</text>` : '')
      + (o.centerSub ? `<text x="${cx}" y="${cy + 21}" class="pm-donut-cs">${esc(o.centerSub)}</text>` : '')
      + `</g>` : '';
    return `<svg class="pm-donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"`
      + ` role="img" aria-label="档位概率分布">${parts}${center}</svg>`;
  }

  /* ---------- 概率走势 ---------- */

  /* 纵轴域（纯函数）：贴着数据范围，但至少 MIN_SPAN 跨度，且不越出 [0,1]。 */
  function trendDomain(points) {
    let lo = Infinity, hi = -Infinity;
    (points || []).forEach(p => { if (p.p < lo) lo = p.p; if (p.p > hi) hi = p.p; });
    if (!isFinite(lo) || !isFinite(hi)) return null;
    let span = hi - lo;
    if (span < MIN_SPAN) {
      const mid = (hi + lo) / 2;
      lo = mid - MIN_SPAN / 2; hi = mid + MIN_SPAN / 2;
    }
    if (lo < 0) { hi += -lo; lo = 0; }
    if (hi > 1) { lo -= (hi - 1); hi = 1; }
    if (lo < 0) lo = 0;
    return { lo, hi };
  }

  /* 序列 → 画布坐标（纯函数）。时间间隔超过 maxGapMs 就断成新的一段——
     缺测的空档不连线，免得把两段不相干的数据粘成一条趋势。
     返回 { segments:[[{x,y,p,t}]], lo, hi, first, last }；点数不足返回 null。 */
  function trendPoints(series, w, h, pad, maxGapMs) {
    const pts = (Array.isArray(series) ? series : [])
      .filter(p => p && isNum(p.t) && isNum(p.p))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2 || !(w > 0) || !(h > pad * 2)) return null;
    const dom = trendDomain(pts);
    if (!dom) return null;
    const innerH = h - pad * 2;
    const span = dom.hi - dom.lo || 1;
    const xAt = (i) => +((i / (pts.length - 1)) * w).toFixed(2);
    const yAt = (p) => +(pad + innerH * (1 - (p - dom.lo) / span)).toFixed(2);
    const segments = [];
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = { x: xAt(i), y: yAt(pts[i].p), p: pts[i].p, t: pts[i].t };
      if (cur.length && maxGapMs && (pts[i].t - cur[cur.length - 1].t) > maxGapMs) {
        segments.push(cur); cur = [];
      }
      cur.push(pt);
    }
    if (cur.length) segments.push(cur);
    return {
      segments: segments.filter(s => s.length > 0),
      lo: dom.lo, hi: dom.hi,
      first: pts[0], last: pts[pts.length - 1],
    };
  }

  /* 走势 SVG。opts: { w, h, pad, maxGapMs, id } */
  function trendSVG(series, opts) {
    const o = opts || {};
    const w = o.w || 280, h = o.h || 54, pad = o.pad == null ? 4 : o.pad;
    const geo = trendPoints(series, w, h, pad, o.maxGapMs);
    if (!geo) return '';
    const paths = geo.segments.map(seg => {
      const d = seg.map((p, i) => (i ? 'L' + p.x + ' ' + p.y : 'M' + p.x + ' ' + p.y)).join('');
      const last = seg[seg.length - 1];
      const area = `${d}L${last.x} ${h}L${seg[0].x} ${h}Z`;
      return `<path class="pm-trend-area" d="${area}"/>`
        + `<path class="pm-trend-line" d="${d}"/>`;
    }).join('');
    const lastP = geo.segments[geo.segments.length - 1];
    const end = lastP[lastP.length - 1];
    return `<svg class="pm-trend" viewBox="0 0 ${w} ${h}" width="100%" height="${h}"`
      + ` preserveAspectRatio="none" role="img" aria-label="概率走势">${paths}`
      + `<circle class="pm-trend-dot" cx="${end.x}" cy="${end.y}" r="2.5"/></svg>`;
  }

  return { PALETTE, REST_COLOR, MIN_SPAN, donutSlices, polar, arcPath, donutSVG, trendDomain, trendPoints, trendSVG };
})();

if (typeof window !== 'undefined') window.PMCharts = PMCharts;
if (typeof module !== 'undefined' && module.exports) module.exports = PMCharts;
