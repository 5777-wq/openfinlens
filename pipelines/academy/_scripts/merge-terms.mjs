#!/usr/bin/env node
/* merge-terms.mjs —— 把纯文本稿合并进术语库
   用法：node _scripts/merge-terms.mjs drafts/batch2.txt [--prune]
   稿子格式（每个词条一段，用 @@ id 开头）：

     @@ pe-ratio
     term: 市盈率
     alias: PE / P/E
     cat: data
     one: 一句话
     metaphor: 比喻
     number: 数字
     pit: 坑
     source: 出处
     sym: sh600519
     link: 读完整的一页 | #/concepts/x

   为什么要走文本稿：几百条词条直接写 JSON 太长，容易在写入时丢引号。
   文本稿里用「」代替直引号，脚本负责转成合法 JSON。 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META = path.join(ROOT, 'content', '_meta', 'glossary.json');

/** 直引号 → 中文引号：成对替换。
    从前两个 replace 的正则一模一样（都是 /"/g），所有直引号都变成孤立的「，永远配不成对。
    现在按对替换；落单的那半个直接去掉，不留半边引号。 */
export function smartQuotes(s) {
  const out = String(s).replace(/"([^"]*)"/g, '「$1」');
  return out.indexOf('"') >= 0 ? out.replace(/"/g, '') : out;
}

export function parseDraft(text) {
  const out = [];
  let cur = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('@@ ')) {
      cur = { id: line.slice(3).trim(), _links: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key === 'link') {
      const p = val.lastIndexOf('|');
      if (p < 0) continue;
      cur._links.push({ text: val.slice(0, p).trim(), href: val.slice(p + 1).trim() });
      continue;
    }
    cur[key] = val;
  }
  return out;
}

/** 一条稿子 → 一条词条记录：只带稿子里真的写了的字段。
    term 与 alias 同理：稿子没写就不带，patch 时才不会把老词条的中文名冲成英文 id。 */
export function buildRec(d) {
  const rec = {};
  if (d.term) rec.term = d.term;
  if (d.alias) rec.alias = d.alias;
  if (d.cat) rec.cat = d.cat;
  for (const k of ['one', 'name', 'metaphor', 'number', 'pit', 'source', 'sym', 'lens']) {
    if (d[k]) rec[k] = smartQuotes(d[k]);
  }
  // kw：额外的搜索关键词（俗名、英文、口语、常见错字），稿子里用逗号分隔
  if (d.kw) rec.kw = d.kw.split(/[,，]/).map((x) => smartQuotes(x.trim())).filter(Boolean);
  if (d._links.length) rec.links = d._links.map((l) => ({ text: smartQuotes(l.text), href: l.href }));
  return rec;
}

/** 把一条稿子合并进术语库，返回合并后的词条。
    patch: yes —— 只改稿子里写了的字段，其余保留原样。
    用来给老词条补一个字段（比如补「名称由来」），不必把整条重抄一遍。 */
export function mergeTerm(terms, d) {
  const rec = buildRec(d);
  if (d.patch && terms[d.id]) {
    const merged = Object.assign({}, terms[d.id]);
    Object.keys(rec).forEach((k) => { merged[k] = rec[k]; });
    return merged;
  }
  // 全量写入：整条换掉。稿子没写 term / cat 时按老规矩兜底。
  if (!rec.term) rec.term = d.id;
  if (!rec.cat) rec.cat = 'basic';
  return rec;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const prune = args.includes('--prune');
  if (!files.length) {
    console.error('用法：node _scripts/merge-terms.mjs <draft.txt> [...] [--prune]');
    process.exit(1);
  }

  const meta = JSON.parse(await readFile(META, 'utf8'));
  const terms = meta.terms || (meta.terms = {});

  let added = 0;
  let updated = 0;
  const seen = new Set();

  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(ROOT, f);
    const drafts = parseDraft(await readFile(p, 'utf8'));
    for (const d of drafts) {
      if (!d.id) continue;
      if (seen.has(d.id)) throw new Error(`稿子里有重复 id：${d.id}`);
      seen.add(d.id);

      const existed = !!terms[d.id];
      terms[d.id] = mergeTerm(terms, d);
      if (existed) updated++; else added++;
    }
  }

  // 分类顺序固定，避免每次提交顺序抖动
  const sorted = {};
  Object.keys(terms).sort().forEach((k) => { sorted[k] = terms[k]; });
  meta.terms = sorted;

  await writeFile(META, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`[merge] 新增 ${added} 条，更新 ${updated} 条，术语库共 ${Object.keys(sorted).length} 条`);
}

// 当脚本跑才合并术语库；被测试 import 时只导出纯函数，不会碰 content/_meta/glossary.json
const SELF = fileURLToPath(import.meta.url);
const isSelf = (p) => {
  if (!p) return false;
  const a = path.resolve(p), b = path.resolve(SELF);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};

if (isSelf(process.argv[1])) {
  main().catch((e) => { console.error('[merge] 失败：', e.message); process.exit(1); });
}
