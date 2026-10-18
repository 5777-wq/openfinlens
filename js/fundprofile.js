/* fundprofile.js —— 「基金」页的画像子面板（对比/画像两个子视图，切换归 app 管）
   数据两路（免密钥）：
     ① fund.eastmoney.com/pingzhongdata/{code}.js —— 档案/净值/收益/排名/规模/申赎/结构/配置/经理
        （以 script 标签加载，不受 CORS 限制，本地 file:// 也能跑）
     ② fundmobapi FundMNInverstPosition —— 重仓股（CORS *，直接 fetch）
   解析在 fundparse.js（纯函数），本文件只负责取数、降级与渲染。
   安全面：唯一外部输入是基金代码，sanitizeCode 用纯数字捕获组收口，原始参数到不了任何 URL。
   红线：只呈现公开披露的历史数据，不给任何操作引导，不构成建议。 */

window.FundProfile = (() => {
  'use strict';
  const U = window.U;
  const { escapeHTML, fmt, num, fmtDay } = U;
  const FP = window.FundParse;

  const PRESETS = [
    { code: '005827', label: '易方达蓝筹精选' },
    { code: '110011', label: '易方达优质精选' },
    { code: '163406', label: '兴全合润' },
    { code: '260108', label: '景顺长城新兴成长' },
    { code: '161725', label: '招商中证白酒' },
  ];

  // pingzhongdata 会往 window 写一串 var；取完就删，不留 300KB 全局垃圾
  const PZ_GLOBALS = ['fS_name', 'fS_code', 'fund_sourceRate', 'fund_Rate', 'fund_minsg',
    'syl_1n', 'syl_6y', 'syl_3y', 'syl_1y', 'stockCodes', 'Data_fundSharesPositions',
    'Data_netWorthTrend', 'Data_ACWorthTrend', 'Data_grandTotal', 'Data_rateInSimilarType',
    'Data_rateInSimilarPersent', 'Data_fluctuationScale', 'Data_holderStructure',
    'Data_assetAllocation', 'Data_performanceEvaluation', 'Data_currentFundManager',
    'Data_buySedemption'];

  let root = null;
  let deps = {};                 // { openDetail, marketOfSecid, tencentOfSecid }
  let els = null;
  let cache = new Map();         // code → { at, data, stocks }
  const TTL = 10 * 60 * 1000;

  function mount(node, d) {
    root = node;
    deps = d || {};
    if (!root) return;
    buildShell();
    bind();
  }

  function buildShell() {
    root.innerHTML = `
      <div class="cmp-bar">
        <span class="search-wrap cmp-search">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="fpInput" class="search-input" type="search" autocomplete="off"
            placeholder="输入 6 位基金代码后回车（005827 / 161725）"
            aria-label="基金代码" aria-controls="fpResults" aria-autocomplete="list">
          <div id="fpResults" class="search-results" role="listbox"></div>
        </span>
        <button id="fpGo" class="icon-btn">查询</button>
        <span class="tool-status" id="fpStatus">天天基金公开披露 · 免密钥</span>
      </div>
      <div class="cmp-presets" id="fpPresets">
        ${PRESETS.map(p => `<button class="pill" data-fpcode="${p.code}">${escapeHTML(p.label)}</button>`).join('')}
      </div>
      <div id="fpBody"></div>`;
    els = {
      input: root.querySelector('#fpInput'),
      results: root.querySelector('#fpResults'),
      go: root.querySelector('#fpGo'),
      status: root.querySelector('#fpStatus'),
      presets: root.querySelector('#fpPresets'),
      body: root.querySelector('#fpBody'),
    };
  }

  function bind() {
    els.go.addEventListener('click', () => open(els.input.value.trim()));
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); open(els.input.value.trim()); }
      else if (e.key === 'Escape') els.results.classList.remove('active');
    });
    els.input.addEventListener('input', () => {
      const kw = els.input.value.trim();
      if (/^\d{6}$/.test(kw)) {
        els.results.innerHTML = `<div class="sr-item" data-fpenter="${kw}" role="option">
          <span class="sr-name">基金 ${kw}</span><span class="sr-code num">${kw}</span>
          <span class="sr-mkt">回车查询画像</span></div>`;
        els.results.classList.add('active');
      } else els.results.classList.remove('active');
    });
    els.results.addEventListener('click', (e) => {
      const it = e.target.closest('[data-fpenter]');
      if (it) { els.results.classList.remove('active'); open(it.getAttribute('data-fpenter')); }
    });
    els.presets.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fpcode]');
      if (b) { els.input.value = b.getAttribute('data-fpcode'); open(b.getAttribute('data-fpcode')); }
    });
    els.body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-fpstock]');
      if (!row || !deps.openDetail) return;
      const secid = row.getAttribute('data-fpstock');
      const name = row.getAttribute('data-fpstockname') || secid;
      const market = deps.marketOfSecid ? deps.marketOfSecid(secid) : 'cn';
      deps.openDetail({
        symbol: 'EM:' + secid, name, code: secid.split('.')[1], market, secid,
        tencent: deps.tencentOfSecid ? deps.tencentOfSecid('EM:' + secid) : undefined,
      });
    });
  }

  function setStatus(msg) { if (els.status) els.status.textContent = msg; }

  /* ---- 取数 ---- */

  // 经典跨域脚本加载：script 标签不受 CORS 限制，顶层 var 落到 window；超时兜底防挂死
  function loadScript(src, { timeout = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error('timeout')); } }, timeout);
      s.onload = () => { if (!done) { done = true; clearTimeout(timer); s.remove(); resolve(); } };
      s.onerror = () => { if (!done) { done = true; clearTimeout(timer); s.remove(); reject(new Error('script error')); } };
      s.src = src;
      document.head.appendChild(s);
    });
  }

  function harvest(globals) {
    const got = {};
    globals.forEach(k => {
      got[k] = typeof window !== 'undefined' ? window[k] : undefined;
      try { delete window[k]; } catch { /* 只读环境忽略 */ }
    });
    return got;
  }

  // 唯一合法输入形态：5~6 位纯数字基金代码。原始参数（hash/输入框）必须先过这里，
  // 之后所有取数只用捕获组结果，污点链在源头截断
  function sanitizeCode(raw) {
    const m = String(raw == null ? '' : raw).trim().match(/^(\d{5,6})$/);
    return m ? m[1] : null;
  }

  async function fetchProfile(code) {
    const hit = cache.get(code);
    if (hit && Date.now() - hit.at < TTL) return hit;
    const c = sanitizeCode(code);
    if (!c) return null;
    // 两路互不依赖；重仓股失败只隐藏对应卡，不拖垮整页。
    // 重仓股主源 mobapi（CORS *），但个别代理出口会被它拒绝 → 兜底用 pingzhongdata 的
    // stockCodes 名单（无占比，如实标注）；jjcc .aspx 因 Referer 防盗链弃用。
    let got = null;
    const [pzVals, mobStocks] = await Promise.all([
      loadScript('https://fund.eastmoney.com/pingzhongdata/' + encodeURIComponent(c) + '.js')
        .then(() => { got = harvest(PZ_GLOBALS); return FP.normalizePingzhong(got); })
        .catch(() => null),
      U.request('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=' +
          encodeURIComponent(c) + '&deviceid=wap&plat=Wap&product=EFund&version=6.2.8')
        .then(j => FP.normalizeInverst(j && j.Datas))
        .catch(() => null),
    ]);
    if (!pzVals) return null;
    const stocks = mobStocks || FP.parseStockCodes(got.stockCodes);
    const rec = { at: Date.now(), data: pzVals, stocks };
    cache.set(c, rec);
    return rec;
  }

  async function open(raw) {
    const code = sanitizeCode(raw);
    if (!code) { setStatus('请输入 5~6 位数字基金代码'); return; }
    if (!els) return;
    els.results.classList.remove('active');
    els.body.innerHTML = '<div class="sk sk-row"></div>';
    setStatus('拉取公开披露数据…');
    const rec = await fetchProfile(code).catch(() => null);
    if (!rec) {
      els.body.innerHTML = '<div class="empty">取不到这只基金的公开数据：代码可能不存在，或数据源暂时不可达（稍后重试）</div>';
      setStatus('查询失败');
      return;
    }
    setStatus(`${rec.data.name} · ${rec.data.code}`);
    render(rec);
  }

  /* ---- 渲染 ---- */

  function section(no, title, sub, bodyHTML, fold = true) {
    return `<div class="section"${fold ? ' data-fold' : ''}>
      <div class="section-head">
        <span class="sec-no">${no}</span>
        <h2 class="section-title">${escapeHTML(title)}</h2>
        <span class="sec-line"></span>
        <span class="section-sub">${sub}</span>
      </div>
      ${bodyHTML}
    </div>`;
  }

  function render(rec) {
    const d = rec.data;
    const parts = [];

    /* 档案头：不折叠，一眼看到这只基金是什么 */
    parts.push(`<div class="fp-head">
      <div class="fp-title"><h2 class="section-title">${escapeHTML(d.name)}</h2>
        <span class="num fp-code">${escapeHTML(d.code)}</span></div>
      <div class="fp-meta">
        ${d.rateNew !== null ? `<span>申购费率 ${fmt(d.rateOld, 2)}% → ${fmt(d.rateNew, 2)}%</span>` : ''}
        ${d.minBuy ? `<span>最小申购 ${escapeHTML(d.minBuy)} 元</span>` : ''}
        ${d.position ? `<span>股票仓位 ${fmt(d.position.pct, 2)}%</span>` : ''}
        ${d.managers && d.managers.length ? `<span>经理 ${d.managers.map(m => escapeHTML(m.name)).join('、')}</span>` : ''}
      </div></div>`);

    /* 01 阶段收益与同类排名 */
    const rk = d.rank;
    parts.push(section('01', '阶段收益与同类排名',
      rk ? `同类排名 ${rk.rank}${rk.total ? ' / ' + rk.total : ''}${rk.percent !== null ? ' · 百分位 ' + fmt(rk.percent, 1) + '%' : ''}` : '排名数据缺失',
      `<div class="fp-returns">
        ${[['近1月', d.returns.m1], ['近3月', d.returns.m3], ['近6月', d.returns.m6], ['近1年', d.returns.y1]]
          .map(([lb, v]) => `<div class="fp-ret"><span class="fp-ret-label">${lb}</span>
            <span class="num fp-ret-val ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v === null ? '--' : (v > 0 ? '+' : '') + fmt(v, 2) + '%'}</span></div>`).join('')}
      </div>
      <p class="insight-disclaimer">阶段收益与同类排名来自基金销售平台的公开披露，历史业绩不代表未来表现。</p>`));

    /* 02 净值走势（单位净值） */
    if (d.netWorth && d.netWorth.length > 1) {
      parts.push(section('02', '净值走势',
        `单位净值 · ${d.netWorth.length} 个交易日 · ${fmtDay(d.netWorth[0].t)} 至 ${fmtDay(d.netWorth[d.netWorth.length - 1].t)}`,
        `<div class="fp-chart-wrap"><canvas id="fpNetChart" height="220" role="img"
          aria-label="${escapeHTML(d.name)} 单位净值走势"></canvas></div>
        <p class="insight-disclaimer">口径是<strong>单位净值</strong>（未含分红再投资）；累计净值含分红口径如需另查，两者差异大时以累计为准。</p>`));
    }

    /* 03 五维评价 */
    if (d.perfEval && d.perfEval.scores.some(s => s !== null)) {
      const pe = d.perfEval;
      parts.push(section('03', '五维评价',
        `综合 ${pe.avr === null ? '--' : fmt(pe.avr, 1)} 分（平台口径）`,
        `<div class="fp-bars">${pe.categories.map((c, i) => `
          <div class="fp-bar-row"><span class="fp-bar-label">${escapeHTML(c)}</span>
            <span class="fp-bar"><i style="width:${Math.max(0, Math.min(100, pe.scores[i] || 0)).toFixed(0)}%"></i></span>
            <span class="num fp-bar-val">${pe.scores[i] === null ? '--' : fmt(pe.scores[i], 0)}</span></div>`).join('')}
        </div>
        <p class="insight-disclaimer">五维评价是数据平台按历史数据打的分（0~100），只反映过去，不构成任何判断。</p>`));
    }

    /* 04 规模与申赎 */
    if (d.scale || d.buyRedeem) {
      let body = '';
      if (d.scale) {
        body += `<h3 class="fp-sub">规模（亿元）</h3><div class="fp-bars">${
          d.scale.cats.map((c, i) => `
          <div class="fp-bar-row"><span class="fp-bar-label">${escapeHTML(c)}</span>
            <span class="fp-bar"><i style="width:${barPct(d.scale.vals[i], d.scale.vals)}%"></i></span>
            <span class="num fp-bar-val">${d.scale.vals[i] === null ? '--' : fmt(d.scale.vals[i], 2)}${d.scale.mom[i] ? `<i class="fp-mom">${escapeHTML(d.scale.mom[i])}</i>` : ''}</span></div>`).join('')}</div>`;
      }
      if (d.buyRedeem) {
        body += `<h3 class="fp-sub">申购 / 赎回（亿份）</h3>
          <div class="fp-table">
            <div class="fp-tr fp-th"><span>报告期</span><span>期间申购</span><span>期间赎回</span><span>总份额</span></div>
            ${d.buyRedeem.cats.map((c, i) => `<div class="fp-tr">
              <span class="num">${escapeHTML(c)}</span>
              <span class="num">${fmt(arrAt(d.buyRedeem.sub, i), 2)}</span>
              <span class="num">${fmt(arrAt(d.buyRedeem.red, i), 2)}</span>
              <span class="num">${fmt(arrAt(d.buyRedeem.shares, i), 2)}</span></div>`).join('')}
          </div>`;
      }
      parts.push(section('04', '规模与申赎', '定期报告披露口径', body));
    }

    /* 05 持有人结构与资产配置 */
    if (d.holders || d.alloc) {
      let body = '';
      if (d.holders) {
        const i = d.holders.inst ? d.holders.inst.length - 1 : -1;
        if (i >= 0) {
          body += `<h3 class="fp-sub">持有人结构（最新一期 ${escapeHTML(String(arrAt(d.holders.cats, i) || ''))}）</h3>
          <div class="fp-stack">
            ${stackSeg('机构', arrAt(d.holders.inst, i), 'var(--accent-signature)')}
            ${stackSeg('个人', arrAt(d.holders.personal, i), 'rgba(77,182,172,0.75)')}
            ${stackSeg('内部', arrAt(d.holders.internal, i), 'rgba(255,255,255,0.35)')}
          </div>`;
        }
      }
      if (d.alloc) {
        const i = d.alloc.stock ? d.alloc.stock.length - 1 : -1;
        if (i >= 0) {
          body += `<h3 class="fp-sub">资产配置（最新一期占净比）</h3>
          <div class="fp-stack">
            ${stackSeg('股票', arrAt(d.alloc.stock, i), 'var(--up)')}
            ${stackSeg('债券', arrAt(d.alloc.bond, i), 'var(--accent-signature)')}
            ${stackSeg('现金', arrAt(d.alloc.cash, i), 'rgba(255,255,255,0.35)')}
          </div>`;
        }
      }
      if (body) parts.push(section('05', '持有人与资产配置', '定期报告披露', body + '<p class="insight-disclaimer">占比为定期报告披露口径，滞后于报告期，不是实时仓位。</p>'));
    }

    /* 06 重仓股：主源 mobapi（含占净值比与环比）；代理出口被拒时降级为披露名单（无占比，如实标注） */
    if (rec.stocks && rec.stocks.length) {
      const withPct = rec.stocks.some(s => s.pct !== null);
      parts.push(section('06', '重仓股', (withPct ? `披露口径 · 共 ${rec.stocks.length} 只` : '持仓股票名单 · 披露顺序，无占比口径') + ' · 点击行进K线',
        `<div class="fp-table">
          <div class="fp-tr fp-th"><span>#</span><span>股票</span><span>${withPct ? '占净值比' : '代码'}</span><span>${withPct ? '环比' : '市场'}</span></div>
          ${rec.stocks.map((s, i) => `<div class="fp-tr fp-click" data-fpstock="${escapeHTML(s.secid)}"
            data-fpstockname="${escapeHTML(s.name || s.code)}" tabindex="0" role="button"
            aria-label="${escapeHTML(s.name || s.code)}${s.pct === null ? '' : ' 占净值比 ' + fmt(s.pct, 2) + '%'}">
            <span class="num">${String(i + 1).padStart(2, '0')}</span>
            <span>${escapeHTML(s.name || '')}<span class="num fp-stock-code">${escapeHTML(s.code)}</span></span>
            <span class="num">${withPct ? (s.pct === null ? '--' : fmt(s.pct, 2) + '%') : ''}</span>
            <span class="num ${s.chg !== null ? (s.chg > 0 ? 'up' : s.chg < 0 ? 'down' : 'flat') : ''}">${withPct ? (s.chg !== null ? (s.chgType || '') + ' ' + (s.chg > 0 ? '+' : '') + fmt(s.chg, 2) : '--') : secidMarketName(s.secid)}</span></div>`).join('')}
        </div>
        <p class="insight-disclaimer">定期报告披露的重仓持仓（滞后于报告期）${withPct ? '，「环比」为占净值比的期间变动' : '；当前只有名单口径，占比字段不可用'}；点击行进个股K线。这是公开披露的历史事实，不代表当前仓位，不构成任何建议。</p>`));
    }

    els.body.innerHTML = parts.join('');
    if (d.netWorth && d.netWorth.length > 1) drawNetChart(d.netWorth);
  }

  const arrAt = (a, i) => (Array.isArray(a) && a[i] !== undefined) ? a[i] : null;
  const barPct = (v, all) => {
    const vals = (all || []).filter(x => typeof x === 'number');
    const max = vals.length ? Math.max(...vals) : 0;
    return (max > 0 && typeof v === 'number') ? (v / max * 100).toFixed(1) : 0;
  };
  function stackSeg(label, v, color) {
    const pct = (typeof v === 'number' && v > 0) ? v : 0;
    return `<span class="fp-seg" title="${escapeHTML(label)} ${typeof v === 'number' ? fmt(v, 2) + '%' : '无数据'}"
      style="flex:${pct.toFixed(2)};background:${color}">
      ${pct >= 12 ? `<i class="num">${escapeHTML(label)} ${fmt(v, 1)}%</i>` : ''}</span>`;
  }
  function secidMarketName(secid) {
    const m = String(secid).split('.')[0];
    return ({ 116: '港股', 1: '沪市', 0: '深市' })[m] || '其他';
  }

  /* 净值走势：手绘 canvas 折线（DPR 适配，端点标首末净值） */
  function drawNetChart(series) {
    const cv = document.getElementById('fpNetChart');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || cv.parentElement.clientWidth || 640;
    const h = 220;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vals = series.map(p => p.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = (max - min) || max * 0.01 || 1;
    const pad = { l: 8, r: 64, t: 14, b: 20 };
    const X = (i) => pad.l + (w - pad.l - pad.r) * (i / (vals.length - 1));
    const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / span);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent-signature').trim() || '#e8a33d';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px sans-serif';
    [min, max].forEach(v => {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmt(v, 4), w - pad.r + 6, y + 4);
    });
    ctx.beginPath();
    series.forEach((p, i) => { const x = X(i), y = Y(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(X(vals.length - 1), h - pad.b);
    ctx.lineTo(X(0), h - pad.b);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(fmt(vals[0], 4), pad.l, Y(vals[0]) - 6);
    const lastV = vals[vals.length - 1];
    ctx.fillText(fmt(lastV, 4), w - pad.r - ctx.measureText(fmt(lastV, 4)).width, Y(lastV) - 6);
  }

  return { mount, open, onEnter: () => {} };
})();
