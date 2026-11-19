#!/usr/bin/env node
/* sync-drafts.mjs —— 把正库（content/_meta/glossary.json）回填到 drafts/batch*.txt

   为什么需要它：merge-terms.mjs 对没有 patch 标记的稿子是「整条替换」，
   稿子里缺的字段（kw / lens / name 这些后来加的）在整批 merge 时会被丢掉。
   正库才是权威版本；稿子一旦落后，整批 merge 就是回退。

   这个脚本做的事：对稿子里已有的词条，把字段块重写成与正库逐字段一致；
   稿子里没有、正库里有的词条不动（它们本来就不受 merge 影响）。
   跑完之后，整批 merge 是幂等的空操作——可以用 verify 自检：

     node _scripts/sync-drafts.mjs          # 回填
     node _scripts/sync-drafts.mjs --verify # 模拟整批 merge，断言零变化

   字段序列化规则与 merge-terms.mjs 的解析规则一一对应：
   标量 `key: value`；kw 用逗号连；links 每条一行 `link: 文字 | #/href`。 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDraft, mergeTerm } from './merge-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META = path.join(ROOT, 'content', '_meta', 'glossary.json');
const DRAFTS = path.join(ROOT, 'drafts');

/** 词条字段在稿子里的规范顺序（与 merge-terms.mjs 头部注释一致） */
const FIELD_ORDER = ['term', 'alias', 'cat', 'one', 'name', 'metaphor', 'number', 'pit', 'source', 'sym', 'lens'];

/** 正库词条 → 稿子字段行（不含 @@ 头、patch 行与 link 行） */
function fieldLines(entry) {
  const lines = [];
  for (const k of FIELD_ORDER) {
    const v = entry[k];
    if (typeof v === 'string' && v.trim()) lines.push(`${k}: ${v}`);
  }
  if (Array.isArray(entry.kw) && entry.kw.length) lines.push(`kw: ${entry.kw.join(',')}`);
  return lines;
}

/** 把一个 batch 文本按 @@ 分段，同步每段 */
function rewriteBatch(text, terms) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let ids = [];
  let touched = false;
  // 逐行状态机：cur = 当前词条 id；dumped = 正库字段块是否已落盘
  let cur = null, dumped = true;
  for (const raw of lines) {
    if (raw.startsWith('@@ ')) {
      const id = raw.slice(3).trim();
      cur = terms[id] ? id : null;
      dumped = !cur;
      if (cur) ids.push(id);
      out.push(raw);
      continue;
    }
    if (!cur) { out.push(raw); continue; }
    if (/^patch:/i.test(raw)) { out.push(raw); continue; }   // patch 标记保留，语义不变
    if (/^[a-zA-Z][a-zA-Z0-9_-]*:/.test(raw)) {
      // 字段区：第一行处落正库字段块（含 links），其余旧字段行丢弃
      if (!dumped) {
        out.push(...fieldLines(terms[cur]));
        if (Array.isArray(terms[cur].links)) {
          for (const l of terms[cur].links) out.push(`link: ${l.text} | ${l.href}`);
        }
        dumped = true;
        touched = true;
      }
      continue;
    }
    out.push(raw); // 空行或注释行原样保留
  }
  return { text: out.join('\n'), ids, touched };
}

/** 键序无关的稳定序列化：整批 merge 只要不改任何字段值就算空操作 */
function stable(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map(stable));
  if (v && typeof v === 'object') {
    return JSON.stringify(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  }
  return JSON.stringify(v);
}

async function main() {
  const verify = process.argv.includes('--verify');
  const meta = JSON.parse(await readFile(META, 'utf8'));
  const terms = meta.terms;

  const files = (await readdir(DRAFTS))
    .filter((f) => /^batch\d+\.txt$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  if (verify) {
    // 模拟整批 merge：把所有稿子按顺序合进正库副本，断言零变化
    const copy = JSON.parse(JSON.stringify(terms));
    for (const f of files) {
      const drafts = parseDraft(await readFile(path.join(DRAFTS, f), 'utf8'));
      for (const d of drafts) copy[d.id] = mergeTerm(copy, d);
    }
    const bad = [];
    for (const id of Object.keys(terms)) {
      if (stable(terms[id]) !== stable(copy[id])) bad.push(id);
    }
    if (!bad.length) {
      console.log(`[sync-drafts] 校验通过：${files.length} 个稿子整批 merge 是空操作（${Object.keys(terms).length} 条术语不变）`);
      return;
    }
    console.error(`[sync-drafts] 校验失败：整批 merge 会改动 ${bad.length} 条：${bad.slice(0, 10).join(', ')}${bad.length > 10 ? ' …' : ''}`);
    process.exit(1);
  }

  let synced = 0;
  const allIds = new Set();
  for (const f of files) {
    const p = path.join(DRAFTS, f);
    const src = await readFile(p, 'utf8');
    const { text, ids, touched } = rewriteBatch(src, terms);
    ids.forEach((id) => allIds.add(id));
    if (touched) {
      await writeFile(p, text.replace(/\s*$/, '\n'), 'utf8');
      synced += ids.length;
    }
  }
  const onlyLib = Object.keys(terms).filter((id) => !allIds.has(id));
  console.log(`[sync-drafts] 已把 ${synced} 条稿子同步成正库内容（${files.length} 个文件）`);
  console.log(`[sync-drafts] 另有 ${onlyLib.length} 条只在正库、稿子里没有（不受 merge 影响）：${onlyLib.slice(0, 8).join(', ')}${onlyLib.length > 8 ? ' …' : ''}`);
}

main().catch((e) => { console.error('[sync-drafts] 失败：', e.message); process.exit(1); });
