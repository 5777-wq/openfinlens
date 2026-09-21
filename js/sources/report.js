/* report.js —— 机构研报流（东财 reportapi，实测可用且 CORS: *）
   GET https://reportapi.eastmoney.com/report/list?industryCode=*&pageSize=20&industry=*&rating=*
       &ratingChange=*&beginTime=..&endTime=..&pageNo=1&qType=0&code=*&p=1&pageNum=1
   实测字段：{ title, orgSName, orgName, publishDate("2026-08-25 00:00:00.000"),
              emRatingName(买入/增持/中性/减持), stockName, stockCode, indvInduName, researcher }
   统一输出：{ id, title, org, date(ms), rating, stockName, stockCode, industry }
   边界：只做聚合（列表 + 评级标签 + 个股相关研报），不解析全文/盈利预测。 */

const ReportSource = (() => {
  const { request, num } = window.U;
  const HOST = 'https://reportapi.eastmoney.com/report/list';

  function ymd(d) {
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // publishDate 是北京时间字符串：new Date() 会按浏览器本地时区解析，非 UTC+8 用户
  // 整批时间戳偏移 6~13 小时、与快讯混排错位（news.js beijingToMs 同款教训）。按固定 +8 解析。
  function beijingToMs(s) {
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? '' : s));
    if (!m) return NaN;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 8 * 3600000;
  }

  function toItem(x) {
    return {
      id: x.infoCode || (x.stockCode + x.publishDate + x.orgSName),
      title: String(x.title || '').trim(),
      org: x.orgSName || x.orgName || '',
      date: x.publishDate ? beijingToMs(x.publishDate) : null,
      rating: x.emRatingName || x.sRatingName || '',
      stockName: x.stockName || '',
      stockCode: x.stockCode || '',
      industry: x.indvInduName || x.industryName || '',
      researcher: x.researcher || '',
      // 东财研报详情页
      url: x.infoCode ? 'https://data.eastmoney.com/report/info/' + x.infoCode + '.html' : '',
    };
  }

  // code: '*' = 全市场最新；'600519' = 个股研报
  async function getReports({ code = '*', pageSize = 30 } = {}) {
    const end = new Date();
    const begin = new Date(Date.now() - 180 * 86400000);
    const cacheKey = 'report:' + code;
    try {
      // URL 对象组装：动态值只进 searchParams，不进地址字符串拼接
      const u = new URL(HOST);
      u.searchParams.set('industryCode', '*');
      u.searchParams.set('pageSize', String(pageSize));
      u.searchParams.set('industry', '*');
      u.searchParams.set('rating', '*');
      u.searchParams.set('ratingChange', '*');
      u.searchParams.set('beginTime', ymd(begin));
      u.searchParams.set('endTime', ymd(end));
      u.searchParams.set('pageNo', '1');
      u.searchParams.set('fields', '');
      u.searchParams.set('qType', '0');
      u.searchParams.set('orgCode', '');
      u.searchParams.set('code', String(code));
      u.searchParams.set('rcode', '');
      u.searchParams.set('p', '1');
      u.searchParams.set('pageNum', '1');
      const url = u.href;
      const j = await request(url, { timeout: 9000 });
      const arr = (j && j.data) || [];
      const list = arr.map(toItem).filter(x => x.title);
      if (!list.length) throw new Error('empty');
      window.U.Cache.set(cacheKey, list);
      window.SourceState.ok('report');
      return { list, via: 'eastmoney', cachedAt: null };
    } catch (e) {
      window.SourceState.fail('report', e.message);
      const c = window.U.Cache.raw(cacheKey);
      return c ? { list: c.val, via: 'cache', cachedAt: c.at } : { list: [], via: 'none', cachedAt: null };
    }
  }

  // 评级 → 语义色（买入=涨色 / 增持=签名色 / 中性=灰 / 减持卖出=跌色）
  function ratingClass(rating) {
    const r = String(rating || '');
    if (/买入|强烈推荐|强推/.test(r)) return 'rt-buy';
    if (/增持|推荐|谨慎推荐|优于/.test(r)) return 'rt-add';
    if (/中性|持有|观望/.test(r)) return 'rt-hold';
    if (/减持|卖出|回避|弱于/.test(r)) return 'rt-sell';
    return 'rt-none';
  }

  return { getReports, ratingClass };
})();

window.ReportSource = ReportSource;
