/* site/net.js —— 全站唯一的网络收口
   所有 fetch 都从这里走：绝对地址只允许 http/https，且拒绝
   localhost / 环回 / 私网 / 保留网段（SSRF 防线）。
   站内相对路径放行——本地 `node scripts/serve.mjs` 就跑在 127.0.0.1 上，
   页面取自己的静态文件不是 SSRF。
   刻意不读 location 来解析相对路径：地址栏是用户可控输入，
   一旦参与解析，每个请求 URL 都带着它的污点。 */
(function () {
  'use strict';

  /** 主机名是否内网/保留。只做字面量判断（不做 DNS 解析）。 */
  function isBlockedHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (h === '::1' || h === '::' || h === '0.0.0.0' || h === '0:0:0:0:0:0:0:1') return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
      const a = +m[1], b = +m[2], c = +m[3];
      if (a === 0 || a === 10 || a === 127) return true;             // 本网/私网A/环回
      if (a === 172 && b >= 16 && b <= 31) return true;              // 私网B
      if (a === 192 && b === 168) return true;                       // 私网C
      if (a === 169 && b === 254) return true;                       // 链路本地
      if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, TEST-NET-1
      if (a === 198 && (b === 18 || b === 19)) return true;          // 基准测试网段
      if (a === 198 && b === 51 && c === 100) return true;           // TEST-NET-2
      if (a === 203 && b === 0 && c === 113) return true;            // TEST-NET-3
      if (a >= 224) return true;                                     // 组播与保留
    }
    return false;
  }

  /** 校验一个 URL 能不能请求：{ok:true} 或 {ok:false, why}
      绝对地址（http/https 开头）解析后过主机名黑名单；
      其余字符串按站内相对路径对待，出现冒号（其他协议）或 //host 一律拒绝。 */
  function allowed(u) {
    const s = String(u == null ? '' : u);
    if (s.startsWith('//')) return { ok: false, why: '协议相对地址被拒绝' };
    if (/^https?:\/\//i.test(s)) {
      let url;
      try { url = new URL(s); } catch (e) { return { ok: false, why: 'URL 解析失败' }; }
      if (isBlockedHost(url.hostname)) {
        return { ok: false, why: '内网或保留地址被拒绝：' + url.hostname };
      }
      return { ok: true };
    }
    if (s.includes(':')) return { ok: false, why: '仅允许 http/https 与站内相对路径' };
    return { ok: true };
  }

  async function safeFetch(u, opts) {
    const g = allowed(u);
    if (!g.ok) throw new Error('SafeNet 拒绝请求：' + g.why + '（' + u + '）');
    return fetch(u, opts);
  }

  window.SafeNet = { fetch: safeFetch, allowed, isBlockedHost };
})();
