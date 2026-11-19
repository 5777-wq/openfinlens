/* actors.js —— Actor / Activity 数据模型（纯函数，无 DOM / 无网络，可直接单测）
   产品口径（tradersoul 式席位档案）：
   Actor = 金融实体（第一版：A股龙虎榜营业部席位 a_share_seat）
   Activity = 该实体的公开披露行为（席位上榜买卖，CONFIRMED——交易所公开披露）
   铁律：
   - 席位 ≠ 自然人账户。名称就是营业部全称，不做"某游资本人"的推断（无可靠来源不标别名）；
   - 每条 Activity 带 source / confidence / tradeDate，时间只到"交易日"（披露口径就是日频）；
   - 金额缺什么显示什么，绝不造 0。 */

const Actors = (() => {

  const SOURCE = '东方财富数据中心 · 交易所公开披露';
  const CONFIDENCE = 'CONFIRMED';   // 交易所龙虎榜为官方披露口径

  const seatId = (code) => 'seat:' + String(code || '').trim();

  /* 明细行（东财 RPT_BILLBOARD_DAILYDETAILSBUY/SELL）→ 统一 Activity
     { seatCode, seatName, code, action:'BUY'|'SELL', buy, sell, net, tradeDate, explanation } */
  function activityFromRow(r, fallbackAction) {
    if (!r || !r.OPERATEDEPT_CODE || !r.SECURITY_CODE) return null;
    const tradeDate = String(r.TRADE_DATE || '').slice(0, 10);
    // 注意 +null === 0：金额缺失必须显式判 null，否则"没买"会被算成"买了 0 元"
    const n = (v) => (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v;
    const buy = n(r.BUY);
    const sell = n(r.SELL);
    let net = n(r.NET);
    if (net === null && (buy !== null || sell !== null)) net = (buy || 0) - (sell || 0);
    let action = fallbackAction;
    if (!action) action = (net === null ? 'BUY' : net >= 0 ? 'BUY' : 'SELL');
    return {
      id: 'act:' + r.OPERATEDEPT_CODE + ':' + r.SECURITY_CODE + ':' + tradeDate + ':' + action,
      actorId: seatId(r.OPERATEDEPT_CODE),
      seatCode: String(r.OPERATEDEPT_CODE),
      seatName: String(r.OPERATEDEPT_NAME || '').trim(),
      type: 'seat_activity',
      action,
      code: String(r.SECURITY_CODE),
      stockName: String(r.SECURITY_NAME_ABBR || '').trim(),   // 披露行自带证券简称，档案页直接用，不靠行情补
      symbol: secidSymbol(r.SECURITY_CODE, r.SECUCODE),
      buy, sell, net,
      tradeDate,
      explanation: String(r.EXPLANATION || ''),
      riseProb3d: n(r.RISE_PROBABILITY_3DAY),
      source: SOURCE,
      confidence: CONFIDENCE,
    };
  }

  /* SECURITY_CODE + SECUCODE("603186.SH") → 内部 symbol（与 lhb.js secidOf 同口径） */
  function secidSymbol(code, secucode) {
    const m = String(secucode || '').split('.')[1];
    const market = (m === 'SH') ? '1.' : '0.';
    return 'EM:' + market + String(code || '');
  }

  /* 当日买/卖两份明细 → 席位 Actor 数组（按 |净额| 降序）
     同一席位同股同日的买卖两行合并为一个 Activity（action 取净方向） */
  function buildSeatActors(buyRows, sellRows) {
    const acts = new Map();
    mergeRows(buyRows, sellRows).forEach(a => { acts.set(a.id, a); });

    const bySeat = new Map();
    acts.forEach(a => {
      if (!bySeat.has(a.actorId)) bySeat.set(a.actorId, []);
      bySeat.get(a.actorId).push(a);
    });

    const out = [];
    bySeat.forEach(list => {
      let buy = 0, buyN = 0, sell = 0, sellN = 0;
      const stocks = new Set();
      list.forEach(a => {
        if (a.buy !== null) { buy += a.buy; buyN++; }
        if (a.sell !== null) { sell += a.sell; sellN++; }
        stocks.add(a.code);
      });
      list.sort((x, y) => Math.abs(y.net || 0) - Math.abs(x.net || 0));
      out.push({
        id: list[0].actorId,
        type: 'a_share_seat',
        name: list[0].seatName,
        market: 'cn',
        source: SOURCE,
        confidence: CONFIDENCE,
        stats: {
          buy, sell, net: buy - sell,
          stockCount: stocks.size,
          activityCount: list.length,
          buyCount: buyN, sellCount: sellN,
        },
        activities: list,
      });
    });
    out.sort((a, b) => Math.abs(b.stats.net) - Math.abs(a.stats.net));
    return out;
  }

  /* 买/卖明细行合并：同席位+同股+同日 只留一条（action 按净方向），买卖额都保留 */
  function mergeRows(buyRows, sellRows) {
    const merged = new Map();
    (Array.isArray(buyRows) ? buyRows : []).forEach(r => {
      const a = activityFromRow(r, 'BUY');
      if (a) merged.set(a.seatCode + ':' + a.code + ':' + a.tradeDate, a);
    });
    (Array.isArray(sellRows) ? sellRows : []).forEach(r => {
      const a = activityFromRow(r, 'SELL');
      if (!a) return;
      const k = a.seatCode + ':' + a.code + ':' + a.tradeDate;
      const prev = merged.get(k);
      if (!prev) { merged.set(k, a); return; }
      // 同席位同股同日两边都有：合并金额，方向按净额
      prev.buy = prev.buy !== null ? prev.buy : a.buy;
      prev.sell = prev.sell !== null ? prev.sell : a.sell;
      if (!prev.stockName && a.stockName) prev.stockName = a.stockName;
      prev.net = (prev.buy || 0) - (prev.sell || 0);
      prev.action = prev.net >= 0 ? 'BUY' : 'SELL';
      prev.id = 'act:' + prev.seatCode + ':' + prev.code + ':' + prev.tradeDate + ':' + prev.action;
    });
    return Array.from(merged.values());
  }

  /* 席位历史明细（跨多日）→ 按日期倒序的活动列表（档案页"近 N 次活动"） */
  function buildSeatHistory(buyRows, sellRows, limit) {
    const list = mergeRows(buyRows, sellRows);
    list.sort((a, b) => (b.tradeDate || '').localeCompare(a.tradeDate || '') ||
      Math.abs(b.net || 0) - Math.abs(a.net || 0));
    const capped = list.slice(0, limit || 20);
    let buyN = 0, sellN = 0;
    const stocks = new Set();
    const probs = [];
    list.forEach(a => {
      if (a.net !== null && a.net >= 0) buyN++; else if (a.net !== null) sellN++;
      stocks.add(a.code);
      if (a.riseProb3d !== null) probs.push(a.riseProb3d);
    });
    return {
      activities: capped,
      total: list.length,
      stats: {
        activityCount: list.length,
        buyCount: buyN,
        sellCount: sellN,
        stockCount: stocks.size,
        avgRiseProb3d: probs.length ? probs.reduce((s, v) => s + v, 0) / probs.length : null,
      },
    };
  }

  /* Activity → K线 marker（颜色由 app 层按红涨绿跌主题注入）
     时间语义：只到交易日（日频披露），绝不伪造盘中时间 */
  function activityToChartEvent(a, colors) {
    if (!a || !a.tradeDate) return null;
    const up = (colors && colors.up) || '#ff5c5c';
    const down = (colors && colors.down) || '#2ebd85';
    return {
      time: a.tradeDate,
      color: a.action === 'BUY' ? up : down,
      text: a.action === 'BUY' ? '席位买' : '席位卖',
      ev: { kind: 'seat', activity: a },
    };
  }

  return { SOURCE, CONFIDENCE, seatId, activityFromRow, secidSymbol,
    buildSeatActors, mergeRows, buildSeatHistory, activityToChartEvent };
})();

if (typeof window !== 'undefined') window.Actors = Actors;
if (typeof module !== 'undefined' && module.exports) module.exports = Actors;
