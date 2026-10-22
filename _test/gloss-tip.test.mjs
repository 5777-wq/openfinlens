#!/usr/bin/env node
/* gloss-tip.test.mjs —— 悬停「这是什么」+ 科普站链接映射的离线单测（Node 直跑）
 * 用法：node _test/gloss-tip.test.mjs
 *
 * 这一层只做两件事，必须锁死：
 *   1) 映射出去的链接必须真的指向科普站存在的一页（术语 id 不能拼错、不能指向空页）；
 *   2) 没有对应术语的标的，只能给"去科普站里搜这个词"，不能假装科普站有它的一页。
 * 链接指错了不会报错，只会让用户点进去扑空——所以写测试钉住。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};

const ctx = vm.createContext({
  console, Math, Date, JSON, Number, String, Array, Object, Boolean,
  isNaN, parseInt, parseFloat, Infinity, isFinite, encodeURIComponent, RegExp,
});
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/explain.js'), 'utf8'), ctx, { filename: 'explain.js' });
// 载入终端的 universe（和真实页面同一份标的清单）
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/universe.js'), 'utf8'), ctx, { filename: 'universe.js' });
// 资产页清单：终端据此判断能不能给 #/assets/<symbol>（科普站没有数据卡的那几只不给）
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/academy-assets.js'), 'utf8'), ctx, { filename: 'academy-assets.js' });
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/academy-gloss.js'), 'utf8'), ctx, { filename: 'academy-gloss.js' });
const AG = ctx.AcademyGloss;
const EX = ctx.Explain;

/* 科普站（白话金融）术语库当前的 id 与中文名。
   这份清单**不是手写的**——它由 _scripts/collect-academy-terms.mjs 从科普站同步过来
   （data/academy-terms.json，采集流水线每天刷新）。以前这里是一份手抄的 39 条清单，
   科普站术语一多就必然过期，测试直接红；更糟的是它一红，人就会去改测试而不是改映射。
   现在：清单过期 = 映射真的指向了不存在的词条 = 确实该修。 */
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'data/academy-terms.json'), 'utf8'));
const ACADEMY_TERM_IDS = MANIFEST.ids;
const ACADEMY_TERM_NAMES = MANIFEST.names;

test('科普站术语清单是同步来的，不是手抄的（防止清单与科普站悄悄脱节）', () => {
  assert.ok(MANIFEST.count >= 100, '术语清单只有 ' + MANIFEST.count + ' 条，科普站早不止这么多了');
  assert.equal(MANIFEST.count, MANIFEST.ids.length, 'count 与 ids 长度对不上');
  assert.ok(MANIFEST.source, '清单没记来源，出了事不知道该去哪对');
  // 每个 id 都要有中文名——概念页的文案要拿它跟科普站对齐
  for (const id of MANIFEST.ids) {
    assert.ok(MANIFEST.names[id], id + ' 没有中文名');
  }
});

/* ---------------- 链接目标 ---------------- */

test('科普站地址是已上线的部署地址', () => {
  assert.equal(AG.BASE, 'https://5777-wq.github.io/openfin-academy/');
});

test('有对应术语的标的 → 精确的术语页', () => {
  const cases = [
    ['EM:101.GC00Y', 'gold'],
    ['EM:102.CL00Y', 'crude-oil'],
    ['usIXIC', 'nasdaq'],
    ['usINX', 'sp500'],
    ['usDJI', 'dow-jones'],
    ['hkHSI', 'hsi'],
    ['EM:100.N225', 'nikkei'],
    ['EM:100.UDI', 'dollar-index'],
    ['EM:101.SI00Y', 'silver'],
    ['EM:171.US10Y', 'risk-free-rate'],
  ];
  for (const [sym, id] of cases) {
    const t = AG.targetFor(sym, '某名字');
    assert.ok(t, sym + ' 应当有链接');
    assert.equal(t.href, AG.BASE + '#/term/' + id, sym + ' 链接不对');
    assert.equal(t.kind, 'exact', sym + ' 不该是概念页');
    assert.ok(t.label.includes('看完整解释'), sym + ' 文案不对：' + t.label);
  }
});

/* 这一条是回归钉子：科创50 点进去必须是科创50 自己的解释，
   不能因为"都属于 A 股"就一律指到「A股」那个词。 */
test('四个 A 股指数各有各的词，不许一律指到「A股」', () => {
  const cases = [
    ['sh000001', 'sse-index'],
    ['sz399001', 'szse-component'],
    ['sz399006', 'chinext'],
    ['sh000688', 'kechuang-50'],
  ];
  for (const [sym, id] of cases) {
    const t = AG.targetFor(sym, '某名字');
    assert.equal(t.href, AG.BASE + '#/term/' + id, sym + ' 链接不对');
    assert.ok(id !== 'a-share', sym + ' 不该指到 a-share');
  }
});

test('概念页：链接文案必须写明点进去会看到哪个概念', () => {
  const t = AG.targetFor('sh601398', '工商银行');
  assert.equal(t.kind, 'concept');
  assert.equal(t.href, AG.BASE + '#/term/dividend');
  assert.ok(t.label.includes('股息 / 分红'), '文案没写清是哪个概念：' + t.label);
});

test('概念页用的概念名必须与科普站一致', () => {
  for (const [sym, c] of Object.entries(AG.CONCEPT_BY_SYMBOL)) {
    assert.ok(ACADEMY_TERM_IDS.includes(c.id), sym + ' 指向了不存在的术语：' + c.id);
    assert.equal(ACADEMY_TERM_NAMES[c.id], c.name, sym + ' 的概念名对不上');
  }
});

test('终端 universe 里的每一只 → 科普站都有对应的去处（不是搜索页）', () => {
  const t = AG.targetFor('sh600519', '贵州茅台');
  assert.ok(t, '应当有链接');
  assert.equal(t.kind, 'asset');
  assert.equal(t.href, AG.BASE + '#/assets/sh600519');
  assert.ok(t.label.includes('看这一页'), '文案不对：' + t.label);
  // universe 里的每一只都要有页，不许退回搜索页
  const uni = (global.window && global.window.TENCENT_UNIVERSE) || [];
  if (uni.length) {
    const missing = uni.filter((x) => {
      const r = AG.targetFor(x.symbol, x.label);
      return !r || r.kind === 'search';
    });
    assert.equal(missing.length, 0, '这些标的没有专属页面：' + missing.map((x) => x.symbol).join(' '));
  }
});

test('标的页只给科普站真的有数据卡的那几只（不给半空页 = 假入口）', () => {
  const A = ctx.AcademyAssets;
  assert.ok(A && Array.isArray(A.symbols) && A.symbols.length, '资产页清单没加载进来');
  // 清单里的每一只，都该拿到标的页
  for (const sym of A.symbols) {
    const t = AG.targetFor(sym, '某名字');
    assert.ok(t, sym + ' 应当有链接');
    // 有精确/概念映射的优先给映射页，其余才是标的页——两种都算数，
    // 但不能是搜索页
    assert.notEqual(t.kind, 'search', sym + ' 退回了搜索页');
  }
  // 不在清单里的，绝不能给标的页
  const uni = [...(ctx.TENCENT_UNIVERSE || []), ...(ctx.EM_UNIVERSE || [])];
  const fake = uni.filter((x) => !A.symbols.includes(x.symbol));
  const wrong = fake.filter((x) => {
    const t = AG.targetFor(x.symbol, x.label);
    return t && t.kind === 'asset';
  });
  assert.equal(wrong.length, 0,
    '这些标的科普站没有数据卡，却给了标的页：' + wrong.map((x) => x.symbol + ' ' + x.label).join(' '));
});

test('外汇那几只给「外汇」概念页，不给没有数据的标的页', () => {
  for (const sym of ['EM:119.EURUSD', 'EM:119.GBPUSD', 'EM:119.USDJPY', 'EM:133.USDCNH']) {
    const t = AG.targetFor(sym, '某个货币对');
    assert.ok(t, sym + ' 应当有链接');
    assert.equal(t.kind, 'concept', sym + ' 应当走概念页');
    assert.equal(t.href, AG.BASE + '#/term/fx');
    assert.ok(t.label.includes('外汇'), sym + ' 的文案没写清是哪个概念：' + t.label);
  }
});

test('科普站搜不到的词就不给链接（不给「必然扑空」的搜索页）', () => {
  // 科普站真能搜到的词 → 给搜索页
  const t = AG.targetFor('xx999999', '宁德时代');
  assert.ok(t, '应当有链接');
  assert.equal(t.kind, 'search');
  assert.equal(t.href, AG.BASE + '#/search?q=' + encodeURIComponent('宁德时代'));
  assert.ok(t.label.includes('宁德时代'), '链接文案要带上标的名：' + t.label);

  // 科普站根本没有的词 → **不给链接**。
  // 以前无条件给，于是「谷歌-A」「强生」这类点过去必然是「没有找到」——
  // 宁可没有入口，也不要一条死路。
  const dead = AG.targetFor('usGOOGL', '谷歌-A');
  assert.equal(dead, null, '科普站搜不到的词却给了搜索链接：' + (dead && dead.href));
});

test('没有名字 → 不给链接（不硬凑一个空搜索）', () => {
  assert.equal(AG.targetFor('xx999999', ''), null);
  assert.equal(AG.targetFor('', ''), null);
});

test('只有名字、没查到 symbol → 也能给出搜索入口', () => {
  const t = AG.targetFor('', '贵州茅台');
  assert.ok(t);
  assert.equal(t.href, AG.BASE + '#/search?q=' + encodeURIComponent('贵州茅台'));
});

test('映射用到的术语 id 必须都在科普站术语库里', () => {
  for (const [sym, id] of Object.entries(AG.TERM_BY_SYMBOL)) {
    assert.ok(ACADEMY_TERM_IDS.includes(id),
      sym + ' 指向了科普站没有的术语：' + id);
  }
});

test('每个精确映射的标的，本站 explain.js 也必须有一句话（否则链接比解释更具体 = 假入口）', () => {
  for (const sym of Object.keys(AG.TERM_BY_SYMBOL)) {
    // 加密标的的一句话解释放在 CRYPTO_NOTES 里，要带上市场与代码才查得到
    const ex = /USDT$/.test(sym)
      ? EX.of({ symbol: sym, market: 'crypto', code: sym, name: sym })
      : EX.of({ symbol: sym, market: '', name: '' });
    assert.ok(ex && ex.kind === 'specific',
      sym + ' 在 explain.js 里没有精确解释，映射却指向了具体术语页');
  }
});

test('映射的标的形态必须合法（防止拼错 symbol 静默失效）', () => {
  const keys = Object.keys(AG.TERM_BY_SYMBOL).concat(Object.keys(AG.CONCEPT_BY_SYMBOL));
  assert.ok(keys.length >= 20, '映射表太小：' + keys.length);
  for (const k of keys) {
    // 加密标的的 symbol 形态是 <BASE>USDT（与 CRYPTO_UNIVERSE 一致）
    assert.match(k, /^(sh|sz|bj|hk|us|EM:|[A-Z0-9]+USDT$)/, 'symbol 形态异常：' + k);
  }
});

/* ---------------- 浮层模块本身 ---------------- */

test('gloss-tip.js 不得自己发网络请求（解释全部取自本地静态数据）', () => {
  const src = readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|new Image\(/.test(src), '浮层里出现了网络请求');
  assert.ok(!/https?:\/\//.test(src.replace(/https?:\/\/[^\s'"`)]*/g, '')), '浮层里硬编码了外部地址');
});

test('gloss-tip.js 必须接住悬停、滚动与 Esc（否则浮层会挂在屏幕上不走）', () => {
  const src = readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8');
  for (const kw of ['mouseover', 'scroll', 'Escape', 'mouseenter']) {
    assert.ok(src.includes(kw), '缺少事件：' + kw);
  }
});

test('index.html 必须同时挂上科普站入口与浮层脚本', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('https://5777-wq.github.io/openfin-academy/'), '顶栏缺少科普站链接');
  assert.ok(html.includes('js/gloss-tip.js'), '没加载浮层脚本');
  assert.ok(html.includes('js/data/academy-gloss.js'), '没加载映射表');
  assert.ok(!/姊妹站/.test(html), '顶栏不该再出现「姊妹站」这类关系称呼');
});

/* ---------------- 概念标记（data-gloss） ---------------- */

test('概念词必须有一句话解释（没有解释就不该标成概念）', () => {
  const notes = EX.CONCEPT_NOTES || {};
  for (const id of ['momentum', 'low-vol', 'factor-etf', 'pe-ratio', 'turnover-rate',
    'dividend-yield', 'industry-chain', 'rsi', 'macd', 'moving-average']) {
    assert.ok(notes[id], '概念词缺解释：' + id);
    assert.ok(String(notes[id]).length > 10, id + ' 的解释太短');
  }
});

test('index.html 里的概念标记都必须能在 explain.js 找到解释', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const marks = [...html.matchAll(/data-gloss="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(marks.length >= 5, '概念标记太少：' + marks.length);
  const notes = EX.CONCEPT_NOTES || {};
  for (const id of marks) {
    assert.ok(notes[id], '标记了却没解释：' + id);
  }
});

test('概念标记还必须是科普站真实存在的词（浮层里的链接不许扑空）', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const marks = [...html.matchAll(/data-gloss="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(marks)) {
    assert.ok(ACADEMY_TERM_IDS.includes(id), '概念标记指向科普站没有的词：' + id);
  }
});

test('ETF 面板的科普入口必须逐个指向真实存在的术语页（不许假链接）', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/<div class="etf-gloss" id="etfGloss">([\s\S]*?)<\/div>/);
  assert.ok(block, 'ETF 面板里没有科普入口');
  const hrefs = [...block[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5, '科普入口太少了：' + hrefs.length);
  for (const href of hrefs) {
    assert.ok(href.startsWith(AG.BASE), '科普入口指到了别处：' + href);
    const m = href.match(/#\/term\/([a-z0-9-]+)/);
    if (m) {
      assert.ok(ACADEMY_TERM_IDS.includes(m[1]), '科普入口指向不存在的术语：' + m[1]);
    } else {
      // 不是术语页，就得是速查表（带分类参数）
      assert.ok(/#\/data\?cat=(data|fund|asset|macro|basic|micro|player|risk|tech|option)$/.test(href),
        '科普入口指向了不认识的页面：' + href);
    }
  }
});

test('ETF 面板的科普入口必须跟着「科普链接」开关一起消失', () => {
  const gate = readFileSync(path.join(ROOT, 'js/academy-gate.js'), 'utf8');
  assert.ok(/etfGloss/.test(gate), '总开关没管 ETF 面板的科普入口');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="etfGloss"'), 'ETF 面板的科普入口没有 id，没法关');
});

test('ETF 持仓行的成分股也要能问「这是什么」', () => {
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const row = app.match(/const rowHtml = \(x, i, cells, tag\)[\s\S]{0,300}?askBtn\(/);
  assert.ok(row, 'ETF 持仓行没有「?」按钮');
});

test('因子 ETF 那一排必须标出动量与低波（用户问的就是"动量选股怎么选"）', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/data-etfsub="spmo"[^>]*data-gloss="momentum"/.test(html), 'SPMO 没标动量');
  assert.ok(/data-etfsub="splv"[^>]*data-gloss="low-vol"/.test(html), 'SPLV 没标低波');
});

test('详情页必须给每个标的一个去科普站的入口', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="detailGloss"'), '详情页缺少科普站入口');
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(app.includes('detailGloss'), 'app.js 没接详情页入口');
  assert.ok(/OpenFinMeta[\s\S]{0,400}of\(symbol\)/.test(app), 'app.js 没暴露 OpenFinMeta.of');
});

/* ---------------- 科普入口开关（设置里可关） ---------------- */

test('设置里有科普入口的开关，且默认开', () => {
  const store = readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
  assert.ok(/academy:\s*true/.test(store), '设置默认值里没有 academy: true');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="swAcademy"'), '设置面板里没有开关');
  assert.ok(/aria-label="科普链接"/.test(html), '开关缺少无障碍标签');
  assert.ok(html.includes('id="academyLink"'), '顶栏链接没有 id，没法关');
});

test('关掉科普：浮层不弹、顶栏链接与详情页链接一起消失', () => {
  // 行为单测在 gloss-gate.test.mjs（带 DOM 桩，真跑一遍）
  const gate = readFileSync(path.join(ROOT, 'js/academy-gate.js'), 'utf8');
  assert.ok(/academyLink/.test(gate), '总开关里没有顶栏链接');
  assert.ok(/detailGloss/.test(gate), '总开关里没有详情页链接');
  assert.ok(/GlossTip\.apply/.test(gate), '总开关没通知浮层');
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/AcademyGate\.apply/.test(app), 'app.js 没走总开关');
  assert.ok(/AcademyGate\.toggle/.test(app), 'app.js 的开关没走总开关');
  const tip = readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8');
  assert.ok(/if \(!enabled\) return;/.test(tip), '浮层没检查开关');
  assert.ok(/academyOn\(\)/.test(tip), '浮层没读设置');
});

/* ---------------- 问号按钮：解释只在它上面浮出 ---------------- */

test('每个标的旁边都要有「?」按钮', () => {
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/function askBtn\(/.test(app), '没有 askBtn 帮手函数');
  assert.ok(/class="ask" data-ask=/.test(app), '「?」按钮没有 data-ask');
  // 四种行都要有：行情行 / 涨跌榜 / 首屏大卡 / 自选卡
  const qrow = app.match(/<div class="qr-name">[\s\S]{0,400}?<\/div>/);
  assert.ok(qrow && qrow[0].includes('askBtn('), '行情行没有「?」');
  const mv = app.match(/<span class="mv-name">[\s\S]{0,300}?<\/span><\/span>/);
  assert.ok(mv && mv[0].includes('askBtn('), '涨跌榜没有「?」');
  const hero = app.match(/<div class="hero-label">[\s\S]{0,300}?<\/div>/);
  assert.ok(hero && hero[0].includes('askBtn('), '首屏大卡没有「?」');
});

test('解释只在「?」上浮出，不再整行悬停都弹', () => {
  const tip = readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8');
  assert.ok(/closest\('\[data-ask\]'\)/.test(tip), '浮层没认 data-ask');
  assert.ok(!/closest\(SELECTOR\)/.test(tip), '还在整行悬停触发');
  assert.ok(!/data-symbol\]\[data-mv\]/.test(tip), '还绑着整行的标识');
});

test('点「?」不能触发行进入详情', () => {
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(/const ask = e\.target\.closest\('\.ask'\);[\s\S]{0,120}?stopPropagation\(\)/.test(app),
    '「?」的点击没有拦住');
  // 键盘同理：Tab 到「?」按回车不该进详情
  assert.ok(/closest\('\[data-star\]'\) \|\| e\.target\.closest\('\.ask'\)/.test(app),
    '键盘路径没拦住「?」');
});

/* ---------------- 双向跳转与回原位置 ---------------- */

test('浮层链接必须带来源与标的（科普站那边要据此给"回原位置"的出口）', () => {
  const src = readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8');
  assert.ok(src.includes('from=lens'), '链接没带来源标记');
  assert.ok(src.includes('sym='), '链接没带标的');
});

test('终端必须支持 #etf= 深链（科普站的动量/低波词条要落到那一块）', () => {
  const app = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(app.includes('#etf='), 'app.js 没处理 #etf= 深链');
  assert.ok(app.includes('pendingEtfScroll'), 'app.js 没处理滚到因子 ETF 区块');
});

/* ---------------- 因子 ETF 持仓行：名字要从**祖先行**上取 ----------------
   2026-10-22 修的真实缺陷：「?」按钮自己身上没有 data-etfname（名字挂在外层 .srow 上），
   而 getAttribute 不查祖先 → domName 恒为空 → OpenFinMeta 又查不到（行情里没有这 70 只）
   → meta.name 为空 → 整个浮层出不来。77 只成分股里 70 只的「?」当时完全没反应。 */

const ETF_JSON = JSON.parse(readFileSync(path.join(ROOT, 'data/actors/etf.json'), 'utf8'));

/* 最小 DOM 桩：只需要 closest / getAttribute / createElement / 事件 */
function makeNode(attrs = {}, parent = null) {
  const node = {
    attrs: Object.assign({}, attrs),
    parent: parent || null,
    children: [],
    style: {},
    className: '',
    _html: '',
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    contains(el) { let n = el; while (n) { if (n === this) return true; n = n.parent; } return false; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    focus() { this.focused = true; },
    closest(sel) {
      const parts = String(sel).split(',').map(s => s.trim());
      let n = this;
      while (n) {
        for (const p of parts) {
          const m = /^\[([^\]=]+)\]$/.exec(p);
          if (m && n.getAttribute(m[1]) !== null) return n;
        }
        n = n.parent;
      }
      return null;
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return node;
}

/* 装上 DOM 桩并加载真的 gloss-tip.js（行情全空 = 离线场景，正是当初出问题的那一档）。
   科普站去处（AcademyGloss.targetFor）在这里换成桩：这一组要验的是**名字解析**，
   不是科普站那边有没有这一页（那是 academy-gloss.js 的事，它的数据每天都在变）。 */
function bootTip(metaOf, targetFor) {
  const created = [];
  const handlers = {};
  const body = makeNode();
  ctx.document = {
    readyState: 'complete',      // 让 init() 真的跑起来（悬停入口就注册在那儿）
    body,
    createElement: () => { const n = makeNode(); created.push(n); return n; },
    addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
    getElementById: () => null,
  };
  ctx.addEventListener = () => { };
  ctx.innerWidth = 1280;
  ctx.innerHeight = 800;
  ctx.OpenFinMeta = { of: metaOf || (() => null) };   // 离线：行情里查不到这 70 只
  if (targetFor) ctx.AcademyGloss = Object.assign({}, ctx.AcademyGloss, { targetFor });
  vm.runInContext(readFileSync(path.join(ROOT, 'js/gloss-tip.js'), 'utf8'), ctx, { filename: 'gloss-tip.js' });
  return { created, handlers };
}

/* 科普站去处的桩：把"传进来的名字"原样带回链接里，好看清解析到的是哪个名字 */
const echoTarget = (sym, name) => ({
  href: 'https://5777-wq.github.io/openfin-academy/#/search?q=' + encodeURIComponent(name || ''),
  kind: 'search',
  label: '在白话金融里查「' + (name || '') + '」↗',
});

/* 造一行 ETF 持仓行（.srow 上挂名字，行里放「?」），悬停它的「?」 */
function hoverAsk(sym, name, opts) {
  const o = opts || {};
  const { created, handlers } = bootTip(o.metaOf, o.noLink ? (() => null) : echoTarget);
  const row = makeNode({ 'data-etfname': name });
  const wrap = makeNode({ class: 'sr-name' }, row);
  const ask = makeNode({ class: 'ask', 'data-ask': sym }, wrap);
  row.appendChild(wrap);
  (handlers.mouseover || []).forEach(fn => fn({ target: ask, clientX: 20, clientY: 20 }));
  const tip = created[created.length - 1];
  return tip && tip._html ? tip : null;
}

test('因子 ETF 持仓行：77 只成分股的「?」都能出浮层（名字取自祖代行）', () => {
  const rows = [];
  (ETF_JSON.funds || []).forEach(f => (f.holdings || []).forEach(h => {
    if (h.sym) rows.push({ sym: h.sym, name: h.zh || h.ticker });
  }));
  const distinct = new Map(rows.map(r => [r.sym, r]));
  assert.equal(distinct.size, 77, '成分股数量对不上（现在 ' + distinct.size + ' 只）');
  const bad = [];
  for (const [sym, r] of distinct) {
    const tip = hoverAsk(sym, r.name);
    if (!tip) { bad.push(sym + '(无浮层)'); continue; }
  }
  assert.equal(bad.length, 0, '这些成分股的「?」没有浮层：' + bad.join(' '));
});

test('因子 ETF 持仓行：双因子交集视图的 21 只同样要能出浮层', () => {
  const rows = (ETF_JSON.overlap && ETF_JSON.overlap.rows) || [];
  assert.equal(rows.length, 21, '交集视图的行数变了（现在 ' + rows.length + ' 行）');
  const bad = [];
  for (const r of rows) {
    if (!r.sym) continue;
    const tip = hoverAsk(r.sym, r.zh || r.ticker);
    if (!tip) bad.push(r.sym);
  }
  assert.equal(bad.length, 0, '交集视图里这些行的「?」没有浮层：' + bad.join(' '));
});

test('因子 ETF 持仓行：用**真的**科普站数据，77 只成分股也要全部出浮层', () => {
  // 这一条不桩掉科普站：科普站那边给不给链接是它的事（不给就不给，不给死路），
  // 但「这是什么」是本站的静态知识——浮层必须出得来。
  const rows = [];
  (ETF_JSON.funds || []).forEach(f => (f.holdings || []).forEach(h => {
    if (h.sym) rows.push({ sym: h.sym, name: h.zh || h.ticker });
  }));
  const distinct = new Map(rows.map(r => [r.sym, r]));
  assert.equal(distinct.size, 77, '成分股数量对不上（现在 ' + distinct.size + ' 只）');
  const bad = [];
  for (const [sym, r] of distinct) {
    const { created, handlers } = bootTip();      // 真 AcademyGloss
    const row = makeNode({ 'data-etfname': r.name });
    const wrap = makeNode({ class: 'sr-name' }, row);
    const ask = makeNode({ class: 'ask', 'data-ask': sym }, wrap);
    row.appendChild(wrap);
    (handlers.mouseover || []).forEach(fn => fn({ target: ask, clientX: 20, clientY: 20 }));
    const tip = created[created.length - 1];
    if (!tip || !tip._html) bad.push(sym);
  }
  assert.equal(bad.length, 0, '这些成分股的「?」没有浮层：' + bad.join(' '));
});

test('浮层里的名字来自行上的 data-etfname（不在 universe 里的标的会拿它去科普站搜）', () => {
  const tip = hoverAsk('usADI', '亚德诺');
  assert.ok(tip, '没有浮层');
  assert.ok(tip.innerHTML.includes('亚德诺'),
    '浮层里没有用到行上的名字：' + tip.innerHTML.slice(0, 200));
  assert.ok(tip.innerHTML.includes('在白话金融里查'), '没有给出科普站入口：' + tip.innerHTML.slice(0, 200));
});

test('名字优先用行情（data-ask 对应的 symbol 在行情表里的名字），行上的名字只是兜底', () => {
  const tip = hoverAsk('usADI', '行上的名字', {
    metaOf: (sym) => ({ symbol: sym, market: 'us', name: '行情里的名字', code: '' }),
  });
  assert.ok(tip && tip.innerHTML.includes('行情里的名字'),
    '没有优先用行情里的名字：' + (tip ? tip.innerHTML.slice(0, 200) : '(无浮层)'));
  assert.ok(!tip.innerHTML.includes('行上的名字'), '不该用行上的名字盖住行情里的名字');
});

test('科普站没有可信去处时：解释照给，只是不带链接（不给死链，也不让「?」没反应）', () => {
  const tip = hoverAsk('usADI', '亚德诺', { noLink: true });
  assert.ok(tip, '没有浮层——解释是本站的静态知识，不该因为科普站没这一页就没了');
  assert.ok(tip.innerHTML.includes('gt-text'), '浮层里没有解释：' + tip.innerHTML.slice(0, 200));
  assert.ok(!tip.innerHTML.includes('gt-link'), '没有可信去处时不该给链接：' + tip.innerHTML.slice(0, 200));
});

test('基金持股变动行的 data-fundname 同样能被取到（祖先查找覆盖两种行）', () => {
  const { created, handlers } = bootTip(null, echoTarget);
  const row = makeNode({ 'data-fundname': '贵州茅台' });
  const wrap = makeNode({ class: 'sr-name' }, row);
  const ask = makeNode({ class: 'ask', 'data-ask': 'usADI' }, wrap);
  row.appendChild(wrap);
  (handlers.mouseover || []).forEach(fn => fn({ target: ask, clientX: 20, clientY: 20 }));
  const tip = created[created.length - 1];
  assert.ok(tip && tip.innerHTML.includes('贵州茅台'),
    '没取到 data-fundname：' + (tip ? tip.innerHTML.slice(0, 200) : '(无浮层)'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
