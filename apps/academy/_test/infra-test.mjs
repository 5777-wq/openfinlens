#!/usr/bin/env node
/* infra-test.mjs —— SEO / PWA 基础设施契约（node 直跑，无浏览器、无网络、无依赖）
   用法：node _test/infra-test.mjs

   覆盖：
   1. robots.txt / manifest.webmanifest 可解析，关键字段与图标合法；
   2. sw.js 能通过 vm.Script 编译，缓存策略与 precache 清单符合约定；
   3. _scripts/gen-seo.mjs 可 import，产物可复现；--check 能跑通；
   4. sitemap.xml / stats.json 与输入数据一致（每个栏目、文章、术语、标的、链都在）；
   5. js/site/jsonld.js 对五类路由返回带 @context 的对象，serialize 能转义 </script>；
   6. js/site/pwa.js 在 file: 下绝不调用 navigator.serviceWorker。
*/
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://5777-wq.github.io/openfin-academy/';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? '  →  ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);
}

function compile(name, src) {
  try { new vm.Script(src, { filename: name }); return null; }
  catch (e) { return e.message; }
}

/** 沙箱执行浏览器端 IIFE，window 指向自身（与真实浏览器一致）。 */
function loadBrowserScript(file, extra) {
  const sandbox = Object.assign({ console, JSON, Promise, Math, Date, encodeURIComponent, decodeURIComponent }, extra || {});
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  return sandbox;
}

async function main() {
  const index = JSON.parse(await readFile(path.join(ROOT, 'data/content/index.json'), 'utf8'));
  const glossary = JSON.parse(await readFile(path.join(ROOT, 'data/content/glossary.json'), 'utf8'));
  const assetIds = JSON.parse(await readFile(path.join(ROOT, 'data/content/asset-ids.json'), 'utf8'));

  /* ============================================================
     1. robots.txt
     ============================================================ */
  {
    const p = path.join(ROOT, 'robots.txt');
    ok('robots.txt 存在', existsSync(p));
    if (existsSync(p)) {
      const text = await readFile(p, 'utf8');
      ok('robots.txt 允许全站抓取', /^User-agent:\s*\*$/im.test(text) && /^Allow:\s*\/\s*$/im.test(text));
      const m = /^Sitemap:\s*(\S+)\s*$/im.exec(text);
      ok('robots.txt 声明了 sitemap 绝对地址', !!m);
      eq('robots.txt 的 sitemap 指向本站在线地址', m && m[1], SITE + 'sitemap.xml');
      ok('robots.txt 不屏蔽子路径', !/^Disallow:\s*\/\S+/im.test(text));
    }
  }

  /* ============================================================
     2. manifest.webmanifest
     ============================================================ */
  {
    const p = path.join(ROOT, 'manifest.webmanifest');
    ok('manifest.webmanifest 存在', existsSync(p));
    if (existsSync(p)) {
      let m = null;
      try { m = JSON.parse(await readFile(p, 'utf8')); }
      catch (e) { ok('manifest.webmanifest 是合法 JSON', false, e.message); }
      if (m) {
        ok('manifest 可解析', true);
        eq('manifest name', m.name, '白话金融 · OpenFin Academy');
        eq('manifest short_name', m.short_name, '白话金融');
        eq('manifest start_url 是相对子路径', m.start_url, '.');
        eq('manifest display', m.display, 'standalone');
        eq('manifest background_color', m.background_color, '#F2ECDF');
        eq('manifest theme_color', m.theme_color, '#F2ECDF');
        eq('manifest lang', m.lang, 'zh-CN');
        ok('manifest description 非空', typeof m.description === 'string' && m.description.length > 10);
        ok('manifest icons 至少 1 个', Array.isArray(m.icons) && m.icons.length >= 1);
        const icons = Array.isArray(m.icons) ? m.icons : [];
        const badIcon = icons.filter((i) => !i || !/^data:image\/svg\+xml,/.test(String(i.src || ''))
          || i.type !== 'image/svg+xml' || i.sizes !== 'any');
        ok('manifest 图标全是内联 SVG data URI（不引用不存在的文件）', badIcon.length === 0,
          badIcon.map((x) => x && x.src).join(' | '));
        let svgBad = 0;
        for (const i of icons) {
          try {
            const svg = decodeURIComponent(String(i.src).replace(/^data:image\/svg\+xml,/, ''));
            if (!/^<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) svgBad++;
          } catch (e) { svgBad++; }
        }
        ok('manifest 图标的 SVG 可解码且有开闭标签', svgBad === 0, `${svgBad} 个坏图标`);
        const missingFileRefs = icons.filter((i) => !/^data:/.test(String(i.src || ''))
          && !existsSync(path.join(ROOT, String(i.src).replace(/^\.\//, ''))));
        ok('manifest 不引用仓库里不存在的图标文件', missingFileRefs.length === 0,
          missingFileRefs.map((x) => x.src).join(' | '));
      }
    }
  }

  /* ============================================================
     3. sw.js —— 语法 + 保守策略契约
     ============================================================ */
  {
    const p = path.join(ROOT, 'sw.js');
    ok('sw.js 存在', existsSync(p));
    if (existsSync(p)) {
      const src = await readFile(p, 'utf8');
      const err = compile('sw.js', src);
      ok('sw.js 语法可通过 vm.Script 编译', !err, err || '');
      ok('sw.js 版本常量是 ofa-v<数字> 且注明发版要改', /const\s+CACHE\s*=\s*['"]ofa-v\d+['"]/.test(src)
        && /发版时改这里|发版时修改/.test(src));
      ok('sw.js 只处理 GET', /request\.method\s*!==\s*['"]GET['"]/.test(src));
      ok('sw.js 拒绝跨域缓存', /url\.origin\s*!==\s*self\.location\.origin/.test(src));
      ok('sw.js 对 http 只放行 127.0.0.1', /url\.protocol\s*===\s*['"]https:['"]/.test(src)
        && /url\.hostname\s*===\s*['"]127\.0\.0\.1['"]/.test(src));
      ok('sw.js 导航使用 network-first（避免发版后一直看旧页面）',
        /networkFirstNavigation/.test(src) && /network-first/.test(src) && /旧页面|旧壳/.test(src));
      ok('sw.js 数据走 stale-while-revalidate', /staleWhileRevalidate/.test(src)
        && /data\?\/content|data\/content/.test(src) && /data\?\/history|data\/history/.test(src));
      ok('sw.js 静态资源 cache-first + 后台更新', /cacheFirst/.test(src) && /js|mjs|css/.test(src));
      ok('sw.js activate 清理旧版本并 clients.claim', /caches\.delete/.test(src) && /clients\.claim/.test(src));

      const pre = /const\s+PRECACHE\s*=\s*\[([\s\S]*?)\];/.exec(src);
      ok('sw.js 有 PRECACHE 清单', !!pre);
      if (pre) {
        let list = null;
        try { list = vm.runInNewContext('[' + pre[1] + ']'); }
        catch (e) { ok('sw.js PRECACHE 是可求值的数组', false, e.message); }
        if (list) {
          const want = ['./', 'index.html', 'css/tokens.css', 'css/layout.css', 'css/components.css', 'css/aurora.css', 'css/home.css', 'css/motion.css', 'manifest.webmanifest'];
          eq('sw.js precache 只含应用壳（9 项）', list.length, want.length);
          ok('sw.js precache 与约定逐项一致', want.every((x) => list.includes(x)), list.join(' | '));
          ok('sw.js precache 不含 data 文件', !list.some((x) => /(^|\/)data\//.test(x)));
          ok('sw.js precache 不含跨域 URL', !list.some((x) => /^https?:\/\//.test(x)));
        }
      }
      ok('sw.js 不缓存跨域行情请求（跨域在进入策略前直接 return）',
        /if\s*\(!isCacheable\(url\)\)\s*return;/.test(src));
      /* 用最小 SW 全局跑真实 fetch 处理器：跨域 / 非 GET 必须完全不介入。 */
      const handlers = {};
      const fakeCache = {
        addAll() { return Promise.resolve(); },
        put() { return Promise.resolve(); },
        match() { return Promise.resolve(null); },
      };
      const swSelf = {
        location: { origin: 'https://5777-wq.github.io', protocol: 'https:' },
        addEventListener(type, fn) { handlers[type] = fn; },
        clients: { claim() { return Promise.resolve(); } },
        skipWaiting() { return Promise.resolve(); },
      };
      const swSandbox = {
        self: swSelf,
        caches: {
          open() { return Promise.resolve(fakeCache); },
          keys() { return Promise.resolve([]); },
          delete() { return Promise.resolve(true); },
        },
        fetch() { return Promise.resolve({ ok: true, clone() { return this; } }); },
        URL,
        Response: class { constructor(body, init) { this.body = body; this.status = init && init.status; this.ok = false; } },
        console,
        Promise,
        RegExp,
      };
      vm.runInContext(src, vm.createContext(swSandbox), { filename: 'sw.js' });
      ok('sw.js 注册了 install / activate / fetch 三个事件', !!handlers.install && !!handlers.activate && !!handlers.fetch);

      function fetchEvent(method, url, mode) {
        const e = { request: { method, url, mode, headers: { has() { return false; } } }, responded: false };
        e.respondWith = function () { e.responded = true; };
        e.waitUntil = function () {};
        handlers.fetch(e);
        return e;
      }
      const cross = fetchEvent('GET', 'https://push2.eastmoney.com/api/qt/ulist.np/get?x=1', 'cors');
      ok('sw.js 对跨域 GET 不调用 respondWith（直接放行，不缓存行情）', cross.responded === false);
      const post = fetchEvent('POST', 'https://5777-wq.github.io/openfin-academy/data/content/index.json', 'same-origin');
      ok('sw.js 对同源 POST 不介入', post.responded === false);
      const plainHttp = fetchEvent('GET', 'http://example.com/openfin-academy/data/content/index.json', 'cors');
      ok('sw.js 对非 127.0.0.1 的明文 http 不介入缓存', plainHttp.responded === false);
      const nav = fetchEvent('GET', 'https://5777-wq.github.io/openfin-academy/', 'navigate');
      ok('sw.js 对同源导航用 respondWith 接管', nav.responded === true);
      const data = fetchEvent('GET', 'https://5777-wq.github.io/openfin-academy/data/content/index.json', 'same-origin');
      ok('sw.js 对 data/content 请求用 respondWith 接管', data.responded === true);
      const asset = fetchEvent('GET', 'https://5777-wq.github.io/openfin-academy/js/site/pwa.js?v=1', 'same-origin');
      ok('sw.js 对同源 js 资源用 respondWith 接管', asset.responded === true);
      /* 策略行为：导航 network-first、断网回退壳；数据 stale-while-revalidate。 */
      async function runHandler(source, fetchImpl, cachedFor) {
        const localHandlers = {};
        const localCache = {
          addAll() { return Promise.resolve(); },
          put() { return Promise.resolve(); },
          match(req) { return Promise.resolve(cachedFor ? cachedFor(String(req.url || req)) : null); },
        };
        const localSelf = {
          location: { origin: 'https://5777-wq.github.io', protocol: 'https:' },
          addEventListener(type, fn) { localHandlers[type] = fn; },
          clients: { claim() { return Promise.resolve(); } },
          skipWaiting() { return Promise.resolve(); },
        };
        vm.runInContext(source, vm.createContext({
          self: localSelf,
          caches: { open() { return Promise.resolve(localCache); }, keys() { return Promise.resolve([]); }, delete() { return Promise.resolve(true); } },
          fetch: fetchImpl,
          URL,
          Response: class { constructor(body, init) { this.body = body; this.status = init && init.status; this.ok = !!(init && init.status === 200); } clone() { return this; } },
          console,
          Promise,
          RegExp,
        }), { filename: 'sw.js' });
        async function fire(url, mode) {
          let responsePromise = null;
          const waits = [];
          localHandlers.fetch({
            request: { method: 'GET', url, mode, headers: { has() { return false; } } },
            respondWith(p) { responsePromise = p; },
            waitUntil(p) { waits.push(p); },
          });
          const response = responsePromise ? await responsePromise : null;
          await Promise.all(waits);
          return response;
        }
        return fire;
      }
      const navOnline = await runHandler(src,
        async () => ({ ok: true, body: 'fresh-shell', clone() { return this; } }),
        null);
      const onlineNav = await navOnline('https://5777-wq.github.io/openfin-academy/', 'navigate');
      eq('导航 network-first：在线时返回网络响应', onlineNav && onlineNav.body, 'fresh-shell');

      const navOffline = await runHandler(src,
        async () => { throw new Error('offline'); },
        () => ({ ok: true, body: 'cached-shell' }));
      const offlineNav = await navOffline('https://5777-wq.github.io/openfin-academy/#/term/gold', 'navigate');
      eq('导航断网时回退到缓存的 index.html', offlineNav && offlineNav.body, 'cached-shell');
      const noShell = await runHandler(src, async () => { throw new Error('offline'); }, null);
      const emptyNav = await noShell('https://5777-wq.github.io/openfin-academy/', 'navigate');
      eq('导航断网且无壳时返回 503（不白屏也不伪装成功）', emptyNav && emptyNav.status, 503);

      const dataFire = await runHandler(src,
        async () => ({ ok: true, body: 'fresh-data', clone() { return this; } }),
        (url) => (url.endsWith('data/content/index.json') ? { ok: true, body: 'cached-data' } : null));
      // put 计数只在上面 fakeCache 里：这里以「有缓存时立刻返回旧值」为断言。
      const swr = await dataFire('https://5777-wq.github.io/openfin-academy/data/content/index.json', 'same-origin');
      eq('data/content 用 stale-while-revalidate：先返回缓存值', swr && swr.body, 'cached-data');
      /* 再跑一遍，这次记录 cache.put：有缓存时后台必须仍把新数据写回。 */
      let swrPut = 0;
      const putHandlers = {};
      const putCache = {
        addAll() { return Promise.resolve(); },
        put() { swrPut++; return Promise.resolve(); },
        match() { return Promise.resolve({ ok: true, body: 'cached-data' }); },
      };
      const putSelf = {
        location: { origin: 'https://5777-wq.github.io', protocol: 'https:' },
        addEventListener(type, fn) { putHandlers[type] = fn; },
        clients: { claim() { return Promise.resolve(); } },
        skipWaiting() { return Promise.resolve(); },
      };
      vm.runInContext(src, vm.createContext({
        self: putSelf,
        caches: { open() { return Promise.resolve(putCache); }, keys() { return Promise.resolve([]); }, delete() { return Promise.resolve(true); } },
        fetch: async () => ({ ok: true, body: 'fresh-data', clone() { return this; } }),
        URL,
        Response: class { constructor(body, init) { this.body = body; this.status = init && init.status; this.ok = !!(init && init.status === 200); } clone() { return this; } },
        console,
        Promise,
        RegExp,
      }), { filename: 'sw.js' });
      let swrResponse = null;
      const swrWaits = [];
      putHandlers.fetch({
        request: { method: 'GET', url: 'https://5777-wq.github.io/openfin-academy/data/history/SPX.json', mode: 'same-origin', headers: { has() { return false; } } },
        respondWith(p) { swrResponse = p; },
        waitUntil(p) { swrWaits.push(p); },
      });
      await Promise.all([swrResponse, ...swrWaits]);
      eq('data/history 有缓存时仍后台写回新响应', swrPut, 1);
    }
  }

  /* ============================================================
     4. gen-seo.mjs —— 可 import、可复现、--check 跑得通
     ============================================================ */
  const gen = await import(pathToFileURL(path.join(ROOT, '_scripts/gen-seo.mjs')).href);
  ok('gen-seo.mjs 导出 buildSeo', typeof gen.buildSeo === 'function');
  ok('gen-seo.mjs 导出 main', typeof gen.main === 'function');

  const builtA = await gen.buildSeo();
  const builtB = await gen.buildSeo();
  eq('gen-seo 两次生成的 sitemap 字节一致（幂等）', builtA.sitemap, builtB.sitemap);
  eq('gen-seo 两次生成的 stats 字节一致（幂等）',
    JSON.stringify(builtA.stats, null, 2), JSON.stringify(builtB.stats, null, 2));
  ok('gen-seo 的 generatedAt 来自输入而非当前时间',
    typeof builtA.stats.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(builtA.stats.generatedAt),
    builtA.stats.generatedAt);

  const check = spawnSync(process.execPath, [path.join(ROOT, '_scripts/gen-seo.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  ok('node _scripts/gen-seo.mjs --check 退出码为 0', check.status === 0,
    `status=${check.status} stderr=${String(check.stderr || '').trim().slice(0, 500)}`);

  /* ============================================================
     5. sitemap.xml / stats.json 与输入一致
     ============================================================ */
  {
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    ok('sitemap.xml 存在（先运行 node _scripts/gen-seo.mjs）', existsSync(sitemapPath));
    const sitemap = existsSync(sitemapPath) ? await readFile(sitemapPath, 'utf8') : '';
    ok('sitemap.xml 是 XML urlset', /^<\?xml[^>]*\?>/.test(sitemap)
      && /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(sitemap)
      && /<\/urlset>\s*$/.test(sitemap));
    ok('sitemap.xml 文件头解释 hash 路由收录有限', /hash|URL 片段|片段/i.test(sitemap.slice(0, 600)));
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    ok('sitemap.xml 所有 loc 都是本站绝对地址', locs.length > 0 && locs.every((u) => u.startsWith(SITE)),
      locs.filter((u) => !u.startsWith(SITE)).slice(0, 3).join(' | '));
    ok('sitemap.xml 没有重复 URL', new Set(locs).size === locs.length,
      `${locs.length} 个 loc / ${new Set(locs).size} 个唯一`);

    const sections = ['concepts', 'crisis', 'assets', 'chains', 'cycles', 'family', 'reports', 'path', 'terms', 'data',
      'compare', 'curve', 'analogy', 'calc', 'saved', 'quiz', 'status'];
    const expected = new Set([SITE]);
    for (const s of sections) expected.add(SITE + '#/' + s);
    const ARTICLE_SECTIONS = { concepts: 'concepts', crisis: 'crisis', assets: 'assets', cycles: 'cycles', family: 'family', reports: 'reports' };
    for (const a of index.items || []) {
      const sec = ARTICLE_SECTIONS[a.section];
      if (sec) expected.add(SITE + '#/' + sec + '/' + encodeURIComponent(a.id));
    }
    for (const id of Object.keys(glossary.terms || {})) expected.add(SITE + '#/term/' + encodeURIComponent(id));
    for (const symbol of Object.keys(assetIds.detail || {})) expected.add(SITE + '#/assets/' + encodeURIComponent(symbol));

    const chainSandbox = { window: {} };
    vm.runInContext(readFileSync(path.join(ROOT, 'vendor/core/industry-chains.js'), 'utf8'),
      vm.createContext(chainSandbox), { filename: 'industry-chains.js' });
    const chains = chainSandbox.window.INDUSTRY_CHAINS || [];
    for (const c of chains) expected.add(SITE + '#/chains/' + encodeURIComponent(c.id));

    const missing = [...expected].filter((u) => !locs.includes(u));
    const extra = locs.filter((u) => !expected.has(u));
    eq('sitemap.xml 覆盖站点根 + 全部栏目 / 文章 / 术语 / 标的 / 产业链且无多余项',
      missing.length + extra.length, 0);
    if (missing.length || extra.length) {
      ok('  · sitemap 缺项示例', missing.length === 0, missing.slice(0, 5).join(' | '));
      ok('  · sitemap 多项示例', extra.length === 0, extra.slice(0, 5).join(' | '));
    }

    const statsPath = path.join(ROOT, 'data/content/stats.json');
    ok('data/content/stats.json 存在', existsSync(statsPath));
    let stats = null;
    if (existsSync(statsPath)) {
      try { stats = JSON.parse(await readFile(statsPath, 'utf8')); }
      catch (e) { ok('stats.json 是合法 JSON', false, e.message); }
    }
    if (stats) {
      const categories = new Set(Object.values(glossary.terms || {}).map((t) => t && t.cat).filter(Boolean));
      eq('stats.generatedAt 与输入一致', stats.generatedAt, builtA.stats.generatedAt);
      eq('stats.terms 与术语库一致', stats.terms, Object.keys(glossary.terms || {}).length);
      eq('stats.articles 与内容索引一致', stats.articles, (index.items || []).length);
      eq('stats.assets 与标的清单一致', stats.assets, Object.keys(assetIds.detail || {}).length);
      eq('stats.chains 与产业链一致', stats.chains, chains.length);
      eq('stats.crisis 与危机文章数一致',
        stats.crisis, (index.items || []).filter((a) => a.section === 'crisis').length);
      eq('stats.glossaryCategories 与术语分类数一致', stats.glossaryCategories, categories.size);
      eq('stats 字段集合与任务约定一致', Object.keys(stats).sort().join(','),
        ['generatedAt', 'terms', 'articles', 'assets', 'chains', 'crisis', 'glossaryCategories'].sort().join(','));
    }
  }

  /* ============================================================
     6. jsonld.js
     ============================================================ */
  {
    const jsonldPath = path.join(ROOT, 'js/site/jsonld.js');
    ok('js/site/jsonld.js 存在', existsSync(jsonldPath));
    if (existsSync(jsonldPath)) {
      const src = await readFile(jsonldPath, 'utf8');
      const err = compile('jsonld.js', src);
      ok('jsonld.js 语法可通过 vm.Script 编译', !err, err || '');
      const sandbox = loadBrowserScript('js/site/jsonld.js');
      const J = sandbox.JsonLd;
      ok('jsonld.js 暴露 window.JsonLd.build', J && typeof J.build === 'function');
      ok('jsonld.js 暴露 window.JsonLd.serialize', J && typeof J.serialize === 'function');

      if (J) {
        const five = [
          ['home', {}, {}, 'WebSite'],
          ['concept', { id: 'inflation' }, { title: '通胀', dek: 'D', dataAsOf: '2026-10-21' }, 'Article'],
          ['asset', { id: 'gold' }, { article: { title: '黄金', dek: 'D', dataAsOf: '2026-10-21' } }, 'Article'],
          ['term', { id: 'gold' }, { term: { term: '黄金', one: 'O', alias: 'gold', cat: 'asset' } }, 'DefinedTerm'],
          ['chains', {}, {}, 'BreadcrumbList'],
        ];
        for (const [route, params, data, type] of five) {
          const obj = J.build(route, params, data);
          ok(`jsonld ${route} 返回带 @context 的对象`, !!obj && obj['@context'] === 'https://schema.org',
            JSON.stringify(obj && obj['@context']));
          eq(`jsonld ${route} 的 @type`, obj && obj['@type'], type);
        }
        const article = J.build('concept', { id: 'inflation' }, { title: '通胀', dek: 'D', dataAsOf: '2026-10-21' });
        ok('jsonld Article 的 URL 是本站 hash 深链',
          /^https:\/\/5777-wq\.github\.io\/openfin-academy\/#\/concepts\//.test(article.url || ''),
          article.url);
        ok('jsonld DefinedTerm 有 inDefinedTermSet',
          !!J.build('term', { id: 'gold' }, { term: { term: '黄金' } }).inDefinedTermSet);
        ok('jsonld BreadcrumbList 有 position 连续的条目',
          J.build('chains', {}, {}).itemListElement.every((it, i) => it.position === i + 1));

        const dirty = { text: '</script><script>alert(1)</script>', line: 'a\u2028b\u2029c', amp: 'a&b' };
        const serialized = J.serialize(dirty);
        ok('JsonLd.serialize 转义了 </script>', !serialized.includes('</script>'));
        var BS = String.fromCharCode(92);
        ok('JsonLd.serialize 用转义码形式转义 <', serialized.includes(BS + 'u003c'));
        ok('JsonLd.serialize 转义 U+2028/U+2029', serialized.includes(BS + 'u2028') && serialized.includes(BS + 'u2029'));
        let roundtrip = null;
        try { roundtrip = JSON.parse(serialized); } catch (e) { /* 下面断言 */ }
        eq('JsonLd.serialize 的结果仍可 JSON.parse 还原', JSON.stringify(roundtrip), JSON.stringify(dirty));
      }
    }
  }

  /* ============================================================
     7. pwa.js —— file: 下不碰 navigator.serviceWorker
     ============================================================ */
  {
    const pwaPath = path.join(ROOT, 'js/site/pwa.js');
    ok('js/site/pwa.js 存在', existsSync(pwaPath));
    if (existsSync(pwaPath)) {
      const src = await readFile(pwaPath, 'utf8');
      const err = compile('pwa.js', src);
      ok('pwa.js 语法可通过 vm.Script 编译', !err, err || '');

      let registerCalls = 0;
      const sandbox = loadBrowserScript('js/site/pwa.js', {
        location: { protocol: 'file:', hostname: '', search: '', href: 'file:///D:/openfin-academy/index.html' },
        navigator: {
          serviceWorker: {
            register() { registerCalls++; return Promise.resolve({}); },
          },
        },
      });
      const P = sandbox.PWA;
      ok('pwa.js 暴露 window.PWA.register', P && typeof P.register === 'function');
      ok('pwa.js 暴露 window.PWA.supported', P && typeof P.supported === 'function');
      ok('PWA.supported() 在存在 serviceWorker 时为 true', !!P && P.supported() === true);
      const result = await P.register();
      eq('file: 下 register 返回 false', result, false);
      eq('file: 下绝不应该调用 navigator.serviceWorker.register', registerCalls, 0);

      // 开发环境防缓存：127.0.0.1 默认不注册，加 ?pwa=1 才注册。
      const local = loadBrowserScript('js/site/pwa.js', {
        location: { protocol: 'http:', hostname: '127.0.0.1', search: '?debug=1', href: 'http://127.0.0.1:8765/?debug=1' },
        navigator: { serviceWorker: { register() { registerCalls++; return Promise.resolve({}); } } },
      });
      const off = await local.PWA.register();
      eq('127.0.0.1 默认不注册 Service Worker', off, false);
      eq('127.0.0.1 默认没有调用 register', registerCalls, 0);
      local.location.search = '?pwa=1';
      const localOn = await local.PWA.register();
      eq('127.0.0.1 + ?pwa=1 才允许注册', localOn, true);
      eq('127.0.0.1 + ?pwa=1 调用了 register 一次', registerCalls, 1);
      ok('PWA 注册路径是子路径安全的 ./sw.js', /SW_PATH\s*=\s*['"]\.\/sw\.js['"]/.test(src));

      // 重复调用不应反复注册：页面里 boot 与视图都可能调用一次。
      let repeatCalls = 0;
      const repeat = loadBrowserScript('js/site/pwa.js', {
        location: { protocol: 'https:', hostname: '5777-wq.github.io', search: '', href: 'https://5777-wq.github.io/openfin-academy/' },
        navigator: { serviceWorker: { register() { repeatCalls++; return Promise.resolve({}); } } },
      });
      await Promise.all([repeat.PWA.register(), repeat.PWA.register()]);
      await repeat.PWA.register();
      eq('重复调用 PWA.register 只注册一次', repeatCalls, 1);
    }
  }
}

main()
  .then(() => {
    console.log(`基础设施测试：通过 ${pass} 条，失败 ${fail} 条`);
    if (fail) {
      console.error('失败项：');
      failures.forEach((f) => console.error('  × ' + f));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error('基础设施测试异常：', e && e.stack ? e.stack : e);
    process.exit(1);
  });
