/* site/cross.js —— 与行情终端（OpenFinLens）的双向跳转
   三档出口，读的人自己选：
     · 去看历史数据 → 终端里那一只标的的 K 线
     · ← 回到 OpenFinLens → 回到终端（带 sym 上下文时落回那只标的）
     · 继续读别的 → 留在科普站接着读
   另有一个总开关：设置里关掉「去行情终端的链接」后，这些入口一起消失。 */
(function () {
  'use strict';

  /* LENS 唯一真源是 site/base.js 的 lensUrl（相对路径 '../index.html'，同站跳转）。
     这里的绝对地址只是 base.js 没加载出来时的兜底（vm 直跑测试也走它），生产不会用到。 */
  const LENS = (window.ACADEMY_SITE && window.ACADEMY_SITE.lensUrl) || 'https://5777-wq.github.io/openfinlens/';
  const esc = (s) => window.Fmt.esc(s);

  /** 是否显示去行情终端的入口（默认显示；老用户没存过也算显示） */
  function enabled() {
    try { return window.Store.get('lens') !== false; } catch (e) { return true; }
  }

  /**
   * 出口锚点集合（不带 .term-cross 外壳）。bar() 拿它包壳成术语页那条跳转条；
   * 术语抽屉的 foot 空间小，直接取锚点、不要壳（components/term-drawer.js）。
   * @param {Object} o
   * @param {string} [o.sym]      终端里的 symbol（有它就跳它的详情页）
   * @param {string} [o.symLabel] sym 深链的自定义文案（缺省「去看历史数据 →」）
   * @param {string} [o.lensSym]  站内 id 对应的终端 symbol（两者不一致时用它）
   * @param {string} [o.lens]     没有 sym 时给的板块链接（如 #etf=spmo）
   * @param {string} [o.lensLabel]
   * @param {boolean}[o.fromLens] 是不是从终端点进来的（是才给"回到 OpenFinLens"）
   * @param {string} [o.moreHref]  "继续读别的"去哪儿
   * @param {string} [o.moreLabel]
   * @returns {string[]} 总开关关着时为空数组
   */
  function links(o) {
    const opt = o || {};
    if (!enabled()) return [];
    const out = [];
    // lensSym：站内的 id 常常不是终端的 symbol（老链接 #/assets/gold 就是），
    // 用错 symbol 链过去，终端会打开一个名为「ld」、没有数据的空详情页。
    const sym = opt.lensSym || opt.sym || '';
    if (sym) {
      // symLabel：术语抽屉的出口也叫「回到 OpenFinLens 看行情」，但深链目标一样——
      // 都落回终端里那一只标的的详情页。不传就用术语页原来的「去看历史数据」。
      out.push(`<a class="btn sm" href="${LENS}#symbol=${encodeURIComponent(sym)}" target="_blank" rel="noopener">${esc(opt.symLabel || '去看历史数据 →')}</a>`);
    } else if (opt.lens) {
      out.push(`<a class="btn sm" href="${esc(opt.lens)}" target="_blank" rel="noopener">${esc(opt.lensLabel || '去 OpenFinLens 看这一块 →')}</a>`);
    }
    if (opt.fromLens) {
      // 回链带上下文：从「某只标的」点过来的，回去时还落回那只标的的详情页——
      // 以前固定回终端根，读者得自己重新把标的找出来。没有 sym 上下文才回根。
      const back = sym ? `${LENS}#symbol=${encodeURIComponent(sym)}` : LENS;
      out.push(`<a class="btn ghost sm" href="${back}" target="_blank" rel="noopener">← 回到 OpenFinLens</a>`);
    }
    if (opt.moreHref) {
      out.push(`<a class="btn ghost sm" href="${esc(opt.moreHref)}">${esc(opt.moreLabel || '继续读别的 →')}</a>`);
    }
    return out;
  }

  /** 跨站跳转条（术语页/标的页用的整条） */
  function bar(o) {
    const out = links(o);
    if (!out.length) return '';
    return `<div class="term-cross">${out.join('')}</div>`;
  }

  window.Cross = { enabled, bar, link: (o) => links(o).join(''), LENS };
})();
