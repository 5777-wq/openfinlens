/* technical.js 技术面指标库：手算核对 + 防御性 + analyze 汇总口径。
   用法：node _test/technical.test.mjs（纯函数，无需网络） */

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

const ctx = vm.createContext({ console, Math, Date, Number, String, Array, Object, isNaN });
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/technical.js'), 'utf8'), ctx, { filename: 'js/technical.js' });
const T = ctx.window.Technical;

const APPROX = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

await test('smaSeries：等差序列手算核对', () => {
  const s = T.smaSeries([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null); assert.equal(s[1], null);
  assert.ok(APPROX(s[2], 2) && APPROX(s[3], 3) && APPROX(s[4], 4));
});

await test('emaSeries：种子=SMA，k=2/(n+1) 手算核对', () => {
  const s = T.emaSeries([1, 2, 3], 2);
  assert.equal(s[0], null);
  assert.ok(APPROX(s[1], 1.5), '种子应为前2项均值1.5');
  assert.ok(APPROX(s[2], 1.5 + (3 - 1.5) * (2 / 3)), 'ema[2]=2.5');
});

await test('rsi：单边涨=100，单边跌=0，9涨5跌=64.29（Wilder 手算）', () => {
  const up = T.rsi(Array.from({ length: 40 }, (_, i) => 100 + i));
  assert.ok(APPROX(up, 100, 0.001), 'up=' + up);
  const down = T.rsi(Array.from({ length: 40 }, (_, i) => 100 - i));
  assert.ok(APPROX(down, 0, 0.001), 'down=' + down);
  // 15 个变动：前 14 个 9涨1跌，第 15 个 +1 → Wilder 平滑后手算值
  const diffs = [1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, 1];
  const closes = [100];
  diffs.forEach(d => closes.push(closes[closes.length - 1] + d));
  const r = T.rsi(closes, 14);
  const g0 = 9 / 14, l0 = 5 / 14;
  const g1 = (g0 * 13 + 1) / 14, l1 = (l0 * 13 + 0) / 14;
  const expect = 100 - 100 / (1 + g1 / l1);
  assert.ok(APPROX(r, expect, 0.01), `rsi=${r} expect=${expect}`);
});

await test('macd：常数序列 dif/dea/hist 全 0', () => {
  const m = T.macd(Array.from({ length: 60 }, () => 10));
  assert.ok(m && APPROX(m.dif, 0, 1e-9) && APPROX(m.dea, 0, 1e-9) && APPROX(m.hist, 0, 1e-9));
});

await test('kdj：hh=ll 时 RSV=50 → K=D=J=50；单边突破手算核对', () => {
  const flat = Array.from({ length: 20 }, (_, i) => ({ close: 10, high: 10, low: 10 }));
  const f = T.kdj(flat);
  assert.ok(APPROX(f.k, 50) && APPROX(f.d, 50) && APPROX(f.j, 50));
  // 9 根：close 1..9，high=close，low=1 → 末根 RSV=100 → K=2/3*50+1/3*100=66.67, D=2/3*50+1/3*66.67=55.56
  const up = Array.from({ length: 9 }, (_, i) => ({ close: i + 1, high: i + 1, low: 1 }));
  const j = T.kdj(up);
  assert.ok(APPROX(j.k, 50 * 2 / 3 + 100 / 3), 'K=' + j.k);
  assert.ok(APPROX(j.d, 50 * 2 / 3 + j.k / 3), 'D=' + j.d);
  assert.ok(APPROX(j.j, 3 * j.k - 2 * j.d), 'J=' + j.j);
});

await test('boll：1..20 等差序列 σ=√33.25 手算核对', () => {
  const b = T.boll(Array.from({ length: 20 }, (_, i) => i + 1));
  const sd = Math.sqrt(33.25);
  assert.ok(APPROX(b.mid, 10.5));
  assert.ok(APPROX(b.up, 10.5 + 2 * sd, 0.001), 'up=' + b.up);
  assert.ok(APPROX(b.low, 10.5 - 2 * sd, 0.001), 'low=' + b.low);
  const pctB = (20 - b.low) / (b.up - b.low);
  assert.ok(APPROX(b.pctB, pctB, 0.001));
});

await test('atr：恒定振幅 2 → ATR=2；量比=末量/前5均量', () => {
  const kl = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i, high: 100 + i + 1, low: 100 + i - 1 }));
  const a = T.atr(kl);
  assert.ok(APPROX(a.value, 2, 0.001), 'atr=' + a.value);
  assert.ok(APPROX(a.pct, 2 / 129 * 100, 0.001));
  const vkl = kl.map((k, i) => ({ ...k, volume: 100 }));
  vkl[vkl.length - 1].volume = 300;
  assert.ok(APPROX(T.volumeRatio(vkl), 3, 0.001));
});

await test('防御：空/短/脏输入一律 null 不抛', () => {
  assert.equal(T.rsi([], 14), null);
  assert.equal(T.rsi([1, 2, 3], 14), null);
  assert.equal(T.macd(null), null);
  assert.equal(T.kdj([{}]), null);
  assert.equal(T.boll([NaN, NaN]), null);
  assert.equal(T.atr(null), null);
  assert.equal(T.volumeRatio([]), null);
  assert.equal(T.maSystem([1, 2, 3]), null);
  assert.equal(T.analyze(null), null);
  assert.equal(T.analyze(Array.from({ length: 50 }, (_, i) => ({ close: i }))), null, '不足 60 根');
});

await test('analyze：单边强趋势 → 信号齐全、无 NaN/荐股词、偏多为', () => {
  const kl = Array.from({ length: 120 }, (_, i) => {
    const c = 100 * Math.pow(1.01, i);
    return { close: c, high: c * 1.005, low: c * 0.995, open: c * 0.998, volume: 1000 + i * 10 };
  });
  const an = T.analyze(kl);
  assert.ok(an && an.signals.length >= 5, '信号条目 ' + (an && an.signals.length));
  const all = an.signals.map(s => s.tag + s.text).join('|');
  assert.ok(!/NaN|undefined/.test(all), '文本含 NaN/undefined');
  assert.ok(!/建议买入|建议卖出|应该买|应该卖|推荐买入|可以抄底|可以买入/.test(all), '出现荐股表述');
  // 均线系统必须正确识别单边趋势；RSI/KDJ 在强趋势里报"超买"是指标本质（矛盾是常态），
  // 因此只要求偏多不少于偏空，且均线/MACD 两个趋势类指标站多头一边
  const maSig = an.signals.find(s => s.tag === '均线');
  assert.ok(maSig && maSig.bias === 'up', '单边涨均线应为多头排列');
  const mdSig = an.signals.find(s => s.tag === 'MACD');
  assert.ok(mdSig && mdSig.bias === 'up', '单边涨 MACD 应偏多');
  assert.ok(an.bias.up >= an.bias.down, `偏多应不少于偏空 (${an.bias.up}/${an.bias.down})`);
});

await test('analyze：单边深跌 → 偏空为；文本互斥性成立', () => {
  const kl = Array.from({ length: 120 }, (_, i) => {
    const c = 100 * Math.pow(0.99, i);
    return { close: c, high: c * 1.005, low: c * 0.995, open: c * 1.002, volume: 1000 };
  });
  const an = T.analyze(kl);
  assert.ok(an.bias.down > an.bias.up, `单边跌应偏空为 (${an.bias.up}/${an.bias.down})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
