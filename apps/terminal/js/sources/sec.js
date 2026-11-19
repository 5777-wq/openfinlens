/* sec.js —— SEC EDGAR 采集产物只读适配器（多家机构 13F-HR）
   采集跑在本地/Actions（_scripts/collect-13f.mjs），产物是随仓库提交的静态 JSON；
   浏览器只读自己的数据，永不直连 SEC（与 gdelt.js 同一原则）。
   口径：13F 为季度披露的美股多头持仓（REPORTED），含看涨/看跌期权——那些行 kind=CALL/PUT，
   其"股数"是名义合约股数而不是持股；每家机构的 lagDays 是报告期末到提交日的真实滞后天数。 */

const SecSource = (() => {

  async function get13F() {
    // 采集产物没有 ?v= 之类的版本串，浏览器可能拿启发式缓存里的旧副本 → 13F 更新后前端看不到。
    // 与 gdelt.js 同法：用 5 分钟桶做缓存穿透（13F 是季度数据，5 分钟粒度足够）。
    const bucket = Math.floor(Date.now() / 300000);
    const j = await window.U.request('data/actors/13f.json?t=' + bucket, { timeout: 9000 });
    if (!j || !Array.isArray(j.institutions) || !j.institutions.length) throw new Error('bad payload');
    return j;
  }

  return { get13F };
})();

window.SecSource = SecSource;
