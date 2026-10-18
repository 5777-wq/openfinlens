/* fundparse.js —— 基金画像纯解析（无 DOM、无网络，Node vm 可直接加载）
   两路输入（字段形状 2026-10 逐个实测）：
     ① pingzhongdata：script 标签加载后 window 上拿到的是已解析的值，
        normalizePingzhong() 负责防御性整形——任何一个字段形状不对就置 null，
        由视图隐藏对应卡片，绝不让一个字段炸掉整页（上游改版是常态）。
     ② fundmobapi FundMNInverstPosition：重仓股 JSON，normalizeInverst() 整形。 */

window.FundParse = (() => {
  'use strict';

  const num = (v) => (v === null || v === undefined || v === '' || isNaN(v)) ? null : Number(v);
  const str = (v) => (v === null || v === undefined) ? null : String(v);
  const lastOf = (a) => (Array.isArray(a) && a.length) ? a[a.length - 1] : null;

  /* ---- pingzhongdata 值归一化 ----
     入参 g = { fS_name, fS_code, fund_sourceRate, fund_Rate, fund_minsg,
       syl_1n(近1年), syl_6y(近6月), syl_3y(近3月), syl_1y(近1月),
       Data_fundSharesPositions, Data_netWorthTrend, Data_ACWorthTrend,
       Data_rateInSimilarType, Data_rateInSimilarPersent, Data_fluctuationScale,
       Data_holderStructure, Data_assetAllocation, Data_performanceEvaluation,
       Data_currentFundManager, Data_buySedemption }
     返回（顶层字段可整体为 null，视图逐块降级）。 */
  function normalizePingzhong(g) {
    g = g || {};
    const name = str(g.fS_name);
    const code = str(g.fS_code);
    if (!name || !code) return null;   // 连名字都没有说明不是这份脚本的形状

    const nw = g.Data_netWorthTrend;
    const netWorth = Array.isArray(nw)
      ? nw.filter(p => p && typeof p.x === 'number' && typeof p.y === 'number')
        .map(p => ({ t: p.x, v: p.y, r: num(p.equityReturn) }))
      : null;

    const ac = g.Data_ACWorthTrend;
    const acWorth = Array.isArray(ac)
      ? ac.filter(p => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
      : null;

    const posLast = lastOf(g.Data_fundSharesPositions);

    const rankLast = lastOf(g.Data_rateInSimilarType);
    const pctLast = lastOf(g.Data_rateInSimilarPersent);

    const scale = seriesBox(g.Data_fluctuationScale);

    const br = g.Data_buySedemption;
    let buyRedeem = null;
    if (br && br.categories && Array.isArray(br.series)) {
      const find = (nm) => (br.series.find(s => s.name === nm) || {}).data || null;
      buyRedeem = {
        cats: br.categories,
        sub: find('期间申购'), red: find('期间赎回'), shares: find('总份额'),
      };
    }

    const hs = g.Data_holderStructure;
    let holders = null;
    if (hs && hs.categories && Array.isArray(hs.series)) {
      const find = (nm) => (hs.series.find(s => String(s.name || '').indexOf(nm) >= 0) || {}).data || null;
      holders = {
        cats: hs.categories,
        inst: find('机构'), personal: find('个人'), internal: find('内部'),
      };
    }

    const aa = g.Data_assetAllocation;
    let alloc = null;
    if (aa && aa.categories && Array.isArray(aa.series)) {
      const find = (nm) => (aa.series.find(s => String(s.name || '').indexOf(nm) >= 0) || {}).data || null;
      alloc = {
        cats: aa.categories,
        stock: find('股票'), bond: find('债券'), cash: find('现金'),
      };
    }

    const pe = g.Data_performanceEvaluation;
    const perfEval = (pe && Array.isArray(pe.categories) && Array.isArray(pe.data))
      ? { avr: num(pe.avr), categories: pe.categories, scores: pe.data.map(num) }
      : null;

    const mg = g.Data_currentFundManager;
    const managers = Array.isArray(mg)
      ? mg.filter(m => m && m.name).map(m => ({
        name: str(m.name), workTime: str(m.workTime), fundSize: str(m.fundSize), star: num(m.star),
      }))
      : null;

    return {
      name, code,
      rateOld: num(g.fund_sourceRate),
      rateNew: num(g.fund_Rate),
      minBuy: str(g.fund_minsg),
      returns: {
        y1: num(g.syl_1n), m6: num(g.syl_6y), m3: num(g.syl_3y), m1: num(g.syl_1y),
      },
      position: (Array.isArray(posLast) && typeof posLast[0] === 'number' && typeof posLast[1] === 'number')
        ? { date: posLast[0], pct: posLast[1] } : null,
      netWorth, acWorth,
      rank: (rankLast && typeof rankLast.y === 'number')
        ? { rank: rankLast.y, total: num(rankLast.sc), percent: Array.isArray(pctLast) ? num(pctLast[1]) : null }
        : null,
      scale, buyRedeem, holders, alloc, perfEval, managers,
    };
  }

  // {categories, series:[{y, mom}]} → {cats, vals, mom}
  function seriesBox(raw) {
    if (!raw || !raw.categories || !Array.isArray(raw.series)) return null;
    return {
      cats: raw.categories,
      vals: raw.series.map(x => (x && typeof x.y === 'number') ? x.y : null),
      mom: raw.series.map(x => (x && x.mom != null) ? String(x.mom) : null),
    };
  }

  /* ---- 重仓股（fundmobapi FundMNInverstPosition） ----
     该接口 CORS * 且无 Referer 防盗链（fundf10 的 jjcc .aspx 实测 404 挡站外引用，弃用）。
     入参是响应 JSON 的 Datas.fundStocks，行形如：
       { GPDM:'00700', GPJC:'腾讯控股', JZBL:'5.72',          // 占净值比 %
         NEWTEXCH:'116',                                       // 东财市场号（116=港，1/0=沪深）
         PCTNVCHGTYPE:'减持', PCTNVCHG:'-3.88' }               // 占净比环比变动
     secid = NEWTEXCH + '.' + GPDM，与热力图/详情同一套口径，不做猜测。 */
  function normalizeInverst(datas) {
    const rows = datas && Array.isArray(datas.fundStocks) ? datas.fundStocks : null;
    if (!rows || !rows.length) return null;
    const stocks = rows
      .filter(r => r && r.GPDM && r.GPJC && r.NEWTEXCH)
      .map(r => {
        const secid = String(r.NEWTEXCH) + '.' + String(r.GPDM);
        return {
          secid,
          code: String(r.GPDM),
          name: String(r.GPJC).trim(),
          pct: num(r.JZBL),
          chgType: str(r.PCTNVCHGTYPE) || null,
          chg: num(r.PCTNVCHG),
        };
      });
    return stocks.length ? stocks : null;
  }

  /* ---- 持仓股票名单（pingzhongdata 的 stockCodes，兜底口径） ----
     形如 ["00700116","6005191","0008580"]：{code}{市场后缀}，116=港股、1=沪、0=深。
     只有名单没有占比（占比在 mobapi，遇代理出口被拒时降级用它），顺序即披露顺序。 */
  function parseStockCodes(arr) {
    if (!Array.isArray(arr)) return null;
    const stocks = [];
    arr.forEach(raw => {
      const s = String(raw || '');
      let market = null, code = null;
      if (s.length > 3 && s.endsWith('116')) { market = '116'; code = s.slice(0, -3); }
      else if (s.endsWith('1')) { market = '1'; code = s.slice(0, -1); }
      else if (s.endsWith('0')) { market = '0'; code = s.slice(0, -1); }
      if (market && code) stocks.push({ secid: market + '.' + code, code, name: null, pct: null, chgType: null, chg: null });
    });
    return stocks.length ? stocks : null;
  }

  return { normalizePingzhong, normalizeInverst, parseStockCodes };
})();
