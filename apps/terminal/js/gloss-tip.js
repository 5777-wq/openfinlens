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

  /** 能不能出这个浮层：
      鼠标设备（hover:hover）——悬停「?」即出；
      触屏设备（pointer:coarse）——点「?」即出（tap 会带一次 mouseover）；
      两样都没有（比如纯键盘）——不启用。 */
  function canHover() {
    try {
      if (!window.matchMedia) return true;
      return window.matchMedia('(hover: hover)').matches
        || window.matchMedia('(pointer: coarse)').matches;
    } catch (e) { return true; }
  }

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'gloss-tip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'glossTip';
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

    /* 名字挂在**祖先行**上，不在「?」按钮自己身上：
       因子 ETF 持仓行是 <div class="srow" data-etfname="苹果">…<button class="ask" data-ask="usAAPL">?</button></div>，
       基金持股变动行用的是 data-fundname。getAttribute 只看自己、不查祖先，
       只在按钮上取，domName 恒为空 → OpenFinMeta 又查不到 → 整个浮层出不来
       （2026-10-22 修：77 只成分股里 70 只的「?」当时完全没反应）。 */
    const row = hit.host.closest ? hit.host.closest('[data-etfname],[data-fundname]') : null;
    const domName = (row && (row.getAttribute('data-etfname') || row.getAttribute('data-fundname'))) || '';

    // 名字优先用行情（data-ask 对应的 symbol 在行情表里的名字），行情里没有再退到行上的名字
    let meta = window.OpenFinMeta ? window.OpenFinMeta.of(hit.symbol) : null;
    if (!meta) {
      meta = { symbol: hit.symbol, market: marketByPrefix(hit.symbol), name: '', code: '' };
    }
    if (!meta.name) meta.name = domName;
    if (!meta.name) return null;

    const ex = window.Explain ? window.Explain.of(meta) : null;
    if (!ex || !ex.text) return null;

    const target = window.AcademyGloss
      ? window.AcademyGloss.targetFor(hit.symbol, meta.name)
      : null;
    /* 没有可信的科普站去处时（那边会拒给"搜不到的词"，免得给一条必然扑空的死路），
       解释照给，只是不带链接——「这是什么」是本站的静态知识，与科普站有没有这一页无关；
       反过来，链接没有就不给，不硬凑一条死路。 */
    if (!target) return { text: ex.text, href: '', label: '' };

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
      + `<span class="gt-text" id="glossTipText">${esc(info.text)}</span>`
      + (info.href ? `<a class="gt-link" href="${esc(info.href)}" target="_blank" rel="noopener">${esc(info.label)}</a>` : '');
    t.style.display = 'block';

    /* 关联触发器与浮层：原来只设了 role=tooltip，没给触发器写 aria-describedby，
       读屏用户在「?」上聚焦时听不到这段解释。 */
    if (el && el.setAttribute && el.getAttribute) {
      const prev = el.getAttribute('aria-describedby');
      if (!prev) el.setAttribute('aria-describedby', 'glossTipText');
      else if (prev.split(/\s+/).indexOf('glossTipText') < 0) el.setAttribute('aria-describedby', prev + ' glossTipText');
    }

    // 贴着鼠标放，靠边时翻到另一侧
    const r = t.getBoundingClientRect();
    let left = x + 18, top = y + 20;
    if (left + r.width > window.innerWidth - 12) left = x - r.width - 18;
    if (top + r.height > window.innerHeight - 12) top = Math.max(8, y - r.height - 14);
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, top) + 'px';
    return true;
  }

  function hide(force) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!force) {
      // 焦点已经进到浮层里（键盘用户按了 Enter）就先别收，否则链接会被抽走
      const act = document.activeElement;
      if (tip && act && tip.contains && tip.contains(act)) return;
    }
    if (current && current.removeAttribute) {
      const prev = current.getAttribute('aria-describedby');
      if (prev) {
        const rest = prev.split(/\s+/).filter(x => x && x !== 'glossTipText');
        if (rest.length) current.setAttribute('aria-describedby', rest.join(' '));
        else current.removeAttribute('aria-describedby');
      }
    }
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
    window.addEventListener('scroll', () => hide(true), true);
    window.addEventListener('blur', () => hide(true));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const act = document.activeElement;
      const inTip = !!(tip && act && tip.contains && tip.contains(act));
      const back = current;
      hide(true);
      // 焦点在浮层里被收走了：还给触发器，别让键盘用户掉在空处
      if (inTip && back && back.focus) { try { back.focus(); } catch (err) { /* 忽略 */ } }
    });

    /* 键盘：Tab 到「?」或概念标记上也要给解释 */
    document.addEventListener('focusin', (e) => {
      const hit = pick(e.target);
      if (!hit) return;
      const r = hit.host.getBoundingClientRect();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      current = hit.host;
      show(hit.host, r.left + 10, r.bottom + 8);
    });
    document.addEventListener('focusout', (e) => {
      // 焦点移进浮层（键盘用户按了 Enter 去看科普链接）时别收
      if (tip && e.relatedTarget && tip.contains && tip.contains(e.relatedTarget)) return;
      if (current) scheduleHide();
    });

    /* 键盘拿得到浮层里的链接。
       浮层挂在 body 末尾，Tab 序在最后——从「?」按钮 Tab 过去要穿过整页，
       键盘用户根本够不到那条科普链接。所以焦点在触发器上按 Enter 时，
       把焦点直接送进浮层里的链接；Esc 再退回触发器。 */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (!current || !tip) return;
      // 只有焦点真的在触发器上时才送进浮层：current 在鼠标悬停时也会被设上
      const act = document.activeElement;
      if (!act || (act !== current && !(current.contains && current.contains(act)))) return;
      const link = tip.querySelector && tip.querySelector('.gt-link');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      link.focus();
    });
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
