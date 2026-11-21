/* sw.js —— OpenFinLens 终端的离线壳（monorepo Phase 5 新增，范式沿用 Academy sw.js）
 *
 * 策略（Gemini 裁定）：
 *   · data/*.json 与 api/v1/** 强制 Network-First——失败才回退缓存，绝不卡死旧行情；
 *   · 其余同源静态（js/css/assets/manifest）stale-while-revalidate：先给缓存保速度，
 *     后台拿新版写回，下次打开就是新的；
 *   · 激活时清掉所有旧版 ofl-* 缓存（版本号一变即整体换代）；
 *   · 只缓存同源 https（本地 127.0.0.1/localhost 例外）；跨域行情接口一律放行不缓存。
 * 所有缓存读写都是「尽力而为」：Cache API 抛错只能让离线能力变弱，不能让在线访问失败。
 */

'use strict';

const CACHE = 'ofl-v3';                 // ← 发版时修改这个版本号（20261121b 导航裁切/井底槽/logo 徽标/热力图兜底 整体换代）
const CACHE_PREFIX = 'ofl-';            // activate 只清本站自己的旧缓存

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
];

/** 只允许同源 + 安全上下文进入缓存。 */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

function putIfCacheable(cache, request, response) {
  if (!response || !response.ok) return Promise.resolve();
  let target = request;
  try { target = new URL(request.url); } catch (e) { /* 保留原 request */ }
  if (target && typeof target === 'object' && target.range) return Promise.resolve();
  return cache.put(request, response).catch(() => { /* 尽力而为 */ });
}

function isDataFirst(url) {
  const p = url.pathname;
  return p.indexOf('/data/') >= 0 || p.indexOf('/api/') >= 0;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => { /* 壳缓存失败不影响在线访问 */ }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => { /* 尽力而为 */ }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!isCacheable(url)) return;               // 跨域行情接口一律放行

  if (isDataFirst(url)) {
    // 行情/采集产物：Network-First——新数据到手就回，断网才回退缓存，绝不给旧行情
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => putIfCacheable(c, req, copy));
        return res;
      }).catch(() =>
        caches.match(req).then((hit) => hit || new Response(JSON.stringify({ stale: true, offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } })),
      ),
    );
    return;
  }

  // 其余同源静态：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => putIfCacheable(c, req, copy));
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
