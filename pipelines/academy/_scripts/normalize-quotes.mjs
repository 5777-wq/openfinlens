#!/usr/bin/env node
/* normalize-quotes.mjs —— 把词条库里的直引号统一成中文引号「」
   用法：node _scripts/normalize-quotes.mjs

   为什么需要：术语正文里混着 `他说"这是股债跷跷板"` 这种直引号，
   而全站其它地方统一用「」。排版不齐，读起来像半路插进来的。

   规则：成对的直引号 → 「」；落单的那个（不配对）直接去掉——
   留半边引号比没有引号更糟。

   幂等：跑第二遍不会继续改。可随时重跑。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META = path.join(ROOT, 'content', '_meta', 'glossary.json');

/** 直引号 → 中文引号（成对替换，落单的去掉） */
export function normalize(s) {
  const out = String(s).replace(/"([^"]*)"/g, '「$1」');
  return out.indexOf('"') >= 0 ? out.replace(/"/g, '') : out;
}

/** 词条里需要规整的字段（links 的 text 也要） */
const FIELDS = ['one', 'name', 'metaphor', 'number', 'pit', 'source', 'alias', 'term'];

function main() {
  const g = JSON.parse(readFileSync(META, 'utf8'));
  const terms = g.terms || {};
  let changed = 0;
  for (const [id, t] of Object.entries(terms)) {
    for (const f of FIELDS) {
      if (typeof t[f] !== 'string' || t[f].indexOf('"') < 0) continue;
      const n = normalize(t[f]);
      if (n !== t[f]) { t[f] = n; changed++; }
    }
    for (const l of (t.links || [])) {
      if (typeof l.text === 'string' && l.text.indexOf('"') >= 0) {
        const n = normalize(l.text);
        if (n !== l.text) { l.text = n; changed++; }
      }
    }
  }
  writeFileSync(META, JSON.stringify(g, null, 2) + '\n', 'utf8');
  console.log(`[quotes] 规整了 ${changed} 个字段`);
}

main();
