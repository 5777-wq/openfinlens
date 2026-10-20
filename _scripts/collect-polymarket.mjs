#!/usr/bin/env node
/* collect-polymarket.mjs —— Polymarket 预测市场"事件概率"采集
   Gamma API（公开只读）→ data/events/polymarket.json
   CLOB 公开只读历史 → data/events/polymarket-history.json（概率走势的数据源）

   合规铁律（强约束，与文件头 js/polymarket.js 同一份口径）：
   - 只读公开接口，只提取"事件发生概率"（Yes 价格）与该概率的历史序列；
     不存 slug/URL/tokenId，产物里没有任何交易平台链接，前端渲染层想外链都没有字段；
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
const OUT_HIST = path.join(ROOT, 'data', 'events', 'polymarket-history.json');
const OUT_I18N = path.join(ROOT, 'data', 'events', 'polymarket-i18n.json');
const API = 'https://gamma-api.polymarket.com/events';
const CLOB_HIST = 'https://clob.polymarket.com/prices-history';
const TR_MEMORY = 'https://api.mymemory.translated.net/get';   // 主通道：对数据中心 IP 友好（Actions 实测 gtx 直接 429）
const TR_GTX = 'https://translate.googleapis.com/translate_a/single';  // 备用：用户自建服务器（非数据中心段）上可用
const PAGES = 3;            // 每页 100、按 24h 成交降序：拿头部 300 个活跃市场足够
const LIMIT = 100;
const TIMEOUT_MS = 25000;
const RETRIES = 2;
const MAX_BYTES = 1024 * 1024;
const TR_BUDGET_MS = 100000;  // 翻译总预算：超时即停，剩余行保留英文（列表页 2026-09-20 用户反馈：全英文看不懂）
const HIST_FETCH_MAX = 60;    // 每轮最多回填多少条概率历史（对上游礼貌）
const HIST_CONC = 5;          // 历史接口并发
const HIST_INTERVAL = '1w';   // 回填窗口：7 天
const HIST_FIDELITY = 60;     // 采样粒度：60 分钟

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 中文标题：MyMemory 主通道 + gtx 备用，逐条翻译（≤60 行、30 分钟一轮，对上游礼貌）。
   两通道都失败 / 超预算 → 保留英文原题（titleZh 不写），前端按 titleZh || title
   展示——宁缺毋假，绝不把半成品机翻当兜底。

   翻译结果落盘到 polymarket-i18n.json 做缓存：同一个事件标题/档位名在多轮采集里
   反复出现，没有缓存就是每轮都重复请求翻译接口（配额消耗大、也慢）。
   缓存只存"英文原文 → 中文译文"对照，不含任何链接字段。 */
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

function loadI18n() {
  try {
    const j = JSON.parse(readFileSync(OUT_I18N, 'utf8'));
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch { return {}; }
}

/* 给一批字符串补中文：先查缓存，缺的现翻（预算内），翻好的写回缓存。
   返回 { map, changed }。 */
async function translateAll(texts) {
  const cache = loadI18n();
  const out = {};
  const pending = [];
  const seen = new Set();
  for (const t of texts) {
    if (!t || /[\u4e00-\u9fa5]/.test(t) || seen.has(t)) continue;   // 本来就是中文 / 重复，跳过
    seen.add(t);
    if (cache[t] && typeof cache[t] === 'string' && cache[t].trim()) out[t] = cache[t].trim();
    else pending.push(t);
  }
  const t0 = Date.now();
  let ok = 0, failed = 0;
  for (const text of pending) {
    if (Date.now() - t0 > TR_BUDGET_MS) {
      console.error(`  翻译预算 ${TR_BUDGET_MS / 1000}s 用尽，剩余 ${pending.length - ok - failed} 条保留英文`);
      break;
    }
    try {
      let zh;
      try { zh = await trMyMemory(text); }
      catch { zh = await trGtx(text); }
      if (zh && zh !== text) { out[text] = zh.trim(); cache[text] = zh.trim(); ok++; }
      else failed++;
    } catch { failed++; }        // 双通道都失败，保留英文
    await sleep(120);
  }
  const changed = Object.keys(cache).length;
  console.log(`  中文标题：${ok} 条新译 / ${failed} 条失败 / 命中缓存 ${Object.keys(out).length - ok} 条`);
  return { map: out, cache, changed };
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

/* ---------- 概率历史回填（走势线的数据源） ---------- */

/* 拉单个档位的历史价格序列。tokenId 只在内存里用，绝不写盘。
   失败返回 null（不编造历史）。 */
async function fetchHistory(tokenId) {
  if (!tokenId) return null;
  const url = `${CLOB_HIST}?market=${encodeURIComponent(tokenId)}&interval=${HIST_INTERVAL}&fidelity=${HIST_FIDELITY}`;
  try {
    const j = await fetchJSON(url);
    if (!j || !Array.isArray(j.history)) return null;
    return j.history.filter(p => p && typeof p.t === 'number' && typeof p.p === 'number')
      .map(p => [p.t, p.p]);
  } catch (e) {
    console.error(`  历史拉取失败（token ${String(tokenId).slice(0, 8)}…）：${e.message}`);
    return null;
  }
}

/* 并发受控地回填。按 (事件热度, 档位次序) 取前 HIST_FETCH_MAX 条。 */
async function fetchHistories(events) {
  const jobs = [];
  for (const e of events) {
    for (const o of (e.outcomes || [])) {
      if (jobs.length >= HIST_FETCH_MAX) break;
      if (!o.tokenId) continue;
      jobs.push({ id: o.id, tokenId: o.tokenId });
    }
    if (jobs.length >= HIST_FETCH_MAX) break;
  }
  console.log(`  回填概率历史：${jobs.length} 条档位（上限 ${HIST_FETCH_MAX}）`);
  const entries = [];
  let idx = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      const points = await fetchHistory(job.tokenId);
      if (points && points.length) entries.push({ id: job.id, points });
      await sleep(60);
    }
  };
  await Promise.all(Array.from({ length: Math.min(HIST_CONC, jobs.length || 1) }, worker));
  console.log(`  历史到位：${entries.length} 条`);
  return entries;
}

/* 旧网格 → 新网格的平移合并：新窗口向前滚动时，未回填到的档位不该丢历史。
   网格按绝对 4h 对齐（PM.HIST_BIN_MS），所以平移量是整数格，合并是逐格的。 */
function mergeHistory(oldGrid, newGrid) {
  if (!oldGrid || !oldGrid.series || !Number.isFinite(oldGrid.from)) return newGrid;
  const bin = newGrid.binMs;
  const shift = Math.round((newGrid.from - oldGrid.from) / bin);
  if (!Number.isFinite(shift)) return newGrid;
  const series = { ...newGrid.series };
  for (const [id, arr] of Object.entries(oldGrid.series)) {
    if (series[id]) {
      // 两边都有：新值优先，新值为空（缺测）时用旧值兜底
      const merged = newGrid.series[id].map((v, i) => {
        if (v !== null && v !== undefined) return v;
        const oi = i + shift;
        return (oi >= 0 && oi < arr.length) ? arr[oi] : null;
      });
      series[id] = merged;
    } else {
      // 本轮没回填到：把旧序列整体平移到新窗口（超出窗口的丢掉）
      const moved = new Array(newGrid.count).fill(null);
      for (let i = 0; i < arr.length; i++) {
        const ni = i - shift;
        if (ni >= 0 && ni < newGrid.count) moved[ni] = arr[i];
      }
      series[id] = moved;
    }
  }
  return { ...newGrid, series };
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

  /* raw 保留 tokenId（回填历史要用），clean 是产物形态（tokenId 被剥掉）。 */
  const raw = PM.normalize(all);
  console.log(`  过滤后保留 ${raw.length} 个事件`);
  if (!raw.length) {
    // 300 个头部活跃事件竟无一命中白名单 = 接口结构大概率变了，按坏数据处理
    console.error('过滤后为 0 个事件：接口结构可能变化，拒绝写空文件');
    process.exit(1);
  }
  const events = PM.sanitizeEvents(raw);
  const byCat = {};
  events.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + 1; });
  console.log('  分类分布：' + Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log(`  互斥事件（可画环图）：${events.filter(e => e.partition).length} / ${events.length}`);

  /* ---- 概率历史：回填 + 合并旧网格 ---- */
  let histPayload = null;
  try {
    const entries = await fetchHistories(raw);
    const grid = PM.buildHistoryGrid(entries, Date.now(), PM.HIST_BIN_MS, PM.HIST_BINS);
    let oldGrid = null;
    try { oldGrid = JSON.parse(readFileSync(OUT_HIST, 'utf8')); } catch { /* 首次生成 */ }
    const merged = mergeHistory(oldGrid, grid);
    histPayload = {
      generatedAt: new Date().toISOString(),
      binMs: merged.binMs,
      from: merged.from,
      count: merged.count,
      seriesCount: Object.keys(merged.series).length,
      series: merged.series,
    };
  } catch (e) {
    console.error('  历史回填失败（不影响主产物）：' + (e && e.message || e));
  }

  /* ---- 中文标题（事件标题 + 词干 + 档位名，带缓存） ---- */
  const texts = [];
  events.forEach(e => {
    texts.push(e.title);
    if (e.stem && e.stem !== e.title) texts.push(e.stem);
    e.outcomes.forEach(o => texts.push(o.label));
  });
  const { map, cache } = await translateAll(texts);
  events.forEach(e => {
    if (map[e.title]) e.titleZh = map[e.title];
    if (e.stem && e.stem !== e.title && map[e.stem]) e.stemZh = map[e.stem];
    e.outcomes.forEach(o => { if (map[o.label]) o.labelZh = map[o.label]; });
  });

  /* ---- 写盘 ---- */
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'Polymarket Gamma API（公开只读）',
    license: '数据归 Polymarket 所有；本站仅只读引用事件概率数值，不含链接、不含交易功能',
    disclaimer: 'probability 为市场定价隐含的"事件发生可能性"，仅供参考，不构成预测或投资建议',
    count: events.length,
    events,
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
  } else {
    writeFileSync(OUT, json);
    console.log(`✓ 已写入 ${path.relative(ROOT, OUT)}（${(Buffer.byteLength(json) / 1024).toFixed(1)} KB）`);
  }

  if (histPayload) {
    const hjson = JSON.stringify(histPayload);
    if (Buffer.byteLength(hjson) > MAX_BYTES) {
      console.error(`历史体积 ${Buffer.byteLength(hjson)} 超限，拒写`);
    } else {
      let hold = null;
      try { hold = readFileSync(OUT_HIST, 'utf8'); } catch { /* 首次生成 */ }
      if (hold === hjson) console.log('历史内容无变化，不写盘');
      else {
        writeFileSync(OUT_HIST, hjson);
        console.log(`✓ 已写入 ${path.relative(ROOT, OUT_HIST)}（${(Buffer.byteLength(hjson) / 1024).toFixed(1)} KB）`);
      }
    }
  }

  // 翻译缓存：有新条目才写盘
  const cacheJson = JSON.stringify(cache, null, 0);
  let cold = null;
  try { cold = readFileSync(OUT_I18N, 'utf8'); } catch { /* 首次生成 */ }
  if (cold !== cacheJson) {
    writeFileSync(OUT_I18N, cacheJson);
    console.log(`✓ 已写入 ${path.relative(ROOT, OUT_I18N)}（${Object.keys(cache).length} 条译文）`);
  } else {
    console.log('翻译缓存无变化，不写盘');
  }
}

main().catch(e => {
  console.error('采集失败：' + (e && e.stack || e));
  process.exit(1);
});
