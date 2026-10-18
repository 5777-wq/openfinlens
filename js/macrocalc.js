/* macrocalc.js —— 宏观策略纯计算（无 DOM、无网络，Node vm 可直接加载）
   数据全部来自已轮询的 universe 行情（app 的 state.quotes），这里只做组装与算术。
   口径纪律：外汇/商品/国债收益率没有免费历史K线源，所以本模块只产出"当日"读数，
   不编造"近一周表现 / 历史分位"这类拿不到数据支撑的数字。 */

window.MacroCalc = (() => {
  'use strict';

  const num = (v) => (v === null || v === undefined || isNaN(v)) ? null : Number(v);

  // 传入的 quotes 既可能是 Map（app 的 state.quotes）也可能是普通对象（测试）。
  const getter = (quotes) => (sym) =>
    typeof quotes.get === 'function' ? quotes.get(sym) : quotes[sym];

  /* ---- 收益率曲线 ----
     期限点按升序；2026-10 实测 171.CN1Y / 171.US1Y 无行情，不列（缺就是缺，不拿别处凑）。 */
  const CURVE_DEFS = {
    cn: [
      { y: 2, label: '2年', symbol: 'EM:171.CN2Y' },
      { y: 5, label: '5年', symbol: 'EM:171.CN5Y' },
      { y: 10, label: '10年', symbol: 'EM:171.CN10Y' },
      { y: 30, label: '30年', symbol: 'EM:171.CN30Y' },
    ],
    us: [
      { y: 0.25, label: '3月', symbol: 'EM:171.US3M' },
      { y: 2, label: '2年', symbol: 'EM:171.US2Y' },
      { y: 5, label: '5年', symbol: 'EM:171.US5Y' },
      { y: 10, label: '10年', symbol: 'EM:171.US10Y' },
      { y: 30, label: '30年', symbol: 'EM:171.US30Y' },
    ],
  };

  function yieldCurve(quotes, mkt = 'us') {
    const get = getter(quotes);
    const pts = [];
    (CURVE_DEFS[mkt] || []).forEach(d => {
      const q = get(d.symbol);
      const v = q ? num(q.price) : null;
      if (v !== null) {
        pts.push({
          y: d.y, label: d.label, value: v,
          chg: num(q.change),              // 收益率绝对变动（百分点），×100 = bp
          changePct: num(q.changePct),
        });
      }
    });
    return pts;
  }

  /* 利差 = 长端收益率 − 短端收益率（百分点）。负值 = 倒挂。
     returns 里 y 缺任一端则该项为 null（调用方按 null 渲染 --）。 */
  function spread(pts, yLong, yShort) {
    const at = (y) => pts.find(p => p.y === y) || null;
    const a = at(yLong), b = at(yShort);
    if (!a || !b) return null;
    const v = a.value - b.value;
    return { value: v, inverted: v < 0 };
  }

  function spreads(pts) {
    return [
      { id: 'us-10-2', label: '美债 10年−2年', s: spread(pts, 10, 2) },
      { id: 'us-10-3m', label: '美债 10年−3月', s: spread(pts, 10, 0.25) },
    ];
  }

  /* ---- 大类资产矩阵（当日） ----
     全部是 universe 已轮询 symbol，零新增请求；缺行情的标的直接不出现在行里。 */
  const ASSET_DEFS = [
    { key: 'eq', label: '全球股指', symbols: [
      { symbol: 'sh000001' }, { symbol: 'sz399001' }, { symbol: 'hkHSI' },
      { symbol: 'usDJI' }, { symbol: 'usIXIC' }, { symbol: 'usINX' },
    ] },
    { key: 'fx', label: '外汇与美元', symbols: [
      { symbol: 'EM:133.USDCNH' }, { symbol: 'EM:119.EURUSD' },
      { symbol: 'EM:119.USDJPY' }, { symbol: 'EM:100.UDI' },
    ] },
    { key: 'cmd', label: '大宗商品', symbols: [
      { symbol: 'EM:101.GC00Y' }, { symbol: 'EM:101.SI00Y' }, { symbol: 'EM:101.HG00Y' },
      { symbol: 'EM:102.CL00Y' }, { symbol: 'EM:102.NG00Y' },
    ] },
    { key: 'rate', label: '10年期国债收益率', symbols: [
      { symbol: 'EM:171.US10Y' }, { symbol: 'EM:171.CN10Y' },
      { symbol: 'EM:171.DE10Y' }, { symbol: 'EM:171.JP10Y' },
    ] },
    { key: 'crypto', label: '加密资产', symbols: [
      { symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' },
    ] },
  ];

  function crossAssetRows(quotes) {
    const get = getter(quotes);
    return ASSET_DEFS.map(def => ({
      key: def.key,
      label: def.label,
      items: def.symbols.map(s => {
        const q = get(s.symbol);
        return q ? {
          symbol: s.symbol,
          name: q.name || s.symbol,
          price: num(q.price),
          changePct: num(q.changePct),
        } : null;
      }).filter(Boolean),
    })).filter(g => g.items.length);
  }

  /* ---- 读数卡 ----
     每张卡都是一句可复核的算术，不给方向判断；caption 写清口径。
     金油比 = 黄金价格(美元/盎司) ÷ 原油价格(美元/桶)，单位"桶/盎司"。 */
  function signals(quotes) {
    const get = getter(quotes);
    const usPts = yieldCurve(quotes, 'us');
    const cn10 = (() => { const q = get('EM:171.CN10Y'); return q ? num(q.price) : null; })();
    const us10 = (() => { const q = get('EM:171.US10Y'); return q ? num(q.price) : null; })();
    const gold = (() => { const q = get('EM:101.GC00Y'); return q ? num(q.price) : null; })();
    const oil = (() => { const q = get('EM:102.CL00Y'); return q ? num(q.price) : null; })();
    const udi = get('EM:100.UDI');
    const out = [];

    spreads(usPts).forEach(({ id, label, s }) => {
      out.push({
        id, label,
        value: s ? s.value * 100 : null,          // 百分点 → bp
        unit: 'bp',
        caption: s && s.inverted ? '倒挂：短端收益率高于长端' : '长端收益率高于短端',
        inverted: s ? s.inverted : false,
      });
    });

    out.push({
      id: 'cn-us-10', label: '中美 10年期利差',
      value: (cn10 !== null && us10 !== null) ? (cn10 - us10) * 100 : null,
      unit: 'bp',
      caption: '中债10年收益率 − 美债10年收益率',
    });

    out.push({
      id: 'gold-oil', label: '金油比',
      value: (gold !== null && oil !== null && oil > 0) ? gold / oil : null,
      unit: '桶/盎司',
      caption: '一盎司黄金能换多少桶原油，纯比价读数',
    });

    out.push({
      id: 'udi', label: '美元指数',
      value: udi ? num(udi.price) : null,
      changePct: udi ? num(udi.changePct) : null,
      unit: '',
      caption: '美元兑一篮子货币汇率指数',
    });

    return out;
  }

  return { CURVE_DEFS, ASSET_DEFS, yieldCurve, spread, spreads, crossAssetRows, signals };
})();
