/* site/pwa.js —— Service Worker 注册（渐进增强，失败不影响页面）
   约定：
   · 只在 http/https 下注册（file: 打开时浏览器根本不允许 SW，不报错、不尝试）；
   · 注册 './sw.js'——相对站点子路径 /openfin-academy/，不要写死绝对路径；
   · 本地 127.0.0.1 / localhost 是开发环境，默认不注册，避免缓存干扰调试；
     真要测 PWA 就在 URL 上加 ?pwa=1；
   · 任何失败只 console.warn，绝不把异常抛到页面上。
*/
(function (root) {
  'use strict';

  var SW_PATH = './sw.js';
  var pendingRegistration = null;   // 同一页面重复调用只注册一次

  function supported() {
    try {
      return !!(root.navigator && 'serviceWorker' in root.navigator);
    } catch (e) {
      return false;
    }
  }

  /** 当前地址要不要注册：协议、localhost 例外都集中在这里，便于测试。 */
  function shouldRegister(loc) {
    var l = loc || (root.location || {});
    var protocol = String(l.protocol || '');
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    var hostname = String(l.hostname || '').toLowerCase();
    var isLocal = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
    if (!isLocal) return true;
    var search = String(l.search || '');
    return /(?:^\?|&)pwa=1(?:&|$)/.test(search);
  }

  /** 注册；已经注册过就跳过。永不 reject。 */
  function register(opts) {
    var options = opts || {};
    if (!shouldRegister(options.location || root.location)) {
      return Promise.resolve(false);
    }
    if (!supported()) return Promise.resolve(false);
    if (pendingRegistration) return pendingRegistration;
    try {
      var registerFn = root.navigator.serviceWorker.register;
      if (typeof registerFn !== 'function') return Promise.resolve(false);
      var pending = registerFn.call(root.navigator, SW_PATH, { scope: './' });
      if (!pending || typeof pending.then !== 'function') return Promise.resolve(true);
      pendingRegistration = pending
        .then(function (registration) {
          if (options.onUpdate && registration && registration.addEventListener) {
            registration.addEventListener('updatefound', function () {
              try { options.onUpdate(registration); } catch (e) { /* 回调自己负责 */ }
            });
          }
          return true;
        })
        .catch(function (err) {
          console.warn('[pwa] Service Worker 注册失败（不影响正常访问）：', err && err.message ? err.message : err);
          pendingRegistration = null;   // 失败允许下次重试
          return false;
        });
      return pendingRegistration;
    } catch (err) {
      console.warn('[pwa] Service Worker 注册失败（不影响正常访问）：', err && err.message ? err.message : err);
      return Promise.resolve(false);
    }
  }

  root.PWA = { register: register, supported: supported, shouldRegister: shouldRegister, SW_PATH: SW_PATH };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PWA;
})(typeof window !== 'undefined' ? window : globalThis);
