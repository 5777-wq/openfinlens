/* fundquiz.js —— 基金页「投资风格测评 → 品类清单」
   分两段，都不联网：
     ① 纯逻辑：QUESTIONS（题）/ CANDIDATES（候选池）/ score()（评分）/ recommend()（推荐 + 风险闸门）
     ② 视图：题目、结果面板、推荐清单（可点选 → 进已有的「画像」面板看真实档案）

   为什么这么做（也是它的红线）：
     - 测评只做一件事：把 6 道题的偏好，映射成一组**公开可查的品类清单**。
       它不预测收益、不给买入引导、不构成投资建议。
     - 候选池是静态代码清单，每个代码都用天天基金 pingzhongdata 核对过名称
       （2026-10-20 实测：511990 华宝添益ETF / 512890 红利低波ETF华泰柏瑞 / 159766 旅游ETF富国 …）。
       画像面板按代码去取真实档案（档案 / 净值 / 同类排名 / 规模 / 持有人 / 资产配置 / 重仓股），
       本模块**不重复造数据**，只做"该看哪一类"的映射。
     - **风险闸门是硬规则**，不是提示：
         · 候选的波动档必须 ≤ 用户的风险档（保守用户绝不可能看到行业主题基金）；
         · 投资期限短时上限更低（3 个月内要用的钱 → 只推货币/短债）；
         · 每条推荐都带"主要风险"，结果面板顶部常驻风险提示。
     - "波动档"是按该品类资产的**典型波动特征**标注的（1 最低 ~ 5 最高），
       不是官方评级，也不代表任何收益预期——文案里写明。

   术语：防御=防守型（低波动/收息），风格轴 防守 ← 平衡 → 进攻。 */

window.FundQuiz = (() => {
  'use strict';
  const U = window.U;
  const { escapeHTML } = U;

  /* ==================== 题目 ====================
     每题 4 个选项。r = 风险承受度贡献(0~3)，s = 风格贡献(-1 防守 ~ +1 进攻)，
     cap = 该选项给风险档设的上限（只有 Q1 用），tag = 附注（会进结果解读）。 */
  const QUESTIONS = [
    {
      q: '这笔钱多久之后要用？',
      hint: '期限比任何预测都更能决定你能拿什么',
      options: [
        { t: '3 个月内，随时可能要用', r: 0, s: 0, cap: 1, tag: '流动性优先' },
        { t: '1–2 年内', r: 1, s: 0, cap: 2 },
        { t: '3–5 年', r: 2, s: 0, cap: 4 },
        { t: '5 年以上', r: 3, s: 0, cap: 5 },
      ],
    },
    {
      q: '持仓浮亏 20% 时，你的第一反应是',
      hint: '反应比问卷上的偏好更接近真实承受力',
      options: [
        { t: '全部卖出，落袋为安', r: 0, s: -1, tag: '厌恶回撤' },
        { t: '卖掉一部分，先降风险', r: 1, s: 0 },
        { t: '不动，等它涨回来', r: 2, s: 0 },
        { t: '加仓摊低成本', r: 3, s: 1, tag: '逆向加仓' },
      ],
    },
    {
      q: '你更想要哪种结果？',
      hint: '想清楚要什么，比能赚多少更重要',
      options: [
        { t: '每年 2–3%，基本不回撤', r: 0, s: -1 },
        { t: '每年 5–7%，中途浮亏能接受', r: 2, s: 0 },
        { t: '争取 10% 以上，能接受大起大落', r: 3, s: 1, tag: '高目标' },
        { t: '说不准，只要别亏太多', r: 1, s: -1 },
      ],
    },
    {
      q: '下面哪类资产，你更愿意长期持有？',
      hint: '这一题定的是风格偏好',
      options: [
        { t: '银行存款、国债这类收息的', r: 0, s: -1 },
        { t: '红利、价值类（低估值高分红）', r: 1, s: -1, tag: '价值偏好' },
        { t: '宽基指数（沪深300 这类一篮子）', r: 2, s: 0 },
        { t: '行业主题（半导体 / 新能源 / 医药）', r: 3, s: 1, tag: '主题偏好' },
      ],
    },
    {
      q: '过去一年你的账户最多浮亏多少，你还能睡得着？',
      hint: '按真实感受选，不用按"应该"选',
      options: [
        { t: '3% 以内', r: 0, s: 0 },
        { t: '10% 以内', r: 1, s: 0 },
        { t: '20% 以内', r: 2, s: 0 },
        { t: '30% 以上都行', r: 3, s: 1 },
      ],
    },
    {
      q: '市场大跌那周，你会',
      hint: '最后一道，看看你是远离市场还是贴着市场',
      options: [
        { t: '卸载软件，不看', r: 1, s: -1, tag: '远离市场' },
        { t: '每天看一次，但不动', r: 2, s: 0 },
        { t: '盯着盘面，想做点什么', r: 2, s: 1 },
        { t: '正好加仓', r: 3, s: 1, tag: '逆向加仓' },
      ],
    },
  ];

  /* ==================== 候选池 ====================
     tier = 波动档（1 最低 ~ 5 最高，按该品类资产的典型波动特征标注，非官方评级）
     style = 风格归属（防守 / 平衡 / 价值 / 进攻）
     硬规则：只有 tier ≤ 用户风险档的候选才可能出现在推荐里。 */
  const CANDIDATES = [
    { code: '511990', name: '华宝添益ETF', cat: '货币', tier: 1, style: '防守',
      why: '随时能用的现金管理，波动接近于零',
      risk: '收益率随市场利率浮动，长期回报远低于权益类资产的潜在水平' },
    { code: '511010', name: '国债ETF国泰', cat: '短久期国债', tier: 1, style: '防守',
      why: '短久期国债，波动很小且有利息票息',
      risk: '利率上行时净值回撤，收益有天花板' },
    { code: '511260', name: '十年国债ETF国泰', cat: '长久期国债', tier: 2, style: '防守',
      why: '利率下行的受益品种，与权益资产低相关',
      risk: '久期长，利率上行时回撤可能明显超预期' },
    { code: '512890', name: '红利低波ETF华泰柏瑞', cat: '红利低波', tier: 2, style: '价值',
      why: '高股息 + 低波动的筛选结果，权益部分里回撤相对温和',
      risk: '长期可能横盘、错过成长行情；行业结构偏向银行与能源' },
    { code: '510880', name: '红利ETF华泰柏瑞', cat: '红利', tier: 2, style: '价值',
      why: '高股息现金流，权益类别里波动最低的一档',
      risk: '行业集中在金融与能源，单一板块调整会放大回撤' },
    { code: '515180', name: '红利ETF易方达', cat: '红利', tier: 2, style: '价值',
      why: '同类的另一只，费率与跟踪误差不同，可作备选',
      risk: '规模较小、流动性弱于同类头部产品' },
    { code: '518880', name: '黄金ETF华安', cat: '黄金', tier: 2, style: '防守',
      why: '不靠利息只靠金价，对冲通胀与地缘冲击',
      risk: '无票息无分红，价格完全取决于金价；金价回撤时同步亏损' },
    { code: '510050', name: '上证50ETF华夏', cat: '大盘蓝筹', tier: 3, style: '价值',
      why: '沪深市值最大的 50 只，成熟龙头的集合',
      risk: '金融与消费占比高、成长性弱，风格切换时滞后' },
    { code: '510300', name: '沪深300ETF华泰柏瑞', cat: '宽基', tier: 3, style: '平衡',
      why: 'A 股最具代表性的宽基，一篮子龙头',
      risk: '跟随整体市场，牛熊同步，没有避风港' },
    { code: '159928', name: '消费ETF汇添富', cat: '消费', tier: 3, style: '平衡',
      why: '需求升级的长期赛道，盈利质量相对高',
      risk: '单一行业集中，政策与消费周期变化影响大' },
    { code: '512690', name: '酒ETF鹏华', cat: '白酒', tier: 3, style: '价值',
      why: '高毛利、高分红的消费龙头集合',
      risk: '极度集中于一个品类，估值杀跌时回撤远超大盘' },
    { code: '561560', name: '电力ETF华泰柏瑞', cat: '公用事业', tier: 3, style: '价值',
      why: '受管制、现金流稳定的防御性资产',
      risk: '成长性有限，利率下行时高股息资产估值承压' },
    { code: '513030', name: '德国ETF华安', cat: '海外宽基', tier: 3, style: '平衡',
      why: '分散单一市场风险，成熟经济体的宽基',
      risk: '汇率波动；QDII 额度受限时可能出现溢价' },
    { code: '510500', name: '中证500ETF南方', cat: '中盘宽基', tier: 4, style: '平衡',
      why: '成长与价值兼顾的中盘宽基',
      risk: '中小盘流动性与波动高于大盘，熊市回撤更深' },
    { code: '512100', name: '中证1000ETF南方', cat: '小盘宽基', tier: 4, style: '进攻',
      why: '小盘弹性，行情上行时弹性最大',
      risk: '小盘股波动大、回撤深，熊市里跌幅远超宽基' },
    { code: '159915', name: '创业板ETF易方达', cat: '成长宽基', tier: 4, style: '进攻',
      why: '成长龙头的集合，弹性与成长性兼备',
      risk: '成长股估值对利率极敏感，利率上行时杀估值' },
    { code: '513100', name: '纳指ETF国泰', cat: '美股科技', tier: 4, style: '进攻',
      why: '全球科技龙头的集合，长期复合能力强',
      risk: '单一市场 + 单一行业，集中度最高；另有汇率与溢价风险' },
    { code: '513500', name: '标普500ETF博时', cat: '美股宽基', tier: 4, style: '平衡',
      why: '500 只美国大公司的集合，跨行业分散',
      risk: '汇率与海外市场波动；QDII 溢价与额度限制' },
    { code: '513180', name: '恒生科技ETF华夏', cat: '港股成长', tier: 4, style: '进攻',
      why: '中国科技资产的直接敞口',
      risk: '政策与流动性冲击大，波动在同类里最剧烈' },
    { code: '159949', name: '创业板50ETF华安', cat: '创业板龙头', tier: 5, style: '进攻',
      why: '创业板头部 50 只，弹性最集中',
      risk: '集中度极高，单一龙头回调即大幅拖累' },
    { code: '588000', name: '科创50ETF华夏', cat: '硬科技', tier: 5, style: '进攻',
      why: '科创板龙头，高研发投入的硬科技集合',
      risk: '估值极高、成分集中，行业调整时回撤远超大盘' },
    { code: '512480', name: '半导体ETF国联安', cat: '半导体', tier: 5, style: '进攻',
      why: '国产替代主题，行业景气上行时弹性最大',
      risk: '强周期，景气反转时跌幅远超大盘，估值波动剧烈' },
    { code: '516160', name: '新能源ETF南方', cat: '新能源', tier: 5, style: '进攻',
      why: '新能源产业链的长期成长主题',
      risk: '依赖政策补贴，存在产能过剩与价格战风险' },
    { code: '515030', name: '新能源车ETF华夏', cat: '新能源车', tier: 5, style: '进攻',
      why: '整车与电池产业链的成长主题',
      risk: '价格战侵蚀行业盈利，个股分化极大' },
    { code: '159766', name: '旅游ETF富国', cat: '旅游消费', tier: 5, style: '进攻',
      why: '出行与消费的复苏弹性',
      risk: '强周期，政策与突发事件驱动，回撤来得快' },
  ];

  const STYLE_LABEL = { 防守: '防守型', 平衡: '平衡型', 进攻: '进取型', 价值: '价值型' };
  const RISK_LABEL = { 1: '很低', 2: '较低', 3: '中等', 4: '中高', 5: '很高' };
  const RISK_DESC = {
    1: '几乎不波动，代价是收益上限也很低',
    2: '波动小，适合放"不能亏"的那部分钱',
    3: '常规水平：能吃下 10%~20% 的浮亏',
    4: '波动明显，需要能承受 20% 以上回撤',
    5: '高波动高弹性，需要能承受 30% 以上回撤且不改变计划',
  };

  /* ==================== 适当性分级（对齐中基协口径）====================
     《基金募集机构投资者适当性管理实施指引（试行）》：普通投资者按风险承受能力
     分为 C1~C5，基金产品按风险从低到高分为 R1~R5，匹配规则是 Cn 可买 Rn 及以下。

     这里把两条轴分开呈现，因为它们回答的是不同的问题：
     · C 级 = **你**能承受多少（由问卷评估，是关于人的）
     · R 级 = **产品**风险多高（上限由 C 级推出，是关于产品的）
     用户在天天基金/蛋卷看到的也是这套词，不对齐就是两套话对不上。

     但要说清一件事：我们的候选池标的标的用的是「波动档」（按品类典型波动特征标注），
     它**不等于** R 级——R 级按资产配置比例划定（看股票仓位），波动档按实际波动。
     两者会不一致：红利 ETF 波动低但股票仓位高，官方 R 级可能到 R4。
     所以面板上两套口径都写出来，不含糊成一句。 */
  const C_LEVELS = {
    1: { code: 'C1', name: '保守型' },
    2: { code: 'C2', name: '相对保守型' },
    3: { code: 'C3', name: '稳健型' },
    4: { code: 'C4', name: '相对积极型' },
    5: { code: 'C5', name: '积极型' },
  };
  const R_LEVELS = {
    1: { code: 'R1', name: '低风险' },
    2: { code: 'R2', name: '中低风险' },
    3: { code: 'R3', name: '中风险' },
    4: { code: 'R4', name: '中高风险' },
    5: { code: 'R5', name: '高风险' },
  };

  function abilityLevel(risk) { return C_LEVELS[risk] || C_LEVELS[1]; }
  function productCap(risk) { return R_LEVELS[risk] || R_LEVELS[1]; }

  /* ==================== 纯逻辑 ==================== */

  /* 评分：answers = {题序号: 选项序号} → { risk, style, caps, tags }
     risk 由"承受度"得分折成 1~5 档，再被"投资期限"给的上限压低（取 min）。
     breakdown 是逐题拆解：把"六道题的答案怎么变成这一档"摊开，
     结果面板要能回答"为什么我是这一档"，而不只是给一个结论。 */
  function score(answers) {
    let r = 0, s = 0, cap = 5;
    const tags = [];
    const breakdown = [];
    QUESTIONS.forEach((q, qi) => {
      const oi = answers && answers[qi];
      if (oi === undefined || oi === null || !q.options[oi]) return;
      const o = q.options[oi];
      r += o.r; s += o.s;
      if (typeof o.cap === 'number') cap = Math.min(cap, o.cap);
      if (o.tag) tags.push(o.tag);
      breakdown.push({
        qi, q: q.q, opt: o.t, r: o.r, s: o.s,
        tag: o.tag || '',
        cap: typeof o.cap === 'number' ? o.cap : null,
      });
    });
    const maxR = QUESTIONS.length * 3;
    let risk = 1 + Math.round((r / maxR) * 4);
    risk = Math.max(1, Math.min(5, risk));
    risk = Math.min(risk, cap);          // 期限闸门：短钱只能拿低波动
    const style = s <= -2 ? '防守' : s >= 2 ? '进攻' : '平衡';
    return { risk, style, rawRisk: r, styleScore: s, cap, tags, breakdown, answered: countAnswered(answers), maxRisk: maxR };
  }

  function countAnswered(answers) {
    let n = 0;
    QUESTIONS.forEach((q, qi) => {
      const oi = answers && answers[qi];
      if (oi !== undefined && oi !== null && q.options[oi]) n++;
    });
    return n;
  }

  /* 推荐：硬性风险闸门 + 风格匹配排序
     ① 候选 tier 必须 ≤ 用户风险档（风险回避的第一条，也是不可绕过的）
     ② 投资期限给的上限已经压进 risk，这里直接用压过的值
     ③ 排序：同风格 > 同档 > 低一档 > 低波动压舱石 */
  function recommend(res) {
    const R = res && res.risk ? res.risk : 1;
    const style = (res && res.style) || '平衡';
    const pool = CANDIDATES.filter(c => c.tier <= R);
    const scored = pool.map(c => {
      let s = 0;
      if (c.style === style) s += 3;
      else if (c.style === '平衡') s += 1;
      if (c.tier === R) s += 2;
      else if (c.tier === R - 1) s += 1;
      else if (c.tier <= 2) s += 0.5;     // 压舱石：低波动那部分钱
      return { c, s };
    });
    scored.sort((a, b) => b.s - a.s || a.c.tier - b.c.tier || a.c.code.localeCompare(b.c.code));
    return scored.slice(0, 6).map(x => x.c);
  }

  /* 结果解读：一段人话，不是模板套话 */
  function profileText(res) {
    const st = STYLE_LABEL[res.style] || '平衡型';
    const rl = RISK_LABEL[res.risk];
    const head = `你落在「${st}」这一档，波动承受度 ${res.risk}/5（${rl}）。`;
    const tail = res.risk <= 2
      ? '清单以低波动品种为主：这类资产的代价是收益上限低，但回撤小、能睡着觉。'
      : res.risk === 3
        ? '清单以宽基为主：拿的是整个市场的平均，涨的时候不会特别突出，跌的时候也一样跟着。'
        : '清单里有弹性更高的品类：它们上涨时更猛，回撤时也更深——请确认你能扛住再点开看。';
    const tagTxt = res.tags && res.tags.length ? `你的答案里有「${res.tags.join('、')}」这类倾向。` : '';
    return head + tail + tagTxt;
  }

  /* ==================== 视图 ==================== */

  let root = null;
  let deps = {};
  let answers = {};          // {题序号: 选项序号}
  let savedAt = 0;           // 这次测评的作答时间（毫秒），用于判断该不该复评
  let el = {};

  const STATE_KEY = 'fundQuiz';

  /* 复评周期：《证券期货投资者适当性管理办法》要求销售机构定期让投资者重新测评，
     行业里常见做法是一年一次。这里按一年算——超期就在结果面板上明说，
     而不是静默沿用一年前的答案（收入、经验、家庭责任都会变，
     适当性评级本来就该跟着变）。 */
  const REVALIDATE_DAYS = 365;

  function ageInfo(at) {
    if (!at) return { days: null, stale: false, text: '' };
    const days = Math.max(0, Math.floor((Date.now() - at) / 86400000));
    if (days <= REVALIDATE_DAYS) return { days, stale: false, text: `作答于 ${days} 天前` };
    return { days, stale: true, text: `这份测评是 ${days} 天前做的` };
  }

  function save() {
    try { window.Store.set(STATE_KEY, { answers, result: score(answers), at: Date.now() }); } catch { /* 隐私模式等 */ }
    savedAt = Date.now();
  }
  function load() {
    try {
      const s = window.Store.get(STATE_KEY, null);
      if (s && s.answers && typeof s.answers === 'object') {
        answers = s.answers;
        savedAt = Number(s.at) || 0;
        return true;
      }
    } catch { /* 忽略 */ }
    return false;
  }

  function mount(node, d) {
    root = node;
    deps = d || {};
    if (!root) return;
    el = {
      intro: root.querySelector('#fqIntro'),
      form: root.querySelector('#fqForm'),
      result: root.querySelector('#fqResult'),
    };
    load();
    render();
  }

  function render() {
    if (!root) return;
    const done = countAnswered(answers);
    const all = done === QUESTIONS.length;
    if (el.intro) el.intro.hidden = all;
    if (el.form) {
      el.form.hidden = !all && done === 0;
      el.form.innerHTML = all ? '' : formHTML(done);
    }
    if (el.result) {
      el.result.hidden = !all;
      el.result.innerHTML = all ? resultHTML(score(answers)) : '';
    }
  }

  /* 题目区：6 题一屏（符合这个产品的密集风格），未答完时"看结果"置灰并提示还差几题 */
  function formHTML(done) {
    const blocks = QUESTIONS.map((q, qi) => {
      const cur = answers[qi];
      const opts = q.options.map((o, oi) =>
        `<button type="button" class="fq-opt${cur === oi ? ' on' : ''}" data-fq-q="${qi}" data-fq-o="${oi}"
          aria-pressed="${cur === oi}">${escapeHTML(o.t)}</button>`).join('');
      return `<fieldset class="fq-q" data-fq-qi="${qi}">
        <legend><span class="fq-num">${qi + 1}</span>${escapeHTML(q.q)}</legend>
        <p class="fq-hint">${escapeHTML(q.hint || '')}</p>
        <div class="fq-opts">${opts}</div>
      </fieldset>`;
    }).join('');
    return `<div class="fq-head">
        <span class="fq-progress">已答 <b class="num">${done}</b> / ${QUESTIONS.length}</span>
        <button type="button" class="pill fq-go" data-fq-go ${done < QUESTIONS.length ? 'disabled' : ''}>
          ${done < QUESTIONS.length ? '还差 ' + (QUESTIONS.length - done) + ' 题' : '看结果'}</button>
      </div>
      <div class="fq-grid">${blocks}</div>`;
  }

  /* 判断依据：把"六道题 → 这一档 → 这份清单"的推导摊开。
     只给结论不给推导，用户没法判断该不该改答案；这也是和那些"黑盒投顾"
     拉开距离的地方——我们把推导过程摆在台面上，而不是让用户猜。 */
  function chainHTML(res, hitCount, shown) {
    const rows = (res.breakdown || []).map(b => {
      const parts = [];
      if (b.r) parts.push(`承受度 +${b.r}`);
      if (b.s > 0) parts.push('风格偏进攻');
      else if (b.s < 0) parts.push('风格偏防守');
      if (b.cap) parts.push(`期限上限 ${b.cap} 档`);
      return `<li class="fq-chain-row">
        <span class="fq-chain-q"><i>${b.qi + 1}</i>${escapeHTML(b.opt)}</span>
        <span class="fq-chain-e">${escapeHTML(parts.join(' · ') || '中性项')}</span>
      </li>`;
    }).join('');
    const ab = abilityLevel(res.risk);
    const rc = productCap(res.risk);
    return `<details class="fq-chain" open>
      <summary>这份清单是怎么算出来的</summary>
      <ol class="fq-chain-list">${rows}</ol>
      <p class="fq-chain-sum">
        承受度合计 <b class="num">${res.rawRisk}/${res.maxRisk}</b> → 风险档 <b class="num">${res.risk}</b>（${ab.code} ${ab.name}）；
        风格合计 <b class="num">${res.styleScore > 0 ? '+' : ''}${res.styleScore}</b> → ${STYLE_LABEL[res.style] || '平衡型'}；
        闸门「候选波动档 ≤ ${res.risk}」命中 ${hitCount} 个品类，按匹配度取前 ${shown} 个。
      </p>
    </details>`;
  }

  function resultHTML(res) {
    const recs = recommend(res);
    const stylePos = res.style === '防守' ? 1 : res.style === '进攻' ? 5 : 3;
    const scale = (pos, n) => Array.from({ length: n }, (_, i) =>
      `<i class="${i + 1 === pos ? 'on' : ''}"></i>`).join('');
    const ab = abilityLevel(res.risk);
    const rc = productCap(res.risk);
    const hitCount = CANDIDATES.filter(c => c.tier <= res.risk).length;
    const age = ageInfo(savedAt);

    const cards = recs.map(c => `<article class="fq-card" data-fq-code="${escapeHTML(c.code)}">
        <div class="fq-card-hd">
          <span class="fq-card-name">${escapeHTML(c.name)}</span>
          <span class="fq-card-code num">${escapeHTML(c.code)}</span>
        </div>
        <div class="fq-card-meta">
          <span class="fq-chip">${escapeHTML(c.cat)}</span>
          <span class="fq-chip fq-tier t${c.tier}">波动档 ${c.tier}/5</span>
        </div>
        <p class="fq-why"><b>为什么给你</b>${escapeHTML(c.why)}</p>
        <p class="fq-risk"><b>主要风险</b>${escapeHTML(c.risk)}</p>
        <button type="button" class="pill fq-open" data-fq-open="${escapeHTML(c.code)}">看画像 →</button>
      </article>`).join('');

    /* 清单短的时候必须说清是"闸门筛的"，不是"没数据"——
       否则用户看到 2 张卡会以为功能坏了。 */
    const tight = recs.length < 4 ? `<p class="fq-tight">你的风险档只放得下 ${recs.length} 个品类。
      这是刻意的：波动档高于你这一档的（更激进的主题基金）不会出现在这里。
      想看更多可选项，回第 1 题调整一下投资期限。</p>` : '';

    /* 复评提示：适当性评级不是永久的。一年前的答案不该被静默沿用。 */
    const stale = age.stale ? `<div class="fq-stale">
        <b>该复评了</b>${escapeHTML(age.text)}。风险承受能力会随收入、经验与家庭责任变化，
        评级也跟着变——重做一次约 1 分钟。
        <button type="button" class="pill fq-again" data-fq-again>重新测评</button>
      </div>` : '';

    return `<div class="fq-verdict">
        <div class="fq-verdict-t">你的风格：<b>${STYLE_LABEL[res.style] || '平衡型'}</b>
          <span class="fq-verdict-r">波动承受 ${res.risk}/5 · ${RISK_LABEL[res.risk]}</span></div>
        <p class="fq-verdict-p">${escapeHTML(profileText(res))}</p>
        <div class="fq-levels">
          <div class="fq-lv"><span class="fq-lv-k">你的风险承受能力</span>
            <span class="fq-lv-v"><b>${ab.code}</b> ${ab.name}</span></div>
          <div class="fq-lv"><span class="fq-lv-k">可买的产品风险上限</span>
            <span class="fq-lv-v"><b>${rc.code}</b> ${rc.name}</span></div>
        </div>
        <p class="fq-lv-note">C/R 分级沿用中基协适当性口径（C1–C5 是投资者、R1–R5 是产品，
          Cn 可买 Rn 及以下），方便和天天基金、蛋卷那边的测评结果对得上话。
          卡片上的“波动档”是按品类典型波动特征标的，与 R 级不是一回事——
          R 级按股票仓位划定，同一只基金两套口径可能不同。</p>
        <div class="fq-dims">
          <div class="fq-dim"><span class="fq-dim-k">风险承受</span>
            <span class="fq-scale">${scale(res.risk, 5)}</span><span class="fq-dim-v num">${res.risk}/5 ${RISK_LABEL[res.risk]}</span></div>
          <div class="fq-dim"><span class="fq-dim-k">收益风格</span>
            <span class="fq-scale">${scale(stylePos, 5)}</span><span class="fq-dim-v num">${STYLE_LABEL[res.style]}</span></div>
        </div>
        <p class="fq-dim-note">${escapeHTML(RISK_DESC[res.risk] || '')}</p>
      </div>
      ${stale}
      ${chainHTML(res, hitCount, recs.length)}
      <div class="fq-warn">
        <b>风险提示</b>　本测评只把你在 ${QUESTIONS.length} 道题上的偏好，映射成一组公开可查的品类清单。
        它不预测收益、不推荐买入、不构成投资建议；历史业绩不代表未来。
        清单里的"波动档"按该品类资产的典型波动特征标注，不是官方评级。
        每只基金的<b>真实回撤、同类排名、规模、资产配置</b>请点"看画像"自己看。
      </div>
      <div class="fq-recs">
        <div class="fq-recs-hd">按匹配度给你 ${recs.length} 个品类<button type="button" class="pill fq-again" data-fq-again>重做测评</button></div>
        ${tight}
        <div class="fq-recs-grid">${cards}</div>
      </div>`;
  }

  /* 事件：委托到根节点，题目选项 / 看结果 / 点开画像 / 重做 */
  function onClick(e) {
    const opt = e.target.closest('[data-fq-o]');
    if (opt) {
      const qi = +opt.getAttribute('data-fq-q'), oi = +opt.getAttribute('data-fq-o');
      answers[qi] = (answers[qi] === oi) ? undefined : oi;   // 再点一次取消
      if (answers[qi] === undefined) delete answers[qi];
      save();
      render();
      return;
    }
    if (e.target.closest('[data-fq-go]')) {
      save();
      render();
      return;
    }
    const open = e.target.closest('[data-fq-open]');
    if (open) {
      const code = open.getAttribute('data-fq-open');
      if (deps.openFund) deps.openFund(code);
      return;
    }
    if (e.target.closest('[data-fq-again]')) {
      answers = {};
      savedAt = 0;
      try { window.Store.set(STATE_KEY, { answers: {} }); } catch { /* 忽略 */ }
      render();
    }
  }

  function reset() {
    answers = {};
    savedAt = 0;
    try { window.Store.set(STATE_KEY, { answers: {} }); } catch { /* 忽略 */ }
    render();
  }

  return {
    QUESTIONS, CANDIDATES, STYLE_LABEL, RISK_LABEL,
    C_LEVELS, R_LEVELS, abilityLevel, productCap, ageInfo, REVALIDATE_DAYS,
    score, recommend, profileText, mount, render, reset, onClick,
    // 渲染函数也导出：结果面板的文案要能离线单测（新加的 C/R 分级与推导链
    // 同样要过一遍"不得出现买入/收益承诺类用语"的合规回归）
    resultHTML, chainHTML,
  };
})();
