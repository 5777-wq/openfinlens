/* site/disclaimer.js —— 全站免责声明（页脚 + 各视图内嵌）
   写作指南要求「文首、文末、每页页脚」三处都要有免责声明。
   以前只有文章页、危机页、词条页有，索引页 / 标的页 / 产业链页都没有——
   读者在那些页面上翻不到任何提示。这个模块把文案收到一处，各视图共用，
   免得每个视图各抄一份、改一处漏三处。 */
(function () {
  'use strict';

  const ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';

  /** 内嵌的一条：<div class="disclaimer">…</div> */
  function inline(text) {
    return `<div class="disclaimer">${ICON}<span>${text}</span></div>`;
  }

  window.Site = window.Site || {};
  window.Site.disclaimer = {
    ICON,
    inline,
    // 正文页：讲机制和数据
    ARTICLE: inline('本文只讲机制和数据，不构成投资建议。数据来自第三方公开接口，有延迟、会出错。'),
    // 危机复盘：历史不预测未来
    CRISIS: inline('历史复盘不预测未来。市场结构、监管环境和参与者都和当年不同。'),
    // 索引 / 列表 / 标的 / 产业链：通用一条
    GENERIC: inline('本站只做金融知识科普，不构成投资建议，不推荐任何具体产品，不预测市场走势。'),
  };
})();
