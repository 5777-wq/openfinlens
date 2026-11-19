#!/usr/bin/env node
/* sync-docs.mjs —— README 里的规模数字不许靠人记（零依赖）
   用法：
     node _scripts/sync-docs.mjs           # 把数字写进 README
     node _scripts/sync-docs.mjs --check   # 只校验，对不上就退出码 1（CI 用）

   为什么要有这个：
   README 里「213 个词 / 114 只标的 / 177 只成分股」这类数字，
   靠人记一定会再错——内容一加、术语一改，文档就悄悄过期了。
   这里从数据里算，CI 里跑一遍 --check，对不上就红。 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.indexOf('--check') >= 0;

/* ---------- 从数据里算 ---------- */
async function stats() {
  const glossary = JSON.parse(await readFile(path.join(ROOT, 'content/_meta/glossary.json'), 'utf8'));
  const terms = Object.keys(glossary.terms || glossary).length;

  const assetIds = JSON.parse(await readFile(path.join(ROOT, 'content/_meta/asset-ids.json'), 'utf8'));
  const assets = assetIds.count || (assetIds.symbols || []).length;

  // 产业链：vendor 里的那一份（与页面用的是同一份）
  const sandbox = { window: {} };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(await readFile(path.join(ROOT, 'vendor/core/industry-chains.js'), 'utf8'), ctx, { filename: 'chains' });
  const chains = (sandbox.window.INDUSTRY_CHAINS) || [];
  const links = chains.reduce((n, c) => n + (c.links || []).length, 0);
  const uniq = new Set();
  chains.forEach((c) => (c.links || []).forEach((l) => (l.stocks || []).forEach(
    (s) => uniq.add(typeof s === 'string' ? s : (s.symbol || s.code || JSON.stringify(s))))));
  const stocks = uniq.size;

  const idx = JSON.parse(await readFile(path.join(ROOT, 'data/content/index.json'), 'utf8'));
  const articles = (idx.items || []).length;
  const crises = (idx.items || []).filter((i) => i.section === 'crisis').length;

  return { terms, assets, articles, crises, chains: chains.length, links, stocks };
}

/* ---------- 生成要写进 README 的内容 ---------- */
function autoBlock(s) {
  return [
    '<!-- AUTO:stats -->',
    '| 术语 | ' + s.terms + ' |',
    '| 标的页 | ' + s.assets + ' |',
    '| 文章 | ' + s.articles + ' |',
    '| 危机复盘 | ' + s.crises + ' |',
    '| 产业链 | ' + s.chains + ' 条 / ' + s.links + ' 环节 / ' + s.stocks + ' 只成分股 |',
    '<!-- /AUTO:stats -->',
  ].join('\n');
}

/** 正文里散落的数字：逐条按固定写法替换（写死了要匹配什么）。
    规则必须**幂等**——跑第二遍不应该有变化，也不该报警告。 */
function inline(s, text) {
  const rules = [
    {
      re: /术语库现在有 \*\*(\d+) 个词\*\*/,
      ok: (m) => m[1] === String(s.terms),
      to: () => '术语库现在有 **' + s.terms + ' 个词**',
    },
    {
      re: /\*\*（(\d+) 只：/,
      ok: (m) => m[1] === String(s.assets),
      to: () => '**（' + s.assets + ' 只：',
    },
    {
      re: /(\d+) 条产业链 (\d+) 环节 (\d+) 只成分股/,
      ok: (m) => m[1] === String(s.chains) && m[2] === String(s.links) && m[3] === String(s.stocks),
      to: () => s.chains + ' 条产业链 ' + s.links + ' 环节 ' + s.stocks + ' 只成分股',
    },
    {
      re: /\|\s*(\d+) 只，全市场实时\s*\|/,
      ok: (m) => m[1] === String(s.stocks),
      to: () => '| ' + s.stocks + ' 只，全市场实时 |',
    },
    /* 英文段落里的数字：写法同样固定，规则同样幂等 */
    {
      re: /a glossary of \*\*(\d+) terms\*\* across ten categories/,
      ok: (m) => m[1] === String(s.terms),
      to: () => 'a glossary of **' + s.terms + ' terms** across ten categories',
    },
    {
      re: /detail pages for \*\*(\d+) tickers\*\* with real historical readings/,
      ok: (m) => m[1] === String(s.assets),
      to: () => 'detail pages for **' + s.assets + ' tickers** with real historical readings',
    },
    {
      re: /\*\*(\d+) replayable crises\*\*/,
      ok: (m) => m[1] === String(s.crises),
      to: () => '**' + s.crises + ' replayable crises**',
    },
    {
      re: /\*\*(\d+) industry chains\*\* with \*\*(\d+) segments\*\* and \*\*(\d+) constituents\*\*/,
      ok: (m) => m[1] === String(s.chains) && m[2] === String(s.links) && m[3] === String(s.stocks),
      to: () => '**' + s.chains + ' industry chains** with **' + s.links + ' segments** and **' + s.stocks + ' constituents**',
    },
  ];
  let out = text;
  for (const r of rules) {
    const m = r.re.exec(out);
    if (!m) { console.warn('[sync-docs] 警告：README 里没匹配到 ' + r.re); continue; }
    if (!r.ok(m)) out = out.replace(r.re, r.to());
  }
  return out;
}

async function main() {
  const s = await stats();
  console.log('[sync-docs] 统计：' + JSON.stringify(s));

  const readmePath = path.join(ROOT, 'README.md');
  let text = await readFile(readmePath, 'utf8');

  // AUTO 块：有就替换，没有就插到「## 数据从哪来」前面
  const block = autoBlock(s);
  const re = /<!-- AUTO:stats -->[\s\S]*?<!-- \/AUTO:stats -->/;
  if (re.test(text)) {
    text = text.replace(re, block);
  } else if (text.includes('## 数据从哪来')) {
    text = text.replace('## 数据从哪来', '## 当前规模\n\n' + block + '\n\n## 数据从哪来');
    console.warn('[sync-docs] README 里没有 AUTO 块，已插到「## 数据从哪来」前面');
  } else {
    throw new Error('README 里找不到「## 数据从哪来」，也不知道往哪插 AUTO 块');
  }

  text = inline(s, text);

  if (CHECK) {
    const cur = await readFile(readmePath, 'utf8');
    if (cur !== text) {
      console.error('[sync-docs] README 与数据对不上，请运行 node _scripts/sync-docs.mjs 并提交');
      process.exit(1);
    }
    console.log('[sync-docs] README 与数据一致 ✓');
    return;
  }
  await writeFile(readmePath, text, 'utf8');
  console.log('[sync-docs] README 已更新');
}

main().catch((e) => { console.error('[sync-docs] 失败：', e.message); process.exit(1); });
