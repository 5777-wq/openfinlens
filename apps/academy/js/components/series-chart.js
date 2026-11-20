/* components/series-chart.js —— 纯 SVG 序列图（折线 / 回撤）
   为什么自己画：本站零构建、零运行时新库，图表只需要一条线、几条刻度、
   一个峰值圈和一段回撤，没必要为它引入整套图形库。

   两条硬约束：
   1. 完全纯函数：render() 只收数据、返回 HTML 字符串，不碰 document，
      不查全局 DOM，node 里可以直接测。
   2. 数字口径不另起一套：最大回撤、逐点回撤全部走 engine/drawdown.js；
      横轴是真实日期，不是「第几个点」等距假年。
   SVG 本体 aria-hidden="true"，读屏拿的是外层容器的 role="img" + aria-label，
   句子由 SeriesChart.describe(series) 生成，保证图和文字说的是同一件事。 */
(function () {
  'use strict';

  const COLORS = ['var(--teal)', 'var(--gold)', 'var(--up)', 'var(--down)'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function cleanPoints(points) {
    if (!Array.isArray(points)) return [];
    const out = [];
    points.forEach((p, i) => {
      if (!p || p.t === null || p.t === undefined) return;
      const v = Number(p.v);
      if (!isFinite(v)) return;
      out.push({ t: String(p.t), v: v, _i: i });
    });
    out.sort((a, b) => String(a.t).localeCompare(String(b.t)) || a._i - b._i);
    return out.map((p) => ({ t: p.t, v: p.v }));
  }

  function digitsOf(series) {
    const d = series && series.digits !== undefined ? Number(series.digits) : 2;
    return isFinite(d) && d >= 0 && d <= 8 ? Math.round(d) : 2;
  }

  function num(v, digits) {
    if (!isNum(v)) return '--';
    const d = digits === undefined ? 2 : digits;
    return Number(v).toLocaleString('zh-CN', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function withUnit(v, digits, unit) {
    const s = num(v, digits);
    const u = String(unit || '');
    if (!u) return s;
    return u === '%' ? s + '%' : s + ' ' + u;
  }

  function yearOf(t) {
    const m = /^(\d{4})/.exec(String(t || ''));
    return m ? Number(m[1]) : null;
  }

  function parseTime(t) {
    const s = String(t || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return NaN;
    return Date.parse(s.slice(0, 10) + 'T00:00:00Z');
  }

  function clampInt(v, lo, hi, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function cssNum(n) { return isFinite(n) ? Number(n).toFixed(2) : '0.00'; }

  function shortName(s) {
    const chars = Array.from(String(s || ''));
    return chars.length > 18 ? chars.slice(0, 17).join('') + '…' : chars.join('');
  }

  function drawdownEngine() {
    return (window.Engine && window.Engine.drawdown) ? window.Engine.drawdown : null;
  }

  function statsOf(series) {
    const I = window.Engine && window.Engine.instrument;
    if (!I || !I.stats) return null;
    try { return I.stats(series); } catch (e) { return null; }
  }

  function extremePoints(points) {
    let peak = points[0], trough = points[0];
    for (const p of points) {
      if (p.v > peak.v) peak = p;
      if (p.v < trough.v) trough = p;
    }
    return { peak: peak, trough: trough };
  }

  /* 收益率序列（unit=%）用「百分点」讲回落，但运行峰值的先后顺序仍然由
     drawdown.drawdownSeries 给出：每一个点的「此前最高值」都从那套标准实现来，
     这里只把单位从「相对峰值的百分比」换算成「当前值 − 此前峰值」的百分点。 */
  function rateDrawdown(pts, ddPct) {
    let worst = 0, worstIdx = -1, worstPeak = null;
    for (let i = 0; i < pts.length; i++) {
      const d = ddPct[i] && ddPct[i].v;
      if (!isNum(d)) continue;
      const denom = 1 + d / 100;
      if (!(denom > 0)) continue;
      const peak = pts[i].v / denom;
      const pp = pts[i].v - peak;
      if (pp < worst) { worst = pp; worstIdx = i; worstPeak = peak; }
    }
    if (worstIdx < 0 || worstPeak === null) return null;
    let peakIdx = -1;
    for (let j = worstIdx; j >= 0; j--) {
      if (Math.abs(pts[j].v - worstPeak) < 1e-9) { peakIdx = j; break; }
    }
    if (peakIdx < 0) return null;
    return { pp: worst, peak: pts[peakIdx], trough: pts[worstIdx], from: pts[peakIdx].t, to: pts[worstIdx].t };
  }

  /** 一句人话，给容器 aria-label 和页面标题用。 */
  function describe(series) {
    if (!series) return '这条序列暂时没有数据。';
    const pts = cleanPoints(series.points);
    const name = String(series.name || '这条序列');
    if (pts.length < 2) return name + '的数据点不足，暂时画不出走势。';
    const digits = digitsOf(series);
    const unit = series.unit ? String(series.unit) : '';
    const ext = extremePoints(pts);
    const st = statsOf(series);
    const peak = (st && st.peak) || ext.peak;
    const trough = (st && st.trough) || ext.trough;
    const y1 = yearOf(pts[0].t);
    const y2 = yearOf(pts[pts.length - 1].t);
    const span = (y1 !== null && y2 !== null) ? '从 ' + y1 + ' 年到 ' + y2 + ' 年，' : '';

    const D = drawdownEngine();
    const md = D && D.maxDrawdown ? D.maxDrawdown(pts) : null;
    let ddText = '最深回撤 0.0%';
    if (unit === '%') {
      let deep = null;
      if (D && D.drawdownSeries && md && md.signed < 0) {
        deep = rateDrawdown(pts, D.drawdownSeries(pts));
      }
      ddText = deep
        ? '最深回撤 -' + num(Math.abs(deep.pp), 2) + ' 个百分点（' + deep.from + ' → ' + deep.to + '）'
        : '最深回撤 0.00 个百分点';
    } else if (md && md.signed < 0) {
      ddText = '最深回撤 ' + md.signed.toFixed(1) + '%（' + md.from + ' → ' + md.to + '）';
    }

    return span + '最高 ' + withUnit(peak.v, digits, unit) +
      '，最低 ' + withUnit(trough.v, digits, unit) + '，' + ddText + '。';
  }

  function xScaleOf(points, left, plotW) {
    const times = points.map((p) => parseTime(p.t));
    const timed = times.every((x) => isFinite(x));
    if (timed && times.length > 1 && times[times.length - 1] > times[0]) {
      const t0 = times[0], t1 = times[times.length - 1];
      return { timed: true, x: (i) => left + ((times[i] - t0) / (t1 - t0)) * plotW };
    }
    return { timed: false, x: (i) => left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW) };
  }

  /** 横轴：长区间按年份等距取 3–6 个刻度；太短的区间退回按月标。 */
  function xTicksOf(points, want, xs) {
    const y1 = yearOf(points[0].t);
    const y2 = yearOf(points[points.length - 1].t);
    if ((y1 === null || y2 === null) || (y2 - y1) < 2) {
      const ids = points.length <= 3 ? points.map((p, i) => i)
        : [0, Math.floor((points.length - 1) / 2), points.length - 1];
      return ids.map((i) => {
        const t = String(points[i].t);
        return { x: xs.x(i), label: t.length >= 7 ? t.slice(0, 7) : t };
      });
    }
    const n = clampInt(want, 3, 6, 5);
    const years = [];
    for (let i = 0; i < n; i++) {
      const y = Math.round(y1 + ((y2 - y1) * i) / (n - 1));
      if (years.indexOf(y) < 0) years.push(y);
    }
    return years.map((y) => {
      const target = Date.UTC(y, 6, 1);
      let best = 0, bestDiff = Infinity;
      for (let i = 0; i < points.length; i++) {
        const tm = parseTime(points[i].t);
        if (!isFinite(tm)) continue;
        const diff = Math.abs(tm - target);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      return { x: xs.x(best), label: String(y) };
    });
  }

  function gridAndAxes(axisPoints, xs, yTicks, left, right, top, plotH, fmtY) {
    let html = '';
    // 横向网格：4–5 条，全部用淡界线
    yTicks.forEach((t) => {
      html += '<line x1="' + cssNum(left) + '" y1="' + cssNum(t.y) +
        '" x2="' + cssNum(right) + '" y2="' + cssNum(t.y) +
        '" stroke="var(--rule-2)" stroke-width="1" vector-effect="non-scaling-stroke" aria-hidden="true"/>';
      html += '<text x="' + cssNum(left - 8) + '" y="' + cssNum(t.y + 3.5) +
        '" text-anchor="end" font-size="10" fill="var(--ink-3)" aria-hidden="true">' +
        esc(fmtY(t.v)) + '</text>';
    });
    // 纵向网格：年份刻度
    xTicksOf(axisPoints, 5, xs).forEach((tick) => {
      html += '<line x1="' + cssNum(tick.x) + '" y1="' + cssNum(top) +
        '" x2="' + cssNum(tick.x) + '" y2="' + cssNum(top + plotH) +
        '" stroke="var(--rule-2)" stroke-width="1" vector-effect="non-scaling-stroke" aria-hidden="true"/>';
      html += '<text x="' + cssNum(tick.x) + '" y="' + cssNum(top + plotH + 20) +
        '" text-anchor="middle" font-size="10" fill="var(--ink-3)" aria-hidden="true">' +
        esc(tick.label) + '</text>';
    });
    return html;
  }

  function lineScale(values, top, plotH) {
    let min = Infinity, max = -Infinity;
    values.forEach((v) => { if (v < min) min = v; if (v > max) max = v; });
    if (!isFinite(min) || !isFinite(max)) return null;
    const useLog = min > 0;
    if (min === max) {
      if (useLog) { min = min * 0.92; max = max * 1.08; }
      else { min -= 1; max += 1; }
    }
    let lo, hi;
    if (useLog) {
      const lmin = Math.log(min), lmax = Math.log(max);
      const pad = (lmax - lmin) * 0.08;
      lo = lmin - pad; hi = lmax + pad;
    } else {
      const pad = (max - min) * 0.08;
      lo = min - pad; hi = max + pad;
    }
    const y = useLog
      ? (v) => top + (1 - (Math.log(v) - lo) / (hi - lo)) * plotH
      : (v) => top + (1 - (v - lo) / (hi - lo)) * plotH;
    const ticks = [];
    for (let i = 0; i < 5; i++) {
      const f = i / 4;
      const v = useLog ? Math.exp(lo + (hi - lo) * f) : lo + (hi - lo) * f;
      ticks.push({ v: v, y: y(v) });
    }
    return { y: y, ticks: ticks, useLog: useLog };
  }

  function normalizeCompare(mainName, mainPts, compareArr) {
    const raw = (Array.isArray(compareArr) ? compareArr : [])
      .filter((s) => s && Array.isArray(s.points) && cleanPoints(s.points).length >= 2);
    if (!raw.length) return null;
    const list = [{ name: mainName, pts: mainPts }].concat(raw.map((s) => ({
      name: String(s.name || '参照序列'),
      pts: cleanPoints(s.points),
    })));
    const maps = list.map((s) => {
      const m = new Map();
      s.pts.forEach((p) => { if (p.t.length >= 7) m.set(p.t.slice(0, 7), p); });
      return m;
    });
    if (maps.some((m) => !m.size)) return null;
    const common = [];
    maps[0].forEach((v, k) => { if (maps.every((m) => m.has(k))) common.push(k); });
    common.sort();
    if (common.length < 2) return null;
    const out = list.map((s, i) => {
      const base = maps[i].get(common[0]).v;
      if (!(base > 0)) return null;
      return {
        name: s.name,
        color: COLORS[i % COLORS.length],
        points: common.map((k) => {
          const p = maps[i].get(k);
          return { t: p.t, v: (p.v / base) * 100 };
        }),
      };
    });
    return out.some((x) => !x) ? null : out;
  }

  function drawLine(series, pts, o, opt) {
    const w = opt.w, h = opt.h, left = 62, right = w - 18;
    const compare = normalizeCompare(String(series.name || '本标的'), pts, o.compare);
    const datasets = compare || [{ name: String(series.name || '本标的'), color: COLORS[0], points: pts }];
    const top = compare ? 40 : 24;
    const plotH = Math.max(40, h - top - 34);
    const plotW = Math.max(40, right - left);
    const xs = xScaleOf(datasets[0].points, left, plotW);
    const allVals = [];
    datasets.forEach((d) => d.points.forEach((p) => allVals.push(p.v)));
    const yScale = lineScale(allVals, top, plotH);
    if (!yScale) return '';

    const digits = digitsOf(series);
    const fmtY = (v) => num(v, Math.abs(v) >= 1000 ? 0 : Math.min(2, digits + 1));
    let html = gridAndAxes(datasets[0].points, xs, yScale.ticks, left, right, top, plotH, fmtY);

    // 数据集折线：主序列用青色，参照序列依次用金 / 涨色 / 跌色
    datasets.forEach((d) => {
      let path = '';
      d.points.forEach((p, i) => {
        path += (path ? 'L' : 'M') + cssNum(xs.x(i)) + ' ' + cssNum(yScale.y(p.v));
      });
      if (!path) return;
      html += '<path class="sc-line" d="' + path + '" fill="none" stroke="' + d.color +
        '" stroke-width="' + (d === datasets[0] ? '2' : '1.6') +
        '" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" aria-hidden="true"/>';
    });

    // 峰值金圈：折线模式的「区间最高点」，主序列只有一枚
    const main = datasets[0];
    let peakIdx = 0;
    main.points.forEach((p, i) => { if (p.v > main.points[peakIdx].v) peakIdx = i; });
    html += '<circle class="sc-peak" cx="' + cssNum(xs.x(peakIdx)) + '" cy="' +
      cssNum(yScale.y(main.points[peakIdx].v)) + '" r="4.5" fill="var(--sheet)" stroke="var(--gold)" stroke-width="2.2" aria-hidden="true"/>';

    // 最近一点：实心点；每个数据集各一枚，颜色跟线走
    if (opt.highlightLast) {
      datasets.forEach((d) => {
        const last = d.points[d.points.length - 1];
        html += '<circle class="sc-last" cx="' + cssNum(xs.x(d.points.length - 1)) + '" cy="' +
          cssNum(yScale.y(last.v)) + '" r="3.2" fill="' + d.color + '" aria-hidden="true"/>';
      });
    }

    // 顶部标识：单序列写名称；对比模式写图例（归一化到 100）
    if (!compare) {
      html += '<text x="' + cssNum(left) + '" y="15" font-size="11" fill="var(--ink-2)" aria-hidden="true">' +
        esc(shortName(series.name || '月线走势')) + '</text>';
    } else {
      let lx = left;
      datasets.forEach((d) => {
        html += '<line x1="' + cssNum(lx) + '" y1="12" x2="' + cssNum(lx + 14) + '" y2="12" stroke="' +
          d.color + '" stroke-width="2.2" vector-effect="non-scaling-stroke" aria-hidden="true"/>';
        html += '<text x="' + cssNum(lx + 19) + '" y="16" font-size="10.5" fill="var(--ink-2)" aria-hidden="true">' +
          esc(shortName(d.name)) + '</text>';
        lx += 19 + Math.max(40, shortName(d.name).length * 12) + 18;
      });
      html += '<text x="' + cssNum(right) + '" y="16" text-anchor="end" font-size="10" fill="var(--ink-3)" aria-hidden="true">起点 = 100</text>';
    }

    // 峰值注记（读屏拿的是外层 aria-label，这句只是给看得见的人）
    const peakPoint = main.points[peakIdx];
    html += '<text x="' + cssNum(Math.min(right - 4, xs.x(peakIdx) + 6)) + '" y="' +
      cssNum(Math.max(top + 10, yScale.y(peakPoint.v) - 7)) + '" text-anchor="end" font-size="10" fill="var(--gold-text)" aria-hidden="true">峰值 ' +
      esc(compare ? num(peakPoint.v, 1) : withUnit(peakPoint.v, digits, series.unit)) + '</text>';

    return '<svg class="series-chart series-chart-line" viewBox="0 0 ' + w + ' ' + h +
      '" width="' + w + '" height="' + h + '" style="display:block;width:100%;height:auto;font-family:var(--font-mono)" aria-hidden="true" focusable="false">' +
      html + '</svg>';
  }

  function drawDrawdown(series, pts, opt) {
    const D = drawdownEngine();
    if (!D || !D.drawdownSeries || !D.maxDrawdown) return '';
    const w = opt.w, h = opt.h, left = 62, right = w - 18, top = 24;
    const plotH = Math.max(40, h - top - 34);
    const plotW = Math.max(40, right - left);
    const xs = xScaleOf(pts, left, plotW);
    const per = D.drawdownSeries(pts);
    const isRate = String(series.unit || '') === '%';

    // 逐点回落：价格序列用百分比；收益率序列用百分点（先后顺序完全相同）
    const draw = [];
    for (let i = 0; i < pts.length; i++) {
      const pct = per[i] && per[i].v;
      if (!isNum(pct)) continue;
      const denom = 1 + pct / 100;
      if (!(denom > 0)) continue;
      const v = isRate ? pts[i].v - pts[i].v / denom : pct;
      draw.push({ t: pts[i].t, v: v, i: i });
    }
    if (draw.length < 2) return '';

    let minV = 0;
    draw.forEach((p) => { if (p.v < minV) minV = p.v; });
    if (minV === 0) minV = -1;
    const y = (v) => top + (v / minV) * plotH;

    // 最深那一段：价格序列直接用 Engine.drawdown.maxDrawdown；
    // 收益率序列用同一套运行峰值换算出的「百分点回落」。
    const md = D.maxDrawdown(pts);
    let deep = null;
    if (isRate) {
      if (md && md.signed < 0) deep = rateDrawdown(pts, per);
    } else if (md && md.signed < 0) {
      deep = { signed: md.signed, from: md.from, to: md.to, peak: md.peak, trough: md.trough };
    }

    const ticks = [];
    for (let i = 0; i < 4; i++) {
      const v = (minV * i) / 3;
      ticks.push({ v: v, y: y(v) });
    }
    const fmtY = (v) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(1));
    let html = gridAndAxes(pts, xs, ticks, left, right, top, plotH, fmtY);

    // 零线在上：回撤的最大值永远是 0（创新高时）
    html += '<line class="sc-dd-zero" x1="' + cssNum(left) + '" y1="' + cssNum(top) +
      '" x2="' + cssNum(right) + '" y2="' + cssNum(top) +
      '" stroke="var(--rule)" stroke-width="1" vector-effect="non-scaling-stroke" aria-hidden="true"/>';

    // 面积从零线向下铺，面积越大 = 离前高越远
    let area = 'M' + cssNum(xs.x(draw[0].i)) + ' ' + cssNum(top);
    draw.forEach((p) => { area += 'L' + cssNum(xs.x(p.i)) + ' ' + cssNum(y(p.v)); });
    area += 'L' + cssNum(xs.x(draw[draw.length - 1].i)) + ' ' + cssNum(top) + 'Z';
    html += '<path class="sc-dd-area" d="' + area + '" fill="var(--fill-down)" stroke="none" aria-hidden="true"/>';

    let line = '';
    draw.forEach((p) => { line += (line ? 'L' : 'M') + cssNum(xs.x(p.i)) + ' ' + cssNum(y(p.v)); });
    html += '<path class="sc-dd-line" d="' + line + '" fill="none" stroke="var(--down)" stroke-width="1.8" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" aria-hidden="true"/>';

    // 最深一段：峰值到谷底的一条金色覆盖线 + 谷底金圈 + 日期与幅度
    if (deep) {
      const fi = pts.findIndex((p) => p.t === deep.from);
      const ti = pts.findIndex((p) => p.t === deep.to);
      if (fi >= 0 && ti >= 0 && ti >= fi) {
        let seg = '';
        for (let i = fi; i <= ti; i++) {
          const pct = per[i] && per[i].v;
          if (!isNum(pct)) continue;
          const denom = 1 + pct / 100;
          if (!(denom > 0)) continue;
          const v = isRate ? pts[i].v - pts[i].v / denom : pct;
          seg += (seg ? 'L' : 'M') + cssNum(xs.x(i)) + ' ' + cssNum(y(v));
        }
        if (seg) {
          html += '<path class="sc-dd-deep" d="' + seg + '" fill="none" stroke="var(--gold)" stroke-width="2.6" ' +
            'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" aria-hidden="true"/>';
        }
        const troughV = isRate ? (deep.trough.v - deep.peak.v) : deep.signed;
        const tx = xs.x(ti), ty = y(troughV);
        html += '<circle class="sc-dd-trough" cx="' + cssNum(tx) + '" cy="' + cssNum(ty) +
          '" r="4.2" fill="var(--sheet)" stroke="var(--gold)" stroke-width="2.2" aria-hidden="true"/>';
        const label = isRate
          ? '最深回撤 -' + num(Math.abs(troughV), 2) + ' 个百分点 · ' + deep.from + ' → ' + deep.to
          : '最深回撤 ' + deep.signed.toFixed(1) + '% · ' + deep.from + ' → ' + deep.to;
        const lx = Math.max(left + 90, Math.min(right - 90, tx));
        const ly = ty > top + plotH * 0.55 ? ty - 9 : ty + 16;
        html += '<text x="' + cssNum(lx) + '" y="' + cssNum(ly) +
          '" text-anchor="middle" font-size="10" fill="var(--gold-text)" stroke="var(--sheet)" stroke-width="4" paint-order="stroke" aria-hidden="true">' +
          esc(label) + '</text>';
      }
    } else {
      html += '<text x="' + cssNum(left) + '" y="' + cssNum(top + 18) +
        '" font-size="10" fill="var(--ink-3)" aria-hidden="true">区间内没有从高点回落的记录</text>';
    }

    // 最近一点实心点：仍然跟着图走
    if (opt.highlightLast) {
      const last = draw[draw.length - 1];
      html += '<circle class="sc-dd-last" cx="' + cssNum(xs.x(last.i)) + '" cy="' + cssNum(y(last.v)) +
        '" r="3.2" fill="var(--down)" aria-hidden="true"/>';
    }

    const unitTitle = isRate ? '个百分点' : '%';
    html += '<text x="' + cssNum(left) + '" y="15" font-size="11" fill="var(--ink-2)" aria-hidden="true">' +
      esc(shortName(series.name || '回撤')) + ' · 回撤（' + unitTitle + '）</text>';

    return '<svg class="series-chart series-chart-drawdown" viewBox="0 0 ' + w + ' ' + h +
      '" width="' + w + '" height="' + h + '" style="display:block;width:100%;height:auto;font-family:var(--font-mono)" aria-hidden="true" focusable="false">' +
      html + '</svg>';
  }

  /**
   * 序列图 → HTML 字符串。
   * @param {{points:Array, name?:string, unit?:string, digits?:number}} series
   * @param {{width?:number, height?:number, mode?:string, years?:number,
   *          highlightLast?:boolean, compare?:Array}} [opts]
   */
  function render(series, opts) {
    if (!series || !Array.isArray(series.points)) return '';
    const pts = cleanPoints(series.points);
    if (pts.length < 2) return '';
    const o = opts || {};
    const w0 = Number(o.width), h0 = Number(o.height);
    const w = isFinite(w0) && w0 >= 240 ? Math.round(w0) : 1000;
    const h = isFinite(h0) && h0 >= 120 ? Math.round(h0) : 260;
    const mode = o.mode === 'drawdown' ? 'drawdown' : 'line';
    const opt = {
      w: w, h: h,
      years: clampInt(o.years, 3, 6, 5),
      highlightLast: o.highlightLast !== false,
    };
    try {
      return mode === 'drawdown' ? drawDrawdown(series, pts, opt) : drawLine(series, pts, o, opt);
    } catch (e) {
      return '';
    }
  }

  window.SeriesChart = { render: render, describe: describe };
})();
