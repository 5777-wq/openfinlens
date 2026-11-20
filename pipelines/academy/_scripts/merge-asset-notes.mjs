#!/usr/bin/env node
/* merge-asset-notes.mjs —— 把分组短注稿合并成 content/_meta/asset-notes.json

   稿子在 drafts/asset-notes/<组key>.json，每组一个文件，格式：

     [
       { "symbol": "EM:171.US10Y", "what": "…", "moves": "…", "trap": "…" },
       …
     ]

   合并时做全量校验（任何一条不过就整体失败、退出码 1，错误一次列全，
   方便修稿的人一轮改完）：
   - 覆盖：素材表里 103 个待写标的，每个恰好出现一次；不许多、不许少；
   - 字段：what ≤ 70 字，moves ≤ 130 字，trap ≤ 130 字；不允许空串；
   - 措辞：站内禁用表达（必将/一定会/稳赚/保本/建议买入/可以考虑/预测点位…）；
     「今天 + 数字」这种会过期的写法；英文直引号 "；U+FFFD 乱码。

   产物 content/_meta/asset-notes.json 由 build-content 拷到 data/content/ 供页面读取。 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'drafts/asset-notes');
const OUT = path.join(ROOT, 'content/_meta/asset-notes.json');

const CAPS = { what: 70, moves: 130, trap: 130 };
const BANNED = [
  [/必将|一定会|注定/, '宿命式断言'],
  [/稳赚|保本|包赚|躺赚/, '收益承诺'],
  [/无风险.{0,4}(高|收益)|高收益.{0,6}无风险/, '无风险高收益话术'],
  [/建议(买入|卖出|加仓|建仓)|可以考虑(买|卖|入手)/, '荐股话术'],
  [/预测.{0,6}(点位|涨跌|目标价)/, '点位预测'],
  [/内幕|消息面|主力动向/, '消息面话术'],
  [/今天.{0,3}\d/, '会过期的「今天+数字」'],
  [/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?的?最新|最新的?\d+(\.\d+)?[%倍]/, '会过期的「最新值」'],
];
const FFD = /\uFFFD/;

async function main() {
  const stats = JSON.parse(await readFile(path.join(SRC, 'stats.json'), 'utf8'));
  const needed = new Set(Object.keys(stats.symbols));

  const files = (await readdir(SRC)).filter((f) => /^[\w-]+\.json$/.test(f) && f !== 'stats.json').sort();
  const errs = [];
  const notes = {};
  let seen = new Set();

  for (const f of files) {
    let arr;
    try { arr = JSON.parse(await readFile(path.join(SRC, f), 'utf8')); }
    catch (e) { errs.push(`${f}：不是合法 JSON（${e.message}）`); continue; }
    if (!Array.isArray(arr)) { errs.push(`${f}：顶层必须是数组`); continue; }
    for (const it of arr) {
      const sym = it && it.symbol;
      if (!needed.has(sym)) { errs.push(`${f}：${sym} 不在待写清单里（或已是有专文的旗舰）`); continue; }
      if (seen.has(sym)) { errs.push(`${f}：${sym} 重复出现`); continue; }
      seen.add(sym);
      const rec = { what: String(it.what || ''), moves: String(it.moves || ''), trap: String(it.trap || '') };
      for (const k of Object.keys(CAPS)) {
        const len = rec[k].length;
        if (!len) errs.push(`${f}：${sym}.${k} 为空`);
        else if (len > CAPS[k]) errs.push(`${f}：${sym}.${k} ${len} 字超上限 ${CAPS[k]}`);
        if (FFD.test(rec[k])) errs.push(`${f}：${sym}.${k} 含乱码字符`);
        if (rec[k].includes('"')) errs.push(`${f}：${sym}.${k} 含英文直引号，请用「」`);
        for (const [re, why] of BANNED) if (re.test(rec[k])) errs.push(`${f}：${sym}.${k} 命中禁用表达「${why}」`);
      }
      notes[sym] = rec;
    }
  }
  for (const sym of needed) if (!seen.has(sym)) errs.push(`缺 ${sym}（${stats.symbols[sym].label}）· 组：${(stats.groups.find((g) => g.symbols.includes(sym)) || {}).key || '?'}`);

  if (errs.length) {
    console.error(`[merge] 校验失败 ${errs.length} 条：`);
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }

  const sorted = {};
  for (const sym of Object.keys(notes).sort()) sorted[sym] = notes[sym];
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: '标的页三段短注（这是什么 / 它跟着什么走 / 最容易踩的坑）。数字口径见 drafts/asset-notes/stats.json；校验与合并见 _scripts/merge-asset-notes.mjs。',
    count: Object.keys(sorted).length,
    symbols: sorted,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[merge] ${out.count} 条短注 → content/_meta/asset-notes.json`);
}

main().catch((e) => { console.error('[merge] 失败：', e.message); process.exit(1); });
