#!/usr/bin/env node
/* asset-notes-stats.mjs —— 为标的短注写作准备素材表

   做三件事（全部只读，产物写到 drafts/asset-notes/stats.json）：
   1. 用与页面同一套引擎（engine/instrument.stats）算出每个标的的真实历史读数；
   2. 列出「需要短注」的标的清单 = 终端标的 114 只 + 站内自有序列（VIX/IXIC）− 有专文的旗舰；
   3. 按市场分组、大组对半拆，供写作工作流按组派活。

   写手只能引用这里给出的数字（自带日期口径），不许凭记忆写数。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadBrowserScripts() {
  const ctx = vm.createContext({
    window: { Fmt: { esc: (s) => String(s), num: (v) => String(v) } },
    console, Math, Date, JSON, Map, Set, Number, String, Array, Object, Boolean, Error, RegExp,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    Promise, Symbol,
  });
  const W = ctx.window;
  ctx.window.window = ctx.window;
  for (const f of ['vendor/core/universe.js', 'js/engine/drawdown.js', 'js/engine/instrument.js', 'js/views/assets.js']) {
    const code = await readFile(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return W;
}

const round = (v, d = 2) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));

async function main() {
  const W = await loadBrowserScripts();
  const AV = W.AssetsView;
  const universe = AV.universe();
  const uMap = new Map(universe.map((u) => [u.symbol, u]));

  const assetIds = JSON.parse(await readFile(path.join(ROOT, 'content/_meta/asset-ids.json'), 'utf8'));
  const index = JSON.parse(await readFile(path.join(ROOT, 'data/content/index.json'), 'utf8'));

  // 有专文的旗舰：文章 id 即标的 symbol（usNVDA…），外加 ARTICLE_OF 的映射（gold）
  const flagshipIds = new Set(index.items.filter((it) => it.section === 'assets').map((it) => it.id));
  for (const [sym, aid] of Object.entries(AV.ARTICLE_OF)) if (flagshipIds.has(aid)) flagshipIds.add(sym);

  // 需要短注的标的：终端清单 + 站内自有序列，去掉旗舰
  const needed = [];
  for (const sym of assetIds.symbols) if (!flagshipIds.has(sym)) needed.push(sym);
  for (const o of AV.OWN_SERIES) if (!needed.includes(o.id)) needed.push(o.id);

  const symbols = {};
  const marketOf = {};
  for (const sym of needed) {
    const sid = AV.seriesIdOf(sym);
    const u = uMap.get(sym);
    let series = null;
    try { series = JSON.parse(await readFile(path.join(ROOT, 'data/history', sid + '.json'), 'utf8')); }
    catch (e) { console.warn('[stats] 没有序列，跳过', sym, sid); continue; }
    const st = W.Engine.instrument.stats(series);
    symbols[sym] = {
      symbol: sym,
      label: (u && (u.label || u.name)) || series.name || sym,
      market: (u && u.market) || 'own',
      seriesId: sid,
      unit: series.unit || '', kind: series.kind || '',
      from: st.from, to: st.to, count: st.count,
      last: { v: round(st.last.v, 4), t: st.last.t },
      peak: { v: round(st.peak.v, 4), t: st.peak.t },
      trough: { v: round(st.trough.v, 4), t: st.trough.t },
      mdd: st.isRate ? null : {
        from: st.mddFrom || (st.mddPeak && st.mddPeak.t) || null,
        to: st.mddTo || (st.mddTrough && st.mddTrough.t) || null,
        pct: round(st.dropPct, 1),
      },
      chg1y: st.isRate ? null : round(st.chg1y, 1),
      chg1yBp: st.isRate ? round(st.chg1yBp, 0) : null,
      isRate: !!st.isRate,
    };
    marketOf[sym] = symbols[sym].market;
  }

  // 分组：小市场整组，大组（hk/cn/us）对半拆
  const byMarket = {};
  for (const sym of Object.keys(symbols)) {
    const m = marketOf[sym] === 'own' ? 'own' : marketOf[sym];
    (byMarket[m] = byMarket[m] || []).push(sym);
  }
  const GROUP_LABEL = {
    index: '全球指数', commodity: '商品', fx: '外汇', macro: '全球利率',
    hk: '港股', cn: 'A股', us: '美股', own: '站内自有序列',
  };
  const groups = [];
  for (const m of ['index', 'commodity', 'fx', 'macro', 'hk', 'cn', 'us', 'own']) {
    const list = (byMarket[m] || []).sort();
    if (!list.length) continue;
    if (['hk', 'cn', 'us'].includes(m) && list.length > 16) {
      const half = Math.ceil(list.length / 2);
      groups.push({ key: m + '-1', label: GROUP_LABEL[m] + '（上）', symbols: list.slice(0, half) });
      groups.push({ key: m + '-2', label: GROUP_LABEL[m] + '（下）', symbols: list.slice(half) });
    } else {
      groups.push({ key: m, label: GROUP_LABEL[m], symbols: list });
    }
  }

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: '给标的页三段短注（what/moves/trap）写作用的素材表。数字由 data/history 用页面同一套引擎算出；写手只能引用这里的数字，写时必须带日期口径。',
    flagship: [...flagshipIds].sort(),
    neededCount: Object.keys(symbols).length,
    symbols, groups,
  };
  await mkdir(path.join(ROOT, 'drafts/asset-notes'), { recursive: true });
  await writeFile(path.join(ROOT, 'drafts/asset-notes/stats.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[stats] 需要短注 ${out.neededCount} 个标的，分 ${groups.length} 组：`);
  for (const g of groups) console.log(`  ${g.key}（${g.label}）× ${g.symbols.length}`);
}

main().catch((e) => { console.error('[stats] 失败：', e); process.exit(1); });
