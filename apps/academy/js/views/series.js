/* views/series.js —— 序列详情（#/series/:id）与数据台账（#/status）
   首页写着「每个数字都能点开看来源」。这句话要能兑现：
   正文里的数字是构建期从 data/history/*.json 取出来的；这里把同一个文件
   打开给读者看——覆盖区间、来源、口径、最新点、图表与原始 JSON。
   不做任何实时请求，只读静态产物。
*/
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CSS_ID = 'series-view-css';

  function ensureCss() {
    try {
      if (document.getElementById(CSS_ID)) return;
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = ''
        + '.sv-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:var(--s-5);}'
        + '.sv-cell{background:var(--sheet);border:1px solid var(--rule-2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;}'
        + '.sv-k{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3);letter-spacing:.04em;}'
        + '.sv-v{font-size:var(--t-small);color:var(--ink);line-height:1.6;word-break:break-word;}'
        + '.sv-chart svg{display:block;width:100%;height:auto;}'
        + '.sv-table td,.sv-table th{white-space:nowrap;}'
        + '.sv-table td.num{font-family:var(--font-mono);}'
        + '.status-list{display:flex;flex-direction:column;gap:2px;}'
        + '.status-row{display:grid;grid-template-columns:minmax(140px,1.2fr) minmax(150px,1fr) repeat(3,minmax(78px,.6fr));gap:10px;align-items:center;padding:9px 12px;border-radius:10px;font-size:var(--t-micro);color:var(--ink-2);}'
        + '.status-row:hover{background:var(--sheet);text-decoration:none;}'
        + '.status-row .sr-name{color:var(--ink);font-weight:500;}'
        + '.status-row .sr-id{display:block;font-family:var(--font-mono);font-size:10px;color:var(--ink-4);}'
        + '.status-row .sr-num{font-family:var(--font-mono);text-align:right;color:var(--ink-3);}'
        + '.status-row .sr-stale{color:var(--warn);font-family:var(--font-mono);font-size:10px;}'
        + '.status-head{display:grid;grid-template-columns:minmax(140px,1.2fr) minmax(150px,1fr) repeat(3,minmax(78px,.6fr));gap:10px;padding:0 12px 8px;font-family:var(--font-mono);font-size:10px;color:var(--ink-4);border-bottom:1px solid var(--rule-2);margin-bottom:4px;}'
        + '.status-filter{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:var(--s-3);}'
        + '.status-filter input{font:inherit;font-size:var(--t-small);padding:8px 11px;border:1px solid var(--rule);border-radius:999px;background:var(--sheet);color:var(--ink);min-width:220px;}'
        + '@media (max-width:760px){.status-row,.status-head{grid-template-columns:1.3fr 1fr;} .status-row .sr-hide,.status-head .sr-hide{display:none;}}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式增强 */ }
  }

  const fmt = (v, digits) => {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    const d = digits === undefined ? 2 : digits;
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  async function renderSeries(view, id) {
    ensureCss();
    const sid = String(id || '');
    view.innerHTML = '<div class="art-head"><div class="eyebrow">数据台账 · 序列</div><h1 style="font-size:var(--t-h1)">' + esc(sid || '序列') + '</h1></div><div class="panel"><div class="skel" style="height:16px;width:40%"></div></div>';
    const s = await window.History.series(sid);
    if (!view.isConnected) return;
    if (!s || !s.points || !s.points.length) {
      view.innerHTML = '<div class="empty"><div class="et">没有这条序列</div><div class="ed">data/history/' + esc(sid) + '.json 不存在或没加载出来。回<a href="#/status">数据台账</a>看看有哪些序列。</div></div>';
      return;
    }
    const st = window.Engine && window.Engine.instrument ? window.Engine.instrument.stats(s) : null;
    const digits = s.digits === undefined ? 2 : s.digits;
    const desc = window.SeriesChart ? window.SeriesChart.describe(s) : '';
    const line = window.SeriesChart ? window.SeriesChart.render(s, { mode: 'line', height: 300 }) : '';
    const dd = window.SeriesChart ? window.SeriesChart.render(s, { mode: 'drawdown', height: 150 }) : '';
    const rows = (s.points || []).slice(-12).reverse().map((p) => '<tr><td class="num">' + esc(p.t) + '</td><td class="num">' + esc(fmt(p.v, digits)) + '</td></tr>').join('');
    const isRate = String(s.unit || '') === '%';

    view.innerHTML = '<div class="art-head">'
      + '<div class="eyebrow">数据台账 · 序列</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">' + esc(s.name || sid) + '</h1>'
      + '<p class="art-dek">这条序列就是正文数字的来源文件。下面是元信息、图和最近 12 个点；原始 JSON 可以直接下载对账。</p>'
      + '</div>'
      + '<div class="sv-meta">'
      + '<div class="sv-cell"><span class="sv-k">序列 id</span><span class="sv-v">' + esc(sid) + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">单位 / 口径</span><span class="sv-v">' + esc(s.unit || '—') + ' · ' + esc(s.kind || '—') + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">来源</span><span class="sv-v">' + esc(s.source || '—') + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">覆盖</span><span class="sv-v">' + esc(s.points[0].t) + ' → ' + esc(s.points[s.points.length - 1].t) + ' · ' + s.points.length + ' 点</span></div>'
      + '<div class="sv-cell"><span class="sv-k">采集时间</span><span class="sv-v">' + esc(s.generatedAt || '—') + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">最新值</span><span class="sv-v">' + esc(fmt(st ? st.last.v : null, digits)) + (isRate ? '%' : '') + '</span></div>'
      + '</div>'
      + (line ? '<section class="panel" style="margin-bottom:var(--s-5)"><div class="panel-title"><h3>走势</h3><span class="sub">' + esc(s.kind || '') + '</span></div><div class="sv-chart" role="img" aria-label="' + esc(desc) + '">' + line + '</div><p class="cmp-hint">' + esc(desc) + '</p></section>' : '')
      + (dd ? '<section class="panel" style="margin-bottom:var(--s-5)"><div class="panel-title"><h3>回撤</h3><span class="sub">从历史高点向下的距离</span></div><div class="sv-chart" role="img" aria-label="回撤曲线">' + dd + '</div></section>' : '')
      + '<section class="panel" style="margin-bottom:var(--s-5)"><div class="panel-title"><h3>最近 12 个点</h3><span class="sub">原样列出，不做加工</span></div><div class="tbl-wrap"><table class="sv-table"><thead><tr><th scope="col">日期</th><th scope="col">值</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>'
      + '<p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn ghost sm" href="data/history/' + encodeURIComponent(sid) + '.json" download>下载原始 JSON</a>'
      + '<a class="btn ghost sm" href="#/compare?ids=' + encodeURIComponent(sid + ',SPX') + '">在对比器里打开</a>'
      + '<a class="btn ghost sm" href="#/status">回数据台账</a></p>'
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');
  }

  async function renderStatus(view) {
    ensureCss();
    view.innerHTML = '<div class="art-head"><div class="eyebrow">数据台账</div><h1 style="font-size:var(--t-h1)">每个数字，都能回到它的文件</h1></div><div class="panel"><div class="skel" style="height:16px;width:40%"></div></div>';
    const reg = await window.History.registry();
    if (!view.isConnected) return;
    const series = ((reg && reg.series) || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!series.length) {
      view.innerHTML = '<div class="empty"><div class="et">序列注册表没读到</div><div class="ed">data/series-map.json 没加载出来。刷新页面再试。</div></div>';
      return;
    }
    const latest = series.reduce((m, s) => (String(s.to || '') > m ? String(s.to) : m), '');
    const latestMs = Date.parse(latest + 'T00:00:00Z');
    const stale = series.filter((s) => {
      const t = Date.parse(String(s.to || '') + 'T00:00:00Z');
      return isFinite(t) && isFinite(latestMs) && (latestMs - t) > 90 * 86400000;
    }).length;

    view.innerHTML = '<div class="art-head">'
      + '<div class="eyebrow">数据台账</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">每个数字，都能回到它的文件</h1>'
      + '<p class="art-dek">' + series.length + ' 条长历史序列，最新数据到 ' + esc(latest) + '。每条都写清来源与覆盖区间；点进去可以看图和原始 JSON。</p>'
      + '</div>'
      + '<div class="sv-meta">'
      + '<div class="sv-cell"><span class="sv-k">序列数</span><span class="sv-v">' + series.length + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">最新日期</span><span class="sv-v">' + esc(latest) + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">超过 90 天未更新</span><span class="sv-v">' + stale + '</span></div>'
      + '<div class="sv-cell"><span class="sv-k">注册表生成时间</span><span class="sv-v">' + esc(reg.generatedAt || '—') + '</span></div>'
      + '</div>'
      + '<div class="status-filter"><label for="status-q" class="sr-only">筛选序列</label><input id="status-q" type="search" placeholder="按名称 / id / 来源筛选"><span class="small muted" id="status-count"></span></div>'
      + '<div class="status-head"><span>序列</span><span>来源</span><span class="sr-hide">频率</span><span class="sr-hide">点数</span><span class="sr-hide">最新</span></div>'
      + '<div class="status-list" id="status-list"></div>'
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');

    const list = view.querySelector('#status-list');
    const input = view.querySelector('#status-q');
    const count = view.querySelector('#status-count');
    function row(s) {
      const t = Date.parse(String(s.to || '') + 'T00:00:00Z');
      const isStale = isFinite(t) && isFinite(latestMs) && (latestMs - t) > 90 * 86400000;
      return `<a class="status-row" href="#/series/${encodeURIComponent(s.id)}">`
        + '<span><span class="sr-name">' + esc(s.name || s.id) + '</span><span class="sr-id">' + esc(s.id) + '</span></span>'
        + '<span>' + esc(s.source || '—') + '</span>'
        + '<span class="sr-num sr-hide">' + esc(s.freq || '') + '</span>'
        + '<span class="sr-num sr-hide">' + esc(String(s.count || '')) + '</span>'
        + '<span class="sr-num sr-hide">' + esc(s.to || '') + (isStale ? ' <span class="sr-stale">偏旧</span>' : '') + '</span>'
        + '</a>';
    }
    function paint() {
      const q = String((input && input.value) || '').trim().toLowerCase();
      const hits = series.filter((s) => !q || [s.id, s.name, s.source, s.kind].join(' ').toLowerCase().indexOf(q) >= 0);
      if (list) list.innerHTML = hits.map(row).join('') || '<div class="empty"><div class="et">没有匹配的序列</div></div>';
      if (count) count.textContent = hits.length + ' / ' + series.length + ' 条';
    }
    if (input) input.addEventListener('input', paint);
    paint();
  }

  window.SeriesView = { render: renderSeries };
  window.StatusView = { render: renderStatus };
})();
