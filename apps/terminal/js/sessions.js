/* sessions.js —— 市场开闭市状态（纯前端时段计算，零请求、零依赖）
   方法论来源：开源交易终端（Neuberg / ProfitMaker 等）的 session clock 徽章——
   行情"看起来不刷新"最常见的解释就是该市场已收盘，徽章直接消除这个困惑。

   ⚠ 时段为常规交易时段，不含节假日休市（免费日历源不稳，宁缺毋滥）：
   A股 09:30-11:30 / 13:00-15:00（Asia/Shanghai）
   港股 09:30-12:00 / 13:00-16:00（Asia/Hong_Kong）
   美股 09:30-16:00（America/New_York，夏令时由 Intl 时区自动处理）
   加密 7×24 */

const Sessions = (() => {
  const MARKETS = {
    cn: { tz: 'Asia/Shanghai', name: 'A股', sessions: [[570, 690], [780, 900]] },   // 09:30-11:30, 13:00-15:00（分钟数）
    hk: { tz: 'Asia/Hong_Kong', name: '港股', sessions: [[570, 720], [780, 960]] }, // 09:30-12:00, 13:00-16:00
    us: { tz: 'America/New_York', name: '美股', sessions: [[570, 960]] },           // 09:30-16:00（含午间）
    crypto: { tz: 'UTC', name: '加密', sessions: [[0, 1440]] },                     // 全天
  };

  // 用 Intl 取某时区的"当前时刻部件"（星期/时/分），DST 自动正确
  function partsIn(tz, date) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const map = {};
      fmt.formatToParts(date || new Date()).forEach(p => { map[p.type] = p.value; });
      const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      let h = parseInt(map.hour, 10);
      if (h === 24) h = 0;   // 部分环境 midnight 显示 24
      return { wd: wdMap[map.weekday], m: h * 60 + parseInt(map.minute, 10) };
    } catch {
      return null;   // 时区数据缺失的极端环境：调用方按"未知"处理
    }
  }

  // 纯函数：给定时区部件 → 状态。便于单测（不必伪造系统时钟）。
  // 返回 { code, label }；code: open | lunch | closed | weekend | unknown
  function statusOf(market, parts) {
    const m = MARKETS[market];
    if (!m) return { code: 'unknown', label: '--' };
    if (!parts) return { code: 'unknown', label: '--' };
    if (m.sessions.length === 1 && m.sessions[0][0] === 0 && m.sessions[0][1] === 1440) {
      return { code: 'open', label: '24小时' };
    }
    if (parts.wd === 0 || parts.wd === 6) return { code: 'weekend', label: '周末休市' };
    const inSes = (s) => parts.m >= s[0] && parts.m < s[1];
    if (m.sessions.some(inSes)) return { code: 'open', label: '交易中' };
    // 午间休市：在两段之间且当天
    if (m.sessions.length > 1 && parts.m >= m.sessions[0][1] && parts.m < m.sessions[1][0]) {
      return { code: 'lunch', label: '午间休市' };
    }
    return { code: 'closed', label: '已收盘' };
  }

  function now(market) {
    return statusOf(market, partsIn(MARKETS[market] ? MARKETS[market].tz : 'UTC'));
  }

  // 状态 → 着色（跟随红涨绿跌语义：交易中=涨色点，休市=灰）
  const codeClass = (code) => ({
    open: 'ses-open', lunch: 'ses-lunch', closed: 'ses-closed',
    weekend: 'ses-closed', unknown: 'ses-unknown',
  }[code] || 'ses-unknown');

  return { MARKETS, partsIn, statusOf, now, codeClass };
})();

window.Sessions = Sessions;
