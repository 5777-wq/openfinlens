/* pmshare.test.mjs —— 分享卡片：纯离线单测（node _test/pmshare.test.mjs）
   覆盖：源码级合规回归（不外泄上游标识）+ 零网络请求 + 声明文案 + API 形状。

   这一组是"分享"这个动作特有的风险面：一张图片会被转到平台之外，
   一旦图上或链接里带上了上游的 slug / URL / tokenId，就等于替交易平台做了引流。
   所以这里的断言不是"功能对不对"，而是"不该出现的东西有没有出现"。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

const src = readFileSync(path.join(ROOT, 'js/pmshare.js'), 'utf8');
const qrSrc = readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8');

/* 上游标识一旦出现在分享链路里，就等于替交易平台做了引流。
   注意只扫代码不扫注释——注释里正好要写"不得出现 tokenId / slug"，
   连注释一起扫的话，这段规则会把自己判成违规。 */
const FORBIDDEN = /tokenId|clobTokenIds|slug|polymarket\.com|gamma-api|clob\.polymarket|kalshi/i;

/* 剥掉块注释与行注释，剩下的才是真正会跑到浏览器里的代码 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

await test('合规：分享模块代码不含上游标识（tokenId / slug / 交易平台域名）', () => {
  assert.doesNotMatch(stripComments(src), FORBIDDEN,
    '分享链路里出现了上游标识——这会把我们变成交易平台的引流入口');
  // 注释里允许出现这些词（规则说明本身），但不允许出现真实链接
  assert.doesNotMatch(src, /https?:\/\/[^\s'"]*polymarket/i, '注释或代码里出现了上游真实链接');
});

await test('合规：二维码只指向自家站点', () => {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array, TextEncoder });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx, { filename: 'js/pmshare.js' });
  const S = ctx.window.PMShare;
  assert.ok(S && S.SHARE_URL, '没导出 SHARE_URL');
  assert.match(S.SHARE_URL, /^https:\/\/5777-wq\.github\.io\/openfinlens\//, '二维码指向的不是自家站点');
  assert.doesNotMatch(S.SHARE_URL, /ev:|pm:/, '二维码链接里带了事件标识');
});

await test('零网络：分享与二维码模块全程不发请求', () => {
  for (const [name, s] of [['pmshare.js', src], ['qr.js', qrSrc]]) {
    assert.doesNotMatch(s, /\bfetch\s*\(/, `${name} 里出现了 fetch`);
    assert.doesNotMatch(s, /XMLHttpRequest/, `${name} 里出现了 XMLHttpRequest`);
    assert.doesNotMatch(s, /navigator\.sendBeacon/, `${name} 里出现了 sendBeacon`);
  }
});

await test('口径声明：卡片文案里保留"不是预测"与"不构成投资建议"的语义', () => {
  assert.match(src, /不是预测/, '缺少"不是预测"的说明');
  assert.match(src, /不构成投资建议/, '缺少"不构成投资建议"的声明');
  assert.match(src, /不可加总|不可相加|互斥/, '缺少档位能否加总的口径说明');
});

await test('API：导出 mount / open / drawCard，且 open 走 deps 取事件', () => {
  const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array, TextEncoder });
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx, { filename: 'js/pmshare.js' });
  const S = ctx.window.PMShare;
  assert.equal(typeof S.mount, 'function');
  assert.equal(typeof S.open, 'function');
  assert.equal(typeof S.drawCard, 'function');
  assert.equal(typeof S.download, 'function');
  // open 必须从 deps 拿事件，而不是自己持有数据（事件数据在 app.js 的 state 里）
  assert.match(src, /deps\.getEvent/, 'open 没有通过 deps 取事件');
  // 取不到事件时必须安静地返回 false，不能画一张空卡
  S.mount({ getEvent: () => null });
  assert.equal(S.open('nope'), false, '取不到事件时应该返回 false');
});

await test('导出：优先系统分享，不可用时退回下载（不给人死按钮）', () => {
  assert.match(src, /navigator\.share/, '没有走 Web Share API');
  assert.match(src, /canShare/, '没有做 canShare 能力探测');
  assert.match(src, /download/, '没有下载兜底');
  // 文件名不能带事件 id
  assert.doesNotMatch(src, /download\s*=\s*`[^`]*\$\{[^}]*id/i, '下载文件名里带了事件 id');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
