/* universe.js —— 8 大品类常量表（全部代码已实测返回有效行情，2026-08；港股/美股于 2026-09-15 扩容）
   group: cn / hk / us / index / crypto / fx / commodity / macro
   tab 归属：all / cn / hk / us / crypto / fxmacro */

// 腾讯源（GBK）：A股 / 港股 / 美股 / 全球指数
const TENCENT_UNIVERSE = [
  // A股指数
  { symbol: 'sh000001', group: 'index', tab: 'cn', label: '上证指数' },
  { symbol: 'sz399001', group: 'index', tab: 'cn', label: '深证成指' },
  { symbol: 'sz399006', group: 'index', tab: 'cn', label: '创业板指' },
  { symbol: 'sh000688', group: 'index', tab: 'cn', label: '科创50' },
  // A股权重个股（28 只；2026-09-15 与港股/美股一同扩容——"全部"页去掉残桩后，
  // 各市场 tab 是唯一的列表入口，4 只太薄）
  { symbol: 'sh600519', group: 'cn', tab: 'cn', label: '贵州茅台' },
  { symbol: 'sz300750', group: 'cn', tab: 'cn', label: '宁德时代' },
  { symbol: 'sh601318', group: 'cn', tab: 'cn', label: '中国平安' },
  { symbol: 'sz000858', group: 'cn', tab: 'cn', label: '五粮液' },
  { symbol: 'sh600036', group: 'cn', tab: 'cn', label: '招商银行' },
  { symbol: 'sh601398', group: 'cn', tab: 'cn', label: '工商银行' },
  { symbol: 'sh601288', group: 'cn', tab: 'cn', label: '农业银行' },
  { symbol: 'sh601988', group: 'cn', tab: 'cn', label: '中国银行' },
  { symbol: 'sh600028', group: 'cn', tab: 'cn', label: '中国石化' },
  { symbol: 'sh601857', group: 'cn', tab: 'cn', label: '中国石油' },
  { symbol: 'sz002594', group: 'cn', tab: 'cn', label: '比亚迪' },
  { symbol: 'sh688981', group: 'cn', tab: 'cn', label: '中芯国际' },
  { symbol: 'sh601012', group: 'cn', tab: 'cn', label: '隆基绿能' },
  { symbol: 'sz000333', group: 'cn', tab: 'cn', label: '美的集团' },
  { symbol: 'sh603288', group: 'cn', tab: 'cn', label: '海天味业' },
  { symbol: 'sh600900', group: 'cn', tab: 'cn', label: '长江电力' },
  { symbol: 'sh601899', group: 'cn', tab: 'cn', label: '紫金矿业' },
  { symbol: 'sz000725', group: 'cn', tab: 'cn', label: '京东方A' },
  { symbol: 'sh601138', group: 'cn', tab: 'cn', label: '工业富联' },
  { symbol: 'sz300059', group: 'cn', tab: 'cn', label: '东方财富' },
  { symbol: 'sh600030', group: 'cn', tab: 'cn', label: '中信证券' },
  { symbol: 'sz000002', group: 'cn', tab: 'cn', label: '万科A' },
  { symbol: 'sh601888', group: 'cn', tab: 'cn', label: '中国中免' },
  { symbol: 'sz002415', group: 'cn', tab: 'cn', label: '海康威视' },
  { symbol: 'sh600276', group: 'cn', tab: 'cn', label: '恒瑞医药' },
  { symbol: 'sz300760', group: 'cn', tab: 'cn', label: '迈瑞医疗' },
  { symbol: 'sz002475', group: 'cn', tab: 'cn', label: '立讯精密' },
  { symbol: 'sh601088', group: 'cn', tab: 'cn', label: '中国神华' },
  // 港股（指数 2 + 权重股 24；2026-09-15 由单一"港美"tab 拆为独立"港股"tab 并扩容，
  // 原 4 只太薄，用户在"全部"页只看到 4 行残桩等于没用）
  { symbol: 'hkHSI', group: 'index', tab: 'hk', label: '恒生指数' },
  { symbol: 'hkHSTECH', group: 'index', tab: 'hk', label: '恒生科技' },
  { symbol: 'hk00700', group: 'hk', tab: 'hk', label: '腾讯控股' },
  { symbol: 'hk09988', group: 'hk', tab: 'hk', label: '阿里巴巴' },
  { symbol: 'hk03690', group: 'hk', tab: 'hk', label: '美团' },
  { symbol: 'hk00941', group: 'hk', tab: 'hk', label: '中国移动' },
  { symbol: 'hk00005', group: 'hk', tab: 'hk', label: '汇丰控股' },
  { symbol: 'hk01810', group: 'hk', tab: 'hk', label: '小米集团' },
  { symbol: 'hk09618', group: 'hk', tab: 'hk', label: '京东集团' },
  { symbol: 'hk09999', group: 'hk', tab: 'hk', label: '网易' },
  { symbol: 'hk02318', group: 'hk', tab: 'hk', label: '中国平安' },
  { symbol: 'hk01299', group: 'hk', tab: 'hk', label: '友邦保险' },
  { symbol: 'hk00939', group: 'hk', tab: 'hk', label: '建设银行' },
  { symbol: 'hk01398', group: 'hk', tab: 'hk', label: '工商银行' },
  { symbol: 'hk03988', group: 'hk', tab: 'hk', label: '中国银行' },
  { symbol: 'hk00883', group: 'hk', tab: 'hk', label: '中国海洋石油' },
  { symbol: 'hk00857', group: 'hk', tab: 'hk', label: '中国石油股份' },
  { symbol: 'hk00386', group: 'hk', tab: 'hk', label: '中国石油化工' },
  { symbol: 'hk01024', group: 'hk', tab: 'hk', label: '快手' },
  { symbol: 'hk02020', group: 'hk', tab: 'hk', label: '安踏体育' },
  { symbol: 'hk06618', group: 'hk', tab: 'hk', label: '京东健康' },
  { symbol: 'hk00291', group: 'hk', tab: 'hk', label: '华润啤酒' },
  { symbol: 'hk06862', group: 'hk', tab: 'hk', label: '海底捞' },
  { symbol: 'hk01113', group: 'hk', tab: 'hk', label: '长实集团' },
  { symbol: 'hk00016', group: 'hk', tab: 'hk', label: '新鸿基地产' },
  { symbol: 'hk00027', group: 'hk', tab: 'hk', label: '银河娱乐' },
  // 美股指数
  { symbol: 'usDJI', group: 'index', tab: 'us', label: '道琼斯' },
  { symbol: 'usIXIC', group: 'index', tab: 'us', label: '纳斯达克' },
  { symbol: 'usINX', group: 'index', tab: 'us', label: '标普500' },
  // 美股个股（24 只，同上由"港美"tab 拆出并扩容）
  { symbol: 'usAAPL', group: 'us', tab: 'us', label: '苹果' },
  { symbol: 'usNVDA', group: 'us', tab: 'us', label: '英伟达' },
  { symbol: 'usMSFT', group: 'us', tab: 'us', label: '微软' },
  { symbol: 'usTSLA', group: 'us', tab: 'us', label: '特斯拉' },
  { symbol: 'usAMZN', group: 'us', tab: 'us', label: '亚马逊' },
  { symbol: 'usGOOG', group: 'us', tab: 'us', label: '谷歌' },
  { symbol: 'usMETA', group: 'us', tab: 'us', label: 'Meta' },
  { symbol: 'usAVGO', group: 'us', tab: 'us', label: '博通' },
  { symbol: 'usAMD', group: 'us', tab: 'us', label: '超威半导体' },
  { symbol: 'usNFLX', group: 'us', tab: 'us', label: '奈飞' },
  { symbol: 'usINTC', group: 'us', tab: 'us', label: '英特尔' },
  { symbol: 'usQCOM', group: 'us', tab: 'us', label: '高通' },
  { symbol: 'usTSM', group: 'us', tab: 'us', label: '台积电' },
  { symbol: 'usMU', group: 'us', tab: 'us', label: '美光科技' },
  { symbol: 'usORCL', group: 'us', tab: 'us', label: '甲骨文' },
  { symbol: 'usJPM', group: 'us', tab: 'us', label: '摩根大通' },
  { symbol: 'usV', group: 'us', tab: 'us', label: 'Visa' },
  { symbol: 'usWMT', group: 'us', tab: 'us', label: '沃尔玛' },
  { symbol: 'usDIS', group: 'us', tab: 'us', label: '迪士尼' },
  { symbol: 'usBA', group: 'us', tab: 'us', label: '波音' },
  { symbol: 'usPFE', group: 'us', tab: 'us', label: '辉瑞' },
  { symbol: 'usXOM', group: 'us', tab: 'us', label: '埃克森美孚' },
  { symbol: 'usCOIN', group: 'us', tab: 'us', label: 'Coinbase' },
  { symbol: 'usPLTR', group: 'us', tab: 'us', label: 'Palantir' },
];

// 东财 secid 源：外汇 / 大宗商品 / 宏观利率 / 部分全球指数
const EM_UNIVERSE = [
  // 外汇（m:119 直盘 / m:133 离岸人民币）
  { symbol: 'EM:133.USDCNH', secid: '133.USDCNH', group: 'fx', tab: 'fxmacro', label: '美元离岸人民币' },
  { symbol: 'EM:119.EURUSD', secid: '119.EURUSD', group: 'fx', tab: 'fxmacro', label: '欧元美元' },
  { symbol: 'EM:119.GBPUSD', secid: '119.GBPUSD', group: 'fx', tab: 'fxmacro', label: '英镑美元' },
  { symbol: 'EM:119.USDJPY', secid: '119.USDJPY', group: 'fx', tab: 'fxmacro', label: '美元日元' },
  { symbol: 'EM:119.USDHKD', secid: '119.USDHKD', group: 'fx', tab: 'fxmacro', label: '美元港币' },
  { symbol: 'EM:100.UDI', secid: '100.UDI', group: 'fx', tab: 'fxmacro', label: '美元指数' },
  // 大宗商品
  { symbol: 'EM:101.GC00Y', secid: '101.GC00Y', group: 'commodity', tab: 'fxmacro', label: 'COMEX黄金' },
  { symbol: 'EM:101.SI00Y', secid: '101.SI00Y', group: 'commodity', tab: 'fxmacro', label: 'COMEX白银' },
  { symbol: 'EM:101.HG00Y', secid: '101.HG00Y', group: 'commodity', tab: 'fxmacro', label: 'COMEX铜' },
  { symbol: 'EM:102.CL00Y', secid: '102.CL00Y', group: 'commodity', tab: 'fxmacro', label: 'NYMEX原油' },
  { symbol: 'EM:102.NG00Y', secid: '102.NG00Y', group: 'commodity', tab: 'fxmacro', label: '天然气' },
  { symbol: 'EM:103.ZC00Y', secid: '103.ZC00Y', group: 'commodity', tab: 'fxmacro', label: '玉米连续' },
  // 宏观利率（m:171 国债收益率）
  { symbol: 'EM:171.US10Y', secid: '171.US10Y', group: 'macro', tab: 'fxmacro', label: '美债10年' },
  { symbol: 'EM:171.US2Y', secid: '171.US2Y', group: 'macro', tab: 'fxmacro', label: '美债2年' },
  { symbol: 'EM:171.US30Y', secid: '171.US30Y', group: 'macro', tab: 'fxmacro', label: '美债30年' },
  { symbol: 'EM:171.CN10Y', secid: '171.CN10Y', group: 'macro', tab: 'fxmacro', label: '中债10年' },
  { symbol: 'EM:171.DE10Y', secid: '171.DE10Y', group: 'macro', tab: 'fxmacro', label: '德债10年' },
  { symbol: 'EM:171.JP10Y', secid: '171.JP10Y', group: 'macro', tab: 'fxmacro', label: '日债10年' },
];

// 加密：卡片墙精选 + 热力图全集（币安 USDT 交易对，显式列举避免大响应被截断）
const CRYPTO_FEATURED = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

const CRYPTO_UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT',
  'LINKUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'APTUSDT', 'ICPUSDT',
  'FILUSDT', 'ETCUSDT', 'ATOMUSDT', 'OPUSDT', 'ARBUSDT', 'SUIUSDT', 'INJUSDT', 'SEIUSDT',
  'TIAUSDT', 'RUNEUSDT', 'AAVEUSDT', 'UNIUSDT', 'MKRUSDT', 'ALGOUSDT', 'VETUSDT', 'FTMUSDT',
  'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'GALAUSDT', 'THETAUSDT', 'EOSUSDT', 'XLMUSDT', 'HBARUSDT',
  'EGLDUSDT', 'FLOWUSDT', 'CHZUSDT', 'ZILUSDT', 'ENJUSDT', 'CRVUSDT', 'COMPUSDT', 'SNXUSDT',
  'LDOUSDT', 'GRTUSDT', 'IMXUSDT', 'STXUSDT', 'RENDERUSDT', 'JUPUSDT', 'PYTHUSDT', 'WIFUSDT',
  'PEPEUSDT', 'SHIBUSDT', 'BONKUSDT', 'FLOKIUSDT', 'ORDIUSDT', 'WLDUSDT', 'ARKMUSDT', 'BLURUSDT',
  'DYDXUSDT', 'GMXUSDT', 'ROSEUSDT', 'ONEUSDT', 'IOTAUSDT', 'KAVAUSDT', 'ZRXUSDT', 'BATUSDT',
  'QNTUSDT', 'ANKRUSDT', 'CELOUSDT', 'MINAUSDT', 'RVNUSDT', 'SKLUSDT', 'STORJUSDT', 'WAVESUSDT',
];

// 卡片墙分组显示顺序（品类标题）
const GROUP_META = [
  { key: 'index', label: '全球指数' },
  { key: 'cn', label: 'A股' },
  { key: 'hk', label: '港股' },
  { key: 'us', label: '美股' },
  { key: 'crypto', label: '加密货币' },
  { key: 'fx', label: '外汇' },
  { key: 'commodity', label: '大宗商品' },
  { key: 'macro', label: '宏观利率' },
];

window.TENCENT_UNIVERSE = TENCENT_UNIVERSE;
window.EM_UNIVERSE = EM_UNIVERSE;
window.CRYPTO_FEATURED = CRYPTO_FEATURED;
window.CRYPTO_UNIVERSE = CRYPTO_UNIVERSE;
window.GROUP_META = GROUP_META;
