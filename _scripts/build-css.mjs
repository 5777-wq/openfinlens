#!/usr/bin/env node
/* build-css.mjs —— 把 5 个 CSS 层打成 1 个（可选压缩），零依赖
 *
 * 为什么需要：
 *   首屏有 5 个 <link rel=stylesheet>，合计 88KB(gzip)。CSS 是**渲染阻塞**资源——
 *   实测线上 FCP 被最后一个 CSS 文件卡在 1.1s（TTFB 才 0.5s）。
 *   合成 1 个文件后少 4 个请求；若 _scripts/minify-css.mjs 存在（去注释+折叠空白），
 *   体积还能降到约 1/3（本仓库注释是大量中文，gzip 压不动，删注释的收益比压空白大）。
 *
 * 顺序 = 层叠顺序，**不能改**：
 *   css/style.css（令牌单一来源 + 旧版兜底）
 *   → css/ui/01-shell.css（外壳/顶栏/一级导航）
 *   → css/ui/02-market.css（行情区）
 *   → css/ui/03-panels.css（面板区）
 *   → css/ui/04-motion.css（动效覆盖）
 *
 * 用法：
 *   node _scripts/build-css.mjs            # 生成 css/bundle.css
 *   node _scripts/build-css.mjs --check    # 只校验是否过期
 *   node _scripts/build-css.mjs --no-minify
 *
 * 源码仍是 css/ 下的分层文件——**改样式改源码，然后跑这个脚本**。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'css/bundle.css');
const CHECK = process.argv.includes('--check');
const NO_MIN = process.argv.includes('--no-minify');

const LAYERS = [
  'css/style.css',
  'css/ui/01-shell.css',
  'css/ui/02-market.css',
  'css/ui/03-panels.css',
  'css/ui/04-motion.css',
];

let minifyCss = (s) => s;
let minified = false;
if (!NO_MIN) {
  try {
    const m = await import('./minify-css.mjs');
    if (typeof m.minifyCss === 'function') { minifyCss = m.minifyCss; minified = true; }
  } catch (e) {
    if (process.env.BUNDLE_DEBUG) console.warn('（未启用压缩：' + e.message + '）');
  }
}

/* 新增/改名 CSS 却忘了登记 → 线上样式静默丢失。这里拦一道。 */
const onDisk = readdirSync(path.join(ROOT, 'css')).filter(f => f.endsWith('.css') && f !== 'bundle.css')
  .map(f => 'css/' + f)
  .concat(readdirSync(path.join(ROOT, 'css/ui')).filter(f => f.endsWith('.css')).map(f => 'css/ui/' + f))
  .sort();
const unlisted = onDisk.filter(f => !LAYERS.includes(f));
const missing = LAYERS.filter(f => !existsSync(path.join(ROOT, f)));
if (missing.length) { console.error('缺少 CSS 文件：\n  ' + missing.join('\n  ')); process.exit(1); }
if (unlisted.length) {
  console.error('以下 CSS 没有登记进 build-css.mjs 的 LAYERS（线上不会生效）：\n  ' + unlisted.join('\n  '));
  process.exit(1);
}

const BANNER = [
  '/* bundle.css —— 由 _scripts/build-css.mjs 从 5 个 CSS 层生成，不要手改。',
  ' * 层叠顺序：' + LAYERS.map(f => path.basename(f)).join(' → '),
  ' * 改样式请改源码后运行：node _scripts/build-css.mjs',
  ' */',
  '',
].join('\n');
const parts = [];   // banner 不参与压缩（压缩器会删注释），最后再拼
for (const rel of LAYERS) {
  const body = readFileSync(path.join(ROOT, rel), 'utf8');
  parts.push('/* ==== ' + rel + ' ==== */');
  parts.push(body.replace(/\s+$/, ''));
  parts.push('');
}
const raw = parts.join('\n');
const out = BANNER + (minified ? minifyCss(raw) : raw) + '\n';

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

if (CHECK) {
  /* 同 build-js-bundle：忽略换行风格差异（git autocrlf 会让同一产物在 Windows 是 CRLF、Linux 是 LF） */
  const norm = (x) => x.split(String.fromCharCode(13) + '\n').join('\n');
  const cur = norm(existsSync(OUT) ? readFileSync(OUT, 'utf8') : '');
  if (cur !== norm(out)) {
    console.error('css/bundle.css 已过期：请运行 node _scripts/build-css.mjs');
    process.exit(1);
  }
  console.log('css/bundle.css 是最新的：' + LAYERS.length + ' 层 → ' + kb(statSync(OUT).size) + (minified ? '（已压缩）' : '（未压缩）'));
  process.exit(0);
}

writeFileSync(OUT, out, 'utf8');
console.log('已生成 css/bundle.css：' + LAYERS.length + ' 层 ' + kb(raw.length) + ' → ' + kb(statSync(OUT).size) + '，压缩：' + (minified ? '开' : '关'));
