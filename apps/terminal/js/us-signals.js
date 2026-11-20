/* us-signals.js —— 「美股信号」Tab（monorepo Phase 4 新增）
 * 消费 Meridian 管线产物 data/us-signals.json（协议见 pipelines/meridian/us-schema.mjs）。
 * 设计约定（Gemini 裁定）：
 *   · 自选直接复用主终端 Store.watchlist（gfd_watchlist），绝不另起一套；星标走
 *     document 级 [data-star] 委托（app.js 已有），这里只渲染按钮；
 *   · 点行 → Bus.emit('symbol:open', …)（bus.js 约定，app.js 接 openDetail）；
 *   · RSI6/RSI14 与 日/周 切换记忆在 localStorage（Store 前缀 gfd_）；
 *   · 换肤只走主终端 CSS 变量（--ink/--muted/--line/--up/--down），本模块零硬编码色；
 *   · us-signals.json 404/未生成 → 诚实空态 + 重试按钮，绝不展示编造数据；
 *   · adj==='raw' → 「不复权」徽标；item.warnings → 口径提示徽标。
 * 渲染时机：Bus 'tab' 事件（app.js setTab 末尾 emit）切到 ussig 时惰性首拉 + 重渲染。
 */
(function () {
  'use strict';

  var el = {};
  var state = {
    data: null,          // 协议对象
    status: 'idle',      // idle | loading | ok | empty | error
    period: '6',         // '6' | '14'（localStorage）
    cycle: 'daily',      // 'daily' | 'weekly'（localStorage）
    filter: 'all',       // all | ob | os | obr | osr | ev | wob | wos | wret | sp500 | ndx100 | spmo | watch
    loaded: false,
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    // 与 utils.js escapeHTML 同一口径：window.U 在场用真源；兜底补 &#39; 单引号转义
    // （ticker/name/警告文案会拼进 title="…"/aria-label="…" 单引号外的双引号属性与文本节点，转干净才放心）
    if (window.U && typeof window.U.escapeHTML === 'function') return window.U.escapeHTML(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; });
  }
  function num(v, d) { return Number.isFinite(v) ? v.toFixed(d == null ? 2 : d) : '--'; }
  function pct(v) { return Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '--'; }
  function getLS(k, d) { try { var v = localStorage.getItem('gfd_' + k); return v == null ? d : v; } catch (e) { return d; } }
  function setLS(k, v) { try { localStorage.setItem('gfd_' + k, v); } catch (e) { /* 隐私模式忽略 */ } }

  function rsiOf(it) {           // 当前周期 + 当前周期线的 RSI 对象
    var src = state.cycle === 'weekly' ? (it.weekly || {}) : it.daily;
    return (state.period === '14' ? (src.rsi14 || null) : (src.rsi6 || null));
  }
  function revertOf(it) { return !!(state.cycle === 'weekly' ? it.weekly && it.weekly.revert : it.daily && it.daily.revert); }
  function vegasOf(it) { return (state.cycle === 'weekly' ? (it.weekly && it.weekly.vegas) || [] : (it.daily && it.daily.vegas) || []); }

  function matches(it) {
    var f = state.filter;
    if (f === 'all') return true;
    if (f === 'sp500') return !!(it.tags && it.tags.sp500);
    if (f === 'ndx100') return !!(it.tags && it.tags.ndx100);
    if (f === 'spmo') return it.spmoWeight != null;
    if (f === 'watch') return !!(it.tags && it.tags.watch);
    var c = state.data && state.data.summary && state.data.summary.counts || {};
    var r = rsiOf(it), rg = rsiOf(it);
    if (f === 'ob') return !!(r && r.state === 'overbought');
    if (f === 'os') return !!(r && r.state === 'oversold');
    if (f === 'obr') return !!(r && r.cross === 'out_ob');
    if (f === 'osr') return !!(r && r.cross === 'out_os');
    if (f === 'ev') return vegasOf(it).some(function (v) { return v.event && v.event.indexOf('break') === 0; });
    if (f === 'wob') { var w = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w && w.state === 'overbought'); }
    if (f === 'wos') { var w2 = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w2 && w2.state === 'oversold'); }
    if (f === 'wret') { var w3 = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w3 && (w3.cross === 'out_ob' || w3.cross === 'out_os')); }
    return true;
  }

  function starBtn(it) {
    // 星标钥匙与主终端同一把：usAAPL（写入由 app.js 的 data-star 委托完成，
    // findQuote('usAAPL') 能命中主终端美股行情，name/market 不再退化）
    var us = (window.U && window.U.normUsSymbol) ? (window.U.normUsSymbol(it.symbol) || it.symbol) : ('us' + it.symbol);
    var on = state.watchSet && state.watchSet[us];
    return '<button class="star' + (on ? ' on' : '') + '" type="button" data-star="' + esc(us) +
      '" aria-label="' + (on ? '移出自选' : '加入自选') + '" title="加入/移出自选">' + (on ? '★' : '☆') + '</button>';
  }

  function badge(text, cls, title) {
    return '<span class="ussig-badge ' + (cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>';
  }

  /* Meridian 信号胶囊卡（Wave 1，Gemini 裁定 4）：详情页消费 usSignals 协议对象的
     唯一渲染口——纯函数，输入协议对象、输出 HTML 字符串（app.js loadTechnical 插入
     detailInsight；vm 单测直接调）。复用 ussig-badge/num 既有类，Wave 2 再令牌化美化。
     只描述事实（RSI 值/通道位置/警告），不给任何操作建议——合规红线。 */
  function renderCard(us) {
    if (!us || typeof us !== 'object') return '';
    var num = function (v, d) {
      if (v === null || v === undefined || !isFinite(Number(v))) return '--';
      return Number(v).toFixed(d === undefined ? 2 : d);
    };
    var POS_TXT = { above: '通道上方', inside: '通道带内', below: '通道下方' };
    var rsiCell = function (r) {
      if (!r || !isFinite(Number(r.value))) return '--';
      var cls = r.state === 'overbought' ? ' ob' : r.state === 'oversold' ? ' os' : '';
      var t = r.state === 'overbought' ? 'RSI 超买区' : r.state === 'oversold' ? 'RSI 超卖区' : '';
      return '<span class="ussig-badge' + cls + '"' + (t ? ' title="' + esc(t) + '"' : '') + '>' + num(r.value, 1) + '</span>';
    };
    var parts = [];
    var head = '<div class="section-head"><h2 class="section-title">Meridian 信号</h2>' +
      '<span class="section-sub">来自美股信号面板的同一份口径 · 只描述事实 · 不构成投资建议</span></div>';
    var row = function (label, val) {
      return '<div class="sig-row"><span class="sig-k">' + esc(label) + '</span><span class="sig-v">' + val + '</span></div>';
    };
    var daily = us.daily || {}, weekly = us.weekly || {};
    parts.push(row('日线 RSI6 / RSI14', rsiCell(daily.rsi6) + ' ' + rsiCell(daily.rsi14)));
    parts.push(row('周线 RSI6 / RSI14', rsiCell(weekly.rsi6) + ' ' + rsiCell(weekly.rsi14)));
    if (daily.revert || weekly.revert) {
      parts.push(row('回归状态', badge('RSI 回归', 'warn', 'RSI6 从超买/超卖区回到中性区')));
    }
    var vegasTxt = (daily.vegas || []).map(function (v) {
      if (!v || v.insufficient) return esc(v && v.key || '') + ' 数据不足';
      var ev = v.event ? ' · ' + esc(String(v.event)) : '';
      return esc(v.key || '') + ' ' + esc(POS_TXT[v.pos] || v.pos || '--') + '（EMA' + num(v.n && v.n[0], 0) + '/' + num(v.n && v.n[1], 0) + '）' + ev;
    }).join('；');
    if (vegasTxt) parts.push(row('Vegas 三通道', '<span class="sig-v-text">' + vegasTxt + '</span>'));
    if (us.spmoWeight != null) parts.push(row('SPMO 权重', '<span class="num">' + num(us.spmoWeight, 1) + '%</span>'));
    if (us.adj === 'raw') parts.push(row('口径', badge('不复权', 'warn', '最后一根收盘 bar 为原始价，指标未按复权口径计算')));
    (us.warnings || []).forEach(function (w) {
      if (w && (w.tag === '数据' || w.tag === '口径')) parts.push(row(w.tag, badge(w.tag, 'warn', w.text)));
    });
    return head + '<div class="sig-card" data-ussig-card="' + esc(us.symbol || '') + '">' + parts.join('') + '</div>';
  }
  /* 术语抽屉标记：data-gloss 走 explain.js CONCEPT_NOTES（gloss-tip 全局委托，
     动态插入的元素自动生效）。只挂 explain.js 真实存在的 id——不许假链接。 */

  function rowBadges(it) {
    var b = '';
    if (it.adj === 'raw') b += '<span class="ussig-badge warn" data-gloss="hfq-raw" tabindex="0" role="button" aria-label="什么是不复权">不复权</span>';
    if (it.stale) b += badge('陈旧', 'warn', '最后一根收盘 bar 为 ' + esc(it.asOf || '') + '，指标不是当期值');
    (it.warnings || []).forEach(function (wn) {
      if (wn.tag === '数据' || wn.tag === '口径') b += badge(wn.tag, 'warn', wn.text);
    });
    return b;
  }

  function rowHTML(it) {
    var r = rsiOf(it);
    var vList = vegasOf(it).map(function (v) {
      if (!v || !v.pos) return '<span class="mut" title="数据不足">·</span>';
      var cls = v.pos === 'above' ? 'up' : v.pos === 'below' ? 'dn' : 'mut';
      var ev = v.event ? (v.event === 'break_up' ? '↑' : v.event === 'break_down' ? '↓' : '·') : '';
      return '<span class="' + cls + '" title="' + esc(v.key + ' EMA' + v.n.join('/') + (v.insufficient ? '（数据不足）' : '')) + '">' +
        esc(v.key.replace('通道', '')) + POS_TXT[v.pos] + ev + '</span>';
    }).join(' ');
    var rev = revertOf(it) ? badge('回落', 'ret', '收盘自上方回落进入通道（回归事件，做T回补观察）') : '';
    var tags = it.tags || {};
    var idx = [tags.sp500 ? '标普' : null, tags.ndx100 ? '纳指' : null].filter(Boolean).join('+');
    var watchNote = tags.watchNote || (tags.watch ? '自选' : '');
    var wR = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6);
    return '<tr class="ussig-row" data-symbol="' + esc(it.symbol) + '" tabindex="0" role="button" aria-label="' + esc(it.symbol + ' ' + (it.name || '') + ' 详情') + '">' +
      '<td class="stcol">' + starBtn(it) + '</td>' +
      '<td class="rank">' + (it.rank != null ? '#' + it.rank : '★') + '</td>' +
      '<td class="ticker">' + esc(it.symbol) + (watchNote ? ' ' + badge(watchNote, 'note') : '') + '</td>' +
      '<td class="company">' + esc(it.name || '') + rowBadges(it) + '</td>' +
      '<td>' + num(it.price) + '</td>' +
      '<td class="' + (it.changePct >= 0 ? 'up' : 'dn') + '">' + pct(it.changePct) + '</td>' +
      '<td class="rsi ' + (r && r.state === 'overbought' ? 'ob' : r && r.state === 'oversold' ? 'os' : '') + '">' +
        '<span data-gloss="rsi" tabindex="0" role="button" aria-label="什么是RSI">' + (r ? num(r.value, 1) : '--') + '</span></td>' +
      '<td>' + (wR ? num(wR.value, 1) : '--') + '</td>' +
      '<td class="sig">' + rev + ' <span class="vegas" data-gloss="vegas" tabindex="0" role="button" aria-label="什么是Vegas通道">' + vList + '</span></td>' +
      '<td class="mut">' + esc(idx || '--') + '</td>' +
      '<td>' + (it.spmoWeight != null ? it.spmoWeight.toFixed(1) + '%' : '--') + '</td>' +
      '</tr>';
  }

  var POS_TXT = { above: '上', inside: '内', below: '下' };

  function filterChipsHTML() {
    var c = (state.data && state.data.summary && state.data.summary.counts) || {};
    var defs = [
      ['all', '全部', (state.data && state.data.items || []).length],
      ['ob', '超买', c.ob], ['os', '超卖', c.os],
      ['obr', '超买回落', c.obr], ['osr', '超卖回升', c.osr],
      ['ev', '通道穿越', c.events],
      ['wob', '周超买', c.wob], ['wos', '周超卖', c.wos], ['wret', '周回归', c.wret],
      ['sp500', 'SP500', null], ['ndx100', 'QQQ', null], ['spmo', 'SPMO 重合', null], ['watch', '自选', null],
    ];
    return defs.map(function (d) {
      var n = d[2] == null ? (d[0] === 'spmo' ? (state.data.items || []).filter(function (x) { return x.spmoWeight != null; }).length
        : d[0] === 'sp500' ? (state.data.items || []).filter(function (x) { return x.tags.sp500; }).length
        : d[0] === 'ndx100' ? (state.data.items || []).filter(function (x) { return x.tags.ndx100; }).length
        : (state.data.items || []).filter(function (x) { return x.tags.watch; }).length) : d[2];
      return '<button class="chip' + (state.filter === d[0] ? ' on' : '') + '" type="button" data-ussig-f="' + d[0] + '" aria-pressed="' + (state.filter === d[0]) + '">' +
        esc(d[1]) + ' <b>' + n + '</b></button>';
    }).join('');
  }

  function render() {
    if (state.status !== 'ok') return;
    var d = state.data, mc = d.marketClock || {};
    var clock = $('ussig-clock');
    if (clock) {
      clock.innerHTML = '美东收盘 <b>' + esc(mc.marketDate || '--') + '</b>' +
        ' · 运行于 ' + esc(mc.runAtEt || '--') +
        (mc.isLive ? ' · ' + badge('盘中参考', 'warn', '当前含未收盘 bar：' + (mc.liveCount || 0) + ' 只，未收盘 bar 不计入正式信号') : '') +
        (mc.staleCount ? ' · ' + badge('陈旧 ' + mc.staleCount + ' 只', 'warn', (mc.staleTickers || []).join(' ')) : '') +
        (d.meta && d.meta.mock ? ' · ' + badge('MOCK 数据', 'warn', '离线 mock 产物，仅供联调') : '');
    }
    var chips = $('ussig-chips');
    if (chips) chips.innerHTML = filterChipsHTML();
    var body = $('ussig-body');
    if (!body) return;
    var items = (d.items || []).slice();
    if (d.spmo) items.unshift(d.spmo);            // SPMO 钉在表首
    var vis = items.filter(matches);
    var head = '<tr><th class="stcol" aria-label="自选"></th><th>排名</th><th>代码</th><th>名称</th><th>收盘</th><th>涨跌</th>' +
      '<th>RSI' + esc(state.period) + (state.cycle === 'weekly' ? '（周）' : '') + '</th><th>周RSI</th><th>信号</th><th>成分</th><th>SPMO%</th></tr>';
    body.innerHTML = vis.length
      ? '<table class="ussig-table"><thead>' + head + '</thead><tbody>' + vis.map(rowHTML).join('') + '</tbody></table>'
      : '<div class="ussig-empty">当前筛选没有匹配标的</div>';
    var note = $('ussig-note');
    if (note) note.textContent = '显示 ' + vis.length + ' / ' + items.length + ' 只 · RSI' + state.period + ' · ' + (state.cycle === 'weekly' ? '周线' : '日线');
  }

  function renderEmpty(msg, retry) {
    var body = $('ussig-body');
    if (body) body.innerHTML = '<div class="ussig-empty">' + esc(msg) +
      (retry ? ' <button class="chip" type="button" data-ussig-retry="1">重试</button>' : '') + '</div>';
    var clock = $('ussig-clock');
    if (clock) clock.textContent = '';
    var chips = $('ussig-chips');
    if (chips) chips.innerHTML = '';
  }

  function load() {
    state.status = 'loading';
    var body = $('ussig-body');
    if (body) body.innerHTML = '<div class="ussig-empty">载入美股信号…</div>';
    fetch('data/us-signals.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.schemaVersion !== 1) throw new Error('协议版本不符（schemaVersion=' + (j && j.schemaVersion) + '）');
      state.data = j;
      // 自选集合快照（星标初始态）——与主终端 Store.watchlist 同源。
      // 键用终端命名空间（usAAPL）：管线 symbol 是裸 ticker，星标写入/匹配都必须
      // 经 normUsSymbol 转成与主终端同一把钥匙，否则同一公司出现两条自选。
      try {
        state.watchSet = {};
        window.Store.watchlist.all().forEach(function (w) {
          var k = (window.U && window.U.normUsSymbol) ? (window.U.normUsSymbol(w.symbol) || w.symbol) : w.symbol;
          state.watchSet[k] = true;
        });
      } catch (e) { state.watchSet = {}; }
      state.status = 'ok';
      state.loaded = true;
      render();
    }).catch(function (e) {
      state.status = 'error';
      renderEmpty('us-signals.json 尚未生成或不可达（' + e.message + '）——Meridian 采集链未跑或 data 分支未部署。', true);
    });
  }

  function bind() {
    var view = $('view-ussig');
    if (!view || view.dataset.bound) return;
    view.dataset.bound = '1';
    view.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-ussig-p]');
      if (sw) { state.period = sw.getAttribute('data-ussig-p'); setLS('ussig_period', state.period); syncSwitches(); render(); return; }
      var cy = e.target.closest('[data-ussig-cycle]');
      if (cy) { state.cycle = cy.getAttribute('data-ussig-cycle'); setLS('ussig_cycle', state.cycle); syncSwitches(); render(); return; }
      var f = e.target.closest('[data-ussig-f]');
      if (f) { state.filter = f.getAttribute('data-ussig-f'); render(); return; }
      if (e.target.closest('[data-ussig-retry]')) { load(); return; }
      // 点行 → 详情（走 bus.js 约定的 symbol:open，app.js 接 openDetail）
      var row = e.target.closest('.ussig-row');
      if (row && !e.target.closest('[data-star]')) {
        var it = (state.data && state.data.items || []).filter(function (x) { return x.symbol === row.getAttribute('data-symbol'); })[0]
          || (state.data && state.data.spmo);
        if (it) {
          // symbol/tencent 统一终端命名空间 usAAPL（payload 断供 secid/tencent 是
          // 曾导致详情页全空的根因——openDetail 的报价/K线全靠这两把钥匙）
          var us = (window.U && window.U.normUsSymbol) ? (window.U.normUsSymbol(it.symbol) || it.symbol) : ('us' + it.symbol);
          window.Bus.emit('symbol:open', {
            symbol: us, name: it.name || it.symbol, market: 'us',
            code: (it.tags && it.tags.tvSymbol) || it.symbol,
            tencent: us,
            usSignals: it,          // 详情面板消费：US 信号的口径与警告随行携带
          });
        }
      }
    });
    // 键盘可达性：行上 Enter/Space 进详情（与主终端卡片行为一致）
    view.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('.ussig-row');
      if (row) { e.preventDefault(); row.click(); }
    });
    // 自选变化（主终端任意处收/取星）→ 星标初始态同步（键与星标同一把 usAAPL 钥匙）
    window.Bus.on('watchlist', function () {
      try {
        state.watchSet = {};
        window.Store.watchlist.all().forEach(function (w) {
          var k = (window.U && window.U.normUsSymbol) ? (window.U.normUsSymbol(w.symbol) || w.symbol) : w.symbol;
          state.watchSet[k] = true;
        });
      } catch (e) { /* 同上 */ }
      if (state.status === 'ok') render();
    });
  }

  function syncSwitches() {
    var rsi = $('ussig-rsi'), cyc = $('ussig-cycle');
    if (rsi) [].forEach.call(rsi.querySelectorAll('[data-ussig-p]'), function (b) {
      var on = b.getAttribute('data-ussig-p') === state.period;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    if (cyc) [].forEach.call(cyc.querySelectorAll('[data-ussig-cycle]'), function (b) {
      var on = b.getAttribute('data-ussig-cycle') === state.cycle;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }

  function boot() {
    el.ready = true;
    state.period = getLS('ussig_period', '6') === '14' ? '14' : '6';
    state.cycle = getLS('ussig_cycle', 'daily') === 'weekly' ? 'weekly' : 'daily';
    bind();
    window.Bus.on('tab', function (tab) {
      if (tab !== 'ussig') return;
      if (!state.loaded && state.status !== 'loading') load();
      else if (state.status === 'ok') render();
    });
    syncSwitches();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 详情页信号胶囊卡的渲染口（app.js loadTechnical 消费；vm 单测直接调）。
  // boot 依赖 DOM，但 renderCard 是纯函数——测试环境只碰这一个导出。
  window.UsSignals = { renderCard: renderCard };
})();
