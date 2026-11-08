/* js/ui/navmap.js —— 一级 ↔ 二级映射（纯函数，无 DOM 无网络）
 * ---------------------------------------------------------------------------
 * 为什么要有这一层（UI v2 · 信息架构 12 → 5）：
 *   顶栏原来是 12 个平铺板块，用户要滚三屏才知道自己在哪。v2 收成 5 个一级
 *   （市场/事件/资产/基金/洞察）+ 按需出现的二级 segmented control。
 *
 * 硬约束：**内部 state.tab 的旧 key 全部保留**（all/cn/hk/us/crypto/fxmacro/
 *   option/events/chain/watch/portfolio/compare）。深链、js/tabscope.js、
 *   js/zones.js、js/marketscope.js 与既有测试全都依赖这 12 个 key——
 *   所以映射只做"展示层分组"，不重命名任何 state。
 *
 * 全部函数纯、可离线单测：不碰 document / location / localStorage。
 * 导出面（Lead 的 _test/navmap.test.mjs 卡死）：
 *   PRIMARY_DEFS / tabToPrimary / primaryOf / defaultTabOf / childrenOf /
 *   needSubBar / parseHash / buildHash
 * ------------------------------------------------------------------------- */

(function (global) {
  'use strict';

  /* 一级 → 子项。顺序即展示顺序；12 个旧 key 必须恰好各被认领一次。 */
  const PRIMARY_DEFS = [
    { key: 'market', label: '市场', children: ['all', 'cn', 'hk', 'us', 'crypto', 'fxmacro', 'option'] },
    { key: 'events', label: '事件', children: ['events'] },
    { key: 'assets', label: '资产', children: ['watch', 'portfolio'] },
    { key: 'fund', label: '基金', children: ['compare'] },
    { key: 'insight', label: '洞察', children: ['chain'] },
  ];

  const DEFAULT_PRIMARY = PRIMARY_DEFS[0].key;               // 'market'
  const DEFAULT_TAB = PRIMARY_DEFS[0].children[0];           // 'all'

  // 反查表：state.tab → 一级 key
  const TAB_TO_PRIMARY = Object.create(null);
  const PRIMARY_BY_KEY = Object.create(null);
  PRIMARY_DEFS.forEach(function (p) {
    PRIMARY_BY_KEY[p.key] = p;
    p.children.forEach(function (child) { TAB_TO_PRIMARY[child] = p.key; });
  });

  /* 旧 key 的子项清单（顺序稳定，供设置面板分组与控制台排错用） */
  const ALL_TABS = PRIMARY_DEFS.reduce(function (acc, p) { return acc.concat(p.children); }, []);

  function isPrimary(key) {
    return typeof key === 'string' && !!PRIMARY_BY_KEY[key];
  }

  /* state.tab → 一级 key；未知（含 null/undefined）返回 null */
  function tabToPrimary(tab) {
    if (typeof tab !== 'string') return null;
    return TAB_TO_PRIMARY[tab] || null;
  }

  /* 语义化别名：读起来更像"这属于哪一级"（tabToPrimary 的同一份实现） */
  function primaryOf(tab) {
    return tabToPrimary(tab);
  }

  /* 一级的子项清单（副本：外部排序不会污染映射表） */
  function childrenOf(primary) {
    const p = PRIMARY_BY_KEY[primary];
    return p ? p.children.slice() : [];
  }

  /* 一级的默认落点 = 第一个子项；未知一级回落 'all' */
  function defaultTabOf(primary) {
    const p = PRIMARY_BY_KEY[primary];
    return p ? p.children[0] : DEFAULT_TAB;
  }

  /* 二级条是否该出现：子项 ≥2。单子项的一级（事件/基金/洞察）不为了
     "有导航"而造导航——二级条只剩一个按钮时它只是噪音。 */
  function needSubBar(primary) {
    const p = PRIMARY_BY_KEY[primary];
    return !!p && p.children.length >= 2;
  }

  function labelOfPrimary(primary) {
    const p = PRIMARY_BY_KEY[primary];
    return p ? p.label : primary;
  }

  /* 解析 hash。两种形态都要认：
   *   新：#tab=market&sub=cn   → { tab:'cn',  sub:'cn',  primary:'market' }
   *   旧：#tab=cn              → { tab:'cn',  sub:null,  primary:'market' }
   *   只有一级：#tab=market     → { tab:'all', sub:'all', primary:'market' }（落到默认子项）
   *   空 / '#tab=' / 未知 key / null / undefined → 默认落点，绝不返回空。
   * 说明：旧 key 的 hash 里 sub 留 null——`state.tab` 已经表达了它，
   * 再回填 sub 会让调用方误以为用户明确点了二级。
   */
  function parseHash(hash) {
    const fallback = { tab: DEFAULT_TAB, sub: null, primary: DEFAULT_PRIMARY };
    if (hash === null || hash === undefined) return fallback;
    let h = String(hash).trim();
    if (!h) return fallback;
    // 允许传完整 URL / 带前导 # 的片段
    const qi = h.indexOf('?');
    if (qi >= 0) h = h.slice(qi + 1);
    if (h.charAt(0) === '#') h = h.slice(1);
    if (!h) return fallback;

    const q = Object.create(null);
    h.split('&').forEach(function (pair) {
      if (!pair) return;
      const eq = pair.indexOf('=');
      const k = (eq < 0 ? pair : pair.slice(0, eq)).trim().toLowerCase();
      let v = eq < 0 ? '' : pair.slice(eq + 1);
      try { v = decodeURIComponent(v); } catch (e) { /* 畸形 % 序列按原样用 */ }
      if (k) q[k] = v;
    });

    const rawTab = (q.tab || '').trim().toLowerCase();
    if (!rawTab) return fallback;

    // ① 一级 key：由 sub 决定子项（非法/缺失 sub → 该一级的默认子项）
    if (isPrimary(rawTab)) {
      const kids = PRIMARY_BY_KEY[rawTab].children;
      const wantSub = (q.sub || '').trim().toLowerCase();
      const sub = kids.indexOf(wantSub) >= 0 ? wantSub : kids[0];
      return { tab: sub, sub: sub, primary: rawTab };
    }

    // ② 旧深链（子项 key 直接当 tab）：原样保留，primary 反查
    const p = TAB_TO_PRIMARY[rawTab];
    if (p) return { tab: rawTab, sub: null, primary: p };

    // ③ 未知 key：回默认落点（深链指向已删除板块时不让页面空转）
    return fallback;
  }

  /* 造 hash。与 parseHash 往返一致：
   *   buildHash('cn')                  → '#tab=market&sub=cn'
   *   buildHash('market', {sub:'us'})  → '#tab=market&sub=us'
   *   buildHash('market')              → '#tab=market&sub=all'
   *   buildHash('未知')                → '#tab=market&sub=all'
   * 一级 key + 非法 sub 时按该一级默认子项收口。
   */
  function buildHash(tab, opts) {
    const o = opts || {};
    let target;
    if (isPrimary(tab)) {
      const kids = PRIMARY_BY_KEY[tab].children;
      target = kids.indexOf(o.sub) >= 0 ? o.sub : kids[0];
    } else if (tabToPrimary(tab)) {
      target = tab;
    } else {
      target = DEFAULT_TAB;
    }
    const p = tabToPrimary(target) || DEFAULT_PRIMARY;
    return '#tab=' + p + '&sub=' + target;
  }

  const API = {
    PRIMARY_DEFS: PRIMARY_DEFS,
    ALL_TABS: ALL_TABS,
    DEFAULT_PRIMARY: DEFAULT_PRIMARY,
    DEFAULT_TAB: DEFAULT_TAB,
    isPrimary: isPrimary,
    tabToPrimary: tabToPrimary,
    primaryOf: primaryOf,
    childrenOf: childrenOf,
    defaultTabOf: defaultTabOf,
    needSubBar: needSubBar,
    labelOfPrimary: labelOfPrimary,
    parseHash: parseHash,
    buildHash: buildHash,
  };

  // 契约名是 Navmap；同时留一个 NavMap 别名，避免大小写差异把调用方坑掉
  global.Navmap = API;
  global.NavMap = API;
})(typeof window !== 'undefined' ? window : globalThis);
