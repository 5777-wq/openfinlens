/* bundle.test.mjs —— 发布卫生：打包产物不能过期、入口不能漏、首屏不能偷偷变重
 *
 * 这套断言防的是「改了源码忘了跑打包」这类静默故障：页面不报错，
 * 只是线上跑的是旧代码——比崩溃更难查。
 * 也防反向：以后有人把懒加载包塞回 index.html，首屏字节又悄悄涨回去。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0, 6).join('\n    ')); }
}
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- 产物新鲜度
for (const [script, label] of [
  ['_scripts/build-js-bundle.mjs', 'JS 包'],
  ['_scripts/build-css.mjs', 'CSS 包'],
]) {
  test(label + '产物是最新的（没忘跑打包脚本）', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, script), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  });
}

// ---------------------------------------------------------------- 入口完整性
const MANIFEST = JSON.parse(read('_scripts/js-bundle.manifest.json'));
const LAZY = new Set(MANIFEST.lazy || []);

test('js/ 下每个文件要么进了包、要么在 manifest.notLoaded 里登记', () => {
  const listed = new Set(MANIFEST.files);
  const notLoaded = new Set(MANIFEST.notLoaded || []);
  const all = [];
  for (const dir of ['js', 'js/ui', 'js/data', 'js/sources', 'js/engine']) {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      if (!name.endsWith('.js')) continue;
      if (/^bundle(-lazy)?\.js$/.test(name)) continue;
      all.push(dir + '/' + name);
    }
  }
  const orphans = all.filter(f => !listed.has(f) && !notLoaded.has(f));
  assert.deepEqual(orphans, [], '未登记：' + orphans.join(', '));
});

test('核心包 + 懒加载包覆盖全部登记文件（没有文件掉队）', () => {
  const crit = MANIFEST.files.filter(f => !LAZY.has(f));
  assert.equal(crit.length + LAZY.size, MANIFEST.files.length);
  assert.ok(crit.length > 20, '核心包文件数异常：' + crit.length);
  assert.ok(LAZY.size > 20, '懒加载包文件数异常：' + LAZY.size);
});

// 首屏必须有的模块（少一个就是首屏缺功能，而不是"懒加载"）
const MUST_BE_CORE = [
  'js/app.js', 'js/utils.js', 'js/store.js', 'js/bus.js', 'js/ui/motion.js', 'js/ui/navmap.js',
  'js/treemap.js', 'js/spark.js', 'js/worldmap.js', 'js/zones.js', 'js/tabscope.js',
  'js/sources/tencent.js', 'js/sources/eastmoney.js', 'js/charts.js',
];
test('首屏必需模块没有被错误地切进懒加载包', () => {
  const wrong = MUST_BE_CORE.filter(f => LAZY.has(f));
  assert.deepEqual(wrong, [], '被错切到懒加载：' + wrong.join(', '));
});

// ---------------------------------------------------------------- index.html 入口
test('index.html 只加载 1 个 JS 包 + 1 个 CSS 包（不许走回头路）', () => {
  const html = read('index.html');
  const js = [...html.matchAll(/<script[^>]+src="(js\/[^"?]+)/g)].map(m => m[1]);
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)/g)].map(m => m[1]);
  assert.deepEqual(js, ['js/bundle.js'], '首屏 JS 入口不是单一包：' + js.join(', '));
  assert.deepEqual(css, ['css/bundle.css'], '首屏 CSS 入口不是单一包：' + css.join(', '));
});

test('index.html 的业务资源 ?v= 版本一致（两个包一起换缓存）', () => {
  const html = read('index.html');
  const vers = [...html.matchAll(/(?:src|href)="(?:js|css)\/[^"]*?\?v=([0-9a-zA-Z]+)"/g)].map(m => m[1]);
  assert.ok(vers.length >= 2, '?v= 数量异常：' + vers.length);
  assert.equal(new Set(vers).size, 1, '版本不一致：' + [...new Set(vers)].join(' / '));
});

test('图表库不在首屏加载（50KB gzip 只有点开详情才用得到）', () => {
  const html = read('index.html');
  assert.ok(!/<script[^>]+src="lib\/lightweight-charts/.test(html), 'lightweight-charts 又回到首屏了');
  assert.ok(/lightweight-charts/.test(read('js/app.js')), 'app.js 里没有懒加载图表库的引用');
});

test('懒加载包由 app.js 触发，且失败不拖垮首屏', () => {
  const app = read('js/app.js');
  assert.ok(/loadLazyBundle\(\)/.test(app), 'app.js 没有调用 loadLazyBundle()');
  assert.ok(/js\/bundle-lazy\.js/.test(app), 'app.js 没引用 bundle-lazy.js');
  assert.ok(/try \{ await lazyReady; \} catch/.test(app), 'await lazyReady 没有错误兜底');
});

// 懒加载文件 → 它定义的全局名（用于守卫检查）
const LAZY_GLOBALS = {
  'js/compareview.js': 'CompareView', 'js/fundprofile.js': 'FundProfile', 'js/fundquiz.js': 'FundQuiz',
  'js/portfolio.js': 'PortfolioView', 'js/macroview.js': 'MacroView', 'js/alerts.js': 'AlertCenter',
  'js/pmshare.js': 'PMShare', 'js/panes.js': 'Panes', 'js/qr.js': 'QR', 'js/events.js': 'Events',
  'js/polymarket.js': 'Polymarket', 'js/sources/option.js': 'OptionSource', 'js/sources/news.js': 'NewsSource',
  'js/sources/lhb.js': 'LhbSource', 'js/data/explain.js': 'Explain', 'js/ui/command.js': 'CommandPalette',
};

test('懒加载包里的模块，app.js 引用处全部有守卫（缺包时只是少面板，不该炸）', () => {
  const lines = read('js/app.js').split(/\r?\n/);
  /* 本仓库认可几种守卫写法（都要求出现在「用到它的那一行之前」）：
       if (window.X) window.X.foo()              同行条件
       if (window.X) { … window.X.foo() }        上一行条件
       window.X && window.X.foo()                短路
       if (!window.X) return;                    函数开头早退（最常见）
       (window.X && typeof window.X.a === 'f') ? … : …   折行三元
     判断粒度是「所在函数」：函数开头早退后，函数体内所有引用都算受保护。 */
  const GUARD = (g) => new RegExp(
    '\\bif \\(\\s*!?window\\.' + g + '\\b' +          // if (window.X) / if (!window.X)
    '|\\btypeof window\\.' + g + '\\b' +
    '|\\(window\\.' + g + '\\s*&&' +
    '|window\\.' + g + '\\s*(&&|\\|\\||\\?)' +
    '|(?:&&|\\|\\|)\\s*window\\.' + g + '\\s*\\)'
  );
  // 缩进 2 空格的 IIFE 内函数声明就是「一个渲染/取数单元」
  const fnStart = lines.map((l, i) => (/^\s{2}(async\s+)?function\s+\w+\s*\(/.test(l) ? i : -1)).filter(i => i >= 0);
  const enclosingFn = (i) => { let s = 0; for (const f of fnStart) { if (f <= i) s = f; else break; } return s; };

  const bad = [];
  for (const [file, g] of Object.entries(LAZY_GLOBALS)) {
    if (!LAZY.has(file)) continue;
    const use = new RegExp('(?<![\\w.])window\\.' + g + '\\.(?=[A-Za-z_])');
    const re = GUARD(g);
    lines.forEach((l, i) => {
      if (!use.test(l)) return;
      const from = enclosingFn(i);
      let ok = false;
      for (let k = from; k < i; k++) if (re.test(lines[k])) { ok = true; break; }
      if (!ok && re.test(l)) ok = true;
      if (!ok) bad.push(g + '@' + (i + 1) + ': ' + l.trim().slice(0, 64));
    });
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// ---------------------------------------------------------------- 体积红线
test('首屏 JS 包不超过 300KB gzip（超了说明又往核心包塞东西了）', () => {
  const gz = zlib.gzipSync(readFileSync(path.join(ROOT, 'js/bundle.js')), { level: 9 }).length;
  assert.ok(gz / 1024 < 300, 'js/bundle.js = ' + (gz / 1024).toFixed(0) + 'KB gz');
});

test('首屏 CSS 不超过 60KB gzip（5 层合并 + 压缩后应显著低于原 88KB）', () => {
  const p = path.join(ROOT, 'css/bundle.css');
  assert.ok(existsSync(p), 'css/bundle.css 不存在');
  const gz = zlib.gzipSync(readFileSync(p), { level: 9 }).length;
  assert.ok(gz / 1024 < 60, 'css/bundle.css = ' + (gz / 1024).toFixed(0) + 'KB gz');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed  （bundle.test.mjs）');
process.exit(fail ? 1 : 0);
