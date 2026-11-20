/* store.js —— 本站本地状态（localStorage，无后端、无埋点） */
(function () {
  'use strict';

  const KEY = 'ofa_';
  const defaults = {
    theme: 'day',            // day | night
    themeAuto: true,         // 首次访问跟随系统，用户手动切换后关闭
    updown: 'red',           // red（红涨绿跌，中式） | green
    lens: true,              // 是否显示「去行情终端」的跨站链接
    pathDone: {},            // 新手路径：lessonId → true
    bookmarks: [],           // 收藏的文章 id
    recent: [],              // 最近阅读
    readAt: {},              // 文章 id → 最后阅读时间
  };

  let mem = null;

  function read() {
    if (mem) return mem;
    let raw = null;
    try { raw = localStorage.getItem(KEY + 'state'); } catch (e) { /* 隐私模式 */ }
    let parsed = {};
    if (raw) { try { parsed = JSON.parse(raw) || {}; } catch (e) { parsed = {}; } }
    mem = Object.assign({}, defaults, parsed);
    return mem;
  }

  function write() {
    try { localStorage.setItem(KEY + 'state', JSON.stringify(mem)); } catch (e) { /* 忽略 */ }
  }

  function get(k) { return read()[k]; }

  function set(k, v) {
    read()[k] = v;
    write();
    return v;
  }

  function toggle(k) {
    const v = read()[k];
    return set(k, v === 'red' ? 'green' : 'red');
  }

  function pushRecent(id) {
    const r = (read().recent || []).filter((x) => x !== id);
    r.unshift(id);
    set('recent', r.slice(0, 12));
  }

  /** 记一次阅读：最近列表 + 读过的时间。收藏页用它显示「今天 / 昨天 / N 天前」。 */
  function touchRead(id) {
    if (!id) return;
    const at = Object.assign({}, read().readAt || {});
    at[id] = Date.now();
    set('readAt', at);
    pushRecent(id);
  }

  function isDone(id) { return !!(read().pathDone || {})[id]; }

  function setDone(id, done) {
    const p = Object.assign({}, read().pathDone || {});
    if (done) p[id] = Date.now(); else delete p[id];
    set('pathDone', p);
  }

  function doneCount() {
    return Object.keys(read().pathDone || {}).length;
  }

  function isBookmarked(id) { return (read().bookmarks || []).indexOf(id) >= 0; }

  function toggleBookmark(id) {
    const b = (read().bookmarks || []).slice();
    const i = b.indexOf(id);
    if (i >= 0) b.splice(i, 1); else b.unshift(id);
    set('bookmarks', b);
    return i < 0;
  }

  window.Store = { get, set, toggle, pushRecent, touchRead, isDone, setDone, doneCount, isBookmarked, toggleBookmark, defaults };
})();
