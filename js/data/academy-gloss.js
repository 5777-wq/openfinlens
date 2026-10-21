/* academy-gloss.js —— 指向「白话金融 OpenFin Academy」的解释入口
   终端里鼠标靠近一个标的时，除了本站的一句话解释，再给一条去科普站读完整解释的路。

   纪律：只映射两边都真实存在的内容——科普站没有某标的的一页，就不假装有，
   那时给的是"去科普站里搜这个词"，而不是一个点进去什么都没有的假链接。 */

const AcademyGloss = (() => {
  const BASE = 'https://5777-wq.github.io/openfin-academy/';

  // symbol → 科普站术语 id（#/term/<id>）
  const TERM_BY_SYMBOL = {
    // ---- 商品 ----
    'EM:101.GC00Y': 'gold',          // COMEX 黄金
    'EM:102.CL00Y': 'crude-oil',     // NYMEX 原油

    // ---- 指数 ----
    'usIXIC': 'nasdaq',              // 纳斯达克
    'sh000001': 'a-share',           // 上证指数
    'sz399001': 'a-share',           // 深证成指
    'sz399006': 'a-share',           // 创业板指
    'sh000688': 'a-share',           // 科创50

    // ---- 利率：长端是「无风险利率」，短端看的是「收益率曲线」 ----
    'EM:171.US10Y': 'risk-free-rate',
    'EM:171.US30Y': 'risk-free-rate',
    'EM:171.CN10Y': 'risk-free-rate',
    'EM:171.US2Y': 'yield-curve',
    'EM:171.US3M': 'yield-curve',
    'EM:171.US5Y': 'yield-curve',
    'EM:171.CN2Y': 'yield-curve',
    'EM:171.CN5Y': 'yield-curve',
    'EM:171.CN30Y': 'yield-curve',

    // ---- 高股息标的 ----
    'sh601398': 'dividend',          // 工商银行
    'sh601288': 'dividend',          // 农业银行
    'sh601988': 'dividend',          // 中国银行
    'hk01398': 'dividend',          // 工商银行（H）
    'hk00941': 'dividend',          // 中国移动
    'hk00005': 'dividend',          // 汇丰控股
    'hk00883': 'dividend',          // 中国海洋石油
    'sh601088': 'dividend',          // 中国神华
  };

  // 非行情标的：ETF / 场内指数基金
  const ETF_TERM = 'etf';

  /**
   * 这次悬停该跳科普站的哪儿。
   * @param {string} symbol 行情 symbol（可空）
   * @param {string} name 标的名称
   * @param {string} [termId] 已知的术语 id（ETF 之类按类目给的）
   * @returns {{href:string,label:string}|null}
   */
  function targetFor(symbol, name, termId) {
    const id = termId || TERM_BY_SYMBOL[symbol];
    if (id) {
      return { href: BASE + '#/term/' + encodeURIComponent(id), label: '在白话金融里看完整解释 ↗' };
    }
    const q = String(name || '').trim();
    if (!q) return null;
    return {
      href: BASE + '#/search?q=' + encodeURIComponent(q),
      label: '在白话金融里查「' + q + '」↗',
    };
  }

  return { BASE, TERM_BY_SYMBOL, ETF_TERM, targetFor };
})();

window.AcademyGloss = AcademyGloss;
