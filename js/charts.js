/* charts.js —— lightweight-charts 封装（K线 + 成交量副图 + 可配置均线组 + 分时）
   兼容 v3/v4（addCandlestickSeries）与 v5（addSeries(CandlestickSeries)）两套 API。
   均线：MA5/10/20/60 + EMA12/26 六条槽位，setMAVisible(配置对象) 按 key 开关（详情页存 localStorage）。
   标尺与对比（K线）：setScale('normal'|'log'|'pct') 切价格标尺档位；
   setCompare(cmp) 叠加第二条标的（rebaseCompare 归一化重定基，值落在主图价格单位）。 */

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
      // 画线选中态的强调色（端点手柄）：走 accent 令牌，8 套皮肤自动适配
      // （现有消费者按需解构，多出的字段零影响）
      accent: varOf('--accent-signature', '#e8a33d'),
    };
  }

  // 蜡烛图 + 成交量 + MA
  // options（可选第二参）：{ onDrawings, onToolEnd } —— 画线工具的持久化 / 退出回调。
  // 不传时行为与旧版完全一致（createTrend 不动）。
  function createKline(el, options) {
    const L = LWC();
    if (!L) return null;
    const opts = (options && typeof options === 'object') ? options : {};
    const onDrawings = typeof opts.onDrawings === 'function' ? opts.onDrawings : null;
    const onToolEnd = typeof opts.onToolEnd === 'function' ? opts.onToolEnd : null;
    // 右键菜单「隐藏全部画线」的上层回调：app 层记忆 + 按钮态同步。
    // 未传时菜单项仍可隐藏本图（临时态，不落盘）。
    const onHideAll = typeof opts.onHideAll === 'function' ? opts.onHideAll : null;
    const { up, down, lineColors: LINE_COLORS } = themeColors();
    const chart = L.createChart(el, Object.assign(baseOptions(), { height: el.clientHeight || 420 }));

    // 图例层（2026-09-17）：十字光标处的 OHLC/量/涨跌幅 + 均线读数，随光标移动；
    // 光标离开画布回退到最新一根。数据自查即所得，不弹窗（TradingView 的左上读数法）。
    const legend = document.createElement('div');
    legend.className = 'k-legend';
    el.appendChild(legend);

    // 图表角落常显徽标「代码 · 周期」（TradingView 左上角常驻读数）：详情页经 setInfo 喂入，
    // paintLegend 总把徽标拼在图例最前面——没有数据时图例为空、徽标也照常显示（「常显」）
    let symInfo = null;
    const symHTML = () => {
      const b = legendBadge(symInfo);
      return b ? '<span class="kl-sym">' + escHtml(b) + '</span>' : '';
    };

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
      drawOverlay();                  // 画线 overlay 跟随主图重画（平移/缩放后坐标会变）
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
    // 槽位样式（slotStyles 的输出，与槽位一一对应）：用户指派的取色下标/线宽
    let slotStyle = [];

    // 一个配置项 → 几个 series 槽（BOLL 三个，其余一个）
    const slotsOf = (l) => (l.type === 'boll' ? 3 : 1);

    // 槽位取色：用户指派的 ci 优先（slotStyles 已归一到 0..n-1），
    // 缺失回退槽位序号——与改造前「按槽位序号取色」的行为一致
    const slotColorOf = (c, i) => {
      const st = slotStyle[i];
      const ci = (st && st.ci !== null && st.ci !== undefined) ? st.ci : i;
      return c.lineColors[ci % c.lineColors.length];
    };
    // 槽位线宽：1/2/3 之外的值一律按 1（slotStyles 已收敛，这里是画图侧兜底）
    const slotWidthOf = (i) => {
      const st = slotStyle[i];
      return (st && (st.w === 2 || st.w === 3)) ? st.w : 1;
    };

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
      // 颜色/线宽按槽位重刷（增删后序号会变）：用户指派的 ci/w 优先，缺失回退槽位序号
      const c = themeColors();
      lineSeries.forEach((s, i) => s.applyOptions({ color: slotColorOf(c, i), lineWidth: slotWidthOf(i) }));
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
    // 对比叠加线（compare overlay，惰性创建）：cmpMap = tKey → 对比线值（图例反查）、
    // cmpBase = 首点值（累计涨跌幅分母，统计口径）、cmpName = 图例读数前缀
    let cmpSeries = null;
    let cmpMap = null;
    let cmpBase = null;
    let cmpName = '';
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

    /* ---- 价格标尺（普通/对数/百分比）：mode 'log'→1 / 'pct'→2 / 其余→0。
       PriceScaleMode 数值常量 v3/v4/v5 稳定，照 setLog 先例 try/catch 老版本静默降级 ---- */
    function setScale(mode) {
      try {
        const m = mode === 'log' ? 1 : mode === 'pct' ? 2 : 0;
        chart.priceScale('right').applyOptions({ mode: m });
      } catch { /* 旧版本无该 API：忽略即可 */ }
    }

    /* ---- 对比叠加（compare overlay）：rebase 后的序列画到一条虚线 Line series，
       与蜡烛共用右价格轴；series 惰性创建、清空只 setData([]) 不销毁（均线池同款）---- */
    function ensureCmpSeries() {
      if (cmpSeries) return cmpSeries;
      cmpSeries = addSeries(chart, 'Line', {
        color: themeColors().lineColors[5],   // --ma-5 令牌链，零颜色字面量
        lineWidth: 2,
        lineStyle: 2,                          // LineStyle.Dashed：与均线实线区分
        lastValueVisible: false,               // 不挤右轴（蜡烛自己的读数已在那里）
        priceLineVisible: false,
        crosshairMarkerVisible: true,          // 悬停可读数
      });
      return cmpSeries;
    }

    function setCompare(cmp) {
      if (!cmp || !Array.isArray(cmp.points) || !cmp.points.length) {
        // null / 空 points 一律收敛为「无对比」：清数据保 series
        if (cmpSeries) cmpSeries.setData([]);
        cmpMap = null;
        cmpBase = null;
        cmpName = '';
        paintLegend(lastKlines.length - 1);
        return;
      }
      ensureCmpSeries();
      cmpName = typeof cmp.name === 'string' ? cmp.name : '';
      cmpMap = new Map();
      const clean = [];
      cmp.points.forEach(p => {
        if (!p || p.time === null || p.time === undefined) return;
        const v = +p.value;
        if (!isFinite(v)) return;
        cmpMap.set(tKey(p.time), v);
        clean.push({ time: p.time, value: v });
      });
      cmpBase = cmpMap.size ? cmpMap.values().next().value : null;
      // 不调 fitContent：points ⊆ 主图时间集，时间轴零变化，保持用户当前视野
      cmpSeries.setData(clean);
      paintLegend(lastKlines.length - 1);
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
      // 槽位数可变 → 取模（色板 6 色，槽位可到 8）。取色走 slotColorOf（用户指派优先）、
      // 线宽走 slotWidthOf——否则换肤会把用户选的色/线宽重置回槽位序号默认值。
      lineSeries.forEach((s, i) => s.applyOptions({ color: slotColorOf(c, i), lineWidth: slotWidthOf(i) }));
      // 对比线同款重取令牌色（--ma-5 链）：创建时的闭包值换肤后会过期
      if (cmpSeries) cmpSeries.applyOptions({ color: c.lineColors[5] });
      if (lastKlines.length) renderPane(lastKlines, c);
      paintLegend(lastKlines.length - 1);
      drawOverlay();                  // 画线取色不在 LWC 管线里：换肤即时重取令牌色重画
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
        return `<span style="color:${slotColorOf(c, i)}">${m.name} ${pt.value}</span>`;
      }).join('');
      // 对比线读数：当前 bar 在对比序列有值时显示「对比名 累计涨跌幅」（基准 = 首点，统计口径、无建议语义）
      let cmpHTML = '';
      if (cmpMap && cmpMap.size && cmpBase) {
        const cv = cmpMap.get(tKey(k.time));
        if (cv !== undefined && isFinite(cv)) {
          const pct = (cv / cmpBase - 1) * 100;
          cmpHTML = `<span style="color:${c.lineColors[5]}">${escHtml(cmpName)} ${(pct >= 0 ? '+' : '') + pct.toFixed(2)}%</span>`;
        }
      }
      return `<span class="kl-time">${fmtLegendTime(k.time)}</span>` +
        `<span>开 <b style="color:${col}">${k.open}</b></span>` +
        `<span>高 <b style="color:${col}">${k.high}</b></span>` +
        `<span>低 <b style="color:${col}">${k.low}</b></span>` +
        `<span>收 <b style="color:${col}">${k.close}</b></span>` +
        (chg !== null ? `<span class="${chg >= 0 ? 'up' : 'down'}">${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%</span>` : '') +
        (k.volume ? `<span>量 <b>${fmtVolShort(k.volume)}</b></span>` : '') + ma + cmpHTML;
    }

    function paintLegend(idx) {
      // 徽标在前、读数在后；无数据时 legendHTML 那段是空串，只剩徽标
      legend.innerHTML = symHTML() + (lastKlines.length
        ? legendHTML(idx === null || idx === undefined ? lastKlines.length - 1 : idx)
        : '');
    }

    /* 标的信息 {code, period}：非对象置空并重画。setData 之前调用也安全——
       lastKlines 为空时 legendHTML 返回 ''，图例只剩徽标。 */
    function setInfo(info) {
      symInfo = (info && typeof info === 'object') ? info : null;
      paintLegend();
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

    /* ---------- 画线工具（基础六件：骨架轮，2026-10-31）----------
       TradingView 模型：绘图层独立于数据序列——画在覆盖主图的 overlay canvas 上，
       每条画线只存「锚点（tKey 产物的时间串 + 价格）」，重画时按当前视野换算坐标。
       本轮只做「画得出 / 存得住 / 重画正确」；选中/拖拽/删除/隐藏留给下一条
       「画线工具·交互」（TV-ROADMAP P0 第 3 条）。
       · 坐标空间：LWC 主图 pane 左上角 = 容器左上角（价格轴在右、时间轴在下），
         el 的 offsetX/Y 与 timeToCoordinate/priceToCoordinate 同一坐标空间，
         overlay 全覆盖 el 即可，无需偏移换算；
       · 吸附：timeScale().coordinateToTime(x) 经 tKey 归一后反查当前序列的原始 time
         （日K 是 "YYYY-MM-DD" 串、分钟K 是伪 UTC 秒——存储统一存 tKey 产物字符串），
         candle.coordinateToPrice(y) 取价；老版本 LWC 没有这两个 API 时静默退化为
         「画不了」（诚实降级，不假装画上）；
       · 交互：drawTool 为 null 时事件直接放行（图表照常平移缩放）；激活时只拦
         mousedown（阻断 LWC 拖拽平移与 subscribeClick 事件标记），mousemove 不拦——
         十字线/图例照常联动，正好当画图的取点辅助；
       · 重画：挂在 runPaneRender 的 rAF+40ms 兜底链末尾（fitContent 后坐标下一帧
         才落地 + 部分 WebView rAF 不触发，同 setData 的注释），resize/换肤各补一次。 */
    const drawCanvas = document.createElement('canvas');
    drawCanvas.className = 'k-draw';
    drawCanvas.setAttribute('aria-hidden', 'true');
    el.appendChild(drawCanvas);

    let drawings = [];          // 已提交的画线（永远是 sanitizeDrawings 收敛口径）
    let drawTool = null;        // 当前画线模式：DRAW_TOOLS 之一或 null
    let draft = null;           // 两点工具的第一下：{ tool, k1, p1, ci }
    let previewPt = null;       // 鼠标预览落点（吸附产物）：{ k, p }
    let textInput = null;       // 文字标注的落点输入框
    let timeByKey = null;       // tKey(k.time) → k.time 反查表（setData 时失效重建）

    /* 画线交互态（选中/拖拽/隐藏，2026-10-31 交互轮）：
       selIdx = 当前选中的画线下标（-1 无）；dragCtx = 拖拽上下文；
       hidden = 「隐藏全部画线」开关（只藏不删，画线保留在存储）；
       hoverHit = 悬停命中的下标（变化才切 cursor，不重画）。 */
    let selIdx = -1;
    let dragCtx = null;         // { idx, grab:{k,p}, keys:string[], moved:boolean }
    let hidden = false;
    let hoverHit = -1;
    let toolbarEl = null;       // 浮动工具条（.k-draw-sel：六色块 + 删除）
    let ctxMenuEl = null;       // 右键菜单（.k-draw-ctx：删除 / 隐藏全部）

    const isTwoPoint = (tool) => tool === 'trend' || tool === 'rect' || tool === 'fib';
    const fmtDrawNum = (v) => String(+Number(v).toFixed(2));

    // 画布就绪：按 devicePixelRatio 设变换，位图尺寸不匹配时重设（防 CSS 拉伸模糊）
    function drawCtx() {
      const w = el.clientWidth || 0, h = el.clientHeight || 0;
      if (!w || !h) return null;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (drawCanvas.width !== pw || drawCanvas.height !== ph) {
        drawCanvas.width = pw;
        drawCanvas.height = ph;
      }
      const ctx = drawCanvas.getContext && drawCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    // k1（tKey 产物）→ 当前序列里的原始 time：日K 就是字符串本身，分钟K 反查数字。
    // 反查不到（切了周期/切了标的）返回 null —— 该条画线自动不画、仍保留在存储里。
    function chartTimeOf(k) {
      if (!timeByKey) {
        timeByKey = new Map();
        lastKlines.forEach(bar => {
          if (bar && bar.time !== null && bar.time !== undefined) timeByKey.set(tKey(bar.time), bar.time);
        });
      }
      return timeByKey.has(k) ? timeByKey.get(k) : null;
    }

    // 屏幕点 → 吸附点：x 吸到 K 线时间（必须在当前序列内），y 取价格。不可用返回 null。
    function snapPoint(x, y) {
      try {
        const ts = chart.timeScale && chart.timeScale();
        if (!ts || typeof ts.coordinateToTime !== 'function') return null;
        if (!lastKlines.length) return null;
        const t = ts.coordinateToTime(x);
        if (t === null || t === undefined) return null;
        const key = tKey(t);
        if (!lastKlines.some(bar => tKey(bar.time) === key)) return null;
        const price = (candle && typeof candle.coordinateToPrice === 'function') ? candle.coordinateToPrice(y) : null;
        if (price === null || price === undefined || !isFinite(price)) return null;
        return { k: key, p: +price };
      } catch (e) { return null; }
    }

    // 吸附点 → 画布坐标（预览用）；任一解析不出（不可见/反查不到）返回 null
    function ptCoords(pt) {
      if (!pt) return null;
      try {
        const ts = chart.timeScale && chart.timeScale();
        const time = chartTimeOf(pt.k);
        if (!ts || time === null) return null;
        const x = ts.timeToCoordinate(time);
        const y = (candle && typeof candle.priceToCoordinate === 'function') ? candle.priceToCoordinate(pt.p) : null;
        if (x === null || x === undefined || !isFinite(x)) return null;
        if (y === null || y === undefined || !isFinite(y)) return null;
        return { x: x, y: y };
      } catch (e) { return null; }
    }

    // 画线对象 → 画布坐标：k→time→timeToCoordinate、p→priceToCoordinate；
    // 两点工具缺 k2/p2 或任一点不可见时返回 null，调用方跳过该条。
    function coordsOf(d) {
      try {
        const ts = chart.timeScale && chart.timeScale();
        if (!ts || typeof ts.timeToCoordinate !== 'function') return null;
        const time1 = chartTimeOf(d.k1);
        if (time1 === null) return null;
        const x1 = ts.timeToCoordinate(time1);
        const y1 = (candle && typeof candle.priceToCoordinate === 'function') ? candle.priceToCoordinate(d.p1) : null;
        if (x1 === null || x1 === undefined || !isFinite(x1)) return null;
        if (y1 === null || y1 === undefined || !isFinite(y1)) return null;
        const out = { x1: x1, y1: y1, x2: null, y2: null };
        if (d.k2 !== undefined && d.k2 !== null) {
          const time2 = chartTimeOf(d.k2);
          if (time2 === null) return null;
          const x2 = ts.timeToCoordinate(time2);
          const y2 = (candle && typeof candle.priceToCoordinate === 'function') ? candle.priceToCoordinate(d.p2) : null;
          if (x2 === null || x2 === undefined || !isFinite(x2)) return null;
          if (y2 === null || y2 === undefined || !isFinite(y2)) return null;
          out.x2 = x2;
          out.y2 = y2;
        }
        // fib 命中判定要逐档 y：priceToCoordinate 逐档解析，解析不出记 null
        // （该档在 hitDrawing 里跳过）；paintShape 不读 fibYs，不受影响
        if (d.tool === 'fib' && out.x2 !== null) {
          out.fibYs = fibLevels(d.p1, d.p2).map(it => {
            const fy = (candle && typeof candle.priceToCoordinate === 'function') ? candle.priceToCoordinate(it.p) : null;
            return (fy === null || fy === undefined || !isFinite(fy)) ? null : fy;
          });
        }
        return out;
      } catch (e) { return null; }
    }

    // 逐条画：trend 直线 / hline 全宽横线+右端价格标签 / vline 全高竖线 /
    // rect 归一化矩形（描边 + 6% 填充）/ fib 七档水平细线+档位标签 / text 文字。
    // 取色全走 --ma-N 令牌链（themeColors），标签文字走 --chart-text（renderPane 同款兜底写法）。
    function paintShape(ctx, d, c, w, h) {
      const pt = coordsOf(d);
      if (!pt) return false;
      // 横线止于价格轴左缘（与 renderPane 的 axisW 同款逻辑：副图与主图右缘对齐）
      let axisW = 44;
      try {
        const ps = chart.priceScale && chart.priceScale('right');
        const pw = ps && typeof ps.width === 'function' ? ps.width() : 0;
        if (pw > 10) axisW = pw;
      } catch (e) { /* 老版本没有 width()，用默认 44 */ }
      const color = c.lineColors[(d.ci || 0) % c.lineColors.length];
      const textColor = getComputedStyle(document.body).getPropertyValue('--chart-text').trim() || '#8a8a92';
      const fontMono = getComputedStyle(document.body).getPropertyValue('--font-mono').trim() || 'monospace';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      if (d.tool === 'trend') {
        ctx.beginPath(); ctx.moveTo(pt.x1, pt.y1); ctx.lineTo(pt.x2, pt.y2); ctx.stroke();
        return true;
      }
      if (d.tool === 'hline') {
        const right = Math.max(10, w - axisW);
        ctx.beginPath(); ctx.moveTo(0, pt.y1); ctx.lineTo(right, pt.y1); ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.font = '10px ' + fontMono;
        ctx.fillText(fmtDrawNum(d.p1), right - 46, pt.y1 - 3);
        return true;
      }
      if (d.tool === 'vline') {
        ctx.beginPath(); ctx.moveTo(pt.x1, 0); ctx.lineTo(pt.x1, h); ctx.stroke();
        return true;
      }
      if (d.tool === 'rect') {
        const rx = Math.min(pt.x1, pt.x2), ry = Math.min(pt.y1, pt.y2);
        ctx.strokeRect(rx, ry, Math.abs(pt.x2 - pt.x1), Math.abs(pt.y2 - pt.y1));
        const ga = ctx.globalAlpha;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(rx, ry, Math.abs(pt.x2 - pt.x1), Math.abs(pt.y2 - pt.y1));
        ctx.globalAlpha = ga;
        return true;
      }
      if (d.tool === 'fib') {
        const right = Math.max(pt.x1, pt.x2);
        ctx.font = '10px ' + fontMono;
        fibLevels(d.p1, d.p2).forEach(it => {
          const y = (candle && typeof candle.priceToCoordinate === 'function') ? candle.priceToCoordinate(it.p) : null;
          if (y === null || y === undefined || !isFinite(y)) return;
          ctx.beginPath(); ctx.moveTo(pt.x1, y); ctx.lineTo(pt.x2, y); ctx.stroke();
          ctx.fillStyle = textColor;
          ctx.fillText((it.lv * 100).toFixed(1) + '% ' + fmtDrawNum(it.p), right + 4, y - 3);
          ctx.fillStyle = color;
        });
        return true;
      }
      if (d.tool === 'text') {
        ctx.fillStyle = color;
        ctx.font = '11px ' + fontMono;
        ctx.fillText(d.text, pt.x1, pt.y1 - 4);
        return true;
      }
      return false;
    }

    function drawOverlay() {
      try {
        const ctx = drawCtx();
        if (!ctx) return;
        const w = el.clientWidth, h = el.clientHeight;
        ctx.clearRect(0, 0, w, h);
        if (hidden) return;                 // 「隐藏全部画线」：清屏即返回（画线保留在存储）
        const c = themeColors();
        drawings.forEach(d => paintShape(ctx, d, c, w, h));
        if (!drawTool) {
          // 选中态：端点手柄（3px 实心圆，两点工具两个、单点一个）+ 浮动工具条贴锚摆位
          if (selIdx >= 0 && drawings[selIdx]) {
            const sc = coordsOf(drawings[selIdx]);
            if (sc) {
              ctx.fillStyle = c.accent;
              ctx.beginPath(); ctx.arc(sc.x1, sc.y1, 3, 0, Math.PI * 2); ctx.fill();
              if (sc.x2 !== null && sc.x2 !== undefined) {
                ctx.beginPath(); ctx.arc(sc.x2, sc.y2, 3, 0, Math.PI * 2); ctx.fill();
              }
              positionToolbar(sc);
            }
          }
          return;
        }
        // 画线模式的辅助预览：吸附点小圆点；两点工具第一下之后实时预览成形
        const pt = ptCoords(previewPt);
        const anchor = draft ? ptCoords({ k: draft.k1, p: draft.p1 }) : null;
        if (anchor) {
          ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 2.5, 0, Math.PI * 2); ctx.fill();
          if (pt) paintShape(ctx, {
            tool: draft.tool, k1: draft.k1, p1: draft.p1, k2: previewPt.k, p2: previewPt.p, ci: draft.ci,
          }, c, w, h);
        } else if (pt) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      } catch (e) { /* 图表已销毁/老版本 LWC：忽略，下一帧再试 */ }
    }

    // 提交：先净化再入库（闭包内 drawings 永远是收敛口径），重画并回调持久化
    function commitDrawing(nd) {
      const clean = sanitizeDrawing(nd);
      if (!clean) return;
      drawings = sanitizeDrawings(drawings.concat([clean]));
      drawOverlay();
      if (onDrawings) onDrawings(drawings);
    }

    // 文字标注：吸附成功后在锚点浮出输入框，Enter 提交、Esc/失焦取消
    function discardTextInput() {
      const inp = textInput;
      textInput = null;
      if (inp && inp.parentNode) inp.parentNode.removeChild(inp);
    }
    function openTextInput(k, p, x, y) {
      discardTextInput();
      const input = document.createElement('input');
      input.className = 'k-draw-input';
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = '文字标注';
      input.setAttribute('aria-label', '文字标注内容');
      // 锚点即输入框左下角，贴边时往回收一点防出画布
      input.style.left = Math.round(Math.min(x, Math.max(0, el.clientWidth - 170))) + 'px';
      input.style.top = Math.round(Math.min(y, Math.max(0, el.clientHeight - 30))) + 'px';
      el.appendChild(input);
      textInput = input;
      const close = (commit) => {
        if (textInput !== input) return;    // 已被 discardTextInput 收走：不再处理
        textInput = null;
        const txt = commit ? String(input.value || '').trim().slice(0, 40) : '';
        if (input.parentNode) input.parentNode.removeChild(input);
        if (commit && txt) commitDrawing({ tool: 'text', k1: k, p1: p, text: txt });
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();               // Esc/Enter 不漏给全局「退出画线模式」
        if (ev.key === 'Enter') close(true);
        else if (ev.key === 'Escape') close(false);
      });
      input.addEventListener('blur', () => close(false));
      input.focus();
    }

    /* ---- 画线交互（选中/拖拽/删除/隐藏，2026-10-31）----
       TradingView 模型：无工具时点中画线即选中（命中容差 8px、从最上层往下找），
       选中浮出工具条（六色块 + 删除），按住可拖（吸附 K 线换锚/移价），
       Esc 取消选中 / 关右键菜单，Delete 或右键菜单删除，
       「隐藏全部画线」只藏不删（存储保留，再点显示）。 */

    // 命中测试：drawings → coordsOf → 尾部（最上层）优先；axisW 与 paintShape 同款
    function hitAt(x, y) {
      const w = el.clientWidth || 0, h = el.clientHeight || 0;
      let axisW = 44;
      try {
        const ps = chart.priceScale && chart.priceScale('right');
        const pw = ps && typeof ps.width === 'function' ? ps.width() : 0;
        if (pw > 10) axisW = pw;
      } catch (e) { /* 老版本没有 width()，用默认 44 */ }
      return hitTestDrawings(drawings, drawings.map(coordsOf), x, y,
        { tol: DRAW_HIT_TOL, w: w, h: h, axisW: axisW });
    }

    /* 拖拽位移（吸附驱动）：换锚/移价 → 净化 → 回写。两道 null 守卫：
       ① snapPoint 回 null（吸附失效区）直接 return——coordinateToTime 出序列/出视野
          或价格无效都回 null（charts.js snapPoint 契约），不守卫则对 null 取 .k，
          mousemove 每帧 TypeError；
       ② moveDrawing/sanitizeDrawing 回 null（锚拖出序列边界/不在当前序列）直接
          return——不置 moved、不改 drawings、不重画。不守卫则 drawings[idx]=null
          打洞，onMouseUp 落盘时 sanitizeDrawings 把该条静默永久删除（localStorage
          里这条画线消失）。 */
    function applyDrag(x, y) {
      if (!dragCtx || dragCtx.idx < 0 || !drawings[dragCtx.idx]) { dragCtx = null; return; }
      const cur = snapPoint(x, y);
      if (!cur) return;                                   // 守卫①：吸附失效区
      const gi = dragCtx.keys.indexOf(dragCtx.grab.k);
      const ci2 = dragCtx.keys.indexOf(cur.k);
      if (gi < 0 || ci2 < 0) {                            // 序列换了（setData 竞态）：弃拖
        dragCtx = null;
        try { el.style.cursor = ''; } catch (e) { /* ignore */ }
        return;
      }
      const moved = moveDrawing(drawings[dragCtx.idx], ci2 - gi, cur.p - dragCtx.grab.p, dragCtx.keys);
      const clean = sanitizeDrawing(moved);
      if (!clean) return;                                 // 守卫②：越界/锚不在序列
      if (JSON.stringify(clean) === JSON.stringify(drawings[dragCtx.idx])) return;   // 没动不写
      drawings[dragCtx.idx] = clean;
      dragCtx.moved = true;
      drawOverlay();
    }

    // 浮动工具条摆位：贴选中画线第一锚点上方，clampBox 钳在画布内（只改 left/top）
    function positionToolbar(c0) {
      if (!toolbarEl) return;
      const bw = toolbarEl.offsetWidth || 110, bh = toolbarEl.offsetHeight || 26;
      const pos = clampBox(c0.x1 - bw / 2, c0.y1 - bh - 8, bw, bh,
        el.clientWidth || 0, el.clientHeight || 0);
      toolbarEl.style.left = Math.round(pos.x) + 'px';
      toolbarEl.style.top = Math.round(pos.y) + 'px';
    }

    // 删除选中画线：splice 后整体净化重画并落盘（与 Delete 键/右键菜单同口径）
    function deleteSelected() {
      const i = selIdx;
      if (i < 0 || !drawings[i]) return;
      removeToolbar();
      removeCtxMenu();
      selIdx = -1;
      drawings = sanitizeDrawings(drawings.slice(0, i).concat(drawings.slice(i + 1)));
      drawOverlay();
      if (onDrawings) onDrawings(drawings);
    }

    function removeToolbar() {
      if (toolbarEl && toolbarEl.parentNode) toolbarEl.parentNode.removeChild(toolbarEl);
      toolbarEl = null;
    }
    function removeCtxMenu() {
      if (ctxMenuEl && ctxMenuEl.parentNode) ctxMenuEl.parentNode.removeChild(ctxMenuEl);
      ctxMenuEl = null;
    }
    // 取消选中：摘工具条；状态确实变化才重画（收敛入口之一）
    function closeSel() {
      removeToolbar();
      if (selIdx >= 0) { selIdx = -1; drawOverlay(); }
    }
    // 选中（收敛入口）：浮出工具条并重画（手柄 + 摆位）；idx<0 或越界 = 取消选中
    function select(idx) {
      closeCtxMenu();
      if (idx === null || idx === undefined || idx < 0 || !drawings[idx]) { closeSel(); return; }
      selIdx = idx;
      openToolbar();
      drawOverlay();
    }

    // 浮动工具条：6 个取色色块（--ma-N 令牌，当前指派 .on）+「删除」。
    // click 委托：改 ci（sanitize 同口径归一，改完立即 onDrawings 落盘——
    // 不落盘则改色刷新即丢）或删除（deleteSelected，与 Delete 键同口径）。
    function openToolbar() {
      removeToolbar();
      const d = drawings[selIdx];
      if (!d) { selIdx = -1; return; }
      const bar = document.createElement('div');
      bar.className = 'k-draw-sel';
      for (let i = 0; i < 6; i++) {
        const sw = document.createElement('i');
        sw.className = 'k-draw-swatch' + ((((d.ci || 0) % 6) + 6) % 6 === i ? ' on' : '');
        sw.setAttribute('data-ci', String(i));
        sw.style.background = 'var(--ma-' + i + ')';
        sw.title = '颜色 ' + (i + 1);
        bar.appendChild(sw);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'k-draw-del';
      del.textContent = '删除';
      del.title = '删除该画线';
      del.setAttribute('aria-label', '删除该画线');
      bar.appendChild(del);
      bar.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t || !t.closest) return;
        const sw = t.closest('[data-ci]');
        if (sw && selIdx >= 0 && drawings[selIdx]) {
          const ci = ((Math.round(+sw.getAttribute('data-ci')) % 6) + 6) % 6;
          if (drawings[selIdx].ci !== ci) {
            drawings[selIdx].ci = ci;
            drawOverlay();
            if (onDrawings) onDrawings(drawings);   // 改色立即落盘（防刷新即丢）
          }
          return;
        }
        if (t.closest('.k-draw-del')) deleteSelected();
      });
      el.appendChild(bar);
      toolbarEl = bar;
    }

    // 右键菜单：两项（删除该画线 / 隐藏全部画线），贴边钳制。
    // 「隐藏全部画线」：setHidden(true) 生效本图 + onHideAll(true) 让 app 层记忆；
    // 未传回调则仅本图临时隐藏（刷新即恢复）。
    function openCtxMenu(x, y) {
      removeCtxMenu();
      const menu = document.createElement('div');
      menu.className = 'k-draw-ctx';
      [
        { label: '删除该画线', fn: deleteSelected },
        { label: '隐藏全部画线', fn: () => { setHidden(true); if (onHideAll) onHideAll(true); } },
      ].forEach(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = it.label;
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removeCtxMenu();
          it.fn();
        });
        menu.appendChild(b);
      });
      el.appendChild(menu);
      const pos = clampBox(x, y, menu.offsetWidth || 120, menu.offsetHeight || 76,
        el.clientWidth || 0, el.clientHeight || 0);
      menu.style.left = Math.round(pos.x) + 'px';
      menu.style.top = Math.round(pos.y) + 'px';
      ctxMenuEl = menu;
    }
    function closeCtxMenu() { removeCtxMenu(); }

    // 「隐藏全部画线」开关：hidden 收敛布尔；隐藏时关选中/菜单/拖拽态并清屏重画。
    // 不回调 onHideAll（避免 app 层 applyDrawTool → setHidden 成环）——菜单项自己调。
    function setHidden(v) {
      hidden = !!v;
      closeSel();
      closeCtxMenu();
      dragCtx = null;
      hoverHit = -1;
      try { el.style.cursor = ''; } catch (e) { /* ignore */ }
      drawOverlay();
    }

    function onMouseDown(e) {
      // 浮层自身（工具条/右键菜单）的按下不进图表逻辑：closest 守卫放最前，
      // 否则会被 el 的 capture 监听拦掉、按钮 click 永远收不到
      if (e && e.target && e.target.closest && e.target.closest('.k-draw-sel,.k-draw-ctx')) return;
      if (hidden) return;                   // 整层隐藏：交互全放行（图表照常用）
      closeCtxMenu();                       // 左键任意按下先关右键菜单（不挂 document mousedown）
      if (drawTool) {                       // 画线模式：维持原画线行为
        e.stopPropagation();                // 阻断 LWC 拖拽平移与 subscribeClick 事件标记
        e.preventDefault();                 // 防 mousedown 默认夺焦（文字输入框要留在焦点）
        if (e.button !== 0 || textInput) return;
        select(-1);                         // 起笔时顺手取消选中（防残留手柄/工具条）
        const pt = snapPoint(e.offsetX, e.offsetY);
        if (!pt) return;                    // 吸附失败不提交（也不清 draft，可换点再按）
        if (isTwoPoint(drawTool)) {
          if (draft) {
            const nd = { tool: draft.tool, k1: draft.k1, p1: draft.p1, k2: pt.k, p2: pt.p, ci: draft.ci };
            draft = null;
            commitDrawing(nd);
          } else {
            draft = { tool: drawTool, k1: pt.k, p1: pt.p, ci: null };
            drawOverlay();
          }
          return;
        }
        if (drawTool === 'text') { openTextInput(pt.k, pt.p, e.offsetX, e.offsetY); return; }
        commitDrawing({ tool: drawTool, k1: pt.k, p1: pt.p, ci: null });
        return;
      }
      // 无工具：选中/拖拽分支
      if (e.button !== 0 || textInput) return;    // 右键给 contextmenu，中键放行
      const hit = hitAt(e.offsetX, e.offsetY);
      if (hit < 0) { select(-1); return; }        // 未命中：取消选中，LWC 照常平移
      e.stopPropagation();                        // 命中：拦 LWC 平移，进入选中/拖拽
      e.preventDefault();
      select(hit);
      const cur = snapPoint(e.offsetX, e.offsetY);
      if (cur) {
        dragCtx = { idx: hit, grab: cur, keys: lastKlines.map(bar => tKey(bar.time)), moved: false };
        try { el.style.cursor = 'grabbing'; } catch (err) { /* ignore */ }
      }
      // 吸附不可用（老版本 LWC / 序列空）→ 只选中不拖，诚实降级同骨架轮
    }
    function onMouseMove(e) {
      if (hidden) return;
      if (drawTool) {
        previewPt = snapPoint(e.offsetX, e.offsetY);
        drawOverlay();                      // 十字线未拦照常联动；这里只管画图辅助预览
        return;
      }
      if (dragCtx) { applyDrag(e.offsetX, e.offsetY); return; }
      // 悬停命中：hoverHit 变化才切 cursor（命中 'move'），不重画
      const hit = hitAt(e.offsetX, e.offsetY);
      if (hit !== hoverHit) {
        hoverHit = hit;
        try { el.style.cursor = hit >= 0 ? 'move' : ''; } catch (err) { /* ignore */ }
      }
    }
    function onMouseLeave() {
      if (!drawTool) return;
      previewPt = null;
      drawOverlay();
    }
    // 拖拽收尾（document 级：鼠标可在画布外松开）：moved 才落盘一次——
    // 拖拽过程零 localStorage 写，只在收尾写一次。
    function onMouseUp() {
      if (!dragCtx) return;
      const moved = dragCtx.moved;
      dragCtx = null;
      try { el.style.cursor = ''; } catch (e) { /* ignore */ }
      if (moved && onDrawings) onDrawings(drawings);
    }
    // Esc：先关右键菜单 → 再取消选中 → 最后落画线模式退出逻辑（一层一层退）；
    // Delete：无工具且有选中时删除该画线并落盘（与右键菜单同口径）
    function onKeyDown(e) {
      if (!e) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
      if (e.key === 'Escape') {
        if (!drawTool) {
          if (ctxMenuEl) { closeCtxMenu(); return; }
          if (selIdx >= 0) { select(-1); return; }
          return;
        }
        draft = null;                       // 画线模式：取消 draft 并退出（UI 收敛回 app.js）
        setDrawTool(null);
        if (onToolEnd) onToolEnd();
        return;
      }
      if (e.key === 'Delete' && !drawTool && selIdx >= 0) deleteSelected();
    }
    // 右键菜单（capture 挂 el）：命中画线 → 打开菜单；未命中放行浏览器默认菜单
    function onContextMenu(e) {
      if (e && e.target && e.target.closest && e.target.closest('.k-draw-sel,.k-draw-ctx')) return;
      if (hidden || drawTool || dragCtx) return;    // 隐藏态/画线中/拖拽中：放行
      const hit = hitAt(e.offsetX, e.offsetY);
      if (hit < 0) return;
      e.preventDefault();
      e.stopPropagation();
      select(hit);
      openCtxMenu(e.offsetX, e.offsetY);
    }
    // capture 挂在 el 上：先于 LWC 内部元素的监听，激活时 stopPropagation 才拦得住
    try { el.addEventListener('mousedown', onMouseDown, true); } catch (e) { /* ignore */ }
    try { el.addEventListener('mousemove', onMouseMove, true); } catch (e) { /* ignore */ }
    try { el.addEventListener('mouseleave', onMouseLeave, true); } catch (e) { /* ignore */ }
    try { el.addEventListener('contextmenu', onContextMenu, true); } catch (e) { /* ignore */ }
    try { document.addEventListener('keydown', onKeyDown); } catch (e) { /* ignore */ }
    try { document.addEventListener('mouseup', onMouseUp); } catch (e) { /* ignore */ }

    // 切换画线模式：白名单外一律置 null；切换清 draft、取消选中、关右键菜单、
    // 复位内联 cursor（防拖拽残留的 grabbing/move 内联样式压掉 .k-drawing 十字光标）、
    // el 挂 k-drawing（十字光标）
    function setDrawTool(tool) {
      drawTool = (tool && DRAW_TOOLS.indexOf(tool) >= 0) ? tool : null;
      draft = null;
      discardTextInput();
      if (!drawTool) previewPt = null;
      select(-1);
      closeCtxMenu();
      try { el.style.cursor = ''; } catch (e) { /* ignore */ }
      try { el.classList.toggle('k-drawing', !!drawTool); } catch (e) { /* ignore */ }
      drawOverlay();
    }

    // 回灌（切标的/切周期）：整体替换并重画。跨周期锚点解析不出的条目自动不画、保留在存储；
    // 回灌时清选中/关浮层/弃拖（旧下标对新表已无意义）
    function setDrawings(list) {
      drawings = sanitizeDrawings(list);
      timeByKey = null;
      closeSel();
      closeCtxMenu();
      dragCtx = null;
      hoverHit = -1;
      drawOverlay();
    }

    function setData(klines) {
      // 盘后/清算时段腾讯日K会混入 OHLC 为 null 的脏bar（lightweight-charts 内部直接炸），
      // 整根剔除：蜡烛/成交量/均线/事件标记共用同一份干净序列
      lastKlines = (klines || []).filter(k => k && k.time !== null && k.time !== undefined &&
        [k.open, k.high, k.low, k.close].every(v => v !== null && v !== undefined && isFinite(v)));
      timeByKey = null;               // 序列换了：tKey → time 反查表失效（画线侧重建）
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
      // 槽位样式（取色/线宽）跟 active 一起算：syncSeriesPool 建槽与补色、
      // 图例读数的取色都从这里走
      slotStyle = slotStyles(active, themeColors().lineColors.length);
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
        // ci/w 是用户在指标面板选的颜色下标/线宽，必须带过去：
        // 之前这里只留 {type,n,on}，localStorage 里存的 ci/w 会在下一次
        // setMAVisible 时被剥掉（菜单上有、图上不生效、刷新后丢失）
        const lines = v.filter(l => l && typeof l === 'object').slice(0, MAX_OVERLAYS).map(l => {
          const ciRaw = (l.ci === undefined || l.ci === null || l.ci === '') ? NaN : Math.round(+l.ci);
          const wRaw = Math.round(+l.w);
          return {
            type: l.type === 'ema' ? 'ema' : l.type === 'boll' ? 'boll' : 'ma',
            n: Math.max(2, Math.min(500, Math.round(+l.n || 5))),
            on: !!l.on,
            ci: Number.isFinite(ciRaw) ? ciRaw : null,   // 合法性由 slotStyles 画图侧再归一
            w: (wRaw === 2 || wRaw === 3) ? wRaw : 1,
          };
        });
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
      drawOverlay();                  // 布局宽度变了：overlay 位图同步重设再画
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
      chart, candle, setData, applyTheme, setMAVisible, setEvents, setPane, setInfo,
      // 画线：setDrawings 回灌（按标的）、setDrawTool 切换画线模式、
      // setHidden 「隐藏全部画线」开关（app 层持久化后经 applyDrawTool 回放）
      setDrawings, setDrawTool, setHidden,
      // getKlines：setData 过滤脏 bar 后的干净序列——app 层 rebase 用它与画布完全同源
      getKlines: () => lastKlines,
      // 标尺（普通/对数/百分比）与对比叠加（compare overlay）
      setScale, setCompare,
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
        // 画线层一起摘：overlay canvas / 文字输入框 / document keydown+mouseup /
        // el 上四个 capture 监听（mousedown/mousemove/mouseleave/contextmenu）
        // ——只摘真实挂上的这些，不新增也不多摘（切标的会反复 createKline，
        // 漏摘就堆出一串 Esc/右键回调与幽灵画布）
        try { el.removeEventListener('mousedown', onMouseDown, true); } catch { /* ignore */ }
        try { el.removeEventListener('mousemove', onMouseMove, true); } catch { /* ignore */ }
        try { el.removeEventListener('mouseleave', onMouseLeave, true); } catch { /* ignore */ }
        try { el.removeEventListener('contextmenu', onContextMenu, true); } catch { /* ignore */ }
        try { document.removeEventListener('keydown', onKeyDown); } catch { /* ignore */ }
        try { document.removeEventListener('mouseup', onMouseUp); } catch { /* ignore */ }
        removeToolbar();
        removeCtxMenu();
        discardTextInput();
        try { if (drawCanvas && drawCanvas.parentNode) drawCanvas.parentNode.removeChild(drawCanvas); }
        catch { /* ignore */ }
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

    // 角落常显徽标（同 K 线图）：详情页 setInfo 喂入，显示「代码 · 分时」
    let symInfo = null;
    const symHTML = () => {
      const b = legendBadge(symInfo);
      return b ? '<span class="kl-sym">' + escHtml(b) + '</span>' : '';
    };

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
      // 徽标在前、读数在后；无数据时只剩徽标（与 K 线图例同一「常显」语义）
      legend.innerHTML = symHTML() + (points.length
        ? legendHTML(idx === null || idx === undefined ? points.length - 1 : idx)
        : '');
    }

    // 标的信息 {code, period}：非对象置空并重画（同 createKline.setInfo）
    function setInfo(info) {
      symInfo = (info && typeof info === 'object') ? info : null;
      paintLegend();
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
      chart, setData, applyTheme: paint, setInfo,
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

  /* ---- 纯函数（离线单测钉口径：_test/charts.test.mjs）---- */

  // 徽标小文本里的 HTML 转义：code/period 来自外部喂入，拼 innerHTML 前先关掉标签
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* 图表角落常显徽标「代码 · 周期」：两段各自 trim 后用 ' · ' 连接，
     任一为空只显示另一段，全空返回 ''。无 DOM 无网络。 */
  function legendBadge(info) {
    const o = (info && typeof info === 'object') ? info : {};
    const kept = [o.code, o.period]
      .map(v => (v === null || v === undefined) ? '' : String(v).trim())
      .filter(Boolean);
    return kept.length ? kept.join(' · ') : '';
  }

  /* 主图指标的槽位样式：输入**展开前**的配置数组 + 调色板长度，
     输出与展开后槽位一一对应的 [{ci, w}]（ci=取 --ma-N 令牌的下标，w=线宽）。
     · ci 用数值强转（容忍 DOM 来的字符串）：非法/缺失 → null（画图时回退槽位序号，
       与改造前行为一致）；合法值归一到 ((round(ci)%n)+n)%n；
     · 线宽仅 1/2/3 合法，其余一律 1；
     · BOLL 占 3 轨（沿用 slotsOf 语义）：三轨从 ci 起顺延取色（ci, ci+1, ci+2 循环），
       保持「一条配置的多轨取色连续」。 */
  function slotStyles(lines, paletteN) {
    const n = Math.max(1, Math.round(+paletteN) || 6);
    const out = [];
    (Array.isArray(lines) ? lines : []).forEach((l) => {
      if (!l || typeof l !== 'object') return;
      const rails = l.type === 'boll' ? 3 : 1;
      const ciRaw = (l.ci === undefined || l.ci === null || l.ci === '') ? NaN : Math.round(+l.ci);
      const ci = Number.isFinite(ciRaw) ? ((ciRaw % n) + n) % n : null;
      const wRaw = Math.round(+l.w);
      const w = (wRaw === 2 || wRaw === 3) ? wRaw : 1;
      for (let k = 0; k < rails; k++) {
        out.push({ ci: ci === null ? null : (ci + k) % n, w });
      }
    });
    return out;
  }

  /* ---- 价格标尺档位归一（离线单测钉口径）：只认 'log'/'pct' 两个字面量，
     其余（数字/undefined/null/'LOG' 大写/空串/中文）一律收敛 'normal'，
     localStorage 读回的脏值进不了图表侧。 */
  function sanitizeScale(v) {
    return v === 'log' || v === 'pct' ? v : 'normal';
  }

  /* ---- 双标的归一化叠加（compare overlay）核心口径（离线单测钉口径）----
     对比标的收盘序列重定基到主图价格单位，与蜡烛共用右价格轴（对数模式值恒正）。
     输入两组 [{time, close}]（主图传 getKlines 的干净序列）；时间键归一（字符串日期
     与伪 UTC 秒统一串键）建主图 close 反查 Map；**交集口径**只保留主图也有的时间
     （防对比序列把 LWC 时间轴撑出幽灵 bar），以首个共同时间定基 factor = 主/对比基准
     close；points 的 time 用主图原始 time（时间轴零变化）、value=+(cmpClose×factor).toFixed(4)；
     脏输入（非数组/交集空/基准 close 非有限或 ≤0）→ points:[]，中段非正 close 跳点。 */
  function rebaseCompare(mainKlines, cmpKlines) {
    const empty = { points: [], factor: null, base: null };
    if (!Array.isArray(mainKlines) || !Array.isArray(cmpKlines)) return empty;
    // tKey 同款归一（createCompare L1496 先例）：字符串原样、业务日对象拼串、数字转串
    const keyOf = (t) => typeof t === 'string' ? t
      : (t && typeof t === 'object' && t.year) ? t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0')
      : String(t);
    const mainMap = new Map();
    for (let i = 0; i < mainKlines.length; i++) {
      const k = mainKlines[i];
      if (!k || k.time === null || k.time === undefined) continue;
      const c = +k.close;
      if (!isFinite(c)) continue;
      mainMap.set(keyOf(k.time), { time: k.time, close: c });
    }
    if (!mainMap.size) return empty;
    const points = [];
    let factor = null;
    let base = null;
    for (let i = 0; i < cmpKlines.length; i++) {
      const k = cmpKlines[i];
      if (!k || k.time === null || k.time === undefined) continue;
      const hit = mainMap.get(keyOf(k.time));
      if (!hit) continue;                        // 交集口径：主图没有该时间不入 points
      const c = +k.close;
      if (!isFinite(c) || c <= 0) continue;      // 中段非正 close：跳过该点
      if (factor === null) {
        if (!isFinite(hit.close) || hit.close <= 0) return empty;   // 基准 ≤0 无从定基
        factor = hit.close / c;
        base = hit.close;
      }
      points.push({ time: hit.time, value: +(c * factor).toFixed(4) });
    }
    if (factor === null) return empty;
    return { points, factor, base };
  }

  /* ---- 画线工具纯函数（离线单测钉口径：_test/charts.test.mjs）----
     画线对象（存储口径）：{ tool, k1, p1[, k2, p2][, text], ci }
     · tool ∈ DRAW_TOOLS 六件；trend/rect/fib 是两点工具（必须另有合法 k2/p2），
       hline/vline/text 是单点工具（k2/p2 一律忽略不收）；
     · k1/k2 是 tKey 的两种产物：日K "YYYY-MM-DD"、分钟K 伪 UTC 秒——存储统一存
       字符串（纯数字串合法），画图侧按当前序列反查原始 time；数字类型的秒存进来
       一律拒收（tKey 产物恒为字符串，收到数字说明数据没走过归一）；
     · 价格经 + 强转必须有限（DOM/localStorage 来的字符串容忍，NaN/Infinity 拒收）；
     · text 仅 text 工具有：trim 后非空、截断 40 字符；
     · ci 与 slotStyles 同口径：数值强转 → 归一 0..5，非法（含缺失）→ null
       （画图侧 ci||0 回退主色）。 */
  const DRAW_TOOLS = ['trend', 'hline', 'vline', 'rect', 'fib', 'text'];
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const DRAW_MAX = 200;          // 单标的画线上限：防 localStorage 与重画失控
  const DRAW_KEY_MAX = 24;       // 存储键（标的 symbol）长度上限
  const DRAW_TEXT_MAX = 40;      // 文字标注长度上限
  const isDrawTwoPoint = (tool) => tool === 'trend' || tool === 'rect' || tool === 'fib';

  // 时间锚：必须是「YYYY-MM-DD」或纯数字秒串（tKey 两种产物），数字类型一律拒收
  function sanitizeDrawK(k) {
    if (typeof k !== 'string') return null;
    return (/^\d{4}-\d{2}-\d{2}$/.test(k) || /^\d+$/.test(k)) ? k : null;
  }

  // 价格锚：+ 强转后必须有限（null/undefined/空串/NaN/Infinity 拒收，'1.5' 收敛为 1.5）
  function sanitizeDrawP(p) {
    if (p === null || p === undefined || p === '') return null;
    const v = +p;
    return isFinite(v) ? v : null;
  }

  function sanitizeDrawing(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (DRAW_TOOLS.indexOf(d.tool) < 0) return null;
    const k1 = sanitizeDrawK(d.k1);
    const p1 = sanitizeDrawP(d.p1);
    if (!k1 || p1 === null) return null;
    const out = { tool: d.tool, k1: k1, p1: p1 };
    if (isDrawTwoPoint(d.tool)) {
      const k2 = sanitizeDrawK(d.k2);
      const p2 = sanitizeDrawP(d.p2);
      if (!k2 || p2 === null) return null;
      out.k2 = k2;
      out.p2 = p2;
    }
    if (d.tool === 'text') {
      const txt = String(d.text === null || d.text === undefined ? '' : d.text).trim().slice(0, DRAW_TEXT_MAX);
      if (!txt) return null;
      out.text = txt;
    }
    const ciRaw = (d.ci === undefined || d.ci === null || d.ci === '') ? NaN : Math.round(+d.ci);
    out.ci = Number.isFinite(ciRaw) ? ((ciRaw % 6) + 6) % 6 : null;
    return out;
  }

  function sanitizeDrawings(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (let i = 0; i < raw.length && out.length < DRAW_MAX; i++) {
      const clean = sanitizeDrawing(raw[i]);
      if (clean) out.push(clean);
    }
    return out;
  }

  /* 画线存储表：{ [symbol]: drawing[] }。键（标的 symbol）须 trim 后非空且
     ≤24 字符；真符号必带市场前缀/字母（sh600519 / usAAPL / BTCUSDT / EM:…），
     纯数字键只可能是旧数据误存的下标，一并剔除。 */
  function sanitizeDrawStore(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((key) => {
      const k = String(key).trim();
      if (!k || k.length > DRAW_KEY_MAX || /^\d+$/.test(k)) return;
      const list = sanitizeDrawings(raw[key]);
      if (list.length) out[k] = list;
    });
    return out;
  }

  // 斐波那契回撤档位：p1→p2 之间的 7 档价位，纯算术、方向无关（反向锚点同表）
  function fibLevels(p1, p2) {
    const a = +p1, b = +p2;
    return FIB_LEVELS.map(lv => ({ lv: lv, p: a + (b - a) * lv }));
  }

  /* ---- 画线交互纯函数（离线单测钉口径：_test/charts.test.mjs）----
     命中/移动/钳制三族，全部无 DOM 无网络：
     · hitDrawing(d, c, x, y, o)：c = coordsOf 产物 {x1,y1,x2,y2,fibYs?}，
       o = {tol, w, h, axisW}（tol 缺省 DRAW_HIT_TOL）；d 或 c 为 null 一律不命中；
     · hitTestDrawings(list, coordsList, x, y, o)：从数组尾部（最上层）往回扫，
       返回首个命中下标或 -1；coords 为 null（锚点不在当前序列/不可见）的条目跳过；
     · moveDrawing(d, idxDelta, pDelta, keys)：keys = tKey 序列字符串数组，
       换锚/移价后返回新对象（Object.assign 不用 spread，老 WebView 安全），
       越界或锚不在 keys 返回 null——调用方丢弃本次位移，不得写回 drawings；
     · clampBox(x, y, w, h, bw, bh)：浮层贴边钳制，区域小于框时归 0。 */
  const DRAW_HIT_TOL = 8;       // 命中容差 px（TradingView 同量级：太小点不中、太大误命中）

  // 点到线段的最短距离：投影参数 t 钳到 [0,1] 后取欧氏距离（钳端点即两点距离）
  function segDist(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  }

  // 文字标注的命中框估算：11px mono 字宽按字符分档——charCode > 0xFF（CJK 全角）
  // 记 11px/字，否则 6.6px/字；锚点是 fillText 的基线（文字主体在基线上方），
  // 框取 [x-2, y-16, w+6, 20]。不用 measureText：离线测试/未挂 canvas 时也保持确定性。
  function drawTextBox(text, x, y) {
    const s = String(text === null || text === undefined ? '' : text);
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0xFF ? 11 : 6.6;
    return { x: x - 2, y: y - 16, w: w + 6, h: 20 };
  }

  // 单条画线命中判定：
  // · trend 点到线段距离 ≤ tol；hline |y-y1| ≤ tol 且 x ≤ w-axisW+tol（横线止于价格轴左缘）；
  // · vline |x-x1| ≤ tol（纵向全高，y 任意）；
  // · rect 外接域（min/max ± tol）内即命中——含内部，与 TradingView 一致；
  // · fib x 在两端点 min/max ± tol 内且 y 与 fibYs 某一档 |dy| ≤ tol（null 档跳过）；
  // · text 落在 drawTextBox 档内。
  function hitDrawing(d, c, x, y, o) {
    if (!d || !c || typeof d.tool !== 'string') return false;
    const tol = (o && o.tol) || DRAW_HIT_TOL;
    if (d.tool === 'trend') return segDist(x, y, c.x1, c.y1, c.x2, c.y2) <= tol;
    if (d.tool === 'hline') {
      const axisW = (o && o.axisW) || 0;
      return Math.abs(y - c.y1) <= tol && x <= ((o && o.w) || 0) - axisW + tol;
    }
    if (d.tool === 'vline') return Math.abs(x - c.x1) <= tol;
    if (d.tool === 'rect') {
      return x >= Math.min(c.x1, c.x2) - tol && x <= Math.max(c.x1, c.x2) + tol &&
        y >= Math.min(c.y1, c.y2) - tol && y <= Math.max(c.y1, c.y2) + tol;
    }
    if (d.tool === 'fib') {
      if (x < Math.min(c.x1, c.x2) - tol || x > Math.max(c.x1, c.x2) + tol) return false;
      const ys = Array.isArray(c.fibYs) ? c.fibYs : [];
      return ys.some(v => v !== null && v !== undefined && isFinite(v) && Math.abs(y - v) <= tol);
    }
    if (d.tool === 'text') {
      const b = drawTextBox(d.text, c.x1, c.y1);
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    }
    return false;
  }

  // 整表命中：尾部（最上层）优先返回首个命中的下标；空表/脏输入一律 -1
  function hitTestDrawings(list, coordsList, x, y, o) {
    if (!Array.isArray(list) || !Array.isArray(coordsList)) return -1;
    const n = Math.min(list.length, coordsList.length);
    for (let i = n - 1; i >= 0; i--) {
      if (hitDrawing(list[i], coordsList[i], x, y, o)) return i;
    }
    return -1;
  }

  // 拖拽位移：hline 只动 p1（横线纵向拖）、vline 只动 k1（竖线横向拖）；
  // text 与两点工具 k1/k2 全按同一序号差位移、p1/p2 加同一价格差。
  // 新锚不在 keys 或越界 → null（调用方丢弃，不得写回 drawings）。
  function moveDrawing(d, idxDelta, pDelta, keys) {
    if (!d || typeof d.tool !== 'string' || !Array.isArray(keys) || !keys.length) return null;
    const dp = +pDelta;
    if (!isFinite(dp)) return null;
    if (d.tool === 'hline') {
      const p1 = d.p1 + dp;
      return isFinite(p1) ? Object.assign({}, d, { p1: p1 }) : null;
    }
    const shiftK = (k) => {
      const i = keys.indexOf(k);
      if (i < 0) return null;
      const j = i + idxDelta;
      return (j >= 0 && j < keys.length) ? keys[j] : null;
    };
    if (d.tool === 'vline') {
      const k1 = shiftK(d.k1);
      return k1 ? Object.assign({}, d, { k1: k1 }) : null;
    }
    // text 与两点工具：k1/k2 全位移 + 价格全位移
    const k1 = shiftK(d.k1);
    if (!k1) return null;
    const out = Object.assign({}, d, { k1: k1, p1: d.p1 + dp });
    if (d.k2 !== undefined && d.k2 !== null) {
      const k2 = shiftK(d.k2);
      if (!k2) return null;
      out.k2 = k2;
      out.p2 = d.p2 + dp;
    }
    return out;
  }

  // 浮层贴边钳制：把 (x,y) 处 w×h 的框收进 bw×bh 的区域；区域小于框时归 0
  function clampBox(x, y, w, h, bw, bh) {
    return {
      x: Math.max(0, Math.min(x, Math.max(0, (bw || 0) - (w || 0)))),
      y: Math.max(0, Math.min(y, Math.max(0, (bh || 0) - (h || 0)))),
    };
  }

  return { createKline, createTrend, createCompare, calcMA, emaSeries, themeColors, retheme, legendBadge, slotStyles,
    sanitizeScale, rebaseCompare,
    DRAW_TOOLS, sanitizeDrawing, sanitizeDrawings, sanitizeDrawStore, fibLevels,
    DRAW_HIT_TOL, segDist, drawTextBox, hitDrawing, hitTestDrawings, moveDrawing, clampBox };
})();

window.Charts = Charts;
