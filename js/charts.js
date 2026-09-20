/* charts.js —— lightweight-charts 封装（K线 + 成交量副图 + 可配置均线组 + 分时）
   兼容 v3/v4（addCandlestickSeries）与 v5（addSeries(CandlestickSeries)）两套 API。
   均线：MA5/10/20/60 + EMA12/26 六条槽位，setMAVisible(配置对象) 按 key 开关（详情页存 localStorage）。 */

const Charts = (() => {
  const LWC = () => window.LightweightCharts;

  function baseOptions() {
    // 图表底色跟主题卡片色一致（#0a0a0a 嵌在 #111 卡片里像凹了一块）。
    // 文字/网格线同样走主题变量（--chart-*），换肤后 retheme() 增量重读即可
    const s = getComputedStyle(document.body);
    const varOf = (name, fb) => (s.getPropertyValue(name) || '').trim() || fb;
    return {
      layout: { background: { type: 'solid', color: varOf('--bg-card', '#111111') }, textColor: varOf('--chart-text', '#86868b') },
      grid: {
        vertLines: { color: varOf('--chart-grid', 'rgba(255,255,255,0.04)') },
        horzLines: { color: varOf('--chart-grid', 'rgba(255,255,255,0.04)') },
      },
      rightPriceScale: { borderColor: varOf('--chart-border', 'rgba(255,255,255,0.08)') },
      timeScale: { borderColor: varOf('--chart-border', 'rgba(255,255,255,0.08)'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
      localization: { locale: 'zh-CN' },
    };
  }

  // 换肤后对已存在的图表增量重读主题变量（canvas 不吃 CSS 变量，必须 applyOptions）
  function retheme(chart) {
    if (chart && typeof chart.applyOptions === 'function') chart.applyOptions(baseOptions());
  }

  // v5 / v4 兼容的 series 添加
  function addSeries(chart, kind, opts) {
    const L = LWC();
    if (typeof chart.addSeries === 'function' && L[kind + 'Series']) {
      return chart.addSeries(L[kind + 'Series'], opts);
    }
    const legacy = { Candlestick: 'addCandlestickSeries', Histogram: 'addHistogramSeries', Line: 'addLineSeries', Area: 'addAreaSeries' };
    return chart[legacy[kind]](opts);
  }

  /* 均线槽位回退色：正常取 CSS 的 --ma-0..5（单一来源），仅在变量缺失时兜底 */
  const MA_FALLBACK = ['#e8a33d', '#5b8def', '#1fc2db', '#b06ad4', '#e0559b', '#aab82e'];

  function themeColors() {
    const s = getComputedStyle(document.body);
    const varOf = (name, fb) => (s.getPropertyValue(name) || '').trim() || fb;
    return {
      up: varOf('--up', '#ff5c5c'),
      down: varOf('--down', '#2ebd85'),
      lineColors: MA_FALLBACK.map((fb, i) => varOf('--ma-' + i, fb)),
    };
  }

  // 蜡烛图 + 成交量 + MA
  function createKline(el) {
    const L = LWC();
    if (!L) return null;
    const { up, down, lineColors: LINE_COLORS } = themeColors();
    const chart = L.createChart(el, Object.assign(baseOptions(), { height: el.clientHeight || 420 }));

    // 图例层（2026-09-17）：十字光标处的 OHLC/量/涨跌幅 + 均线读数，随光标移动；
    // 光标离开画布回退到最新一根。数据自查即所得，不弹窗（TradingView 的左上读数法）。
    const legend = document.createElement('div');
    legend.className = 'k-legend';
    el.appendChild(legend);

    const candle = addSeries(chart, 'Candlestick', {
      upColor: up, downColor: down, borderVisible: false,
      wickUpColor: up, wickDownColor: down,
    });
    const vol = addSeries(chart, 'Histogram', {
      priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });

    // 6 条均线槽位，颜色由 CSS 调色板 --ma-0..5 决定；类型与周期由外部配置驱动（详情页菜单可改任意周期）
    const lineSeries = LINE_COLORS.map(color => addSeries(chart, 'Line', {
      color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    }));

    let lastKlines = [];
    // 每条均线的完整序列（renderMA 时缓存一份），十字光标读数按时间下标取值
    let maData = [];
    // 事件标记层（Event-on-Chart）：宏观/新闻/龙虎榜等事件画到对应日期K线上，
    // 点击 marker 通过 Bus 抛给详情页弹事件卡。数据结构见 js/events.js toChartEvent。
    let chartEvents = [];
    const tKey = (t) => typeof t === 'string' ? t
      : (t && typeof t === 'object' && t.year) ? t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0')
      : String(t);
    const tCmp = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b
      : (tKey(a) < tKey(b) ? -1 : tKey(a) > tKey(b) ? 1 : 0);

    function applyMarkers() {
      if (!candle.setMarkers) return;
      if (!chartEvents.length) { candle.setMarkers([]); return; }
      // 只画落在实际K线上的事件（周末/停牌日没有 bar，画不出去还得排序报错）
      const times = new Set(lastKlines.map(k => tKey(k.time)));
      const ms = chartEvents
        .filter(e => times.has(tKey(e.time)))
        .slice(0, 40)
        .map(e => ({
          time: e.time, position: 'aboveBar', shape: 'circle', size: 1,
          color: e.color || '#e8a33d', text: e.text || '',
        }))
        .sort((a, b) => tCmp(a.time, b.time));
      candle.setMarkers(ms);
    }

    function setEvents(list) {
      chartEvents = Array.isArray(list) ? list : [];
      applyMarkers();
    }

    if (typeof chart.subscribeClick === 'function' && window.Bus) {
      chart.subscribeClick((param) => {
        const key = param && param.time !== undefined ? tKey(param.time) : null;
        if (!key) return;
        const hits = chartEvents.filter(e => tKey(e.time) === key);
        if (hits.length) window.Bus.emit('chart:event', { time: key, events: hits });
      });
    }
    // 默认：MA5 + MA20 + EMA26（配置存 localStorage，详情页菜单可改任意周期 2~500）
    let maLines = [
      { type: 'ma', n: 5, on: true },
      { type: 'ma', n: 10, on: false },
      { type: 'ma', n: 20, on: true },
      { type: 'ma', n: 60, on: false },
      { type: 'ema', n: 12, on: false },
      { type: 'ema', n: 26, on: true },
    ];

    function applyTheme() {
      const c = themeColors();
      candle.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
      lineSeries.forEach((s, i) => s.applyOptions({ color: LINE_COLORS[i] }));
      if (lastKlines.length) setVolume(lastKlines, c);
      paintLegend(lastKlines.length - 1);
    }

    function setVolume(klines, c) {
      vol.setData(klines.map(k => ({
        time: k.time,
        value: k.volume || 0,
        color: (k.close >= k.open ? c.up : c.down) + '66',
      })));
    }

    /* ---- 十字光标图例 ---- */
    const fmtVolShort = (v) => {
      const F = window.U && window.U.fmtVol ? window.U.fmtVol : null;
      return F ? F(v) : String(v);
    };

    // 日K 的 time 是 "2026-09-16" 字符串，分钟K是伪 UTC 秒级时间戳——分别排版
    const fmtLegendTime = (t) => {
      if (typeof t !== 'number') return tKey(t);
      const d = new Date(t * 1000);
      const two = (n) => String(n).padStart(2, '0');
      const hm = two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
      const now = new Date();
      return d.getUTCFullYear() === now.getUTCFullYear()
        ? (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + hm
        : d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm;
    };

    function legendHTML(idx) {
      const k = lastKlines[idx];
      if (!k) return '';
      const c = themeColors();
      const col = k.close >= k.open ? c.up : c.down;
      const prev = lastKlines[idx - 1];
      const chg = (prev && prev.close) ? (k.close - prev.close) / prev.close * 100 : null;
      const ma = maLines.map((l, i) => {
        if (!l.on) return '';
        const pt = maData[i] && maData[i][idx];
        if (!pt || pt.value === null || pt.value === undefined || !Number.isFinite(pt.value)) return '';
        return `<span style="color:${LINE_COLORS[i]}">${l.type.toUpperCase()}${l.n} ${pt.value}</span>`;
      }).join('');
      return `<span class="kl-time">${fmtLegendTime(k.time)}</span>` +
        `<span>开 <b style="color:${col}">${k.open}</b></span>` +
        `<span>高 <b style="color:${col}">${k.high}</b></span>` +
        `<span>低 <b style="color:${col}">${k.low}</b></span>` +
        `<span>收 <b style="color:${col}">${k.close}</b></span>` +
        (chg !== null ? `<span class="${chg >= 0 ? 'up' : 'down'}">${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%</span>` : '') +
        (k.volume ? `<span>量 <b>${fmtVolShort(k.volume)}</b></span>` : '') + ma;
    }

    function paintLegend(idx) {
      legend.innerHTML = lastKlines.length ? legendHTML(idx === null || idx === undefined ? lastKlines.length - 1 : idx) : '';
    }

    if (typeof chart.subscribeCrosshairMove === 'function') {
      chart.subscribeCrosshairMove((param) => {
        if (!lastKlines.length) return;
        if (!param || param.time === undefined || param.time === null) { paintLegend(null); return; }
        const key = tKey(param.time);
        const idx = lastKlines.findIndex(k => tKey(k.time) === key);
        paintLegend(idx >= 0 ? idx : lastKlines.length - 1);
      });
    }

    function setData(klines) {
      // 盘后/清算时段腾讯日K会混入 OHLC 为 null 的脏bar（lightweight-charts 内部直接炸），
      // 整根剔除：蜡烛/成交量/均线/事件标记共用同一份干净序列
      lastKlines = (klines || []).filter(k => k && k.time !== null && k.time !== undefined &&
        [k.open, k.high, k.low, k.close].every(v => v !== null && v !== undefined && isFinite(v)));
      const c = themeColors();
      candle.setData(lastKlines.map(k => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close,
      })));
      setVolume(lastKlines, c);
      renderMA();
      chart.timeScale().fitContent();
      paintLegend(lastKlines.length - 1);
    }

    function renderMA() {
      const closes = lastKlines.map(k => k.close);
      maData = [];
      maLines.forEach((l, i) => {
        if (!l.on || lastKlines.length < l.n) { lineSeries[i].setData([]); maData[i] = []; return; }
        // 两条序列同形为 [{time,value}]：calcMA 原生对象；emaSeries 是数字数组（null 会在
        // 下面的 p.value 上炸掉——腾讯日K 盘后会出现 null 收盘bar，必须在此归一）
        const seq = l.type === 'ema'
          ? emaSeries(closes, l.n).map((v, k) => ({
              time: lastKlines[k].time,
              value: (closes[k] === null || closes[k] === undefined) ? null : v,
            }))
          : calcMA(lastKlines, l.n);
        const clean = seq.filter(p => p && p.value !== null && Number.isFinite(p.value));
        lineSeries[i].setData(clean);
        maData[i] = seq;
      });
    }

    function setMAVisible(v) {
      if (Array.isArray(v)) {
        // 新配置：[{type:'ma'|'ema', n, on}, ...]（槽位数量可少于 6，缺省槽关闭）
        maLines = LINE_COLORS.map((_, i) => {
          const l = v[i] || {};
          const n = Math.max(2, Math.min(500, Math.round(+l.n || 5)));
          return { type: l.type === 'ema' ? 'ema' : 'ma', n, on: !!l.on };
        });
      } else if (v && typeof v === 'object') {
        maLines = maLines.map(l => Object.assign({}, l));   // 未知对象：保持现状
      } else {
        maLines = maLines.map(l => Object.assign({}, l, { on: !!v }));   // 旧布尔：全开/全关
      }
      renderMA();
    }

    return {
      chart, candle, vol, setData, applyTheme, setMAVisible, setEvents,
      remove() { try { chart.remove(); } catch { /* ignore */ } },
    };
  }

  // 分时图（面积线 + 成交量）
  function createTrend(el) {
    const L = LWC();
    if (!L) return null;
    const chart = L.createChart(el, Object.assign(baseOptions(), { height: el.clientHeight || 420 }));
    const { up, down } = themeColors();

    // 分时图例：时间 + 价格 + 相对昨收涨跌（十字光标跟随，同 K 线图例）
    const legend = document.createElement('div');
    legend.className = 'k-legend';
    el.appendChild(legend);

    const area = addSeries(chart, 'Area', {
      lineWidth: 2, lineColor: up,
      topColor: up + '40', bottomColor: up + '02',
      priceLineVisible: true, lastValueVisible: true,
    });
    const vol = addSeries(chart, 'Histogram', {
      priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

    let points = [];
    let prevClose = null;

    const tKey2 = (t) => typeof t === 'number' ? hhmm(t) : String(t);
    const hhmm = (sec) => {
      const d = new Date(sec * 1000);
      return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    };

    function legendHTML(idx) {
      const p = points[idx];
      if (!p) return '';
      const c = themeColors();
      const last = points.length ? points[points.length - 1].value : null;
      const col = prevClose === null || p.value === null ? c.up : (p.value >= prevClose ? c.up : c.down);
      const chg = (prevClose && p.value !== null) ? (p.value - prevClose) / prevClose * 100 : null;
      return `<span class="kl-time">${tKey2(p.time)}</span>` +
        `<span>价 <b style="color:${col}">${p.value}</b></span>` +
        (chg !== null ? `<span class="${chg >= 0 ? 'up' : 'down'}">${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%</span>` : '') +
        `<span class="kl-dim">昨收 ${prevClose !== null ? prevClose : '--'} · 最新 ${last !== null ? last : '--'}</span>`;
    }

    function paintLegend(idx) {
      legend.innerHTML = points.length ? legendHTML(idx === null || idx === undefined ? points.length - 1 : idx) : '';
    }

    if (typeof chart.subscribeCrosshairMove === 'function') {
      chart.subscribeCrosshairMove((param) => {
        if (!points.length) return;
        if (!param || param.time === undefined || param.time === null) { paintLegend(null); return; }
        const idx = points.findIndex(p => p.time === param.time);
        paintLegend(idx >= 0 ? idx : points.length - 1);
      });
    }

    function paint() {
      const c = themeColors();
      const last = points.length ? points[points.length - 1].value : null;
      const rising = prevClose === null || last === null ? true : last >= prevClose;
      const col = rising ? c.up : c.down;
      area.applyOptions({ lineColor: col, topColor: col + '40', bottomColor: col + '02' });
      area.setData(points.map(p => ({ time: p.time, value: p.value })));
      vol.setData(points.map(p => ({ time: p.time, value: p.volume || 0, color: col + '55' })));
      chart.timeScale().fitContent();
      paintLegend(points.length - 1);
    }

    function setData(pts, prev) {
      points = pts || [];
      prevClose = prev === undefined ? prevClose : prev;
      paint();
    }

    return {
      chart, setData, applyTheme: paint,
      setMAVisible() { /* 分时无 MA */ },
      setEvents() { /* 分时不画日频事件标记 */ },
      remove() { try { chart.remove(); } catch { /* ignore */ } },
    };
  }

  /* 基金对比：N 条归一化曲线共用一套 --ma-N 调色板（与 K线均线同一份令牌，
     不另起一套颜色字面量），十字光标横向联动出各标的当日读数。 */
  function createCompare(el, { onHover } = {}) {
    const L = LWC();
    if (!L) return null;
    const chart = L.createChart(el, Object.assign(baseOptions(), {
      height: el.clientHeight || 460,
      /* 下边距 0.04 是量出来的：0.08 时 lightweight-charts 会在数据下方（下边距带内）
         多画一个 0.00 刻度——归一曲线的 0 点毫无意义，容易被读成"从 0 开始"。
         0.04 时 0 落在画布外（实测 y=400.4 > 400），曲线仍留 16px 余量不贴边。 */
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.10, bottom: 0.04 } },
      // 对比图靠鼠标拖拽看细节，滚轮留给页面滚动更符合直觉
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    }));
    let series = [];                 // [{ key, s }]
    let hoverCb = onHover || null;
    let lastTimes = [];

    function palette() { return themeColors().lineColors; }

    function ensure(n) {
      const colors = palette();
      while (series.length < n) {
        const i = series.length;
        series.push({
          key: null,
          s: addSeries(chart, 'Line', {
            color: colors[i % colors.length], lineWidth: 2,
            priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
          }),
        });
      }
      return colors;
    }

    function setSeries(list) {
      const colors = ensure(list.length);
      lastTimes = [];
      series.forEach((slot, i) => {
        const item = list[i];
        if (!item) { slot.key = null; slot.s.setData([]); return; }
        slot.key = item.key;
        slot.s.applyOptions({
          color: colors[i % colors.length],
          title: '',
          lastValueVisible: list.length <= 8,
        });
        slot.s.setData(item.points.map(p => ({ time: p.time, value: p.value })));
        if (item.points.length) lastTimes.push(item.points[item.points.length - 1].time);
      });
      chart.timeScale().fitContent();
    }

    function setLog(on) {
      try {
        const mode = on ? L.PriceScaleMode.Logarithmic : L.PriceScaleMode.Normal;
        chart.priceScale('right').applyOptions({ mode });
      } catch { /* 旧版本没有 PriceScaleMode：忽略即可，图的绝对值仍可读 */ }
    }

    const tKey = (t) => typeof t === 'string' ? t
      : (t && typeof t === 'object' && t.year) ? t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0')
      : String(t);

    if (typeof chart.subscribeCrosshairMove === 'function') {
      chart.subscribeCrosshairMove((param) => {
        if (!hoverCb) return;
        const time = param && param.time !== undefined && param.time !== null ? tKey(param.time) : null;
        const vals = {};
        if (time) {
          series.forEach(slot => {
            if (!slot.key) return;
            const d = param.seriesData && param.seriesData.get ? param.seriesData.get(slot.s) : null;
            if (d && d.value !== undefined && d.value !== null) vals[slot.key] = d.value;
          });
        }
        hoverCb(time, vals);
      });
    }

    return {
      chart, setSeries, setLog,
      setHover(fn) { hoverCb = fn; },
      applyTheme() { const c = palette(); series.forEach((slot, i) => slot.s.applyOptions({ color: c[i % c.length] })); },
      fit() { chart.timeScale().fitContent(); },
      remove() { try { chart.remove(); } catch { /* ignore */ } },
    };
  }

  // MA 均线序列（自算）；窗口内含 null/脏收盘价时该点断线（null 当 0 加会算出假均线）
  function calcMA(klines, n) {
    const out = [];
    let sum = 0;
    let bad = 0;
    for (let i = 0; i < klines.length; i++) {
      const c = klines[i].close;
      if (c === null || c === undefined || !isFinite(c)) bad++;
      else sum += c;
      if (i >= n) {
        const old = klines[i - n].close;
        if (old === null || old === undefined || !isFinite(old)) bad--;
        else sum -= old;
      }
      out.push({
        time: klines[i].time,
        value: (i < n - 1 || bad > 0) ? null : +(sum / n).toFixed(3),
      });
    }
    return out;
  }

  function emaSeries(closes, n) {
    const T = window.Technical;
    if (T) return T.emaSeries(closes, n).map(v => v === null ? null : +v.toFixed(3));
    return closes.map(() => null);
  }

  return { createKline, createTrend, createCompare, calcMA, emaSeries, themeColors, retheme };
})();

window.Charts = Charts;
