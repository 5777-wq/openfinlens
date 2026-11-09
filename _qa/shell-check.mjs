#!/usr/bin/env node
/* _qa/shell-check.mjs —— shell 自检（一次会话跑完）
   覆盖：5 个一级切换 / 二级条按需出现 / 命令面板全键盘 / 深链新旧两种 /
         模式切换 + 一键还原 / 390px 移动端 / 合规开关下的子项剔除。
   截图时临时 Emulation.setEmulatedMedia(prefers-reduced-motion: reduce)：
   headless 下合成层动画不一定推进，会把"动画进行中"的一帧截下来（指示器看着不动），
   减动效让所有过渡瞬时落位，截到的是真实终态。
   用法：node _qa/shell-check.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME || 'C:/Users/WangQ/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 90);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shellchk-'));
const BASE = 'http://127.0.0.1:8123/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra }); console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  ' + extra : '')); };

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

async function getWs() {
  for (let i = 0; i < 120; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('chrome 未就绪');
}

let id = 0;
const pend = new Map();
function send(ws, method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => { pend.set(mid, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 60000); });
}

const ws = new WebSocket(await getWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXCEPTION ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('CONSOLE ' + m.params.args.map((a) => a.value || a.description || a.type).join(' '));
  }
};

await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Log.enable');

const ev = async (expr) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
const shot = async (file, clip) => {
  const { data } = await send(ws, 'Page.captureScreenshot', Object.assign({ format: 'png', captureBeyondViewport: false }, clip ? { clip } : {}));
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('   shot', file);
};
const setViewport = async (w, h, mobile) => {
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
};
const reduceMotion = async (on) => {
  await send(ws, 'Emulation.setEmulatedMedia', on
    ? { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }
    : { features: [] });
};
const goto = async (url) => { await send(ws, 'Page.navigate', { url }); await sleep(4200); };

const state = () => ev(`(() => {
  const ink = document.getElementById('navInk');
  const activeP = document.querySelector('#primaryNav [aria-selected="true"]');
  const activeT = document.querySelector('#tabs .tab.active');
  const sub = document.getElementById('subbar');
  const pb = document.getElementById('primaryNav').getBoundingClientRect();
  const ib = ink.getBoundingClientRect();
  const on = activeP ? document.querySelector('#primaryNav [data-primary="' + activeP.dataset.primary + '"]') : null;
  const ob = on ? on.getBoundingClientRect() : null;
  return {
    primary: activeP ? activeP.dataset.primary : null,
    tab: activeT ? activeT.dataset.tab : null,
    subHidden: sub.hidden,
    bodyHasSub: document.body.classList.contains('has-subbar'),
    subCount: [...document.querySelectorAll('#tabs .tab')].filter(n=>n.getClientRects().length).length,
    subLabels: [...document.querySelectorAll('#tabs .tab')].filter(n=>n.getClientRects().length).map(n=>n.textContent.trim()),
    inkAligned: ob ? (Math.abs(ib.left - ob.left) < 2 && Math.abs(ib.width - ob.width) < 2) : false,
    theme: document.documentElement.dataset.theme,
  };
})()`);

const main = async () => {
  await reduceMotion(true);
  await setViewport(1440, 1000, false);
  await goto(BASE);
  await ev(`localStorage.removeItem('ofl:crypto'); localStorage.removeItem('ofl:options'); location.hash=''; true`);
  await goto(BASE);

  ok('首帧模式数据令牌 = daylight（默认白底）', (await state()).theme === 'daylight', 'theme=' + (await state()).theme);

  /* ---------- 5 个一级 ---------- */
  const expect = {
    market: { tab: 'all', sub: true, count: 7, labels: ['全部', 'A股', '港股', '美股', '加密', '宏观', '期权'] },
    events: { tab: 'events', sub: false, count: 1 },
    assets: { tab: 'watch', sub: true, count: 2, labels: ['自选', '持仓'] },
    fund: { tab: 'compare', sub: false, count: 1 },
    insight: { tab: 'chain', sub: false, count: 1 },
  };
  for (const k of Object.keys(expect)) {
    await ev(`document.getElementById('pnav-${k}').click(); true`);
    await sleep(700);
    const st = await state();
    const e = expect[k];
    ok(`一级 ${k} → tab=${e.tab}`, st.tab === e.tab, JSON.stringify(st.tab));
    ok(`一级 ${k} 的二级条 ${e.sub ? '出现' : '隐藏'}`, st.subHidden === !e.sub, 'subHidden=' + st.subHidden);
    const wantCount = e.sub ? e.count : 0;   // 二级条隐藏时按钮不参与布局（可见数为 0）
    ok(`一级 ${k} 子项数 = ${wantCount}`, st.subCount === wantCount, 'count=' + st.subCount + ' labels=' + (st.subLabels || []).join('/'));
    ok(`一级 ${k} 指示器对齐当前胶囊`, st.inkAligned === true, 'inkAligned=' + st.inkAligned);
    if (e.labels) ok(`一级 ${k} 子项顺序`, (st.subLabels || []).join(',') === e.labels.join(','), (st.subLabels || []).join(','));
    await shot(`_qa/shell-p-${k}.png`);
  }

  /* ---------- 一级回跳记忆：市场→A股→事件→市场 应回到 A股 ---------- */
  await ev(`document.getElementById('tab-cn').click(); true`); await sleep(500);
  await ev(`document.getElementById('pnav-events').click(); true`); await sleep(500);
  await ev(`document.getElementById('pnav-market').click(); true`); await sleep(600);
  ok('一级回跳记忆（回市场落回 A股）', (await state()).tab === 'cn', 'tab=' + (await state()).tab);

  /* ---------- 命令面板：真实键盘 ⌘K ---------- */
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 });
  await sleep(500);
  const pal = await ev(`({ hidden: document.getElementById('cmdPalette').hidden, open: document.getElementById('cmdPalette').classList.contains('is-open'), items: document.querySelectorAll('#cmdList .cmd-item').length, focus: document.activeElement.id })`);
  ok('⌘K 打开命令面板', !pal.hidden && pal.open && pal.items > 0, JSON.stringify(pal));
  ok('焦点进入命令输入框', pal.focus === 'cmdInput', pal.focus);
  await shot('_qa/shell-cmd-open.png');

  await ev(`(() => { const i=document.getElementById('cmdInput'); i.value='茅台'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(900);
  const search = await ev(`[...document.querySelectorAll('#cmdList .cmd-item')].map(n=>n.textContent.trim())`);
  ok('搜索「茅台」出结果', search.length > 0, JSON.stringify(search.slice(0, 4)));
  ok('本地/远程同一只标的去重', search.length === 1 || new Set(search.map(s=>s.replace(/^标的|^A股/,'').trim())).size === search.length, JSON.stringify(search));
  await shot('_qa/shell-cmd-search.png');

  await ev(`(() => { const i=document.getElementById('cmdInput'); ['ArrowDown','ArrowUp'].forEach(k=>i.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}))); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true; })()`);
  await sleep(1400);
  const after = await ev(`({ hidden: document.getElementById('cmdPalette').hidden, hash: location.hash, view: (document.querySelector('.view.active')||{}).id })`);
  ok('↵ 执行 → 进入标的详情', after.hidden && after.hash.indexOf('#symbol=') === 0 && after.view === 'view-detail', JSON.stringify(after));
  await shot('_qa/shell-cmd-enter.png');

  /* ---------- 深链 ---------- */
  await ev(`location.hash='#tab=market&sub=hk'; true`); await sleep(1000);
  let st = await state();
  ok('新深链 #tab=market&sub=hk → 港股', st.tab === 'hk' && st.primary === 'market', JSON.stringify({ tab: st.tab, primary: st.primary }));
  await ev(`location.hash='#tab=cn'; true`); await sleep(1000);
  st = await state();
  ok('旧深链 #tab=cn → A股 + 市场', st.tab === 'cn' && st.primary === 'market', JSON.stringify({ tab: st.tab, primary: st.primary }));
  await ev(`location.hash='#tab=fxmacro'; true`); await sleep(900);
  st = await state();
  ok('旧深链 #tab=fxmacro → 宏观（二级条仍出现）', st.tab === 'fxmacro' && st.subHidden === false, JSON.stringify({ tab: st.tab, subHidden: st.subHidden }));
  await ev(`location.hash='#tab=market'; true`); await sleep(900);
  ok('一级深链 #tab=market → 默认子项', (await state()).tab === 'all', 'tab=' + (await state()).tab);

  /* ---------- 设置：模式 + 一键还原 ---------- */
  await ev(`document.getElementById('settingsBtn').click(); true`); await sleep(500);
  await shot('_qa/shell-settings.png');
  const segCount = await ev(`document.querySelectorAll('#segTheme button').length`);
  ok('设置里只剩两个模式', segCount === 2, 'buttons=' + segCount);
  ok('没有随机换肤按钮', (await ev(`!!document.getElementById('segThemeRandom')`)) === false);
  await ev(`document.querySelector('#segTheme [data-theme="daylight"]').click(); true`); await sleep(800);
  let th = await ev(`({ theme: document.documentElement.dataset.theme, stored: JSON.parse(localStorage.getItem('gfd_settings')||'{}').theme, scheme: document.documentElement.style.colorScheme })`);
  ok('切日光：data-theme + 持久化 + colorScheme', th.theme === 'daylight' && th.stored === 'daylight' && th.scheme === 'light', JSON.stringify(th));
  await ev(`document.getElementById('settingsClose').click(); true`); await sleep(500);
  await shot('_qa/shell-daylight.png');
  // 一键还原
  await ev(`document.getElementById('settingsBtn').click(); true`); await sleep(400);
  await ev(`document.getElementById('settingsReset').click(); true`); await sleep(900);
  th = await ev(`({ theme: document.documentElement.dataset.theme, stored: JSON.parse(localStorage.getItem('gfd_settings')||'{}').theme, open: document.getElementById('settingsModal').classList.contains('active') })`);
  ok('一键还原 → 默认日光 + 弹层关闭', th.theme === 'daylight' && th.stored === 'daylight' && !th.open, JSON.stringify(th));

  /* ---------- 移动端 390px ---------- */
  await reduceMotion(true);
  await setViewport(390, 844, true);
  for (const [file, hash] of [['m-all', '#tab=all'], ['m-events', '#tab=events'], ['m-compare', '#tab=compare']]) {
    await goto(BASE + hash);
    await sleep(1500);
    const m = await ev(`(() => {
      const tb=document.querySelector('.topbar').getBoundingClientRect();
      const nav=document.getElementById('primaryNav').getBoundingClientRect();
      const sub=document.getElementById('subbar');
      const doc=document.documentElement;
      return { overflowX: doc.scrollWidth > doc.clientWidth + 1, topbarW: Math.round(tb.width), navW: Math.round(nav.width), subHidden: sub.hidden, subTop: Math.round(sub.getBoundingClientRect().top), topbarH: Math.round(tb.height) };
    })()`);
    ok(`390px ${file}：无横向溢出`, !m.overflowX, JSON.stringify(m));
    ok(`390px ${file}：二级条位置正确`, m.subHidden ? true : m.subTop === m.topbarH, 'subTop=' + m.subTop + ' topbarH=' + m.topbarH);
    await shot(`_qa/shell-${file}.png`);
  }

  /* ---------- 390px 详情工具条：画线六件默认折叠、点开可见 ---------- */
  await goto(BASE + '#symbol=sh600519');
  await sleep(1500);
  const kt = await ev(`(() => {
    const more = document.getElementById('kToolbarMore');
    const group = document.getElementById('kDrawGroup');
    const shown = (n) => n.getClientRects().length > 0;
    return {
      moreShown: shown(more), expanded: more.getAttribute('aria-expanded'),
      drawsShown: [...document.querySelectorAll('[data-draw]')].filter(shown).length,
    };
  })()`);
  ok('390px 详情：画线开关可见、六件默认收起', kt.moreShown && kt.drawsShown === 0 && kt.expanded === 'false', JSON.stringify(kt));
  await ev(`document.getElementById('kToolbarMore').click(); true`);
  await sleep(300);
  const kt2 = await ev(`({ expanded: document.getElementById('kToolbarMore').getAttribute('aria-expanded'), drawsShown: [...document.querySelectorAll('[data-draw]')].filter(n=>n.getClientRects().length>0).length })`);
  ok('390px 详情：点开后六件画线按钮全部可见', kt2.expanded === 'true' && kt2.drawsShown === 6, JSON.stringify(kt2));
  await shot('_qa/shell-m-detail.png');

  /* ---------- 390px 命令面板 ---------- */
  await ev(`document.getElementById('cmdOpen').click(); true`);
  await sleep(500);
  await shot('_qa/shell-m-cmd.png');
  await ev(`document.getElementById('cmdScrim').click(); true`);
  await sleep(400);

  /* ---------- 合规开关：crypto/options 关掉后子项剔除 + 深链回落 ---------- */
  await setViewport(1440, 1000, false);
  await goto(BASE + '?crypto=off&options=off#tab=option');
  await sleep(1500);
  st = await state();
  ok('合规关闭：#tab=option 回落到「全部」', st.tab === 'all', 'tab=' + st.tab);
  ok('合规关闭：市场子项剔除 加密/期权', (st.subLabels || []).join(',') === '全部,A股,港股,美股,宏观', (st.subLabels || []).join(','));
  await ev(`document.getElementById('pnav-market').click(); true`); await sleep(600);
  ok('合规关闭：点一级市场不报错且有内容', (await state()).tab === 'all');
  await goto(BASE + '?crypto=on&options=on');
  await sleep(800);

  /* ---------- 汇总 ---------- */
  console.log('\n===== shell check =====');
  const bad = results.filter((r) => !r.pass);
  console.log(results.length - bad.length + ' passed, ' + bad.length + ' failed');
  if (bad.length) bad.forEach((b) => console.log('  FAIL', b.name, b.extra || ''));
  const pageErrors = logs.filter((l) => /EXCEPTION/.test(l));
  console.log('page exceptions:', pageErrors.length);
  pageErrors.slice(0, 8).forEach((l) => console.log('  ' + l));
  process.exitCode = bad.length ? 1 : 0;
};

try { await main(); }
catch (e) { console.error('CHECK FAILED:', e.message); console.log(logs.slice(0, 12).join('\n')); process.exitCode = 1; }
finally {
  ws.close(); chrome.kill();
  setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} process.exit(process.exitCode || 0); }, 300);
}
