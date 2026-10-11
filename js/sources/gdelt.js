/* gdelt.js —— 全球事件源适配器
   架构（强约束）：浏览器永远不直连 GDELT。海外采集在 GitHub Actions 定时跑
   （_scripts/collect-events.mjs，名义 */5 cron + collect-keeper 每 10 分钟拉起，
   见 docs/SERVER-COLLECT.md），产出 data/events/global-events.json
   随仓库静态托管；浏览器只读自己的 JSON。
   降级链：静态 JSON（live）→ localStorage 缓存（cache）。拿不到就诚实说"暂无数据"，
   绝不造假事件。 */

const EventsSource = (() => {
  const CACHE_KEY = 'events:global';
  const STALE_MS = 30 * 60 * 1000;   // 采集 5 分钟/轮，30 分钟没更新就该亮"滞后"

  async function getEvents() {
    let data = null;
    let via = null;
    try {
      // 60 秒桶破 CDN 缓存：采集任务 5 分钟/轮，前端 1 分钟刷新
      const bust = Math.floor(Date.now() / 60000);
      const res = await window.U.request('data/events/global-events.json?v=' + bust, { timeout: 8000 });
      // 占位文件（events:[] 且无 generatedAt）不算有效数据，继续走缓存/无数据
      if (res && Array.isArray(res.events) && (res.events.length || res.generatedAt)) { data = res; via = 'live'; }
    } catch { /* 静态 JSON 不可达 → 走缓存 */ }
    if (!data) {
      const c = window.U.Cache.raw(CACHE_KEY);
      if (c) { data = c.val; via = 'cache'; }
    }
    if (data && via === 'live') window.U.Cache.set(CACHE_KEY, data);

    const generatedAt = data && data.generatedAt ? window.Events.toMs(data.generatedAt) : null;
    const events = data ? window.Events.normalize(data.events) : [];
    if (via) window.SourceState.ok('gdelt', via);
    else window.SourceState.fail('gdelt', '无数据（采集任务未运行或不可达）');
    return {
      events,
      via,                       // 'live' | 'cache' | null
      generatedAt,               // ms | null
      stale: window.Events.isStale(generatedAt, STALE_MS),
      source: data && data.source || 'GDELT DOC 2.0',
    };
  }

  return { getEvents, STALE_MS };
})();

window.EventsSource = EventsSource;
