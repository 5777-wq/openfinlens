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

  function rsiFrom(it, cycle, period) {  // 参数化取线（buildMarkdown/buildCSV 纯函数复用，不读 state）
    var src = cycle === 'weekly' ? (it.weekly || {}) : (it.daily || {});
    return (period === '14' ? (src.rsi14 || null) : (src.rsi6 || null));
  }
  function rsiOf(it) {           // 当前周期 + 当前周期线的 RSI 对象
    return rsiFrom(it, state.cycle, state.period);
  }
  function revertFlag(it, cycle) { return !!(cycle === 'weekly' ? it.weekly && it.weekly.revert : it.daily && it.daily.revert); }
  function revertOf(it) { return revertFlag(it, state.cycle); }
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
    if (f === 'revert') return !!(it.daily && it.daily.revert === true);
    if (f === 'ev') return vegasOf(it).some(function (v) { return v.event && v.event.indexOf('break') === 0; });
    if (f === 'wob') { var w = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w && w.state === 'overbought'); }
    if (f === 'wos') { var w2 = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w2 && w2.state === 'oversold'); }
    if (f === 'wret') { var w3 = it.weekly && (state.period === '14' ? it.weekly.rsi14 : it.weekly.rsi6); return !!(w3 && (w3.cross === 'out_ob' || w3.cross === 'out_os')); }
    return true;
  }

  /* ---------- Sprint2 S1「信号工作台」：可测纯函数（window.UsSignals 导出） ----------
     只提炼事实（回归/穿线/自选命中），不携带任何操作建议——合规红线。
     buildRadar/buildMarkdown/buildCSV 均不读 state、不碰 DOM，vm 单测直接调。 */

  var POS_FULL = { above: '通道上方', inside: '通道带内', below: '通道下方' };  // vdot title / 摘要全称
  var POS_JOIN = { above: '上方', inside: '带内', below: '下方' };              // 摘要内联：短通道＋方位

  var FILTER_DEFS = [   // 筛选键 → 中文标签（filterChipsHTML 与 buildMarkdown/buildCSV 共用一份）
    ['all', '全部'], ['ob', '超买'], ['os', '超卖'], ['obr', '超买回落'], ['osr', '超卖回升'],
    ['ev', '通道穿越'], ['wob', '周超买'], ['wos', '周超卖'], ['wret', '周回归'],
    ['sp500', 'SP500'], ['ndx100', 'QQQ'], ['spmo', 'SPMO 重合'], ['watch', '自选'],
  ];
  function filterLabel(f) {
    for (var i = 0; i < FILTER_DEFS.length; i++) if (FILTER_DEFS[i][0] === f) return FILTER_DEFS[i][1];
    return f;
  }

  function stateTxt(s) {
    if (s === 'overbought') return '超买';
    if (s === 'oversold') return '超卖';
    return s ? '中性' : '';
  }
  function normUsKey(s) {  // 与 starBtn 同一把 usAAPL 钥匙（自选集合的键）
    if (window.U && typeof window.U.normUsSymbol === 'function') return window.U.normUsSymbol(s) || s;
    return 'us' + s;
  }
  function vegasJoin(it, cycle) {  // 「短通道下方（break_up）、中通道带内」形态；数据不足诚实标注
    var list = (cycle === 'weekly' ? (it.weekly && it.weekly.vegas) : it.daily && it.daily.vegas) || [];
    return list.map(function (v) {
      if (!v || !v.pos) return (v && v.key || '') + '数据不足';
      return (v.key || '') + (POS_JOIN[v.pos] || v.pos || '') + (v.event ? '（' + String(v.event) + '）' : '');
    }).join('、');
  }
  function tagsJoin(it) {  // 「标普500+纳指100」形态
    var t = it.tags || {};
    return [t.sp500 ? '标普500' : '', t.ndx100 ? '纳指100' : ''].filter(Boolean).join('+');
  }

  /* 今日异动雷达：三组各按 rank 升序最多 2 枚。
     · revert 组 = it.daily.revert === true；点击筛选键 'revert'（matches 按
       daily.revert 直筛——回归组混有 out_os/out_ob 两种 cross，按首枚定向
       会丢另一半，2026-11-21 浏览器实测抓包后改直筛）
     · vegas 组  = daily.vegas 任一 v.event 非空；点击筛选键 'ev'
     · watch 组  = watchSet[normUs(symbol)] 且 rsi6 ob/os 或 revert 或 vegas 穿线；点击筛选键 'watch' */
  function buildRadar(items, watchSet, normUs) {
    var nfn = typeof normUs === 'function' ? normUs : function (s) { return s; };
    var rankOf = function (it) { return it && it.rank != null ? Number(it.rank) : 1e9; };  // 无 rank（如 SPMO）排末尾
    var byRank = (items || []).slice().sort(function (a, b) { return rankOf(a) - rankOf(b); });  // slice 防突变
    var pick = function (list) { return list.slice(0, 2).map(function (it) { return it && it.symbol; }); };
    var revert = byRank.filter(function (it) { return !!(it && it.daily && it.daily.revert === true); });
    var vegas = byRank.filter(function (it) {
      return ((it && it.daily && it.daily.vegas) || []).some(function (v) { return !!(v && v.event); });
    });
    var watch = byRank.filter(function (it) {
      if (!it || !watchSet || !watchSet[nfn(it.symbol)]) return false;
      var d = it.daily || {}, r6 = d.rsi6 || {};
      return r6.state === 'overbought' || r6.state === 'oversold' || d.revert === true ||
        (d.vegas || []).some(function (v) { return !!(v && v.event); });
    });
    return {
      revert: { filterKey: revert.length ? 'revert' : null, syms: pick(revert) },
      vegas: { filterKey: 'ev', syms: pick(vegas) },
      watch: { filterKey: 'watch', syms: pick(watch) },
    };
  }

  function mdEsc(s) {  // Markdown 文本转义（反斜杠先转，再处理 * ` _ [ ]）
    return String(s == null ? '' : s).replace(/([\\`*_\[\]])/g, '\\$1');
  }
  function csvCell(v) {  // RFC4180：含逗号/引号/换行的单元格加引号，内部引号翻倍
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* 结构化 Markdown 摘要：头部（周期口径 · 日期）＋ 计数行 ＋ 每条一行事实 ＋ 免责句。
     meta = { cycle:'daily'|'weekly', period:'6'|'14', date:'YYYY-MM-DD', filter, filterLabel } */
  function buildMarkdown(items, meta) {
    meta = meta || {};
    var cyc = meta.cycle === 'weekly' ? '周' : '日';
    var rsiLabel = cyc + 'RSI' + (meta.period === '14' ? '14' : '6');
    var lines = ['## 美股信号摘要（' + rsiLabel + (meta.date ? ' · ' + String(meta.date) : '') + '）', ''];
    lines.push('共 ' + (items ? items.length : 0) + ' 只 · 筛选：' + (meta.filterLabel || meta.filter || '全部'));
    lines.push('');
    if (!items || !items.length) lines.push('当前筛选没有匹配标的', '');
    (items || []).forEach(function (it) {
      if (!it) return;
      var parts = [];
      var r = rsiFrom(it, meta.cycle, meta.period);
      var val = r && isFinite(Number(r.value)) ? Number(r.value).toFixed(1) : '--';
      var st = stateTxt(r && r.state);
      parts.push(rsiLabel + ' ' + val + (st ? '（' + st + '）' : ''));
      var vg = vegasJoin(it, meta.cycle);
      if (vg) parts.push('Vegas ' + vg);
      if (revertFlag(it, meta.cycle)) parts.push('RSI 回归');
      var tg = tagsJoin(it);
      if (tg) parts.push(tg);
      var nm = it.name ? ' ' + mdEsc(it.name) : '';
      lines.push('- **' + mdEsc(it.symbol) + nm + '**：' + parts.join(' · '));
    });
    lines.push('', '仅供研究参考，不构成投资建议');
    return lines.join('\n');
  }

  /* CSV 导出文本：UTF-8 BOM 打头（Excel 直开不乱码），固定 9 列表头，CRLF 行尾。
     列：代码,名称,收盘,涨跌幅,日RSI6,日RSI14,周RSI6,信号,成分（RSI 三列与周期开关无关，两套都给）。 */
  function buildCSV(items, meta) {
    meta = meta || {};
    var rows = [['代码', '名称', '收盘', '涨跌幅', '日RSI6', '日RSI14', '周RSI6', '信号', '成分'].map(csvCell).join(',')];
    (items || []).forEach(function (it) {
      if (!it) return;
      var d = it.daily || {}, w = it.weekly || {};
      var segs = [];
      var r = rsiFrom(it, meta.cycle, meta.period);
      var st = stateTxt(r && r.state);
      if (st === '超买' || st === '超卖') segs.push(st);
      var vg = vegasJoin(it, meta.cycle);
      if (vg) segs.push('Vegas ' + vg);
      if (revertFlag(it, meta.cycle)) segs.push('RSI 回归');
      var f1 = function (v) { return isFinite(Number(v)) ? Number(v).toFixed(1) : ''; };
      rows.push([
        it.symbol || '',
        it.name || '',
        isFinite(Number(it.price)) ? Number(it.price).toFixed(2) : '',
        isFinite(Number(it.changePct)) ? Number(it.changePct).toFixed(2) : '',
        f1(d.rsi6 && d.rsi6.value),
        f1(d.rsi14 && d.rsi14.value),
        f1(w.rsi6 && w.rsi6.value),
        segs.join(' · '),
        tagsJoin(it),
      ].map(csvCell).join(','));
    });
    return '\ufeff' + rows.join('\r\n');
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

  function rsiBar(r) {
    // 48×5px 微型温度条（Sprint2 S1）：轨道 0–100，fill 从 0 到当前值，30/70 阈值刻度竖线；
    // 落点色 ≥70 --text-rise / ≤30 --text-fall / 中间 --text-secondary。纯装饰，aria-hidden。
    if (!r || !isFinite(Number(r.value))) return '';
    var v = Math.max(0, Math.min(100, Number(r.value)));
    var cls = r.value >= 70 ? ' t-hi' : r.value <= 30 ? ' t-lo' : '';
    return ' <span class="rsi-bar' + cls + '" aria-hidden="true">' +
      '<span class="rsi-fill" style="left:0%;width:' + v.toFixed(1) + '%"></span>' +
      '<span class="rsi-tick t30"></span><span class="rsi-tick t70"></span></span>';
  }

  function rowHTML(it) {
    var r = rsiOf(it);
    var vList = vegasOf(it).map(function (v) {
      // Sprint2 S1：长文本 → 三点矩阵（短/中/长单字徽标，pos 三态着色，穿线事件加描边）；
      // 悬停 title 给原文（键：方位（EMA n/n）· 事件），窄屏比整行文字省空间。
      if (!v || !v.pos) return '<span class="mut" title="数据不足">·</span>';
      var posCls = v.pos === 'above' ? ' v-above' : v.pos === 'below' ? ' v-below' : ' v-inside';
      var ttl = (v.key || '') + '：' + (POS_FULL[v.pos] || v.pos || '') + '（EMA' + (v.n || []).join('/') + '）' +
        (v.event ? ' · ' + String(v.event) : '') + (v.insufficient ? '（数据不足）' : '');
      return '<span class="vdot' + posCls + (v.event ? ' v-ev' : '') + '" title="' + esc(ttl) + '">' +
        esc((v.key || '').replace('通道', '')) + '</span>';
    }).join('');
    var rev = revertOf(it) ? badge('回落', 'ret', '收盘自上方回落进入通道（RSI 回归事件，仅陈述事实）') : '';
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
        '<span data-gloss="rsi" tabindex="0" role="button" aria-label="什么是RSI">' + (r ? num(r.value, 1) : '--') + '</span>' + rsiBar(r) + '</td>' +
      '<td>' + (wR ? num(wR.value, 1) : '--') + '</td>' +
      '<td class="sig">' + rev + ' <span class="vegas" data-gloss="vegas" tabindex="0" role="button" aria-label="什么是Vegas通道">' + vList + '</span></td>' +
      '<td class="mut">' + esc(idx || '--') + '</td>' +
      '<td>' + (it.spmoWeight != null ? it.spmoWeight.toFixed(1) + '%' : '--') + '</td>' +
      '</tr>';
  }

  function filterChipsHTML() {
    var c = (state.data && state.data.summary && state.data.summary.counts) || {};
    var items = (state.data && state.data.items) || [];
    // summary.counts 缺口一律诚实回 0（旧实现会误落到自选计数）
    var counts = {
      all: items.length,
      ob: c.ob, os: c.os, obr: c.obr, osr: c.osr, ev: c.events,
      wob: c.wob, wos: c.wos, wret: c.wret,
      sp500: items.filter(function (x) { return x.tags && x.tags.sp500; }).length,
      ndx100: items.filter(function (x) { return x.tags && x.tags.ndx100; }).length,
      spmo: items.filter(function (x) { return x.spmoWeight != null; }).length,
      watch: items.filter(function (x) { return x.tags && x.tags.watch; }).length,
    };
    return FILTER_DEFS.map(function (d) {
      var n = counts[d[0]];
      return '<button class="chip' + (state.filter === d[0] ? ' on' : '') + '" type="button" data-ussig-f="' + d[0] + '" aria-pressed="' + (state.filter === d[0]) + '">' +
        esc(d[1]) + ' <b>' + (n == null ? 0 : n) + '</b></button>';
    }).join('');
  }

  function toolsHTML() {  // 导出工具：chips 行末尾两枚轻按钮（Sprint2 S1 挂点④）
    return '<button class="pill ussig-act" type="button" data-ussig-copy="1" aria-label="复制当前筛选下的美股信号摘要（Markdown 格式）">复制摘要</button>' +
      '<button class="pill ussig-act" type="button" data-ussig-csv="1" aria-label="导出当前筛选下的美股信号为 CSV 文件">导出 CSV</button>';
  }

  function matchedItems() {  // 当前 filter + cycle + period 下 matches 的条目（SPMO 钉在表首）
    var d = state.data;
    if (!d) return [];
    var all = (d.items || []).slice();
    if (d.spmo) all.unshift(d.spmo);
    return all.filter(matches);
  }
  function snapshotMeta() {  // 导出纯函数的 meta 快照（周期口径 · 日期 · 筛选标签）
    var d = state.data || {};
    return {
      cycle: state.cycle,
      period: state.period,
      date: (d.marketClock && d.marketClock.marketDate) || '',
      filter: state.filter,
      filterLabel: filterLabel(state.filter),
    };
  }

  function radarHost() {  // 摘要带宿主：插在 chips 行下方（.ussig-head 之后）、工具行/表格上方；懒建一次
    var chips = $('ussig-chips');
    var head = chips && chips.parentElement;
    if (!head) return null;
    var host = $('ussig-radar');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ussig-radar';
      host.className = 'ussig-radar-band';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', '今日异动雷达');
      head.insertAdjacentElement('afterend', host);
    }
    return host;
  }
  function radarHTML(radar) {  // 组标签＋代码胶囊；组内相连、组间 1px 分隔线；aria-pressed 跟随当前筛选
    if (!radar) return '';
    var groups = [];
    if (radar.revert && radar.revert.syms.length) groups.push({ tag: '回归', f: radar.revert.filterKey || 'obr', syms: radar.revert.syms });
    if (radar.vegas && radar.vegas.syms.length) groups.push({ tag: '穿线', f: 'ev', syms: radar.vegas.syms });
    if (radar.watch && radar.watch.syms.length) groups.push({ tag: '自选', f: 'watch', syms: radar.watch.syms });
    if (!groups.length) return '';
    return '<span class="r-lead" aria-hidden="true">今日异动</span>' + groups.map(function (g) {
      return g.syms.map(function (s) {
        var on = state.filter === g.f;
        return '<button class="ussig-radar' + (on ? ' on' : '') + '" type="button" data-radar-f="' + esc(g.f) + '" aria-pressed="' + on + '" aria-label="' + esc(g.tag + '异动：' + s + '，按该组筛选') + '">' +
          '<span class="r-tag">' + esc(g.tag) + '</span><span class="r-sym">' + esc(s || '') + '</span></button>';
      }).join('');
    }).join('<span class="r-sep" aria-hidden="true"></span>');
  }

  function flash(btn, doneText) {  // 轻反馈：1.2s 后恢复原文字（期间防重入）
    if (!btn || btn.dataset.busy) return;
    var orig = btn.textContent;
    btn.dataset.busy = '1';
    btn.textContent = doneText;
    setTimeout(function () { btn.textContent = orig; delete btn.dataset.busy; }, 1200);
  }
  function copyText(text, btn) {  // clipboard API 优先，失败回退 execCommand('copy')，再失败诚实提示
    var done = function (ok) { flash(btn, ok ? '已复制 ✓' : '复制失败'); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }
  function copySummary(btn) {  // 复制摘要：当前 filter+cycle+period 下的 matches → Markdown
    if (!state.data) return;
    copyText(buildMarkdown(matchedItems(), snapshotMeta()), btn);
  }
  function exportCSV(btn) {  // 导出 CSV：同口径条目 → BOM CSV 下载（文件名含美东收盘日）
    if (!state.data) return;
    var meta = snapshotMeta();
    var stamp = String(meta.date || '').replace(/[^0-9]/g, '');
    if (!stamp) {
      var t = new Date();
      stamp = t.getFullYear() + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2);
    }
    try {
      var blob = new Blob([buildCSV(matchedItems(), meta)], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'us-signals-' + stamp + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash(btn, '已导出 ✓');
    } catch (e) { flash(btn, '导出失败'); }
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
    if (chips) chips.innerHTML = filterChipsHTML() + toolsHTML();
    // 今日异动雷达带（Sprint2 S1 挂点①）：chips 行下方、表格上方；提炼自 items + 自选集合
    var all = (d.items || []).slice();
    if (d.spmo) all.unshift(d.spmo);              // SPMO 钉在表首
    var rhost = radarHost();
    if (rhost) rhost.innerHTML = radarHTML(buildRadar(all, state.watchSet || {}, normUsKey));
    var body = $('ussig-body');
    if (!body) return;
    var vis = all.filter(matches);
    var head = '<tr><th class="stcol" aria-label="自选"></th><th>排名</th><th>代码</th><th>名称</th><th>收盘</th><th>涨跌</th>' +
      '<th>RSI' + esc(state.period) + (state.cycle === 'weekly' ? '（周）' : '') + '</th><th>周RSI</th><th>信号</th><th>成分</th><th>SPMO%</th></tr>';
    body.innerHTML = vis.length
      ? '<table class="ussig-table"><thead>' + head + '</thead><tbody>' + vis.map(rowHTML).join('') + '</tbody></table>'
      : '<div class="ussig-empty">当前筛选没有匹配标的</div>';
    var note = $('ussig-note');
    if (note) note.textContent = '显示 ' + vis.length + ' / ' + all.length + ' 只 · RSI' + state.period + ' · ' + (state.cycle === 'weekly' ? '周线' : '日线');
  }

  function renderEmpty(msg, retry) {
    var body = $('ussig-body');
    if (body) body.innerHTML = '<div class="ussig-empty">' + esc(msg) +
      (retry ? ' <button class="chip" type="button" data-ussig-retry="1">重试</button>' : '') + '</div>';
    var clock = $('ussig-clock');
    if (clock) clock.textContent = '';
    var chips = $('ussig-chips');
    if (chips) chips.innerHTML = '';
    var rhost = $('ussig-radar');
    if (rhost) rhost.innerHTML = '';   // 摘要带随空态一起清空（不建宿主，只清已有的）
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
      // 雷达胶囊（Sprint2 S1 挂点①）：点击 → 切到该组既有筛选键并联动 render（aria-pressed 随重渲染刷新）
      var rd = e.target.closest('[data-radar-f]');
      if (rd) { state.filter = rd.getAttribute('data-radar-f'); render(); return; }
      // 导出工具（挂点④）：复制 Markdown 摘要 / 下载 BOM CSV
      var cp = e.target.closest('[data-ussig-copy]');
      if (cp) { copySummary(cp); return; }
      var cs = e.target.closest('[data-ussig-csv]');
      if (cs) { exportCSV(cs); return; }
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
    /* 深链直达双保险（2026-11-21）：#ussig / #tab=ussig 直接打开时，Bus 'tab' 的
       emit 时机与 defer/ContentLoaded 存在竞态，监听可能收不到首帧事件——
       boot 即时自查一次 + 1.5s 兜底再查一次，两道都漏才算漏。
       调试探针默认关闭：URL 带 ?debug=1 才写 window.__ussigDebug（终审要求
       生产无探针残留；保留门控便于日后复诊）。 */
    const debugOn = /[?&]debug=1/.test(location.search || '');
    if (debugOn) { window.__ussigDebug = window.__ussigDebug || []; window.__ussigDebug.push('boot rs=' + document.readyState + ' hash=' + (location.hash || '').slice(0, 20)); }
    if (/ussig/.test(location.hash || '')) {
      if (debugOn) window.__ussigDebug.push('selfcheck-hit loaded=' + state.loaded + ' st=' + state.status);
      if (!state.loaded && state.status !== 'loading') { if (debugOn) window.__ussigDebug.push('selfcheck-load'); load(); }
    }
    setTimeout(function () {
      if (debugOn) window.__ussigDebug.push('t1500 loaded=' + state.loaded + ' st=' + state.status);
      if (!state.loaded && state.status !== 'loading' && /ussig/.test(location.hash || '')) { if (debugOn) window.__ussigDebug.push('t1500-load'); load(); }
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 详情页信号胶囊卡的渲染口（app.js loadTechnical 消费；vm 单测直接调）。
  // boot 依赖 DOM，但 renderCard 与 buildRadar/buildMarkdown/buildCSV 都是纯函数——
  // 测试环境只碰这四个导出，不触 DOM/网络。
  window.UsSignals = { renderCard: renderCard, buildRadar: buildRadar, buildMarkdown: buildMarkdown, buildCSV: buildCSV };
})();
