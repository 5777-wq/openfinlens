/* components/era-timeline.js —— 时代横轴（首页签名元素）
   这个站的本质是「时间 × 资产 × 事件」，所以首页的主导航是一条时间轴，
   而不是一排栏目按钮。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  /** 时代节点定义：分两带——近代与更早，各自有独立刻度 */
  const DEFAULT_BANDS = [
    {
      label: '近代', range: '2000 – 2026', eras: [
        { year: '2000', label: '互联网泡沫', stat: '纳指 -78%', href: '#/cycles/2000-dotcom',
          tip: '叙事先于盈利，估值先行崩塌。跌掉约78%，将近十五年后才收复泡沫顶点。' },
        { year: '2008', label: '次贷危机', stat: '标普 -57%', href: '#/crisis/2008',
          tip: '房价、CDS、银行股、美股、美债——危机沿着资产负债表一路传导。' },
        // 2013 还没有专文：不能指向不存在的文章（点了只会「没找到这篇文章」）。
        // 它是「长端利率被重新定价」的故事，直接去收益率曲线实验室更贴题。
        { year: '2013', label: '缩减恐慌', stat: '标普 -6%', href: '#/curve?market=us&ym=2013-06',
          tip: '央行怎么说话，市场就能怎么抖。去曲线实验室拖到 2013 看长端怎么被重新定价。' },
        { year: '2020', label: '疫情熔断', stat: '标普 -34%', href: '#/crisis/2020',
          tip: '10 个交易日的极速下跌，流动性危机而非基本面危机。' },
        { year: '2022', label: '暴力加息', stat: '纳指 -36%', href: '#/crisis/2022',
          tip: '40 年最狠通胀，利率从 0 拉到 5%，成长股被杀估值。' },
        // 「现在」这个节点指向本轮真正在跑的东西：算力产业链
        { year: '2026', label: 'AI 周期', stat: '进行中', href: '#/chains/ai', now: true,
          tip: '本轮由算力资本开支驱动。哪些像 2000，哪些不像——用数据来比。' },
      ],
    },
    {
      label: '更早', range: '1987 – 1998', eras: [
        { year: '1987', label: '黑色星期一', stat: '标普 -20.5%', href: '#/crisis/1987',
          tip: '一天跌掉五分之一，没有预警，也没有解释。' },
        { year: '1990', label: '日本泡沫', stat: '日经 -63%', href: '#/crisis/1990',
          tip: '跌了三年才跌完。慢刀子割肉，才是最难受的那种。' },
        { year: '1994', label: '比索危机', stat: '美债 7.9%', href: '#/crisis/1994',
          tip: '一个小国引发的美元紧缩，代价由全世界分摊。' },
        { year: '1998', label: '亚洲金融危机', stat: '恒指 -60%', href: '#/crisis/1998',
          tip: '同一年，恒指单日 -13.7%，LTCM 逼得美联储下场救火。' },
      ],
    },
  ];

  /* ------------------------------------------------------------------
     动效样式（随组件注入一次，零构建站没有 per-component css 入口）。
     规则：只动 transform / opacity；时长缓动一律引用设计令牌并带兜底值；
     全部是一次性进场或 hover/选中的即时反馈，无循环、无脉冲；
     prefers-reduced-motion 下显式关闭（layout.css 的全局关闭是兜底，
     这里声明本表面自己的意图，避免 backwards 填充被 delay 拖住）。
     ------------------------------------------------------------------ */
  const MOTION_CSS = `
/* ---- 进场（一次性，随换页重渲染触发）：节点沿轴依次显影 ---- */
.era-node {
  animation: era-node-in var(--dur-2, 340ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) backwards;
  animation-delay: calc(var(--stagger, 62ms) * var(--en-i, 0));
}
@keyframes era-node-in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to   { opacity: 1; transform: translateX(-50%); }
}
/* ---- 进场（一次性）：金线从左端滑到「现在」——transform 缩放，不动画宽度 ---- */
.era-axis .axis-fill {
  transform-origin: 0 50%;
  animation: era-fill-in var(--dur-3, 580ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) backwards;
}
@keyframes era-fill-in { from { transform: scaleX(0); } }
/* ---- hover / 键盘选中：金色游标滑到所指节点（指示，不表演；不循环不脉冲） ---- */
.era-axis .axis-cursor {
  position: absolute; left: 0; top: 46px; width: 2px; height: 12px; margin-left: -1px;
  background: var(--gold); opacity: 0; pointer-events: none;
  transform: translateX(var(--era-cx, 0px));
  transition: transform var(--dur-2, 240ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
              opacity var(--dur-1, 140ms) var(--ease-in-out, cubic-bezier(.65,0,.35,1));
}
.era-axis .axis-cursor.on { opacity: 1; }
/* 悬停/选中时连接线染金：颜色的双向过渡用 ease-in-out */
.era-node .en-stem {
  transition: background var(--dur-1, 140ms) var(--ease-in-out, cubic-bezier(.65,0,.35,1));
}
.era-node:hover .en-stem,
.era-node:focus-visible .en-stem { background: var(--gold); }
/* 键盘选中与悬停同一套反馈（焦点环由全局 :focus-visible 提供，这里只补齐体感） */
.era-node:focus-visible { transform: translateX(-50%) translateY(-2px); }
.era-node:focus-visible .en-dot { background: var(--gold); border-color: var(--gold); transform: scale(1.25); }
.era-node:focus-visible .en-year { color: var(--gold-text); }
.era-node:focus-visible .en-label { color: var(--ink); }
.era-node:focus-visible .en-tip {
  opacity: 1; transform: translateX(calc(-50% + var(--tip-shift))) translateY(0);
}
/* 窄屏没有横轴，游标随之消失（与 components.css 的 860px 断点对齐） */
@media (max-width: 860px) {
  .era-axis .axis-cursor { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .era-node, .era-axis .axis-fill { animation: none; }
  .era-axis .axis-cursor { display: none; }
}
`;

  function ensureMotionCss() {
    if (document.getElementById('era-motion-css')) return;
    const el = document.createElement('style');
    el.id = 'era-motion-css';
    el.textContent = MOTION_CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /** 游标：JS 只报「指到哪了」（位置 + 开关），滑移本身交给 CSS transition。
      节点带 translateX(-50%)，视觉中心恰好落在 offsetLeft 上。 */
  function wireCursor(axis) {
    const cursor = axis.querySelector('.axis-cursor');
    if (!cursor) return;
    const place = (node) => {
      axis.style.setProperty('--era-cx', node.offsetLeft + 'px');
      cursor.classList.add('on');
    };
    const hide = () => cursor.classList.remove('on');
    axis.addEventListener('pointerover', (ev) => {
      const node = ev.target && ev.target.closest ? ev.target.closest('.era-node') : null;
      if (node) place(node);
    });
    axis.addEventListener('pointerout', (ev) => {
      const to = ev.relatedTarget;
      if (!(to && to.closest && to.closest('.era-node'))) hide();
    });
    axis.addEventListener('focusin', (ev) => {
      const node = ev.target;
      if (node && node.classList && node.classList.contains('era-node')
        && node.matches && node.matches(':focus-visible')) place(node);
    });
    axis.addEventListener('focusout', hide);
  }

  function renderBand(band, opts) {
    const list = band.eras;
    const y0 = Number(list[0].year);
    const y1 = Number(list[list.length - 1].year);
    const span = Math.max(1, y1 - y0);

    let nowLeft = null;
    const nodes = list.map((e, i) => {
      const y = Number(String(e.year).slice(0, 4));
      const pos = ((y - y0) / span) * 100;
      // 端点稍微内缩，避免节点贴边被裁
      const left = 6 + pos * 0.88;
      if (e.now) nowLeft = left;
      // 相邻年份（如 2020 / 2022）标签会相撞：奇偶交替下移一行
      const lane = i % 2 ? ' lane-1' : '';
      return `<a class="era-node${lane}${e.now ? ' now' : ''}" href="${esc(e.href)}" style="left:${left.toFixed(2)}%;--en-i:${i}">
        <span class="en-tip"><b>${esc(e.year)} · ${esc(e.label)}</b><span>${esc(e.tip)}</span></span>
        <span class="en-year">${esc(e.year)}</span>
        <span class="en-dot"></span>
        <span class="en-stem"></span>
        <span class="en-label">${esc(e.label)}</span>
        <span class="en-stat">${esc(e.stat)}</span>
      </a>`;
    }).join('');

    // 金线随"当前时代"填充：宽度直接写进标记（进场用 scaleX 动画滑过去）
    const fillStyle = nowLeft === null ? '' : ` style="width:${nowLeft.toFixed(2)}%"`;

    return `<div class="era-band">
      <div class="era-band-head">
        <span class="era-band-label">${esc(band.label)}</span>
        <span class="era-band-range num">${esc(band.range)}</span>
        ${opts && opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}
      </div>
      <div class="era-axis">
        <div class="axis-line"></div>
        <div class="axis-fill" data-fill${fillStyle}></div>
        ${nodes}
        <span class="axis-cursor" aria-hidden="true"></span>
      </div>
    </div>`;
  }

  function render(container, bands) {
    if (!container) return;
    const list = bands && bands.length ? bands : DEFAULT_BANDS;
    ensureMotionCss();
    container.innerHTML = list.map((band, i) => renderBand(band, {
      hint: i === 0 ? '悬停看一句话，点进去看完整复盘' : '',
    })).join('');

    // 金线游标：reduced-motion 时不接线（CSS 里也已整体关闭）
    if (!reducedMotion()) {
      container.querySelectorAll('.era-axis').forEach(wireCursor);
    }
  }

  window.EraTimeline = { render, DEFAULT_BANDS, DEFAULT_ERAS: DEFAULT_BANDS[0].eras };
})();
