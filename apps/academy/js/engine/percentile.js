/* engine/percentile.js —— 历史分位（纯函数）
   口径：分位 = 历史上取值低于当前的比例（0-100） */
(function () {
  'use strict';

  /** 当前值在历史样本中的分位（%）。v 不在样本内时按插值定位，仅用于展示。 */
  function percentile(values, v) {
    if (!values || !values.length || v === null || v === undefined) return null;
    const arr = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (!arr.length) return null;
    let below = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] <= v) below++;
    return (below / arr.length) * 100;
  }

  /** 分位 → 文字档位（供小白读） */
  function band(p) {
    if (p === null || p === undefined) return { label: '数据不足', tone: 'muted' };
    if (p >= 90) return { label: '历史极高位', tone: 'up' };
    if (p >= 70) return { label: '历史偏高', tone: 'up' };
    if (p >= 30) return { label: '历史中枢', tone: 'flat' };
    if (p >= 10) return { label: '历史偏低', tone: 'down' };
    return { label: '历史极低位', tone: 'down' };
  }

  /** 相对 v 的偏离度：当前比中位数高/低多少 % */
  function vsMedian(values, v) {
    if (!values || !values.length || v === null || v === undefined) return null;
    const arr = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (!arr.length) return null;
    const med = arr.length % 2
      ? arr[(arr.length - 1) / 2]
      : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
    if (!med) return null;
    return (v / med - 1) * 100;
  }

  window.Engine = window.Engine || {};
  window.Engine.percentile = { percentile, band, vsMedian };
})();
