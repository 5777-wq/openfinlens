/* views/curve.js —— 收益率曲线实验室（#/curve）
   美债五档（3M/2Y/5Y/10Y/30Y）与中债四档（2Y/5Y/10Y/30Y）的月频曲线。
   拖动年份看曲线形态；利差历史只描述「倒挂发生过什么」，不预言下一次。
   所有数据来自 data/history/*.json，不联网。
*/
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CSS_ID = 'curve-view-css';
  const US = [
    { id: 'US3M', label: '3M', years: 0.25 },
    { id: 'US2Y', label: '2Y', years: 2 },
    { id: 'US5Y', label: '5Y', years: 5 },
    { id: 'US10Y', label: '10Y', years: 10 },
    { id: 'US30Y', label: '30Y', years: 30 },
  ];
  const CN = [
    { id: 'CN2Y', label: '2Y', years: 2 },
    { id: 'CN5Y', label: '5Y', years: 5 },
    { id: 'CN10Y', label: '10Y', years: 10 },
    { id: 'CN30Y', label: '30Y', years: 30 },
  ];

  function ensureCss() {
    try {
      if (document.getElementById(CSS_ID)) return;
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = ''
        + '.cv-controls{display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:flex-end;margin-bottom:var(--s-4);}'
        + '.cv-seg{display:inline-flex;border:1px solid var(--rule);border-radius:var(--r-2);overflow:hidden;}'
        + '.cv-seg button{font:inherit;font-size:var(--t-small);padding:7px 14px;border:0;background:var(--sheet);color:var(--ink-2);cursor:pointer;}'
        + '.cv-seg button[aria-pressed="true"]{background:var(--teal-soft);color:var(--teal);}'
        + '.cv-field{display:flex;flex-direction:column;gap:4px;font-size:var(--t-micro);color:var(--ink-3);}'
        + '.cv-field select,.cv-field input{font:inherit;font-size:var(--t-small);padding:7px 9px;border:1px solid var(--rule);border-radius:var(--r-1);background:var(--sheet);color:var(--ink);}'
        + '.cv-chart svg{display:block;width:100%;height:auto;}'
        + '.cv-grid{stroke:var(--rule-2);stroke-width:1;}'
        + '.cv-axis{fill:var(--ink-3);font-family:var(--font-mono);font-size:11px;}'
        + '.cv-line{fill:none;stroke:var(--teal);stroke-width:2.4;stroke-linejoin:round;}'
        + '.cv-ghost{fill:none;stroke:var(--ink-4);stroke-width:1.6;stroke-dasharray:5 5;}'
        + '.cv-dot{fill:var(--teal);}'
        + '.cv-val{fill:var(--ink);font-family:var(--font-mono);font-size:11px;font-weight:600;}'
        + '.cv-inv{fill:var(--warn-soft);}'
        + '.cv-spread{fill:none;stroke:var(--teal);stroke-width:1.8;}'
        + '.cv-spread2{fill:none;stroke:var(--gold-text);stroke-width:1.5;stroke-dasharray:4 4;}'
        + '.cv-zero{stroke:var(--ink-3);stroke-width:1;stroke-dasharray:4 4;}'
        + '.cv-legend{display:flex;flex-wrap:wrap;gap:var(--s-3);font-size:var(--t-micro);color:var(--ink-3);margin-top:var(--s-2);}'
        + '.cv-swatch{display:inline-block;width:16px;height:3px;border-radius:1px;vertical-align:middle;margin-right:5px;}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式增强 */ }
  }

  /** 把一条月序列变成 月份 → 值 的映射（同月取最后一点）。 */
  function byMonth(series) {
    const m = new Map();
    (series && series.points || []).forEach((p) => {
      const ym = String(p.t).slice(0, 7);
      m.set(ym, p.v);
    });
    return m;
  }

  /** 只保留所有档位都有值的月份，升序。 */
  function commonMonths(maps) {
    let acc = null;
    maps.forEach((m) => {
      if (acc === null) acc = new Set(m.keys());
      else acc = new Set([...acc].filter((k) => m.has(k)));
    });
    return acc ? [...acc].sort() : [];
  }

  const X_OF = (years) => Math.sqrt(Math.max(0.1, years));
  const xLabel = '横轴按期限年数开方排布——否则 3M 到 2Y 会挤成一条线，30Y 又太宽。';

  function curveSvg(points, prev, label) {
    const W = 1000, H = 340, L = 58, R = 26, T = 20, B = 46;
    const vals = points.map((p) => p.value).concat(prev ? prev.map((p) => p.value) : []);
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (!isFinite(min) || !isFinite(max)) return '';
    const pad = Math.max(0.05, (max - min) * 0.12);
    min -= pad; max += pad;
    const xs = points.map((p) => X_OF(p.years));
    const xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    const xAt = (y) => L + ((X_OF(y) - xMin) / (xMax - xMin || 1)) * (W - L - R);
    const yAt = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * i / 4;
      const yy = yAt(v).toFixed(1);
      svg += '<line class="cv-grid" x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"/>';
      svg += '<text class="cv-axis" x="' + (L - 8) + '" y="' + yy + '" text-anchor="end" dominant-baseline="middle">' + v.toFixed(2) + '</text>';
    }
    points.forEach((p) => {
      const x = xAt(p.years);
      svg += '<line class="cv-grid" x1="' + x.toFixed(1) + '" y1="' + T + '" x2="' + x.toFixed(1) + '" y2="' + (H - B) + '"/>';
      svg += '<text class="cv-axis" x="' + x.toFixed(1) + '" y="' + (H - B + 18) + '" text-anchor="middle">' + esc(p.label) + '</text>';
    });
    if (prev) {
      const d = prev.map((p, i) => (i ? 'L' : 'M') + xAt(p.years).toFixed(1) + ' ' + yAt(p.value).toFixed(1)).join('');
      svg += '<path class="cv-ghost" d="' + d + '"/>';
    }
    const d = points.map((p, i) => (i ? 'L' : 'M') + xAt(p.years).toFixed(1) + ' ' + yAt(p.value).toFixed(1)).join('');
    svg += '<path class="cv-line" d="' + d + '"/>';
    points.forEach((p) => {
      const x = xAt(p.years), y = yAt(p.value);
      svg += '<circle class="cv-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2"/>';
      svg += '<text class="cv-val" x="' + x.toFixed(1) + '" y="' + (y - 10).toFixed(1) + '" text-anchor="middle">' + p.value.toFixed(2) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function spreadSvg(dates, s1, s2) {
    const W = 1000, H = 190, L = 58, R = 22, T = 14, B = 30;
    const all = s1.concat(s2);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (!isFinite(min) || !isFinite(max)) return '';
    const pad = Math.max(10, (max - min) * 0.1);
    min -= pad; max += pad;
    const xAt = (i) => L + (i / Math.max(1, dates.length - 1)) * (W - L - R);
    const yAt = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="10 年减 2 年、10 年减 3 月利差历史">';
    if (min < 0 && max > 0) {
      const y0 = yAt(0);
      svg += '<rect class="cv-inv" x="' + L + '" y="' + y0.toFixed(1) + '" width="' + (W - L - R) + '" height="' + (H - B - y0).toFixed(1) + '"/>';
      svg += '<line class="cv-zero" x1="' + L + '" y1="' + y0.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y0.toFixed(1) + '"/>';
      svg += '<text class="cv-axis" x="' + (L - 8) + '" y="' + y0.toFixed(1) + '" text-anchor="end" dominant-baseline="middle">0</text>';
    }
    const path = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join('');
    svg += '<path class="cv-spread2" d="' + path(s2) + '"/>';
    svg += '<path class="cv-spread" d="' + path(s1) + '"/>';
    const step = Math.max(1, Math.ceil(dates.length / 6));
    for (let i = 0; i < dates.length; i += step) {
      svg += '<text class="cv-axis" x="' + xAt(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(String(dates[i]).slice(0, 4)) + '</text>';
    }
    const yMin = yAt(min), yMax = yAt(max);
    svg += '<text class="cv-axis" x="' + (L - 8) + '" y="' + yMax.toFixed(1) + '" text-anchor="end">' + max.toFixed(0) + '</text>';
    svg += '<text class="cv-axis" x="' + (L - 8) + '" y="' + yMin.toFixed(1) + '" text-anchor="end">' + min.toFixed(0) + '</text>';
    svg += '</svg>';
    return svg;
  }

  function shapeText(shape) {
    if (!shape) return '数据不足';
    if (shape.shape === 'inverted') return '倒挂：短端高于长端';
    if (shape.shape === 'flat') return '平坦：长短期利差很小';
    return '正常向上：长端高于短端';
  }

  async function render(view, query) {
    ensureCss();
    const market = query && query.market === 'cn' ? 'cn' : 'us';
    const defs = market === 'cn' ? CN : US;
    view.innerHTML = '<div class="art-head"><div class="eyebrow">工具箱 · 收益率曲线</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">一条曲线，看利率的形状</h1>'
      + '<p class="art-dek">把不同期限的国债收益率连起来。倒挂是「短端比长端贵」——它是信号，不是预言。</p></div>'
      + '<div class="panel"><div class="skel" style="height:16px;width:40%"></div></div>';

    const all = await Promise.all(defs.map((d) => window.History.series(d.id)));
    if (!view.isConnected) return;
    const maps = all.map(byMonth);
    const months = commonMonths(maps);
    if (!months.length) {
      view.innerHTML = '<div class="empty"><div class="et">这个市场的曲线数据没读到</div><div class="ed">data/history 下的国债序列可能没加载出来。刷新页面再试，或切到另一个市场。</div></div>';
      return;
    }
    let ym = query && /^\d{4}-\d{2}$/.test(query.ym || '') && months.indexOf(query.ym) >= 0
      ? query.ym
      : months[months.length - 1];
    const idx = months.indexOf(ym);
    const prevYM = idx >= 12 ? months[idx - 12] : null;

    // 利差历史（美债）：10Y-2Y 与 10Y-3M
    let spreadBlock = '';
    if (market === 'us') {
      const y2 = maps[1], y10 = maps[3], y3m = maps[0];
      const dts = [], s1 = [], s2 = [];
      months.forEach((m) => {
        if (y2.has(m) && y10.has(m)) { dts.push(m); s1.push((y10.get(m) - y2.get(m)) * 100); s2.push(y3m.has(m) ? (y10.get(m) - y3m.get(m)) * 100 : null); }
      });
      const last = s1[s1.length - 1];
      spreadBlock = '<section class="panel" style="margin-bottom:var(--s-5)">'
        + '<div class="panel-title"><h3>利差历史（基点）</h3><span class="sub">10Y−2Y；虚线 10Y−3M</span></div>'
        + '<div class="cv-chart">' + spreadSvg(dts, s1, s2.filter((v) => v !== null)) + '</div>'
        + '<div class="cv-legend"><span><i class="cv-swatch" style="background:var(--teal)"></i>10Y−2Y</span><span><i class="cv-swatch" style="background:var(--gold-text)"></i>10Y−3M</span><span>底色 = 倒挂（利差 &lt; 0）</span></div>'
        + '<p class="cmp-hint">当前 10Y−2Y：' + (last === undefined ? '--' : (last >= 0 ? '+' : '') + last.toFixed(0) + ' 个基点') + '。倒挂只说明市场给短端的定价高于长端；历史上它常在衰退前出现，但<strong>不是每次倒挂都衰退</strong>，也不是倒挂后马上下跌。</p>'
        + '</section>';
    }

    const points = defs.map((d, i) => ({ label: d.label, years: d.years, value: maps[i].get(ym) }));
    const prevPoints = prevYM ? defs.map((d, i) => ({ label: d.label, years: d.years, value: maps[i].get(prevYM) })) : null;
    const shape = window.Engine && window.Engine.spread
      ? window.Engine.spread.curveShape(points.map((p) => ({ y: p.years, label: p.label, value: p.value })))
      : null;

    const monthOptions = months.slice().reverse().map((m) => '<option value="' + esc(m) + '"' + (m === ym ? ' selected' : '') + '>' + esc(m) + '</option>').join('');

    view.innerHTML = '<div class="art-head"><div class="eyebrow">工具箱 · 收益率曲线</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">一条曲线，看利率的形状</h1>'
      + '<p class="art-dek">把不同期限的国债收益率连起来。倒挂是「短端比长端贵」——它是信号，不是预言。</p></div>'
      + '<section class="panel" style="margin-bottom:var(--s-5)">'
      + '<div class="cv-controls">'
      + '<div class="cv-seg" role="group" aria-label="市场"><button type="button" data-market="us" aria-pressed="' + (market === 'us') + '">美债</button><button type="button" data-market="cn" aria-pressed="' + (market === 'cn') + '">中债</button></div>'
      + '<label class="cv-field">月份<select id="cv-month">' + monthOptions + '</select></label>'
      + '<div class="cv-field"><span>形态</span><strong>' + esc(shapeText(shape)) + '</strong></div>'
      + '<div class="cv-field"><span>数据</span><strong>' + esc(months[0]) + ' → ' + esc(months[months.length - 1]) + '</strong></div>'
      + '</div>'
      + '<div class="cv-chart">' + curveSvg(points, prevPoints, (market === 'us' ? '美债' : '中债') + '收益率曲线，' + ym) + '</div>'
      + '<div class="cv-legend"><span><i class="cv-swatch" style="background:var(--teal)"></i>' + esc(ym) + '</span>'
      + (prevYM ? '<span><i class="cv-swatch" style="background:var(--ink-4)"></i>' + esc(prevYM) + '（一年前）</span>' : '')
      + '<span>' + esc(xLabel) + '</span></div>'
      + (market === 'cn' ? '<p class="cmp-hint">中债四档序列从 2023 年开始，样本比美债短得多；这里的曲线形状只描述这段有限历史。</p>' : '')
      + '</section>'
      + spreadBlock
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');

    const sel = view.querySelector('#cv-month');
    if (sel) sel.addEventListener('change', () => {
      if (window.Router) window.Router.go('/curve?market=' + market + '&ym=' + encodeURIComponent(sel.value), { replace: true });
    });
    view.querySelectorAll('[data-market]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.getAttribute('data-market') !== market && window.Router) {
          window.Router.go('/curve?market=' + b.getAttribute('data-market'), { replace: true });
        }
      });
    });
  }

  window.CurveView = { render, commonMonths, byMonth };
})();
