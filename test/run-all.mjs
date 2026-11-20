#!/usr/bin/env node
/* run-all.mjs —— 全仓统一离线测试总入口（Phase 5 收口）
 *
 * 一键跑全部三套件：
 *   主仓 + core/ + Meridian   →  _test/run-all.mjs --offline（53 组离线 47）
 *   白话金融 Academy          →  apps/academy/_test/run-all.mjs（引擎/DOM 渲染/无障碍/基建，6088+ 断言）
 *
 * 用法：node test/run-all.mjs            # 全离线（CI 口径）
 *       node test/run-all.mjs --net      # 附带实网组（本地/手动）
 * 退出码：任一套件失败 → 1。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const offline = !process.argv.includes('--net');

const suites = [
  { name: '主仓 + core/ + Meridian（53 组）', cmd: path.join(ROOT, '_test', 'run-all.mjs'), args: offline ? ['--offline'] : [] },
  { name: '白话金融 Academy（引擎/契约/渲染/无障碍/基建）', cmd: path.join(ROOT, 'apps', 'academy', '_test', 'run-all.mjs'), args: [] },
];

let failed = 0;
for (const s of suites) {
  console.log(`\n===== ${s.name} =====`);
  const r = spawnSync(process.execPath, [s.cmd, ...s.args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n${'═'.repeat(50)}`);
console.log(failed === 0 ? '✓ 全部套件通过' : `✗ ${failed} 个套件失败`);
process.exit(failed ? 1 : 0);
