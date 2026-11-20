/* js/ui/motion.js —— 动效层运行时（Telegram-iOS 手感，零依赖）
 *
 * 契约：docs/UI-V2-SPEC.md §2「动效规格」；曲线/时长令牌在 css/style.css :root，
 *       样式在 css/ui/04-motion.css。本文件只负责"什么时候播"，不负责"长什么样"。
 *
 * 为什么需要 JS（CSS 已经能覆盖大半）：
 *   ① 触屏滚动时 :active 不一定触发（Chrome 的 tap-delay 逻辑），补一版 60ms 高亮；
 *   ② 浮层的 transform-origin 要指向"从哪儿点开的"——只有运行时知道触发点；
 *   ③ 数字滚动要保留旧值 —— 主节点文本必须即时更新（读屏与复制拿到新值），
 *      旧值只能是一层绝对定位的副本，这件事 CSS 做不到；
 *   ④ 列表错峰要知道"哪一批是同一批新增的"，只有 MutationObserver 知道；
 *   ⑤ 一级 tab 指示器要量当前按钮的几何（transform 的 x/scaleX）。
 *
 * 铁律（与 SPEC §2 一致）：
 *   · 只动 transform / opacity / color / background-color（外加按压蒙版用的 inset 阴影）；
 *   · 不用 scroll 事件驱动动画（scroll 只用来"取消"按压，passive）；
 *   · MutationObserver 全部进 rAF 批处理，单帧工作量封顶；
 *   · 同一个节点不重复绑定（dataset 守卫），脚本重复执行不叠加（window 守卫）；
 *   · prefers-reduced-motion: reduce 下：不挂按压 JS、不滚数字、不错峰、不滚动进入、不 View Transition。
 *
 * 挂载：index.html 末尾 <script defer src="js/ui/motion.js"></script>。
 * 不依赖 app.js 的初始化顺序：readyState 判断 + setTimeout(0) + 观察者兜底。
 */
(function () {
  'use strict';

  /* ---------- 幂等守卫：重复执行直接返回（不叠监听器/不建第二个指示器） ---------- */
  if (window.__oflMotion) return;
  window.__oflMotion = true;
  var doc = document;
  var root = doc.documentElement;
  if (root.dataset.motionReady) return;
  root.dataset.motionReady = '1';

  /* ---------- 缓动常量：与 css 令牌同值（WAAPI 拿不到 CSS 变量，这里对齐一份） ---------- */
  var EASE = {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    panel: 'cubic-bezier(0.22, 1.12, 0.36, 1)',
    signature: 'cubic-bezier(0.38, 0.7, 0.125, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)'
  };
  var DUR = { d1: 120, d2: 200, d3: 300, d4: 420 };

  /* ---------- 基础工具 ---------- */
  var raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function (fn) { return setTimeout(fn, 16); };
  function closest(el, sel) {
    if (!el || el.nodeType !== 1 || !el.closest) return null;
    return el.closest(sel);
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.02;
  }
  function num(s) {
    var v = parseFloat(String(s).replace(/[^0-9eE+.\-]/g, ''));
    return isFinite(v) ? v : null;
  }

  /* ---------- 减动效：所有位移/弹簧/错峰/数字滚动在 reduce 下关闭 ---------- */
  var reduce = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduce = !!mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', function (e) { reduce = !!e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { reduce = !!e.matches; });
  } catch (e) { /* 老浏览器：当作不减弱 */ }

  /* 最近一次指针位置与触发元素：浮层的 transform-origin 从这里"长出来"。
     只记坐标不够——键盘打开（回车/空格）没有指针，就退回到"最后获得焦点的那颗按钮"。 */
  var lastX = null, lastY = null;
  var lastTrigger = null;

  function noteTrigger(el) {
    lastTrigger = (el && el.nodeType === 1) ? el : null;   // 点空白处 = 清空，别留上一颗按钮
  }

  /* ==================================================================== 1. 按压
     鼠标交给 CSS :active（零延迟、零 JS）。这里只补触屏：
     pointerdown 后 60ms 仍按住 → 加 .is-press（滚动时 :active 常不触发）；
     移出 10px / 抬起 / 取消 / 滚动 / 长按菜单 → 立刻摘掉（长按取消）。 */
  var PRESS_SEL = 'button,[role="button"],.pressable,.tab,.pill,.chip,.bchip,' +
    '.qrow,.crow,.srow,.row,.sr-item,.icon-btn,.ask,.seg button,.ma-menu label,' +
    '.opt-row,.prow,.gcard,.link-node,.av-cell,.pm-tab,.pm-card,.wcard,.event-item,.news-item';

  function initPress() {
    if (reduce) return;
    var timer = 0, cur = null, sx = 0, sy = 0;

    function drop() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (cur) { cur.classList.remove('is-press'); cur = null; }
    }
    function onDown(e) {
      lastX = e.clientX; lastY = e.clientY;
      noteTrigger(closest(e.target, 'button,[role="button"],.pressable,.tab,.pill,.nav-primary,.icon-btn'));
      if (e.pointerType === 'mouse') return;              // 鼠标：CSS :active 足够
      var el = closest(e.target, PRESS_SEL);
      if (!el || el.hasAttribute('data-no-press') || el.hasAttribute('disabled')) return;
      drop();
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(function () {
        timer = 0;
        cur = el;
        el.classList.add('is-press');
      }, 60);
    }
    function onMove(e) {
      if (!timer && !cur) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) drop();
    }

    window.addEventListener('pointerdown', onDown, { passive: true, capture: true });
    window.addEventListener('pointermove', onMove, { passive: true, capture: true });
    window.addEventListener('pointerup', drop, { passive: true, capture: true });
    window.addEventListener('pointercancel', drop, { passive: true, capture: true });
    doc.addEventListener('pointerleave', drop, { passive: true });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      noteTrigger(doc.activeElement);
    }, { passive: true, capture: true });
    window.addEventListener('blur', drop);
    window.addEventListener('scroll', drop, { passive: true, capture: true });
    window.addEventListener('contextmenu', drop, { passive: true, capture: true });
  }

  /* ==================================================================== 2. 浮层
     开关方式有两种，JS 只做两件事：
     ① 出现时把 transform-origin 指到触发点（从哪儿点开就从哪儿长）；
     ② class 关闭时补一个 .is-closing（退出动画，animationend/超时后摘掉）。
     hidden / style.display 开关的浮层由 CSS @keyframes 负责（display 变化不触发 transition）。 */
  var OVERLAY_SEL = '.modal-overlay,.ma-menu,.board-drawer,.gloss-tip,.ofl-toast,.search-results,.cmd-host';
  var openState = new WeakMap();

  /* 三种开关方式统一判定：class（active/on/is-open）、hidden 属性、style.display */
  function isOpen(el) {
    if (el.classList.contains('modal-overlay')) return el.classList.contains('active');
    if (el.classList.contains('ofl-toast')) return el.classList.contains('on');
    if (el.classList.contains('search-results')) return el.classList.contains('active');
    if (el.classList.contains('cmd-host')) return el.classList.contains('is-open') && !el.hasAttribute('hidden');
    if (el.classList.contains('gloss-tip')) return el.style.display !== 'none';
    if (el.classList.contains('ma-menu') || el.classList.contains('board-drawer')) return !el.hasAttribute('hidden');
    return false;
  }

  function setOrigin(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x = lastX, y = lastY;
    // 触发元素优先：它比"上一次点击坐标"更接近用户心智里的"从这儿长出来"
    var t = lastTrigger;
    if (t && t.isConnected && !el.contains(t)) {
      var tr = t.getBoundingClientRect();
      if (tr.width && tr.height) { x = tr.left + tr.width / 2; y = tr.top + tr.height / 2; }
    }
    if (x == null || y == null) { x = r.left + r.width / 2; y = r.top; }
    var ox = Math.max(0, Math.min(1, (x - r.left) / r.width));
    var oy = Math.max(0, Math.min(1, (y - r.top) / r.height));
    el.style.setProperty('--mo-origin', (ox * 100).toFixed(1) + '% ' + (oy * 100).toFixed(1) + '%');
  }

  function closing(el) {
    if (reduce) return;
    el.classList.add('is-closing');
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      el.classList.remove('is-closing');
    };
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, DUR.d2 + 40);
  }

  function onOverlayMutate(el) {
    var now = isOpen(el);
    var was = openState.get(el);
    if (was === undefined) { openState.set(el, now); return; }
    if (now === was) return;
    openState.set(el, now);
    if (now) { el.classList.remove('is-closing'); setOrigin(el); }
    else closing(el);
  }

  /* ==================================================================== 3. 数字滚动
     主节点文本即时更新（读屏/复制拿新值），旧值与新值各一层绝对定位副本：
       旧值 translateY(±0.6em) scale(1→.3) opacity→0（.2s）
       新值 scale(.3→1) opacity 0→1（.2s）
     主节点文本在动画期间 color:transparent（不是 opacity——opacity 会连带副本一起透明）。
     冲突保护：app.js 的 flashPrice 用 WAAPI 改 backgroundColor，检测到就跳过，不打架。 */
  var NUM_SEL = '.num,.up,.down,.hero-value,.qchg,.link-pct,.bc-pct,.pct,.bd-value,[data-roll]';
  var lastText = new WeakMap();
  var pendingNum = new Map();
  var numRaf = 0;
  var ROLL_MS = 200;

  function seedNum(node) {
    if (!node || lastText.has(node)) return;
    lastText.set(node, node.textContent);
  }

  function scheduleNum(node) {
    if (!node) return;
    if (node.__moRolling) return;          // 正在滚：此刻的文本变化是自己插的副本造成的
    pendingNum.set(node, 1);
    if (!numRaf) numRaf = raf(flushNum);
  }

  function flushNum() {
    numRaf = 0;
    var batch = [];
    pendingNum.forEach(function (_, n) { batch.push(n); });
    pendingNum.clear();
    /* v3.2：行情 10s 一轮，全表几十个数字同时滚会明显「发花」。
       只滚视口内的节点，单批上限 24；超出的直接落到终值（不播动画）。 */
    var budget = 24;
    for (var i = 0; i < batch.length; i++) {
      var node = batch[i];
      var inView = false;
      try {
        var rect = node.getBoundingClientRect();
        inView = rect.bottom > -80 && rect.top < (window.innerHeight || 0) + 80;
      } catch (err) { inView = false; }
      if (inView && budget > 0) { rollNum(node); budget -= 1; }
    }
    if (pendingNum.size && !numRaf) numRaf = raf(flushNum);
  }

  function busyWithFlash(node) {
    if (node.hasAttribute('data-flash')) return true;
    if (!node.getAnimations) return false;
    var list;
    try { list = node.getAnimations(); } catch (e) { return false; }
    for (var i = 0; i < list.length; i++) {
      try {
        var kf = list[i].effect && list[i].effect.getKeyframes ? list[i].effect.getKeyframes() : null;
        if (kf) {
          for (var j = 0; j < kf.length; j++) if (kf[j].backgroundColor) return true;
        }
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function rollNum(node) {
    if (!node || !node.isConnected || node.__moRolling) return;
    var text = node.textContent || '';
    var prev = lastText.get(node);
    lastText.set(node, text);
    if (reduce || prev == null || prev === text) return;
    if (text.length > 24 || prev.length > 24) return;
    if (!/\d/.test(text) || !/\d/.test(prev)) return;
    if (closest(node, '[data-no-roll],.ma-menu,.cmd-host,.gloss-tip,#settingsModal')) return;
    if (!isVisible(node)) return;
    if (busyWithFlash(node)) return;

    var a = num(prev), b = num(text);
    var down = (a != null && b != null) ? (b < a) : false;   // 收跌/变小：旧值向下滚
    var dy = down ? '0.6em' : '-0.6em';

    var cs = getComputedStyle(node);
    var color = cs.color;
    var inlineColor = node.style.color;
    node.classList.add('mo-roll');
    if (cs.display === 'inline') node.classList.add('mo-roll-inline');
    node.style.color = 'transparent';

    node.__moRolling = true;               // 副本已插入：本体 textContent 暂时含副本文本
    var token = (node.__moRollTok || 0) + 1;
    node.__moRollTok = token;
    var realText = text;

    var oldN = doc.createElement('span');
    oldN.className = 'mo-roll-old';
    oldN.setAttribute('aria-hidden', 'true');
    oldN.textContent = prev;
    oldN.style.color = color;

    var newN = doc.createElement('span');
    newN.className = 'mo-roll-old mo-roll-new';
    newN.setAttribute('aria-hidden', 'true');
    newN.textContent = text;
    newN.style.color = color;

    node.appendChild(oldN);
    node.appendChild(newN);

    try {
      oldN.animate([
        { transform: 'translateY(0) scale(1)', opacity: 1 },
        { transform: 'translateY(' + dy + ') scale(0.3)', opacity: 0 }
      ], { duration: ROLL_MS, easing: EASE.out, fill: 'forwards' });
      newN.animate([
        { transform: 'translateY(0) scale(0.3)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1 }
      ], { duration: ROLL_MS, easing: EASE.panel, fill: 'forwards' });
    } catch (e) { /* 不支持 WAAPI：直接清场，不留副本 */ }

    setTimeout(function () {
      if (node.__moRollTok !== token) return;   // 期间又滚过一次：让新一轮自己收尾
      oldN.remove();
      newN.remove();
      node.style.color = inlineColor;
      node.__moRolling = false;
      lastText.set(node, node.textContent || realText);
    }, ROLL_MS + 60);
  }

  /* ==================================================================== 4. 列表错峰
     父容器"第一次"拿到子项时播一次：translateY(8px)→0，.4s 招牌曲线，40ms 错峰，
     索引封顶 7（总长 ≤280ms）。之后同一父容器的更新不再重播——行情每 10s 刷一遍，
     每次都入场会变成"满屏乱跳"，那是噪音不是手感。 */
  var ITEM_SEL = '.qrow,.crow,.srow,.pm-card,.wcard,.event-item,.news-item,.bchip,.chip,' +
    '.gcard,.link-node,.prow,.opt-row,.sr-item,.av-cell,.actor-row';
  var STAGGER_MAX = 8;

  function staggerIn(added) {
    if (reduce || !added.length) return;
    var items = [];
    for (var i = 0; i < added.length && items.length < 24; i++) {
      var n = added[i];
      if (!n || n.nodeType !== 1) continue;
      if (n.matches && n.matches(ITEM_SEL)) items.push(n);
      if (n.querySelectorAll) {
        var inner = n.querySelectorAll(ITEM_SEL);
        for (var j = 0; j < inner.length && items.length < 24; j++) items.push(inner[j]);
      }
    }
    if (!items.length) return;

    var groups = new Map();
    for (var k = 0; k < items.length; k++) {
      var el = items[k];
      var p = el.parentElement;
      if (!p || p.dataset.moStaggered) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    }
    groups.forEach(function (els, parent) {
      parent.dataset.moStaggered = '1';       // 父容器只播第一轮
      if (!el_rendered(parent)) return;
      if (els.length < 2) return;             // 单条不配错峰（克制的下限）
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.dataset.moStaggered) continue;
        el.dataset.moStaggered = '1';
        el.style.setProperty('--mo-i', String(Math.min(i, STAGGER_MAX - 1)));
        el.classList.add('mo-in-item');
      }
    });
  }
  function el_rendered(el) { return !!el && el.getClientRects().length > 0; }

  function resetStagger() {
    // 回到某个板块时把"播过"的标记清掉，让列表重新入场一次（同一屏内不重复）
    var els = doc.querySelectorAll('[data-mo-staggered]');
    for (var i = 0; i < els.length && i < 400; i++) delete els[i].dataset.moStaggered;
  }

  /* ==================================================================== 5. 滚动进入（once）
     只对首屏以下的内容生效——首屏已经看见的区块不该再"重新长出来"。 */
  var REVEAL_SEL = '.section,.pm-card,.event-item,.news-item,.wcard,.board-wrap';
  var io = null;

  function initReveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    var vh = window.innerHeight || 800;
    var els = doc.querySelectorAll(REVEAL_SEL);
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (!en.isIntersecting) continue;
        en.target.classList.add('mo-in');
        io.unobserve(en.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.dataset.moIo) continue;
      if (el.closest('.rv')) continue;               // app.js 的 .rv 已覆盖，别播第二遍
      var r = el.getBoundingClientRect();
      if (!r.height) continue;                       // 隐藏 tab 里的区块：交给 .view 的切换动画
      if (r.top < vh * 0.9) continue;                // 首屏内：不做
      el.dataset.moIo = '1';
      el.classList.add('mo-io');
      io.observe(el);
    }
    // 兜底：观察者因任何原因没回调，4s 后强制显形（宁可不动，不能不见）
    setTimeout(function () {
      var left = doc.querySelectorAll('.mo-io:not(.mo-in)');
      for (var i = 0; i < left.length; i++) left[i].classList.add('mo-force');
    }, 4000);
  }

  function revealNew(el) {
    if (!io || !el || el.dataset.moIo) return;
    if (!el.matches || !el.matches(REVEAL_SEL)) return;
    if (el.closest('.rv')) return;                   // 同上：app.js 已负责
    if (!el_rendered(el)) return;
    var r = el.getBoundingClientRect();
    if (r.top < (window.innerHeight || 800) * 0.9) return;
    el.dataset.moIo = '1';
    el.classList.add('mo-io');
    io.observe(el);
  }

  /* ==================================================================== 6. 一级 tab 指示器
     shell 在 #primaryNav 里放好 .nav-ink；没有就自建（两条路都能跑）。
     位移用 transform: translateX(x) scaleX(s)，不碰 width/left（零 layout）。
     宽度基准取 offsetWidth（layout 宽度，不受 transform 影响）。 */
  function initInk() {
    var host = doc.getElementById('primaryNav') || doc.querySelector('#primaryNav[role="tablist"]');
    if (!host) {
      // 兼容旧结构：只有存在 [data-tab] 且没有一级栏时，才退回到 .tabs
      if (doc.querySelector('[data-primary]')) return;
      host = doc.querySelector('.tabs[role="tablist"]');
    }
    if (!host || host.dataset.moInkReady) return;

    var ink = host.querySelector('.nav-ink');
    if (!ink) {
      // 已有原生下划线（.tab.active::after）时不自建，否则两条指示器打架
      var act = host.querySelector('[role="tab"][aria-selected="true"]');
      if (act) {
        try {
          var ps = getComputedStyle(act, '::after');
          if (ps && ps.content && ps.content !== 'none' && parseFloat(ps.height) > 1) return;
        } catch (e) { /* ignore */ }
      }
      ink = doc.createElement('span');
      ink.className = 'nav-ink';
      ink.id = 'navInk';
      ink.setAttribute('aria-hidden', 'true');
      host.appendChild(ink);
    }
    host.dataset.moInkReady = '1';
    host.classList.add('mo-ink-host');
    ink.setAttribute('data-mo-ink', '1');

    function move(animate) {
      var cur = host.querySelector('[role="tab"][aria-selected="true"]');
      if (!cur || !ink.isConnected) return;
      if (!el_rendered(cur)) return;
      if (!animate) ink.classList.add('mo-ink-static');
      var hr = host.getBoundingClientRect();
      var r = cur.getBoundingClientRect();
      var base = ink.offsetWidth || 1;
      /* 绝对定位的包含块是宿主的 **padding box**，而 getBoundingClientRect 是 **border box**：
         宿主若有 1px 描边（v2 的 #primaryNav 就是 1px），少减这一下指示器会恒定偏 1px。
         scaleX 的基准用 offsetWidth（同样是 padding box 宽度），所以宽度那边天然是对的。 */
      var x = (r.left - hr.left) - (host.clientLeft || 0) + (host.scrollLeft || 0);
      var s = r.width / base;
      ink.style.setProperty('--mo-ink-x', x.toFixed(2) + 'px');
      ink.style.setProperty('--mo-ink-s', s.toFixed(6));   // 4 位小数会让宽度差 0.02px，6 位归零
      if (!animate) {
        raf(function () { raf(function () { ink.classList.remove('mo-ink-static'); }); });
      }
    }

    move(false);
    // 字体换行/图片撑开都会改变 tab 宽度：字体就绪 + resize + 容器尺寸变化 都重排一次
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(function () { move(false); }).catch(function () {});
    }
    var rsT = 0;
    function relayout() {
      if (rsT) clearTimeout(rsT);
      rsT = setTimeout(function () { rsT = 0; move(false); }, 80);
    }
    window.addEventListener('resize', relayout, { passive: true });
    host.addEventListener('scroll', function () { move(false); }, { passive: true });
    if ('ResizeObserver' in window) {
      try { new ResizeObserver(relayout).observe(host); } catch (e) { /* ignore */ }
    }
    // aria-selected 变化由主观察者转发到这里（直接调用，不走自定义事件）
    host.__moInkMove = move;
  }

  function onInkMutate(el, name) {
    if (name !== 'aria-selected') return;
    var host = closest(el, '[role="tablist"]');
    if (host && host.__moInkMove) host.__moInkMove(true);
  }

  /* ==================================================================== 7. 页面切换
     次要方案（永远在）：CSS 给 .view.active 播 180ms 淡入+4px 位移（见 04-motion.css）。
     增强方案：一级 tab 点击时用 View Transitions API 包一层（旧页快照 → 新页快照交叉淡出）。
     只用在一级栏：它切换的是整块视图，快照值得；二级栏/命令面板不包（会跟内部重排打架）。
     失败/不支持/减动效 → 静默退回 CSS 方案，用户无感。 */
  /* v3.2：View Transition 默认关闭。
     原因不是兼容性，是成本：切一次一级 = 对 1440×1000 的整页做两个快照（含热力图 canvas），
     实测稳定产生一次 ~59ms 的长任务 —— 那一帧的卡顿正是「不够丝滑」的来源。
     CSS 的 opacity+translateY 只走合成层，同样能把「换页」讲清楚，且不掉帧。
     想找回快照交叉淡出，把 USE_VT 改回 true 即可（下面的逻辑保留完整）。 */
  var USE_VT = false;
  function initPageTransition() {
    if (!USE_VT || reduce || !doc.startViewTransition) return;
    var busy = false;

    /* 收尾：只有"过渡真的跑过"才给新视图打 .mo-vt-skip（否则跳过过渡时连 CSS 兜底动画也没了）。
       顺序很重要：先给视图打标记、再撤 root 标记 —— 反过来的话 animation 会从 none 变回
       moPageIn，已经显示出来的页面会再淡入一次（双重入场）。 */
    function finish(usedVt) {
      if (usedVt) {
        var act = doc.querySelector('.view.active');
        if (act) act.classList.add('mo-vt-skip');
      }
      root.classList.remove('mo-vt');
      busy = false;
    }
    /* 三个 Promise 必须各自吃掉 rejection，否则控制台会冒未捕获异常：
         ready    → AbortError: Transition was skipped
         finished → AbortError / TimeoutError: ...timeout in DOM update
         updateCallbackDone → 更新回调自身异常
       注意必须在同一个任务里同步挂上 catch（晚一拍就已经算 unhandled 了）。 */
    function swallow(p) { if (p && typeof p.catch === 'function') p.catch(function () {}); }

    doc.addEventListener('click', function (e) {
      var tab = closest(e.target, '#primaryNav [role="tab"]');
      if (!tab) return;
      if (tab.getAttribute('aria-selected') === 'true') return;   // 点的是当前项：不换视图，不包过渡
      if (busy) return;
      // Chrome 129+ 暴露 activeViewTransition：已有过渡在飞就跳过，绝不叠加（叠加必抛 skipped）
      if (doc.activeViewTransition) return;

      busy = true;
      root.classList.add('mo-vt');

      var ran = false;
      var vt;
      try {
        vt = doc.startViewTransition(function () {
          /* 同步返回，不 await、不等 rAF。
             DOM 已经由 app.js 的 click 处理器在同一个任务里改完了；这里再让出事件循环，
             updateCallback 就会拖过浏览器给 DOM 更新的超时线（实测 headless 下报
             TimeoutError: Transition was aborted because of timeout in DOM update）。 */
        });
      } catch (err) { finish(false); return; }

      swallow(vt.updateCallbackDone);
      if (vt.ready && vt.ready.then) {
        vt.ready.then(function () { ran = true; }, function () { ran = false; });
      }
      if (vt.finished && vt.finished.then) {
        vt.finished.then(function () { finish(ran); }, function () { finish(false); });
      } else {
        finish(false);
      }
      setTimeout(function () { finish(ran); }, 1200);   // 兜底：过渡卡住也不锁死 busy
    }, true);
  }

  /* ==================================================================== 8. MutationObserver
     一个观察者管三件事：新增子树（错峰/滚动进入/数字种子）、文本变化（数字滚动）、
     属性变化（浮层开关 / 指示器跟随）。全部塞进一帧处理，单帧工作量封顶。 */
  var qAdded = [];
  var qAttrs = [];
  var moRaf = 0;
  var mo = null;

  function flushMutations() {
    moRaf = 0;
    var added = qAdded.slice(0, 200);
    qAdded.length = 0;
    var attrs = qAttrs.slice(0, 120);
    qAttrs.length = 0;

    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      var el = a.target;
      if (!el || el.nodeType !== 1) continue;
      if (a.attributeName === 'aria-selected') { onInkMutate(el, 'aria-selected'); continue; }
      // 视图离开时清掉 VT 标记，下次进来照常播 CSS 入场动画
      if (el.classList && el.classList.contains('view') && !el.classList.contains('active')) {
        el.classList.remove('mo-vt-skip');
        continue;
      }
      if (!el.matches || !el.matches(OVERLAY_SEL)) continue;
      onOverlayMutate(el);
    }

    if (added.length) {
      staggerIn(added);
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        revealNew(n);
        // 数字种子：新渲染的数字节点记下当前值，下一次变化才有"旧值"可滚
        if (n.matches && n.matches(NUM_SEL)) seedNum(n);
        if (n.querySelectorAll) {
          var seeds = n.querySelectorAll(NUM_SEL);
          for (var k = 0; k < seeds.length && k < 80; k++) seedNum(seeds[k]);
        }
      }
    }
  }

  function onRecords(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length && qAdded.length < 300; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType === 1) qAdded.push(n);
        }
        if (r.target && r.target.nodeType === 1 && r.addedNodes.length) {
          var t = closest(r.target, NUM_SEL);
          if (t) scheduleNum(t);
        }
      } else if (r.type === 'characterData') {
        var p = r.target && r.target.parentElement;
        var tn = closest(p, NUM_SEL);
        if (tn) scheduleNum(tn);
      } else if (r.type === 'attributes') {
        if (qAttrs.length < 300) qAttrs.push(r);
      }
    }
    if (!moRaf) moRaf = raf(flushMutations);
  }

  function initObserver() {
    if (!window.MutationObserver || !doc.body) return;
    mo = new MutationObserver(onRecords);
    mo.observe(doc.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'aria-selected']
    });
  }

  /* ==================================================================== 初始化 */

  /* 浮层开合状态打底：不先记一遍，第一次开关会被当成"初始值"而漏掉 origin */
  function seedOverlays() {
    var els = doc.querySelectorAll(OVERLAY_SEL);
    for (var i = 0; i < els.length; i++) openState.set(els[i], isOpen(els[i]));
  }

  function seedAllNumbers() {
    var nodes = doc.querySelectorAll(NUM_SEL);
    for (var i = 0; i < nodes.length; i++) seedNum(nodes[i]);
  }

  var inited = false;
  function init() {
    if (inited) return;
    inited = true;
    var steps = [initPress, initReveal, initInk, initPageTransition, seedOverlays, seedAllNumbers];
    for (var i = 0; i < steps.length; i++) {
      try { steps[i](); } catch (e) { /* 单模块失败不拖垮其余模块 */ }
    }
    try { initObserver(); } catch (e) { /* ignore */ }
    // 二级 tab 切换后重置错峰：回到某个板块时，列表重新入场一次
    doc.addEventListener('click', function (e) {
      var tab = closest(e.target, '[role="tab"],.tab');
      if (tab) setTimeout(resetStagger, 0);
    }, true);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  } else {
    setTimeout(init, 0);
  }

  /* 调试钩子：_qa/motion-probe.mjs 用它读状态，生产代码不依赖 */
  window.__oflMotionDebug = {
    reduce: function () { return reduce; },
    ink: function () {
      var h = doc.getElementById('primaryNav');
      var k = h && h.querySelector('.nav-ink');
      return k ? { x: k.style.getPropertyValue('--mo-ink-x'), s: k.style.getPropertyValue('--mo-ink-s') } : null;
    },
    rolling: function () { return doc.querySelectorAll('.mo-roll-old').length; },
    inited: function () { return inited; }
  };
})();
