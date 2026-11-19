#!/usr/bin/env node
/* collect-history.mjs —— 采集长历史序列，产出 data/history/*.json
   来源（全部免密钥、官方或公开接口）：
     · 东方财富 push2his  —— 指数 / 商品 / 外汇 月线
     · CBOE 官方 CSV      —— VIX 日线
     · 美国财政部官方 CSV —— 美债收益率曲线日线
   产物提交进仓库，浏览器只读静态 JSON，不直连海外源。 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'history');
const EAST = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** --only=east,vix,treasury,chain —— 只跑指定环节，方便迭代 */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);

/** --series=ID,ID —— 只采指定序列（不写其它序列的文件） */
const SERIES = (process.argv.find((a) => a.startsWith('--series=')) || '').slice(9).split(',').filter(Boolean);
const wantedSeries = (id) => !SERIES.length || SERIES.includes(id);

/** --crisis=2020,2022 —— 只重建指定危机包。
   没有它时，--only=crisis 会把全部历史包重采一遍：上游一旦换备源，
   已有的对账锚点也会被一起重写，失去「只加新内容」的边界。 */
const CRISIS_ONLY = (process.argv.find((a) => a.startsWith('--crisis=')) || '').slice(9).split(',').filter(Boolean);
const wantedCrisis = (id) => !CRISIS_ONLY.length || CRISIS_ONLY.includes(id);

async function getText(url, timeout = 25000) {
  // 重试：CDN 偶发失败是常态。采集脚本是每日流水线，不能因为一次抖动就断。
  // 但重试次数要给够：连着跑两轮时上游会限流，一串「fetch failed」能把
  // 一整个危机包废掉（实测：5 个包全缺序列）。退避也拉长，让上游缓过来。
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; openfin-academy collector)' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < 5) {
        console.warn(`  [retry ${attempt}] ${url.slice(0, 64)}… ${e.message}`);
        await sleep(1500 * attempt);
      }
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

/* ---------------- 原始文本缓存 ----------------
   CBOE 的 VIX CSV 有 1.5MB，财政部 CSV 每年一份。
   月频与日频两条链路都要它们——不缓存就是同一个进程下两遍，
   容易触发 CDN 限流（实测第二次会 fetch failed）。 */
const rawText = new Map();

async function cboeCsv() {
  const KEY = 'cboe-vix';
  if (rawText.has(KEY)) return rawText.get(KEY);
  const txt = await getText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
  rawText.set(KEY, txt);
  return txt;
}

async function treasuryCsv(year) {
  const KEY = 'treasury-' + year;
  if (rawText.has(KEY)) return rawText.get(KEY);
  const u = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all`
    + `?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  let txt = null;
  try { txt = await getText(u); } catch (e) { console.warn(`  [treasury] ${year} 失败：${e.message}`); }
  rawText.set(KEY, txt);
  return txt;
}

/* ---------------- 东方财富月线 ---------------- */
async function eastMonthly(secid, from = '19000101') {
  const u = `${EAST}?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3`
    + `&fields2=f51,f53&klt=103&fqt=0&beg=${from}&end=20991231&lmt=5000`;
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const d = j && j.data;
  if (!d || !d.klines || !d.klines.length) return [];
  return d.klines.map((line) => {
    const p = line.split(',');
    return { t: p[0], v: Number(p[1]) };
  }).filter((x) => Number.isFinite(x.v));
}

/* ---------------- 腾讯月线（备源） ----------------
   实测：东财 push2his 在部分网络下直连不通（socket 被掐），腾讯 ifzq 通且回 CORS 头。
   只覆盖 A 股指数——腾讯 symbol 规则简单：1.xxxxxx → shxxxxxx，0.xxxxxx → szxxxxxx。
   lmt 上限 2000（写 5000 腾讯直接回 "param error"）。 */
async function tencentMonthly(secid) {
  const m = /^([10])\.(\d{6})$/.exec(String(secid || ''));
  if (!m) return [];
  const code = (m[1] === '1' ? 'sh' : 'sz') + m[2];
  const u = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param='
    + `${code},month,,,2000&_var=1`;
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const node = j && j.data && j.data[code];
  const rows = node && node.month ? node.month : [];
  return rows.map((r) => ({ t: String(r[0]).slice(0, 10), v: Number(r[2]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.t) && Number.isFinite(x.v));
}

/* 腾讯月线（港股）：恒生科技这类只有腾讯能取到的序列 */
async function tencentMonthlyHK(secid) {
  const m = /^100\.(.+)$/.exec(String(secid || ''));
  if (!m) return [];
  const code = 'hk' + m[1];
  const u = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param='
    + `${code},month,,,2000&_var=1`;
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const node = j && j.data && j.data[code];
  const rows = node && node.month ? node.month : [];
  return rows.map((r) => ({ t: String(r[0]).slice(0, 10), v: Number(r[2]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.t) && Number.isFinite(x.v));
}

/* ---------------- 终端 universe 里的个股 ----------------
   终端能看的每个标的，科普站也要能查到它的历史——两边共用同一份标的清单。
   腾讯的 symbol 规则：
     A股 sh600519 / sz300750 → 原样
     港股 hk00700 → 原样
     美股 usAAPL → 必须带交易所后缀 usAAPL.OQ（不带就只回 1 根 bar）
   美股后缀从 qt.gtimg.cn 查一次（GBK 编码），查不到就退回裸代码。 */
const usSuffixCache = new Map();
async function tencentSymbol(symbol) {
  const s = String(symbol || '');
  if (/^(sh|sz|bj|hk)/.test(s)) return s;
  if (s.startsWith('us')) {
    const code = s.slice(2);
    if (usSuffixCache.has(code)) return usSuffixCache.get(code);
    let sym = s;
    try {
      const res = await fetch('https://qt.gtimg.cn/q=' + s, { signal: AbortSignal.timeout(12000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const txt = new TextDecoder('gbk').decode(buf);
      const f = String(txt).match(/="([^"]*)"/);
      const full = f ? (f[1].split('~')[2] || '').trim() : '';
      if (/^[A-Za-z.]{1,14}$/.test(full)) sym = 'us' + full;
    } catch (e) { /* 取不到就用裸代码试一次 */ }
    usSuffixCache.set(code, sym);
    return sym;
  }
  return null;
}

/** 拆股在某条序列里的生效位置。
    必须同时看**日期窗口**和**比值**：只看比值会把真实的暴跌（-35% ≈ 1.6 倍）
    误判成拆股，位置一错，整条序列的比例就全错了。 */
function effectiveSplitIndex(points, split) {
  const m = split.date.slice(0, 7);
  let start = -1;
  for (let i = 0; i < points.length; i++) { if (points[i].t.slice(0, 7) >= m) { start = i; break; } }
  if (start < 0) return -1;                       // 拆股在这条序列开始之前 → 不影响
  let best = -1, bestErr = Infinity;
  const lo = Math.max(1, start - 2), hi = Math.min(points.length, start + 4);
  for (let i = lo; i < hi; i++) {
    const r = points[i - 1].v / points[i].v;
    if (r <= 1.05) continue;
    const err = Math.abs(Math.log(r / split.ratio));
    if (err < bestErr) { bestErr = err; best = i; }
  }
  if (best >= 0 && bestErr < 0.35) return best;  // 比值对得上
  return start;                                  // 对不上就按日期：拆股之后的第一根
}

/**
 * 把不复权价整平成复权价。
 * base = 当前这个价位对应的比例（用 Yahoo 复权价反推，≈1）；
 * 每一次拆股把它**之前**的 bar 乘上比例（拆股前的 1 股变成 N 股，价要除以 N）。
 */
function rescaleBySplits(points, splits, base) {
  if (!splits || !splits.length) return points;
  const f = new Array(points.length).fill(base);
  for (const s of splits) {
    const i = effectiveSplitIndex(points, s);
    if (i < 0) continue;
    for (let k = 0; k < i; k++) f[k] *= s.ratio;
  }
  return points.map((p, i) => (f[i] === 1 ? p : { t: p.t, v: p.v / f[i] }));
}

async function tencentMonthlySymbol(symbol) {
  const code = await tencentSymbol(symbol);
  if (!code) return [];
  const u = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param='
    + `${code},month,,,2000&_var=1`;
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const node = j && j.data && j.data[code];
  const rows = node && node.month ? node.month : [];
  return rows.map((r) => ({ t: String(r[0]).slice(0, 10), v: Number(r[2]) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.t) && Number.isFinite(x.v));
}

/* 腾讯的美股 symbol 必须带交易所后缀（usAAPL → usAAPL.OQ），
   而后缀要从 qt.gtimg.cn 查——那一步偶尔会失败，失败了就只回 1 根 bar。
   兜底：把三个交易所后缀都试一遍，谁给的 bar 多用谁。 */
async function tencentMonthlySymbolRobust(symbol) {
  let best = await tencentMonthlySymbol(symbol);
  if (best.length >= 12) return best;
  const s = String(symbol || '');
  if (/^us/.test(s)) {
    const base = s.slice(2);
    for (const suf of ['.OQ', '.N', '.A']) {
      const u = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param='
        + `us${base}${suf},month,,,2000&_var=1`;
      try {
        const txt = await getText(u);
        const j = JSON.parse(txt);
        const node = j && j.data && j.data['us' + base + suf];
        const rows = node && node.month ? node.month : [];
        const pts = rows.map((r) => ({ t: String(r[0]).slice(0, 10), v: Number(r[2]) }))
          .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.t) && Number.isFinite(x.v));
        if (pts.length > best.length) best = pts;
      } catch (e) { /* 试下一个 */ }
    }
  }
  return best;
}

/* ---------------- 拆股复权 ----------------
   腾讯给的是**不复权**价：英伟达 2024-06 十拆一，在月线里就是一道 10 倍断崖
   （2024-05 收 1096.33，2024-06 收 123.5）；谷歌 2014-04 的 Class C 分配同理。
   修法不用猜：拿 Yahoo 的**拆股复权**月线做价，腾讯的月线做**日期**——
   腾讯给的是当月最后一个交易日，Yahoo 给的是当月首日。各取所长：
     日期 = 腾讯（真实月末交易日）
     数值 = Yahoo（已按拆股复权，不含分红）
   拆股事件（split events）只用来交叉验证，不作为唯一依据。 */
const yahooCache = new Map();

function yahooSymbolOf(symbol) {
  const s = String(symbol || '');
  if (/^sh/.test(s)) return s.slice(2) + '.SS';
  if (/^sz/.test(s)) return s.slice(2) + '.SZ';
  if (/^bj/.test(s)) return s.slice(2) + '.BJ';
  if (/^hk/.test(s)) {
    const digits = s.slice(2).replace(/\D/g, '').replace(/^0+/, '') || '0';
    return digits.padStart(4, '0') + '.HK';
  }
  if (/^us/.test(s)) return s.slice(2).replace(/\./g, '-');
  return null;
}

/** Yahoo 月线：月份 → 已按拆股复权的收盘价 */
async function yahooMonthly(symbol) {
  const y = yahooSymbolOf(symbol);
  if (!y) return null;
  if (yahooCache.has(y)) return yahooCache.get(y);
  let map = null;
  try {
    const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(y)
      + '?range=max&interval=1mo';
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (r && r.timestamp && r.indicators) {
      const ts = r.timestamp;
      const cl = r.indicators.quote[0].close || [];
      map = new Map();
      for (let i = 0; i < ts.length; i++) {
        if (cl[i] === null || cl[i] === undefined) continue;
        map.set(new Date(ts[i] * 1000).toISOString().slice(0, 7), Number(cl[i]));
      }
    }
  } catch (e) {
    console.warn(`  [yahoo] ${symbol}：取不到复权价（${e.message}）`);
  }
  yahooCache.set(y, map);
  return map;
}

/** 拆股事件（仅用于交叉验证） */
async function yahooSplits(symbol) {
  const y = yahooSymbolOf(symbol);
  if (!y) return [];
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(y)
    + '?range=max&interval=1mo&events=split';
  try {
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    const ev = (j && j.chart && j.chart.result && j.chart.result[0].events && j.chart.result[0].events.splits) || {};
    return Object.values(ev).map((x) => ({
      date: new Date(x.date * 1000).toISOString().slice(0, 10),
      ratio: (Number(x.numerator) || 1) / (Number(x.denominator) || 1),
    })).filter((x) => x.ratio && x.ratio !== 1);
  } catch (e) {
    return [];
  }
}

/* ---------------- Yahoo 日频（东财不可达时的备源） ----------------
   危机回放包要的是**某一段历史里的真实日收盘**，不是实时行情。
   东财 push2his 在某些网络下会整条 TCP 被掐（本机实测 fetch failed），
   但 Yahoo chart 接口同区间可取，且 ^TNX 与财政部官方 10Y 同日数值一致
   （2022-10-14 两边都是 4.00）。所以这里只作为**备源**，不改主源。
   注意：Yahoo 的指数时间戳在不同交易所时区，这里统一取 UTC 日期；
   期货 GC=F / CL=F 的日收盘与东财连续合约可能存在换月口径差异，
   页面与产物里都会写明来源，不混着当同一条线。 */
async function yahooDaily(ySymbol, from, to) {
  const p1 = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
  // period2 是开区间：多给一天，避免把 to 当天丢掉
  const p2 = Math.floor(new Date(to + 'T00:00:00Z').getTime() / 1000) + 86400;
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ySymbol)
    + '?period1=' + p1 + '&period2=' + p2 + '&interval=1d';
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp || !r.indicators || !r.indicators.quote) return [];
  const ts = r.timestamp;
  const cl = r.indicators.quote[0].close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const v = Number(cl[i]);
    if (!Number.isFinite(v)) continue;
    const t = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (t < from || t > to) continue;
    out.push({ t, v });
  }
  return out;
}

/* ---------------- CBOE VIX 日线 → 月末 ---------------- */
async function cboeVix() {
  const txt = await getText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
  const lines = txt.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((s) => s.trim().toUpperCase());
  const ci = head.indexOf('CLOSE');
  const di = head.indexOf('DATE');
  const byMonth = new Map();
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length <= ci) continue;
    const iso = usToIso(String(p[di]).trim());
    const v = Number(p[ci]);
    if (!iso || !Number.isFinite(v)) continue;
    // 每个月的**最后一个交易日**才算月末收盘。
    // 不依赖 CSV 的行序（升序/倒序都成立），换源也不会悄悄错一个月。
    const mk = iso.slice(0, 7);
    const cur = byMonth.get(mk);
    if (!cur || iso > cur.t) byMonth.set(mk, { t: iso, v });
  }
  return [...byMonth.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function usToIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]), yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;   // 脏行直接丢
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* ---------------- 美国财政部收益率曲线 → 月末 ---------------- */
async function treasuryCurve(years) {
  const out = { US3M: new Map(), US2Y: new Map(), US5Y: new Map(), US10Y: new Map(), US30Y: new Map() };
  for (const y of years) {
    const txt = await treasuryCsv(y);
    if (!txt) continue;
    const lines = txt.trim().split(/\r?\n/);
    // 表头形如：Date,"1 Mo","3 Mo","6 Mo",... —— 引号要剥掉再找列
    const head = lines[0].split(',').map((s) => s.trim().replace(/^"|"$/g, '').trim());
    const di = head.indexOf('Date');
    if (di < 0) { console.warn(`  [treasury] ${y} 表头无法识别：${lines[0].slice(0, 80)}`); continue; }
    const idx = {
      US3M: head.indexOf('3 Mo'), US2Y: head.indexOf('2 Yr'), US5Y: head.indexOf('5 Yr'),
      US10Y: head.indexOf('10 Yr'), US30Y: head.indexOf('30 Yr'),
    };
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const iso = usToIso(String(p[di]).trim().replace(/^"|"$/g, ''));
      if (!iso) continue;
      for (const key of Object.keys(idx)) {
        const j = idx[key];
        if (j < 0 || p[j] === undefined) continue;
        const cell = String(p[j]).trim().replace(/^"|"$/g, '');
        // 空单元格 ≠ 0.00%。Number('') === 0，Number.isFinite(0) === true，
        // 于是「这条期限当天没有报价」会被写成 0 收益率 —— 页面上就是一条
        // 从 5.40% 垂直掉到 0 并横躺十个月的假曲线。空就是缺，不要当 0。
        if (!cell) continue;
        const v = Number(cell);
        if (!Number.isFinite(v)) continue;
        const mk = iso.slice(0, 7);
        // 财政部 CSV 是倒序（新→旧），同一个月的多行会依次覆盖同一个 key。
        // 取该月**最晚**的一天才是月末值；直接覆盖拿到的是月初值，
        // 画在同一条 SPX 月末图上会整体错开约一个月。
        const cur = out[key].get(mk);
        if (!cur || iso > cur.t) out[key].set(mk, { t: iso, v });
      }
    }
    await sleep(120);
  }
  const res = {};
  for (const k of Object.keys(out)) res[k] = [...out[k].values()].sort((a, b) => a.t.localeCompare(b.t));
  return res;
}

/* ---------------- 写产物 ---------------- */
async function writeSeries(id, def, points) {
  if (!points.length) { console.warn(`  [skip] ${id}：无数据`); return null; }
  const file = path.join(OUT, id + '.json');
  // 宁缺毋假：只有几个点的残次品不能覆盖掉好的多年曲线。
  // 腾讯接口偶尔只回 1 根 bar（不带交易所后缀时就是 1 个点），
  // 东财被掐时也会退化——原来那把好曲线就没了，页面上只剩一条"只有一点的历史"。
  if (points.length < 12 && existsSync(file)) {
    const old = JSON.parse(await readFile(file, 'utf8'));
    if ((old.points || []).length > points.length) {
      console.warn(`  [skip] ${id}：本次只有 ${points.length} 点，保留旧的 ${old.points.length} 点`);
      return null;
    }
  }
  const payload = Object.assign({
    id,
    generatedAt: new Date().toISOString(),
    points,
  }, def);
  /* 当月还没走完时，最后一点是采集当天的盘中价，不是月末价。
     在数据里标出来，页面就不必猜——以前它被写成「最新月末」，是句假话。 */
  const lastPoint = points[points.length - 1];
  if (lastPoint && String(lastPoint.t).slice(0, 7) === new Date().toISOString().slice(0, 7)) {
    lastPoint.partial = true;
  }
  await writeFile(file, JSON.stringify(payload), 'utf8');
  console.log(`  [ok] ${id.padEnd(12)} ${points.length} 点  ${points[0].t} → ${points[points.length - 1].t}`);
  return payload;
}

/* ---------------- 危机回放包（日频） ----------------
   月频会把崩盘日藏起来：1997-10 恒指月末收 16459，但当月最低收盘只有 9059。
   所以危机包一律用日频——回放器能逐日拖过雷曼倒闭、黑色星期一。 */
const CRISIS_DEFS = [
  {
    id: '2008', title: '2008 年次贷危机',
    headlineKey: 'SPX',
    from: '2006-01-01', to: '2010-06-30',
    series: ['SPX', 'GC00Y', 'CL00Y', 'US10Y', 'VIX'],
    events: [
      { t: '2006-02-01', title: '美国房价见顶回落', note: '房价是这轮危机的燃料，它先熄火。' },
      { t: '2007-08-09', title: '两只对冲基金爆仓', note: '对冲基金也能爆仓——它们用高杠杆做流动性赌注。' },
      { t: '2007-09-15', title: '北岩银行遭挤兑', note: '英国房贷银行。现代金融里，第一家倒下的不是投行，是靠短期批发融资放房贷的银行。' },
      { t: '2008-03-16', title: '贝尔斯登被美联储接管', note: '救助第一次出现，官方还在否认系统性风险。' },
      { t: '2008-09-15', title: '雷曼兄弟破产', note: '158 年历史的投行倒下，全球信用市场当晚冻结。' },
      { t: '2008-09-16', title: 'AIG 获 850 亿美元救助', note: '危机从「投行」级别升级为「保险公司」级别。' },
      { t: '2008-10-14', title: 'G7 达成救市行动计划', note: '各国央行联合降息，财政刺激开始摆上台面。' },
      { t: '2008-10-15', title: '标普单日 -9.03%', note: '危机中最惨的一天。这才是「系统性风险」长什么样。' },
      { t: '2008-11-25', title: '美联储正式实施 QE1', note: '直接买机构债和 MBS——日本 2001 年已经做过，美联储不是第一个。' },
      { t: '2008-12-16', title: '联邦基金利率降到 0', note: '常规工具用尽，接下来只能靠 QE。' },
      { t: '2009-03-09', title: '标普500 见底', note: '从 2007 年高点跌去 57%，这个底后来再没破。' },
      { t: '2009-03-18', title: '美联储宣布 QE2', note: '第二轮 1.75 万亿美元，危机还没结束但政策已经转向。' },
    ],
  },
  {
    id: '1990', title: '1990 日本泡沫破裂',
    headlineKey: 'N225',
    from: '1987-04-01', to: '1993-06-30',
    series: ['N225', 'SPX', 'HSI', 'GC00Y', 'CL00Y', 'US10Y'],
    events: [
      { t: '1987-09-12', title: '日本央行加息', note: '把基准利率从 5% 降到 2.5%——听起来是宽松，其实是给泡沫降温。' },
      { t: '1987-10-20', title: '日经单日 -14.9%', note: '美国 10 月 19 日崩盘，日本隔一天崩得更狠。这就是泡沫的起点。' },
      { t: '1989-12-29', title: '日经见顶 38915', note: '这个位置站了整整一年，全世界都以为日本经济不会跌。' },
      { t: '1990-02-13', title: '日本央行加息至 5.25%', note: '泡沫开始裂开。' },
      { t: '1990-04-02', title: '日经 1990 年最大单日跌幅 -6.6%', note: '注意这个数字：1990 年整年最大单日跌幅只有 6.6%——日本泡沫是慢刀子，不是崩盘。' },
      { t: '1990-08-11', title: '日本央行加息至 6%', note: '加息成了压垮骆驼的最后一根稻草。' },
      { t: '1992-03-16', title: '日经跌破 2 万', note: '从 1989 年 12 月的峰值算起，不到 10 个月就跌掉了三分之一——两年后才轮到跌破 2 万。' },
      { t: '1992-08-18', title: '日经见底 14309', note: '较峰值跌去 63%。「泡沫经济总清算」结束，接下来是失去的十年。' },
    ],
  },
  {
    id: '1998', title: '1998 亚洲金融危机与 LTCM',
    headlineKey: 'HSI',
    from: '1997-04-01', to: '1999-06-30',
    series: ['HSI', 'N225', 'SPX', 'GC00Y', 'US10Y', 'VIX'],
    events: [
      { t: '1997-05-11', title: '泰铢崩盘', note: '国际炒家一天就把泰铢打下去 15%，盯住泰铢的汇率制度失守。' },
      { t: '1997-07-02', title: '亚洲金融危机全面爆发', note: '从泰国蔓延到印尼、马来西亚、菲律宾、然后是香港。' },
      { t: '1997-10-23', title: '恒指单日 -10.4%', note: '香港政府入市干预，仍没能挡住下跌。' },
      { t: '1997-10-28', title: '恒指单日 -13.7%', note: '「黑色星期五」。这是港股史上单日最大跌幅之一。' },
      { t: '1997-11-10', title: '恒指跌破 10000', note: '从 8 月的 16673 点一路跌下来，跌了四成。' },
      { t: '1998-08-13', title: '恒指见底 6660', note: '较 1997 年 8 月峰值跌去 60%，比亚洲其它市场跌得更深。' },
      { t: '1998-08-17', title: '俄罗斯违约', note: '卢布崩盘，全球市场最怕的事情发生了。' },
      { t: '1998-08-25', title: '美联储组织救助 LTCM', note: '一家对冲基金撑垮了，需要央行召集六家银行来救。' },
      { t: '1998-09-08', title: '雷曼因 LTCM 头寸股价被砸到低点', note: '它并没有被收购——十年后，它自己成了倒下那一家。' },
      { t: '1999-03-31', title: '美股掉头向上', note: '降息 + 互联网叙事，1999 到 2000 是史上最疯的两年。' },
    ],
  },
  {
    id: '1994', title: '1994 墨西哥比索危机',
    headlineKey: 'US10Y',
    from: '1993-10-01', to: '1995-12-31',
    series: ['SPX', 'US10Y', 'GC00Y', 'CL00Y', 'HSI'],
    events: [
      { t: '1994-01-01', title: '萨卡多平托掌权', note: '比索被盯上，汇率成为政治问题。' },
      { t: '1994-03-31', title: '比索危机爆发', note: '一夜之间贬值两成。' },
      { t: '1994-12-31', title: '美联储连续加息', note: '从 1994 年 2 月到 1995 年 2 月一共加了 7 次息——这轮紧缩比索危机还早半年：先有美元利率抬高，比索才撑不住。' },
      { t: '1995-02-28', title: '墨西哥经济企稳', note: '国际货币基金组织援助计划生效。' },
    ],
  },
  {
    id: '2022', title: '2022 年暴力加息：股债为什么一起跌',
    headlineKey: 'US10Y',
    from: '2021-12-01', to: '2023-06-30',
    series: ['SPX', 'IXIC', 'GC00Y', 'CL00Y', 'US10Y', 'US2Y', 'VIX'],
    events: [
      { t: '2021-12-15', title: '美联储承认通胀不是暂时的', note: '政策口径转向，市场开始给加息定价。' },
      { t: '2022-03-16', title: '本轮第一次加息', note: '联邦基金利率上调 25 个基点，零利率时代结束。' },
      { t: '2022-05-04', title: '加息 50 个基点', note: '单次幅度加大，缩表也排上日程。' },
      { t: '2022-06-15', title: '加息 75 个基点', note: '1994 年以来首次这么大的单次幅度。' },
      { t: '2022-06-16', title: '纳指与美债同时承压', note: '股票跌估值、债券跌价格：利率上行不是只打一类资产。' },
      { t: '2022-09-21', title: '连续第三次加息 75 个基点', note: '短端收益率抬得更快，曲线倒挂加深。' },
      { t: '2022-10-24', title: '10Y 到 4.25%', note: '财政部官方日频 10 年期收益率，2021 年末还在 1.5% 附近。' },
      { t: '2022-12-14', title: '加息幅度降到 50 个基点', note: '速度放缓不等于利率回到低位。' },
    ],
    note: '日频口径。SPX / IXIC / 黄金 / 原油 / VIX 与美债曲线分属不同来源；收益率变化用个百分点，价格用百分比。',
  },
  {
    id: '2020', title: '2020 年疫情熔断：流动性先崩，政策后救',
    headlineKey: 'SPX',
    from: '2020-01-02', to: '2021-03-31',
    series: ['SPX', 'IXIC', 'N225', 'HSI', 'GC00Y', 'CL00Y', 'US10Y', 'VIX'],
    events: [
      { t: '2020-01-23', title: '武汉封城', note: '疫情从地区事件变成全球供应链问题。' },
      { t: '2020-02-19', title: '标普创当时历史新高', note: '暴跌前的顶点，之后一个月跌去约三分之一。' },
      { t: '2020-03-09', title: '美股第一次熔断', note: '油价战与疫情叠加，盘中触发一级熔断。' },
      { t: '2020-03-12', title: '第二次熔断', note: '恐慌扩散到全球资产，黄金也开始被卖。' },
      { t: '2020-03-16', title: '第三次熔断', note: '美联储已降息到零，市场仍先处理流动性。' },
      { t: '2020-03-18', title: '第四次熔断', note: '十个交易日四次熔断，历史罕见。' },
      { t: '2020-03-23', title: '标普见底', note: '无限量 QE 与财政救助随后把流动性托住。' },
      { t: '2020-04-20', title: 'WTI 近月期货跌入负值', note: '交割与库存问题把期货价格打成负数，不等于所有原油都免费。' },
      { t: '2020-08-18', title: '标普收复前高', note: '指数回本比多数人的感受快，结构分化仍然很大。' },
    ],
    note: '日频口径。不同市场的交易日不完全重合，回放器按当日或之前最近值对齐；收益率用个百分点，价格用百分比。',
  },
  {
    id: '1987', title: '1987 黑色星期一',
    headlineKey: 'SPX',
    from: '1987-06-01', to: '1988-12-31',
    series: ['SPX', 'CL00Y'],
    events: [
      { t: '1987-10-19', title: '黑色星期一', note: '标普500 单日从 282.70 跌到 224.84，一天蒸发掉五分之一的市值。' },
      { t: '1987-10-20', title: '各地交易所紧急休市', note: '美国停市一天，全球市场像被按了暂停键。' },
      { t: '1987-11-30', title: '格林斯潘放水', note: '央行开始提供流动性。挤兑几周就止住了，但价格回到崩盘前用了近两年。' },
    ],
    note: 'VIX 与美债收益率的官方序列都从 1990 年开始，所以这场只能看标普和原油——这本身就是个诚实的数据边界。',
  },
];

/** 取一段区间的日频序列（东财） */
async function eastDaily(secid, from, to) {
  const u = `${EAST}?secid=${encodeURIComponent(secid)}&fields1=f1,f2`
    + `&fields2=f51,f53&klt=101&fqt=0&beg=${from.replace(/-/g, '')}&end=${to.replace(/-/g, '')}&lmt=5000`;
  const txt = await getText(u);
  const j = JSON.parse(txt);
  const d = j && j.data;
  if (!d || !d.klines || !d.klines.length) return [];
  return d.klines.map((line) => {
    const p = line.split(',');
    return { t: p[0], v: Number(p[1]) };
  }).filter((x) => Number.isFinite(x.v));
}

/** 危机包里的序列：从哪来（日频） */
const CRISIS_SOURCES = {
  SPX: { kind: 'east', secid: '100.SPX', yahoo: '^GSPC' },
  DJIA: { kind: 'east', secid: '100.DJIA', yahoo: '^DJI' },
  N225: { kind: 'east', secid: '100.N225', yahoo: '^N225' },
  HSI: { kind: 'east', secid: '100.HSI', yahoo: '^HSI' },
  GC00Y: { kind: 'east', secid: '101.GC00Y', yahoo: 'GC=F' },
  SI00Y: { kind: 'east', secid: '101.SI00Y', yahoo: 'SI=F' },
  CL00Y: { kind: 'east', secid: '102.CL00Y', yahoo: 'CL=F' },
  UDI: { kind: 'east', secid: '100.UDI', yahoo: 'DX-Y.NYB' },
  IXIC: { kind: 'yahoo', symbol: '^IXIC' },
  VIX: { kind: 'cboe' },
  US10Y: { kind: 'treasury', col: '10 Yr' },
  US2Y: { kind: 'treasury', col: '2 Yr' },
  US3M: { kind: 'treasury', col: '3 Mo' },
  US30Y: { kind: 'treasury', col: '30 Yr' },
};

const dailyCache = new Map();

/** CBOE VIX 原始日频 */
async function cboeDaily() {  if (dailyCache.has('VIX')) return dailyCache.get('VIX');
  const txt = await cboeCsv();
  const lines = txt.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((s) => s.trim().toUpperCase());
  const ci = head.indexOf('CLOSE'), di = head.indexOf('DATE');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length <= ci) continue;
    const iso = usToIso(String(p[di]).trim());
    const v = Number(p[ci]);
    if (!iso || !Number.isFinite(v)) continue;
    out.push({ t: iso, v });
  }
  out.sort((a, b) => a.t.localeCompare(b.t));
  dailyCache.set('VIX', out);
  return out;
}

/** 美国财政部收益率曲线原始日频（按年增量抓，内存缓存） */
const treasuryRaw = new Map();
async function treasuryDaily(col, from, to) {
  // 全量缓存仍按列保留，但只抓覆盖目标区间的年份：
  // 新包要看 2013 / 2022 时，没必要把 1989–2026 每年 CSV 都打一遍。
  const y0 = from ? Number(String(from).slice(0, 4)) : 1989;
  const y1 = to ? Number(String(to).slice(0, 4)) : new Date().getUTCFullYear();
  const key = col + ':' + y0 + '-' + y1;
  if (treasuryRaw.has(key)) return treasuryRaw.get(key);
  const all = [];
  for (let y = y0; y <= y1; y++) {
    const txt = await treasuryCsv(y);
    if (!txt) continue;
    const lines = txt.trim().split(/\r?\n/);
    const head = lines[0].split(',').map((s) => s.trim().replace(/^"|"$/g, '').trim());
    const di = head.indexOf('Date');
    const ci = head.indexOf(col);
    if (di < 0 || ci < 0) continue;
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const iso = usToIso(String(p[di]).trim().replace(/^"|"$/g, ''));
      // 同上：空单元格当缺失，不当 0
      const cell = String(p[ci] === undefined ? '' : p[ci]).trim().replace(/^"|"$/g, '');
      if (!iso || !cell) continue;
      const v = Number(cell);
      if (!Number.isFinite(v)) continue;
      all.push({ t: iso, v });
    }
    await sleep(80);
  }
  all.sort((a, b) => a.t.localeCompare(b.t));
  treasuryRaw.set(key, all);
  return all;
}

/** 每天按日期把东财序列的采集顺序转一下。
    为什么：上游（push2his）会限流——一轮下来通常只有前十几条能取到，
    实测第 19 条之后开始连着 fetch failed。顺序固定的话，
    被挡住的那几条**永远排不到**，就一直缺着。
    按天轮转之后，被挡住的下一轮就排到前面了；
    成功的照旧写盘，失败的保留旧文件（宁缺毋假）。 */
function orderedEastDefs(defs) {
  const off = Math.floor(Date.now() / 86400000) % defs.length;
  return defs.slice(off).concat(defs.slice(0, off));
}

async function buildCrisis(def) {
  const series = [];
  const missing = [];
  for (const k of def.series) {
    const src = CRISIS_SOURCES[k];
    if (!src) { console.warn(`  [skip] ${def.id}/${k}：未知来源`); missing.push(k); continue; }
    let pts = [];
    try {
      if (src.kind === 'east') {
        try {
          pts = await eastDaily(src.secid, def.from, def.to);
        } catch (e) {
          // 主源被掐不等于这段历史不存在：有 Yahoo 备源就换过去，别直接判缺。
          if (src.yahoo) {
            console.warn(`  [fallback] ${def.id}/${k}：东财不可达（${e.message}），改用 Yahoo ${src.yahoo}`);
            pts = await yahooDaily(src.yahoo, def.from, def.to);
          } else throw e;
        }
        // 主源「通了但这一段没数据」也允许备源补一次（空数组不抛错）。
        if (!pts.length && src.yahoo) pts = await yahooDaily(src.yahoo, def.from, def.to);
      }
      else if (src.kind === 'yahoo') pts = await yahooDaily(src.symbol, def.from, def.to);
      else if (src.kind === 'cboe') pts = (await cboeDaily()).filter((p) => p.t >= def.from && p.t <= def.to);
      else if (src.kind === 'treasury') pts = (await treasuryDaily(src.col, def.from, def.to)).filter((p) => p.t >= def.from && p.t <= def.to);
    } catch (e) { console.warn(`  [skip] ${def.id}/${k}：${e.message}`); missing.push(k); continue; }
    if (!pts.length) { console.warn(`  [skip] ${def.id}/${k}：区间内无数据`); missing.push(k); continue; }
    const meta = await seriesMeta(k);
    series.push({ key: k, name: meta.name, unit: meta.unit, digits: meta.digits, points: pts });
  }
  // 危机包是**一组**序列：回放器把它们对齐到同一条日期轴上，缺一条图就是残的。
  // 之前缺了就照样写盘，于是上游一次抖动 → 恒指没了 → 1998 危机页少一条线，
  // 而头条还会悄悄换成别的资产（见 buildCrisisIndex）——那是会骗人的降级。
  // 宁缺毋假：缺任何一条就**不写**，保留上一版完整包，等下一轮补上。
  if (missing.length) {
    console.warn(`  [skip] crisis-${def.id}：缺 ${missing.join('、')}，保留旧包（不写残缺包）`);
    return;
  }
  if (!series.length) { console.warn(`  [skip] crisis-${def.id}：没有可用序列`); return; }

  // 规范日期轴：所有序列日期的并集
  const set = new Set();
  for (const s of series) for (const p of s.points) set.add(p.t);
  const dates = [...set].sort();

  const payload = {
    id: def.id,
    title: def.title,
    from: def.from, to: def.to, freq: 'D',
    generatedAt: new Date().toISOString(),
    dates,
    series,
    // 这一场**应该**有哪几条序列，写进产物里。
    // 有了它，CI 才能断言「包没缺序列」——缺一条的包在回放器里就是残的图。
    expectedSeries: def.series,
    events: def.events || [],
    source: '东方财富（指数/商品）· CBOE（VIX）· 美国财政部（美债收益率）',
    note: def.note || '日频口径。前复权与否按各源原始序列，不做跨源价格调整。',
  };
  await writeFile(path.join(OUT, 'crisis-' + def.id + '.json'), JSON.stringify(payload), 'utf8');
  console.log(`  [ok] crisis-${def.id}  ${dates.length} 个交易日 × ${series.length} 条序列  ${def.title}`);
}

/** 标准最大回撤：谷底必须落在峰值之后。
    拿全局 max / min 直接相除，在谷底早于峰值时会算出两个不相干日期的比值，
    挂到页面上就是假数字。返回 { peak, trough, signed }。 */
function maxDrawdown(points) {
  if (!points || points.length < 2) return null;
  let peak = null, peakPt = null, worst = 0, troughPt = null;
  for (let i = 0; i < points.length; i++) {
    const v = points[i].v;
    if (v === null || v === undefined) continue;
    if (peak === null || v > peak) { peak = v; peakPt = points[i]; }
    const dd = peak ? ((v / peak) - 1) * 100 : 0;
    if (dd < worst) { worst = dd; troughPt = points[i]; }
  }
  if (!peakPt || !troughPt) return null;
  return { peak: peakPt, trough: troughPt, signed: worst };
}

/** 危机包轻量索引：列表页只读这个，不加载几百 KB 的完整包
    头条资产由 CRISIS_DEFS 的 headlineKey 指定（是编辑判断），
    但数值一律从数据算（不是手写）——指定"看哪条"，不指定"是多少"。 */
async function buildCrisisIndex() {
  const isYield = (k) => k === 'US10Y' || k === 'US2Y' || k === 'US3M' || k === 'US30Y';
  const items = [];
  for (const def of CRISIS_DEFS) {
    const p = path.join(OUT, 'crisis-' + def.id + '.json');
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(await readFile(p, 'utf8'));

    // 头条资产由 CRISIS_DEFS 的 headlineKey 指定（是编辑判断），
    // 数值一律从数据算（不是手写）——指定"看哪条"，不指定"是多少"。
    // 找不到 headlineKey 就**跳过这一场**：悄悄换成另一条资产，
    // 等于让读者以为 1998 年的头条还是恒指，其实已经是别的东西了。
    const s = (pkg.series || []).find((x) => x.key === def.headlineKey);
    if (!s) {
      console.warn(`  [skip] crisis-index ${def.id}：包内缺头条序列 ${def.headlineKey}`);
      continue;
    }

    let hi = null, lo = null, worst = { pct: 0, t: '' };
    for (let i = 0; i < s.points.length; i++) {
      const q = s.points[i];
      if (!hi || q.v > hi.v) hi = q;
      if (!lo || q.v < lo.v) lo = q;
      if (i > 0) {
        const pct = (q.v / s.points[i - 1].v - 1) * 100;
        if (pct < worst.pct) worst = { pct, t: q.t };
      }
    }
    // 峰谷要**有先后**：谷底必须落在峰值之后，才算「从高点跌下来」。
    // 拿全局 max / min 直接相除，在谷底早于峰值时会算出两个不相干日期的比值。
    const dd = maxDrawdown(s.points);
    const yieldType = isYield(s.key);
    // 收益率讲的是「区间跨度」（最高 - 最低），不涉及先后，所以用全局 hi/lo；
    // 价格讲的是「跌了多少」，用真正的最大回撤那一对。
    const peak = yieldType ? hi : (dd ? dd.peak : hi);
    const trough = yieldType ? lo : (dd ? dd.trough : lo);
    items.push({
      id: pkg.id, title: pkg.title,
      from: pkg.dates[0], to: pkg.dates[pkg.dates.length - 1],
      days: pkg.dates.length, freq: pkg.freq,
      seriesCount: (pkg.series || []).length,
      events: (pkg.events || []).length,
      headline: {
        key: s.key, name: s.name, kind: yieldType ? 'yield' : 'price',
        peak: { t: peak.t, v: peak.v },
        trough: { t: trough.t, v: trough.v },
        // 收益率用「区间变动（个百分点）」，价格用「峰谷跌幅（%）」——两者不能混
        dropPct: yieldType ? null : (dd ? dd.signed : (trough.v / peak.v - 1) * 100),
        changePp: yieldType ? (peak.v - trough.v) : null,
        worstDay: worst.pct ? { t: worst.t, pct: worst.pct } : null,
      },
      note: pkg.note || '',
    });
  }
  await writeFile(path.join(OUT, 'crisis-index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items }), 'utf8');
  console.log(`  [ok] crisis-index  ${items.length} 场（列表页只读这个）`);
}

/** 取序列的名称/单位/小数位（读月度产物即可，元信息一致） */
async function seriesMeta(id) {
  try {
    const j = JSON.parse(await readFile(path.join(OUT, id + '.json'), 'utf8'));
    return { name: j.name, unit: j.unit, digits: j.digits };
  } catch (e) {
    return { name: id, unit: '', digits: 2 };
  }
}

/* ---------------- 产业链 secid 解析 ---------------- */
async function resolveChainSecids() {
  const srcFile = path.join(ROOT, 'vendor', 'core', 'industry-chains.js');
  if (!existsSync(srcFile)) { console.warn('  [chain] vendor 尚未同步，跳过'); return; }
  const txt = await readFile(srcFile, 'utf8');
  const re = /\{\s*name:\s*'([^']+)'\s*,\s*symbol:\s*'([^']+)'/g;
  const stocks = new Map();
  let m;
  while ((m = re.exec(txt))) stocks.set(m[2], m[1]);

  const map = {};
  const usList = [];
  for (const [symbol, name] of stocks) {
    if (/^sh\d{6}$/.test(symbol)) map[symbol] = { name, secid: '1.' + symbol.slice(2) };
    else if (/^sz\d{6}$/.test(symbol)) map[symbol] = { name, secid: '0.' + symbol.slice(2) };
    else if (/^hk\d{4,5}$/.test(symbol)) map[symbol] = { name, secid: '116.' + symbol.slice(2) };
    else if (/^us[A-Z0-9.]+$/.test(symbol)) usList.push([symbol, name]);
  }

  // 美股：105=纳斯达克 106=纽交所 107=AMEX，一次批量试出来
  const cand = [];
  usList.forEach(([symbol, name]) => {
    [105, 106, 107].forEach((mk) => cand.push({ symbol, name, secid: mk + '.' + symbol.slice(2) }));
  });
  for (let i = 0; i < cand.length; i += 50) {
    const chunk = cand.slice(i, i + 50);
    const ids = chunk.map((c) => c.secid).join(',');
    const u = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f12,f13,f14&secids=${encodeURIComponent(ids)}`;
    try {
      const j = JSON.parse(await getText(u));
      const diff = (j.data && j.data.diff) || [];
      const found = new Set(diff.map((d) => `${d.f13}.${d.f12}`));
      chunk.forEach((c) => {
        if (found.has(c.secid) && !map[c.symbol]) {
          map[c.symbol] = { name: c.name, secid: c.secid };
        }
      });
    } catch (e) { console.warn('  [chain] 一批解析失败：' + e.message); }
    await sleep(100);
  }

  await writeFile(path.join(ROOT, 'data', 'chain-secids.json'), JSON.stringify(map, null, 1), 'utf8');
  const missing = [...stocks.keys()].filter((s) => !map[s]);
  console.log(`  [ok] chain-secids  ${Object.keys(map).length}/${stocks.size} 只成分股已解析${missing.length ? `，未解析 ${missing.length} 只` : ''}`);
}

/* ---------------- 主流程 ---------------- */

/* 终端 universe（vendor 里同步过来的那份）——两边共用同一份标的清单 */
async function loadVendorUniverse() {
  const p = path.join(ROOT, 'vendor', 'core', 'universe.js');
  if (!existsSync(p)) return [];
  const src = await readFile(p, 'utf8');
  const ctx = { window: {}, console };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: 'vendor/core/universe.js' });
  return (ctx.window.TENCENT_UNIVERSE || []).slice();
}

/* 已经用别的方式采过的（指数/商品有专门的采集路径），个股环节跳过 */
const INSTRUMENT_COVERED = new Set([
  'sh000001', 'sz399001', 'sz399006', 'sh000688',   // A股四大指数
  'usINX', 'usDJI',                                  // 标普 / 道指
  'hkHSI', 'hkHSTECH',                               // 恒指 / 恒生科技
]);

function unitOf(u) {
  if (u.symbol.startsWith('hk')) return '港元';
  if (u.symbol.startsWith('us')) return '美元';
  return '人民币';
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const seriesMap = {};

  console.log('[collect] 东方财富：指数与商品月线');
  const eastDefs = [
    // 指数点位保留两位小数：回放器里读者要能对着原始收盘价核对
    ['SPX', '100.SPX', '标普500', '点', 2, '东方财富 push2his 100.SPX'],
    // ⚠ 东财的 secid 叫「100.NDX」，但它**返回的是纳斯达克综合指数**，不是纳指100。
    //   证据：它与腾讯源的 usIXIC（综合指数）在 234 个重叠交易日里数值一致到 ±0.27% 以内；
    //   而真正的纳指100 应比综合指数高 4—5%（2007-03-30 综合指数收 2421.64，
    //   纳指100 当时在 2000 附近）。所以这里登记为 IXIC（综合指数），
    //   序列 id 也叫 IXIC，免得下一个人把「100.NDX」当成纳指100 再用一次。
    //   站内另有腾讯源的 usIXIC（2007 年起），两者是同一条线的不同历史段。
    ['IXIC', '100.NDX', '纳斯达克综合指数', '点', 2, '东方财富 push2his 100.NDX（该 secid 实际返回的是综合指数，见上方注释）'],
    ['DJIA', '100.DJIA', '道琼斯工业指数', '点', 2, '东方财富 push2his 100.DJIA'],
    ['N225', '100.N225', '日经225', '点', 2, '东方财富 push2his 100.N225'],
    ['HSI', '100.HSI', '恒生指数', '点', 2, '东方财富 push2his 100.HSI'],
    ['HSTECH', '100.HSTECH', '恒生科技指数', '点', 2, '东方财富 push2his 100.HSTECH'],
    ['SH000001', '1.000001', '上证指数', '点', 2, '东方财富 push2his 1.000001'],
    ['SZ399001', '0.399001', '深证成指', '点', 2, '东方财富 push2his 0.399001'],
    ['SZ399006', '0.399006', '创业板指', '点', 2, '东方财富 push2his 0.399006'],
    ['SH000688', '1.000688', '科创50', '点', 2, '东方财富 push2his 1.000688'],
    ['GC00Y', '101.GC00Y', 'COMEX黄金', '美元/盎司', 2, '东方财富 push2his 101.GC00Y'],
    ['SI00Y', '101.SI00Y', 'COMEX白银', '美元/盎司', 2, '东方财富 push2his 101.SI00Y'],
    ['CL00Y', '102.CL00Y', 'NYMEX原油', '美元/桶', 2, '东方财富 push2his 102.CL00Y'],
    ['UDI', '100.UDI', '美元指数', '', 2, '东方财富 push2his 100.UDI'],
    // —— 下面这批是终端「全球指数条 / 宏观面板 / 外汇」里的标的 ——
    // 之前只有终端能给实时价，站内没有月线序列，于是这些标的**一个页都没有**
    // （终端只能退回去给术语页）。secid 全部取自终端 universe 自己带的 secid 字段，
    // 不是猜的：终端就是拿这些 secid 问东财要价的。
    ['GDAXI', '100.GDAXI', '德国DAX', '点', 2, '东方财富 push2his 100.GDAXI'],
    ['FTSE', '100.FTSE', '英国富时100', '点', 2, '东方财富 push2his 100.FTSE'],
    ['FCHI', '100.FCHI', '法国CAC40', '点', 2, '东方财富 push2his 100.FCHI'],
    ['KS11', '100.KS11', '韩国KOSPI', '点', 2, '东方财富 push2his 100.KS11'],
    ['SENSEX', '100.SENSEX', '印度SENSEX', '点', 2, '东方财富 push2his 100.SENSEX'],
    ['HG00Y', '101.HG00Y', 'COMEX铜', '美元/磅', 3, '东方财富 push2his 101.HG00Y'],
    ['NG00Y', '102.NG00Y', 'NYMEX天然气', '美元/百万英热', 3, '东方财富 push2his 102.NG00Y'],
    ['ZC00Y', '103.ZC00Y', 'CBOT玉米连续', '美元/蒲式耳', 2, '东方财富 push2his 103.ZC00Y'],
    ['CN2Y', '171.CN2Y', '中债2年期国债收益率', '%', 2, '东方财富 push2his 171.CN2Y'],
    ['CN5Y', '171.CN5Y', '中债5年期国债收益率', '%', 2, '东方财富 push2his 171.CN5Y'],
    ['CN10Y', '171.CN10Y', '中债10年期国债收益率', '%', 2, '东方财富 push2his 171.CN10Y'],
    ['CN30Y', '171.CN30Y', '中债30年期国债收益率', '%', 2, '东方财富 push2his 171.CN30Y'],
    ['DE10Y', '171.DE10Y', '德国10年期国债收益率', '%', 2, '东方财富 push2his 171.DE10Y'],
    ['JP10Y', '171.JP10Y', '日本10年期国债收益率', '%', 2, '东方财富 push2his 171.JP10Y'],
    ['USDCNH', '133.USDCNH', '美元离岸人民币', '人民币/美元', 4, '东方财富 push2his 133.USDCNH'],
    ['EURUSD', '119.EURUSD', '欧元美元', '美元/欧元', 4, '东方财富 push2his 119.EURUSD'],
    ['GBPUSD', '119.GBPUSD', '英镑美元', '美元/英镑', 4, '东方财富 push2his 119.GBPUSD'],
    ['USDJPY', '119.USDJPY', '美元日元', '日元/美元', 3, '东方财富 push2his 119.USDJPY'],
    ['USDHKD', '119.USDHKD', '美元港币', '港元/美元', 4, '东方财富 push2his 119.USDHKD'],
  ];
  for (const [id, secid, name, unit, digits, source] of orderedEastDefs(eastDefs)) {
    if (!want('east')) break;
    if (!wantedSeries(id)) continue;
    let pts = [], used = source;
    try {
      pts = await eastMonthly(secid);
    } catch (e) {
      console.warn(`  [fallback] ${id}：东财不可达（${e.message}），改用腾讯备源`);
    }
    if (!pts.length) {
      try {
        pts = await tencentMonthly(secid);
        if (!pts.length) pts = await tencentMonthlyHK(secid);
        if (pts.length) used = `腾讯 ifzq 备源 ${secid}`;
      } catch (e) { console.warn(`  [skip] ${id}：${e.message}`); }
    }
    if (!pts.length) {
      console.warn(`  [skip] ${id}：两个源都没取到数据`);
    } else {
      const p = await writeSeries(id, { name, unit, digits, freq: 'M', source: used, kind: '月收盘价' }, pts);
      if (p) seriesMap[id] = p;
    }
    await sleep(500);
  }

  // 终端 universe 里的个股：终端能看的每一只，科普站也要能查到它的历史。
  // 腾讯源是**不复权**价（不含分红），所以 kind 照实写，页面里也照实说。
  console.log('[collect] 终端 universe：个股月线（腾讯 ifzq）');
  if (want('instruments')) {
    const uni = await loadVendorUniverse();
    for (const u of uni) {
      if (!wantedSeries(u.symbol)) continue;
      if (INSTRUMENT_COVERED.has(u.symbol)) continue;
      try {
        const raw = await tencentMonthlySymbolRobust(u.symbol);
        if (!raw.length) { console.warn(`  [skip] ${u.symbol}：无数据`); continue; }
        const ym = await yahooMonthly(u.symbol);
        let pts = raw, srcNote;
        if (ym && ym.size) {
          // 腾讯的港股序列会带上上市之前的脏数据（华润啤酒能回到 1983），
          // 用 Yahoo 的起始月裁掉——那才是这只票真正存在的起点
          const firstY = [...ym.keys()].sort()[0];
          const trimmed = raw.filter((p) => p.t.slice(0, 7) >= firstY);
          const useRaw = trimmed.length >= 12 ? trimmed : raw;
          // 1) 从能对上的月份反推基准比例（当前价位 ≈ 1）
          const matched = [];
          useRaw.forEach((p, i) => {
            const yv = ym.get(p.t.slice(0, 7));
            if (yv !== undefined && yv !== 0) matched.push({ i, f: p.v / yv });
          });
          const tail = matched.filter((m) => m.i >= useRaw.length - 24);
          const base = tail.length ? tail[tail.length - 1].f
            : (matched.length ? matched[matched.length - 1].f : 1);
          // 2) 拆股事件定比例，价格断崖定生效位置
          const splits = await yahooSplits(u.symbol);
          pts = rescaleBySplits(useRaw, splits, base);
          srcNote = '价：Yahoo Finance（拆股复权）· 日期：腾讯 ifzq';
        } else {
          srcNote = '腾讯 ifzq（未复权）';
        }
        const p = await writeSeries(u.symbol, {
          name: u.label, unit: unitOf(u), digits: 2, freq: 'M',
          source: srcNote,
          // 口径必须跟实际走通的分支一致。
          // 之前 kind 是写死的「已按拆股复权」，哪怕这次走的是未复权备源，
          // 页面上就出现「已复权 · 未复权」两句自相矛盾的话。
          kind: srcNote.includes('未复权')
            ? '月末收盘（未复权，不含分红）'
            : '月末收盘（已按拆股复权，不含分红）',
        }, pts);
        if (p) seriesMap[u.symbol] = p;
      } catch (e) { console.warn(`  [skip] ${u.symbol}：${e.message}`); }
      await sleep(180);
    }
  }

  console.log('[collect] CBOE：VIX');  if (want('vix')) {
  try {
    const pts = await cboeVix();
    const p = await writeSeries('VIX', { name: 'VIX 恐慌指数', unit: '', digits: 1, freq: 'M', source: 'CBOE 官方 VIX_History.csv', kind: '月末收盘' }, pts);
    if (p) seriesMap['VIX'] = p;
  } catch (e) { console.warn('  [skip] VIX：' + e.message); }
  }

  console.log('[collect] 美国财政部：收益率曲线');
  if (want('treasury')) {
  const years = [];
  for (let y = 1990; y <= 2026; y++) years.push(y);
  const curve = await treasuryCurve(years);
  const tDefs = [
    ['US10Y', '美国10年期国债收益率', '%', 2],
    ['US5Y', '美国5年期国债收益率', '%', 2],
    ['US2Y', '美国2年期国债收益率', '%', 2],
    ['US3M', '美国3月期国库券收益率', '%', 2],
    ['US30Y', '美国30年期国债收益率', '%', 2],
  ];
  for (const [id, name, unit, digits] of tDefs) {
    const p = await writeSeries(id, {
      name, unit, digits, freq: 'M',
      source: '美国财政部官方 daily-treasury-rates.csv',
      kind: '月末值',
    }, curve[id] || []);
    if (p) seriesMap[id] = p;
  }
  }

  console.log('[collect] 组合危机回放包');
  if (want('crisis')) {
    for (const def of CRISIS_DEFS) if (wantedCrisis(def.id)) await buildCrisis(def);
    await buildCrisisIndex();
  }

  // 序列注册表（与已有注册表合并，便于分步采集）
  const regPath = path.join(ROOT, 'data', 'series-map.json');
  const prev = existsSync(regPath) ? JSON.parse(await readFile(regPath, 'utf8')) : { series: [] };
  const merged = new Map();
  // 注册表只 merge 不 prune：改过名、下过架的 id 会永远留在表里。
  // 正文引用一个没有数据文件的 id → 图表空白，而注册表本身看不出异常。
  (prev.series || []).forEach((s) => {
    if (existsSync(path.join(OUT, s.id + '.json'))) merged.set(s.id, s);
    else console.warn(`  [prune] ${s.id}：数据文件已不存在，从注册表移除`);
  });
  Object.values(seriesMap).forEach((s) => {
    merged.set(s.id, {
      id: s.id, name: s.name, unit: s.unit, freq: s.freq, kind: s.kind,
      source: s.source, from: s.points[0].t, to: s.points[s.points.length - 1].t, count: s.points.length,
    });
  });
  const registry = {
    generatedAt: new Date().toISOString(),
    note: '正文只能引用本表中的 id，杜绝临时抓数写进文章',
    series: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  await writeFile(regPath, JSON.stringify(registry, null, 2), 'utf8');
  console.log(`  [ok] series-map  ${registry.series.length} 条序列已登记`);

  console.log('[collect] 产业链成分股 secid 解析');
  if (want('chain')) await resolveChainSecids();

  console.log('[collect] 全部完成');
}

main().catch((e) => { console.error('[collect] 失败：', e); process.exit(1); });
