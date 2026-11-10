#!/usr/bin/env node
/* load.mjs —— 首屏加载实测（CDP，零依赖）
   用法：node _qa/load.mjs [url]
   输出：导航时序（TTFB/FCP/LCP/DCL/load）、资源数量与体积 Top、关键内容出现时刻
        （第一行行情 / 热力图首帧 / 全球指数条 / 骨架消失）
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9940 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-load-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--disable-background-timer-throttling', '--force-color-profile=srgb',
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

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

// 在文档开始前埋观测点：FCP/LCP + 关键内容出现时刻
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__marks = { t0: performance.now(), key: {} };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__marks['fcp'] = Math.round(e.startTime); })
        .observe({ type: 'paint', buffered: true });
      new PerformanceObserver((l) => { const es = l.getEntries(); const last = es[es.length - 1]; if (last) window.__marks['lcp'] = Math.round(last.startTime); })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}
    const tick = () => {
      const m = window.__marks;
      if (!m.key.qrow && document.querySelector('#cardWall .qrow, .qrow')) m.key.qrow = Math.round(performance.now());
      if (!m.key.hero && document.querySelector('#heroStrip .hero-value')) m.key.hero = Math.round(performance.now());
      if (!m.key.globe && document.querySelector('#globeBar .gcard')) m.key.globe = Math.round(performance.now());
      if (!m.key.heat && document.querySelector('#heatCanvas') && document.querySelector('#heatCanvas').width > 10) m.key.heat = Math.round(performance.now());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();`
});

const navStart = Date.now();
await send('Page.navigate', { url: URL });
await sleep(15000);   // 给慢加载留足观察窗

const perf = await send('Runtime.evaluate', {
  expression: `(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource').map(r => ({
      n: r.name.split('/').slice(-1)[0].split('?')[0], t: Math.round(r.duration), s: Math.round((r.transferSize||0)/1024),
      type: r.initiatorType,
    }));
    const js = res.filter(r => /\\.js$/.test(r.n));
    const css = res.filter(r => /\\.css$/.test(r.n));
    const slow = [...res].sort((a,b) => b.s - a.s).slice(0, 8);
    return {
      marks: window.__marks,
      fcp: window.__marks.fcp, lcp: window.__marks.lcp,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      resources: res.length, jsCount: js.length, cssCount: css.length,
      jsBytes: js.reduce((a,b)=>a+b.s,0), cssBytes: css.reduce((a,b)=>a+b.s,0),
      slowest: [...res].sort((a,b)=>b.t-a.t).slice(0,6),
      biggest: slow,
    };
  })()`, returnByValue: true,
});
console.log(JSON.stringify({ url: URL, wallMs: Date.now() - navStart, ...perf.result.value }, null, 1));
ws.close(); chrome.kill();
setTimeout(() => process.exit(0), 200);
