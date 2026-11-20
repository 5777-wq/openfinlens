/* breadth.js —— 市场宽度与情绪指标计算（纯函数，无网络请求）
   数据来源：复用 G3 热力图的东财全市场 diff（同一份数据，禁止重复拉取）。

   情绪指数口径：上涨家数占比（剔除平盘）直接映射 0-100。
     score = 上涨 / (上涨 + 下跌) * 100
   之所以剔除平盘：停牌与一字板会把分母灌水，导致普涨日算出来的分数被压低。
   全部平盘/无有效数据 → 返回 null（界面显示 --，不伪造 50）。 */

const Breadth = (() => {
  // 七段分布（红涨绿跌，从跌到涨）
  const BUCKETS = [
    { key: 'lt-5', label: '<-5%', min: -Infinity, max: -5, dir: 'down' },
    { key: '-5-3', label: '-5~-3%', min: -5, max: -3, dir: 'down' },
    { key: '-3-1', label: '-3~-1%', min: -3, max: -1, dir: 'down' },
    { key: 'flat', label: '±1%', min: -1, max: 1, dir: 'flat' },
    { key: '1-3', label: '1~3%', min: 1, max: 3, dir: 'up' },
    { key: '3-5', label: '3~5%', min: 3, max: 5, dir: 'up' },
    { key: 'gt5', label: '>5%', min: 5, max: Infinity, dir: 'up' },
  ];

  // A股涨跌停判定：主板 ±10%、创业板/科创板 ±20%、ST ±5%。
  // 用阈值下浮 0.3pct 容错（实际封板价四舍五入后常见 9.98 / 19.97 / 4.96）。
  function limitOf(row) {
    const code = String(row.code || '');
    const name = String(row.name || '');
    // 顺序必须是"先板块后 ST"：注册制下创业板/科创板 ST 股仍是 ±20%
    // （实测 300010 ST豆神 +10.42%，若 ST 优先判 5% 会被误计涨停）
    if (/^(30|68)/.test(code)) return 20;
    // 北交所：存量 43/83/87/88 段 + 2024 年起启用的 920 段，均 ±30%
    if (/^(8|4|92)/.test(code)) return 30;
    if (/ST/i.test(name)) return 5;
    return 10;
  }

  // 新股无涨跌幅限制：N=上市首日，C=注册制上市次日至第 5 日
  // （实测 N华汇 +111.74% 曾被计成涨停）
  const isNewStock = (name) => /^N|^C/.test(String(name || ''));

  // rows: [{ code, name, price, changePct, change, marketCap, amount? }]
  function compute(rows) {
    const empty = {
      total: 0, up: 0, down: 0, flat: 0, limitUp: 0, limitDown: 0,
      upRatio: null, avgPct: null, medianPct: null, amount: null,
      score: null, dist: BUCKETS.map(b => ({ ...b, count: 0, ratio: 0 })),
    };
    if (!rows || !rows.length) return empty;

    const valid = rows.filter(r => r && r.changePct !== null && r.changePct !== undefined && !isNaN(r.changePct));
    if (!valid.length) return empty;

    let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0, sum = 0, amount = 0;
    const dist = BUCKETS.map(b => ({ ...b, count: 0, ratio: 0 }));
    const pcts = [];

    valid.forEach(r => {
      const p = Number(r.changePct);
      pcts.push(p);
      sum += p;
      if (r.amount) amount += Number(r.amount) || 0;

      if (p > 0) up++; else if (p < 0) down++; else flat++;

      // 新股上市初期无涨跌幅限制，不计入涨跌停（涨幅本身照常进分布/涨跌统计）
      if (!isNewStock(r.name)) {
        const lim = limitOf(r);
        if (p >= lim - 0.3) limitUp++;
        else if (p <= -lim + 0.3) limitDown++;
      }

      // 落桶：区间取 [min, max)，最后一桶闭合
      for (let i = 0; i < dist.length; i++) {
        const b = dist[i];
        const hit = i === dist.length - 1 ? (p >= b.min) : (p >= b.min && p < b.max);
        if (hit) { b.count++; break; }
      }
    });

    const total = valid.length;
    dist.forEach(b => { b.ratio = total ? b.count / total : 0; });
    pcts.sort((a, b) => a - b);
    const mid = Math.floor(pcts.length / 2);
    const medianPct = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;

    const decisive = up + down;
    return {
      total, up, down, flat, limitUp, limitDown,
      upRatio: total ? up / total : null,
      avgPct: sum / total,
      medianPct,
      amount: amount || null,
      score: decisive ? (up / decisive) * 100 : null,
      dist,
    };
  }

  // 情绪分档：<30 恐慌（偏跌色）/ 30-70 中性（签名色）/ >70 亢奋（偏涨色）
  function scoreBand(score) {
    if (score === null || score === undefined || isNaN(score)) return { key: 'none', label: '--', cls: 'sb-none' };
    if (score < 30) return { key: 'panic', label: '恐慌', cls: 'sb-panic' };
    if (score <= 70) return { key: 'neutral', label: '中性', cls: 'sb-neutral' };
    return { key: 'greed', label: '亢奋', cls: 'sb-greed' };
  }

  /* ---- 情绪历史（方法论参考：bankrollhunter/market-breadth 的宽度时间序列）----
   本机 localStorage 逐日快照：同一天反复计算只保留最后一次（收盘后的最准），
   全市场样本 < 3000 只不入库（腾讯 88 只兜底会算出假情绪）。 */
  const HIST_CAP = 90;

  function localDateStr(ts) {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function recordHistory(hist, score, total, now) {
    if (score === null || score === undefined || isNaN(score)) return hist || [];
    if (!total || total < 3000) return hist || [];   // 兜底样本不入库
    const arr = Array.isArray(hist) ? hist.slice() : [];
    const d = localDateStr(now || Date.now());
    const i = arr.findIndex(x => x.d === d);
    if (i >= 0) arr[i] = { d, s: +(score.toFixed(1)) };
    else arr.push({ d, s: +(score.toFixed(1)) });
    return arr.slice(-HIST_CAP);
  }

  // sparkline 数据：最近 n 个点归一到 [0,1]（纯函数，渲染层只管画）
  function sparkPoints(hist, n) {
    const pts = (hist || []).slice(-(n || 30)).map(x => (x && typeof x.s === 'number') ? x.s : null);
    const valid = pts.filter(v => v !== null);
    if (valid.length < 2) return { pts, min: null, max: null, norm: [] };
    const min = Math.min(...valid), max = Math.max(...valid);
    const span = max - min;
    const norm = pts.map(v => v === null ? null : span === 0 ? 0.5 : (v - min) / span);
    return { pts, min, max, norm };
  }

  return { compute, scoreBand, BUCKETS, limitOf, recordHistory, sparkPoints, HIST_CAP };
})();

window.Breadth = Breadth;
