/* sources/history.js —— 长历史序列（静态 JSON 优先，浏览器不直连海外源）
   产物由 _scripts/collect-history.mjs 生成，登记在 data/series-map.json */
(function () {
  'use strict';

  const BASE = 'data/history/';
  const cache = new Map();
  const pending = new Map();

  async function loadJSON(path) {
    if (cache.has(path)) return cache.get(path);
    if (pending.has(path)) return pending.get(path);
    const p = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        // 同 content.js：走默认缓存，不强制回源
        const res = await window.SafeNet.fetch(path, { signal: ctl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        cache.set(path, j);
        return j;
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
        pending.delete(path);
      }
    })();
    pending.set(path, p);
    return p;
  }

  /** 载入单条序列 */
  async function series(id) {
    return loadJSON(BASE + id + '.json');
  }

  /** 载入已组合的危机回放包 */
  async function crisis(id) {
    return loadJSON(BASE + 'crisis-' + id + '.json');
  }

  /** 载入序列注册表 */
  async function registry() {
    return loadJSON('data/series-map.json');
  }

  function cached(path) { return cache.get(path) || null; }

  window.History = { BASE, loadJSON, series, crisis, registry, cached, cache };
})();
