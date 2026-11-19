/* views/compare.js —— 资产对比器（#/compare）
   把「时间 × 资产」从 5 个写死的危机包，扩成任意 2–4 条序列、任意区间的对照。
   只做编排：读静态月线 → 交 engine/compare.js 计算 → 画 SVG / 表 / 相关矩阵。
   一次网络请求都不发（实时行情属于 OpenFinLens）。

   三条口径必须写在页面上：
   1. 归一化到起点 = 100，比的是相对涨跌，不是绝对价格；
   2. 对齐用 step-hold（当日或之前最近值），不插值、不补假点；
   3. 收益率序列（单位 %）的涨跌与波动用「个百分点」，价格类用「%」。
*/
(function () {
  'use strict';

  const MAX_SERIES = 4;
  const MIN_SERIES = 2;
  const DEFAULT_IDS = ['SPX', 'GC00Y', 'US10Y'];
  const PRESETS = [
    { key: '1y', label: '近 1 年', months: 12 },
    { key: '5y', label: '近 5 年', months: 60 },
    { key: '10y', label: '近 10 年', months: 120 },
    { key: 'all', label: '全部' },
  ];
  const SERIES_COLORS = ['var(--teal)', 'var(--gold)', 'var(--warn)', 'var(--ink-2)'];
  const GROUP_ORDER = ['index', 'cn', 'hk', 'us', 'commodity', 'rate', 'fx', 'vol', 'other'];
  const GROUP_LABEL = {
    index: '指数', cn: 'A 股', hk: '港股', us: '美股',
    commodity: '商品', rate: '利率', fx: '外汇', vol: '波动率', other: '其它',
  };
  const INDEX_IDS = new Set([
    'SPX', 'DJIA', 'IXIC', 'usIXIC', 'N225', 'GDAXI', 'FTSE', 'FCHI', 'KS11', 'SENSEX',
    'HSI', 'HSTECH', 'SH000001', 'SZ399001', 'SZ399006', 'SH000688',
  ]);
  const COMMODITY_IDS = new Set(['GC00Y', 'SI00Y', 'HG00Y', 'CL00Y', 'NG00Y', 'ZC00Y']);
  const FX_IDS = new Set(['UDI', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDHKD', 'USDCNH']);

  const CSS_ID = 'compare-view-css';
  let cssReady = false;

  const esc = (s) => (window.Fmt && window.Fmt.esc
    ? window.Fmt.esc(s)
    : String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  const fmtNumber = (v, digits) => {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    const d = digits === undefined ? 2 : digits;
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtSigned = (v, digits) => {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    const d = digits === undefined ? 2 : digits;
    return (v > 0 ? '+' : '') + Number(v).toFixed(d);
  };
  const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

  function ensureCss() {
    if (cssReady) return;
    try {
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = ''
        + '.cmp-page .art-head{max-width:860px;}'
        + '.cmp-setup{margin-bottom:var(--s-5);}'
        + '.cmp-fieldset{border:0;padding:0;margin:0 0 var(--s-4);}'
        + '.cmp-fieldset legend{font-family:var(--font-mono);font-size:var(--t-eyebrow);letter-spacing:.14em;color:var(--gold-text);padding:0;margin-bottom:var(--s-2);}'
        + '.cmp-group{border-top:1px solid var(--rule-2);padding:var(--s-2) 0;}'
        + '.cmp-group:first-of-type{border-top:0;}'
        + '.cmp-group summary{cursor:pointer;font-size:var(--t-small);color:var(--ink-2);line-height:1.9;}'
        + '.cmp-group summary b{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3);font-weight:500;margin-left:6px;}'
        + '.cmp-chips{display:flex;flex-wrap:wrap;gap:6px;padding:var(--s-2) 0 var(--s-1);}'
        + '.cmp-chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 9px;cursor:pointer;border:1px solid var(--rule);border-radius:var(--r-2);background:var(--sheet);color:var(--ink-2);font-size:var(--t-micro);}'
        + '.cmp-chip input{accent-color:var(--teal);margin:0;}'
        + '.cmp-chip .cmp-chip-id{font-family:var(--font-mono);font-size:10px;color:var(--ink-4);}'
        + '.cmp-chip:has(input:checked){border-color:var(--teal-line);background:var(--teal-soft);color:var(--ink);}'
        + '.cmp-range{display:grid;grid-template-columns:repeat(2,minmax(150px,210px)) auto;gap:var(--s-3);align-items:end;}'
        + '.cmp-presets{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}'
        + '.cmp-preset{font:inherit;font-size:var(--t-micro);color:var(--ink-2);background:var(--sheet);border:1px solid var(--rule);border-radius:var(--r-1);padding:5px 11px;cursor:pointer;}'
        + '.cmp-preset[aria-pressed="true"]{border-color:var(--teal-line);background:var(--teal-soft);color:var(--teal);}'
        + '.cmp-field{display:flex;flex-direction:column;gap:4px;font-size:var(--t-micro);color:var(--ink-3);}'
        + '.cmp-field input{font:inherit;font-family:var(--font-mono);font-size:var(--t-small);color:var(--ink);background:var(--sheet);border:1px solid var(--rule);border-radius:var(--r-1);padding:7px 9px;}'
        + '.cmp-form-error{min-height:1.4em;margin:var(--s-2) 0 0;font-size:var(--t-micro);color:var(--danger);}'
        + '.cmp-hint{margin:var(--s-1) 0 0;font-size:var(--t-micro);color:var(--ink-3);line-height:1.7;}'
        + '.cmp-warn{margin:0 0 var(--s-4);padding:10px 12px;border:1px solid var(--warn);border-radius:var(--r-2);background:var(--warn-soft);font-size:var(--t-small);color:var(--warn);line-height:1.7;}'
        + '.cmp-chart svg{display:block;width:100%;height:auto;overflow:visible;}'
        + '.cmp-grid{stroke:var(--rule-2);stroke-width:1;}'
        + '.cmp-zero{stroke:var(--ink-3);stroke-width:1;stroke-dasharray:4 4;opacity:.65;}'
        + '.cmp-axis-text{fill:var(--ink-3);font-family:var(--font-mono);font-size:11px;}'
        + '.cmp-axis-note{fill:var(--gold-text);font-family:var(--font-mono);font-size:10.5px;}'
        + '.cmp-line{fill:none;stroke-width:2.1;stroke-linejoin:round;stroke-linecap:round;}'
        + '.cmp-legend{display:flex;flex-wrap:wrap;gap:var(--s-3);margin-top:var(--s-3);padding-top:var(--s-3);border-top:1px solid var(--rule-2);}'
        + '.cmp-legend-item{display:inline-flex;align-items:center;gap:6px;font-size:var(--t-small);color:var(--ink-2);}'
        + '.cmp-legend-item .cmp-swatch{width:16px;height:3px;border-radius:1px;flex:none;}'
        + '.cmp-legend-item .cmp-legend-id{font-family:var(--font-mono);font-size:10px;color:var(--ink-4);}'
        + '.cmp-legend-item .cmp-legend-val{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3);}'
        + '.cmp-stats td,.cmp-stats th{white-space:nowrap;}'
        + '.cmp-stats td.cmp-name{white-space:normal;min-width:128px;}'
        + '.cmp-stats td .cmp-sub{display:block;font-size:10px;color:var(--ink-4);font-family:var(--font-mono);}'
        + '.cmp-corr td,.cmp-corr th{text-align:center;white-space:nowrap;}'
        + '.cmp-corr th:first-child,.cmp-corr td:first-child{text-align:left;}'
        + '.cmp-corr .cmp-corr-id{font-family:var(--font-mono);font-size:10px;color:var(--ink-4);display:block;font-weight:400;}'
        + '.cmp-corr td.diag{color:var(--ink);font-weight:600;}'
        + '@media (max-width:760px){.cmp-range{grid-template-columns:1fr 1fr;}.cmp-range .btn{grid-column:1 / -1;width:100%;justify-content:center;}.cmp-stats td,.cmp-stats th{white-space:normal;}}';
      (document.head || document.documentElement).appendChild(st);
      cssReady = true;
    } catch (e) { /* 样式注入失败不影响功能 */ }
  }

  function groupOf(s) {
    const id = String((s && s.id) || '');
    if (id === 'VIX') return 'vol';
    if (INDEX_IDS.has(id)) return 'index';
    if (String((s && s.unit) || '') === '%') return 'rate';
    if (COMMODITY_IDS.has(id)) return 'commodity';
    if (FX_IDS.has(id)) return 'fx';
    if (/^hk\d/i.test(id)) return 'hk';
    if (/^us[A-Z]/i.test(id)) return 'us';
    if (/^(sh|sz)\d/i.test(id)) return 'cn';
    return 'other';
  }

  function groupSeries(series) {
    const groups = new Map();
    for (const s of series || []) {
      const g = groupOf(s);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({
      key: g, label: GROUP_LABEL[g] || g, items: groups.get(g),
    }));
  }

  const isRate = (s) => String((s && s.unit) || '') === '%';

  function parseQuery(q) {
    const E = window.Engine && window.Engine.compare;
    const raw = String((q && q.ids) || '').split(',').map((x) => x.trim()).filter(Boolean);
    let ids = raw.slice(0, MAX_SERIES);
    if (ids.length < MIN_SERIES) ids = DEFAULT_IDS.slice();
    const from = E && E.validMonth(q && q.from) ? q.from : '';
    const to = E && E.validMonth(q && q.to) ? q.to : '';
    return { ids, from, to };
  }

  function presetRange(key, latestYM) {
    const E = window.Engine && window.Engine.compare;
    if (!E || !latestYM || key === 'all') return { from: '', to: latestYM || '' };
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return { from: '', to: latestYM };
    return { from: E.monthShift(latestYM, -p.months), to: latestYM };
  }

  const formatYM = (iso) => String(iso || '').slice(0, 7);

  function seriesY(rows) {
    const vals = [];
    rows.forEach((r) => r.values.forEach((v) => { if (v !== null && isFinite(v)) vals.push(v); }));
    if (!vals.length) return { min: 0, max: 1 };
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }

  function niceTicks(min, max, n) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const step = span / Math.max(1, n);
    const out = [];
    for (let i = 0; i <= n; i++) out.push(min + step * i);
    return out;
  }

  function chartSvg(rows, dates, colors) {
    const W = 1000, H = 360, L = 58, R = 22, T = 18, B = 44;
    const y = seriesY(rows);
    const n = dates.length;
    const xAt = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const yAt = (v) => T + (1 - (v - y.min) / (y.max - y.min)) * (H - T - B);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="归一化走势对比图">';
    niceTicks(y.min, y.max, 5).forEach((t) => {
      const yy = yAt(t).toFixed(1);
      svg += '<line class="cmp-grid" x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"></line>';
      svg += '<text class="cmp-axis-text" x="' + (L - 8) + '" y="' + yy + '" text-anchor="end" dominant-baseline="middle">' + esc(fmtNumber(t, 0)) + '</text>';
    });
    if (y.min <= 100 && y.max >= 100) {
      const yy = yAt(100).toFixed(1);
      svg += '<line class="cmp-zero" x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"></line>';
      svg += '<text class="cmp-axis-note" x="' + (W - R) + '" y="' + (Number(yy) - 6) + '" text-anchor="end">起点 = 100</text>';
    }
    const yearIdx = [];
    let lastYear = '';
    dates.forEach((d, i) => {
      const yr = String(d).slice(0, 4);
      if (yr !== lastYear) { yearIdx.push(i); lastYear = yr; }
    });
    const every = Math.max(1, Math.ceil(yearIdx.length / 6));
    yearIdx.filter((_, i) => i % every === 0).forEach((i) => {
      const x = xAt(i).toFixed(1);
      svg += '<line class="cmp-grid" x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (H - B) + '"></line>';
      svg += '<text class="cmp-axis-text" x="' + x + '" y="' + (H - B + 18) + '" text-anchor="middle">' + esc(String(dates[i]).slice(0, 4)) + '</text>';
    });
    rows.forEach((r, ri) => {
      let d = '';
      let started = false;
      r.values.forEach((v, i) => {
        if (v === null || !isFinite(v)) { started = false; return; }
        d += (started ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1);
        started = true;
      });
      if (d) svg += '<path class="cmp-line" d="' + d + '" stroke="' + colors[ri % colors.length] + '"></path>';
    });
    svg += '<text class="cmp-axis-note" x="' + L + '" y="' + (H - 6) + '">区间起点 = 100；纵轴为相对水平</text>';
    svg += '</svg>';
    return svg;
  }

  function statsTable(rows) {
    const E = window.Engine.compare;
    const head = '<thead><tr><th scope="col">序列</th><th scope="col">起点</th><th scope="col">终点</th><th scope="col">区间涨跌</th><th scope="col">年化</th><th scope="col">年化波动</th><th scope="col">最大回撤</th></tr></thead>';
    const body = rows.map((r) => {
      const rate = isRate(r.meta);
      const st = rate ? E.rateStats(r.points) : E.seriesStats(r.points);
      const change = rate
        ? (st.changePp === null ? '--' : (st.changePp >= 0 ? '+' : '') + st.changePp.toFixed(2) + ' 个百分点')
        : (st.changePct === null ? '--' : fmtSigned(st.changePct, 1) + '%');
      const ann = rate ? '--' : (st.cagr === null ? '--' : fmtSigned(st.cagr, 1) + '%');
      const vol = rate
        ? (st.volPp === null ? '--' : st.volPp.toFixed(2) + ' 个百分点')
        : (st.vol === null ? '--' : st.vol.toFixed(1) + '%');
      const mdd = rate
        ? (st.mddPp === null ? '--' : st.mddPp.toFixed(2) + ' 个百分点')
        : (st.mdd === null ? '--' : '-' + st.mdd.toFixed(1) + '%');
      const digits = r.meta && r.meta.digits !== undefined ? r.meta.digits : 2;
      return '<tr>'
        + '<td class="cmp-name">' + esc(r.meta.name || r.key) + '<span class="cmp-sub">' + esc(r.key) + (r.meta.unit ? ' · ' + esc(r.meta.unit) : '') + '</span></td>'
        + '<td class="num">' + esc(fmtNumber(st.first ? st.first.v : null, digits)) + '<span class="cmp-sub">' + esc(formatYM(st.first && st.first.t)) + '</span></td>'
        + '<td class="num">' + esc(fmtNumber(st.last ? st.last.v : null, digits)) + '<span class="cmp-sub">' + esc(formatYM(st.last && st.last.t)) + '</span></td>'
        + '<td class="num ' + dirClass(rate ? st.changePp : st.changePct) + '">' + esc(change) + '</td>'
        + '<td class="num">' + esc(ann) + '</td>'
        + '<td class="num">' + esc(vol) + '</td>'
        + '<td class="num">' + esc(mdd) + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="cmp-stats">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function corrMatrix(rows) {
    const E = window.Engine.compare;
    if (rows.length < 2) return '';
    let head = '<thead><tr><th scope="col">相关性</th>';
    rows.forEach((r) => { head += '<th scope="col">' + esc(r.meta.name || r.key) + '<span class="cmp-corr-id">' + esc(r.key) + '</span></th>'; });
    head += '</tr></thead>';
    let body = '';
    rows.forEach((a, i) => {
      body += '<tr><th scope="row">' + esc(a.meta.name || a.key) + '<span class="cmp-corr-id">' + esc(a.key) + '</span></th>';
      rows.forEach((b, j) => {
        if (i === j) { body += '<td class="diag">1.00</td>'; return; }
        if (j < i) { body += '<td class="muted">—</td>'; return; }
        const r = E.correlation(a.values, b.values, { diffA: isRate(a.meta), diffB: isRate(b.meta) });
        body += '<td class="num">' + (r === null ? '--' : r.toFixed(2)) + '</td>';
      });
      body += '</tr>';
    });
    return '<div class="tbl-wrap"><table class="cmp-corr">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function setupHtml(groups, selected, from, to) {
    const chips = groups.map((g) => {
      const open = selected.some((id) => g.items.some((s) => s.id === id));
      return '<details class="cmp-group"' + (open ? ' open' : '') + '>'
        + '<summary>' + esc(g.label) + ' <b>' + g.items.length + '</b></summary>'
        + '<div class="cmp-chips">'
        + g.items.map((s) => '<label class="cmp-chip">'
          + '<input type="checkbox" name="cmp-series" value="' + esc(s.id) + '"' + (selected.indexOf(s.id) >= 0 ? ' checked' : '') + '>'
          + '<span>' + esc(s.name || s.id) + '</span><span class="cmp-chip-id">' + esc(s.id) + '</span>'
          + '</label>').join('')
        + '</div></details>';
    }).join('');
    return '<form class="panel cmp-setup" id="cmp-form">'
      + '<fieldset class="cmp-fieldset"><legend>选 2–4 条序列</legend>'
      + '<p class="cmp-hint">同一张图里最多 4 条。收益率序列用「个百分点」，价格序列用「%」——两者不混着算。</p>'
      + chips + '</fieldset>'
      + '<fieldset class="cmp-fieldset"><legend>区间</legend>'
      + '<div class="cmp-range">'
      + '<div class="cmp-presets" role="group" aria-label="区间预设">'
      + PRESETS.map((p) => '<button type="button" class="cmp-preset" data-preset="' + p.key + '" aria-pressed="false">' + esc(p.label) + '</button>').join('')
      + '</div>'
      + '<label class="cmp-field">开始月份<input type="month" id="cmp-from" value="' + esc(from) + '"></label>'
      + '<label class="cmp-field">结束月份<input type="month" id="cmp-to" value="' + esc(to) + '"></label>'
      + '<button class="btn" type="submit" id="cmp-apply">画出来</button>'
      + '</div></fieldset>'
      + '<p class="cmp-form-error" id="cmp-error" role="status" aria-live="polite"></p>'
      + '</form>';
  }

  function bindSetup(view) {
    const form = view.querySelector('#cmp-form');
    if (!form) return;
    const boxes = view.querySelectorAll('input[name="cmp-series"]');
    const err = view.querySelector('#cmp-error');
    const fromEl = view.querySelector('#cmp-from');
    const toEl = view.querySelector('#cmp-to');

    const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);
    function check() {
      const sel = picked();
      if (sel.length > MAX_SERIES) {
        if (err) err.textContent = '最多选 4 条；先取消一条再选。';
        return false;
      }
      if (sel.length < MIN_SERIES) {
        if (err) err.textContent = '至少选 2 条才能对比。';
        return false;
      }
      if (err) err.textContent = '';
      return true;
    }
    boxes.forEach((b) => b.addEventListener('change', check));

    const setPreset = (key) => {
      const to = toEl && toEl.value ? toEl.value : '';
      if (!to) return;
      const range = presetRange(key, to);
      if (fromEl) fromEl.value = range.from || '';
      if (toEl) toEl.value = range.to || to;
      view.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-preset') === key ? 'true' : 'false');
      });
    };
    view.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => setPreset(btn.getAttribute('data-preset')));
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!check()) return;
      const sel = picked();
      const from = fromEl && fromEl.value ? fromEl.value : '';
      const to = toEl && toEl.value ? toEl.value : '';
      const qs = 'ids=' + encodeURIComponent(sel.join(','))
        + (from ? '&from=' + encodeURIComponent(from) : '')
        + (to ? '&to=' + encodeURIComponent(to) : '');
      if (window.Router && window.Router.go) window.Router.go('/compare?' + qs, { replace: true });
    });
  }

  const PAGE_HEAD = '<div class="art-head">'
    + '<div class="eyebrow">工具箱 · 资产对比</div>'
    + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">把两条线放在同一张图上</h1>'
    + '<p class="art-dek">选 2–4 条序列，归一化到同一起点，看它们在同一段时间里的相对涨跌、波动与回撤。这里只陈述历史，不预测、不排序「谁更好」。</p>'
    + '</div>';

  async function render(view, query) {
    ensureCss();
    const E = window.Engine && window.Engine.compare;
    if (!E) {
      view.innerHTML = '<div class="empty"><div class="et">对比引擎没有加载</div><div class="ed">页面脚本可能没加载完整，刷新一次再试。</div></div>';
      return;
    }
    view.innerHTML = PAGE_HEAD + '<div class="panel"><div class="skel" style="height:16px;width:40%"></div></div>';

    const reg = await window.History.registry();
    if (!view.isConnected) return;
    const series = ((reg && reg.series) || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    if (!series.length) {
      view.innerHTML = '<div class="empty"><div class="et">序列注册表没读到</div><div class="ed">data/series-map.json 没加载出来，多半是网络抖了一下。刷新页面再试。</div></div>';
      return;
    }

    const groups = groupSeries(series);
    const q = parseQuery(query);
    const selected = q.ids.filter((id) => series.some((s) => s.id === id));
    if (selected.length < MIN_SERIES) {
      DEFAULT_IDS.forEach((id) => {
        if (series.some((s) => s.id === id) && selected.length < MAX_SERIES && selected.indexOf(id) < 0) selected.push(id);
      });
    }
    const latest = series.reduce((m, s) => (String(s.to || '') > m ? String(s.to) : m), '');
    const latestYM = formatYM(latest);
    let to = q.to || latestYM;
    let from = q.from || (latestYM ? E.monthShift(to, -120) : '');
    if (from && to && from > to) { const t = from; from = to; to = t; }

    view.innerHTML = PAGE_HEAD + setupHtml(groups, selected, from, to)
      + '<div id="cmp-result" aria-live="polite"></div>'
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');
    bindSetup(view);

    const result = view.querySelector('#cmp-result');
    if (!result) return;

    const loaded = [];
    for (const id of selected) {
      const s = await window.History.series(id);
      if (!view.isConnected) return;
      if (s && Array.isArray(s.points) && s.points.length) loaded.push({ id, meta: s, points: s.points });
    }
    if (!loaded.length) {
      result.innerHTML = '<div class="empty"><div class="et">这几条序列都没读到</div><div class="ed">data/history 下的文件可能没加载出来；刷新页面或换几条试试。</div></div>';
      return;
    }

    const aligned = E.alignSeries(loaded.map((x) => ({ id: x.id, points: x.points })), from, to);
    if (!aligned || !aligned.dates.length) {
      result.innerHTML = '<div class="cmp-warn">这个区间里没有可对齐的数据。把开始月份往前调，或者点「全部」。</div>';
      return;
    }
    const rows = aligned.rows.map((r) => {
      const meta = loaded.find((x) => x.id === r.key).meta;
      // 统计必须只用选中的区间，不能用全历史：否则「近 1 年」的涨跌会拿 1990 年的首值来算。
      return { key: r.key, meta, values: r.values, points: E.slicePoints(meta.points, from, to) };
    }).filter((r) => r.values.some((v) => v !== null));
    if (rows.length < 2) {
      result.innerHTML = '<div class="cmp-warn">这个区间里只有 1 条序列有数据，没法对比。换一个区间或再加一条。</div>';
      return;
    }

    const priceRows = rows.filter((r) => !isRate(r.meta));
    const rateRows = rows.filter((r) => isRate(r.meta));
    const colors = SERIES_COLORS;
    let html = '';

    if (priceRows.length) {
      const norm = priceRows.map((r) => Object.assign({}, r, { values: E.normalize(r.values, 100) }));
      html += '<section class="panel" style="margin-bottom:var(--s-5)">'
        + '<div class="panel-title"><h3>相对走势（起点 = 100）</h3><span class="sub">' + esc(from) + ' → ' + esc(to) + '</span></div>'
        + '<div class="cmp-chart">' + chartSvg(norm, aligned.dates, colors) + '</div>'
        + '<div class="cmp-legend">' + norm.map((r, i) => {
          const last = r.values[r.values.length - 1];
          return '<span class="cmp-legend-item"><i class="cmp-swatch" style="background:' + colors[i % colors.length] + '"></i>'
            + esc(r.meta.name || r.key) + '<span class="cmp-legend-id">' + esc(r.key) + '</span>'
            + (last === null ? '' : '<span class="cmp-legend-val">' + last.toFixed(1) + '</span>') + '</span>';
        }).join('') + '</div>'
        + '<p class="cmp-hint">价格类序列归一化到起点 = 100。它只回答「相对涨了多少」，不回答「贵不贵」。</p>'
        + '</section>';
    }
    if (rateRows.length) {
      const ppRows = rateRows.map((r) => {
        const base = r.values.find((v) => v !== null);
        return Object.assign({}, r, {
  
          values: r.values.map((v) => (v === null || base === null ? null : (v - base) * 100)),
        });
      });
      html += '<section class="panel" style="margin-bottom:var(--s-5)">'
        + '<div class="panel-title"><h3>收益率变动（个百分点）</h3><span class="sub">相对区间起点</span></div>'
        + '<div class="cmp-chart">' + chartSvg(ppRows, aligned.dates, colors.slice(priceRows.length)) + '</div>'
        + '<div class="cmp-legend">' + ppRows.map((r) => '<span class="cmp-legend-item">' + esc(r.meta.name || r.key) + '<span class="cmp-legend-id">' + esc(r.key) + '</span></span>').join('') + '</div>'
        + '<p class="cmp-hint">收益率是水平值：从 4% 到 2% 是跌了 2 个百分点，不是跌了 50%。所以这一块画的是百分点变动，不归一化。</p>'
        + '</section>';
    }

    html += '<section class="panel" style="margin-bottom:var(--s-5)">'
      + '<div class="panel-title"><h3>区间读数</h3><span class="sub">全部由月线序列算出</span></div>'
      + statsTable(rows)
      + '<p class="cmp-hint">年化波动 = 月度对数收益标准差 × √12；最大回撤 = 峰值之后的最深跌幅（谷底必须在峰值之后）。过去不代表未来。</p>'
      + '</section>';

    if (rows.length >= 2) {
      html += '<section class="panel" style="margin-bottom:var(--s-5)">'
        + '<div class="panel-title"><h3>同区间相关性</h3><span class="sub">月度变动</span></div>'
        + corrMatrix(rows)
        + '<p class="cmp-hint">相关性只描述这段历史里「同向 / 反向」的程度，会随区间变化，不是资产之间的固定属性，更不是因果关系。</p>'
        + '</section>';
    }
    result.innerHTML = html;
  }

  window.CompareView = { render, parseQuery, groupOf, presetRange };
})();
