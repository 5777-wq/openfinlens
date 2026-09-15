#!/usr/bin/env node
/* migrate-brand-accent.mjs —— 把 PNG 里的品牌强调色从一个值迁到另一个值（像素级保真）
 *
 * 为什么需要它：assets/icons/*.png（PWA/主屏图标）是二进制产物，当初没有留下生成脚本
 * （android/gen_icons.py 只产安卓 mipmap）。品牌色一改，这些图标就会和网页 favicon、
 * css --accent-signature 脱节。重新手绘风险高，故用"换色"而非"重画"。
 *
 * 原理：这些图标只有两种主色——底色 bg 与强调色 from——其余像素都是二者的抗锯齿线性插值
 * （可验证：插值像素在 bg→from 连线上的投影残差为 0）。因此对每个像素求它在 bg→from 上的
 * 比例 t，再用 bg→to 重建即可，边缘过渡一并正确迁移，不走样。
 *
 * 用法（推荐省略 --from，自动探测；脚本会拒绝"最频繁色是亮色"的可疑输入）：
 *   node _scripts/migrate-brand-accent.mjs --to=#e8a33d assets/icons/*.png
 *   node _scripts/migrate-brand-accent.mjs --from=#D97757 --to=#e8a33d [--dry] <png...>
 *
 * 警告：--from 必须传"当前文件里实际的强调色"。若对**已经换过色**的图标再跑一次并传入旧值，
 * 旧值在图上已不存在，投影会被钳到 0/1 两端，把抗锯齿像素压成实心（残差告警可发现，但已有轻微走样）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (name) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY = argv.includes('--dry');
const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || ''));
  if (!m) throw new Error('需要 #rrggbb 形式的颜色，收到: ' + s);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const TO = hex(opt('to') || (() => { throw new Error('必须给 --to=#rrggbb'); })());
const FROM = opt('from') ? hex(opt('from')) : null;
const files = argv.filter(a => !a.startsWith('--'));
if (!files.length) throw new Error('没有输入文件');

/* ---------- 最小 PNG 解码（8bit，colorType 6=RGBA / 2=RGB，覆盖全部 5 种行滤波） ---------- */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      const depth = data[8]; ct = data[9];
      if (depth !== 8) throw new Error('只支持 8bit，收到 bitDepth=' + depth);
      if (ct !== 6 && ct !== 2) throw new Error('只支持 RGBA/RGB，收到 colorType=' + ct);
      if (data[12] !== 0) throw new Error('不支持隔行扫描');
    }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3, stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (ft !== 0) throw new Error('未知行滤波 ' + ft);
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, px: out };
}

/* ---------- 最小 PNG 编码（全 0 滤波 + zlib） ---------- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng({ w, h, ch, px }) {
  const stride = w * ch;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                                  // 滤波类型 0
    px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 主流程 ---------- */
for (const f of files) {
  const img = decodePng(readFileSync(f));
  const { w, h, ch, px } = img;

  // 主色统计（RGB 三通道即可，alpha 在这些图标里恒为 255）
  const counts = new Map();
  for (let i = 0; i < w * h; i++) {
    const o = i * ch, k = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const unpack = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
  const lum = (a) => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  const hx0 = (a) => '#' + a.map(v => v.toString(16).padStart(2, '0')).join('');
  const bg = unpack(ranked[0][0]);
  const from = FROM || (ranked[1] ? unpack(ranked[1][0]) : null);
  if (!from) throw new Error(f + ': 只有一个主色，无法推断 --from');
  // 自动探测的前提是"底色出现次数多于强调色"。若最频繁色反而更亮，说明两者角色可能颠倒
  // （例如强调色面积大于底色）——此时静默换色会把背景刷成强调色，且连线残差仍为 0、不会告警。
  if (!FROM && lum(bg) >= lum(from)) {
    throw new Error(f + ': 自动探测到的最频繁色是亮色（' + hx0(bg) + '），底色/强调色角色可疑，'
      + '请显式传 --from=' + hx0(from));
  }
  if (FROM && from.join(',') === TO.join(',')) {
    console.warn(f + ': --from 与 --to 相同，无事可做');
  }

  const dv = [from[0] - bg[0], from[1] - bg[1], from[2] - bg[2]];
  const dv2 = dv[0] * dv[0] + dv[1] * dv[1] + dv[2] * dv[2];
  if (!dv2) throw new Error(f + ': --from 与底色相同');
  const dvTo = [TO[0] - bg[0], TO[1] - bg[1], TO[2] - bg[2]];

  let maxResid = 0;
  const patched = Buffer.from(px);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const d = [px[o] - bg[0], px[o + 1] - bg[1], px[o + 2] - bg[2]];
    let t = (d[0] * dv[0] + d[1] * dv[1] + d[2] * dv[2]) / dv2;
    // 残差 = 像素到 bg→from 连线的距离；非插值像素（若有）会暴露出来
    for (let c = 0; c < 3; c++) maxResid = Math.max(maxResid, Math.abs(d[c] - t * dv[c]));
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let c = 0; c < 3; c++) patched[o + c] = Math.round(bg[c] + t * dvTo[c]);
  }

  const hx = (a) => '#' + a.map(v => v.toString(16).padStart(2, '0')).join('');
  console.log(`${f}  ${w}x${h}  bg=${hx(bg)}  ${hx(from)} → ${hx(TO)}  连线残差max=${maxResid.toFixed(2)}`);
  if (maxResid > 2) console.log(`  ! 残差偏大：图标可能含有不在这条连线上的颜色，请人工看一眼`);
  if (!DRY) writeFileSync(f, encodePng({ w, h, ch, px: patched }));
}
console.log(DRY ? '(dry-run，未写入)' : '完成');
