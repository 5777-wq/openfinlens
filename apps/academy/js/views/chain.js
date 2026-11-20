/* views/chain.js —— 产业链图谱：列表 + 详情（含实时环节强弱） */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  /* —— 列表卡 hover 反馈（即时反馈类动效）——
     六个视图文件（list/article/assets/chain/path/search）各带一份**逐字节相同**的
     这段样式，共用同一个 id：谁先渲染谁注入，后来者按 id 跳过——不依赖加载顺序。 */
  const ENTRY_CSS_ID = 'entry-cards-css';
  const ENTRY_CSS = ''
    + '.entries .entry{position:relative;transition:background-color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry::before{content:"";position:absolute;left:-9px;top:13px;bottom:13px;width:2px;border-radius:1px;'
    + 'background:var(--gold);transform:scaleY(0);transform-origin:50% 50%;'
    + 'transition:transform var(--dur-1,140ms) var(--ease-out,cubic-bezier(.16,1,.3,1));}'
    + '.entries .entry .e-t{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry .e-d{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1));}'
    + '.entries .entry .e-m{transition:color var(--dur-1,140ms) var(--ease-in-out,cubic-bezier(.65,0,.35,1)),'
    + 'transform var(--dur-1,140ms) var(--ease-out,cubic-bezier(.16,1,.3,1));}'
    + '.entries .entry:hover .e-d,.entries .entry:focus-visible .e-d{color:var(--ink-2);}'
    + '.entries .entry:hover .e-m,.entries .entry:focus-visible .e-m{color:var(--ink-2);transform:translateX(2px);}'
    + '.entries .entry:hover::before,.entries .entry:focus-visible::before{transform:scaleY(1);}'
    + '@media (prefers-reduced-motion:reduce){'
    + '.entries .entry,.entries .entry::before,.entries .entry .e-t,.entries .entry .e-d,.entries .entry .e-m{transition:none;}'
    + '}';

  function ensureEntryCss() {
    try {
      if (document.getElementById(ENTRY_CSS_ID)) return;
      const st = document.createElement('style');
      st.id = ENTRY_CSS_ID;
      st.textContent = ENTRY_CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 注入不了就算了——动效是增强，不是功能 */ }
  }

  function chains() {
    return (typeof window.INDUSTRY_CHAINS !== 'undefined' && window.INDUSTRY_CHAINS) || [];
  }

  function renderList(view) {
    ensureEntryCss();
    const cs = chains();
    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">栏目 04 · 产业链图谱</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">从上游到下游，谁在赚钱</h1>
        <p class="art-dek">一条产业链就是一串"谁给谁供货"的关系。环节强弱用成分股当日涨跌幅等权平均算，口径写在页面上，不做加工。</p>
      </div>
      <div class="entries">
        ${cs.map((c) => `<a class="entry" href="#/chains/${esc(c.id)}">
          <span>
            <span class="e-t">${esc(c.name)}</span>
            <span class="e-d">${esc((c.links || []).map((l) => l.name).join(' → '))}</span>
            <span class="e-tags"><span class="tag">${(c.links || []).length} 个环节</span>
              <span class="tag">${(c.links || []).reduce((n, s) => n + (s.stocks || []).length, 0)} 只成分股</span></span>
          </span>
          <span class="e-m">看链路 →</span>
        </a>`).join('')}
      </div>
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}`;
  }

  async function renderDetail(view, id) {
    const c = chains().find((x) => x.id === id);
    if (!c) {
      view.innerHTML = `<div class="empty"><div class="et">没有这条产业链</div>
        <a class="btn ghost sm" href="#/chains">回列表</a></div>`;
      return;
    }
    const links = c.links || [];

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">产业链图谱</div>
        <h1>${esc(c.name)}</h1>
        <p class="art-dek">${esc(links.map((l) => l.name).join(' → '))}</p>
      </div>
      <div id="chain-heat" style="margin-bottom:var(--s-6)">
        <div class="panel"><div class="skel" style="height:16px;width:40%"></div></div>
      </div>
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}
      <div class="prose">
        ${links.map((s) => `
          <h3>${esc(s.name)}</h3>
          ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
          <p class="small muted" style="font-family:var(--font-mono)">成分：${(s.stocks || []).map((x) => esc(x.name)).join(' · ')}</p>
        `).join('')}
      </div>`;

    await window.ChainHeat.loadQuotes();
    // 切走了就别画了；容器也只在自己的视图里找，别去文档里抢同名节点
    if (!view.isConnected) return;
    window.ChainHeat.render(view.querySelector('#chain-heat'), c);
  }

  window.ChainView = { renderList, renderDetail, chains };
})();
