/* news.js —— 新闻流：新浪滚动(主) + 东财新闻(备)
   实测（2026-08）：
   - 新浪 feed.mix.sina.com.cn/api/roll/get 无 CORS 头 → 但支持 callback= JSONP，走 JSONP 可直连
     字段：result.data[] { title, url, ctime(Unix秒), intro, media_name, docid }
   - 东财 np-listapi 需要 req_trace 参数，否则报 "Required String parameter 'req_trace' is not present"
     字段：data.list[] { title, uniqueUrl, showTime("YYYY-MM-DD HH:mm:ss"), summary, mediaName, code }
   统一输出：{ id, title, url, time(ms), source, summary } */

const NewsSource = (() => {
  const { fetchJSONP, request, num } = window.U;

  // 新浪频道：lid 2516 财经滚动 / 2517 国内 / 2518 国际 / 2519 证券
  const SINA_LIDS = [2516, 2519];

  async function fromSina(num_ = 50) {
    const jobs = SINA_LIDS.map(lid =>
      fetchJSONP(`https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=${num_}&page=1`, 'callback', 9000)
        .then(j => (j && j.result && j.result.data) || [])
        .catch(() => [])
    );
    const parts = await Promise.all(jobs);
    const out = [];
    parts.flat().forEach(it => {
      if (!it || !it.title || !it.url) return;
      out.push({
        id: 'sina:' + (it.docid || it.url),
        title: String(it.title).trim(),
        url: it.url,
        time: (num(it.ctime) || 0) * 1000,
        source: it.media_name || '新浪财经',
        summary: String(it.intro || '').trim(),
      });
    });
    return out;
  }

  // 东财 showTime 是北京时间字符串：new Date() 会按浏览器本地时区解析，
  // 非 UTC+8 用户整批时间戳偏移、与新浪（epoch 秒）混排错位。按固定 +8 解析。
  function beijingToMs(s) {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? '' : s));
    if (!m) return NaN;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 8 * 3600000;
  }

  async function fromEastmoney(size = 30) {
    // column 348 实测可用（财经要闻）
    const trace = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const url = 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col' +
      `&column=348&order=1&needInteractData=0&page_index=1&page_size=${size}&req_trace=${trace}&fields=&types=1,20`;
    const j = await request(url, { timeout: 9000 });
    const list = (j && j.data && j.data.list) || [];
    return list.filter(it => it && it.title).map(it => ({
      id: 'em:' + (it.code || it.uniqueUrl),
      title: String(it.title).trim(),
      url: it.uniqueUrl || it.url,
      time: it.showTime ? beijingToMs(it.showTime) : Date.now(),
      source: it.mediaName || '东方财富',
      summary: String(it.summary || '').trim(),
    }));
  }

  // 主源 → 备源 → 缓存（60s）
  async function getNews() {
    try {
      const list = await fromSina();
      if (list.length) {
        const merged = dedupe(list);
        window.U.Cache.set('news', merged);
        window.SourceState.ok('news', 'sina');
        return { list: merged, via: 'sina', cachedAt: null };
      }
      throw new Error('sina empty');
    } catch (e1) {
      try {
        const list = await fromEastmoney();
        if (list.length) {
          const merged = dedupe(list);
          window.U.Cache.set('news', merged);
          window.SourceState.ok('news', 'eastmoney');
          return { list: merged, via: 'eastmoney', cachedAt: null };
        }
        throw new Error('em empty');
      } catch (e2) {
        window.SourceState.fail('news', e2.message);
        const c = window.U.Cache.raw('news');
        return c ? { list: c.val, via: 'cache', cachedAt: c.at } : { list: [], via: 'none', cachedAt: null };
      }
    }
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    list.forEach(it => {
      const key = it.title.slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(it);
    });
    return out.sort((a, b) => b.time - a.time);
  }

  // 市场分类关键词（加密不单独接源，按关键词过滤）
  const KEYWORDS = {
    crypto: ['比特币', 'BTC', '以太坊', 'ETH', '加密', '虚拟货币', '数字货币', '稳定币', 'USDT', '区块链', '币圈'],
    cn: ['A股', '沪指', '深证', '创业板', '科创板', '上证', '证监会', '北向', '两市', '涨停', '央行', '人民币', '国常会', '公募', '私募'],
    global: ['美股', '纳斯达克', '道琼斯', '标普', '恒指', '港股', '美联储', '联储', '非农', 'CPI', '英伟达', '特斯拉', '苹果', '欧元', '日元', '黄金', '原油'],
  };
  function matchMarket(item, market) {
    if (!market || market === 'all') return true;
    const keys = KEYWORDS[market];
    if (!keys) return true;
    const text = item.title + ' ' + (item.summary || '');
    return keys.some(k => text.toUpperCase().includes(k.toUpperCase()));
  }

  // 产业链板块分类（与 app.js 概念榜的 CHAIN_HINTS 同一图谱口径，文案偏新闻）
  const CHAIN_KW = {
    nev: ['新能源车', '汽车整车', '汽车', '充电桩', '动力电池', '锂电', '锂矿', '固态电池', '智能驾驶', '自动驾驶', '蔚来', '理想汽车', '小鹏'],
    semicon: ['半导体', '芯片', '光刻', '集成电路', '晶圆', '存储', '封测', '中芯'],
    ai: ['算力', '人工智能', 'AIGC', '大模型', 'ChatGPT', 'OpenAI', '光模块', '数据中心', '英伟达', 'AI'],
    pv: ['光伏', '太阳能', '钙钛矿', '硅料', '硅片', '组件', '逆变器'],
    consumer: ['消费电子', '苹果', 'iPhone', '手机', '面板', 'OLED', '折叠屏', '耳机', 'Vision'],
    pharma: ['创新药', '医药', 'CXO', 'CRO', '疫苗', '医疗器械', '中药', '减肥药', 'GLP'],
    defense: ['军工', '航天', '卫星', '大飞机', '船舶', '军工', '无人机', '核聚变'],
    robot: ['机器人', '减速器', '人形', '伺服', '执行器'],
    storage: ['储能', '虚拟电厂', '特高压', '电网', '电力', '核电'],
    xinchuang: ['信创', '国产软件', '操作系统', '数据库', '网络安全', '华为', '鸿蒙', '国资云', '数据要素'],
    macro: ['美联储', '联储', '央行', '降息', '加息', '通胀', 'CPI', 'PPI', 'GDP', '非农', '关税', '国债', '汇率', 'PMI', 'LPR', '社融'],
  };
  // 板块分类：返回 {id, hit}；命中多板块时取关键词最长者（更具体）
  function classify(item) {
    const text = (item.title + ' ' + (item.summary || '')).toUpperCase();
    // ≤4 位纯英文词按整词匹配：裸 includes 会让 'AI' 命中 TAIWAN/THAILAND/SAID
    //（'TAIWAN'.includes('AI') 为真），成批新闻被错挂 AI 板块
    const words = new Set(text.split(/[^A-Z0-9]+/).filter(Boolean));
    let best = null;
    Object.keys(CHAIN_KW).forEach(id => {
      CHAIN_KW[id].forEach(kw => {
        const K = kw.toUpperCase();
        const hit = /^[A-Z0-9]{1,4}$/.test(K) ? words.has(K) : text.includes(K);
        if (hit && (!best || kw.length > best.hit.length)) best = { id, hit: kw };
      });
    });
    return best ? best.id : null;
  }

  // 大V喊单名单：推特爱喊单的那批人（新闻聚合口径——免费无推特 API，用"关于他们的新闻"替代原始推文）
  // en: 英文名 / title: 公开身份（徽章展示用）；yelen 已卸任，财长按 2026 现任为 Bessent
  const VOICES = [
    { id: 'musk', name: '马斯克', en: 'Elon Musk', title: '特斯拉 / SpaceX CEO', kws: ['马斯克', 'Musk', 'SpaceX', '星链', '星舰'], flag: 'us' },
    { id: 'trump', name: '特朗普', en: 'Donald Trump', title: '美国总统', kws: ['特朗普', 'Trump', ' Truth Social'], flag: 'us' },
    { id: 'huang', name: '黄仁勋', en: 'Jensen Huang', title: 'NVIDIA 总裁兼 CEO', kws: ['黄仁勋', '英伟达', 'NVIDIA', 'Jensen Huang'], flag: 'us' },
    { id: 'altman', name: '奥尔特曼', en: 'Sam Altman', title: 'OpenAI CEO', kws: ['奥尔特曼', '奥特曼', 'Altman', 'OpenAI'], flag: 'us' },
    { id: 'powell', name: '鲍威尔', en: 'Jerome Powell', title: '美联储主席', kws: ['鲍威尔', 'Powell', '美联储主席'], flag: 'us' },
    { id: 'cook', name: '库克', en: 'Tim Cook', title: 'Apple CEO', kws: ['库克', 'Tim Cook', '苹果CEO'], flag: 'us' },
    { id: 'bezos', name: '贝索斯', en: 'Jeff Bezos', title: 'Amazon 创始人', kws: ['贝索斯', 'Bezos', '亚马逊创始人'], flag: 'us' },
    { id: 'zuck', name: '扎克伯格', en: 'Mark Zuckerberg', title: 'Meta CEO', kws: ['扎克伯格', 'Zuckerberg', 'Meta CEO'], flag: 'us' },
    { id: 'bessent', name: '贝森特', en: 'Scott Bessent', title: '美国财长', kws: ['贝森特', 'Bessent', '美财长'], flag: 'us' },
    { id: 'lagarde', name: '拉加德', en: 'Christine Lagarde', title: '欧洲央行行长', kws: ['拉加德', 'Lagarde', '欧洲央行行长'], flag: 'eu' },
  ];
  // 命中名单：一条新闻可能涉及多人（如"马斯克回应特朗普"）
  function matchVoices(item) {
    const text = item.title + ' ' + (item.summary || '');
    return VOICES.filter(v => v.kws.some(k => text.toUpperCase().includes(k.toUpperCase())));
  }

  // 喊单页用更大新闻池（三频道并发），复用同样的解析与去重
  async function getNewsPool(size = 60) {
    const jobs = [
      fromSina(size).catch(() => []),
      fromEastmoney(size).catch(() => []),
    ];
    const parts = await Promise.all(jobs);
    return dedupe(parts.flat());
  }

  return { getNews, matchMarket, classify, matchVoices, getNewsPool, fromSina, fromEastmoney, VOICES, CHAIN_KW };
})();

window.NewsSource = NewsSource;
