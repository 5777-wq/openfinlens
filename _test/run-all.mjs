#!/usr/bin/env node
/* run-all.mjs —— 一键跑全部测试组（纯 Node，无需依赖）
   用法：node _test/run-all.mjs            全部（含实网组）
         node _test/run-all.mjs --offline  只跑不依赖网络的组（logic/insight/breadth）
   退出码：全部通过 0；任一组失败 1。 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const offlineOnly = process.argv.includes('--offline');

const groups = [
  { file: 'tokens.test.mjs', net: false },  // 设计令牌一致性/均线色距/发布卫生（读真实源文件）
  { file: 'logic.test.mjs', net: false },
  { file: 'compare.test.mjs', net: false },  // 基金对比纯计算：归一/年化/回撤/年度收益/相关性（手算核对）
  { file: 'compareview.test.mjs', net: false }, // 基金对比视图层：深链解析/渲染/重试通道（DOM 打桩，无浏览器）
  { file: 'spark.test.mjs', net: false },   // 首屏图形层：振幅条位置/走势线坐标（纯函数，画歪了才算错）
  { file: 'insight.test.mjs', net: false },
  { file: 'evolve.test.mjs', net: false },  // 市场时段/情绪历史/请求去重（纯函数）
  { file: 'technical.test.mjs', net: false }, // 技术面指标手算核对（纯函数）
  { file: 'events.test.mjs', net: false },  // 事件数据模型/聚类/时间语义/Bus（纯函数）
  { file: 'worldmap.test.mjs', net: false }, // 平面地图几何：跨180°unwrap/缩放聚类阈值（纯函数）
  { file: 'engine.test.mjs', net: false },  // 语义引擎：新闻标准化/去重/分类/聚类/AI闸门/影响边
  { file: 'actors.test.mjs', net: false },  // Actor/Activity 模型（席位聚合/合并/口径）
  { file: 'seeds.test.mjs', net: false },   // 采集产物体检（全球事件/伯克希尔13F 种子 JSON）
  { file: 'breadth.test.mjs', net: true },  // 结构断言为主，但取数需联网
  { file: 'detail.test.mjs', net: true },
  { file: 'degrade.test.mjs', net: true },
  { file: 'boards.test.mjs', net: true },   // 今日热门概念：榜单/成分股接口 + 链条匹配
  { file: 'live.test.mjs', net: true },
  { file: 'history.test.mjs', net: true },  // 基金对比长历史源：5000 根深度/CORS/复权口径/预设代码
];

let failed = 0;
for (const g of groups) {
  if (offlineOnly && g.net) { console.log(`-- 跳过 ${g.file}（--offline 模式，需联网）`); continue; }
  console.log(`\n===== ${g.file} =====`);
  const r = spawnSync(process.execPath, [path.join(dir, g.file)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`✗ ${g.file} 失败（exit ${r.status}）`); }
}

console.log('\n===== 汇总 =====');
if (failed) { console.log(`✗ ${failed} 组未通过`); process.exit(1); }
console.log('✓ 全部测试组通过');
