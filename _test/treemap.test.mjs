/* treemap.test.mjs —— 热力图：色带区间与取色（纯离线单测）
   覆盖：区间边界归属 / 区间连续无缝 / 无涨跌幅不算入区间 / 图例取色。

   为什么盯边界：图例是筛选器，区间归属差 0.01% 就会把"刚好 2% 的票"
   归错档，用户点掉一段却发现少了几只说不清的票。边界值（-3 / -2 / -1 / 0 / 1 / 2 / 3）
   的归属必须钉死。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + e.message); }
}

const ctx = vm.createContext({
  console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, JSON, Uint8Array,
  // treemap 的 refreshColors 读 CSS 变量，Node 里没有，给个最小桩
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  document: { documentElement: {}, body: {} },
});
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/treemap.js'), 'utf8'), ctx, { filename: 'js/treemap.js' });
const T = ctx.window.Treemap;

const B = T.PCT_BANDS;

await test('色带：8 档，覆盖 -3% 到 +3% 且两端为开区间', () => {
  assert.equal(B.length, 8, '应为 8 段');
  assert.equal(B[0].lo, -Infinity, '第一段应从 -∞ 开始');
  assert.equal(B[B.length - 1].hi, Infinity, '最后一段应到 +∞');
  assert.equal(B[0].hi, -3);
  assert.equal(B[B.length - 1].lo, 3);
});

await test('色带：相邻区间首尾相接（无缝隙、无重叠）', () => {
  for (let i = 0; i < B.length - 1; i++) {
    assert.equal(B[i].hi, B[i + 1].lo, `第 ${i} 段的上界应等于第 ${i + 1} 段的下界`);
  }
});

await test('色带：边界值归属明确（-3 归第二段，0 归第五段，3 归最后一段）', () => {
  const key = (p) => B[T.bandOf(p)].key;
  assert.equal(key(-3.01), 'b0', '-3.01% 应在 ≤-3% 段');
  assert.equal(key(-3), 'b1', '-3% 应归 -3~-2% 段（左闭右开）');
  assert.equal(key(-2.5), 'b1');
  assert.equal(key(-2), 'b2', '-2% 应归 -2~-1% 段');
  assert.equal(key(-0.01), 'b3', '-0.01% 应归 -1~0% 段');
  assert.equal(key(0), 'b4', '0% 应归 0~+1% 段');
  assert.equal(key(0.01), 'b4');
  assert.equal(key(2.99), 'b6');
  assert.equal(key(3), 'b7', '3% 应归 ≥+3% 段');
  assert.equal(key(3.01), 'b7');
});

await test('色带：极端涨跌幅（涨跌停、暴涨暴跌）都落在两端', () => {
  assert.equal(B[T.bandOf(-10)].key, 'b0');
  assert.equal(B[T.bandOf(10)].key, 'b7');
  assert.equal(B[T.bandOf(-100)].key, 'b0');
  assert.equal(B[T.bandOf(100)].key, 'b7');
});

await test('色带：没有涨跌幅的不算入任何一段（停牌/缺数据）', () => {
  assert.equal(T.bandOf(null), null);
  assert.equal(T.bandOf(undefined), null);
  assert.equal(T.bandOf(NaN), null);
  assert.equal(T.bandOf('abc'), null);
});

await test('色带：全量扫描不落空（-50% 到 +50% 每个点都有归属）', () => {
  for (let p = -50; p <= 50; p += 0.13) {
    const i = T.bandOf(p);
    assert.ok(i !== null && i >= 0 && i < B.length, `${p}% 没有落到任何一段`);
  }
});

await test('取色：colorAt 返回可用的 CSS 颜色（不抛）', () => {
  const c = T.colorAt(1.5);
  assert.ok(typeof c === 'string' && c.length > 0, '没拿到颜色');
  assert.match(c, /^(rgb|#)/, '颜色格式不对：' + c);
  // 边界也要能取到色（两端是开区间，用代表值取）
  assert.ok(T.colorAt(B[0].rep), '第一段代表值取不到色');
  assert.ok(T.colorAt(B[B.length - 1].rep), '最后一段代表值取不到色');
});

/* ==================== 分组布局（groupedLayout，2026-10-29 美股板块分组） ====================
   两级 squarify：组先铺大块、组内再铺个股。这层错了的症状都很隐蔽——
   组框压住格子、格子越组、组间面积分配失衡——必须结构性钉死：
   覆盖（每只都有块）/ 不重叠 / 组框不重叠 / 格子在组框内且在抬头之下。 */

function mkItems() {
  // 3 组 × 各 8 块，市值递减拉开差距，pct 有正有负（组头加权涨幅要有输入）
  const out = [];
  const groups = ['信息技术', '金融', '医疗保健'];
  groups.forEach((g, gi) => {
    for (let i = 0; i < 8; i++) {
      out.push({ name: g + i, code: g + '-' + i, group: g, value: 1000 - gi * 100 - i * 10, pct: (i % 2 ? 1 : -1) * (i + gi) });
    }
  });
  return out;
}

await test('分组布局：每只标的都有块（覆盖完整，无丢失）', () => {
  const items = mkItems();
  const { cells } = T.groupedLayout(items, 0, 0, 800, 600);
  assert.equal(cells.length, items.length, `24 只应有 24 块，实际 ${cells.length}`);
});

await test('分组布局：组框数 = 组数，且组框互不重叠、都在画布内', () => {
  const { frames } = T.groupedLayout(mkItems(), 0, 0, 800, 600);
  assert.equal(frames.length, 3, '3 个行业应有 3 个组框');
  for (const f of frames) {
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= 800 && f.y + f.h <= 600, '组框越出画布');
    assert.ok(f.headH > 0, '大画布上的组都应留抬头');
  }
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i], b = frames[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `组框 ${a.name} 与 ${b.name} 重叠`);
    }
  }
});

await test('分组布局：格子落在所属组框内、且在抬头之下', () => {
  const { cells, frames } = T.groupedLayout(mkItems(), 0, 0, 800, 600);
  const byName = {};
  frames.forEach(f => { byName[f.name] = f; });
  for (const c of cells) {
    const g = c.item.group;
    const f = byName[g];
    assert.ok(f, `标的 ${c.item.name} 的组 ${g} 没有组框`);
    assert.ok(c.x >= f.x - 0.01 && c.y >= f.y + f.headH - 0.01 &&
      c.x + c.w <= f.x + f.w + 0.01 && c.y + c.h <= f.y + f.h + 0.01,
      `标的 ${c.item.name} 的块越出了组框（或在抬头里）`);
  }
});

await test('分组布局：格子互不重叠', () => {
  const { cells } = T.groupedLayout(mkItems(), 0, 0, 800, 600);
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 &&
        a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      assert.ok(!overlap, `块 ${a.item.name} 与 ${b.item.name} 重叠`);
    }
  }
});

await test('分组布局：组按市值从大到小排（最大的组占左上角）', () => {
  const { frames } = T.groupedLayout(mkItems(), 0, 0, 800, 600);
  // mkItems 里「信息技术」组值最大
  assert.equal(frames[0].name, '信息技术', '值最大的组应排第一');
});

await test('分组布局：无 group 字段全部归「其他」单组，不炸不丢', () => {
  const items = mkItems().map(x => ({ name: x.name, code: x.code, value: x.value, pct: x.pct }));
  const { cells, frames } = T.groupedLayout(items, 0, 0, 800, 600);
  assert.equal(cells.length, items.length, '块数不能丢');
  assert.equal(frames.length, 1, '无分组时整图一个「其他」框');
  assert.equal(frames[0].name, '其他');
});

await test('分组布局：画布太小（退化）不抛异常、输出可渲染', () => {
  const { cells, frames } = T.groupedLayout(mkItems(), 0, 0, 10, 10);
  assert.ok(Array.isArray(cells) && Array.isArray(frames), '退化输出仍是数组');
});

await test('分组布局：零面积/负值标的被过滤', () => {
  const items = mkItems().concat([
    { name: 'zero', code: 'Z', value: 0, pct: 1 },
    { name: 'neg', code: 'N', value: -5, pct: 1 },
  ]);
  const { cells } = T.groupedLayout(items, 0, 0, 800, 600);
  assert.equal(cells.length, 24, '0/负面积的块不参与布局');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
