/* report.mjs —— 输出层：控制台表格 / data/us-signals.json / data/us-signals-latest.csv
 * 移植自 Meridian lib/report.mjs 的控制台与 CSV 层。HTML 自包含报告与 klines.json
 * **不迁**（monorepo 里由终端「美股信号」Tab 替代，Gemini 裁定）。
 * 产物命名（Gemini 裁定）：
 *   · us-signals.json        —— 协议化轻量产物（schemaVersion 1，见 us-schema.mjs）
 *   · us-signals-latest.csv  —— 固定覆盖名（不再按日期堆积撑爆 data 分支），UTF-8 BOM
 * 落盘走 同目录 *.tmp + rename（同目录 rename 原子）——半途失败绝不留下半份产物。 */

import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildUsSignals, validateUsSignals } from './us-schema.mjs';

/* ---------- 文本对齐（CJK 记 2 列） ---------- */
const w = (s) => String(s ?? '').split('').reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e00 ? 2 : 1), 0);
function pad(s, n, right = false) {
  s = String(s ?? '');
  const gap = n - w(s);
  if (gap <= 0) return s;
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}
const fmtNum = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const fmtPct = (v, d = 2, sign = true) => (Number.isFinite(v) ? (sign && v > 0 ? '+' : '') + v.toFixed(d) + '%' : '--');
const POS_TXT = { above: '上', inside: '内', below: '下' };
const RSI_TXT = { overbought: '超买', oversold: '超卖', neutral: '' };

/* 按显示宽度截断（CJK 记 2），超宽补省略号 */
function clip(s, n) {
  let out = '', wsum = 0;
  for (const ch of String(s ?? '')) {
    const cw = ch.charCodeAt(0) > 0x2e00 ? 2 : 1;
    if (wsum + cw > n - 1) { out += '…'; break; }
    out += ch; wsum += cw;
  }
  return out;
}

function rowLine(r) {
  const t = r.tunnels || [];
  const tun = (i) => (t[i] && t[i].pos ? POS_TXT[t[i].pos] + (t[i].event && t[i].event.startsWith('break') ? '!' : '') : '·');
  const wk = r.wk || null;
  const wt = wk ? wk.tunnels || [] : [];
  const wpos = wk ? wt.map((x) => (x && x.pos ? POS_TXT[x.pos] : '·')).join('') : '--';
  const ev = [];
  if (r.rsi6 && r.rsi6.cross === 'into_ob') ev.push('新进超买');
  if (r.rsi6 && r.rsi6.cross === 'into_os') ev.push('新进超卖');
  if (r.rsi6 && r.rsi6.cross === 'out_ob') ev.push('超买回落');
  if (r.rsi6 && r.rsi6.cross === 'out_os') ev.push('超卖回升');
  for (const x of t) if (x.event && x.event.startsWith('break')) ev.push((x.event === 'break_up' ? '上穿' : '下穿') + x.key);
  if (wk && wk.rsi6) {
    if (wk.rsi6.cross === 'into_ob') ev.push('周新进超买');
    if (wk.rsi6.cross === 'into_os') ev.push('周新进超卖');
    if (wk.rsi6.cross === 'out_ob') ev.push('周超买回落');
    if (wk.rsi6.cross === 'out_os') ev.push('周超卖回升');
  }
  if (wk) for (const x of wt) if (x.event && x.event.startsWith('break')) ev.push((x.event === 'break_up' ? '周上穿' : '周下穿') + x.key);
  const idx = r.rank == null ? [[r.sp500, '标普'], [r.ndx, '纳指']].filter((x) => x[0]).map((x) => x[1]).join('+') || '--' : (r.ndx ? '标普+纳指' : '');
  return [
    pad(r.rank ?? '★', 4, true),
    pad(r.ticker, 7),
    pad(clip(r.name, 18), 19),
    pad(fmtNum(r.close), 9, true),
    pad(fmtPct(r.chgPct), 7, true),
    pad(r.rsi6 ? fmtNum(r.rsi6.value, 1) : '--', 6, true),
    pad(r.rsi6 ? RSI_TXT[r.rsi6.state] : '--', 4),
    pad(r.rsi14 ? fmtNum(r.rsi14.value, 1) : '--', 6, true),
    pad(tun(0), 3, true), pad(tun(1), 3, true), pad(tun(2), 3, true),
    pad(wk && wk.rsi6 ? fmtNum(wk.rsi6.value, 1) : '--', 6, true),
    pad(wk && wk.rsi6 ? wpos : '--', 7),
    pad(idx, 9),
    pad(r.spmoPct !== null && r.spmoPct !== undefined ? fmtNum(r.spmoPct, 1) + '%' : '', 6, true),
    pad((r.adj === 'raw' ? '[不复权] ' : '') + ev.join(','), 26),
  ].join(' ');
}

const HEAD = ['排名', '代码', '名称', '收盘', '涨跌', 'RSI6', '状态', 'RSI14', '短', '中', '长', '周RSI', '周通道', '成分', 'SPMO%', '事件'];
const COLW = [4, 7, 19, 9, 7, 6, 4, 6, 3, 3, 3, 6, 7, 9, 6, 26];

/* ---------- 控制台 ---------- */
export function consoleReport(data) {
  const L = [];
  const { meta, spmo, rows, summary } = data;
  L.push('═'.repeat(96));
  L.push(`Meridian · ${meta.marketDate} 收盘${meta.liveCount ? `（盘中另见 live 参考，共 ${meta.liveCount} 只含未收盘 bar）` : ''} · 生成于 ${meta.generatedAtLocal}`);
  L.push(`池子：SP500 实时市值前 ${meta.topN}${meta.extraNote || ' + SPMO'} · 候选池快照 ${meta.candidatesAsOf} · ${meta.universeNote || ''}`);
  L.push(`数据：东财后复权 ${meta.srcEast} 只 · Yahoo 复权 ${meta.srcYahoo} 只 · 腾讯不复权兜底 ${meta.srcTx} 只 · 失败 ${meta.srcFail} 只${meta.eastError ? ` · 东财: ${meta.eastError}` : ''}${meta.yahooError ? ` · Yahoo: ${meta.yahooError}` : ''}`);
  L.push('═'.repeat(96));

  if (spmo) {
    L.push('');
    L.push('◆ 核心标的 SPMO（标普500动量ETF）');
    L.push('  ' + rowLine(spmo));
    for (const n of spmo.notes || []) L.push(`    · [${n.tag}] ${n.text}`);
    if (spmo.live) L.push(`    · 盘中参考：现价 ${fmtNum(spmo.live.close)} · RSI6 ${fmtNum(spmo.live.rsi6, 1)}`);
  }

  const watchRows = [spmo, ...rows].filter((r) => r && r.watch);
  const watchFailed = (data.failed || []).filter((f) => f.watch);
  if (watchRows.length || watchFailed.length) {
    L.push('');
    L.push(`◆ 自选持仓（${watchRows.length}）—— config.watchlist · 池内标的在全表打标，池外标的单独取数`);
    for (const r of watchRows) {
      L.push('  ' + rowLine(r));
      if (r.note) L.push(`    · [备注] ${r.note}`);
    }
    if (watchFailed.length) L.push('  ✗ 取数失败：' + watchFailed.map((f) => f.ticker).join(' '));
  }

  const section = (title, arr, hint) => {
    if (!arr.length) return;
    L.push('');
    L.push(`◆ ${title}（${arr.length}）${hint ? '—— ' + hint : ''}`);
    for (const r of arr) L.push('  ' + rowLine(r));
  };
  section('超买 RSI6 > ' + data.cfg.rsi.overbought, summary.overbought, '策略语境：超买观察做T');
  section('超卖 RSI6 < ' + data.cfg.rsi.oversold, summary.oversold, '策略语境：超卖观察分批吸纳');
  section('超买回落 RSI6 回到正常区', summary.obReturn, '前一根超买 → 本根收盘回落（做T回补观察）');
  section('超卖回升 RSI6 回到正常区', summary.osReturn, '前一根超卖 → 本根收盘回升（吸纳确认观察）');
  section('通道事件', summary.events, 'Vegas 通道上下穿/回入');

  // 周线榜单：与日线同一套逻辑（RSI6/三通道/回归），序列是周线
  const allW = [spmo, ...rows].filter((r) => r && r.wk && r.wk.rsi6);
  const wOk = allW.filter((r) => r.wk.rsi6.state === 'overbought').sort((a, b) => b.wk.rsi6.value - a.wk.rsi6.value);
  const wOs = allW.filter((r) => r.wk.rsi6.state === 'oversold').sort((a, b) => a.wk.rsi6.value - b.wk.rsi6.value);
  const wRet = allW.filter((r) => r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os');
  section('周线超买 周RSI6 > ' + data.cfg.rsi.overbought, wOk, '周线口径，同日线逻辑：波段高位观察');
  section('周线超卖 周RSI6 < ' + data.cfg.rsi.oversold, wOs, '周线口径：波段低位观察分批吸纳');
  section('周线回归 周RSI6 回到正常区', wRet, '前一周超买/超卖 → 本周回到正常区');

  L.push('');
  L.push('◆ 全表（按市值排名）');
  L.push('  ' + COLW.map((n, i) => pad(HEAD[i], n)).join(' ').trimEnd());
  for (const r of rows) L.push('  ' + rowLine(r));

  const fails = data.failed || [];
  if (fails.length) {
    L.push('');
    L.push(`◆ 取数失败（${fails.length}）：` + fails.map((f) => f.ticker).join(' '));
  }
  L.push('');
  L.push('输出：' + data.outputs.join(' · '));
  L.push('口径：RSI6=Wilder 平滑（同通达信/TradingView RMA）；EMA 种子=前 n 项 SMA；三通道=' + data.cfg.tunnels.map((t) => t.key + '=EMA' + t.n.join('/')).join(' · ') + '；周线=日线按周重采样（周五标签）后同参重算。');
  L.push('声明：指标只描述事实与常用读法，不构成投资建议。');
  return L.join('\n');
}

/* ---------- CSV（UTF-8 BOM，Excel 直开） ---------- */
export function csvPayload(data) {
  const cell = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['排名', '代码', '名称', '市值亿USD', '收盘', '涨跌%', 'RSI6', 'RSI前值', 'RSI状态', 'RSI穿越', 'RSI14', 'RSI14状态', 'RSI14穿越', '短通道', '中通道', '长通道', '周RSI6', '周RSI状态', '周RSI穿越', '周RSI14', '周RSI14状态', '周通道', '成分', '通道事件', 'SPMO持仓%', '自选备注', '超买天数', '通道上方天数', '距上轨%', '量比', '数据源', '复权', '截至'];
  const pos = (t) => (t && t.pos ? { above: '上', inside: '内', below: '下' }[t.pos] : '');
  const ev = (r) => {
    const a = [];
    if (r.rsi6?.cross === 'into_ob') a.push('新进超买');
    if (r.rsi6?.cross === 'into_os') a.push('新进超卖');
    if (r.rsi6?.cross === 'out_ob') a.push('超买回落');
    if (r.rsi6?.cross === 'out_os') a.push('超卖回升');
    for (const t of r.tunnels || []) if (t.event) a.push(t.key + ':' + t.event);
    if (r.wk && r.wk.rsi6) {
      if (r.wk.rsi6.cross === 'into_ob') a.push('周新进超买');
      if (r.wk.rsi6.cross === 'into_os') a.push('周新进超卖');
      if (r.wk.rsi6.cross === 'out_ob') a.push('周超买回落');
      if (r.wk.rsi6.cross === 'out_os') a.push('周超卖回升');
    }
    for (const t of (r.wk && r.wk.tunnels) || []) if (t.event) a.push('周' + t.key + ':' + t.event);
    return a.join('|');
  };
  const idx = (r) => {
    const a = [];
    if (r.sp500) a.push('SP500');
    if (r.ndx) a.push('纳指100');
    return a.join('+') || (r.rank == null ? '池外' : '');
  };
  const line = (r) => [r.rank ?? 'SPMO', r.ticker, r.name, r.mcapUsd ? (r.mcapUsd / 1e8).toFixed(0) : '', r.close, r.chgPct?.toFixed(2) ?? '', r.rsi6?.value?.toFixed(2) ?? '', r.rsi6?.prev?.toFixed(2) ?? '', RSI_TXT[r.rsi6?.state] ?? '', r.rsi6?.cross ?? '', r.rsi14?.value?.toFixed(2) ?? '', RSI_TXT[r.rsi14?.state] ?? '', r.rsi14?.cross ?? '', pos(r.tunnels?.[0]), pos(r.tunnels?.[1]), pos(r.tunnels?.[2]), r.wk?.rsi6?.value?.toFixed(2) ?? '', RSI_TXT[r.wk?.rsi6?.state] ?? '', r.wk?.rsi6?.cross ?? '', r.wk?.rsi14?.value?.toFixed(2) ?? '', RSI_TXT[r.wk?.rsi14?.state] ?? '', (r.wk?.tunnels || []).map(pos).join(''), idx(r), ev(r), r.spmoPct ?? '', r.watch ? (r.note || '自选') : '', r.obDays || '', r.aboveDays || '', r.extPct ?? '', r.volRatio ?? '', r.source, r.adj, r.asOf].map(cell).join(',');
  return '\uFEFF' + [head.join(','), ...[data.spmo, ...data.rows].filter(Boolean).map(line)].join('\r\n') + '\r\n';
}

/* ---------- 写文件 ---------- */
/* 原子写出：全部内容先在内存生成（生成期抛错不会碰旧文件），
 * 落盘走 同目录 *.tmp + rename（同目录 rename 原子）——半途失败绝不留下半份产物。 */
function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/* 产物写出：
 *   <outDir>/us-signals.json       —— 协议化 JSON（写前先过 Schema 校验，违约拒发）
 *   <outDir>/us-signals-latest.csv —— 固定覆盖名（UTF-8 BOM）
 * opts.csv=false 可只出 JSON。空报告守卫：rows 与 spmo 均空时抛错，绝不覆盖旧产物。 */
export function writeOutputs(data, outDir, opts = {}) {
  if (!data || (!data.spmo && !(data.rows && data.rows.length))) {
    throw new Error('writeOutputs 拒绝写出：rows 与 spmo 均为空（全部取数失败？）');
  }
  const json = buildUsSignals(data);
  const v = validateUsSignals(json);
  if (!v.ok) throw new Error('us-signals.json Schema 校验失败，拒绝写出：' + v.errors.slice(0, 5).join('；'));
  mkdirSync(outDir, { recursive: true });
  const outputs = [];
  const jsonPath = path.join(outDir, 'us-signals.json');
  writeAtomic(jsonPath, JSON.stringify(json, null, 1));
  outputs.push(jsonPath);
  if (opts.csv !== false) {
    const csvPath = path.join(outDir, 'us-signals-latest.csv');
    writeAtomic(csvPath, csvPayload(data));
    outputs.push(csvPath);
  }
  return outputs;
}
