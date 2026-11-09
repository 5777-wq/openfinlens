// prof.mjs —— 切 tab 时抓 CPU profile，找出长任务里的热点函数
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9820 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prof-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
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
const events = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Profiler.consoleProfileFinished') events.push(m.params.profile);
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(6000);
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 200 });
await send('Profiler.start');
await send('Runtime.evaluate', { expression: `document.querySelector('[data-primary="events"]').click(); true` });
await sleep(900);
const { profile: prof } = await send('Profiler.stop');

// 聚合 sample 到自己命中的函数（node 不带 sourcemap，按 functionName+url:line 归并）
const nodes = new Map(prof.nodes.map(n => [n.id, n]));
const self = new Map();
for (const nodeId of prof.samples || []) {
  const n = nodes.get(nodeId);
  if (!n) continue;
  const cf = n.callFrame || {};
  const key = (cf.functionName || '(anonymous)') + ' @ ' + (cf.url || '').split('/').slice(-1)[0] + ':' + (cf.lineNumber ?? 0);
  self.set(key, (self.get(key) || 0) + 1);
}
const total = (prof.samples || []).length || 1;
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
function chainOf(nodeId) {
  const out = []; let cur = nodeId, guard = 0;
  while (cur && guard++ < 8) {
    const n = nodes.get(cur); if (!n) break;
    const cf = n.callFrame || {};
    if (cf.functionName || cf.url) out.push((cf.functionName || '(anon)') + '@' + (cf.url || '').split('/').slice(-1)[0] + ':' + (cf.lineNumber ?? 0));
    cur = parent.get(cur);
  }
  return out.join(' <- ');
}
const chains = new Map();
for (const nodeId of prof.samples || []) {
  const n = nodes.get(nodeId); if (!n) continue;
  const cf = n.callFrame || {};
  if (!cf.functionName && !cf.url) continue;
  const key = chainOf(nodeId);
  chains.set(key, (chains.get(key) || 0) + 1);
}
const topChains = [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([k, v]) => ({ pct: +(v / total * 100).toFixed(1), chain: k }));
console.log(JSON.stringify({ samples: total, topChains }, null, 1));
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
