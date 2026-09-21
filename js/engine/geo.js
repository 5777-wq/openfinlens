/* engine/geo.js —— 新闻地理编码：标题关键词 → ISO2 国家 + 代表坐标
   纯查表，无 NER 依赖（规则优先原则）。词表是 engine 内独立维护的契约数据，
   与采集脚本 _scripts/collect-events.mjs 的 PLACES 职责不同（那边是采集端
   正则流水线，这边是引擎的结构化编码），词表内容允许重叠。 */

const Geo = (() => {
  /* [正则, ISO2, 国家中文名, lat, lng, 大小写敏感正则?]  顺序=优先级（具体地名在前；中英文同条规则）
     词表纪律：货币名/英文常用词必须带国家限定（"real estate" 曾被 real\b 判给巴西、
     "won" 曾被判给韩国），裸货币词一律收敛为「国家名+货币」或 ISO 代码。
     2026-09-21 补课：所有裸英文词一律 \b 包夹——rial 曾命中 industr*ial* 判伊朗、
     franc 命中 San *Franc*isco 判瑞士、india 命中 Ind*iana*、mexico 命中 New *Mexico*。
     缩写若与英文常用词/子串冲突（US vs 小写代词 us），放第 6 位做大小写敏感校验。 */
  const COUNTRY_RULES = [
    [/日本|东京|大阪|日銀|日本央行|日元|日经|\bjapan(?:ese)?\b|\btokyo\b|\bosaka\b|\bbank of japan\b|\bboj\b|\byen\b|\bnikkei\b/i, 'JP', '日本', 35.68, 139.69],
    [/韩国|首尔|韩元|KOSPI|south korea|seoul|korean won|\bkrw\b|\bkospi\b/i, 'KR', '韩国', 37.57, 126.98],
    [/朝鲜|平壤|north korea|pyongyang/i, 'KP', '朝鲜', 39.03, 125.75],
    [/印度(?!尼西亚)|新德里|孟买|印度卢比|印度央行|NIFTY|\bindia\b|\bindians?\b|\bdelhi\b|\bmumbai\b|\bbombay\b|\bindian rupee\b|\bnifty\b/i, 'IN', '印度', 28.61, 77.21],
    [/印度尼西亚|雅加达|印尼|indonesia|jakarta/i, 'ID', '印度尼西亚', -6.21, 106.85],
    [/中国大陆|中国|广东|北京|上海|深圳|人民币|中国人民银行|A股|证监会|国家统计局|国务院|沪深|\bchina\b|\bchinese\b|\bguangdong\b|\bbeijing\b|\bshanghai\b|\bshenzhen\b|\byuan\b|\brenminbi\b|\bPBOC\b/i, 'CN', '中国', 39.90, 116.41],
    [/香港|港币|恒生|hong kong|\bhkd\b|hang seng/i, 'HK', '香港', 22.32, 114.17],
    [/台湾|台北|新台币|台积电|taiwan|taipei|tsmc/i, 'TW', '台湾', 25.03, 121.57],
    [/乌克兰|基辅|俄乌|\bukraine\b|\bukrainians?\b|\bkyiv\b/i, 'UA', '乌克兰', 50.45, 30.52],
    [/俄罗斯|莫斯科|卢布|普京|russia|moscow|rouble|putin/i, 'RU', '俄罗斯', 55.76, 37.62],
    [/德国|柏林|法兰克福|DAX|德国央行|\bgermany\b|\bgermans?\b|\bberlin\b|\bfrankfurt\b|\bbundesbank\b/i, 'DE', '德国', 50.11, 8.68],
    [/法国|巴黎|CAC|\bfrance\b|\bfrench\b|\bparis\b/i, 'FR', '法国', 48.86, 2.35],
    [/英国|伦敦|英格兰银行|英镑|富时|\bUK\b|\bbritain\b|\bbritish\b|\blondon\b|\bsterling\b|\bftse\b|\bpound\b/i, 'GB', '英国', 51.51, -0.13],
    [/意大利|罗马|米兰|italy|rome|milan/i, 'IT', '意大利', 41.90, 12.50],
    [/西班牙|马德里|spain|madrid/i, 'ES', '西班牙', 40.42, -3.70],
    [/瑞士|苏黎世|瑞士央行|瑞郎|\bswitzerland\b|\bzurich\b|\bfrancs?\b/i, 'CH', '瑞士', 46.95, 7.45],
    [/荷兰|阿姆斯特丹|netherlands|amsterdam/i, 'NL', '荷兰', 52.37, 4.90],
    [/土耳其|里拉|伊斯坦布尔|\bturkey\b|\blira\b|\bistanbul\b/i, 'TR', '土耳其', 39.93, 32.86],
    [/以色列|特拉维夫|谢克尔|内塔尼亚胡|israel|tel aviv|shekel|netanyahu/i, 'IL', '以色列', 32.08, 34.78],
    [/加沙|约旦河西岸|gaza|west bank/i, 'PS', '巴勒斯坦', 31.50, 34.47],
    [/伊朗|德黑兰|里亚尔|\biranians?\b|\biran\b|\btehran\b|\brial\b/i, 'IR', '伊朗', 35.69, 51.39],
    [/伊拉克|巴格达|iraq|baghdad/i, 'IQ', '伊拉克', 33.31, 44.36],
    [/沙特|利雅得|saudi|riyadh/i, 'SA', '沙特', 24.71, 46.68],
    [/阿联酋|迪拜|阿布扎比|\bUAE\b|dubai|abu dhabi/i, 'AE', '阿联酋', 24.47, 54.37],
    [/卡塔尔|多哈|qatar|doha/i, 'QA', '卡塔尔', 25.29, 51.53],
    [/埃及|开罗|egypt|cairo/i, 'EG', '埃及', 30.04, 31.24],
    [/南非|约翰内斯堡|兰特|south africa|johannesburg|\brand\b/i, 'ZA', '南非', -26.20, 28.05],
    [/尼日利亚|拉各斯|nigeria|lagos/i, 'NG', '尼日利亚', 6.52, 3.38],
    [/巴西|圣保罗|雷亚尔|巴西利亚|brazil|sao paulo|brazilian real|\bbrl\b/i, 'BR', '巴西', -15.79, -47.88],
    [/阿根廷|布宜诺斯艾利斯|阿根廷比索|argentina|argentine peso/i, 'AR', '阿根廷', -34.60, -58.38],
    // mexico 加 (?<!new )：New Mexico 是美国州名，\b 挡不住（Mexico 本身就是完整词）
    [/墨西哥|墨西哥比索|\bmexican peso\b|\bmexicans?\b|\bmxn\b|(?<!new )\bmexico\b/i, 'MX', '墨西哥', 19.43, -99.13],
    [/加拿大|渥太华|加元|多伦多|\bcanada\b|\bcanadian\b|\bottawa\b|\btoronto\b|\bloonie\b/i, 'CA', '加拿大', 45.42, -75.70],
    [/澳大利亚|悉尼|澳元|澳洲联储|\baustralia(?:n)?\b|\bsydney\b|\baussie\b|\brba\b/i, 'AU', '澳大利亚', -35.28, 149.13],
    [/新西兰|惠灵顿|纽元|new zealand|wellington/i, 'NZ', '新西兰', -41.29, 174.78],
    [/新加坡|海峡时报|singapore/i, 'SG', '新加坡', 1.35, 103.82],
    [/泰国|曼谷|泰铢|\bthailand\b|\bbaht\b/i, 'TH', '泰国', 13.76, 100.50],
    [/越南|河内|越南盾|\bvietnam\b|\bdong\b/i, 'VN', '越南', 21.03, 105.85],
    [/菲律宾|马尼拉|菲律宾比索|philippines|philippine peso|\bphp\b/i, 'PH', '菲律宾', 14.60, 120.98],
    [/马来西亚|吉隆坡|林吉特|malaysia|ringgit/i, 'MY', '马来西亚', 3.14, 101.69],
    [/巴基斯坦|卡拉奇|巴基斯坦卢比|pakistan|karachi|\bpkr\b/i, 'PK', '巴基斯坦', 33.69, 73.05],
    [/波兰|华沙|兹罗提|poland|warsaw|zloty/i, 'PL', '波兰', 52.23, 21.01],
    [/瑞典|斯德哥尔摩|瑞典克朗|sweden|stockholm|swedish krona|\bsek\b/i, 'SE', '瑞典', 59.33, 18.07],
    [/挪威|奥斯陆|挪威克朗|norway|oslo|norwegian krone|\bnok\b/i, 'NO', '挪威', 59.91, 10.75],
    // US/USA 用第 6 位大小写敏感正则校验：/i 的 \bUS\b 会命中小写代词 us（"give us a warning"）
    [/美国|华盛顿|白宫|美联储|纽约|华尔街|美元|纳斯达克|标普|道琼斯|united states|washington|white house|federal reserve|fed\b|wall street|dollar|nasdaq|\bs&p\b|\bdow\b/i, 'US', '美国', 38.90, -77.04, /\bUS\b|\bUSA\b/],
    [/欧元区|欧盟|欧洲央行|欧央行|布鲁塞尔|eurozone|euro area|\bEU\b|european union|\bECB\b|brussels/i, 'EU', '欧元区', 50.11, 8.68],
    [/联合国|安理会|united nations|security council/i, 'UN', '联合国', 40.75, -73.97],
  ];

  /**
   * 标题 → 地理归属
   * @param {string} title
   * @returns {{country:string, name:string, lat:number, lng:number}|null}
   */
  function resolveCountry(title) {
    const t = String(title || '');
    for (const [re, iso2, name, lat, lng, csRe] of COUNTRY_RULES) {
      if (re.test(t) || (csRe && csRe.test(t))) return { country: iso2, name, lat, lng };
    }
    return null;
  }

  /** ISO2 → 中文名（timeline/详情用） */
  const ISO2_NAME = (() => {
    const m = {};
    for (const [, iso2, name] of COUNTRY_RULES) m[iso2] = name;
    return m;
  })();

  /**
   * 距离最近的国家（地图点选国家用）。用代表坐标平方距离近似，maxDeg 为经纬度容差。
   * @returns {{country:string, name:string}|null}
   */
  function nearestCountry(lat, lng, maxDeg) {
    let best = null, bestD = (maxDeg || 14) * (maxDeg || 14);
    for (const [, iso2, name, la, ln] of COUNTRY_RULES) {
      const d = (la - lat) * (la - lat) + (ln - lng) * (ln - lng);
      if (d < bestD) { bestD = d; best = { country: iso2, name }; }
    }
    return best;
  }

  /** 中文名 → ISO2（原始事件流的 country 是中文名，接引擎时需要反查） */
  function iso2OfName(name) {
    for (const [, iso2, n] of COUNTRY_RULES) if (n === name) return iso2;
    return null;
  }

  /* world-atlas countries-110m 的 feature.id（ISO 3166-1 numeric，零填充字符串）→ ISO2。
     供平面地图"点在多边形"命中后接回引擎国家表；HK/SG/EU/UN 在 110m 里没有
     独立多边形，地图点选由 nearestCountry 兜底。 */
  const NUMERIC_TO_ISO2 = {
    32: 'AR', 36: 'AU', 76: 'BR', 124: 'CA', 156: 'CN', 158: 'TW', 250: 'FR', 276: 'DE',
    275: 'PS', 356: 'IN', 360: 'ID', 364: 'IR', 368: 'IQ', 376: 'IL', 380: 'IT', 392: 'JP',
    408: 'KP', 410: 'KR', 458: 'MY', 484: 'MX', 528: 'NL', 554: 'NZ', 566: 'NG', 578: 'NO',
    586: 'PK', 608: 'PH', 616: 'PL', 634: 'QA', 643: 'RU', 682: 'SA', 704: 'VN',
    710: 'ZA', 724: 'ES', 752: 'SE', 756: 'CH', 764: 'TH', 792: 'TR', 804: 'UA', 818: 'EG',
    826: 'GB', 840: 'US', 784: 'AE',
  };
  /** world-atlas feature.id（可能带零填充）→ ISO2；未收录返回 null */
  function iso2OfNumeric(id) {
    if (id === null || id === undefined) return null;
    const key = String(id).replace(/^0+/, '');
    return Object.prototype.hasOwnProperty.call(NUMERIC_TO_ISO2, key) ? NUMERIC_TO_ISO2[key] : null;
  }

  return { resolveCountry, ISO2_NAME, nearestCountry, iso2OfName, iso2OfNumeric };
})();

if (typeof window !== 'undefined') window.EngineGeo = Geo;
if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
