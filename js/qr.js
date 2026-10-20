/* js/qr.js —— 最小二维码编码器（字节模式 / ECC L·M / 版本 1–10 / 8 种掩码自动取优）

   存在理由：分享卡片要带二维码，但项目原则是零依赖、零后端、零外部请求。
   引 CDN 库会破坏「双击 index.html 就能用、离线可用」这条底线；调第三方二维码接口
   会把用户的分享内容送出本机，也会在国内网络上不可达。所以这里自实现一个够用的子集。

   支持范围与不做的部分：
   - 只做字节模式（UTF-8），不做数字/汉字优化模式——我们的负载是一个 URL，
     字节模式在 URL 上本来就更省（模式指示符只要 4 bit，数字模式要 10 bit 变长段）。
   - 只做纠错等级 L 与 M：分享卡片的二维码印在图片里，印刷噪声与遮挡概率高于屏幕，
     M 的 15% 纠错能力比 L 的 7% 更合适。
   - 版本上限 10（可容 271 字节 @L）：分享链接只有几十字节，版本 3 就够。
   - 不做 Micro QR、不做版本 ≥11、不做 ECC Q/H。

   正确性防线（比"看起来对"强）：
   1. 模块预算断言——功能图形（定位/校正/定时/格式/版本信息）占掉的模块数必须
      恰好让剩余模块等于「码字总数 × 8」。定位图案放错一个位置，这个等式立刻不成立，
      编码器会当场抛错而不是产出一张扫不出/扫错字的码。这条断言是本文件最重要的防线。
   2. RS 剩余式——每个纠错块的多项式必须被生成多项式整除（所有 α^i 处求值为 0）。
   3. 编码→解码往返自测（_test/qr.test.mjs）：把矩阵按标准 zigzag 读回来，
      去掉掩码、解交织、剥掉纠错，应能逐字节还原原文。
*/

(function (global) {
  'use strict';

  /* ==================== GF(256) 运算 ====================
     QR 用本原多项式 x^8+x^4+x^3+x^2+1（0x11D）。EXP/LOG 表让乘除变成查表。 */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* ==================== 版本与纠错块表 ====================
     每项：[每块纠错码字数, 组1块数, 组1数据码字, 组2块数, 组2数据码字]
     数据码字多的叫长块，两组块长不同时按标准交错填充。 */
  const VERSIONS = {
    1:  { L: [7,  1, 19,  0, 0],  M: [10, 1, 16, 0, 0] },
    2:  { L: [10, 1, 34,  0, 0],  M: [16, 1, 28, 0, 0] },
    3:  { L: [15, 1, 55,  0, 0],  M: [26, 1, 44, 0, 0] },
    4:  { L: [20, 1, 80,  0, 0],  M: [18, 2, 32, 0, 0] },
    5:  { L: [26, 1, 108, 0, 0],  M: [24, 2, 43, 0, 0] },
    6:  { L: [18, 2, 68,  0, 0],  M: [16, 4, 27, 0, 0] },
    7:  { L: [20, 2, 78,  0, 0],  M: [18, 4, 31, 0, 0] },
    8:  { L: [24, 2, 97,  0, 0],  M: [22, 2, 38, 2, 39] },
    9:  { L: [30, 2, 116, 0, 0],  M: [22, 3, 36, 2, 37] },
    10: { L: [18, 2, 68,  2, 69], M: [26, 4, 43, 1, 44] },
  };

  const MAX_VERSION = 10;
  const ECC_BITS = { L: 0b01, M: 0b00 };   // 格式信息里的纠错等级位（Q=11, H=10，这里用不到）

  /* 每版总码字数（含纠错）——用于模块预算断言 */
  const TOTAL_CODEWORDS = (() => {
    const t = {};
    for (let v = 1; v <= MAX_VERSION; v++) {
      const l = VERSIONS[v].L, m = VERSIONS[v].M;
      t[v] = {
        L: l[0] * (l[1] + l[3]) + l[1] * l[2] + l[3] * l[4],
        M: m[0] * (m[1] + m[3]) + m[1] * m[2] + m[3] * m[4],
      };
    }
    return t;
  })();

  /* 字符计数指示符位宽：版本 1–9 是 8 位，版本 10–26 是 16 位 */
  const cciBits = (v) => (v < 10 ? 8 : 16);

  /* 余数位：所有码字放完后还剩下的模块数（标准规定这些位填 0，但不是功能图形）。
     版本 1 是 0，版本 2–6 是 7，版本 7–13 是 0，版本 14–20 是 3…… */
  const REMAINDER_BITS = (() => {
    const t = {};
    for (let v = 1; v <= 40; v++) {
      t[v] = (v === 1 || (v >= 7 && v <= 13) || (v >= 35)) ? 0
        : (v <= 6) ? 7
          : (v <= 20) ? 3
            : (v <= 27) ? 4 : 3;
    }
    return t;
  })();

  /* 某版本+纠错等级能装多少字节 */
  function capacityBytes(v, ecc) {
    const t = VERSIONS[v][ecc];
    const data = t[1] * t[2] + t[3] * t[4];
    return Math.floor((data * 8 - 4 - cciBits(v)) / 8);
  }

  /* ==================== 纠错 ==================== */

  /* 生成多项式 G(x) = ∏(x - α^i)，系数按高次在前 */
  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                            // poly[j] * x
        next[j + 1] ^= gfMul(poly[j], EXP[i]);          // poly[j] * α^i
      }
      poly = next;
    }
    return poly;
  }

  /* 对一个数据块求纠错码字（多项式除法的余数） */
  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const buf = new Array(data.length + ecLen).fill(0);
    for (let i = 0; i < data.length; i++) buf[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const coef = buf[i];
      if (coef === 0) continue;
      for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], coef);
    }
    return buf.slice(data.length);
  }

  /* 剩余式校验：完整码字多项式在 α^0..α^(n-1) 处求值应全为 0。
     编码器自己算的纠错码不一定能被独立验证，这条把"自洽"升级为"可证"。 */
  function rsSyndromes(codewords, ecLen) {
    const out = [];
    for (let i = 0; i < ecLen; i++) {
      let v = 0;
      for (let j = 0; j < codewords.length; j++) {
        v = gfMul(v, EXP[i]) ^ codewords[j];
      }
      out.push(v);
    }
    return out;
  }

  /* ==================== 比特流 ==================== */

  function utf8Bytes(str) {
    if (global.TextEncoder) return new TextEncoder().encode(str);
    // 老环境兜底：手写 UTF-8 编码（中文标题要用）
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  /* 字节模式的数据段：模式指示符 + 字符计数 + 数据字节 */
  function dataBits(bytes, v) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);                 // 字节模式
    push(bytes.length, cciBits(v));
    for (const b of bytes) push(b, 8);
    return bits;
  }

  /* 补足到字节边界，再交替 0xEC / 0x11 填满剩余码字 */
  function padToCodewords(bits, v, ecc) {
    const t = VERSIONS[v][ecc];
    const totalData = t[1] * t[2] + t[3] * t[4];
    const bitsLen = totalData * 8;
    const out = bits.slice();
    // 终止符最多 4 个 0
    for (let i = 0; i < 4 && out.length < bitsLen; i++) out.push(0);
    while (out.length % 8 !== 0) out.push(0);
    const bytes = [];
    for (let i = 0; i < out.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | out[i + j];
      bytes.push(b);
    }
    // 交替填充字节 0xEC / 0x11
    let pad = 0;
    while (bytes.length < totalData) {
      bytes.push((pad & 1) ? 0x11 : 0xEC);
      pad++;
    }
    return bytes;
  }

  /* 分块 → 算纠错 → 标准交织（数据与纠错码字各自按块轮询） */
  function makeCodewords(dataBytes, v, ecc) {
    const t = VERSIONS[v][ecc];
    const [ecLen, b1, d1, b2, d2] = t;
    const data = padToCodewords(dataBits(dataBytes, v), v, ecc);

    const blocks = [];
    let off = 0;
    for (let i = 0; i < b1; i++) { blocks.push(data.slice(off, off + d1)); off += d1; }
    for (let i = 0; i < b2; i++) { blocks.push(data.slice(off, off + d2)); off += d2; }
    if (off !== data.length) throw new Error('qr: 分块与数据码字数不一致');

    const ecBlocks = blocks.map(b => rsEncode(b, ecLen));

    const out = [];
    const maxData = Math.max(d1, d2 || 0);
    for (let i = 0; i < maxData; i++) {
      for (const b of blocks) if (i < b.length) out.push(b[i]);
    }
    for (let i = 0; i < ecLen; i++) {
      for (const b of ecBlocks) out.push(b[i]);
    }
    const expect = TOTAL_CODEWORDS[v][ecc];
    if (out.length !== expect) throw new Error(`qr: 码字总数 ${out.length} ≠ 表值 ${expect}`);
    return out;
  }

  /* ==================== 矩阵 ==================== */

  const sizeOf = (v) => 17 + 4 * v;

  /* 校正图案中心坐标（标准表；用算法生成避免手抄整张表） */
  function alignPositions(v) {
    if (v === 1) return [];
    const numAlign = Math.floor(v / 7) + 2;
    const step = v === 32 ? 26
      : Math.floor((v * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    const res = new Array(numAlign);
    res[0] = 6;
    for (let i = numAlign - 1, pos = v * 4 + 10; i >= 1; i--, pos -= step) res[i] = pos;
    return res;
  }

  function makeGrid(v) {
    const size = sizeOf(v);
    const modules = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);   // 1 = 功能图形，不放数据、不参与掩码
    const set = (r, c, dark) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      modules[r * size + c] = dark ? 1 : 0;
      fn[r * size + c] = 1;
    };
    const at = (r, c) => modules[r * size + c];

    /* 定位图案 7×7 + 分隔符（一并把周围一圈标成浅色） */
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          set(r0 + r, c0 + c, inRing || inCore);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    /* 校正图案 5×5：外环深、中心 3×3 深、间隔浅 */
    const centers = alignPositions(v);
    const last = size - 7;
    for (const r of centers) {
      for (const c of centers) {
        if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            set(r + dr, c + dc, ring !== 1);
          }
        }
      }
    }

    /* 定时图案：第 6 行与第 6 列，深浅交替（偶数坐标为深） */
    for (let i = 8; i < size - 8; i++) {
      if (!fn[6 * size + i]) set(6, i, i % 2 === 0);
      if (!fn[i * size + 6]) set(i, 6, i % 2 === 0);
    }

    /* 格式信息占位（真值要等掩码定了才写，但位置必须先占住，否则数据会写进去） */
    for (let i = 0; i <= 8; i++) { if (!fn[8 * size + i]) { fn[8 * size + i] = 1; modules[8 * size + i] = 0; } }
    for (let i = 0; i <= 8; i++) { if (!fn[i * size + 8]) { fn[i * size + 8] = 1; modules[i * size + 8] = 0; } }
    for (let i = 0; i < 8; i++) { fn[(size - 1 - i) * size + 8] = 1; modules[(size - 1 - i) * size + 8] = 0; }
    for (let i = 0; i < 8; i++) { fn[8 * size + (size - 1 - i)] = 1; modules[8 * size + (size - 1 - i)] = 0; }

    /* 版本信息（版本 ≥ 7）占位 */
    if (v >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        fn[b * size + a] = 1; modules[b * size + a] = 0;
        fn[a * size + b] = 1; modules[a * size + b] = 0;
      }
    }

    return { size, modules, fn, at };
  }

  /* 数据位按标准 zigzag 从右下角往上/往下的双列交替填充 */
  function placeData(grid, codewords) {
    const { size, modules, fn } = grid;
    let bitIdx = 0;
    const total = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;              // 第 6 列是定时图案，跳过
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = (((right + 1) & 2) === 0);
          const r = upward ? size - 1 - vert : vert;
          const p = r * size + c;
          if (fn[p]) continue;
          if (bitIdx < total) {
            const bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            modules[p] = bit;
            bitIdx++;
          } else {
            modules[p] = 0;                    // 余下模块留 0（标准要求）
          }
        }
      }
    }
    if (bitIdx !== total) throw new Error(`qr: 数据位写入数 ${bitIdx} ≠ 码字位数 ${total}`);
  }

  /* ==================== 掩码 ==================== */

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function applyMask(grid, mask) {
    const { size, modules, fn } = grid;
    const f = MASKS[mask];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = r * size + c;
        if (fn[p]) continue;
        if (f(r, c)) modules[p] ^= 1;
      }
    }
  }

  /* 标准四条罚分规则 */
  function penalty(grid) {
    const { size, modules } = grid;
    let score = 0;

    // 规则 1：同色连续 ≥5，每 5 个记 3 分
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (modules[r * size + c] === modules[r * size + c - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (modules[r * size + c] === modules[(r - 1) * size + c]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // 规则 2：2×2 同色块，每块 3 分
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = modules[r * size + c];
        if (v === modules[r * size + c + 1] && v === modules[(r + 1) * size + c] && v === modules[(r + 1) * size + c + 1]) score += 3;
      }
    }

    // 规则 3：1:1:3:1:1 图形（深浅深浅深 或 浅深深深浅），每处 40 分
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const match = (get, n) => {
      let s = 0;
      for (let i = 0; i + 11 <= n; i++) {
        let a = true, b = true;
        for (let k = 0; k < 11; k++) {
          const v = get(i + k);
          if (v !== pat1[k]) a = false;
          if (v !== pat2[k]) b = false;
        }
        if (a || b) s++;
      }
      return s;
    };
    for (let r = 0; r < size; r++) score += 40 * match((i) => modules[r * size + i], size);
    for (let c = 0; c < size; c++) score += 40 * match((i) => modules[i * size + c], size);

    // 规则 4：深色比例偏离 50%，每 5% 记 10 分
    let dark = 0;
    for (let i = 0; i < modules.length; i++) dark += modules[i];
    const ratio = (dark * 100) / modules.length;
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

    return score;
  }

  /* ==================== 格式信息 / 版本信息 ==================== */

  /* 格式信息：5 位数据（纠错等级 2 位 + 掩码 3 位）+ 10 位 BCH，异或 0x5412。
     BCH 用移位寄存器做多项式长除：每轮左移一位，若移出的那一位是 1 就异或生成多项式
     0x537（x^10+x^8+x^5+x^4+x^2+x+1）。10 轮之后寄存器里就是余数。 */
  function formatBits(ecc, mask) {
    const data = (ECC_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  /* 版本信息：6 位版本 + 12 位 BCH（生成多项式 0x1F25，度 12），同样是移位寄存器 */
  function versionBits(v) {
    let rem = v;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
    }
    return (v << 12) | rem;
  }

  function drawFormat(grid, ecc, mask) {
    const { size, modules } = grid;
    const bits = formatBits(ecc, mask);
    const get = (i) => (bits >> i) & 1;

    /* 第一份：左上角定位图案周围。
       位序容易写反：bits 0–5 沿第 8 列向下（行 0→5），bit 6 在 (7,8)、bit 7 在 (8,8)、
       bit 8 在 (8,7)，bits 9–14 沿第 8 行向左（列 5→0）。 */
    for (let i = 0; i <= 5; i++) modules[i * size + 8] = get(i);
    modules[7 * size + 8] = get(6);
    modules[8 * size + 8] = get(7);
    modules[8 * size + 7] = get(8);
    for (let i = 9; i < 15; i++) modules[8 * size + (14 - i)] = get(i);
    // 第二份：左下与右上
    for (let i = 0; i < 8; i++) modules[8 * size + (size - 1 - i)] = get(i);
    for (let i = 8; i < 15; i++) modules[(size - 15 + i) * size + 8] = get(i);
    modules[(size - 8) * size + 8] = 1;   // 固定深色模块
  }

  /* 把矩阵里的格式信息读回来并校验 BCH 有效性。
     这是格式信息"放对位置"的判据：BCH(15,5) 只有 32 个合法码字，
     放反了位序读出来的 15 位几乎必然是非法码字。 */
  function readFormat(modules, size) {
    const get = (r, c) => modules[r * size + c];
    let raw = 0;
    for (let i = 0; i <= 5; i++) raw |= get(i, 8) << i;
    raw |= get(7, 8) << 6;
    raw |= get(8, 8) << 7;
    raw |= get(8, 7) << 8;
    for (let i = 9; i < 15; i++) raw |= get(8, 14 - i) << i;
    const unmasked = raw ^ 0x5412;
    const data = unmasked >>> 10;
    const rem = unmasked & 0x3ff;
    // 校验余数：把 5 位数据当作码字再除一次生成多项式，余数应为 0
    let chk = data;
    for (let i = 0; i < 10; i++) chk = (chk << 1) ^ (((chk >>> 9) & 1) * 0x537);
    return { raw, data, rem, valid: (chk & 0x3ff) === rem, eccBits: (data >>> 3) & 3, mask: data & 7 };
  }

  function drawVersion(grid, v) {
    if (v < 7) return;
    const { size, modules } = grid;
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      modules[b * size + a] = bit;
      modules[a * size + b] = bit;
    }
  }

  /* ==================== 对外接口 ==================== */

  function pickVersion(byteLen, ecc) {
    for (let v = 1; v <= MAX_VERSION; v++) {
      if (capacityBytes(v, ecc) >= byteLen) return v;
    }
    return -1;
  }

  /* 编码文本 → 矩阵。
     返回 { version, ecc, mask, size, modules(Uint8Array row-major 0/1) } */
  function encode(text, opts) {
    const o = opts || {};
    const bytes = utf8Bytes(String(text));
    // 优先用纠错能力更强的 M，装不下再退 L
    let ecc = o.ecc || 'M';
    if (!VERSIONS[1][ecc]) ecc = 'M';
    let v = pickVersion(bytes.length, ecc);
    if (v < 0 && ecc === 'M') { ecc = 'L'; v = pickVersion(bytes.length, ecc); }
    if (v < 0) throw new Error(`qr: 内容过长（${bytes.length} 字节），超出支持范围`);

    const codewords = makeCodewords(bytes, v, ecc);

    // 选掩码：8 种逐一试，按罚分取最低
    const base = makeGrid(v);
    placeData(base, codewords);
    let best = null;
    for (let m = 0; m < 8; m++) {
      const g = makeGrid(v);
      placeData(g, codewords);
      applyMask(g, m);
      drawFormat(g, ecc, m);
      drawVersion(g, v);
      const sc = penalty(g);
      if (!best || sc < best.score) best = { score: sc, mask: m, grid: g };
    }

    const grid = best.grid;
    /* 模块预算断言：功能图形占掉的模块必须恰好让剩余
       = 码字总数 × 8 + 该版本的余数位。图形位置写错一个，这个等式立刻不成立。 */
    let free = 0;
    for (let i = 0; i < grid.fn.length; i++) if (!grid.fn[i]) free++;
    const expect = TOTAL_CODEWORDS[v][ecc] * 8 + REMAINDER_BITS[v];
    if (free !== expect) {
      throw new Error(`qr: 模块预算不符（可用 ${free} ≠ 期望 ${expect}），版本 ${v} 图形布局有误`);
    }

    return {
      version: v, ecc, mask: best.mask, size: grid.size,
      modules: grid.modules,
      get(r, c) { return grid.modules[r * grid.size + c] === 1; },
    };
  }

  /* 把矩阵读回原文（去掩码 → zigzag 取位 → 解交织 → 剥纠错 → 解析字节模式）。
     这是编码器的自校验通道：往返一次能逐字节还原，说明"编码 + 放置 + 掩码"三段自洽。
     只给测试与自校验用，生产路径不依赖它。 */
  function decode(modules, version, ecc, mask) {
    const size = sizeOf(version);
    const grid = makeGrid(version);
    grid.modules.set(modules);
    // 去掩码：功能图形不受掩码影响，只有数据位翻转
    const f = MASKS[mask];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = r * size + c;
        if (grid.fn[p]) continue;
        if (f(r, c)) grid.modules[p] ^= 1;
      }
    }
    // 按 zigzag 读出码字
    const codewords = [];
    let cur = 0, filled = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = (((right + 1) & 2) === 0);
          const r = upward ? size - 1 - vert : vert;
          const p = r * size + c;
          if (grid.fn[p]) continue;
          cur = (cur << 1) | grid.modules[p];
          filled++;
          if (filled === 8) { codewords.push(cur); cur = 0; filled = 0; }
        }
      }
    }
    // 解交织：把码字按块轮询分配回去
    const t = VERSIONS[version][ecc];
    const [ecLen, b1, d1, b2, d2] = t;
    const blockLens = [];
    for (let i = 0; i < b1; i++) blockLens.push(d1);
    for (let i = 0; i < b2; i++) blockLens.push(d2);
    const blocks = blockLens.map(() => []);
    let idx = 0;
    const maxData = Math.max(d1, d2 || 0);
    for (let i = 0; i < maxData; i++) {
      for (let b = 0; b < blocks.length; b++) {
        if (i < blockLens[b]) blocks[b].push(codewords[idx++]);
      }
    }
    // 纠错码字在数据之后，剥掉
    const dataBytes = [];
    for (const b of blocks) for (let i = 0; i < b.length; i++) dataBytes.push(b[i]);
    // 解析字节模式
    let bitPos = 0;
    const readBits = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        const byte = dataBytes[bitPos >> 3];
        const bit = (byte >> (7 - (bitPos & 7))) & 1;
        v = (v << 1) | bit;
        bitPos++;
      }
      return v;
    };
    const mode = readBits(4);
    if (mode !== 0b0100) throw new Error('qr: 解码得到非字节模式');
    const count = readBits(cciBits(version));
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = readBits(8);
    return out;
  }

  global.QR = {
    encode,
    decode,
    capacityBytes,
    alignPositions,
    formatBits,
    versionBits,
    rsGenerator,
    rsEncode,
    rsSyndromes,
    utf8Bytes,
    VERSIONS,
    TOTAL_CODEWORDS,
    REMAINDER_BITS,
    MAX_VERSION,
    _internal: {
      makeGrid, placeData, applyMask, MASKS, penalty,
      drawFormat, drawVersion, readFormat, sizeOf, makeCodewords, padToCodewords,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

