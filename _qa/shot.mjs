#!/usr/bin/env node
/* shot.mjs —— 用 CDP 截图（零依赖：Node 22+ 自带 WebSocket）
   用法：node _qa/shot.mjs <url> <out.png> [width] [height] [waitMs] [theme] [tab]
   例：  node _qa/shot.mjs http://127.0.0.1:8123/index.html out.png 1440 1000 3500
   可选环境变量：CHROME（chrome 可执行文件）、MOBILE=1（390x844 + 触屏 + DPR2） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [url, out, w = '1440', h = '1000', waitMs = '3500', theme = '', tab = ''] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node _qa/shot.mjs <url> <out.png> [w] [h] [waitMs] [theme] [tab]'); process.exit(2); }

const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const W = Number(w), H = Number(h), WAIT = Number(waitMs);
const MOBILE = process.env.MOBILE === '1';
const PORT = 9500 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shot-'));

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
// 主题/分区注入（页面支持 html[data-theme] 与 location.hash 深链）
if (theme || tab) {
  const expr = `(() => { ${theme ? `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});` : ''} ${tab ? `location.hash = '#tab=${tab}';` : ''} return true; })()`;
  await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true });
}
await sleep(WAIT);
const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log('saved', out, fs.statSync(out).size, 'bytes');
ws.close();
chrome.kill();
setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(0); }, 300);
