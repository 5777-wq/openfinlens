#!/usr/bin/env node
/* peek.mjs —— 带「先执行一段 JS 再截图」的取证工具（CDP，零依赖）
   用法：node _qa/peek.mjs <out.png> "<js 表达式>" [w] [h] [waitMs] [theme]
   例：  node _qa/peek.mjs _qa/heat-day.png "document.querySelector('[data-zone-btn=heat]').click()" 1440 1000 3000 daylight
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [out, js = 'true', w = '1440', h = '1000', waitMs = '3000', theme = 'nexus'] = process.argv.slice(2);
const BASE = process.env.QA_URL || 'http://127.0.0.1:8123/index.html';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 80);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-peek-'));
const MOBILE = process.env.MOBILE === '1';
const W = Number(w), H = Number(h);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--force-color-profile=srgb',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pend = new Map();
async function pageWs() {
  for (let i = 0; i < 120; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = j.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('chrome 未就绪');
}
const ws = new WebSocket(await pageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}
const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
};
await send('Page.enable');
// 截图/断言取证关动效：headless 下 transition 不一定推进，会把指示器拍在过渡中间帧
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
await send('Page.navigate', { url: BASE });
await sleep(1600);
await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); true` });
await sleep(300);
const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
if (r.exceptionDetails) console.error('JS 异常:', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
console.log('js →', JSON.stringify(r.result?.value));
await sleep(Number(waitMs));
const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log('saved', out, 'errors:', errors.length);
ws.close(); chrome.kill();
setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(0); }, 250);
