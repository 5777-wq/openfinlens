/* views/analogy.js —— 六维历史对照（#/analogy）
   把 2000 年互联网泡沫和本轮 AI 周期放在同一组轴上逐项比较。
   ⚠ 分数是**固定的编辑判断**，不是行情数据，也不让读者拖动：
   拖动滑块会制造「结论可以随便调」的错觉，而且页面会显得像个玩具。
   这里只把两列判断和差值算清楚，并给出「最像 / 最不像」。
*/
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CSS_ID = 'analogy-view-css';

  // 编辑判断，依据 content/cycles/2000-dotcom.md 的逐维表；改动要同步改正文。
  const BASE_2000 = { valuation: 85, liquidity: 60, narrative: 95, profit: 35, breadth: 25, structure: 55 };
  const NOW = { valuation: 70, liquidity: 55, narrative: 90, profit: 55, breadth: 35, structure: 65 };

  function ensureCss() {
    try {
      if (document.getElementById(CSS_ID)) return;
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = ''
        + '.ana-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:var(--s-5);align-items:start;}'
        + '@media (max-width:860px){.ana-grid{grid-template-columns:1fr;}}'
        + '.ana-dim{padding:var(--s-4) 0;border-top:1px solid var(--rule-2);}'
        + '.ana-dim:first-child{border-top:0;padding-top:0;}'
        + '.ana-dim-head{display:flex;align-items:baseline;gap:var(--s-2);flex-wrap:wrap;margin-bottom:var(--s-2);}'
        + '.ana-dim-name{font-size:var(--t-small);color:var(--ink);font-weight:600;}'
        + '.ana-dim-hint{font-size:var(--t-micro);color:var(--ink-3);}'
        + '.ana-row{display:grid;grid-template-columns:52px 1fr 40px;gap:var(--s-2);align-items:center;margin-top:6px;}'
        + '.ana-row span{font-family:var(--font-mono);font-size:10px;color:var(--ink-4);}'
        + '.ana-bar{height:8px;border-radius:999px;background:var(--rule-2);overflow:hidden;}'
        + '.ana-bar i{display:block;height:100%;border-radius:999px;}'
        + '.ana-bar.base i{background:var(--ink-4);}'
        + '.ana-bar.now i{background:var(--teal);}'
        + '.ana-row output{font-family:var(--font-mono);font-size:11px;color:var(--ink-2);text-align:right;}'
        + '.ana-score{font-family:var(--font-mono);font-size:52px;line-height:1;color:var(--gold-text);letter-spacing:-.03em;}'
        + '.ana-score small{font-size:14px;color:var(--ink-3);letter-spacing:0;}'
        + '.ana-card{padding:var(--s-5);background:var(--sheet);border:1px solid var(--rule-2);border-radius:16px;box-shadow:var(--sh-1);}'
        + '.ana-list{margin:var(--s-3) 0 0;padding-left:1.1em;font-size:var(--t-small);line-height:1.9;color:var(--ink-2);}'
        + '.ana-pill{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;background:var(--gold-soft);color:var(--gold-text);font-family:var(--font-mono);font-size:10.5px;}'
        + '.ana-caveat{margin:0 0 var(--s-5);padding:var(--s-3) var(--s-4);border-left:2px solid var(--gold);background:var(--gold-soft);font-size:var(--t-small);line-height:1.8;color:var(--ink-2);}'
        + '.ana-method{font-size:var(--t-micro);color:var(--ink-3);line-height:1.7;}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式增强 */ }
  }

  function resultHtml() {
    const A = window.Engine && window.Engine.analogy;
    if (!A) return '<p class="muted">对照引擎没有加载，刷新页面再试。</p>';
    const cmp = A.compare(NOW, BASE_2000);
    const diffs = A.differences(cmp);
    const closest = diffs.slice().sort((a, b) => a.diff - b.diff).slice(0, 2);
    const far = diffs.slice().sort((a, b) => b.diff - a.diff).slice(0, 2);
    return '<div class="ana-card">'
      + '<div class="eyebrow">相似度（算术结果）</div>'
      + '<div class="ana-score">' + (cmp.similarity === null ? '--' : cmp.similarity) + ' <small>/ 100</small></div>'
      + '<p class="ana-method">六个维度差值的平均数换算而来。分数高只说明「和 2000 年的编辑打分更像」，不代表风险高、更不代表会重演。</p>'
      + '<div class="eyebrow" style="margin-top:var(--s-4)">最像的两项</div>'
      + '<ul class="ana-list">' + closest.map((d) => '<li><strong>' + esc(d.label) + '</strong>：差 ' + d.diff + ' 分，' + esc(d.verdict) + '</li>').join('') + '</ul>'
      + '<div class="eyebrow" style="margin-top:var(--s-4)">最不像的两项</div>'
      + '<ul class="ana-list">' + far.map((d) => '<li><strong>' + esc(d.label) + '</strong>：差 ' + d.diff + ' 分，' + esc(d.verdict) + '</li>').join('') + '</ul>'
      + '<div class="eyebrow" style="margin-top:var(--s-4)">逐维差值</div>'
      + '<ul class="ana-list">' + cmp.rows.map((r) => '<li>' + esc(r.dim.label) + '：2000 年 ' + (r.b === null ? '--' : r.b) + ' / 本轮 ' + (r.a === null ? '--' : r.a) + ' <span class="ana-pill">' + esc(r.verdict) + '</span></li>').join('') + '</ul>'
      + '</div>';
  }

  function render(view) {
    ensureCss();
    const A = window.Engine && window.Engine.analogy;
    if (!A) {
      view.innerHTML = '<div class="empty"><div class="et">对照引擎没有加载</div><div class="ed">刷新一次页面再试。</div></div>';
      return;
    }

    const dimHtml = A.DIMENSIONS.map((d) => {
      const val = NOW[d.key];
      const base = BASE_2000[d.key];
      return '<div class="ana-dim" data-dim="' + d.key + '">'
        + '<div class="ana-dim-head"><span class="ana-dim-name">' + esc(d.label) + '</span><span class="ana-dim-hint">' + esc(d.hint) + '</span></div>'
        + '<div class="ana-row"><span>2000</span><span class="ana-bar base"><i style="width:' + base + '%"></i></span><output>' + base + '</output></div>'
        + '<div class="ana-row"><span>本轮</span><span class="ana-bar now"><i style="width:' + val + '%"></i></span><output>' + val + '</output></div>'
        + '</div>';
    }).join('');

    view.innerHTML = '<div class="art-head">'
      + '<div class="eyebrow">工具箱 · 周期对照</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">本轮 AI 周期，像 2000 年吗？</h1>'
      + '<p class="art-dek">六个维度逐项对照。分数是编辑判断，不是行情指标；相似度是算术结果，不是预测。</p>'
      + '</div>'
      + '<p class="ana-caveat"><strong>这是算术，不是预测。</strong>六组分数是编辑根据公开事实打的分，固定列在这里，不提供拖动调节。它只回答「这两组判断差多少」，不告诉你「接下来会怎样」，也不构成任何建议。</p>'
      + '<div class="ana-grid"><section class="panel" aria-label="六维打分">'
      + dimHtml
      + '<p class="ana-method" style="margin-top:var(--s-4)">评分依据写在 <a href="#/cycles/2000-dotcom">《2000 年互联网泡沫》</a> 正文的六维表里；分数变了要同步改正文，不允许两处各说各话。</p>'
      + '</section><div id="ana-result">' + resultHtml() + '</div></div>'
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');
  }

  window.AnalogyView = { render, BASE_2000, NOW };
})();
