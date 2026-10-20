/* js/tabscope.js —— 顶栏板块的顺序与显隐（纯逻辑，无 DOM 无网络）
 *
 * 为什么要有这个模块：
 * 顶栏的板块顺序与显隐原先是写死在 index.html 里的静态标签。
 * 用户要能自己调（"tag 顺序应该有设置可以自定义调整（顺序和是否显示）"），
 * 就必须有一份"合法配置"的定义放在纯函数里——
 * 校验、去重、兜底都在这里，才能单测；
 * app.js 只负责把结果落到 DOM 上。
 *
 * 三条硬约束（不满足就回落默认，不给用户半残的界面）：
 *   ① 「全部」永远可见且排第一：它是总览入口，藏了或往后排会让人找不到回来的路。
 *   ② 加密板块受合规开关控制：开关关掉时它连设置项里都不该出现。
 *   ③ 至少留两个可见板块：只留一个时顶栏退化成单按钮，导航就没意义了。 */

(function (global) {
  'use strict';

  // 全部可用板块（顺序即默认顺序）。label 是设置项里显示的名字。
  const TAB_DEFS = [
    { key: 'all', label: '全部', fixed: true },   // 固定首位
    { key: 'cn', label: 'A股' },
    { key: 'hk', label: '港股' },
    { key: 'us', label: '美股' },
    { key: 'crypto', label: '加密', cryptoOnly: true },
    { key: 'fxmacro', label: '宏观' },
    { key: 'events', label: '事件' },
    { key: 'chain', label: '产业链' },
    { key: 'watch', label: '自选' },
    { key: 'portfolio', label: '持仓' },
    { key: 'compare', label: '基金' },
  ];

  const DEFAULT_ORDER = TAB_DEFS.map(d => d.key);

  const byKey = {};
  TAB_DEFS.forEach(d => { byKey[d.key] = d; });

  /* 规范化一份用户配置 → { order: [...], hidden: [...] }
   * cfg: { order?: string[], hidden?: string[] }
   * cryptoOk: 合规开关（关掉时加密不在可用集合里）
   *
   * 兜底规则：
   *   · 未知 key 丢掉（配置可能来自旧版本）
   *   · 重复 key 去重
   *   · 「全部」强制置顶且不可隐藏
   *   · 隐藏后可见数不足 2 → 撤销隐藏（只留一个板块的顶栏没有导航意义）
   */
  function normalize(cfg, cryptoOk) {
    const c = cfg || {};
    const usable = new Set(TAB_DEFS.filter(d => !d.cryptoOnly || cryptoOk).map(d => d.key));

    // 顺序：先取用户顺序里合法且可用的，再补上没出现过的（按默认顺序追加）
    const seen = new Set();
    const order = [];
    (Array.isArray(c.order) ? c.order : []).forEach(k => {
      if (typeof k === 'string' && usable.has(k) && !seen.has(k)) { seen.add(k); order.push(k); }
    });
    DEFAULT_ORDER.forEach(k => {
      if (usable.has(k) && !seen.has(k)) { seen.add(k); order.push(k); }
    });

    // 「全部」固定置顶
    const allIdx = order.indexOf('all');
    if (allIdx > 0) { order.splice(allIdx, 1); order.unshift('all'); }

    // 隐藏集合：只认合法可用且不是「全部」的
    let hidden = new Set((Array.isArray(c.hidden) ? c.hidden : [])
      .filter(k => typeof k === 'string' && usable.has(k) && k !== 'all'));

    // 可见数不足 2 → 撤销隐藏（优先保留靠前的，恢复用户最近藏掉的那个太绕，
    // 这里直接把隐藏集合清空：宁可全显示，也不要一个只剩一个板块的顶栏）
    if (order.length - hidden.size < 2) hidden = new Set();

    return { order, hidden: Array.from(hidden) };
  }

  /* 应用配置 → 实际要渲染的板块列表（已排序、已过滤） */
  function visibleTabs(cfg, cryptoOk) {
    const n = normalize(cfg, cryptoOk);
    return n.order.filter(k => n.hidden.indexOf(k) < 0);
  }

  /* 移动一个板块（上移/下移），返回新的 order。
   * 「全部」固定在首位，不参与移动。 */
  function move(order, key, dir) {
    const list = (Array.isArray(order) ? order.slice() : DEFAULT_ORDER.slice());
    const i = list.indexOf(key);
    if (i < 0) return list;
    const j = dir < 0 ? i - 1 : i + 1;
    if (j <= 0 || j >= list.length) return list;    // 「全部」在 0 位，不许越过
    const t = list[i]; list[i] = list[j]; list[j] = t;
    return list;
  }

  /* 切换某板块的显隐，返回新的 hidden 集合。
   * 「全部」不可隐藏；隐藏到只剩一个可见时拒绝（返回原集合）。 */
  function toggleHidden(cfg, key, cryptoOk) {
    const n = normalize(cfg, cryptoOk);
    if (key === 'all' || !n.order.includes(key)) return n.hidden;
    const hidden = new Set(n.hidden);
    if (hidden.has(key)) {
      hidden.delete(key);
    } else {
      if (n.order.length - hidden.size - 1 < 2) return n.hidden;   // 藏了就只剩 <2 个可见
      hidden.add(key);
    }
    return Array.from(hidden);
  }

  function labelOf(key) {
    return (byKey[key] && byKey[key].label) || key;
  }

  global.TabScope = {
    TAB_DEFS, DEFAULT_ORDER,
    normalize, visibleTabs, move, toggleHidden, labelOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
