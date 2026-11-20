/* components/term-drawer.js —— 术语抽屉（签名交互）
   读文章时遇到不懂的词，点一下右侧滑出解释，不离开当前阅读位置。

   抽屉是模态的：打开时背景要真的退出可聚焦序列（inert），
   Tab 要在抽屉里转圈，关闭时焦点要还给打开它的那个元素。
   只挂 aria-modal 是不够的——那只是给读屏的提示，浏览器不会把背景移出 Tab 序，
   键盘用户照样能 Tab 到被挡住的背景上去。 */
(function () {
  'use strict';

  let el, scrim, titleEl, bodyEl, footEl, lastFocus = null, onOpen = null;
  let bgInert = false;   // 背景当前是不是被我们挡住的：只在自己状态变化时才动，别把别人的也摘了

  const esc = (s) => window.Fmt.esc(s);

  // 背景上的顶层容器：抽屉打开时它们整体 inert，Tab 与点击都进不去
  const BG = ['.masthead', '.ticker', '.shell', '.tabbar'];

  /* ---- 动效样式（抽屉自带的一小块）----
     抽屉本体的滑入/滑出在 components.css 里（transform + visibility，随 .on 类切换），
     这里只补「内容的一次性进场」：抽屉滑进来的同时，词条做一小段同向淡入——
     回答「这东西从哪来」，而不是给面板装发动机。
     绑在 .drawer.on .drawer-body 上是有讲究的：
     · 开一次播一次（摘 .on 动画即取消，再开重播）；
     · 开着的时候重画内容（设置面板切开关会重走 show()）**不会重播**——
       .drawer-body 元素没换，动画状态还在，读者看到的是内容就地更新。
     只动 transform/opacity；时长/缓动引用全局变量并带兜底；
     prefers-reduced-motion 的关闭分支显式写在这里。 */
  function ensureMotionStyle() {
    try {
      if (document.getElementById('style-drawer-motion')) return;
      const s = document.createElement('style');
      s.id = 'style-drawer-motion';
      s.textContent = `
.drawer.on .drawer-body {
  animation: drawer-body-in var(--dur-2, 340ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
}
@keyframes drawer-body-in {
  from { opacity: 0; transform: translateX(14px); }
  to   { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .drawer.on .drawer-body { animation: none; }
}
`;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 注入不了就算了，抽屉照常工作 */ }
  }

  function init(opts) {
    ensureMotionStyle();
    el = document.getElementById('drawer');
    scrim = document.getElementById('scrim');
    titleEl = document.getElementById('drawer-title');
    bodyEl = document.getElementById('drawer-body');
    footEl = document.getElementById('drawer-foot');
    onOpen = (opts && opts.onOpen) || null;

    document.getElementById('drawer-close').addEventListener('click', close);
    scrim.addEventListener('click', close);

    // 抽屉关着的时候，它必须彻底退出可聚焦序列：
    // CSS 里是 visibility:hidden，这里再补一个 inert，并摘掉 role="dialog"——
    // 否则读屏会念出一个空的对话框。
    syncA11y();
    // 快捷键面板、站点设置也是直接加 .on 类打开的：用观察器跟着同步，别只盯着 open()
    if (typeof MutationObserver === 'function') {
      try { new MutationObserver(syncA11y).observe(el, { attributes: true, attributeFilter: ['class'] }); }
      catch (e) { /* 观察不了就算了，open()/close() 里也会同步 */ }
    }

    // 事件委托：正文里的术语锚点
    document.addEventListener('click', (e) => {
      /* 抽屉里的站内链接：先关抽屉，再让默认行为继续跳。
         以前不关——路由换了页，抽屉还盖在上面，body 也还是 overflow:hidden，
         读者看到的是「页面换了但被盖着，还不能滚」，焦点还掉到 body 上。
         这里只 close()，**不** preventDefault：跳转交给路由自己处理。 */
      const inner = e.target.closest && e.target.closest('#drawer-body a[href^="#/"]');
      if (inner) { close(); return; }

      // 复制链接：读者终于能把一个术语发给朋友
      const copyBtn = e.target.closest && e.target.closest('[data-copy-term]');
      if (copyBtn) {
        e.preventDefault();
        copyTermLink(copyBtn.getAttribute('data-copy-term'), copyBtn);
        return;
      }

      const ref = e.target.closest('[data-term]');
      if (!ref) return;
      e.preventDefault();
      open(ref.getAttribute('data-term'));
    });
    document.addEventListener('keydown', (e) => {
      // Tab 只在抽屉里转：焦点不能跑到被挡住的背景上去
      if (e.key === 'Tab' && isOpen()) { trapTab(el, e); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const ref = e.target.closest && e.target.closest('[data-term]');
      if (!ref) return;
      e.preventDefault();
      open(ref.getAttribute('data-term'));
    });
  }

  /** 开合状态 ↔ 无障碍属性：role="dialog" 只在打开时挂，关着就彻底不可聚焦 */
  function syncA11y() {
    if (!el) return;
    const open = el.classList.contains('on');
    if (open) {
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.removeAttribute('inert');
    } else {
      el.removeAttribute('role');
      el.removeAttribute('aria-modal');
      el.setAttribute('inert', '');
    }
    if (open !== bgInert) { bgInert = open; setBackgroundInert(open); }
  }

  /** 背景隔离：顶层容器整体 inert，键盘与读屏都进不去 */
  function setBackgroundInert(on) {
    BG.forEach((sel) => {
      document.querySelectorAll(sel).forEach((n) => {
        if (on) n.setAttribute('inert', '');
        else n.removeAttribute('inert');
      });
    });
  }

  /** 容器里能拿到焦点的元素（按 Tab 顺序） */
  function focusables(root) {
    if (!root || !root.querySelectorAll) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(root.querySelectorAll(sel));
  }

  /** Tab 在容器里循环：到头就绕回开头，Shift+Tab 反着来 */
  function trapTab(root, e) {
    const els = focusables(root);
    if (!els.length) { e.preventDefault(); return; }
    const i = els.indexOf(document.activeElement);
    let next;
    if (e.shiftKey) next = (i <= 0) ? els.length - 1 : i - 1;
    else next = (i < 0 || i === els.length - 1) ? 0 : i + 1;
    e.preventDefault();
    if (els[next] && els[next].focus) els[next].focus();
  }

  /** 术语抽屉 */
  function open(termId) {
    if (!el) return;
    const t = window.Content.term(termId);

    if (!t) {
      show({
        title: '术语',
        body: `<div class="empty">
        <div class="et">这个词还没有收录</div>
        <div class="ed">术语库正在补充中。如果你就是知道答案的人，欢迎提一个 Issue 或 PR 把它写进来。</div>
        <a class="btn ghost sm" href="https://github.com/5777-wq/openfin-academy/issues/new" target="_blank" rel="noopener">去补充这个词 →</a>
      </div>`,
        foot: '',
      });
    } else {
      show({
        title: t.term || termId,
        body: window.TermCard.render(t) + (t.links || []).map((l) => `
        <a class="entry" style="display:flex;gap:8px;padding:10px 0;border-bottom:1px solid var(--rule-2);color:var(--teal);font-size:13px" href="${esc(l.href)}">${esc(l.text)} →</a>`).join(''),
        foot: (t.source ? `<span>出处：${esc(t.source)}</span>` : `<span>本站编写的通俗解释</span>`)
          + `<button class="btn ghost sm" data-copy-term="${esc(termId)}" style="margin-left:auto">复制链接</button>`,
      });
    }
    if (onOpen) onOpen(termId);
  }

  /**
   * 打开抽屉的通用流程：快捷键面板、站点设置也走这里。
   * 记下是谁打开的（关闭时焦点要还回去）、把焦点搬进抽屉、把背景隔开。
   */
  function show(opts) {
    if (!el) return;
    const o = opts || {};
    // 已经开着的时候重画（设置面板切开关会重画）：焦点来源还是外面那个，
    // 别把抽屉里的按钮记成「打开它的那个元素」——抽屉一关，那个按钮就看不见了。
    const active = document.activeElement;
    const inside = !!(el.contains && active && el.contains(active));
    if (!inside) lastFocus = active;

    titleEl.textContent = o.title || '';
    bodyEl.innerHTML = o.body || '';
    footEl.innerHTML = o.foot || '';

    el.classList.add('on');
    scrim.classList.add('on');
    document.body.style.overflow = 'hidden';
    syncA11y();
    const closeBtn = document.getElementById('drawer-close');
    if (closeBtn && closeBtn.focus) closeBtn.focus();
  }

  function close() {
    if (!el) return;
    el.classList.remove('on');
    scrim.classList.remove('on');
    document.body.style.overflow = '';
    syncA11y();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* 忽略 */ } }
    lastFocus = null;
  }

  function isOpen() { return el && el.classList.contains('on'); }

  /** 复制词条链接：读者终于能把一个术语发给朋友。
      剪贴板不可用时退回选中法——总比什么都不做强。 */
  function copyTermLink(termId, btn) {
    const url = location.origin + location.pathname + '#/term/' + encodeURIComponent(termId);
    const done = (ok) => {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
      return;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      done(!!ok);
    } catch (e) { done(false); }
  }

  window.TermDrawer = { init, open, close, isOpen, openPanel: show };
})();
