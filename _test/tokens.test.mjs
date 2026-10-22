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
import { readFileSync, readdirSync } from 'node:fs';
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

test('指标菜单色块必须用 var(--ma-N)，不得写死 hex', () => {
  // 2026-10-20 起指标菜单改成动态渲染（可增删指标），色块不再静态写在 index.html 里，
  // 而是由 app.js 按槽位序号生成。断言的**意图**不变：色板只能来自 CSS 令牌，
  // 不许出现第二份字面量（改了 --ma-N 而菜单不变，就是两处漂移）。
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/id="maMenu"/.test(HTML), '找不到指标菜单');
  const gen = app.slice(app.indexOf('function renderMaMenu'));
  const block = gen.slice(0, gen.indexOf('\n  }'));
  assert.ok(/var\(--ma-\$\{i % 6\}\)/.test(block), '色块必须按槽位序号取 var(--ma-N) 令牌');
  // 菜单与图表两处都不许写死 hex 色值
  const hexInMenu = block.match(/#[0-9a-f]{3,8}\b/gi);
  assert.equal(hexInMenu, null, '指标菜单里出现了写死的 hex 色值: ' + (hexInMenu || []).join(','));
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

test('js/ 全部脚本必须可解析（块注释里写 */ 会让整个文件静默变 undefined）', () => {
  // 真实事故：gdelt.js 头注释里写了"*/5 cron"，*/ 提前终结块注释 → 整个文件 SyntaxError，
  // script 标签不报加载失败、window.EventsSource 变 undefined、事件页永远"数据更新中"。
  // 本项目全部是经典脚本（IIFE），new Function 即可当解析器用。
  const walk = (d) => readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => {
    const p = path.join(ROOT, d, e.name);
    return e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith('.js') ? [p] : []);
  });
  const files = walk('js');
  assert.ok(files.length > 30, 'js 文件数异常，walk 选择器可能失效');
  const bad = [];
  files.forEach(f => {
    try { new Function(readFileSync(f, 'utf8')); }
    catch (e) { bad.push(path.relative(ROOT, f) + ' → ' + e.message.split('\n')[0]); }
  });
  assert.equal(bad.length, 0, '存在语法错误的脚本: ' + bad.join(' | '));
});

/* ---------------- 标签控件的可读性守卫 ----------------
   "tag 逼仄"是一类看不见的回归：padding 少 4px 不会有任何报错，
   只在页面上表现为文字贴着边框。所以把它钉成断言。 */

test('带边框的四种皮肤里 .pill 必须有自己的内边距（文字不能贴框线）', () => {
  // 这四套给 .pill 套了 1px 边框，但基础 .pill 的 padding 是给"下划线型"设计的，
  // 套上边框后文字直接压在框上——用户反馈"tag 做得太逼仄"的根因。
  ['swiss', 'bauhaus', 'clay', 'memphis'].forEach(t => {
    const re = new RegExp(`html\\[data-theme="${t}"\\] \\.pill \\{[^}]*\\}`);
    const m = CSS.match(re);
    assert.ok(m, `${t} 主题里找不到 .pill 规则`);
    const pad = /padding:\s*([^;]+);/.exec(m[0]);
    assert.ok(pad, `${t} 的 .pill 没有内边距`);
    const nums = pad[1].match(/\d+/g).map(Number);
    assert.ok(nums.length >= 2, `${t} 的 .pill 内边距应写"上下 左右"两段，实际 "${pad[1]}"`);
    assert.ok(nums[1] >= 8, `${t} 的 .pill 左右内边距只有 ${nums[1]}px，文字会贴住边框`);
  });
});

test('.chip 筛选器与 .pill 视图切换必须是两套独立的视觉', () => {
  // 混用会让用户读不出层级：筛选器是信息单元（带计数/色点），
  // 视图切换是导航。两者同款时，页面上两行 tag 看起来是一回事。
  assert.ok(/\.chip \{[^}]*border:/.test(CSS), '.chip 应有自己的边框');
  assert.ok(/\.chip \{[^}]*display: inline-flex/.test(CSS), '.chip 应为 inline-flex（色点+文字+计数要能对齐）');
  assert.ok(/\.chip b \{/.test(CSS), '.chip 的计数应有独立样式');
});

test('0 圆角通配不得压掉语义圆点（事件类型色点必须是圆）', () => {
  // 四套设计语言皮肤用 `* { border-radius: 0 !important }` 统一硬朗感，
  // 但它会把 .ev-dot（事件类型前置色点）压成方块，丢掉"这是一个点"的读感。
  ['swiss', 'bauhaus', 'clay', 'memphis'].forEach(t => {
    const re = new RegExp(`html\\[data-theme="${t}"\\] \\.ev-dot[^{]*\\{[^}]*border-radius:\\s*50%`);
    assert.ok(re.test(CSS), `${t} 主题的 .ev-dot 缺少圆角豁免`);
  });
});

/* ---------------- 浅色皮肤下的可读性守卫 ----------------
   "看不见"是一类不会报错的回归：5% 白叠在白底上等于什么都没发生，
   键盘选中的那一行直接在 5 套浅色皮肤里消失。这里把它变成可断言的数字。 */

const THEMES = [':root', 'swiss', 'paper', 'bauhaus', 'clay', 'memphis', 'aurora', 'oled'];
function themeBlock(name) {
  const re = name === ':root'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : new RegExp('html\\[data-theme="' + name + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}');
  const m = CSS.match(re);
  assert.ok(m, '找不到 ' + name + ' 的主题块');
  return m[1];
}
function themeVar(name, block) {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(block);
  return m ? m[1].trim() : null;
}
const srgb2linRel = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relLum = ([r, g, b]) => 0.2126 * srgb2linRel(r) + 0.7152 * srgb2linRel(g) + 0.0722 * srgb2linRel(b);
const contrast = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

test('8 套皮肤都定义了选中/悬停要用到的令牌（--accent-rgb / --bg-hover）', () => {
  THEMES.forEach(t => {
    const b = themeBlock(t);
    assert.ok(themeVar('accent-rgb', b), t + ' 缺 --accent-rgb');
    assert.ok(themeVar('bg-hover', b), t + ' 缺 --bg-hover');
    assert.ok(themeVar('bg-elevated', b), t + ' 缺 --bg-elevated');
  });
});

test('搜索下拉的悬停/选中行不许再写死白色透明层（5% 白叠白底 = 看不见）', () => {
  const rules = CSS.match(/\.sr-item[^{]*\{[^}]*\}/g) || [];
  const joined = rules.join('\n');
  assert.ok(rules.length >= 2, '没扫到 .sr-item 的规则（选择器可能失效）');
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(joined),
    '还在用写死的白色透明层：' + joined.replace(/\s+/g, ' '));
  assert.ok(/var\(--accent-rgb\)/.test(joined), '选中/悬停行没有用主题强调色');
});

test('搜索下拉选中行在 8 套皮肤下都看得见（与面板底色有可辨的色差）', () => {
  THEMES.forEach(t => {
    const b = themeBlock(t);
    const bg = themeVar('bg-elevated', b);
    const rgb = themeVar('accent-rgb', b).split(',').map(s => parseInt(s, 10));
    assert.ok(/^#[0-9a-f]{6}$/i.test(bg), t + ' 的 --bg-elevated 不是 hex：' + bg);
    const base = [1, 3, 5].map(i => parseInt(bg.substr(i, 2), 16));
    const alpha = 0.20;   // .sr-item.sel 的蒙版浓度
    const over = base.map((c, i) => c + (rgb[i] - c) * alpha);
    const ratio = contrast(over, base);
    assert.ok(ratio >= 1.15,
      t + ' 皮肤的选中行与面板底色色差只有 ' + ratio.toFixed(2) + ':1（看得见才算数）');
  });
});

test('「?」按钮桌面端可点区 ≥24×24，字色用 --text-tertiary（浅色皮肤下 --text-faint 太淡）', () => {
  const m = CSS.match(/\n\.ask \{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到桌面端的 .ask 规则');
  const block = m[1];
  assert.ok(/position:\s*relative/.test(block), '没有定位基准，外扩的可点区放不下');
  assert.ok(/var\(--text-tertiary\)/.test(block), '问号字色还是 --text-faint（浅色皮肤下几乎看不见）');
  const after = CSS.match(/\.ask::after \{([^}]*)\}/);
  assert.ok(after, '没有外扩的可点区（.ask::after）');
  const w = /width:\s*(\d+(?:\.\d+)?)px/.exec(after[1]);
  const h = /height:\s*(\d+(?:\.\d+)?)px/.exec(after[1]);
  assert.ok(w && h, '可点区没有写明宽高');
  assert.ok(parseFloat(w[1]) >= 24 && parseFloat(h[1]) >= 24,
    `可点区只有 ${w[1]}×${h[1]}px（要 ≥24×24）`);
});

test('窄屏的「?」仍要保持 26×26（那段是手指头能点到的尺寸，别改坏）', () => {
  const re = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g;
  let m, narrow = null;
  while ((m = re.exec(CSS))) { if (/\.ask \{/.test(m[1])) { narrow = m[1]; break; } }
  assert.ok(narrow, '窄屏媒体查询里没有 .ask 规则');
  const rule = narrow.match(/\.ask \{([\s\S]*?)\}/);
  assert.ok(rule, '窄屏里没有 .ask 规则');
  assert.ok(/width:\s*26px/.test(rule[1]) && /height:\s*26px/.test(rule[1]), '窄屏的可点区不是 26×26');
});

/* ============================================================
   可访问性守卫（2026-10-22）
   ------------------------------------------------------------
   上面那些是"看起来对不对"，这一组是"看不见的回归"：
   涨跌文字对比度、焦点环宽度、焦点环被关掉——三者都不会报错，
   只在页面上表现为低视力用户看不清涨跌、键盘用户不知道焦点在哪。
   全部按 WCAG 相对亮度公式实算（不做目测），逐皮肤给数字。
   ============================================================ */

const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, '');   // 去掉注释再扫规则

// 某个主题的令牌；主题没定义就回落 :root（深色皮肤共用根令牌）
function themeVarOrRoot(name, theme) {
  const v = themeVar(name, themeBlock(theme));
  if (v) return v;
  return themeVar(name, themeBlock(':root'));
}

test('8 套皮肤下涨/跌**文字色**对各自底色都 ≥4.5:1（AA 正文）', () => {
  // 浅色 5 套（paper/swiss/bauhaus/clay/memphis）原来直接用亮色
  // #ff5c5c / #2ebd85，实测只有 2.22~3.03:1 —— AA 正文要 4.5:1。
  // 现在每套浅色皮肤各自覆写 --text-rise / --text-fall（文字专用色），
  // 色块/图形仍然是原来的亮色 --up / --down。
  THEMES.forEach(t => {
    const rise = themeVarOrRoot('text-rise', t);
    const fall = themeVarOrRoot('text-fall', t);
    assert.ok(/^#[0-9a-f]{6}$/i.test(rise), t + ' 的 --text-rise 不是 #rrggbb：' + rise);
    assert.ok(/^#[0-9a-f]{6}$/i.test(fall), t + ' 的 --text-fall 不是 #rrggbb：' + fall);
    const b = themeBlock(t);
    ['bg', 'bg-elevated', 'bg-card'].forEach(surface => {
      const bgHex = themeVar(surface, b);
      assert.ok(/^#[0-9a-f]{6}$/i.test(bgHex), t + ' 的 --' + surface + ' 不是 hex：' + bgHex);
      const bg = hex2rgb(bgHex);
      const up = contrast(hex2rgb(rise), bg);
      const down = contrast(hex2rgb(fall), bg);
      assert.ok(up >= 4.5, `${t} 的涨字色 ${rise} 对 --${surface}(${bgHex}) 只有 ${up.toFixed(2)}:1`);
      assert.ok(down >= 4.5, `${t} 的跌字色 ${fall} 对 --${surface}(${bgHex}) 只有 ${down.toFixed(2)}:1`);
    });
  });
});

test('涨跌文字走 --up-text/--down-text，色块仍走亮色 --up/--down', () => {
  const up = CSS.match(/^\.up\s*\{([^}]*)\}/m);
  assert.ok(up, '找不到 .up 规则');
  assert.ok(/var\(--up-text\)/.test(up[1]), '.up 文字没有走 --up-text：' + up[1]);
  const down = CSS.match(/^\.down\s*\{([^}]*)\}/m);
  assert.ok(down, '找不到 .down 规则');
  assert.ok(/var\(--down-text\)/.test(down[1]), '.down 文字没有走 --down-text：' + down[1]);
  // 分布条/热力图色块是图形，不是文字：必须还是亮色，否则热力图整体变暗
  const bar = CSS.match(/\.brief-bar\s*>\s*\.b-up\s*\{([^}]*)\}/);
  assert.ok(bar && /var\(--up\)/.test(bar[1]), '分布条的色块不该换成文字色');
});

test('全局焦点环宽度 ≥2px（WCAG 2.2 SC 2.4.11）', () => {
  const m = CSS_NC.match(/^:focus-visible\s*\{([^}]*)\}/m);
  assert.ok(m, '找不到全局 :focus-visible 规则');
  const w = /outline:\s*(\d+(?:\.\d+)?)px/.exec(m[1]);
  assert.ok(w, '全局 :focus-visible 的 outline 没写像素宽度：' + m[1].replace(/\s+/g, ' '));
  assert.ok(parseFloat(w[1]) >= 2, `全局焦点环只有 ${w[1]}px（SC 2.4.11 要求 ≥2px）`);
});

test('.bchip:focus-visible 的焦点环不能是 none（产业链概念条）', () => {
  const m = CSS_NC.match(/\.bchip:focus-visible\s*\{([^}]*)\}/);
  assert.ok(m, '找不到 .bchip:focus-visible 规则');
  assert.ok(!/outline:\s*none/.test(m[1]),
    '.bchip 的焦点环被关掉了（合成到浅色皮肤白底只有 1.00:1）：' + m[1].replace(/\s+/g, ' '));
  const w = /outline:\s*(\d+(?:\.\d+)?)px/.exec(m[1]);
  assert.ok(w && parseFloat(w[1]) >= 2, '.bchip 的焦点环宽度不足 2px：' + m[1].replace(/\s+/g, ' '));
});

test('不许用 :focus{outline:none} 把焦点环整个关掉', () => {
  // :focus 的特异性高于全局的 :focus-visible，写了 outline:none 焦点环就没了。
  // 到价提醒弹层的「触发价」输入框原来就是这样——键盘用户看不到自己在哪一格。
  const rules = CSS_NC.match(/[^{}]+\{[^{}]*\}/g) || [];
  const bad = rules.filter(r => {
    const i = r.indexOf('{');
    const sel = r.slice(0, i);
    const body = r.slice(i);
    return /:focus(?![-\w])/.test(sel) && /outline:\s*none/.test(body);
  });
  assert.equal(bad.length, 0, '这些规则把焦点指示关掉了：' +
    bad.map(s => s.replace(/\s+/g, ' ')).join(' | '));
});

test('折叠标题的焦点环要用焦点环专用色（原来的 --border-hover 合成到白底只有 1.90:1）', () => {
  const m = CSS_NC.match(/\[data-fold\][^{]*\.section-head:focus-visible\s*\{([^}]*)\}/);
  assert.ok(m, '找不到折叠标题的焦点环规则');
  assert.ok(/var\(--focus-ring\)/.test(m[1]), '折叠标题的焦点环没有用 --focus-ring：' + m[1]);
});

test('焦点环颜色在 8 套皮肤下都对底色 ≥3:1（WCAG 1.4.11 非文本对比）', () => {
  // clay 的主强调橙压自己的底色只有 2.78:1、memphis 的粉只有 2.86:1，
  // 所以这两套皮肤把焦点环换成同色系深一档的 --focus-ring。
  THEMES.forEach(t => {
    let ring = themeVarOrRoot('focus-ring', t);
    if (ring === 'var(--accent-signature)') ring = themeVarOrRoot('accent-signature', t);
    assert.ok(/^#[0-9a-f]{6}$/i.test(ring), t + ' 的 --focus-ring 不是 hex：' + ring);
    const b = themeBlock(t);
    ['bg', 'bg-elevated'].forEach(surface => {
      const bg = hex2rgb(themeVar(surface, b));
      const r = contrast(hex2rgb(ring), bg);
      assert.ok(r >= 3, `${t} 的焦点环 ${ring} 对 --${surface} 只有 ${r.toFixed(2)}:1（要 ≥3:1）`);
    });
  });
});

test('三个分段控件的按钮都有 aria-pressed（选中态不能只活在 CSS 类里）', () => {
  ['segTheme', 'segUpdown', 'segRefresh'].forEach(id => {
    const m = HTML.match(new RegExp('id="' + id + '"[\\s\\S]*?</div>'));
    assert.ok(m, 'index.html 里找不到 ' + id);
    const buttons = m[0].match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length >= 2, id + ' 里没有按钮');
    buttons.filter(b => !/data-theme="random"/.test(b)).forEach(b => {
      assert.ok(/aria-pressed=/.test(b), id + ' 里的按钮缺 aria-pressed：' + b);
    });
  });
});

test('搜索框要是 combobox（searchbox 角色不支持 aria-expanded / aria-autocomplete）', () => {
  const m = HTML.match(/<input[^>]*id="searchInput"[^>]*>/);
  assert.ok(m, '找不到搜索输入框');
  assert.ok(/role="combobox"/.test(m[0]), '搜索框缺 role="combobox"');
  assert.ok(/aria-autocomplete="list"/.test(m[0]), '搜索框缺 aria-autocomplete="list"');
  assert.ok(/aria-controls="searchResults"/.test(m[0]), '搜索框缺 aria-controls');
  assert.ok(/aria-activedescendant/.test(m[0]), '搜索框缺 aria-activedescendant');
});

test('热力图画布要可聚焦（tabindex="0"）+ 有表格视图兜底', () => {
  const m = HTML.match(/<canvas[^>]*id="heatCanvas"[^>]*>/);
  assert.ok(m, '找不到热力图画布');
  assert.ok(/tabindex="0"/.test(m[0]), '热力图画布不可聚焦，键盘用户拿不到全市场涨跌分布');
  assert.ok(/id="heatTable"/.test(HTML), '没有热力图表格视图（读屏用户的等价入口）');
  assert.ok(/id="heatCursorLive"/.test(HTML), '没有热力图游标播报区');
});

test('三个弹层都接了公共焦点陷阱（js/focus-trap.js）', () => {
  const trap = readFileSync(path.join(ROOT, 'js/focus-trap.js'), 'utf8');
  assert.ok(/summary/.test(trap),
    '焦点陷阱的候选里必须有 <summary>——设置弹层的「数据源自检」是 <details>，漏了它永远拿不到焦点');
  ['js/app.js', 'js/alerts.js', 'js/pmshare.js'].forEach(f => {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/FocusTrap/.test(src), f + ' 没有接公共焦点陷阱（Tab 会跑出弹层 / 关掉后焦点丢失）');
  });
  assert.ok(/js\/focus-trap\.js\?v=/.test(HTML), 'index.html 里没有加载 js/focus-trap.js');
});

test('一级 tab 是 roving tabindex（同一时刻只占一个 Tab 位）', () => {
  const m = HTML.match(/<nav[^>]*id="tabs"[\s\S]*?<\/nav>/);
  assert.ok(m, '找不到顶栏 tablist');
  const tabs = m[0].match(/<button[^>]*role="tab"[^>]*>/g) || [];
  assert.ok(tabs.length >= 10, '顶栏 tab 数量异常');
  const zero = tabs.filter(t => /tabindex="0"/.test(t)).length;
  const minus = tabs.filter(t => /tabindex="-1"/.test(t)).length;
  assert.equal(zero, 1, `有 ${zero} 个 tab 在 Tab 序里（roving tabindex 只允许 1 个）`);
  assert.equal(minus, tabs.length - 1, '其余 tab 应当是 tabindex="-1"');
  // 每个 tab 都要有 id：面板用 aria-labelledby 指向当前那个 tab
  tabs.forEach(t => assert.ok(/\sid="tab-/.test(t), 'tab 缺 id（面板名会一直停在"全球市场"）：' + t));
  assert.ok(/id="view-market"[^>]*aria-labelledby="tab-all"/.test(HTML), '市场面板没有用 aria-labelledby 指向当前 tab');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
