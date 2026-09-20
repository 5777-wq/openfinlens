/* polymarket.js —— 预测市场概率源适配器（架构强约束同 gdelt.js）：
   浏览器永远不直连 Polymarket。采集在 GitHub Actions（_scripts/collect-polymarket.mjs，
   30 分钟/轮）产出 data/events/polymarket.json 随仓库静态托管；浏览器只读自己的 JSON。
   降级链：静态 JSON（live）→ localStorage 缓存（cache）→ 诚实空态，绝不造假数据。
   合规口径：行里没有 slug/URL 字段，UI 无从外链；只展示"事件发生概率"。 */

const PmSource = (() => {
  const CACHE_KEY = 'events:polymarket';
  const STALE_MS = 60 * 60 * 1000;   // 采集 30 分钟/轮，1 小时没更新就该亮"滞后"

  async function getMarkets() {
    let data = null;
    let via = null;
    try {
      // 5 分钟桶破 CDN 缓存：采集 30 分钟/轮，前端进面板时刷新一次
      const bust = Math.floor(Date.now() / 300000);
      const res = await window.U.request('data/events/polymarket.json?v=' + bust, { timeout: 8000 });
      // 占位文件（markets:[] 且无 generatedAt）不算有效数据，继续走缓存/无数据
      if (res && Array.isArray(res.markets) && (res.markets.length || res.generatedAt)) { data = res; via = 'live'; }
    } catch { /* 静态 JSON 不可达 → 走缓存 */ }
    if (!data) {
      const c = window.U.Cache.raw(CACHE_KEY);
      if (c) { data = c.val; via = 'cache'; }
    }
    if (data && via === 'live') window.U.Cache.set(CACHE_KEY, data);

    const generatedAt = data && data.generatedAt ? window.Events.toMs(data.generatedAt) : null;
    // sanitize 是前后端共用的同一份清洗定义（js/polymarket.js），坏行在此统一剔除
    const markets = data ? window.Polymarket.sanitize(data.markets) : [];
    // 数据源状态 key 用中性的 forecast：页脚数据源面板不出现来源品牌（合规口径）
    if (via) window.SourceState.ok('forecast', via);
    else window.SourceState.fail('forecast', '无数据（采集任务未运行或不可达）');
    return {
      markets,
      via,                       // 'live' | 'cache' | null
      generatedAt,               // ms | null
      stale: window.Events.isStale(generatedAt, STALE_MS),
      source: data && data.source || 'Polymarket Gamma API',
      disclaimer: data && data.disclaimer || '',
    };
  }

  return { getMarkets, STALE_MS };
})();

window.PmSource = PmSource;
