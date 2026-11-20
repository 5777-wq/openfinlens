/* views/tag.js —— 标签聚合页（#/tag/:tag）
   文章卡上的标签、文章页底部的标签，点进来就是这一页。
   它只做汇总，不新增任何数据：文章靠 index.json 的 tags，
   术语靠术语库的 词名 / 别名 / 关键词。

   匹配口径写清楚（这决定了读者看到的是「相关」还是「噪音」）：
   · 文章：tags 里**精确**命中（大小写不敏感）。「AI」只匹配标签写着 AI 的文章，
     不会把「OpenFinLens 里的 AI 助手」这种正文里提到的也算进来。
   · 术语：词名 / 别名 / 关键词里**含**这个标签。中文按子串匹配，
     ASCII 按词边界匹配（跟站内搜索 search.js 的 tokenHit 同一套规则）——
     否则「AI」会把关键词里带 "capital gains tax" 的词条全部捞进来，
     读者看到一堆跟 AI 无关的词，这个页面就没用了。
     复用搜索那套规则还有一个好处：同一个词在标签页和搜索页不会两处两个结果。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  const TERM_LIMIT = 30;

  /** 词元是否出现在文本里：ASCII 走词边界，中文走子串（与 views/search.js 一致） */
  function tokenHit(tok, text) {
    const t = String(tok || '').trim().toLowerCase();
    const s = String(text || '').toLowerCase();
    if (!t) return false;
    const BS = String.fromCharCode(92);
    const escRe = (x) => String(x).split('').map((ch) => '.*+?^${}()|[]'.indexOf(ch) >= 0 ? BS + ch : ch).join('');
    if (/^[a-z0-9.+-]+$/.test(t)) {
      if (new RegExp('(^|[^a-z0-9])' + escRe(t) + '([^a-z0-9]|$)').test(s)) return true;
      // 英文复数：tags 写 etfs、词条写 etf 时也得命中
      if (/s$/.test(t) && t.length > 2) {
        return new RegExp('(^|[^a-z0-9])' + escRe(t.slice(0, -1)) + '([^a-z0-9]|$)').test(s);
      }
      return false;
    }
    return s.indexOf(t) >= 0;
  }

  /** 一个标签在文章索引里的命中（精确、大小写不敏感） */
  function articlesOf(tag) {
    const want = String(tag || '').trim().toLowerCase();
    if (!want) return [];
    return (window.Content.list() || []).filter((a) => {
      const tags = Array.isArray(a && a.tags) ? a.tags : [];
      return tags.some((x) => String(x).trim().toLowerCase() === want);
    });
  }

  /** 术语是否被这个标签命中：返回命中强度（0 = 不命中；数字越小越靠前） */
  function termRank(t, tok) {
    const name = String(t.term || '');
    const alias = String(t.alias || '');
    const kw = Array.isArray(t.kw) ? t.kw : [];
    if (tokenHit(tok, name)) return 0;                       // 词名直接命中：最相关
    if (alias.split(/\s*\/\s*/).some((x) => tokenHit(tok, x))) return 1;   // 别名命中的一段
    if (kw.some((x) => tokenHit(tok, x))) return 2;           // 关键词命中：相关但可能宽泛
    return -1;
  }

  /** 术语命中，最多 limit 条（默认 30）。排序：词名 > 别名 > 关键词，同档按 id */
  function termsOf(tag, limit) {
    const tok = String(tag || '').trim();
    if (!tok) return [];
    const cap = (limit === undefined || limit === null) ? TERM_LIMIT : Number(limit);
    const max = isFinite(cap) && cap >= 0 ? cap : TERM_LIMIT;
    const g = window.Content.glossary() || {};
    const hits = [];
    Object.keys(g).forEach((id) => {
      const t = g[id] || {};
      const rank = termRank(t, tok);
      if (rank >= 0) hits.push({ id: id, t: t, rank: rank });
    });
    hits.sort((a, b) => (a.rank - b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return hits.slice(0, max).map((h) => Object.assign({ id: h.id }, h.t));
  }

  /** 展示用的标签写法：优先用内容里原本的大小写（tag 写 AI，页面就别显示 ai） */
  function displayTag(tag, arts) {
    const want = String(tag || '').trim().toLowerCase();
    for (let i = 0; i < arts.length; i++) {
      const tags = Array.isArray(arts[i].tags) ? arts[i].tags : [];
      for (let j = 0; j < tags.length; j++) {
        if (String(tags[j]).trim().toLowerCase() === want) return String(tags[j]);
      }
    }
    return String(tag || '').trim();
  }

  function articleRow(a) {
    const sec = String(a.section || '');
    const href = sec ? '#/' + sec + '/' + encodeURIComponent(String(a.id || '')) : '#/';
    return `<a class="entry" href="${esc(href)}">
      <span>
        <span class="e-t">${esc(a.title || a.id || '')}</span>
        <span class="e-d">${esc(a.dek || '')}</span>
      </span>
      <span class="e-m">${a.readMinutes ? a.readMinutes + ' min' : ''}</span>
    </a>`;
  }

  function termRow(t) {
    return `<a class="entry" href="#/term/${encodeURIComponent(String(t.id || ''))}">
      <span>
        <span class="e-t">${esc(t.term || t.id || '')}${t.alias ? ' <span class="small muted">' + esc(t.alias) + '</span>' : ''}</span>
        <span class="e-d">${esc(t.one || '')}</span>
      </span>
      <span class="e-m">看词条 →</span>
    </a>`;
  }

  function render(view, tag) {
    const raw = String(tag === undefined || tag === null ? '' : tag).trim();
    const arts = articlesOf(raw);
    const terms = termsOf(raw);
    const name = raw ? displayTag(raw, arts) : '';
    const total = arts.length + terms.length;

    if (!raw) {
      view.innerHTML = `<div class="art-head" data-page-title="标签 · 白话金融">
        <div class="eyebrow">标签</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">没有指定标签</h1>
      </div>
      <div class="empty">
        <div class="et">地址里少了标签名</div>
        <div class="ed">这一页的地址形如 <code>#/tag/AI</code>。你也可以从文章卡上的标签点进来，
          或者直接去术语库找一个词。</div>
        <a class="btn ghost sm" href="#/">回首页 →</a>
        <a class="btn ghost sm" href="#/terms" style="margin-left:var(--s-2)">去术语库 →</a>
      </div>`;
      return;
    }

    const head = `<div class="art-head" data-page-title="${esc('标签「' + name + '」')} · 白话金融">
      <div class="eyebrow">标签 · ${arts.length} 篇文章 · ${terms.length} 个术语${terms.length >= TERM_LIMIT ? '+' : ''}</div>
      <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">${esc(name)}</h1>
      <p class="art-dek">这个标签下有 ${arts.length} 篇文章、${terms.length} 个术语。
        文章是整篇讲这件事的（按文章的 tags 精确匹配）；术语是词名、别名或关键词里提到它的词条，
        点开就是四段式解释。两类都不是推荐，只是把同一件事的内容摆在一起。</p>
    </div>`;

    if (!total) {
      view.innerHTML = head + `<div class="empty">
        <div class="et">还没有内容打过「${esc(name)}」这个标签</div>
        <div class="ed">这个标签暂时没有对应的文章或词条。可能是打错了字，也可能是我们还没写到。
          去全站搜索里找找看，或者回术语库浏览。</div>
        <a class="btn ghost sm" href="#/search?q=${encodeURIComponent(raw)}">搜一下「${esc(name)}」→</a>
        <a class="btn ghost sm" href="#/terms" style="margin-left:var(--s-2)">去术语库 →</a>
        <a class="btn ghost sm" href="#/" style="margin-left:var(--s-2)">回首页 →</a>
      </div>`;
      return;
    }

    view.innerHTML = head + `
      <section style="margin-bottom:var(--s-7)">
        <div class="eyebrow" style="margin-bottom:var(--s-2)">文章 · ${arts.length} 篇</div>
        ${arts.length
          ? `<div class="entries">${arts.map(articleRow).join('')}</div>`
          : `<div class="empty"><div class="et">还没有文章用这个标签</div>
              <div class="ed">词条里有它，说明这是个真词；只是还没写到专门讲它的文章。</div>
              <a class="btn ghost sm" href="#/terms">去术语库 →</a></div>`}
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:var(--s-2)">术语 · ${terms.length} 个${terms.length >= TERM_LIMIT ? '（最多列 30 个）' : ''}</div>
        ${terms.length
          ? `<div class="entries">${terms.map(termRow).join('')}</div>
             ${terms.length >= TERM_LIMIT ? `<p class="small muted" style="margin-top:var(--s-2)">还有更多，去
               <a href="#/terms?q=${encodeURIComponent(raw)}">术语库按「${esc(name)}」过滤</a> 看全部。</p>` : ''}`
          : `<div class="empty"><div class="et">术语库里没有直接命中「${esc(name)}」的词</div>
              <div class="ed">这个词可能写在文章正文里，而不是词条里。
                <a href="#/search?q=${encodeURIComponent(raw)}">去全站搜索「${esc(name)}」</a> 看看文章和标的。</div></div>`}
      </section>`;
  }

  window.TagView = { render, articlesOf, termsOf, tokenHit, TERM_LIMIT };
})();
