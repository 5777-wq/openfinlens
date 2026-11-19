/* engine/llm-provider.js —— LLM adapter 与 AI 成本闸门
   设计（docs/ARCHITECTURE.md §AI）：
   - LLMProvider 统一接口：summarize(event) → { text, provider, model, tokens }
     未来可插 OpenAI / Gemini / Claude / 本地模型，业务只面向接口。
   - MockProvider：规则式拼接事实（国家/类别/来源数/时间线），零成本零网络，
     结构与真实 provider 返回逐字段一致——替换实现即替换 provider，业务无感。
   - AnthropicProvider：**骨架**。密钥必须走服务端（铁律：前端不存 API key），
     浏览器端调用会直接抛错，防止未来误接线。
   - aiGate：三闸门（严重度阈值 / TTL 缓存 / 并发上限）——WorldMonitor 同款思想。 */

/* global EngineTypes, EngineGeo */

const LLMProvider = (() => {
  const { AI_SCORE_THRESHOLD, AI_CACHE_TTL_MS, AI_MAX_CONCURRENT } = EngineTypes;

  /* ---------- Mock：规则式摘要（生产前占位，输出结构即契约） ---------- */

  const CATEGORY_LABEL = {
    war: '军事冲突', geopolitics: '地缘政治', economy: '宏观经济', central_bank: '央行政策',
    politics: '政治', trade: '贸易', energy: '能源', commodities: '大宗商品',
    markets: '金融市场', technology: '科技', natural_disaster: '自然灾害', social: '社会',
  };

  function summarizeMock(ev) {
    const place = ev.location && ev.countries.length
      ? (EngineGeo.ISO2_NAME[ev.countries[0]] || ev.countries[0])
      : (ev.countries[0] ? EngineGeo.ISO2_NAME[ev.countries[0]] || ev.countries[0] : '全球');
    const cat = CATEGORY_LABEL[ev.categories[0]] || ev.categories[0];
    const first = ev.timeline.length ? ev.timeline[0].note : ev.title;
    const text = `【${place}·${cat}】${first}。`
      + `当前共 ${ev.newsIds.length} 条报道来自 ${ev.countries.length ? '相关地区' : '全球'}，`
      + `严重度 ${ev.severity}/100，综合置信 ${(ev.confidence * 100) | 0}%。`
      + `本段为规则摘要（Mock provider），非模型生成。`;
    return { text, provider: 'mock', model: 'rules-v1', tokens: 0 };
  }

  const mockProvider = { name: 'mock', summarize: (ev) => Promise.resolve(summarizeMock(ev)) };

  /* ---------- Anthropic 骨架：只允许在服务端使用 ---------- */

  function anthropicProvider(config) {
    return {
      name: 'anthropic',
      /** @private 骨架：真实调用必须在服务端（前端禁止持有 API key） */
      summarize() {
        return Promise.reject(new Error('AnthropicProvider 只能在服务端使用（前端禁止持有 API key）。'
          + '部署 Worker 后由 Worker 持钥代理调用，接入点 POST https://api.anthropic.com/v1/messages。'));
      },
    };
  }

  /* ---------- 闸门 + 缓存 + 并发 ---------- */

  const cache = new Map();     // eventId → { text, provider, model, tokens, cachedAt }
  let inFlight = 0;

  function aiGate(ev) {
    // 单一谓词：与 EventEngine.needsAiReview 同源（ARCHITECTURE.md §9/§16），
    // 防止两处阈值漂移；引擎模块未加载时退回本地等价式。
    if (typeof EventEngine !== 'undefined' && EventEngine.needsAiReview) {
      return EventEngine.needsAiReview(ev);
    }
    return ev.confidence < 0.5
      || (ev.severity >= AI_SCORE_THRESHOLD && ev.newsIds.length < 3);
  }

  /**
   * 带三闸门的摘要入口：闸门不过 → 返回 null（不花钱）；
   * 缓存命中 → 直接返回；并发满 → 返回 null（下轮再说）。
   * @param {object} ev Event
   * @param {{provider: {name:string, summarize:Function}}} provider
   */
  function summarizeWithGate(ev, provider) {
    if (!aiGate(ev)) return Promise.resolve(null);
    const hit = cache.get(ev.id);
    if (hit && Date.now() - hit.cachedAt < AI_CACHE_TTL_MS) return Promise.resolve(hit);
    if (inFlight >= AI_MAX_CONCURRENT) return Promise.resolve(null);
    inFlight++;
    let p;
    try { p = provider.summarize(ev); }
    catch (e) { inFlight--; return Promise.reject(e); }   // 同步抛错也要放掉并发名额，否则 3 次后闸门永久关闭
    return Promise.resolve(p).then((r) => {
      inFlight--;
      const entry = Object.assign({ eventId: ev.id, cachedAt: Date.now() }, r);
      cache.set(ev.id, entry);
      return entry;
    }).catch((e) => {
      inFlight--;
      return Promise.reject(e);
    });
  }

  /** 测试/会话隔离用 */
  function resetCache() { cache.clear(); inFlight = 0; }

  return { mockProvider, anthropicProvider, summarizeWithGate, aiGate, resetCache };
})();

if (typeof window !== 'undefined') window.LLMProvider = LLMProvider;
if (typeof module !== 'undefined' && module.exports) module.exports = LLMProvider;
