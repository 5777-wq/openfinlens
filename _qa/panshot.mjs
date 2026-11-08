#!/usr/bin/env node
/* panshot.mjs —— shot.mjs 的「可点击」变体（面板区施工专用，2026-11-08 panels）
   用法：node _qa/panshot.mjs <url> <out.png> [width] [height] [waitMs] [theme] [tab] [js]
   第 8 个参数 js 是在注入主题/hash 之后、截图之前执行的表达式（用来点二级分区/子视图）。
   与 shot.mjs 唯一区别就是这段 js —— 不改 shot.mjs，避免和 Lead 的截图口径打架。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [url, out, w = '1440', h = '1000', waitMs = '5000', theme = '', tab = '', js = ''] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node _qa/panshot.mjs <url> <out.png> [w] [h] [waitMs] [theme] [tab] [js]'); process.exit(2); }

const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const W = Number(w), H = Number(h), WAIT = Number(waitMs);
const MOBILE = process.env.MOBILE === '1';
const PORT = 9900 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pan-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('chrome 未就绪');
}

let id = 0;
const pend = new Map();
function send(ws, method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE,
});
if (MOBILE) await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send(ws, 'Page.navigate', { url });
await sleep(1200);
if (theme || tab) {
  const expr = `(() => { ${theme ? `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});` : ''} ${tab ? `location.hash = '#tab=${tab}';` : ''} return true; })()`;
  await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true });
}
await sleep(1600);
if (js) {
  const r = await send(ws, 'Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) console.error('js 异常:', JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
}
await sleep(WAIT);
// 可选滚动：SCROLL=<css 选择器> 把该元素滚到视口顶部（看表格/列表下半段用）
if (process.env.SCROLL) {
  const sel = JSON.stringify(process.env.SCROLL);
  await send(ws, 'Runtime.evaluate', { expression: `(() => { const e = document.querySelector(${sel}); if (!e) return 'missing'; e.scrollIntoView({block:'start'}); return 'ok'; })()`, returnByValue: true });
  await sleep(900);
}
const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log('saved', out, fs.statSync(out).size, 'bytes');
ws.close();
chrome.kill();
setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(0); }, 300);
