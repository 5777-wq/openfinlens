/* index.mjs —— core/registry 静态注册表加载器（Node 侧）
 * 注册表是"唯一静态真源"：产业链（10 链·49 环节·177 股）、SP500/NDX/SPMO 候选池、
 * series-map。浏览器不 import 本模块（node:fs 不可用），前端按 HTTP 取同目录 JSON。
 * 一致性由 _test/core-registry.test.mjs 守住：core JSON 必须 === 旧路径数据的语义内容，
 * 防止双份漂移（Phase 4 切换后旧路径退役）。 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

function readJson(name) {
  return JSON.parse(readFileSync(path.join(DIR, name), 'utf8'));
}

/* 产业链唯一真源：10 条链 · 49 环节 · 177 只去重成分股
 * （2026-11-19 Phase 0 审计：openfinlens js/data/industry-chains.js 与
 *   openfin-academy vendor/core/industry-chains.js md5 一致，以此抽取为 JSON） */
export function loadChains() {
  return readJson('industry-chains.json');
}

/* 候选池：sp500 / ndx / spmo（移植自 Meridian data/ 快照） */
export function loadCandidates(kind) {
  const map = {
    sp500: 'sp500-candidates.json',
    ndx: 'ndx-candidates.json',
    spmo: 'spmo-holdings.json',
  };
  const file = map[kind];
  if (!file) throw new Error('未知候选池类型：' + kind + '（可选 sp500/ndx/spmo）');
  return readJson(file);
}

/* series-map（当前快照来自 openfin-academy data/ 编译产物，Phase 4 随内容管线归位） */
export function loadSeriesMap() {
  return readJson('series-map.json');
}

/* 成分股去重计数（audit 口径：按 symbol 去重） */
export function chainStockSymbols(chains) {
  const syms = new Set();
  for (const c of chains || []) {
    for (const l of (c.links || [])) {
      for (const s of (l.stocks || [])) syms.add(s.symbol);
    }
  }
  return syms;
}
