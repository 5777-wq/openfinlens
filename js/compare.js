/* compare.js —— 基金对比的纯计算层（无 DOM、无网络，全部可单测）
 *
 * 口径（与 totalrealreturns 一类工具对齐）：
 *   · 序列来自东财后复权价（含分红再投资近似），只用于算比值 —— 归一曲线一律把区间首日定为基准
 *     （100 或 0%），绝不展示复权价本身（后复权价不是真实报价）。
 *   · 总收益 / CAGR 用区间首末收盘；年化波动用期间收益率标准差 × √年频；
 *     最大回撤含峰谷日期；年度收益按自然年（首末年份数据不满一年会标 partial）。
 *   · 相关性用"所有标的都有数据的公共交易日"上的收益率，避免把不同市场的休市日
 *     当成 0 收益混进去（A股/港股/美股日历不同，这一点会显著压低相关性）。
 */

const CompareMath = (() => {
  const DAY = 86400000;
  const YEAR_DAYS = 365.25;

  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  /* 区间切片：日期是 ISO 字符串，直接按字典序比较即可（不做 Date 解析，避免时区平移） */
  function sliceRange(bars, start, end) {
    if (!Array.isArray(bars) || !bars.length) return [];
    return bars.filter(b => (!isDate(start) || b.time >= start) && (!isDate(end) || b.time <= end));
  }

  /* 归一化：基准 = 区间第一根 bar（或显式传入的 base 收盘价，见 buildLines 的"共同起点"）。
     as='index' → 起点 100（指数刻度）；as='pct' → 起点 0%（累计收益率）；as='mult' → 起点 1 倍。
     曾经写成 base 数字相乘，"0%" 那档会被乘成一条全 0 直线——三种口径用名字区分，不用数字。
     注意 pct 口径会出现负值 → 该口径下对数轴无意义，由界面禁用。 */
  function normalize(bars, { as = 'index', base = null } = {}) {
    if (!bars || !bars.length) return [];
    const first = (base > 0) ? base : bars[0].close;
    if (!(first > 0)) return [];
    const mode = (as === 'pct' || as === 'mult') ? as : 'index';
    return bars.map(b => {
      const idx = 100 * b.close / first;
      const value = mode === 'pct' ? idx - 100 : mode === 'mult' ? idx / 100 : idx;
      return { time: b.time, value: +value.toFixed(4) };
    });
  }

  function daysBetween(a, b) {
    const t1 = Date.parse(a + 'T00:00:00Z');
    const t2 = Date.parse(b + 'T00:00:00Z');
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
    return (t2 - t1) / DAY;
  }

  function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  /* 样本标准差（n-1）：收益率的波动率用总体口径会把小样本估小，样本口径与业界一致 */
  function stdev(a) {
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }

  /* 逐期简单收益率（前一根缺失/为 0 时跳过该点） */
  function returns(bars) {
    const out = [];
    for (let i = 1; i < bars.length; i++) {
      const p = bars[i - 1].close, c = bars[i].close;
      if (p > 0 && c > 0) out.push(c / p - 1);
    }
    return out;
  }

  /* 最大回撤：返回幅度与峰/谷日期（回撤区间用真实日期标注，不写"第 N 天"） */
  function maxDrawdown(bars) {
    let peak = -Infinity, peakAt = null, worst = 0, worstPeak = null, worstTrough = null;
    for (const b of bars) {
      if (b.close > peak) { peak = b.close; peakAt = b.time; }
      const dd = peak > 0 ? b.close / peak - 1 : 0;
      if (dd < worst) { worst = dd; worstPeak = peakAt; worstTrough = b.time; }
    }
    return { maxDD: worst * 100, peakAt: worstPeak, troughAt: worstTrough };
  }

  /* 指标卡：区间内的全部读数。periodsPerYear 由粒度决定（日 252 / 周 52 / 月 12）。
     rf=0：夏普按"无风险利率 = 0"的简化口径，界面必须标注，不能默认读者知道。 */
  function metrics(bars, { periodsPerYear = 252, rf = 0 } = {}) {
    if (!Array.isArray(bars) || bars.length < 2) return null;
    const first = bars[0], last = bars[bars.length - 1];
    if (!(first.close > 0) || !(last.close > 0)) return null;
    const days = daysBetween(first.time, last.time);
    const years = days === null ? null : days / YEAR_DAYS;
    const total = (last.close / first.close - 1) * 100;
    const cagr = (years && years > 0.02) ? (Math.pow(last.close / first.close, 1 / years) - 1) * 100 : null;
    const rets = returns(bars);
    const sd = stdev(rets);
    const vol = sd === null ? null : sd * Math.sqrt(periodsPerYear) * 100;
    const avg = mean(rets);
    const sharpe = (sd && sd > 0 && avg !== null) ? (avg * periodsPerYear - rf) / (sd * Math.sqrt(periodsPerYear)) : null;
    const dd = maxDrawdown(bars);
    // 区间太短（<1 个月）时年化数字没有意义，CAGR/卡玛一律留空而不是给个漂亮的大数
    const calmar = (cagr !== null && dd.maxDD < 0) ? cagr / Math.abs(dd.maxDD) : null;
    const ys = yearlyReturns(bars).filter(y => !y.partial);
    return {
      n: bars.length, from: first.time, to: last.time, days, years,
      total, cagr, vol, sharpe, calmar,
      maxDD: dd.maxDD, peakAt: dd.peakAt, troughAt: dd.troughAt,
      best: ys.length ? ys.reduce((a, b) => (b.pct > a.pct ? b : a)) : null,
      worst: ys.length ? ys.reduce((a, b) => (b.pct < a.pct ? b : a)) : null,
      upYears: ys.filter(y => y.pct > 0).length, yearCount: ys.length,
    };
  }

  /* 年度收益（自然年）。首年/末年数据不满整年 → partial=true（界面上年份后加 * 并注明），
     否则"2010 年 +47%"里混着半年数据会被当成全年读。 */
  function yearlyReturns(bars) {
    const out = [];
    if (!Array.isArray(bars) || !bars.length) return out;
    for (let i = 0; i < bars.length;) {
      const y = bars[i].time.slice(0, 4);
      let j = i;
      while (j + 1 < bars.length && bars[j + 1].time.slice(0, 4) === y) j++;
      const base = bars[i - 1] ? bars[i - 1].close : bars[i].close;   // 首年以该年首根为基准
      const last = bars[j].close;
      const beganLate = i === 0 && bars[i].time.slice(5) > '01-05';
      const endedEarly = j === bars.length - 1 && bars[j].time.slice(5) < '12-24';
      out.push({ year: y, pct: base > 0 ? (last / base - 1) * 100 : null, partial: beganLate || endedEarly });
      i = j + 1;
    }
    return out;
  }

  /* 多标的对齐：mode='own' 各自起点归一（能看到晚上市基金的完整表现）；
     mode='common' 共同起点归一（同一天起算、同一个基准，读数可直接比）。
     返回 excluded 明确交代"谁为什么没进图"，不做静默丢弃。 */
  function buildLines(funds, { mode = 'own', start = null, end = null, as = 'index' } = {}) {
    const sliced = (funds || []).map(f => ({ ...f, bars: sliceRange(f.bars, start, end) }));
    const excluded = [];
    let commonStart = null;
    if (mode === 'common') {
      // 共同起点 = 各标的区间内数据起点的最晚者（即"所有标的都已上市/有数据"的第一天）。
      // 只用**真的能进图的**标的算（≥2 根 bar）：否则会被一个随后因样本不足被排除的标的
      // 拖晚整个共同起点，脚注上写的起点没人在用。
      const ok = sliced.filter(f => f.bars.length >= 2);
      if (ok.length) commonStart = ok.reduce((s, f) => (f.bars[0].time > s ? f.bars[0].time : s), ok[0].bars[0].time);
    }
    const lines = [];
    for (const f of sliced) {
      if (!f.bars.length) { excluded.push({ key: f.key, name: f.name, reason: '该区间内没有数据' }); continue; }
      let bars = f.bars;
      let base = null;                       // null = 用区间第一根 bar 作基准（own 模式）
      if (mode === 'common') {
        /* 基准必须落在**同一天**上，否则"共同起点"是假的：
           A股与美股休市日不同，共同起点那天可能有市场不交易 → 取"该日或之前最后一根 bar"
           的收盘作基准（前向填充，节假日当天的价格就是上一根收盘价，没有编造）。
           数据止于共同起点之前的标的（退市/停牌/数据缺口）在这里排除并写明理由。 */
        const last = bars[bars.length - 1].time;
        if (last < commonStart) {
          excluded.push({ key: f.key, name: f.name, reason: '数据止于 ' + last + '，早于共同起点 ' + commonStart });
          continue;
        }
        let baseIdx = -1;
        for (let i = 0; i < bars.length; i++) { if (bars[i].time <= commonStart) baseIdx = i; else break; }
        if (baseIdx < 0) {
          excluded.push({ key: f.key, name: f.name, reason: '数据自 ' + bars[0].time + ' 起，晚于共同起点 ' + commonStart });
          continue;
        }
        base = bars[baseIdx].close;
        bars = bars.filter(b => b.time >= commonStart);
      }
      /* 只有 1 根 bar 的区间没有"区间收益"可言（metrics 也返回 null）。
         两种对齐模式一视同仁地排除并说明——曾经 own 模式放行、界面靠 null 兜底，
         一算指标就炸成白屏 */
      if (bars.length < 2) {
        excluded.push({ key: f.key, name: f.name, reason: '区间内只有 ' + bars.length + ' 个交易日，不足以算收益' });
        continue;
      }
      lines.push({ key: f.key, name: f.name, bars, base, points: normalize(bars, { as, base }) });
    }
    return { lines, excluded, commonStart, mode };
  }

  /* 相关性矩阵：公共交易日上的收益率。样本不足（<3 个公共日）返回 null，不硬凑一个数 */
  function correlation(seriesList) {
    const list = (seriesList || []).filter(s => s && s.bars && s.bars.length > 1);
    if (list.length < 2) return null;
    const maps = list.map(s => new Map(s.bars.map(b => [b.time, b.close])));
    const common = [...maps[0].keys()].filter(t => maps.every(m => m.has(t))).sort();
    if (common.length < 4) return null;
    const rets = maps.map(m => {
      const r = [];
      for (let i = 1; i < common.length; i++) {
        const p = m.get(common[i - 1]), c = m.get(common[i]);
        r.push(p > 0 ? c / p - 1 : 0);
      }
      return r;
    });
    const pearson = (a, b) => {
      const ma = mean(a), mb = mean(b);
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        const x = a[i] - ma, y = b[i] - mb;
        num += x * y; da += x * x; db += y * y;
      }
      return (da > 0 && db > 0) ? num / Math.sqrt(da * db) : null;
    };
    const matrix = list.map((_, i) => list.map((__, j) => (i === j ? 1 : pearson(rets[i], rets[j]))));
    return { keys: list.map(s => s.key), names: list.map(s => s.name), matrix, days: common.length };
  }

  return { sliceRange, normalize, metrics, yearlyReturns, returns, maxDrawdown, correlation,
    buildLines, mean, stdev, daysBetween, YEAR_DAYS };
})();

window.CompareMath = CompareMath;
