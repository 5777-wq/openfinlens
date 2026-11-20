/* okx.js —— 加密源（OKX 规格适配器）
   ⚠️ 实测（2026-08，本机网络）：www.okx.com / aws.okx.com 全部超时不可达（http=000）
   → 保留完整适配器实现（配代理或换网络即可生效），调度器把它排在币安之后作为备源。
   接口：GET https://www.okx.com/api/v5/market/tickers?instType=SPOT
   changePct 自算 = (last - open24h) / open24h * 100 */

const OkxSource = (() => {
  const { num, request } = window.U;
  const API = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';

  function toQuote(t) {
    const last = num(t.last), open24h = num(t.open24h);
    if (last === null) return null;
    const base = String(t.instId || '').split('-')[0];
    return {
      symbol: String(t.instId || '').replace('-', ''),
      instId: t.instId,
      name: base,
      code: t.instId,
      market: 'crypto',
      price: last,
      prevClose: open24h,
      open: open24h,
      high: num(t.high24h), low: num(t.low24h),
      change: open24h !== null ? last - open24h : null,
      changePct: open24h ? (last - open24h) / open24h * 100 : null,
      volume: num(t.vol24h),
      amount: num(t.volCcy24h),
      marketCap: null,
      updatedAt: Date.now(),
      source: 'okx',
    };
  }

  // symbols: ['BTCUSDT','ETHUSDT'] （统一大写无分隔），空数组 = 全量
  async function getQuotes(symbols) {
    try {
      const j = await request(API, { timeout: 8000 });
      if (!j || j.code !== '0' || !Array.isArray(j.data)) throw new Error('bad payload');
      let list = j.data.map(toQuote).filter(Boolean).filter(q => /USDT$/.test(q.symbol));
      if (symbols && symbols.length) {
        const want = new Set(symbols.map(s => s.toUpperCase().replace('-', '')));
        list = list.filter(q => want.has(q.symbol));
      }
      if (list.length) window.SourceState.ok('okx');
      else window.SourceState.fail('okx', 'empty');
      return list;
    } catch (e) {
      window.SourceState.fail('okx', e.message);
      return [];
    }
  }

  // 全量（热力图"加密市值"视图用），按 24h 成交额排序取前 n
  async function getTop(n = 80) {
    const all = await getQuotes([]);
    return all.sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, n);
  }

  return { getQuotes, getTop };
})();

window.OkxSource = OkxSource;
