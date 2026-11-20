#!/usr/bin/env node
/* audit.mjs —— 站内一致性审计（词条 / 分类 / 跨站）
   用法：node _scripts/audit.mjs [--src <OpenFinLens 目录>]

   查五类错位（这些**都不会报错**，页面照常渲染，只是内容对不上）：
     A. 词条的 sym 指向终端里不存在的 symbol → 「去看历史数据」点了没反应
     B. 词条的 links 指向不存在的术语 / 未知路由 → 延伸阅读点了扑空
     C. 终端 universe 里的标的，本站没有对应的一页 → 终端给不了精确解释
     D. 词条的 cat 不在十个分类里 / 分类为空 → 速查表和索引会把它漏掉
     E. 同一分类里，一条都没有的分类 → 分类导航会开天窗

   另外打印分类分布，供人工审一眼归类合不合理（这一步机器替不了）。 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = (() => {
  const i = process.argv.indexOf('--src');
  return (i > -1 && process.argv[i + 1]) ? path.resolve(process.argv[i + 1]) : null;
})();

const CATS = ['data', 'fund', 'asset', 'option', 'macro', 'basic', 'micro', 'player', 'risk', 'tech'];
const problems = [];
const note = (area, msg) => problems.push({ area, msg });

async function readJSON(p) { return JSON.parse(await readFile(p, 'utf8')); }

async function vmLoad(file, extra) {
  const ctx = vm.createContext(Object.assign({ console, Math, JSON, Date, encodeURIComponent, decodeURIComponent }, extra || {}));
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(await readFile(file, 'utf8'), ctx, { filename: path.basename(file) });
  return ctx;
}

async function main() {
  const glossary = await readJSON(path.join(ROOT, 'content/_meta/glossary.json'));
  const terms = glossary.terms || {};
  const assetIds = await readJSON(path.join(ROOT, 'content/_meta/asset-ids.json'));

  /* ---- D / E. 分类 ---- */
  const byCat = {};
  for (const [id, t] of Object.entries(terms)) {
    if (!t.cat) { note('D', `${id}（${t.term}）没有 cat`); continue; }
    if (!CATS.includes(t.cat)) note('D', `${id}（${t.term}）的 cat="${t.cat}" 不在十个分类里`);
    (byCat[t.cat] = byCat[t.cat] || []).push(id);
  }
  for (const c of CATS) {
    if (!byCat[c] || !byCat[c].length) note('E', `分类 ${c} 一条词都没有 → 速查表和索引会开天窗`);
  }

  /* ---- B. links ---- */
  const ROUTES = ['concepts', 'crisis', 'assets', 'chains', 'cycles', 'family', 'path', 'terms', 'data', 'term', 'search'];
  for (const [id, t] of Object.entries(terms)) {
    for (const l of (t.links || [])) {
      const href = String(l.href || '');
      if (href.startsWith('#/term/')) {
        const tid = decodeURIComponent(href.slice('#/term/'.length).split('?')[0]);
        if (!terms[tid]) note('B', `${id} 的延伸阅读「${l.text}」指向不存在的术语 ${tid}`);
      } else if (href.startsWith('#/')) {
        const seg = href.slice(2).split('?')[0].split('/')[0];
        if (!ROUTES.includes(seg)) note('B', `${id} 的延伸阅读「${l.text}」指向未知路由 ${href}`);
      }
    }
  }

  /* ---- 跨站 ---- */
  if (srcDir && existsSync(path.join(srcDir, 'js/data/universe.js'))) {
    const ctx = await vmLoad(path.join(srcDir, 'js/data/universe.js'));
    // 终端的 symbol 有三处：universe（A股/港股/美股）、EM（商品/外汇/利率）、
    // GLOBAL_INDEX（顶栏那一排全球指数）——第三处最容易被漏掉。
    const uni = [...(ctx.TENCENT_UNIVERSE || []), ...(ctx.EM_UNIVERSE || [])]
      .concat((ctx.GLOBAL_INDEX || []).map((x) => ({ symbol: x.symbol, label: x.name })));
    const uniSyms = new Set(uni.map((x) => x.symbol));

    // A. 词条的 sym 是**终端**的 symbol，要对终端的清单校验，不是对站内序列
    for (const [id, t] of Object.entries(terms)) {
      if (!t.sym) continue;
      if (!uniSyms.has(t.sym)) note('A', `${id}（${t.term}）的 sym="${t.sym}" 不在行情终端的标的清单里 → 「去看历史数据」会扑空`);
    }

    // C. 终端每一只，本站要么有标的页，要么终端映射到别的词条——
    //    两者都没有就是「终端能给、本站没有」，那是该补内容或补映射的信号。
    const gloss = await vmLoad(path.join(srcDir, 'js/data/academy-gloss.js'));
    const AG = gloss.AcademyGloss;
    const has = new Set(assetIds.symbols || []);
    for (const u of uni) {
      const mapped = AG.TERM_BY_SYMBOL[u.symbol]
        || (AG.CONCEPT_BY_SYMBOL[u.symbol] && AG.CONCEPT_BY_SYMBOL[u.symbol].id);
      if (!has.has(u.symbol) && !mapped) {
        note('C', `终端有 ${u.symbol}（${u.label}），本站既没有它的标的页、终端也没映射到词条`);
      }
    }
  } else {
    console.log('[audit] 没给 --src，跳过跨站对账（A/C）');
  }

  /* ---- 输出 ---- */
  console.log(`\n词条 ${Object.keys(terms).length} 条 · 分类 ${Object.keys(byCat).length} 个`);
  console.log('分类分布：');
  CATS.forEach((c) => console.log(`  ${c.padEnd(7)} ${String((byCat[c] || []).length).padStart(3)} 条`));

  if (!problems.length) { console.log('\n✓ 没查出问题'); return; }
  const grouped = {};
  for (const p of problems) (grouped[p.area] = grouped[p.area] || []).push(p.msg);
  for (const [area, list] of Object.entries(grouped)) {
    console.log(`\n【${area}】${list.length} 处`);
    list.forEach((m) => console.log('  · ' + m));
  }
  console.log(`\n合计 ${problems.length} 处`);
  process.exitCode = 1;   // CI 靠这个变红
}

main().catch((e) => { console.error('[audit] 失败：', e); process.exit(1); });
