/* utils.js —— 请求封装 / 格式化 / 节流 / 缓存 */

// JSONP：用于只给 callback 不给 CORS 头的接口（东财 searchapi）
function fetchJSONP(url, cbParam = 'cb', timeout = 8000) {
  return new Promise((resolve, reject) => {
    // 回调名不能以下划线开头：新浪 roll 接口会拒绝（"callback illegal character"）
    const name = 'gfdcb' + Math.random().toString(36).slice(2, 10);
    const s = document.createElement('script');
    let done = false;
    const cleanup = (keepNoop) => {
      done = true;
      // 超时路径不能把回调真删掉：已发出的 <script> 稍后才到达时，会调用已删除的全局名
      // 抛未捕获 ReferenceError——留个空函数吸收迟到响应。成功/出错路径脚本已落幕，正常删。
      if (keepNoop) window[name] = () => {};
      else delete window[name];
      s.remove();
    };
    const timer = setTimeout(() => {
      if (!done) { cleanup(true); reject(new Error('jsonp timeout')); }
    }, timeout);
    window[name] = (data) => { clearTimeout(timer); cleanup(false); resolve(data); };
    s.onerror = () => { clearTimeout(timer); cleanup(false); reject(new Error('jsonp error')); };
    s.src = url + (url.includes('?') ? '&' : '?') + cbParam + '=' + name;
    document.head.appendChild(s);
  });
}

// 通用请求：直连 → window.PROXY 代理（重试一次）
async function request(url, { gbk = false, timeout = 10000 } = {}) {
  const tryFetch = async (u) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      if (gbk) {
        const res = await fetch(u, { signal: ctl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return new TextDecoder('gbk').decode(await res.arrayBuffer());
      }
      const res = await fetch(u, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  };
  try { return await tryFetch(url); }
  catch (e) {
    if (!window.PROXY) throw e;
    return tryFetch(window.PROXY + '?url=' + encodeURIComponent(url));
  }
}

const throttle = (fn, ms) => {
  let t = 0;
  return (...a) => { const now = Date.now(); if (now - t > ms) { t = now; fn(...a); } };
};
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? '--' : Number(n).toFixed(d);
const fmtPct = n => (n === null || n === undefined || isNaN(n)) ? '--' : (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const fmtChg = (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? '--' : (n > 0 ? '+' : '') + Number(n).toFixed(d);
const fmtVol = n => {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(0) + '万' : String(Math.round(n));
};
// 价格小数位：加密/外汇小价格要多位
const priceDigits = (p) => {
  if (p === null || p === undefined || isNaN(p)) return 2;
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 1) return 2;   // A股 7.28 显示 7.28（去尾零）；外汇第 4 位由市场分支（fx→4）负责
  if (a >= 0.01) return 4;
  return 6;
};
const fmtPrice = (p) => fmt(p, priceDigits(p));

const fmtTime = (ts) => {
  if (!ts) return '--';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};
const fmtAgo = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return Math.floor(s / 86400) + ' 天前';
};

const escapeHTML = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 把"本地墙钟"编码成伪 UTC 秒级时间戳。
// lightweight-charts 对 UTCTimestamp 一律按 UTC 渲染：直接传真实 epoch 会让时间轴
// 平移一个时区（实测上证分时 09:30-15:00 显示成 02:00-07:00）。把墙钟分量用 Date.UTC
// 重新编码后，图表显示出来的就是用户本地时间。分时 / 分钟级 K线必用；日/周K用日期字符串不受影响。
function toChartTime(epochSec) {
  const d = new Date(epochSec * 1000);
  return Math.floor(Date.UTC(
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes()
  ) / 1000);
}

// 内存缓存：最近一次成功数据（降级链兜底）。
// 关键前缀持久化到 localStorage：纯内存缓存刷新页面即清空，若此时主备源恰好都挂，
// 降级链最后一环等于不存在。持久化后跨会话仍有兜底（带时间戳，界面会标注缓存时间）。
const Cache = {
  _m: new Map(),
  // heat:us（美股全市场 ≈1.38 万行）持久化会同步字符串化 ~1.5MB 卡主线程、
  // 逼近 localStorage 5MB 配额（超了以后每次写入都静默失败），只留内存缓存；
  // heat:hk（~2900 行）与 lhb（日频 ~80 行）量级安全，照常持久化兜底
  _persist: ['q:', 'heat:cn', 'heat:crypto', 'heat:hk', 'lhb', 'news', 'report:'],
  _canPersist(key) { return this._persist.some(p => key.startsWith(p)); },
  set(key, val) {
    const e = { val, at: Date.now() };
    this._m.set(key, e);
    if (this._canPersist(key)) {
      try { localStorage.setItem('gfd_cache_' + key, JSON.stringify(e)); }
      catch { /* 超配额时退化为纯内存缓存 */ }
    }
  },
  get(key, maxAge) {
    const e = this._m.get(key);
    if (!e) return null;
    if (maxAge && Date.now() - e.at > maxAge) return null;   // 过期视为未命中
    return e;
  },
  raw(key) {
    let e = this._m.get(key);
    if (!e && this._canPersist(key)) {
      try {
        e = JSON.parse(localStorage.getItem('gfd_cache_' + key));
        if (e && e.val !== undefined) this._m.set(key, e); else e = null;
      } catch { e = null; }
    }
    return e || null;
  },
};

window.U = {
  fetchJSONP, request, throttle, debounce,
  num, fmt, fmtPct, fmtChg, fmtVol, fmtPrice, priceDigits, fmtTime, fmtAgo,
  escapeHTML, Cache, toChartTime,
};
