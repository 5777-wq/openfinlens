/* _qa/shell-normal.mjs —— 正常模式（不关动效）+ 强制出帧，验证一级指示器终态与控制台异常
   motion 的经验：无头 Chrome 不产帧时 transition/rAF 全停，读到的永远是起始值；
   测量前先 Page.captureScreenshot 逼一帧，动效才按真实时间推进。

   ⚠ 几何基准坑（2026-11-08 实测踩过）：绝对定位元素的包含块是宿主的 padding box，
     而 getBoundingClientRect() 给的是 border box。若宿主有 1px 描边，
     `rect.left - hostRect.left` 会恒定多算一条描边（dx=1px，看着像动画没收敛，
     其实数学就错了 1px）。正确写法：
       x = (rect.left - hostRect.left) - host.clientLeft + host.scrollLeft
     宽度方向同理：分母用 offsetWidth（同为 padding box），并给 scale 留 6 位小数，
     4 位小数会剩 ~0.02px 的舍入差。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 8500 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shelln-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--force-color-profile=srgb',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
async function getWs() {
  for (let i = 0; i < 120; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(150);
  } throw new Error('no chrome');
}
let id = 0; const pend = new Map();
function send(ws, m, p = {}) { const mid = ++id; ws.send(JSON.stringify({ id: mid, method: m, params: p }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + m)), 60000); }); }
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
};
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
const ev = async (x) => { const r = await send(ws, 'Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const frame = async () => send(ws, 'Page.captureScreenshot', { format: 'jpeg', quality: 20 });
await send(ws, 'Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(4200);
await frame();

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n + (x ? '  ' + x : '')); };

for (const k of ['events', 'assets', 'fund', 'insight', 'market']) {
  await ev(`document.getElementById('pnav-${k}').click(); true`);
  await frame(); await sleep(420); await frame();   // 逼帧 → .3s 曲线跑完
  const st = await ev(`(() => {
    const host = document.getElementById('primaryNav').getBoundingClientRect();
    const ink = document.getElementById('navInk').getBoundingClientRect();
    const b = document.querySelector('#primaryNav [aria-selected="true"]').getBoundingClientRect();
    return { dx: Math.round(ink.left - b.left), dw: Math.round(ink.width - b.width), primary: document.querySelector('#primaryNav [aria-selected="true"]').dataset.primary };
  })()`);
  ok(`正常模式 ${k}：指示器终态对齐（曲线跑完）`, Math.abs(st.dx) <= 2 && Math.abs(st.dw) <= 2, JSON.stringify(st));
}

// 再切两轮看 View Transition 是否还抛
for (const k of ['events', 'market', 'insight', 'market']) { await ev(`document.getElementById('pnav-${k}').click(); true`); await frame(); await sleep(300); }
await frame();
const bad = errs.filter((e) => !/gtimg|CORS|ERR_FAILED|Failed to load/i.test(e));
ok('正常模式：无页面未捕获异常（含 View Transition）', bad.length === 0, bad.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed  (exceptions total ${errs.length}, non-network ${bad.length})`);
ws.close(); chrome.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 300);
