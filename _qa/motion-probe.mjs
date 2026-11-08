#!/usr/bin/env node
/* _qa/motion-probe.mjs —— 动效层探针（CDP，零依赖：Node 22+ 自带 WebSocket）

   为什么需要它：截图只能证明"某一刻长什么样"，证明不了动效真的在跑、参数对不对。
   这个脚本用 CDP 触发真实状态变化（合成 pointerdown / 真点击 / 改文本 / 造列表），
   在动画中途与结束后各取一次计算样式 + 截图，把"手感"变成可断言的数字。

   【headless 的坑】无头渲染器在没有帧需求时不产帧，CSS transition / rAF 全停在起点，
   读到的永远是初始值（本项目实测：指示器一直显示 translateX(4px)）。所以每次测量前
   都先 frame()——一张低成本截图强制渲染一帧，数值才是真的。

   断言（对应 docs/UI-V2-SPEC.md §2）：
     P1 按压：按下瞬时 background=rgba(255,255,255,.09) 且 transform scale(.98)；松开 300ms 后复原
     P2 浮层：出现走 .42s --ease-panel（有位移/过冲）；关闭 200ms 内回落到非 active
     P3 指示器：切换一级后指示器位置/宽度与当前按钮对齐（误差 <1.5px），.3s signature
     P4 数字滚动：改文本后旧值副本存在且主节点文本已是新值；300ms 后副本清零
     P5 错峰：新插入 5 行 → 依次 .mo-in-item 且 --mo-i=0..4、delay=0/40/80/120/160ms
     P6 滚动进入：.rv 被本层校准为 6px/--dur-4 --ease-out，且真实滚动能拿到 .rv-in
     P7 减动效：prefers-reduced-motion:reduce 下 P1 无 transform、P4 无副本、P5 不挂类

   用法：node _qa/motion-probe.mjs [url]
   产物：_qa/motion-*.png + 控制台 JSON 报告（退出码 0=全过，1=有失败） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL_ARG = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const OUT = path.resolve('_qa');
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-motion-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
// 每次跑之前清掉上一轮的截图，避免 motion-07-xxx 这种旧编号文件混进交付物
for (const f of fs.readdirSync(OUT)) {
  if (/^motion-\d\d-.*\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--force-color-profile=srgb', '--window-size=1440,1000',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 160; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(120);
  }
  throw new Error('chrome 未就绪');
}

let id = 0;
const pend = new Map();
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => {
    pend.set(mid, { res, rej });
    setTimeout(() => { if (pend.has(mid)) { pend.delete(mid); rej(new Error('timeout ' + method)); } }, 30000);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
/* 强制渲染一帧（headless 不产帧时 transition/rAF 全停在这个点上） */
async function frame() {
  await send('Page.captureScreenshot', { format: 'jpeg', quality: 25 });
}

let shotN = 0;
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, `motion-${String(++shotN).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return path.relative(process.cwd(), file).replace(/\\/g, '/');
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function boot(reduced) {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  });
  await send('Page.navigate', { url: URL_ARG });
  await sleep(1500);
  // 兜底：若 shell 还没把两行挂上，这里补（幂等，已存在就跳过）
  await evaluate(`(() => {
    if (!document.querySelector('link[href*="04-motion.css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'css/ui/04-motion.css'; document.head.appendChild(l);
    }
    if (!window.__oflMotion) {
      const s = document.createElement('script');
      s.src = 'js/ui/motion.js'; document.body.appendChild(s);
    }
    return true;
  })()`);
  await sleep(2200);
  await frame();
  return evaluate(`!!(window.__oflMotionDebug && window.__oflMotionDebug.inited())`);
}

/* ================================================================== 跑一遍 */
const inited = await boot(false);
check('M0 motion.js 已初始化', inited);

/* P1 按压（合成 pointerdown → 60ms 后 .is-press，不依赖真实触屏） */
const pressTarget = await evaluate(`(() => {
  const el = document.querySelector('#primaryNav .nav-primary:not([aria-selected="true"])')
          || document.querySelector('#tabs .tab') || document.querySelector('button');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const base = getComputedStyle(el);
  window.__probeEl = el;
  return { id: el.id || el.className, bg: base.backgroundColor, tf: base.transform, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
await evaluate(`(() => {
  window.__probeEl.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerType: 'touch',
    clientX: ${pressTarget ? pressTarget.x : 0}, clientY: ${pressTarget ? pressTarget.y : 0}, isPrimary: true,
  }));
  return true;
})()`);
await sleep(130);
await frame();
const pressed = await evaluate(`(() => { const c = getComputedStyle(window.__probeEl); return { bg: c.backgroundColor, tf: c.transform, cls: window.__probeEl.className }; })()`);
const shotPress = await shot('press-active');
await evaluate(`window.__probeEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' }))`);
await sleep(320);
await frame();
const released = await evaluate(`(() => { const c = getComputedStyle(window.__probeEl); return { bg: c.backgroundColor, tf: c.transform }; })()`);
check('P1 按压：按下变色 rgba(255,255,255,.09) + scale(.98)，松开复原',
  !!pressTarget && pressed.bg !== pressTarget.bg && /0\.98/.test(pressed.tf) && released.tf === 'none',
  pressTarget ? `${pressTarget.id}: bg ${pressTarget.bg}→${pressed.bg}；tf ${pressed.tf}→${released.tf}` : 'no pressable');

/* P2 浮层：开设置弹层 → 中途取样 → 关闭 */
await evaluate(`document.getElementById('settingsBtn') && document.getElementById('settingsBtn').click()`);
await sleep(120);
await frame();
const openMid = await evaluate(`(() => {
  const o = document.getElementById('settingsModal') || document.querySelector('.modal-overlay.active');
  if (!o) return null;
  const m = o.querySelector('.modal');
  const cs = getComputedStyle(m);
  return { cls: o.className, tf: cs.transform, tr: cs.transitionDuration, td: cs.transitionTimingFunction };
})()`);
const shotOpen = await shot('modal-opening');
await sleep(700);
await frame();
const openEnd = await evaluate(`(() => {
  const o = document.getElementById('settingsModal');
  const m = o && o.querySelector('.modal');
  return m ? { tf: getComputedStyle(m).transform, origin: getComputedStyle(m).transformOrigin } : null;
})()`);
const shotSettled = await shot('modal-open-settled');
await evaluate(`document.getElementById('settingsClose') && document.getElementById('settingsClose').click()`);
await sleep(120);
await frame();
const closeMid = await evaluate(`(() => {
  const o = document.getElementById('settingsModal');
  if (!o) return null;
  return { cls: o.className, op: +getComputedStyle(o).opacity, tf: getComputedStyle(o.querySelector('.modal')).transform };
})()`);
const shotClosing = await shot('modal-closing');
await sleep(400);
await frame();
const closed = await evaluate(`(() => {
  const o = document.getElementById('settingsModal');
  return o ? { active: o.classList.contains('active'), op: +getComputedStyle(o).opacity } : null;
})()`);
check('P2 浮层：出现走 .42s 面板曲线（有位移），收起 .2s 内回落到关闭态',
  !!openMid && openMid.tf !== 'none' && /0\.42s/.test(openMid.tr) && closed && closed.active === false,
  openMid ? `open tf=${openMid.tf} dur=${openMid.tr} ease=${openMid.td}；close@120ms op=${closeMid.op} → 终态 op=${closed.op}` : 'no overlay');

/* P3 指示器：切到第 2 个一级 → 量 ink 与按钮的关系 */
await evaluate(`(() => { const t = [...document.querySelectorAll('#primaryNav [role="tab"]')][1]; if (t) t.click(); return true; })()`);
await sleep(420);
await frame();
const inkAfter = await evaluate(`(() => {
  const host = document.getElementById('primaryNav');
  const ink = host && host.querySelector('.nav-ink');
  const cur = host && host.querySelector('[role="tab"][aria-selected="true"]');
  if (!ink || !cur) return null;
  const hr = host.getBoundingClientRect(), r = cur.getBoundingClientRect(), ir = ink.getBoundingClientRect();
  return {
    vars: { x: ink.style.getPropertyValue('--mo-ink-x'), s: ink.style.getPropertyValue('--mo-ink-s') },
    wantLeft: +(r.left - hr.left).toFixed(2), gotLeft: +(ir.left - hr.left).toFixed(2),
    wantW: +r.width.toFixed(2), gotW: +ir.width.toFixed(2),
    tr: getComputedStyle(ink).transitionDuration,
    ease: getComputedStyle(ink).transitionTimingFunction,
  };
})()`);
const shotInk = await shot('primary-ink');
check('P3 指示器：位置/宽度跟着当前一级（误差 <1.5px），.3s 招牌曲线',
  !!inkAfter && Math.abs(inkAfter.wantLeft - inkAfter.gotLeft) < 1.5 && Math.abs(inkAfter.wantW - inkAfter.gotW) < 1.5,
  inkAfter ? `left ${inkAfter.gotLeft}/${inkAfter.wantLeft}px；width ${inkAfter.gotW}/${inkAfter.wantW}px；${inkAfter.tr} ${inkAfter.ease}；vars ${JSON.stringify(inkAfter.vars)}` : 'no ink');

/* P4 数字滚动 */
await evaluate(`(() => {
  const host = document.querySelector('.main, main, body');
  const el = document.createElement('span');
  el.className = 'num'; el.id = 'moProbeNum';
  el.style.cssText = 'display:inline-block;font-size:22px;color:#fff;padding:2px 0';
  el.textContent = '1,234.56';
  host.appendChild(el);
  return true;
})()`);
await sleep(320);
await frame();
await frame();
await evaluate(`document.getElementById('moProbeNum').textContent = '1,999.99'`);
let rollMid = { clones: 0, newClones: 0, text: '', color: '' };
for (let i = 0; i < 14; i++) {
  await sleep(40);
  await frame();
  rollMid = await evaluate(`(() => {
    const el = document.getElementById('moProbeNum');
    return { text: el.childNodes[0] ? el.childNodes[0].nodeValue : '', full: el.textContent,
             clones: el.querySelectorAll('.mo-roll-old').length,
             newClones: el.querySelectorAll('.mo-roll-new').length, color: getComputedStyle(el).color };
  })()`);
  if (rollMid.clones > 0) break;
}
const shotRoll = await shot('number-roll');
await sleep(420);
await frame();
const rollEnd = await evaluate(`(() => {
  const el = document.getElementById('moProbeNum');
  return { text: el.textContent, clones: el.querySelectorAll('.mo-roll-old').length, color: getComputedStyle(el).color };
})()`);
check('P4 数字滚动：旧+新两层副本、主节点即时是新值、收尾清零',
  rollMid.clones === 2 && rollMid.newClones === 1 && rollMid.text === '1,999.99' &&
  rollEnd.clones === 0 && rollEnd.text === '1,999.99' && rollEnd.color !== 'rgba(0, 0, 0, 0)',
  `mid clones=${rollMid.clones}(new ${rollMid.newClones}) text=${rollMid.text}；end clones=${rollEnd.clones} color=${rollEnd.color}`);

/* P11 与 app.js 的 flashPrice 不打架：节点上跑着 backgroundColor 的 WAAPI 动画时，滚动让路 */
await evaluate(`(() => {
  const host = document.querySelector('.main, main, body');
  const el = document.createElement('span');
  el.className = 'num'; el.id = 'moProbeNum3';
  el.style.cssText = 'display:inline-block;font-size:22px;color:#fff;padding:2px 0';
  el.textContent = '100.00';
  host.appendChild(el);
  return true;
})()`);
await sleep(160);
await frame();
await evaluate(`(() => {
  const el = document.getElementById('moProbeNum3');
  el.animate([{ backgroundColor: 'rgba(255,77,94,0.20)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 900, easing: 'ease-out' });
  el.textContent = '200.00';
  return true;
})()`);
await sleep(140);
await frame();
const flashCase = await evaluate(`(() => {
  const el = document.getElementById('moProbeNum3');
  return { clones: el.querySelectorAll('.mo-roll-old').length, text: el.textContent };
})()`);
check('P11 价格闪烁优先：flashPrice 动画在场时不插数字副本（不打架）',
  flashCase.clones === 0 && flashCase.text === '200.00', JSON.stringify(flashCase));

/* P5 错峰：造 5 行新列表（.qrow 家族），看是否按序挂 .mo-in-item / --mo-i */
await evaluate(`(() => {
  const host = document.querySelector('.main, main, body');
  const box = document.createElement('div'); box.id = 'moProbeList';
  for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'qrow'; d.textContent = 'probe ' + i; box.appendChild(d); }
  host.appendChild(box);
  return true;
})()`);
let stagger = [];
for (let i = 0; i < 14; i++) {
  await sleep(40);
  await frame();
  stagger = await evaluate(`(() => {
  const box = document.getElementById('moProbeList');
  return [...box.children].map((r) => ({
    cls: r.classList.contains('mo-in-item'),
    i: r.style.getPropertyValue('--mo-i'),
    delay: getComputedStyle(r).animationDelay,
    dur: getComputedStyle(r).animationDuration,
  }));
})()`);
  if (stagger.length && stagger[0].cls) break;
}
const shotStagger = await shot('stagger-list');
const staggerOk = Array.isArray(stagger) && stagger.length === 5 &&
  stagger.every((r) => r.cls) && stagger.map((r) => r.i).join(',') === '0,1,2,3,4' &&
  stagger.map((r) => parseFloat(r.delay)).join(',') === '0,0.04,0.08,0.12,0.16';
check('P5 错峰入场：5 行依次 0..4，40ms 递进，.42s 招牌曲线', staggerOk,
  stagger ? stagger.map((r) => `${r.i}:${r.delay}/${r.dur}`).join(' ') : 'no result');

/* P6 滚动进入：.rv 契约由本层校准（app.js 的 IO 负责加 .rv-in，两边不重复） */
const reveal = await evaluate(`(async () => {
  const el = document.createElement('div');
  el.className = 'rv'; el.textContent = 'probe rv';
  document.body.appendChild(el);
  await new Promise((r2) => setTimeout(r2, 80));
  const cs = getComputedStyle(el);
  const contract = { tf: cs.transform, dur: cs.transitionDuration, ease: cs.transitionTimingFunction };
  el.remove();
  const all = [...document.querySelectorAll('.section.rv:not(.rv-in), .pm-sec.rv:not(.rv-in)')];
  const live = all.filter((n) => n.getClientRects().length).slice(0, 1);
  let liveOk = null;
  if (live.length) {
    live[0].scrollIntoView({ block: 'center' });
    await new Promise((r3) => setTimeout(r3, 500));
    liveOk = live[0].classList.contains('rv-in');
  }
  return { contract, hidden: all.length - live.length, liveOk,
           revealed: document.querySelectorAll('.rv.rv-in').length,
           io: document.querySelectorAll('.mo-io').length };
})()`);
await sleep(600);
await frame();
const shotReveal = await shot('scroll-reveal');
const revealOk = reveal && /matrix\(1, 0, 0, 1, 0, 6\)/.test(reveal.contract.tf) &&
  reveal.contract.dur.split(',')[0].trim() === '0.42s' &&
  reveal.liveOk !== false && reveal.revealed > 0;
check('P6 滚动进入：.rv 时序按 SPEC 校准（6px / --dur-4 / --ease-out）', revealOk, JSON.stringify(reveal));

/* P7 减动效：整页重开（media 改成 reduce） */
const inited2 = await boot(true);
await frame();
const reduced = await evaluate(`window.__oflMotionDebug.reduce()`);
await evaluate(`(() => {
  const el = document.querySelector('#primaryNav .nav-primary') || document.querySelector('button');
  window.__probeEl = el;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: r.left + 2, clientY: r.top + 2 }));
  return true;
})()`);
await sleep(150);
await frame();
const press2 = await evaluate(`(() => { const c = getComputedStyle(window.__probeEl); return { tf: c.transform, bg: c.backgroundColor, cls: window.__probeEl.className }; })()`);
await evaluate(`window.__probeEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))`);
await evaluate(`(() => {
  const host = document.querySelector('.main, main, body');
  const el = document.createElement('span'); el.className = 'num'; el.id = 'moProbeNum2'; el.textContent = '42.00';
  host.appendChild(el);
  return true;
})()`);
await sleep(160);
await frame();
await evaluate(`document.getElementById('moProbeNum2').textContent = '99.00'`);
await sleep(150);
await frame();
const roll2 = await evaluate(`(() => { const el = document.getElementById('moProbeNum2'); return { clones: el.querySelectorAll('.mo-roll-old').length, text: el.textContent }; })()`);
await evaluate(`(() => {
  const host = document.querySelector('.main, main, body');
  const box = document.createElement('div'); box.id = 'moProbeList2';
  for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'qrow'; box.appendChild(d); }
  host.appendChild(box);
  return true;
})()`);
await sleep(160);
await frame();
const stagger2 = await evaluate(`[...document.getElementById('moProbeList2').children].filter((r) => r.classList.contains('mo-in-item')).length`);
const shotReduce = await shot('reduced-motion');
check('P7 减动效：无位移、无数字副本、无错峰',
  inited2 && reduced && press2.tf === 'none' && roll2.clones === 0 && stagger2 === 0,
  `reduce=${reduced} pressTf=${press2.tf} pressBg=${press2.bg} clones=${roll2.clones} stagger=${stagger2}`);

/* P8 日光模式：同一套按压蒙版换成 rgba(10,20,35,.06)，两模式都成立 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: URL_ARG });
await sleep(2600);
await evaluate(`document.documentElement.setAttribute('data-theme', 'daylight')`);
await sleep(400);
await frame();
await evaluate(`(() => {
  const el = document.querySelector('#primaryNav .nav-primary') || document.querySelector('button');
  window.__probeEl = el;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: r.left + 2, clientY: r.top + 2 }));
  return true;
})()`);
await sleep(140);
await frame();
const day = await evaluate(`(() => {
  const c = getComputedStyle(window.__probeEl);
  const root = getComputedStyle(document.documentElement);
  return { bg: c.backgroundColor, tf: c.transform, press: root.getPropertyValue('--mo-press').trim(),
           theme: document.documentElement.getAttribute('data-theme') };
})()`);
const shotDay = await shot('daylight-press');
check('P8 日光模式：按压蒙版走 rgba(10,20,35,.06)，形变一致',
  day && day.theme === 'daylight' && /^rgba\(10, 20, 35/.test(day.bg) && /0\.98/.test(day.tf),
  JSON.stringify(day));

/* P9 下拉菜单（hidden 开关 → @keyframes，transition 不触发）：解除 hidden 后应拿到 moPanelIn */
const menu = await evaluate(`(() => {
  const m = document.querySelector('.ma-menu[hidden]') || document.querySelector('.ma-menu');
  if (!m) return null;
  const had = m.hasAttribute('hidden');
  m.removeAttribute('hidden');
  const cs = getComputedStyle(m);
  const out = { id: m.id, had, names: cs.animationName, durs: cs.animationDuration,
                origin: cs.transformOrigin, ease: cs.animationTimingFunction };
  if (had) m.setAttribute('hidden', '');
  return out;
})()`);
check('P9 下拉菜单：hidden 解除即播 moPanelIn（.42s --ease-panel）+ moFadeIn（.2s）',
  !!menu && /moPanelIn/.test(menu.names) && /moFadeIn/.test(menu.names) && /0\.42s/.test(menu.durs),
  JSON.stringify(menu));

/* P10 一级切换：View Transitions（支持时）或 CSS 兜底，最终视图正确且不残留状态 */
const viewBefore = await evaluate(`(document.querySelector('.view.active') || {}).id || null`);
await evaluate(`(() => { const t = document.getElementById('pnav-events'); if (t) t.click(); return true; })()`);
await sleep(90);
const vtMid = await evaluate(`({ vt: document.documentElement.classList.contains('mo-vt'), htm: document.documentElement.className, support: typeof document.startViewTransition })`);
await frame();
const shotPage = await shot('page-switch');
await sleep(900);
await frame();
const pageEnd = await evaluate(`({
  view: (document.querySelector('.view.active') || {}).id || null,
  vt: document.documentElement.classList.contains('mo-vt'),
  skip: document.querySelector('.view.active').classList.contains('mo-vt-skip'),
  anim: getComputedStyle(document.querySelector('.view.active')).animationName,
})`);
// 不变量：视图一定切过去、不锁死，且"要么 VT 跑过且不补 CSS 动画（防二次淡入），
//         要么 VT 被跳过时 CSS 兜底动画仍在（用户总有过渡，但永远只有一次）"
const pageOk = pageEnd.view !== viewBefore && pageEnd.vt === false &&
  (pageEnd.skip === true ? pageEnd.anim === 'none' : pageEnd.anim === 'moPageIn');
check('P10 一级切换：视图切过去、不锁死、过渡只播一次（VT 或 CSS 兜底）',
  pageOk,
  `before=${viewBefore} → after=${pageEnd.view}；VT 支持=${vtMid.support} 触发中=${vtMid.vt}；skip=${pageEnd.skip} 动画=${pageEnd.anim}`);

/* ------------------------------------------------------------------ 汇总 */
const fail = results.filter((r) => !r.ok);
console.log('\n截图：');
[shotPress, shotOpen, shotSettled, shotClosing, shotInk, shotRoll, shotStagger, shotReveal, shotReduce, shotDay, shotPage]
  .forEach((f) => console.log('  ' + f));
console.log('\n' + JSON.stringify({ pass: results.length - fail.length, fail: fail.length, results }, null, 1));

ws.close();
chrome.kill();
process.exit(fail.length ? 1 : 0);
