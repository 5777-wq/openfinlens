/* etf.js —— 美股 因子 ETF 持仓（Invesco 采集产物只读适配器）
   采集跑在本地/Actions（_scripts/collect-etf.mjs），产物是随仓库提交的静态 JSON；
   浏览器只读自己的数据，永不直连 Invesco（与 gdelt.js / sec.js 同一原则）。
   口径：规则化因子 ETF 的**每日全量持仓**（官方发布）——动量 ETF 的持仓回答"趋势资金在哪"，
   低波 ETF 回答"防御资金在哪"，overlap 是同时被两类因子选中的股票。这是编制规则的被动结果，
   不是基金经理的主观判断。payload.asOf 是持仓基准日，lagDays 是到采集日的日历天数。 */

const EtfSource = (() => {

  async function getEtfHoldings() {
    // 采集产物没有 ?v= 之类的版本串，浏览器可能拿启发式缓存里的旧副本 → 采集更新后前端看不到。
    // 与 sec.js/fundholds.js 同法：5 分钟桶做缓存穿透（日更数据，粒度足够）。
    const bucket = Math.floor(Date.now() / 300000);
    const j = await window.U.request('data/actors/etf.json?t=' + bucket, { timeout: 9000 });
    if (!j || !Array.isArray(j.funds) || !j.funds.length) throw new Error('bad payload');
    if (!j.overlap || !Array.isArray(j.overlap.rows)) throw new Error('bad payload');
    return j;
  }

  return { getEtfHoldings };
})();

window.EtfSource = EtfSource;
