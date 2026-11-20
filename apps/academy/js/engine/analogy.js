/* engine/analogy.js —— 历史类比六维打分（纯函数）
   用途：把「今天的处境」和「历史某段时期」逐维度对比，
        给出相似度与差异清单。刻意不做"会不会重演"的判断。 */
(function () {
  'use strict';

  /** 六个固定维度（顺序即展示顺序） */
  const DIMENSIONS = [
    { key: 'valuation', label: '估值水位', hint: '整体估值相对自身历史的位置' },
    { key: 'liquidity', label: '流动性环境', hint: '货币与信用是否宽松' },
    { key: 'narrative', label: '叙事强度', hint: '市场共识与故事的热度' },
    { key: 'profit',    label: '盈利兑现', hint: '企业盈利是否真的跟上叙事' },
    { key: 'breadth',   label: '参与广度', hint: '是普涨还是只有少数标的' },
    { key: 'structure', label: '产业结构', hint: '技术与竞争格局的成熟度' },
  ];

  const SCALE = [0, 25, 50, 75, 100];  // 五个档位

  /** 把 0-100 的原始分映射到五档刻度 */
  function toBand(score) {
    if (score === null || score === undefined) return null;
    const s = Math.max(0, Math.min(100, score));
    let idx = 0;
    for (let i = 0; i < SCALE.length; i++) if (s >= SCALE[i]) idx = i;
    return idx;
  }

  /**
   * 六维对照
   * @param {Object} a  当前 {dimensionKey: 0-100}
   * @param {Object} b  历史参照 {dimensionKey: 0-100}
   * @returns {Object} { similarity, rows:[{dim, a, b, band, diff, verdict}] }
   */
  function compare(a, b) {
    const rows = [];
    let simSum = 0, used = 0;
    DIMENSIONS.forEach((d) => {
      const av = a && a[d.key] !== undefined ? a[d.key] : null;
      const bv = b && b[d.key] !== undefined ? b[d.key] : null;
      if (av === null || bv === null) {
        rows.push({ dim: d, a: av, b: bv, diff: null, verdict: '缺数据' });
        return;
      }
      const diff = Math.abs(av - bv);
      const sim = Math.max(0, 100 - diff);
      simSum += sim; used++;
      rows.push({
        dim: d, a: av, b: bv, diff,
        band: toBand(av), bandB: toBand(bv),
        verdict: diff <= 15 ? '接近' : (diff <= 35 ? '有差异' : '明显不同'),
      });
    });
    return {
      similarity: used ? Math.round(simSum / used) : null,
      usedDimensions: used,
      totalDimensions: DIMENSIONS.length,
      rows,
    };
  }

  /** 差异清单（按差异从大到小） */
  function differences(cmp) {
    return cmp.rows
      .filter((r) => r.diff !== null)
      .sort((x, y) => y.diff - x.diff)
      .map((r) => ({ label: r.dim.label, hint: r.dim.hint, diff: r.diff, verdict: r.verdict, a: r.a, b: r.b }));
  }

  window.Engine = window.Engine || {};
  window.Engine.analogy = { DIMENSIONS, SCALE, toBand, compare, differences };
})();
