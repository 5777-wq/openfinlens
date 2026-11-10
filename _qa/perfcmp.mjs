// perfcmp.mjs —— 同条件对比「旧构建 vs 新构建」的首屏时序（带网络限速）
// 为什么要本地对比：沙箱到 GitHub Pages 的带宽抖动极大（同一份 124KB 有时 230ms 有时 670ms），
// 单次线上测量说明不了问题。这里用 CDP 的 fixed-profile 限速，对两套产物跑同样的字节条件。
// 用法：node _qa/perfcmp.mjs <urlA> <urlB> [标签A] [标签B] [轮数]
// 前置：两个 URL 分别由 _qa/serve.mjs（带 gzip）托管旧/新构建。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [URL_A, URL_B, LABEL_A = '旧', LABEL_B = '新', ROUNDS = '3'] = process.argv.slice(2);
if (!URL_A || !URL_B) { console.error('usage: node _qa/perfcmp.mjs <urlA> <urlB> [labelA] [labelB] [rounds]'); process.exit(2); }
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9990 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmp-'));
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
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');

// 限速档位：1.6Mbps 下行 / 750kbps 上行 / 150ms RTT —— 接近国内访问 GitHub Pages 的实测量级
const THROTTLE = { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 };

const PROBE = `(() => {
  window.__m = { t0: performance.now() };
  const tick = () => {
    const k = window.__m;
    if (!k.hero && document.querySelector('#heroStrip .hero-value')) k.hero = Math.round(performance.now());
    if (!k.globe && document.querySelector('#globeBar .gcard')) k.globe = Math.round(performance.now());
    if (document.querySelector('#cardWall .card, #cardWall .row')) k.cards = k.cards || Math.round(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function run(url) {
  await send('Network.emulateNetworkConditions', THROTTLE);
  await send('Network.clearBrowserCache');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await send('Page.navigate', { url });
  await sleep(9000);
  const r = await send('Runtime.evaluate', { expression: `(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const res = performance.getEntriesByType('resource');
    const sum = (f) => res.filter(f).reduce((s, e) => s + (e.encodedBodySize || 0), 0);
    const js = res.filter(e => /bundle(\\.js|-lazy\\.js)?/.test(e.name));
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      ttfb: Math.round(nav.responseStart || 0),
      hero: window.__m.hero || null, globe: window.__m.globe || null, cards: window.__m.cards || null,
      reqs: res.length + 1,
      kb: Math.round((sum(() => true) + (nav.encodedBodySize || 0)) / 1024),
      jsKB: Math.round(sum(e => /\\/js\\/|lib\\/|bundle/.test(e.name)) / 1024),
      cssKB: Math.round(sum(e => /\\.css/.test(e.name)) / 1024),
    };
  })()`, returnByValue: true });
  return r.result.value;
}

const n = Math.max(1, Number(ROUNDS));
const all = { A: [], B: [] };
for (let i = 0; i < n; i++) {
  all.A.push(await run(URL_A));
  all.B.push(await run(URL_B));
}
const med = (xs) => { const v = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null; };
const KEYS = ['ttfb', 'fcp', 'hero', 'globe', 'cards', 'dcl', 'load', 'reqs', 'kb', 'jsKB', 'cssKB'];
console.log('\n指标          ' + LABEL_A.padStart(8) + LABEL_B.padStart(10) + '   变化');
for (const k of KEYS) {
  const a = med(all.A.map(x => x[k])), b = med(all.B.map(x => x[k]));
  const delta = (a && b) ? ((b - a) / a * 100) : 0;
  console.log(k.padEnd(12) + String(a).padStart(8) + String(b).padStart(10) + '   ' + (delta ? (delta > 0 ? '+' : '') + delta.toFixed(0) + '%' : ''));
}
fs.writeFileSync(path.join(os.tmpdir(), 'perfcmp.json'), JSON.stringify({ A: all.A, B: all.B }, null, 1));
console.log('\n原始数据：' + path.join(os.tmpdir(), 'perfcmp.json') + '（每轮 ' + n + ' 次，取中位数）');
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
