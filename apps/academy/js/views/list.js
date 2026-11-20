/* views/list.js —— 栏目索引页（货币与利率 / 标的百科 / 周期 / 家庭理财 共用） */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);

  /* —— 列表卡 hover 反馈（即时反馈类动效）——
     六个视图文件（list/article/assets/chain/path/search）各带一份**逐字节相同**的
     这段样式，共用同一个 id：谁先渲染谁注入，后来者按 id 跳过——不依赖加载顺序。
     只做三件事：墨色平滑过渡（原本是硬切）、右侧行动文字轻推 2px、
     左缘金线 scaleY 指示（金色只做指示不做表演）。全程 transform + 颜色过渡，
     时长与缓动只引用全局变量并带兜底；reduced-motion 下显式关掉过渡
     （layout.css 顶部的全局关闭分支是第二道保险）。
     注：规则挂在 .entries .entry 上，home/crisis/term 等页的条目同样受益——
     全站一张脸，不为某页单独长样。 */
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

  /** 一次性注入 <style>（测试桩里 getElementById 恒真值，自然跳过，零副作用） */
  function ensureEntryCss() {
    try {
      if (document.getElementById(ENTRY_CSS_ID)) return;
      const st = document.createElement('style');
      st.id = ENTRY_CSS_ID;
      st.textContent = ENTRY_CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 注入不了就算了——动效是增强，不是功能 */ }
  }

  const INTRO = {
    concepts: {
      eyebrow: '栏目 01 · 货币与利率',
      title: '一切资产定价的尺子',
      dek: '从"钱存在哪"到"为什么美债收益率是全球无风险利率"。这一栏是全站的地基——后面所有栏目都会回到这里。',
    },
    assets: {
      eyebrow: '栏目 03 · 标的百科',
      title: '每个标的，一页讲完',
      dek: '黄金、白银、原油、纳指、标普、A股、恒生、国债……每页固定四段：这是什么、为什么涨跌、历史最疯和最惨的五次、什么人适合。',
    },
    cycles: {
      eyebrow: '栏目 05 · 周期与镜鉴',
      title: '今天在哪一格，历史上有谁走过',
      dek: '不预测，只对照。把当前的处境和历史做六维度逐项比较，明确写出哪里像、哪里不像。',
    },
    family: {
      eyebrow: '栏目 06 · 家庭理财',
      title: '给家里人的那份说明书',
      dek: '闲钱怎么分、期限怎么配、房贷怎么被利率影响、常见骗局的识别。写给第一次认真管钱的人。',
    },
    chains: {
      eyebrow: '栏目 04 · 产业链图谱',
      title: '从上游到下游，谁在赚钱',
      dek: 'AI 算力链、半导体、新能源车、光伏……每条链拆成环节，环节强弱实时算给你看。',
    },
    reports: {
      eyebrow: '栏目 07 · 读懂财报',
      title: '财报不是给会计看的',
      dek: '三张表各回答一个问题：赚没赚、欠多少、钱到没到。PE、ROE 这些指标全是从三张表里算出来的——看懂表，指标自动看懂。',
    },
  };

  function render(view, section) {
    ensureEntryCss();
    const intro = INTRO[section] || { eyebrow: '', title: '', dek: '' };
    const items = window.Content.bySection(section);
    /* 标签不能塞进卡片锚点里：<a> 里套 <a> 是不合法 HTML，浏览器会在嵌套处
       提前关闭外层链接，标签和右侧阅读时长会掉出卡片。所以标签渲染成
       卡片**后面的兄弟节点**，仍然可点。 */
    const cards = items.map((c) => `
      <a class="entry" href="#/${section}/${c.id}">
        <span>
          <span class="e-t">${esc(c.title)}</span>
          <span class="e-d">${esc(c.dek || '')}</span>
        </span>
        <span class="e-m">${c.readMinutes ? c.readMinutes + ' min' : ''}</span>
      </a>
      ${c.tags && c.tags.length ? `<div class="entry-tagrow">${c.tags.slice(0, 3).map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}`).join('');

    view.innerHTML = `
      <div class="art-head">
        <div class="eyebrow">${esc(intro.eyebrow)}</div>
        <h1 style="font-size:var(--t-hero);letter-spacing:-.015em;margin-bottom:var(--s-3)">${esc(intro.title)}</h1>
        <p class="art-dek">${esc(intro.dek)}</p>
      </div>
      ${(window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : ''}
      <div class="entries">${cards || '<div class="empty"><div class="et">这一栏还在写</div><div class="ed">内容正在补充中。</div></div>'}</div>`;
  }

  window.ListView = { render, INTRO };
})();
