/* sw.js —— OpenFin Academy 的离线壳（纯手写，无构建）
 *
 * 发版时改这里：CACHE 版本号一变，install 的 skipWaiting 与 activate 的
 * clients.claim 会让新版本立即接管，并清掉所有旧的 ofa-* 缓存。
 * 缓存策略刻意保守：
 *   · 只处理同源 GET；跨域请求一律放行，绝不缓存（行情接口必须实时）。
 *   · 只缓存 https；http 仅在本地 127.0.0.1 / localhost 开发时允许，
 *     避免明文内容进缓存。
 *   · install 只 precache 应用壳，不碰 100 多个 data 文件——否则每次发版
 *     都要重新下载整站数据，安装会拖慢甚至失败。
 *   · 导航 network-first：发版后读者不会一直看到旧页面；断网时才回退到壳。
 *   · data/content 与 data/history 用 stale-while-revalidate：先给旧数据保速度，
 *     后台拿到新数据再写回缓存，下次打开就是新的。
 *   · js/css/fonts 用 cache-first + 后台更新：静态资源带 ?v= 版本号，
 *     命中缓存即可，不必每次回源。
 * 所有缓存读写都是「尽力而为」：Cache API 抛错只能让离线能力变弱，
 * 不能让在线访问失败。
 */

'use strict';

const CACHE = 'ofa-v9';                 // ← 发版时修改这个版本号
const CACHE_PREFIX = 'ofa-';            // activate 只清本站自己的缓存

/* 应用壳：只放首屏必需、体量小的文件。data/*.json 不在其中。 */
const PRECACHE = [
  './',
  'index.html',
  'css/tokens.css',
  'css/layout.css',
  'css/components.css',
  'css/aurora.css',
  'css/home.css',
  'css/motion.css',
  'manifest.webmanifest',
];

const INDEX_URL = 'index.html';

/** 只允许同源 + 安全上下文（本地 127.0.0.1 / localhost 例外）进入缓存。 */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

/** 把成功的、同源、非 opaque 的响应写进缓存；不缓存 Range 片段。 */
function putIfCacheable(cache, request, response) {
  if (!response || !response.ok) return Promise.resolve();
  let target;
  try { target = new URL(request.url); } catch (err) { return Promise.resolve(); }
  if (!isCacheable(target)) return Promise.resolve();
  if (request.headers && request.headers.has('range')) return Promise.resolve();
  return cache.put(request, response.clone()).catch(() => {});
}

/** 统一的离线兜底：不白屏，明确告诉读者这是断网而不是数据不存在。 */
function offline(message) {
  return new Response(message, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/* ---------------- install ----------------
   只装壳。addAll 里任何一个 404 都会让安装失败，所以清单必须短且稳定。
   skipWaiting 让新版本不用等所有旧标签页关掉——否则 reader 可能几周都看不到新版。 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch((err) => {
        // 壳装不全不阻断后续版本：下次打开还会再试。
        console.warn('[sw] precache 失败：', err && err.message ? err.message : err);
      })
      .then(() => self.skipWaiting()),
  );
});

/* ---------------- activate ----------------
   清掉旧版本缓存（只清 ofa-*，不碰同域别的应用），并立即接管已打开的页面。 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

/* ---------------- 策略实现 ---------------- */

/** 导航：network-first。发版后如果 cache-first，读者会一直看旧页面；
    网络失败才回退到 precache 的 index.html（hash 路由由前端自己恢复）。 */
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // 缓存写回是增强，不是导航成功的前提：Cache API 出错不能拖垮页面。
      try {
        const cache = await caches.open(CACHE);
        await putIfCacheable(cache, request, response);
      } catch (err) { /* 忽略缓存写失败 */ }
    }
    return response;
  } catch (err) {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true })
        || await cache.match(INDEX_URL)
        || await cache.match('./');
      if (cached) return cached;
    } catch (cacheErr) { /* 缓存不可用，走下面的离线响应 */ }
    return offline('离线：页面壳尚未缓存');
  }
}

/** stale-while-revalidate：有缓存先返回，同时后台更新；没有就等网络。
    返回 { response, background }：background 由 fetch 处理器**同步**交给
    event.waitUntil——异步回调里再调 waitUntil 会丢生命周期，后台更新可能被浏览器掐掉。 */
function staleWhileRevalidate(request) {
  const cacheOpened = caches.open(CACHE).catch(() => null);
  const cached = cacheOpened
    .then((cache) => (cache ? cache.match(request) : null))
    .catch(() => null);
  const network = fetch(request)
    .then(async (response) => {
      // 后台写回失败不影响这次响应；网络本身成功就已经够用。
      try {
        const cache = await cacheOpened;
        if (cache) await putIfCacheable(cache, request, response);
      } catch (err) { /* 忽略缓存写失败 */ }
      return response;
    })
    .catch(() => null);

  const response = cached.then((hit) => {
    if (hit) return hit;
    return network.then((fresh) => fresh || offline('离线：这份数据还没有缓存'));
  });

  return { response, background: network.then(() => {}) };
}

/** cache-first + 后台更新：静态资源命中就返回，顺带刷新缓存。
    匹配**精确 URL**（含 ?v= 版本号），这样发版换版本号时不会被旧缓存顶掉；
    断网时才退回 ignoreSearch，用 install 时 precache 的无版本号壳文件兜底。 */
function cacheFirst(request) {
  const cacheOpened = caches.open(CACHE).catch(() => null);
  const cached = cacheOpened
    .then((cache) => (cache ? cache.match(request) : null))
    .catch(() => null);
  const network = fetch(request)
    .then(async (response) => {
      try {
        const cache = await cacheOpened;
        if (cache) await putIfCacheable(cache, request, response);
      } catch (err) { /* 忽略缓存写失败 */ }
      return response;
    })
    .catch(() => null);

  const response = cached.then(async (hit) => {
    if (hit) return hit;
    const fresh = await network;
    if (fresh) return fresh;
    try {
      const cache = await cacheOpened;
      if (cache) {
        const fallback = await cache.match(request, { ignoreSearch: true });
        if (fallback) return fallback;
      }
    } catch (err) { /* 缓存不可用，走下面的离线响应 */ }
    return offline('离线：静态资源不可用');
  });

  return { response, background: network.then(() => {}) };
}

function isDataPath(pathname) {
  return pathname.indexOf('/data/content/') >= 0 || pathname.indexOf('/data/history/') >= 0;
}

function isStaticAsset(pathname) {
  return /\.(?:js|mjs|css|woff2?|ttf|otf|eot)$/i.test(pathname)
    || /\/fonts\//i.test(pathname);
}

/* ---------------- fetch ----------------
   顺序很重要：先挡掉跨域 / 非 GET / 明文 http（本地 127.0.0.1 / localhost 除外），
   再按「导航 → 数据 → 静态资源 → 其它」分流。 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (err) { return; }
  if (!isCacheable(url)) return;

  const pathname = url.pathname;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isDataPath(pathname)) {
    const job = staleWhileRevalidate(request);
    event.respondWith(job.response);
    event.waitUntil(job.background);
    return;
  }

  if (isStaticAsset(pathname)) {
    const job = cacheFirst(request);
    event.respondWith(job.response);
    event.waitUntil(job.background);
    return;
  }

  // 其它同源 GET：直接走网络，不介入缓存。
});
