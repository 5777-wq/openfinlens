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

    /* ---------- 副图指标窗（独立 canvas，自绘） ----------
       TradingView 的模型：主图 + 一个独立的指标窗（成交量 / RSI / MACD）。
       为什么不用 lightweight-charts 的第二条 priceScale：vendor 是 4.2.3，
       没有 addPane（多窗格要 v5），而 4.x 的 priceScale 只能挂 left/right ——
       副图刻度会和主图价格轴挤在同一边。实测把 RSI 挂在隐藏的 'vol' scale 上时，
       lightweight-charts 把 0~100 映射到了**主价格轴**，RSI 线直接画进了价格区。
       所以副图自绘：独立 canvas、独立纵轴刻度、横向与主图等宽。

       成交量也走这条路径（原来是 lightweight-charts 的 vol series + 隐藏 scale），
       统一成一套绘制逻辑，副图形态才一致。 */
    const paneCanvas = document.createElement('canvas');
    paneCanvas.className = 'k-pane';
    paneCanvas.setAttribute('role', 'img');
    paneCanvas.setAttribute('aria-label', '副图指标');
    // 副图高度写死：原来按 el.clientHeight 的 26% 算，而详情页还没展开时
    // clientHeight 读到的不是主图高度，比例算出来的高度时对时不对。
    // 固定 110px（主图 420 + 副图 110 ≈ TradingView 的主图/指标窗比例）。
    const PANE_H = 110;
    paneCanvas.style.height = PANE_H + 'px';
    // 副图 canvas 必须挂在**主图容器外面**（chart-box）——
    // 放进 #klineChart 里会被 lightweight-charts 的定位规则卷进去，
    // 结果它浮到图表下方、压住下一个板块的标题。
    const paneHost = el.parentElement || el;
    if (paneHost && paneHost.insertBefore) {
      paneHost.insertBefore(paneCanvas, el.nextSibling);
    } else {
      el.appendChild(paneCanvas);
    }

    // 当前副图：'vol' | 'rsi' | 'macd'
    let paneKey = 'vol';
    let paneParams = {};

    /* 主图 → 副图的横坐标换算：直接问主图要每个时间点的 x（像素）。
       为什么不用「按序号等分」：主图 fitContent 之后首尾两根 bar 各留半个
       bar 间距，等分会让副图整体偏移半格 —— 副图上的 10-20 会落在主图的
       10-19 旁边，差 6~7px，肉眼看不出来但读数全对不上。
       等分还画不出「中间休市」的缺口（休市日被当成连续的一天连成假线）。
       ⚠ 平移/缩放后 timeToCoordinate 只回**可见区**的点（不可见的返回 null），
       对不可见点回退等分会把画布外的点摆进可见区（幽灵柱）。补全逻辑
       （可见点仿射拟合 x = a·i + b 再外推到全部下标）在 paneview.affineX，
       纯函数、有单测。换算不可用时返回 null，调用方回退等分。 */
    function mainChartX(times, plotW) {
      try {
        const ts = chart.timeScale && chart.timeScale();
        if (!ts || typeof ts.timeToCoordinate !== 'function') return null;
        const sparse = new Map();       // 可见点：time → x
        times.forEach(t => {
          const x = ts.timeToCoordinate(t);
          if (x === null || x === undefined || !isFinite(x)) return;
          sparse.set(t, x);
        });
        return window.PaneView.affineX(times, sparse, plotW);
      } catch (e) { return null; }
    }

    /* 副图重画的统一入口（帧合并）：setData / 副图切换 / 主图平移缩放 /
       十字光标移动都走这里，一帧内多次触发只画一次。
       等“下一帧”的原因见 setData 内注释（fitContent 的新坐标下一帧才落地）。
       ⚠ 不能只押 requestAnimationFrame：部分 WebView / 隐藏视图里 rAF 长期不触发
       （本仓库 animateScore 记过同一坑：数值正确性依赖 rAF 就会永远停在旧值），
       实测内嵌浏览器里主图已画、副图却整块空白。40ms（约两帧）兜底补画。 */
    let paneRaf = 0;
    function runPaneRender() {
      if (!paneRaf) return;           // 另一条路径已经画过，别画两遍
      paneRaf = 0;
      if (lastKlines.length) renderPane(lastKlines, themeColors());
    }
    function schedulePaneRender() {
      if (paneRaf) return;
      paneRaf = requestAnimationFrame(runPaneRender);
      setTimeout(() => {
        if (!paneRaf) return;
        cancelAnimationFrame(paneRaf);
        runPaneRender();
      }, 40);
    }

    /* 十字光标联动状态（TradingView 的整图十字线：主图与副图同 x 一起亮）：
       mainCrossX = 主图 crosshair 时间落在副图上的 x；paneHoverX = 鼠标直接在副图上时的 x。
       lastXMap = renderPane 最近一次用的 time→x 映射，副图 hover 反查时间用。 */
    let mainCrossX = null;
    let paneHoverX = null;
    let lastXMap = null;

    function setPaneCross(time) {
      let x = null;
      if (time !== null && time !== undefined && lastXMap) {
        const v = lastXMap.get(time);
        if (v !== undefined && isFinite(v)) x = v;
      }
      if (x === mainCrossX) return;   // 没动就不重画
      mainCrossX = x;
      schedulePaneRender();
    }

    /* 副图标题（TradingView 每个副图左上角都有指标名 + 当前值） */
    function paneTitle() {
      if (paneKey === 'rsi') return 'RSI(' + (paneParams.n || 14) + ')';
      if (paneKey === 'macd') {
        const d = window.Panes && window.Panes.paneDef('macd');
        const def = (k) => ((d && d.params || []).find(x => x.key === k) || {}).def;
        return 'MACD(' + [paneParams.fast || def('fast') || 12,
          paneParams.slow || def('slow') || 26, paneParams.signal || def('signal') || 9].join(',') + ')';
      }
      return '成交量';
    }

    /* 按当前副图类型重画。数据来自 js/panes.js（纯计算、可单测），
       几何来自 js/paneview.js（纯几何、可单测）。 */
    function renderPane(klines, c) {
      if (!window.Panes || !window.PaneView) return;
      const pane = window.Panes.computePane(paneKey, klines, paneParams);
      const series = [];
      const bars = [];
      if (paneKey === 'vol') {
        const dirOf = new Map();
        (klines || []).forEach(k => {
          if (k && k.time != null) dirOf.set(k.time, k.close >= k.open ? 1 : -1);
        });
        const d = (pane.bars[0] ? pane.bars[0].data : []).map(x => ({
          time: x.time, value: x.value, up: (dirOf.get(x.time) || 1) > 0,
        }));
        bars.push({ name: '成交量', color: c.up, data: d, kind: 'bar' });
      } else if (paneKey === 'rsi') {
        const l = pane.lines[0];
        if (l) series.push({ name: l.name, color: c.lineColors[1 % c.lineColors.length], data: l.data });
      } else if (paneKey === 'macd') {
        const dif = pane.lines[0], dea = pane.lines[1];
        const hist = pane.bars[0] ? pane.bars[0].data : [];
        if (dif) series.push({ name: 'DIF', color: c.lineColors[2 % c.lineColors.length], data: dif.data });
        if (dea) series.push({ name: 'DEA', color: c.lineColors[5 % c.lineColors.length], data: dea.data });
        // MACD 柱按正负染色（多头红 / 空头绿）：符号由值本身决定
        if (hist.length) {
          bars.push({
            name: 'MACD', color: c.up, kind: 'bar',
            data: hist.map(d => Object.assign({}, d, { up: d.value >= 0 })),
          });
        }
      }

      // 纵轴域：成交量从 0 起；RSI 固定 0~100；MACD 含零轴
      const vals = [];
      series.forEach(s => (s.data || []).forEach(d => { if (isFinite(d.value)) vals.push(d.value); }));
      bars.forEach(s => (s.data || []).forEach(d => { if (isFinite(d.value)) vals.push(d.value); }));
      const domain = paneKey === 'rsi'
        ? { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] }
        : window.PaneView.axis(vals, { includeZero: true });

      // 时间轴：主图与副图共用（横向必须对齐，否则读数对不上）
      const times = (klines || []).map(k => k.time);
      // 副图绘图区宽度 = 主图宽度 - 右侧价格轴宽度：
      // 两块横向不对齐的话，副图上的时间和主图上的 K 线会错位，读数全废。
      let axisW = 44;
      try {
        const ps = chart.priceScale && chart.priceScale('right');
        const w = ps && typeof ps.width === 'function' ? ps.width() : 0;
        if (w > 10) axisW = w;
      } catch (e) { /* 老版本没有 width()，用默认 44 */ }
      // 尺寸以副图 canvas 自身为准（它就在主图旁边，宽度同源）
      const totalW = paneCanvas.clientWidth || el.clientWidth || 400;
      const plotW = Math.max(10, totalW - axisW);   // 副图绘图区（右侧留刻度区）
      const h = paneCanvas.clientHeight || PANE_H;
      // 横坐标：向主图要真实像素位置（逐像素对齐 + 休市缺口）
      const xMap = mainChartX(times, plotW);
      lastXMap = xMap;                 // 副图 hover 反查时间 / 主图十字竖线都用它
      // 缺交易日断线的判定步长 = 主图当前的 bar 间距（像素）
      let step = 0;
      try {
        const ts = chart.timeScale && chart.timeScale();
        if (ts && typeof ts.barSpacing === 'function') step = ts.barSpacing();
      } catch (e) { /* ignore */ }
      if (!(step > 0)) step = times.length > 1 ? (plotW / (times.length - 1)) : 0;
      // 线与柱**都要**进 layout：layout 才把数据点落到画布坐标上。
      // 之前只把线传了进去，柱只参与了纵轴取值 ——
      // 结果就是"纵轴有刻度、图上一根柱都没有"（成交量 / MACD 柱全空）。
      const model = window.PaneView.layout(
        series.map(s => ({ name: s.name, color: s.color, data: s.data, kind: 'line' }))
          .concat(bars.map(b => ({ name: b.name, color: b.color, data: b.data, kind: 'bar' }))),
        times, domain || { min: 0, max: 1, ticks: [] }, plotW, h, 6, xMap);
      window.PaneView.draw(paneCanvas, {
        lines: model.lines,
        bars: model.bars,   // 用 layout 落位后的柱（原始 bars 只有数值，没坐标）
      }, {
        domain,
        w: totalW,          // canvas 内部总宽（= 主图宽度）
        axisRight: axisW,   // 右侧刻度区宽度 = 主图价格轴宽度（两块横向必须对齐）
        step: step,          // 主图的 bar 间距（像素）：缺交易日的缺口靠它判定
        barCount: times.length,
        upColor: c.up, downColor: c.down,
        gridColor: getComputedStyle(document.body).getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.07)',
        textColor: getComputedStyle(document.body).getPropertyValue('--chart-text').trim() || '#8a8a92',
        zeroColor: getComputedStyle(document.body).getPropertyValue('--chart-border').trim() || 'rgba(0,0,0,0.22)',
        // 成交量纵轴用「亿/万」（共用 U.fmtVol 的口径，和图例里的量一个单位）
        fmtTick: paneKey === 'vol'
          ? (v) => (window.U && window.U.fmtVol ? window.U.fmtVol(v) : String(v))
          : null,
        // 标题里的当前值：成交量也走「亿/万」，指标值两位小数
        fmtValue: paneKey === 'vol'
          ? (v) => (window.U && window.U.fmtVol ? window.U.fmtVol(v) : String(v))
          : null,
        // 副图标题（指标名）+ 十字光标竖线（与主图联动，谁在上面用谁的 x）
        title: paneTitle(),
        crossX: paneHoverX !== null ? paneHoverX : mainCrossX,
        pad: 6,
      });
    }

    /* 外部设置：{ key, params } —— key 是副图类型，params 是该指标自己的参数。
       ⚠ 参数变化（RSI 14→6）也要重画：只判 key 的话，改参数后图不动，
       菜单上的数字与副图曲线就对不上了（2026-10-21 复查适配时发现）。 */
    function setPane(v) {
      const p = v || {};
      const key = window.Panes && window.Panes.paneDef(p.key) ? p.key : 'vol';
      const changed = key !== paneKey || JSON.stringify(paneParams || {}) !== JSON.stringify(p.params || {});
      paneKey = key;
      paneParams = p.params || {};
      if (changed && lastKlines.length) schedulePaneRender();
    }

    /* 主图平移/缩放 → 副图跟着重画：否则副图停在上一次的视野里，
       "逐像素对齐"在第一次拖动后就断了（2026-10-21 复查适配时发现）。
       fitContent/setData 也会触发 range change，与 setData 的一帧延迟
       合并到同一个 rAF，不会重复画。 */
    const onRangeChange = () => schedulePaneRender();
    try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange); }
    catch (e) { /* 老版本没有该订阅：退化为不跟随（拖动后仍可切周期/指标触发重画） */ }

    /* 副图鼠标：hover 时副图画竖线，并把主图十字线吸附到对应 bar
       （setCrosshairPosition，图例同步读数）；离开时清掉。
       最近点超过 30px 就不联动——空白区硬吸附会给出假读数。 */
    paneCanvas.addEventListener('mousemove', (e) => {
      const x = e && isFinite(e.offsetX) ? e.offsetX : null;
      paneHoverX = x;
      if (x !== null && lastXMap) {
        let best = null, bestD = Infinity;
        lastXMap.forEach((px, t) => {
          const d = Math.abs(px - x);
          if (d < bestD) { bestD = d; best = t; }
        });
        if (best !== null && bestD <= 30) {
          const bar = lastKlines.find(k => k.time === best);
          try { chart.setCrosshairPosition(bar ? bar.close : 0, best, candle); }
          catch (err) { /* 老版本没有 setCrosshairPosition：只画副图竖线 */ }
        }
      }
      schedulePaneRender();
    });
    paneCanvas.addEventListener('mouseleave', () => {
      paneHoverX = null;
      try { chart.clearCrosshairPosition(); } catch (err) { /* ignore */ }
      schedulePaneRender();
    });


    /* ---------- 主图叠加指标（TradingView 模型：可任意增删） ----------
       用户 2026-10-20："无法自定义 ema/ma 或者主图副图其他指标等等 这点重点参考 tv"。
       原来主图指标是**固定 6 槽**（MA5/10/20/60 + EMA12/26），只能开关与改周期，
       加不了一条新的。现在改成动态池：
         · 配置是任意长度的数组（上限 8 条），可增可删；
         · 类型支持 MA / EMA / BOLL（布林带占 3 个 series 槽：上/中/下轨）；
         · 颜色取 --ma-0..5 六色令牌，超出时循环取色（不新增颜色字面量）。
       lightweight-charts 4.2.3 有 removeSeries，所以槽位能真正销毁再建。 */
    const MAX_OVERLAYS = 8;
    const lineSeries = [];          // 动态池：与展开后的槽位一一对应

    // 一个配置项 → 几个 series 槽（BOLL 三个，其余一个）
    const slotsOf = (l) => (l.type === 'boll' ? 3 : 1);

    // 把配置数组展开成槽位数组（每个槽位记着自己的配置与轨号）
    function expandSlots(lines) {
      const out = [];
      for (const l of lines) {
        const n = slotsOf(l);
        for (let k = 0; k < n; k++) out.push({ cfg: l, rail: k });
      }
      return out;
    }

    // 槽位数变了 → 增删 series（lightweight-charts 不能改 series 的类型，
    // 所以数量变化时按需新建/销毁；类型变化（BOLL 的 3 槽）也走这条路）
    function syncSeriesPool(slots) {
      while (lineSeries.length > slots.length) {
        const s = lineSeries.pop();
        try { if (typeof chart.removeSeries === 'function') chart.removeSeries(s); } catch (e) { /* ignore */ }
      }
      while (lineSeries.length < slots.length) {
        lineSeries.push(addSeries(chart, 'Line', {
          color: LINE_COLORS[lineSeries.length % LINE_COLORS.length], lineWidth: 1,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        }));
      }
      // 颜色按槽位序号重刷（增删后序号会变）
      const c = themeColors();
      lineSeries.forEach((s, i) => s.applyOptions({ color: c.lineColors[i % c.lineColors.length] }));
    }

    // 默认：MA5 + MA20 + EMA26（沿用原默认，其余槽位不画）
    let maLines = [
      { type: 'ma', n: 5, on: true },
      { type: 'ma', n: 20, on: true },
      { type: 'ema', n: 26, on: true },
    ];

    // BOLL(20,2) 三轨：中轨 = SMA(n)，上下轨 = 中轨 ± k × 总体标准差
    function bollSeries(closes, n, k) {
      const mid = calcMA(lastKlines, n);
      const out = { mid: [], upper: [], lower: [] };
      for (let i = 0; i < mid.length; i++) {
        const m = mid[i];
        if (!m || m.value === null || !Number.isFinite(m.value)) { out.mid.push(null); out.upper.push(null); out.lower.push(null); continue; }
        const win = closes.slice(Math.max(0, i - n + 1), i + 1).filter(v => v !== null && v !== undefined);
        if (win.length < 2) { out.mid.push(null); out.upper.push(null); out.lower.push(null); continue; }
        const mean = win.reduce((s2, v) => s2 + v, 0) / win.length;
        const sd = Math.sqrt(win.reduce((s2, v) => s2 + (v - mean) * (v - mean), 0) / win.length);
        out.mid.push(m);
        out.upper.push({ time: m.time, value: m.value + k * sd });
        out.lower.push({ time: m.time, value: m.value - k * sd });
      }
      return out;
    }

    let lastKlines = [];
    // 每条均线的完整序列（renderMA 时缓存一份），十字光标读数按时间下标取值
    let maData = [];
    // 展开后的槽位元信息（槽位 → {name, type, n}）：图例要按槽位显示，
    // 因为一个 BOLL 配置项占三条轨（上/中/下），按配置项显示会少两轨读数。
    let maSlotMeta = [];
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
          // size 3：marker 不带文字了（见 js/events.js 的 toChartEvent），
          // 圆点就是唯一的可见线索，太小（1~2px）在浅色图上根本看不见。
          time: e.time, position: 'aboveBar', shape: 'circle', size: 3,
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

    function applyTheme() {
      const c = themeColors();
      candle.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
      // 均线取当前 c.lineColors：LINE_COLORS 是创建时捕获的闭包值，换肤/切红绿后会过期。
      // 槽位数可变 → 取模（色板 6 色，槽位可到 8）。
      lineSeries.forEach((s, i) => s.applyOptions({ color: c.lineColors[i % c.lineColors.length] }));
      if (lastKlines.length) renderPane(lastKlines, c);
      paintLegend(lastKlines.length - 1);
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
      // 读数按**展开后的槽位**（maSlotMeta），不是配置项：
      // BOLL 一项占三轨，图例要分别标出上/中/下轨。
      const ma = (maSlotMeta || []).map((m, i) => {
        const pt = maData[i] && maData[i][idx];
        if (!pt || pt.value === null || pt.value === undefined || !Number.isFinite(pt.value)) return '';
        return `<span style="color:${c.lineColors[i % c.lineColors.length]}">${m.name} ${pt.value}</span>`;
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
        // 副图竖线跟主图十字线同 x（联动的一侧；另一侧是副图 hover → setCrosshairPosition）
        setPaneCross(param && param.time !== undefined && param.time !== null ? param.time : null);
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
      // 先 fitContent 再画副图：副图的横坐标直接取主图的 timeToCoordinate，
      // 时间轴没落位时换算出来的 x 是旧的（首尾会差半格甚至错位）。
      chart.timeScale().fitContent();
      // 但 fitContent 的新 bar 间距是**下一帧**才落地的：
      // 同步去问 timeToCoordinate，拿到的还是默认间距（6px）算出来的旧坐标，
      // 首点会跑到画布外（实测 x0=-1018），副图整块错位。
      // 所以副图等一帧再画（schedulePaneRender：rAF 合并 + WebView 不触发 rAF 的兜底；
      // range change 订阅触发的重画也合并到同一帧，差一帧 16ms 肉眼无感）。
      schedulePaneRender();
      renderMA();
      paintLegend(lastKlines.length - 1);
    }

    function renderMA() {
      const closes = lastKlines.map(k => k.close);
      maData = [];
      maSlotMeta = [];
      // 只画 on 的配置项；关掉的直接不占槽位（不建 series）
      const active = maLines.filter(l => l && l.on);
      const slots = expandSlots(active);
      syncSeriesPool(slots);
      // 槽位 → 序列数据：BOLL 一次算三条，其余一条
      let si = 0;
      for (const l of active) {
        if (l.type === 'boll') {
          const b = bollSeries(closes, l.n, 2);
          const rails = [
            { data: b.upper, name: 'BOLL上' },
            { data: b.mid, name: 'BOLL中' },
            { data: b.lower, name: 'BOLL下' },
          ];
          for (const rail of rails) {
            const clean = rail.data.filter(p => p && p.value !== null && Number.isFinite(p.value));
            lineSeries[si].setData(clean);
            maData[si] = rail.data;
            maSlotMeta[si] = { name: rail.name, type: 'boll', n: l.n };
            si++;
          }
          continue;
        }
        // 两条序列同形为 [{time,value}]：calcMA 原生对象；emaSeries 是数字数组（null 会在
        // 下面的 p.value 上炸掉——腾讯日K 盘后会出现 null 收盘bar，必须在此归一）
        const seq = l.type === 'ema'
          ? emaSeries(closes, l.n).map((v, k) => ({
              time: lastKlines[k].time,
              value: (closes[k] === null || closes[k] === undefined) ? null : v,
            }))
          : calcMA(lastKlines, l.n);
        const clean = seq.filter(p => p && p.value !== null && Number.isFinite(p.value));
        lineSeries[si].setData(clean);
        maData[si] = seq;
        maSlotMeta[si] = { name: l.type.toUpperCase() + l.n, type: l.type, n: l.n };
        si++;
      }
    }

    /* 主图指标配置：[{type:'ma'|'ema'|'boll', n, on}, ...]
       数组长度任意（上限 MAX_OVERLAYS），可增可删。
       传布尔是旧接口（全开/全关），传对象是旧对象格式，都保留兼容。 */
    function setMAVisible(v) {
      if (Array.isArray(v)) {
        const lines = v.filter(l => l && typeof l === 'object').slice(0, MAX_OVERLAYS).map(l => ({
          type: l.type === 'ema' ? 'ema' : l.type === 'boll' ? 'boll' : 'ma',
          n: Math.max(2, Math.min(500, Math.round(+l.n || 5))),
          on: !!l.on,
        }));
        maLines = lines;
      } else if (v && typeof v === 'object') {
        maLines = maLines.map(l => Object.assign({}, l));   // 未知对象：保持现状
      } else {
        maLines = maLines.map(l => Object.assign({}, l, { on: !!v }));   // 旧布尔：全开/全关
      }
      renderMA();
    }

    /* 副图是自绘 canvas：布局宽度变化时 CSS 只拉伸位图，不会重画，
       拖一下就和主图对不上了。监听重画一次。
       lightweight-charts 自己有 autoSize，主图不用管。
       监听源用 ResizeObserver 观察副图自身（宽度 100% 跟着容器走）：
       窗口缩放、折叠面板展开、换肤侧栏这类**不改 window 尺寸**的布局变化
       也能触发（只挂 window.resize 会漏掉它们，2026-10-21 复查适配时发现）；
       老 WebView 没有 ResizeObserver 时退回 window.resize。
       要等**两帧**：尺寸变化 → ResizeObserver → 主图重算 → 主图重绘，
       中间隔着一次 rAF；只等一帧拿到的是主图重算之前的旧坐标。
       同样不押 rAF（见 schedulePaneRender 的注释）：80ms 兜底补画。 */
    let resizeRaf = 0;
    function runResizeRender() {
      if (!resizeRaf) return;
      resizeRaf = 0;
      if (lastKlines.length) renderPane(lastKlines, themeColors());
    }
    function onResize() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = requestAnimationFrame(runResizeRender);
      });
      setTimeout(() => {
        if (!resizeRaf) return;
        cancelAnimationFrame(resizeRaf);
        runResizeRender();
      }, 80);
    }
    let paneRO = null;
    if (typeof ResizeObserver === 'function') {
      paneRO = new ResizeObserver(onResize);
      paneRO.observe(paneCanvas);   // observe 首次回调只会多画一次幂等帧，无害
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', onResize);
    }

    return {
      chart, candle, setData, applyTheme, setMAVisible, setEvents, setPane,
      // 副图 canvas 挂在主图容器外面，销毁时必须一起摘掉，
      // 否则切标的/切周期会留下一堆空副图（每次 createKline 都新建一个）。
      remove() {
        // 订阅/观察器先摘再销毁图表：chart.remove() 之后某些版本的内部对象已不可解绑
        try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange); }
        catch { /* chart 已销毁或老版本：忽略 */ }
        if (paneRO) { try { paneRO.disconnect(); } catch { /* ignore */ } paneRO = null; }
        try { chart.remove(); } catch { /* ignore */ }
        try { if (paneCanvas && paneCanvas.parentNode) paneCanvas.parentNode.removeChild(paneCanvas); }
        catch { /* ignore */ }
        // 监听要一起摘：切标的会反复 createKline，漏摘就堆出一串 resize 回调
        if (typeof window !== 'undefined' && window.removeEventListener) {
          window.removeEventListener('resize', onResize);
        }
        if (resizeRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(resizeRaf);
        if (paneRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(paneRaf);
        paneRaf = 0;
        // 十字线状态复位：下一次 createKline 是全新的闭包，不复位也不会串——
        // 显式置空只是让"销毁后仍被 rAF 持有"的窗口期读到一致的空态
        mainCrossX = null;
        paneHoverX = null;
        lastXMap = null;
      },
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
      // 分时图只保留成交量副图（TradingView 的分时默认也是成交量副图）；
      // 日频指标（RSI/MACD）只在日 K 上给，避免在分钟线上算出无意义的读数。
      setPane() { /* 分时副图固定为成交量 */ },
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
