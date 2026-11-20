/* signals.mjs —— 单标的信号评估（纯函数，core/engine 唯一真源，移植自 Meridian lib/signals.mjs）
 * 输入：一个标的的 closed bars（已剔除未收盘的 live bar）+ 可选 live bar。
 * 输出：事实层（收盘/涨跌/RSI6/三通道位置）+ 描述层（超买/超卖/穿越事件标签）。
 * 铁律同上层看板：只描述事实与常用读法，绝不产出"建议买卖"；
 * 不复权数据打 raw 标记（拆股会让长通道失真，见 core/sources/history.mjs 头注）。 */

import { rsiSnap, tunnelSnap } from './indicators.mjs';
import { resampleWeekly } from './weekly.mjs';
import { tradingDaysBetween } from './market-time.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const TUNNEL_READ = {
  above: '价格在通道上方（趋势多头侧）',
  inside: '价格在通道内（观察区）',
  below: '价格在通道下方（趋势空头侧）',
};
const EVENT_READ = {
  break_up: '收盘向上突破出通道（站上上轨）',
  break_down: '收盘向下突破出通道（跌破下轨）',
  reenter_up: '收盘自下方回升进入通道内',
  reenter_down: '收盘自上方回落进入通道内',
};

/* cfg.tunnels: [{key, n:[a,b]}]，cfg.rsi: {period, period2, overbought, oversold} */
export function evaluate(meta, series, cfg, marketDate) {
  const { bars, adj, source } = series;
  if (!Array.isArray(bars) || bars.length < 30) return null;

  // bars 已按日期升序；live bar（日期晚于 marketDate）不计入信号
  const closed = marketDate ? bars.filter((b) => b[0] <= marketDate) : bars;
  const liveBars = bars.length - closed.length;
  if (closed.length < 30) return null;

  const closes = closed.map((b) => b[2]);
  const lastBar = closed[closed.length - 1];
  const prevBar = closed[closed.length - 2];
  const close = lastBar[2];
  const chgPct = prevBar && prevBar[2] ? (close / prevBar[2] - 1) * 100 : null;

  const rsiCfg = cfg.rsi;
  const r = rsiSnap(closes, rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold);
  // 第二周期 RSI（config.rsi.period2，默认 14）：同阈值同口径，供报表页切换查看；
  // 主口径（榜单/推送/notes）始终用 rsi.period。字段名固定 rsi14，.period 暴露真实周期。
  const p2 = Number(rsiCfg.period2) > 0 && Number(rsiCfg.period2) !== rsiCfg.period ? Number(rsiCfg.period2) : null;
  const r2v = p2 ? rsiSnap(closes, p2, rsiCfg.overbought, rsiCfg.oversold) : null;

  const tunnels = [];
  for (const t of cfg.tunnels) {
    const s = tunnelSnap(closes, t.n[0], t.n[1]);
    if (s) tunnels.push({ key: t.key, n: t.n, upper: Math.max(s.a, s.b), lower: Math.min(s.a, s.b), pos: s.pos, event: s.event, widthPct: s.widthPct });
    else tunnels.push({ key: t.key, n: t.n, pos: null, event: null, insufficient: true });
  }

  // live bar（盘中参考）：用含 live 的序列重算 RSI 与主通道位置，仅供盘中运行时对照
  let live = null;
  if (liveBars > 0) {
    const allCloses = bars.map((b) => b[2]);
    const lr = rsiSnap(allCloses, rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold);
    const lt = cfg.tunnels.map((t) => tunnelSnap(allCloses, t.n[0], t.n[1]));
    live = { close: bars[bars.length - 1][2], date: bars[bars.length - 1][0], rsi6: lr ? lr.value : null, mainPos: lt[1] ? lt[1].pos : null };
  }

  // 周线：与日线完全同一套监控逻辑（同参 RSI6 Wilder + Vegas 三通道），只是序列换成周线。
  // 长通道 EMA576/676 在周线上需要 ~13 年历史，多数标的如实标 insufficient，不算异常。
  // 全部日期无法归周（如离线测试的假日期）时 wk=null，各端按缺失显示。
  const wbars = resampleWeekly(closed);
  let wk = null;
  if (wbars.length) {
    const wcloses = wbars.map((b) => b[2]);
    const wr = rsiSnap(wcloses, rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold);
    const wr2 = p2 ? rsiSnap(wcloses, p2, rsiCfg.overbought, rsiCfg.oversold) : null;
    const wtunnels = cfg.tunnels.map((t) => {
      const s = tunnelSnap(wcloses, t.n[0], t.n[1]);
      if (s) return { key: t.key, n: t.n, upper: Math.max(s.a, s.b), lower: Math.min(s.a, s.b), pos: s.pos, event: s.event, widthPct: s.widthPct };
      return { key: t.key, n: t.n, pos: null, event: null, insufficient: true };
    });
    let wlive = null;
    if (liveBars > 0) {
      const allWeekly = resampleWeekly(bars);
      const lw = allWeekly.length ? rsiSnap(allWeekly.map((b) => b[2]), rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold) : null;
      wlive = { close: allWeekly[allWeekly.length - 1][2], date: allWeekly[allWeekly.length - 1][0], rsi6: lw ? lw.value : null };
    }
    wk = { asOf: wbars[wbars.length - 1][0], bars: wbars.length, rsi6: wr ? { value: wr.value, prev: wr.prev, state: wr.state, cross: wr.cross, period: rsiCfg.period } : null, rsi14: wr2 ? { value: wr2.value, prev: wr2.prev, state: wr2.state, cross: wr2.cross, period: p2 } : null, tunnels: wtunnels, live: wlive };
  }

  // 描述标签（事实 + 常用读法，非建议）
  const notes = [];
  // 数据新鲜度：最后一根收盘 bar 落后报告日 >1 个交易日 = 陈旧（数据商延迟/停更），
  // 该行所有指标都不是当期值，如实打标，绝不静默混进正常报告
  let stale = false, staleDays = 0;
  if (marketDate) {
    staleDays = tradingDaysBetween(lastBar[0], marketDate);
    if (staleDays > 1) {
      stale = true;
      notes.push({ tag: '数据', level: 'warn', text: `数据陈旧：最后一根收盘 bar 为 ${lastBar[0]}，落后报告日 ${staleDays} 个交易日，请勿按当期信号使用。` });
    }
  }
  // 次新标的（上市/分拆晚于长窗口 EMA 所需根数）：长通道暂不可算，如实标注，不算异常
  const missingT = tunnels.filter((t) => t.insufficient);
  if (missingT.length) {
    notes.push({ tag: '通道', level: 'info', text: `${missingT.map((t) => t.key + '（EMA' + t.n.join('/') + '）').join('、')}数据不足暂未计算：该标的上市/分拆时间短于窗口所需 ${Math.max(...missingT.map((t) => Math.max(...t.n)))} 根日线，随数据积累自动出现。` });
  }
  if (r) {
    if (r.state === 'overbought') {
      notes.push({ tag: 'RSI6', level: r.cross === 'into_ob' ? 'hot' : 'warn', text: `RSI6=${r.value.toFixed(1)} 超买（>${rsiCfg.overbought}）${r.cross === 'into_ob' ? '，今日新进超买区' : ''}。策略语境：超买常是做T减仓的观察信号，强趋势里会持续钝化。` });
    } else if (r.state === 'oversold') {
      notes.push({ tag: 'RSI6', level: 'cold', text: `RSI6=${r.value.toFixed(1)} 超卖（<${rsiCfg.oversold}）${r.cross === 'into_os' ? '，今日新进超卖区' : ''}。策略语境：超卖常是分批吸纳的观察信号，弱势里同样会钝化。` });
    }
    if (r.cross === 'out_ob') notes.push({ tag: 'RSI6', level: 'info', text: `RSI6 自超买回落（前值 ${r.prev.toFixed(1)} → ${r.value.toFixed(1)}）。做T语境下常见做法是观察回补时机，此处只记录事件。` });
    if (r.cross === 'out_os') notes.push({ tag: 'RSI6', level: 'info', text: `RSI6 自超卖回升（前值 ${r.prev.toFixed(1)} → ${r.value.toFixed(1)}）。只记录事件。` });
  }
  for (const t of tunnels) {
    if (t.event === 'break_up') notes.push({ tag: t.key, level: 'info', text: `${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_up}。` });
    if (t.event === 'break_down') notes.push({ tag: t.key, level: 'info', text: `${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_down}。` });
    if (t.event === 'reenter_up' || t.event === 'reenter_down') notes.push({ tag: t.key, level: 'info', text: `${t.key}：${EVENT_READ[t.event]}。` });
  }
  // 周线事件（只记超买超卖状态与穿越，回入不记——周线颗粒粗，事件少而重）
  if (wk) {
    const wr = wk.rsi6;
    if (wr) {
      if (wr.state === 'overbought') notes.push({ tag: '周RSI6', level: wr.cross === 'into_ob' ? 'hot' : 'warn', text: `周线RSI6=${wr.value.toFixed(1)} 超买（>${rsiCfg.overbought}）${wr.cross === 'into_ob' ? '，本周新进超买区' : ''}。周线口径的超买常对应波段高位，强趋势里同样会钝化。` });
      else if (wr.state === 'oversold') notes.push({ tag: '周RSI6', level: 'cold', text: `周线RSI6=${wr.value.toFixed(1)} 超卖（<${rsiCfg.oversold}）${wr.cross === 'into_os' ? '，本周新进超卖区' : ''}。周线超卖常对应波段低位，弱势里同样会钝化。` });
      if (wr.cross === 'out_ob') notes.push({ tag: '周RSI6', level: 'info', text: `周线RSI6 自超买回落（前值 ${wr.prev.toFixed(1)} → ${wr.value.toFixed(1)}）。周线级别的回归信号，做T回补观察，只记录。` });
      if (wr.cross === 'out_os') notes.push({ tag: '周RSI6', level: 'info', text: `周线RSI6 自超卖回升（前值 ${wr.prev.toFixed(1)} → ${wr.value.toFixed(1)}）。周线级别的回归信号，吸纳确认观察，只记录。` });
    }
    for (const t of wk.tunnels) {
      if (t.event === 'break_up') notes.push({ tag: '周' + t.key, level: 'info', text: `周线${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_up}。` });
      if (t.event === 'break_down') notes.push({ tag: '周' + t.key, level: 'info', text: `周线${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_down}。` });
      if (t.event === 'reenter_up') notes.push({ tag: '周' + t.key, level: 'info', text: `周线${t.key}：${EVENT_READ.reenter_up}。` });
      if (t.event === 'reenter_down') notes.push({ tag: '周' + t.key, level: 'info', text: `周线${t.key}：${EVENT_READ.reenter_down}。` });
    }
  }
  if (adj === 'raw') notes.push({ tag: '口径', level: 'warn', text: '本行数据为不复权价（东财主源不可用，腾讯兜底）。近一年内有拆股的标的，长通道（EMA576/676）会明显失真，RSI6/主通道参考价值有限。' });

  return {
    ticker: meta.ticker,
    name: meta.name || series.name || meta.ticker,
    rank: meta.rank ?? null,
    mcapUsd: meta.mcapUsd ?? null,
    spmoPct: meta.spmoPct ?? null,
    sp500: meta.sp500 ?? null,
    ndx: meta.ndx ?? null,
    asOf: lastBar[0],
    close,
    chgPct,
    rsi6: r ? { value: r.value, prev: r.prev, state: r.state, cross: r.cross, period: rsiCfg.period } : null,
    rsi14: r2v ? { value: r2v.value, prev: r2v.prev, state: r2v.state, cross: r2v.cross, period: p2 } : null,
    tunnels,
    wk,
    live,
    adj,
    source,
    bars: closed.length,
    stale: stale || undefined,
    staleDays: stale ? staleDays : undefined,
    notes,
  };
}

/* 新鲜度汇总与发布闸门（纯函数）：dataDate 取行内最大 asOf；
 * stale 占比超阈值（默认 5%）→ blocked=true，调用方应写 preview 而非正式产物。 */
export function stalenessGate(rows, { maxRatio = 0.05 } = {}) {
  const ok = rows.filter(Boolean);
  const staleRows = ok.filter((r) => r.stale);
  const dataDate = ok.length ? ok.reduce((m, r) => (r.asOf > (m || '') ? r.asOf : m), '') : null;
  const staleRatio = ok.length ? staleRows.length / ok.length : 0;
  return {
    dataDate,
    staleCount: staleRows.length,
    staleTickers: staleRows.map((r) => r.ticker),
    staleRatio,
    blocked: ok.length > 0 && staleRatio > maxRatio,
  };
}

/* 汇总：分组输出。核心是"回归信号"——前一根收盘在超买/超卖区、本根收盘回到
 * 正常区（30~70）：超买回落=做T回补观察，超卖回升=吸纳确认观察。
 * overbought/oversold 仍单列（当前停在区内的），events 只留通道穿越。 */
export function summarize(rows) {
  const ok = rows.filter(Boolean);
  const ob = ok.filter((r) => r.rsi6 && r.rsi6.state === 'overbought').sort((a, b) => b.rsi6.value - a.rsi6.value);
  const os = ok.filter((r) => r.rsi6 && r.rsi6.state === 'oversold').sort((a, b) => a.rsi6.value - b.rsi6.value);
  const obReturn = ok.filter((r) => r.rsi6 && r.rsi6.cross === 'out_ob');
  const osReturn = ok.filter((r) => r.rsi6 && r.rsi6.cross === 'out_os');
  const events = ok.filter((r) => r.tunnels.some((t) => t.event));
  const newInto = ok.filter((r) => r.rsi6 && (r.rsi6.cross === 'into_ob' || r.rsi6.cross === 'into_os'));
  return { all: ok, overbought: ob, oversold: os, obReturn, osReturn, events, newInto };
}
