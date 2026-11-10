#!/usr/bin/env node
/* build-js-bundle.mjs —— 把 index.html 里的业务脚本打成一个包（零依赖）
 *
 * 为什么需要：首屏 69 个 <script defer>，每个都是独立请求。实测慢网下
 * 单个小文件要排队 ~1.9s（universe.js/explain.js 各自 1.9s），首屏被请求数拖住。
 * 打成 1 个包后：请求数 -68，解析总量不变，但没了排队与重复的请求头。
 *
 * 顺序来源：_scripts/js-bundle.manifest.json（由本脚本 --init 从 index.html 生成一次）。
 * 用法：
 *   node _scripts/build-js-bundle.mjs          # 按 manifest 重新生成 js/bundle.js
 *   node _scripts/build-js-bundle.mjs --init    # 从 index.html 的 <script src="js/..."> 顺序重建 manifest
 *   node _scripts/build-js-bundle.mjs --check   # 只校验 bundle 与 manifest 是否过期（CI 用）
 *
 * 依赖库（lib/*.js）不打包：它们是独立版本号、可能被替换。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const MANIFEST = path.join(ROOT, '_scripts/js-bundle.manifest.json');
const OUT = path.join(ROOT, 'js/bundle.js');
const INIT = process.argv.includes('--init');
const CHECK = process.argv.includes('--check');

function readManifestFromHtml() {
  const html = readFileSync(HTML, 'utf8');
  const list = [...html.matchAll(/<script defer src="(js\/[^"?]+\.js)\?v=[^"]+"><\/script>/g)].map(m => m[1]);
  return list.filter(f => f !== 'js/bundle.js');
}

if (INIT || !existsSync(MANIFEST)) {
  const files = readManifestFromHtml();
  writeFileSync(MANIFEST, JSON.stringify({ note: 'index.html 的脚本加载顺序（build-js-bundle.mjs --init 生成）', files }, null, 2) + '\n', 'utf8');
  console.log('manifest 已生成：' + files.length + ' 个文件');
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const missing = manifest.files.filter(f => !existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error('manifest 里有不存在的文件：\n  ' + missing.join('\n  '));
  process.exit(1);
}

const parts = [
  '/* bundle.js —— 由 _scripts/build-js-bundle.mjs 从 _scripts/js-bundle.manifest.json 生成。',
  ' * 不要手改这个文件：改源码后重新跑 `node _scripts/build-js-bundle.mjs`。',
  ' * 打包原因见脚本头注释（首屏 69 个请求 → 1 个）。',
  ' */',
  '',
];
for (const rel of manifest.files) {
  const body = readFileSync(path.join(ROOT, rel), 'utf8');
  parts.push('/* ==== ' + rel + ' ==== */');
  parts.push(body.replace(/\s+$/, ''));
  parts.push(';');   // 分隔：避免上一文件末尾无分号时与下一文件粘连
  parts.push('');
}
const out = parts.join('\n');

if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== out) {
    console.error('js/bundle.js 已过期：请运行 node _scripts/build-js-bundle.mjs');
    process.exit(1);
  }
  console.log('bundle 是最新的（' + manifest.files.length + ' 个文件）');
  process.exit(0);
}

writeFileSync(OUT, out, 'utf8');
const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log('已生成 js/bundle.js：' + manifest.files.length + ' 个文件 → ' + kb(statSync(OUT).size));
