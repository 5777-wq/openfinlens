#!/usr/bin/env node
/* probe.mjs —— 取一个元素的 getComputedStyle（含 ::before/::after），面板施工核对用
   用法：node _qa/probe.mjs <url> <tab> <selector> [pseudo] [js] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [url, tab, sel, pseudo = '', js = ''] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9900 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const j = await r.json();
      const p = j.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(150);
  }
  throw new Error('chrome 未就绪');
}
let id = 0; const pend = new Map();
function send(ws, method, params = {}) {
  const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}
const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
await send(ws, 'Page.navigate', { url }); await sleep(1500);
if (tab) await send(ws, 'Runtime.evaluate', { expression: `location.hash='#tab=${tab}'`, awaitPromise: true });
await sleep(2500);
if (js) await send(ws, 'Runtime.evaluate', { expression: js, awaitPromise: true });
await sleep(1500);
const expr = `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return 'no element: ' + ${JSON.stringify(sel)};
  const cs = getComputedStyle(e, ${JSON.stringify(pseudo || null)});
  const r = e.getBoundingClientRect();
  const keys = ['width','height','background-color','background-image','border-radius','color','font-size','font-family','text-align','position','display','left','top','bottom','opacity','z-index','border-top-width','box-shadow','filter'];
  const out = { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  keys.forEach(k => out[k] = cs.getPropertyValue(k));
  return JSON.stringify(out, null, 1);
})()`;
const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(r.result.value);
ws.close(); chrome.kill(); setTimeout(() => process.exit(0), 200);
