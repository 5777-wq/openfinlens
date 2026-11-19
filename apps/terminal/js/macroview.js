/* macroview.js —— 「宏观」tab 的策略面板（fxmacro）
   三块内容：① 中美国债收益率曲线与利差 ② 大类资产当日矩阵 ③ 宏观读数卡。
   数据零新增请求：全部读已轮询的 universe 行情（含扩容后的中债/美债期限点），
   轮询 tick 里由 app 调 patch() 原地更新数字，不重建折叠头、不丢悬停。 */

window.MacroView = (() => {
  'use strict';
  const U = window.U;
  const { escapeHTML, fmt, fmtPct, num } = U;
  const MC = window.MacroCalc;

  let root = null;
  let deps = {};                  // { getQuote, openDetail, targetFromSymbol }
  let built = false;
  let els = null;                 // { curveCn, curveUs, spreadBar, matrix, sigGrid, sub }

  const pctCls = (p) => (p === null || p === undefined || isNaN(p)) ? 'flat' : (p > 0 ? 'up' : p < 0 ? 'down' : 'flat');

  function mount(node, d) {
    root = node;
    deps = d || {};
    if (!root) return;
    buildShell();
    root.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-mcsym]');
      if (!cell || !deps.openDetail || !deps.targetFromSymbol) return;
      const t = deps.targetFromSymbol(cell.getAttribute('data-mcsym'));
      if (t) deps.openDetail(t);
    });
  }

  /* 骨架只建一次（折叠头/标题属于静态结构）；patch 只重绘各 body 容器 */
  function buildShell() {
    if (built) return;
    built = true;
    root.innerHTML = `
      <div class="section" data-fold>
        <div class="section-head">
          <h2 class="section-title">国债收益率曲线</h2>
          <span class="sec-line"></span>
          <span class="section-sub">东财 171 段国债收益率 · 当日读数</span>
        </div>
        <div class="mac-curves">
          <div class="mac-curve-col">
            <h3 class="mac-col-title">中国国债</h3>
            <div id="macCurveCn"><div class="sk sk-row"></div></div>
          </div>
          <div class="mac-curve-col">
            <h3 class="mac-col-title">美国国债</h3>
            <div id="macCurveUs"><div class="sk sk-row"></div></div>
          </div>
        </div>
        <div class="mac-spreads" id="macSpreadBar"></div>
        <p class="insight-disclaimer">收益率为二级市场到期收益率（日频口径）。利差为长端减短端，负值即倒挂；倒挂与否是市场定价的统计事实，本页只呈现读数，不构成任何判断或建议。</p>
      </div>
      <div class="section" data-fold>
        <div class="section-head">
          <h2 class="section-title">大类资产当日矩阵</h2>
          <span class="sec-line"></span>
          <span class="section-sub">股指 / 外汇 / 商品 / 利率 / 加密 · 复用已轮询行情，零新增请求</span>
        </div>
        <div id="macMatrix"><div class="sk sk-row"></div></div>
        <p class="insight-disclaimer">全部标的来自首页已轮询的行情全集，点击任意格子进 K 线详情。外汇与商品无免费历史K线源，所以只有当日涨跌，不提供区间表现。</p>
      </div>
      <div class="section" data-fold>
        <div class="section-head">
          <h2 class="section-title">宏观读数</h2>
          <span class="sec-line"></span>
          <span class="section-sub" id="macSigSub">—</span>
        </div>
        <div class="mac-sig-grid" id="macSigGrid"></div>
      </div>`;
    els = {
      curveCn: root.querySelector('#macCurveCn'),
      curveUs: root.querySelector('#macCurveUs'),
      spreadBar: root.querySelector('#macSpreadBar'),
      matrix: root.querySelector('#macMatrix'),
      sigGrid: root.querySelector('#macSigGrid'),
      sigSub: root.querySelector('#macSigSub'),
    };
  }

  function renderCurve(container, pts) {
    if (!container) return;
    if (!pts.length) {
      container.innerHTML = '<div class="empty">行情尚未到位，稍后自动补上</div>';
      return;
    }
    const max = Math.max(...pts.map(p => p.value)) * 1.15;
    container.innerHTML = pts.map(p => `
      <div class="mac-curve-row">
        <span class="mac-clabel">${escapeHTML(p.label)}</span>
        <span class="mac-cbar"><i style="width:${Math.min(100, p.value / max * 100).toFixed(1)}%"></i></span>
        <span class="num mac-cval">${fmt(p.value, 3)}%</span>
        <span class="num mac-cchg ${pctCls(p.chg)}">${p.chg === null ? '--' : (p.chg > 0 ? '+' : '') + (p.chg * 100).toFixed(1) + 'bp'}</span>
      </div>`).join('');
  }

  function renderSpreads(usPts) {
    if (!els.spreadBar) return;
    const items = MC.spreads(usPts);
    els.spreadBar.innerHTML = items.map(({ id, label, s }) => {
      const v = s ? s.value * 100 : null;
      return `<span class="mac-spread ${s && s.inverted ? 'inv' : ''}" title="${id}">
        <b>${escapeHTML(label)}</b>
        <span class="num">${v === null ? '--' : (v > 0 ? '+' : '') + v.toFixed(1) + ' bp'}</span>
        ${s && s.inverted ? '<i>倒挂</i>' : ''}
      </span>`;
    }).join('');
  }

  function renderMatrix(quotes) {
    if (!els.matrix) return;
    const groups = MC.crossAssetRows(quotes);
    if (!groups.length) {
      els.matrix.innerHTML = '<div class="empty">行情尚未到位，稍后自动补上</div>';
      return;
    }
    els.matrix.innerHTML = groups.map(g => `
      <div class="mac-group">
        <h3 class="mac-col-title">${escapeHTML(g.label)}</h3>
        <div class="mac-chips">
          ${g.items.map(it => `
            <button class="mac-chip" data-mcsym="${escapeHTML(it.symbol)}"
              title="${escapeHTML(it.name)} · 点击进K线">
              <span class="mc-name">${escapeHTML(it.name)}</span>
              <span class="num mc-price">${fmt(it.price, it.price >= 1000 ? 2 : 4)}</span>
              <span class="num mc-pct ${pctCls(it.changePct)}">${fmtPct(it.changePct)}</span>
            </button>`).join('')}
        </div>
      </div>`).join('');
  }

  function renderSignals(quotes) {
    if (!els.sigGrid) return;
    const sigs = MC.signals(quotes);
    const filled = sigs.filter(s => s.value !== null).length;
    if (els.sigSub) els.sigSub.textContent = filled ? `${filled} 项读数 · 当日口径` : '—';
    els.sigGrid.innerHTML = sigs.map(s => `
      <div class="sig-card ${s.inverted ? 'inv' : ''}">
        <div class="sig-label">${escapeHTML(s.label)}</div>
        <div class="sig-value num">${s.value === null ? '--' :
          (s.unit === 'bp' ? (s.value > 0 ? '+' : '') + s.value.toFixed(1) : fmt(s.value, 2))}
          <small>${escapeHTML(s.unit || '')}</small></div>
        ${s.changePct !== undefined && s.changePct !== null
          ? `<div class="sig-extra num ${pctCls(s.changePct)}">当日 ${fmtPct(s.changePct)}</div>` : ''}
        <div class="sig-caption">${escapeHTML(s.caption || '')}</div>
      </div>`).join('');
  }

  function render() {
    if (!root || !built || !deps.getQuote) return;
    // getQuote 包一层 Map 形状，供 MacroCalc 复用同一套取数口径
    const qmap = {
      get: (sym) => { const q = deps.getQuote(sym); return q || undefined; },
    };
    const cn = MC.yieldCurve(qmap, 'cn');
    const us = MC.yieldCurve(qmap, 'us');
    renderCurve(els.curveCn, cn);
    renderCurve(els.curveUs, us);
    renderSpreads(us);
    renderMatrix(qmap);
    renderSignals(qmap);
  }

  const onEnter = render;
  const patch = render;

  return { mount, onEnter, patch };
})();
