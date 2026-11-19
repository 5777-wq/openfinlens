/* site/cross.js —— 与行情终端（OpenFinLens）的双向跳转
   三档出口，读的人自己选：
     · 去看历史数据 → 终端里那一只标的的 K 线
     · ← 回到 OpenFinLens → 回到终端（终端那一页本来就没被导航过，原位还在）
     · 继续读别的 → 留在科普站接着读
   另有一个总开关：设置里关掉「去行情终端的链接」后，这些入口一起消失。 */
(function () {
  'use strict';

  const LENS = (window.ACADEMY_SITE && window.ACADEMY_SITE.lensUrl) || 'https://5777-wq.github.io/openfinlens/';
  const esc = (s) => window.Fmt.esc(s);

  /** 是否显示去行情终端的入口（默认显示；老用户没存过也算显示） */
  function enabled() {
    try { return window.Store.get('lens') !== false; } catch (e) { return true; }
  }

  /**
   * 跨站跳转条
   * @param {Object} o
   * @param {string} [o.sym]      终端里的 symbol（有它就跳它的详情页）
   * @param {string} [o.lensSym]  站内 id 对应的终端 symbol（两者不一致时用它）
   * @param {string} [o.lens]     没有 sym 时给的板块链接（如 #etf=spmo）
   * @param {string} [o.lensLabel]
   * @param {boolean}[o.fromLens] 是不是从终端点进来的（是才给"回到 OpenFinLens"）
   * @param {string} [o.moreHref]  "继续读别的"去哪儿
   * @param {string} [o.moreLabel]
   */
  function bar(o) {
    const opt = o || {};
    if (!enabled()) return '';
    const out = [];
    // lensSym：站内的 id 常常不是终端的 symbol（老链接 #/assets/gold 就是），
    // 用错 symbol 链过去，终端会打开一个名为「ld」、没有数据的空详情页。
    const sym = opt.lensSym || opt.sym || '';
    if (sym) {
      out.push(`<a class="btn sm" href="${LENS}#symbol=${encodeURIComponent(sym)}" target="_blank" rel="noopener">去看历史数据 →</a>`);
    } else if (opt.lens) {
      out.push(`<a class="btn sm" href="${esc(opt.lens)}" target="_blank" rel="noopener">${esc(opt.lensLabel || '去 OpenFinLens 看这一块 →')}</a>`);
    }
    if (opt.fromLens) {
      out.push(`<a class="btn ghost sm" href="${LENS}" target="_blank" rel="noopener">← 回到 OpenFinLens</a>`);
    }
    if (opt.moreHref) {
      out.push(`<a class="btn ghost sm" href="${esc(opt.moreHref)}">${esc(opt.moreLabel || '继续读别的 →')}</a>`);
    }
    if (!out.length) return '';
    return `<div class="term-cross">${out.join('')}</div>`;
  }

  window.Cross = { enabled, bar, LENS };
})();
