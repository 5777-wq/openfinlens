/* market-time.mjs —— 美股交易日时钟（ET）（core/engine 唯一真源，移植自 Meridian lib/market.mjs）
 * 用途：判定"最后一个已收盘的交易日"。盘中运行时，源数据最后一根是未收盘的
 * live bar，必须剔除后再算信号（RSI6/EMA 都只认收盘价）。
 * 只做星期与时刻的墙钟推断，不处理节假日：节假日由数据侧兜底
 * （源里最后那根就是真实最后收盘，日期 ≤ 预期日即视为已收盘）。 */

const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
  weekday: 'short',
});

export function etNow(now = new Date()) {
  const parts = {};
  for (const p of ET_FMT.formatToParts(now)) parts[p.type] = p.value;
  // en-CA 的 24 点会显示成 "24"（Intl 已知怪癖）→ 归零到当天 00:00 语义
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hhmm: `${hh}:${parts.minute}` };
}

const MS_DAY = 86400000;
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (ms) => { const w = new Date(ms).getUTCDay(); return w === 0 || w === 6; };
function prevWeekday(ms) { let t = ms - MS_DAY; while (isWeekend(t)) t -= MS_DAY; return t; }

/* 最后一个已收盘交易日（ET 墙钟）：
 * - 周末 → 上个周五（再往前跳过周末）；
 * - 工作日 09:30 前 → 前一个工作日（当日未开盘，昨晚那根已是最后收盘）；
 * - 09:30–16:00（盘中）→ 前一个工作日（今日那根未收盘）；
 * - 16:00 后 → 当日。 */
export function lastClosedDate(now = new Date()) {
  const { date, weekday, hhmm } = etNow(now);
  const t = toDate(date);
  const mins = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  if (weekday === 'Sat' || weekday === 'Sun') return fromUTC(prevWeekday(t));
  if (mins < 9 * 60 + 30) return fromUTC(prevWeekday(t));
  if (mins < 16 * 60) return fromUTC(prevWeekday(t));
  return date;
}

/* 按 marketDate 切分 bars（[date,...] 升序）：closed 用于信号，live 仅作盘中参考 */
export function splitClosed(bars, marketDate) {
  const closed = bars.filter((b) => b[0] <= marketDate);
  return { closed, liveCount: bars.length - closed.length };
}

/* d2 比 d1 晚几个交易日（d2 >= d1，工作日近似；任一日期非法或倒挂返回 0）。
 * 用于陈旧判定：数据商延迟/停更的标的，最后一根 bar 会落后报告日多个交易日。 */
export function tradingDaysBetween(d1, d2) {
  const a = Date.parse(d1 + 'T00:00:00Z'), b = Date.parse(d2 + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  let n = 0;
  for (let t = a + 86400000; t <= b; t += 86400000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}
