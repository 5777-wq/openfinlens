/* charts.js —— lightweight-charts 封装（K线 + 成交量副图 + 可配置均线组 + 分时）
   兼容 v3/v4（addCandlestickSeries）与 v5（addSeries(CandlestickSeries)）两套 API。
   均线：MA5/10/20/60 + EMA12/26 六条槽位，setMAVisible(配置对象) 按 key 开关（详情页存 localStorage）。 */

const Charts = (() => {
  const LWC = () => window.LightweightCharts;

  function baseOptions() {
    // 图表底色跟主题卡片色一致（#0a0a0a 嵌在 #111 卡片里像凹了一块）
    const bg = (getComputedStyle(document.body).getPropertyValue('--bg-card') || '').trim() || '#111111';
    return {
      layout: { background: { type: 'solid', color: bg }, textColor: '#86868b' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
      localization: { locale: 'zh-CN' },
    };
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
    }

    function setVolume(klines, c) {
      vol.setData(klines.map(k => ({
        time: k.time,
        value: k.volume || 0,
        color: (k.close >= k.open ? c.up : c.down) + '66',
      })));
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
    }

    function renderMA() {
      const closes = lastKlines.map(k => k.close);
      maLines.forEach((l, i) => {
        if (!l.on || lastKlines.length < l.n) { lineSeries[i].setData([]); return; }
        // 两条序列同形为 [{time,value}]：calcMA 原生对象；emaSeries 是数字数组（null 会在
        // 下面的 p.value 上炸掉——腾讯日K 盘后会出现 null 收盘bar，必须在此归一）
        const seq = l.type === 'ema'
          ? emaSeries(closes, l.n).map((v, k) => ({
              time: lastKlines[k].time,
              value: (closes[k] === null || closes[k] === undefined) ? null : v,
            }))
          : calcMA(lastKlines, l.n);
        lineSeries[i].setData(seq.filter(p => p && p.value !== null && Number.isFinite(p.value)));
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

    function paint() {
      const c = themeColors();
      const last = points.length ? points[points.length - 1].value : null;
      const rising = prevClose === null || last === null ? true : last >= prevClose;
      const col = rising ? c.up : c.down;
      area.applyOptions({ lineColor: col, topColor: col + '40', bottomColor: col + '02' });
      area.setData(points.map(p => ({ time: p.time, value: p.value })));
      vol.setData(points.map(p => ({ time: p.time, value: p.volume || 0, color: col + '55' })));
      chart.timeScale().fitContent();
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

  return { createKline, createTrend, calcMA, emaSeries, themeColors };
})();

window.Charts = Charts;
