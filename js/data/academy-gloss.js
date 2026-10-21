/* academy-gloss.js —— 指向「白话金融 OpenFin Academy」的解释入口
   终端里鼠标靠近一个标的时，除了本站的一句话解释，再给一条去科普站读完整解释的路。

   纪律：链接必须诚实到"点进去就知道会看到什么"。
     · 精确页：这个符号的主体就是这个词（科创50 → 科创50 的解释）——点进去就是它自己。
     · 概念页：这个符号只是某个概念的一个代表（工商银行 → 股息/分红的解释）——文案里写出是哪个概念。
     · 搜索页：科普站没有这一页——只给"去科普站里搜这个词"，不做点进去扑空的假入口。
   宁可给搜索页，也不给一个主体对不上的页面。 */

const AcademyGloss = (() => {
  const BASE = 'https://5777-wq.github.io/openfin-academy/';

  // 精确页：symbol → 科普站术语 id
  const TERM_BY_SYMBOL = {
    // ---- A 股四大指数（各是各的，不许一律指到「A股」） ----
    'sh000001': 'sse-index',           // 上证指数
    'sz399001': 'szse-component',      // 深证成指
    'sz399006': 'chinext',             // 创业板指
    'sh000688': 'kechuang-50',         // 科创50
    // ---- 海外指数 ----
    'usIXIC': 'nasdaq',                // 纳斯达克
    'usINX': 'sp500',                  // 标普500
    'usDJI': 'dow-jones',              // 道琼斯
    'hkHSI': 'hsi',                    // 恒生指数
    'EM:100.N225': 'nikkei',           // 日经225
    // ---- 商品与汇率 ----
    'EM:101.GC00Y': 'gold',            // COMEX 黄金
    'EM:102.CL00Y': 'crude-oil',       // NYMEX 原油
    'EM:101.SI00Y': 'silver',          // COMEX 白银
    'EM:100.UDI': 'dollar-index',      // 美元指数
    // ---- 利率 ----
    'EM:171.US10Y': 'risk-free-rate',  // 美债10年：无风险利率本人
  };

  // 概念页：symbol → { id, name }——这个符号只是这个概念的一个代表
  const CONCEPT_BY_SYMBOL = {
    // 长端利率是"无风险利率"这个概念的代表（短端看的是曲线）
    'EM:171.US30Y': { id: 'risk-free-rate', name: '无风险利率' },
    'EM:171.CN10Y': { id: 'risk-free-rate', name: '无风险利率' },
    'EM:171.US2Y': { id: 'yield-curve', name: '收益率曲线' },
    'EM:171.US3M': { id: 'yield-curve', name: '收益率曲线' },
    'EM:171.US5Y': { id: 'yield-curve', name: '收益率曲线' },
    'EM:171.CN2Y': { id: 'yield-curve', name: '收益率曲线' },
    'EM:171.CN5Y': { id: 'yield-curve', name: '收益率曲线' },
    'EM:171.CN30Y': { id: 'yield-curve', name: '收益率曲线' },
    // 高股息标的：它们是"股息/分红"这个概念的代表
    'sh601398': { id: 'dividend', name: '股息 / 分红' },   // 工商银行
    'sh601288': { id: 'dividend', name: '股息 / 分红' },   // 农业银行
    'sh601988': { id: 'dividend', name: '股息 / 分红' },   // 中国银行
    'hk01398': { id: 'dividend', name: '股息 / 分红' },   // 工商银行（H）
    'hk00941': { id: 'dividend', name: '股息 / 分红' },   // 中国移动
    'hk00005': { id: 'dividend', name: '股息 / 分红' },   // 汇丰控股
    'hk00883': { id: 'dividend', name: '股息 / 分红' },   // 中国海洋石油
    'sh601088': { id: 'dividend', name: '股息 / 分红' },   // 中国神华
  };

  /**
   * 这次悬停该跳科普站的哪儿。
   * @param {string} symbol 行情 symbol（可空）
   * @param {string} name 标的名称
   * @returns {{href:string,kind:string,label:string}|null}
   */
  function targetFor(symbol, name) {
    const exact = TERM_BY_SYMBOL[symbol];
    if (exact) {
      return {
        href: BASE + '#/term/' + encodeURIComponent(exact),
        kind: 'exact',
        label: '在白话金融里看完整解释 ↗',
      };
    }
    const concept = CONCEPT_BY_SYMBOL[symbol];
    if (concept) {
      return {
        href: BASE + '#/term/' + encodeURIComponent(concept.id),
        kind: 'concept',
        label: '在白话金融里看「' + concept.name + '」的解释 ↗',
      };
    }
    const q = String(name || '').trim();
    if (!q) return null;
    return {
      href: BASE + '#/search?q=' + encodeURIComponent(q),
      kind: 'search',
      label: '在白话金融里查「' + q + '」↗',
    };
  }

  return { BASE, TERM_BY_SYMBOL, CONCEPT_BY_SYMBOL, targetFor };
})();

window.AcademyGloss = AcademyGloss;
