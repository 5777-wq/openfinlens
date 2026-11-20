/* js/zones.js —— 二级分区（一级 tab 下的第二层）的纯逻辑

   为什么单独抽一个模块：分区判定看起来是 DOM 操作，其实是两组正交的可见性规则，
   很容易写错而且错了很难看出来（"分区栏不见了"而不是"某个按钮点不动"）。
   所以把判定部分做成纯函数，DOM 只负责把结论落地——这样能单测。

   两组正交规则：
   ① tab 维度（hidden 属性）：这个市场有没有这一块内容。
   ② 分区维度（zone-off 类）：这一屏看哪一块。
   两者都要看，只看其中之一必然出错：
   - 只看 hidden → 切到别的分区后元素仍"可见"（热力图 canvas 尺寸为 0，画出来是黑的）
   - 只看 zone-off → 分区自己藏自己，下一轮就以为这个分区没内容了（自锁）

   纯函数不碰 DOM，可离线单测（_test/zones.test.mjs）。 */

(function (global) {
  'use strict';

  /* 分区定义。顺序即导航条上的顺序，"概览"永远排第一（它是默认落点）。 */
  const ZONE_DEFS = [
    { key: 'overview', label: '概览' },
    { key: 'focus', label: '焦点' },
    { key: 'heat', label: '热力图' },
    { key: 'sentiment', label: '情绪' },
    { key: 'disclosure', label: '披露' },
  ];

  /* 导航条右侧的一句话提示：告诉用户这一分区在看什么 */
  const ZONE_HINTS = {
    overview: '行情卡片与自选',
    focus: '涨跌幅与成交额三榜',
    heat: '全市场分布',
    sentiment: '市场宽度与温度',
    disclosure: '监管披露的持仓与席位',
  };

  /* 可用分区表。
     nodes: [{ zone, hidden }] —— hidden 只表示 tab 维度的显隐（不表示分区维度）。
     判定只看 tab 维度：若把分区维度也读进来会自锁——
     上一轮分区把元素藏起来，这一轮就会以为这个分区没有内容。 */
  function availability(nodes) {
    const map = {};
    (nodes || []).forEach(n => {
      if (!n || !n.zone) return;
      const z = n.zone;
      if (map[z] === undefined) map[z] = false;
      if (!n.hidden) map[z] = true;
    });
    return map;
  }

  /* 按定义顺序排出可用的分区 key */
  function keysOf(avail) {
    return ZONE_DEFS.filter(d => avail && avail[d.key]).map(d => d.key);
  }

  /* 只有一个分区时不显示导航条：一条只有一个选项的导航不是导航，是噪音 */
  function shouldShowBar(keys) {
    return Array.isArray(keys) && keys.length >= 2;
  }

  /* 当前分区在新集合里失效时回落到第一个 */
  function resolveZone(keys, current) {
    if (!keys || !keys.length) return null;
    return keys.indexOf(current) >= 0 ? current : keys[0];
  }

  /* 把某个分区设为当前：非当前分区的节点打上 zone-off，当前分区的节点排队号（--zi）。
     只用 classList / style.setProperty / getAttribute 三个接口，
     所以能用假 DOM 直接单测——"点一下热力图，概览的内容真的藏起来了吗"
     这种问题不该只能靠肉眼验。 */
  function applyTo(nodes, key) {
    const list = Array.prototype.slice.call(nodes || []);
    let i = 0;
    list.forEach(n => {
      if (!n) return;
      const on = n.getAttribute('data-zone') === key;
      n.classList.toggle('zone-off', !on);
      if (on) {
        n.classList.remove('zone-in');
        n.style.setProperty('--zi', String(i++));
      }
    });
    return i;   // 当前分区里的节点数
  }

  global.Zones = {
    ZONE_DEFS, ZONE_HINTS,
    availability, keysOf, shouldShowBar, resolveZone, applyTo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
