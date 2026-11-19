/* site/format.js —— 本站格式化工具（纯函数，node 可测） */
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  /** 2026-10-21 → 2026年10月21日 */
  function cnDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  }

  /** 2026-10-21 → 10月21日 */
  function cnDateShort(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso || '');
    return `${Number(m[2])}月${Number(m[3])}日`;
  }

  /** Date → 2026-10-21 */
  function isoDate(d) {
    const x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return '';
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }

  /** 今天 */
  function today() { return isoDate(new Date()); }

  /** 2026-10-21 → 10月21日 周三 */
  function cnDateWithWeek(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return `${Number(m[2])}月${Number(m[3])}日 周${WEEK[d.getDay()]}`;
  }

  /** 距今天数（正数=过去） */
  function daysSince(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return Math.round((t - d) / 86400000);
  }

  /** 数值 → 字符串，null 安全；按量级自动取小数位 */
  function num(v, digits) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '--';
    const n = Number(v);
    if (!Number.isFinite(n)) return '--';
    const d = digits !== undefined ? digits : (Math.abs(n) >= 1000 ? 0 : (Math.abs(n) >= 10 ? 2 : 3));
    return n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** 百分比，带正负号 */
  function pct(v, digits = 2) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(digits) + '%';
  }

  /** 涨跌幅方向 → 语义 class */
  function dir(v) {
    if (v === null || v === undefined || isNaN(v)) return 'flat';
    const n = Number(v);
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'flat';
  }

  /** 读取分钟数 → 12 min */
  function minutes(m) {
    if (!m && m !== 0) return '';
    return `${m} 分钟`;
  }

  /** HTML 转义 */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 极简 markdown → HTML（受控子集：标题/加粗/斜体/代码/链接/列表/引用/段落/换行） */

  /**
   * 链接协议白名单。
   *
   * 正文里的 markdown 链接会被渲染成 <a href>。如果不做校验，
   * `[点我](javascript:alert(1))` 就会变成一个可点击的 javascript: 链接——
   * 这是内容被投毒时的注入面。现在只放行 http(s)、站内绝对路径和锚点，
   * 其余一律**不生成 <a>**（原样留成文本）。
   */
  const SAFE_HREF = /^(https?:|\/|#)/i;

  function md(src) {
    if (!src) return '';
    const blocks = String(src).replace(/\r\n/g, '\n').split(/\n{2,}/);
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
        const h = String(href).trim();
        if (!SAFE_HREF.test(h)) return m;   // 不安全的协议：不生成链接
        const rel = /^https?:/i.test(h) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${h}"${rel}>${text}</a>`;
      });

    return blocks.map((b) => {
      const t = b.trim();
      if (!t) return '';
      if (/^###\s+/.test(t)) return `<h3>${inline(t.replace(/^###\s+/, ''))}</h3>`;
      if (/^##\s+/.test(t)) return `<h2>${inline(t.replace(/^##\s+/, ''))}</h2>`;
      if (/^>\s?/.test(t)) {
        /* 逐行渲染再拼 <br>。
           以前是 lines.join('<br>') 之后才转义，转义把 <br> 变成了 &lt;br&gt;，
           页面上能直接看到「&lt;br&gt;」这几个字。 */
        const lines = t.split('\n').map((l) => inline(l.replace(/^>\s?/, '')));
        return `<blockquote><p>${lines.join('<br>')}</p></blockquote>`;
      }
      if (/^[-*]\s+/.test(t)) {
        const items = t.split('\n').filter((l) => l.trim()).map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`);
        return `<ul>${items.join('')}</ul>`;
      }
      if (/^\d+\.\s+/.test(t)) {
        const items = t.split('\n').filter((l) => l.trim()).map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`);
        return `<ol>${items.join('')}</ol>`;
      }
      return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
  }

  window.Fmt = {
    cnDate, cnDateShort, cnDateWithWeek, isoDate, today, daysSince,
    num, pct, dir, minutes, esc, md, pad,
  };
})();
