/* base.js —— Academy 部署坐标唯一真源（monorepo Phase 4）
 * Pages 项目站部署在 /openfinlens/ 子路径下；本地 serve.mjs 跑在根路径。
 * 站内资源一律相对路径（天然免疫前缀）；本文件只管两件事：
 *   1. 跨站绝对链接（跳终端/分享/canonical/sitemap）的统一拼接基准；
 *   2. canonical/og:url 的静态回退值随部署常量收敛为一处。
 * 必须最先加载（jsonld.js / cross.js / 各视图都读 window.ACADEMY_SITE）。 */
(function () {
  var SUB = '/openfinlens';                                   // Pages 项目站子路径（部署常量）
  var path = location.pathname;
  var ON_SUB = path === SUB || path.indexOf(SUB + '/') === 0;
  var ORIGIN = 'https://5777-wq.github.io';                   // SEO canonical 的正式域名
  window.ACADEMY_SITE = {
    sub: ON_SUB ? SUB : '',                                   // ''（本地根路径）或 '/openfinlens'
    selfUrl: ORIGIN + (ON_SUB ? SUB : '') + '/academy/',      // 本站 canonical/sitemap 基
    lensUrl: ORIGIN + (ON_SUB ? SUB : '') + '/',              // 主终端入口
  };
})();
