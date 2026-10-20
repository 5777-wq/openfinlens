#!/usr/bin/env node
/* fetch-us-icons.mjs —— 一次性把美股 logo 抓成本地资源
   （_scripts/fetch-us-icons.mjs，node fetch-us-icons.mjs）

   为什么要有它：美股 logo 原先走 https://www.google.com/s2/favicons，
   **国内不可达**——每个可见行都会触发一次跨域请求、失败后被 onerror 移除，
   界面一直缺 logo。改为抓一次存进 assets/icons/us/<symbol>.png（29 个共 19.7KB），
   运行时只读本地，零外部请求。

   域名表在 js/app.js 的 US_DOMAINS（两处要同步：这里抓、那里引用）。
   favicon 源返回 64px PNG；没有 favicon 的域名（如 lnvtx.com）会被跳过，
   对应标的就不显示 logo（与 A股"无稳定免费源不造假"同一口径）。

   手工跑一次即可，不需要定时执行。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icons', 'us');
fs.mkdirSync(OUT, { recursive: true });

/* 域名表与 js/app.js 的 US_DOMAINS 同源（此处按需取，避免解析源码） */
const DOMAINS = {
  'usAAPL': 'apple.com', 'usNVDA': 'nvidia.com', 'usMSFT': 'microsoft.com', 'usTSLA': 'tesla.com',
  'usAMZN': 'amazon.com', 'usGOOG': 'google.com', 'usMETA': 'meta.com', 'usAVGO': 'broadcom.com',
  'usAMD': 'amd.com', 'usQCOM': 'qualcomm.com', 'usINTC': 'intel.com', 'usTSM': 'tsmc.com',
  'usASML': 'asml.com', 'usAMAT': 'appliedmaterials.com', 'usPLTR': 'palantir.com',
  'usENPH': 'enphase.com', 'usFSLR': 'firstsolar.com', 'usSEDG': 'solaredge.com', 'usFLNC': 'fluenceenergy.com',
  'usPFE': 'pfizer.com', 'usMRK': 'msd.com', 'usJNJ': 'jnj.com', 'usLMT': 'lockheedmartin.com',
  'usRTX': 'rtx.com', 'usNOC': 'northropgrumman.com', 'usCHPT': 'chargepoint.com',
  'usNIO': 'nio.com', 'usXPEV': 'xiaopeng.com', 'usLI': 'lixiang.com',
};

let ok = 0, fail = 0;
for (const [sym, dom] of Object.entries(DOMAINS)) {
  const url = `https://www.google.com/s2/favicons?domain=${dom}&sz=64`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small (' + buf.length + 'B)');
    fs.writeFileSync(path.join(OUT, sym + '.png'), buf);
    ok++;
    process.stdout.write('.');
  } catch (e) {
    fail++;
    console.log(`\n  ✗ ${sym} (${dom}): ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 120));
}
console.log(`\n完成：成功 ${ok}，失败 ${fail} → ${path.relative(ROOT, OUT)}`);
