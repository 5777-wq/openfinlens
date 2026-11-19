#!/usr/bin/env node
/* repoint-frontend-tests.mjs —— Phase 5：把读前端文件的测试 ROOT 切到 apps/terminal
 *
 * 背景：Phase 4 过渡期根树保留旧前端（terminal-drift 钉住双树一致）；Phase 5 删除根
 * 前端后，读 js/css/index.html 的测试必须改指 apps/terminal（站点真身）。
 *
 * 策略（Phase 5 裁定）：
 *   · 整树 repoint 仅适用于「只读前端」的测试（显式清单，人工核对过）；
 *   · 三个 MIXED（degrade/gloss-tip/pmview：既读 js 又读 data/api）不在本脚本——
 *     由逐文件手术加第二基座常量，避免误伤其 data/api 读取；
 *   · core- 前缀与 meridian- 前缀的测试自带正确路径，跳过；
 *   · 替换只动两类已核实的模式：
 *       import.meta.dirname + '/..'            → + '/../apps/terminal'
 *       path.dirname(fileURLToPath(...)), '..') → ..., '..', 'apps', 'terminal')
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS = path.join(HERE, '..', '_test');

/* 只读前端的测试（人工核对：无 data/api/us-signals 读取；skip 的见头注） */
const FILES = [
  'actors.test.mjs', 'auniverse.test.mjs', 'boards.test.mjs', 'breadth.test.mjs',
  'bundle.test.mjs', 'charts.test.mjs', 'compare.test.mjs', 'compareview.test.mjs',
  'detail.test.mjs', 'engine.test.mjs', 'events.test.mjs', 'evolve.test.mjs',
  'fundparse.test.mjs', 'fundquiz.test.mjs', 'gloss-gate.test.mjs', 'gloss-tip.test.mjs',
  'insight.test.mjs', 'live.test.mjs', 'logic.test.mjs', 'macrocalc.test.mjs',
  'marketscope.test.mjs', 'minify.test.mjs', 'navmap.test.mjs', 'option.test.mjs',
  'panes.test.mjs', 'paneview.test.mjs', 'pmcharts.test.mjs', 'pmshare.test.mjs',
  'pmview.test.mjs', 'polymarket.test.mjs', 'qr.test.mjs', 'seeds.test.mjs',
  'spark.test.mjs', 'tabscope.test.mjs', 'technical.test.mjs', 'tokens.test.mjs',
  'treemap.test.mjs', 'us-indexes.test.mjs', 'utils.test.mjs', 'worldmap.test.mjs',
  'zones.test.mjs', 'history.test.mjs',
];
/* seeds/api/degrade/gloss-tip/pmview 及 meridian、core 前缀的测试不在此列（数据基座或自带路径） */

let changed = 0;
for (const f of FILES) {
  const p = path.join(TESTS, f);
  let s = readFileSync(p, 'utf8');
  const before = s;
  s = s.split("import.meta.dirname + '/..'").join("import.meta.dirname + '/../apps/terminal'");
  s = s.split("path.resolve(import.meta.dirname, '..')").join("path.resolve(import.meta.dirname, '..', 'apps', 'terminal')");
  s = s.split("path.dirname(fileURLToPath(import.meta.url)), '..')").join("path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'terminal')");
  s = s.split("path.dirname(fileURLToPath(import.meta.url)), '..')").join("path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'terminal')");
  if (s !== before) {
    writeFileSync(p, s);
    changed++;
    console.log('repoint: ' + f);
  }
}
console.log('共 ' + changed + ' 个测试文件已切 apps/terminal 基座');
