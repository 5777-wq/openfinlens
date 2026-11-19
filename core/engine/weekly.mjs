/* weekly.mjs —— 日线 → 周线重采样（纯函数，core/engine 唯一真源，移植自 Meridian lib/weekly.mjs）
 * 周线口径：周标签 = 该日历周的周五（节假日闭市时仍用周五日历日做标签，
 * 不影响指标——RSI/EMA 只看相邻周序）。开=周首日开，收=周末日收，
 * 高=周内最高，低=周内最低，量=周内求和。监控逻辑与日线完全同参
 * （RSI6 Wilder + Vegas 三通道），只是喂的是周线序列。 */

/* 'YYYY-MM-DD' → 该日历周周五 'YYYY-MM-DD'（ET 日历日，无时区换算） */
export function weekEndOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const dow = new Date(t).getUTCDay();              // 0 周日 … 6 周六
  const toFri = (5 - dow + 7) % 7;                  // 距本周周五的天数
  const d = new Date(t + toFri * 86400000);
  return d.toISOString().slice(0, 10);
}

/* bars: [date,o,c,h,l,v] 升序 → 周线 bars（同元组结构） */
export function resampleWeekly(bars) {
  const out = [];
  let cur = null;
  for (const b of bars || []) {
    if (!b || !b[0] || !Number.isFinite(b[2])) continue;
    const wk = weekEndOf(b[0]);
    if (!wk) continue;
    if (!cur || cur[0] !== wk) {
      if (cur) out.push(cur);
      cur = [wk, b[1], b[2], b[3], b[4], b[5] || 0];
    } else {
      cur[2] = b[2];                                // 收盘 = 周内最后一根
      if (Number.isFinite(b[3])) cur[3] = Math.max(cur[3], b[3]);
      if (Number.isFinite(b[4])) cur[4] = Math.min(cur[4], b[4]);
      cur[5] += b[5] || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}
