/* base.js —— Academy 部署坐标唯一真源（monorepo Phase 4）
 * Pages 项目站部署在 /openfinlens/ 子路径下；本地 serve.mjs 跑在根路径。
 * 站内资源一律相对路径（天然免疫前缀）；本文件管两件事：
 *   1. 跨站链接（跳终端）的统一拼接基准——相对路径，换域/换子路径/本地根路径通吃；
 *   2. canonical/og:url / sitemap 的绝对基（SEO 用，随部署常量收敛为一处）。
 * 必须最先加载（jsonld.js / cross.js / 各视图都读 window.ACADEMY_SITE）。 */
(function () {
  var SUB = '/openfinlens';                                   // Pages 项目站子路径（部署常量）
  var path = location.pathname;
  var ON_SUB = path === SUB || path.indexOf(SUB + '/') === 0;
  var ORIGIN = 'https://5777-wq.github.io';                   // SEO canonical 的正式域名
  /* 终端入口的相对基准。本站永远部署在终端根的下一级目录：
       Pages  /openfinlens/academy/ → 终端根 /openfinlens/
       本地   /academy/（终端在 /）  → 终端根 /
     页面文件就是本目录的 index.html（hash 路由不再往深处走），
     相对 URL 以**文档所在目录**为基准解析，所以「回终端」永远是往上一级：
     '../index.html' 在三处拓扑都落回终端根，且 academy 单独打开时父目录
     仍是同站——不跳出。（原来的部署站绝对地址在本地/同仓打开会跳到线上。） */
  window.ACADEMY_SITE = {
    sub: ON_SUB ? SUB : '',                                   // ''（本地根路径）或 '/openfinlens'
    selfUrl: ORIGIN + (ON_SUB ? SUB : '') + '/academy/',      // 本站 canonical/sitemap 基（SEO，保持绝对）
    lensUrl: '../index.html',                                 // 主终端入口（相对，同站跳转）
  };
})();
