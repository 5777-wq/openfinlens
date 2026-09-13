/* tencent.js —— A股 / 港股 / 美股 / 全球指数 主源（qt.gtimg.cn，GBK）
   实测字段（2026-08 验证）：
   [1]名称 [2]代码 [3]现价 [4]昨收 [5]今开 [6]成交量(手) [31]涨跌额 [32]涨跌幅%
   [33]最高 [34]最低 [36]成交量(手) [37]成交额(万) [38]换手率 [44]流通市值(亿) [45]总市值(亿)
   港股/美股用同一格式，涨跌额/幅同样在 [31][32]。
   ⚠ [37] 的单位按市场分流（见 amountScale）：统一 ×1e4 曾把港美成交额放大一万倍。 */

const TencentSource = (() => {
  const BASE = 'https://qt.gtimg.cn/q=';
  const { num, request } = window.U;

  function marketOf(code) {
    if (/^(sh|sz|bj)/.test(code)) return /^(sh000|sz399|sh950|bj899)/.test(code) ? 'index' : 'cn';
    if (/^hk/.test(code)) return /^hk(HSI|HSTECH|HSCEI|N225|KS11|STI|TWII)$/i.test(code) ? 'index' : 'hk';
    if (/^us/.test(code)) return /^us(DJI|IXIC|INX|VIX)$/i.test(code) ? 'index' : 'us';
    return 'other';
  }

  /* [37] 成交额的单位按市场分流：A股与 A 股指数是"万"（×1e4），港股/美股及其
     指数接口返回的已经是"元"（×1）。统一 ×1e4 曾把港美成交额放大一万倍
     （腾讯控股显示 66.7 万亿港元、道琼斯显示 18.6 亿亿元）。 */
  function amountScale(symbol) {
    return /^(sh|sz|bj)/.test(symbol) ? 1e4 : 1;
  }

  /* [30] 行情时间（如 20260913150001 或 "20260913 15:00:01"）：源返回的真正行情
     时刻，与"抓取时间"分开标注。美股字段是美东时间，固定 +8 折算会错时区，
     只对沪深/港股（与北京时间同域）启用，美股显式 null（宁缺毋假）。 */
  function quoteTimeOf(s) {
    const m = /^(\d{4})(\d{2})(\d{2})[T ]?(\d{2}):?(\d{2}):?(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600000;
  }

  function parse(text) {
    const out = [];
    text.split(';').forEach(line => {
      const m = line.match(/v_([A-Za-z0-9._]+)="(.*)"/);
      if (!m) return;
      const symbol = m[1];
      const f = m[2].split('~');
      if (f.length < 33 || !f[3]) return;
      const price = num(f[3]);
      if (price === null) return;
      const prevClose = num(f[4]);
      let changePct = num(f[32]);
      let change = num(f[31]);
      if (changePct === null && prevClose) changePct = (price - prevClose) / prevClose * 100;
      if (change === null && prevClose !== null) change = price - prevClose;
      out.push({
        symbol,
        name: (f[1] || symbol).trim(),
        code: (f[2] || '').trim(),
        market: marketOf(symbol),
        price, prevClose,
        open: num(f[5]),
        high: num(f[33]),
        low: num(f[34]),
        change, changePct,
        volume: num(f[36]) !== null ? num(f[36]) : num(f[6]),
        amount: num(f[37]) !== null ? num(f[37]) * amountScale(symbol) : null,
        marketCap: num(f[45]) !== null ? num(f[45]) * 1e8 : null,
        quoteAt: /^(sh|sz|bj|hk)/.test(symbol) ? quoteTimeOf(f[30]) : null,
        updatedAt: Date.now(),
        source: 'tencent',
      });
    });
    return out;
  }

  // symbols: ['sh000001','hk00700','usAAPL', ...]
  async function getQuotes(symbols) {
    if (!symbols || !symbols.length) return [];
    try {
      const chunks = [];
      for (let i = 0; i < symbols.length; i += 60) chunks.push(symbols.slice(i, i + 60));
      const parts = await Promise.all(chunks.map(c =>
        request(BASE + c.join(','), { gbk: true }).catch(() => '')
      ));
      const list = parse(parts.join(';'));
      if (list.length) window.SourceState.ok('tencent');
      else window.SourceState.fail('tencent', 'empty');
      return list;
    } catch (e) {
      window.SourceState.fail('tencent', e.message);
      return [];
    }
  }

  // 分时（A股/港股/美股均可）：web.ifzq.gtimg.cn minute/query
  async function getMinute(symbol) {
    // 符号白名单：仅放行交易所标准格式（sh600000 / hk00700 / usAAPL 等），
    // 拼接 URL 前收敛注入面（扫描器标记的 SSRF 入口在此闭合）
    if (!/^[a-z]{2}[0-9a-z.]{1,12}$/i.test(String(symbol))) return [];
    try {
      const u = new URL('https://web.ifzq.gtimg.cn/appstock/app/minute/query');
      u.searchParams.set('code', String(symbol));   // URL 对象组装：参数值不再进入地址字符串拼接
      const j = await request(u.href);
      const node = j && j.data && j.data[symbol];
      const rows = node && node.data && node.data.data;
      if (!rows || !rows.length) return [];
      // 实测 date 字段是 8 位（如 "20260825"）；旧的 6 位正则会解析出 NaN 时间戳
      const raw = String(node.data.date || '');
      const dateStr = /^\d{8}$/.test(raw)
        ? raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8)
        : /^\d{6}$/.test(raw)
          ? '20' + raw.slice(0, 2) + '-' + raw.slice(2, 4) + '-' + raw.slice(4, 6)
          : '';
      // 基准日按"墙钟"构造伪 UTC（不经 new Date 本地化，避免图表时区平移）：
      // dateStr 是交易所日期，直接取年月日数字用 Date.UTC 编码
      let base = Date.now() - (Date.now() % 86400000);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        base = Date.UTC(y, m - 1, d);
      }
      let prevVol = 0;
      const out = [];
      rows.forEach((r, ri) => {
        const p = r.split(/\s+/);
        if (p.length < 3) return;
        const hh = +p[0].slice(0, 2), mm = +p[0].slice(2, 4);
        const price = num(p[1]);
        const cumVol = num(p[2]) || 0;
        if (price === null) return;
        const vol = ri === 0 ? 0 : Math.max(0, cumVol - prevVol);   // 首点差分无意义（美股盘后单点会渲染成全日巨量柱）
        prevVol = cumVol;
        out.push({ time: Math.floor((base + (hh * 60 + mm) * 60000) / 1000), value: price, volume: vol });
      });
      // date 为空（实测：美股盘后）时 base 退化为"今天"，唯一数据点会被错标成今天的时刻 → 视同无分时，交给日K兜底
      if (!raw) return [];
      return out;
    } catch { return []; }
  }

  // 日K / 周K：web.ifzq.gtimg.cn fqkline（qfq 前复权）
  // ⚠️ 美股实测：param 用 usAAPL 只回 2 根脏数据，必须用带交易所后缀的完整代码（usAAPL.OQ）
  async function getKline(symbol, period = 'day', limit = 320) {
    const tryOnce = async (code) => {
      const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='
        + encodeURIComponent([code, period, '', '', limit, 'qfq'].join(','));
      const j = await request(url);
      const node = j && j.data && (j.data[code] || j.data[symbol]);
      if (!node) return [];
      const rows = node['qfq' + period] || node[period] || [];
      return rows.map(r => ({
        time: r[0],
        open: num(r[1]), close: num(r[2]), high: num(r[3]), low: num(r[4]),
        volume: num(r[5]) || 0,
      })).filter(k => k.open !== null && k.close !== null);
    };
    try {
      const rows = await tryOnce(symbol);
      if (rows.length >= 5 || !/^us/i.test(symbol)) return rows;
      const full = await usFullCode(symbol);      // 美股补后缀重试
      if (!full) return rows;
      const retry = await tryOnce('us' + full);
      return retry.length > rows.length ? retry : rows;
    } catch { return []; }
  }

  // 美股完整代码缓存（usAAPL → AAPL.OQ，取实时行情的 [2] 字段）
  const usCodeCache = new Map();
  async function usFullCode(symbol) {
    if (usCodeCache.has(symbol)) return usCodeCache.get(symbol);
    try {
      const text = await request(BASE + symbol, { gbk: true });
      const m = text.match(/v_[A-Za-z0-9._]+="([^"]*)"/);
      const code = m ? (m[1].split('~')[2] || '').trim() : '';
      const full = /\./.test(code) ? code : null;
      usCodeCache.set(symbol, full);
      return full;
    } catch { return null; }
  }

  return { getQuotes, getKline, getMinute, parse, amountScale, quoteTimeOf };
})();

window.TencentSource = TencentSource;
