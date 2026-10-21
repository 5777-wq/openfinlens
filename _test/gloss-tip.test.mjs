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

test('终端 universe 里的每一只 → 科普站的标的页（不是搜索页）', () => {
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

test('不在 universe 里的标的 → 只能给搜索页，不给假入口', () => {
  const t = AG.targetFor('xx999999', '某只没收录的票');
  assert.ok(t);
  assert.equal(t.kind, 'search');
  assert.equal(t.href, AG.BASE + '#/search?q=' + encodeURIComponent('某只没收录的票'));
  assert.ok(t.label.includes('某只没收录的票'), '链接文案要带上标的名：' + t.label);
});

test('没有名字 → 不给链接（不硬凑一个空搜索）', () => {
  assert.equal(AG.targetFor('xx999999', ''), null);
  assert.equal(AG.targetFor('', ''), null);
});

test('只有名字、没查到 symbol → 也能给出搜索入口', () => {
  const t = AG.targetFor('', '宁德时代');
  assert.ok(t);
  assert.equal(t.href, AG.BASE + '#/search?q=' + encodeURIComponent('宁德时代'));
});

test('映射用到的术语 id 必须都在科普站术语库里', () => {
  for (const [sym, id] of Object.entries(AG.TERM_BY_SYMBOL)) {
    assert.ok(ACADEMY_TERM_IDS.includes(id),
      sym + ' 指向了科普站没有的术语：' + id);
  }
});

test('每个精确映射的标的，本站 explain.js 也必须有一句话（否则链接比解释更具体 = 假入口）', () => {
  for (const sym of Object.keys(AG.TERM_BY_SYMBOL)) {
    const ex = EX.of({ symbol: sym, market: '', name: '' });
    assert.ok(ex && ex.kind === 'specific',
      sym + ' 在 explain.js 里没有精确解释，映射却指向了具体术语页');
  }
});

test('映射的标的形态必须合法（防止拼错 symbol 静默失效）', () => {
  const keys = Object.keys(AG.TERM_BY_SYMBOL).concat(Object.keys(AG.CONCEPT_BY_SYMBOL));
  assert.ok(keys.length >= 20, '映射表太小：' + keys.length);
  for (const k of keys) {
    assert.match(k, /^(sh|sz|bj|hk|us|EM:)/, 'symbol 形态异常：' + k);
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
      assert.ok(/#\/data\?cat=(data|fund|asset|macro|basic|micro|player|risk|tech)$/.test(href),
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
