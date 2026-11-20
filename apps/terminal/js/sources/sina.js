/* sina.js —— 外汇 / 商品 / A股备源（hq.sinajs.cn，GBK）
   ⚠️ 实测：hq.sinajs.cn 无 Referer 直接返回 403，浏览器 fetch 不能自定义 Referer
   → 本源只在配置了 window.PROXY（Worker 会补 Referer）时可用；
     未配代理时 getQuotes 返回空数组，由调度器降级到东财（eastmoney.js）。

   实测字段：
   外汇 fx_s*: [0]时间 [1]昨收 [2]今开 [5]最高 [6]最低 [8]现价 [9]名称 [11]涨跌额 [12]涨跌幅%
   商品 hf_*:  [0]现价 [2]买价 [3]卖价 [4]最高 [5]最低 [6]时间 [7]昨收 [8]今开 [13]名称
   A股 sh/sz:  [0]名称 [1]今开 [2]昨收 [3]现价 [4]最高 [5]最低 [8]成交量(股) [9]成交额(元) */

const SinaSource = (() => {
  const BASE = 'https://hq.sinajs.cn/list=';
  const { num, request } = window.U;

  function parseLine(key, body) {
    const f = body.split(',');
    if (key.startsWith('fx_s')) {
      const price = num(f[8]), prevClose = num(f[1]);
      if (price === null) return null;
      let changePct = num(f[12]), change = num(f[11]);
      if (changePct === null && prevClose) changePct = (price - prevClose) / prevClose * 100;
      if (change === null && prevClose !== null) change = price - prevClose;
      return {
        symbol: key, name: (f[9] || key).trim(), code: key.replace('fx_s', '').toUpperCase(),
        market: 'fx', price, prevClose, open: num(f[2]), high: num(f[5]), low: num(f[6]),
        change, changePct, volume: null, updatedAt: Date.now(), source: 'sina',
      };
    }
    if (key.startsWith('hf_')) {
      const price = num(f[0]), prevClose = num(f[7]);
      if (price === null) return null;
      return {
        symbol: key, name: (f[13] || key).trim(), code: key.replace('hf_', ''),
        market: 'commodity', price, prevClose, open: num(f[8]), high: num(f[4]), low: num(f[5]),
        change: prevClose !== null ? price - prevClose : null,
        changePct: prevClose ? (price - prevClose) / prevClose * 100 : null,
        volume: null, updatedAt: Date.now(), source: 'sina',
      };
    }
    // A股备源
    const price = num(f[3]), prevClose = num(f[2]);
    if (price === null || price === 0) return null;
    return {
      symbol: key, name: (f[0] || key).trim(), code: key.slice(2),
      market: /^(sh000|sz399)/.test(key) ? 'index' : 'cn',
      price, prevClose, open: num(f[1]), high: num(f[4]), low: num(f[5]),
      change: prevClose !== null ? price - prevClose : null,
      changePct: prevClose ? (price - prevClose) / prevClose * 100 : null,
      volume: num(f[8]) !== null ? num(f[8]) / 100 : null,
      amount: num(f[9]), updatedAt: Date.now(), source: 'sina',
    };
  }

  function parse(text) {
    const out = [];
    text.split('\n').forEach(line => {
      const m = line.match(/var hq_str_([A-Za-z0-9_]+)="(.*)"/);
      if (!m || !m[2]) return;
      const q = parseLine(m[1], m[2]);
      if (q) out.push(q);
    });
    return out;
  }

  async function getQuotes(symbols) {
    if (!symbols || !symbols.length) return [];
    if (!window.PROXY) {          // 无代理 → 必然 403，直接让调度器走备源
      window.SourceState.fail('sina', 'need proxy (referer)');
      return [];
    }
    try {
      const text = await request(BASE + symbols.join(','), { gbk: true });
      const list = parse(text);
      if (list.length) window.SourceState.ok('sina');
      else window.SourceState.fail('sina', 'empty');
      return list;
    } catch (e) {
      window.SourceState.fail('sina', e.message);
      return [];
    }
  }

  return { getQuotes, parse };
})();

window.SinaSource = SinaSource;
