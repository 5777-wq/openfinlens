#!/usr/bin/env node
/* monitor.mjs —— Meridian 美股监控 CLI（monorepo 版，零依赖，Node 20+）
 * 移植自 us-stock-monitor monitor.mjs；指标/降级链/时钟全部改引 core/ 唯一真源，
 * 不保留旧版重复模块。产物协议见 us-schema.mjs。
 *
 * 监控策略（用户自述）：
 *   · 池子：SP500 实时市值前 topN + SPMO（核心攒股标的，固定监控）；
 *   · 指标：日线收盘 RSI6（Wilder）>70 超买（做T观察）/<30 超卖（吸纳观察）；
 *   · Vegas 三通道：EMA144/169 短 · EMA288/338 中 · EMA576/676 长，
 *     记录价格相对通道位置与当日上下穿事件；周线同参重算。
 * 产物（写仓库 data/，由 _scripts/push-data-branch.sh 提交 data 分支）：
 *   · data/us-signals.json        协议化轻量产物（绝不含全量 K 线）
 *   · data/us-signals-latest.csv  固定覆盖名（UTF-8 BOM）
 * 试跑安全：--limit / OFL_MOCK_HTTP（离线 mock）都算"试跑"——产物只写 preview 目录，
 * 绝不覆盖正式 data/ 产物（曾发生试跑快照顶掉全量报告的事故）。
 * 盘中运行安全：marketDate 只认已收盘交易日，未收盘 bar 只作 live 参考，不进信号。
 * 用法：
 *   node pipelines/meridian/monitor.mjs                       # 全量（首次约 2-4 分钟）
 *   node pipelines/meridian/monitor.mjs --limit 5             # 只取前 5 只（试跑）
 *   node pipelines/meridian/monitor.mjs --refresh-cache       # 忽略增量判断，全量重拉
 *   node pipelines/meridian/monitor.mjs --out <dir> --cache-dir <dir>
 *   OFL_MOCK_HTTP=<路由JSON> node monitor.mjs --limit 5       # 离线 mock（测试/试跑专用）
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSeries, eastStatus, yahooStatus, tencentQuotes, anchorSeries } from '../../core/sources/history.mjs';
import { emaSeries } from '../../core/engine/indicators.mjs';
import { evaluate, summarize, stalenessGate } from '../../core/engine/signals.mjs';
import { lastClosedDate, etNow } from '../../core/engine/market-time.mjs';
import { buildUniverse, tvSymbolOf, normalizeWatchlist, splitWatchlist, watchTargetOf } from './universe.mjs';
import { rowContext, signalHistory, statsOf } from './analytics.mjs';
import { consoleReport, writeOutputs } from './report.mjs';
import { notifyIfEnabled } from './notify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOCK = !!process.env.OFL_MOCK_HTTP;   // 离线 mock 通道（见 core/sources/history.mjs 头注）

/* 单标的有限重试 [FIX-06]：全链失败/异常等 500ms 再试一次（多数是瞬时网络抖动）。
 * 东财侧的节奏与熔断由 sources.eastKline 内部管理（600ms 间隔 + 60s 冷却），这里不额外加压。 */
async function getSeriesWithRetry(ticker, opts) {
  let r = null;
  for (let i = 0; i < 2; i++) {
    try { r = await getSeries(ticker, opts); }
    catch { r = null; }
    if (r && r.bars && r.bars.length) return r;
    if (i === 0) await sleep(500);
  }
  return r;
}

/* ---------- 参数与配置 ---------- */

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (t === '--config') a.config = argv[++i];
    else if (t === '--refresh-cache') a.refresh = true;
    else if (t === '--quiet') a.quiet = true;
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--cache-dir') a.cacheDir = argv[++i];
    else if (t === '--help' || t === '-h') a.help = true;
    else a._.push(t);
  }
  return a;
}

function loadConfig(file) {
  const p = path.resolve(HERE, file || 'config.json');
  const defaults = {
    universe: { topN: 150, candidatesFile: 'core/registry/sp500-candidates.json', quoteBatch: 60 },
    rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 },
    tunnels: [
      { key: '短通道', n: [144, 169] },
      { key: '中通道', n: [288, 338] },
      { key: '长通道', n: [576, 676] },
    ],
    sources: { bootstrapLmt: 2000, refreshLmt: 120 },
    watchlist: { tickers: [] },
    report: { console: true, csv: true },
    notify: { enabled: false, onlySignals: true, serverchanSendkey: '', barkUrl: '', telegramToken: '', telegramChatId: '' },
  };
  if (!existsSync(p)) return defaults;
  const user = JSON.parse(readFileSync(p, 'utf8'));
  /* 公开 config.json 出现真实推送密钥 = 泄露通道：告警并拒发。
   * 密钥的正确去处是 config.local.json 或 CI 的 NOTIFY_* Secrets。 */
  const pubNotify = (user && user.notify) || {};
  if (['serverchanSendkey', 'barkUrl', 'telegramToken', 'telegramChatId'].some((k) => typeof pubNotify[k] === 'string' && pubNotify[k])) {
    console.error('✗ 安全防护：config.json 里出现 notify 推送密钥（会随公开仓库泄露）——已禁用推送。密钥请放 config.local.json 或 NOTIFY_* 环境变量。');
    user.notify = { ...(user.notify || {}), enabled: false };
  }
  const merge = (d, u) => {
    if (!u) return d;
    const o = Array.isArray(d) ? [...d] : { ...d };
    for (const k of Object.keys(u)) o[k] = u[k] && typeof u[k] === 'object' && !Array.isArray(u[k]) ? merge(d[k] || {}, u[k]) : u[k];
    return o;
  };
  let merged = merge(defaults, user);
  /* config.local.json（gitignore，持仓隐私）叠加在 config.json 之上；
   * --config 显式指定时不叠加（明确要看的就只是那份配置）。坏文件静默忽略。 */
  if (!file) {
    const lp = path.join(HERE, 'config.local.json');
    if (existsSync(lp)) {
      try { merged = merge(merged, JSON.parse(readFileSync(lp, 'utf8'))); }
      catch { /* 隐私配置层解析失败不弄挂监控 */ }
    }
  }
  return merged;
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node pipelines/meridian/monitor.mjs [--limit N] [--config file] [--refresh-cache] [--quiet] [--out dir] [--cache-dir dir]');
    process.exit(0);
  }
  const cfg = loadConfig(args.config);
  // 试跑（--limit 或离线 mock）只写 preview，绝不覆盖正式 data/ 产物
  const trial = !!(args.limit || MOCK);
  const outDir = args.out ? path.resolve(args.out)
    : trial ? path.join(REPO_ROOT, '.meridian-cache', 'preview')
      : path.join(REPO_ROOT, 'data');
  const cacheDir = args.cacheDir ? path.resolve(args.cacheDir) : path.join(REPO_ROOT, '.meridian-cache', 'klines');
  const quiet = args.quiet;

  const et = etNow();
  const marketDate = lastClosedDate();
  if (!quiet) console.error(`[${et.date} ${et.hhmm} ET] 最后已收盘交易日: ${marketDate}${MOCK ? '（离线 MOCK 模式：数据来自 OFL_MOCK_HTTP 路由）' : ''}`);

  /* 1. 池子：SP500 候选 → 实时市值前 N */
  const { universe, candidatesMeta, spmoHoldings, spmoQuote, ndxMeta, sp500Set, ndxSet } = await buildUniverse({
    topN: cfg.universe.topN,
    candidatesFile: cfg.universe.candidatesFile,
    quoteBatch: cfg.universe.quoteBatch,
  });
  const picked = args.limit ? universe.slice(0, args.limit) : universe;
  if (!quiet) console.error(`候选池 ${candidatesMeta.asOf} 共 ${universe.length}+1 只（含SPMO）；报价命中 ${universe.filter((r) => !r.mcapMissing).length}/${universe.length}`);

  /* 2. 逐标的取数 + 评估（SPMO 排第一） */
  const targets = [
    {
      ticker: 'SPMO', rank: null, mcapUsd: null, spmoPct: null,
      name: (spmoQuote && spmoQuote.name) || '标普500动量ETF-Invesco',
      quotePrice: spmoQuote ? spmoQuote.price : null,
      tvSymbol: tvSymbolOf(spmoQuote && spmoQuote.code, 'SPMO'),
    },
    ...picked,
  ];

  /* 1.5 自选/持仓：池内标的就地打标（不重复取数），池外标的补报价后新增目标 */
  const watchlist = normalizeWatchlist(cfg.watchlist);
  const { extra: extraWatch } = splitWatchlist(targets, watchlist);
  if (extraWatch.length) {
    const wQuotes = await tencentQuotes(extraWatch.map((w) => w.ticker), { batch: cfg.universe.quoteBatch || 60 });
    targets.push(...extraWatch.map((w) => watchTargetOf(
      w,
      wQuotes.find((q) => String(q.query || '').replace(/^us/i, '').toUpperCase() === w.ticker),
    )));
  }
  if (watchlist.length && !quiet) console.error(`自选/持仓 ${watchlist.length} 只（池内打标 ${watchlist.length - extraWatch.length} · 池外新增 ${extraWatch.length}）`);

  /* 1.6 成分标注：SP500（候选快照）与纳指100（QQQ 成分快照）。ETF（SPMO/QQQ/TLT 等）两者皆非 */
  for (const t of targets) { t.sp500 = sp500Set.has(t.ticker); t.ndx = ndxSet.has(t.ticker); }

  const rows = [];
  const failed = [];
  // 历史信号统计的全池原始样本（信号后5日收益），最后汇总进 meta.sigStats
  const pooled = { obr: [], osr: [], ret: [] };
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    if (!quiet) console.error(`[${i + 1}/${targets.length}] ${m.ticker} …`);
    let series = null;
    try {
      series = await getSeriesWithRetry(m.ticker, {
        cacheDir,
        bootstrapLmt: cfg.sources.bootstrapLmt,
        refreshLmt: args.refresh ? cfg.sources.bootstrapLmt : cfg.sources.refreshLmt,
        eastProxy: cfg.sources.eastProxy || undefined,
      });
    } catch (e) { if (!quiet) console.error(`  ✗ ${e.message}`); }
    if (!series || series.bars.length < 30) { failed.push({ ...m, reason: series ? 'bars<30' : '取数失败' }); continue; }
    // 后复权序列锚定回现价口径（RSI/EMA 尺度不变，仅展示价回归真实价位）
    const anchored = anchorSeries(series, m.quotePrice);
    if (anchored !== series) series = anchored;
    const row = evaluate(m, series, cfg, marketDate);
    if (!row) { failed.push({ ...m, reason: '指标计算数据不足' }); continue; }
    row.anchored = series.anchored || false;
    row.tvSymbol = m.tvSymbol || m.ticker;
    if (m.watch) { row.watch = true; row.note = m.watchNote || ''; }
    // 专业级上下文：钝化背景（连续超买/通道上方天数）、扩展度、量比、本标的历史信号 5 日收益统计
    try {
      const closedBars = series.bars.filter((b) => b[0] <= marketDate);
      Object.assign(row, rowContext(closedBars, cfg));
      const hist = signalHistory(closedBars.map((b) => b[2]), cfg, 5);
      row.sigHist = { obr: statsOf(hist.obr), osr: statsOf(hist.osr), ret: statsOf(hist.ret) };
      pooled.obr.push(...hist.obr); pooled.osr.push(...hist.osr); pooled.ret.push(...hist.ret);
      if (row.obDays >= 5) {
        row.notes.push({ tag: 'RSI6', level: 'info', text: `RSI6 已连续 ${row.obDays} 个交易日收在超买区（>${cfg.rsi.overbought}）——趋势钝化背景，持续超买本身不是离场信号，但回落信号出现时值得更高关注。` });
      }
    } catch (e) { console.error(`  ⚠ 上下文统计失败 ${m.ticker}: ${e.message}`); }
    // K 线切片（原 HTML 报告用）不迁——产物走轻量协议，完整 K 线由增量缓存承载
    rows.push(row);
    await sleep(60);
  }

  const spmo = rows.find((r) => r.ticker === 'SPMO') || null;
  const stockRows = rows.filter((r) => r.ticker !== 'SPMO');
  const summary = summarize([spmo, ...stockRows].filter(Boolean));
  const es = eastStatus();
  const gate = stalenessGate([spmo, ...stockRows].filter(Boolean));

  const meta = {
    marketDate,
    dataDate: gate.dataDate,
    staleCount: gate.staleCount,
    staleTickers: gate.staleTickers.length > 12 ? gate.staleTickers.slice(0, 12).concat(['…']) : gate.staleTickers,
    generatedAt: new Date().toISOString(),
    generatedAtLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    runAtEt: `${et.date} ${et.hhmm} ET`,
    etDate: et.date,
    etTime: et.hhmm,
    topN: cfg.universe.topN,
    extraNote: ' + SPMO',
    candidatesAsOf: candidatesMeta.asOf,
    ndxAsOf: ndxMeta.asOf || null,
    universeNote: `SPMO持仓快照 ${spmoHoldings.asOf || '不可用'}（前40大，标记重合） · 纳指100快照 ${ndxMeta.asOf || '不可用'}`,
    srcEast: rows.filter((r) => r.source === 'eastmoney').length,
    srcYahoo: rows.filter((r) => r.source === 'yahoo').length,
    srcTx: rows.filter((r) => r.source === 'tencent').length,
    srcFail: failed.length,
    eastError: es.disabled ? (es.lastError || '熔断') : null,
    yahooError: (() => { const ys = yahooStatus(); return ys.fails && ys.lastError ? ys.lastError : null; })(),
    liveCount: rows.filter((r) => r.live).length,
    watchCount: rows.filter((r) => r.watch).length,
    mock: MOCK || undefined,
    // 市场宽度：当日涨跌家数 + RSI6 中位——一眼读市场状态
    breadth: (() => {
      const up = rows.filter((r) => Number.isFinite(r.chgPct) && r.chgPct > 0).length;
      const down = rows.filter((r) => Number.isFinite(r.chgPct) && r.chgPct < 0).length;
      const rsis = rows.map((r) => r.rsi6 && r.rsi6.value).filter(Number.isFinite).sort((a, b) => a - b);
      const rsiMed = rsis.length ? +rsis[Math.floor(rsis.length / 2)].toFixed(1) : null;
      return { up, down, upPct: rows.length ? Math.round((up / rows.length) * 100) : null, rsiMed };
    })(),
    // 历史信号验证（全池汇总）：信号出现后 5 日收益分布
    sigStats: { obr: statsOf(pooled.obr), osr: statsOf(pooled.osr), ret: statsOf(pooled.ret), horizonDays: 5, tickers: rows.length },
  };

  const data = { meta, cfg, spmo, rows: stockRows, summary, failed, outputs: [] };

  // 全失败保护：先于一切写出检查——绝不覆盖本地最后一份好报告
  if (!rows.length) {
    console.error('✗ 全部取数失败 —— 检查网络后重试，或删掉缓存目录后重跑');
    process.exit(2);
  }

  // 发布闸门 [FIX-04]：陈旧行占比 >5% 视为数据源大面积延迟/停更——只写 preview 排查，
  // 绝不把陈旧数据顶掉上一份好报告；非 0 退出触发 CI 失败告警
  if (gate.blocked && !trial) {
    writeOutputs(data, path.join(REPO_ROOT, '.meridian-cache', 'preview'), { csv: cfg.report.csv });
    console.error(`✗ 陈旧数据闸门：${gate.staleCount}/${rows.length} 行（${(gate.staleRatio * 100).toFixed(1)}%）落后报告日 >1 个交易日——正式产物未发布（已写 .meridian-cache/preview）。stale 标的：${gate.staleTickers.join(' ')}`);
    process.exit(3);
  }

  // 试跑（--limit / mock）只写 preview 目录；正式跑写 data/
  const outputs = writeOutputs(data, outDir, { csv: cfg.report.csv });
  data.outputs = outputs.map((p) => path.relative(REPO_ROOT, p));
  if (!quiet) console.error(`产物：${data.outputs.join(' · ')}${trial ? '（试跑模式，未触碰正式 data/ 产物）' : ''}`);

  if (cfg.report.console !== false && !quiet) console.log(consoleReport(data));

  // mock 模式绝不触发推送（假数据不该进任何真实通知渠道）
  if (MOCK) {
    console.error('[mock] 离线 mock 模式：跳过推送');
  } else {
    await notifyIfEnabled(cfg.notify, data);
  }
}

main().catch((e) => { console.error('✗ 运行失败:', e && e.stack || e); process.exit(1); });
