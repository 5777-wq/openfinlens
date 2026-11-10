// load2.mjs —— 二次访问（有缓存）首屏实测：验证「缓存优先」是否让老访客秒开
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9990 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-load2-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--disable-background-timer-throttling', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
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
  throw new Error('no chrome');
}
const ws = new WebSocket(await pageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
function send(method, params = {}) {
  const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };

await send('Page.enable'); await send('Runtime.enable');
const probe = `(() => {
  window.__m = { key: {} };
  const tick = () => {
    const k = window.__m.key;
    if (!k.hero && document.querySelector('#heroStrip .hero-value')) k.hero = Math.round(performance.now());
    if (!k.globe && document.querySelector('#globeBar .gcard')) k.globe = Math.round(performance.now());
    if (!k.sk && document.querySelector('#cardWall .sk')) k.sk = Math.round(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

// 第一次：全新访问（无缓存）
await send('Page.addScriptToEvaluateOnNewDocument', { source: probe });
await send('Page.navigate', { url: URL });
await sleep(6000);
const first = await send('Runtime.evaluate', { expression: `window.__m.key`, returnByValue: true });

// 第二次：同一 profile 重新加载（localStorage 里有上一轮的行情）
await send('Page.navigate', { url: URL });
await sleep(6000);
const second = await send('Runtime.evaluate', { expression: `window.__m.key`, returnByValue: true });

console.log(JSON.stringify({ url: URL, firstVisit: first.result.value, secondVisit: second.result.value }, null, 1));
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
