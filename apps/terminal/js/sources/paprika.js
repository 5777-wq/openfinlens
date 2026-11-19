/* paprika.js —— 加密「真实流通市值」补齐源（app.js loadHeatCrypto 的富化层）
   背景：币安/OKX 的现货接口只给 24h 成交额，没有流通市值——加密热力图的
   「市值」面积此前一直用成交额代理（界面标签已如实标注）。本适配器用免费
   无密钥的市值源按 symbol 匹配补齐，覆盖 ≥80% 才切换口径，拿不到就维持
   代理并保持原标签，绝不混着标。
   降级链：CoinPaprika（实测 2026-10 可用、CORS 全开）→ CoinGecko（免费档
   同样无密钥；国内网络常不可达，配 worker 代理即可生效）→ localStorage 缓存
   → 放弃富化（回落成交额代理）。
   接口：
     GET https://api.coinpaprika.com/v1/tickers?limit=250
     GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&...&per_page=250
   市值是慢变量，10 分钟取一次足够；缓存不做时效淘汰（旧市值仍远比成交额代理诚实）。 */

const PaprikaSource = (() => {
  const { request, Cache } = window.U;
  const CACHE_KEY = 'crypto:cap';
  const REFRESH_MS = 10 * 60 * 1000;
  const LIMIT = 1000;   // 覆盖币安 24h 额 Top80 全部（高换手 meme 币市值排名常在 250 外，实测 1000 名内全中）

  /* ---- 纯函数（可单测）：两家响应规格 → 统一 [{sym, cap, rank}] → symbol→市值 Map ---- */

  // 同 symbol 去重取 rank 最小（头部常有同码 Wrapped 变体，如 RETH/JITOSOL）
  function toCapMap(rows) {
    const out = new Map();
    (Array.isArray(rows) ? rows : []).forEach(r => {
      const sym = String(r && r.sym || '').toUpperCase();
      if (!sym || !Number.isFinite(r && r.cap) || r.cap <= 0) return;
      const rank = Number.isFinite(r.rank) ? r.rank : 1e9;
      const prev = out.get(sym);
      if (!prev || rank < prev.rank) out.set(sym, { cap: r.cap, rank });
    });
    return out;
  }

  function fromPaprikaRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(r => ({
      sym: r && r.symbol,
      cap: r && r.quotes && r.quotes.USD ? r.quotes.USD.market_cap : null,
      rank: r && r.rank,
    }));
  }

  function fromCoingeckoRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(r => ({
      sym: r && r.symbol,
      cap: r && r.market_cap,
      rank: r && r.market_cap_rank,
    }));
  }

  /* ---- 取数：主源 → 备源 → 缓存。返回 Map(symbol → 市值USD)，全失败返回空 Map ---- */

  let lastFetch = 0;

  async function getCaps({ force = false } = {}) {
    const cached = Cache.raw(CACHE_KEY);
    const fresh = cached && (Date.now() - cached.at) < REFRESH_MS;
    if (!force && fresh && cached.val && cached.val.length) return new Map(cached.val);

    let rows = null, via = null;
    try {
      rows = await request('https://api.coinpaprika.com/v1/tickers?limit=' + LIMIT, { timeout: 9000 });
      if (Array.isArray(rows) && rows.length) via = 'paprika';
    } catch { /* 主源不可达（国内常被墙）→ 备源 */ }
    if (!via) {
      try {
        rows = await request('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd' +
          '&order=market_cap_desc&per_page=' + LIMIT + '&page=1&sparkline=false', { timeout: 9000 });
        if (Array.isArray(rows) && rows.length) via = 'coingecko';
      } catch { /* 备源也不可达 → 缓存 */ }
    }

    if (via) {
      const entries = Array.from(toCapMap(via === 'paprika' ? fromPaprikaRows(rows) : fromCoingeckoRows(rows)))
        .map(([sym, v]) => [sym, v.cap]);
      if (entries.length) Cache.set(CACHE_KEY, entries);   // 纯数组好 JSON 序列化
      lastFetch = Date.now();
      return new Map(entries);
    }
    return cached && cached.val && cached.val.length ? new Map(cached.val) : new Map();
  }

  return { getCaps, toCapMap, fromPaprikaRows, fromCoingeckoRows, REFRESH_MS };
})();

window.PaprikaSource = PaprikaSource;
