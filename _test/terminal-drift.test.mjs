/* terminal-drift.test.mjs —— 过渡期双树漂移钉子（monorepo Phase 4）
 * 根目录旧前端（index.html/js/css/assets/manifest）与 apps/terminal 迁入副本必须
 * 逐字节一致——serve.mjs 与 deploy-pages 已切 apps/terminal 为站点根，根副本只是
 * 测试基座与过渡回退。Phase 5 收口删除根前端时，本测试随之删除。
 * 用法：node _test/terminal-drift.test.mjs（纯离线） */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname + '/..';
const A = ROOT;                                    // 根树（旧前端）
const B = path.join(ROOT, 'apps', 'terminal');     // 新树（站点真身）
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  ← ' + String(extra).slice(0, 200) : '')); }
}

function walk(rel) {
  const absA = path.join(A, rel);
  const out = [];
  if (!existsSync(absA) || !statSync(absA).isDirectory()) return out;
  for (const e of readdirSync(absA, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(r));
    else out.push(r);
  }
  return out;
}

const TREES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets'];
let rootFiles = TREES.flatMap(walk);
ok(rootFiles.length > 100, '根树前端文件齐备（' + rootFiles.length + ' 个）');

for (const rel of rootFiles) {
  const a = readFileSync(path.join(A, rel));
  const bPath = path.join(B, rel);
  if (!existsSync(bPath)) { ok(false, 'apps/terminal 缺 ' + rel); continue; }
  const b = readFileSync(bPath);
  ok(a.equals(b), rel + ' 两树逐字节一致');
}
// 新树独有文件（如新增模块先落 apps/terminal）：反向也钉住，防单边修改
for (const rel of walk('js').concat(walk('css'))) {
  if (!existsSync(path.join(A, rel))) ok(false, '根树缺 apps/terminal 侧文件 ' + rel + '（镜像缺失）');
}

console.log(`\n通过 ${pass} · 失败 ${fail}${fail ? '  ✗✗✗' : '  ✓✓✓'}`);
process.exit(fail ? 1 : 0);
