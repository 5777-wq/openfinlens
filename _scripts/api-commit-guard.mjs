#!/usr/bin/env node
/* api-commit-guard.mjs —— 采集流水线里的「语义无变化就不提交」守卫
 *
 * 为什么需要它：api/v1/** 是每次构建都会重写的产物，其中 meta.generatedAt / durationMs
 * 这类字段**每轮都变**。若照单全提交，行情快没变化的日子也会每小时产出 1.6MB 提交，
 * 仓库与 Pages 构建都会被这些"噪声提交"拖垮。
 *
 * 做法：把 HEAD 版本与工作区版本都解析成 JSON，递归剔除易变字段后深比较；
 *   语义一致 → git checkout 回 HEAD 版本（于是 git add 拿不到差异，不产生提交）；
 *   语义不同 → 保留工作区版本（真实数据变化，照常提交）。
 *
 * 用法：node _scripts/api-commit-guard.mjs [--dry]
 * 退出码恒 0（这是卫生步骤，不该让采集流水线变红）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/* 易变字段：只影响"这一次构建是什么时候跑的"，不影响数据本身 */
const VOLATILE = new Set([
  'generatedAt', 'durationMs', 'ms', 'lastBuilt', 'asof', 'updatedAt', 'checkedAt',
  'builtAt', 'elapsedMs', 'took',
]);

function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node).sort()) {
      if (VOLATILE.has(k)) continue;
      out[k] = strip(node[k]);
    }
    return out;
  }
  return node;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

let files;
try {
  files = git(['ls-files', 'api']).split('\n').filter(f => f.endsWith('.json'));
} catch (e) {
  console.error('[api-guard] 读不到 git 文件列表（不是 git 仓库？）→ 跳过');
  process.exit(0);
}

let same = 0, changed = 0, missing = 0, broken = 0;
const changedList = [];

for (const rel of files) {
  let headRaw;
  try {
    headRaw = git(['show', 'HEAD:' + rel]);
  } catch {
    missing++;            // HEAD 里还没有这个文件（首次构建）→ 必须提交
    continue;
  }
  let cur;
  try {
    cur = readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue;             // 工作区没有（构建没产出）→ 不处理
  }
  if (cur === headRaw) { same++; continue; }

  let equal = false;
  try {
    equal = JSON.stringify(strip(JSON.parse(cur))) === JSON.stringify(strip(JSON.parse(headRaw)));
  } catch {
    broken++;             // 解析失败：保守起见保留工作区版本，交给测试去红
    changedList.push(rel + '（解析失败）');
    continue;
  }

  if (equal) {
    same++;
    if (!DRY) git(['checkout', '--', rel]);
  } else {
    changed++;
    changedList.push(rel);
  }
}

console.log(`[api-guard] 语义未变 ${same} 个（已还原，不提交）｜有真实变化 ${changed} 个｜新文件 ${missing} 个｜坏文件 ${broken} 个`);
if (changedList.length) console.log('[api-guard] 有变化的文件：' + changedList.slice(0, 12).join(', ') + (changedList.length > 12 ? ` …共 ${changedList.length} 个` : ''));
if (DRY) console.log('[api-guard] --dry：只报告，不还原');
