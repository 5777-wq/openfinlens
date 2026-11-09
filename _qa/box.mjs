// 打印某个元素及其祖先的盒模型宽度，定位 390px 横向溢出的真正来源
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9720 + Math.floor(Math.random() * 30);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-box-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
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
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout')), 30000); });
}
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(1500);
await send('Runtime.evaluate', { expression: "location.hash='#tab=events'; true" });
await sleep(4500);
const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const card = document.querySelector('.pm-card');
    const chain = [];
    let el = card;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,50),
        w: Math.round(r.width), left: Math.round(r.left),
        pad: cs.padding, disp: cs.display, gtc: cs.gridTemplateColumns, minW: cs.minWidth });
      el = el.parentElement;
    }
    const all = [...document.querySelectorAll('body *')].map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,40), id: el.id,
               right: Math.round(r.right), w: Math.round(r.width),
               disp: getComputedStyle(el).display, pos: getComputedStyle(el).position };
    }).filter(o => o.right > document.documentElement.clientWidth + 1 && o.disp !== 'none')
      .sort((a,b)=>b.right-a.right).slice(0,6);
    return { client: document.documentElement.clientWidth, inner: window.innerWidth, all, chain: chain.slice(0,2) };
  })()`, returnByValue: true,
});
console.log(JSON.stringify(r.result.value, null, 1));
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
