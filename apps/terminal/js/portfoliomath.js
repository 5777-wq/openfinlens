/* portfoliomath.js —— 持仓跟踪纯计算（无 DOM、无网络，Node vm 可直接加载）
   估值/盈亏/多币种折算/快照合并，全部是可手算复核的算术。
   币种纪律：折算链路只用已轮询的外汇行情（USDCNH、USDHKD），缺哪档汇率
   就在哪档标 converted=false，不拿估值日的旧汇率冒充。 */

window.PortfolioMath = (() => {
  'use strict';

  const num = (v) => (v === null || v === undefined || isNaN(v)) ? null : Number(v);

  // 市场 → 计价币。加密市场以 USDT 计价，按 ≈USD 口径处理（页面上如实标注）。
  const CURRENCY_OF = { cn: 'CNY', hk: 'HKD', us: 'USD', crypto: 'USD' };
  function currencyOf(market) { return CURRENCY_OF[market] || null; }

  /* 估值
     holdings: [{ id, symbol, name, market, shares, cost }]
     getQuote: symbol → { price, prevClose, changePct } | undefined
     fx: { USD: number|null, HKD: number|null }   // 该币兑人民币汇率
     返回 { rows, totals }：
       rows[i] = { holding, currency, price, changePct, value, costBasis, pnl, pnlPct,
                   dayPnl, valueCny, pnlCny, dayPnlCny }
       totals  = { byCur: { CNY: {value,pnl,dayPnl}, ... }, cny: {value,pnl,dayPnl,converted} }
     price 缺失（停牌/未拉到）的行保留原样、金额全 null——宁可 -- 也不拿旧价硬算。 */
  function valuation(holdings, getQuote, fx) {
    const rows = [];
    const byCur = {};
    holdings.forEach(h => {
      const cur = currencyOf(h.market);
      const q = getQuote(h.symbol);
      const shares = num(h.shares);
      const cost = num(h.cost);
      const price = q ? num(q.price) : null;
      const changePct = q ? num(q.changePct) : null;
      const prevClose = q ? num(q.prevClose) : null;
      const value = (price !== null && shares !== null) ? price * shares : null;
      const costBasis = (cost !== null && shares !== null) ? cost * shares : null;
      const pnl = (value !== null && costBasis !== null) ? value - costBasis : null;
      const pnlPct = (pnl !== null && costBasis > 0) ? pnl / costBasis * 100 : null;
      // 当日盈亏优先用昨收差价；昨收缺失时按涨跌幅反推（value − value/(1+r)）
      let dayPnl = null;
      if (value !== null && prevClose !== null) dayPnl = (price - prevClose) * shares;
      else if (value !== null && changePct !== null && changePct !== -100) {
        dayPnl = value - value / (1 + changePct / 100);
      }
      const rateCny = cur === 'CNY' ? 1 : (cur && fx ? num(fx[cur]) : null);
      const mul = (v) => (v === null || rateCny === null) ? null : v * rateCny;
      const row = {
        holding: h, currency: cur,
        price, changePct, value, costBasis, pnl, pnlPct, dayPnl,
        valueCny: mul(value), pnlCny: mul(pnl), dayPnlCny: mul(dayPnl),
      };
      rows.push(row);
      if (cur && value !== null) {
        const t = byCur[cur] = byCur[cur] || { value: 0, pnl: 0, dayPnl: 0, n: 0 };
        t.value += value;
        if (pnl !== null) t.pnl += pnl;
        if (dayPnl !== null) t.dayPnl += dayPnl;
        t.n++;
      }
    });
    // 人民币合计：只有每一行都能折算才给 converted=true，缺汇率就整体不算，
    // 避免"一部分按今天的汇率、一部分按 null"拼出一个说谎的总数
    let converted = rows.length > 0;
    let v = 0, p = 0, d = 0;
    rows.forEach(r => {
      if (r.valueCny === null) { converted = false; return; }
      v += r.valueCny;
      if (r.pnlCny !== null) p += r.pnlCny; else converted = false;
      if (r.dayPnlCny !== null) d += r.dayPnlCny; else converted = false;
    });
    return {
      rows,
      totals: {
        byCur,
        cny: converted ? { value: v, pnl: p, dayPnl: d, converted: true }
          : { value: null, pnl: null, dayPnl: null, converted: false },
      },
    };
  }

  /* 由已轮询行情组装汇率表（兑人民币）。USD 用离岸人民币直接价；
     HKD 用交叉价 USDCNH ÷ USDHKD。任一腿缺失该档为 null。 */
  function fxFromQuotes(quotes) {
    const get = (s) => (typeof quotes.get === 'function' ? quotes.get(s) : quotes[s]);
    const cnh = get('EM:133.USDCNH');
    const hkd = get('EM:119.USDHKD');
    const usd = cnh ? num(cnh.price) : null;
    let hk = null;
    if (usd !== null && hkd && num(hkd.price) > 0) hk = usd / num(hkd.price);
    return { USD: usd, HKD: hk };
  }

  /* 资产快照：同一天只留一条（后写覆盖），按日期升序，最多留 400 条（≈1.5年工作日）。 */
  function snapshotPush(hist, dateStr, value) {
    const list = (Array.isArray(hist) ? hist : []).filter(x => x && x.d && typeof x.v === 'number');
    const i = list.findIndex(x => x.d === dateStr);
    if (i >= 0) list[i] = { d: dateStr, v: value };
    else list.push({ d: dateStr, v: value });
    list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return list.slice(-400);
  }

  // 本地日期串（快照键）：不用 toISOString——它按 UTC，会在中国早上把日期记成昨天
  function localDateStr(ts) {
    const d = ts ? new Date(ts) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  return { CURRENCY_OF, currencyOf, valuation, fxFromQuotes, snapshotPush, localDateStr };
})();
