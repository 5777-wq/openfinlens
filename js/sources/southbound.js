/* southbound.js —— 港股通（南向）持有个股（东财数据中心 datacenter-web，免密钥）
   实测（2026-09）：该接口**带 Access-Control-Allow-Origin: * —— 前提是请求带 Origin 头**，
   浏览器天然会带，所以浏览器可直连、不需要采集层（与 GDELT/SEC 的路径不同，它是国内源）。

   口径（诚实标注，与"席位/龙虎榜"区分开）：
   · 这是"内地资金通过港股通合计持有多少"，交易所/结算披露口径，**日频**；
   · 它衡量的是**持仓存量与当日变化**，不是"某只基金今天买了什么"——港股没有像
     美股 13F 那样可按机构拆分的免费结构化披露（HKEX 权益披露只有 HTML 交互；
     CCASS 明细虽细但使用条款明文禁止程序化访问），所以这一块只能到"通道合计"粒度。

   ⚠ MUTUAL_TYPE=002(沪) 与 004(深) 是**同一份合并持仓各复制一份**（实测数值完全相同），
   汇总时必须只取一侧，否则所有数字翻倍。这里固定取 002。

   降级链：东财 → 内存缓存（与 lhb 同：日频数据不值得每次进页都打网络）。 */

const SouthboundSource = (() => {
  const API = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const COLUMNS = 'SECUCODE,SECURITY_CODE,SECURITY_NAME,HOLD_DATE,HOLD_SHARES,HOLD_MARKET_CAP,' +
    'HOLD_SHARES_RATIO,HOLD_SHARES_CHANGE,ADD_SHARES_AMP,PARTICIPANT_NUM,CLOSE_PRICE,CHANGE_RATE,INDUSTRY';

  const urlOf = (date, pn) => API + '?' + new URLSearchParams({
    reportName: 'RPT_MUTUAL_STOCK_HOLDRANKS',
    columns: COLUMNS,
    filter: `(MUTUAL_TYPE="002")(HOLD_DATE='${date}')`,
    pageNumber: String(pn), pageSize: '500',      // 接口上限 500；单日 660 行 → 2 页
    sortTypes: '-1', sortColumns: 'HOLD_MARKET_CAP', source: 'WEB', client: 'WEB',
  }).toString();

  const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

  /* 单日全量（分页并发）。未发布/非交易日时接口 success=false 且 data 为 null，返回空数组。 */
  async function fetchDay(date) {
    const first = await window.U.request(urlOf(date, 1), { timeout: 12000 });
    const res = first && first.result;
    if (!first || !first.success || !res || !Array.isArray(res.data) || !res.data.length) return [];
    const rows = res.data.slice();
    const pages = Math.min(Number(res.pages) || 1, 4);   // 防御：异常放大时不无限拉
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          window.U.request(urlOf(date, i + 2), { timeout: 12000 })
            .then(j => (j && j.result && j.result.data) || []).catch(() => []))
      );
      rest.forEach(r => rows.push(...r));
    }
    const out = [];
    const seen = new Set();
    rows.forEach(r => {
      const code = String(r.SECURITY_CODE || '');
      if (!code || seen.has(code)) return;    // 盘中按市值分页时个股会位移，需去重
      seen.add(code);
      out.push({
        code,
        name: String(r.SECURITY_NAME || ''),
        date: String(r.HOLD_DATE || '').slice(0, 10),
        shares: window.U.num(r.HOLD_SHARES),
        marketCap: window.U.num(r.HOLD_MARKET_CAP),       // 港元
        ratio: window.U.num(r.HOLD_SHARES_RATIO),         // 南向持股占已发行股本 %
        changeShares: window.U.num(r.HOLD_SHARES_CHANGE), // 当日增减（股）
        changePct: window.U.num(r.ADD_SHARES_AMP),        // 当日增减（%）
        participants: window.U.num(r.PARTICIPANT_NUM),    // 参与券商/托管行家数
        price: window.U.num(r.CLOSE_PRICE),
        changeRate: window.U.num(r.CHANGE_RATE),          // 当日涨跌幅 %
        industry: String(r.INDUSTRY || ''),
      });
    });
    return out;
  }

  /* 最新已披露交易日：当日尚未发布时逐日回退（最多 8 天，够跨周末+假期）。
     单日失败只跳过、继续往前找（与 lhb.js 同款容错）：否则当日一次超时就会放弃
     全部更早的披露日，刷新页面后（内存缓存已清）南向面板直接空掉。 */
  async function latest(days = 8) {
    const base = Date.now();
    for (let i = 0; i <= days; i++) {
      const date = dayStr(base - i * 86400000);
      let rows = [];
      try { rows = await fetchDay(date); } catch { /* 当日失败继续往前找 */ }
      if (rows.length) return { date, rows };
    }
    return { date: null, rows: [] };
  }

  return { fetchDay, latest, urlOf };
})();

window.SouthboundSource = SouthboundSource;
