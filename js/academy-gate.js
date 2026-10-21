/* academy-gate.js —— 科普入口（白话金融）的总开关
   设置里可以整个关掉：关掉后
     · 悬停浮出的「这是什么」不再出现
     · 顶栏的「白话金融 ↗」链接消失
     · 详情页顶栏的「在白话金融里看解释」消失
     · 概念标记不再显示可悬停的光标
   单独放一个模块，是为了这段逻辑能被 node 直接单测（效果全在 DOM 上，断言也全在 DOM 上）。 */
(function () {
  'use strict';

  const BASE = 'https://5777-wq.github.io/openfinlens/';

  /** 当前是否开着（默认开；老用户没存过这项也算开） */
  function isOn() {
    try {
      const s = window.Store && window.Store.settings ? window.Store.settings.get() : null;
      return s ? s.academy !== false : true;
    } catch (e) { return true; }
  }

  /** 把开关状态同步到所有相关 DOM 上；返回最终状态 */
  function apply(on) {
    const v = !!on;
    if (document.body) document.body.dataset.academy = v ? 'on' : 'off';

    const link = document.getElementById('academyLink');
    if (link) link.hidden = !v;

    const gl = document.getElementById('detailGloss');
    if (gl) gl.hidden = !v;

    const sw = document.getElementById('swAcademy');
    if (sw) {
      sw.classList.toggle('on', v);
      sw.setAttribute('aria-checked', String(v));
    }

    if (window.GlossTip) window.GlossTip.apply(v);
    return v;
  }

  /** 切换并落盘 */
  function toggle() {
    const next = !isOn();
    if (window.Store && window.Store.settings) window.Store.settings.set({ academy: next });
    return apply(next);
  }

  window.AcademyGate = { isOn, apply, toggle, BASE };
})();
