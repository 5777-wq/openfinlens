#!/usr/bin/env node
/* collect-academy-terms.mjs —— 同步「白话金融 OpenFin Academy」的术语清单与资产页清单
   产物：
     data/academy-terms.json   术语 id + 中文名（测试读它）
     js/data/academy-assets.js  哪些终端标的在科普站**真的有标的页**（运行时读它）

   为什么需要它：终端把标的映射到科普站的术语页，映射里的 id 一旦拼错或
   科普站那边把词删了，用户点进去只会看到「这个词还没有收录」——链接不会报错，
   只会静静地扑空。以前这里靠一份手写的 id 清单守着，科普站术语一多就必然过期
   （实测：清单停在 39 条，科普站已经 162 条，测试直接红）。

   同一类问题的另一面：终端原来把**每个**标的都链到 #/assets/<symbol>，
   但科普站只给采到了月线序列的标的做了数据卡。剩下的点过去是半空页——
   承诺了「看这一页」，实际没有数据。所以还要同步一份「真的有页」的清单。

   现在改成：清单由脚本从科普站同步，测试与运行时读快照。
     默认：从**线上已部署**的科普站拉（部署完就自动生效，不依赖本地目录）
     --src <dir>：从本地相邻的科普站仓库读（发布前自测用）

   拿不到就保留旧快照、退出 0——和本站其它采集器一个脾气：宁缺毋假，
   不因为一次网络抖动就把好数据覆盖成空。真正过期了，终端的离线测试会红。 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'academy-terms.json');
const OUT_ASSETS = path.join(ROOT, 'js', 'data', 'academy-assets.js');
const LIVE = 'https://5777-wq.github.io/openfin-academy/data/content/glossary.json';
const LIVE_ASSETS = 'https://5777-wq.github.io/openfin-academy/data/content/asset-ids.json';

/** --src <dir>：本地科普站仓库 */
const srcDir = (() => {
  const i = process.argv.indexOf('--src');
  return (i > -1 && process.argv[i + 1]) ? path.resolve(process.argv[i + 1]) : null;
})();

/** 两边的术语库结构一样：{ generatedAt, note, terms: { id: {term, ...} } } */
function toManifest(raw, source) {
  const g = JSON.parse(raw);
  const terms = g.terms || g;
  const ids = [];
  const names = {};
  for (const [id, t] of Object.entries(terms)) {
    ids.push(id);
    names[id] = (t && t.term) || id;
  }
  ids.sort();
  return { generatedAt: new Date().toISOString(), source, count: ids.length, ids, names };
}

async function fromLive() {
  const res = await fetch(LIVE, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const raw = await res.text();
  const m = toManifest(raw, LIVE);
  if (m.count < 50) throw new Error('拿到的术语数异常少：' + m.count);
  return m;
}

function fromLocal(dir) {
  const p = path.join(dir, 'content', '_meta', 'glossary.json');
  if (!existsSync(p)) throw new Error('找不到 ' + p);
  const m = toManifest(readFileSync(p, 'utf8'), 'local:' + dir);
  if (m.count < 50) throw new Error('拿到的术语数异常少：' + m.count);
  return m;
}

/* ---- 资产页清单：哪些终端标的在科普站**真的有**标的页 ---- */

async function assetsFromLive() {
  const res = await fetch(LIVE_ASSETS, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return JSON.parse(await res.text());
}

function assetsFromLocal(dir) {
  const p = path.join(dir, 'content', '_meta', 'asset-ids.json');
  if (!existsSync(p)) throw new Error('找不到 ' + p);
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 写成运行时可读的静态 JS（终端不直连科普站，只读本地静态文件） */
function writeAssetsJS(a) {
  const body = `/* academy-assets.js —— 科普站能接住哪些标的
   ⚠ 自动生成，勿手改。来源：_scripts/collect-academy-terms.mjs（从科普站同步）。
   用途：
     · symbols —— 哪些终端标的在科普站**真的有标的页**（带真实月线数据卡）。
       终端据此决定能不能给 #/assets/<symbol> 的链接：不在表里的点过去是半空页，
       那种链接是假入口，不该给。
     · searchable —— 科普站真能搜到的词（词条名 + 标的页标题）。
       终端据此决定要不要给「去科普站里搜这个词」的入口：
       给一个搜不到词的搜索链接，等于给用户一条必然扑空的路。 */
window.AcademyAssets = ${JSON.stringify({
    generatedAt: a.generatedAt || '',
    source: a.source || LIVE_ASSETS,
    count: (a.symbols || []).length,
    symbols: a.symbols || [],
    searchable: a.searchable || [],
  }, null, 1)};
`;
  let old = null;
  try { old = readFileSync(OUT_ASSETS, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body) return false;
  writeFileSync(OUT_ASSETS, body, 'utf8');
  return true;
}

/**
 * 自检：终端里所有指向科普站术语页的地方，都必须在清单里。
 * 清单过期这件事，只有在这里查才抓得住——CI 的 paths-ignore 把 data/** 排除了，
 * 光靠"数据变更提交后跑一次 CI"是抓不到术语清单过期的。
 * 查不到就退出 1，让采集流水线的 gate 把 CI 点红。
 */
function selfCheck(m, assets) {
  const ids = new Set(m.ids);
  const bad = [];

  // 1) 真加载映射表（别用正则扫源码——扫不准，还会被注释骗）
  //    universe 与资产页清单必须装进**同一个** ctx：targetFor 判定标的页时
  //    要同时用到「在不在 universe 里」和「科普站有没有这一页」。
  const ctx = vm.createContext({ console, window: null, encodeURIComponent, Math, JSON });
  ctx.window = ctx;
  vm.runInContext(readFileSync(path.join(ROOT, 'js/data/universe.js'), 'utf8'), ctx, { filename: 'universe.js' });
  ctx.AcademyAssets = { symbols: (assets && assets.symbols) || [] };
  vm.runInContext(readFileSync(path.join(ROOT, 'js/data/academy-gloss.js'), 'utf8'), ctx, { filename: 'academy-gloss.js' });
  const AG = ctx.AcademyGloss;
  for (const [sym, id] of Object.entries(AG.TERM_BY_SYMBOL || {})) {
    if (!ids.has(id)) bad.push('精确映射 ' + sym + ' → ' + id);
  }
  for (const [sym, c] of Object.entries(AG.CONCEPT_BY_SYMBOL || {})) {
    if (!ids.has(c.id)) bad.push('概念映射 ' + sym + ' → ' + c.id);
  }

  // 2) index.html 里的 data-gloss="<id>"（悬停浮层直接链到科普站术语页）
  //    以及科普站入口里直接写死的 #/term/<id> 链接
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m2 of html.matchAll(/data-gloss="([^"]+)"/g)) {
    if (!ids.has(m2[1])) bad.push('index.html data-gloss → ' + m2[1]);
  }
  for (const m2 of html.matchAll(/#\/term\/([a-z0-9-]+)/g)) {
    if (!ids.has(m2[1])) bad.push('index.html 术语链接 → ' + m2[1]);
  }

  // 3) 标的页：终端 universe 里每一只，科普站要么真有这么一页，要么不给 asset 页。
  //    给一个科普站没有数据卡的标的页 = 假入口（「看这一页」点进去是空的）。
  const has = new Set((assets && assets.symbols) || []);
  const uni = [...(ctx.TENCENT_UNIVERSE || []), ...(ctx.EM_UNIVERSE || [])];
  for (const u of uni) {
    const t = AG.targetFor(u.symbol, u.label);
    if (t && t.kind === 'asset' && !has.has(u.symbol)) {
      bad.push('标的页 ' + u.symbol + '（' + u.label + '）→ 科普站没有这一页');
    }
  }

  if (bad.length) {
    console.error('[academy-terms] 映射与科普站对不上：');
    [...new Set(bad)].forEach((b) => console.error('  · ' + b));
    console.error('  → 改映射，或在科普站补这个词 / 补这条序列，再重跑本脚本');
    process.exit(1);
  }
  console.log('[academy-terms] 自检通过（精确映射 / 概念映射 / 概念标记 / 术语链接 / 标的页全部对得上）');
}

async function main() {
  let m, assets;
  try {
    m = srcDir ? fromLocal(srcDir) : await fromLive();
    assets = srcDir ? assetsFromLocal(srcDir) : await assetsFromLive();
  } catch (e) {
    console.log('[academy-terms] 拉取失败（' + e.message + '），保留旧快照');
    process.exit(0);
  }
  console.log('[academy-terms] ' + m.count + ' 个术语 · 来源 ' + m.source);
  console.log('[academy-terms] ' + ((assets.symbols || []).length) + ' 个终端标的在科普站有标的页');

  selfCheck(m, assets);

  const body = JSON.stringify(m, null, 1) + '\n';
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body) { console.log('术语清单内容无变化，不写文件'); }
  else { writeFileSync(OUT, body, 'utf8'); console.log('写入 ' + OUT); }

  if (writeAssetsJS(assets)) console.log('写入 ' + OUT_ASSETS);
  else console.log('资产页清单内容无变化，不写文件');
}

main().catch((e) => { console.error('[academy-terms] 失败：', e.message); process.exit(1); });
