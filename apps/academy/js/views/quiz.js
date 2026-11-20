/* views/quiz.js —— 术语自测（#/quiz）
   题面直接用术语库的「一句话」，四个选项是同一分类里的词名。
   答错时把该词的「坑」原文给出来——解析不另写，避免两处说法不一致。
   纯本地：不出网络请求，成绩只存本机（只保留最好的一次）。
*/
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CAT_OF = {
    data: '研报数据', fund: '基金与策略', asset: '资产类别', option: '期权与期权策略',
    macro: '宏观经济', basic: '基础概念', micro: '微观与行为', player: '机构与人物',
    risk: '风险与交易', tech: '技术指标',
  };
  const CSS_ID = 'quiz-view-css';

  function ensureCss() {
    try {
      if (document.getElementById(CSS_ID)) return;
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = ''
        + '.quiz-card{margin-bottom:var(--s-5);}'
        + '.quiz-q{font-size:var(--t-h3);line-height:1.7;margin:0 0 var(--s-3);}'
        + '.quiz-opts{display:grid;gap:8px;margin:0;padding:0;list-style:none;}'
        + '.quiz-opt{display:block;width:100%;text-align:left;font:inherit;font-size:var(--t-small);padding:10px 12px;border:1px solid var(--rule);border-radius:var(--r-2);background:var(--sheet);color:var(--ink-2);cursor:pointer;}'
        + '.quiz-opt:hover{border-color:var(--rule);background:var(--sheet-2);color:var(--ink);}'
        + '.quiz-opt:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}'
        + '.quiz-opt.is-correct{border-color:var(--down);background:var(--down-soft);color:var(--down);}'
        + '.quiz-opt.is-wrong{border-color:var(--up);background:var(--up-soft);color:var(--up);}'
        + '.quiz-explain{margin:var(--s-3) 0 0;padding:var(--s-3) var(--s-4);border-left:2px solid var(--gold);background:var(--gold-soft);font-size:var(--t-small);line-height:1.8;color:var(--ink-2);}'
        + '.quiz-progress{display:flex;gap:var(--s-2);align-items:center;margin-bottom:var(--s-3);font-family:var(--font-mono);font-size:var(--t-micro);color:var(--ink-3);}'
        + '.quiz-score{font-family:var(--font-mono);font-size:22px;color:var(--gold-text);}'
        + '.quiz-actions{display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-4);}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式是增强 */ }
  }

  /** 简单可复现的伪随机：同一个 seed 出同一组题。 */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildQuestions(glossary, opts) {
    const n = Math.max(1, Math.min(20, opts.n || 5));
    const seed = opts.seed || 20261029;
    const rand = rng(seed);
    const cat = opts.cat && Object.prototype.hasOwnProperty.call(CAT_OF, opts.cat) ? opts.cat : '';
    let pool = Object.keys(glossary).filter((id) => glossary[id] && glossary[id].one && glossary[id].term);
    if (cat) pool = pool.filter((id) => (glossary[id].cat || 'basic') === cat);
    if (pool.length < 4) pool = Object.keys(glossary).filter((id) => glossary[id] && glossary[id].one && glossary[id].term);
    if (pool.length < 4) return [];
    const picked = shuffle(pool, rand).slice(0, Math.min(n, pool.length));
    return picked.map((id) => {
      const t = glossary[id];
      const sameCat = pool.filter((x) => x !== id && (glossary[x].cat || 'basic') === (t.cat || 'basic'));
      const others = shuffle(sameCat.length >= 3 ? sameCat : pool.filter((x) => x !== id), rand).slice(0, 3);
      const options = shuffle([id].concat(others), rand).map((x) => ({ id: x, term: glossary[x].term }));
      return { id, question: t.one, answer: id, options, pit: t.pit || '' };
    });
  }

  function resultHtml(q, chosen, idx, total) {
    const ok = chosen === q.answer;
    const correct = q.options.find((o) => o.id === q.answer);
    return '<div class="quiz-explain" role="status">'
      + '<strong>' + (ok ? '答对了。' : '正确答案是「' + esc(correct ? correct.term : q.answer) + '」。') + '</strong>'
      + (q.pit ? '<br>最容易踩的坑：' + esc(q.pit) : '')
      + '</div>'
      + (idx + 1 < total
        ? '<div class="quiz-actions"><button type="button" class="btn" id="quiz-next">下一题 →</button></div>'
        : '<div class="quiz-actions"><a class="btn" href="#/quiz">再来一组</a><a class="btn ghost" href="#/path">回新手路径</a></div>');
  }

  function render(view, query) {
    ensureCss();
    const g = (window.Content && window.Content.glossary) ? window.Content.glossary() : {};
    const n = Number((query && query.n) || 5);
    const seed = Number((query && query.seed) || 20261029);
    const questions = buildQuestions(g, { n, cat: query && query.cat, seed });
    if (!questions.length) {
      view.innerHTML = '<div class="empty"><div class="et">题库还没准备好</div><div class="ed">术语库至少要 4 个带「一句话」的词条才能出题。</div><a class="btn ghost sm" href="#/terms">去术语库</a></div>';
      return;
    }
    let idx = 0;
    let score = 0;
    let answered = false;

    function paint() {
      const q = questions[idx];
      view.innerHTML = '<div class="art-head">'
        + '<div class="eyebrow">工具箱 · 术语自测</div>'
        + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">这句话说的是哪个词？</h1>'
        + '<p class="art-dek">题目来自术语库的「一句话」，答错会给出该词的「坑」。' + (query && query.cat && CAT_OF[query.cat] ? '本组只考「' + esc(CAT_OF[query.cat]) + '」。' : '') + '</p>'
        + '</div>'
        + '<section class="panel quiz-card" id="quiz-card">'
        + '<div class="quiz-progress"><span>第 ' + (idx + 1) + ' / ' + questions.length + ' 题</span><span>已答对 ' + score + '</span></div>'
        + '<p class="quiz-q">' + esc(q.question) + '</p>'
        + '<ul class="quiz-opts" id="quiz-opts">' + q.options.map((o) => '<li><button type="button" class="quiz-opt" data-id="' + esc(o.id) + '">' + esc(o.term) + '</button></li>').join('') + '</ul>'
        + '<div id="quiz-feedback"></div>'
        + '</section>'
        + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');

      const buttons = view.querySelectorAll('.quiz-opt');
      buttons.forEach((b) => b.addEventListener('click', () => choose(b.getAttribute('data-id'))));
    }

    function choose(id) {
      if (answered) return;
      answered = true;
      const q = questions[idx];
      const ok = id === q.answer;
      if (ok) score++;
      const buttons = view.querySelectorAll('.quiz-opt');
      buttons.forEach((b) => {
        const bid = b.getAttribute('data-id');
        b.disabled = true;
        if (bid === q.answer) b.classList.add('is-correct');
        if (bid === id && !ok) b.classList.add('is-wrong');
      });
      const fb = view.querySelector('#quiz-feedback');
      if (fb) fb.innerHTML = resultHtml(q, id, idx, questions.length);
      const next = view.querySelector('#quiz-next');
      if (next) next.addEventListener('click', () => {
        idx++;
        answered = false;
        paint();
      });
    }

    paint();
  }

  window.QuizView = { render, buildQuestions, rng };
})();
