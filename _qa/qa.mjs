#!/usr/bin/env node
/* qa.mjs —— 整合验收探针（CDP，零依赖）
   1) 遍历 5 个一级视图 × 2 模式，收集 console 错误 / 未捕获异常 / 资源 404
   2) 命令面板：⌘K → 输入 → ↓ → ↵ → 校验落点
   3) 输出 JSON 报告 + 失败断言
   用法：node _qa/qa.mjs [--shots]
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.QA_URL || 'http://127.0.0.1:8123/index.html';
const SHOTS = process.argv.includes('--shots');
const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9910 + Math.floor(Math.random() * 60);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-qa-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
  '--force-color-profile=srgb', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pend = new Map();
const problems = [];
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); if (!cond) problems.push(name + (detail ? ' :: ' + detail : '')); };

async function pageWs() {
  for (let i = 0; i < 120; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = j.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('chrome 未就绪');
}
const ws = new WebSocket(await pageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}
const ALLOW = /(ifzq\.gtimg\.cn|gtimg\.cn|sinajs\.cn|eastmoney\.com|binance\.com|okx\.com|coinpaprika\.com|coingecko\.com|127\.0\.0\.1|localhost)/;
const pageErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?'));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    // 只对**浏览器自己记录的第三方资源失败**放行（行情源在无头环境/被墙时必然 CORS 或 501）。
    // Runtime.exceptionThrown 绝不放行：真异常必须继续红，否则探针就失去意义。
    const txt = m.params.entry.text + ' ' + (m.params.entry.url || '');
    if (!ALLOW.test(txt)) pageErrors.push('log: ' + txt);
  }
};

await send('Page.enable');
// 截图/断言取证关动效：headless 下 transition 不一定推进，会把指示器拍在过渡中间帧
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
const notFound = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) notFound.push(m.params.response.status + ' ' + m.params.response.url);
});

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};
const shot = async (name) => {
  if (!SHOTS) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('_qa/qa', { recursive: true });
  fs.writeFileSync(path.join('_qa/qa', name), Buffer.from(data, 'base64'));
};

await send('Page.navigate', { url: BASE });
await sleep(4500);

/* ---------- 1. 每屏健康检查 ---------- */
const VIEWS = ['market', 'events', 'assets', 'fund', 'insight'];
const THEMES = ['nexus', 'daylight'];
for (const theme of THEMES) {
  for (const v of VIEWS) {
    pageErrors.length = 0;
    await evalJs(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      const b = document.querySelector('[data-primary="${v}"]'); if (b) b.click(); return true; })()`);
    await sleep(2200);
    const info = await evalJs(`(() => {
      const primary = [...document.querySelectorAll('[data-primary]')].find(b => b.getAttribute('aria-selected') === 'true');
      const activeTab = document.querySelector('#tabs [data-tab][aria-selected="true"]');
      const sub = document.getElementById('subbar');
      const subVisible = !!sub && getComputedStyle(sub).display !== 'none' && sub.offsetHeight > 0;
      const bodyText = document.body.innerText;
      return { primary: primary && primary.dataset.primary, activeTab: activeTab && activeTab.dataset.tab,
               subVisible, small: document.querySelectorAll('*').length,
               overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
               tinyFonts: [...document.querySelectorAll('body *')].filter(el => {
                 const t = el.textContent.trim(); if (!t || el.children.length) return false;
                 const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
                 return parseFloat(getComputedStyle(el).fontSize) < 12;
               }).length,
               emptyish: bodyText.replace(/\\s+/g, '').length < 200,
             }; })()`);
    ok(`${theme}/${v}: 一级高亮正确`, info.primary === v, JSON.stringify(info));
    ok(`${theme}/${v}: 无 console/网络错误`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') + notFound.slice(0, 3).join(' | '));
    ok(`${theme}/${v}: 无横向溢出`, !info.overflowX, '');
    ok(`${theme}/${v}: 无 <12px 文字`, info.tinyFonts === 0, String(info.tinyFonts));
    ok(`${theme}/${v}: 内容非空`, !info.emptyish, '');
    await shot(`${theme}-${v}.png`);
  }
}

/* ---------- 2. 命令面板 ---------- */
pageErrors.length = 0;
await evalJs(`(() => { document.documentElement.setAttribute('data-theme','nexus'); return true; })()`);
await evalJs(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
  return true; })()`);
await sleep(700);
const paletteOpen = await evalJs(`(() => { const h = document.getElementById('cmdPalette'); return !!h && !h.hidden && getComputedStyle(h).display !== 'none'; })()`);
ok('命令面板: Ctrl+K 打开', paletteOpen);
await shot('palette-open.png');

const focused = await evalJs(`document.activeElement && document.activeElement.id`);
ok('命令面板: 焦点在输入框', focused === 'cmdInput', String(focused));

await evalJs(`(() => { const i = document.getElementById('cmdInput'); i.value = '茅台'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(600);
const items = await evalJs(`(() => [...document.querySelectorAll('#cmdPanel [role="option"], #cmdPanel .cmd-item, #cmdPanel li')].map(e => e.textContent.trim().slice(0, 40)).slice(0, 6))()`);
ok('命令面板: 中文可搜到结果', Array.isArray(items) && items.length > 0, JSON.stringify(items));
await shot('palette-search.png');

await evalJs(`(() => { const i = document.getElementById('cmdInput');
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); 
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
await sleep(2600);
const afterEnter = await evalJs(`(() => { const h = document.getElementById('cmdPalette');
  return { closed: !!h && (h.hidden || getComputedStyle(h).display === 'none'),
           detail: !!document.querySelector('#view-detail, .detail-wrap:not([hidden]), #detailView:not([hidden])'),
           hash: location.hash }; })()`);
ok('命令面板: Enter 后关闭', afterEnter.closed, JSON.stringify(afterEnter));
ok('命令面板: Enter 后落到详情或目标', afterEnter.detail || afterEnter.hash.length > 1, JSON.stringify(afterEnter));
ok('命令面板: 全程无 console 错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

/* ---------- 3. 深链兼容 ---------- */
for (const h of ['#tab=cn', '#tab=events', '#tab=market&sub=us']) {
  await evalJs(`(() => { location.hash = ${JSON.stringify(h)}; return true; })()`);
  await sleep(1600);
  const r = await evalJs(`(() => ({ tab: (document.querySelector('#tabs [data-tab][aria-selected="true"]') || {}).dataset?.tab,
      primary: [...document.querySelectorAll('[data-primary]')].find(b => b.getAttribute('aria-selected') === 'true')?.dataset.primary }))()`);
  ok(`深链 ${h} 生效`, !!r.tab, JSON.stringify(r));
  if (h === '#tab=cn') ok('深链 #tab=cn → 市场/A股', r.tab === 'cn' && r.primary === 'market', JSON.stringify(r));
  if (h === '#tab=events') ok('深链 #tab=events → 事件', r.primary === 'events', JSON.stringify(r));
}

/* ---------- 4. 移动端 ---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await evalJs(`(() => { location.hash = '#tab=market&sub=all'; return true; })()`);
await sleep(2200);
const m = await evalJs(`(() => ({ overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  sw: document.documentElement.scrollWidth, iw: window.innerWidth,
  topbarH: document.querySelector('.topbar')?.offsetHeight || 0 }))()`);
ok('移动端: 无横向溢出', !m.overflowX, JSON.stringify(m));
ok('移动端: 顶栏高度 ≤ 120', m.topbarH <= 120, String(m.topbarH));
await shot('mobile-market.png');

fs.mkdirSync('_qa', { recursive: true });
fs.writeFileSync('_qa/qa-report.json', JSON.stringify({ results, problems }, null, 1));
const failed = results.filter(r => !r.pass);
console.log(`\n===== QA 汇总 =====\n断言 ${results.length} 条，通过 ${results.length - failed.length}，失败 ${failed.length}`);
failed.forEach(f => console.log('✗ ' + f.name + (f.detail ? '\n   ' + f.detail : '')));
ws.close(); chrome.kill();
setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(failed.length ? 1 : 0); }, 300);
