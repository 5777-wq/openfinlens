#!/usr/bin/env node
/* navmap.test.mjs —— 一级/二级导航映射（纯函数，无 DOM 无网络）
 *
 * 为什么单独一组：v2 把 12 个一级 tab 合并成 5 个一级入口，但**内部 state.tab 的钥匙
 * 一个都不能变**（深链 #tab=cn、tabscope 自定义顺序、zones 分区判定、marketscope 归属
 * 全都挂在旧 key 上）。映射一旦漂移，表现是"点 A股 跳到美股"或"刷新回首页"这种
 * 没人会归因到映射表上的怪现象，所以把它钉死在这里。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
};
const assert = {
  ok: (v, m) => { if (!v) throw new Error(m || '断言失败'); },
  equal: (a, b, m) => { if (a !== b) throw new Error((m || '不相等') + `：${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
  deep: (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '不相等') + `：${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
};

/* 用假 window 载入（与项目其他测试同套路：浏览器脚本 + node 可测） */
const src = readFileSync(path.join(ROOT, 'js/ui/navmap.js'), 'utf8');
const sandbox = { window: {}, globalThis: {} };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'js/ui/navmap.js' });
const Nav = sandbox.window.Navmap || sandbox.Navmap || sandbox.window.NavMap;
assert.ok(Nav, 'js/ui/navmap.js 没有把模块挂到 window.Navmap 上');

const ALL_TABS = ['all', 'cn', 'hk', 'us', 'crypto', 'fxmacro', 'option', 'events', 'chain', 'watch', 'portfolio', 'compare'];

test('5 个一级入口，且每个一级都有 label 与非空子项', () => {
  const P = Nav.PRIMARY_DEFS;
  assert.ok(Array.isArray(P), 'PRIMARY_DEFS 应为数组');
  assert.equal(P.length, 5, '一级入口应为 5 个');
  P.forEach(d => {
    assert.ok(d.key && d.label, '一级项缺 key/label：' + JSON.stringify(d));
    assert.ok(Array.isArray(d.children) && d.children.length >= 1, d.key + ' 没有子项');
  });
  assert.deep(P.map(d => d.key), ['market', 'events', 'assets', 'fund', 'insight'], '一级顺序固定（市场/事件/资产/基金/洞察）');
});

test('12 个旧 key 一个不落地被某个一级认领（一个 key 只能属于一个一级）', () => {
  const owner = {};
  Nav.PRIMARY_DEFS.forEach(d => d.children.forEach(k => {
    assert.ok(!owner[k], `旧 key "${k}" 被两个一级同时认领：${owner[k]} / ${d.key}`);
    owner[k] = d.key;
  }));
  ALL_TABS.forEach(k => assert.ok(owner[k], `旧 key "${k}" 没有被任何一级认领（深链会掉进黑洞）`));
  assert.equal(Object.keys(owner).length, ALL_TABS.length, '子项集合里出现了未知 key');
});

test('tabToPrimary：每个旧 key 都能追到唯一一级', () => {
  ALL_TABS.forEach(k => {
    const p = Nav.tabToPrimary(k);
    assert.ok(Nav.PRIMARY_DEFS.some(d => d.key === p), `${k} → ${p} 不是合法一级`);
  });
  assert.equal(Nav.tabToPrimary('boss'), null, '未知 key 应返回 null 而不是瞎猜');
});

test('defaultTabOf / childrenOf / needSubBar 与定义一致', () => {
  Nav.PRIMARY_DEFS.forEach(d => {
    assert.equal(Nav.defaultTabOf(d.key), d.children[0], d.key + ' 默认落点应为首个子项');
    assert.deep(Nav.childrenOf(d.key), d.children, d.key + ' 子项顺序不准改');
    assert.equal(Nav.needSubBar(d.key), d.children.length >= 2, d.key + ' needSubBar 判定错（单子项不该显示二级条）');
  });
  /* 单子项的一级：事件/基金/洞察当前各只有 1 个子项 → 不显示二级条 */
  assert.equal(Nav.needSubBar('events'), false, '事件只有 1 个子项，不该显示二级条');
  assert.equal(Nav.needSubBar('market'), true, '市场有多个子项，必须显示二级条');
});

test('深链解析：新格式 #tab=market&sub=cn', () => {
  assert.deep(Nav.parseHash('#tab=market&sub=cn'), { tab: 'cn', sub: 'cn', primary: 'market' });
  assert.deep(Nav.parseHash('#tab=events'), { tab: 'events', sub: 'events', primary: 'events' });
});

test('深链兼容：旧格式 #tab=cn 仍解析为「市场 + A股」', () => {
  const r = Nav.parseHash('#tab=cn');
  assert.equal(r.tab, 'cn', '旧深链的 tab 必须原样保留（state.tab 钥匙不许变）');
  assert.equal(r.primary, 'market', '旧深链要能反推一级');
});

test('深链兜底：空/未知一律回默认，不许白屏', () => {
  const def = Nav.defaultTabOf('market');
  ['', '#', '#tab=', '#tab=nonsense', '#foo=1', null, undefined].forEach(h => {
    const r = Nav.parseHash(h);
    assert.ok(r && r.tab, 'parseHash(' + JSON.stringify(h) + ') 没有返回兜底 tab');
    assert.ok(Nav.tabToPrimary(r.tab), '兜底 tab 必须是合法 key：' + r.tab);
  });
  assert.equal(Nav.parseHash('').tab, def, '空深链应回默认落点');
});

test('buildHash 与 parseHash 往返一致（不许出现点了两次才生效的链接）', () => {
  ALL_TABS.forEach(k => {
    const h = Nav.buildHash(k);
    const r = Nav.parseHash(h);
    assert.equal(r.tab, k, `buildHash('${k}') = "${h}" 无法往返`);
  });
  /* 二级条上的子项：hash 里带上 sub 参数，解析仍回到同一个 tab */
  Nav.PRIMARY_DEFS.forEach(d => {
    const h = Nav.buildHash(d.children[0], { sub: d.children[0] });
    assert.equal(Nav.parseHash(h).tab, d.children[0], '带 sub 的 hash 解析错：' + h);
  });
});

test('一级/二级一致性：子项必须属于该一级，不许串门', () => {
  const wrong = [];
  Nav.PRIMARY_DEFS.forEach(d => d.children.forEach(k => {
    if (Nav.tabToPrimary(k) !== d.key) wrong.push(k);
  }));
  assert.equal(wrong.length, 0, '这些 key 的归属自相矛盾：' + wrong.join(','));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
