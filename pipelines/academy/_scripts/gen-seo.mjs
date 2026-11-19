#!/usr/bin/env node
/* gen-seo.mjs —— 生成 sitemap.xml 与 data/content/stats.json（零依赖）
   用法：
     node _scripts/gen-seo.mjs           # 写盘
     node _scripts/gen-seo.mjs --check   # 只生成到内存，和磁盘产物比对；不一致 exit 1

   幂等约定：
   generatedAt **不取当前时间**，而是从输入产物自带的 generatedAt / updatedAt /
   dataAsOf 里取最新日期。同样的输入跑两遍，产物逐字节一致；--check 也把
   generatedAt 纳入比较。内容或数据真的更新了，它才会跟着变。

   本站是哈希路由单页应用，页面地址形如 /openfin-academy/#/term/gold。
   搜索引擎通常不把 URL 片段（# 后面）当作独立页面收录，sitemap 里的这些
   hash URL 只能算尽力而为；真正稳定可收录的是站点根与静态壳的 canonical。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/* monorepo Phase 4：脚本随管线迁入 pipelines/academy/_scripts/，站点根在 apps/academy/；
 * 部署坐标 = Pages 项目站子路径 /openfinlens/ + /academy/ 挂载（与 js/site/base.js 同源）。
 * vendor/core/industry-chains.js 的读取改指 apps/academy/js/legacy/（vendor 已退役）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'academy');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const STATS_PATH = path.join(ROOT, 'data', 'content', 'stats.json');
const SITE = 'https://5777-wq.github.io/openfinlens/academy/';
const CHECK = process.argv.indexOf('--check') >= 0;

/* 顶层静态栏目。search 不列：搜索结果页是用户输入驱动的，不该进 sitemap。
   path / terms / data 虽然不是「七个栏目」，但它们是有稳定地址的公开入口。 */
const SECTION_PAGES = [
  ['concepts', '货币与利率'],
  ['crisis', '危机复盘'],
  ['assets', '标的百科'],
  ['chains', '产业链图谱'],
  ['cycles', '周期与镜鉴'],
  ['family', '家庭理财'],
  ['reports', '读懂财报'],
  ['path', '新手路径'],
  ['terms', '术语库'],
  ['data', '速查表'],
  ['compare', '资产对比'],
  ['curve', '收益率曲线'],
  ['analogy', '周期对照'],
  ['calc', '理财计算器'],
  ['saved', '收藏与记录'],
  ['quiz', '术语自测'],
  ['status', '数据台账'],
];

/* 文章 section → 路由 section。路由表里 assets 专栏的文章也是 #/assets/<id>。 */
const ARTICLE_SECTIONS = {
  concepts: 'concepts',
  crisis: 'crisis',
  assets: 'assets',
  cycles: 'cycles',
  family: 'family',
  reports: 'reports',
};

async function readJSON(rel) {
  const p = path.join(ROOT, rel);
  return JSON.parse(await readFile(p, 'utf8'));
}

/** 与 sync-docs 相同：vm 加载浏览器端定义，取页面真正使用的那一份链定义 */
async function loadChains() {
  const src = await readFile(path.join(ROOT, 'js/legacy/industry-chains.js'), 'utf8');
  const sandbox = { window: {} };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: 'vendor/core/industry-chains.js' });
  const chains = sandbox.window.INDUSTRY_CHAINS;
  if (!Array.isArray(chains) || !chains.length) throw new Error('vendor/core/industry-chains.js 里没有 INDUSTRY_CHAINS');
  return chains;
}

/** 输入数据里最新的日期。只认可解析的日期，不编造「今天」。 */
function latestDate(values) {
  let best = '';
  let bestMs = -Infinity;
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    // 同一天有两种写法时取更完整的那个（例如 2026-10-27T...Z 优于 2026-10-27），
    // 但仍然只从输入里挑，不生成新时间。
    if (ms > bestMs || (ms === bestMs && raw > best)) {
      best = raw;
      bestMs = ms;
    }
  }
  return best;
}

/** @returns {Promise<{articles:any[], terms:Array<[string,any]>, assetDetails:Record<string,any>, chains:any[], pathData:any, stats:any, sitemap:string, counts:any}>} */
export async function buildSeo() {
  const [index, glossary, pathData, assetIds, chains] = await Promise.all([
    readJSON('data/content/index.json'),
    readJSON('data/content/glossary.json'),
    readJSON('data/content/path.json'),
    readJSON('data/content/asset-ids.json'),
    loadChains(),
  ]);

  const articles = Array.isArray(index.items) ? index.items : [];
  const glossaryTerms = glossary && glossary.terms && typeof glossary.terms === 'object'
    ? Object.entries(glossary.terms)
    : [];
  const assetDetails = assetIds && assetIds.detail && typeof assetIds.detail === 'object'
    ? assetIds.detail
    : {};
  if (!articles.length) throw new Error('data/content/index.json 没有 items');
  if (!glossaryTerms.length) throw new Error('data/content/glossary.json 没有 terms');
  if (!Object.keys(assetDetails).length) throw new Error('data/content/asset-ids.json 没有 detail');
  if (!pathData || !Array.isArray(pathData.lessons)) throw new Error('data/content/path.json 没有 lessons');

  const categories = [...new Set(glossaryTerms.map(([, t]) => String((t && t.cat) || '').trim()).filter(Boolean))];
  const crisisCount = articles.filter((a) => a && a.section === 'crisis').length;

  // 只从输入里取日期：保证同一份输入字节级可复现，--check 才能直接比 generatedAt。
  const generatedAt = latestDate([
    glossary.generatedAt,
    assetIds.generatedAt,
    ...articles.flatMap((a) => [a && a.updatedAt, a && a.dataAsOf]),
    pathData.generatedAt,
  ]);

  const stats = {
    generatedAt,
    terms: glossaryTerms.length,
    articles: articles.length,
    assets: Object.keys(assetDetails).length,
    chains: chains.length,
    crisis: crisisCount,
    glossaryCategories: categories.length,
  };

  const urls = [];
  const seen = new Set();
  function addUrl(url) {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    urls.push(url);
    return true;
  }
  function hashUrl(routePath) {
    return SITE + '#' + (String(routePath).startsWith('/') ? routePath : '/' + routePath);
  }

  // 1) 站点根 + 固定栏目页
  addUrl(SITE);
  for (const [id] of SECTION_PAGES) addUrl(hashUrl('/' + id));

  // 2) 每篇文章：按 section 拼路径
  const articleUrls = new Set();
  for (const article of articles) {
    const section = String(article && article.section || '');
    const id = String(article && article.id || '');
    const routeSection = ARTICLE_SECTIONS[section];
    if (!routeSection) throw new Error(`文章 ${id || '(无 id)'} 的 section「${section}」没有对应路由`);
    if (!id) throw new Error(`文章索引里有空 id（section=${section}）`);
    articleUrls.add(hashUrl('/' + routeSection + '/' + encodeURIComponent(id)));
  }
  for (const url of articleUrls) addUrl(url);

  // 3) 术语页（293 个词的稳定深链）
  const termIds = glossaryTerms.map(([id]) => String(id)).sort();
  for (const id of termIds) addUrl(hashUrl('/term/' + encodeURIComponent(id)));

  // 4) 标的页：detail 的键就是 #/assets/<symbol> 里的 symbol
  const assetKeys = Object.keys(assetDetails).sort();
  for (const symbol of assetKeys) addUrl(hashUrl('/assets/' + encodeURIComponent(symbol)));

  // 5) 产业链
  for (const chain of chains) {
    if (!chain || !chain.id) throw new Error('INDUSTRY_CHAINS 里有条目缺 id');
    addUrl(hashUrl('/chains/' + encodeURIComponent(chain.id)));
  }

  const sitemap = renderSitemap(urls);
  const counts = {
    sectionPages: SECTION_PAGES.length,
    articles: articleUrls.size,
    terms: termIds.length,
    assets: assetKeys.length,
    chains: chains.length,
    urls: urls.length,
    // 资产专文和标的详情使用同一个 URL，去重后实际 URL 少于「文章 + 标的」之和。
    deduped: articleUrls.size + assetKeys.length - assetKeys.filter((k) => articleUrls.has(hashUrl('/assets/' + encodeURIComponent(k)))).length,
  };
  return { articles, terms: glossaryTerms, assetDetails, chains, pathData, stats, sitemap, counts };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 纯函数：URL 数组 → sitemap XML 文本（末尾带换行，便于 git diff）。 */
export function renderSitemap(urls) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    '  OpenFin Academy sitemap（由 _scripts/gen-seo.mjs 生成，请勿手改）',
    '  本站是哈希路由单页应用，实际页面地址形如 /openfin-academy/#/term/gold。',
    '  搜索引擎通常不会把 URL 片段（# 之后的部分）当作独立页面收录，',
    '  因此下面的 hash URL 只能算尽力而为；静态壳的 canonical 仍指向站点根。',
    '-->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const url of urls) lines.push('  <url><loc>' + escapeXml(url) + '</loc></url>');
  lines.push('</urlset>', '');
  return lines.join('\n');
}

async function compare(expected, file) {
  if (!existsSync(file)) return { ok: false, why: '文件不存在' };
  const actual = await readFile(file, 'utf8');
  if (actual === expected) return { ok: true };
  return {
    ok: false,
    why: `内容不一致（磁盘 ${actual.length} 字节 / 期望 ${expected.length} 字节）`,
  };
}

export async function main() {
  const result = await buildSeo();
  const statsText = JSON.stringify(result.stats, null, 2) + '\n';
  const c = result.counts;
  console.log(
    `[gen-seo] sitemap：站点根 1 · 栏目页 ${c.sectionPages} · 文章 ${c.articles} · `
    + `术语 ${c.terms} · 标的页 ${c.assets} · 产业链 ${c.chains} · 去重后 ${c.urls} 个 URL`,
  );
  console.log(
    `[gen-seo] stats：terms=${result.stats.terms} articles=${result.stats.articles} `
    + `assets=${result.stats.assets} chains=${result.stats.chains} crisis=${result.stats.crisis} `
    + `glossaryCategories=${result.stats.glossaryCategories} generatedAt=${result.stats.generatedAt || '(输入无日期)'}`,
  );

  if (CHECK) {
    const [sitemapCheck, statsCheck] = await Promise.all([
      compare(result.sitemap, SITEMAP_PATH),
      compare(statsText, STATS_PATH),
    ]);
    const bad = [];
    if (!sitemapCheck.ok) bad.push(`sitemap.xml：${sitemapCheck.why}`);
    if (!statsCheck.ok) bad.push(`data/content/stats.json：${statsCheck.why}`);
    if (bad.length) {
      console.error('[gen-seo] 产物与数据不一致，请运行 node _scripts/gen-seo.mjs 并提交：');
      bad.forEach((x) => console.error('  · ' + x));
      return 1;
    }
    console.log('[gen-seo] sitemap.xml 与 data/content/stats.json 均与数据一致 ✓');
    return 0;
  }

  await mkdir(path.dirname(STATS_PATH), { recursive: true });
  await Promise.all([
    writeFile(SITEMAP_PATH, result.sitemap, 'utf8'),
    writeFile(STATS_PATH, statsText, 'utf8'),
  ]);
  console.log(`[gen-seo] 已写入 ${path.relative(ROOT, SITEMAP_PATH)} 与 ${path.relative(ROOT, STATS_PATH)}`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main()
    .then((code) => { if (code) process.exit(code); })
    .catch((e) => { console.error('[gen-seo] 失败：', e.message); process.exit(1); });
}
