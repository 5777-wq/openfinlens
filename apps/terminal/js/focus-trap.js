/* focus-trap.js —— 弹层焦点工具（进焦点 / Tab 循环 / 退出还焦点）
 *
 * 为什么要有这一层：站里原本有三套各写各的弹层键盘处理——
 *   · app.js 的设置弹层：手写 Tab 循环，候选选择器漏了 <summary>，
 *     「开发者：数据源自检」那个折叠块永远拿不到焦点；
 *   · pmshare.js 的分享弹层：自己一份 Tab 陷阱；
 *   · alerts.js 的到价提醒弹层：根本没有陷阱，Tab 会跑进背景的 K 线页，
 *     关掉后焦点掉到 body，键盘用户直接迷路。
 * 三份各写各的 = 三份都会漏。现在合成一处：谁开弹层谁调 FocusTrap.open()，
 * 关的时候调 close()，焦点自己还回去。
 *
 * 约定：
 *   · open(root, opts) —— root 是弹层根节点，opts.initialFocus 指定先进哪个，
 *     opts.onEscape 收 Esc（不传就只拦 Tab）；
 *   · close() —— 解除 Tab 循环，并把焦点还给开弹层前的那一个。
 * 全站同时只允许一个陷阱：后开的接管先开的（嵌套弹层本来也只会有一个）。
 */
const FocusTrap = (() => {
  /* 候选：能拿到键盘焦点的都算上。
     <summary> 必须在里面——<details> 的折叠头是原生可聚焦的，
     漏了它设置弹层里的「数据源自检」就打不开。 */
  const FOCUSABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  let session = null;   // 当前生效的陷阱

  /* 弹层里真正能聚焦的元素：排除 disabled、排除隐藏的（display:none 的祖先）。
     用 getClientRects 判断可见性，比 offsetParent 稳（fixed 定位的元素 offsetParent 是 null）。 */
  function focusables(root) {
    if (!root || !root.querySelectorAll) return [];
    const list = root.querySelectorAll(FOCUSABLE);
    return Array.prototype.slice.call(list || []).filter(el => {
      if (!el || el.disabled) return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      if (typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
      return true;
    });
  }

  function onKeydown(e) {
    const root = session && session.root;
    if (!root) return;
    if (e.key === 'Escape') {
      if (session.onEscape) {
        // Esc 只关最上面那层：拦下来，别让下层弹层/详情页跟着反应
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        session.onEscape();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables(root);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const act = document.activeElement;
    const inside = !!(act && root.contains && root.contains(act));
    if (e.shiftKey) {
      if (!inside || act === first) { e.preventDefault(); last.focus(); }
    } else if (!inside || act === last) {
      e.preventDefault(); first.focus();
    }
  }

  /* 收掉当前陷阱。restore=false 时不还焦点——开新弹层时用：
     那时要把焦点还给**新**弹层的触发点，不能被上一个陷阱抢回去。 */
  function teardown(restore) {
    const s = session;
    if (!s) return;
    session = null;
    if (document.removeEventListener) document.removeEventListener('keydown', onKeydown, true);
    if (restore && s.lastFocus && s.lastFocus.focus &&
        (!document.contains || document.contains(s.lastFocus))) {
      try { s.lastFocus.focus(); } catch (err) { /* 触发点已消失，忽略 */ }
    }
  }

  /**
   * 开一个焦点陷阱。
   * @param {HTMLElement} root 弹层根节点
   * @param {{initialFocus?: HTMLElement, onEscape?: Function}} opts
   * @returns {{close: Function}} 句柄
   */
  function open(root, opts) {
    if (!root) return { close: () => {} };
    const o = opts || {};
    const act = document.activeElement;
    teardown(false);   // 同一时刻只留一个陷阱（但不还焦点，见上面的说明）
    session = {
      root,
      onEscape: o.onEscape || null,
      // 记住是谁打开的：关掉之后焦点回到那儿，键盘用户不丢位置
      lastFocus: (act && act !== document.body && act.focus) ? act : null,
    };
    // 捕获阶段：Tab 循环要在别的监听器之前收口
    if (document.addEventListener) document.addEventListener('keydown', onKeydown, true);
    const first = o.initialFocus || focusables(root)[0];
    if (first && first.focus) { try { first.focus(); } catch (err) { /* 元素已移除，忽略 */ } }
    return { close };
  }

  /** 关掉陷阱：解除监听 + 把焦点还给开它的那个元素 */
  function close() {
    teardown(true);
  }

  return { open, close, focusables, isActive: () => !!session };
})();

window.FocusTrap = FocusTrap;
