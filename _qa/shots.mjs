#!/usr/bin/env node
/* shots.mjs —— 批量截图（内嵌 CDP 客户端，一次起浏览器拍多张）
   用法：node _qa/shots.mjs <outDir> [--mobile] [--themes=nexus,daylight] [--tabs=all,events,...]
   产出：<outDir>/<theme>-<tab>[-m].png
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outDir = process.argv[2] || '_qa/shots';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const mobiles = process.argv.includes('--mobile');
const themes = arg('themes', 'nexus').split(',');
const tabs = arg('tabs', 'all,events,chain,watch,compare').split(',');
const base = arg('url', 'http://127.0.0.1:8123/index.html');
const wait = Number(arg('wait', '4500'));

const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shots-'));
const W = mobiles ? 390 : 1440, H = mobiles ? 844 : 1000;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
  '--force-color-profile=srgb', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
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

let id = 0; const pend = new Map();
function send(ws, method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}

const ws = new WebSocket(await pageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
await send(ws, 'Page.enable');
// 截图/断言取证关动效：headless 下 transition 不一定推进，会把指示器拍在过渡中间帧
await send(ws, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send(ws, 'Runtime.enable');
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobiles ? 2 : 1, mobile: mobiles });
if (mobiles) await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

fs.mkdirSync(outDir, { recursive: true });
let first = true;
for (const theme of themes) {
  for (const tab of tabs) {
    if (first) {
      await send(ws, 'Page.navigate', { url: base });
      await sleep(1000);
      first = false;
    }
    await send(ws, 'Runtime.evaluate', {
      expression: `(() => { try { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); } catch(e){}
        location.hash = '#tab=${tab}'; return document.documentElement.getAttribute('data-theme'); })()`,
    });
    await sleep(wait);
    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const f = path.join(outDir, `${theme}-${tab}${mobiles ? '-m' : ''}.png`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('saved', f);
  }
}
ws.close(); chrome.kill();
setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(0); }, 250);
