#!/usr/bin/env node
/* collect-polymarket.mjs —— Polymarket 预测市场"事件概率"采集
   Gamma API（公开只读）→ data/events/polymarket.json

   合规铁律（强约束，与文件头 js/polymarket.js 同一份口径）：
   - 只读公开接口，只提取"事件发生概率"（Yes 价格）；不存 slug/URL，产物里没有任何
     交易平台链接，前端渲染层想外链都没有字段；
   - 只保留可能影响市场的类别（央行/宏观/贸易/地缘/选举/能源），过滤逻辑在
     js/polymarket.js（与本脚本共用，前端/测试同一份定义）；
   - 概率是市场定价隐含值，不是本站预测；JSON 里带 disclaimer，前端展示层再标注一次。

   与 collect-events.mjs 同一套铁律：
   - 全部页失败 → exit 1 且绝不改写旧文件（宁缺毋假）；
   - 内容没变 → 不写盘（CI 侧自然无提交）；
   - 体积超限 → 拒写。
   本脚本只在 Actions / 服务器侧跑（gamma-api.polymarket.com 国内不可达），
   浏览器永远不直连 Polymarket。 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PM = require('../js/polymarket.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'events', 'polymarket.json');
const API = 'https://gamma-api.polymarket.com/events';
const TR_MEMORY = 'https://api.mymemory.translated.net/get';   // 主通道：对数据中心 IP 友好（Actions 实测 gtx 直接 429）
const TR_GTX = 'https://translate.googleapis.com/translate_a/single';  // 备用：用户自建服务器（非数据中心段）上可用
const PAGES = 3;            // 每页 100、按 24h 成交降序：拿头部 300 个活跃市场足够
const LIMIT = 100;
const TIMEOUT_MS = 25000;
const RETRIES = 2;
const MAX_BYTES = 1024 * 1024;
const TR_BUDGET_MS = 100000;  // 翻译总预算：超时即停，剩余行保留英文（列表页 2026-09-20 用户反馈：全英文看不懂）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 中文标题：MyMemory 主通道 + gtx 备用，逐条翻译（≤60 行、30 分钟一轮，对上游礼貌）。
   两通道都失败 / 超预算 → 保留英文原题（questionZh 不写），前端按 questionZh || question
   展示——宁缺毋假，绝不把半成品机翻当兜底。 */
async function trMyMemory(text) {
  const j = await fetchJSON(`${TR_MEMORY}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
  const t = j && j.responseData && j.responseData.translatedText;
  if (!t || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t)) throw new Error('mymemory: bad response');
  return t;
}
async function trGtx(text) {
  const j = await fetchJSON(`${TR_GTX}?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`);
  const zh = (Array.isArray(j) && Array.isArray(j[0]) ? j[0].map(s => (s && s[0]) || '').join('') : '').trim();
  if (!zh) throw new Error('gtx: empty');
  return zh;
}
async function addZh(markets) {
  const t0 = Date.now();
  let ok = 0;
  for (const m of markets) {
    if (/[\u4e00-\u9fa5]/.test(m.question)) continue;   // 本来就是中文，跳过
    if (Date.now() - t0 > TR_BUDGET_MS) {
      console.error(`  翻译预算 ${TR_BUDGET_MS / 1000}s 用尽，剩余行保留英文`);
      break;
    }
    try {
      let zh;
      try { zh = await trMyMemory(m.question); }
      catch { zh = await trGtx(m.question); }
      if (zh && zh !== m.question) { m.questionZh = zh.trim(); ok++; }
    } catch { /* 双通道都失败，保留英文 */ }
    await sleep(120);
  }
  console.log(`  中文标题：${ok}/${markets.length} 条翻译成功`);
}

async function fetchJSON(url) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': 'openfinlens-collector/1.0 (read-only; probability display only)' },
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data;
    } catch (e) {
      if (attempt === RETRIES) throw e;
      const wait = 2000 * Math.pow(2, attempt) + Math.random() * 800;
      console.error(`  重试 ${attempt + 1}/${RETRIES}（${Math.round(wait / 1000)}s 后）：${e.message}`);
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main() {
  const all = [];
  let okPages = 0;
  for (let i = 0; i < PAGES; i++) {
    const url = `${API}?closed=false&active=true&archived=false&limit=${LIMIT}&offset=${i * LIMIT}` +
      `&order=volume24hr&ascending=false`;
    try {
      const data = await fetchJSON(url);
      if (!Array.isArray(data)) throw new Error('响应非数组');
      all.push(...data);
      okPages++;
      console.log(`  page ${i}: +${data.length} 个活跃事件（累计 ${all.length}）`);
      if (data.length < LIMIT) break;   // 没有更多了
      await sleep(1200);                // 礼貌间隔
    } catch (e) {
      console.error(`  page ${i} 失败：${e.message}`);
      break;                            // 首页之后失败：用已拿到的继续，够用就不硬撑
    }
  }
  if (!okPages) {
    // 铁律：全源失败 exit 1，绝不碰旧文件（CI 会红，旧数据继续服务前端）
    console.error('Polymarket 采集全部页失败，保留旧数据');
    process.exit(1);
  }

  const markets = PM.normalize(all);
  console.log(`  过滤后保留 ${markets.length} 行（可能影响市场的类别）`);
  if (!markets.length) {
    // 300 个头部活跃市场竟无一命中白名单 = 接口结构大概率变了，按坏数据处理
    console.error('过滤后为 0 行：接口结构可能变化，拒绝写空文件');
    process.exit(1);
  }

  await addZh(markets);
  const byCat = {};
  markets.forEach(m => { byCat[m.category] = (byCat[m.category] || 0) + 1; });
  console.log('  分类分布：' + Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(' '));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'Polymarket Gamma API（公开只读）',
    license: '数据归 Polymarket 所有；本站仅只读引用事件概率数值，不含链接、不含交易功能',
    disclaimer: 'probability 为市场定价隐含的"事件发生可能性"，仅供参考，不构成预测或投资建议',
    count: markets.length,
    markets,
  };
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    console.error(`体积 ${Buffer.byteLength(json)} 超限（>${MAX_BYTES}），拒写`);
    process.exit(1);
  }

  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === json) {
    console.log('内容无变化，不写盘');
    return;
  }
  writeFileSync(OUT, json);
  console.log(`✓ 已写入 ${path.relative(ROOT, OUT)}（${(Buffer.byteLength(json) / 1024).toFixed(1)} KB）`);
}

main().catch(e => {
  console.error('采集失败：' + (e && e.stack || e));
  process.exit(1);
});
