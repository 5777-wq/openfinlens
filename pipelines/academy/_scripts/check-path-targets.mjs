#!/usr/bin/env node
/* check-path-targets.mjs —— 新手路径 8 课的 target 必须真实存在
   以前 8 课只有 id/title/dek，没有落地页，读者点哪一课都没反应。
   现在每课都带一个 target，这里逐条核对：
     · #/term/<id>  → id 必须在术语库（data/content/glossary.json）里
     · #/<栏目>/<id> → id 必须在内容索引（data/content/index.json）的 items 里
   跑法：node _scripts/check-path-targets.mjs */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const meta = JSON.parse(await readFile(path.join(ROOT, 'content/_meta/path.json'), 'utf8'));
const glossary = JSON.parse(await readFile(path.join(ROOT, 'data/content/glossary.json'), 'utf8')).terms || {};
const index = JSON.parse(await readFile(path.join(ROOT, 'data/content/index.json'), 'utf8')).items || [];

const termIds = new Set(Object.keys(glossary));
const articleIds = new Set(index.map((a) => a.section + '/' + a.id));

let bad = 0;
for (const l of meta.lessons || []) {
  const t = String(l.target || '');
  let where = '';
  const m = /^#\/term\/(.+)$/.exec(t);
  const a = /^#\/([^/]+)\/([^/]+)$/.exec(t);
  if (!t) { where = '没有 target'; }
  else if (m) { where = termIds.has(decodeURIComponent(m[1])) ? '术语库 ✓' : '术语库里没有这个 id ✗'; }
  else if (a) { where = articleIds.has(a[1] + '/' + a[2]) ? '文章 ✓' : '内容索引里没有这一篇 ✗'; }
  else { where = '看不懂的 target ✗'; }
  if (where.indexOf('✗') >= 0) bad++;
  console.log(`${l.id}  ${t || '(空)'}  →  ${where}`);
}

console.log('');
console.log(`共 ${(meta.lessons || []).length} 课，落地页真实存在 ${(meta.lessons || []).length - bad} 课，坏链 ${bad} 条`);
process.exit(bad ? 1 : 0);
