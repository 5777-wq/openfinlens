/* qr.test.mjs —— 二维码编码器：纯离线单测（node _test/qr.test.mjs）
   覆盖：标准表交叉核对（格式信息 / 版本信息 / 校正图案坐标）、格式信息落位校验、
   RS 纠错剩余式、模块预算、掩码选择、编码→解码往返。

   为什么这些断言要紧：二维码是"扫出来才知道对不对"的东西，肉眼验不了。
   所以用四道可证伪的防线把实现钉住——
   ① 与 ISO/IEC 18004 的硬编码标准表逐值核对（BCH 位序、掩码位序最容易写反）；
   ② 格式信息从矩阵里读回来必须过 BCH 校验（BCH(15,5) 只有 32 个合法码字，
      放反位序读出来的 15 位几乎必然非法——这是"放对位置"的判据）；
   ③ 每个纠错块的多项式在 α^0..α^(n-1) 处求值为 0（编码器自证"可纠"）；
   ④ 把矩阵按标准 zigzag 读回来能逐字节还原原文（放置与掩码自洽）。
   另外编码器内部还有一道模块预算断言：功能图形占掉的模块必须恰好让
   剩余模块 = 码字总数 × 8 + 该版本余数位，图形位置写错会当场抛错而不是产出错码。 */

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
  console, Math, Date, Number, String, Array, Object, isNaN, parseInt, RegExp, Set, Map, JSON,
  Uint8Array, TextEncoder,
});
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(readFileSync(path.join(ROOT, 'js/qr.js'), 'utf8'), ctx, { filename: 'js/qr.js' });
const QR = ctx.window.QR;

/* ---- ISO/IEC 18004 标准表（硬编码，用于交叉核对实现）---- */

/* 格式信息 15 位：按 (纠错等级, 掩码) 排列。编码器只支持 L 与 M（见文件头说明），
   所以这里只留这两组——多列 Q/H 属于没人用的死数据。 */
const FORMAT_TABLE = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101',
      '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
      '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
};

/* 版本信息 18 位（版本 7 及以上才需要） */
const VERSION_TABLE = {
  7: '000111110010010100',
  8: '001000010110111100',
  9: '001001101010011001',
  10: '001010010011010011',
};

/* 校正图案中心坐标（标准表） */
const ALIGN_TABLE = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const bin = (n, len) => n.toString(2).padStart(len, '0');
/* vm 沙箱里 new 出来的数组原型与宿主不同，deepStrictEqual 会因原型不同而失败，
   所以统一先转成宿主数组再比。 */
const hostArr = (a) => Array.from(a);

await test('格式信息：与标准表逐值核对（L 与 M × 8 掩码）', () => {
  for (const [ecc, list] of Object.entries(FORMAT_TABLE)) {
    for (let m = 0; m < 8; m++) {
      const got = bin(QR.formatBits(ecc, m), 15);
      assert.equal(got, list[m], `${ecc} 掩码 ${m}：得到 ${got}，标准 ${list[m]}`);
    }
  }
});

await test('版本信息：与标准表逐值核对（版本 7–10）', () => {
  for (const [v, expect] of Object.entries(VERSION_TABLE)) {
    const got = bin(QR.versionBits(Number(v)), 18);
    assert.equal(got, expect, `版本 ${v}：得到 ${got}，标准 ${expect}`);
  }
});

await test('校正图案坐标：与标准表核对（版本 1–10）', () => {
  for (let v = 1; v <= 10; v++) {
    assert.deepEqual(hostArr(QR.alignPositions(v)), ALIGN_TABLE[v], `版本 ${v} 坐标不符`);
  }
});

await test('容量：随版本单调不减，版本 3@M 至少装得下 39 字节的 URL', () => {
  for (const ecc of ['L', 'M']) {
    let prev = 0;
    for (let v = 1; v <= 10; v++) {
      const c = QR.capacityBytes(v, ecc);
      assert.ok(c >= prev, `${ecc} 版本 ${v} 容量 ${c} 比上一版 ${prev} 还小`);
      prev = c;
    }
  }
  assert.ok(QR.capacityBytes(3, 'M') >= 39, '版本 3@M 装不下 39 字节');
  assert.ok(QR.capacityBytes(3, 'L') >= 39, '版本 3@L 装不下 39 字节');
});

await test('往返自测：编码 → 标准 zigzag 读回 → 逐字节还原（多版本多纠错等级）', () => {
  const cases = [
    'https://5777-wq.github.io/openfinlens/',
    'A',
    '1234567890',
    'https://5777-wq.github.io/openfinlens/#tab=events',
    'OpenFinLens 市场预测 · 隐含概率',
    'x'.repeat(100),
    'y'.repeat(180),
  ];
  for (const ecc of ['L', 'M']) {
    for (const s of cases) {
      const enc = QR.encode(s, { ecc });
      const back = QR.decode(enc.modules, enc.version, enc.ecc, enc.mask);
      const orig = QR.utf8Bytes(s);
      assert.equal(back.length, orig.length, `${ecc}「${s.slice(0, 18)}…」长度不符`);
      for (let i = 0; i < orig.length; i++) {
        assert.equal(back[i], orig[i], `${ecc}「${s.slice(0, 18)}…」第 ${i} 字节不符`);
      }
    }
  }
});

await test('往返自测：长内容触发更高版本（100/180 字节）', () => {
  const a = QR.encode('x'.repeat(100));
  const b = QR.encode('y'.repeat(180));
  assert.ok(a.version >= 4, `100 字节应升到版本 ≥4，实际 ${a.version}`);
  assert.ok(b.version >= 6, `180 字节应升到版本 ≥6，实际 ${b.version}`);
  assert.equal(b.size, 17 + 4 * b.version, '矩阵尺寸应为 17 + 4×版本');
});

await test('格式信息落位：从矩阵读回必须过 BCH 校验且与实际掩码一致', () => {
  for (const ecc of ['L', 'M']) {
    for (const s of ['https://5777-wq.github.io/openfinlens/', 'x'.repeat(120)]) {
      const enc = QR.encode(s, { ecc });
      const f = QR._internal.readFormat(enc.modules, enc.size);
      assert.ok(f.valid, `${ecc} 格式信息 BCH 校验失败——落位可能写反了`);
      assert.equal(f.mask, enc.mask, `${ecc} 读回的掩码与实际不符`);
      const eccBits = ecc === 'L' ? 0b01 : 0b00;
      assert.equal(f.eccBits, eccBits, `${ecc} 读回的纠错等级位不符`);
    }
  }
});

await test('纠错剩余式：每个块的码字多项式在 α^0..α^(n-1) 处求值为 0', () => {
  // 手工造一个块：数据 0..15，纠错 10 个码字（版本 1@M 的规格）
  const data = Array.from({ length: 16 }, (_, i) => i);
  const ec = QR.rsEncode(data, 10);
  assert.equal(ec.length, 10, '纠错码字数不对');
  const full = data.concat(ec);
  const syn = QR.rsSyndromes(full, 10);
  for (let i = 0; i < syn.length; i++) {
    assert.equal(syn[i], 0, `第 ${i} 个剩余式非零（${syn[i]}）——纠错码没被生成多项式整除`);
  }
});

await test('矩阵结构：定位图案、时序图案、固定深色模块位置正确', () => {
  const enc = QR.encode('https://5777-wq.github.io/openfinlens/');
  const size = enc.size;
  const g = (r, c) => enc.get(r, c);
  assert.ok(g(3, 3), '左上定位图案中心应为深');
  assert.ok(g(3, size - 4), '右上定位图案中心应为深');
  assert.ok(g(size - 4, 3), '左下定位图案中心应为深');
  assert.ok(g(0, 0), '定位图案左上角应为深');
  assert.ok(!g(0, 7), '定位图案右侧分隔符应为浅');
  assert.ok(!g(7, 0), '定位图案下方分隔符应为浅');
  for (let i = 8; i < size - 8; i += 2) assert.ok(g(6, i), `时序行第 ${i} 列应为深`);
  for (let i = 9; i < size - 8; i += 2) assert.ok(!g(6, i), `时序行第 ${i} 列应为浅`);
  assert.ok(g(size - 8, 8), '固定深色模块应为深');
});

await test('模块预算：功能图形占位后剩余模块 = 码字位数 + 该版本余数位', () => {
  for (const ecc of ['L', 'M']) {
    for (let v = 1; v <= 10; v++) {
      const grid = QR._internal.makeGrid(v);
      let free = 0;
      for (let i = 0; i < grid.fn.length; i++) if (!grid.fn[i]) free++;
      const expect = QR.TOTAL_CODEWORDS[v][ecc] * 8 + QR.REMAINDER_BITS[v];
      assert.equal(free, expect,
        `版本 ${v}@${ecc}：可用模块 ${free} ≠ 期望 ${expect}`);
    }
  }
});

await test('掩码：编码器选的掩码确实是 8 种里罚分最低', () => {
  const s = 'https://5777-wq.github.io/openfinlens/';
  const enc = QR.encode(s);
  const cw = QR._internal.makeCodewords(QR.utf8Bytes(s), enc.version, enc.ecc);
  let best = Infinity, bestMask = -1;
  for (let m = 0; m < 8; m++) {
    const g = QR._internal.makeGrid(enc.version);
    QR._internal.placeData(g, cw);
    QR._internal.applyMask(g, m);
    QR._internal.drawFormat(g, enc.ecc, m);
    QR._internal.drawVersion(g, enc.version);
    const p = QR._internal.penalty(g);
    if (p < best) { best = p; bestMask = m; }
  }
  assert.equal(enc.mask, bestMask, `编码器选了掩码 ${enc.mask}，重算最低是 ${bestMask}`);
});

await test('边界：内容超长抛明确错误而不是产出坏码', () => {
  assert.throws(() => QR.encode('z'.repeat(500)), /超出支持范围|内容过长/);
});

await test('边界：空串可编码且能解回空串', () => {
  const enc = QR.encode('');
  assert.ok(enc.size >= 21, '矩阵尺寸不对');
  const back = QR.decode(enc.modules, enc.version, enc.ecc, enc.mask);
  assert.equal(back.length, 0, '空串解出非空');
});

await test('UTF-8：中文标题按 UTF-8 字节编码，解回一致', () => {
  const s = '美联储九月议息';
  const bytes = QR.utf8Bytes(s);
  assert.equal(bytes.length, s.length * 3, '中文应为 3 字节/字');
  const enc = QR.encode(s);
  const back = QR.decode(enc.modules, enc.version, enc.ecc, enc.mask);
  assert.deepEqual(hostArr(back), hostArr(bytes), '中文往返不一致');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
