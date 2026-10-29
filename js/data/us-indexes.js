/* us-indexes.js —— 美股三大指数成分表（标普500 / 道指30 / 纳指100）
   用途：热力图「美股」模式的指数成分筛选（app.js heatUsIndex）。只存代码——
   名称/市值/涨跌幅/行业都来自东财全市场行（heatItems.us），这里不复制行情字段。
   来源（2026-10-29 抓取）：
   - 标普500：Wikipedia「List of S&P 500 companies」（datasets/s-and-p-500-companies 镜像），503 只
   - 纳指100：Wikipedia「List of NASDAQ-100 companies」原始 wikitext 解析，101 只
   - 道指30：Wikipedia DJIA 组件 navbox（30 家公司 ↔ 代码一一核对），30 只
   更新节奏：成分变化是季度级低频事件，随版本发布手工刷新即可；上次复核 2026-10-29。
   代码匹配用归一化键（去 . 和 -）：BRK.B ↔ BRK-B ↔ BRKB 互认，
   消化东财/腾讯/维基在多类股代码上的写法差异。 */

const US_INDEXES = (() => {
  const LISTS = {
    sp500: [
      'MMM', 'AOS', 'ABT', 'ABBV', 'ACN', 'ADBE', 'AMD', 'AES', 'AFL', 'A',
      'APD', 'ABNB', 'AKAM', 'ALB', 'ARE', 'ALGN', 'ALLE', 'LNT', 'ALL', 'GOOGL',
      'GOOG', 'MO', 'AMZN', 'AMCR', 'AEE', 'AEP', 'AXP', 'AIG', 'AMT', 'AWK',
      'AMP', 'AME', 'AMGN', 'APH', 'ADI', 'AON', 'APA', 'APO', 'AAPL', 'AMAT',
      'APP', 'APTV', 'ACGL', 'ADM', 'ARES', 'ANET', 'AJG', 'AIZ', 'T', 'ATO',
      'ADSK', 'ADP', 'AZO', 'AVY', 'AXON', 'BKR', 'BALL', 'BAC', 'BAX', 'BDX',
      'BRK.B', 'BBY', 'TECH', 'BIIB', 'BLK', 'BX', 'XYZ', 'BE', 'BNY', 'BA',
      'BKNG', 'BSX', 'BMY', 'AVGO', 'BR', 'BRO', 'BF.B', 'BG', 'BXP', 'CHRW',
      'CDNS', 'CPT', 'COF', 'CAH', 'CCL', 'CARR', 'CVNA', 'CASY', 'CAT', 'CBOE',
      'CBRE', 'CDW', 'COR', 'CNC', 'CNP', 'CF', 'CRL', 'SCHW', 'CHTR', 'CVX',
      'CMG', 'CB', 'CHD', 'CIEN', 'CI', 'CINF', 'CTAS', 'CSCO', 'C', 'CFG',
      'CLX', 'CME', 'CMS', 'KO', 'CTSH', 'COHR', 'COIN', 'CL', 'CMCSA', 'FIX',
      'COP', 'ED', 'STZ', 'CEG', 'COO', 'CPRT', 'GLW', 'CPAY', 'CSGP', 'COST',
      'CRH', 'CRWD', 'CCI', 'CSX', 'CMI', 'CVS', 'DHR', 'DRI', 'DDOG', 'DVA',
      'DECK', 'DE', 'DELL', 'DAL', 'DVN', 'DXCM', 'FANG', 'DLR', 'DG', 'DLTR',
      'D', 'DPZ', 'DASH', 'DOV', 'DOW', 'DHI', 'DTE', 'DUK', 'DD', 'ETN',
      'EBAY', 'ECHO', 'ECL', 'EIX', 'EW', 'ELV', 'EME', 'EMR', 'ETR', 'EOG',
      'EQT', 'EFX', 'EQIX', 'ERIE', 'ESS', 'EL', 'EG', 'EVRG', 'P', 'ES',
      'EXC', 'EXE', 'EXPE', 'EXPD', 'EXR', 'XOM', 'FFIV', 'FDS', 'FICO', 'FAST',
      'FRT', 'FDX', 'FDXF', 'FERG', 'FIS', 'FITB', 'FSLR', 'FE', 'FISV', 'FLEX',
      'F', 'FTNT', 'FTV', 'FOXA', 'FOX', 'BEN', 'FCX', 'GRMN', 'IT', 'GE',
      'GEHC', 'GEV', 'GEN', 'GNRC', 'GD', 'GIS', 'GM', 'GPC', 'GILD', 'GPN',
      'GL', 'GDDY', 'GS', 'HAL', 'HIG', 'HAS', 'HCA', 'DOC', 'HSIC', 'HSY',
      'HPE', 'HLT', 'HD', 'HONA', 'HON', 'HRL', 'HST', 'HWM', 'HPQ', 'HUBB',
      'HUM', 'HBAN', 'HII', 'IBM', 'IEX', 'IDXX', 'ITW', 'ILMN', 'INCY', 'IR',
      'PODD', 'INTC', 'IBKR', 'ICE', 'IFF', 'IP', 'INTU', 'ISRG', 'IVZ', 'INVH',
      'IQV', 'IRM', 'JBHT', 'JBL', 'JKHY', 'J', 'JNJ', 'JCI', 'JPM', 'KVUE',
      'KDP', 'KEY', 'KEYS', 'KMB', 'KIM', 'KMI', 'KKR', 'KLAC', 'KHC', 'KR',
      'LHX', 'LH', 'LRCX', 'LVS', 'LDOS', 'LEN', 'LII', 'LLY', 'LIN', 'LYV',
      'LMT', 'L', 'LOW', 'LULU', 'LITE', 'LYB', 'MTB', 'MPC', 'MAR', 'MRSH',
      'MLM', 'MRVL', 'MAS', 'MA', 'MKC', 'MCD', 'MCK', 'MDT', 'MRK', 'META',
      'MET', 'MTD', 'MGM', 'MCHP', 'MU', 'MSFT', 'MAA', 'MRNA', 'MDLZ', 'MPWR',
      'MNST', 'MCO', 'MS', 'MOS', 'MSI', 'MSCI', 'NDAQ', 'NTAP', 'NFLX', 'NEM',
      'NWSA', 'NWS', 'NEE', 'NKE', 'NI', 'NDSN', 'NSC', 'NTRS', 'NOC', 'NCLH',
      'NRG', 'NUE', 'NVDA', 'NVR', 'NXPI', 'ORLY', 'OXY', 'ODFL', 'OMC', 'ON',
      'OKE', 'ORCL', 'OTIS', 'PCAR', 'PKG', 'PLTR', 'PANW', 'PH', 'PAYX', 'PYPL',
      'PNR', 'PEP', 'PFE', 'PCG', 'PM', 'PSX', 'PNW', 'PNC', 'PPG', 'PPL',
      'PFG', 'PG', 'PGR', 'PLD', 'PRU', 'PTC', 'PEG', 'PSA', 'PHM', 'Q',
      'QCOM', 'PWR', 'DGX', 'RL', 'RJF', 'RDDT', 'O', 'REG', 'REGN', 'RF',
      'RSG', 'RMD', 'RVTY', 'HOOD', 'ROK', 'ROL', 'ROP', 'ROST', 'RCL', 'RTX',
      'SPGI', 'CRM', 'SNDK', 'SBAC', 'SLB', 'STX', 'SRE', 'NOW', 'SHW', 'SPG',
      'SKYD', 'SWKS', 'SJM', 'SW', 'SNA', 'SOLV', 'SO', 'LUV', 'SWK', 'SBUX',
      'STT', 'STLD', 'STE', 'SYK', 'SMCI', 'SYF', 'SNPS', 'SYY', 'TMUS', 'TROW',
      'TTWO', 'TPR', 'TRGP', 'TGT', 'TEL', 'TDY', 'TER', 'TSLA', 'TXN', 'TPL',
      'TXT', 'TMO', 'TJX', 'TKO', 'TSCO', 'TT', 'TDG', 'TRV', 'TRMB', 'TFC',
      'TWLO', 'TYL', 'TSN', 'USB', 'UBER', 'UDR', 'ULTA', 'UNP', 'UAL', 'UPS',
      'URI', 'UNH', 'UHS', 'VLO', 'VEEV', 'VTR', 'VLTO', 'VRSN', 'VRSK', 'VZ',
      'VRTX', 'VRT', 'VTRS', 'VICI', 'V', 'VST', 'VMRK', 'VMC', 'VYLR', 'WRB',
      'GWW', 'WAB', 'WMT', 'DIS', 'WM', 'WAT', 'WEC', 'WFC', 'WELL', 'WST',
      'WDC', 'WY', 'WSM', 'WMB', 'WTW', 'WDAY', 'WYNN', 'XEL', 'XYL', 'YUM',
      'ZBRA', 'ZBH', 'ZTS',
    ],
    dj30: [
      'MMM', 'GOOGL', 'AMZN', 'AXP', 'AMGN', 'AAPL', 'BA', 'CAT', 'CVX', 'CSCO',
      'KO', 'DIS', 'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'MCD', 'MRK',
      'MSFT', 'NKE', 'NVDA', 'PG', 'CRM', 'SHW', 'TRV', 'UNH', 'V', 'WMT',
    ],
    ndx100: [
      'ADBE', 'AMD', 'ABNB', 'ALNY', 'GOOGL', 'GOOG', 'AMZN', 'AEP', 'AMGN', 'ADI',
      'AAPL', 'AMAT', 'APP', 'ARM', 'ASML', 'ALAB', 'ADSK', 'ADP', 'AXON', 'BKR',
      'BKNG', 'AVGO', 'CDNS', 'CTAS', 'CSCO', 'CCEP', 'CMCSA', 'CEG', 'CPRT', 'CRWV',
      'COST', 'CRWD', 'CSX', 'DDOG', 'DXCM', 'FANG', 'DASH', 'EXC', 'FAST', 'FER',
      'FTNT', 'GEHC', 'GILD', 'HONA', 'HON', 'IDXX', 'INTC', 'INTU', 'ISRG', 'KDP',
      'KLAC', 'LRCX', 'LIN', 'LITE', 'MAR', 'MRVL', 'MELI', 'META', 'MCHP', 'MU',
      'MSFT', 'MSTR', 'MRNA', 'MDLZ', 'MPWR', 'MNST', 'NBIS', 'NFLX', 'NVDA', 'NXPI',
      'ORLY', 'ODFL', 'PCAR', 'PLTR', 'PANW', 'PAYX', 'PYPL', 'PDD', 'PEP', 'QCOM',
      'REGN', 'RKLB', 'ROP', 'ROST', 'SNDK', 'STX', 'SHOP', 'SPCX', 'SBUX', 'SNPS',
      'TMUS', 'TTWO', 'TER', 'TSLA', 'TXN', 'TRI', 'VRTX', 'WMT', 'WDC', 'WDAY',
      'XEL',
    ],
  };

  const LABELS = { all: '全部', sp500: '标普500', dj30: '道指30', ndx100: '纳指100' };
  const AS_OF = '2026-10-29';

  // 归一化：去交易所写法差异（BRK.B / BRK-B / BRKKB 之类）只剩字母数字
  function norm(code) {
    return String(code || '').toUpperCase().replace(/[.-]/g, '');
  }

  // key → 归一化代码 Set（懒建缓存）。all 恒为 null = 不过滤。
  const _sets = {};
  function members(key) {
    if (key === 'all' || !LISTS[key]) return null;
    if (!_sets[key]) _sets[key] = new Set(LISTS[key].map(norm));
    return _sets[key];
  }

  function includes(key, code) {
    const s = members(key);
    return !s || s.has(norm(code));
  }

  // rows: [{ code, ... }]（东财全市场行）→ 成分内子集。all 原样返回。
  function filter(rows, key) {
    if (key === 'all' || !LISTS[key]) return rows || [];
    const s = members(key);
    return (rows || []).filter(r => r && s.has(norm(r.code)));
  }

  return { LISTS, LABELS, AS_OF, norm, members, includes, filter };
})();

window.US_INDEXES = US_INDEXES;
