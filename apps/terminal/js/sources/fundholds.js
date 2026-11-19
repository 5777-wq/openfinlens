/* fundholds.js —— A股 基金持仓变动（东财采集产物只读适配器）
   采集跑在本地/Actions（_scripts/collect-fundholds.mjs），产物是随仓库提交的静态 JSON；
   浏览器只读自己的数据。口径见采集脚本注释：**基金合计**（含 ETF/指数基金，被动申赎
   同样体现为加仓/减仓），季度披露且滞后大（payload.lagDays 是距报告期末的天数）。 */

const FundHoldsSource = (() => {

  async function getFundHolds() {
    // 采集产物没有版本串，用 5 分钟桶做缓存穿透（季度数据，粒度足够）
    const bucket = Math.floor(Date.now() / 300000);
    const j = await window.U.request('data/actors/fundholds.json?t=' + bucket, { timeout: 9000 });
    if (!j || !Array.isArray(j.topAdd) || !Array.isArray(j.topTrim)) throw new Error('bad payload');
    return j;
  }

  return { getFundHolds };
})();

window.FundHoldsSource = FundHoldsSource;
