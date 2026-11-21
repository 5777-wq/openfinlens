/* views/home.js —— 首页（时代横轴 hero + 实时仪表 + 今日一词） */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const F = () => window.Fmt;

  /* ------------------------------------------------------------------
     动效样式（随视图注入一次）：
     1) 区块进场次序（stagger）：换页/首次渲染时各区块按 --h-sec-i 依次
        显影——「这东西从哪来」只回答这一次，滚动不触发、不回放；
     2) 仪表读数到达：只有「占位 → 真数据」这一次状态切换给淡入，
        数字本体永不动画（不滚动、不闪烁），30 秒轮询换数时屏幕静止。
     规则：只动 transform / opacity；时长缓动一律引用设计令牌并带兜底值；
     prefers-reduced-motion 下显式关闭（layout.css 的全局关闭是兜底，
     这里声明本表面自己的意图，避免 backwards 填充被 delay 拖住）。
     ------------------------------------------------------------------ */
  const MOTION_CSS = `
.h-sec {
  animation: h-sec-in var(--dur-3, 580ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) backwards;
  animation-delay: calc(var(--stagger, 62ms) * var(--h-sec-i, 0));
}
@keyframes h-sec-in {
  from { opacity: 0; transform: translate3d(0, 18px, 0) scale(.996); }
  to   { opacity: 1; transform: none; }
}
.dpanel.dp-arrive {
  animation: dp-arrive-in var(--dur-3, 580ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) backwards;
}
@keyframes dp-arrive-in { from { opacity: 0; transform: translate3d(0, 6px, 0); } }
@media (prefers-reduced-motion: reduce) {
  .h-sec, .dpanel.dp-arrive { animation: none; }
}
`;

  function ensureMotionCss() {
    if (document.getElementById('home-motion-css')) return;
    const el = document.createElement('style');
    el.id = 'home-motion-css';
    el.textContent = MOTION_CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /** 仪表卡片：实时读数 + 一句"这是什么"。
      dp-wait = 数据未到的占位卡（只作标记，供下一次 paintGauges 识别
      「占位 → 真数据」这一次状态切换）；dp-arrive = 刚拿到数的克制淡入。 */
  function gaugeCard(cfg) {
    const q = cfg.fetch();
    if (!q) {
      /* 加载失败之后这里一直写「数据加载中」——读者以为页面卡住了。
         行情源已经试过一轮还拿不到数，就直说连不上，别让人干等。 */
      const tried = !!(window.Quotes.state && window.Quotes.state.source);
      return `<div class="dpanel dp-wait" data-key="${esc(cfg.key)}">
        <div class="dp-k">${esc(cfg.name)}</div>
        <div class="dp-v">--</div>
        <div class="dp-d muted">${tried ? '行情暂时连不上' : '数据加载中'}</div>
      </div>`;
    }
    const d = F().dir(q.pct);
    const pctTxt = q.pct === null ? '--' : F().pct(q.pct);
    return `<div class="dpanel${cfg.hot ? ' hot' : ''}${cfg.arrive ? ' dp-arrive' : ''}" data-key="${esc(cfg.key)}">
      <div class="dp-k">${esc(cfg.name)}${cfg.unit ? ` <span class="muted">${esc(cfg.unit)}</span>` : ''}</div>
      <div class="dp-v">${F().num(q.price, q.digits)}</div>
      <div class="dp-d ${d}">${pctTxt} <span class="muted">当日</span></div>
      ${cfg.href ? `<div class="dp-f">这是什么？→ <a href="${esc(cfg.href)}">${esc(cfg.link || '看解释')}</a></div>` : ''}
    </div>`;
  }

  const GAUGES = [
    { name: '美债 10 年期收益率', unit: '%', key: 'EM:171.US10Y', digits: 2, hot: true, href: '#/term/risk-free-rate', link: '为什么它是全球无风险利率' },
    { name: 'COMEX 黄金', unit: '美元/盎司', key: 'EM:101.GC00Y', digits: 1, href: '#/assets/gold', link: '黄金到底在防什么' },
    { name: '纳斯达克综合指数', unit: '', key: 'usIXIC', digits: 2, href: '#/term/nasdaq', link: '纳指为什么对利率最敏感' },
    { name: 'NYMEX 原油', unit: '美元/桶', key: 'EM:102.CL00Y', digits: 2, href: '#/term/crude-oil', link: '原油是通胀的风向标' },
    { name: '美元指数', unit: '', key: 'EM:100.UDI', digits: 2, href: '#/term/dollar-index', link: '美元为什么是世界的锚' },
    { name: '上证指数', unit: '', key: 'sh000001', digits: 2, href: '#/term/sse-index', link: '大A 的「大盘」指什么' },
  ];

  /** 只重绘仪表区：行情到达时补上，不动整页。
      只有上一轮还是占位卡（dp-wait）的槽位，这次拿到数才淡入一次；
      之后轮询换数字是静默替换——数字本体永不动画。 */
  function paintGauges() {
    const box = document.getElementById('home-gauges');
    if (!box) return;
    const G = window.Quotes;
    const wasWaiting = new Set();
    if (typeof box.querySelectorAll === 'function') {
      box.querySelectorAll('.dpanel.dp-wait[data-key]').forEach((el) => {
        const k = el.getAttribute && el.getAttribute('data-key');
        if (k) wasWaiting.add(k);
      });
    }
    const firstPaint = !box.dataset.painted;
    box.innerHTML = GAUGES.map((g) => gaugeCard({
      name: g.name, unit: g.unit, digits: g.digits, hot: g.hot, href: g.href, link: g.link,
      key: g.key, arrive: wasWaiting.has(g.key),
      fetch: () => G.get(g.key),
    })).join('');
    if (firstPaint) {
      box.dataset.painted = '1';
      box.classList.add('is-staggered');
      const cards = box.querySelectorAll ? box.querySelectorAll('.dpanel') : null;
      const lastCard = cards && cards.length ? cards[cards.length - 1] : null;
      if (lastCard && lastCard.addEventListener) {
        lastCard.addEventListener('animationend', () => box.classList.remove('is-staggered'), { once: true });
      }
      // A quote refresh inside the first second can replace the observed node.
      // This timer is the reliable one-shot guard; after it fires, polling is silent.
      setTimeout(() => box.classList.remove('is-staggered'), 1400);
    }
    if (typeof paintSnapshot === 'function') paintSnapshot();
  }

  /** 今天是本年的第几天（本地时区；1 月 1 日算第 1 天）
      原来写死 Date.UTC(2026,0,1)，2027 年起就会变成「第 366 天」并一直长下去。 */
  function dayOfYear(d) {
    const now = d || new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
  }

  /** 今日一词：按当天日期做种子，同一天永远是同一个词。
      （原来用 Math.random()：内容加载完后 route() 会再渲染一次，
        读者眼睁睁看着词在自己眼前换掉。） */
  function pickTodayTerm(ids, date) {
    if (!ids || !ids.length) return null;
    const d = date || new Date();
    const seed = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    let h = 2166136261;                    // FNV-1a：同一个种子永远落到同一个词
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ids[(h >>> 0) % ids.length];
  }

  /* Real quote surface only. No decorative chart and no synthetic trend. */
  function marketSnapshot() {
    const primary = window.Quotes.get('EM:171.US10Y');
    const price = primary ? F().num(primary.price, primary.digits) : '--';
    const direction = primary ? F().dir(primary.pct) : 'flat';
    const change = primary && primary.pct !== null ? F().pct(primary.pct) : '--';
    const tried = !!(window.Quotes.state && window.Quotes.state.source);
    const rows = GAUGES.slice(1, 4).map((g) => {
      const q = window.Quotes.get(g.key);
      const d = q ? F().dir(q.pct) : 'flat';
      const names = { 'EM:101.GC00Y': 'XAU', usIXIC: 'IXIC', 'EM:102.CL00Y': 'WTI', 'EM:100.UDI': 'DXY', sh000001: 'SSE' };
      return `<a class="snapshot-row" href="${esc(g.href)}"><span class="snapshot-code">${names[g.key]}</span><span class="snapshot-name">${esc(g.name)}</span><span class="snapshot-value">${q ? F().num(q.price, q.digits) : '--'}</span><span class="snapshot-change ${d}">${q && q.pct !== null ? F().pct(q.pct) : '--'}</span></a>`;
    }).join('');
    return `<section class="market-snapshot" aria-label="真实市场报价，数据可能延迟">
      <div class="snapshot-head"><span>今日焦点</span><span class="snapshot-status">${tried ? esc(window.Quotes.freshness()) : '正在连接行情'}</span></div>
      <a class="snapshot-primary" href="#/term/risk-free-rate"><span class="snapshot-label">美国 10 年期国债收益率 <span>US 10Y</span></span><span class="snapshot-price">${price}<small>%</small></span><span class="snapshot-primary-foot"><span>全球资产定价的锚</span><span class="${direction}">${change} 当日</span></span></a>
      <div class="snapshot-list">${rows}</div>
      <div class="snapshot-foot"><span>公开数据源 · 有延迟 · 非投资建议</span><a href="#/data">完整数据台账 <span aria-hidden="true">→</span></a></div>
    </section>`;
  }
  function paintSnapshot() {
    const box = document.getElementById('home-snapshot');
    if (box) box.innerHTML = marketSnapshot();
  }

  function sectionHead(n, title, desc, href, link) {
    return `<div class="home-section-head"><span class="section-index">${n}</span><div><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>${href ? `<a class="section-link" href="${esc(href)}">${esc(link)}<span aria-hidden="true">→</span></a>` : ''}</div>`;
  }

  function storyCard(article, index) {
    return `<a class="home-story" href="#/${esc(article.section)}/${esc(article.id)}"><div class="story-meta"><span>${index === 0 ? '历史复盘' : '生活金融'}</span><span>${article.readMinutes ? esc(article.readMinutes) + ' MIN READ' : 'READ'}</span></div><h3>${esc(article.title)}</h3><p>${esc(article.dek || '')}</p></a>`;
  }

  /* 首页不只做导航：把「先学什么」「还可以读什么」摆出来。
     卡片都链到真实内容，不生成空入口。 */
  const SECTION_LABEL = {
    concepts: '货币与利率', crisis: '危机复盘', assets: '标的百科',
    chains: '产业链图谱', cycles: '周期与镜鉴', family: '家庭理财', reports: '读懂财报',
  };
  const CONCEPT_IDS = ['risk-free-rate', 'inflation', 'inversion', 'max-drawdown', 'compounding', 'liquidity'];
  const READING_IDS = ['interest-rate', 'three-statements', 'emergency-fund', 'rate-cycle', 'yield-curve', 'risk-volatility'];

  function curriculumCard(lesson, index) {
    const target = lesson.target && /^#\//.test(lesson.target) ? lesson.target : '#/path';
    return `<a class="curriculum-card" href="${esc(target)}">
      <span class="cc-top"><span class="cc-num">第 ${index + 1} 课</span><span class="cc-time">${esc(lesson.minutes || 4)} min</span></span>
      <span class="cc-title">${esc(lesson.title || '')}</span>
      <span class="cc-dek">${esc(lesson.dek || '')}</span>
      <span class="cc-go">读这一课 <span aria-hidden="true">→</span></span>
    </a>`;
  }

  function conceptCard(id, term) {
    return `<a class="home-concept-card" href="#/term/${encodeURIComponent(id)}">
      <span class="hc-word">${esc(term.term || id)}</span>
      <span class="hc-one">${esc(term.one || '')}</span>
      <span class="hc-more">看解释 <span aria-hidden="true">→</span></span>
    </a>`;
  }

  function readingCard(article) {
    const section = SECTION_LABEL[article.section] || article.tag || '长文';
    return `<a class="home-reading-card" href="#/${esc(article.section)}/${encodeURIComponent(article.id)}">
      <span class="hr-meta"><span>${esc(section)}</span><span>${article.readMinutes ? esc(article.readMinutes) + ' min' : '阅读'}</span></span>
      <span class="hr-title">${esc(article.title)}</span>
      <span class="hr-dek">${esc(article.dek || '')}</span>
      <span class="hr-more">继续读 <span aria-hidden="true">→</span></span>
    </a>`;
  }
  function render(view) {
    const G = window.Quotes;
    ensureMotionCss();
    let secI = 0;
    const si = () => `--h-sec-i:${secI++};`;
    // 术语库空闲档加载中（site/content.js）：今日一词/概念速览先缺席（不放假卡），
    // 术语库到了就地重画一次——只重画本视图，不重跑路由。
    const C = window.Content;
    if (C && C.glossaryLoaded && !C.glossaryLoaded() && C.onGlossary) {
      C.onGlossary(() => { if (view.isConnected) render(view); });
    }
    const glossary = window.Content.glossary();
    const termIds = Object.keys(glossary);
    const pick = pickTodayTerm(termIds);
    const termHtml = pick ? `<a class="term-link" href="#/term/${encodeURIComponent(pick)}">${window.TermCard.render(Object.assign({ id: pick }, glossary[pick]))}<span class="term-link-more">看完整解释 <span aria-hidden="true">→</span></span></a>` : '';
    const family = window.Content.bySection('family');
    const familyStory = family.find((a) => a.id === 'money-jar') || family[0];
    const stories = [window.Content.bySection('crisis')[0], familyStory].filter(Boolean);
    const plan = window.Content.pathPlan && window.Content.pathPlan();
    const lessons = plan && Array.isArray(plan.lessons) ? plan.lessons.slice(0, 4) : [];
    const concepts = CONCEPT_IDS.map((id) => [id, glossary[id]]).filter((x) => x[1]);
    const picks = READING_IDS.map((id) => window.Content.meta && window.Content.meta(id)).filter(Boolean);
    const articleCount = (window.Content.list && window.Content.list().length) || 0;
    const assetCount = (window.Content.assetPages && window.Content.assetPages().length) || 0;
    const chainCount = (window.INDUSTRY_CHAINS || []).length;

    view.innerHTML = `<div class="home-page">
      <section class="home-hero h-sec" style="${si()}">
        <div class="home-copy">
          <div class="home-kicker"><span class="system-status">Finance, explained.</span><span class="k-date">${esc(F().cnDateWithWeek(F().today()))} · DAY ${dayOfYear()}</span></div>
          <h1>看懂金融，<br class="hero-br"><span class="hero-highlight">从一个概念开始。</span></h1>
          <p class="art-dek">把美债收益率、黄金、纳指、原油、A股讲成你听得懂的话。用真实数据、历史复盘和可交互工具，建立你自己的金融认知。</p>
          <div class="hero-actions"><a class="btn teal" href="#/path">从零开始 · 8 课<span aria-hidden="true">→</span></a><a class="btn ghost" href="#/crisis">探索危机复盘</a><a class="btn ghost" href="#/terms?q=PE">查一个词</a></div>
          <div class="home-proof"><span><b>${articleCount}</b> 篇长文</span><span><b>${termIds.length}</b> 个词条</span><span><b>${assetCount}</b> 个标的页</span><span><b>${chainCount}</b> 条产业链</span></div>
        </div>
        <div id="home-snapshot">${marketSnapshot()}</div>
      </section>

      ${lessons.length ? `<section class="home-section home-curriculum h-sec" style="${si()}">${sectionHead('01', '先搭一个能用的框架', '四节课，把利率、通胀、风险和定价串起来', '#/path', '完整 8 课')}<div class="curriculum-grid">${lessons.map(curriculumCard).join('')}</div></section>` : ''}

      <section class="home-section h-sec" style="${si()}">${sectionHead('02', '从指标理解市场', '不只看涨跌，也看它为什么重要', '#/data', '查看数据台账')}<div class="gauges" id="home-gauges"></div><p class="home-note"><span id="gauge-src">行情来自公开数据源，可能存在延迟。读数用于理解，不构成投资建议。</span></p></section>

      <section class="home-section h-sec" style="${si()}">${sectionHead('03', '今天，学一点', '一个概念、两个故事，再加六个高频词', '#/terms', '浏览术语库')}<div class="home-learn"><div class="home-term" aria-label="今日一词">${termHtml || '<div class="empty"><div class="et">今日一词正在补充</div></div>'}</div><div class="home-featured">${stories.map(storyCard).join('')}</div></div>${concepts.length ? `<div class="home-mini-head"><span>再记住六个词</span><a href="#/terms">全部 ${termIds.length} 个词条 <span aria-hidden="true">→</span></a></div><div class="home-concept-rail">${concepts.map(([id, term]) => conceptCard(id, term)).join('')}</div>` : ''}</section>

      <section class="home-section h-sec" style="${si()}">${sectionHead('04', '在时间里，理解周期', '不预测明天，只看清曾经发生过什么', '#/crisis', '全部危机复盘')}<div id="home-era"></div></section>

      ${picks.length ? `<section class="home-section home-reading h-sec" style="${si()}">${sectionHead('05', '继续读，把知识串起来', '利率、财报、家庭现金与加息周期，六篇新长文', '#/path', '按学习路径读')}<div class="home-reading-rail">${picks.map(readingCard).join('')}</div></section>` : ''}

      <section class="home-section h-sec" style="${si()}">${sectionHead('06', '动手，建立自己的判断', '六个小工具，把抽象概念变成可见的关系', '', '')}
        <div class="tool-grid">${[
          ['01', '资产对比', '两条线放同一张图上，看相对涨跌与回撤', '#/compare'],
          ['02', '收益率曲线', '拖动年份，看曲线形状与倒挂', '#/curve'],
          ['03', '周期对照', '2000 与本届 AI 的六维对照', '#/analogy'],
          ['04', '理财计算器', '通胀、定投、房贷与回本', '#/calc'],
          ['05', '术语自测', '5 题检验理解，答错给解析', '#/quiz'],
          ['06', '收藏与记录', '收藏、阅读历史与学习进度', '#/saved'],
        ].map(([ic, title, desc, href]) => `<a class="tool-card" href="${href}"><span class="tc-ic">${ic}</span><span><b>${title}</b><small>${desc}</small></span></a>`).join('')}</div>
      </section>
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}
      <section class="lens-only h-sec" style="${si()}"><div class="panel" style="display:flex;gap:var(--s-4);align-items:center;flex-wrap:wrap"><div style="flex:1 1 260px"><div class="eyebrow">OpenFinLens / Live terminal</div><h3 style="margin-bottom:6px">从理解金融，到观察市场。</h3><p class="small muted" style="margin:0">实时盘口、热力图、全球事件与产业链强弱。数据同源，视角互补。</p></div><a class="btn ghost" ${(window.ACADEMY_SITE&&window.ACADEMY_SITE.lensUrl)||'https://5777-wq.github.io/openfinlens/'} target="_blank" rel="noopener">打开实时终端</a></div></section>
    </div>`;
    const eraBox = document.getElementById('home-era');
    if (eraBox) window.EraTimeline.render(eraBox);
    paintGauges();
    paintSnapshot();
    const src = document.getElementById('gauge-src');
    if (src && window.Quotes.state.source) src.textContent = '来源 ' + window.Quotes.state.source + ' · ' + window.Quotes.freshness() + ' · 数据可能有延迟，不构成投资建议';
  }

  window.HomeView = { render, paintGauges, pickTodayTerm, dayOfYear };
})();
