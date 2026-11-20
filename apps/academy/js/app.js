/* app.js —— 站点主控：路由编排 / 导航 / 报价条 / 键盘操控 / 主题 */
(function () {
  'use strict';

  const F = () => window.Fmt;
  const esc = (s) => window.Fmt.esc(s);

  const NAV = [
    { id: 'home',     path: '/',              label: '首页',       n: '00' },
    { id: 'concepts', path: '/concepts',      label: '货币与利率', n: '01', section: 'concepts' },
    { id: 'crisis',   path: '/crisis',        label: '危机复盘',   n: '02', section: 'crisis' },
    { id: 'assets',   path: '/assets',        label: '标的百科',   n: '03', section: 'assets' },
    { id: 'chains',   path: '/chains',        label: '产业链图谱', n: '04', section: 'chains' },
    { id: 'cycles',   path: '/cycles',        label: '周期与镜鉴', n: '05', section: 'cycles' },
    { id: 'family',   path: '/family',        label: '家庭理财',   n: '06', section: 'family' },
    { id: 'reports',  path: '/reports',       label: '读懂财报',   n: '07', section: 'reports' },
    { id: 'terms',    path: '/terms',         label: '术语库',     n: '08' },
    { id: 'data',     path: '/data',          label: '速查表',     n: '09' },
    { id: 'path',     path: '/path',          label: '新手路径',   n: '★' },
    { id: 'compare',  path: '/compare',       label: '资产对比',   n: '10' },
    { id: 'curve',    path: '/curve',         label: '收益率曲线', n: '11' },
    { id: 'analogy',  path: '/analogy',       label: '周期对照',   n: '12' },
    { id: 'calc',     path: '/calc',          label: '理财计算器', n: '13' },
    { id: 'saved',    path: '/saved',         label: '收藏与记录', n: '☆' },
    { id: 'quiz',     path: '/quiz',          label: '术语自测',   n: '?' },
  ];

  /* 左栏分组显式写出来，不再用 NAV.slice 猜下标——
     之前加栏目时 slice 没跟着改，「查词」组里混进了「读懂财报」。 */
  const NAV_GROUPS = [
    { label: '栏目', ids: ['home', 'concepts', 'crisis', 'assets', 'chains', 'cycles', 'family', 'reports'] },
    { label: '查词', ids: ['terms', 'data'] },
    { label: '工具', ids: ['compare', 'curve', 'analogy', 'calc'] },
    { label: '开始', ids: ['path', 'saved', 'quiz'] },
  ];

  const TABS = [
    { path: '/',         label: '首页',   icon: 'M3 11l9-8 9 8M5 10v10h14V10' },
    { path: '/concepts', label: '概念',   icon: 'M4 5h16M4 12h16M4 19h10' },
    { path: '/terms',    label: '术语',   icon: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z' },
    // 标的百科是全站最大的栏目，手机上却只有一个藏在报价条里的入口——
    // 而报价条看着像行情，不像导航。底栏给它一格。
    { path: '/assets',   label: '标的',   icon: 'M4 7h16M4 12h16M4 17h16M7 4v6' },
    { path: '/crisis',   label: '复盘',   icon: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5' },
    { path: '/chains',   label: '产业链', icon: 'M4 4v16h16M8 15l3-4 3 2 4-6' },
    { path: '/more',     label: '更多',   icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
  ];

  let currentKey = '';
  const stats = { routes: 0 };   // 渲染次数：冷启动只该有一次

  /* ---------------- 报头 ---------------- */
  function paintMasthead() {
    const d = document.getElementById('mh-date');
    if (d) d.textContent = F().cnDateWithWeek(F().today());

    // 报头右上角：行情终端入口。只给名字和链接，不写"姊妹站"这类关系称呼。
    const sister = document.getElementById('mh-sister');
    if (sister) {
      sister.textContent = 'OpenFinLens ↗';
      sister.href = (window.ACADEMY_SITE && window.ACADEMY_SITE.lensUrl) || 'https://5777-wq.github.io/openfinlens/';
      sister.target = '_blank';
      sister.rel = 'noopener';
    }

    // 报头下的时间刻度线：1990 → 2026
    const tr = document.getElementById('tick-rule');
    if (tr && !tr.childElementCount) {
      let html = '';
      for (let i = 0; i <= 36; i++) {
        const major = i % 6 === 0;
        html += `<i class="${major ? 'major' : ''}" style="left:${(i / 36 * 100).toFixed(2)}%"></i>`;
      }
      tr.innerHTML = html;
    }
  }

  /* ---------------- 左栏 ---------------- */
  function paintRail() {
    const rail = document.getElementById('rail');
    if (!rail) return;
    // 三组：栏目（六大栏目）· 查词（术语库与速查表）· 开始（新手路径）
    // 「查词」这一组是后加的——术语库 189 条、速查表十张表是站内最大的两块内容，
    // 之前只挂在正文链接里，左栏没有入口，等于把一半内容藏起来了。
    const groups = NAV_GROUPS.map((g) => ({
      label: g.label,
      items: g.ids.map((id) => NAV.find((x) => x.id === id)).filter(Boolean),
    }));
    rail.innerHTML = '<span class="rail-pill" id="rail-pill" aria-hidden="true"></span>' + groups.map((g) => `
      <div class="rail-group">
        <div class="rail-label">${esc(g.label)}</div>
        ${g.items.map((it) => {
          // 产业链的条目来自 vendor（10 条链），不是内容索引
          let count = null;
          if (it.id === 'terms') {
            count = Object.keys((window.Content && window.Content.glossary && window.Content.glossary()) || {}).length;
          } else if (it.id === 'data') {
            count = (window.TermView && window.TermView.CATS ? window.TermView.CATS : []).length;
          } else if (it.section === 'chains') {
            count = (typeof window.INDUSTRY_CHAINS !== 'undefined' && window.INDUSTRY_CHAINS) || [];
            count = count.length;
          } else if (it.section) {
            count = window.Content.bySection(it.section).length;
          }
          return `<a class="rail-item" data-path="${esc(it.path)}">
            <span class="ri-n">${esc(it.n)}</span>
            <span class="ri-t">${esc(it.label)}</span>
            ${count !== null ? `<span class="ri-c">${count}</span>` : ''}
          </a>`;
        }).join('')}
      </div>`).join('') + `
      <div class="rail-sister lens-only">
        <div class="rs-t">OpenFinLens</div>
        <p class="rs-d">实时行情终端。热力图、全球事件、产业链实时强弱、13F 与龙虎榜。</p>
        <a class="btn ghost sm" style="margin-top:10px;width:100%;justify-content:center" target="_blank" rel="noopener"
           ${(window.ACADEMY_SITE&&window.ACADEMY_SITE.lensUrl)||'https://5777-wq.github.io/openfinlens/'}">打开 ↗</a>
      </div>`;

    rail.querySelectorAll('.rail-item').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); window.Router.go(a.dataset.path); });
    });

    /* 「标的百科」这一项显示的是**页面上有多少条**（终端有 ∩ 本站有序列的标的，90+ 条），
       不是专文篇数——两者混在一列数字里，读者会以为点进去只有十几条。
       序列注册表是异步的，拿到后再回填这一个数字。 */
    const assetsCount = rail.querySelector('.rail-item[data-path="/assets"] .ri-c');
    if (assetsCount && window.History && window.History.registry) {
      window.History.registry().then((reg) => {
        const have = new Set(((reg && reg.series) || []).map((s) => s.id));
        const uni = [
          ...(window.TENCENT_UNIVERSE || []),
          ...(window.EM_UNIVERSE || []),
          ...(window.GLOBAL_INDEX || []),
        ];
        const n = uni.filter((u) => have.has(window.AssetsView && window.AssetsView.seriesIdOf
          ? window.AssetsView.seriesIdOf(u.symbol) : u.symbol)).length;
        if (n) assetsCount.textContent = String(n);
      }).catch(() => { /* 拿不到就保持原来的篇数 */ });
    }
  }

  function paintTabbar() {
    const bar = document.getElementById('tabbar');
    if (!bar) return;
    bar.innerHTML = TABS.map((t) => `
      <button data-path="${esc(t.path)}"${t.path === '/more' ? ' aria-haspopup="dialog" aria-controls="drawer"' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="${t.icon}"/>
        </svg>
        <span>${esc(t.label)}</span>
      </button>`).join('');
    bar.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const p = b.dataset.path;
        if (p === '/more') showNav();
        else if (p === '/search') openPalette();
        else window.Router.go(p);
      });
    });
  }

  function markActive(path) {
    /* 数据台账/序列也在「查词」里选「速查表」：否则进 #/status 时整条左栏
       一个选中项都没有，读者会以为导航丢了。 */
    const navPath = (path.indexOf('/status') === 0 || path.indexOf('/series/') === 0) ? '/data' : path;
    let activeEl = null;
    document.querySelectorAll('.rail-item').forEach((a) => {
      const p = a.dataset.path;
      const on = p === '/' ? navPath === '/' : navPath.indexOf(p) === 0;
      a.classList.toggle('on', on);
      if (on) activeEl = a;
      // 读屏用户要知道自己在哪一栏：当前这一项要标出来
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    /* Telegram 式滑动选中块：一个胶囊在左栏里平滑移动，而不是每一项
       各自闪一下底色。位置用 transform，不触发布局。 */
    const rail = document.getElementById('rail');
    const pill = document.getElementById('rail-pill');
    if (rail && pill) {
      let pillY = null;
      let pillH = 0;
      if (activeEl && rail.getBoundingClientRect && activeEl.getBoundingClientRect) {
        const rr = rail.getBoundingClientRect();
        const ar = activeEl.getBoundingClientRect();
        if (ar.height) {
          pillY = ar.top - rr.top + rail.scrollTop;
          pillH = ar.height;
        }
      } else if (activeEl && typeof activeEl.offsetTop === 'number' && activeEl.offsetHeight) {
        pillY = activeEl.offsetTop;
        pillH = activeEl.offsetHeight;
      }
      if (pillY !== null) {
        pill.style.height = pillH + 'px';
        pill.style.transform = 'translateY(' + pillY + 'px)';
        pill.style.opacity = '1';
        if (!pill.classList.contains('ready') && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => pill.classList.add('ready'));
        } else {
          pill.classList.add('ready');
        }
      } else {
        pill.style.opacity = '0';
      }
    }
    document.querySelectorAll('#tabbar button').forEach((b) => {
      const p = b.dataset.path;
      const on = p === '/' ? path === '/' : path.indexOf(p) === 0;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /* ---------------- 报价条 ---------------- */
  function paintTicker() {
    const box = document.getElementById('ticker');
    if (!box) return;
    const rows = window.Quotes.all();
    if (!rows.length) {
      const tried = !!window.Quotes.state.source;
      // 「行情暂不可用（数据源不可达且无本地缓存）」这句话像是在说站坏了。
      // 读者只要知道「暂时连不上、正在重试」就够了。
      box.innerHTML = `<span class="tk src-note">${tried ? '行情暂时连不上，正在重试' : '行情加载中…'}</span>`;
      return;
    }
    box.innerHTML = rows.map((q) => {
      const d = F().dir(q.pct);
      const pct = q.pct === null ? '--' : F().pct(q.pct);
      return `<a class="tk" href="#/assets" title="${esc(q.name)}">
        <span class="k">${esc(q.name)}</span>
        <span class="v">${F().num(q.price, q.digits)}</span>
        <span class="c ${d}">${pct}</span>
      </a>`;
    }).join('') + `<span class="tk src-note">${esc(window.Quotes.state.source)}${window.Quotes.state.degraded ? ' · 降级' : ''}</span>`;

    box.querySelectorAll('.tk[href]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); window.Router.go('/assets'); });
    });
  }

  /* ---------------- 路由 ---------------- */
  const SECTION_NAME = {
    concepts: '货币与利率', crisis: '危机复盘', assets: '标的百科',
    chains: '产业链图谱', cycles: '周期与镜鉴', family: '家庭理财',
    reports: '读懂财报',
  };
  const DEFAULT_DESC = '把美债收益率、黄金、纳指、原油、A股和 AI 产业链讲成金融小白听得懂的话。零后端、零密钥、零构建的金融科普站。';

  /** 标的 symbol → 站内专文 id（和 views/assets.js 用的是同一张表） */
  function assetArticleId(sym) {
    const map = (window.AssetsView && window.AssetsView.ARTICLE_OF) || {};
    return map[sym] || sym;
  }

  /** 这条路由要不要正文？首屏不拉任何正文，只有真读正文时才去取 */
  function bodyIdForRoute(r, params) {
    if (r.id === 'crisis-one' || (r.id === 'crisis' && params.id)) return params.id;
    if (r.id === 'asset') return assetArticleId(params.id);
    return null;
  }

  /**
   * 页面标题。
   * 约定：视图在容器上写 data-page-title="<内容名> · <栏目> · 白话金融"，
   * 有就用它；没有就按路由推一个——
   * 以前 189 个词条页共用一个「术语 · 白话金融」，
   * 浏览器开八个标签根本分不清是市盈率还是夏普，分享出去的卡片也没有词名。
   */
  function pageTitle(r, params, query, host) {
    const el = host && host.querySelector ? host.querySelector('[data-page-title]') : null;
    const t = el && el.getAttribute('data-page-title');
    if (t && String(t).trim()) return String(t).trim();
    return derivedTitle(r, params, query);
  }

  function derivedTitle(r, params, query) {
    const SITE = '白话金融';
    if (r.id === 'term') {
      const t = window.Content.term(params.id);
      return ((t && t.term) || '术语') + ' · 术语 · ' + SITE;
    }
    if (r.id === 'search') {
      const q = String((query && query.q) || '').trim();
      return q ? '搜索「' + q + '」· ' + SITE : '搜索 · ' + SITE;
    }
    if (r.id === 'tag') return '标签「' + String(params.tag || '') + '」· ' + SITE;
    if (r.id === 'compare') return '资产对比 · ' + SITE;
    if (r.id === 'curve') return '收益率曲线 · ' + SITE;
    if (r.id === 'analogy') return '周期对照 · ' + SITE;
    if (r.id === 'calc') return '理财计算器 · ' + SITE;
    if (r.id === 'saved') return '收藏与阅读记录 · ' + SITE;
    if (r.id === 'quiz') return '术语自测 · ' + SITE;
    if (r.id === 'series') return '序列 ' + String(params.id || '') + ' · 数据台账 · ' + SITE;
    if (r.id === 'status') return '数据台账 · ' + SITE;
    if (r.id === 'concept' || r.id === 'cycle' || r.id === 'family-one' || r.id === 'crisis-one') {
      const sec = SECTION_NAME[{ concept: 'concepts', cycle: 'cycles', 'family-one': 'family', 'crisis-one': 'crisis' }[r.id]];
      const meta = window.Content.meta(params.id);
      return ((meta && meta.title) || r.title) + ' · ' + (sec || r.title) + ' · ' + SITE;
    }
    if (r.id === 'asset') {
      const meta = window.Content.meta(assetArticleId(params.id));
      if (meta && meta.title) return meta.title + ' · 标的百科 · ' + SITE;
      const pages = (window.Content.assetPages ? window.Content.assetPages() : []);
      const hit = pages.filter((x) => x.symbol === params.id)[0];
      return ((hit && hit.label) || params.id) + ' · 标的百科 · ' + SITE;
    }
    return (r.title && r.title !== '首页' ? r.title + ' · ' : '') + SITE;
  }

  /** 分享卡片的描述：这一页在讲什么 */
  function pageDescription(r, params, query) {
    if (r.id === 'term') {
      const t = window.Content.term(params.id);
      return (t && t.one) || DEFAULT_DESC;
    }
    if (r.id === 'search') {
      const q = String((query && query.q) || '').trim();
      return q ? '站内搜索「' + q + '」的结果。' : DEFAULT_DESC;
    }
    if (r.id === 'tag') return '标签「' + String(params.tag || '') + '」下的文章与术语。';
    if (r.id === 'compare') return '任选 2–4 条序列，归一化到同一起点，对比历史涨跌、波动与回撤。';
    if (r.id === 'curve') return '美债与中债的收益率曲线：形状、倒挂与利差历史。';
    if (r.id === 'analogy') return '2000 年互联网泡沫与本轮 AI 周期的六维对照。分数是编辑判断，不是预测。';
    if (r.id === 'calc') return '通胀、定投、房贷、回本四个纯算术小工具。';
    if (r.id === 'saved') return '你收藏的文章与最近读过的页面，只存在本机。';
    if (r.id === 'quiz') return '从术语库生成的自测题，答错给解析。';
    if (r.id === 'series') return '这条长历史序列的来源、覆盖区间、图表与原始 JSON。';
    if (r.id === 'status') return '站内全部长历史序列的来源、覆盖与采集时间。';
    const id = r.id === 'asset' ? assetArticleId(params.id) : params.id;
    const meta = window.Content.meta(id);
    return (meta && meta.dek) || DEFAULT_DESC;
  }

  /** 分享卡片：每页改写成这一页的内容（爬虫不执行 JS，所以静态兜底写在 index.html 里） */
  function syncShare(title, desc) {
    const url = location.href;
    setMeta('og-title', title);
    setMeta('og-desc', desc);
    setMeta('og-url', url);
    setMeta('tw-title', title);
    setMeta('tw-desc', desc);
    const c = document.getElementById('canonical');
    if (c) c.setAttribute('href', url);
  }

  function setMeta(id, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', value);
  }

  /** 换页提示：读屏用户看不见页面变了，得有人告诉他一声 */
  function announcePage(title) {
    const live = document.getElementById('route-live');
    if (live) live.textContent = '当前页：' + title;
  }

  function route() {
    stats.routes++;
    const m = window.Router.current();
    const view = document.getElementById('view');
    if (!m) { window.Router.go('/'); return; }

    /* 抽屉开着的时候换页：先把它收掉。
       不收的话读者看到的是「页面换了，但抽屉还盖在上面，而且不能滚」——
       焦点也会掉到 body 上。 */
    if (window.TermDrawer && window.TermDrawer.isOpen()) window.TermDrawer.close();

    const key = location.hash;
    const prevKey = currentKey;
    if (key !== currentKey) {
      window.Router.stashScroll(currentKey);
      currentKey = key;
    }

    const { route: r, params, query } = m;
    const path = window.Router.parse(location.hash).path;
    if (view) {
      view.dataset.route = r.id;
      view.classList.toggle('reading', r.id !== 'home');
    }

    // 静态骨架是"首页的样子"。深链进别的页面时先换成中性占位，
    // 否则用户会先看到一段首页内容，然后突然变成危机列表。
    const viewEl = document.getElementById('view');
    if (viewEl && viewEl.dataset.skeleton === '1' && r.id !== 'home') {
      viewEl.innerHTML = `<div class="empty" style="padding:var(--s-8) 0">
        <div class="skel" style="height:22px;width:34%;margin:0 auto 16px"></div>
        <div class="skel" style="height:13px;width:58%;margin:0 auto 9px"></div>
        <div class="skel" style="height:13px;width:44%;margin:0 auto"></div>
      </div>`;
    }

    /* 每次路由换一个**新的容器节点**给视图用。
       为什么：assets / crisis 的渲染是 async（要先等 JSON），而用户在这期间
       可能已经切到别的页面。以前所有路由共用同一个 #view，旧页面的 await 回来后
       直接 view.innerHTML = ... —— 于是 URL 显示 A 页、页面上却是 B 页的内容。
       换成独立容器后，旧页面的异步结果写进的是**已经被换掉的旧容器**，屏幕上看不见。
       这是不改各个视图文件就能修掉竞态的办法。 */
    const host = document.createElement('div');
    host.className = 'route-host';
    view.innerHTML = '';
    view.appendChild(host);

    const errHtml = (e) => `<div class="empty"><div class="et">这一页出了点问题</div>
        <div class="ed">${esc(e && e.message ? e.message : String(e))}</div>
        <a class="btn ghost sm" href="#/">回首页</a></div>`;
    const skelHtml = () => `<div class="empty" style="padding:var(--s-8) 0">
        <div class="skel" style="height:22px;width:34%;margin:0 auto 16px"></div>
        <div class="skel" style="height:13px;width:58%;margin:0 auto 9px"></div>
        <div class="skel" style="height:13px;width:44%;margin:0 auto"></div>
      </div>`;

    const render = () => {
      switch (r.id) {
        case 'home': return window.HomeView.render(host);
        case 'concepts': return window.ListView.render(host, 'concepts');
        case 'concept': return window.ArticleView.render(host, 'concepts', params.id);
        case 'assets': return window.AssetsView.renderIndex(host);
        case 'cycles': return window.ListView.render(host, 'cycles');
        case 'family': return window.ListView.render(host, 'family');
        case 'family-one': return window.ArticleView.render(host, 'family', params.id);
        case 'reports': return window.ListView.render(host, 'reports');
        case 'report': return window.ArticleView.render(host, 'reports', params.id);
        case 'chains': return window.ChainView.renderList(host);
        case 'path': return window.PathView.render(host);
        case 'terms': return window.TermView.renderIndex(host, query);
        case 'data': return window.TermView.renderDataSheet(host, query);
        case 'term': return window.TermView.render(host, params.id, query);
        case 'search': return window.SearchView.render(host, query.q || '');
        case 'crisis':
          if (params.id) return window.CrisisView.renderDetail(host, params.id);
          return window.CrisisView.renderList(host);
        case 'crisis-one': return window.CrisisView.renderDetail(host, params.id);
        case 'asset': return window.AssetsView.renderDetail(host, params.id);
        case 'chain': return window.ChainView.renderDetail(host, params.id);
        case 'cycle': return window.ArticleView.render(host, 'cycles', params.id);
        case 'compare': return window.CompareView.render(host, query);
        case 'curve': return window.CurveView.render(host, query);
        case 'analogy': return window.AnalogyView.render(host, query);
        case 'calc': return window.CalcView.render(host, query);
        case 'saved': return window.SavedView.render(host, query);
        case 'quiz': return window.QuizView.render(host, query);
        case 'tag': return window.TagView.render(host, params.tag);
        case 'series': return window.SeriesView.render(host, params.id);
        case 'status': return window.StatusView.render(host, query);
        default:
          return window.ListView.render(host, 'concepts');
      }
    };

    // 危机复盘页和标的详情页是**同步**读正文的：正文没到位它们会画出空页。
    // 所以这两条路由先把正文取回来再交给视图；其余页面正文按需自己取。
    const bodyId = bodyIdForRoute(r, params);

    let pending = null;
    if (bodyId) {
      host.innerHTML = skelHtml();
      pending = window.Content.ensureArticle(bodyId).then(render);
    } else {
      try {
        pending = render();
      } catch (e) {
        console.error('[render]', e);
        host.innerHTML = errHtml(e);
      }
    }

    // 视图是 async 的时候，上面的 try/catch 抓不到它内部的异常——
    // 异常会变成 unhandledRejection，用户看到的是**上一次的残页**而不是错误页，
    // 同时 index.html 的全局兜底会在屏幕底部压一条永不消失的红色调试条。
    if (pending && typeof pending.then === 'function') {
      // 先按路由给个标题（别让标签页标题空着），等视图画完再按视图写的那个校准
      applyPageMeta(r, params, query, host, false);
      pending
        .then(() => { if (host.isConnected) applyPageMeta(r, params, query, host, true); })
        .catch((e) => {
          console.error('[render]', e);
          if (!host.isConnected) return;   // 已经切走，这一页不在屏幕上了
          host.innerHTML = errHtml(e);
        });
    } else {
      applyPageMeta(r, params, query, host, true);
    }

    // 换页之后焦点要落到正文上：内容整块换掉了，读屏用户却什么都没收到
    if (key !== prevKey) {
      const main = document.getElementById('main');
      if (main && main.focus) {
        try { main.focus({ preventScroll: true }); } catch (e) { main.focus(); }
      }
    }

    applyLensSetting(false);   // 跨站链接总开关：每次重画都要跟着当前设置走
    markActive(path);
    // 滚动位置：先恢复（用**离开时**的 key），再决定要不要归零。
    // 以前是「先恢复、再无条件 scrollTo(0,0)」——恢复的结果 100% 被覆盖，
    // 浏览器后退回长文时会被强行拉回顶部。
    window.Router.restoreScroll(prevKey);
    if (r.id !== 'search' && key !== prevKey) window.scrollTo(0, 0);
  }

  /** 每页一个 JSON-LD：WebSite / Article / DefinedTerm。爬虫不执行 JS 时至少还有静态兜底。 */
  function syncJsonLd(r, params) {
    if (!window.JsonLd) return;
    try {
      let data = {};
      if (r.id === 'term') data = { term: window.Content.term(params.id) };
      else if (r.id === 'asset') data = { article: window.Content.meta(assetArticleId(params.id)) || { title: params.id } };
      else if (r.id === 'concept' || r.id === 'crisis-one' || r.id === 'cycle' || r.id === 'family-one' || r.id === 'report') {
        data = { article: window.Content.meta(params.id) };
      }
      const obj = window.JsonLd.build(r.id, params, data);
      if (!obj) return;
      let el = document.getElementById('page-jsonld');
      if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.id = 'page-jsonld';
        document.head.appendChild(el);
      }
      el.textContent = window.JsonLd.serialize(obj);
    } catch (e) { /* 结构化数据失败不影响页面 */ }
  }

  /** 页面标题 + 分享卡片 + 换页提示：一次性做完 */
  function applyPageMeta(r, params, query, host, say) {
    const title = pageTitle(r, params, query, host);
    document.title = title;
    syncShare(title, pageDescription(r, params, query));
    syncJsonLd(r, params);
    if (say !== false) announcePage(title);
  }

  /* ---------------- 命令面板 ----------------
     面板底部写着「↑↓ 选择 / ⏎ 打开 / Esc 关闭」，那这三条就必须真的能用。
     以前只有鼠标能点：↑↓ 不动、⏎ 不开、Esc 只把输入框 blur 一下（面板还留在屏幕上，
     读者以为已经关了）。这一版把三件事补齐，并把焦点还给打开它的那个元素。

     面板是模态的：Tab 要在「输入框 + 候选项」之间转圈，不能跑到弹层外面去——
     外面那块背景已经被 aria-modal 对读屏隐藏了，焦点跑出去就等于人和读屏分家了。 */
  let paletteItems = [];
  let paletteSel = 0;
  let paletteLastFocus = null;
  let paletteBgInert = false;

  // 背景上的顶层容器：面板打开时整体 inert
  const BG = ['.masthead', '.ticker', '.shell', '.tabbar'];

  function isPaletteOpen() {
    const wrap = document.getElementById('palette-wrap');
    return !!(wrap && wrap.classList.contains('on'));
  }

  function setBackgroundInert(on) {
    BG.forEach((sel) => {
      document.querySelectorAll(sel).forEach((n) => {
        if (on) n.setAttribute('inert', '');
        else n.removeAttribute('inert');
      });
    });
  }

  function openPalette() {
    const wrap = document.getElementById('palette-wrap');
    const input = document.getElementById('palette-input');
    if (!wrap || !input) return;
    // 抽屉开着的时候再开面板：先把抽屉收掉，焦点和背景状态都归位
    if (window.TermDrawer && window.TermDrawer.isOpen()) window.TermDrawer.close();
    paletteLastFocus = document.activeElement;
    wrap.classList.add('on');
    input.value = '';
    paintPalette('');
    input.focus();
    // aria-expanded 原来在 HTML 里写死成 true：面板关着时也念「已展开」
    input.setAttribute('aria-expanded', 'true');
    if (!paletteBgInert) { paletteBgInert = true; setBackgroundInert(true); }
  }
  function closePalette() {
    const wrap = document.getElementById('palette-wrap');
    if (!wrap || !wrap.classList.contains('on')) return;
    wrap.classList.remove('on');
    const input = document.getElementById('palette-input');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    if (paletteBgInert) { paletteBgInert = false; setBackgroundInert(false); }
    // 焦点还回去：面板是 display:none，焦点会自动掉到 body，
    // 键盘用户下一次 Tab 得从页面最顶部重新走一遍。
    const stillThere = !document.contains || document.contains(paletteLastFocus);
    if (paletteLastFocus && stillThere && paletteLastFocus.focus) {
      try { paletteLastFocus.focus(); } catch (e) { /* 元素已经没了就算了 */ }
    }
    paletteLastFocus = null;
  }

  /** 面板里能拿到焦点的元素：输入框 + 候选项 */
  function paletteFocusables() {
    const input = document.getElementById('palette-input');
    const list = document.getElementById('palette-list');
    const items = list && list.querySelectorAll
      ? Array.prototype.slice.call(list.querySelectorAll('.pl-item'))
      : [];
    return input ? [input].concat(items) : items;
  }

  /** Tab 在面板里转：输入框 → 候选项 → 回到输入框 */
  function paletteTab(back) {
    const els = paletteFocusables();
    if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    let next;
    if (back) next = (i <= 0) ? els.length - 1 : i - 1;
    else next = (i < 0 || i === els.length - 1) ? 0 : i + 1;
    if (els[next] && els[next].focus) els[next].focus();
  }

  /** ↑↓ 移动选中项 */
  function paletteMove(d) {
    if (!paletteItems.length) return;
    const n = Math.min(paletteItems.length, 40);
    paletteSel = (paletteSel + d + n) % n;
    const list = document.getElementById('palette-list');
    if (!list) return;
    list.querySelectorAll('.pl-item').forEach((el, i) => {
      const on = i === paletteSel;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const cur = list.querySelector('.pl-item.sel');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    // 焦点落在候选项上时，选中项要跟着走：不然会出现「人在 A、选中 B」
    const input = document.getElementById('palette-input');
    if (cur && input && document.activeElement !== input && cur.focus) cur.focus();
    if (input) input.setAttribute('aria-activedescendant', 'pl-opt-' + paletteSel);
  }

  /** ⏎ 打开选中项 */
  function paletteEnter() {
    const it = paletteItems[paletteSel];
    if (!it) return;
    closePalette();
    it.go();
  }

  /** 空查询时给的引导：点开搜索就看到「无结果」，是「这站坏了」的第一印象。
      给的四个入口都是真能点开的（点进去就知道会看到什么）。 */
  const PALETTE_STARTERS = [
    { t: '通货膨胀', s: '钱为什么变薄', path: '/term/inflation' },
    { t: '无风险利率', s: '全站定价的尺子', path: '/term/risk-free-rate' },
    { t: '新手路径', s: '8 课入门', path: '/path' },
    { t: '危机复盘', s: '拖时间轴看崩盘', path: '/crisis' },
    { t: '资产对比', s: '两条线放同一张图上', path: '/compare' },
    { t: '收益率曲线', s: '看倒挂的形状', path: '/curve' },
    { t: '理财计算器', s: '通胀、定投、房贷、回本', path: '/calc' },
    { t: '术语自测', s: '5 题检验记住没有', path: '/quiz' },
    { t: '数据台账', s: '每个数字回到它的文件', path: '/status' },
  ];

  function paintPalette(q) {
    const list = document.getElementById('palette-list');
    const key = String(q || '').trim().toLowerCase();
    const input = document.getElementById('palette-input');
    const items = [];

    if (!key) {
      PALETTE_STARTERS.forEach((s) => items.push({
        g: '试试这些', t: s.t, s: s.s,
        go: () => window.Router.go(s.path),
      }));
    } else {
      const r = window.SearchView.search(key);
      r.terms.forEach((t) => items.push({ g: '术语', t: t.term, s: t.one || '', go: () => window.Router.go('/term/' + encodeURIComponent(t.id)) }));
      r.articles.forEach((a) => items.push({ g: '文章', t: a.title, s: a.dek || '', go: () => window.Router.go('/' + a.section + '/' + a.id) }));
      r.assets.forEach((a) => items.push({ g: '标的', t: a.name, s: '', go: () => window.Router.go('/assets/' + encodeURIComponent(a.symbol)) }));
    }
    paletteItems = items;
    paletteSel = 0;

    if (!items.length) {
      list.innerHTML = `<div class="pl-group">无结果</div><div class="pl-item muted">换个词试试，或者按 Esc 关闭</div>`;
      // 已经没有候选项了，aria-activedescendant 不能还指着不存在的 pl-opt-0
      if (input) input.removeAttribute('aria-activedescendant');
      return;
    }
    let lastG = null, html = '';
    items.slice(0, 40).forEach((it, i) => {
      if (it.g !== lastG) { html += `<div class="pl-group">${esc(it.g)}</div>`; lastG = it.g; }
      // tabindex="-1"：候选项能被 Tab 到、能拿到焦点，但不会自己进 Tab 序
      html += `<div class="pl-item${i === 0 ? ' sel' : ''}" id="pl-opt-${i}" data-i="${i}" role="option"
        tabindex="-1" aria-selected="${i === 0}">
        <span class="pli-t">${esc(it.t)}</span>
        ${it.s ? `<span class="pli-k">${esc(String(it.s).slice(0, 22))}</span>` : ''}
      </div>`;
    });
    list.innerHTML = html;
    if (input) input.setAttribute('aria-activedescendant', 'pl-opt-0');
    list.querySelectorAll('.pl-item').forEach((el) => {
      el.addEventListener('click', () => {
        const it = items[Number(el.dataset.i)];
        closePalette();
        if (it) it.go();
      });
    });
  }

  /* ---------------- 全部栏目（手机底栏） ----------------
     底栏只放最常用的 7 个入口；其余栏目和工具收进一个可滚动抽屉，
     避免手机 / 小屏用户只能靠搜索或页脚才能找到「家庭理财」「读懂财报」「周期对照」。 */
  function showNav() {
    const groups = NAV_GROUPS.map((g) => {
      const links = g.ids.map((id) => NAV.find((x) => x.id === id)).filter(Boolean).map((it) => `
        <a class="nav-sheet-link" href="#${esc(it.path)}">
          <span class="nsl-n">${esc(it.n)}</span>
          <span class="nsl-t">${esc(it.label)}</span>
        </a>`).join('');
      return `<section class="nav-sheet-group"><h3>${esc(g.label)}</h3><div class="nav-sheet-links">${links}</div></section>`;
    }).join('');
    window.TermDrawer.openPanel({
      title: '全部栏目',
      body: `<nav class="nav-sheet" aria-label="全部栏目">${groups}</nav>`,
      foot: '<span>选一个栏目，抽屉会自动关闭</span>',
    });
  }

  /* ---------------- 快捷键面板 ---------------- */
  function showKeys() {
    const rows = [
      ['/', '搜索（打开命令面板）'],
      ['⌘K / Ctrl+K', '命令面板'],
      ['?', '打开这个面板'],
      ['← →', '危机回放器：前后步进'],
      ['Esc', '关闭抽屉 / 面板'],
      ['T', '切换日夜皮肤'],
      ['G 然后 H', '回首页'],
    ];
    // 走抽屉的打开流程：记下是谁打开的、焦点搬进抽屉、背景隔开、关闭时焦点还回去
    window.TermDrawer.openPanel({
      title: '快捷键',
      body: `<div class="keys">${rows.map(([k, d]) => `<div class="kr"><span>${esc(d)}</span><span class="kk"><span class="kbd">${esc(k)}</span></span></div>`).join('')}</div>`,
      foot: '<span>本站全程键盘可达</span>',
    });
  }

  /* ---------------- 站点设置（抽屉） ----------------
     两个开关：夜间皮肤、去行情终端的链接。设置只存在本机，不联网。 */
  function showSettings() {
    const dark = window.Store.get('theme') === 'night';
    const lens = window.Cross ? window.Cross.enabled() : true;
    window.TermDrawer.openPanel({
      title: '站点设置',
      body: `
      <div class="set-row">
        <div>
          <div class="set-k">夜间皮肤</div>
          <div class="set-h">报头的月亮按钮也能切</div>
        </div>
        <button class="switch ${dark ? 'on' : ''}" id="swTheme" role="switch" aria-checked="${dark}" aria-label="夜间皮肤"></button>
      </div>
      <div class="set-row">
        <div>
          <div class="set-k">涨跌配色</div>
          <div class="set-h">中式「红涨绿跌」或西式「绿涨红跌」。只改变颜色，不改变数字。</div>
        </div>
        <button class="switch ${window.Store.get('updown') === 'green' ? 'on' : ''}" id="swUpdown" role="switch" aria-checked="${window.Store.get('updown') === 'green'}" aria-label="绿涨红跌"></button>
      </div>
      <div class="set-row">
        <div>
          <div class="set-k">跟随系统深浅色</div>
          <div class="set-h">打开后不再使用手动选择的皮肤；关掉时用当前这一套。</div>
        </div>
        <button class="switch ${window.Store.get('themeAuto') ? 'on' : ''}" id="swThemeAuto" role="switch" aria-checked="${!!window.Store.get('themeAuto')}" aria-label="跟随系统深浅色"></button>
      </div>
      <div class="set-row">
        <div>
          <div class="set-k">去行情终端的链接</div>
          <div class="set-h">关掉后，术语页与标的页不再出现「去看历史数据」和「回到 OpenFinLens」，报头的入口也一起消失</div>
        </div>
        <button class="switch ${lens ? 'on' : ''}" id="swLens" role="switch" aria-checked="${lens}" aria-label="去行情终端的链接"></button>
      </div>
      <p class="set-note">设置只存在这台设备上（localStorage），不联网、不上传、没有统计。</p>`,
      foot: '<span>白话金融 OpenFin Academy</span>',
    });

    document.getElementById('swTheme').addEventListener('click', () => { toggleTheme(); showSettings(); });
    const swUp = document.getElementById('swUpdown');
    if (swUp) swUp.addEventListener('click', () => {
      window.Store.set('updown', window.Store.get('updown') === 'green' ? 'red' : 'green');
      applyTheme();
      showSettings();
    });
    const swAuto = document.getElementById('swThemeAuto');
    if (swAuto) swAuto.addEventListener('click', () => {
      const next = !window.Store.get('themeAuto');
      window.Store.set('themeAuto', next);
      if (!next) window.Store.set('theme', resolvedTheme());
      applyTheme();
      showSettings();
    });
    document.getElementById('swLens').addEventListener('click', () => {
      const next = !(window.Cross ? window.Cross.enabled() : true);
      window.Store.set('lens', next);
      applyLensSetting(true);
      showSettings();
    });
  }

  /** 跨站链接总开关：报头的入口 + 左栏卡片 + 各页的跳转条一起开关 */
  function applyLensSetting(rerender) {
    const on = window.Cross ? window.Cross.enabled() : true;
    const sister = document.getElementById('mh-sister');
    if (sister) sister.hidden = !on;
    document.querySelectorAll('.lens-only').forEach((n) => { n.hidden = !on; });
    if (rerender) route();   // 当前页重画：跳转条要跟着出现/消失
  }

  /* ---------------- 主题 ---------------- */
  function systemPrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }

  /** 解析当前主题：用户没手动选过就跟随系统。 */
  function resolvedTheme() {
    if (window.Store.get('themeAuto')) return systemPrefersDark() ? 'night' : 'day';
    return window.Store.get('theme') || 'day';
  }

  function applyTheme() {
    const t = resolvedTheme();
    document.body.setAttribute('data-theme', t);
    document.body.setAttribute('data-updown', window.Store.get('updown') === 'green' ? 'green' : 'red');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t === 'night' ? '#08111C' : '#F2ECDF');
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* T 键切肤时的颜色过渡：过渡全在 CSS（body.theme-anim，写在 index.html 动效层），
     JS 只挂类/摘类。摘类靠 transitionend 事件——那个兜底计时器只在事件
     迟迟不来时收尾清类（此时过渡已按 CSS 时长结束，摘类不产生任何视觉变化，
     不是在驱动动画）；prefers-reduced-motion 时干脆不挂类，颜色瞬切。 */
  let themeFadeOff = null;
  function fadeThemeColors() {
    if (prefersReducedMotion()) return;
    const body = document.body;
    if (!body || !body.classList) return;
    if (themeFadeOff) themeFadeOff();   // 上一次还没收尾就又切：先归位再重来
    body.classList.add('theme-anim');
    const off = () => {
      body.classList.remove('theme-anim');
      body.removeEventListener('transitionend', onEnd);
      if (tid) clearTimeout(tid);
      themeFadeOff = null;
    };
    const onEnd = (e) => {
      // 只认颜色类属性的结束；width 之类（如滚动进度条）不许提前收场
      if (e && e.propertyName && /color|fill|stroke|shadow/i.test(e.propertyName)) off();
    };
    let tid = setTimeout(off, 500);
    body.addEventListener('transitionend', onEnd);
    themeFadeOff = off;
  }

  function toggleTheme() {
    const current = resolvedTheme();
    const t = current === 'night' ? 'day' : 'night';
    window.Store.set('themeAuto', false);
    window.Store.set('theme', t);
    fadeThemeColors();
    applyTheme();
  }

  /* ---------------- 滚动进度 ---------------- */
  function onScroll() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? (doc.scrollTop / max) * 100 : 0;
    const bar = document.getElementById('progress');
    if (bar) bar.style.transform = 'scaleX(' + (p / 100).toFixed(4) + ')';
    const top = document.getElementById('to-top');
    if (top) {
      const show = doc.scrollTop > 500;
      top.classList.toggle('on', show);
      // 看不见的时候也要退出 Tab 序：opacity:0 挡不住键盘，
      // Tab 到一个透明按钮上，焦点圈画在空白处，用户根本不知道自己在哪。
      if (show) top.removeAttribute('inert');
      else top.setAttribute('inert', '');
    }
  }

  /* ---------------- 键盘 ---------------- */
  let pendingG = 0;   // 「G 然后 H」的第一下：G
  function onKey(e) {
    // 命令面板开着的时候，键盘整个归它管（↑↓ 选、⏎ 开、Esc 关、Tab 在面板里转圈）
    if (isPaletteOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
      if (e.key === 'Tab') { e.preventDefault(); paletteTab(e.shiftKey); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); paletteEnter(); return; }
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      if (window.TermDrawer.isOpen()) { window.TermDrawer.close(); return; }
      closePalette();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }
    if (e.key === '?') { e.preventDefault(); showKeys(); return; }
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) { toggleTheme(); return; }
    // G 然后 H 回首页（快捷键面板里写着这一条，就得真的能用）
    const k = e.key.toLowerCase();
    if (k === 'g' && !e.metaKey && !e.ctrlKey) { pendingG = Date.now(); return; }
    if (k === 'h' && !e.metaKey && !e.ctrlKey && pendingG && Date.now() - pendingG < 1500) {
      pendingG = 0;
      e.preventDefault();
      window.Router.go('/');
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      window.ReplayPlayer.onKey(e);
    }
  }

  /** 首页仪表：行情到达后补上读数（不重绘整页） */
  function paintGauges() {
    if (window.HomeView && window.HomeView.paintGauges) window.HomeView.paintGauges();
    const src = document.getElementById('gauge-src');
    if (src && window.Quotes.state.source) {
      src.textContent = '来源 ' + window.Quotes.state.source + ' · ' + window.Quotes.freshness();
    }
  }

  /* ---------------- 启动 ---------------- */
  // 启动轨迹：排查白屏时用。默认不显示，加 ?debug=1 才出现。
  const DEBUG = /(\?|&)debug=1/.test(location.search);
  const trace = [];
  function step(msg) {
    trace.push(msg);
    if (!DEBUG) return;
    try {
      let el = document.getElementById('boot-trace');
      if (!el) {
        el = document.createElement('pre');
        el.id = 'boot-trace';
        el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9998;margin:0;padding:8px 12px;'
          + 'background:#0b1f24;color:#9fe3d6;font:11px/1.5 monospace;max-width:46ch;white-space:pre-wrap;opacity:.9';
        document.body.appendChild(el);
      }
      el.textContent = trace.join('\n');
    } catch (e) { /* 忽略 */ }
  }

  /**
   * file:// 打开时的提示。
   *
   * 浏览器不允许 file:// 页面 fetch 本地 JSON（origin 是 null，直接被 CORS 拦掉），
   * 以前这里什么都不说：页面显示成一个空骨架，左栏计数全是 0，
   * 读者只会以为这个站坏了。现在明确告诉他怎么打开。
   */
  function showFileProtocolNotice() {
    const v = document.getElementById('view');
    if (!v) return;
    v.innerHTML = `<div class="empty">
      <div class="et">请用本地服务器打开这个页面</div>
      <div class="ed">浏览器不允许 <code>file://</code> 页面读取数据文件（JSON），
      所以双击 <code>index.html</code> 只会得到一个空页面。在项目目录里跑
      <code>node scripts/serve.mjs 8765</code>，然后打开
      <code>http://127.0.0.1:8765</code>。</div>
      <p class="ed">也可以直接看线上版：
      <a href="${(window.ACADEMY_SITE&&window.ACADEMY_SITE.selfUrl)||'https://5777-wq.github.io/openfinlens/academy/'}" target="_blank" rel="noopener">5777-wq.github.io/openfinlens/academy</a></p>
    </div>`;
  }

  async function boot() {
    step('boot:start');
    applyTheme();
    applyLensSetting(false);
    paintMasthead();
    paintTabbar();

    /* file:// 打不开：先说清楚，别让读者对着一个空骨架猜。 */
    if (location.protocol === 'file:') {
      showFileProtocolNotice();
      step('boot:file protocol blocked');
      return;
    }

    bindInteractions();          // 先让站点活过来
    /* PWA 注册是增强：失败只 warn，不阻塞任何页面。 */
    if (window.PWA && window.PWA.register) window.PWA.register();
    step('boot:shell painted + interactions bound');

    // 内容与行情并行加载；内容最多等 8 秒，超时也先把页面渲染出来
    const contentReady = window.Content.loadAll().catch((e) => {
      console.error('[content] 加载失败', e);
      return null;
    });
    const quotesReady = window.Quotes.load().catch(() => window.Quotes.state);

    await Promise.race([
      contentReady,
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    step('boot:content ready ' + (window.Content.idx.list ? 'ok' : 'EMPTY'));

    const contentOk = !!window.Content.idx.list;
    if (!contentOk) {
      const v = document.getElementById('view');
      if (v) {
        v.innerHTML = `<div class="empty"><div class="et">内容没能加载出来</div>
          <div class="ed">多半是网络或静态服务的问题，不是站点坏了。请刷新试试，或者到
          <a href="https://github.com/5777-wq/openfin-academy/issues/new" target="_blank" rel="noopener">Issue 区</a> 反馈。</div>
          <button class="btn ghost sm" onclick="location.reload()">重新加载</button></div>`;
      }
    }

    paintRail();
    applyLensSetting(false);   // 左栏那张终端卡片也要跟着开关走
    paintTicker();
    step('boot:rail+ticker painted');

    /* ⚠ 先把路由渲染出来，再等行情。
       行情源可能慢或不可达，但内容页绝不能等它——否则首屏会白着。 */
    const renderRoute = () => {
      if (!location.hash) location.replace('#/');
      else route();
    };
    window.Router.onRoute(route);
    window.addEventListener('hashchange', route);
    /* 内容没加载出来时**不要**渲染路由：
       route() 会把上面那张错误页覆盖成骨架，读者看到的是「站点像坏了」，
       而不是「数据没加载出来，点这里重试」。
       内容也可能只是迟到（8 秒超时）——那时候再补一次渲染。 */
    if (contentOk) {
      renderRoute();
    } else {
      contentReady.then(() => { if (window.Content.idx.list) renderRoute(); });
    }
    step('boot:routed');

    await quotesReady;
    paintTicker();
    paintGauges();
    step('boot:quotes ready');

    /* 行情轮询：失败要退避。
       以前固定 30 秒一次，数据源挂了就一直重试——既费流量，也像在跟源较劲。
       现在失败一次就把间隔拉长：30 → 60 → 120 → 240 → 300 秒（封顶 5 分钟），
       成功一次就回到 30 秒。 */
    let pollDelay = 30000;
    let pollTimer = null;
    const poll = async () => {
      await window.Quotes.load();
      paintTicker();
      paintGauges();
      return !window.Quotes.state.degraded;   // true = 这次拿到的是实时数据
    };
    const schedulePoll = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (document.hidden) { schedulePoll(); return; }
        let ok = false;
        try { ok = await poll(); } catch (e) { ok = false; }
        pollDelay = ok ? 30000 : Math.min(pollDelay * 2, 300000);
        schedulePoll();
      }, pollDelay);
    };
    schedulePoll();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      // 回到前台立刻补跑一次，别让读者盯着一个已经过期的报价
      pollDelay = 30000;
      poll().then(() => schedulePoll());
    });
  }

  /* ---------------- 交互绑定 ----------------
     必须在任何 await 之前完成：站点一加载出来就该能点、能搜、能切主题，
     不能等行情源返回才活过来。 */
  function bindInteractions() {
    window.TermDrawer.init();
    document.getElementById('btn-search').addEventListener('click', openPalette);
    document.getElementById('btn-keys').addEventListener('click', showKeys);
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('btn-settings').addEventListener('click', showSettings);
    document.getElementById('to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    const pw = document.getElementById('palette-wrap');
    pw.addEventListener('click', (e) => { if (e.target === pw) closePalette(); });
    document.getElementById('palette-input').addEventListener('input', (e) => paintPalette(e.target.value));

    // 跳到主内容：不能让它真的改地址栏。
    // 本站是 hash 路由：地址栏一变就是换页，#main 这种锚点会被路由当成「不认识的路」。
    const skip = document.getElementById('skip-link');
    if (skip) {
      skip.addEventListener('click', (e) => {
        e.preventDefault();
        const main = document.getElementById('main');
        if (!main) return;
        if (main.focus) { try { main.focus(); } catch (err) { /* 忽略 */ } }
        if (main.scrollIntoView) main.scrollIntoView();
      });
    }

    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => {
      try { markActive(window.Router.parse(location.hash).path); } catch (e) { /* 忽略 */ }
    });
    onScroll();

    /* 动效收敛：不再做点按涟漪/位移动画；反馈交给颜色与阴影。 */
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.App = { NAV, openPalette, toggleTheme, showKeys, route, onScroll, stats };
})();
