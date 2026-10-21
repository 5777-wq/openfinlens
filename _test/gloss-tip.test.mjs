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
vm.runInContext(readFileSync(path.join(ROOT, 'js/data/academy-gloss.js'), 'utf8'), ctx, { filename: 'academy-gloss.js' });
const AG = ctx.AcademyGloss;
const EX = ctx.Explain;

/* 科普站（白话金融）术语库当前的 id 全集。
   科普站增删术语时这里要同步——否则映射可能指向一个不存在的术语页。 */
const ACADEMY_TERM_IDS = [
  'risk-free-rate', 'discount-rate', 'yield-curve', 'inversion', 'inflation',
  'real-rate', 'liquidity', 'ltcm', 'leverage', 'dotcom-bubble', 'gold',
  'crude-oil', 'nasdaq', 'a-share', 'etf', 'dividend', 'risk-free',
];

/* ---------------- 链接目标 ---------------- */

test('科普站地址是已上线的部署地址', () => {
  assert.equal(AG.BASE, 'https://5777-wq.github.io/openfin-academy/');
});

test('有对应术语的标的 → 精确的术语页', () => {
  const cases = [
    ['EM:101.GC00Y', 'gold'],
    ['EM:102.CL00Y', 'crude-oil'],
    ['usIXIC', 'nasdaq'],
    ['sh000001', 'a-share'],
    ['sz399001', 'a-share'],
    ['EM:171.US10Y', 'risk-free-rate'],
    ['EM:171.CN10Y', 'risk-free-rate'],
    ['EM:171.US2Y', 'yield-curve'],
    ['sh601398', 'dividend'],
    ['hk00941', 'dividend'],
  ];
  for (const [sym, id] of cases) {
    const t = AG.targetFor(sym, '某名字');
    assert.ok(t, sym + ' 应当有链接');
    assert.equal(t.href, AG.BASE + '#/term/' + id, sym + ' 链接不对');
    assert.ok(t.label.includes('看完整解释'), sym + ' 文案不对：' + t.label);
  }
});

test('没有对应术语的标的 → 只能给搜索页，不给假入口', () => {
  const t = AG.targetFor('sh600519', '贵州茅台');
  assert.ok(t);
  assert.equal(t.href, AG.BASE + '#/search?q=' + encodeURIComponent('贵州茅台'));
  assert.ok(t.label.includes('贵州茅台'), '链接文案要带上标的名：' + t.label);
});

test('没有名字 → 不给链接（不硬凑一个空搜索）', () => {
  assert.equal(AG.targetFor('sh600519', ''), null);
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

test('每个映射的标的，本站 explain.js 也必须有一句话（否则链接比解释更具体 = 假入口）', () => {
  for (const sym of Object.keys(AG.TERM_BY_SYMBOL)) {
    const ex = EX.of({ symbol: sym, market: '', name: '' });
    assert.ok(ex && ex.kind === 'specific',
      sym + ' 在 explain.js 里没有精确解释，映射却指向了具体术语页');
  }
});

test('映射的标的不得重复指向同一个错误（表本身非空且格式合法）', () => {
  const keys = Object.keys(AG.TERM_BY_SYMBOL);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
