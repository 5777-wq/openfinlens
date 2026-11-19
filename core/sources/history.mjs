/* history.mjs —— K 线历史数据层（core/sources 唯一真源，零第三方依赖，Node 20+）
 * 移植自 Meridian lib/sources.mjs（与主仓 js/sources/history.js 同一套实测结论）。
 * 降级链与口径：
 *   1) 东财 push2his：fqt=2 后复权（乘性，含拆股+分红，信号口径最稳），lmt≤5000。
 *      本机 Node fetch 会被 WAF 掐（UND_ERR_SOCKET）→ 传输链 fetch → curl 子进程；
 *      连续失败达阈值即熔断（东财 WAF 会 IP 级拒连，越打越死），本轮换腾讯兜底。
 *   2) Yahoo v8 chart：复权收盘价（拆股+分红，10y），东财挂了之后的第二只复权腿。
 *   3) 腾讯 kline/kline：美股返回【不复权】价（实测 NVDA/NFLX 拆股缺口裸露），
 *      2000 根深度最好。仅作兜底，返回 adj='raw'，报表标注"不复权"。
 * 缓存：cacheDir/<源>-<代码>.json（调用方注入目录），按日期去重合并；近期已有数据只
 * 增量拉 120 根，避免每次全量拉 2000 根大响应触发东财 WAF（实测"连续拉大响应→整段拒连"）。
 * 报价（qt.gtimg.cn，GBK）：中文名 + 总市值（f[45] 亿美元×1e8），用于市值排名。
 *
 * 可测试性（离线单测用，生产路径不受影响）：
 *   __setHttpTransport(fn) —— 注入假传输层（URL → ArrayBuffer），绕开真实网络；
 *   __setEastGapMs(ms)     —— 东财限速间隔（生产 600ms，测试 0ms）；
 *   __resetState()         —— 清熔断/统计状态（模块级状态跨用例隔离）。
 * 浏览器永远不 import 本模块（Node-only）；前端走 /data/ HTTP 端点。 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { tradingDaysBetween, lastClosedDate } from '../engine/market-time.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const NUM = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

/* ---------- 传输层（fetch 优先，curl 子进程兜底；统一返回 ArrayBuffer） ---------- */

let HTTP_GET = null;      // 测试注入；null = 真实传输链
let EAST_GAP_MS = 600;    // 东财请求间隔（测试可置 0）

export function __setHttpTransport(fn) { HTTP_GET = fn; }
export function __setEastGapMs(ms) { EAST_GAP_MS = ms; }

/* 离线 mock 通道（仅测试/试跑）：设 OFL_MOCK_HTTP=<路由 JSON 路径> 后，全部 HTTP 走假传输层。
 * 路由文件格式：[[URL前缀, 响应体], ...]，响应体为字符串或对象（自动 JSON 序列化）；
 * 未命中任何前缀 → 抛错（mock 下没有真实网络兜底，宁可红也不编造）。
 * 安全护栏（monitor.mjs 侧强制）：mock 视为试跑——产物只写 preview 目录、meta.mock=true、
 * 不触发推送；生产环境误设此变量时会有显眼日志。 */
if (process.env.OFL_MOCK_HTTP) {
  try {
    const routes = JSON.parse(readFileSync(process.env.OFL_MOCK_HTTP, 'utf8'));
    HTTP_GET = async (url) => {
      for (const [prefix, body] of routes) {
        if (url.startsWith(prefix)) {
          return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
        }
      }
      throw new Error('mock: 未注册的 URL ' + url.slice(0, 80));
    };
    console.error('[history] OFL_MOCK_HTTP 生效：HTTP 全部走离线 mock 路由（' + routes.length + ' 条）——数据为固定 fixture，绝不用于正式发布');
  } catch (e) {
    console.error('[history] OFL_MOCK_HTTP 加载失败，忽略（走真实网络）:', e.message);
  }
}

async function viaFetch(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/' }, signal: ac.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.arrayBuffer();
  } finally { clearTimeout(timer); }
}

/* transports: 有序传输链，逐个试。返回 ArrayBuffer（GBK 场景由调用方解码） */
async function httpGet(url, { timeoutMs = 20000, transports = ['fetch', 'curl'] } = {}) {
  if (HTTP_GET) return HTTP_GET(url, { timeoutMs, transports });
  let lastErr = null;
  for (const t of transports) {
    try {
      if (t === 'curl') {
        return await new Promise((resolve, reject) => {
          // --fail：HTTP 4xx/5xx 让 curl 以 22 退出，错误页不再被当成功响应送进解析器
          execFile('curl', ['-s', '-S', '-f', '--compressed', '--http1.1', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA, url],
            { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
            (err, stdout) => (err ? reject(new Error('curl(' + (err.code || err.message) + ')')) : resolve(stdout)));
        });
      }
      return await viaFetch(url, timeoutMs);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all transports failed');
}

function decodeMaybeGBK(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { try { return new TextDecoder('gbk').decode(bytes); } catch { return Buffer.from(bytes).toString('latin1'); } }
}

/* ---------- 东财：secid 解析 + 后复权日K ---------- */

const EAST_HOSTS = ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com'];
const eastState = { fails: 0, disabled: false, disabledAt: 0, lastError: null, requests: 0 };
let lastEastAt = 0;

function eastNote(err) {
  eastState.fails += 1;
  eastState.lastError = String(err && err.message || err).slice(0, 160);
  if (eastState.fails >= 2) {
    eastState.disabled = true;
    eastState.disabledAt = Date.now();
  }
}
/* 冷却重试：熔断 60s 后放开一次（fails=1 宽限）——东财 WAF 的拒连常是分钟级窗口，
 * 一轮 3~4 分钟的跑动里给几次重试窗口，hfq 覆盖率比"一次熔断跑到底"高得多 */
function eastOk() {
  eastState.requests += 1;
  if (eastState.disabled && Date.now() - eastState.disabledAt >= 60000) {
    eastState.disabled = false;
    eastState.fails = 1;
  }
  return !eastState.disabled;
}
export function eastStatus() { return { ...eastState }; }

/* 解析东财 kline 行 "date,open,close,high,low,vol[,amount]" → [date,o,c,h,l,v] */
export function parseEast(jsonText) {
  const j = JSON.parse(jsonText);
  const d = j && j.data;
  const rows = (d && d.klines) || [];
  const bars = rows.map((s) => {
    const f = String(s).split(',');
    return [f[0], NUM(f[1]), NUM(f[2]), NUM(f[3]), NUM(f[4]), NUM(f[5])];
  }).filter((b) => b[0] && b[2] !== null && b[2] > 0);
  return { name: d && d.name || null, bars };
}

/* 逐个市场位试探（107=美股基金/Arca，106=纽交所，105=纳斯达克），返回即含全量 bars。
 * 只有网络级失败计入熔断；三个市场位都干净返回空 = 代码不认识，不算东财的错。
 * proxyBase（可选）：openfinlens worker.js 部署后的地址，走 Cloudflare IP 绕开本机 WAF 封禁，
 * 约定与上层看板一致：PROXY + '?url=' + encodeURIComponent(真实URL)，worker 只放行行情域名。 */
async function eastKline(ticker, lmt, proxyBase) {
  const code = String(ticker).toUpperCase().replace(/\./g, '_');
  const wrap = (url) => (proxyBase ? proxyBase.replace(/\/$/, '') + '?url=' + encodeURIComponent(url) : url);
  let hardErr = null;
  for (const host of EAST_HOSTS) {
    for (const mkt of [107, 106, 105]) {
      if (!eastOk()) throw new Error('eastmoney 熔断中');
      // 东财 WAF 讨厌密集大响应：请求间保持间隔（600ms 换取整个池子跑完不被掐）
      const gap = Date.now() - lastEastAt;
      if (gap < EAST_GAP_MS) await sleep(EAST_GAP_MS - gap);
      lastEastAt = Date.now();
      const url = wrap(host + '/api/qt/stock/kline/get?secid=' + mkt + '.' + code +
        '&klt=101&fqt=2&lmt=' + lmt + '&end=20500101' +
        '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57');
      try {
        const text = decodeMaybeGBK(await httpGet(url, { transports: proxyBase ? ['fetch'] : ['fetch', 'curl'] }));
        let r;
        try { r = parseEast(text); }
        catch (parseErr) {
          // WAF 偶发吐 HTML 挑战页（200 + <html>）：等 1s 原样重试一次，仍是 HTML 才算失败
          await sleep(1000);
          r = parseEast(decodeMaybeGBK(await httpGet(url, { transports: proxyBase ? ['fetch'] : ['fetch', 'curl'] })));
        }
        if (r.bars.length) {
          eastState.fails = 0;
          return { secid: mkt + '.' + code, name: r.name, bars: r.bars };
        }
      } catch (e) { hardErr = e; }
    }
  }
  if (hardErr) eastNote(hardErr);
  return null;
}

/* ---------- 腾讯：报价（中文名/市值/完整代码）+ 不复权日K ---------- */

export function parseQuotes(text) {
  const out = [];
  text.replace(/\r/g, '').split(';').forEach((line) => {
    const m = line.match(/v_([A-Za-z0-9._]+)="([^"]*)"/);
    if (!m) return;
    const f = m[2].split('~');
    if (f.length < 46 || !f[3]) return;
    const price = NUM(f[3]);
    if (price === null || price === 0) return;   // 0 价 = 上游故障行（同 tencent.js 守卫）
    out.push({
      query: m[1],
      code: (f[2] || '').trim(),                 // 完整代码，如 AAPL.OQ / BRK.B.N / SPMO.AM
      name: (f[1] || '').trim(),
      price,
      prevClose: NUM(f[4]),
      mcapUsd: NUM(f[45]) !== null ? NUM(f[45]) * 1e8 : null,   // f[45] 总市值（亿美元）×1e8
    });
  });
  return out;
}

export async function tencentQuotes(tickers, { batch = 60 } = {}) {
  const list = [];
  for (let i = 0; i < tickers.length; i += batch) {
    const chunk = tickers.slice(i, i + batch).map((t) => 'us' + String(t).toUpperCase());
    try {
      const raw = decodeMaybeGBK(await httpGet('https://qt.gtimg.cn/q=' + chunk.join(','), { transports: ['fetch', 'curl'] }));
      list.push(...parseQuotes(raw));
    } catch { /* 单批失败不致命 */ }
    if (i + batch < tickers.length) await sleep(120);
  }
  return list;
}

async function tencentKline(fullCode, lmt) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' +
    encodeURIComponent([fullCode, 'day', '', '', lmt].join(','));
  const j = JSON.parse(decodeMaybeGBK(await httpGet(url, { transports: ['fetch', 'curl'] })));
  const node = j && j.data && (j.data[fullCode] || Object.values(j.data || {})[0]);
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => [r[0], NUM(r[1]), NUM(r[2]), NUM(r[3]), NUM(r[4]), NUM(r[5])])
    .filter((b) => b[0] && b[2] !== null && b[2] > 0);
}

/* ---------- 价格锚定 ---------- */

/* 后复权(hfq)序列是"上市至今累计调整价"，直接展示会显示 77621 这种数字。
 * 用报价现价做锚：整条序列等比缩放回"现价口径"（等价于锚定今日的前复权）。
 * RSI/EMA/通道位置全部尺度不变 → 指标值不受影响，展示价回到真实价位。 */
export function anchorSeries(series, quotePrice) {
  if (!series || series.adj !== 'hfq' || !Number.isFinite(quotePrice) || quotePrice <= 0) return series;
  const bars = series.bars;
  if (!bars || !bars.length) return series;
  const lastClose = bars[bars.length - 1][2];
  if (!Number.isFinite(lastClose) || lastClose <= 0) return series;
  const f = quotePrice / lastClose;
  return {
    ...series,
    adj: 'hfq',
    anchored: true,
    bars: bars.map((b) => [b[0], b[1] * f, b[2] * f, b[3] * f, b[4] * f, b[5]]),
  };
}

/* ---------- Yahoo：复权收盘价（拆股+分红，10y，东财挂了之后的第二只复权腿） ----------
 * 只有收盘价参与指标（RSI/EMA 全用 close），open/high/volume 用占位值填充不影响结果。
 * adjclose 的末值 = 真实现价（Yahoo 的复权锚定在当前），展示无需再锚定。本机被墙（403）
 * 也不影响：它在链路里只是东财和腾讯之间的中间层，Actions 网络可达时自动生效。 */

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const yahooState = { fails: 0, ok: 0, lastError: null };
export function yahooStatus() { return { ...yahooState }; }
const ET_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function parseYahoo(jsonText) {
  const j = JSON.parse(jsonText);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const ts = (r && r.timestamp) || [];
  const q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  const adj = r && r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose;
  const rawC = (q && q.close) || [];
  const rawO = (q && q.open) || [];
  const rawH = (q && q.high) || [];
  const rawL = (q && q.low) || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = NUM(adj ? adj[i] : rawC[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    // Yahoo 的 quote OHLC 是未复权、adjclose 是复权收盘：按当根比例把开高低拉到复权口径，
    // 否则 o=h=l=c，蜡烛全画成短横线
    const f = adj && Number.isFinite(rawC[i]) && rawC[i] > 0 ? c / rawC[i] : 1;
    const o = NUM(rawO[i]) !== null ? NUM(rawO[i]) * f : c;
    const h = Math.max(NUM(rawH[i]) !== null ? NUM(rawH[i]) * f : c, c, o);
    const l = Math.min(NUM(rawL[i]) !== null ? NUM(rawL[i]) * f : c, c, o);
    bars.push([ET_YMD.format(ts[i] * 1000), +o.toFixed(4), +c.toFixed(4), +h.toFixed(4), +l.toFixed(4), 0]);
  }
  bars.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return bars;
}

async function yahooKline(ticker, lmt) {
  const sym = String(ticker).toUpperCase().replace(/\./g, '-');   // BRK.B → BRK-B
  let lastErr = null;
  for (const host of YAHOO_HOSTS) {
    const url = host + '/v8/finance/chart/' + encodeURIComponent(sym) +
      '?range=10y&interval=1d&includeAdjustedClose=true&events=div%2Csplit';
    try {
      const bars = parseYahoo(decodeMaybeGBK(await httpGet(url, { transports: ['fetch', 'curl'], timeoutMs: 25000 })));
      if (bars.length) { yahooState.ok += 1; return bars.slice(-Math.max(lmt, 30)); }
      lastErr = new Error('yahoo empty');
    } catch (e) { lastErr = e; }
  }
  yahooState.fails += 1;
  yahooState.lastError = String(lastErr && lastErr.message || lastErr).slice(0, 160);
  throw lastErr || new Error('yahoo failed');
}

/* ---------- 缓存 ---------- */

function cachePath(cacheDir, key) { return path.join(cacheDir, key + '.json'); }

function loadCache(cacheDir, key) {
  try {
    const p = cachePath(cacheDir, key);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

function saveCache(cacheDir, key, obj) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(cacheDir, key), JSON.stringify({ ...obj, key, savedAt: new Date().toISOString() }));
  } catch { /* 缓存写失败不影响主流程 */ }
}

/* 按日期合并去重（新数据覆盖同日），按日期升序 */
export function mergeBars(oldBars, newBars) {
  const map = new Map();
  for (const b of (oldBars || [])) if (b && b[0]) map.set(b[0], b);
  for (const b of (newBars || [])) if (b && b[0]) map.set(b[0], b);
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const daysBetween = (d1, d2) => Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000);

/* 缓存新鲜度判定 [FIX-06]：最后一根 bar 距 anchor（最近已收盘交易日）≤1 个交易日即视为可用。
 * 非法日期（离线假日期 fixture 等）一律判不新鲜，绝不拿脏缓存顶当期数据。 */
export function cacheFreshEnough(bars, anchor) {
  if (!Array.isArray(bars) || !bars.length || typeof anchor !== 'string') return false;
  const lastDate = bars[bars.length - 1][0];
  if (typeof lastDate !== 'string') return false;
  if (!Number.isFinite(Date.parse(lastDate + 'T00:00:00Z')) || !Number.isFinite(Date.parse(anchor + 'T00:00:00Z'))) return false;
  return tradingDaysBetween(lastDate, anchor) <= 1;
}

/* 测试钩子：清空模块级状态（熔断/统计/限速时钟），离线用例间隔离 */
export function __resetState() {
  eastState.fails = 0; eastState.disabled = false; eastState.disabledAt = 0;
  eastState.lastError = null; eastState.requests = 0;
  lastEastAt = 0;
  yahooState.fails = 0; yahooState.ok = 0; yahooState.lastError = null;
}

/* ---------- 单标的主入口 ---------- */

/* getSeries('AAPL') → {ticker, name, bars, adj, source, fetched} | null
 * 复权降级链：东财 hfq（2400+ 根，可走 worker 代理）→ Yahoo 复权收盘（10y）→
 * 腾讯不复权兜底（2000 根，adj='raw' 打标）。各家缓存独立，绝不混口径合并。 */
export async function getSeries(ticker, { cacheDir, bootstrapLmt = 2000, refreshLmt = 120, eastProxy } = {}) {
  const T = String(ticker).toUpperCase();
  const key = 'east-' + T.replace(/\./g, '_');
  const cached = loadCache(cacheDir, key);

  if (!eastState.disabled || Date.now() - eastState.disabledAt >= 60000) {
    const fresh = cached && Array.isArray(cached.bars) && cached.bars.length &&
      daysBetween(cached.bars[cached.bars.length - 1][0], new Date().toISOString().slice(0, 10)) <= 10;
    try {
      const r = await eastKline(T, fresh ? refreshLmt : bootstrapLmt, eastProxy);
      if (r && r.bars.length) {
        const bars = mergeBars(cached && cached.bars, r.bars);
        saveCache(cacheDir, key, { ticker: T, secid: r.secid, name: r.name, adj: 'hfq', source: 'eastmoney', bars });
        return { ticker: T, name: r.name, bars, adj: 'hfq', source: 'eastmoney', fetched: fresh ? 'refresh' : 'bootstrap' };
      }
    } catch { /* 落到 Yahoo */ }
  } else if (cached && cacheFreshEnough(cached.bars, lastClosedDate())) {
    // 熔断中 [FIX-06]：本地新鲜缓存（≤1 个交易日延迟）优先于降级链——hfq 口径一致、
    // 不给 WAF 加压；缓存也旧了才落 Yahoo/腾讯
    return { ticker: T, name: cached.name || null, bars: cached.bars, adj: 'hfq', source: 'eastmoney', fetched: 'cache', degraded: true };
  }

  // Yahoo 复权收盘（第二只复权腿）
  const yKey = 'yahoo-' + T.replace(/\./g, '_');
  try {
    const yCached = loadCache(cacheDir, yKey);
    const yFresh = yCached && Array.isArray(yCached.bars) && yCached.bars.length &&
      daysBetween(yCached.bars[yCached.bars.length - 1][0], new Date().toISOString().slice(0, 10)) <= 10;
    const yBars = await yahooKline(T, yFresh ? Math.max(refreshLmt, 30) : bootstrapLmt);
    if (yBars.length) {
      const bars = mergeBars(yCached && yCached.bars, yBars);
      saveCache(cacheDir, yKey, { ticker: T, adj: 'hfq', source: 'yahoo', bars });
      return { ticker: T, name: null, bars, adj: 'hfq', source: 'yahoo', fetched: yFresh ? 'refresh' : 'bootstrap' };
    }
  } catch { /* 落到腾讯 */ }

  // 腾讯兜底：报价解析完整代码（usAAPL → usAAPL.OQ），不复权
  const tKey = 'tx-' + T.replace(/\./g, '_');
  try {
    const codeMap = loadCache(cacheDir, 'code-map') || { map: {} };
    let full = codeMap.map[T] || null;
    if (!full) {
      const q = await tencentQuotes([T]);
      full = q.length && /\./.test(q[0].code) ? 'us' + q[0].code : null;
      if (full) { codeMap.map[T] = full; saveCache(cacheDir, 'code-map', { map: codeMap.map }); }
    }
    // 瞬时抖动重试一次（实测：全量跑 101 只时偶发单标的超时，重试即恢复）
    let bars = null;
    for (let i = 0; i < 2 && !(bars && bars.length); i++) {
      if (i) await sleep(800);
      try { bars = await tencentKline(full || 'us' + T, bootstrapLmt); } catch { bars = null; }
    }
    if (!bars || !bars.length) return null;
    const txCached = loadCache(cacheDir, tKey);
    const merged = mergeBars(txCached && txCached.bars, bars);
    saveCache(cacheDir, tKey, { ticker: T, code: full, adj: 'raw', source: 'tencent', bars: merged });
    return { ticker: T, name: null, bars: merged, adj: 'raw', source: 'tencent', fetched: 'fallback' };
  } catch { return null; }
}
