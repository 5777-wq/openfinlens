#!/usr/bin/env node
/* collect-academy-terms.mjs —— 同步「白话金融 OpenFin Academy」的术语清单
   产物 data/academy-terms.json（随仓库提交，测试只读这份快照）。

   为什么需要它：终端把标的映射到科普站的术语页，映射里的 id 一旦拼错或
   科普站那边把词删了，用户点进去只会看到「这个词还没有收录」——链接不会报错，
   只会静静地扑空。以前这里靠一份手写的 id 清单守着，科普站术语一多就必然过期
   （实测：清单停在 39 条，科普站已经 162 条，测试直接红）。

   现在改成：清单由脚本从科普站同步，测试读快照。
     默认：从**线上已部署**的科普站拉（部署完就自动生效，不依赖本地目录）
     --src <dir>：从本地相邻的科普站仓库读 content/_meta/glossary.json（发布前自测用）

   拿不到就保留旧快照、退出 0——和本站其它采集器一个脾气：宁缺毋假，
   不因为一次网络抖动就把好数据覆盖成空。真正过期了，终端的离线测试会红。 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'academy-terms.json');
const LIVE = 'https://5777-wq.github.io/openfin-academy/data/content/glossary.json';

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

/**
 * 自检：终端里所有指向科普站术语页的地方，都必须在清单里。
 * 清单过期这件事，只有在这里查才抓得住——CI 的 paths-ignore 把 data/** 排除了，
 * 光靠"数据变更提交后跑一次 CI"是抓不到术语清单过期的。
 * 查不到就退出 1，让采集流水线的 gate 把 CI 点红。
 */
function selfCheck(m) {
  const ids = new Set(m.ids);
  const bad = [];

  // 1) 真加载映射表（别用正则扫源码——扫不准，还会被注释骗）
  const ctx = vm.createContext({ console, window: null, encodeURIComponent, Math, JSON });
  ctx.window = ctx;
  vm.runInContext(readFileSync(path.join(ROOT, 'js/data/academy-gloss.js'), 'utf8'), ctx);
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

  if (bad.length) {
    console.error('[academy-terms] 映射指向科普站不存在的术语：');
    [...new Set(bad)].forEach((b) => console.error('  · ' + b));
    console.error('  → 改映射，或在科普站补这个词，再重跑本脚本');
    process.exit(1);
  }
  console.log('[academy-terms] 映射自检通过（精确映射 / 概念映射 / 概念标记 / 术语链接全部有对应词条）');
}

async function main() {
  let m;
  try {
    m = srcDir ? fromLocal(srcDir) : await fromLive();
  } catch (e) {
    console.log('[academy-terms] 拉取失败（' + e.message + '），保留旧快照');
    process.exit(0);
  }
  console.log('[academy-terms] ' + m.count + ' 个术语 · 来源 ' + m.source);

  selfCheck(m);

  const body = JSON.stringify(m, null, 1) + '\n';
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body) { console.log('内容无变化，不写文件'); return; }
  writeFileSync(OUT, body, 'utf8');
  console.log('写入 ' + OUT);
}

main().catch((e) => { console.error('[academy-terms] 失败：', e.message); process.exit(1); });
