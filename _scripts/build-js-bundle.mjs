#!/usr/bin/env node
/* build-js-bundle.mjs —— 把 js/ 下的业务脚本打成「首屏必需包 + 懒加载包」（零依赖）
 *
 * 为什么需要：
 *   1) 首屏原本 69 个 <script defer>，每个都是独立请求。慢网下单个小文件也要排队 ~1.9s；
 *      打成一个包后请求数 -68，解析总量不变但没了排队。
 *   2) 打成一个包后仍有 431KB(gzip)，其中一大半是「只有点开详情/基金/事件仓才用」的模块。
 *      把它们切出去（bundle-lazy.js），首屏只用下载真正需要的部分；
 *      懒加载包由 app.js 在首屏骨架铺好后并行拉取，并在装配面板前 await。
 *   3) 若 _scripts/minify-js.mjs 存在，则输出前做词法安全的压缩（只删注释与冗余空白）。
 *
 * 顺序来源：_scripts/js-bundle.manifest.json
 *   files —— 全部文件，按加载顺序（跨包顺序由「先核心后懒加载」保证）
 *   lazy  —— 其中的懒加载子集
 * 用法：
 *   node _scripts/build-js-bundle.mjs            # 生成 js/bundle.js + js/bundle-lazy.js
 *   node _scripts/build-js-bundle.mjs --check    # 只校验（CI/提交前用）
 *   node _scripts/build-js-bundle.mjs --no-minify  # 不压缩（排错用）
 *
 * 依赖库（lib/*.js）不打包：它们是独立版本号、可能被替换。
 *   lightweight-charts 由 app.js 的懒加载器在拉 bundle-lazy 之前注入（见 index.html 注释）。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, statSync as st } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, '_scripts/js-bundle.manifest.json');
const OUT_CRIT = path.join(ROOT, 'js/bundle.js');
const OUT_LAZY = path.join(ROOT, 'js/bundle-lazy.js');
const CHECK = process.argv.includes('--check');
const NO_MIN = process.argv.includes('--no-minify');

let minifyJs = (s) => s;
let minified = false;
if (!NO_MIN) {
  try {
    const m = await import('./minify-js.mjs');
    if (typeof m.minifyJs === 'function') { minifyJs = m.minifyJs; minified = true; }
  } catch (e) {
    if (process.env.BUNDLE_DEBUG) console.warn('（未启用压缩：' + e.message + '）');
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const lazySet = new Set(manifest.lazy || []);

const missing = manifest.files.filter(f => !existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error('manifest 里有不存在的文件：\n  ' + missing.join('\n  '));
  process.exit(1);
}
const stale = [...lazySet].filter(f => !manifest.files.includes(f));
if (stale.length) {
  console.error('manifest.lazy 里有不在 files 内的文件：\n  ' + stale.join('\n  '));
  process.exit(1);
}

/* 新增 js 文件却忘了登记 → 线上会「少一个模块」，这是最难查的那类 bug。
   这里在 --check 与生成时都拦一道（lib/ 与 bundle*.js 不算）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = st(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') && !/^bundle(-lazy)?\.js$/.test(name)) out.push(p);
  }
  return out;
}
const notLoaded = new Set(manifest.notLoaded || []);   // 只在 _test 里用的模块，故意不进包
const onDisk = walk(path.join(ROOT, 'js')).map(p => path.relative(ROOT, p).split(path.sep).join('/')).filter(f => !notLoaded.has(f)).sort();
const listed = new Set(manifest.files);
const unlisted = onDisk.filter(f => !listed.has(f));
if (unlisted.length) {
  console.error('以下 js 文件没有登记进 _scripts/js-bundle.manifest.json（线上不会加载）：\n  ' + unlisted.join('\n  '));
  process.exit(1);
}
const gone = manifest.files.filter(f => !onDisk.includes(f.replace(/\\/g, '/')));
if (gone.length) {
  console.error('manifest 登记了磁盘上不存在的文件：\n  ' + gone.join('\n  '));
  process.exit(1);
}

const HEAD = (name, extra) => [
  '/* ' + name + ' —— 由 _scripts/build-js-bundle.mjs 生成，不要手改。',
  ' * 改源码后运行：node _scripts/build-js-bundle.mjs',
  extra,
  ' */',
  '',
];

function build(files, name) {
  const parts = [];   // banner 不参与压缩（压缩器会删注释），最后再拼
  for (const rel of files) {
    const body = readFileSync(path.join(ROOT, rel), 'utf8');
    parts.push('/* ==== ' + rel + ' ==== */');
    parts.push(body.replace(/\s+$/, ''));
    parts.push(';');   // 分隔：避免上一文件末尾无分号时与下一文件粘连
    parts.push('');
  }
  const raw = parts.join('\n');
  // 压缩器会删掉所有注释（含本文件的 banner），所以 banner 在压缩之后再拼回最前面
  const body = minified ? minifyJs(raw) : raw;
  if (process.env.BUNDLE_DEBUG && minified) console.log('  minify ' + name + ' ' + raw.length + ' → ' + body.length + ' bytes');
  return HEAD(name, ' * 文件数：' + files.length).join('\n') + body + '\n';
}

const critFiles = manifest.files.filter(f => !lazySet.has(f));
const lazyFiles = manifest.files.filter(f => lazySet.has(f));

const crit = build(critFiles, 'bundle.js（首屏必需）');
const laz = build(lazyFiles, 'bundle-lazy.js（首屏后懒加载）');

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

if (CHECK) {
  /* 比较时统一换行：仓库 core.autocrlf=true，同一份产物在 Windows 检出是 CRLF、
     在 Linux CI 是 LF，逐字节比会假报警（banner 行尤其明显）。 */
  const norm = (x) => x.split(String.fromCharCode(13) + '\n').join('\n');
  const cur1 = norm(existsSync(OUT_CRIT) ? readFileSync(OUT_CRIT, 'utf8') : '');
  const cur2 = norm(existsSync(OUT_LAZY) ? readFileSync(OUT_LAZY, 'utf8') : '');
  let bad = false;
  if (cur1 !== norm(crit)) { console.error('js/bundle.js 已过期'); bad = true; }
  if (cur2 !== norm(laz)) { console.error('js/bundle-lazy.js 已过期'); bad = true; }
  if (bad) {
    console.error('请运行：node _scripts/build-js-bundle.mjs');
    process.exit(1);
  }
  console.log('bundle 是最新的：核心 ' + critFiles.length + ' 文件 ' + kb(statSync(OUT_CRIT).size) +
    ' / 懒加载 ' + lazyFiles.length + ' 文件 ' + kb(statSync(OUT_LAZY).size) + (minified ? '（已压缩）' : '（未压缩）'));
  process.exit(0);
}

writeFileSync(OUT_CRIT, crit, 'utf8');
writeFileSync(OUT_LAZY, laz, 'utf8');
console.log('核心包 js/bundle.js       ' + critFiles.length + ' 文件 → ' + kb(statSync(OUT_CRIT).size));
console.log('懒加载包 js/bundle-lazy.js ' + lazyFiles.length + ' 文件 → ' + kb(statSync(OUT_LAZY).size));
console.log('压缩：' + (minified ? '开（minify-js.mjs）' : '关'));
