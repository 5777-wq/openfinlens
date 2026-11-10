// waterfall.mjs —— 线上/本地首屏网络瀑布：每个资源的「传输字节 + 耗时 + 开始/结束」
// 用途：定位「到底是字节多、还是排队多、还是 TTFB 高」
// 用法：node _qa/waterfall.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.argv[2] || 'https://5777-wq.github.io/openfinlens/';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9990 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wf-'));
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
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 90000); });
}
const reqs = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  const p = m.params; if (!p) return;
  if (m.method === 'Network.requestWillBeSent') {
    reqs.set(p.requestId, { url: p.request.url, type: p.type, start: p.timestamp, prio: p.initialPriority,
      doc: p.type === 'Document' ? p : null });
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(p.requestId); if (r) { r.status = p.response.status; r.enc = p.response.encodedDataLength; r.hdr = p.response.headers; r.ttfbAt = p.timestamp; }
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(p.requestId); if (r) { r.end = p.timestamp; r.enc = p.encodedDataLength || r.enc; }
  }
};

await send('Network.enable', { maxTotalBufferSize: 40000000, maxResourceBufferSize: 2000000 });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  window.__m = {};
  const tick = () => {
    const k = window.__m;
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart > 0 && !k.ttfb) k.ttfb = Math.round(nav.responseStart);
    if (!k.hero && document.querySelector('#heroStrip .hero-value')) k.hero = Math.round(performance.now());
    if (!k.globe && document.querySelector('#globeBar .gcard')) k.globe = Math.round(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();` });
await send('Page.navigate', { url: URL });
await sleep(9000);

const met = await send('Runtime.evaluate', { expression: `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
  return { ttfb: Math.round(nav.responseStart || 0), dl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0), fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: lcp ? Math.round(lcp.startTime) : null, mine: window.__m,
    res: performance.getEntriesByType('resource').length };
})()`, returnByValue: true });

const t0 = Math.min(...[...reqs.values()].map(r => r.start).filter(Boolean));
const rows = [...reqs.values()].filter(r => r.end).map(r => ({
  url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 60),
  type: r.type,
  st: Math.round((r.start - t0) * 1000),
  en: Math.round((r.end - t0) * 1000),
  dur: Math.round((r.end - r.start) * 1000),
  kb: +((r.enc || 0) / 1024).toFixed(1),
  enc: (r.hdr && (r.hdr['content-encoding'] || '')).slice(0, 6) || '-',
  status: r.status,
}));
console.log('=== metrics ===');
console.log(JSON.stringify(met.result.value, null, 1));
const totalKB = rows.reduce((s, r) => s + r.kb, 0);
console.log(`\n=== ${rows.length} requests, ${totalKB.toFixed(0)}KB transferred ===`);
console.log('--- top 22 by bytes ---');
for (const r of rows.slice().sort((a, b) => b.kb - a.kb).slice(0, 22))
  console.log(String(r.kb).padStart(7) + 'KB ' + String(r.dur).padStart(5) + 'ms [' + String(r.st).padStart(5) + '→' + String(r.en).padStart(5) + '] ' + r.enc.padEnd(6) + r.type.padEnd(10) + r.url);
console.log('--- timeline: requests still running at key moments ---');
for (const t of [500, 1000, 1500, 2000, 2500, 3000]) {
  const active = rows.filter(r => r.st <= t && r.en > t);
  const pending = rows.filter(r => r.st > t);
  console.log(`  t=${t}ms  进行中 ${active.length} 个 (${active.reduce((s, r) => s + r.kb, 0).toFixed(0)}KB) / 尚未开始 ${pending.length} 个`);
}
console.log('--- per type ---');
const byType = {};
for (const r of rows) { const k = r.type; byType[k] = byType[k] || { n: 0, kb: 0 }; byType[k].n++; byType[k].kb += r.kb; }
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1].kb - a[1].kb)) console.log('  ' + k.padEnd(12) + String(v.n).padStart(3) + ' req ' + v.kb.toFixed(0).padStart(6) + 'KB');
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
