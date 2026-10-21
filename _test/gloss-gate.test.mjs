#!/usr/bin/env node
/* gloss-gate.test.mjs —— 科普入口开关的行为单测（node 直跑，DOM 打桩）
 * 用法：node _test/gloss-gate.test.mjs
 *
 * 这一层要锁死的是「关掉之后终端里一点科普痕迹都不剩」：
 * 悬停浮层不出现、顶栏链接消失、详情页链接消失、概念标记不再暗示可悬停。 */
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

/* ---- 最小 DOM 桩 ---- */
function makeEl(id) {
  return {
    id, hidden: false, classList: { _s: new Set(), toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    attrs: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
  };
}

function boot(settings) {
  const els = {
    academyLink: makeEl('academyLink'),
    detailGloss: makeEl('detailGloss'),
    swAcademy: makeEl('swAcademy'),
  };
  els.swAcademy.classList.toggle('on', true);
  els.swAcademy.setAttribute('aria-checked', 'true');
  const saved = { settings: { ...settings } };
  const ctx = {
    console,
    document: {
      body: { dataset: {} },
      getElementById: (id) => els[id] || null,
    },
    window: null,
    JSON, Object, Boolean, Number, String, Math, Date, RegExp, Error,
  };
  ctx.window = ctx;
  ctx.Store = {
    settings: {
      get: () => Object.assign({ updown: 'red', refresh: 10, showDegraded: true, theme: 'swiss', academy: true }, saved.settings),
      set: (s) => { saved.settings = Object.assign(ctx.Store.settings.get(), s); },
    },
  };
  ctx.GlossTip = { applied: null, apply(v) { this.applied = v; } };
  const context = vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(ROOT, 'js/academy-gate.js'), 'utf8'), context, { filename: 'academy-gate.js' });
  return { ctx: context, els, saved };
}

/* ---------------- 测试 ---------------- */

test('默认是开的', () => {
  const { ctx } = boot({});
  assert.equal(ctx.AcademyGate.isOn(), true);
});

test('存了 academy:false 之后读出来是关的', () => {
  const { ctx, saved } = boot({ academy: false });
  assert.equal(ctx.AcademyGate.isOn(), false);
  assert.equal(saved.settings.academy, false);
});

test('关掉：顶栏链接、详情页链接一起消失，开关自己也是关的', () => {
  const { ctx, els } = boot({});
  ctx.AcademyGate.apply(false);
  assert.equal(els.academyLink.hidden, true, '顶栏链接没隐藏');
  assert.equal(els.detailGloss.hidden, true, '详情页链接没隐藏');
  assert.equal(els.swAcademy.classList.contains('on'), false, '开关显示还开着');
  assert.equal(els.swAcademy.getAttribute('aria-checked'), 'false');
  assert.equal(ctx.document.body.dataset.academy, 'off', 'body 标记没写');
  assert.equal(ctx.GlossTip.applied, false, '浮层没收到关闭指令');
});

test('打开：链接回来、开关是开的、body 标记是 on', () => {
  const { ctx, els } = boot({});
  ctx.AcademyGate.apply(true);
  assert.equal(els.academyLink.hidden, false);
  assert.equal(els.detailGloss.hidden, false);
  assert.equal(els.swAcademy.classList.contains('on'), true);
  assert.equal(els.swAcademy.getAttribute('aria-checked'), 'true');
  assert.equal(ctx.document.body.dataset.academy, 'on');
  assert.equal(ctx.GlossTip.applied, true);
});

test('toggle 会落盘并切状态', () => {
  const { ctx, saved, els } = boot({});
  assert.equal(ctx.AcademyGate.toggle(), false);
  assert.equal(saved.settings.academy, false);
  assert.equal(els.academyLink.hidden, true);
  assert.equal(ctx.AcademyGate.toggle(), true);
  assert.equal(saved.settings.academy, true);
  assert.equal(els.academyLink.hidden, false);
});

test('设置里没这一项的老用户，算开着（不受影响）', () => {
  const { ctx } = boot({ theme: 'swiss' });
  assert.equal(ctx.AcademyGate.isOn(), true);
});

test('index.html 必须加载这个模块', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('js/academy-gate.js'), '没加载 academy-gate.js');
  assert.ok(/id="swAcademy"/.test(html), '设置里没有这个开关');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
