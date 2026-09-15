/* eastmoney.js —— A股全市场列表 / 通用报价（外汇·商品·国债收益率）/ K线 / 搜索
   实测（2026-08）：
   - push2.eastmoney.com 直连不可达；push2delay.eastmoney.com 可用且带 CORS 头（含 Origin: null，file:// 也能跑）
   - clist 单页最多返回 100 条（pz>100 被截断为 100）→ 全市场需分页并发
   - searchapi 不带 CORS 头但支持 JSONP（cb=）；search-codetable 支持拼音搜索 + JSONP
   - push2his(K线) 直连不可达 → K线主源用腾讯 ifzq，本文件的 getKline 仅作为备源尝试 */

const EastmoneySource = (() => {
  const { num, request, fetchJSONP } = window.U;
  const HOST = 'https://push2delay.eastmoney.com';
  // 沪深京 A 股：主板 + 创业板 + 深主板 + 科创板
  const FS_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
  /* 港股：必须带类型位。裸 m:116 会混进 1.7 万条权证/牛熊证（名称如"广汽摩通六乙购A"、市值为空），
     t:3=主板 + t:4=GEM，实测 2925 只，都是有市值的正股。 */
  const FS_HK = 'm:116+t:3,m:116+t:4';
  /* 美股：纳斯达克 + 纽交所 + AMEX。含权证（名称带 _WS / Wt、市值为空），
     由"按市值取 Top N"自然滤掉。 */
  const FS_US = 'm:105,m:106,m:107';

  function fieldsToQuote(d) {
    const price = num(d.f2);
    const pct = num(d.f3);
    const chg = num(d.f4);
    const mkt = num(d.f13);
    const code = String(d.f12 || '');
    const secid = mkt !== null ? mkt + '.' + code : code;
    return {
      symbol: 'EM:' + secid,
      secid,
      name: String(d.f14 || code),
      code,
      market: marketOfSecid(secid),
      price,
      prevClose: (price !== null && chg !== null) ? price - chg : null,
      open: num(d.f17), high: num(d.f15), low: num(d.f16),
      change: chg, changePct: pct,
      volume: num(d.f5),
      amount: num(d.f6),
      marketCap: num(d.f20),
      updatedAt: Date.now(),
      source: 'eastmoney',
    };
  }

  function marketOfSecid(secid) {
    const m = +String(secid).split('.')[0];
    if (m === 1 || m === 0) return 'cn';
    if (m === 116 || m === 128 || m === 124) return 'hk';
    if (m === 105 || m === 106 || m === 107) return 'us';
    if (m === 119 || m === 133) return 'fx';
    if (m === 101 || m === 102 || m === 103 || m === 104 || m === 113) return 'commodity';
    if (m === 171) return 'macro';
    if (m === 100) return 'index';
    return 'other';
  }

  // 通用报价：secids = ['119.EURUSD','101.GC00Y','171.US10Y','1.600519', ...]
  async function getQuotes(secids) {
    if (!secids || !secids.length) return [];
    try {
      const url = `${HOST}/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secids.join(',')}` +
        '&fields=f1,f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f20';
      const j = await request(url);
      const diff = j && j.data && j.data.diff;
      if (!diff || !diff.length) { window.SourceState.fail('eastmoney', 'empty'); return []; }
      window.SourceState.ok('eastmoney');
      return diff.map(fieldsToQuote).filter(q => q.price !== null);
    } catch (e) {
      window.SourceState.fail('eastmoney', e.message);
      return [];
    }
  }

  // A股全市场（热力图数据源）：分页并发，每页 100 条
  // in-flight 去重（方法论：Kong/swrv 的请求合并）：热力图与情绪页的调度可能在同一段
  // 时间窗内各自触发全市场抓取（56 页请求），并发期间第二次调用直接共享第一次的 Promise。
  /* 同一时刻只允许"同一市场"有一个全量抓取在飞：并发期间第二次调用共享第一次的 Promise。
     必须按 fs 分桶——A股全市场（56 页）与美股全市场（139 页）是两套完全不同的数据，
     共用一个槽位会让后发者拿到先发者的结果（美股宽度会算出 A股 的数、热力图跟着串）。
     concurrency/maxCount 不参与分桶：同市场的共享在语义上是对的。 */
  const _fullInflight = new Map();
  function getFullMarket(opts) {
    const fs = (opts && opts.fs) || FS_A;
    if (_fullInflight.has(fs)) return _fullInflight.get(fs);
    const p = getFullMarketInner(opts).finally(() => { _fullInflight.delete(fs); });
    _fullInflight.set(fs, p);
    return p;
  }

  async function getFullMarketInner({ maxCount = 6000, concurrency = 12, fs = FS_A } = {}) {
    const mkUrl = (pn) => `${HOST}/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${fs}&fields=f2,f3,f4,f5,f6,f12,f13,f14,f20`;   // f5 成交量(手) f6 成交额(元)：市场宽度要用
    try {
      const first = await request(mkUrl(1));
      const data = first && first.data;
      if (!data || !data.diff) { window.SourceState.fail('em-clist', 'empty'); return []; }
      const total = Math.min(num(data.total) || 0, maxCount);
      const pages = Math.ceil(total / 100);
      const rows = data.diff.slice();

      // 并发拉剩余页（分批，避免一次性打太多）
      let pn = 2;
      while (pn <= pages) {
        const batch = [];
        for (let i = 0; i < concurrency && pn <= pages; i++, pn++) batch.push(pn);
        const res = await Promise.all(batch.map(p =>
          request(mkUrl(p)).then(j => (j && j.data && j.data.diff) || []).catch(() => [])
        ));
        res.forEach(r => rows.push(...r));
      }
      // 盘中按 f3 排序分页抓取时，相邻页之间个股会位移：同一只股可能重复出现。
      // 必须按 code 去重，否则热力图面积虚增、情绪计数虚高（先出现的页码数据更新鲜，保留先到的）
      const seen = new Set();
      const list = rows
        .map(d => ({
          code: String(d.f12 || ''),
          name: String(d.f14 || ''),
          secid: (num(d.f13) !== null ? d.f13 : (String(d.f12).startsWith('6') ? 1 : 0)) + '.' + d.f12,
          price: num(d.f2), changePct: num(d.f3), change: num(d.f4),
          volume: num(d.f5), amount: num(d.f6),
          marketCap: num(d.f20),
        }))
        .filter(x => {
          if (!x.code || x.changePct === null || seen.has(x.code)) return false;
          seen.add(x.code);
          return true;
        });
      if (list.length) window.SourceState.ok('em-clist');
      else window.SourceState.fail('em-clist', 'parsed empty');
      return list;
    } catch (e) {
      window.SourceState.fail('em-clist', e.message);
      return [];
    }
  }

  // 搜索：searchapi(JSONP，中文/代码) + codetable(JSONP，拼音)
  async function search(input) {
    const kw = String(input || '').trim();
    if (!kw) return [];
    const jobs = [
      fetchJSONP('https://searchapi.eastmoney.com/api/suggest/get?input=' +
        encodeURIComponent(kw) + '&type=14&count=10')
        .then(j => {
          const arr = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
          return arr.map(x => ({
            code: x.Code, name: x.Name, secid: x.QuoteID || (x.MktNum + '.' + x.Code),
            marketName: x.SecurityTypeName, classify: x.Classify,
          }));
        }).catch(() => []),
      fetchJSONP('https://search-codetable.eastmoney.com/codetable/search/web?client=web&keyword=' +
        encodeURIComponent(kw) + '&pageIndex=1&pageSize=10')
        .then(j => (j && j.result || []).map(x => ({
          code: x.code, name: x.shortName, secid: x.market + '.' + x.code,
          marketName: x.securityTypeName, classify: '',
        }))).catch(() => []),
    ];
    const [a, b] = await Promise.all(jobs);
    const seen = new Set();
    const out = [];
    [...a, ...b].forEach(x => {
      if (!x.code || !x.secid || seen.has(x.secid)) return;
      seen.add(x.secid);
      out.push(x);
    });
    if (out.length) window.SourceState.ok('em-search');
    return out.slice(0, 10);
  }

  // K线备源（2026-08-31 逐域逐参实测）：
  // - push2delay 直连可达、接口活着，但 dktotal=0 / klines 恒空（delay 镜像不存历史K线）；
  // - push2hisdelay 对 kline 路径一律 302 到官网首页，不承载该 API；
  // - push2his 源本身正常，但本网络直连不可达——配 window.PROXY（Worker）时可用。
  // 结论：外汇/商品/宏观（119/133/101/171 secid）K线无免费直连源，
  // 直连模式下详情页走空态提示；部署 Worker 后由 push2his 接管。
  // 保留 push2delay 在链首：零成本探测，上游若恢复历史数据即自动生效。
  const KLINE_HOSTS = ['https://push2delay.eastmoney.com', 'https://push2his.eastmoney.com'];
  async function getKline(secid, klt = 101, limit = 320) {
    const path = '/api/qt/stock/kline/get?secid=' + secid +
      `&klt=${klt}&fqt=1&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6` +
      '&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
    for (const host of KLINE_HOSTS) {
      try {
        const j = await request(host + path);
        const kl = j && j.data && j.data.klines;
        if (!kl || !kl.length) continue;
        return kl.map(row => {
          const p = row.split(',');
          return {
            time: p[0].length > 10 ? p[0].slice(0, 10) : p[0],
            open: num(p[1]), close: num(p[2]), high: num(p[3]), low: num(p[4]),
            volume: num(p[5]) || 0,
          };
        }).filter(k => k.open !== null && k.close !== null && k.high !== null && k.low !== null);
        // close/high/low 缺失会毒化 MA（NaN）与蜡烛 setData，必须与腾讯源同口径全滤
      } catch { /* 换下一个 host */ }
    }
    return [];
  }

  // 板块涨跌幅排行（2026-09 实测：免密钥、免 ut，push2delay 镜像承载，带 CORS）
  // kind: 'concept' 概念板块(t:3, ~500个) | 'industry' 行业板块(t:2, ~86个)
  // 榜单里混有"昨日连板/昨日打X板/题材股"等**技术分类**，不是真概念 → 名称黑名单过滤
  const BOARD_BAD = /昨日|连板|打板|含一字|次新|题材|ST板块|B股|AH股|融资融券|可转债|新股|GDR/;
  async function getBoardRank(kind = 'concept', limit = 28) {
    const fs = kind === 'industry' ? 'm:90+t:2' : 'm:90+t:3';
    try {
      const url = `${HOST}/api/qt/clist/get?pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f3` +
        `&fs=${fs}&fields=f3,f12,f14,f104,f105,f128,f136`;
      const j = await request(url);
      const diff = j && j.data && j.data.diff;
      if (!diff || !diff.length) { window.SourceState.fail('em-board', 'empty'); return []; }
      const list = diff
        .map(d => ({
          bk: String(d.f12 || ''),
          name: String(d.f14 || ''),
          changePct: num(d.f3),
          up: num(d.f104), down: num(d.f105),
          leadName: d.f128 ? String(d.f128) : '',
          leadPct: num(d.f136),
        }))
        .filter(x => x.bk && x.changePct !== null && !BOARD_BAD.test(x.name));
      if (list.length) window.SourceState.ok('em-board');
      else window.SourceState.fail('em-board', 'parsed empty');
      return list.slice(0, limit);
    } catch (e) {
      window.SourceState.fail('em-board', e.message);
      return [];
    }
  }

  // 板块成分股（fs=b:BKxxxx），按涨跌幅降序：概念榜点开兜底用（未匹配到人工链条时）
  async function getBoardStocks(bk, limit = 12) {
    const code = String(bk || '');
    if (!/^BK\d{4,6}$/.test(code)) return [];   // 入参白名单：只接受 BK 代码
    try {
      const url = `${HOST}/api/qt/clist/get?pn=1&pz=${Math.min(+limit || 12, 100)}&po=1&np=1` +
        `&fltt=2&invt=2&fid=f3&fs=b:${code}&fields=f2,f3,f12,f13,f14`;
      const j = await request(url);
      const diff = j && j.data && j.data.diff;
      if (!diff || !diff.length) { window.SourceState.fail('em-board', 'empty'); return []; }
      return diff
        .map(d => ({
          secid: num(d.f13) !== null ? d.f13 + '.' + d.f12 : String(d.f12),
          code: String(d.f12 || ''),
          name: String(d.f14 || ''),
          price: num(d.f2), changePct: num(d.f3),
        }))
        .filter(x => x.code && x.name);
      // 注意：price/changePct 允许 null——深夜清算时段东财把 f2/f3 返回 "-"，
      // 若按数值过滤会整页清空；前端对 null 显示 "--"
    } catch (e) {
      window.SourceState.fail('em-board', e.message);
      return [];
    }
  }

  return { getQuotes, getFullMarket, search, getKline, getBoardRank, getBoardStocks, marketOfSecid,
    FS_A, FS_HK, FS_US };
})();

window.EastmoneySource = EastmoneySource;
