#!/usr/bin/env node
/* collect-events.mjs —— 全球事件采集任务（跑在 GitHub Actions / 本地，浏览器永远不执行）
   流程：GDELT DOC 2.0 (artlist) → 清洗 → 去重 → 地理定位 → 重要性评分 → relatedSymbols
        → data/events/global-events.json（随仓库提交，前端只读这份静态 JSON）。
   原则：宁缺毋假——所有查询都失败时退出码 1 且绝不改写旧文件；定位不到的事件坐标为
   null（列表可见、地球不画点），不猜测。复用 js/events.js 的纯函数（去重键/标的映射）。 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Events = require('../js/events.js');

const OUT = path.join(ROOT, 'data', 'events', 'global-events.json');
const API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const WINDOW_HOURS = 6;
const CAP = 220;

/* 六类查询，覆盖第一版重点：macro / geopolitics / policy / central_bank / trade / conflict */
const QUERIES = [
  { type: 'central_bank', q: '("federal reserve" OR FOMC OR "rate decision" OR "european central bank" OR "bank of japan" OR "people\'s bank of china" OR "central bank") sourcelang:english' },
  { type: 'macro', q: '(inflation OR CPI OR "gross domestic product" OR recession OR "rate hike" OR "rate cut" OR unemployment) sourcelang:english' },
  { type: 'trade', q: '(tariff OR "trade war" OR "export controls" OR embargo OR "trade agreement" OR customs) sourcelang:english' },
  { type: 'conflict', q: '(airstrike OR "missile strike" OR ceasefire OR invasion OR "military offensive" OR "drone attack") sourcelang:english' },
  { type: 'geopolitics', q: '(sanctions OR summit OR "peace talks" OR NATO OR treaty OR diplomacy) sourcelang:english' },
  { type: 'macro', q: '(OPEC OR "crude output" OR "oil production" OR "natural gas prices" OR "energy prices") sourcelang:english' },
];

/* 地理定位：标题正则 → (国家, 首都/代表城市坐标)。按特异性排序（先长词后短词），
   命中即止。覆盖第一版重点地区；匹配不到 → lat/lng = null（不编位置）。 */
const PLACES = [
  [/hong kong/i, '香港', 22.32, 114.17],
  [/taiwan|taipei/i, '台湾', 25.03, 121.57],
  [/ukraine|kyiv|kiev/i, '乌克兰', 50.45, 30.52],
  [/russia|moscow|kremlin|putin/i, '俄罗斯', 55.76, 37.62],
  [/israel|gaza|tel aviv|jerusalem/i, '以色列', 32.08, 34.78],
  [/iran|tehran/i, '伊朗', 35.69, 51.39],
  [/saudi|riyadh/i, '沙特', 24.71, 46.68],
  [/opec|vienna/i, '奥地利', 48.21, 16.37],
  // 中国排在 united states 之前：英文快讯常同时出现 "China" 与 "U.S."，
  // 美国规则在前会把中国事件抢走到美国坐标（四轮后用户复现"点击事件老是放到美国"）
  [/china|chinese|beijing|shanghai|shenzhen|pboc|yuan|renminbi/i, '中国', 39.904, 116.407],
  [/united states|u\.s\.|washington|white house|new york|federal reserve|wall street/i, '美国', 38.895, -77.036],
  [/canada|ottawa/i, '加拿大', 45.42, -75.70],
  [/mexico/i, '墨西哥', 19.43, -99.13],
  [/brazil|brasilia/i, '巴西', -15.79, -47.88],
  [/argentina/i, '阿根廷', -34.60, -58.38],
  [/united kingdom|britain|london|boe|bank of england/i, '英国', 51.51, -0.13],
  [/france|paris/i, '法国', 48.86, 2.35],
  [/germany|berlin|bundesbank/i, '德国', 52.52, 13.40],
  [/european union|eurozone|brussels|ecb|european central bank|frankfurt/i, '欧元区', 50.11, 8.68],
  [/switzerland|swiss|davos/i, '瑞士', 46.94, 7.45],
  [/spain|madrid/i, '西班牙', 40.42, -3.70],
  [/italy|rome/i, '意大利', 41.90, 12.50],
  [/poland|warsaw/i, '波兰', 52.23, 21.01],
  [/turkey|ankara|istanbul/i, '土耳其', 39.93, 32.86],
  [/india|delhi|mumbai|reserve bank of india/i, '印度', 28.61, 77.21],
  [/japan|tokyo|bank of japan|boj/i, '日本', 35.68, 139.69],
  // 朝鲜必须在韩国之前：/korea/ 是 north korea 的子串，放后面会把朝鲜新闻全判到首尔坐标
  [/north korea|pyongyang/i, '朝鲜', 39.02, 125.75],
  [/south korea|seoul|korea/i, '韩国', 37.57, 126.98],
  [/australia|canberra|reserve bank of australia/i, '澳大利亚', -35.28, 149.13],
  [/singapore/i, '新加坡', 1.35, 103.82],
  [/indonesia|jakarta/i, '印度尼西亚', -6.21, 106.85],
  [/vietnam|hanoi/i, '越南', 21.03, 105.85],
  [/pakistan|islamabad/i, '巴基斯坦', 33.68, 73.05],
  [/nigeria|abuja/i, '尼日利亚', 9.06, 7.49],
  [/egypt|cairo/i, '埃及', 30.04, 31.24],
  [/south africa|pretoria|johannesburg/i, '南非', -25.75, 28.19],
  [/netherlands|amsterdam|dutch/i, '荷兰', 52.37, 4.90],
  [/sweden|stockholm|riksbank/i, '瑞典', 59.33, 18.07],
  [/norway|oslo/i, '挪威', 59.91, 10.75],
  [/denmark|copenhagen/i, '丹麦', 55.68, 12.57],
  [/finland|helsinki/i, '芬兰', 60.17, 24.94],
  [/portugal|lisbon/i, '葡萄牙', 38.72, -9.14],
  [/greece|athens/i, '希腊', 37.98, 23.73],
  [/hungary|budapest/i, '匈牙利', 47.50, 19.04],
  [/czech|prague/i, '捷克', 50.08, 14.44],
  [/romania|bucharest/i, '罗马尼亚', 44.43, 26.10],
  [/kazakhstan|astana/i, '哈萨克斯坦', 51.17, 71.43],
  [/uae|dubai|abu dhabi|emirates/i, '阿联酋', 24.47, 54.37],
  [/qatar|doha/i, '卡塔尔', 25.29, 51.53],
  [/thailand|bangkok/i, '泰国', 13.76, 100.50],
  [/malaysia|kuala lumpur/i, '马来西亚', 3.14, 101.69],
  [/philippines|manila/i, '菲律宾', 14.60, 120.98],
  [/new zealand|wellington/i, '新西兰', -41.29, 174.78],
  [/chile|santiago/i, '智利', -33.45, -70.67],
  [/colombia|bogota/i, '哥伦比亚', 4.71, -74.07],
  [/peru|lima/i, '秘鲁', -12.05, -77.04],
  [/kenya|nairobi/i, '肯尼亚', -1.29, 36.82],
];

/* 重要性：同事件跨源重复 ≥3 = high；白名单大社 = 至少 med；其余 low/med */
const TOP_SOURCES = /reuters|bloomberg|apnews|associated press|wsj|wall street journal|ft\.com|financial times|cnbc|bbc|nytimes|cnn|aljazeera/i;

/* ---- 第二来源：新浪财经 7x24 快讯（国内可达，GDELT 不可达时的兜底/补充）----
   只收全球宏观/地缘条目（GLOBAL_RE 命中），A股个股快讯不进地球；坐标与类型按
   中文关键词映射，匹配不到就是 null（列表可见、地球不画点），绝不编位置。 */
const SINA_API = 'https://zhibo.sina.com.cn/api/zhibo/feed';
const GLOBAL_RE = /美联储|FOMC|鲍威尔|加息|降息|利率决议|存款准备金|LPR|逆回购|欧央行|欧洲央行|日本央行|英国央行|澳大利亚联储|加拿大央行|土耳其里拉|关税|贸易战|贸易谈判|出口管制|芯片法案|制裁|地缘|大选|选举|特朗普|拜登|议会|OPEC|原油|石油减产|天然气|黄金|国债收益率|非农|CPI|PPI|GDP|PMI|通胀|通缩|衰退|失业率|IMF|世界银行|G7|G20|北约|欧盟|联合国|安理会|俄乌|乌克兰|俄罗斯|加沙|以色列|伊朗|朝鲜|韩国|台海|南海|东海|日本|印度|汇市|人民币汇率|美元指数|比特币|以太坊|地震|飓风|台风|罢工|封锁|坠机|爆炸|意大利|西班牙|葡萄牙|希腊|荷兰|瑞士|瑞典|挪威|丹麦|芬兰|波兰|匈牙利|捷克|土耳其|哈萨克斯坦|阿联酋|迪拜|卡塔尔|泰国|马来西亚|菲律宾|印尼|越南|新西兰|澳大利亚|巴西|阿根廷|墨西哥|智利|秘鲁|哥伦比亚|南非|尼日利亚|埃及|肯尼亚|摩洛哥/i;
const HIGH_IMPACT_RE = /美联储|加息|降息|关税|非农|CPI|制裁|停火|袭击|地震|退出|违约|减产/i;
const CN_TYPE_RULES = [
  [/美联储|FOMC|鲍威尔|加息|降息|利率决议|欧央行|欧洲央行|日本央行|英国央行|澳大利亚联储|加拿大央行|中国人民银行|央行/, 'central_bank'],
  [/关税|贸易战|贸易谈判|出口管制|芯片法案/, 'trade'],
  [/空袭|导弹|停火|袭击|入侵|军事|俄乌|加沙|坠机|爆炸/, 'conflict'],
  [/CPI|PPI|GDP|PMI|非农|通胀|通缩|衰退|失业率|IMF|世界银行/, 'macro'],
  [/制裁|大选|选举|峰会|北约|联合国|安理会|台海|南海|东海|外交|条约/, 'geopolitics'],
];
const CN_TYPE_RULES_2 = [
  [/OPEC|原油|石油|天然气|减产/, 'macro'],
  [/黄金|国债收益率|美元指数|汇市|人民币汇率|比特币|以太坊/, 'market'],
];
function classifyCn(t) {
  for (const [re, type] of CN_TYPE_RULES) if (re.test(t)) return type;
  for (const [re, type] of CN_TYPE_RULES_2) if (re.test(t)) return type;
  return 'market';
}
/* 中文地名/主体 → (国家, 代表坐标)。特异性高的排在前面；命中即止。
   覆盖 ~45 国：东亚/东南亚/南亚/中东/欧洲/拉美/非洲，日本·韩国·欧洲列在"中国"之前防误配。 */
const CJK_PLACES = [
  [/香港/i, '香港', 22.32, 114.17],
  [/台湾|台北|台海/i, '台湾', 25.03, 121.57],
  [/乌克兰|基辅|俄乌/i, '乌克兰', 50.45, 30.52],
  [/俄罗斯|莫斯科|普京|克里姆林/i, '俄罗斯', 55.76, 37.62],
  [/以色列|加沙|特拉维夫|内塔尼亚胡/i, '以色列', 32.08, 34.78],
  [/伊朗|德黑兰/i, '伊朗', 35.69, 51.39],
  [/沙特|利雅得/i, '沙特', 24.71, 46.68],
  [/阿联酋|迪拜|阿布扎比/i, '阿联酋', 24.47, 54.37],
  [/卡塔尔|多哈/i, '卡塔尔', 25.29, 51.53],
  [/OPEC|维也纳/i, '奥地利', 48.21, 16.37],
  [/朝鲜|平壤/i, '朝鲜', 39.02, 125.75],
  [/韩国|首尔|韩元/i, '韩国', 37.57, 126.98],
  [/日本|东京|日经|日本央行|日元/i, '日本', 35.68, 139.69],
  [/印度|新德里|孟买|印度央行|卢比/i, '印度', 28.61, 77.21],
  [/澳大利亚|堪培拉|澳洲联储|悉尼/i, '澳大利亚', -35.28, 149.13],
  [/新西兰|惠灵顿|新西兰联储/i, '新西兰', -41.29, 174.78],
  [/新加坡/i, '新加坡', 1.35, 103.82],
  [/越南|河内|胡志明市/i, '越南', 21.03, 105.85],
  [/泰国|曼谷|泰国央行/i, '泰国', 13.76, 100.50],
  [/马来西亚|吉隆坡/i, '马来西亚', 3.14, 101.69],
  [/菲律宾|马尼拉/i, '菲律宾', 14.60, 120.98],
  [/印尼|雅加达|印度尼西亚/i, '印度尼西亚', -6.21, 106.85],
  [/哈萨克斯坦|阿斯塔纳/i, '哈萨克斯坦', 51.17, 71.43],
  [/土耳其|安卡拉|伊斯坦布尔|里拉/i, '土耳其', 39.93, 32.86],
  [/加拿大|渥太华|加拿大央行|加元/i, '加拿大', 45.42, -75.70],
  [/英国|伦敦|英格兰银行|英镑/i, '英国', 51.51, -0.13],
  [/法国|巴黎|法郎/i, '法国', 48.86, 2.35],
  [/德国|柏林|德国央行/i, '德国', 52.52, 13.40],
  [/意大利|罗马|米兰/i, '意大利', 41.90, 12.50],
  [/西班牙|马德里/i, '西班牙', 40.42, -3.70],
  [/葡萄牙|里斯本/i, '葡萄牙', 38.72, -9.14],
  [/希腊|雅典/i, '希腊', 37.98, 23.73],
  [/荷兰|阿姆斯特丹/i, '荷兰', 52.37, 4.90],
  [/瑞士|达沃斯|苏黎世|瑞士央行/i, '瑞士', 46.94, 7.45],
  [/瑞典|斯德哥尔摩/i, '瑞典', 59.33, 18.07],
  [/挪威|奥斯陆/i, '挪威', 59.91, 10.75],
  [/丹麦|哥本哈根/i, '丹麦', 55.68, 12.57],
  [/芬兰|赫尔辛基/i, '芬兰', 60.17, 24.94],
  [/波兰|华沙/i, '波兰', 52.23, 21.01],
  [/匈牙利|布达佩斯/i, '匈牙利', 47.50, 19.04],
  [/捷克|布拉格/i, '捷克', 50.08, 14.44],
  [/欧盟|欧元区|布鲁塞尔|欧央行|欧洲央行|法兰克福|欧元/i, '欧元区', 50.11, 8.68],
  [/巴西|巴西利亚|圣保罗/i, '巴西', -15.79, -47.88],
  [/阿根廷|布宜诺斯艾利斯|比索/i, '阿根廷', -34.60, -58.38],
  [/墨西哥|墨西哥城/i, '墨西哥', 19.43, -99.13],
  [/智利|圣地亚哥/i, '智利', -33.45, -70.67],
  [/秘鲁|利马/i, '秘鲁', -12.05, -77.04],
  [/哥伦比亚|波哥大/i, '哥伦比亚', 4.71, -74.07],
  [/南非|开普敦|约翰内斯堡|南非央行/i, '南非', -25.75, 28.19],
  [/尼日利亚|阿布贾/i, '尼日利亚', 9.06, 7.49],
  [/埃及|开罗/i, '埃及', 30.04, 31.24],
  [/肯尼亚|内罗毕/i, '肯尼亚', -1.29, 36.82],
  // 中国必须排在 美国 之前：中文快讯常同时出现 中国 与 美元/美股/美联储（如
  // "央行逆回购对冲美元走强"），美国规则在前会把中国事件抢走到美国坐标
  // （四轮后用户复现"点击事件老是放到美国"）；具体地名（香港/日本等）仍在本表更前。
  [/中国|北京|上海|深圳|中国人民银行|人民币|A股|证监会|国家统计局|国务院|发改委|财政部|商务部|工信部|国资委|金融监管总局|沪深|北向资金|沪指|深证成指|创业板|科创板|三大指数|两市|中概股|港股通|离岸人民币|沪深300|中证|北交所|央行/i, '中国', 39.904, 116.407],
  [/美国|华盛顿|白宫|美联储|纽约|华尔街|美元|纳斯达克|美股|特朗普|拜登/i, '美国', 38.895, -77.036],
];
/* 新浪 create_time 是北京时间 → UTC ms（不依赖机器时区） */
function sinaToMs(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600000;
}
async function fetchSina(pages = 2) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const qs = new URLSearchParams({ page: String(p), page_size: '100', zhibo_id: '152' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    // 单页失败收在页内：第 2 页超时不能把第 1 页已拿到的条目一起带走
    //（新浪 7x24 的存在意义就是 GDELT 不可达时的兜底，正抖动时最容易只挂一页）
    try {
      const res = await fetch(SINA_API + '?' + qs.toString(), { signal: ctl.signal, headers: { 'User-Agent': 'openfinlens-collector/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const list = (j && j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || [];
      list.forEach(it => {
        const title = String(it.rich_text || '').replace(/\s+/g, ' ').trim();
        if (!title || !GLOBAL_RE.test(title)) return;
        const publishedAt = sinaToMs(it.create_time);
        if (publishedAt === null || publishedAt < Date.now() - WINDOW_HOURS * 3600 * 1000) return;
        const place = CJK_PLACES.find(([re]) => re.test(title));
        out.push({
          type: classifyCn(title),
          title,
          domain: '新浪财经7x24',
          url: 'https://finance.sina.com.cn/7x24/',
          seenMs: publishedAt,
          importance: HIGH_IMPACT_RE.test(title) ? 'med' : 'low',
          place: place || null,
        });
      });
    } catch (e) {
      console.error(`  新浪7x24 第 ${p} 页失败: ` + e.message);
    } finally {
      clearTimeout(timer);
    }
    await sleep(800);
  }
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchQuery(item, attempt = 0) {
  const qs = new URLSearchParams({
    query: item.q, mode: 'artlist', maxrecords: '75',
    format: 'json', timespan: WINDOW_HOURS + 'h', sort: 'datedesc',
  });
  const url = API + '?' + qs.toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'openfinlens-collector/1.0' } });
    if (res.status === 429 && attempt < 3) {
      await sleep(5000 * (attempt + 1));
      return fetchQuery(item, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return j.articles || [];
  } finally {
    clearTimeout(timer);
  }
}

function seenToMs(s) {
  return Events.toMs(s);
}

async function main() {
  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  const raw = [];
  const fails = [];
  let gdeltCount = 0;
  for (const item of QUERIES) {
    try {
      const arts = await fetchQuery(item);
      arts.forEach(a => raw.push({ ...a, type: item.type }));
      gdeltCount += arts.length;
      console.log(`  [${item.type}] ${arts.length} 条`);
    } catch (e) {
      fails.push('gdelt ' + item.type + ': ' + e.message);
      console.error(`  [${item.type}] 失败 ${e.message}`);
    }
    await sleep(1200);   // GDELT 礼貌间隔
  }

  // 新浪 7x24：GDELT 不可达（国内网络/限流）时的兜底 + 常态补充源
  let sinaCount = 0;
  try {
    const sinaItems = await fetchSina();
    sinaItems.forEach(a => raw.push(a));
    sinaCount = sinaItems.length;
    console.log(`  [sina] ${sinaCount} 条`);
  } catch (e) {
    fails.push('sina: ' + e.message);
    console.error(`  [sina] 失败 ${e.message}`);
  }

  if (!raw.length) {
    console.error('所有来源均失败，保留旧数据不动。\n' + fails.join('\n'));
    process.exit(1);
  }

  // 跨源重复计数（去重前）→ 重要性；seen 时间窗过滤
  const dupCount = new Map();
  raw.forEach(a => {
    const k = Events.dedupeKey(a.title);
    if (k) dupCount.set(k, (dupCount.get(k) || 0) + 1);
  });

  const events = [];
  const seen = new Set();
  raw.forEach(a => {
    const publishedAt = (a.seenMs !== undefined && a.seenMs !== null) ? a.seenMs : seenToMs(a.seendate);
    if (publishedAt === null || publishedAt < cutoff) return;
    const key = Events.dedupeKey(a.title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const dups = dupCount.get(key) || 1;
    const topSource = TOP_SOURCES.test(a.domain || '') || TOP_SOURCES.test(a.title || '');
    // 新浪条目自带 importance（中文快讯没有跨源重复可数），GDELT 条目按重复数/大社评
    const importance = a.importance || (dups >= 3 ? 'high' : (topSource || dups >= 2) ? 'med' : 'low');
    const place = a.place || PLACES.find(([re]) => re.test(a.title || ''));
    events.push({
      id: key + '|' + publishedAt,
      type: a.type,
      title: String(a.title || '').trim(),
      source: String(a.domain || a.sourcecountry || ''),
      sourceUrl: /^https?:\/\//i.test(a.url || '') ? a.url : '',
      publishedAt: new Date(publishedAt).toISOString(),
      lat: place ? place[2] : null,
      lng: place ? place[3] : null,
      country: place ? place[1] : null,
      importance,
      relatedSymbols: Events.matchSymbols(a.title || ''),
      relatedAssets: Events.matchRelated(a.title || ''),
    });
  });

  // 排序：重要度 → 新鲜度；截断
  events.sort((x, y) =>
    (Events.impRank(y.importance) - Events.impRank(x.importance)) ||
    (Date.parse(y.publishedAt) - Date.parse(x.publishedAt)));
  const out = events.slice(0, CAP);

  const sourceLabel = [gdeltCount ? 'GDELT DOC 2.0 (artlist)' : null, sinaCount ? '新浪财经7x24' : null]
    .filter(Boolean).join(' + ');
  const payload = {
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    windowHours: WINDOW_HOURS,
    count: out.length,
    license: 'GDELT 免费开放数据（gdeltproject.org）· 新浪财经7x24 公开快讯；坐标为本项目关键词地理定位，精度为国家/地区级',
    events: out,
  };

  // 体积守门：JSON 超过 1.5MB 说明脏了（正常 ~200KB），拒绝写入
  const body = JSON.stringify(payload);
  if (body.length > 1.5 * 1024 * 1024) {
    console.error('产物体积异常（' + body.length + 'B），拒绝写入');
    process.exit(1);
  }

  // 与旧文件对比：内容没变就不写（Action 提交才不会空转）
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body + '\n') {
    console.log('内容无变化，不写文件');
    return;
  }
  writeFileSync(OUT, body + '\n');
  console.log(`写入 ${OUT}：${out.length} 条事件（high ${out.filter(e => e.importance === 'high').length}）`);
}

main().catch(e => { console.error(e); process.exit(1); });
