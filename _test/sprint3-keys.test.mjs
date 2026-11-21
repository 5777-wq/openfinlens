#!/usr/bin/env node
/* sprint3-keys.test.mjs —— Sprint 2 切片 S3「Power-User 全站键盘流」验收（2026-11-21）
 * 只覆盖 apps/terminal/js/ui/command.js 本切片的三件事：
 *   ① ⌘K 接入 Academy 文章索引（buildArticleItems 纯函数 / 懒拉路径 / 打分通道 /
 *      去重 key 'article|' / 与术语同框 / openArticle 的真实路由 #/<section>/<id>）
 *   ② ? 快捷键速查浮层（动态 DOM 复用 cmd-* 皮肤、role=dialog、双列清单、开关幂等）
 *   ③ T 键切主题（nextThemeOf 纯函数 + keydown 静态接线 + 输入控件守卫）
 * 加载方式：vm 沙箱（mock window/document/localStorage/fetch），参考 wave1.test.mjs 的
 * usctx 模式；command.js 依赖的 AppNav/AcademyGloss 等给桩。
 * 注意：定时器是同步版——closeKbdSheet 的 220ms 收尾立即落地，断言不必等真实时钟。
 * 用法：node _test/sprint3-keys.test.mjs */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'apps', 'terminal');
const read = (p) => readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push(async () => {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
});
const tick = () => new Promise((r) => setImmediate(r));   // 排空沙箱里挂着的微任务链

/* ---- 真实数据（探明过的结构，直接喂给纯函数与 fetch 桩）---- */
const INDEX = JSON.parse(read(path.join(ROOT, 'apps', 'academy', 'data', 'content', 'index.json')));
const TERMS = { ids: ['cnbond', 'pe'], names: { cnbond: '中债收益率', pe: '市盈率' } };

/* ---- vm 沙箱：mock window/document/localStorage/fetch ---- */
function makeEl(tag) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], id: '', hidden: false, innerHTML: '', tabIndex: -1,
    offsetWidth: 0, parentNode: null, __focused: false,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    appendChild: (c) => { el.children.push(c); c.parentNode = el; return c; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    focus: () => { el.__focused = true; },
    remove: () => {},
  };
  // className 与 classList 同源（command.js 两种写法都用：赋值字符串 / add('is-open')）
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  el.__listeners = listeners;
  el.__attrs = attrs;
  el.__classes = classes;
  return el;
}

/**
 * 装载 command.js 进沙箱。
 * serve(url) → { ok:true, json: async () => data } 或 null（null = 网络失败，走静默分支）。
 * withDom  → document.createElement 返回可检视的假元素（速查浮层 DOM 测试用）。
 */
function loadCommand({ serve, withDom = false, withGloss = true } = {}) {
  const opened = [];        // window.open 捕获
  const fetched = [];       // fetch URL 捕获
  const bodyClasses = new Set();
  const bodyChildren = [];
  const created = [];
  const ctx = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, RegExp, Error, Promise, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat, Infinity, isFinite,
    // 同步定时器：本文件不测异步时序，只需要 220ms 收尾立即落地、无悬挂计时器
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    document: {
      readyState: 'complete',
      documentElement: { dataset: {} },
      body: {
        classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), contains: (c) => bodyClasses.has(c) },
        appendChild: (c) => { bodyChildren.push(c); return c; },
      },
      getElementById: () => null,        // 页面骨架缺席：面板 bind 早退，速查浮层走动态创建
      addEventListener() {},
      createElement: withDom
        ? (tag) => { const el = makeEl(tag); created.push(el); return el; }
        : () => ({ style: {}, remove() {}, addEventListener() {} }),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: (url) => {
      fetched.push(String(url));
      const res = serve ? serve(String(url)) : null;
      if (!res) return Promise.reject(new Error('offline in test'));
      return Promise.resolve({ ok: res.ok !== false, json: () => Promise.resolve(res.data) });
    },
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.open = (url, target, features) => { opened.push({ url, target, features }); return null; };
  ctx.window.AppNav = {
    setTheme(t) { ctx.window.AppNav.__lastTheme = t; return t; },
    setTab() {}, navToPrimary() {}, openIndicator() {}, openSymbol() {},
    toggleTheme() {}, refresh() {}, exportSnapshot() {},
  };
  if (withGloss) ctx.window.AcademyGloss = { BASE: 'academy/' };
  vm.runInContext(readFileSync(path.join(SITE, 'js', 'ui', 'command.js'), 'utf8'), ctx, { filename: 'js/ui/command.js' });
  return { ctx, I: ctx.window.CommandPalette._internals, opened, fetched, bodyClasses, bodyChildren, created };
}

/* ============ ① Academy 文章索引 ============ */

test('buildArticleItems：真实 index.json → 条目形态（kind/group/id/section/label/hint/py）', () => {
  const { I } = loadCommand();
  const items = I.buildArticleItems(INDEX);
  assert.ok(Array.isArray(items), '必须返回数组');
  assert.equal(items.length, INDEX.items.length, '134 篇全量映射（条目数与源一致）');
  const first = items[0];
  assert.equal(first.kind, 'article');
  assert.equal(first.group, '文章');
  assert.equal(first.id, INDEX.items[0].id);
  assert.equal(first.section, INDEX.items[0].section);
  assert.equal(first.label, INDEX.items[0].title);
  assert.equal(first.hint, '白话金融 · 复盘/科普文章');
  assert.match(first.py, /^[A-Z]+$/, 'py 必须是拼音/字母首字母串');
});

test('buildArticleItems：脏输入不炸（null / 空对象 / 缺 title 的条目被跳过）', () => {
  const { I } = loadCommand();
  assert.equal(I.buildArticleItems(null), null);
  assert.equal(I.buildArticleItems({}), null);
  assert.equal(I.buildArticleItems('x'), null);
  const items = I.buildArticleItems({ items: [{ id: 'only-id' }, null, { id: 'ok', section: 'assets', title: '有标题' }] });
  assert.equal(items.length, 1, '缺 title / null 条目被跳过');
  assert.equal(items[0].id, 'ok');
  assert.equal(items[0].label, '有标题');
  assert.equal(items[0].section, 'assets');
});

test('index.json 的 section 全部落在 academy router.js 真实存在的 :id 路由上', () => {
  const routerJs = read(path.join(ROOT, 'apps', 'academy', 'js', 'router.js'));
  const valid = new Set(['assets', 'concepts', 'crisis', 'cycles', 'family', 'reports']);
  for (const a of INDEX.items) {
    assert.ok(valid.has(a.section), '未知 section: ' + a.section);
  }
  for (const s of valid) {
    assert.match(routerJs, new RegExp("path: '/" + s + "/:id'"), 'router.js 必须有 /' + s + '/:id');
  }
  assert.ok(INDEX.items.length >= 100, '文章索引应 ≥100 篇');
});

test('openArticle：URL 走 academy 真实路由 #/<section>/<id> + from=lens + noopener 新标签', () => {
  const { I, opened } = loadCommand();
  I.openArticle({ id: 'CL00Y', section: 'assets' });
  I.openArticle({ id: 'three-statements', section: 'reports' });
  I.openArticle({ id: '2008', section: 'crisis' });
  assert.deepEqual(opened[0], { url: 'academy/#/assets/CL00Y?from=lens', target: '_blank', features: 'noopener' });
  assert.equal(opened[1].url, 'academy/#/reports/three-statements?from=lens');
  assert.equal(opened[2].url, 'academy/#/crisis/2008?from=lens');
});

test('openArticle：id/section 编码、缺 section 回退 assets、脏输入不开窗', () => {
  const { I, opened } = loadCommand();
  I.openArticle({ id: 'a b/c', section: 'assets' });
  assert.equal(opened[0].url, 'academy/#/assets/a%20b%2Fc?from=lens');
  I.openArticle({ id: 'noSection' });
  assert.equal(opened[1].url, 'academy/#/assets/noSection?from=lens');
  I.openArticle(null);
  I.openArticle({});
  assert.equal(opened.length, 2, '无 id 不得调用 window.open');
});

test('openArticle / openTerm：AcademyGloss 缺席时回退同一字面量 academy/', () => {
  const { I, opened } = loadCommand({ withGloss: false });
  I.openArticle({ id: 'CL00Y', section: 'assets' });
  I.openTerm('gzmt');
  assert.equal(opened[0].url, 'academy/#/assets/CL00Y?from=lens');
  assert.equal(opened[1].url, 'academy/#/term/gzmt?from=lens', 'openTerm 行为不被本切片改动');
});

test('懒拉：首次打开/输入触发 academy/data/content/index.json；失败静默只试一次', async () => {
  const { I, fetched } = loadCommand({ serve: (u) => (u === 'academy/data/content/index.json' ? { data: INDEX } : null) });
  I.fetchArticlesIntoLocal();
  await tick();
  assert.ok(fetched.includes('academy/data/content/index.json'), '文章索引用 academy/ 相对路径（不是 data/）');
  assert.ok(fetched.includes('data/us-signals.json'), '原有 us-signals 懒拉保持不动');
  const results = I.buildAll('原油');
  assert.ok(results.some((x) => x.kind === 'article' && x.id === 'CL00Y'), '拉到的文章进入打分通道');
  // 只试一次：再调不重发
  const n = fetched.filter((u) => u === 'academy/data/content/index.json').length;
  I.fetchArticlesIntoLocal();
  assert.equal(fetched.filter((u) => u === 'academy/data/content/index.json').length, n, '失败/成功都不重试轰炸');
});

test('懒拉失败静默：⌘K 仍然可用（只有标的与命令，无文章）', async () => {
  const { I } = loadCommand({ serve: () => null });   // 全部网络失败
  I.fetchArticlesIntoLocal();
  await tick();
  const results = I.buildAll('原油');
  assert.ok(results.every((x) => x.kind !== 'article'), '拉不到时文章通道为空');
});

test('同框搜索：一次查询同时给出 术语(kind:term) + 文章(kind:article)', async () => {
  const { I } = loadCommand({
    serve: (u) => {
      if (u === 'academy/data/content/index.json') return { data: INDEX };
      if (u === 'data/academy-terms.json') return { data: TERMS };
      return null;
    },
  });
  I.fetchArticlesIntoLocal();
  I.fetchTermsIntoLocal();          // 术语与文章同款懒拉入口（openPalette/onInput 里成对触发）
  await tick();
  const results = I.buildAll('中债');
  assert.ok(results.some((x) => x.kind === 'term'), '术语通道在位');
  assert.ok(results.some((x) => x.kind === 'article'), '文章通道在位');
});

test('去重：同 id 文章只出一条（key = article|<id>）', async () => {
  const dup = { items: [
    { id: 'dup', section: 'assets', title: '测试文章甲' },
    { id: 'dup', section: 'assets', title: '测试文章甲' },
  ] };
  const { I } = loadCommand({ serve: (u) => (u === 'academy/data/content/index.json' ? { data: dup } : null) });
  I.fetchArticlesIntoLocal();
  await tick();
  const results = I.buildAll('测试');
  assert.equal(results.filter((x) => x.kind === 'article').length, 1, '重复 id 被 article| 前缀去重');
});

test('runItem 分发：article 条目走 openArticle（静态接线断言）', () => {
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.match(js, /item\.kind === 'article'\)[\s\S]{0,80}openArticle\(item\)/, 'runItem 必须有 article 分支');
  assert.match(js, /kind: 'article'/, '条目 kind');
  assert.match(js, /group: '文章'/, '条目分组');
  assert.match(js, /'article\|' \+ \(x\.item\.id \|\| x\.item\.label\)/, '去重 key 前缀');
});

/* ============ ② ? 快捷键速查浮层 ============ */

test('浮层 DOM：动态创建、复用 cmd-host/cmd-panel、role=dialog aria-label=快捷键速查', () => {
  const { I, bodyChildren, bodyClasses, created } = loadCommand({ withDom: true });
  I.toggleKbdSheet();
  const host = bodyChildren.find((c) => c.classList.contains('cmd-host'));
  assert.ok(host, '浮层宿主挂到 body 且复用 cmd-host');
  assert.equal(host.id, 'kbdSheet');
  assert.equal(host.hidden, false);
  assert.ok(host.classList.contains('is-open'), '打开态类与命令面板同款');
  const panel = host.children.find((c) => c.classList.contains('cmd-panel'));
  assert.ok(panel, '卡片复用 cmd-panel');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-label'), '快捷键速查');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.ok(panel.__focused, '打开时焦点落到面板（对话框语义）');
  assert.ok(bodyClasses.has('modal-open'), '与设置弹层/命令面板共用 modal-open 约定');
  assert.ok(created.length > 0, 'DOM 由 createElement 动态生成');
});

test('浮层内容：KBD_ROWS 静态数组渲染双列清单，每条注明作用', () => {
  const { I, bodyChildren } = loadCommand({ withDom: true });
  I.toggleKbdSheet();
  const host = bodyChildren.find((c) => c.classList.contains('cmd-host'));
  const rows = I.KBD_ROWS;
  assert.equal(rows.length, 4);
  assert.ok(rows[0].keys.includes('1–6') && rows[0].desc.includes('美股信号'), '1–6 切一级板块');
  assert.ok(rows[1].keys.includes('⌘K') && rows[1].desc.includes('文章'), '⌘K / / 全局搜索（标的·术语·文章）');
  assert.ok(rows[2].keys === 'T' && rows[2].desc.includes('纸白'), 'T 切主题');
  assert.ok(rows[3].keys === 'Esc' && rows[3].desc.includes('命令面板'), 'Esc 关闭');
  // DOM 里每个条目一个 .cmd-item，键盘 kbd 与描述都进了 innerHTML
  const cells = [];
  (function walk(n) { (n.children || []).forEach((c) => { if (c.classList && c.classList.contains('cmd-item')) cells.push(c); walk(c); }); })(host);
  assert.equal(cells.length, rows.length, '每个 KBD_ROW 渲染一个 cmd-item');
  const html = cells.map((c) => c.innerHTML).join('\n');
  assert.match(html, /市场 \/ 事件 \/ 资产 \/ 基金 \/ 洞察 \/ 美股信号/);
  assert.match(html, /标的 · 术语 · 文章/);
});

test('浮层开关：再次 ? / Esc / 点遮罩 关闭，幂等且收尾后 hidden', () => {
  const { I, bodyChildren, bodyClasses } = loadCommand({ withDom: true });
  I.toggleKbdSheet();
  const host = bodyChildren.find((c) => c.classList.contains('cmd-host'));
  I.toggleKbdSheet();                              // 再次 ?
  assert.ok(!host.classList.contains('is-open'));
  assert.equal(host.hidden, true, '同步定时器下 220ms 收尾立即落地');
  assert.ok(!bodyClasses.has('modal-open'));
  I.toggleKbdSheet();                              // 再开
  const scrim = host.children.find((c) => c.classList.contains('cmd-scrim'));
  assert.ok(scrim && scrim.__listeners.click && scrim.__listeners.click.length === 1, '遮罩挂了关闭回调');
  scrim.__listeners.click[0]();                    // 点遮罩
  assert.equal(host.hidden, true);
  assert.ok(!bodyClasses.has('modal-open'));
  I.toggleKbdSheet();                              // 再开再关（幂等性最后一道）
  I.toggleKbdSheet();
  assert.equal(host.hidden, true);
});

test('浮层静态接线：keydown 含 ? 分支、输入控件守卫、复用 cmd-* 类', () => {
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.match(js, /e\.key === '\?' \|\| e\.key === '？'/, '? 分支（含全角问号兜底）');
  assert.match(js, /toggleKbdSheet\(\)/, '? → toggle 浮层');
  assert.match(js, /e\.key === 'Escape' && kbdOpen/, 'Esc 兜底关闭浮层');
  assert.match(js, /tag === 'input' \|\| tag === 'textarea' \|\| tag === 'select' \|\| \(t && t\.isContentEditable\)/,
    '输入控件守卫（与 app.js 数字键同款）');
  assert.match(js, /className = 'cmd-host'/, '复用 cmd-host');
  assert.match(js, /className = 'cmd-panel'/, '复用 cmd-panel');
  assert.match(js, /className = 'cmd-scrim'/, '复用 cmd-scrim');
  assert.ok(!/kbd-sheet\.css|kbdSheet\.css/i.test(js), '不允许新增 css 文件引用');
});

/* ============ ③ T 键切主题 ============ */

test('nextThemeOf：daylight→nexus、nexus→daylight、脏值按默认（daylight）处理', () => {
  const { I } = loadCommand();
  assert.equal(I.nextThemeOf('daylight'), 'nexus');
  assert.equal(I.nextThemeOf('nexus'), 'daylight');
  assert.equal(I.nextThemeOf(''), 'daylight');      // app.js DEFAULT_THEME='daylight'，未设视为日光
  assert.equal(I.nextThemeOf(undefined), 'daylight');
  assert.equal(I.nextThemeOf('junk'), 'daylight');
});

test('T 键运行时：读 dataset.theme 反色后走 AppNav.setTheme', () => {
  const { ctx, I } = loadCommand();
  // keydown 全局监听在沙箱里注册不上（bind 因页面骨架缺席早退），
  // 直调与 T 分支同一条执行路径的 toggleThemeKey（AppNav 给桩）：
  ctx.document.documentElement.dataset.theme = 'daylight';
  I.toggleThemeKey();
  assert.equal(ctx.window.AppNav.__lastTheme, 'nexus');
  ctx.document.documentElement.dataset.theme = 'nexus';
  I.toggleThemeKey();
  assert.equal(ctx.window.AppNav.__lastTheme, 'daylight');
  ctx.document.documentElement.dataset.theme = '';
  I.toggleThemeKey();
  assert.equal(ctx.window.AppNav.__lastTheme, 'daylight');
  // 真正的 keydown 接线由静态断言钉死：
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.match(js, /k === 't'/, 'keydown 有 t 分支');
  assert.match(js, /nextThemeOf\(root && root\.dataset \? root\.dataset\.theme : ''\)/, '主题反色必须经 nextThemeOf');
  assert.match(js, /app\.setTheme\(/, '走 AppNav.setTheme（不直接改 DOM 主题）');
  assert.match(js, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return/, '修饰键组合（Ctrl+T 新标签）不劫持');
});

test('键位不冲突：app.js 已占 1-9/0 与 /，未占用 ? 与 t（静态断言）', () => {
  const appjs = read(path.join(SITE, 'js', 'app.js'));
  assert.match(appjs, /\/\^\[0-9\]\$\/\.test\(e\.key\)/, 'app.js 数字键切 tab 在位');
  assert.match(appjs, /e\.key === '\/'/, 'app.js 的 / 聚焦搜索在位');
  assert.ok(!/e\.key === 't'/.test(appjs), 'app.js 未占用 t');
  assert.ok(!/e\.key === '\?'/.test(appjs), 'app.js 未占用 ?（shift+/ 产生 ?，不撞 / 分支）');
});

/* ============ 通用卫生 ============ */

test('command.js：不写死域名、import 零第三方依赖', () => {
  const js = read(path.join(SITE, 'js', 'ui', 'command.js'));
  assert.ok(!/5777-wq\.github\.io/.test(js), '不写死科普站域名');
  assert.ok(!/require\(|^import /m.test(js), '浏览器文件不引模块');
});

/* ---- 汇总 ---- */
(async () => {
  for (const t of tests) await t();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
