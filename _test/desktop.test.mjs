/* desktop.test.mjs —— 轻量桌面版契约（纯离线，读真实源文件）
   desktop.html / js/desktop.js / css/desktop.css 是三件套之外的独立入口，
   本组钉住它的边界：资源引用白名单、版本戳一致、构建登记（manifest notLoaded
   + build-css STANDALONE）、与移动页互链、desktop.js 可编译、合规词扫描。
   背景：bundle.test 只守 index.html 的入口唯一性，desktop.html 是第二个入口，
   没有这组钉子它就会漂。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'apps', 'terminal');
const read = (p) => readFileSync(path.join(SITE, p), 'utf8');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

await test('desktop.html 资源引用白名单：三件套 + vendor 五件，无其他 script/link', () => {
  const html = read('desktop.html');
  const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1].split('?')[0])
    .filter(h => !h.startsWith('data:'));   // favicon 的 data: URI 不算资源引用
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
  const ALLOW_LINKS = ['css/bundle.css', 'css/desktop.css', 'desktop.webmanifest'];
  const ALLOW_SCRIPTS = [
    'core/vendor/lightweight-charts.standalone.production.js',
    'js/bundle.js',
    'js/sources/news.js',
    'js/desktop.js',
  ];
  for (const h of links) assert.ok(ALLOW_LINKS.includes(h), '意外 link: ' + h);
  for (const s of scripts) assert.ok(ALLOW_SCRIPTS.includes(s), '意外 script: ' + s);
  const inline = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 2, '内联脚本只允许两段：首帧主题 + SW 注册');
  assert.ok(/首帧主题/.test(inline[0][1]), '第一段应是首帧主题引导');
  assert.ok(/serviceWorker/.test(inline[1][1]), '第二段应是 SW 注册');
  assert.equal(scripts.filter(s => s === 'js/bundle.js').length, 1, 'bundle.js 恰好一次');
  assert.equal(scripts.filter(s => s.includes('bundle-lazy')).length, 0, '桌面版不加载懒加载包（地图/多图不用，省 282KB）');
});

await test('desktop.html 业务资源 ?v= 同版本，与 index.html 当前版本一致', () => {
  const html = read('desktop.html');
  const idx = read('index.html');
  const stamps = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  assert.ok(stamps.length >= 3, '业务版本戳应覆盖 css 两件 + js 两件（vendor 用语义版本不计）');
  assert.equal(new Set(stamps).size, 1, '桌面版内部 ?v= 必须同版本');
  const idxStamps = [...idx.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  const idxVer = new Set(idxStamps);
  assert.equal(idxVer.size, 1, '前置：index.html 本身应同版本');
  assert.equal(stamps[0], [...idxVer][0], '桌面版与完整版必须同版本号（同批缓存失效）');
  const vendor = [...html.matchAll(/lightweight-charts[^"]*\?v=([^"&]+)/g)][0];
  assert.ok(vendor && vendor[1] === '4.2.3', 'vendor 钉 4.2.3');
});

await test('构建登记：js/desktop.js 在 manifest.notLoaded；css/desktop.css 在 build-css STANDALONE', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '_scripts', 'js-bundle.manifest.json'), 'utf8'));
  assert.ok(manifest.notLoaded.includes('js/desktop.js'), 'desktop.js 未登记 notLoaded（bundle.test 会红）');
  assert.ok(!manifest.files.includes('js/desktop.js'), 'desktop.js 不得进首屏包');
  assert.ok(!manifest.lazy.includes('js/desktop.js'), 'desktop.js 不得进懒加载包');
  const bc = readFileSync(path.join(ROOT, '_scripts', 'build-css.mjs'), 'utf8');
  assert.ok(/STANDALONE\s*=\s*\['css\/desktop\.css'\]/.test(bc), 'build-css 未豁免 desktop.css');
  const bundleCss = read('css/bundle.css');
  assert.ok(!/\.dt-grid/.test(bundleCss), 'desktop 样式混进了 bundle.css（移动端白背字节）');
});

await test('两页互链：完整版有「桌面版」入口，桌面版有「返回完整版」', () => {
  const idx = read('index.html');
  const html = read('desktop.html');
  assert.ok(/href="desktop\.html"/.test(idx), 'index.html 缺桌面版入口');
  assert.ok(/href="\.\/index\.html"/.test(html), 'desktop.html 缺返回完整版链接');
});

await test('应用壳：可安装独立窗口（manifest standalone + SW）+ 可拖分隔条 + 不滚动壳', () => {
  const html = read('desktop.html');
  const css = read('css/desktop.css');
  const manifest = JSON.parse(readFileSync(path.join(SITE, 'desktop.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone', 'manifest 必须 standalone（独立窗口）');
  assert.ok(/desktop\.html/.test(manifest.start_url), 'start_url 指向桌面页');
  assert.ok(manifest.icons && manifest.icons.length >= 1, '安装至少要一个图标');
  assert.ok(/serviceWorker[^]*register\('sw\.js'\)/.test(html), '桌面页未注册 SW（不满足安装条件）');
  assert.ok(/id="dtInstall"[^>]*hidden/.test(html), '缺安装按钮（默认隐藏，beforeinstallprompt 才亮）');
  assert.ok(/class="dt-app"/.test(html), '缺应用壳根节点');
  assert.ok(/id="dtVsplit"/.test(html) && /id="dtHsplit"/.test(html), '缺可拖分隔条');
  assert.ok(/role="separator"/.test(html), '分隔条缺 separator 语义');
  assert.ok(/overflow:\s*hidden/.test(css) && /100dvh/.test(css), '应用壳必须满高不滚动');
  const js = read('js/desktop.js');
  assert.ok(/dtLayout/.test(js), '分隔条布局未落盘（刷新即丢）');
  assert.ok(/beforeinstallprompt/.test(js), '安装按钮缺 beforeinstallprompt 接线');
});

await test('desktop.js 语法可编译（new Function 口径）且无 ESM/外部 URL', () => {
  const js = read('js/desktop.js');
  assert.ok(!/^\s*import\s/m.test(js), 'desktop.js 必须是纯 IIFE（browser 直接加载）');
  assert.ok(!/^\s*export\s/m.test(js), 'desktop.js 不允许 export');
  assert.doesNotThrow(() => new Function(js), 'desktop.js 无法编译');
  assert.ok(!/https?:\/\//.test(js), 'desktop.js 不允许硬编码外链（取数必须走既有源模块/相对路径）');
});

await test('desktop.js 合规词扫描：无预测市场品牌、无省略号问句、面向文案为中文', () => {
  const js = read('js/desktop.js');
  const html = read('desktop.html');
  const all = js + html;
  assert.ok(!/polymarket|poly\.market/i.test(all), '桌面版不出现预测市场品牌（合规红线）');
  // 红线口径是「省略号问句」（问句文本以省略号收尾/占位）；载入提示等 UI 文案的
  // 单个省略号与主站同惯例，不在禁令内
  assert.ok(!/…\s*[?？]|\.\.\.\s*[?？]/.test(all), '不得出现省略号问句（合规红线）');
  assert.ok(/轻量桌面版/.test(html), '页面应有中文标识');
});

await test('desktop.js 只声明使用 bundle.js 的既有全局（不 require 不 import 不自建取数协议）', () => {
  const js = read('js/desktop.js');
  for (const g of ['window.U', 'window.Bus', 'window.Store', 'window.Charts',
    'window.TencentSource', 'window.EastmoneySource', 'window.BinanceSource', 'window.NewsSource']) {
    assert.ok(js.includes(g), '缺少全局引用: ' + g);
  }
  assert.ok(!/XMLHttpRequest|new WebSocket/.test(js), '不允许绕开 request 层自建传输');
  assert.ok(/data\/us-signals\.json/.test(js), '美股信号吃 data 分支产物（相对路径）');
});

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}, 0);
