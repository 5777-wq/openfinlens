#!/usr/bin/env node
/* tokens.test.mjs —— 设计令牌与发布卫生守卫（纯文本解析，不依赖网络、不依赖浏览器）
 *
 * 为什么需要这一组：css 里的颜色令牌是"人肉维护 + 多份副本"的结构——
 *   · --accent-signature（hex，给 CSS/JS 直接用）与 --accent-rgb（裸三元组，给 rgba() 合成）
 *     必须同值，但它们写在两行里，改一处漏一处不会有任何报错；
 *   · 均线调色板同一份颜色曾分别在 css/charts.js/index.html 各写一遍，改色必然漂移；
 *   · 测试里若用自造的假 CSS 值，就永远测不出上面两件事（历史缺口）。
 * 因此这里直接读真实源文件，把"不可能漂"变成"漂了就红"。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};
const assert = {
  ok: (v, m) => { if (!v) throw new Error(m || '断言失败'); },
  equal: (a, b, m) => { if (a !== b) throw new Error((m || '不相等') + `：${a} !== ${b}`); },
};

const CSS = readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const cssVar = (name, src = CSS) => {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(src);
  return m ? m[1].trim() : null;
};
const hex2rgb = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) throw new Error('不是 #rrggbb 形式: ' + h);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ---------------- 强调色双令牌一致性 ---------------- */

test('--accent-rgb 是裸三元组（否则 rgba(var(--accent-rgb),α) 会静默失效）', () => {
  const v = cssVar('accent-rgb');
  assert.ok(v, 'css 缺少 --accent-rgb');
  assert.ok(/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v), `应为 "r,g,b"，实际 "${v}"`);
  const parts = v.split(',').map(s => +s.trim());
  parts.forEach(p => assert.ok(p >= 0 && p <= 255, '分量越界: ' + p));
});

test('--accent-signature 与 --accent-rgb 必须同值', () => {
  const hex = cssVar('accent-signature');
  const rgb = cssVar('accent-rgb');
  const want = hex2rgb(hex).join(',');
  const got = rgb.split(',').map(s => +s.trim()).join(',');
  assert.equal(got, want, `--accent-rgb 与 --accent-signature(${hex}) 不同步`);
});

test('--accent-signature 不得是 Claude/Anthropic 品牌赭橙 #D97757', () => {
  const hex = cssVar('accent-signature').toLowerCase();
  assert.ok(hex !== '#d97757', '又用回了 #D97757（这是"AI 生成"辨识度最高的信号）');
});

/* ---------------- 均线调色板 ---------------- */

const MA = [0, 1, 2, 3, 4, 5].map(i => cssVar('ma-' + i));
const MA_HEX = /^#[0-9a-f]{6}$/i;

test('6 个均线槽位令牌都存在且是 hex', () => {
  MA.forEach((v, i) => assert.ok(MA_HEX.test(v || ''), `--ma-${i} 缺失或格式不对: ${v}`));
});

test('--ma-0 跟随交互强调色（历史约定：槽位 0 = 品牌色）', () => {
  assert.equal(MA[0].toLowerCase(), cssVar('accent-signature').toLowerCase(), '--ma-0 应与 --accent-signature 同值');
});

test('6 个均线槽位两两不同色', () => {
  const uniq = new Set(MA.map(c => c.toLowerCase()));
  assert.equal(uniq.size, 6, '存在重复槽位色: ' + MA.join(' '));
});

/* CIEDE2000：把"两条线人眼看着像不像"变成可断言的数字。
   阈值 15 是本调色板改动前就存在的下限（--ma-2 绿 vs --ma-5 青 = 15.2），
   任何新配色都不该低于它。 */
const srgb2lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb2lab = ([r, g, b]) => {
  const R = srgb2lin(r), G = srgb2lin(g), B = srgb2lin(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047);
  const fy = f(R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const fz = f((R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
function dE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (y, x) => { const v = Math.atan2(y, x) * 180 / Math.PI; return v < 0 ? v + 360 : v; };
  const H1 = h(b1, a1p), H2 = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = H2 - H1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let Hbp;
  if (C1p * C2p === 0) Hbp = H1 + H2;
  else { const d = Math.abs(H1 - H2); Hbp = d <= 180 ? (H1 + H2) / 2 : (H1 + H2 < 360 ? (H1 + H2 + 360) / 2 : (H1 + H2 - 360) / 2); }
  const T = 1 - 0.17 * Math.cos((Hbp - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * Hbp * Math.PI / 180)
    + 0.32 * Math.cos((3 * Hbp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * Hbp - 63) * Math.PI / 180);
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * 30 * Math.exp(-Math.pow((Hbp - 275) / 25, 2)) * Math.PI / 180) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}
const dE = (a, b) => dE2000(rgb2lab(hex2rgb(a)), rgb2lab(hex2rgb(b)));

test('均线槽位之间的最小色距 ≥ 15（低于即两条线人眼难分）', () => {
  let min = Infinity, who = '';
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const d = dE(MA[i], MA[j]);
    if (d < min) { min = d; who = `--ma-${i}(${MA[i]}) vs --ma-${j}(${MA[j]})`; }
  }
  assert.ok(min >= 15, `最小色距 ${min.toFixed(1)} < 15：${who}`);
});

test('均线槽位不得与涨跌色混淆（ΔE ≥ 15）', () => {
  const up = cssVar('up'), down = cssVar('down');
  MA.forEach((c, i) => {
    assert.ok(dE(c, up) >= 15, `--ma-${i}(${c}) 与涨色 ${up} 色距仅 ${dE(c, up).toFixed(1)}`);
    assert.ok(dE(c, down) >= 15, `--ma-${i}(${c}) 与跌色 ${down} 色距仅 ${dE(c, down).toFixed(1)}`);
  });
});

/* ---------------- 单一来源：不许有第二份字面量 ---------------- */

test('index.html 均线菜单色块必须用 var(--ma-N)，不得写死 hex', () => {
  const i0 = HTML.indexOf('id="maMenu"');
  assert.ok(i0 > 0, '找不到均线菜单');
  const block = HTML.slice(i0, HTML.indexOf('</span>', i0));
  const swatches = [...block.matchAll(/<i style="background:([^"]+)"/g)].map(m => m[1]);
  assert.equal(swatches.length, 6, `应恰好 6 个色块，实际 ${swatches.length}`);
  swatches.forEach((s, i) => assert.ok(s.trim() === `var(--ma-${i})`, `槽位 ${i} 应为 var(--ma-${i})，实际 "${s}"`));
});

test('charts.js 不得再自带一份均线调色板字面量', () => {
  const charts = readFileSync(path.join(ROOT, 'js/charts.js'), 'utf8');
  assert.ok(!/LINE_COLORS\s*=\s*\[/.test(charts), 'charts.js 又出现了 LINE_COLORS 字面量数组');
  assert.ok(charts.includes("varOf('--ma-'"), 'charts.js 应通过 --ma-N 令牌取色');
});

/* ---------------- 发布卫生 ---------------- */

test('index.html 的业务资源 ?v= 必须全部同版本（防缓存穿透失效）', () => {
  const vers = [...HTML.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  assert.ok(vers.length > 10, '没扫到预期的 ?v=，选择器可能失效');
  const uniq = [...new Set(vers)];
  assert.equal(uniq.length, 1, `版本号不统一（漏 bump 会导致用户看到旧缓存）：${uniq.join(' ')}`);
});

test('vendor 库的 ?v= 必须是锁定的语义化版本，不被业务版本号覆盖', () => {
  const vendor = [...HTML.matchAll(/lib\/[^"?]+\?v=([^"&]+)/g)].map(m => m[1]);
  assert.ok(vendor.length >= 3, '没扫到 vendor 资源');
  vendor.forEach(v => assert.ok(/^\d+\.\d+\.\d+$/.test(v), `vendor 版本应形如 1.2.3，实际 "${v}"`));
});

test('开屏 splash 的所有形态都不得复活（解释性注释不计）', () => {
  const files = ['index.html', 'css/style.css', 'js/app.js'];
  const bad = [];
  const PAT = /id="spFill"|id="spStatus"|id="splash"|\.sp-fill|\.sp-track|splash-on|revealSplash|splashProgress|SPLASH_MIN|splashReady/;
  files.forEach(f => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    // 逐行扫描并跟踪块注释/HTML 注释状态：只在"代码行"上报错，避免说明文字里的标识符误报
    let inBlock = false, inHtml = false;
    src.split('\n').forEach((line, n) => {
      const wasCommented = inBlock || inHtml;
      // 更新状态（同一行内的开关按出现顺序粗略处理，足够这类源文件使用）
      let rest = line;
      if (inHtml) { if (rest.includes('-->')) { inHtml = false; rest = rest.slice(rest.indexOf('-->') + 3); } else return; }
      if (inBlock) { if (rest.includes('*/')) { inBlock = false; rest = rest.slice(rest.indexOf('*/') + 2); } else return; }
      const lc = rest.indexOf('//');
      const bc = rest.indexOf('/*');
      const hc = rest.indexOf('<!--');
      if (hc >= 0 && (bc < 0 || hc < bc) && (lc < 0 || hc < lc)) {
        if (!rest.slice(hc).includes('-->')) inHtml = true;
        rest = rest.slice(0, hc);
      } else if (bc >= 0 && (lc < 0 || bc < lc)) {
        if (!rest.slice(bc).includes('*/')) inBlock = true;
        rest = rest.slice(0, bc);
      } else if (lc >= 0) {
        rest = rest.slice(0, lc);
      }
      if (!wasCommented && PAT.test(rest)) bad.push(`${f}:${n + 1}`);
    });
  });
  assert.equal(bad.length, 0, '发现开屏残留: ' + bad.join(', '));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
