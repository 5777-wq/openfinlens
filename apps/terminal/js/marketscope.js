/* js/marketscope.js —— 市场维度的归属判定（纯逻辑，无 DOM 无网络）
 *
 * 为什么要有这个模块：
 * 市场这个维度在界面上被表达过两次——一级 tab（A股/港股/美股/加密）
 * 和热力图工具栏自己带的四个市场按钮。两处都能改同一个维度，
 * 就会打架：在一级 tab 停在「A股」时点一下工具栏里的「美股全市场」，
 * 画布变成美股，页面标题却还写着「A股市场」，Movers 三榜还是 A 股的。
 * 用户看到的就是"这叫什么话"。
 *
 * 正确的关系是：市场维度只由一级 tab 决定，下层不许再表达一次。
 * 本模块把这条规则写成可单测的纯函数——
 * 判定错了不该只能靠肉眼发现（"标签栏不见了"而不是"某个按钮点不动"）。
 *
 * 规则细则：
 *   ① 一级 tab 是具体市场（cn/hk/us/crypto）→ 该市场独占热力图，
 *      工具栏里的市场切换按钮整组撤掉（市场已由 tab 表达过一遍，
 *      再表达一次就是矛盾的来源）。
 *   ② 一级 tab 是「全部」→ 它本身不对应任何单一市场，
 *      热力图市场需要用户自己选，所以切换按钮组在这里保留是合法的。
 *   ③ 加密内容开关关闭时，加密那一档随市场一起消失。
 *
 * 纯函数不碰 DOM，可离线单测（_test/marketscope.test.mjs）。 */

(function (global) {
  'use strict';

  // 有热力图的市场。键与 state.heatMode / 一级 tab 的取值一致。
  const HEAT_MARKETS = ['cn', 'hk', 'us', 'crypto'];

  // 一级 tab → 它的市场归属。null = 该 tab 不属于任何单一市场。
  const TAB_MARKET = {
    all: null,
    cn: 'cn',
    hk: 'hk',
    us: 'us',
    crypto: 'crypto',
    fxmacro: null,
    events: null,
    chain: null,
    watch: null,
    portfolio: null,
    compare: null,
  };

  /* 当前 tab 下的热力图市场。
   * 返回 null 表示"这一屏没有单一市场归属，热力图市场由用户选"。
   * cryptoOk 由调用方传入：合规开关关闭时加密档整体消失。 */
  function heatMarketOf(tab, cryptoOk) {
    const m = TAB_MARKET[tab];
    if (!m) return null;
    if (m === 'crypto' && !cryptoOk) return null;
    return m;
  }

  /* 这一屏是否该出现热力图区。
   * 「全部」返回 true（市场由用户选），具体市场返回 true（市场已定），
   * 宏观/事件/产业链等与行情无关的 tab 返回 false。 */
  function showsHeat(tab, cryptoOk) {
    if (tab === 'all') return true;
    return heatMarketOf(tab, cryptoOk) !== null;
  }

  /* 工具栏里的市场切换按钮组是否该出现。
   * 只有当这一屏没有自己的市场归属（「全部」）时才需要它——
   * 那时它是唯一的市场选择入口，保留不构成"表达两次"。
   * 具体市场 tab 下必须撤掉，否则用户能在 A股 页里切出美股热力图。 */
  function showsMarketSwitcher(tab, cryptoOk) {
    if (tab === 'all') return true;
    return TAB_MARKET[tab] === undefined;
  }

  /* 市场的中文名，给副标题/说明文字用。 */
  const MARKET_LABEL = {
    cn: 'A股',
    hk: '港股',
    us: '美股',
    crypto: '加密',
  };

  /* 市场在热力图工具栏上的完整称谓（与按钮文案一致）。 */
  const MARKET_TITLE = {
    cn: 'A股全市场',
    hk: '港股全市场',
    us: '美股全市场',
    crypto: '加密市值',
  };

  function marketLabel(m) {
    return MARKET_LABEL[m] || '';
  }

  function marketTitle(m) {
    return MARKET_TITLE[m] || '';
  }

  /* ==================== 数据源告警的相关性 ====================
     页脚的"数据源响应异常"原先统计**所有**源的失败，于是：
     产业链页的数据完全正常，但 A 股全市场源在降级 → 用户在产业链页
     也会看到一条红色告警。告警与自己眼前的数据无关，就成了噪音，
     真出问题时反而被稀释。

     所以要按"这一屏实际用到哪些源"来判定。
     源 → 页面 的映射写死在这里（纯数据，可单测）：
       tencent/eastmoney  行情主源，所有行情页
       em-clist           A股全市场（热力图/宽度/三榜）→ A股页、全部页
       em-board           板块榜 → 产业链页
       lhb                龙虎榜 → A股页
       brk                13F → 美股页
       news/sina          新闻快讯 → 事件页
       gdelt              全球事件 → 事件页
       forecast           预测市场 → 事件页
       worldbank          世行年度指标 → 宏观页
       fred               利率序列 → 宏观页
       history            基金长历史 → 基金页
       em-search          搜索（任何页都可能用）→ 视为全局
       binance/okx        加密行情 → 加密页 */

  const TAB_SOURCES = {
    all: ['tencent', 'eastmoney', 'em-clist'],
    cn: ['tencent', 'eastmoney', 'em-clist', 'lhb'],
    hk: ['tencent', 'eastmoney'],
    us: ['tencent', 'eastmoney', 'brk'],
    crypto: ['tencent', 'binance', 'okx'],
    fxmacro: ['tencent', 'eastmoney', 'worldbank', 'fred'],
    events: ['tencent', 'news', 'sina', 'gdelt', 'forecast'],
    chain: ['tencent', 'eastmoney', 'em-board'],
    watch: ['tencent', 'eastmoney'],
    portfolio: ['tencent', 'eastmoney'],
    compare: ['history', 'eastmoney', 'tencent'],
  };

  /* 任何页面都可能用到的源（搜索是全局的）：它们坏了任何页都该提示 */
  const GLOBAL_SOURCES = ['em-search'];

  /* 这一屏该关注哪些源。tab 未知时返回全部（宁可多报不漏报）。 */
  function relevantSources(tab) {
    const list = TAB_SOURCES[tab];
    if (!list) return null;    // null = 不筛选（全部源都算）
    return list.concat(GLOBAL_SOURCES);
  }

  /* 从 SourceState 的条目里挑出"与当前页相关且失败"的源。
   * items: [[key, {ok, via, msg}]]（SourceState.all() 的形状）
   * 返回相关且失败的 key 数组。 */
  function failingSources(items, tab) {
    const rel = relevantSources(tab);
    const bad = [];
    for (const [k, v] of (items || [])) {
      if (!v || v.ok) continue;
      if (rel && rel.indexOf(k) < 0) continue;   // 与本页无关的源不算
      bad.push(k);
    }
    return bad;
  }

  global.MarketScope = {
    HEAT_MARKETS,
    TAB_MARKET,
    TAB_SOURCES,
    heatMarketOf,
    showsHeat,
    showsMarketSwitcher,
    marketLabel,
    marketTitle,
    relevantSources,
    failingSources,
  };
})(typeof window !== 'undefined' ? window : globalThis);
