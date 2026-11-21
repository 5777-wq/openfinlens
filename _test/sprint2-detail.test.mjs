/* sprint2-detail.test.mjs —— S2 切片：K 线详情三合一联动 + 数据源健康度浮层 + 港股备源扩容
   · AppMatch 纯匹配函数（matchChain / assetHref）：从 app.js 源码抽出真块在 vm 里跑，
     配真实 INDUSTRY_CHAINS / AcademyAssets 数据文件（不手工复刻，防漂移——同 detail.test.mjs 纪律）。
   · 详情上下文挂载 / 一键加入对比 / 健康度浮层 / HK_BLUE_CHIPS：源码级静态断言钉关键路径。
   用法：node _test/sprint2-detail.test.mjs（纯离线） */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'apps', 'terminal');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

/* ---- 最小 window 环境：utils.js 只在调用时才碰 DOM，顶层可加载 ---- */
const ctx = {
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Infinity,
  setTimeout, clearTimeout, Promise, Error, RegExp, Map, Set, encodeURIComponent, decodeURIComponent,
  document: { createElement: () => ({ style: {} }), querySelectorAll: () => [] },
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
const APP_SRC_RAW = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const APP_SRC = APP_SRC_RAW.replace(/\r\n/g, '\n');   // 源文件 CRLF：静态断言统一按 LF 处理
const SHELL_CSS = readFileSync(path.join(ROOT, 'css', 'ui', '01-shell.css'), 'utf8').replace(/\r\n/g, '\n');
const PANELS_CSS = readFileSync(path.join(ROOT, 'css', 'ui', '03-panels.css'), 'utf8').replace(/\r\n/g, '\n');

load('js/utils.js');
load('js/data/industry-chains.js');
load('js/data/academy-assets.js');

/* ---- 抽出 app.js 里的 window.AppMatch 真 IIFE（测线上代码，不是副本） ---- */
const appMatchSrc = (() => {
  const m = APP_SRC.match(/window\.AppMatch = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/);
  if (!m) throw new Error('app.js 源码中找不到 window.AppMatch 块');
  return m[0];
})();
vm.runInContext(appMatchSrc, ctx, { filename: 'app.js#AppMatch' });
const AppMatch = vm.runInContext('window.AppMatch', ctx);
const W = vm.runInContext('window', ctx);

/* ================= AppMatch：归一与别名 ================= */
await test('canonSymbol：裸美股 ticker 与 us 前缀形态归一到同键（U.normUsSymbol 真源）', () => {
  assert.equal(AppMatch.canonSymbol('usAAPL'), 'usaapl');
  assert.equal(AppMatch.canonSymbol('AAPL'), 'usaapl');
  assert.equal(AppMatch.canonSymbol('hk00700'), 'hk00700');
  assert.equal(AppMatch.canonSymbol('sh600519'), 'sh600519');
  assert.equal(AppMatch.canonSymbol('BTCUSDT'), 'btcusdt');   // 币对不是美股裸码，normUsSymbol 拒收
  assert.equal(AppMatch.canonSymbol(''), '');
  assert.equal(AppMatch.canonSymbol(null), '');
});

await test('aliasKeys：裸码/EM:116 ↔ hk 前缀等别名侧与索引侧共用一套', () => {
  assert.equal(AppMatch.aliasKeys('sh600519').join('|'), 'sh600519|600519');   // vm 数组跨 realm，deepStrictEqual 不认
  assert.equal(AppMatch.aliasKeys('600519').join('|'), '600519');
  assert.ok(AppMatch.aliasKeys('usTSLA').indexOf('tsla') >= 0, '裸美股 ticker 别名');
  assert.ok(AppMatch.aliasKeys('EM:116.00700').indexOf('hk00700') >= 0, 'EM:116.xxxxx ↔ hkxxxxx');
  assert.ok(AppMatch.aliasKeys('EM:105.AAPL').indexOf('usaapl') >= 0, 'EM:105/106/107 ↔ us 前缀');
  assert.equal(AppMatch.aliasKeys('').join('|'), '');
});

/* ================= AppMatch：产业链匹配（真实 INDUSTRY_CHAINS） ================= */
await test('matchChain：腾讯格式 / 裸 6 位 / 裸美股 / 裸港股 5 位 / EM 形态都能命中真实链条', () => {
  const hit1 = AppMatch.matchChain('sz002460');
  assert.equal(hit1.chainId, 'nev');
  assert.equal(hit1.chainName, '新能源车');
  assert.equal(hit1.linkName, '锂矿资源');
  assert.equal(hit1.stockName, '赣锋锂业');
  const hit2 = AppMatch.matchChain('300750');            // 裸 6 位（搜索/榜单详情可能只有裸码）
  assert.equal(hit2.chainId, 'nev');
  assert.equal(hit2.stockName, '宁德时代');
  const hit3 = AppMatch.matchChain('usTSLA');
  assert.equal(hit3.chainId, 'nev');
  assert.equal(hit3.stockName, '特斯拉');
  assert.equal(AppMatch.matchChain('ASML').chainId, 'semicon', '裸美股 ticker 命中');
  assert.ok(AppMatch.matchChain('hk01810'), '链内港股成员（hk01810）');
  assert.ok(AppMatch.matchChain('01810'), '裸 5 位港股命中');
  assert.equal(AppMatch.matchChain('sh600519'), null, '不在任何链里的标的（贵州茅台）→ null');
  assert.equal(AppMatch.matchChain('BTCUSDT'), null);
  assert.equal(AppMatch.matchChain(''), null);
});

await test('matchChain：自洽——真实清单里每个成员 symbol 都能被自己命中', () => {
  const chains = W.INDUSTRY_CHAINS;
  assert.ok(Array.isArray(chains) && chains.length >= 10, '链清单已加载（' + chains.length + ' 条）');
  let members = 0;
  chains.forEach(c => {
    assert.ok(c.id && c.name, '链条带 id/name：' + c.id);
    c.links.forEach(l => {
      assert.ok(l.name, '环节带 name');
      l.stocks.forEach(s => {
        members++;
        assert.ok(s.symbol && s.name, '成员带 symbol/name');
        const hit = AppMatch.matchChain(s.symbol, chains);
        assert.ok(hit, '成员自命中失败：' + s.symbol);
        assert.ok(hit.chainId && hit.linkName, '命中结构完整：' + s.symbol);
      });
    });
  });
  assert.ok(members >= 150, '成员规模（' + members + '）');
});

await test('matchChain：chains 参数可注入（vm 可测），缺省回读 window.INDUSTRY_CHAINS', () => {
  const mini = [{ id: 't', name: '测试链', links: [{ name: '环节A', stocks: [{ name: '甲', symbol: 'sz000001' }] }] }];
  assert.equal(AppMatch.matchChain('sz000001', mini).chainName, '测试链');
  assert.ok(typeof W.INDUSTRY_CHAINS === 'object' && AppMatch.matchChain('usNVDA'), '缺省读 window.INDUSTRY_CHAINS');
});

/* ================= AppMatch：标的百科链接（真实 AcademyAssets） ================= */
await test('assetHref：命中科普站标的页 → 稳定 href；未命中（假入口）→ null', () => {
  const A = W.AcademyAssets;
  assert.ok(Array.isArray(A.symbols) && A.symbols.length >= 100, 'AcademyAssets.symbols 已加载');
  // id 就是清单里的终端符号本体；sym 带回查询原词
  assert.equal(AppMatch.assetHref('usAAPL'), 'academy/#/assets/usAAPL?from=lens&sym=usAAPL');
  assert.equal(AppMatch.assetHref('AAPL'), 'academy/#/assets/usAAPL?from=lens&sym=AAPL', '裸 ticker 也命中同一页');
  assert.equal(AppMatch.assetHref('600519'), 'academy/#/assets/sh600519?from=lens&sym=600519', '裸 6 位 A股');
  assert.equal(AppMatch.assetHref('hk00700'), 'academy/#/assets/hk00700?from=lens&sym=hk00700');
  assert.equal(AppMatch.assetHref('BTCUSDT'), null, '科普站没有币对标的名（假入口不给）');
  assert.equal(AppMatch.assetHref('usZZZZZ'), null, '不在清单的美股 → null');
  assert.equal(AppMatch.assetHref(''), null);
  // 清单里每一个都能给出链接（不给半空页的承诺要双向成立）
  A.symbols.forEach(s => assert.ok(AppMatch.assetHref(s), '清单内标的取不到链接：' + s));
});

await test('assetHref：assets 参数可注入，缺省回读 window.AcademyAssets', () => {
  const mini = { symbols: ['usMSFT'] };
  assert.equal(AppMatch.assetHref('MSFT', mini), 'academy/#/assets/usMSFT?from=lens&sym=MSFT');
  assert.equal(AppMatch.assetHref('MSFT', { symbols: [] }), null);
});

/* ================= 源码级静态断言：详情上下文挂载 ================= */
await test('mountDetailContext：产业链胶囊构造（chain-pill · setTab(chain) · 插在 detailStats 之前）', () => {
  const fn = APP_SRC.match(/function mountDetailContext\(t\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(fn.includes('window.AppMatch'), '消费 window.AppMatch');
  assert.ok(fn.includes('matchChain'), '走 matchChain');
  assert.ok(fn.includes("className = 'pill chain-pill'"), '胶囊 class= pill chain-pill');
  assert.ok(fn.includes("setTab('chain')"), '点击进产业链页');
  assert.ok(fn.includes('detailStats.parentNode.insertBefore'), '插在 detailStats 之前');
  assert.ok(fn.includes('.detail-context'), '残留清理按 .detail-context 摘除');
  assert.ok(fn.includes('hit.chainName + \' · \' + hit.linkName'), '胶囊文案 = 链条名 · 环节');
});

await test('mountDetailContext：白话标的百科链接（assetHref · academy/#/assets · target=_blank · 科普总开关）', () => {
  const fn = APP_SRC.match(/function mountDetailContext\(t\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(fn.includes('assetHref'), '走 assetHref');
  assert.ok(fn.includes('白话标的百科 ↗'), '链接文案');
  assert.ok(fn.includes("target = '_blank'") && fn.includes("'noopener'"), '新开页 + noopener');
  assert.ok(fn.includes("academy !== false"), '设置里关掉科普站则不给链接（对齐 detailGloss 总开关）');
  assert.ok(fn.includes(".detail-asset-link"), 'class 与 CSS 对上');
});

await test('loadTechnical 开头挂载详情上下文（sigCard 之前，不依赖日K 结果）', () => {
  const fn = APP_SRC.match(/async function loadTechnical\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(fn.includes('mountDetailContext(t)'), 'loadTechnical 内调用挂载');
  const mIdx = fn.indexOf('mountDetailContext(t)');
  const sigIdx = fn.indexOf('renderCard');
  assert.ok(mIdx >= 0 && sigIdx > mIdx, '挂载点在信号卡渲染之前');
});

/* ================= 源码级静态断言：一键加入对比 ================= */
await test('一键加入对比：CompareView 复用（键 cmp · MAX_FUNDS=8 · 去重 · 满员诚实提示）', () => {
  assert.ok(APP_SRC.includes('function ensureCompareBtn()'), 'ensureCompareBtn 存在');
  assert.ok(APP_SRC.includes('function addCurrentToCompare()'), 'addCurrentToCompare 存在');
  const add = APP_SRC.match(/function addCurrentToCompare\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(add.includes('window.CompareView'), '复用 CompareView（存储键 cmp / addItem / 持久化都归它）');
  assert.ok(add.includes('cv.MAX_FUNDS || 8'), '上限读 CompareView.MAX_FUNDS（8）');
  assert.ok(add.includes('对比列表已满'), '满员诚实提示文案');
  assert.ok(add.includes('compareHas(t)'), '先去重再塞入');
  assert.ok(add.includes('AlertCenter.toast'), '满员走既有 toast');
  assert.ok(add.includes('compareBtnFlash'), '按钮文字 1.2s 反馈');
  const sup = APP_SRC.match(/function compareSupported\(t\) \{[\s\S]*?\n  \}/)[0];
  ['cn', 'hk', 'us', 'crypto'].forEach(m => assert.ok(sup.includes("'" + m + "'"), '放行 ' + m));
  assert.ok(sup.includes('^(sh|sz|bj)'), 'A股指数（sh/sz/bj）放行');
  const btn = APP_SRC.match(/function ensureCompareBtn\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(btn.includes('el.maToggle.parentNode.insertBefore'), '插在 maToggle 前（ensureVegasToggle 同款）');
  assert.ok(btn.includes("className = 'pill cmp-add-btn'"), 'pill 形态');
  assert.ok(APP_SRC.includes('ensureCompareBtn();\n    syncCompareBtn();'), 'openDetail 已接线');
});

/* ================= 源码级静态断言：数据源健康度浮层 ================= */
await test('健康度浮层：四市场 heatVia 文案映射（primary/tencent/cache/recent/backup/none/null）', () => {
  assert.ok(APP_SRC.includes("HEAT_MKT_NAMES = { cn: 'A股', hk: '港股', us: '美股', crypto: '加密' }"), '四市场都在');
  assert.ok(APP_SRC.includes("primary: '主源直连'"), 'primary 文案');
  assert.ok(APP_SRC.includes("tencent: '腾讯备源'"), 'tencent 文案');
  assert.ok(APP_SRC.includes("cache: '缓存'"), 'cache 文案');
  assert.ok(APP_SRC.includes("HEAT_BACKUP_LABELS"), 'backup 分市场措辞（A股=腾讯精选兜底 / 加密=OKX 备源）');
  const via = APP_SRC.match(/function heatViaLabel\(mkt\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(via.includes("'recent'"), 'recent 分支');
  assert.ok(via.includes('fmtAgo'), 'recent 主源·N前 用 fmtAgo');
  assert.ok(via.includes("'未加载'"), 'null → 未加载');
  assert.ok(via.includes("indexOf('backup') === 0"), 'backup 前缀（含 A股「backup·已剔除指数 N」装饰串）');
});

await test('健康度浮层：产物新鲜度读运行时 state（events + us-signals 的 generatedAt 补存）', () => {
  assert.ok(APP_SRC.includes('state.usSigGeneratedAt = j.generatedAt'), 'ensureUsSigMap 补存 us-signals generatedAt');
  assert.ok(APP_SRC.includes('state.eventsGeneratedAt = generatedAt || null'), 'loadEvents 补存事件 generatedAt');
  const html = APP_SRC.match(/function healthPanelHTML\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(html.includes('state.eventsGeneratedAt'), '全球事件新鲜度');
  assert.ok(html.includes('state.usSigGeneratedAt'), '美股信号新鲜度');
  assert.ok(html.includes('healthStamp'), 'fmtTime/fmtDay 口径的时间戳');
});

await test('健康度浮层：SW 版本读取 + 刷新缓存（caches 全删 + reload，不 confirm）', () => {
  const sw = APP_SRC.match(/function swVersionLabel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(sw.includes('navigator.serviceWorker'), '读 SW controller');
  assert.ok(sw.includes('/ofl-v\\d+/'), 'scriptURL 匹配 ofl-vN');
  assert.ok(sw.includes("'未注册'"), '无 SW → 未注册');
  const build = APP_SRC.match(/function buildHealthPanel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(build.includes('caches.keys'), 'Cache Storage 全清');
  assert.ok(build.includes('caches.delete'), '逐键删除');
  assert.ok(build.includes('location.reload()'), '清完整页重载');
  assert.ok(!build.includes('confirm'), '不弹 confirm');
  assert.ok(build.includes("'清除中…'"), '按钮态变化');
});

await test('健康度浮层：aria（role=dialog / aria-label / aria-expanded）+ liveStat 绑定 + 关闭模式', () => {
  const build = APP_SRC.match(/function buildHealthPanel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(build.includes("'dialog'"), 'role=dialog');
  assert.ok(build.includes("'数据源健康度'"), 'aria-label');
  const bind = APP_SRC.match(/if \(el\.liveStat\) \{[\s\S]*?\n    \}/)[0];
  assert.ok(bind.includes("toggleHealthPanel"), 'liveStat click 绑定在 bindEvents 区');
  assert.ok(bind.includes("'Enter'") && bind.includes("' '"), '键盘 Enter/Space 等价');
  assert.ok(bind.includes("aria-haspopup', 'dialog'"), 'aria-haspopup');
  assert.ok(bind.includes("aria-expanded", ), 'aria-expanded 动态同步');
  assert.ok(bind.includes("closest('#liveStat')"), '点浮层/触发器外才收（对齐 alerts.js）');
  assert.ok(APP_SRC.includes("if (healthPanel && !healthPanel.hidden) { closeHealthPanel(); return; }"), 'Esc 键序在铃铛面板之后');
  assert.ok(APP_SRC.includes('function openHealthPanel()'), 'open/close/toggle 三件套');
  assert.ok(APP_SRC.includes('healthPanel.innerHTML = healthPanelHTML()'), '每次打开按当前 state 现组装（不新发请求）');
});

await test('anyModalOpen 已补定义（原 app.js:6505 调用未定义，详情 Esc 会 ReferenceError）', () => {
  const defs = (APP_SRC.match(/function anyModalOpen\(\)/g) || []).length;
  assert.equal(defs, 1, '定义恰好一次');
  const fn = APP_SRC.match(/function anyModalOpen\(\) \{[\s\S]*?\n  \}/)[0];
  ['healthPanel', 'alertModal', 'alertPanel', 'settingsModal', 'searchResults'].forEach(k => assert.ok(fn.includes(k), '弹层清单含 ' + k));
  assert.ok(APP_SRC.includes('!anyModalOpen()'), 'Backspace/Esc 返回守卫仍走它');
});

/* ================= 源码级静态断言：港股蓝筹备源池 ================= */
await test('HK_BLUE_CHIPS：60~80 只、hk+5位格式、无重复、ensureHKRows 已切换并统一「港股蓝筹」', () => {
  const m = APP_SRC.match(/const HK_BLUE_CHIPS = \[([\s\S]*?)\n  \];/);
  assert.ok(m, '常量存在（ensureHKRows 附近）');
  const entries = [...m[1].matchAll(/\{\s*symbol:\s*'(hk\d{5})',\s*name:\s*'([^']+)'\s*\}/g)];
  assert.ok(entries.length >= 60 && entries.length <= 80, '条数在 60~80（实际 ' + entries.length + '）');
  const syms = entries.map(e => e[1]);
  assert.equal(new Set(syms).size, syms.length, 'symbol 无重复');
  syms.forEach(s => assert.ok(/^hk\d{5}$/.test(s), '格式 hk+5位：' + s));
  const names = entries.map(e => e[2]);
  names.forEach(n => assert.ok(n.length >= 2 && n.length <= 12, '名称合理：' + n));
  const rows = APP_SRC.match(/async function ensureHKRows\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(rows.includes('HK_BLUE_CHIPS'), '备源池已切换为 HK_BLUE_CHIPS');
  assert.ok(rows.includes("'港股蓝筹'"), 'industry 统一「港股蓝筹」');
  assert.ok(rows.includes('q && q.marketCap'), '市值有值才入列（与主兜底一致）');
  assert.ok(rows.includes("getQuotes(hk.map(u => u.symbol))"), '走腾讯批量报价（60/批 → 两次请求内）');
  assert.ok(!rows.includes("industry: '港股精选'"), '旧「港股精选」标签已替换');
});

await test('HK_BLUE_CHIPS 与 TENCENT_UNIVERSE 港股符号格式同构（腾讯源可直接报价）', () => {
  const uni = readFileSync(path.join(ROOT, 'js', 'data', 'universe.js'), 'utf8');
  const uniHk = [...uni.matchAll(/'(hk\d{5})'/g)].map(m => m[1]);
  assert.ok(uniHk.length > 0, 'universe 港股符号存在');
  const m = APP_SRC.match(/const HK_BLUE_CHIPS = \[([\s\S]*?)\n  \];/);
  [...m[1].matchAll(/'(hk\d{5})'/g)].forEach(x => assert.ok(/^hk\d{5}$/.test(x[1]), x[1]));
});

/* ================= CSS：新类都在对应文件尾部 ================= */
await test('01-shell.css 尾部：health-panel 卡面（--r-lg + --shadow-2 + 340px + right 对齐 + dialog 层级）', () => {
  assert.ok(SHELL_CSS.includes('.health-panel {'), '.health-panel 存在');
  assert.ok(SHELL_CSS.includes('.live-stat { position: relative; }'), 'liveStat 作定位锚');
  const block = SHELL_CSS.slice(SHELL_CSS.indexOf('.health-panel {'));
  assert.ok(block.includes('width: 340px'), '宽 ~340px');
  assert.ok(block.includes('var(--r-lg)'), '--r-lg 卡');
  assert.ok(block.includes('var(--shadow-2)'), '--shadow-2');
  assert.ok(block.includes('right: 0'), 'right 对齐 live-stat');
  assert.ok(block.includes('z-index: 130'), '与 .alert-panel 同层级');
  assert.ok(block.includes('top: calc(100% + 10px)'), 'alert-panel 同款定位语言');
  ['.hp-head', '.hp-cap', '.hp-row', '.hp-foot'].forEach(c => assert.ok(SHELL_CSS.includes(c + ' '), '配套类 ' + c));
});

await test('03-panels.css 尾部：chain-pill / detail-context / detail-asset-link', () => {
  ['.detail-context {', '.detail-context .chain-pill', '.detail-gloss.detail-asset-link'].forEach(c =>
    assert.ok(PANELS_CSS.includes(c), '类存在 ' + c));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
