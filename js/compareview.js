/* compareview.js —— 「基金对比」页（多标的总收益对比）
 *
 * 职责：把用户选的几只基金 → 长历史序列（sources/history.js）→ 纯计算（compare.js）→ 三块可读结果：
 *   ① 归一化曲线（各自起点 / 共同起点，归一 100 / 累计% / 倍数，可切对数轴）
 *   ② 区间指标表（总收益 / CAGR / 年化波动 / 最大回撤 / 卡玛 / 夏普 / 最好最差年）
 *   ③ 年度收益矩阵 + 收益率相关性矩阵
 *
 * 两条不能被含糊掉的口径（这两点会让"看起来对"的数字变成错的）：
 *   · 含分红 vs 价格收益：东财后复权含分红，腾讯港美股兜底只有不复权价。
 *     降级时必须把它写在角标和脚注里，不能让用户以为在看总收益。
 *   · 各自起点 vs 共同起点：晚上市的基金（如 SPMO 2015）在"各自起点"下是完整表现，
 *     在"共同起点"下会被排除并写明理由——绝不静默对齐出一个假共同区间。
 */

window.CompareView = (() => {
  const { escapeHTML, fmt, num } = window.U;
  const MAX_FUNDS = 8;
  const DEF_START = '2010-01-01';
  const EARLIEST = '2006-01-01';      // 东财后复权实测最早只到 2006-10（5000 根日线）

  /* 常用组合：全部逐个实测过能取到历史（_test/history.test.mjs 锁住）。
     第一项曾是「你举的例」——拿用户的话当按钮名很奇怪（用户 2026-09-16 直接吐槽），
     改成按内容命名。 */
  const PRESETS = [
    { label: '宽基 + 红利', codes: ['QQQ', 'DIA', 'SPY', 'SCHD', 'SPMO', 'SCHG'] },
    { label: '美股宽基', codes: ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI'] },
    { label: '红利 / 因子', codes: ['SCHD', 'SPMO', 'SCHG', 'SPLV', 'VYM'] },
    { label: 'A股宽基', codes: ['510300', '510500', '510050', '159915', '588000'] },
    { label: 'A股行业', codes: ['512880', '512480', '513050', '513100'] },
    { label: '港股', codes: ['02800', '03033', '02828'] },
    { label: '跨市场', codes: ['SPY', '510300', '02800'] },
  ];

  const GRANULARITY_CN = { day: '日线', week: '周线', month: '月线' };
  const VIA_CN = { eastmoney: '东财', tencent: '腾讯' };
  /* 复权口径标注：目前只有东财后复权一种"含分红"，其它一律是不复权价（价格收益）。
     qfq 不再出现——腾讯 A股的前复权实测是加性口径，已按价格收益处理。 */
  const ADJ_CN = {
    hfq: { text: '含分红（后复权）', dividend: true },
    none: { text: '未含分红（价格收益）', dividend: false },
  };

  let deps = {};
  let el = {};
  let chart = null;
  let lastWrittenHash = null;      // 我们自己写进地址栏的最后一个 hash（用于识别回声，见 applyHash）

  const state = {
    items: [],            // [{ code, secid, name, market }] 用户选择
    loaded: [],           // 本次取数结果（含 bars / adj / via / error）
    start: DEF_START,
    end: '',
    granularity: 'auto',
    norm: 'index',
    align: 'own',
    log: false,
    gen: 0,
    loading: false,
    hoverTime: null,
    hoverVals: {},
  };

  /* ---------------- 工具 ---------------- */

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
  const palette = () => (window.Charts && window.Charts.themeColors
    ? window.Charts.themeColors().lineColors : ['#e8a33d']);
  const periodsPerYear = (g) => (g === 'week' ? 52 : g === 'month' ? 12 : 252);

  /* 区间长度 → 粒度：日线历史取不满时自动退周线（5000 根日线 ≈ 20 年，用到 15 年就转周更稳） */
  function resolveGranularity() {
    if (state.granularity !== 'auto') return state.granularity;
    const days = daysBetween(state.start || EARLIEST, state.end || todayISO());
    return days > 15 * 365.25 ? 'week' : 'day';
  }

  function persist() {
    window.Store.set('cmp', {
      items: state.items.map(i => ({ code: i.code, secid: i.secid || null })),
      start: state.start, end: state.end,
      granularity: state.granularity, norm: state.norm, align: state.align, log: state.log,
    });
  }

  function restore() {
    const s = window.Store.get('cmp', null);
    if (!s || !Array.isArray(s.items) || !s.items.length) {
      // 首次进来就给一组能立刻看懂的例子（用户给的 URL 就是这六只）
      state.items = PRESETS[0].codes.map(code => ({ code, secid: null }));
      state.end = todayISO();
      return;
    }
    state.items = s.items.slice(0, MAX_FUNDS).map(i => ({ code: i.code, secid: i.secid || null }));
    state.start = /^\d{4}-\d{2}-\d{2}$/.test(s.start || '') ? s.start : DEF_START;
    state.end = /^\d{4}-\d{2}-\d{2}$/.test(s.end || '') ? s.end : todayISO();
    state.granularity = ['auto', 'day', 'week', 'month'].includes(s.granularity) ? s.granularity : 'auto';
    state.norm = ['index', 'pct', 'mult'].includes(s.norm) ? s.norm : 'index';
    state.align = s.align === 'common' ? 'common' : 'own';
    state.log = !!s.log;
  }

  /* ---------------- 标的增删 ---------------- */

  function addItem(code, secid, name) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return;
    if (state.items.some(i => i.code.toUpperCase() === c)) { flash('「' + c + '」已在对比里'); return; }
    if (state.items.length >= MAX_FUNDS) { flash('最多同时对比 ' + MAX_FUNDS + ' 只'); return; }
    state.items.push({ code: c, secid: secid || null, name: name || '' });
    persist();
    refresh();
  }

  function removeItem(code) {
    state.items = state.items.filter(i => i.code !== code);
    persist();
    refresh();
  }

  function flash(msg) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.classList.add('warn');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.status.classList.remove('warn'); renderStatusText(); }, 3200);
  }

  /* ---------------- 渲染：输入区 / 预设 / chips ---------------- */

  function renderPresets() {
    if (!el.presets) return;
    el.presets.innerHTML = PRESETS.map(p =>
      `<button class="cmp-preset" data-preset="${escapeHTML(p.codes.join(','))}" title="${escapeHTML(p.codes.join(' · '))}">${escapeHTML(p.label)}</button>`
    ).join('');
  }

  function renderChips() {
    if (!el.chips) return;
    const colors = palette();
    el.chips.innerHTML = state.items.map((it, i) => {
      const dot = `<i class="cmp-dot" style="background:${colors[i % colors.length]}"></i>`;
      // 兜底源常常拿不到中文名（name 回退成代码本身）→ 与左边的代码重复，判掉
      const name = it.name && it.name.toUpperCase() !== it.code.toUpperCase()
        ? `<span class="cmp-chip-name">${escapeHTML(it.name)}</span>` : '';
      return `<span class="cmp-chip" data-chip="${escapeHTML(it.code)}">${dot}` +
        `<span class="cmp-chip-code num">${escapeHTML(it.code)}</span>${name}` +
        `<button class="cmp-chip-x" data-remove="${escapeHTML(it.code)}" title="移除" aria-label="移除 ${escapeHTML(it.code)}">×</button></span>`;
    }).join('');
  }

  function renderStatusText() {
    if (!el.status) return;
    if (state.loading) { el.status.textContent = '取数中…'; el.status.classList.remove('warn'); return; }
    const ok = state.loaded.filter(f => !f.error);
    if (!ok.length) { el.status.textContent = state.loaded.length ? '没有可用数据' : '—'; return; }
    const degraded = ok.some(f => f.adj === 'none');
    const via = [...new Set(ok.map(f => VIA_CN[f.via] || f.via))].join('+');
    el.status.textContent = ok.length + ' 只 · ' + via + (degraded ? ' · 含价格收益口径' : ' · 含分红');
    el.status.classList.toggle('warn', degraded);
    /* 页头副标题跟着实际口径走：静态写死"（含分红）"会在降级时与状态行/脚注自相矛盾
       （复核实测：数据全是价格收益，副标题还在说含分红） */
    if (el.sub) {
      el.sub.textContent = degraded
        ? '价格收益口径（数据源未含分红）· 归一化曲线 + 年化/回撤/年度收益/相关性'
        : '总收益口径（含分红，后复权）· 归一化曲线 + 年化/回撤/年度收益/相关性';
    }
  }

  /* ---------------- 渲染：图 + 图例 ---------------- */

  function renderChart(lines, excluded) {
    if (!el.chartBox) return;
    if (!lines.length) {
      destroyChart();
      el.chartBox.classList.add('off');
      return;
    }
    el.chartBox.classList.remove('off');
    if (!chart) {
      chart = window.Charts.createCompare(el.chart, { onHover: onHover });
      if (!chart) { el.chartBox.classList.add('off'); return; }
    }
    const colors = palette();
    const byKey = new Map(state.loaded.map(f => [f.key, f]));
    chart.setSeries(lines.map((l, i) => ({
      key: l.key,
      color: colors[i % colors.length],
      points: l.points,
      fund: byKey.get(l.key),
    })));
    chart.setLog(state.log && state.norm !== 'pct');
    renderLegend(lines, byKey, excluded);
  }

  function onHover(time, vals) {
    state.hoverTime = time;
    state.hoverVals = vals || {};
    renderLegend();
  }

  /* 图例兼读数条：悬停时显示光标所在日的归一值，移开显示区间末值 */
  let lastLines = [];
  let lastByKey = new Map();
  let lastExcluded = [];

  function renderLegend(lines, byKey, excluded) {
    if (!el.legend) return;
    if (lines) { lastLines = lines; lastByKey = byKey || new Map(); lastExcluded = excluded || []; }
    if (!lastLines.length) { el.legend.innerHTML = ''; return; }
    const colors = palette();
    const hover = state.hoverTime;
    el.legend.innerHTML = lastLines.map((l, i) => {
      const f = lastByKey.get(l.key) || {};
      const last = l.points[l.points.length - 1];
      let value = last ? last.value : null;
      if (hover && state.hoverVals[l.key] !== undefined) value = state.hoverVals[l.key];
      const first = l.points[0] ? l.points[0].value : null;
      // 区间收益直接读归一曲线首末（"各自起点"下就是该基金自身区间的收益）
      const ret = (value === null || first === null) ? null
        : state.norm === 'pct' ? value - first
          : state.norm === 'mult' ? (value / first - 1) * 100
            : (value / first - 1) * 100;
      const tags = [];
      if (f.adj === 'none') tags.push('价格收益');
      if (f.from && state.start && f.from > state.start) tags.push(f.from + ' 起');
      return `<span class="cmp-lg" data-lg="${escapeHTML(l.key)}" tabindex="0" role="button" aria-label="${escapeHTML(l.key)} 详情">
        <i class="cmp-dot" style="background:${colors[i % colors.length]}"></i>
        <b class="num">${escapeHTML(l.key)}</b>
        <span class="cmp-lg-val num">${fmtNorm(value)}</span>
        <span class="cmp-lg-ret num ${retClass(ret)}">${ret === null ? '' : (ret > 0 ? '+' : '') + ret.toFixed(1) + '%'}</span>
        ${tags.length ? `<span class="cmp-lg-tag">${escapeHTML(tags.join(' · '))}</span>` : ''}
      </span>`;
    }).join('') + (lastExcluded.length
      ? `<span class="cmp-lg cmp-lg-off">未纳入：${lastExcluded.map(x => escapeHTML(x.name + '（' + x.reason + '）')).join('，')}</span>`
      : '');
  }

  const retClass = (v) => (v === null || v === undefined || isNaN(v)) ? 'flat' : (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  function fmtNorm(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    if (state.norm === 'pct') return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    if (state.norm === 'mult') return v.toFixed(3) + '×';
    return v.toFixed(2);
  }

  function destroyChart() {
    if (chart) { chart.remove(); chart = null; }
    if (el.chart) el.chart.innerHTML = '';
    lastLines = []; lastByKey = new Map(); lastExcluded = [];
    if (el.legend) el.legend.innerHTML = '';
  }

  /* ---------------- 渲染：区间指标表 ---------------- */

  function renderMetrics(rows, gran) {
    if (!el.metrics) return;
    if (!rows.length) { el.metrics.innerHTML = '<div class="empty">没有可对比的标的</div>'; return; }
    const head = `<div class="cmp-row cmp-head" aria-hidden="true">
      <span class="cmp-c-name">基金</span><span>区间</span><span>年数</span><span>总收益</span>
      <span>年化</span><span>年化波动</span><span>最大回撤</span><span>卡玛</span><span>夏普</span>
      <span>最好年</span><span>最差年</span></div>`;
    /* 单根 bar 的区间（比如把起止日期都填成同一天附近）会让 CompareMath.metrics 返回 null：
       这里必须整体容错成 "--"，否则模板里第一个 .toFixed 就抛错——整块表停在骨架上、
       后面的脚注与 hash 同步也全不执行（复核实测到的白屏路径）。 */
    const body = rows.map((r, i) => {
      const m = r.m || {};
      const has = (v) => v !== null && v !== undefined;
      const colors = palette();
      const dot = `<i class="cmp-dot" style="background:${colors[i % colors.length]}"></i>`;
      // 区间内没有回撤时不画峰谷箭头（空箭头比不画更让人以为数据缺了）
      const ddRange = (m.peakAt && m.troughAt)
        ? `<em>${escapeHTML(m.peakAt.slice(2))}→${escapeHTML(m.troughAt.slice(2))}</em>` : '';
      const dd = !has(m.maxDD) ? '--' : `<span class="cmp-dd">${m.maxDD.toFixed(1)}%${ddRange}</span>`;
      const yr = (y) => (y && has(y.pct)) ? `${escapeHTML(y.year)}<em>${y.pct > 0 ? '+' : ''}${y.pct.toFixed(1)}%</em>` : '--';
      const name = (r.name && r.name.toUpperCase() !== r.key.toUpperCase()) ? `<em>${escapeHTML(r.name)}</em>` : '';
      return `<div class="cmp-row" data-mrow="${escapeHTML(r.key)}" tabindex="0" role="button" aria-label="${escapeHTML(r.key)} 详情">
        <span class="cmp-c-name">${dot}<b>${escapeHTML(r.key)}</b>${name}${r.adj === 'none' ? '<i class="cmp-flag">价格</i>' : ''}</span>
        <span class="num cmp-dim">${m.from && m.to ? escapeHTML(m.from.slice(2)) + '→' + escapeHTML(m.to.slice(2)) : '--'}</span>
        <span class="num">${has(m.years) ? m.years.toFixed(1) : '--'}</span>
        <span class="num ${retClass(m.total)}">${has(m.total) ? (m.total > 0 ? '+' : '') + m.total.toFixed(1) + '%' : '--'}</span>
        <span class="num ${retClass(m.cagr)}">${has(m.cagr) ? (m.cagr > 0 ? '+' : '') + m.cagr.toFixed(2) + '%' : '--'}</span>
        <span class="num">${has(m.vol) ? m.vol.toFixed(1) + '%' : '--'}</span>
        <span class="num down">${dd}</span>
        <span class="num">${has(m.calmar) ? m.calmar.toFixed(2) : '--'}</span>
        <span class="num">${has(m.sharpe) ? m.sharpe.toFixed(2) : '--'}</span>
        <span class="num ${m.best ? retClass(m.best.pct) : ''}">${yr(m.best)}</span>
        <span class="num ${m.worst ? retClass(m.worst.pct) : ''}">${yr(m.worst)}</span>
      </div>`;
    }).join('');
    el.metrics.innerHTML = head + body;
    if (el.metricsSub) {
      el.metricsSub.textContent = `按${GRANULARITY_CN[gran]} · 年化波动/夏普按 ${periodsPerYear(gran)} 期年化 · 夏普假设无风险利率 0`;
    }
  }

  /* ---------------- 渲染：年度收益矩阵 ---------------- */

  function renderYearly(rows) {
    if (!el.yearly) return;
    const cols = rows.filter(r => r.years.length);
    if (!cols.length) { el.yearly.innerHTML = '<div class="empty">区间不足一年，没有年度数据</div>'; return; }
    const years = [...new Set(cols.flatMap(r => r.years.map(y => y.year)))].sort();
    const colors = palette();
    const grid = `grid-template-columns:64px repeat(${cols.length}, minmax(76px, 1fr))`;
    const head = `<div class="cmp-row cmp-head" style="${grid}" aria-hidden="true"><span class="cmp-c-year">年份</span>` +
      cols.map((r, i) => `<span class="cmp-c-y"><i class="cmp-dot" style="background:${colors[i % colors.length]}"></i>${escapeHTML(r.key)}</span>`).join('') + '</div>';
    const body = years.map(y => {
      const cells = cols.map(r => {
        const hit = r.years.find(x => x.year === y);
        if (!hit || hit.pct === null || hit.pct === undefined || isNaN(hit.pct)) {
          return '<span class="num cmp-dim">--</span>';
        }
        return `<span class="num ${retClass(hit.pct)}">${hit.pct > 0 ? '+' : ''}${hit.pct.toFixed(1)}%${hit.partial ? '<i class="cmp-p">*</i>' : ''}</span>`;
      }).join('');
      return `<div class="cmp-row" style="${grid}"><span class="cmp-c-year num">${y}</span>${cells}</div>`;
    }).join('');
    el.yearly.innerHTML = head + body +
      '<p class="cmp-hint">＊＝该年数据不满整年（首末年份），不是全年收益</p>';
  }

  /* ---------------- 渲染：相关性矩阵 ---------------- */

  function renderCorr(corr) {
    if (!el.corr) return;
    if (!corr) { el.corr.innerHTML = '<div class="empty">公共交易日不足，无法计算相关性</div>'; return; }
    const grid = `grid-template-columns:64px repeat(${corr.keys.length}, minmax(64px, 1fr))`;
    const head = `<div class="cmp-row cmp-head" style="${grid}" aria-hidden="true"><span class="cmp-c-year">相关</span>` +
      corr.keys.map(k => `<span class="cmp-c-y">${escapeHTML(k)}</span>`).join('') + '</div>';
    const body = corr.matrix.map((row, i) => `<div class="cmp-row" style="${grid}"><span class="cmp-c-year num">${escapeHTML(corr.keys[i])}</span>` +
      row.map((v, j) => {
        if (i === j) return '<span class="cmp-corr cmp-corr-diag">1.00</span>';
        if (v === null || v === undefined) return '<span class="cmp-corr cmp-dim">--</span>';
        // 强度用品牌色透明度表达（不用涨跌色：相关性没有涨跌方向）
        const a = Math.min(0.42, Math.abs(v) * 0.42).toFixed(3);
        return `<span class="cmp-corr" style="background:rgba(var(--accent-rgb),${a})">${v.toFixed(2)}</span>`;
      }).join('') + '</div>').join('');
    el.corr.innerHTML = head + body +
      `<p class="cmp-hint">按 ${corr.days} 个公共交易日计算（各市场休市日不同，只取都有数据的日子）</p>`;
  }

  /* ---------------- 主流程 ---------------- */

  async function refresh({ fresh = false } = {}) {
    renderChips();
    renderPresets();
    if (el.chipsSub) el.chipsSub.textContent = state.items.length + ' / ' + MAX_FUNDS;
    if (!state.end) state.end = todayISO();
    if (!hasItems() || state.start >= state.end) {
      // 0 只标的 / 区间非法（深链可能塞进来）：给空态，不打网也不留骨架
      state.loaded = [];
      destroyChart();
      if (el.status) el.status.textContent = hasItems() ? '区间起止日期不合法' : '先加一只基金';
      renderMetrics([], 'day'); renderYearly([]); renderCorr(null);
      renderNote(null, 'day');
      return;
    }
    if (el.start) el.start.value = state.start;
    if (el.end) el.end.value = state.end;
    syncControls();

    const gen = ++state.gen;
    state.loading = true;
    renderStatusText();
    if (el.metrics) el.metrics.innerHTML = '<div class="sk sk-card"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>';

    const gran = resolveGranularity();
    const days = daysBetween(state.start || EARLIEST, state.end || todayISO());
    const results = await window.HistorySource.loadMany(
      state.items.map(i => i.secid || i.code), { granularity: gran, days, max: 3, fresh });
    if (gen !== state.gen) return;                 // 期间用户又改了选择

    state.loading = false;
    state.loaded = state.items.map((it, idx) => {
      const r = results[idx];
      if (!r) return { key: it.code, name: it.name || '', error: true };
      return {
        key: it.code, name: it.name && !/^\d+$/.test(it.name) ? it.name : (r.name || it.code),
        secid: r.secid, market: r.market, adj: r.adj, via: r.via, bars: r.bars,
        // provisional 必须原样带过来：它是"secid 只是猜出来的标签"的标记，
        // 漏掉它下面那段"不写进记忆"的判断就永远为真（复核实测过这个漏洞）
        provisional: !!r.provisional,
        from: r.bars.length ? r.bars[0].time : null,
      };
    });
    // 解析出真实 secid 的记下来，下次（含深链）不必再猜市场位。
    // provisional（兜底源认下的猜测市场位）不写进记忆：东财恢复后它可能取空，留着反而是坑。
    state.loaded.forEach((f, idx) => {
      const it = state.items[idx];
      if (!it) return;
      if (f.secid && !f.provisional && !it.secid) it.secid = f.secid;
      if (f.name && !it.name) it.name = f.name;
    });
    persist();
    renderChips();
    renderStatusText();

    const ok = state.loaded.filter(f => !f.error);
    const as = state.norm === 'pct' ? 'pct' : state.norm === 'mult' ? 'mult' : 'index';
    const built = window.CompareMath.buildLines(ok, { mode: state.align, start: state.start, end: state.end, as });
    const byKey = new Map(ok.map(f => [f.key, f]));

    const rows = built.lines.map(l => {
      const f = byKey.get(l.key);
      return {
        key: l.key, name: f.name, adj: f.adj,
        m: window.CompareMath.metrics(l.bars, { periodsPerYear: periodsPerYear(gran) }),
        years: window.CompareMath.yearlyReturns(l.bars),
      };
    });
    renderChart(built.lines, built.excluded);
    renderMetrics(rows, gran);
    renderYearly(rows);
    renderCorr(window.CompareMath.correlation(built.lines.map(l => ({ key: l.key, name: l.name, bars: l.bars }))));
    renderNote(built, gran);
    syncHash();
  }

  const hasItems = () => state.items.some(i => i && i.code);

  /* 脚注：把口径、数据源、降级、共同起点、失败标的全部写清楚 */
  function renderNote(built, gran) {
    if (!el.note) return;
    const ok = state.loaded.filter(f => !f.error);
    const failed = state.loaded.filter(f => f.error);
    if (!ok.length) {
      el.note.innerHTML = failed.length
        ? `<b>取数失败：</b>${failed.map(f => escapeHTML(f.key)).join('、')} — 数据源可能正在限流（东财对短时间大量长历史请求会临时拒连）。` +
          '稍等一两分钟再点「重新取数」（它会绕过本地缓存重新请求），或先换成 A股/港股标的试。'
        : '还没有选择标的。';
      return;
    }
    const adjSet = [...new Set(ok.map(f => f.adj))];
    const adjText = adjSet.map(a => ADJ_CN[a] ? ADJ_CN[a].text : a).join(' / ');
    const degraded = adjSet.includes('none');
    const lines = [];
    lines.push(`<b>口径：</b>${escapeHTML(adjText)} · 按${GRANULARITY_CN[gran]} · 数据源 ${escapeHTML([...new Set(ok.map(f => VIA_CN[f.via] || f.via))].join(' / '))}`);
    lines.push(`<b>区间：</b>${escapeURI(state.start)} → ${escapeURI(state.end)}` +
      (built && built.mode === 'common' && built.commonStart ? ` · 共同起点 ${escapeURI(built.commonStart)}` : ' · 各自起点归一'));
    /* 被排除的标的必须写在这里：renderChart 在图没画出来时提前返回，图例压根不渲染，
       而"谁为什么没进图"恰恰是空图时用户唯一需要看到的信息 */
    const ex = (built && built.excluded) || [];
    if (ex.length) lines.push(`<b>未纳入对比：</b>${ex.map(x => escapeHTML(x.name + '（' + x.reason + '）')).join('，')}`);
    if (degraded) lines.push('<b>注意：</b>部分标的走的是兜底源，只有<b>不复权价</b>（A股腾讯源的前复权是加性口径、港美股无复权），曲线是价格收益、未含分红——与含分红口径不能直接并排比较。');
    const late = ok.filter(f => f.from && state.start && f.from > state.start);
    if (late.length) lines.push(`<b>数据起点：</b>${late.map(f => escapeHTML(f.key + ' 自 ' + f.from)).join('、')}（上市时间或数据源深度所限，之前没有数据）`);
    const cut = ok.filter(f => f.bars.length >= window.HistorySource.MAX_BARS);
    if (cut.length) lines.push(`<b>深度上限：</b>${cut.map(f => escapeHTML(f.key)).join('、')} 触到单次 5000 根上限，更早的历史未纳入`);
    if (failed.length) lines.push(`<b>未取到：</b>${failed.map(f => escapeHTML(f.key)).join('、')}`);
    lines.push('归一化曲线只表达相对涨跌（复权价不是真实报价，故不展示价格本身）· 指标为历史统计，不构成投资建议');
    el.note.innerHTML = lines.map(t => '<span class="cmp-note-line">' + t + '</span>').join('');
  }

  const escapeURI = (s) => escapeHTML(String(s == null ? '' : s));

  /* ---------------- 控件状态同步 ---------------- */

  function syncControls() {
    const gran = resolveGranularity();
    document.querySelectorAll('[data-cmpgran]').forEach(b =>
      b.classList.toggle('active', state.granularity === 'auto' ? b.dataset.cmpgran === 'auto' : b.dataset.cmpgran === gran));
    document.querySelectorAll('[data-cmpnorm]').forEach(b => b.classList.toggle('active', b.dataset.cmpnorm === state.norm));
    document.querySelectorAll('[data-cmpalign]').forEach(b => b.classList.toggle('active', b.dataset.cmpalign === state.align));
    if (el.log) {
      // 对数轴在"累计%"口径下会出现 ≤0 的值，直接禁用而不是画一条断掉的图
      const allowed = state.norm !== 'pct';
      el.log.disabled = !allowed;
      el.log.classList.toggle('active', allowed && state.log);
      el.log.setAttribute('aria-pressed', String(allowed && state.log));
      el.log.title = allowed ? '切换对数坐标（长周期看收益率更公平）' : '累计%口径含负值，对数轴不可用';
    }
    if (el.normHint) el.normHint.textContent = state.norm === 'index' ? '起点 = 100'
      : state.norm === 'pct' ? '起点 = 0%' : '起点 = 1 倍';
  }

  /* ---------------- 搜索建议（复用东财 searchapi，走系统搜索源） ---------------- */

  function bindSearch() {
    if (!el.input) return;
    let timer = null;
    let items = [];
    let sel = -1;

    const hide = () => { if (el.results) { el.results.classList.remove('active'); } sel = -1; };
    const paint = () => {
      if (!el.results) return;
      if (!items.length) { el.results.innerHTML = ''; el.results.classList.remove('active'); return; }
      el.results.innerHTML = items.map((x, i) =>
        `<div class="sr-item${i === sel ? ' sel' : ''}" role="option" data-sug="${i}" aria-selected="${i === sel}">
          <span class="sr-name">${escapeHTML(x.name || x.code)}</span>
          <span class="sr-code num">${escapeHTML(x.code)}</span>
          <span class="sr-mkt">${escapeHTML(x.marketName || '')}</span>
        </div>`).join('');
      el.results.classList.add('active');
    };

    const doSearch = async () => {
      const kw = el.input.value.trim();
      if (kw.length < 1) { items = []; paint(); return; }
      try {
        const list = await window.EastmoneySource.search(kw);
        items = (list || []).slice(0, 8);
      } catch { items = []; }
      sel = -1;
      paint();
    };

    el.input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 240);
    });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { sel = (sel + 1) % items.length; paint(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp' && items.length) { sel = (sel - 1 + items.length) % items.length; paint(); e.preventDefault(); return; }
      if (e.key === 'Escape') { hide(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const pick = sel >= 0 ? items[sel] : null;
      if (pick) {
        addItem(pick.code, pick.secid, pick.name);
        items = []; hide();
      } else if (el.input.value.trim()) {
        addItem(el.input.value.trim(), null, '');
        items = []; hide();
      }
      el.input.value = '';
    });
    if (el.results) {
      el.results.addEventListener('click', (e) => {
        const t = e.target.closest('[data-sug]');
        if (!t) return;
        const x = items[+t.dataset.sug];
        if (!x) return;
        addItem(x.code, x.secid, x.name);
        items = []; hide();
        if (el.input) el.input.value = '';
      });
    }
    document.addEventListener('click', (e) => {
      if (!el.wrap || el.wrap.contains(e.target)) return;
      hide();
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    if (el.add) el.add.addEventListener('click', () => {
      if (!el.input || !el.input.value.trim()) { el.input && el.input.focus(); return; }
      addItem(el.input.value.trim(), null, '');
      el.input.value = '';
    });
    if (el.chips) {
      el.chips.addEventListener('click', (e) => {
        const x = e.target.closest('[data-remove]');
        if (x) { removeItem(x.dataset.remove); return; }
        const chip = e.target.closest('[data-chip]');
        if (chip) openFund(chip.dataset.chip);
      });
    }
    if (el.presets) {
      el.presets.addEventListener('click', (e) => {
        const b = e.target.closest('[data-preset]');
        if (!b) return;
        state.items = b.dataset.preset.split(',').map(code => ({ code, secid: null }));
        persist();
        refresh();
      });
    }
    if (el.start) el.start.addEventListener('change', () => {
      const v = el.start.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.start.value = state.start; return; }
      if (v >= state.end) { flash('起始日期要早于结束日期'); el.start.value = state.start; return; }
      state.start = v;
      state.granularity = state.granularity === 'auto' ? 'auto' : state.granularity;
      persist(); refresh();
    });
    if (el.end) el.end.addEventListener('change', () => {
      const v = el.end.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.end.value = state.end; return; }
      if (v <= state.start) { flash('结束日期要晚于起始日期'); el.end.value = state.end; return; }
      state.end = v;
      persist(); refresh();
    });
    if (el.quick) {
      el.quick.addEventListener('click', (e) => {
        const b = e.target.closest('[data-range]');
        if (!b) return;
        const y = +b.dataset.range;
        if (y === 0) state.start = EARLIEST;
        else {
          const end = state.end || todayISO();
          const d = new Date(end + 'T00:00:00Z');
          d.setUTCFullYear(d.getUTCFullYear() - y);
          state.start = d.toISOString().slice(0, 10);
        }
        persist(); refresh();
      });
    }
    document.querySelectorAll('[data-cmpgran]').forEach(b => b.addEventListener('click', () => {
      state.granularity = b.dataset.cmpgran; persist(); refresh();
    }));
    document.querySelectorAll('[data-cmpnorm]').forEach(b => b.addEventListener('click', () => {
      state.norm = b.dataset.cmpnorm;
      if (state.norm === 'pct') state.log = false;
      persist(); refresh();
    }));
    document.querySelectorAll('[data-cmpalign]').forEach(b => b.addEventListener('click', () => {
      state.align = b.dataset.cmpalign; persist(); refresh();
    }));
    if (el.log) el.log.addEventListener('click', () => {
      if (state.norm === 'pct') return;
      state.log = !state.log; persist(); refresh();
    });
    if (el.retry) el.retry.addEventListener('click', () => { refresh({ fresh: true }); });
    // 点指标行 / 图例 → 进该标的 K 线详情（复用现有详情页）
    const openFromEvent = (e) => {
      const lg = e.target.closest('[data-lg]');
      if (lg) { openFund(lg.dataset.lg); return; }
      const row = e.target.closest('[data-mrow]');
      if (row) openFund(row.dataset.mrow);
    };
    if (el.legend) el.legend.addEventListener('click', openFromEvent);
    if (el.metrics) el.metrics.addEventListener('click', openFromEvent);
    if (el.legend) el.legend.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromEvent(e); }
    });
  }

  function openFund(key) {
    const f = state.loaded.find(x => x.key === key && !x.error);
    if (!f || !f.secid || !deps.openDetail) return;
    const [m, code] = f.secid.split('.');
    deps.openDetail({
      symbol: 'EM:' + f.secid, code, name: f.name || code,
      market: f.market, secid: f.secid,
      tencent: deps.tencentOfSecid ? deps.tencentOfSecid(f.secid) : null,
    });
  }

  /* ---------------- 挂载 / 深链 ---------------- */

  function mount(dom, dependencies) {
    deps = dependencies || {};
    el = dom || {};
    restore();
    renderPresets();          // 只在挂载时画一次（refresh 里还会重画，避免重复调用）
    bindSearch();
    bind();
    return api;
  }

  let entered = false;
  function onEnter() {
    if (entered) return;              // 进过一次就别重复打网（切 tab 回来直接用现有结果）
    entered = true;
    refresh();
  }

  /* 深链：#tab=compare&f=SPY,QQQ&start=2010-01-01&end=2026-09-10&g=day&n=index&a=common&log=1 */
  function applyHash(hash) {
    const h = String(hash || '');
    /* 先整串解析成 Map，再按固定键取值。
       刻意不"用参数拼正则"（把键名拼进模式字符串）：既没必要（同一串要重解析 N 次），
       也会被静态扫描判成注入入口——本项目 commit 前的安全扫描就因此拦过一次。
       这条正则只含常量与字符类，参数只作为**被比较的键名**，不参与模式构造。 */
    const params = new Map();
    for (const m of h.matchAll(/[#&]([A-Za-z0-9_]+)=([^&]*)/g)) params.set(m[1], m[2]);
    const get = (k) => {
      if (!params.has(k)) return null;
      const raw = params.get(k);
      try { return decodeURIComponent(raw); } catch { return raw; }
    };
    /* 自己写的 hash 又回灌进来时不要用它覆盖内存状态。
       这条路径真实存在：file:// 下 replaceState 可能被拒（syncHash 的 catch），地址栏停在旧值，
       用户点了图例进详情再后退 → popstate → 这里用**旧列表**重建 items 并 persist()，
       被删掉的标的会从 localStorage 里复活。参数完全等于我们自己写过的那个就直接刷新。 */
    if (h === lastWrittenHash) { refresh(); return; }

    const f = get('f');
    if (f) {
      const seen = new Set();
      const codes = f.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        .filter(c => { if (seen.has(c)) return false; seen.add(c); return true; })   // 深链可能重复同一个代码
        .slice(0, MAX_FUNDS);
      if (codes.length) state.items = codes.map(code => ({ code, secid: null }));
    }
    const st = get('start');
    const en = get('end');
    if (st && /^\d{4}-\d{2}-\d{2}$/.test(st)) state.start = st;
    if (en && /^\d{4}-\d{2}-\d{2}$/.test(en)) state.end = en;
    if (state.start >= state.end) {          // 深链里的非法区间：回到默认，不把空图当结果
      state.start = DEF_START;
      state.end = todayISO();
    }
    const g = get('g');
    if (g && ['auto', 'day', 'week', 'month'].includes(g)) state.granularity = g;
    const n = get('n');
    if (n && ['index', 'pct', 'mult'].includes(n)) state.norm = n;
    const a = get('a');
    if (a && ['own', 'common'].includes(a)) state.align = a;
    state.log = get('log') === '1' && state.norm !== 'pct';
    persist();
    entered = true;                   // 深链自带参数：直接取数，不走默认预设
    refresh();
  }
  /* 当前选择的深链（切到本 tab 时写进地址栏，用户可直接复制分享）。
     注意：调用方拿到后必定会立刻把它写进 URL（app.js 的 navigate / 本文件的 syncHash），
     所以顺手记下"我们自己写的最后一个 hash"——用于 applyHash 识别自己的回声。
     **存解码后的形式**：app.js 的 renderFromHash 传给 applyHash 的是 decodeURIComponent(hash)，
     存编码形式（f=A%2CB）永远比不上（f=A,B），守卫就形同虚设——复核实测过这个错配。 */
  function hashFor() {
    const parts = ['#tab=compare'];
    if (state.items.length) parts.push('f=' + encodeURIComponent(state.items.map(i => i.code).join(',')));
    if (state.start) parts.push('start=' + state.start);
    if (state.end) parts.push('end=' + state.end);
    if (state.granularity !== 'auto') parts.push('g=' + state.granularity);
    if (state.norm !== 'index') parts.push('n=' + state.norm);
    if (state.align !== 'own') parts.push('a=' + state.align);
    if (state.log) parts.push('log=1');
    const h = parts.join('&');
    try { lastWrittenHash = decodeURIComponent(h); } catch { lastWrittenHash = h; }
    return h;
  }

  /* 改区间/粒度/口径后同步地址栏：用 replaceState（不 push），
     否则每点一下就多一条历史记录，后退键会被自己的选择挤爆。
     只有本页是当前视图时才改地址栏——否则会把别的 tab 的 hash 冲掉。
     replaceState 被拒（file:// 的某些安全策略）时退回直接改 location.hash：地址栏哪怕多一条历史，
     也好过停在旧值——停在旧值会让"后退/前进"把**已经删掉的标的**按旧 hash 复活（复核实测）。 */
  function syncHash() {
    if (typeof location === 'undefined' || !String(location.hash).startsWith('#tab=compare')) return;
    const h = hashFor();
    if (location.hash === h) return;
    try {
      history.replaceState(null, '', h);
    } catch {
      try { location.hash = h; } catch { /* 完全不可写：内存状态仍是权威（applyHash 的回声守卫兜底） */ }
    }
  }

  const api = { mount, onEnter, refresh, applyHash, hashFor,
    state, addItem, removeItem, PRESETS, MAX_FUNDS };
  return api;
})();
