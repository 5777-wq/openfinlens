#!/usr/bin/env node
/* export-asset-ids.mjs —— 导出「哪些终端标的在本站真的有页」
   产物 content/_meta/asset-ids.json（build-content 会一起拷到 data/content/）。

   为什么需要这份清单：
   行情终端把每个标的都链到本站的 #/assets/<symbol>，但本站只给**采到了月线序列**
   的标的做了数据卡。没采到的那几只，点过去是一个「月线序列还没采到」的半空页——
   终端的文案却写着「在白话金融里看这一页 ↗」，承诺了有一页，实际没有数据。
   这就是「假入口」。

   终端据此判断：某个 symbol 在这份清单里，才给标的页；不在，就给术语页或搜索页。
   （终端那份清单由 collect-academy-terms.mjs 从线上本站拉，6h 自动刷新。）

   口径与页面完全一致：直接加载 js/views/assets.js 里那张 SERIES_OF 表 + vendor
   同步过来的终端 universe + data/series-map.json，三者对得上才算「有页」。
   故意不手抄第二份映射——手抄的那份迟早会和代码里的对不上。 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 加载浏览器端那份 assets.js，取出它真正在用的 SERIES_OF */
async function seriesOf() {
  // 浏览器里 window === globalThis，沙箱必须照做，
  // 否则模块里的 window.AssetsView 挂到嵌套对象上，取不到。
  const ctx = vm.createContext({
    console, Math, JSON, Date, encodeURIComponent, decodeURIComponent,
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.Fmt = { esc: (s) => String(s == null ? '' : s) };
  vm.runInContext(await readFile(path.join(ROOT, 'js/views/assets.js'), 'utf8'), ctx, { filename: 'assets.js' });
  return (ctx.AssetsView && ctx.AssetsView.SERIES_OF) || {};
}

/** 终端的标的清单（vendor/core/universe.js，从 OpenFinLens 同步而来）
    三处都要：TENCENT_UNIVERSE（A股/港股/美股）、EM_UNIVERSE（商品/外汇/利率）、
    GLOBAL_INDEX（顶栏那一排全球指数——它不是 universe 的一员，但终端点得到） */
async function universe() {
  const p = path.join(ROOT, 'vendor/core/universe.js');
  const ctx = vm.createContext({ console, Math, JSON, Date });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(await readFile(p, 'utf8'), ctx, { filename: 'universe.js' });
  const base = [...(ctx.TENCENT_UNIVERSE || []), ...(ctx.EM_UNIVERSE || [])];
  const gi = (ctx.GLOBAL_INDEX || []).map((x) => ({
    symbol: x.symbol, label: x.name, group: 'index', tab: 'all',
  }));
  return base.concat(gi);
}

export async function buildAssetIds() {
  const [of, uni] = await Promise.all([seriesOf(), universe()]);
  const map = JSON.parse(await readFile(path.join(ROOT, 'data/series-map.json'), 'utf8'));
  const series = map.series || map;
  const have = new Set(series.map((s) => s.id || s.key));

  const symbols = [];
  const detail = {};
  const labels = [];
  for (const u of uni) {
    const sid = of[u.symbol] || u.symbol;
    if (!have.has(sid)) continue;
    symbols.push(u.symbol);
    labels.push(u.label);
    detail[u.symbol] = { series: sid, label: u.label };
  }
  symbols.sort();

  // 「科普站真能搜到的词」：词条名 + 标的页的标题。
  // 终端据此决定要不要给「去科普站里搜这个词」的入口——
  // 给一个搜不到词的搜索链接，就是给用户一条必然扑空的路。
  const g = JSON.parse(await readFile(path.join(ROOT, 'content', '_meta', 'glossary.json'), 'utf8'));
  const terms = g.terms || {};
  const searchable = [...new Set([
    ...Object.keys(terms).map((id) => terms[id].term).filter(Boolean),
    ...Object.keys(terms).map((id) => terms[id].alias).filter(Boolean),
    ...labels,
  ])].sort();

  return {
    // 用序列表的生成日，不用今天——产物必须可复现，
    // 否则 CI 的「data/content 与 content/ 同步」校验每天都会误报。
    generatedAt: map.generatedAt || '',
    note: '这些终端标的在「白话金融」有对应的标的页（#/assets/<symbol>，带真实月线数据卡）。'
      + '不在表里的标的，终端只给术语页或搜索页——不给半空页。',
    count: symbols.length,
    symbols,
    detail,
    searchable,
  };
}

async function main() {
  const m = await buildAssetIds();
  const out = path.join(ROOT, 'content', '_meta', 'asset-ids.json');
  await writeFile(out, JSON.stringify(m, null, 2) + '\n', 'utf8');
  console.log(`[asset-ids] ${m.count} 个终端标的在本站有标的页 → ${path.relative(ROOT, out)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[asset-ids] 失败：', e.message); process.exit(1); });
}
