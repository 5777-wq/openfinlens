/* auniverse.js —— A股全市场行的分类：哪些是"个股"，哪些是"指数"（纯函数，无 DOM 无网络）
 *
 * 为什么需要它（2026-10-20）：
 *   东财全市场接口（clist fs=m:0+t:6,...）会把各板块的**头条指数**一起返回：
 *   上证指数(000001)、深证成指(399001)、创业板指(399006)、科创50(000688)……
 *   这些不是成分股，是成分股的加权聚合。混进"全市场"热力图有三个后果：
 *     1) 面积失真——指数的"总市值"是成分股市值之和，等于把同一批市值算了两遍；
 *     2) 视觉被吃掉——指数块天然巨大（截图里 4 个指数占了约一半可见面积），
 *        而这些数字在顶部「关键指数」和跑马灯里本来就有一份；
 *     3) **宽度口径被污染**——热力图/市场宽度/Movers 三榜共用同一批行，
 *        指数会被算进"上涨家数""下跌家数""涨停家数"里。家数只该数个股。
 *   所以过滤放在**数据源**：一次过滤，三个消费方同时受益。
 *
 * 判定信号（三条，都可离线单测）：
 *   1) 代码段：399xxx（深市指数段）、899xxx（北证指数段）——这两个段位没有个股占用；
 *   2) 指数名称前缀：上证/深证/创业板/科创/北证/中证/沪深/国证…… 个股名不会以这些词开头
 *      （反例警示：不能把"新华"加进去——新华保险/新华银行是正经个股）；
 *   3) 名称以"指数"结尾。
 *
 *   名称前缀规则**只对沪深行生效**：美股有一只股票就叫 MSCI（MSCI Inc），
 *   不设市场守卫就会把真股票当指数剔掉。
 */

const AUniverse = (() => {

  // 代码段：深市指数段 + 北证指数段（无个股占用）
  const INDEX_CODE_RE = /^(399|899)/;

  // 指数名称前缀（个股名不会以这些词开头）
  const INDEX_NAME_PREFIX_RE = /^(上证|深证|创业板|科创|北证|中证|沪深|国证)/;

  // 名称以"指数"结尾
  const INDEX_NAME_SUFFIX_RE = /指数$/;

  const CN_MARKETS = [0, 1];   // 东财市场码：0=深 1=沪

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /* 这一行是不是指数？入参是 clist 的原始字段映射（code/f13/f14）。 */
  function isIndexRow(row) {
    if (!row) return false;
    const code = String(row.code || '');
    if (INDEX_CODE_RE.test(code)) return true;
    const mkt = num(row.market !== undefined ? row.market : row.f13);
    if (!CN_MARKETS.includes(mkt)) return false;      // 只对沪深行套名称规则
    const name = String(row.name || row.f14 || '');
    if (INDEX_NAME_PREFIX_RE.test(name)) return true;
    if (INDEX_NAME_SUFFIX_RE.test(name)) return true;
    return false;
  }

  /* 列表过滤：剔除指数行（返回新数组，不改原数组） */
  function withoutIndices(rows) {
    return (Array.isArray(rows) ? rows : []).filter(r => !isIndexRow(r));
  }

  return { INDEX_CODE_RE, INDEX_NAME_PREFIX_RE, INDEX_NAME_SUFFIX_RE, CN_MARKETS, isIndexRow, withoutIndices };
})();

if (typeof window !== 'undefined') window.AUniverse = AUniverse;
if (typeof module !== 'undefined' && module.exports) module.exports = AUniverse;
