/* views/crisis.js —— 危机复盘：列表（从回放包自动生成）+ 详情（文章 + 回放器） */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const F = () => window.Fmt;

  /** 已知的危机包 id（与 _scripts/collect-history.mjs 的 CRISIS_DEFS 对应） */
  const PKG_IDS = ['1987', '1990', '1994', '1998', '2008', '2020', '2022'];

  /** 轻量索引：列表页只读这个，不加载几百 KB 的完整包 */
  async function loadIndex() {
    const idx = await window.History.loadJSON('data/history/crisis-index.json');
    return (idx && idx.items) || [];
  }

  async function renderList(view) {
    // 从详情页回列表：上一个回放器必须拆掉，否则它的方向键还挂在全局
    if (window.ReplayPlayer) window.ReplayPlayer.stop();
    const items = await loadIndex();
    const arts = window.Content.bySection('crisis');
    const artIds = arts.map((a) => a.id);

    /* 列表按**危机本身的年份倒序**（最近的在前）。
       之前用的是采集脚本里的定义顺序（2008/1990/1998/1994/1987）——
       那既不是时间序，也不是惨烈序（1987 那天跌 20.47%，是五场里最惨的，却排在最后），
       读者只会觉得这个列表是乱的。按时间排，读者一眼能看出「上一场大危机离现在有多远」，
       而且每场危机的来龙去脉本来就连着：87 → 90 → 94 → 98 → 08。
       注意按**危机的年份**排，不是按数据区间的起点：1990 那场的回放区间从 1987-04
       开始（含黑色星期一那段），按起点排它会跑到 1987 前面去——那就又乱了。 */
    const yearOf = (s) => {
      const m = /(\d{4})/.exec(String((s && s.id) || ''));
      return m ? Number(m[1]) : 0;
    };
    const sorted = items.slice().sort((a, b) =>
      yearOf(b) - yearOf(a) || String(b.from || '').localeCompare(String(a.from || '')));

    const cards = sorted.map((s) => {
      const art = arts.find((a) => a.id === s.id);
      const h = s.headline;
      // 收益率用「区间变动（百分点）」，价格用「峰谷跌幅（%）」——两者不能混着写
      const tag = !h ? ''
        : h.kind === 'yield'
          ? `<span class="tag up">${esc(h.name)} 区间 ${h.changePp.toFixed(2)} 个百分点</span>`
          : `<span class="tag down">${esc(h.name)} ${h.dropPct.toFixed(1)}%</span>`;
      const worst = h && h.worstDay ? h.worstDay : null;
      return `<a class="entry" href="#/crisis/${esc(s.id)}">
        <span>
          <span class="e-t">${esc(s.title)}</span>
          <span class="e-d">${esc(s.from)} → ${esc(s.to)} · ${s.days} 个交易日 · ${s.seriesCount} 条序列
            ${worst ? `· 最惨一天 ${esc(worst.t)} ${worst.pct.toFixed(2)}%` : ''}</span>
          <span class="e-tags">
            ${tag}
            <span class="tag">${esc(s.freq === 'D' ? '日频' : '月频')}</span>
            <span class="tag">${s.events} 个事件</span>
          </span>
        </span>
        <span class="e-m">${art ? art.readMinutes + ' min' : '看复盘 →'}</span>
      </a>`;
    }).join('');

    // 有文章但还没有回放包的（id 就是年份，按年份倒序排）
    const extra = arts.filter((a) => !PKG_IDS.includes(a.id))
      .sort((a, b) => String(b.id).localeCompare(String(a.id))).map((a) => `
      <a class="entry" href="#/crisis/${esc(a.id)}">
        <span><span class="e-t">${esc(a.title)}</span><span class="e-d">${esc(a.dek || '')}</span></span>
        <span class="e-m">${a.readMinutes || ''} min</span>
      </a>`).join('');

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">栏目 02 · 危机复盘</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">每一场危机，都值得拖一遍时间轴</h1>
        <p class="art-dek">下面每场危机都配了一个回放器：多条资产在同一条时间轴上同步走，<b>日频</b>，你可以拖到崩盘那一天，看那一刻各资产到底怎么了。页面上每个跌幅都是从数据里算出来的，不是手写的。<b>按时间倒序，最近的在前。</b></p>
      </div>
      <div class="entries">${cards}${extra}</div>`;
  }

  async function renderDetail(view, id) {
    // 重挂载前先拆掉上一个回放器：定时器、观察器、宿主引用都不该留着
    if (window.ReplayPlayer) window.ReplayPlayer.stop();
    const pkg = await window.History.crisis(id);
    /* 切走了就别画了。
       危机页要等一个几百 KB 的 JSON，这期间用户很可能已经跳去别的页面。
       不检查这一句，旧页面的内容会覆盖到新页面上——URL 是 A、图却是 B。 */
    if (!view.isConnected) return;
    const art = window.Content.article(id);

    if (!art) {
      // 这支复盘还没写，但回放数据可能已经有了：
      // 容器必须一起输出，否则 mountReplay 找不到 #crisis-replay，页面上什么都没有。
      view.innerHTML = `<div class="empty"><div class="et">这场复盘还没写</div>
        <div class="ed">回放数据${pkg ? '已经有了' : '也需要先跑一次采集'}。</div>
        <a class="btn ghost sm" href="#/crisis">回复盘列表</a></div>
        <div id="crisis-replay" style="margin-top:var(--s-6)"></div>`;
      mountReplay(view, pkg, id);
      return;
    }

    const glossary = window.Content.glossary();
    let html = F().md(art.body || '');
    html = window.TermCard.markTerms(html, glossary);
    const m = art.meta || art;
    const s = pkg ? window.Engine.crisis.summarize(pkg) : null;

    view.innerHTML = `
      <article class="art-head">
        <div class="eyebrow">危机复盘${m.range ? ' · ' + esc(m.range) : ''}</div>
        <h1>${esc(m.title || '')}</h1>
        ${m.dek ? `<p class="art-dek">${esc(m.dek)}</p>` : ''}
        <div class="art-meta">
          ${m.readMinutes ? `<span>阅读约 ${m.readMinutes} 分钟</span><span class="msep">·</span>` : ''}
          <span>本文写于 ${esc(m.dataAsOf || '—')}</span>
          ${m.dataAsOfActual ? `<span class="msep">·</span><span>数据截至 ${esc(m.dataAsOfActual)}</span>` : ''}
          ${m.source ? `<span class="msep">·</span><span>来源 ${esc(m.source)}</span>` : ''}
          ${s ? `<span class="msep">·</span><span>${s.days} 个交易日 × ${s.seriesCount} 条序列</span>` : ''}
        </div>
      </article>

      <div class="disclaimer">
        ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.ICON : ''}
        <span>历史复盘不预测未来。市场结构、监管环境和参与者都和当年不同。</span>
      </div>

      <div id="crisis-replay" style="margin-bottom:var(--s-6)"></div>

      ${(m.points && m.points.length) ? `
        <div class="panel" style="margin-bottom:var(--s-6);background:var(--sheet-2)">
          <div class="eyebrow" style="margin-bottom:10px">这一场的三句话</div>
          <ol style="margin:0;padding-left:1.2em">
            ${m.points.map((p) => `<li style="margin-bottom:6px">${esc(p)}</li>`).join('')}
          </ol>
        </div>` : ''}

      <div class="prose">${html}</div>`;

    if (pkg) mountReplay(view, pkg, id);
  }

  function mountReplay(view, pkg, id) {
    /* 只在自己的容器里找。
       以前用 document.getElementById('crisis-replay')——那是**整个文档**里的第一个同名节点。
       旧页面 await 回来时，新页面已经有同名节点了，于是旧数据被写进新页面：
       URL 显示 1998 亚洲金融危机，图上画的却是 1987 的数据。 */
    const box = view.querySelector('#crisis-replay');
    if (!box) return;
    if (!pkg || !pkg.series || !pkg.series.length) {
      /* 「还没采集」和「没加载到」是两回事：
         前者要跑采集脚本，后者多半是网络问题——给个重试按钮就够了。
         以前一律说「还没采集」，读者对着一个已存在的文件白跑一次脚本。 */
      const known = PKG_IDS.indexOf(String(id)) >= 0;
      box.innerHTML = known
        ? `<div class="panel"><div class="empty" style="padding:var(--s-5) 0">
            <div class="et">回放数据这次没加载出来</div>
            <div class="ed">数据文件是有的（data/history/crisis-${esc(String(id))}.json），
            多半是网络抖了一下。刷新页面就能再试一次。</div>
            <button class="btn ghost sm" onclick="location.reload()">重新加载</button></div></div>`
        : `<div class="panel"><div class="empty" style="padding:var(--s-5) 0">
            <div class="et">回放数据还没采集</div>
            <div class="ed">跑一次 <code>node _scripts/collect-history.mjs</code> 就能拿到真实长历史。</div></div></div>`;
      return;
    }
    // 挂新实例之前先拆旧的
    if (window.ReplayPlayer) window.ReplayPlayer.stop();
    window.ReplayPlayer.render(box, pkg);
  }

  window.CrisisView = { renderList, renderDetail, mountReplay, loadIndex, PKG_IDS };
})();
