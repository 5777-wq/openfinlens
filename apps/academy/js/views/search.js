/* views/search.js —— 站内搜索结果页 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

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

  /* —— 搜索结果的分组层次（纯静态样式，无动效）——
     报纸的分栏线语法：每组一条 2px 墨线压顶，组头比正文标签深一档，
     组间距大于组内行距——三组结果扫一眼就知道边界在哪。 */
  const PAGE_CSS_ID = 'search-view-css';
  const PAGE_CSS = ''
    + '.sr-group{border-top:2px solid var(--ink);padding-top:var(--s-2);margin-bottom:var(--s-6);}'
    + '.sr-group .eyebrow{color:var(--ink-2);margin-bottom:var(--s-2);}'
    + '.sr-cards{display:grid;gap:var(--s-3);}'
    + '.sr-more{margin-top:var(--s-3);}';

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

  /**
   * 搜索：术语 + 文章 + 标的
   *
   * 为什么不是「整个关键词出现在某一个字段里」：
   *  · 读者会连着打——「pe市盈率」「roe净资产收益率」「etf费率」，
   *    整串匹配一个都搜不到。改成**按词元 AND 匹配**：每个词元都得在，
   *    就能命中了。
   *  · 整串匹配还会误伤：「pe ratio」会命中「sha**rpe ratio**」，
   *    因为 pe 是 sharpe 的子串。ASCII 词元改成**按词边界**匹配就不会。
   *  · 标的代码也走同一条路：读者打的是「600519」，站内 id 是「sh600519」，
   *    所以代码要单独拆成一个字段来比对（见 codesOf），不能指望子串。
   */
  function tokenize(q) {
    const s = String(q || '').trim();
    if (!s) return [];
    // ① 在「中文 ↔ 英文数字」的边界处切开（零宽切分，'pe市盈率' → ['pe','市盈率']）
    // ② 再按空白与常见分隔符切
    const parts = s.split(/(?<=[a-z0-9])(?=[\u4e00-\u9fa5])|(?<=[\u4e00-\u9fa5])(?=[a-z0-9])/i)
      .flatMap((x) => x.split(/[\s,，、/／·|]+/))
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return parts;
  }

  /** 一个词元是否出现在文本里
      ASCII 词元按**词边界**匹配（'pe' 不该命中 'sharpe'），
      中文词元按子串匹配（中文没有词边界概念）。 */
  function tokenHit(tok, text) {
    if (!tok) return true;
    if (/^[a-z0-9.+-]+$/.test(tok)) {
      const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)');
      if (re.test(text)) return true;
      // 英文复数：'etfs' 找不到时退一步试 'etf'
      if (/s$/.test(tok) && tok.length > 2) {
        const stem = tok.slice(0, -1);
        return new RegExp('(^|[^a-z0-9])' + stem + '([^a-z0-9]|$)').test(text);
      }
      return false;
    }
    return text.indexOf(tok) >= 0;
  }

  /** 一条记录是否命中全部词元 */
  function matchAll(tokens, text) {
    if (!tokens.length) return false;
    return tokens.every((tok) => tokenHit(tok, text));
  }

  /** 别名拆段：「PE / P/E / PE ratio / 市盈率」拆成四段，
      读者打哪一段都算「说中了别名」。斜杠两边要带空格才拆——
      「P/E」本身是一个写法，拆成 P 和 E 就没意义了。 */
  function aliasParts(alias) {
    return String(alias || '')
      .split(/\s*\/\s*/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }

  /** 词条的可搜文本：id + 词名 + 别名 + 一句话 + 关键词（俗名/英文/口语/错字）
      + 名称由来 + 比喻 + 坑。后三个都是现成的好别名源：
      读者说的那些口语（房贷、加息、「稳赚」这种坑话）常常只出现在比喻和坑里。 */
  function termText(id, t) {
    return [id, t.term || '', t.alias || '', t.one || '', (t.kw || []).join(' '),
      t.name || '', t.metaphor || '', t.pit || ''].join(' ').toLowerCase();
  }

  /** 已经拉到手的正文。
      正文现在是按需拉的（js/site/content.js 改成懒加载了），
      搜索不该反过来逼着浏览器把全站正文全下下来——
      所以这里只读缓存里已有的那几篇，读者逛过的文章也搜得到。 */
  function loadedBody(id) {
    const idx = window.Content && window.Content.idx;
    if (!idx || !idx.articles) return '';
    const full = typeof idx.articles.get === 'function' ? idx.articles.get(id) : idx.articles[id];
    return (full && full.body) || '';
  }

  /** 文章的可搜文本：id + 栏目 + 标题 + 摘要 + 标签 + 已加载的正文。
      栏目与标签也进搜索：「家庭理财」能搜到那一篇，
      读者不用先知道文章叫什么。 */
  function articleText(a) {
    return [a.id || '', a.section || '', a.title || '', a.dek || '', a.tag || '',
      (a.tags || []).join(' '), loadedBody(a.id)].join(' ').toLowerCase();
  }

  /* 命中档位：数字越小越靠前。
     以前结果按 id 字母序排，读者第一眼看到的是噪音——
     搜「市盈率」第一条是「每股收益」，搜「PE」前两条是「收益率倒挂」「均值回归」。
     现在先看「命中得有多准」，再看「这条词站内有几页正文」，最后才轮到字母序。 */
  const TIER = {
    TERM_EQ: 0,     // 词名完全等于查询
    ALIAS_EQ: 1,    // 别名里的某一段完全等于查询（PE、P/E、PE ratio…）
    TERM_PREFIX: 2, // 词名以查询开头（RSI 相对强弱指标）
    TERM_HAS: 3,    // 词名里包含查询
    ALIAS_HAS: 4,   // 别名里包含查询
    ID_EQ: 5,       // id 完全等于查询
    ID_HAS: 6,      // id 里包含查询
    ONE_HAS: 7,     // 一句话里提到
    EXTRA_HAS: 8,   // 名称由来 / 比喻 / 坑 / 关键词里提到
    NONE: 99,
  };

  /** 词元在这个词条里命中得有多准（数字越小越准）。
      判定一律走 tokenHit——跟筛选用的是同一套词边界规则：
      「pe」是「peg」的字首，但不是「peg」这个词，不能算命中别名。 */
  function termTier(tok, id, t) {
    const term = String(t.term || '').toLowerCase();
    const alias = String(t.alias || '').toLowerCase();
    const one = String(t.one || '').toLowerCase();
    const extra = [t.name || '', t.metaphor || '', t.pit || '', (t.kw || []).join(' ')].join(' ').toLowerCase();
    const lid = String(id).toLowerCase();
    if (term === tok) return TIER.TERM_EQ;
    if (aliasParts(alias).indexOf(tok) >= 0) return TIER.ALIAS_EQ;
    if (term.indexOf(tok) === 0 && tokenHit(tok, term)) return TIER.TERM_PREFIX;
    if (tokenHit(tok, term)) return TIER.TERM_HAS;
    if (tokenHit(tok, alias)) return TIER.ALIAS_HAS;
    if (lid === tok) return TIER.ID_EQ;
    if (tokenHit(tok, lid)) return TIER.ID_HAS;
    if (tokenHit(tok, one)) return TIER.ONE_HAS;
    if (tokenHit(tok, extra)) return TIER.EXTRA_HAS;
    return TIER.NONE;
  }

  /** 关键词在 kw 里的位置：排得越前，说明作者越当它是这个词的入口。
      「降息」在 lpr 的 kw 里排第一，在 monetary-policy 里排第六——同档时前者更贴。 */
  function kwRank(tok, t) {
    const kw = (t.kw || []).map((x) => String(x).toLowerCase());
    for (let i = 0; i < kw.length; i++) {
      if (kw[i].indexOf(tok) >= 0) return i;
    }
    return 50;
  }

  /** 词元在文章里命中得有多准 */
  function articleTier(tok, a) {
    const title = String(a.title || '').toLowerCase();
    const head = [a.id || '', a.section || '', a.dek || '', a.tag || '', (a.tags || []).join(' ')].join(' ').toLowerCase();
    const body = loadedBody(a.id).toLowerCase();
    if (title === tok) return 0;
    if (title.indexOf(tok) === 0 && tokenHit(tok, title)) return 1;
    if (tokenHit(tok, title)) return 2;
    if (tokenHit(tok, head)) return 3;
    if (body && tokenHit(tok, body)) return 4;
    return 9;
  }

  /* ---------------- 标的 ---------------- */

  /** 一只标的的代码：读者打的是「600519」「00700」「AAPL」，
      站内 id 是「sh600519」「hk00700」「usAAPL」——把市场前缀摘掉才是读者认得的代码。 */
  function codesOf(symbol) {
    const s = String(symbol || '');
    const out = [s];
    const colon = s.indexOf(':');
    const tail = colon >= 0 ? s.slice(colon + 1) : s;
    const dot = tail.lastIndexOf('.');
    if (dot >= 0) {
      out.push(tail.slice(dot + 1));   // EM:171.US10Y → US10Y
      out.push(tail);                 // EM:171.US10Y → 171.US10Y
    }
    const m = /^(sh|sz|hk|us)(.+)$/.exec(s);
    if (m) out.push(m[2]);            // sh600519 → 600519
    return out.filter(Boolean);
  }

  /** 读者看得懂的代码：优先用摘掉市场前缀的那个 */
  function codeOf(symbol) {
    const s = String(symbol || '');
    const m = /^(sh|sz|hk|us)(.+)$/.exec(s);
    if (m) return m[2];
    const colon = s.indexOf(':');
    const tail = colon >= 0 ? s.slice(colon + 1) : s;
    const dot = tail.lastIndexOf('.');
    if (dot >= 0) return tail.slice(dot + 1);
    return s;
  }

  /* 标的百科那套市场分组（终端 universe 的 group），搜索结果里标清是 A 股还是港股 */
  const MARKET_LABEL = {
    cn: 'A 股', hk: '港股', us: '美股', index: '指数',
    crypto: '加密', fx: '外汇', commodity: '商品', macro: '利率', other: '其它',
  };
  const MARKET_RANK = { cn: 0, index: 1, hk: 2, us: 3, commodity: 4, macro: 5, fx: 6, crypto: 7, other: 8 };

  /** 站内标的页清单：报价条 10 个 + 站内 94 个标的页，合并去重。
      中债10Y、欧元美元只出现在报价条里，站内没有它们的页面——
      没有页面的标的就不进结果（点进去是空页，比搜不到更糟）。 */
  function assetIndex() {
    const pages = (window.Content.assetPages ? window.Content.assetPages() : []);
    const has = new Set(pages.map((a) => a.symbol));
    const uni = (window.AssetsView && window.AssetsView.universe) ? window.AssetsView.universe() : [];
    const groupOf = new Map(uni.map((u) => [u.symbol, u.market || 'other']));

    const out = new Map();
    const put = (symbol, label) => {
      if (!symbol || !has.has(symbol)) return;
      if (!out.has(symbol)) {
        out.set(symbol, { symbol, label: label || symbol, names: [], codes: codesOf(symbol) });
      }
      if (label) out.get(symbol).names.push(label);
    };
    pages.forEach((a) => put(a.symbol, a.label));                 // 站内的名字当主名
    (window.Quotes.INSTRUMENTS || []).forEach((i) => put(i.key, i.name)); // 报价条的名字也算别名

    return [...out.values()].map((a) => {
      a.names = [...new Set(a.names)];
      a.code = codeOf(a.symbol);
      const group = groupOf.get(a.symbol) || (/^(sh|sz)/.test(a.symbol) ? 'cn' : 'other');
      a.market = MARKET_LABEL[group] || '';
      a.rank = MARKET_RANK[group] === undefined ? 9 : MARKET_RANK[group];
      return a;
    });
  }

  /** 一只标的的可搜文本：代码 + 名字（站内名与报价条名都算） */
  function assetText(a) {
    return [a.code].concat(a.names).concat(a.codes).join(' ').toLowerCase();
  }

  /** 标的是否命中：名字按普通规则，代码额外允许「前缀」——
      读者只记得住 60051 后面那几位，也应该能找着 600519。 */
  function assetHit(tokens, a) {
    const text = assetText(a);
    return tokens.every((tok) => {
      if (tokenHit(tok, text)) return true;
      if (tok.length >= 4 && /^[a-z0-9]+$/.test(tok)) {
        return a.codes.some((c) => String(c).toLowerCase().indexOf(tok) === 0);
      }
      return false;
    });
  }

  /** 词元在这只标的上命中得有多准：代码命中比名字命中更准——
      读者打出「600519」就是要找这只票，不是找一堆名字里带 600519 的东西。 */
  function assetTier(tok, a) {
    const code = String(a.code || '').toLowerCase();
    const names = a.names.map((n) => String(n).toLowerCase());
    if (code === tok) return 0;
    if (names.indexOf(tok) >= 0) return 1;
    if (names.some((n) => n.indexOf(tok) === 0 && tokenHit(tok, n))) return 2;
    if (code.length >= 4 && code.indexOf(tok) === 0) return 3;
    if (names.some((n) => tokenHit(tok, n))) return 4;
    if (tokenHit(tok, String(a.symbol))) return 5;
    return 9;
  }

  /** 站内排序分层（有专文 > 终端会链到 > 有 sym > 字母序）——
      跟术语库那套完全一样（js/views/term.js 的 orderTerms），
      同一个词在两边不该排出两个顺序。 */
  function termSignal(id, g, hot) {
    const t = g[id] || {};
    if (window.TermView && window.TermView.hasArticle(g, id)) return 0;
    if (hot && hot.has(id)) return 1;
    if (t.sym) return 2;
    return 3;
  }

  function search(q) {
    const tokens = tokenize(q);
    if (!tokens.length) return { terms: [], articles: [], assets: [] };

    const g = window.Content.glossary();
    const hot = (window.TermView && window.TermView.hotIds) ? window.TermView.hotIds() : new Set();

    const terms = Object.entries(g)
      .map(([id, t]) => {
        if (!matchAll(tokens, termText(id, t))) return null;
        const tiers = tokens.map((tok) => termTier(tok, id, t));
        const tier = Math.min(Math.max.apply(null, tiers), TIER.EXTRA_HAS);
        return {
          id, term: t.term, one: t.one, kind: '术语',
          tier,
          sub: tier === TIER.EXTRA_HAS
            ? Math.min.apply(null, tokens.map((tok) => kwRank(tok, t)))
            : 99,
          signal: termSignal(id, g, hot),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.tier - b.tier) || (a.signal - b.signal) || (a.sub - b.sub)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const articles = window.Content.list()
      .map((a) => {
        if (!matchAll(tokens, articleText(a))) return null;
        const tier = Math.min.apply(null, tokens.map((tok) => articleTier(tok, a)));
        return { id: a.id, section: a.section, title: a.title, dek: a.dek, kind: '文章', tier };
      })
      .filter(Boolean)
      .sort((a, b) => (a.tier - b.tier) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const assets = assetIndex()
      .map((a) => {
        if (!assetHit(tokens, a)) return null;
        const tier = Math.min.apply(null, tokens.map((tok) => assetTier(tok, a)));
        // 有专文的排前面：有专文才有一整页能读，没专文的只是一张数据卡
        const aid = (window.AssetsView && window.AssetsView.articleIdOf) ? window.AssetsView.articleIdOf(a.symbol) : a.symbol;
        const art = window.Content.meta(aid);   // 用索引里的那条判断，正文没拉到也不吵
        return {
          symbol: a.symbol, name: a.label, code: a.code, market: a.market,
          kind: '标的', tier, rank: a.rank, signal: art ? 0 : 1,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.tier - b.tier) || (a.signal - b.signal) || (a.rank - b.rank)
        || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));

    return { terms, articles, assets };
  }

  function render(view, q) {
    ensureCss();
    const r = search(q);
    const total = r.terms.length + r.articles.length + r.assets.length;
    const q1 = esc(q || '');

    /* 分组容器 sr-group：2px 墨线压顶，组头/组距的层次都在 search-view-css 里 */
    const group = (title, items, renderItem) => items.length
      ? `<section class="sr-group"><div class="eyebrow">${esc(title)} · ${items.length}</div>
         <div class="entries">${items.map(renderItem).join('')}</div></section>`
      : '';

    /* 术语命中：直接把完整词条卡画出来（一句话/比喻/数字/坑），
       读者搜一个词要的就是这个答案，不该再点一层。
       渲染用 term.js 的 dictCard——与术语库词典页同一份，两处不长两个样。
       命中太多时前 5 张画整卡，其余收成紧凑行：页面还能用，答案也不埋没。 */
    const CARD_CAP = 5;
    const dictCardOf = (id) => (window.TermView && window.TermView.dictCard)
      ? window.TermView.dictCard(id) : '';
    const compactTerm = (t) => `<a class="entry" href="#/term/${encodeURIComponent(t.id)}">
        <span><span class="e-t">${esc(t.term)}</span><span class="e-d">${esc(t.one || '')}</span></span>
        <span class="e-m">看解释 →</span></a>`;
    const termsBlock = r.terms.length
      ? `<section class="sr-group sr-terms">
          <div class="eyebrow">术语 · ${r.terms.length}</div>
          <div class="sr-cards">
            ${r.terms.slice(0, CARD_CAP).map((t) => dictCardOf(t.id)).join('')}
          </div>
          ${r.terms.length > CARD_CAP ? `<div class="entries sr-more">
            ${r.terms.slice(CARD_CAP).map(compactTerm).join('')}
          </div>` : ''}
        </section>`
      : '';

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">站内搜索</div>
        <h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">${q1 ? '「' + q1 + '」的搜索结果' : '搜索'}</h1>
        <p class="art-dek">${total ? `找到 ${total} 条结果。` : '没有匹配结果。'} 术语会告诉你"这是什么"，文章会告诉你"为什么"。</p>
      </div>
      ${termsBlock}
      ${group('文章', r.articles, (a) => `<a class="entry" href="#/${esc(a.section)}/${esc(a.id)}">
          <span><span class="e-t">${esc(a.title)}</span><span class="e-d">${esc(a.dek || '')}</span></span>
          <span class="e-m">读一篇 →</span></a>`)}
      ${group('标的', r.assets, (a) => `<a class="entry" href="#/assets/${encodeURIComponent(a.symbol)}">
          <span><span class="e-t">${esc(a.name)}</span>
            <span class="e-d">${esc([a.market, a.code ? '代码 ' + a.code : ''].filter(Boolean).join(' · '))}</span></span>
          <span class="e-m">看这一页 →</span></a>`)}
      ${!total ? `<div class="empty"><div class="et">没有找到</div>
        <div class="ed">还没有这个词。换个说法试试，或者去<a href="#/path">新手路径</a>从头看起——那 8 课把最常出现的词都讲了一遍。</div></div>` : ''}`;
  }

  window.SearchView = { render, search, tokenize, tokenHit, assetIndex, codesOf, codeOf, assetHit };
})();
