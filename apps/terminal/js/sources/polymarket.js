/* polymarket.js —— 预测市场概率源适配器（架构强约束同 gdelt.js）：
   浏览器永远不直连 Polymarket。采集在 GitHub Actions（_scripts/collect-polymarket.mjs，
   30 分钟/轮）产出 data/events/polymarket.json 随仓库静态托管；浏览器只读自己的 JSON。
   降级链：静态 JSON（live）→ localStorage 缓存（cache）→ 诚实空态，绝不造假数据。
   合规口径：行里没有 slug/URL/tokenId 字段，UI 无从外链；只展示"事件发生概率"。

   概率历史（走势线的数据源）走同一套降级链：data/events/polymarket-history.json。
   历史缺失不是错误——走势图只是"还没有数据"，界面显示诚实空态，不画假线。 */

const PmSource = (() => {
  const CACHE_KEY = 'events:polymarket';
  const HIST_CACHE_KEY = 'events:polymarket-history';
  const STALE_MS = 60 * 60 * 1000;   // 采集 30 分钟/轮，1 小时没更新就该亮"滞后"
  const HIST_STALE_MS = 24 * 3600 * 1000;   // 历史每天回填一次即可，一天没更新才算异常

  async function getMarkets() {
    let data = null;
    let via = null;
    try {
      // 5 分钟桶破 CDN 缓存：采集 30 分钟/轮，前端进面板时刷新一次
      const bust = Math.floor(Date.now() / 300000);
      const res = await window.U.request('data/events/polymarket.json?v=' + bust, { timeout: 8000 });
      // 占位文件（events:[] 且无 generatedAt）不算有效数据，继续走缓存/无数据
      if (res && Array.isArray(res.events) && (res.events.length || res.generatedAt)) { data = res; via = 'live'; }
    } catch { /* 静态 JSON 不可达 → 走缓存 */ }
    if (!data) {
      const c = window.U.Cache.raw(CACHE_KEY);
      if (c) { data = c.val; via = 'cache'; }
    }
    if (data && via === 'live') window.U.Cache.set(CACHE_KEY, data);

    const generatedAt = data && data.generatedAt ? window.Events.toMs(data.generatedAt) : null;
    // sanitize 是前后端共用的同一份清洗定义（js/polymarket.js），坏行在此统一剔除
    const events = data ? window.Polymarket.sanitizeEvents(data.events) : [];
    // 数据源状态 key 用中性的 forecast：页脚数据源面板不出现来源品牌（合规口径）
    if (via) window.SourceState.ok('forecast', via);
    else window.SourceState.fail('forecast', '无数据（采集任务未运行或不可达）');
    return {
      events,
      via,                       // 'live' | 'cache' | null
      generatedAt,               // ms | null
      stale: window.Events.isStale(generatedAt, STALE_MS),
      source: data && data.source || 'Polymarket Gamma API',
      disclaimer: data && data.disclaimer || '',
    };
  }

  /* 概率历史网格：{ binMs, from, count, series: { "<档位id>": [概率×1000|null, ...] } }
     取不到就返回空网格（前端据此显示"走势数据积累中"，不画线）。 */
  async function getHistory() {
    let data = null;
    let via = null;
    try {
      const bust = Math.floor(Date.now() / 300000);
      const res = await window.U.request('data/events/polymarket-history.json?v=' + bust, { timeout: 8000 });
      if (res && Array.isArray(res.series) && res.count) { data = res; via = 'live'; }
    } catch { /* 历史文件不可达 → 走缓存 */ }
    if (!data) {
      const c = window.U.Cache.raw(HIST_CACHE_KEY);
      if (c) { data = c.val; via = 'cache'; }
    }
    if (data && via === 'live') window.U.Cache.set(HIST_CACHE_KEY, data);

    const generatedAt = data && data.generatedAt ? window.Events.toMs(data.generatedAt) : null;
    return {
      grid: data && data.series && data.count ? data : null,
      via,
      generatedAt,
      stale: window.Events.isStale(generatedAt, HIST_STALE_MS),
    };
  }

  return { getMarkets, getHistory, STALE_MS, HIST_STALE_MS };
})();

window.PmSource = PmSource;
