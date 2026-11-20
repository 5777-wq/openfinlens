/* engine/spread.js —— 利差 / 曲线形态 / 比价（纯函数） */
(function () {
  'use strict';

  /**
   * 收益率曲线：按期限升序的点集
   * points: [{y: 0.25, label:'3月', value: 4.12}, ...]
   */
  function curveShape(points) {
    if (!points || points.length < 2) return { shape: 'unknown', inverted: false, text: '数据不足' };
    const asc = points.slice().sort((a, b) => a.y - b.y);
    const shortY = asc[0].y, longY = asc[asc.length - 1].y;
    const shortV = asc[0].value, longV = asc[asc.length - 1].value;
    const gap = longV - shortV;
    let shape = 'normal', text = '正常向上';
    if (gap < 0) { shape = 'inverted'; text = '倒挂：短端高于长端'; }
    else if (Math.abs(gap) < 0.15) { shape = 'flat'; text = '平坦'; }
    return { shape, inverted: gap < 0, gap, gapBp: gap * 100, text, shortY, longY, shortV, longV };
  }

  /** 指定两期限利差（百分点） */
  function spread(points, yLong, yShort) {
    if (!points) return null;
    const a = points.find((p) => p.y === yLong);
    const b = points.find((p) => p.y === yShort);
    if (!a || !b) return null;
    return { value: a.value - b.value, bp: (a.value - b.value) * 100, inverted: a.value < b.value };
  }

  /** 金油比：美元/盎司 ÷ 美元/桶 = 桶/盎司 */
  function goldOilRatio(gold, oil) {
    if (!gold || !oil) return null;
    return gold / oil;
  }

  /** 实际利率 = 名义收益率 - 通胀率 */
  function realRate(nominal, inflation) {
    if (nominal === null || nominal === undefined) return null;
    if (inflation === null || inflation === undefined) return null;
    return nominal - inflation;
  }

  window.Engine = window.Engine || {};
  window.Engine.spread = { curveShape, spread, goldOilRatio, realRate };
})();
