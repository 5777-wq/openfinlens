/* pmshare.test.mjs —— 分享卡片：纯离线单测（node _test/pmshare.test.mjs）
   覆盖：源码级合规回归（不外泄上游标识）+ 零网络请求 + 声明文案 + API 形状。

   这一组是"分享"这个动作特有的风险面：一张图片会被转到平台之外，
   一旦图上或链接里带上了上游的 slug / URL / tokenId，就等于替交易平台做了引流。
   所以这里的断言不是"功能对不对"，而是"不该出现的东西有没有出现"。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

const src = readFileSync(path.join(ROOT, 'js/pmshare.js'), 'utf8');
const qrSrc = readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8');

/* 上游标识一旦出现在分享链路里，就等于替交易平台做了引流。
   注意只扫代码不扫注释——注释里正好要写"不得出现 tokenId / slug"，
   连注释一起扫的话，这段规则会把自己判成违规。 */
const FORBIDDEN = /tokenId|clobTokenIds|slug|polymarket\.com|gamma-api|clob\.polymarket|kalshi/i;

/* 剥掉块注释与行注释，剩下的才是真正会跑到浏览器里的代码 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

await test('合规：分享模块代码不含上游标识（tokenId / slug / 交易平台域名）', () => {
  assert.doesNotMatch(stripComments(src), FORBIDDEN,
    '分享链路里出现了上游标识——这会把我们变成交易平台的引流入口');
  // 注释里允许出现这些词（规则说明本身），但不允许出现真实链接
  assert.doesNotMatch(src, /https?:\/\/[^\s'"]*polymarket/i, '注释或代码里出现了上游真实链接');
});

await test('合规：二维码只指向自家站点', () => {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array, TextEncoder });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx, { filename: 'js/pmshare.js' });
  const S = ctx.window.PMShare;
  assert.ok(S && S.SHARE_URL, '没导出 SHARE_URL');
  assert.match(S.SHARE_URL, /^https:\/\/5777-wq\.github\.io\/openfinlens\//, '二维码指向的不是自家站点');
  assert.doesNotMatch(S.SHARE_URL, /ev:|pm:/, '二维码链接里带了事件标识');
});

await test('零网络：分享与二维码模块全程不发请求', () => {
  for (const [name, s] of [['pmshare.js', src], ['qr.js', qrSrc]]) {
    assert.doesNotMatch(s, /\bfetch\s*\(/, `${name} 里出现了 fetch`);
    assert.doesNotMatch(s, /XMLHttpRequest/, `${name} 里出现了 XMLHttpRequest`);
    assert.doesNotMatch(s, /navigator\.sendBeacon/, `${name} 里出现了 sendBeacon`);
  }
});

await test('口径声明：卡片文案里保留"不是预测"与"不构成投资建议"的语义', () => {
  assert.match(src, /不是预测/, '缺少"不是预测"的说明');
  assert.match(src, /不构成投资建议/, '缺少"不构成投资建议"的声明');
  assert.match(src, /不可加总|不可相加|互斥/, '缺少档位能否加总的口径说明');
});

await test('API：导出 mount / open / drawCard，且 open 走 deps 取事件', () => {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array, TextEncoder });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx, { filename: 'js/pmshare.js' });
  const S = ctx.window.PMShare;
  assert.equal(typeof S.mount, 'function');
  assert.equal(typeof S.open, 'function');
  assert.equal(typeof S.drawCard, 'function');
  assert.equal(typeof S.download, 'function');
  // open 必须从 deps 拿事件，而不是自己持有数据（事件数据在 app.js 的 state 里）
  assert.match(src, /deps\.getEvent/, 'open 没有通过 deps 取事件');
  // 取不到事件时必须安静地返回 false，不能画一张空卡
  S.mount({ getEvent: () => null });
  assert.equal(S.open('nope'), false, '取不到事件时应该返回 false');
});

await test('导出：优先系统分享，不可用时退回下载（不给人死按钮）', () => {
  assert.match(src, /navigator\.share/, '没有走 Web Share API');
  assert.match(src, /canShare/, '没有做 canShare 能力探测');
  assert.match(src, /download/, '没有下载兜底');
  // 文件名不能带事件 id
  assert.doesNotMatch(src, /download\s*=\s*`[^`]*\$\{[^}]*id/i, '下载文件名里带了事件 id');
});

await test('分享卡片是"饼图类图像"：互斥事件画环图，独立问句画概率堆叠条', () => {
  // 用户 2026-10-20："分享也应该是饼图之类的图像"——原来整张卡只有文字+细条。
  assert.match(src, /drawDonut/, '缺少环图绘制');
  assert.match(src, /drawStack/, '缺少独立问句事件的堆叠条');
  assert.match(src, /arc\(/, '环图没有画圆弧');
  // 环图口径必须与页面一致：复用 PMCharts.donutSlices，不自己另算一套占比
  assert.match(src, /PMCharts\.donutSlices/, '环图没复用 PMCharts.donutSlices（口径会与页面对不上）');
  // 互斥才画环图：独立问句画环图等于暗示了并不存在的互斥关系
  assert.match(src, /isPartition/, '没有区分互斥/独立事件');
});

await test('分享卡片：环图中心显示最大档位概率，图注说明"占比"与"真实报价"是两件事', () => {
  assert.match(src, /最大档位/, '环图中心没标最大档位');
  assert.match(src, /环图按各档位报价占比绘制/, '缺少"环图是占比形状、数字是真实报价"的说明');
  assert.match(src, /不可相加/, '独立问句事件缺少"概率不可加总"的口径');
});

/* ---------------- 弹层：键盘关不掉（2026-10-22 修） ----------------
   原来的分享弹层：整页没有关闭按钮、打开后不接焦点、Esc 也没人管——
   键盘用户进去以后只能靠鼠标点背景才能出来。 */

const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

await test('分享弹层必须有关闭按钮（原来整页都没有 shareClose，绑定从来没生效）', () => {
  assert.ok(/id="shareClose"/.test(HTML), 'index.html 里没有 shareClose 按钮');
  assert.match(src, /getElementById\('shareClose'\)/, 'pmshare.js 没有去绑这个按钮');
  // Esc 与 Tab 焦点锁现在走公共的 FocusTrap（js/focus-trap.js）——
  // 设置弹层、到价提醒弹层、分享弹层共用同一套「进焦点 / Tab 循环 / 退出还焦点」。
  assert.match(src, /FocusTrap/, 'pmshare.js 没有接公共焦点陷阱（Esc 关不掉 / Tab 会跑出弹层）');
  const trapSrc = readFileSync(path.join(ROOT, 'js/focus-trap.js'), 'utf8');
  assert.match(trapSrc, /addEventListener\('keydown'/, '公共焦点陷阱没有监听 keydown');
});

/* 行为单测：真的把 pmshare.js 跑起来，模拟一次"打开 → Esc → 关闭 → 焦点归还" */
function bootShare() {
  const mk = (id) => ({
    id, hidden: true, disabled: false, focused: false,
    style: {}, innerHTML: '', children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
    },
    attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    focus() { this.focused = true; ctx.document.activeElement = this; },
    contains(el) { return this.children.includes(el); },
    querySelectorAll() { return []; },
  });
  // 画布桩：drawCard 会画一整张卡，方法多到写不完——用 Proxy 兜住
  const ctx2d = new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (k === 'getImageData') return () => ({ data: [] });
      if (k === 'canvas') return t.canvas;
      return () => { };
    },
    set() { return true; },
  });
  const els = {
    shareOverlay: mk('shareOverlay'), sharePreview: mk('sharePreview'),
    shareSave: mk('shareSave'), shareNative: mk('shareNative'), shareClose: mk('shareClose'),
    trigger: mk('trigger'),
  };
  const docHandlers = {};
  const raw = {
    console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array, TextEncoder,
    setTimeout, clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      body: {
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      },
      activeElement: null,
      getElementById: (id) => els[id] || null,
      createElement: (tag) => {
        if (tag === 'canvas') {
          const cv = mk('canvas');
          cv.toDataURL = () => 'data:image/png;base64,';
          cv.getContext = () => ctx2d;
          return cv;
        }
        return mk(tag);
      },
      addEventListener: (t, fn) => { (docHandlers[t] = docHandlers[t] || []).push(fn); },
    },
    requestAnimationFrame: (f) => f(),
  };
  const ctx = vm.createContext(raw);
  ctx.window = ctx; ctx.globalThis = ctx;
  // 公共焦点陷阱要先加载：pmshare.js 的 Esc/Tab 锁现在走它
  vm.runInContext(readFileSync(path.join(ROOT, 'js/focus-trap.js'), 'utf8'), ctx, { filename: 'js/focus-trap.js' });
  vm.runInContext(src, ctx, { filename: 'js/pmshare.js' });
  const fire = (type, e) => (docHandlers[type] || []).forEach(fn => fn(e));
  const open = (active) => {
    const S = ctx.window.PMShare;
    S.mount({ getEvent: () => ({ id: 'e1', title: '测试事件', category: 'politics', outcomes: [{ label: '是', probability: 0.6 }, { label: '否', probability: 0.4 }] }) });
    if (active) ctx.document.activeElement = active;
    const ok = S.open('e1');
    assert.equal(ok, true, '分享弹层没能打开');
    return S;
  };
  return { ctx, els, fire, open };
}

await test('分享弹层：Esc 能关（pmshare.js 自己监听，不依赖 app.js）', () => {
  const { els, fire, open } = bootShare();
  open();
  assert.equal(els.shareOverlay.hidden, false, '弹层没有显示出来');
  fire('keydown', { key: 'Escape', preventDefault() { } });
  assert.equal(els.shareOverlay.classList.contains('active'), false, 'Esc 没有关掉弹层');
});

await test('分享弹层：关闭按钮真的能关', () => {
  const { els, open } = bootShare();
  open();
  assert.equal(els.shareOverlay.hidden, false);
  (els.shareClose.listeners.click || []).forEach(fn => fn({}));
  assert.equal(els.shareOverlay.classList.contains('active'), false, '关闭按钮没有关掉弹层');
});

await test('分享弹层：打开时焦点进弹层，关掉后焦点还给触发它的那一个', () => {
  const { ctx, els, open } = bootShare();
  const S = open(els.trigger);
  assert.equal(els.shareSave.focused, true, '焦点没有进弹层');
  S.hide();
  assert.equal(els.trigger.focused, true, '焦点没有还给触发它的那一个');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
