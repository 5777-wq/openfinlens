// treemap.js 主题化改造（Lead 一次性脚本）：色带从令牌读，日光模式不再是黑画布
const fs = require('fs');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const p = 'D:/57的vibe coding内容/global-fin-dashboard/js/treemap.js';
let s = fs.readFileSync(p, 'utf8');
const crlf = s.indexOf(CR + LF) >= 0;
if (crlf) s = s.split(CR + LF).join(LF);
const rep = (from, to, label) => {
  if (!s.includes(from)) throw new Error('找不到片段：' + (label || from.slice(0, 40)));
  s = s.split(from).join(to);
};

/* 1) 颜色状态：加中性面 / 画布底 / 明暗标记 */
rep(`  let _cs = { up: [255, 92, 92], down: [46, 189, 133] };
  let _csDirty = true;   // 脏标记：paint 不每帧读 getComputedStyle，仅首次与红绿切换时刷新
  function refreshColors() {
    const st = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const up = (body.getPropertyValue('--up') || st.getPropertyValue('--up')).trim();
    const down = (body.getPropertyValue('--down') || st.getPropertyValue('--down')).trim();
    if (up) _cs.up = hexToRgb(up);
    if (down) _cs.down = hexToRgb(down);
    _csDirty = false;
  }

  // 涨跌幅 → 颜色（±3% 封顶，从 #333 线性插值到涨/跌色）
  function pctColor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '#222';
    const t = Math.max(-3, Math.min(3, pct)) / 3;
    const to = t >= 0 ? _cs.up : _cs.down;
    const from = [51, 51, 51];
    const a = Math.abs(t);
    const c = from.map((f, i) => Math.round(f + (to[i] - f) * a));
    return \`rgb(\${c[0]},\${c[1]},\${c[2]})\`;
  }`,
`  /* 颜色状态：红/绿 + **中性面/画布底也来自令牌**。
     2026-11 改造前中性面写死 #333、画布底写死 #0a0a0a —— 深空下没问题，
     日光模式（data-theme="daylight"）会画出一整块黑色画布（用户截图实锤）。 */
  let _cs = {
    up: [255, 92, 92], down: [46, 189, 133],
    neutral: [11, 17, 25], bg: '#0a0f17', dark: true,
  };
  let _csDirty = true;   // 脏标记：paint 不每帧读 getComputedStyle，仅首次与红绿切换时刷新
  const _lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  function refreshColors() {
    const st = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const pick = (n) => ((body.getPropertyValue(n) || st.getPropertyValue(n) || '').trim());
    const up = pick('--up');
    const down = pick('--down');
    if (up) _cs.up = hexToRgb(up);
    if (down) _cs.down = hexToRgb(down);
    const neutral = pick('--bg-elevated');
    if (/^#[0-9a-f]{3,8}$/i.test(neutral)) _cs.neutral = hexToRgb(neutral);
    const bg = pick('--bg-card') || pick('--bg');
    if (bg) _cs.bg = bg;
    _cs.dark = _lum(hexToRgb(_cs.bg)) < 0.5;
    _csDirty = false;
  }

  /* 块面文字色：块本身可能是浅色（日光下的浅中性面），白字会糊。
     按块面亮度二选一，比"统一白字"多一行代码，换来两种模式都读得清。 */
  function inkOn(rgbArr, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    return _lum(rgbArr) > 0.55
      ? \`rgba(11,21,32,\${a})\`
      : \`rgba(255,255,255,\${a})\`;
  }

  /* 涨跌幅 → 颜色（±3% 封顶，从中性面线性插值到涨/跌色）。
     pctRgb 是对外取色与块内文字色的共同来源，pctColor 只是它的 CSS 字符串形式。 */
  function pctRgb(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return _cs.neutral.slice();
    const t = Math.max(-3, Math.min(3, pct)) / 3;
    const to = t >= 0 ? _cs.up : _cs.down;
    const from = _cs.neutral;
    const a = Math.abs(t);
    return from.map((f, i) => Math.round(f + (to[i] - f) * a));
  }
  function pctColor(pct) {
    const c = pctRgb(pct);
    return \`rgb(\${c[0]},\${c[1]},\${c[2]})\`;
  }`, 'colors');

/* 2) 画布底 */
rep(`      ctx.fillStyle = '#0a0a0a';`, `      ctx.fillStyle = _cs.bg;`, 'canvas bg');

/* 3) 组头与描边：随模式取墨（白/黑） */
rep(`            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(sx, sy, sw, 15);`, `            ctx.fillStyle = _cs.dark ? 'rgba(255,255,255,0.06)' : 'rgba(10,20,32,0.06)';
            ctx.fillRect(sx, sy, sw, 15);`, 'group head bg');
rep(`          ctx.strokeStyle = 'rgba(255,255,255,0.10)';`, `          ctx.strokeStyle = _cs.dark ? 'rgba(255,255,255,0.10)' : 'rgba(10,20,32,0.12)';`, 'group border');
rep(`            ctx.fillStyle = 'rgba(255,255,255,0.78)';`, `            ctx.fillStyle = _cs.dark ? 'rgba(255,255,255,0.78)' : 'rgba(11,21,32,0.72)';`, 'group name');

/* 4) 块面文字：按块面亮度取墨 + 悬停描边 */
rep(`        ctx.fillStyle = pctColor(c.item.pct);`, `        const tileRgb = pctRgb(c.item.pct);
        ctx.fillStyle = \`rgb(\${tileRgb[0]},\${tileRgb[1]},\${tileRgb[2]})\`;`, 'tile fill');
rep(`          ctx.strokeStyle = 'rgba(255,255,255,0.85)';`, `          ctx.strokeStyle = inkOn(tileRgb, 0.85);`, 'hover stroke');
rep(`          ctx.fillStyle = 'rgba(255,255,255,0.96)';`, `          ctx.fillStyle = inkOn(tileRgb, 0.96);`, 'name 1');
rep(`          ctx.fillStyle = 'rgba(255,255,255,0.82)';`, `          ctx.fillStyle = inkOn(tileRgb, 0.82);`, 'name 2');
rep(`          ctx.fillStyle = 'rgba(255,255,255,0.94)';`, `          ctx.fillStyle = inkOn(tileRgb, 0.94);`, 'name 3');
rep(`          ctx.fillStyle = 'rgba(255,255,255,0.85)';`, `          ctx.fillStyle = inkOn(tileRgb, 0.85);`, 'name 4');

/* 5) 导出 surface 增加 pctRgb（图例/测试可复用同一取色口径） */
rep(`  return { create, squarify, groupedLayout, pctColor, refreshColors, colorAt, PCT_BANDS, bandOf,`,
  `  return { create, squarify, groupedLayout, pctColor, pctRgb, refreshColors, colorAt, PCT_BANDS, bandOf,`, 'export');

if (crlf) s = s.split(LF).join(CR + LF);
fs.writeFileSync(p, s, 'utf8');
console.log('treemap.js patched', s.length, 'chars');
