#!/usr/bin/env node
/* api-commit-guard.mjs —— 采集流水线里的「语义无变化就不提交」守卫
 *
 * 为什么需要它：api/v1/** 是每次构建都会重写的产物，其中 meta.generatedAt / durationMs
 * 这类字段**每轮都变**。若照单全提交，行情快没变化的日子也会产出 1.6MB 提交，
 * 仓库与 Pages 构建都会被这些"噪声提交"拖垮。
 *
 * 做法：把「基准版本」与工作区版本都解析成 JSON，递归剔除易变字段后深比较；
 *   语义一致 → 把工作区文件还原成基准版本（产物树与基点一致，data 分支不产生提交）；
 *   语义不同 → 保留工作区版本（真实数据变化，照常提交）。
 *
 * 基准版本从哪来（2026-11-19 monorepo 分支解耦，Gemini 审查裁定必改）：
 *   环境变量 OFL_API_BASE_REF 指向的 tree-ish。collect.yml 在 data 分支存在时设为
 *   FETCH_HEAD（data 基点）；未设置时回退 HEAD。为什么不能永远对照 HEAD：切仓后
 *   main 的 api/ 永久冻结，data 分支一旦偏离切仓日，守卫若继续对照 main HEAD，
 *   「语义无变化」判定就会失效——每轮都被判"有变化"，噪声提交回来了。
 *   还原目标也是基准版本本身（git checkout <BASE> -- rel）：只有工作区文件与基点
 *   逐字节一致，commit-tree 产物树才会与基点树相同，no-change 判定才成立。
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
const BASE = process.env.OFL_API_BASE_REF || 'HEAD';

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
  let baseRaw;
  try {
    baseRaw = git(['show', BASE + ':' + rel]);
  } catch {
    missing++;            // 基准里还没有这个文件（首次构建）→ 必须提交
    continue;
  }
  let cur;
  try {
    cur = readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue;             // 工作区没有（构建没产出）→ 不处理
  }
  if (cur === baseRaw) { same++; continue; }

  let equal = false;
  try {
    equal = JSON.stringify(strip(JSON.parse(cur))) === JSON.stringify(strip(JSON.parse(baseRaw)));
  } catch {
    broken++;             // 解析失败：保守起见保留工作区版本，交给测试去红
    changedList.push(rel + '（解析失败）');
    continue;
  }

  if (equal) {
    same++;
    if (!DRY) {
      // 还原到「基准版本」而不是 HEAD：基点是 FETCH_HEAD 时，工作区必须与 data 基点
      // 逐字节一致，commit-tree 的产物树才会与基点树相同（no-change 判定才成立）。
      git(['checkout', BASE, '--', rel]);
    }
  } else {
    changed++;
    changedList.push(rel);
  }
}

console.log(`[api-guard] 基准=${BASE}｜语义未变 ${same} 个（已还原，不提交）｜有真实变化 ${changed} 个｜新文件 ${missing} 个｜坏文件 ${broken} 个`);
if (changedList.length) console.log('[api-guard] 有变化的文件：' + changedList.slice(0, 12).join(', ') + (changedList.length > 12 ? ` …共 ${changedList.length} 个` : ''));
if (DRY) console.log('[api-guard] --dry：只报告，不还原');
