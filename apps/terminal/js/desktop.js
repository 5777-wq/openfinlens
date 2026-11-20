/* desktop.js —— 轻量桌面版面板装配层（2026-11-20）。
   只由 desktop.html 加载（js-bundle.manifest.json 的 notLoaded 登记，不进两个
   bundle——移动用户零字节负担）。全部能力来自 bundle.js 已有的 window 全局面：
   U / Bus / Store / Charts / Technical / TencentSource / EastmoneySource /
   BinanceSource / NewsSource / SourceState + 宇宙常量表。本文件不做取数协议、
   不引第三方、不做图表实现——只做布局装配、轮询调度与紧凑渲染。
   合规同主站：不碰预测市场、无品牌词；所有外发请求走既有源模块。 */
(function () {
  'use strict';

  /* ---------- 全局面与工具 ---------- */
  var U = window.U, Bus = window.Bus, Store = window.Store, Charts = window.Charts;
  var TC = window.TencentSource, EM = window.EastmoneySource, BIN = window.BinanceSource;
  var NEWS = window.NewsSource;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    if (U && typeof U.escapeHTML === 'function') return U.escapeHTML(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pctCls(n) { return n == null || !isFinite(n) ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }
  function fmtPct(n) {
    if (n == null || !isFinite(n)) return '--';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtPrice(n) {
    if (n == null || !isFinite(n)) return '--';
    return Number(n) >= 1000 ? Number(n).toFixed(2) : Number(n).toFixed(Number(n) < 10 ? 4 : 2);
  }
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------- 统一轮询调度：页面不可见即停，回到前台立即补一轮 ---------- */
  var Sched = {
    jobs: [],
    add: function (ms, fn) { this.jobs.push({ ms: ms, fn: fn, last: 0 }); },
    kick: function () {
      var now = Date.now();
      this.jobs.forEach(function (j) {
        if (now - j.last >= j.ms) { j.last = now; try { j.fn(); } catch (e) { /* 单轮失败不拖垮调度 */ } }
      });
    },
    start: function () {
      var self = this;
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) self.kick();
      });
      this.kick();
      setInterval(function () { if (!document.hidden) self.kick(); }, 15000);
    },
  };

  /* ---------- 主题（与 index.html 同一份 Store.settings 存量） ---------- */
  var Theme = {
    label: { nexus: '深空', daylight: '日光' },
    meta: { nexus: '#0b0e14', daylight: '#ffffff' },
    apply: function (t, rerender) {
      if (t !== 'nexus' && t !== 'daylight') t = 'daylight';
      document.documentElement.dataset.theme = t;
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.content = this.meta[t];
      var btn = $('dtTheme');
      if (btn) btn.textContent = this.label[t];
      if (rerender && Charts && typeof Charts.retheme === 'function' && Kline.chart) {
        try { Charts.retheme(Kline.chart); } catch (e) { /* 图表未就绪时忽略 */ }
      }
    },
    init: function () {
      var self = this;
      var cur = (Store && Store.settings && Store.settings.get().theme) || 'daylight';
      this.apply(cur, false);
      var btn = $('dtTheme');
      if (btn) btn.addEventListener('click', function () {
        var next = document.documentElement.dataset.theme === 'daylight' ? 'nexus' : 'daylight';
        try { if (Store && Store.settings) Store.settings.set({ theme: next }); } catch (e) { /* 隐私模式忽略 */ }
        self.apply(next, true);
      });
    },
  };

  /* ---------- K 线面板 ---------- */
  var Kline = {
    chart: null,
    target: null,
    period: 'day',
    gen: 0,
    /* 图表实例销毁（Wave 1 泄漏修复）：charts.js 的 remove() 是全量清理
       （window resize / document 键鼠 / 副图 RO / 画线层）。换标的/换周期/空态
       都必须先走这里——否则旧实例的监听随切换累积（首跑实测 20 次切换监听暴涨）。 */
    destroyChart: function () {
      if (this.chart && typeof this.chart.remove === 'function') {
        try { this.chart.remove(); } catch (e) { /* 实例已损坏时尽力而为 */ }
      }
      this.chart = null;
    },
    MA_LINES: [
      { type: 'ma', n: 5, on: true },
      { type: 'ma', n: 20, on: true },
      { type: 'ema', n: 26, on: true },
    ],
    /* 路由：tc=腾讯符号（sh600519/usAAPL/hk00700）；em=东财 secid（100.N225/105.AAPL）；
       crypto=币安符号（BTCUSDT）。与移动端 openDetail 的分源口径一致（K线主源腾讯，
       东财 push2his 兜底；加密走币安）。 */
    fetchKlines: function (t, period) {
      if (t.kind === 'crypto') {
        return BIN.getKline(t.symbol, period === 'week' ? '1w' : '1d', 320);
      }
      if (t.kind === 'em' && t.secid) {
        return EM.getKline(t.secid, period === 'week' ? 102 : 101).catch(function () { return []; });
      }
      if (t.symbol) {
        return TC.getKline(t.symbol, period).then(function (d) {
          if (d && d.length) return d;
          if (t.secid) return EM.getKline(t.secid, period === 'week' ? 102 : 101).catch(function () { return []; });
          return [];
        });
      }
      return Promise.resolve([]);
    },
    show: function (t) {
      if (!Charts) return;
      this.target = t;
      var gen = ++this.gen;
      var host = $('dtKlineHost');
      var title = $('dtKlineTitle');
      if (title) title.textContent = (t.name || t.symbol) + (t.code && t.code !== t.symbol ? ' · ' + t.code : '');
      if (!host) return;
      var self = this;
      // Wave 1 泄漏修复：换标的/换周期先销毁旧实例再拉数据（请求在途时旧图仍可看，
      // 数据回来才换新图——销毁放在数据到达后的重建前，两分支全覆盖）
      this.fetchKlines(t, this.period).then(function (rows) {
        if (gen !== self.gen) return;   // 快速切换时丢弃慢响应
        if (!rows || !rows.length) {
          self.destroyChart();          // 空态也清实例：监听不残留
          host.innerHTML = '<div class="dt-empty">该周期暂无数据（' + esc(t.name || t.symbol) + '）</div>';
          host.classList.remove('is-on');
          return;
        }
        self.destroyChart();            // 重建前必清旧实例（窗口/document/RO 监听随旧实例销毁）
        host.innerHTML = '';
        host.classList.add('is-on');
        var h = Charts.createKline(host);
        if (!h) {
          host.innerHTML = '<div class="dt-empty">图表内核未就绪</div>';
          return;
        }
        self.chart = h;
        if (h.setInfo) h.setInfo({ code: t.code || t.symbol || '', period: self.period === 'week' ? '周' : '日' });
        if (h.setPanes) h.setPanes([{ key: 'vol', params: {} }]);
        if (h.setMAVisible) h.setMAVisible(self.MA_LINES);
        h.setData(rows);
        self.syncWatchActive();
      }).catch(function () {
        if (gen !== self.gen) return;
        host.innerHTML = '<div class="dt-empty">行情源暂不可达，稍后再试</div>';
      });
    },
    setPeriod: function (p) {
      this.period = p === 'week' ? 'week' : 'day';
      [].forEach.call(document.querySelectorAll('.dt-seg-btn'), function (b) {
        var on = b.getAttribute('data-period') === p;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      if (this.target) this.show(this.target);
    },
    syncWatchActive: function () {
      var cur = this.target && this.target.key;
      [].forEach.call(document.querySelectorAll('#dtWatchBody tr[data-key]'), function (tr) {
        tr.classList.toggle('on', tr.getAttribute('data-key') === cur);
      });
    },
    init: function () {
      var self = this;
      [].forEach.call(document.querySelectorAll('.dt-seg-btn'), function (b) {
        b.addEventListener('click', function () { self.setPeriod(b.getAttribute('data-period')); });
      });
    },
  };

  /* ---------- 自选面板（与完整版同一 Store.watchlist 存量） ---------- */
  var Watch = {
    rows: [],           // 最近一次报价快照（symbol → row）
    routes: {},         // symbol → kline 路由
    items: function () {
      try { return (Store && Store.watchlist && Store.watchlist.all()) || []; } catch (e) { return []; }
    },
    routeOf: function (item) {
      var sym = String(item.symbol || '');
      if (item.market === 'crypto' || /^[A-Z0-9]+USDT$/.test(sym)) {
        return { kind: 'crypto', symbol: sym, code: sym, name: item.name || sym, market: 'crypto' };
      }
      // Wave 1：裸美股 ticker（us-signals 早期写入的自选存量）先走统一规范化——
      // 兜底之前映射成 usAAPL，腾讯路由才有钥匙（拉得到行情/开得了 K 线）
      if (U && typeof U.normUsSymbol === 'function' && U.isBareUsTicker(sym)) {
        var us = U.normUsSymbol(sym);
        return { kind: 'tc', symbol: us.toLowerCase(), code: sym, name: item.name || sym, market: 'us' };
      }
      if (/^(sh|sz|bj|hk|us)/i.test(sym)) {
        return { kind: 'tc', symbol: sym.toLowerCase(), code: sym, name: item.name || sym, market: item.market || '' };
      }
      if (/^EM:/.test(sym)) {
        return { kind: 'em', secid: sym.slice(3), code: sym.slice(3), name: item.name || sym, market: item.market || '' };
      }
      return { kind: 'tc', symbol: sym.toLowerCase(), code: sym, name: item.name || sym, market: item.market || '' };
    },
    keyOf: function (r) { return r.kind + ':' + (r.secid || r.symbol); },
    fetch: function () {
      var items = this.items();
      if (!items.length) { this.render(); return Promise.resolve(); }
      var tcSyms = [], emSecids = [], binSyms = [], self = this;
      items.forEach(function (it) {
        var r = self.routeOf(it);
        self.routes[self.keyOf(r)] = r;
        if (r.kind === 'crypto') binSyms.push(r.symbol);
        else if (r.kind === 'em') emSecids.push(r.secid);
        else tcSyms.push(r.symbol);
      });
      var jobs = [];
      if (tcSyms.length && TC) jobs.push(TC.getQuotes(tcSyms));
      if (emSecids.length && EM) jobs.push(EM.getQuotes(emSecids));
      if (binSyms.length && BIN) jobs.push(BIN.getQuotes(binSyms).catch(function () { return []; }));
      return Promise.all(jobs).then(function (parts) {
        var byKey = {};
        parts.forEach(function (rows) {
          (rows || []).forEach(function (q) {
            if (!q) return;
            if (q.secid) byKey['em:' + q.secid] = q;
            if (q.symbol) {
              byKey['tc:' + String(q.symbol).toLowerCase()] = q;
              byKey['crypto:' + String(q.symbol).toUpperCase()] = q;
            }
          });
        });
        self.rows = items.map(function (it) {
          var r = self.routeOf(it);
          var q = byKey[self.keyOf(r)] || null;
          return { item: it, route: r, q: q };
        });
        self.render();
      });
    },
    render: function () {
      var body = $('dtWatchBody');
      if (!body) return;
      var items = this.items();
      if (!items.length) {
        body.innerHTML = '<div class="dt-empty">自选为空——去完整版点卡片右上角的星，或用上方搜索打开标的</div>';
        return;
      }
      var self = this;
      var html = '<table class="dt-watch-table"><thead><tr>' +
        '<th scope="col">名称</th><th scope="col">最新</th><th scope="col">涨跌</th><th scope="col"> </th>' +
        '</tr></thead><tbody>';
      this.rows.length ? this.rows.forEach(function (r) {
        var q = r.q || {};
        var pct = q.changePct != null ? q.changePct : null;
        var key = esc(self.keyOf(r.route));
        html += '<tr class="dt-row" data-key="' + key + '" tabindex="0" role="button" aria-label="' +
          esc(r.item.symbol + ' ' + (r.item.name || '') + ' K线') + '">' +
          '<td><span class="dt-w-name">' + esc(r.item.name || r.item.symbol) + '</span>' +
          '<span class="dt-w-code">' + esc(r.item.symbol) + '</span></td>' +
          '<td>' + fmtPrice(q.price) + '</td>' +
          '<td class="dt-w-pct ' + pctCls(pct) + '">' + fmtPct(pct) + '</td>' +
          '<td><button class="dt-star on" type="button" data-unstar="' + esc(r.item.symbol) +
          '" aria-label="取消自选 ' + esc(r.item.symbol) + '">★</button></td></tr>';
      }) : items.forEach(function (it) {
        html += '<tr class="dt-row" data-key="' + esc(it.symbol) + '"><td><span class="dt-w-name">' +
          esc(it.name || it.symbol) + '</span><span class="dt-w-code">' + esc(it.symbol) + '</span></td>' +
          '<td>--</td><td class="dt-w-pct flat">--</td><td></td></tr>';
      });
      html += '</tbody></table>';
      body.innerHTML = html;
      Kline.syncWatchActive();
    },
    bind: function () {
      var self = this;
      var body = $('dtWatchBody');
      if (body) body.addEventListener('click', function (e) {
        var un = e.target.closest('[data-unstar]');
        if (un) {
          e.stopPropagation();
          var sym = un.getAttribute('data-unstar');
          var item = self.items().filter(function (x) { return x.symbol === sym; })[0];
          try {
            if (item && Store && Store.watchlist) Store.watchlist.toggle(item);
            if (Bus) Bus.emit('watchlist');
          } catch (err) { /* 隐私模式忽略 */ }
          self.fetch();
          return;
        }
        var tr = e.target.closest('tr[data-key]');
        if (!tr) return;
        var r = self.routes[tr.getAttribute('data-key')];
        if (r) Kline.show(r);
      });
      if (body) body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr[data-key]');
        if (tr) { e.preventDefault(); tr.click(); }
      });
      if (Bus) Bus.on('watchlist', function () { self.fetch(); });
    },
  };

  /* ---------- 指数跑马条 ---------- */
  var Tape = {
    fetch: function () {
      var el = $('dtTape');
      if (!el) return Promise.resolve();
      var tcSyms = [], emSecids = [], meta = {};
      (window.TENCENT_UNIVERSE || []).forEach(function (u) {
        if (u.group !== 'index') return;
        tcSyms.push(u.symbol);
        meta['tc:' + u.symbol] = u.label;
      });
      (window.GLOBAL_INDEX || []).forEach(function (g) {
        emSecids.push(g.secid);
        meta['em:' + g.secid] = g.name;
      });
      var jobs = [];
      if (tcSyms.length && TC) jobs.push(TC.getQuotes(tcSyms));
      if (emSecids.length && EM) jobs.push(EM.getQuotes(emSecids).catch(function () { return []; }));
      return Promise.all(jobs).then(function (parts) {
        var out = [];
        parts.forEach(function (rows) {
          (rows || []).forEach(function (q) {
            if (!q || q.price == null) return;
            var key = q.secid ? 'em:' + q.secid : 'tc:' + String(q.symbol).toLowerCase();
            out.push({ name: meta[key] || q.name || q.symbol || '', price: q.price, pct: q.changePct,
              route: q.secid ? { kind: 'em', secid: q.secid, code: q.secid, name: meta[key] || q.name }
                             : { kind: 'tc', symbol: String(q.symbol).toLowerCase(), code: q.symbol, name: meta[key] || q.name } });
          });
        });
        if (!out.length) { el.innerHTML = '<span class="dt-tape-item dt-muted">行情源暂不可达</span>'; return; }
        el.innerHTML = out.map(function (r) {
          return '<button class="dt-tape-item" type="button" data-tape="' + esc(r.name) + '">' +
            '<span class="t-name">' + esc(r.name) + '</span>' +
            '<span class="t-price">' + fmtPrice(r.price) + '</span>' +
            '<span class="t-pct ' + pctCls(r.pct) + '">' + fmtPct(r.pct) + '</span></button>';
        }).join('');
        var byName = {};
        out.forEach(function (r) { byName[r.name] = r.route; });
        el.onclick = function (e) {
          var b = e.target.closest('[data-tape]');
          if (!b) return;
          var r = byName[b.getAttribute('data-tape')];
          if (r) Kline.show(r);
        };
      });
    },
  };

  /* ---------- 新闻流 ---------- */
  var News = {
    fetch: function () {
      var body = $('dtNewsBody');
      if (!body) return Promise.resolve();
      // NewsSource 由 desktop.html 单独挂 js/sources/news.js；缺失时显式降级，
      // 不许面板停在「载入中」（2026-11-20 本地冒烟实测踩中）
      if (!NEWS || !NEWS.getNews) {
        body.innerHTML = '<li class="dt-empty">新闻源未就绪（news.js 未加载）</li>';
        return Promise.resolve();
      }
      return NEWS.getNews().then(function (res) {
        var list = (res && res.list) || [];
        if (!list.length) {
          body.innerHTML = '<li class="dt-empty">新闻源暂不可达</li>';
          return;
        }
        body.innerHTML = list.slice(0, 30).map(function (n) {
          return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc(n.title) + '</a><span class="dt-news-time"> ' + fmtTime(n.time) + '</span></li>';
        }).join('');
      }).catch(function () {
        body.innerHTML = '<li class="dt-empty">新闻源暂不可达</li>';
      });
    },
  };

  /* ---------- 美股信号（吃 data/us-signals.json，与主站同产物） ---------- */
  var UsSig = {
    data: null,        // 最近一次 us-signals.json（重渲染复用）
    filter: 'all',     // 筛选键（与完整版 ussig chips 同一口径的桌面子集）
    usKey: function (sym) {
      return (U && typeof U.normUsSymbol === 'function') ? (U.normUsSymbol(sym) || sym) : ('us' + sym);
    },
    fetch: function () {
      var body = $('dtUssigBody');
      if (!body) return Promise.resolve();
      return fetch('data/us-signals.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.schemaVersion !== 1) throw new Error('协议版本不符');
        this.data = j;
        this.render();
      }.bind(this)).catch(function () {
        body.innerHTML = '<div class="dt-empty">us-signals.json 尚未生成或不可达——Meridian 采集链未跑或 data 分支未部署</div>';
      });
    },
    rsiCell: function (r) {
      if (!r || !Number.isFinite(r.value)) return '--';
      var cls = r.state === 'overbought' ? ' dt-up' : r.state === 'oversold' ? ' dt-down' : '';
      return '<span class="' + cls + '">' + Number(r.value).toFixed(1) + '</span>';
    },
    matches: function (it) {
      var f = this.filter;
      if (f === 'all') return true;
      var r6 = it.daily && it.daily.rsi6, w6 = it.weekly && it.weekly.rsi6;
      if (f === 'ob') return !!(r6 && r6.state === 'overbought');
      if (f === 'os') return !!(r6 && r6.state === 'oversold');
      if (f === 'obr') return !!(r6 && r6.cross === 'out_ob');
      if (f === 'osr') return !!(r6 && r6.cross === 'out_os');
      if (f === 'wob') return !!(w6 && w6.state === 'overbought');
      if (f === 'wos') return !!(w6 && w6.state === 'oversold');
      if (f === 'watch') return !!(it.tags && it.tags.watch);
      return true;
    },
    render: function () {
      var body = $('dtUssigBody');
      var j = this.data;
      if (!body || !j) return;
      var mc = j.marketClock || {};
      var clock = $('dtUssigClock');
      if (clock) {
        clock.textContent = '美东收盘 ' + (mc.marketDate || '--') +
          (mc.etTime ? ' · ' + mc.etTime + ' ET' : '') + ' · 日线 RSI6/14 + Vegas';
      }
      var counts = (j.summary && j.summary.counts) || {};
      var self = this;
      var chips = [['all', '全部'], ['ob', '日超买'], ['os', '日超卖'], ['obr', '日转出'],
        ['wob', '周超买'], ['wos', '周超卖'], ['watch', '自选']]
        .filter(function (p) { return p[0] === 'all' || typeof counts[p[0]] === 'number' || p[0] === 'watch'; })
        .map(function (p) {
          var n = p[0] === 'all' ? (j.items || []).length : (p[0] === 'watch' ? null : counts[p[0]]);
          return '<button class="dt-ussig-badge' + (self.filter === p[0] ? ' on' : '') +
            '" type="button" data-us-f="' + p[0] + '"' + (n != null ? ' data-n="' + n + '"' : '') + '>' +
            esc(p[1]) + (n != null ? ' ' + n : '') + '</button>';
        }).join(' ');
      var items = (j.items || []).slice(0, 24).filter(function (it) { return self.matches(it); });
      if (!items.length) {
        body.innerHTML = (chips ? '<div style="margin-bottom:8px">' + chips + '</div>' : '') +
          '<div class="dt-empty">该筛选下暂无明细</div>';
        return;
      }
      var html = (chips ? '<div style="margin-bottom:8px">' + chips + '</div>' : '') +
        '<table class="dt-ussig-table"><thead><tr>' +
        '<th scope="col">自选</th><th scope="col">标的</th><th scope="col">现价</th><th scope="col">涨跌</th>' +
        '<th scope="col">日RSI6</th><th scope="col">日RSI14</th><th scope="col">周RSI6</th><th scope="col">标签</th>' +
        '</tr></thead><tbody>';
      items.forEach(function (it) {
        var tags = it.tags || {};
        var tagTxt = [tags.sp500 ? '标普' : null, tags.ndx100 ? '纳指' : null, tags.watch ? '自选' : null]
          .filter(Boolean).join('+') || '--';
        var d6 = it.daily && it.daily.rsi6, d14 = it.daily && it.daily.rsi14;
        var w6 = it.weekly && it.weekly.rsi6;
        var us = self.usKey(it.symbol);
        var on = false;
        try { on = Store && Store.watchlist && Store.watchlist.has(us); } catch (e) { /* 隐私模式 */ }
        html += '<tr class="dt-row" data-us="' + esc(us) + '" data-name="' + esc(it.name || it.symbol) +
          '" tabindex="0" role="button" aria-label="' + esc(it.symbol + ' ' + (it.name || '') + ' K线') + '">' +
          '<td><button class="dt-star' + (on ? ' on' : '') + '" type="button" data-us-star="' + esc(us) +
          '" data-us-name="' + esc(it.name || it.symbol) + '" aria-label="' + (on ? '取消自选 ' : '加入自选 ') + esc(it.symbol) +
          '">' + (on ? '★' : '☆') + '</button></td>' +
          '<td><span class="dt-w-name">' + esc(it.name || it.symbol) + '</span>' +
          '<span class="dt-w-code">' + esc(it.symbol) + (it.rank != null ? ' #' + it.rank : '') + '</span></td>' +
          '<td>' + fmtPrice(it.price) + '</td>' +
          '<td class="dt-w-pct ' + pctCls(it.changePct) + '">' + fmtPct(it.changePct) + '</td>' +
          '<td>' + this.rsiCell(d6) + '</td><td>' + this.rsiCell(d14) + '</td><td>' + this.rsiCell(w6) + '</td>' +
          '<td>' + esc(tagTxt) + '</td></tr>';
      }, this);
      html += '</tbody></table>';
      body.innerHTML = html;
    },
    bind: function () {
      var body = $('dtUssigBody');
      if (!body) return;
      var self = this;
      body.addEventListener('click', function (e) {
        var star = e.target.closest('[data-us-star]');
        if (star) {
          e.stopPropagation();
          // 星标写终端命名空间 usAAPL——与主终端/自选页同一把钥匙，实时互通
          try {
            if (Store && Store.watchlist) {
              Store.watchlist.toggle({ symbol: star.getAttribute('data-us-star'), name: star.getAttribute('data-us-name'), market: 'us' });
              if (Bus) Bus.emit('watchlist');
            }
          } catch (err) { /* 隐私模式忽略 */ }
          self.render();
          return;
        }
        var chip = e.target.closest('[data-us-f]');
        if (chip) {
          self.filter = chip.getAttribute('data-us-f');
          self.render();
          return;
        }
        var tr = e.target.closest('tr[data-us]');
        if (!tr) return;
        var us = tr.getAttribute('data-us');
        Kline.show({ kind: 'tc', symbol: us.toLowerCase(), code: us.slice(2), name: tr.getAttribute('data-name') || us, market: 'us' });
      });
      body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr[data-us]');
        if (tr) { e.preventDefault(); tr.click(); }
      });
      // 主终端/自选页任意处收星 → 本面板星标态同步（与完整版同一条 Bus 约定）
      if (Bus) Bus.on('watchlist', function () { if (self.data) self.render(); });
    },
  };

  /* ---------- 搜索（东财 suggest → 直达 K 线） ---------- */
  var Search = {
    timer: null,
    results: [],
    init: function () {
      var input = $('dtSearch'), list = $('dtSearchList');
      if (!input || !list || !EM || !EM.search) return;
      var self = this;
      input.addEventListener('input', function () {
        clearTimeout(self.timer);
        var kw = input.value.trim();
        if (!kw) { list.hidden = true; return; }
        self.timer = setTimeout(function () { self.query(kw); }, 300);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { list.hidden = true; return; }
        if (e.key === 'Enter') {
          var pick = list.querySelector('li.on') || list.querySelector('li');
          if (pick) pick.click();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var lis = [].slice.call(list.querySelectorAll('li'));
          if (!lis.length) return;
          var i = lis.findIndex(function (x) { return x.classList.contains('on'); });
          lis.forEach(function (x) { x.classList.remove('on'); });
          var next = e.key === 'ArrowDown' ? Math.min(i + 1, lis.length - 1) : Math.max(i - 1, 0);
          if (i < 0 && e.key === 'ArrowDown') next = 0;
          lis[next].classList.add('on');
        }
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.dt-search')) list.hidden = true;
      });
      list.addEventListener('click', function (e) {
        var li = e.target.closest('li[data-secid]');
        if (!li) return;
        list.hidden = true;
        input.value = '';
        Kline.show({
          kind: 'em', secid: li.getAttribute('data-secid'),
          code: li.getAttribute('data-code') || '', name: li.getAttribute('data-name') || '',
        });
      });
    },
    query: function (kw) {
      var list = $('dtSearchList');
      var self = this;
      EM.search(kw).then(function (out) {
        self.results = out || [];
        if (!self.results.length) { list.hidden = true; return; }
        list.innerHTML = self.results.map(function (r, i) {
          return '<li role="option" data-secid="' + esc(r.secid) + '" data-code="' + esc(r.code) +
            '" data-name="' + esc(r.name) + '"' + (i === 0 ? ' class="on"' : '') + '>' +
            '<span class="s-name">' + esc(r.name) + '</span>' +
            '<span class="s-code">' + esc(r.code) + '</span>' +
            '<span class="s-mkt">' + esc(r.marketName || '') + '</span></li>';
        }).join('');
        list.hidden = false;
      }).catch(function () { if (list) list.hidden = true; });
    },
  };

  /* ---------- 分隔条：拖拽调面板大小（双击复位、方向键微调、布局落盘） ---------- */
  var Split = {
    DEF: { sw: 320, bh: 300 },
    cfg: { sw: 320, bh: 300 },
    load: function () {
      try {
        var c = Store ? Store.get('dtLayout', null) : null;
        if (c && Number.isFinite(c.sw) && Number.isFinite(c.bh)) this.cfg = { sw: c.sw, bh: c.bh };
      } catch (e) { /* 隐私模式用默认 */ }
      this.apply();
    },
    apply: function () {
      var app = document.querySelector('.dt-app');
      if (!app) return;
      app.style.setProperty('--dt-sw', this.cfg.sw + 'px');
      app.style.setProperty('--dt-bh', this.cfg.bh + 'px');
    },
    save: function () { try { if (Store) Store.set('dtLayout', this.cfg); } catch (e) { /* 忽略 */ } },
    /* dir='col'：拖出自选栏宽（相对壳左缘）；dir='row'：拖出下排高（相对壳底缘扣状态栏） */
    bind: function (id, dir, key, min, max) {
      var el = $(id);
      if (!el) return;
      var self = this;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件/无活动指针时忽略 */ }
        el.classList.add('on');
        var move = function (ev) {
          var appRect = document.querySelector('.dt-app').getBoundingClientRect();
          if (dir === 'col') {
            self.cfg[key] = Math.max(min, Math.min(max, Math.round(ev.clientX - appRect.left)));
          } else {
            var foot = document.querySelector('.dt-foot');
            var footH = foot ? foot.getBoundingClientRect().height : 30;
            self.cfg[key] = Math.max(min, Math.min(max, Math.round(appRect.bottom - ev.clientY - footH)));
          }
          self.apply();
        };
        var up = function () {
          el.classList.remove('on');
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          self.save();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
      el.addEventListener('dblclick', function () {
        self.cfg[key] = self.DEF[key];
        self.apply();
        self.save();
      });
      el.addEventListener('keydown', function (e) {
        var d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -16
          : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 16 : 0;
        if (!d) return;
        e.preventDefault();
        self.cfg[key] = Math.max(min, Math.min(max, self.cfg[key] + d));
        self.apply();
        self.save();
      });
    },
    init: function () {
      this.load();
      this.bind('dtVsplit', 'col', 'sw', 260, 560);
      this.bind('dtHsplit', 'row', 'bh', 140, 620);
    },
  };

  /* ---------- 安装为桌面应用（standalone 独立窗口，无地址栏） ---------- */
  var Install = {
    deferred: null,
    init: function () {
      var btn = $('dtInstall');
      if (!btn) return;
      var self = this;
      // 已以独立窗口运行（或已安装）就不再展示安装按钮
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        self.deferred = e;
        btn.hidden = false;
      });
      btn.addEventListener('click', function () {
        if (!self.deferred) return;
        self.deferred.prompt();
        self.deferred.userChoice.then(function () {
          self.deferred = null;
          btn.hidden = true;
        }).catch(function () { /* 用户关闭弹窗 */ });
      });
      window.addEventListener('appinstalled', function () { btn.hidden = true; });
    },
  };

  /* ---------- 启动 ---------- */
  function boot() {
    if (!U || !Store || !Charts) {
      var g = document.querySelector('.dt-grid');
      if (g) g.innerHTML = '<div class="dt-panel" style="grid-column:1/-1"><div class="dt-empty">核心包未加载——请检查网络后刷新</div></div>';
      return;
    }
    Theme.init();
    Kline.init();
    Watch.bind();
    UsSig.bind();
    Search.init();
    Split.init();
    Install.init();

    // 软件感键盘操作：/ 聚焦搜索（输入控件内不劫持）
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.defaultPrevented) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var s = $('dtSearch');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
    });

    Sched.add(30000, function () { Tape.fetch(); Watch.fetch(); });
    Sched.add(300000, function () { News.fetch(); });
    Sched.add(600000, function () { UsSig.fetch(); });
    Sched.start();

    // 首帧：指数条与自选先出，K 线给个默认标的（自选第一只，否则上证指数）
    Tape.fetch();
    Watch.fetch().then(function () {
      var first = Watch.items()[0];
      if (first) Kline.show(Watch.routeOf(first));
      else Kline.show({ kind: 'tc', symbol: 'sh000001', code: '000001', name: '上证指数', market: 'cn' });
    });
    News.fetch();
    UsSig.fetch();

    var stat = $('dtStat');
    setInterval(function () {
      if (stat) stat.textContent = '行情更新 ' + new Date().toTimeString().slice(0, 8);
    }, 30000);
  }

  ready(boot);
})();
