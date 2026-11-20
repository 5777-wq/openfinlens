// 核对每个标的在维基百科有没有词条，生成 content/_meta/asset-wiki.json。
// 规矩：
//   1) 候选标题（人工维护，简繁都放）批量确认存在性，命中即用——这是唯一可信来源；
//   2) 搜索兜底只接受「结果包含问句或问句包含结果」的命中，其余一律进 NEEDS 清单等人工加候选词，
//      绝不自动收星表/枪械这类同名杂讯（第一次 dry-run 的教训）；
//   3) 汇率对、国债收益率这类没有单一词条的标的进 EXEMPT，页面不挂链接。
// 复跑：node _scripts/resolve-asset-wiki.mjs [--dry]
//   --dry  只打印结果，不写文件。NEEDS 清单非空时不要写盘。

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { readFile, writeFile } = await import('node:fs/promises');
const path = await import('node:path');

const assetIds = JSON.parse(await readFile(path.join(ROOT, 'content', '_meta', 'asset-ids.json'), 'utf8'));
const dry = process.argv.includes('--dry');

// —— 显示名兜底（series-map 拿不到的那几个指数）——
const NAME_OVERRIDES = {
  'sh000001': '上证综合指数',
  'sh000688': '科创50',
  'sz399001': '深证成指',
  'sz399006': '创业板指',
  'usDJI': '道琼斯工业平均指数',
  'usINX': '标普500',
};

// —— 中文候选标题：候选 1 通常是最稳的写法，简繁变体都放（zh 维基标题简繁混用）——
const ZH_ALIASES = {
  // 港股
  'hk00005': ['滙豐'],
  'hk00016': ['新鴻基地產', '新鸿基地产'],
  'hk00027': ['銀河娛樂', '银河娱乐'],
  'hk00291': ['華潤啤酒', '华润啤酒'],
  'hk00386': ['中国石化', '中國石化'],
  'hk00700': ['騰訊', '腾讯', '腾讯控股'],
  'hk00857': ['中國石油', '中国石油', '中国石油天然气股份有限公司'],
  'hk00883': ['中國海洋石油', '中国海洋石油', '中海油'],
  'hk00939': ['中国建设银行', '中國建設銀行'],
  'hk00941': ['中国移动', '中國移動'],
  'hk01024': ['快手'],
  'hk01113': ['長江實業集團', '長實集團'],
  'hk01299': ['友邦保險', '友邦保险'],
  'hk01398': ['中国工商银行', '中國工商銀行'],
  'hk01810': ['小米集团', '小米集團', '小米公司'],
  'hk02020': ['安踏体育', '安踏體育', '安踏'],
  'hk02318': ['中国平安', '中國平安'],
  'hk03690': ['美团', '美團'],
  'hk03988': ['中国银行', '中國銀行'],
  'hk06618': ['京东健康', '京東健康'],
  'hk06862': ['海底捞', '海底撈'],
  'hk09618': ['京东', '京東'],
  'hk09988': ['阿里巴巴集团', '阿里巴巴集團', '阿里巴巴'],
  'hk09999': ['网易', '網易'],
  'hkHSI': ['恒生指數', '恒生指数'],
  'hkHSTECH': ['恒生科技指數', '恒生科技指数'],
  // A 股
  'sh600028': ['中国石化', '中國石化'],
  'sh600030': ['中信證券', '中信证券'],
  'sh600036': ['招商银行', '招商銀行'],
  'sh600276': ['恒瑞医药', '恆瑞醫藥'],
  'sh600519': ['贵州茅台', '貴州茅台'],
  'sh600900': ['长江电力', '長江電力'],
  'sh601012': ['隆基绿能', '隆基股份', '隆基綠能'],
  'sh601088': ['中国神华能源', '中国神华', '中國神華'],
  'sh601138': ['富士康工業互聯網', '工业富联'],
  'sh601288': ['中国农业银行', '中國農業銀行'],
  'sh601318': ['中国平安', '中國平安'],
  'sh601398': ['中国工商银行', '中國工商銀行'],
  'sh601857': ['中國石油', '中国石油天然气股份有限公司'],
  'sh601888': ['中国中免', '中國中免'],
  'sh601899': ['紫金矿业', '紫金礦業'],
  'sh601988': ['中国银行', '中國銀行'],
  'sh603288': ['海天味业', '海天味業'],
  'sh688981': ['中芯国际', '中芯國際'],
  'sz000002': ['万科', '萬科'],
  'sz000333': ['美的集团', '美的集團'],
  'sz000725': ['京东方', '京東方'],
  'sz000858': ['五粮液', '五糧液'],
  'sz002415': ['海康威视', '海康威視'],
  'sz002475': ['立讯精密', '立訊精密'],
  'sz002594': ['比亚迪', '比亞迪'],
  'sz300059': ['东方财富', '東方財富'],
  'sz300750': ['宁德时代', '寧德時代'],
  'sz300760': ['迈瑞医疗', '邁瑞醫療'],
  // 美股
  'usAAPL': ['蘋果公司', '苹果公司'],
  'usAMD': ['AMD', '超威半导体'],
  'usAMZN': ['亚马逊公司', '亞馬遜公司'],
  'usAVGO': ['博通'],
  'usBA': ['波音'],
  'usCOIN': ['Coinbase'],
  'usDIS': ['华特迪士尼公司', '华特迪士尼', '迪士尼公司', '華特迪士尼公司'],
  'usGOOG': ['Alphabet', '谷歌'],
  'usINTC': ['英特尔', '英特爾'],
  'usJPM': ['摩根大通'],
  'usMETA': ['Meta', 'Facebook'],
  'usMSFT': ['微软', '微軟'],
  'usMU': ['美光科技', '美光'],
  'usNFLX': ['Netflix'],
  'usNVDA': ['英伟达', '英偉達'],
  'usORCL': ['甲骨文公司', '甲骨文'],
  'usPFE': ['辉瑞', '輝瑞'],
  'usQCOM': ['高通'],
  'usTSLA': ['特斯拉'],
  'usTSM': ['台積電', '台积电'],
  'usV': ['Visa公司', 'Visa'],
  'usWMT': ['沃尔玛', '沃爾瑪'],
  'usXOM': ['埃克森美孚'],
  // 指数与大宗商品
  'usDJI': ['道琼斯工业平均指数', '道瓊斯工業平均指數'],
  'usINX': ['标普500指数', '標準普爾500指數', '标准普尔500指数'],
  'usIXIC': ['纳斯达克综合指数', '納斯達克綜合指數'],
  'sh000001': ['上海证券交易所综合股价指数', '上海證券交易所綜合股價指數'],
  'sz399001': ['深证成指', '深證成指', '深证成份指数'],
  'sz399006': ['创业板指', '創業板指', '创业板指数', '创业板指數'],
  'EM:100.FCHI': ['CAC 40指數', 'CAC 40'],
  'EM:100.FTSE': ['富时100指数', '富時100指數'],
  'EM:100.GDAXI': ['DAX指数', 'DAX', '德国DAX指数'],
  'EM:100.KS11': ['KOSPI', '韓國綜合股價指數', '韩国综合股价指数'],
  'EM:100.N225': ['日经平均指数', '日經平均指數'],
  'EM:100.SENSEX': ['BSE SENSEX', 'SENSEX'],
  'EM:100.UDI': ['美元指数', '美元指數'],
  'EM:101.GC00Y': ['金', '黄金', '黃金'],
  'EM:101.HG00Y': ['铜', '銅'],
  'EM:101.SI00Y': ['银', '銀', '白银'],
  'EM:102.CL00Y': ['石油'],
  'EM:102.NG00Y': ['天然气', '天然氣'],
  'EM:103.ZC00Y': ['玉米'],
};

// —— 英文候选（美股 + 有把握的港 A 巨头 + 指数）——
const EN_NAMES = {
  'usAAPL': 'Apple Inc.', 'usAMD': 'AMD', 'usAMZN': 'Amazon (company)',
  'usAVGO': 'Broadcom', 'usBA': 'Boeing', 'usCOIN': 'Coinbase', 'usDIS': 'Walt Disney',
  'usGOOG': 'Alphabet', 'usINTC': 'Intel', 'usJPM': 'JPMorgan Chase', 'usMETA': 'Meta Platforms',
  'usMSFT': 'Microsoft', 'usMU': 'Micron Technology', 'usNFLX': 'Netflix', 'usNVDA': 'Nvidia',
  'usORCL': 'Oracle Corporation', 'usPFE': 'Pfizer', 'usPLTR': 'Palantir',
  'usQCOM': 'Qualcomm', 'usTSLA': 'Tesla, Inc.', 'usTSM': 'TSMC', 'usV': 'Visa Inc.',
  'usWMT': 'Walmart', 'usXOM': 'ExxonMobil',
  'usDJI': 'Dow Jones Industrial Average', 'usINX': 'S&P 500', 'usIXIC': 'Nasdaq Composite',
  'hk00005': 'HSBC', 'hk00016': 'Sun Hung Kai Properties', 'hk00027': 'Galaxy Entertainment Group',
  'hk00291': 'China Resources Beer', 'hk00386': 'Sinopec', 'hk00700': 'Tencent',
  'hk00857': 'PetroChina', 'hk00883': 'CNOOC Group', 'hk00939': 'China Construction Bank',
  'hk00941': 'China Mobile', 'hk01024': 'Kuaishou', 'hk01113': 'CK Asset Holdings',
  'hk01299': 'AIA Group', 'hk01398': 'Industrial and Commercial Bank of China',
  'hk01810': 'Xiaomi', 'hk02020': 'Anta Sports', 'hk02318': 'Ping An Insurance',
  'hk03690': 'Meituan', 'hk03988': 'Bank of China', 'hk06618': 'JD Health',
  'hk06862': 'Haidilao', 'hk09618': 'JD.com', 'hk09988': 'Alibaba Group', 'hk09999': 'NetEase',
  'hkHSI': 'Hang Seng Index', 'hkHSTECH': 'Hang Seng TECH Index',
  'sh600028': 'Sinopec', 'sh600030': 'CITIC Securities', 'sh600036': 'China Merchants Bank',
  'sh600519': 'Kweichow Moutai', 'sh600900': 'China Yangtze Power', 'sh601012': 'LONGi',
  'sh601088': 'China Shenhua Energy', 'sh601288': 'Agricultural Bank of China',
  'sh601318': 'Ping An Insurance', 'sh601398': 'Industrial and Commercial Bank of China',
  'sh601857': 'PetroChina', 'sh601899': 'Zijin Mining', 'sh601988': 'Bank of China',
  'sh603288': 'Haitian', 'sh688981': 'Semiconductor Manufacturing International Corporation',
  'sz000002': 'Vanke', 'sz000333': 'Midea', 'sz000725': 'BOE', 'sz000858': 'Wuliangye',
  'sz002415': 'Hikvision', 'sz002475': 'Luxshare', 'sz002594': 'BYD Company',
  'sz300059': 'East Money', 'sz300750': 'CATL', 'sz300760': 'Mindray',
  'sh000001': 'SSE Composite Index', 'sh000688': 'STAR 50 Index', 'sz399001': 'SZSE Component Index',
  'sz399006': 'ChiNext Index',
  'EM:100.FCHI': 'CAC 40', 'EM:100.FTSE': 'FTSE 100 Index', 'EM:100.GDAXI': 'DAX',
  'EM:100.KS11': 'KOSPI', 'EM:100.N225': 'Nikkei 225', 'EM:100.SENSEX': 'BSE SENSEX',
  'EM:100.UDI': 'U.S. Dollar Index', 'EM:101.GC00Y': 'Gold', 'EM:101.HG00Y': 'Copper',
  'EM:101.SI00Y': 'Silver', 'EM:102.CL00Y': 'Petroleum', 'EM:102.NG00Y': 'Natural gas',
  'EM:103.ZC00Y': 'Maize',
};

// —— 显式豁免：汇率对 / 国债收益率 / 科创50（中英文都没有词条），页面不挂链接 ——
const EXEMPT = new Set([
  'sh000688',
  'EM:119.EURUSD', 'EM:119.GBPUSD', 'EM:119.USDHKD', 'EM:119.USDJPY', 'EM:133.USDCNH',
  'EM:171.CN2Y', 'EM:171.CN5Y', 'EM:171.CN10Y', 'EM:171.CN30Y',
  'EM:171.DE10Y', 'EM:171.JP10Y', 'EM:171.US3M', 'EM:171.US5Y', 'EM:171.US10Y', 'EM:171.US2Y', 'EM:171.US30Y',
]);

const seriesMap = JSON.parse(await readFile(path.join(ROOT, 'data', 'series-map.json'), 'utf8')).series;
function nameOf(sym) {
  if (NAME_OVERRIDES[sym]) return NAME_OVERRIDES[sym];
  const tries = [sym, sym.replace(/^(EM:\d+\.)/, ''), sym.replace(/^(sh|sz|hk|us)/, '')];
  for (const t of tries) {
    const hit = seriesMap.find((x) => x.id === t);
    if (hit && hit.name) return hit.name;
  }
  return sym;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(lang, params) {
  const url = `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=2&` + new URLSearchParams(params);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'openfin-academy-link-check/1.0 (static site curation)' } });
      if (r.status === 429) {
        const wait = (Number(r.headers.get('retry-after')) || 5) + attempt * 3;
        console.warn(`  [429] ${lang} 限流，等 ${wait}s…`);
        await sleep(wait * 1000);
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (e.message.startsWith('HTTP')) throw e;
      if (attempt === 4) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}

// 批量确认标题存在性：返回 Set(归一化 title)（missing / 重定向目标不一致的不进表）。
async function confirmBatch(lang, titles) {
  const found = new Set();
  for (let i = 0; i < titles.length; i += 40) {
    const j = await api(lang, { action: 'query', titles: titles.slice(i, i + 40).join('|'), redirects: 1 });
    for (const p of j.query.pages) if (!p.missing) found.add(p.title);
    await sleep(2000);
  }
  return found;
}

// 搜索只做诊断提示（打印确认存在的候选标题），**绝不自动收**——
// 第一次跑的教训：「hk00005 → HD 200052（Hipparcos 星表）」「AMD → 反垄断诉讼案」都是搜索兜底放进来的。
async function searchHint(lang, text) {
  const j = await api(lang, { action: 'opensearch', search: text, limit: 3, namespace: 0 });
  const hits = (j[1] || []).filter((h) => h && h.length >= 2);
  if (!hits.length) return [];
  const confirm = await confirmBatch(lang, hits);
  return hits.filter((h) => confirm.has(h));
}

// —— 先收全部候选，每语言只发几次批量请求；再对未命中的逐个搜索兜底 ——
const plans = [];
for (const sym of assetIds.symbols) {
  const name = nameOf(sym);
  if (EXEMPT.has(sym)) { plans.push({ sym, name, exempt: true }); continue; }
  const zhCands = [...new Set([...(ZH_ALIASES[sym] || []), name].filter(Boolean))];
  const en = EN_NAMES[sym] || null;
  plans.push({ sym, name, zhCands, enCands: en ? [en] : [] });
}

console.log('批量确认存在性…');
const zhAll = await confirmBatch('zh', plans.flatMap((p) => p.zhCands || []));
const enAll = await confirmBatch('en', plans.flatMap((p) => p.enCands || []));

const results = [];
const needs = [];
for (const plan of plans) {
  if (plan.exempt) { results.push({ sym: plan.sym, name: plan.name, zh: null, en: null, via: 'exempt' }); continue; }
  let zh = plan.zhCands.find((c) => zhAll.has(c)) || null;
  let en = plan.enCands.find((c) => enAll.has(c)) || null;
  const via = [];
  if (zh) via.push('zh:候选');
  if (en) via.push('en:候选');

  if (!zh && plan.name && plan.name.length >= 2) {
    const hints = await searchHint('zh', plan.name);
    if (hints.length) console.log(`  [提示] zh ${plan.sym}（${plan.name}）搜到：${hints.join(' / ')}——确认无误后加进 ZH_ALIASES`);
    await sleep(1500);
  }
  if (!en && plan.enCands.length) {
    const hints = await searchHint('en', plan.enCands[0]);
    if (hints.length) console.log(`  [提示] en ${plan.sym}（${plan.enCands[0]}）搜到：${hints.join(' / ')}——确认无误后改 EN_NAMES`);
    await sleep(1500);
  }
  results.push({ sym: plan.sym, name: plan.name, zh, en, via: via.join(', ') });
  if (!zh && !en) needs.push(plan.sym + '（' + plan.name + '）');
}

console.log('\n===== 复核表 =====');
for (const r of results) {
  const link = r.zh ? `zh:${r.zh}` + (r.en ? ` | en:${r.en}` : '') : (r.en ? `en:${r.en}` : '—');
  console.log(`${r.sym.padEnd(16)} ${r.name.padEnd(14)} ${link}   [${r.via}]`);
}
console.log('\n===== NEEDS（没有任何链接，需要人工补候选词或进豁免表）=====');
console.log(needs.length ? needs.join('\n') : '无');
console.log('\n豁免：', [...EXEMPT].join(', '));

if (!dry && needs.length === 0) {
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: '标的页「延伸阅读」的维基百科深链：标题都经 MediaWiki API 确认存在（重定向已归一）。'
      + '豁免表里的标的（汇率对 / 国债收益率）没有单一词条，页面不挂链接。'
      + '核对与再生成命令：node _scripts/resolve-asset-wiki.mjs',
    exempt: [...EXEMPT],
    symbols: Object.fromEntries(results
      .filter((r) => r.zh || r.en)
      .map((r) => [r.sym, Object.assign(
        r.zh ? { zh: `https://zh.wikipedia.org/wiki/${encodeURIComponent(r.zh)}` } : {},
        r.en ? { en: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.en.replace(/ /g, '_'))}` } : {},
      )])),
  };
  const target = path.join(ROOT, 'content', '_meta', 'asset-wiki.json');
  await writeFile(target, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\n已写出 ' + target + '（' + Object.keys(out.symbols).length + ' 条链接 / ' + out.exempt.length + ' 条豁免）');
} else if (needs.length) {
  console.log('\nNEEDS 非空，没有写盘。先补 ZH_ALIASES / EN_NAMES 或挪进 EXEMPT。');
}
