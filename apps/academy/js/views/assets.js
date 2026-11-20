/* views/assets.js —— 标的百科：索引（与行情终端同一份标的清单）+ 详情（专文 + 真实数据卡）
   为什么这么做：终端能看的每个标的，科普站都要能查到它的历史。
   所以索引是数据驱动生成的（不手写清单），详情页的峰谷、区间涨跌也全部由序列算出。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const LENS = (window.ACADEMY_SITE && window.ACADEMY_SITE.lensUrl) || 'https://5777-wq.github.io/openfinlens/';

  /* —— 列表卡 hover 反馈（即时反馈类动效）——
     六个视图文件（list/article/assets/chain/path/search）各带一份**逐字节相同**的
     这段样式，共用同一个 id：谁先渲染谁注入，后来者按 id 跳过——不依赖加载顺序。 */
  const ENTRY_CSS_ID = 'entry-cards-css';
  const ENTRY_CSS = ''
    + '.entries .entry{position:relative;transition:background-color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry::before{content:"";position:absolute;left:-9px;top:13px;bottom:13px;width:2px;border-radius:1px;'
    + 'background:var(--gold);transform:scaleY(0);transform-origin:50% 50%;'
    + 'transition:transform var(--dur-1,140ms) var(--ease-out,cubic-bezier(.16,1,.3,1));}'
    + '.entries .entry .e-t{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry .e-d{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry .e-m{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1)),'
    + 'transform var(--dur-1,140ms) var(--ease-out,cubic-bezier(.16,1,.3,1));}'
    + '.entries .entry:hover .e-d,.entries .entry:focus-visible .e-d{color:var(--ink-2);}'
    + '.entries .entry:hover .e-m,.entries .entry:focus-visible .e-m{color:var(--ink-2);transform:translateX(2px);}'
    + '.entries .entry:hover::before,.entries .entry:focus-visible::before{transform:scaleY(1);}'
    + '@media (prefers-reduced-motion:reduce){'
    + '.entries .entry,.entries .entry::before,.entries .entry .e-t,.entries .entry .e-d,.entries .entry .e-m{transition:none;}'
    + '}';

  /* —— 标的详情页的视觉层级（纯静态样式，无动效）——
     两块面板各有各的身份，长一个样的话读者分不清哪块是数、哪块是话：
      · 数据卡 = 展品：读数拆成一组留白清楚的小模块，不再用整宽框线；
        「最新」一格铺金箔底——金色只做指示：这一格是"现在"，其余都是历史。
      · 三段短注 = 解读：次级纸底（sheet-2，与文章页「本文要点」同一种纸），
        三个小标用金色等宽字竖着排，「坑」的小标用警示色——颜色都在纸底 ≥4.5:1 的那套里。 */
  const PAGE_CSS_ID = 'assets-view-css';
  const PAGE_CSS = ''
    + '.stat.is-now{background:var(--gold-soft);}'
    + '.an-panel{background:var(--sheet-2);}'
    + '.an-panel .cat-desc{margin:0;padding:9px 0;font-size:var(--t-small);color:var(--ink-2);}'
    + '.an-panel .cat-desc:first-of-type{padding-top:0;}'
    + '.an-panel .cat-desc:last-of-type{padding-bottom:0;}'
    + '.an-panel .cat-desc b{display:block;font-family:var(--font-mono);font-size:var(--t-eyebrow);'
    + 'font-weight:600;letter-spacing:.14em;color:var(--gold-text);margin-bottom:4px;}'
    + '.an-panel .cat-desc.an-trap b{color:var(--warn);}';
    // 走势与回撤两块图：纸底、细界线、等宽数字，图表不自己造一套配色。
    + '.chart-panel{margin-bottom:var(--s-6);}'
    + '.chart-panel .panel-title{margin-bottom:var(--s-3);}'
    + '.chart-panel .chart-host{min-height:120px;overflow:hidden;}'
    + '.chart-panel .chart-host svg{display:block;width:100%;height:auto;}'
    + '.chart-caveat{color:var(--ink-3);}'
    + '.compare-row{display:flex;align-items:center;gap:var(--s-3);flex-wrap:wrap;margin:0 0 var(--s-3);}'
    + '.compare-row label{font-family:var(--font-mono);font-size:var(--t-micro);color:var(--ink-3);}'
    + '.compare-row select{font:inherit;font-size:var(--t-small);padding:6px 9px;border:1px solid var(--rule);'
    + 'border-radius:var(--r-2);background:var(--sheet);color:var(--ink);}'
    + '.compare-row select:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}'
    + '.chart-loading{margin:0;padding:var(--s-4) 0;color:var(--ink-3);font-size:var(--t-small);}'

  function ensureCss() {
    for (const [id, css] of [[ENTRY_CSS_ID, ENTRY_CSS], [PAGE_CSS_ID, PAGE_CSS]]) {
      try {
        if (document.getElementById(id)) continue;
        const st = document.createElement('style');
        st.id = id;
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
      } catch (e) { /* 注入不了就算了——动效是增强，不是功能 */ }
    }
  }

  /* 终端的 symbol → 站内序列 id（大部分同名，指数/商品另有一套） */
  const SERIES_OF = {
    sh000001: 'SH000001', sz399001: 'SZ399001', sz399006: 'SZ399006', sh000688: 'SH000688',
    usINX: 'SPX', usDJI: 'DJIA', hkHSI: 'HSI', hkHSTECH: 'HSTECH',
    'EM:100.N225': 'N225',            // 终端「全球指数条」那一排里的日经225
    'EM:100.GDAXI': 'GDAXI', 'EM:100.FTSE': 'FTSE', 'EM:100.FCHI': 'FCHI',
    'EM:100.KS11': 'KS11', 'EM:100.SENSEX': 'SENSEX',
    'EM:101.GC00Y': 'GC00Y', 'EM:101.SI00Y': 'SI00Y', 'EM:101.HG00Y': 'HG00Y',
    'EM:102.CL00Y': 'CL00Y', 'EM:102.NG00Y': 'NG00Y', 'EM:103.ZC00Y': 'ZC00Y',
    'EM:100.UDI': 'UDI',
    'EM:171.US10Y': 'US10Y', 'EM:171.US5Y': 'US5Y', 'EM:171.US2Y': 'US2Y',
    'EM:171.US3M': 'US3M', 'EM:171.US30Y': 'US30Y',
    'EM:171.CN2Y': 'CN2Y', 'EM:171.CN5Y': 'CN5Y', 'EM:171.CN10Y': 'CN10Y', 'EM:171.CN30Y': 'CN30Y',
    'EM:171.DE10Y': 'DE10Y', 'EM:171.JP10Y': 'JP10Y',
    'EM:133.USDCNH': 'USDCNH',
    'EM:119.EURUSD': 'EURUSD', 'EM:119.GBPUSD': 'GBPUSD',
    'EM:119.USDJPY': 'USDJPY', 'EM:119.USDHKD': 'USDHKD',
    gold: 'GC00Y',            // 老链接 #/assets/gold 也要能拿到数据卡
  };

  /* 站内 id → 终端的 symbol。
     两者**不是一回事**：#/assets/gold 是站内老链接，终端里没有 gold 这个 symbol
     （只有 EM:101.GC00Y）。用站内 id 去链终端，终端会打开一个名为「ld」、
     没有数据的空详情页。 */
  const LENS_OF = {
    gold: 'EM:101.GC00Y',
  };

  /* 站内自有序列：终端里没有对应标的，不给「去看历史数据」的链接
     （链过去终端会打开一个空详情页）。 */
  const NO_LENS = new Set(['VIX', 'IXIC']);

  /* 站内自有序列：终端不展示、但本站有月线数据的序列。
     它们以前只能被词条引用（「站内 VIX 月度序列可核对」），读者却找不到地方核对——
     序列收在仓库里，站内没有任何页面能打开它。 */
  const OWN_SERIES = [
    { id: 'VIX', label: 'VIX 恐慌指数', note: 'CBOE 官方月末收盘 · 标普500期权的隐含波动率' },
    { id: 'IXIC', label: '纳斯达克综合指数（1991 年起）', note: '综合指数的长历史 · 站内另有腾讯源的 usIXIC（2007 年起）——同一条指数的两段历史，不是两个指数' },
  ];

  /* 少数几个标的的名字要说清楚。
     usIXIC 与 IXIC 是**同一条指数**（纳斯达克综合指数）的两段历史：
     腾讯源从 2007 年起，东财源从 1991 年起。名字含糊的话，读者会以为是两个指数。 */
  const LABEL_OF = {
    usIXIC: '纳斯达克综合指数',
  };

  /* 终端的 symbol → 站内专文 id（已写过专文的） */
  const ARTICLE_OF = {
    'EM:101.GC00Y': 'gold',
    'EM:100.FCHI': 'FCHI',
    'EM:100.FTSE': 'FTSE',
    'EM:100.GDAXI': 'GDAXI',
    'EM:100.KS11': 'KS11',
    'EM:100.N225': 'N225',
    'EM:100.SENSEX': 'SENSEX',
    'EM:100.UDI': 'UDI',
    'EM:101.HG00Y': 'HG00Y',
    'EM:101.SI00Y': 'SI00Y',
    'EM:102.CL00Y': 'CL00Y',
    'EM:102.NG00Y': 'NG00Y',
    'EM:103.ZC00Y': 'ZC00Y',
    'EM:119.EURUSD': 'EURUSD',
    'EM:119.GBPUSD': 'GBPUSD',
    'EM:119.USDHKD': 'USDHKD',
    'EM:119.USDJPY': 'USDJPY',
    'EM:133.USDCNH': 'USDCNH',
    'EM:171.CN10Y': 'CN10Y',
    'EM:171.CN2Y': 'CN2Y',
    'EM:171.CN30Y': 'CN30Y',
    'EM:171.CN5Y': 'CN5Y',
    'EM:171.DE10Y': 'DE10Y',
    'EM:171.JP10Y': 'JP10Y',
    'EM:171.US10Y': 'US10Y',
    'EM:171.US2Y': 'US2Y',
    'EM:171.US30Y': 'US30Y',
    'EM:171.US3M': 'US3M',
    'EM:171.US5Y': 'US5Y',
    'hkHSI': 'HSI',
    'hkHSTECH': 'HSTECH',
    'sh000001': 'SH000001',
    'sh000688': 'SH000688',
    'sz399001': 'SZ399001',
    'sz399006': 'SZ399006',
    'usDJI': 'DJIA',
    'usINX': 'SPX',
  };

  const GROUP_LABEL = {
    index: '指数', cn: 'A 股', hk: '港股', us: '美股',
    crypto: '加密', fx: '外汇', commodity: '商品', macro: '利率', other: '其它',
  };

  /** 终端 universe（vendor 同步过来的那份）——两边共用同一份标的清单。
      GLOBAL_INDEX（终端顶栏那一排全球指数）也要算进来：
      它们同样有站内页（日经225 / 德国DAX / 英国富时100 / 法国CAC40 / 韩国KOSPI / 印度SENSEX），
      漏了的话读者在标的百科里翻不到——页面存在却没人引得到。 */
  function universe() {
    const t = (window.TENCENT_UNIVERSE || []).map((x) => Object.assign({ market: x.group }, x));
    const em = (window.EM_UNIVERSE || []).map((x) => Object.assign({ market: x.group }, x));
    // GLOBAL_INDEX 那份用的是 name 而不是 label，映射时补上——不然索引里会写「undefined」
    const gi = (window.GLOBAL_INDEX || []).map((x) => Object.assign({ market: 'index', group: 'index' }, x, { label: x.label || x.name }));
    return t.concat(em, gi);
  }

  function seriesIdOf(sym) { return SERIES_OF[sym] || sym; }
  function articleIdOf(sym) { return ARTICLE_OF[sym] || sym; }

  /** 标的百科索引：清单 + 覆盖区间，全部来自数据，不手写 */
  async function renderIndex(view) {
    ensureCss();
    const reg = await window.History.registry();
    const map = new Map(((reg && reg.series) || []).map((s) => [s.id, s]));
    const uni = universe();

    const groups = new Map();
    for (const u of uni) {
      const sid = seriesIdOf(u.symbol);
      const s = map.get(sid);
      if (!s) continue;                       // 没采到数据的就不列——不列空页
      const g = u.market || 'other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ u, s });
    }

    const order = ['index', 'cn', 'hk', 'us', 'commodity', 'macro', 'fx', 'crypto', 'other'];
    const blocks = order.filter((g) => groups.has(g)).map((g) => {
      const rows = groups.get(g).map(({ u, s }) => {
        const art = window.Content.article(articleIdOf(u.symbol));
        const notes = (window.Content.assetNotes && window.Content.assetNotes()) || {};
        const badge = art ? ' · 有专文' : (notes[u.symbol] ? ' · 三段短注' : '');
        return `<a class="entry" href="#/assets/${encodeURIComponent(u.symbol)}">
          <span>
            <span class="e-t">${esc(LABEL_OF[u.symbol] || u.label)}</span>
            <span class="e-d">${esc(s.from)} → ${esc(s.to)} · ${s.count} 个月度点${badge}</span>
          </span>
          <span class="e-m">看这一页 →</span>
        </a>`;
      }).join('');
      return `<div class="eyebrow" style="margin:var(--s-6) 0 var(--s-3)">${esc(GROUP_LABEL[g] || g)} · ${rows ? groups.get(g).length : 0}</div>
        <div class="entries">${rows}</div>`;
    }).join('');

    // 站内自有序列：终端不展示，但本站有数据、词条也在引用它们。
    // 不列出来的话，「站内 VIX 月度序列可核对」这句话就是空头支票。
    const ownRows = OWN_SERIES.map((o) => {
      const s = map.get(o.id);
      if (!s) return '';
      return `<a class="entry" href="#/assets/${encodeURIComponent(o.id)}">
        <span>
          <span class="e-t">${esc(o.label)}</span>
          <span class="e-d">${esc(o.note)} · ${esc(s.from)} → ${esc(s.to)} · ${s.count} 个月度点</span>
        </span>
        <span class="e-m">看这一页 →</span>
      </a>`;
    }).filter(Boolean).join('');
    const ownBlock = ownRows ? `
      <div class="eyebrow" style="margin:var(--s-6) 0 var(--s-3)">站内自有序列 · ${ownRows.split('<a class="entry"').length - 1}</div>
        <div class="entries">${ownRows}</div>
        <p class="cat-desc" style="margin-top:var(--s-2)">这几条行情终端里不展示，但本站有完整的月线数据——词条里说「可在站内核对」的就是它们。</p>` : '';

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">栏目 03 · 标的百科</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">和行情终端同一份标的清单</h1>
        <p class="art-dek">下面是行情终端里能看的每一只标的。点进去有它的真实历史读数（历史最高、历史最低、最大回撤、近一年涨跌），有专文的还会多一篇讲清楚它靠什么赚钱。</p>
      </div>
      ${blocks || '<div class="empty"><div class="et">数据还没采齐</div><div class="ed">跑一次采集脚本就能拿到真实历史。</div></div>'}
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}
      ${ownBlock}`;
  }

  /** 标的详情页：专文（如果有）+ 真实数据卡 */
  async function renderDetail(view, id) {
    ensureCss();
    // 同一个容器可能连续渲染两只标的：只让最后一次的异步图表写回。
    view.__assetPageSeq = (view.__assetPageSeq || 0) + 1;
    const sym = id;
    const sid = seriesIdOf(sym);
    const aid = articleIdOf(sym);
    const art = window.Content.article(aid);
    const series = await window.History.series(sid);
    await window.Content.ensureWiki();
    // 切走了就别画了：序列是异步取的，这期间用户很可能已经跳去别的页面
    if (!view.isConnected) return;
    const st = window.Engine.instrument ? window.Engine.instrument.stats(series) : null;

    const q = window.Router ? window.Router.parse(location.hash).query : {};
    const fromLens = q.from === 'lens';

    const dataCard = st ? `
      <div class="panel stats-card" style="margin-bottom:var(--s-6)">
        <div class="eyebrow" style="margin-bottom:var(--s-3)">真实历史读数 · 全部由月线序列算出</div>
        <div class="stat-grid">
          <div class="stat is-now"><span class="s-k">最新</span><span class="s-v num">${esc(fmtNum(st.last.v, series))}</span><span class="s-n">${esc(st.to)}${st.partial ? ' · 当月未收' : ''}</span></div>
          <div class="stat"><span class="s-k">历史最高</span><span class="s-v num">${esc(fmtNum(st.peak.v, series))}</span><span class="s-n">${esc(st.peak.t)}</span></div>
          <div class="stat"><span class="s-k">历史最低</span><span class="s-v num">${esc(fmtNum(st.trough.v, series))}</span><span class="s-n">${esc(st.trough.t)}</span></div>
          ${st.isRate ? `
          <div class="stat"><span class="s-k">历史区间</span><span class="s-v num">${st.spreadPp.toFixed(2)} 个百分点</span><span class="s-n">最高到最低</span></div>
          <div class="stat"><span class="s-k">近一年</span><span class="s-v num ${(st.chg1yBp || 0) >= 0 ? 'up' : 'down'}">${st.chg1yBp === null ? '--' : (st.chg1yBp >= 0 ? '+' : '') + st.chg1yBp.toFixed(0) + ' 个基点'}</span><span class="s-n">收益率变化</span></div>`
          : `
          <div class="stat"><span class="s-k">最大回撤</span><span class="s-v num ${st.dropPct < 0 ? 'down' : 'up'}">${st.dropPct.toFixed(1)}%</span><span class="s-n">${esc(String(st.mddFrom || '').slice(0, 7))} → ${esc(String(st.mddTo || '').slice(0, 7))}</span></div>
          <div class="stat"><span class="s-k">近一年</span><span class="s-v num ${(st.chg1y || 0) >= 0 ? 'up' : 'down'}">${st.chg1y === null ? '--' : st.chg1y.toFixed(1) + '%'}</span><span class="s-n">不含分红</span></div>`}
          <div class="stat"><span class="s-k">覆盖区间</span><span class="s-v num">${esc(st.from.slice(0, 7))} 起</span><span class="s-n">${st.count} 个月度点</span></div>
          ${st.pctl !== null && st.pctl !== undefined && st.band ? `
          <div class="stat">
            <span class="s-k">当前在历史上的位置</span>
            <span class="s-v num">${st.pctl.toFixed(0)}% 分位</span>
            <span class="pbar" aria-hidden="true"><i style="left:${st.pctl.toFixed(1)}%"></i></span>
            <span class="s-n">${esc(st.band.label)}</span>
          </div>` : ''}
        </div>
        <p class="insight-note">口径：${esc(series.kind || '月收盘价')} · ${esc(series.source || '')}${st.unadj ? '。未复权价不含分红，所以这里的涨幅是价格涨幅，不是总回报' : ''}${st.isRate ? '。收益率的变化用「个百分点 / 个基点」说，不用百分比——从 5% 跌到 2% 是跌了 3 个百分点，不是跌了 60%' : ''}${st.partial ? '。序列的最后一点是采集当天的盘中值，当月还没走完，所以不叫「月末」' : ''}。最大回撤指的是历史里最深的那一次「从高点跌到低点」，峰值在前、谷底在后。</p>
      </div>` : `
      <div class="panel" style="margin-bottom:var(--s-6)">
        <div class="eyebrow">历史数据</div>
        <p class="muted" style="margin:0">这一只的月线序列还没采到，跑一次采集脚本就能补上。</p>
      </div>`;

    // —— 与行情终端的双向跳转 ——
    // lensSym：站内 id 不一定是终端的 symbol（gold → EM:101.GC00Y）；
    // 站内自有序列（VIX / NDX）终端根本没有，就不给「去看历史数据」。
    const lensSym = LENS_OF[sym] || (NO_LENS.has(sym) ? '' : sym);
    const cross = window.Cross.bar({
      sym: sym,
      lensSym: lensSym,
      fromLens: fromLens,
      moreHref: '#/assets',
      moreLabel: '看别的标的 →',
    });

    const body = art ? window.TermCard.markTerms(window.Fmt.md(art.body || ''), window.Content.glossary()) : '';

    // 没有专文的标的页不再只是一张数据表：三段短注（这是什么 / 它跟着什么走 / 最容易踩的坑）。
    // 内容在 content/_meta/asset-notes.json，口径与校验见 drafts/asset-notes/stats.json。
    const notesMap = (window.Content.assetNotes && window.Content.assetNotes()) || null;
    const note = (!art && notesMap && notesMap[sym]) || null;
    const noteHtml = note ? `
      <div class="panel an-panel" style="margin-bottom:var(--s-6)">
        <div class="eyebrow" style="margin-bottom:var(--s-2)">三段话读懂它</div>
        <p class="cat-desc an-what"><b>这是什么：</b>${esc(note.what)}</p>
        <p class="cat-desc an-moves"><b>它跟着什么走：</b>${esc(note.moves)}</p>
        <p class="cat-desc an-trap"><b>最容易踩的坑：</b>${esc(note.trap)}</p>
      </div>` : '';

    // 延伸阅读：公司沿革、创始人故事、历年大事记这类长线内容，维基百科上更完整。
    // 链接表在 content/_meta/asset-wiki.json（_scripts/resolve-asset-wiki.mjs 逐条核对过存在性）；
    // 外部站点，站内不对其内容负责，所以只给深链不给内嵌。
    const wikiMap = (window.Content.assetWiki && window.Content.assetWiki()) || null;
    const wiki = wikiMap && wikiMap[sym];
    const wikiLinks = wiki
      ? [
        wiki.zh ? `<a href="${esc(wiki.zh)}" target="_blank" rel="noopener noreferrer">中文维基百科 ↗</a>` : '',
        wiki.en ? `<a href="${esc(wiki.en)}" target="_blank" rel="noopener noreferrer">English Wikipedia ↗</a>` : '',
      ].filter(Boolean).join('<span class="msep" aria-hidden="true">·</span>')
      : '';
    const wikiHtml = wikiLinks ? `
      <div class="panel" style="margin-bottom:var(--s-6)">
        <div class="eyebrow" style="margin-bottom:var(--s-2)">延伸阅读</div>
        <p class="muted" style="margin:0 0 var(--s-3)">它的来龙去脉——怎么起家、中间出过什么大事、谁在掌舵——维基百科上有持续更新的完整版本：</p>
        <p style="margin:0">${wikiLinks}</p>
      </div>` : '';

    view.innerHTML = `
      <article class="art-head">
        <div class="eyebrow">标的百科</div>
        <h1>${esc((art && art.title) || (series && series.name) || sym)}</h1>
        ${art && art.dek ? `<p class="art-dek">${esc(art.dek)}</p>` : ''}
        ${series ? `<p class="art-meta"><span>${esc(LABEL_OF[sym] || series.name || sym)}</span><span class="msep">·</span><span>${esc(series.unit || '')}</span><span class="msep">·</span><span>数据截至 ${esc(st ? st.to : '—')}</span></p>` : ''}
      </article>

      ${dataCard}
      ${chartBlocks(series)}
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}
      ${cross}

      ${art ? `<div class="prose">${body}</div>` : (noteHtml || `
        <div class="empty"><div class="et">这一只还没有解释</div>
          <div class="ed">数据卡是真的（上面每个数都能对着月线序列核）；但"它靠什么赚钱、什么时候会跌"这类解释还在写。${
            (window.Cross && window.Cross.enabled())
              ? '想看它的实时行情与走势，去 OpenFinLens。'
              : ''}</div>
          ${(window.Cross && window.Cross.enabled())
            ? `<a class="btn ghost sm" href="${LENS}#symbol=${encodeURIComponent(sym)}" target="_blank" rel="noopener">去 OpenFinLens 看行情 →</a>`
            : ''}
        </div>`)}

      ${wikiHtml}

      ${(art || noteHtml || wikiHtml) ? `<p style="margin-top:var(--s-6)"><a class="btn ghost sm" href="#/assets">看全部标的 →</a></p>` : ''}`;

    // 图在容器挂载之后才填：真正写进 DOM 的只能是本视图里的那两个容器
    // （作用域查询，与回放器同一条规矩——绝不越界去别的页面找同名节点）。
    paintCharts(view, series);
    paintCompare(view, series, sid);

    // 术语库若还在空闲档加载（site/content.js），正文词条锚点会先降级成纯文本；
    // 术语库一到就地补画这一次（序列与正文都有缓存，__assetPageSeq 挡住竞态）。
    if (window.Content.glossaryLoaded && !window.Content.glossaryLoaded() && window.Content.onGlossary) {
      window.Content.onGlossary(() => { if (view.isConnected) renderDetail(view, id); });
    }
  }

    /* —— 标的页的图：月线走势 / 回撤 / 同区间对比 ——
     口径不在这里另算：回撤与峰值先后顺序交给 Engine.drawdown；
     读屏句子交给 SeriesChart.describe；页面只把结果放进对的容器。 */
  const REF_OPTIONS = [
    { id: 'SPX', label: '标普500' },
    { id: 'GC00Y', label: 'COMEX黄金' },
    { id: 'US10Y', label: '美债10年期收益率' },
  ];

  function rateSeries(series) { return String(series && series.unit || '') === '%'; }

  function isUnadjusted(series) {
    const k = String(series && series.kind || '');
    const src = String(series && series.source || '');
    return /未复权/.test(k) || /未复权/.test(src);
  }

  function chartBlocks(series) {
    if (!series || !Array.isArray(series.points) || series.points.length < 2) return '';
    if (!window.SeriesChart || !window.SeriesChart.describe) {
      return `<div class="panel chart-panel">
        <div class="panel-title"><h3>月线走势与回撤</h3><span class="sub">图表组件未载入</span></div>
        <p class="insight-note">这一页的数据卡仍然可用；图表组件没有加载成功，所以先不画。</p>
      </div>`;
    }
    const desc = window.SeriesChart.describe(series);
    const kind = esc(series.kind || '月收盘价');
    const source = series.source ? ' · ' + esc(series.source) : '';
    const kindNote = '口径：' + kind + source + '。' +
      (isUnadjusted(series)
        ? '未复权价不含分红，所以这里的涨幅是价格涨幅，不是总回报。'
        : '复权方式以数据源标注为准。') +
      (rateSeries(series) ? '这是收益率序列，变化用「个百分点」说，不用百分比。' : '');

    return `
      <div class="panel chart-panel">
        <div class="panel-title"><h3>月线走势</h3><span class="sub">对数纵轴 · ${esc(series.unit || '')}</span></div>
        <div id="asset-chart" class="chart-host" role="img" aria-label="${esc(desc)}"></div>
        <p class="insight-note">${kindNote}纵轴取对数：价格跨数量级时，早期走势不会被压成一条平线。</p>
        <p class="insight-note chart-caveat">过去不代表未来。这条线只呈现已经发生的月末读数，不预测下一步。</p>
      </div>

      <div class="panel chart-panel">
        <div class="panel-title"><h3>回撤</h3><span class="sub">从上一个高点算起</span></div>
        <div id="asset-dd" class="chart-host" role="img" aria-label="${esc(desc)}"></div>
        <p class="insight-note">${kindNote}每个点都跟「它之前出现过的最高点」比；谷底一定在峰值之后，金线标出最深的那一段。</p>
        <p class="insight-note chart-caveat">过去不代表未来。回撤记录的是历史里跌得最深的一次，不说明下一次会跌多少。</p>
      </div>

      <div class="panel chart-panel">
        <div class="panel-title"><h3>同区间对比</h3><span class="sub">归一化到 100</span></div>
        <div class="compare-row">
          <label for="asset-compare-ref">参照序列</label>
          <select id="asset-compare-ref" aria-label="选择同区间对比的参照序列">
            ${REF_OPTIONS.map((o) => `<option value="${esc(o.id)}"${o.id === 'SPX' ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
          <span class="muted small">只取两条序列都有数据的月份；起点 = 100。</span>
        </div>
        <div id="asset-compare" class="chart-host" role="img" aria-label="同区间对比：正在读取参照序列"></div>
        <p class="insight-note chart-caveat">过去不代表未来。归一化只方便比较同区间的相对涨跌，不代表两者风险相同，也不构成投资建议。</p>
      </div>`;
  }

  /** 把两块主图填进**本视图**的容器。容器在页面 HTML 里先摆好，
      这样即使 SVG 生成失败也只是容器里留一句兜底，不会白屏。 */
  function paintCharts(view, series) {
    if (!view || !view.querySelector || !series) return;
    if (!window.SeriesChart || !window.SeriesChart.render) return;
    const desc = window.SeriesChart.describe(series);
    const lineHost = view.querySelector('#asset-chart');
    const ddHost = view.querySelector('#asset-dd');
    const line = heroChart(series, { mode: 'line', width: 1000, height: 260, years: 5 });
    const dd = heroChart(series, { mode: 'drawdown', width: 1000, height: 260, years: 5 });
    fillChart(lineHost, line, desc, '这条序列的月线走势暂时画不出来；上面的数据卡仍然可用。');
    fillChart(ddHost, dd, desc + ' 纵轴是距此前高点的回落。', '这条序列的回撤暂时画不出来；上面的数据卡仍然可用。');
  }

  function heroChart(series, opts) {
    try { return window.SeriesChart.render(series, opts) || ''; } catch (e) { return ''; }
  }

  function fillChart(host, svg, label, fallback) {
    if (!host) return;
    if (svg) {
      host.innerHTML = svg;
      host.setAttribute('role', 'img');
      host.setAttribute('aria-label', label);
    } else {
      host.innerHTML = `<p class="chart-loading">${esc(fallback)}</p>`;
      host.setAttribute('role', 'note');
      host.setAttribute('aria-label', fallback);
    }
  }

  /** 同区间对比：默认 SPX；切下拉只重画对比那一块，焦点留在 select 上。 */
  function paintCompare(view, series, mainId) {
    if (!view || !view.querySelector || !series) return;
    if (!window.History || !window.History.series || !window.SeriesChart) return;
    const host = view.querySelector('#asset-compare');
    const sel = view.querySelector('#asset-compare-ref');
    if (!host || !sel) return;

    // 同一视图里连续切下拉：只认最后一次，慢请求回来不许盖掉新选择。
    let refSeq = 0;
    // 换页竞态：先记下这是第几次渲染这个容器；await 回来时若已换页就不写。
    const pageSeq = view.__assetPageSeq || 0;

    const load = (ref) => {
      const mine = ++refSeq;
      host.innerHTML = '<p class="chart-loading">正在读取参照序列…</p>';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-label', '正在读取参照序列');
      window.History.series(ref).then((refSeries) => {
        if (mine !== refSeq) return;
        if (!view.isConnected || (view.__assetPageSeq || 0) !== pageSeq) return;
        const box = view.querySelector('#asset-compare');
        if (!box) return;
        if (ref === mainId) {
          box.innerHTML = '<p class="chart-loading">这只标的本身就是参照序列；换一条参照再看对比。</p>';
          box.setAttribute('role', 'note');
          box.setAttribute('aria-label', '这只标的本身就是参照序列，请换一条参照');
          return;
        }
        if (!refSeries || !Array.isArray(refSeries.points) || refSeries.points.length < 2) {
          box.innerHTML = '<p class="chart-loading">这条参照序列暂时取不到；上面的走势与回撤仍然可用。</p>';
          box.setAttribute('role', 'note');
          box.setAttribute('aria-label', '参照序列取不到');
          return;
        }
        let svg = '';
        try {
          svg = window.SeriesChart.render(series, {
            mode: 'line', width: 1000, height: 280, years: 5,
            compare: [refSeries],
          }) || '';
        } catch (e) { svg = ''; }
        if (!svg) {
          box.innerHTML = '<p class="chart-loading">这两条序列没有足够的共同月份；暂时画不出对比。</p>';
          box.setAttribute('role', 'note');
          box.setAttribute('aria-label', '两条序列没有足够的共同月份');
          return;
        }
        const refLabel = (REF_OPTIONS.filter((o) => o.id === ref)[0] || {}).label || ref;
        const label = window.SeriesChart.describe(series) + ' 对比参照：' + refLabel + '，两条都归一化到起点 100。';
        box.innerHTML = svg;
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', label);
      }).catch(() => {
        if (mine !== refSeq) return;
        if (!view.isConnected || (view.__assetPageSeq || 0) !== pageSeq) return;
        const box = view.querySelector('#asset-compare');
        if (!box) return;
        box.innerHTML = '<p class="chart-loading">这条参照序列暂时取不到；上面的走势与回撤仍然可用。</p>';
        box.setAttribute('role', 'note');
        box.setAttribute('aria-label', '参照序列取不到');
      });
    };

    sel.addEventListener('change', () => load(sel.value || 'SPX'));
    load(sel.value || 'SPX');
  }

  function fmtNum(v, series) {
    const d = series && series.digits !== undefined ? series.digits : 2;
    return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  window.AssetsView = { renderIndex, renderDetail, universe, SERIES_OF, ARTICLE_OF, seriesIdOf, LENS_OF, OWN_SERIES };
})();
