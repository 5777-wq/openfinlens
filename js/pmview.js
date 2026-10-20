/* pmview.js —— 市场预测面板的视图层（纯渲染：事件数组 + 历史网格 → HTML 字符串）
 *
 * 为什么单独成文件（与 js/polymarket.js 模型层、js/pmcharts.js 几何层配套）：
 *   这一层只做"数据 → HTML"的确定性映射，没有网络、没有 DOM 取数，可以离线单测
 *   直接断言结构（有没有环图、走势跟的是不是选中的档位、"其他 N 项"在不在），
 *   不用起浏览器、不依赖行情接口通不通。
 *
 * 两条硬约束（渲染层最容易犯的错，这里钉死）：
 *   · 环图只给互斥事件（Polymarket negRisk）——独立问句型事件画成饼图等于暗示了
 *     不存在的互斥关系，是范畴错误；
 *   · 图例数字永远是市场真实报价。环图的扇区角度是"按显示总质量归一化后的占比形状"，
 *     两者分开，报价合计偏离 100% 时另起一行说明，绝不让读者把占比当成报价。
 */

const PMView = (() => {

  /* 转义/日期/数值一律优先用 js/utils.js 的公共实现（U.escapeHTML / U.fmtDay / U.fmtVol），
     避免同一套逻辑写三遍、改一处漏一处。
     这里的兜底实现只在单测沙箱（没加载 utils.js）里会走到；它同样转义单引号——
     早前 pmview/pmcharts 各自的 esc 漏了 `'`，属性里会漏出去。 */
  const esc = (s) => (window.U && window.U.escapeHTML ? window.U.escapeHTML(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  const pmDay = (ms) => {
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  /* 完整日期（截止日要看到年份——可能是明年） */
  const fullDay = (ms) => (window.U && window.U.fmtDay ? window.U.fmtDay(ms) : (() => {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  })());

  /* 金额紧凑写法（万/亿） */
  const vol = (n) => (window.U && window.U.fmtVol ? window.U.fmtVol(n) : (() => {
    if (n === null || n === undefined || isNaN(n)) return '--';
    return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿'
      : n >= 1e4 ? (n / 1e4).toFixed(0) + '万'
        : String(Math.round(n));
  })());

  /* 类别分布总览：事件计数的环图。
     这块永远是有效饼图——数的是事件个数（计数），不是概率，
     不存在"加起来不等于 100%"的问题。 */
  function overviewHTML(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const C = window.PMCharts;
    const META = window.Polymarket.CAT_META;
    const counts = {};
    list.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    let acc = 0;
    const slices = Object.keys(counts).map(cat => {
      const share = counts[cat] / total;
      const a0 = acc; acc += share;
      return {
        key: cat, label: (META[cat] || {}).label || cat, value: counts[cat],
        color: (META[cat] || {}).color || C.PALETTE[0], rest: false, share, a0, a1: acc,
      };
    });
    const partN = list.filter(e => e.partition).length;
    return `<div class="pm-ov">${C.donutSVG(slices, {
      size: 92, thickness: 14, centerTop: '事件', centerMain: String(total), centerSub: '个',
    })}</div>`
      + `<div class="pm-ov-side">`
      + `<div class="pm-ov-leg">${slices.map(s =>
        `<span class="pm-ov-it"><i class="pm-dot" style="background:${s.color}"></i>${esc(s.label)}<b class="num">${s.value}</b></span>`
      ).join('')}</div>`
      + `<div class="pm-ov-note">${partN} 个互斥事件可看档位分布环图 · ${total - partN} 个独立问句事件只给概率条`
      + `<br>环图按各档位报价占比绘制，图例数字为市场真实报价</div>`
      + `</div>`;
  }

  /* 单个事件卡：环图（仅互斥事件）+ 档位列表 + 概率走势。
     ctx: { history, sel } —— history 是历史网格，sel 是 {事件id: 档位id} 的选择记忆。 */
  function cardHTML(e, meta, ctx) {
    const C = window.PMCharts;
    const o = ctx || {};
    const outs = e.outcomes || [];
    const selMap = o.sel || {};
    const selId = (selMap[e.id] && outs.some(x => x.id === selMap[e.id]))
      ? selMap[e.id] : (outs[0] && outs[0].id);
    const sel = outs.find(x => x.id === selId) || outs[0];

    /* 环图：只有互斥事件才画 */
    let viz = '';
    if (e.partition && outs.length >= 2) {
      const slices = C.donutSlices(outs, e.rest, '其他');
      const top = slices[0];
      const quoted = slices.reduce((s, x) => s + x.value, 0);
      const drift = Math.abs(quoted - 1) > 0.02;
      viz = `<div class="pm-viz">${C.donutSVG(slices, {
        size: 112, thickness: 16,
        centerTop: '最高档位',
        centerMain: top ? (top.value * 100).toFixed(1) + '%' : '',
        centerSub: top ? String(top.label).slice(0, 10) : '',
      })}`
        + (drift ? `<div class="pm-viz-sum num" title="各档位是独立盘口报价，合计可能偏离 100%；环图按占比绘制，数字为真实报价">报价合计 ${(quoted * 100).toFixed(1)}%</div>` : '')
        + `</div>`;
    }

    const rows = outs.map((x, i) => {
      const on = x.id === selId;
      const pct = x.probability * 100;
      const chg = x.change24h;
      const chgTxt = (chg === null || chg === undefined || isNaN(chg) || !chg) ? ''
        : `<span class="pm-chg num ${chg > 0 ? 'up' : 'down'}" title="24 小时概率变化（百分点）">${chg > 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(1)}</span>`;
      // 档位色：环图扇区、圆点、概率条、走势线都用它（互斥事件里一一对应扇区；
      // 独立问句事件没有环图，但同一个色系让"点—条—线"仍然成组）
      const color = C.PALETTE[i % C.PALETTE.length];
      const tip = esc(x.q || x.label) + '｜隐含概率 ' + pct.toFixed(1) + '%'
        + (chg ? '｜24h ' + (chg > 0 ? '+' : '') + chg.toFixed(1) + ' 个百分点' : '');
      return `<button type="button" class="pm-out${on ? ' on' : ''}" data-pmout="${esc(x.id)}" data-pmev="${esc(e.id)}" title="${tip}">
        <i class="pm-dot" style="background:${color}"></i>
        <span class="pm-out-l">${esc(x.labelZh || x.label)}</span>
        <span class="pm-out-bar" style="--pm-bar-c:${color}"><i style="width:${Math.max(1, Math.min(100, pct))}%"></i></span>
        <span class="pm-out-p num">${pct.toFixed(pct >= 10 ? 0 : 1)}%</span>
        ${chgTxt}
      </button>`;
    }).join('');

    let restRow = '';
    if (e.rest && e.rest.count > 0) {
      const rp = e.rest.probability * 100;
      restRow = `<div class="pm-out pm-out-rest" title="未展开的 ${e.rest.count} 个档位${e.partition
        ? '，概率合计 ' + rp.toFixed(1) + '%' : '（各问句互相独立，概率不可相加）'}">
        <i class="pm-dot" style="background:${C.REST_COLOR}"></i>
        <span class="pm-out-l">其他 ${e.rest.count} 项</span>
        ${e.partition
          ? `<span class="pm-out-bar" style="--pm-bar-c:${C.REST_COLOR}"><i style="width:${Math.max(1, Math.min(100, rp))}%"></i></span><span class="pm-out-p num">${rp.toFixed(1)}%</span>`
          : '<span class="pm-out-p pm-out-na">不可相加</span>'}
      </div>`;
    }

    const series = sel ? window.Polymarket.seriesFromGrid(o.history, sel.id) : [];
    // 走势线用"当前选中档位"的颜色——这条线就是这一档
    const selIdx = sel ? Math.max(0, outs.indexOf(sel)) : 0;
    const selColor = C.PALETTE[selIdx % C.PALETTE.length];
    let trendBody, trendMeta = '';
    if (series.length >= 2) {
      const bin = (o.history && o.history.binMs) || 14400000;
      trendBody = window.PMCharts.trendSVG(series, { w: 340, h: 54, maxGapMs: bin * 2.5 });
      let lo = Infinity, hi = -Infinity;
      series.forEach(s => { if (s.p < lo) lo = s.p; if (s.p > hi) hi = s.p; });
      trendMeta = `<span class="pm-trend-r num">${(lo * 100).toFixed(1)}% ~ ${(hi * 100).toFixed(1)}%</span>`
        + `<span class="pm-trend-d num">${pmDay(series[0].t)} → ${pmDay(series[series.length - 1].t)}</span>`;
    } else {
      trendBody = '<div class="pm-trend-empty">概率走势：历史序列积累中（采集端回填近 7 天窗口）</div>';
    }

    const badge = e.partition
      ? '<span class="pm-badge" title="各档位互斥且穷尽，概率可加总——环图成立">互斥档位</span>'
      : '<span class="pm-badge pm-badge-ind" title="各档位是彼此独立的问句（如 持续到10月22吗 / 24吗），概率不可加总——只给概率条">独立问句</span>';

    /* 模板题（标题带省略号）的展示：标题只到词干，缺的那截由档位名补全
       ——"美伊停火一直持续到" + 档位"10月22日" 读起来才是一句完整问话。 */
    const templated = /\.\.\.|…/.test(e.title || '');
    const head = templated ? (e.stemZh || e.stem || e.title) : (e.titleZh || e.title);

    return `<article class="pm-card" style="--cat-c:${(meta && meta.color) || 'var(--border-hover)'}">
      <header class="pm-card-hd">
        <div class="pm-card-t" title="${esc(e.title)}">${esc(head)}</div>
        <div class="pm-card-meta">
          ${badge}
          <span class="num">24h 成交 $${vol(e.volume24hr)}</span>
          <span class="num">流动性 $${vol(e.liquidity)}</span>
          <span class="num">${e.endDate ? '截止 ' + fullDay(e.endDate) : '长期有效'}</span>
        </div>
      </header>
      <div class="pm-card-bd">
        ${viz}
        <div class="pm-outs">${rows}${restRow}</div>
      </div>
      <div class="pm-trend" style="--pm-trend-c:${selColor}">
        <div class="pm-trend-hd">
          <span class="pm-trend-t">概率走势</span>
          <span class="pm-trend-cur">${esc(sel ? (sel.labelZh || sel.label) : '')}</span>
          ${trendMeta}
        </div>
        <div class="pm-trend-wrap">${trendBody}</div>
      </div>
    </article>`;
  }

  /* 分类分区（每类一栏 + 折叠） */
  function sectionsHTML(groups, ctx) {
    const o = ctx || {};
    const FOLD_N = 6;
    const expand = o.expand || {};
    return (Array.isArray(groups) ? groups : []).map(g => {
      const meta = g.meta || {};
      const items = g.items || [];
      const isOpen = !!expand[g.cat];
      const shown = isOpen ? items : items.slice(0, FOLD_N);
      const fold = items.length > FOLD_N
        ? `<button class="pill pm-fold" data-pmexpand="${g.cat}">${isOpen ? '收起' : '展开其余 ' + (items.length - FOLD_N) + ' 个事件'}</button>`
        : '';
      return `<div class="pm-sec">
        <div class="pm-sec-head" style="--cat-c:${meta.color || 'var(--border-hover)'}">
          <i class="ev-dot" style="background:${meta.color || 'inherit'}"></i>
          <span class="pm-sec-t">${esc(meta.label || g.cat)}</span>
          <span class="pm-sec-en">${esc(meta.en || '')}</span>
          <b class="num pm-sec-n">${items.length}</b>
        </div>
        <div class="pm-cards">${shown.map(e => cardHTML(e, meta, o)).join('')}</div>
        ${fold}
      </div>`;
    }).join('');
  }

  return { esc, pmDay, fullDay, vol, overviewHTML, cardHTML, sectionsHTML };
})();

if (typeof window !== 'undefined') window.PMView = PMView;
if (typeof module !== 'undefined' && module.exports) module.exports = PMView;
