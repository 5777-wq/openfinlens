/* views/calc.js —— 家庭理财：四个纯算术小计算器（#/calc）
   为什么放在前端算：通胀侵蚀、定投复利、房贷月供、跌后回本都是确定性算术，
   不需要联网，也不该把用户输入发出去。页面不存数据，刷新即忘。

   交互约定：
   - 输入都有 <label for>；oninput 实时算；
   - 只重画自己那块结果区，不整页重绘，输入焦点不会丢；
   - 术语链接只在术语库里确实存在时才挂；
   - 「这是算术演示，不是理财建议」写死在页面上。
*/
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CSS_ID = 'calc-view-css';

  const CSS = ''
    + '.calc-demo-note{margin:0 0 var(--s-5);padding:var(--s-3) var(--s-4);border-radius:8px;background:var(--gold-soft);color:var(--ink-2);font-size:var(--t-small);line-height:1.75;}'
    + '.calc-card{margin-bottom:var(--s-4);}'
    + '.calc-card .panel-title{margin-bottom:var(--s-3);}'
    + '.calc-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--s-3);}'
    + '.calc-field label{display:block;margin-bottom:5px;font-family:var(--font-mono);font-size:var(--t-micro);color:var(--ink-3);}'
    + '.calc-field input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:8px 10px;border:1px solid var(--rule);border-radius:var(--r-2);background:var(--sheet);color:var(--ink);}'
    + '.calc-field input:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}'
    + '.calc-out{margin-top:var(--s-3);}'
    + '.calc-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;background:transparent;border:0;}'
    + '.calc-result{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-radius:8px;background:color-mix(in srgb,var(--sheet-2) 56%,transparent);}'
    + '.calc-k{font-size:var(--t-micro);color:var(--ink-3);}'
    + '.calc-v{font-family:var(--font-mono);font-size:17px;font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums;}'
    + '.calc-n{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-4);}'
    + '.calc-note{margin:var(--s-3) 0 0;font-size:var(--t-micro);color:var(--ink-3);line-height:1.7;}'
    + '.calc-term-row{display:flex;flex-wrap:wrap;gap:var(--s-2);margin:var(--s-3) 0 0;font-size:var(--t-micro);color:var(--ink-3);}'
    + '.calc-term{color:var(--ink);padding:2px 7px;border-radius:999px;background:var(--sheet-2);text-decoration:none;}'
    + '.calc-warn{margin:0;padding:var(--s-3) var(--s-4);background:var(--warn-soft);border:0;border-radius:8px;color:var(--ink-2);font-size:var(--t-small);line-height:1.7;}'
    + '@media (max-width:430px){.calc-fields{grid-template-columns:1fr;}}';

  function ensureCss() {
    try {
      if (document.getElementById(CSS_ID)) return;
      const st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 样式是增强 */ }
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const money = (v) => (isNum(v)
    ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 元'
    : '--');
  const pct = (v, d) => (isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d) + '%' : '--');
  const plain = (v, d) => (isNum(v) ? Number(v).toFixed(d === undefined ? 2 : d) : '--');

  function warn(text) {
    return '<p class="calc-warn" role="status">' + esc(text) + '</p>';
  }

  function resultGrid(items) {
    return '<div class="calc-result-grid">' + items.map((x) => '<div class="calc-result">'
      + '<span class="calc-k">' + esc(x.k) + '</span>'
      + '<span class="calc-v">' + esc(x.v) + '</span>'
      + '<span class="calc-n">' + esc(x.n || '') + '</span></div>').join('') + '</div>';
  }

  function termRow(ids) {
    const g = (window.Content && window.Content.glossary) ? window.Content.glossary() : {};
    const hits = (ids || []).filter((id) => g[id]);
    if (!hits.length) return '';
    return '<p class="calc-term-row">相关词条：'
      + hits.map((id) => `<a class="calc-term" href="#/term/${encodeURIComponent(id)}">${esc(g[id].term || id)}</a>`).join('')
      + '</p>';
  }

  function field(id, label, value, step, min, max, suffix) {
    return '<div class="calc-field"><label for="' + id + '">' + esc(label) + '</label>'
      + '<input id="' + id + '" type="number" inputmode="decimal" value="' + esc(String(value)) + '"'
      + (step !== undefined ? ' step="' + step + '"' : '')
      + (min !== undefined ? ' min="' + min + '"' : '')
      + (max !== undefined ? ' max="' + max + '"' : '')
      + (suffix ? ' aria-describedby="' + id + '-unit"' : '') + '>'
      + (suffix ? '<span id="' + id + '-unit" class="calc-n">' + esc(suffix) + '</span>' : '')
      + '</div>';
  }

  function numberAt(view, id) {
    const el = view.querySelector('#' + id);
    if (!el) return NaN;
    const v = Number(el.value);
    return isNum(v) ? v : NaN;
  }

  function resultOf(view, id) {
    return view.querySelector('#' + id);
  }

  /* 1. 名义 vs 实际：本金按名义年化增长，再按通胀折算购买力 */
  function calcReal(view) {
    const principal = numberAt(view, 'real-p');
    const nominal = numberAt(view, 'real-n');
    const inflation = numberAt(view, 'real-i');
    const years = numberAt(view, 'real-y');
    const out = resultOf(view, 'real-out');
    if (!out) return;
    if (![principal, nominal, inflation, years].every(isNum) || principal < 0 || years <= 0 || years > 100) {
      out.innerHTML = warn('请填本金、名义年化、通胀和年数（年数 0–100）。');
      return;
    }
    const nominalFuture = principal * Math.pow(1 + nominal / 100, years);
    const realFuture = nominalFuture / Math.pow(1 + inflation / 100, years);
    const realRate = ((1 + nominal / 100) / (1 + inflation / 100) - 1) * 100;
    out.innerHTML = '<div class="calc-out">' + resultGrid([
      { k: '名义终值', v: money(nominalFuture), n: '按名义年化 ' + plain(nominal, 2) + '% 复利' },
      { k: '折成今天的购买力', v: money(realFuture), n: '按通胀 ' + plain(inflation, 2) + '% 折算' },
      { k: '实际年化', v: pct(realRate, 2), n: '(1+名义) ÷ (1+通胀) − 1' },
    ]) + termRow(['inflation', 'real-rate', 'compounding'])
      + '<p class="calc-note">公式：名义终值 = 本金 × (1 + 名义年化)^年数；实际购买力 = 名义终值 ÷ (1 + 通胀)^年数。真实世界里的通胀每年不同，这里是固定假设。</p></div>';
  }

  /* 2. 定投/复利：每月月末投入，按月复利 */
  function calcDca(view) {
    const monthly = numberAt(view, 'dca-m');
    const annual = numberAt(view, 'dca-r');
    const years = numberAt(view, 'dca-y');
    const out = resultOf(view, 'dca-out');
    if (!out) return;
    if (![monthly, annual, years].every(isNum) || monthly < 0 || annual <= -100 || years <= 0 || years > 100) {
      out.innerHTML = warn('请填每月投入（≥0）、年化（>−100%）和年数（0–100）。');
      return;
    }
    const months = Math.max(1, Math.round(years * 12));
    const mr = annual / 100 / 12;
    const invested = monthly * months;
    const future = Math.abs(mr) < 1e-12 ? invested : monthly * (Math.pow(1 + mr, months) - 1) / mr;
    if (!isNum(future)) {
      out.innerHTML = warn('这组数字超出可计算范围，换小一点的数。');
      return;
    }
    out.innerHTML = '<div class="calc-out">' + resultGrid([
      { k: '期末合计', v: money(future), n: '每月月末投入，按月复利' },
      { k: '总投入', v: money(invested), n: months + ' 个月 × 每月投入' },
      { k: '其中收益', v: money(future - invested), n: future >= invested ? '复利滚出来的部分' : '负收益也会复利' },
    ]) + termRow(['compounding', 'index-fund'])
      + '<p class="calc-note">公式：期末 = 每月投入 × ((1 + 月利率)^月数 − 1) ÷ 月利率。固定年化是假设，真实收益会波动，也没扣费用和税。</p></div>';
  }

  /* 3. 房贷：等额本息月供 + 利率加 1 个百分点的敏感度 */
  function calcMortgage(view) {
    const loan = numberAt(view, 'mort-l');
    const rate = numberAt(view, 'mort-r');
    const years = numberAt(view, 'mort-y');
    const out = resultOf(view, 'mort-out');
    if (!out) return;
    if (![loan, rate, years].every(isNum) || loan <= 0 || rate < 0 || years <= 0 || years > 50) {
      out.innerHTML = warn('请填贷款额（>0）、年利率（≥0%）和年限（0–50）。');
      return;
    }
    const n = Math.round(years * 12);
    const mr = rate / 100 / 12;
    const pay = mr === 0 ? loan / n : loan * mr * Math.pow(1 + mr, n) / (Math.pow(1 + mr, n) - 1);
    const total = pay * n;
    const interest = total - loan;
    // 利率 +1 个百分点：
    const mr2 = (rate + 1) / 100 / 12;
    const pay2 = mr2 === 0 ? loan / n : loan * mr2 * Math.pow(1 + mr2, n) / (Math.pow(1 + mr2, n) - 1);
    out.innerHTML = '<div class="calc-out">' + resultGrid([
      { k: '每月月供', v: money(pay), n: '等额本息，共 ' + n + ' 期' },
      { k: '总利息', v: money(interest), n: '总还款 − 本金' },
      { k: '利率 +1% 后月供', v: money(pay2), n: '每月多 ' + money(Math.max(0, pay2 - pay)) },
    ]) + termRow(['mortgage', 'interest-rate', 'amortization'])
      + '<p class="calc-note">公式：月供 = 贷款额 × 月利率 × (1+月利率)^月数 ÷ ((1+月利率)^月数 − 1)。这是等额本息；等额本金、提前还款、LPR 浮动都没有算进来。</p></div>';
  }

  /* 4. 回本算术：跌 X% 之后要涨多少才回到原点 */
  function calcRecover(view) {
    const drop = numberAt(view, 'rec-d');
    const out = resultOf(view, 'rec-out');
    if (!out) return;
    if (!isNum(drop) || drop <= 0 || drop >= 100) {
      out.innerHTML = warn('请填 0–100 之间的跌幅（例如 50 表示跌了一半）。');
      return;
    }
    const need = (1 / (1 - drop / 100) - 1) * 100;
    const half = (1 / (1 - 0.5) - 1) * 100;
    out.innerHTML = '<div class="calc-out">' + resultGrid([
      { k: '回本需要上涨', v: pct(need, 2), n: '从跌后的价格回到原价' },
      { k: '如果跌 50%', v: pct(half, 0), n: '跌一半，要翻倍才回本' },
      { k: '对称性', v: '不对称', n: '跌得越深，回本需要的涨幅越大' },
    ]) + termRow(['max-drawdown', 'compounding', 'volatility'])
      + '<p class="calc-note">公式：回本涨幅 = 1 ÷ (1 − 跌幅) − 1。跌 20% 要涨 25%，跌 50% 要涨 100%，跌 80% 要涨 400%。这也是为什么「控制回撤」比「追求高收益」更先被讨论。</p></div>';
  }

  function card(id, title, dek, fields, outId, formula) {
    return '<section class="panel calc-card" id="' + id + '">'
      + '<div class="panel-title"><h3>' + esc(title) + '</h3><span class="sub">' + esc(dek) + '</span></div>'
      + '<div class="calc-fields">' + fields + '</div>'
      + '<p class="calc-note">' + esc(formula) + '</p>'
      + '<div class="calc-out" id="' + outId + '" aria-live="polite"></div>'
      + '</section>';
  }

  function bind(view, ids, fn) {
    ids.forEach((id) => {
      const el = view.querySelector('#' + id);
      if (el) el.addEventListener('input', () => fn(view));
    });
    fn(view);
  }

  function render(view) {
    ensureCss();
    view.innerHTML = '<div class="art-head">'
      + '<div class="eyebrow">工具箱 · 家庭理财计算器</div>'
      + '<h1 style="font-size:var(--t-h1);margin-bottom:var(--s-2)">先把算术算清楚，再谈别的</h1>'
      + '<p class="art-dek">四个小工具：通胀吃掉多少、定投滚成多少、房贷每月还多少、跌下去要涨多少才回本。全部在本地算，输入不会离开这台设备。</p>'
      + '</div>'
      + '<p class="calc-demo-note"><strong>这是算术演示，不是理财建议。</strong>每个工具都写清了公式与假设；真实收益会波动，也没扣费用和税。</p>'
      + card('calc-real', '名义收益 vs 实际购买力', '10 年后的钱，还值今天多少',
        field('real-p', '本金（元）', 100000, 1000, 0, undefined, '元')
        + field('real-n', '名义年化（%）', 5, 0.1, -100, 100, '%')
        + field('real-i', '通胀（%）', 2, 0.1, -50, 50, '%')
        + field('real-y', '年数', 10, 1, 0.1, 100, '年'),
        'real-out', '先按名义年化滚大，再按通胀折回今天的购买力。')
      + card('calc-dca', '定投 / 复利', '每月投入，长期滚成多少',
        field('dca-m', '每月投入（元）', 1000, 100, 0, undefined, '元')
        + field('dca-r', '年化（%）', 6, 0.1, -100, 100, '%')
        + field('dca-y', '年数', 10, 1, 0.1, 100, '年'),
        'dca-out', '每月月末投入，按月复利；固定年化只是假设。')
      + card('calc-mort', '房贷月供', '等额本息，以及利率 +1% 的变化',
        field('mort-l', '贷款额（元）', 1000000, 10000, 0, undefined, '元')
        + field('mort-r', '年利率（%）', 4.2, 0.05, 0, 30, '%')
        + field('mort-y', '年限', 30, 1, 0.1, 50, '年'),
        'mort-out', '等额本息；等额本金、提前还款、LPR 浮动都没有算。')
      + card('calc-rec', '跌下去，要涨多少才回本', '回撤与回本的不对称',
        field('rec-d', '跌幅（%）', 30, 1, 0, 99.9, '%'),
        'rec-out', '回本涨幅 = 1 ÷ (1 − 跌幅) − 1。')
      + ((window.Site && window.Site.disclaimer) ? window.Site.disclaimer.GENERIC : '');

    bind(view, ['real-p', 'real-n', 'real-i', 'real-y'], calcReal);
    bind(view, ['dca-m', 'dca-r', 'dca-y'], calcDca);
    bind(view, ['mort-l', 'mort-r', 'mort-y'], calcMortgage);
    bind(view, ['rec-d'], calcRecover);
  }

  window.CalcView = { render };
})();
