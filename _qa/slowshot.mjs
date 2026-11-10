// slowshot.mjs —— 限速下的首屏加载态截图（验证骨架而不是"空白像坏了"）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const OUT = process.argv[3] || '_qa/slow-load.png';
const AT = Number(process.argv[4] || 1200);
const RTT = Number(process.argv[5] || 150);        // ms
const KBPS = Number(process.argv[6] || 800);       // KB/s ≈ 6.4Mbps
const CHROME = 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9970 + Math.floor(Math.random() * 20);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-slow-'));
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

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.emulateNetworkConditions', {
  offline: false, latency: RTT, downloadThroughput: KBPS * 1024, uploadThroughput: 256 * 1024,
});
await send('Page.navigate', { url: URL });
await sleep(AT);
const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
console.log('saved', OUT, '(rtt', RTT, 'ms,', KBPS, 'KB/s, at', AT, 'ms)');
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
