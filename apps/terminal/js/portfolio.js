/* portfolio.js —— 「持仓」页：本机记账 + 实时盈亏
   持仓（代码/数量/成本）只存 localStorage（Store.portfolio）；行情全部来自已轮询池，
   多币种折算用同一池里的 USDCNH / USDHKD 交叉价——缺汇率就不给人民币合计，
   绝不拼一个"部分按旧汇率"的总数（口径见 portfoliomath.js）。
   红线：只做记录与统计，没有任何交易入口，也不出现成交量字段。 */

window.PortfolioView = (() => {
  'use strict';
  const U = window.U;
  const { escapeHTML, fmt, fmtPct, debounce } = U;
  const PM = window.PortfolioMath;

  let root = null;
  let deps = {};                 // { getQuote, openDetail, targetFromSymbol, search }
  let els = null;
  let editId = null;             // 正在编辑的持仓 id（null = 新增模式）
  let pending = null;            // 搜索选中的待记账标的
  let searchItems = [];
  let searchGen = 0;
  let lastSnapAt = 0;            // 快照写盘节流（同一次 patch 里只算一次）

  const pctCls = (p) => (p === null || p === undefined || isNaN(p)) ? 'flat' : (p > 0 ? 'up' : p < 0 ? 'down' : 'flat');
  // 份额显示：整数不带小数；碎股（<1，如 0.2 BTC）保留 4 位，其余 2 位
  const fmtShares = (n) => (Number.isInteger(n) ? fmt(n, 0) : fmt(n, Math.abs(n) < 1 ? 4 : 2));
  const curLabel = (c) => ({ CNY: '¥', HKD: 'HK$', USD: '$' }[c] || c || '');

  function mount(node, d) {
    root = node;
    deps = d || {};
    if (!root) return;
    buildShell();
    bind();
    render();
  }

  function buildShell() {
    root.innerHTML = `
      <div class="port-stats" id="portStats"><div class="sk sk-row"></div></div>

      <div class="heat-toolbar port-addbar" id="portAddBar">
        <span class="search-wrap port-search">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="portInput" class="search-input" type="search" autocomplete="off"
            placeholder="搜代码或名称（A股 / 港股 / 美股 / BTCUSDT）"
            aria-label="搜索要记录的标的" aria-controls="portResults" aria-autocomplete="list">
          <div id="portResults" class="search-results" role="listbox"></div>
        </span>
        <input id="portShares" class="port-num" type="number" min="0" step="any" placeholder="数量（股/份）" aria-label="持仓数量">
        <input id="portCost" class="port-num" type="number" min="0" step="any" placeholder="成本价（可空）" aria-label="成本价">
        <button id="portSave" class="icon-btn">记一笔</button>
        <button id="portCancel" class="pill" hidden>取消编辑</button>
        <span class="tool-status" id="portStatus">—</span>
      </div>

      <div id="portTable"></div>

      <div class="section" data-fold id="portCurveSec">
        <div class="section-head">
          <h2 class="section-title">资产曲线</h2>
          <span class="sec-line"></span>
          <span class="section-sub" id="portCurveSub">—</span>
        </div>
        <div class="port-curve-wrap"><canvas id="portCurve" height="130" role="img" aria-label="组合总市值快照曲线"></canvas>
          <div class="empty" id="portCurveEmpty" hidden></div>
        </div>
        <p class="insight-disclaimer">每个自然日记录一次总市值快照（当天以最后一次打开为准），只存本机浏览器。按可折算币种合计，缺汇率的日子不计入。历史事实记录，不构成任何建议。</p>
      </div>`;
    els = {
      stats: root.querySelector('#portStats'),
      input: root.querySelector('#portInput'),
      results: root.querySelector('#portResults'),
      shares: root.querySelector('#portShares'),
      cost: root.querySelector('#portCost'),
      save: root.querySelector('#portSave'),
      cancel: root.querySelector('#portCancel'),
      status: root.querySelector('#portStatus'),
      table: root.querySelector('#portTable'),
      curve: root.querySelector('#portCurve'),
      curveEmpty: root.querySelector('#portCurveEmpty'),
      curveSub: root.querySelector('#portCurveSub'),
    };
  }

  function bind() {
    const doSearch = debounce((kw) => runSearch(kw), 250);
    els.input.addEventListener('input', (e) => doSearch(e.target.value.trim()));
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(searchItems.length ? 0 : -1);
      } else if (e.key === 'Escape') {
        els.results.classList.remove('active');
      }
    });
    els.results.addEventListener('click', (e) => {
      const it = e.target.closest('.sr-item');
      if (it) pick(+it.dataset.idx);
    });
    els.save.addEventListener('click', save);
    els.cancel.addEventListener('click', () => setEdit(null));
    root.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-portedit]');
      const delBtn = e.target.closest('[data-portdel]');
      if (editBtn) { startEdit(editBtn.getAttribute('data-portedit')); return; }
      if (delBtn) { confirmDel(delBtn); return; }
      const row = e.target.closest('[data-porthold]');
      if (row && !e.target.closest('button')) {
        const h = find(row.getAttribute('data-porthold'));
        if (h && deps.openDetail) {
          // 直接用持仓自带的市场/secid 构造目标：冷门票不在行情池里时照样能进详情
          const t = h.market === 'crypto'
            ? { symbol: h.symbol, name: h.name, code: h.code || h.symbol, market: 'crypto', binance: h.symbol }
            : h.secid
              ? { symbol: h.symbol, name: h.name, code: h.code || h.symbol, market: h.market, secid: h.secid,
                  tencent: deps.tencentOfSecid ? deps.tencentOfSecid(h.secid) : undefined }
              : (deps.targetFromSymbol ? deps.targetFromSymbol(h.symbol) : null);
          if (t) deps.openDetail(t);
        }
      }
    });
  }

  function find(id) { return window.Store.portfolio.all().find(x => x.id === id) || null; }

  async function runSearch(kw) {
    if (!kw) { ++searchGen; els.results.classList.remove('active'); return; }
    // 直接输 BTCUSDT / ETHUSDT 这类币对：本地就能确定标的，不必等搜索接口
    if (/^[A-Z0-9]{4,11}USDT$/i.test(kw)) {
      searchItems = [{ symbol: kw.toUpperCase(), name: kw.toUpperCase(), market: 'crypto', raw: true }];
      paintResults('币安币对（按回车选中）');
      return;
    }
    const gen = ++searchGen;
    const list = deps.search ? await deps.search(kw).catch(() => []) : [];
    if (gen !== searchGen) return;
    searchItems = list;
    paintResults(list.length ? '' : '没有匹配的标的');
  }

  function paintResults(emptyMsg) {
    if (!searchItems.length) {
      els.results.innerHTML = emptyMsg ? `<div class="sr-empty">${escapeHTML(emptyMsg)}</div>` : '';
      els.results.classList.add('active');
      return;
    }
    els.results.innerHTML = searchItems.map((x, i) => `<div class="sr-item" data-idx="${i}" role="option">
      <span class="sr-name">${escapeHTML(x.name)}</span>
      <span class="sr-code num">${escapeHTML(x.code || x.symbol)}</span>
      <span class="sr-mkt">${escapeHTML(x.marketName || '')}</span>
    </div>`).join('');
    els.results.classList.add('active');
  }

  function pick(i) {
    const x = searchItems[i];
    if (!x) return;
    els.results.classList.remove('active');
    els.input.value = '';
    searchItems = [];
    // EM 搜索结果 → 统一 symbol（与 app 的 targetFromHashSymbol 同一映射思路）
    let t;
    if (x.raw) {
      t = { symbol: x.symbol, name: x.name, code: x.symbol, market: 'crypto', binance: x.symbol };
    } else if (x.secid) {
      t = { symbol: 'EM:' + x.secid, name: x.name, code: x.code, secid: x.secid, market: deps.marketOfSecid ? deps.marketOfSecid(x.secid) : 'cn' };
    } else {
      t = { symbol: x.symbol, name: x.name, code: x.code || x.symbol, market: x.market || 'cn' };
    }
    pending = t;
    setStatus(`已选 ${t.name}，填数量后记账`);
    els.shares.focus();
  }

  function setStatus(msg) { if (els.status) els.status.textContent = msg; }

  function startEdit(id) {
    const h = find(id);
    if (!h) return;
    editId = id;
    pending = { symbol: h.symbol, name: h.name, code: h.code, market: h.market, secid: h.secid };
    els.shares.value = h.shares;
    els.cost.value = (h.cost === null || h.cost === undefined) ? '' : h.cost;
    els.save.textContent = '保存修改';
    els.cancel.hidden = false;
    setStatus(`正在编辑 ${h.name}`);
  }

  function setEdit(id) {
    editId = id;
    if (!id) {
      pending = null;
      els.shares.value = '';
      els.cost.value = '';
      els.save.textContent = '记一笔';
      els.cancel.hidden = true;
      setStatus('—');
    }
  }

  let delArm = null;   // { id, timer }：二次确认删除，防误触且不用弹窗打断
  function confirmDel(btn) {
    const id = btn.getAttribute('data-portdel');
    if (delArm && delArm.id === id) {
      clearTimeout(delArm.timer);
      delArm = null;
      window.Store.portfolio.remove(id);
      if (editId === id) setEdit(null);
      render();
      setStatus('已删除');
      return;
    }
    if (delArm) clearTimeout(delArm.timer);
    btn.textContent = '确认删除';
    btn.classList.add('armed');
    delArm = { id, timer: setTimeout(() => { delArm = null; render(); }, 2600) };
  }

  function save() {
    if (!pending) { setStatus('先在上面选一个标的'); return; }
    const shares = Number(els.shares.value);
    const cost = els.cost.value === '' ? null : Number(els.cost.value);
    if (!(shares > 0)) { setStatus('数量要大于 0'); return; }
    if (cost !== null && !(cost >= 0)) { setStatus('成本价不能是负数'); return; }
    const list = window.Store.portfolio.all();
    if (editId) {
      window.Store.portfolio.update(editId, { shares, cost, name: pending.name });
      setStatus('已保存修改');
    } else {
      const dup = list.find(x => x.symbol === pending.symbol);
      if (dup) {
        window.Store.portfolio.update(dup.id, { shares: dup.shares + shares, cost });
        setStatus(`同一标的已存在，已合并数量（现 ${dup.shares + shares}）`);
      } else {
        window.Store.portfolio.add({
          symbol: pending.symbol, name: pending.name, code: pending.code || '',
          market: pending.market || 'cn', secid: pending.secid || '', shares, cost,
        });
        setStatus(`已记录 ${pending.name}`);
      }
    }
    setEdit(null);
    render();
    // 新标的可能在轮询全集之外，让 app 补抓一轮
    if (deps.onHoldingsChanged) deps.onHoldingsChanged();
  }

  /* ---- 渲染 ---- */

  function render() { patch(); }

  function patch() {
    if (!root || !els) return;
    const holdings = window.Store.portfolio.all();
    const fx = deps.getQuote ? PM.fxFromQuotes({ get: (s) => deps.getQuote(s) || undefined }) : { USD: null, HKD: null };
    const val = PM.valuation(holdings, (s) => (deps.getQuote ? deps.getQuote(s) : null) || null, fx);
    renderStats(val);
    renderTable(val);
    renderCurve(val);
  }

  function renderStats(val) {
    const t = val.totals;
    const n = val.rows.length;
    const cny = t.cny;
    const byCur = Object.keys(t.byCur).map(c => {
      const b = t.byCur[c];
      return `${curLabel(c)} ${fmt(b.value, b.value >= 10000 ? 0 : 2)}`;
    }).join(' · ');
    els.stats.innerHTML = `
      <div class="pstat"><div class="pstat-label">总市值（折合）</div>
        <div class="pstat-value num">${cny.converted ? '¥' + fmt(cny.value, 2) : '--'}</div>
        <div class="pstat-sub">${byCur || '还没有记录'}</div></div>
      <div class="pstat"><div class="pstat-label">持仓盈亏</div>
        <div class="pstat-value num ${pctCls(cny.pnl)}">${cny.converted && cny.pnl !== null ? '¥' + fmt(cny.pnl, 2) : '--'}</div>
        <div class="pstat-sub">按成本价与最新行情估算</div></div>
      <div class="pstat"><div class="pstat-label">当日盈亏</div>
        <div class="pstat-value num ${pctCls(cny.dayPnl)}">${cny.converted && cny.dayPnl !== null ? '¥' + fmt(cny.dayPnl, 2) : '--'}</div>
        <div class="pstat-sub">昨收价差口径</div></div>
      <div class="pstat"><div class="pstat-label">持仓只数</div>
        <div class="pstat-value num">${n}</div>
        <div class="pstat-sub">${cny.converted ? '汇率取自离岸人民币实时行情' : '缺汇率档，暂不折算合计'}</div></div>`;
  }

  function renderTable(val) {
    if (!val.rows.length) {
      els.table.innerHTML = `<div class="empty-hint">还没有持仓记录。在上面搜一个标的、填上数量和成本价，行情到位后这里会实时算出市值与盈亏。所有记录只保存在本机浏览器。</div>`;
      return;
    }
    els.table.innerHTML = `<div class="prow-head" aria-hidden="true">
        <span>标的</span><span>现价</span><span>当日</span><span>数量</span><span>成本价</span>
        <span>市值</span><span>持仓盈亏</span><span>当日盈亏</span><span></span>
      </div>` + val.rows.map(r => {
      const h = r.holding;
      return `<div class="prow" data-porthold="${escapeHTML(h.id)}" tabindex="0" role="button"
          aria-label="${escapeHTML(h.name)} 市值 ${r.value === null ? '未知' : fmt(r.value, 2)}">
        <span class="pr-name">${escapeHTML(h.name)}<span class="pr-code num">${escapeHTML(h.code || h.symbol)}</span></span>
        <span class="num">${r.currency === 'USD' ? '$' : r.currency === 'HKD' ? 'HK$' : '¥'}${fmt(r.price, 2)}</span>
        <span class="num ${pctCls(r.changePct)}">${fmtPct(r.changePct)}</span>
        <span class="num">${fmtShares(r.holding.shares)}</span>
        <span class="num">${r.holding.cost === null || r.holding.cost === undefined ? '--' : fmt(r.holding.cost, 2)}</span>
        <span class="num">${r.value === null ? '--' : curLabel(r.currency) + fmt(r.value, r.value >= 10000 ? 0 : 2)}</span>
        <span class="num ${pctCls(r.pnl)}">${r.pnl === null ? '--'
          : `${curLabel(r.currency)}${fmt(r.pnl, 2)}<i>(${fmtPct(r.pnlPct)})</i>`}</span>
        <span class="num ${pctCls(r.dayPnl)}">${r.dayPnl === null ? '--' : curLabel(r.currency) + fmt(r.dayPnl, 2)}</span>
        <span class="pr-ops">
          <button class="pill pr-op" data-portedit="${escapeHTML(h.id)}">编辑</button>
          <button class="pill pr-op danger" data-portdel="${escapeHTML(h.id)}">删除</button>
        </span>
      </div>`;
    }).join('');
  }

  function renderCurve(val) {
    const cny = val.totals.cny;
    const now = Date.now();
    if (cny.converted && cny.value > 0 && now - lastSnapAt > 5000) {
      lastSnapAt = now;
      window.Store.portSnaps.push(PM.localDateStr(now), cny.value);
    }
    const hist = window.Store.portSnaps.all();
    if (els.curveSub) {
      els.curveSub.textContent = hist.length
        ? `${hist.length} 个快照 · 最新 ${hist[hist.length - 1].d}`
        : '—';
    }
    drawCurve(hist);
  }

  function drawCurve(hist) {
    const cv = els.curve;
    if (!cv) return;
    if (!hist || hist.length < 2) {
      cv.hidden = true;
      els.curveEmpty.hidden = false;
      els.curveEmpty.textContent = hist.length === 1
        ? `已有 1 个快照（${hist[0].d}）。明天再打开一次，这里就会开始连线。`
        : '记录持仓后，每个自然日会落一个总市值快照，两天起连线。';
      return;
    }
    cv.hidden = false;
    els.curveEmpty.hidden = true;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || cv.parentElement.clientWidth || 600;
    const h = 130;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 8, r: 56, t: 12, b: 18 };
    const vals = hist.map(x => x.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = (max - min) || max * 0.01 || 1;
    const X = (i) => pad.l + (w - pad.l - pad.r) * (i / (vals.length - 1));
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / span);
    const css = getComputedStyle(document.documentElement);
    const up = css.getPropertyValue('--up').trim() || '#2ebd85';
    const down = css.getPropertyValue('--down').trim() || '#f6465d';
    const last = vals[vals.length - 1], first = vals[0];
    const color = last >= first ? up : down;
    // 网格与首末标签
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px sans-serif';
    [min, max].forEach(v => {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmt(v, v >= 10000 ? 0 : 2), w - pad.r + 6, y + 4);
    });
    // 面积 + 线
    ctx.beginPath();
    hist.forEach((pt, i) => { const x = X(i), y = Y(pt.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(X(vals.length - 1), h - pad.b);
    ctx.lineTo(X(0), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = last >= first ? 'rgba(46,189,133,0.10)' : 'rgba(246,70,93,0.10)';
    ctx.fill();
    // 日期端点
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(hist[0].d, pad.l, h - 4);
    const lastLbl = hist[hist.length - 1].d;
    ctx.fillText(lastLbl, w - pad.r - ctx.measureText(lastLbl).width, h - 4);
  }

  return { mount, patch, onEnter: patch };
})();
