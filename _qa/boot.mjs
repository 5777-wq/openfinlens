// boot.mjs —— 首屏 + 懒加载包体检：跑完全站 5 个一级入口，收集报错与「模块是否就位」
// 用途：拆分核心/懒加载包后，确认 (a) 首屏无报错、(b) 懒加载包到齐后所有面板模块都在、
//       (c) 每个子页签都能渲染出东西。
// 用法：node _qa/boot.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9990 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-boot-'));
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
const errors = []; const warns = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  const p = m.params; if (!m.method) return;
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning'))
    warns.push(p.type + ' ' + p.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 160));
  if (m.method === 'Log.entryAdded' && p.entry.level === 'error') errors.push('LOG ' + p.entry.text.slice(0, 160));
};

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
await send('Page.navigate', { url: URL });
await sleep(5000);

const mods = await send('Runtime.evaluate', { expression: `(() => {
  const names = ['Charts','Treemap','CompareView','CompareMath','FundParse','FundProfile','FundQuiz','PortfolioView',
    'PortfolioMath','MacroView','MacroCalc','AlertCenter','Panes','PaneView','Technical','Events','EventsSource',
    'Polymarket','PMView','PMCharts','Actors','QR','PMShare','CommandPalette','Explain','AcademyAssets',
    'AcademyGloss','AcademyGate','INDUSTRY_CHAINS','OptionSource','HistorySource','NewsSource','LhbSource',
    'SouthboundSource','EtfSource','SecSource','FundHoldsSource','ImpactEngine'];
  const missing = names.filter(n => !window[n]);
  const q = performance.getEntriesByType('navigation')[0] || {};
  return { missing, lazyLoaded: !!document.querySelector('script[src*="bundle-lazy"]'),
    lwc: !!window.LightweightCharts, ttfb: Math.round(q.responseStart||0),
    dl: Math.round(q.domContentLoadedEventEnd||0), hero: !!document.querySelector('#heroStrip .hero-value'),
    base: document.documentElement.scrollWidth, view: window.innerWidth };
})()`, returnByValue: true });
console.log('加载后 5s：', JSON.stringify(mods.result.value));

// 走一遍一级入口 + 主要子页签
const NAV = [
  ['market', 'all'], ['market', 'cn'], ['market', 'hk'], ['market', 'us'], ['market', 'crypto'],
  ['events', 'all'], ['events', 'pm'], ['assets', 'all'], ['assets', 'opt'], ['fund', 'compare'], ['fund', 'quiz'],
  ['insight', 'news'], ['insight', 'chain'],
];
for (const [tab, sub] of NAV) {
  await send('Runtime.evaluate', { expression: `(() => {
    const a = document.querySelector('#primaryNav [data-primary="${tab}"]');
    if (a) a.click();
    return true;
  })()`, returnByValue: true });
  await sleep(180);
  await send('Runtime.evaluate', { expression: `(() => {
    const b = document.querySelector('#tabs [data-tab="${sub}"]');
    if (b) b.click();
    return true;
  })()`, returnByValue: true });
  await sleep(420);
  const st = await send('Runtime.evaluate', { expression: `(() => {
    const active = document.querySelector('.view:not([hidden])');
    const html = active ? (active.innerText || '') : '';
    return { tab: document.querySelector('#primaryNav [aria-selected="true"]')?.dataset.primary || '?',
      sub: document.querySelector('#tabs [aria-selected="true"]')?.dataset.tab || '?',
      chars: html.replace(/\\s+/g, '').length,
      sk: document.querySelectorAll('.sk').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()`, returnByValue: true });
  const v = st.result.value;
  const ok = v.chars > 120 && v.overflow <= 1;
  console.log((ok ? '  ok  ' : ' WARN ') + tab + '/' + sub + '  文本 ' + v.chars + ' 字, 骨架 ' + v.sk + ', 横向溢出 ' + v.overflow);
}

// 详情页（依赖懒加载包里的 charts.js + lightweight-charts）
await send('Runtime.evaluate', { expression: `location.hash = '#symbol=sh600519'`, returnByValue: true });
await sleep(3000);
const detail = await send('Runtime.evaluate', { expression: `(() => {
  const cv = document.querySelector('#detailChart canvas, .kline canvas, canvas');
  return { canvas: !!cv, w: cv ? cv.width : 0, text: ((document.querySelector('#detailView')||document.body).innerText||'').replace(/\\s+/g,'').slice(0,60) };
})()`, returnByValue: true });
console.log('详情页：', JSON.stringify(detail.result.value));

console.log('\n=== errors (' + errors.length + ') ===');
errors.slice(0, 20).forEach(e => console.log('  ' + e));
console.log('=== warns (' + warns.length + ') ===');
warns.slice(0, 12).forEach(e => console.log('  ' + e));
ws.close(); chrome.kill();
setTimeout(() => process.exit(errors.length ? 1 : 0), 200);
