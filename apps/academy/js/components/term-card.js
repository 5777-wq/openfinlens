/* components/term-card.js —— 四段式术语卡（签名组件）
   一句话 / 一个比喻 / 一个真实数字 / 一个坑 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  /* ---- 动效样式（本组件自带的这一小块）----
     词条卡在词典/首页/搜索里都是以 .term-link 整卡可点的形态出现，
     hover 时给一张「轻微抬起」——回答「我刚刚碰了什么」。
     规则与全站总纲对齐：
     · 只动 transform（合成器友好），不碰颜色、不加阴影动画；
     · 时长/缓动引用全局变量并带兜底，兜底取 live --dur-1=180ms（不是
       tokens.css 里已死的 140ms），零节奏变化；
     · prefers-reduced-motion: reduce 的关闭分支在下面显式写了一份
       （layout.css / motion.css 里的全局关闭分支是第二道网）。
     hover 的「轻抬」由 motion.css 的 `.term-link:hover .term`（内层 -2px）
     唯一提供——这里绝不再叠一层，避免内外同抬变成 -4px 的第三层位移。
     本块只补键盘 :focus-visible：焦点环画在外层 <a> 上，卡和环必须一起抬，
     否则卡片会从自己的焦点环里探出去。hover 与 focus-visible 互斥，
     两处各抬一次、不会相加。
     注入失败（极老浏览器/测试桩）不影响任何功能——动效是增强，不是功能。 */
  (function ensureMotionStyle() {
    try {
      if (document.getElementById('style-term-card-motion')) return;
      const s = document.createElement('style');
      s.id = 'style-term-card-motion';
      s.textContent = `
.term-link {
  transition: transform var(--dur-1, 180ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
}
/* 只抬键盘焦点态：hover 的 -2px 在 motion.css 里已有一份，不叠第二层。 */
.term-link:focus-visible { transform: translateY(-2px); }
@media (prefers-reduced-motion: reduce) {
  .term-link { transition: none; }
  .term-link:focus-visible { transform: none; }
}
`;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 注入不了就算了，功能不依赖它 */ }
  })();

  /** 术语卡 HTML
   *  opts.noName：词名由外层承担（术语页的 h1），这里只留别名与编号，避免同页出现两次 */
  function render(term, opts) {
    if (!term) return '';
    const o = opts || {};
    const parts = [];
    if (term.one) parts.push(part('一句话', term.one));
    // 「名称由来」放在最前面：读者看到「日经225」「标普500」第一反应就是
    // 「225 是几家？500 是几家？」——这个答案比数字更重要，先给。
    if (term.name) parts.push(part('名称由来', term.name));
    if (term.metaphor) parts.push(part('比喻', term.metaphor));
    if (term.number) parts.push(part('数字', term.number));
    if (term.pit) parts.push(part('坑', term.pit, true));
    if (term.detail) parts.push(part('展开', term.detail));
    if (!parts.length) return '';

    const head = o.noName
      ? ((term.alias || term.id) ? `<div class="term-head">
          ${term.alias ? `<span class="tag">${esc(term.alias)}</span>` : ''}
          ${term.id ? `<span class="tid">${esc(term.id)}</span>` : ''}
        </div>` : '')
      : `<div class="term-head">
          <span class="tt">${esc(term.term || '')}</span>
          ${term.alias ? `<span class="tag">${esc(term.alias)}</span>` : ''}
          ${term.id ? `<span class="tid">${esc(term.id)}</span>` : ''}
        </div>`;

    return `<div class="term">${head}<div class="term-parts">${parts.join('')}</div></div>`;
  }

  function part(k, v, pit) {
    return `<div class="term-part${pit ? ' pit' : ''}">
      <span class="tp-k">${esc(k)}</span>
      <span class="tp-v">${inline(v)}</span>
    </div>`;
  }

  /** 行内 Markdown（只这一小段：加粗 / 斜体 / 代码）
      为什么不用 Fmt.md：那个是块级渲染器，会把一句话包成 <p>，
      而词条卡的值都放在 <span class="tp-v"> 里，块级标签会撑坏版式。
      词条里出现的 `**加粗**` 之前是原样打印星号的——读者看到的是
      「**隐含波动率**是……」这种半成品排版。 */
  function inline(v) {
    if (v === null || v === undefined) return '';
    return esc(v)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  /** 把正文里的「术语引用」标记成可点元素
     语法：[[术语id|显示文本]]
     术语不在库里时不生成可点锚点——不做假入口。 */
  function markTerms(html, glossary) {
    return String(html || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, id, text) => {
      const t = glossary && glossary[id];
      if (!t) return esc(text || id);
      const label = text || t.term || id;
      const tip = t.one ? ` title="${esc(t.one)}"` : '';
      return `<span class="t-ref" data-term="${esc(id)}" role="button" tabindex="0"${tip}>${esc(label)}</span>`;
    });
  }

  window.TermCard = { render, markTerms, part, inline };
})();
