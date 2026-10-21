#!/usr/bin/env node
/* run-all.mjs —— 一键跑全部测试组（纯 Node，无需依赖）
   用法：node _test/run-all.mjs            全部（含实网组）
         node _test/run-all.mjs --offline  只跑不依赖网络的组
   退出码：全部通过 0；任一组失败 1。
   组数与"离线/实网"划分以本文件的 groups 数组为准——下方会打印实际执行的组数，
   CI 注释里不要写死数字（写死必过期）。 */

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
  { file: 'macrocalc.test.mjs', net: false },  // 宏观策略纯计算：曲线装配/利差bp换算/倒挂判定/金油比
  { file: 'portfoliomath.test.mjs', net: false }, // 持仓估值/多币种折算/快照合并（手算核对）
  { file: 'fundparse.test.mjs', net: false },  // 基金画像解析：pingzhongdata 值归一 + jjcc 重仓股表格
  { file: 'fundquiz.test.mjs', net: false },   // 投资风格测评：评分单调性 + 风险闸门（硬规则）+ 合规回归
  { file: 'qr.test.mjs', net: false },         // 二维码编码器：标准表核对 + RS 剩余式 + 编码→解码往返
  { file: 'zones.test.mjs', net: false },      // 二级分区判定：可用分区/导航条阈值/回落/自锁防护
  { file: 'marketscope.test.mjs', net: false }, // 市场维度归属：市场只由一级 tab 表达/切换器与标签互斥
  { file: 'gloss-tip.test.mjs', net: false }, // 悬停「这是什么」：科普站链接映射的诚实性（假入口防护）
  { file: 'tabscope.test.mjs', net: false },   // 顶栏板块：顺序/显隐自定义 +「全部」固定首位 + 非法配置清理
  { file: 'panes.test.mjs', net: false },      // 副图指标计算：RSI/MACD 序列 + 口径与 technical.js 一致
  { file: 'paneview.test.mjs', net: false },   // 副图指标窗几何：坐标/断线/刻度/与主图横向对齐
  { file: 'treemap.test.mjs', net: false },    // 热力图色带：区间边界归属/连续无缝/取色
  { file: 'pmshare.test.mjs', net: false },    // 分享卡片：源码级合规回归（不外泄上游标识）+ 零网络请求
  { file: 'spark.test.mjs', net: false },   // 首屏图形层：振幅条位置/走势线坐标（纯函数，画歪了才算错）
  { file: 'insight.test.mjs', net: false },
  { file: 'evolve.test.mjs', net: false },  // 市场时段/情绪历史/请求去重（纯函数）
  { file: 'technical.test.mjs', net: false }, // 技术面指标手算核对（纯函数）
  { file: 'events.test.mjs', net: false },  // 事件数据模型/聚类/时间语义/Bus（纯函数）
  { file: 'auniverse.test.mjs', net: false }, // 全市场行分类：指数 vs 个股（漏判与误判都要钉死）
  { file: 'polymarket.test.mjs', net: false }, // 预测市场概率模型：标题闸门/互斥判定/档位聚合/清洗/历史网格（纯函数）
  { file: 'pmcharts.test.mjs', net: false },   // 市场预测图形层：环图扇区角度/走势坐标（纯函数，画歪了才算错）
  { file: 'pmview.test.mjs', net: false },     // 市场预测视图层：事件卡 HTML 结构/走势图跟选中的档位（纯渲染映射）
  { file: 'worldmap.test.mjs', net: false }, // 平面地图几何：跨180°unwrap/缩放聚类阈值（纯函数）
  { file: 'engine.test.mjs', net: false },  // 语义引擎：新闻标准化/去重/分类/聚类/AI闸门/影响边
  { file: 'actors.test.mjs', net: false },  // Actor/Activity 模型（席位聚合/合并/口径）
  { file: 'seeds.test.mjs', net: false },   // 采集产物体检（全球事件/伯克希尔13F 种子 JSON）
  { file: 'breadth.test.mjs', net: true },  // 结构断言为主，但取数需联网
  { file: 'detail.test.mjs', net: true },
  // 降级链拆两组：离线组（静态 JSON 源 + 缓存 + 诚实空态，零外网）进 CI；
  // 实网组打真实第三方接口，只在本地/手动跑。同一个文件用 --net 切换。
  { file: 'degrade.test.mjs', net: false },
  { file: 'degrade.test.mjs', net: true, args: ['--net'] },
  { file: 'boards.test.mjs', net: true },   // 今日热门概念：榜单/成分股接口 + 链条匹配
  { file: 'live.test.mjs', net: true },
  { file: 'history.test.mjs', net: true },  // 基金对比长历史源：5000 根深度/CORS/复权口径/预设代码
];

let failed = 0;
let ran = 0, skipped = 0;
for (const g of groups) {
  if (offlineOnly && g.net) { console.log(`-- 跳过 ${g.file}（--offline 模式，需联网）`); skipped++; continue; }
  console.log(`\n===== ${g.file}${g.args && g.args.length ? ' ' + g.args.join(' ') : ''} =====`);
  ran++;
  const r = spawnSync(process.execPath, [path.join(dir, g.file), ...(g.args || [])], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`✗ ${g.file} 失败（exit ${r.status}）`); }
}

console.log('\n===== 汇总 =====');
console.log(`共 ${groups.length} 组（离线 ${groups.filter(g => !g.net).length} / 实网 ${groups.filter(g => g.net).length}），本次执行 ${ran} 组、跳过 ${skipped} 组`);
if (failed) { console.log(`✗ ${failed} 组未通过`); process.exit(1); }
console.log('✓ 全部测试组通过');
