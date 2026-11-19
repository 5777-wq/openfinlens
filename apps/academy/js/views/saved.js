/* views/saved.js —— 收藏夹（#/saved）
   这一页是全站唯一读 localStorage 里 bookmarks / recent / readAt 的地方。
   数据本来就在 store.js 里躺着：文章页点「收藏」会写 bookmarks，读完一篇会
   pushRecent 并写 readAt。以前没有任何页面把它们读回来，等于收藏了没处看。
   这里只做「读出来、排好、能取消」，不新增任何存储字段，也不上传任何东西。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  /** 栏目 id → 中文名（与 list.js / article.js 的写法保持一致） */
  const SECTION_NAME = {
    concepts: '货币与利率',
    crisis: '危机复盘',
    assets: '标的百科',
    chains: '产业链图谱',
    cycles: '周期与镜鉴',
    family: '家庭理财',
    reports: '读懂财报',
  };

  /** 文章 id → 站内地址。id 来自索引，仍按「只参与路径拼装前先编码」处理 */
  function hrefOf(meta) {
    const sec = String((meta && meta.section) || '');
    const id = String((meta && meta.id) || '');
    if (!sec || !id) return '';
    return '#/' + sec + '/' + encodeURIComponent(id);
  }

  function sectionOf(meta) {
    const sec = String((meta && meta.section) || '');
    return SECTION_NAME[sec] || String((meta && meta.tag) || '');
  }

  /**
   * 阅读时间 → 相对时间：今天 / 昨天 / N 天前。
   * 按**自然日**算，不是按 24 小时：晚上 23:50 读的，第二天早上就该显示「昨天」。
   * 时间戳缺失或非法时返回空串——宁可这一行不显示，也不编一个时间。
   */
  function relTime(ts, now) {
    const t = Number(ts);
    if (!t || !isFinite(t)) return '';
    const a = new Date(t);
    const b = new Date(now === undefined || now === null ? Date.now() : Number(now));
    if (isNaN(a) || isNaN(b)) return '';
    const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    const days = Math.round((d1 - d0) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    return days + ' 天前';
  }

  /** 收藏的一行：整行可点（<a>），「取消收藏」按钮在 <a> **外面**——
      链接里套按钮是无效 HTML，键盘与读屏会把它当成两个可点的玩意儿。 */
  function bookmarkRow(meta, i) {
    const title = String(meta.title || meta.id || '');
    return `<div class="sv-row" style="display:flex;align-items:center;gap:var(--s-3);border-bottom:1px solid var(--rule-2)">
      <a class="entry" href="${esc(hrefOf(meta))}" style="flex:1 1 auto;min-width:0;border-bottom:0">
        <span>
          <span class="e-t">${esc(title)}</span>
          <span class="e-d">${esc(sectionOf(meta))}</span>
        </span>
        <span class="e-m">${meta.readMinutes ? meta.readMinutes + ' min' : ''}</span>
      </a>
      <button type="button" class="btn ghost sm" id="saved-unbookmark-${i}" data-id="${esc(meta.id)}"
        aria-label="取消收藏「${esc(title)}」">取消收藏</button>
    </div>`;
  }

  /** 最近阅读的一行：整行就是链接，右栏显示相对时间 */
  function recentRow(meta, at) {
    const title = String(meta.title || meta.id || '');
    return `<a class="entry" href="${esc(hrefOf(meta))}">
      <span>
        <span class="e-t">${esc(title)}</span>
        <span class="e-d">${esc(sectionOf(meta))}</span>
      </span>
      <span class="e-m">${esc(relTime(at))}</span>
    </a>`;
  }

  const EMPTY_BOOKMARKS = `<div class="empty">
    <div class="et">还没有收藏</div>
    <div class="ed">读到一篇想留着的文章，点标题下面的「收藏」，它就会排在这里。
      顺序按你收藏的先后，最新的在最上面。收藏只存在你自己这台设备的浏览器里，不上传、不同步。</div>
    <a class="btn ghost sm" href="#/">去首页读一篇 →</a>
    <a class="btn ghost sm" href="#/terms" style="margin-left:var(--s-2)">先去术语库查个词 →</a>
  </div>`;

  const EMPTY_RECENT = `<div class="empty">
    <div class="et">还没有阅读记录</div>
    <div class="ed">读过的文章会按时间排在这里，方便下次接着读。
      记录同样只存在你自己的浏览器里，清掉浏览器数据就没了。</div>
    <a class="btn ghost sm" href="#/">去首页读一篇 →</a>
    <a class="btn ghost sm" href="#/terms" style="margin-left:var(--s-2)">先去术语库查个词 →</a>
  </div>`;

  /** 收藏顺序原样保留；索引里查不到的 id（文章改名 / 删了）单独数出来，不假装它还在 */
  function bookmarked(bm) {
    const rows = [];
    let missing = 0;
    (Array.isArray(bm) ? bm : []).forEach((id) => {
      const m = window.Content.meta(id);
      if (m) rows.push(m); else missing++;
    });
    return { rows: rows, missing: missing };
  }

  function recentList() {
    const recent = window.Store.get('recent');
    const readAt = window.Store.get('readAt') || {};
    const rows = [];
    (Array.isArray(recent) ? recent : []).forEach((id) => {
      const m = window.Content.meta(id);
      if (m) rows.push({ meta: m, at: readAt[id] });
    });
    return rows;
  }

  function bindUnbookmark(view, query, ids) {
    for (let i = 0; i < ids.length; i++) {
      const btn = view.querySelector('#saved-unbookmark-' + i);
      if (!btn) continue;
      const id = ids[i];
      btn.addEventListener('click', () => {
        window.Store.toggleBookmark(id);
        render(view, query);   // 原地重绘：不跳页、不改地址
        // 重绘会换掉按钮节点，焦点得还给列表，否则键盘用户直接掉回页面顶部
        const list = view.querySelector('#saved-list');
        if (list && typeof list.focus === 'function') {
          try { list.focus({ preventScroll: true }); } catch (e) { try { list.focus(); } catch (e2) { /* 拿不到焦点不影响功能 */ } }
        }
      });
    }
  }

  function render(view, query) {
    const bm = window.Store.get('bookmarks');
    const marked = bookmarked(bm);
    const recent = recentList();

    const bmRows = marked.rows.map(bookmarkRow).join('');
    const recentRows = recent.map((r) => recentRow(r.meta, r.at)).join('');

    view.innerHTML = `
      <div class="art-head" data-page-title="收藏与最近阅读 · 白话金融">
        <div class="eyebrow">我的书架 · 只存在本机</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">收藏与最近阅读</h1>
        <p class="art-dek">收藏按你先后的顺序排；最近阅读按时间倒序，右边写着你是什么时候读的。
          这两份记录都只存在这台设备的浏览器里——没有账号、不上传、换台设备就看不到。</p>
      </div>

      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}

      <section style="margin-bottom:var(--s-7)">
        <div class="eyebrow" style="margin-bottom:var(--s-2)">收藏 · ${marked.rows.length} 篇</div>
        <div id="saved-list" tabindex="-1" style="outline:none">${bmRows || EMPTY_BOOKMARKS}</div>
        ${marked.missing ? `<p class="small muted" style="margin-top:var(--s-2)">另有 ${marked.missing} 条收藏在内容索引里找不到了（文章可能改过名或下架），已隐藏。</p>` : ''}
      </section>

      <section>
        <div class="eyebrow" style="margin-bottom:var(--s-2)">最近阅读 · ${recent.length} 篇</div>
        <div class="entries" id="saved-recent">${recentRows || EMPTY_RECENT}</div>
      </section>`;

    bindUnbookmark(view, query, marked.rows.map((m) => m.id));
  }

  window.SavedView = { render, relTime, sectionOf };
})();
