/* lhb.js —— A股龙虎榜（东财数据中心 datacenter-web，免密钥）
   实测（2026-09）：该接口带 Access-Control-Allow-Origin: *，浏览器可直连——
   与 GDELT/SEC 不同，它是国内源，不需要采集层。
   口径（诚实标注）：龙虎榜是交易所披露的营业部/机构席位汇总，日频，不是任何
   个人账户的实时交易；D1/D5 字段是该股历史次日/5日涨跌统计，不是预测。
   降级链：东财 → localStorage 缓存。 */

const LhbSource = (() => {
  const API = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  const COLUMNS = 'SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE,CHANGE_RATE,BILLBOARD_NET_AMT,' +
    'BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_DEAL_AMT,DEAL_NET_RATIO,EXPLANATION,' +
    'TRADE_DATE,MARKET,D1_CLOSE_ADJCHRATE,D5_CLOSE_ADJCHRATE,CLOSE_PRICE';

  // EM secid：m=1 沪，m=0 深北（与 tencentOfSecid 的映射互为镜像）
  function secidOf(row) {
    const code = String(row.SECURITY_CODE || '');
    return (String(row.MARKET).toUpperCase() === 'SH' ? '1.' : '0.') + code;
  }

  async function fetchDate(date) {
    const qs = new URLSearchParams({
      reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
      columns: COLUMNS,
      filter: `(TRADE_DATE='${date}')`,
      // pageSize 曾写 60，而实测单日 70+ 行（2026-09-15 为 73 行）。排序是
      // BILLBOARD_NET_AMT 降序，被截掉的恰恰是"净卖出最多"的那几只——
      // "今天谁在被大举出货"这条最有价值的信息被静默丢弃，榜单系统性偏向净买入。
      // 接口上限 500，取 200 留足余量。
      pageNumber: '1', pageSize: '200',
      sortTypes: '-1', sortColumns: 'BILLBOARD_NET_AMT',
      source: 'WEB', client: 'WEB',
    });
    const j = await window.U.request(API + '?' + qs.toString(), { timeout: 9000 });
    const rows = (j && j.result && j.result.data) || [];
    return rows.map(r => {
      const secid = secidOf(r);
      return {
        secid,
        symbol: 'EM:' + secid,
        code: String(r.SECURITY_CODE || ''),
        name: String(r.SECURITY_NAME_ABBR || r.SECURITY_CODE || ''),
        changePct: window.U.num(r.CHANGE_RATE),
        netAmt: window.U.num(r.BILLBOARD_NET_AMT),
        buyAmt: window.U.num(r.BILLBOARD_BUY_AMT),
        sellAmt: window.U.num(r.BILLBOARD_SELL_AMT),
        dealAmt: window.U.num(r.BILLBOARD_DEAL_AMT),
        netRatio: window.U.num(r.DEAL_NET_RATIO),
        close: window.U.num(r.CLOSE_PRICE),
        d1: window.U.num(r.D1_CLOSE_ADJCHRATE),
        d5: window.U.num(r.D5_CLOSE_ADJCHRATE),
        reason: String(r.EXPLANATION || ''),
        tradeDate: String(r.TRADE_DATE || '').slice(0, 10),
      };
    }).filter(r => r.netAmt !== null);
  }

  /* 取"最近一个有数据的披露日"。节假日/清仓日返回空表就往前找（最多 6 天）。
     降级链兑现：成功时落 Cache（localStorage 持久化，前缀见 utils.Cache._persist），
     全部失败时回缓存兜底——东财 datacenter 有 IP 级封禁前科，一次失败不该把
     几分钟前刚渲染好的榜单清成空表、刷新页面后也不该无兜底。 */
  async function getLhb() {
    const tried = new Set();
    for (let i = 0; i < 6; i++) {
      const date = window.Events.latestLhbDate(Date.now() - i * 86400000);
      if (!date || tried.has(date)) continue;
      tried.add(date);
      let rows = [];
      try { rows = await fetchDate(date); } catch { /* 当日失败继续往前找 */ }
      if (rows.length) {
        window.SourceState.ok('lhb');
        window.U.Cache.set('lhb', { rows, tradeDate: date });
        return { rows, tradeDate: date, via: 'em', at: Date.now() };
      }
    }
    const cached = window.U.Cache.raw('lhb');
    if (cached && cached.val && cached.val.rows && cached.val.rows.length) {
      return { rows: cached.val.rows, tradeDate: cached.val.tradeDate, via: 'cache', at: cached.at };
    }
    window.SourceState.fail('lhb', '东财龙虎榜不可达');
    return { rows: [], tradeDate: null, via: null, at: Date.now() };
  }

  /* 当日全部席位明细（买+卖两页）。单页上限 500（southbound.js 同款）：常态 ~330 行/侧
     一页拿完，极端披露日超 500 行时满页就翻下一页（5 页封顶防异常死循环）。
     返回 { tradeDate, buyRows, sellRows }，喂给 Actors.buildSeatActors 出席位目录。 */
  async function getDayDetails(date) {
    const fetchAll = async (reportName, sortCol) => {
      const onePage = async (page) => {
        const qs = new URLSearchParams({
          reportName, columns: 'ALL',
          filter: `(TRADE_DATE='${date}')`,
          pageNumber: String(page), pageSize: '500',
          sortTypes: '-1', sortColumns: sortCol,
          source: 'WEB', client: 'WEB',
        });
        const j = await window.U.request(API + '?' + qs.toString(), { timeout: 12000 });
        return (j && j.result && j.result.data) || [];
      };
      let page = 1, out = [];
      for (;;) {
        const rows = await onePage(page);
        out = out.concat(rows);
        if (rows.length < 500 || page >= 5) break;
        page++;
      }
      return out;
    };
    const [buyRows, sellRows] = await Promise.all([
      fetchAll('RPT_BILLBOARD_DAILYDETAILSBUY', 'BUY'),
      fetchAll('RPT_BILLBOARD_DAILYDETAILSSELL', 'SELL'),
    ]);
    return { tradeDate: date, buyRows, sellRows };
  }

  /* 单席位历史活动（跨日）：90 天窗口按日期倒序。win.history.test 已实测可用。
     返回原始明细行（买卖各查一次，合并交给 Actors.buildSeatHistory）。 */
  async function getSeatRawHistory(seatCode, sinceDays) {
    const since = new Date(Date.now() - (sinceDays || 90) * 86400000).toISOString().slice(0, 10);
    const one = (reportName, sortCol) => {
      const qs = new URLSearchParams({
        reportName, columns: 'ALL',
        filter: `(OPERATEDEPT_CODE="${seatCode}")(TRADE_DATE>='${since}')`,
        pageNumber: '1', pageSize: '200',
        sortTypes: '-1', sortColumns: sortCol,
        source: 'WEB', client: 'WEB',
      });
      return window.U.request(API + '?' + qs.toString(), { timeout: 12000 });
    };
    const [buy, sell] = await Promise.all([
      one('RPT_BILLBOARD_DAILYDETAILSBUY', 'TRADE_DATE'),
      one('RPT_BILLBOARD_DAILYDETAILSSELL', 'TRADE_DATE'),
    ]);
    return {
      buyRows: (buy && buy.result && buy.result.data) || [],
      sellRows: (sell && sell.result && sell.result.data) || [],
    };
  }

  return { getLhb, fetchDate, secidOf, getDayDetails, getSeatRawHistory };
})();

window.LhbSource = LhbSource;
