/* fred.js —— 宏观（可选）
   api_key 为空 → 直接返回空数组，界面隐藏 FRED 卡片，不报错。
   前端不写任何真实 key（禁令 2）：如需启用，部署时由使用者自行填入常量或走代理注入。
   宏观利率主数据不依赖本源：国债收益率走东财 171.* secid（见 app.js MACRO 常量）。 */

const FredSource = (() => {
  const { num, request } = window.U;
  // 密钥由部署环境注入（window.FRED_CONFIG.apiKey），源码不保存任何真实 key
  const SERIES = [
    { id: 'DGS10', name: '美国10年期国债(FRED)' },
    { id: 'DGS2', name: '美国2年期国债(FRED)' },
    { id: 'FEDFUNDS', name: '联邦基金利率' },
    { id: 'CPIAUCSL', name: '美国CPI' },
  ];

  const enabled = () => typeof window !== 'undefined' && !!window.FRED_CONFIG?.apiKey;

  async function getQuotes() {
    if (!enabled()) return [];
    try {
      const out = [];
      for (const s of SERIES) {
        // 密钥取自部署环境注入的 FRED_CONFIG；URL 用 URLSearchParams 组装
        const url = new URL('https://api.stlouisfed.org/fred/series/observations');
        url.searchParams.set('series_id', s.id);
        url.searchParams.set('api_key', window.FRED_CONFIG.apiKey);
        url.searchParams.set('file_type', 'json');
        url.searchParams.set('sort_order', 'desc');
        url.searchParams.set('limit', '2');
        const j = await request(url).catch(() => null);
        const obs = j && j.observations;
        if (!obs || !obs.length) continue;
        const price = num(obs[0].value);
        const prev = obs[1] ? num(obs[1].value) : null;
        if (price === null) continue;
        out.push({
          symbol: 'FRED:' + s.id, name: s.name, code: s.id, market: 'macro',
          price, prevClose: prev,
          change: prev !== null ? price - prev : null,
          changePct: prev ? (price - prev) / prev * 100 : null,
          volume: null, updatedAt: Date.now(), source: 'fred',
        });
      }
      if (out.length) window.SourceState.ok('fred');
      return out;
    } catch (e) {
      window.SourceState.fail('fred', e.message);
      return [];
    }
  }

  return { getQuotes, enabled };
})();

window.FredSource = FredSource;
