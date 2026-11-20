#!/usr/bin/env node
/* build-legacy.mjs —— Legacy 双树构建期单源生成（Wave 3 切片 B）
 *
 * 背景：apps/academy/js/legacy/ 下的五个 IIFE 兼容模块与终端同名文件是同一份代码的
 * 两个副本。此前靠人肉同步，两边迟早漂移（历史上真的漂过：主仓为此专门写过
 * terminal-drift.test.mjs，后来该文件删除，契约收口到 apps/academy/_test/run-all.mjs）。
 * 现在改为构建期单源：终端侧文件是唯一真源，本脚本把真源**逐字节拷贝**到 legacy 树。
 *
 * 真源 → 副本映射（副本文件名允许与真源路径解耦，历史原因 universe/explain/
 * industry-chains/academy-gloss 在终端侧挂在 js/data/ 下，legacy 树是平铺的）：
 *   apps/terminal/js/utils.js                 → apps/academy/js/legacy/utils.js
 *   apps/terminal/js/data/universe.js         → apps/academy/js/legacy/universe.js
 *   apps/terminal/js/data/explain.js          → apps/academy/js/legacy/explain.js
 *   apps/terminal/js/data/industry-chains.js  → apps/academy/js/legacy/industry-chains.js
 *   apps/terminal/js/data/academy-gloss.js    → apps/academy/js/legacy/academy-gloss.js
 *
 * 用法：
 *   node _scripts/build-legacy.mjs            写模式：拷贝覆盖副本，打印每份的同步/漂移结果
 *   node _scripts/build-legacy.mjs --check    校验模式：逐字节比对，任一漂移 exit 1
 *                                             （改了终端侧文件忘跑写模式时，让 CI 红在这里）
 *
 * 约定：
 *   · 逐字节（Buffer.equals）比较与拷贝，不做 EOL 归一——单源生成不允许“看起来一样”；
 *   · 零第三方依赖，纯 node:fs；
 *   · apps/academy/js/legacy/ 是生成物，不要手改——改终端侧真源后跑一次写模式。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAP = {
  'apps/terminal/js/utils.js': 'apps/academy/js/legacy/utils.js',
  'apps/terminal/js/data/universe.js': 'apps/academy/js/legacy/universe.js',
  'apps/terminal/js/data/explain.js': 'apps/academy/js/legacy/explain.js',
  'apps/terminal/js/data/industry-chains.js': 'apps/academy/js/legacy/industry-chains.js',
  'apps/terminal/js/data/academy-gloss.js': 'apps/academy/js/legacy/academy-gloss.js',
};

const check = process.argv.includes('--check');

let drift = 0;
let synced = 0;

for (const [src, dst] of Object.entries(MAP)) {
  const srcPath = path.join(ROOT, src);
  const dstPath = path.join(ROOT, dst);

  let srcBuf = null;
  try {
    srcBuf = readFileSync(srcPath);
  } catch (e) {
    drift++;
    console.error('✗ 真源读不到：' + src + '（' + e.code + '）');
    continue;
  }

  let dstBuf = null;
  try { dstBuf = readFileSync(dstPath); } catch (e) { /* 副本缺失按漂移处理 */ }

  if (dstBuf && srcBuf.equals(dstBuf)) {
    synced++;
    console.log('＝ ' + dst + '（与真源一致）');
    continue;
  }

  if (check) {
    drift++;
    const firstDiff = dstBuf
      ? (() => {
          const n = Math.min(srcBuf.length, dstBuf.length);
          for (let i = 0; i < n; i++) if (srcBuf[i] !== dstBuf[i]) return i;
          return n;   // 前缀一致但长度不同
        })()
      : null;
    const detail = dstBuf
      ? '首个差异字节 @ ' + firstDiff + '（真源 ' + srcBuf.length + 'B / 副本 ' + dstBuf.length + 'B）'
      : '副本缺失';
    console.error('✗ ' + dst + ' 漂移：' + detail + ' → 跑 node _scripts/build-legacy.mjs 重新生成');
    continue;
  }

  // 写模式：拷贝覆盖（副本目录历史上已存在，mkdirSync 兜底防目录被整删）
  mkdirSync(path.dirname(dstPath), { recursive: true });
  writeFileSync(dstPath, srcBuf);
  synced++;
  console.log('↻ ' + dst + ' ← ' + src + '（已按真源覆盖' + (dstBuf ? '，此前漂移' : '，此前缺失') + '）');
}

const total = Object.keys(MAP).length;
if (check) {
  console.log('\n校验 ' + total + ' 份：一致 ' + synced + ' / 漂移 ' + drift);
  if (drift) process.exit(1);
  console.log('✓ legacy 双树与终端真源逐字节一致');
} else {
  console.log('\n已同步 ' + total + ' 份（一致 ' + synced + ' / 覆盖 ' + (total - synced) + '）');
}
