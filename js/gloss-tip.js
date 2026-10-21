/* gloss-tip.js —— 悬停「这是什么」+ 跳科普站
   鼠标靠近任意标的行、指数格、涨跌榜条目，浮出一条小解释；
   下面挂一条去「白话金融 OpenFin Academy」读完整解释的入口。

   为什么要有这一层：终端是给"已经知道自己在看什么"的人用的。
   遇到看不懂的词，不该在终端里猜——那就去科普站把它讲清楚。

   说明：解释文案全部取自本站已有的 explain.js（纯静态知识），
   本模块不产生任何网络请求，也不新增任何行情或解释数据。 */
(function () {
  'use strict';

  const HIDE_DELAY = 240;

  let tip = null, hideTimer = null, current = null, enabled = true;

  /** 设置里可以关掉科普入口（默认开） */
  function academyOn() {
    try {
      if (window.AcademyGate) return window.AcademyGate.isOn();
      const s = window.Store && window.Store.settings ? window.Store.settings.get() : null;
      return s ? s.academy !== false : true;
    } catch (e) { return true; }
  }

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

  /** 找到最近的那个带标识的元素
      · data-ask  = 行情行上的「?」（symbol）——解释只在它上面浮出
      · data-gloss = 概念标记（术语 id）——标题/指标卡上悬停即出 */
  function pick(el) {
    if (!el || !el.closest) return null;
    const ask = el.closest('[data-ask]');
    if (ask) {
      const sym = ask.getAttribute('data-ask') || '';
      return sym ? { host: ask, symbol: sym, isConcept: false } : null;
    }
    const gl = el.closest('[data-gloss]');
    if (gl) {
      const id = gl.getAttribute('data-gloss') || '';
      return id ? { host: gl, symbol: id, isConcept: true } : null;
    }
    return null;
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
    enabled = academyOn();

    document.addEventListener('mouseover', (e) => {
      if (!enabled) return;
      if (tip && tip.contains(e.target)) return;   // 浮层自己，别收
      const hit = pick(e.target);
      if (!hit) {
        if (current) scheduleHide();
        return;
      }
      if (hit.host === current) return;            // 同一个目标不重画
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      current = hit.host;
      if (!show(hit.host, e.clientX, e.clientY)) {
        current = null;
        hide();
      }
    }, { passive: true });

    // 页面滚动了，浮层的位置就过期了
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

    // 键盘：Tab 到「?」或概念标记上也要给解释
    document.addEventListener('focusin', (e) => {
      const hit = pick(e.target);
      if (!hit) return;
      const r = hit.host.getBoundingClientRect();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      current = hit.host;
      show(hit.host, r.left + 10, r.bottom + 8);
    });
    document.addEventListener('focusout', () => { if (current) scheduleHide(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /** 设置里开关生效：关掉就收走浮层（顶栏链接与详情页链接由 app.js 同步） */
  function apply(on) {
    enabled = !!on;
    if (!enabled) hide();
  }

  window.GlossTip = { show, hide, apply, academyOn };
})();
