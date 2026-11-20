/* views/path.js —— 新手路径：8 课，把基础打完 */
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

  function ensureEntryCss() {
    try {
      if (document.getElementById(ENTRY_CSS_ID)) return;
      const st = document.createElement('style');
      st.id = ENTRY_CSS_ID;
      st.textContent = ENTRY_CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 注入不了就算了——动效是增强，不是功能 */ }
  }

  /** 这课会把你带到哪儿：把 target 变成读者看得懂的几个字。
      点进去之前就知道会看到什么——路径里不做假入口。 */
  function targetLabel(target) {
    const t = String(target || '');
    const m = /^#\/term\/(.+)$/.exec(t);
    if (m) {
      const term = window.Content.term(decodeURIComponent(m[1]));
      return term ? (term.term || '') : '';
    }
    const a = /^#\/([^/]+)\/([^/]+)$/.exec(t);
    if (a) {
      const art = window.Content.meta(a[2]);
      return art ? (art.title || '') : '';
    }
    return '';
  }

  function render(view) {
    ensureEntryCss();
    const plan = window.Content.pathPlan();
    if (!plan || !plan.lessons || !plan.lessons.length) {
      view.innerHTML = `<div class="empty"><div class="et">路径正在编排</div>
        <div class="ed">新手路径是本站的主线之一，内容还在写。</div></div>`;
      return;
    }

    const done = plan.lessons.filter((l) => window.Store.isDone(l.id)).length;
    const pct = Math.round((done / plan.lessons.length) * 100);

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">新手路径 · ${plan.lessons.length} 课 · 约 ${plan.totalMinutes || 0} 分钟</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">${esc(plan.title || '从零开始')}</h1>
        <p class="art-dek">${esc(plan.dek || '')}</p>
      </div>

      <div class="panel" style="margin-bottom:var(--s-6)">
        <div style="display:flex;align-items:baseline;gap:var(--s-3);margin-bottom:10px">
          <span class="num" style="font-size:24px;color:var(--gold)">${done}<span class="muted" style="font-size:14px">/${plan.lessons.length}</span></span>
          <span class="small muted">课已完成</span>
          <span class="small muted" style="margin-left:auto">${pct}%</span>
        </div>
        <div class="meter gold"><i style="width:${pct}%"></i></div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-3)">
          <a class="btn ghost sm" href="#/quiz">自测 5 题 →</a>
          <a class="btn ghost sm" href="#/saved">收藏与阅读记录 →</a>
        </div>
      </div>

      <div class="entries">
        ${plan.lessons.map((l, i) => {
          const ok = window.Store.isDone(l.id);
          const target = l.target || '';
          const label = targetLabel(target);
          const title = esc(l.title);

          // 整行都是链接。以前这里是个 <div class="entry">：读者点哪一课都没反应，
          // 唯一能点的是左边那个打勾圆圈——一圈点完，还以为自己把课学完了。
          const body = `<span>
              <span class="e-t">${title}</span>
              <span class="e-d">${esc(l.dek || '')}</span>
            </span>
            <span class="e-m">${l.minutes ? l.minutes + ' min' : ''}${label ? ' · ' + esc(label) : ''} →</span>`;

          return `<div class="lesson${ok ? ' done' : ''}">
            <button class="btn ghost sm lesson-check" type="button" data-lesson="${esc(l.id)}"
              aria-pressed="${ok ? 'true' : 'false'}"
              aria-label="${ok ? '取消「' + title + '」的已学标记' : '把「' + title + '」标记为已学'}">
              ${ok ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>' : '<span class="num" style="font-size:11px">' + (i + 1) + '</span>'}
            </button>
            ${target
              ? `<a class="entry" href="${esc(target)}">${body}</a>`
              : `<div class="entry">${body}<span class="e-m">这一课还没写</span></div>`}
          </div>`;
        }).join('')}
      </div>`;

    view.querySelectorAll('[data-lesson]').forEach((b) => {
      b.addEventListener('click', (e) => {
        // 打勾是状态按钮，不是导航：点了不能带着整行跳走
        e.preventDefault();
        e.stopPropagation();
        const id = b.getAttribute('data-lesson');
        const now = !window.Store.isDone(id);
        window.Store.setDone(id, now);
        render(view);
      });
    });
  }

  window.PathView = { render, targetLabel };
})();
