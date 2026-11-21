/* views/article.js —— 通用文章阅读器
   适用：货币与利率 / 标的百科 / 周期镜鉴 / 家庭理财 的详情页

   正文是**按需拉**的：打开哪篇才拉哪篇。
   所以第一屏先按索引里的标题/简介摆好版面（body 还在路上），
   正文到了再把整块填上——不能先渲染「没找到这篇文章」再改成正文，
   慢网下那样会让人以为站点坏了。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const F = () => window.Fmt;

  /* —— 列表卡 hover 反馈（即时反馈类动效）——
     六个视图文件（list/article/assets/chain/path/search）各带一份**逐字节相同**的
     这段样式，共用同一个 id：谁先渲染谁注入，后来者按 id 跳过——不依赖加载顺序。
     注：规则挂在 .entries .entry 上，全站的条目列表同一张脸。 */
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

  /* —— 文章正文首次进场的淡入 ——
     回答的是「这东西从哪来」，不是表演：
      · 换页进场由 index.html 动效层的 .route-host（route-in）统一负责——app.js
        每次换页都新建容器节点，那段动画天然一页只播一次。这里**不**重复做骨架阶段的进场。
      · 这里只标记「正文到达」这一次：骨架与正文是同一容器里的两次 innerHTML，
        正文到了、整块换上来的那一瞬，新到的块淡入一次（CSS animation 只播一轮，
        滚动不触发、不重复、不回放）。标题与免责声明从骨架起就站在屏上
        （结构相同、内容相同），跟着重闪一遍会像页面坏了，所以排除在外。
      · 数字与图表本体永不动画；动的只是容器块的 opacity 与 6px 位移。 */
  const PAGE_CSS_ID = 'article-view-css';
  const PAGE_CSS = ''
    + '.fx-page > *{animation:fx-page-in var(--dur-3,580ms) var(--ease-out,cubic-bezier(.16,1,.3,1)) both;}'
    + '.fx-page > :nth-child(3){animation-delay:calc(var(--stagger,62ms) * 1);}'
    + '.fx-page > :nth-child(4){animation-delay:calc(var(--stagger,62ms) * 2);}'
    + '.fx-page > :nth-child(5){animation-delay:calc(var(--stagger,62ms) * 3);}'
    + '.fx-page > :nth-child(n+6){animation-delay:calc(var(--stagger,62ms) * 4);}'
    + '.fx-page.fx-body-in > .art-head,.fx-page.fx-body-in > .disclaimer{animation:none;}'
    + '@keyframes fx-page-in{from{opacity:0;transform:translate3d(0,12px,0);}}'
    + '@media (prefers-reduced-motion:reduce){.fx-page > *{animation:none;}}';

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

  /** 进场只切类名，动画全在 CSS。bodyIn = 这次 innerHTML 是「正文到达」的那一次。 */
  function fxEnter(view, bodyIn) {
    view.classList.add('fx-page');
    if (bodyIn) view.classList.add('fx-body-in');
    else view.classList.remove('fx-body-in');
  }

  const DISCLAIMER = (window.Site && window.Site.disclaimer)
    ? window.Site.disclaimer.ARTICLE
    : `<div class="disclaimer"><span>本文只讲机制和数据，不构成投资建议。</span></div>`;

  /** 页面标题：内容名 · 栏目 · 白话金融（各视图都按这个约定写 data-page-title） */
  function pageTitle(section, m) {
    const name = (m && m.title) || '';
    return name + ' · ' + (sectionName(section) || '白话金融') + ' · 白话金融';
  }

  function render(view, section, id) {
    ensureCss();
    // 标题、简介、阅读时长都在 index.json 里，先摆出来：读者不用等正文才知道自己在读哪篇
    const m = window.Content.meta(id);
    // 只认最后一次渲染：慢网下旧请求回来得晚，不能盖掉新页面
    const seq = (view.__artSeq || 0) + 1;
    view.__artSeq = seq;
    // 换页进场交给 layout.css 的 .route-host（整个容器一次淡入），骨架不另做动画
    view.innerHTML = skeleton(section, m, id);
    bindBookmark(view, id);

    return window.Content.ensureArticle(id).then((art) => {
      if (view.__artSeq !== seq) return;   // 已经切到别的页面了，这一篇别再画
      if (!art) {
        fxEnter(view, false);
        view.innerHTML = `<div class="empty"><div class="et">没找到这篇文章</div>
          <div class="ed">它可能还没写，或者链接变了。</div>
          <a class="btn ghost sm" href="#/">回首页</a></div>`;
        return;
      }
      fxEnter(view, true);         // 正文到达：只淡入新到的块，标题不再重播
      paint(view, section, art);
      bindBookmark(view, art.id || id);
      // 术语库若还在空闲档加载（site/content.js），词条锚点会先降级成纯文本；
      // 术语库一到就地补画这一次（正文在缓存里，只换词条标记，阅读位置不动）。
      if (window.Content.glossaryLoaded && !window.Content.glossaryLoaded() && window.Content.onGlossary) {
        window.Content.onGlossary(() => {
          if (view.isConnected && view.__artSeq === seq) {
            paint(view, section, art);
            bindBookmark(view, art.id || id);
          }
        });
      }
    });
  }

  /** 正文没到时的样子：结构跟真的一样，只是正文是骨架线 */
  function skeleton(section, m, id) {
    const title = (m && m.title) || id;
    return `
      <article class="art-head" data-page-title="${esc(pageTitle(section, m))}">
        <div class="eyebrow">${esc(sectionName(section))} ${m && m.difficulty ? '· 难度 ' + m.difficulty + '/5' : ''}</div>
        <h1>${esc(title)}</h1>
        ${m && m.dek ? `<p class="art-dek">${esc(m.dek)}</p>` : ''}
        <div class="art-meta">
          ${m && m.readMinutes ? `<span>阅读约 ${m.readMinutes} 分钟</span><span class="msep">·</span>` : ''}
          <span>本文写于 ${esc((m && m.dataAsOf) || '—')}</span>
          ${m && m.dataAsOfActual ? `<span class="msep">·</span><span>数据截至 ${esc(m.dataAsOfActual)}</span>` : ''}
          ${m && m.updatedAt ? `<span class="msep">·</span><span>更新于 ${esc(m.updatedAt)}</span>` : ''}
          <span class="msep">·</span>
          <button class="btn ghost sm" id="art-bookmark" style="height:24px;padding:0 8px;margin:-1px 0">${bookmarkLabel(id)}</button>
        </div>
      </article>
      ${DISCLAIMER}
      <div class="prose">
        <div class="skel" style="height:15px;width:92%"></div>
        <div class="skel" style="height:15px;width:86%;margin-top:12px"></div>
        <div class="skel" style="height:15px;width:90%;margin-top:12px"></div>
        <div class="skel" style="height:15px;width:64%;margin-top:12px"></div>
        <div class="skel" style="height:15px;width:88%;margin-top:24px"></div>
        <div class="skel" style="height:15px;width:78%;margin-top:12px"></div>
      </div>`;
  }

  /** 正文到了：整块画出来 */
  function paint(view, section, art) {
    const glossary = window.Content.glossary();
    let html = F().md(art.body || '');
    html = window.TermCard.markTerms(html, glossary);

    // 编译产物是扁平结构（{ id, title, dek, body, ... }）；保留对嵌套 meta 的兼容
    const m = art.meta || art;
    // related 里混着两种 id：文章 id 与术语 id。
    // 只查文章索引的话，术语型 related 会整块查不到——页面上「接着读」直接消失，还一声不响。
    // 所以先查文章，再查术语库，两边都没有才丢掉。
    const related = (m.related || [])
      .map((rid) => {
        const id = String(rid);
        const a = window.Content.meta(id);
        if (a) {
          return {
            href: `#/${a.section}/${a.id}`, title: a.title || id,
            dek: a.dek || '', min: a.readMinutes || null,
          };
        }
        const t = window.Content.term(id);
        if (t) {
          return {
            href: `#/term/${encodeURIComponent(id)}`, title: t.term || id,
            dek: t.one || '', min: null,
          };
        }
        return null;
      })
      .filter(Boolean);

    view.innerHTML = `
      <article class="art-head" data-page-title="${esc(pageTitle(section, m))}">
        <div class="eyebrow">${esc(sectionName(section))} ${m.difficulty ? '· 难度 ' + m.difficulty + '/5' : ''}</div>
        <h1>${esc(m.title || '')}</h1>
        ${m.dek ? `<p class="art-dek">${esc(m.dek)}</p>` : ''}
        <div class="art-meta">
          ${m.readMinutes ? `<span>阅读约 ${m.readMinutes} 分钟</span><span class="msep">·</span>` : ''}
          <span>本文写于 ${esc(m.dataAsOf || '—')}</span>
          ${m.dataAsOfActual ? `<span class="msep">·</span><span>数据截至 ${esc(m.dataAsOfActual)}</span>` : ''}
          ${m.updatedAt ? `<span class="msep">·</span><span>更新于 ${esc(m.updatedAt)}</span>` : ''}
          <span class="msep">·</span>
          <button class="btn ghost sm" id="art-bookmark" style="height:24px;padding:0 8px;margin:-1px 0">${bookmarkLabel(m.id)}</button>
        </div>
      </article>

      ${DISCLAIMER}

      ${(m.points && m.points.length) ? `
        <div class="panel" style="margin-bottom:var(--s-6);background:var(--sheet-2)">
          <div class="eyebrow" style="margin-bottom:10px">本文要点</div>
          <ol style="margin:0;padding-left:1.2em">
            ${m.points.map((p) => `<li style="margin-bottom:6px">${esc(p)}</li>`).join('')}
          </ol>
        </div>` : ''}

      <div class="prose">${html}</div>

      ${(m.tags && m.tags.length) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:var(--s-6)">
        ${m.tags.map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}

      ${related.length ? `
        <section style="margin-top:var(--s-7)">
          <div class="eyebrow">接着读</div>
          <div class="entries">
            ${related.map((c) => `<a class="entry" href="${esc(c.href)}">
              <span><span class="e-t">${esc(c.title)}</span><span class="e-d">${esc(c.dek || '')}</span></span>
              <span class="e-m">${c.min ? c.min + ' min' : ''}</span></a>`).join('')}
          </div>
        </section>` : ''}

      <section class="lens-only" style="margin-top:var(--s-7)">
        <div class="panel" style="display:flex;gap:var(--s-4);align-items:center;flex-wrap:wrap">
          <div style="flex:1 1 240px">
            <div class="eyebrow">想看此刻的行情</div>
            <p class="small muted" style="margin:0">这篇文章讲的是原理。想知道今天的价格和涨跌幅，去 OpenFinLens 看实时行情。</p>
          </div>
          <a class="btn ghost sm" ${(window.ACADEMY_SITE&&window.ACADEMY_SITE.lensUrl)||'https://5777-wq.github.io/openfinlens/'} target="_blank" rel="noopener">打开实时看板 ↗</a>
        </div>
      </section>`;

    if (window.Store.touchRead) window.Store.touchRead(m.id);
    else window.Store.pushRecent(m.id);
  }

  function bindBookmark(view, id) {
    const bm = document.getElementById('art-bookmark');
    if (!bm || bm.__bound) return;
    bm.__bound = true;   // 骨架和正文各画一次，别让同一个按钮挂两个监听
    bm.addEventListener('click', () => {
      const added = window.Store.toggleBookmark(id);
      bm.textContent = added ? '已收藏 ★' : '收藏';
      toast(added ? '已收藏' : '已取消收藏');
    });
  }

  function bookmarkLabel(id) {
    return window.Store.isBookmarked(id) ? '已收藏 ★' : '收藏';
  }

  function sectionName(section) {
    return ({
      concepts: '货币与利率', assets: '标的百科', crisis: '危机复盘',
      chains: '产业链图谱', cycles: '周期与镜鉴', family: '家庭理财',
    })[section] || '';
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('on'), 1800);
  }

  window.ArticleView = { render, toast, sectionName, pageTitle };
})();
