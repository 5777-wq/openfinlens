/* binance.js —— 加密主源
   实测（2026-08）：api.binance.com 超时不可达；data-api.binance.vision 可用且 CORS: *
   → HOSTS 依次尝试，任一成功即用。
   接口：GET /api/v3/ticker/24hr?symbols=["BTCUSDT",...]（全量 1.9MB 易被网络截断 → 一律显式传 symbols）
        GET /api/v3/klines?symbol=BTCUSDT&interval=1d|1w|5m&limit=n */

const BinanceSource = (() => {
  const { num, request } = window.U;
  const HOSTS = [
    'https://data-api.binance.vision',
    'https://api.binance.com',
    'https://api1.binance.com',
  ];
  let goodHost = null;

  async function hostGet(path) {
    const order = goodHost ? [goodHost, ...HOSTS.filter(h => h !== goodHost)] : HOSTS;
    let lastErr;
    for (const h of order) {
      try {
        const j = await request(h + path, { timeout: 9000 });
        goodHost = h;
        return j;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all hosts failed');
  }

  // 市值权重代理：用 24h 成交额（quoteVolume）代替真实市值（免费源拿不到流通量）
  function toQuote(t) {
    const price = num(t.lastPrice);
    if (price === null) return null;
    const open = num(t.openPrice);
    return {
      symbol: t.symbol,
      instId: t.symbol.replace(/USDT$/, '-USDT'),
      name: t.symbol.replace(/USDT$/, ''),
      code: t.symbol,
      market: 'crypto',
      price,
      prevClose: num(t.prevClosePrice) !== null ? num(t.prevClosePrice) : open,
      open,
      high: num(t.highPrice), low: num(t.lowPrice),
      change: num(t.priceChange),
      changePct: num(t.priceChangePercent),
      volume: num(t.volume),
      amount: num(t.quoteVolume),
      marketCap: null,
      updatedAt: Date.now(),
      source: 'binance',
    };
  }

  async function getQuotes(symbols) {
    const list = (symbols && symbols.length) ? symbols : window.CRYPTO_UNIVERSE || [];
    if (!list.length) return [];
    const syms = list.map(s => s.toUpperCase().replace('-', ''));
    try {
      const out = [];
      // 分批，单批 <= 60，避免 URL 过长与大响应被截断
      for (let i = 0; i < syms.length; i += 60) {
        const part = syms.slice(i, i + 60);
        const q = encodeURIComponent(JSON.stringify(part));
        let j;
        try {
          j = await hostGet('/api/v3/ticker/24hr?symbols=' + q);
        } catch (e) {
          // symbols 里混进一个失效/退市代码，币安对整批回 400(-1121 Invalid symbol)。
          // 仅 HTTP 4xx 时拆成单只请求，只丢坏的那只——别让整批报价陪葬、每个周期
          // 都被打去 OKX 备源；网络级故障不拆单，原样上抛走降级。
          if (!/HTTP 4/.test(String((e && e.message) || ''))) throw e;
          const parts = await Promise.all(part.map(s =>
            hostGet('/api/v3/ticker/24hr?symbol=' + s).catch(() => null)
          ));
          j = parts.filter(Boolean);
        }
        if (Array.isArray(j)) out.push(...j.map(toQuote).filter(Boolean));
      }
      if (out.length) window.SourceState.ok('binance');
      else window.SourceState.fail('binance', 'empty');
      return out;
    } catch (e) {
      window.SourceState.fail('binance', e.message);
      return [];
    }
  }

  async function getTop(n = 80) {
    const all = await getQuotes(window.CRYPTO_UNIVERSE || []);
    return all.sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, n);
  }

  // K线：interval 5m / 1d / 1w
  // 时间轴口径与腾讯源统一：分钟线转"本地墙钟伪 UTC"（否则图表按 UTC 渲染会平移一个时区）；
  // 日/周线直接用开盘时间的 UTC 日期字符串（与币安切K口径一致，也不受时区影响）
  async function getKline(symbol, interval = '1d', limit = 320) {
    try {
      const j = await hostGet(`/api/v3/klines?symbol=${symbol.toUpperCase().replace('-', '')}&interval=${interval}&limit=${limit}`);
      if (!Array.isArray(j)) return [];
      const daily = interval === '1d' || interval === '1w' || interval === '1M';
      return j.map(r => {
        const openMs = r[0];
        let time;
        if (daily) {
          const d = new Date(openMs);
          time = d.getUTCFullYear() + '-' +
            String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(d.getUTCDate()).padStart(2, '0');
        } else {
          time = window.U.toChartTime(openMs / 1000);
        }
        return {
          time,
          open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]),
          volume: num(r[5]) || 0,
        };
      }).filter(k => k.open !== null);
    } catch { return []; }
  }

  return { getQuotes, getTop, getKline };
})();

window.BinanceSource = BinanceSource;
