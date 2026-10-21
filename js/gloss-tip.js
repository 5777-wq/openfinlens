/* gloss-tip.js —— 悬停「这是什么」+ 跳科普站
   鼠标靠近任意标的行、指数格、涨跌榜条目，浮出一条小解释；
   下面挂一条去「白话金融 OpenFin Academy」读完整解释的入口。

   为什么要有这一层：终端是给"已经知道自己在看什么"的人用的。
   遇到看不懂的词，不该在终端里猜——那就去科普站把它讲清楚。

   说明：解释文案全部取自本站已有的 explain.js（纯静态知识），
   本模块不产生任何网络请求，也不新增任何行情或解释数据。 */
(function () {
  'use strict';

  const SELECTOR = '[data-symbol],[data-mv],[data-etfsym],[data-fundsym],[data-gidx],[data-gloss]';
  const ATTRS = ['data-symbol', 'data-mv', 'data-etfsym', 'data-fundsym', 'data-gidx', 'data-gloss'];
  const HIDE_DELAY = 240;

  let tip = null, hideTimer = null, current = null;

  const esc = (s) => (window.U && window.U.escapeHTML
    ? window.U.escapeHTML(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function canHover() {
    try { return !window.matchMedia || window.matchMedia('(hover: hover)').matches; }
    catch (e) { return true; }
  }

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'gloss-tip';
    tip.setAttribute('role', 'tooltip');
    tip.style.display = 'none';
    document.body.appendChild(tip);
    // 鼠标移进浮层时不要马上收走——里面的链接要能点
    tip.addEventListener('mouseenter', () => { if (hideTimer) clearTimeout(hideTimer); });
    tip.addEventListener('mouseleave', scheduleHide);
    return tip;
  }

  /** symbol 前缀 → 市场分类（只在元数据查不到时兜底） */
  function marketByPrefix(symbol) {
    const s = String(symbol || '');
    if (/^EM:/.test(s)) {
      const sec = s.slice(3);
      if (/^(1|0)\./.test(sec)) return 'cn';
      if (/^116\./.test(sec)) return 'hk';
      if (/^(105|106|107)\./.test(sec)) return 'us';
      if (/^100\./.test(sec)) return 'index';
      if (/^(101|102|103)\./.test(sec)) return 'commodity';
      if (/^171\./.test(sec)) return 'macro';
      if (/^119\./.test(sec)) return 'fx';
      return 'other';
    }
    if (/^(sh|sz|bj)/.test(s)) return 'cn';
    if (/^hk/.test(s)) return 'hk';
    if (/^us/.test(s)) return 'us';
    if (/USDT$/.test(s)) return 'crypto';
    return '';
  }

  /** 找到最近的那个带标识的元素 */
  function pick(el) {
    if (!el || !el.closest) return null;
    const host = el.closest(SELECTOR);
    if (!host) return null;
    // 行内的按钮（自选星标等）不触发，免得盖住它自己的提示
    if (el.closest('button[data-star]')) return null;
    const name = ATTRS.find((a) => host.hasAttribute(a));
    if (!name) return null;
    let symbol = host.getAttribute(name) || '';
    // 全球指数卡片存的是 secid（100.N225），行情层的 symbol 是 'EM:100.N225'
    if (name === 'data-gidx') symbol = 'EM:' + symbol;
    return { host, name, symbol, isConcept: name === 'data-gloss' };
  }

  /** 概念标记（data-gloss）：解释来自 explain.js 的 CONCEPT_NOTES，链接直接进科普站术语页 */
  function resolveConcept(id) {
    const notes = window.Explain && window.Explain.CONCEPT_NOTES;
    const text = notes && notes[id];
    if (!text) return null;
    const base = window.AcademyGloss ? window.AcademyGloss.BASE : '';
    if (!base) return null;
    return {
      text,
      href: base + '#/term/' + encodeURIComponent(id) + '?from=lens',
      label: '在白话金融里看完整解释 ↗',
    };
  }

  /** 解析出「一句话解释 + 去科普站的入口」 */
  function resolve(el) {
    const hit = pick(el);
    if (!hit || !hit.symbol) return null;
    if (hit.isConcept) return resolveConcept(hit.symbol);

    const domName = hit.host.getAttribute('data-etfname')
      || hit.host.getAttribute('data-fundname') || '';

    let meta = window.OpenFinMeta ? window.OpenFinMeta.of(hit.symbol) : null;
    if (!meta) {
      meta = { symbol: hit.symbol, market: marketByPrefix(hit.symbol), name: domName, code: '' };
    }
    if (!meta.name) meta.name = domName;
    if (!meta.name) return null;

    const ex = window.Explain ? window.Explain.of(meta) : null;
    if (!ex || !ex.text) return null;

    const target = window.AcademyGloss
      ? window.AcademyGloss.targetFor(hit.symbol, meta.name)
      : null;
    if (!target) return null;

    // 带上来源与这只标的：科普站那边能给出"去看历史数据"和"回到 OpenFinLens"
    const sep = target.href.indexOf('?') >= 0 ? '&' : '?';
    const href = target.href + sep + 'from=lens&sym=' + encodeURIComponent(hit.symbol);

    return { text: ex.text, href, label: target.label };
  }

  function show(el, x, y) {
    const info = resolve(el);
    if (!info) return false;
    const t = ensureTip();
    t.innerHTML = `<span class="gt-kind">这是什么</span>`
      + `<span class="gt-text">${esc(info.text)}</span>`
      + `<a class="gt-link" href="${esc(info.href)}" target="_blank" rel="noopener">${esc(info.label)}</a>`;
    t.style.display = 'block';

    // 贴着鼠标放，靠边时翻到另一侧
    const r = t.getBoundingClientRect();
    let left = x + 18, top = y + 20;
    if (left + r.width > window.innerWidth - 12) left = x - r.width - 18;
    if (top + r.height > window.innerHeight - 12) top = Math.max(8, y - r.height - 14);
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
    return true;
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (tip) tip.style.display = 'none';
    current = null;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY);
  }

  function init() {
    if (!canHover()) return;

    document.addEventListener('mouseover', (e) => {
      if (tip && tip.contains(e.target)) return;   // 浮层自己，别收
      const host = e.target.closest ? e.target.closest(SELECTOR) : null;
      if (!host) {
        if (current) scheduleHide();
        return;
      }
      if (host === current) return;                 // 同一个目标不重画
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      current = host;
      if (!show(host, e.clientX, e.clientY)) {
        current = null;
        hide();
      }
    }, { passive: true });

    // 页面滚动了，浮层的位置就过期了
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    // 键盘：Tab 到带 data-gloss 的元素上也要给解释（只标了 data-gloss 的概念才提示）
    document.addEventListener('focusin', (e) => {
      const host = e.target && e.target.closest ? e.target.closest('[data-gloss]') : null;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      current = host;
      show(host, r.left + 10, r.bottom + 8);
    });
    document.addEventListener('focusout', () => { if (current) scheduleHide(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.GlossTip = { show, hide };
})();
