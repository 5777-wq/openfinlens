#!/usr/bin/env node
/* perf.mjs —— 动效实测：帧间隔 + 长任务（CDP，零依赖）
   用法：node _qa/perf.mjs [--theme=daylight|nexus] [--action=nav|sub|palette|hover|idle]
   输出：p50/p95/max 帧间隔、>33ms 帧数、最长长任务、以及动作耗时。
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const THEME = arg('theme', 'daylight');
const ACTION = arg('action', 'nav');
const CHROME = 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9760 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-perf-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(1800);
await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme', ${JSON.stringify(THEME)}); true` });
await sleep(4500);

// 埋测量器：记录 rAF 间隔与长任务
const ACT = {
  nav: `(() => { const b = document.querySelector('[data-primary="events"]'); b && b.click();
                  setTimeout(() => { const m = document.querySelector('[data-primary="market"]'); m && m.click(); }, 700); })()`,
  sub: `(() => { const b = document.querySelector('#tabs [data-tab="cn"]'); b && b.click();
                  setTimeout(() => { const a = document.querySelector('#tabs [data-tab="all"]'); a && a.click(); }, 700); })()`,
  palette: `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
                      setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 900); })()`,
  hover: `(() => { const rows = [...document.querySelectorAll('.qrow, .pm-card, .gcard')].slice(0, 6);
                  rows.forEach((r, i) => setTimeout(() => { r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }, i * 60)); })()`,
  idle: `(() => {})()`,
  poll: `(() => {})()`,
};

await send('Runtime.evaluate', {
  expression: `(() => {
    window.__perf = { frames: [], longs: [], t0: 0 };
    let last = performance.now();
    const loop = (t) => { window.__perf.frames.push({ d: t - last, at: t }); last = t; if (window.__perf.frames.length < 900) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longs.push({ d: Math.round(e.duration), n: e.name }); })
      .observe({ entryTypes: ['longtask'] }); } catch (e) {}
    return true; })()`, returnByValue: true,
});
const t0 = Date.now();
await send('Runtime.evaluate', { expression: `window.__perf.t0 = performance.now(); true` });
await send('Runtime.evaluate', { expression: ACT[ACTION] || ACT.nav, returnByValue: true });
await sleep(ACTION === 'poll' ? 11500 : (ACTION === 'idle' ? 2000 : 2400));
const r = await send('Runtime.evaluate', { expression: `(() => {
  const t0 = window.__perf.t0 || 0;
  const f = window.__perf.frames.filter(x => x.d > 0 && x.at >= t0).map(x => x.d);
  const sorted = [...f].sort((a, b) => a - b);
  const q = (p) => sorted.length ? +sorted[Math.floor((sorted.length - 1) * p)].toFixed(1) : null;
  return { frames: f.length, p50: q(0.5), p95: q(0.95), max: q(1),
           over33: f.filter(x => x > 33.4).length, over50: f.filter(x => x > 50).length,
           longs: window.__perf.longs.slice(0, 6), longTotal: window.__perf.longs.length };
})()`, returnByValue: true });

console.log(JSON.stringify({ theme: THEME, action: ACTION, wallMs: Date.now() - t0, ...r.result.value }, null, 1));
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
