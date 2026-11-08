#!/usr/bin/env node
/* build-api.mjs —— 把仓库数据编译成静态 JSON API（api/v1/** + api/openapi.json）
 *
 * 设计原则：
 *   1. 零依赖：只用 Node 内置 fs/path/vm/fetch；行情与 K 线复用 js/sources/*.js 的 URL 与解析口径
 *     （通过 mcp/lib/live-sources.mjs 用 vm 加载），不另发明一套接口。
 *   2. 统一信封：{ ok, data, meta }；meta 必含 dataset/asof/generatedAt/source/stale/license/note。
 *   3. 宁缺毋假：实时抓取失败时沿用上一次提交的快照并标 stale=true；没有旧快照就输出空数组并标 stale，
 *      绝不编造数字。离线模式（--offline）完全不发网络请求。
 *   4. 幂等：重复运行只覆盖同名文件，不追加；输出按固定顺序排序。构建时间可用 BUILD_API_NOW 固定，
 *      便于回归测试。
 *   5. 合规：不输出交易活跃度字段；预测市场只保留事件/档位/概率，不出现平台品牌与链接。
 *
 * 用法：
 *   node _scripts/build-api.mjs                 # 联网构建（实时行情 + K 线 + 宏观）
 *   node _scripts/build-api.mjs --offline       # 只用仓库已有数据构建（不发请求）
 *   BUILD_API_NOW=2026-11-08T00:00:00Z node _scripts/build-api.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUniverse, loadWorldBankMeta, fetchQuotes, fetchKlines } from '../mcp/lib/live-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'api');
const V1 = path.join(API, 'v1');
const OFFLINE = process.argv.includes('--offline') || process.env.BUILD_API_OFFLINE === '1';
const NOW = process.env.BUILD_API_NOW ? new Date(process.env.BUILD_API_NOW) : new Date();
if (!Number.isFinite(NOW.getTime())) {
  console.error('BUILD_API_NOW 不是合法时间：' + process.env.BUILD_API_NOW);
  process.exit(1);
}
const GENERATED_AT = NOW.toISOString();
// 固定 BUILD_API_NOW 时把耗时字段归零：时间是构建环境噪声，不利于字节级复现
const REPRODUCIBLE = !!process.env.BUILD_API_NOW;

const VERSION = 'v1';
const GENERAL_LICENSE = '公开数据，仅用于信息展示与统计研究；不构成任何投资建议。';

/* 各数据集的滞后判定预算（分钟）。含义：asof 距今超过该值即 stale=true。 */
const FRESHNESS_MINUTES = {
  'events.global': 180,
  'prediction.markets': 120,
  'institutions.holdings': 14400,   // 13F 是季度披露，10 天窗口足够
  'macro.series': 64800,            // 世界银行年度数据，45 天窗口
};

/* K 线覆盖：主要指数 + 热门标的 + 加密龙头（全部有稳定免费直连源） */
const KLINE_SYMBOLS = [
  'sh000001', 'sz399001', 'sz399006', 'sh000688',
  'hkHSI', 'hkHSTECH', 'usDJI', 'usIXIC', 'usINX',
  'sh600519', 'sz300750', 'sh601318', 'sz002594',
  'hk00700', 'hk09988', 'usAAPL', 'usNVDA', 'usTSLA', 'BTCUSDT',
];
const KLINE_PERIODS = ['day', 'week', 'month'];
const KLINE_LIMITS = { day: 160, week: 104, month: 60 };

/* ==================== 通用工具 ==================== */

const absOf = (rel) => path.join(ROOT, rel);

function readJsonIf(rel) {
  try { return JSON.parse(readFileSync(absOf(rel), 'utf8')); } catch { return null; }
}

function writeJson(rel, obj) {
  const abs = absOf(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function envelope(dataset, data, meta) {
  return {
    ok: true,
    data,
    meta: {
      dataset,
      asof: meta.asof !== undefined ? meta.asof : null,
      generatedAt: GENERATED_AT,
      source: meta.source || '',
      stale: meta.stale === true,
      license: meta.license || GENERAL_LICENSE,
      note: meta.note || '',
      ...(meta.extra || {}),
    },
  };
}

const isStaleIso = (iso, minutes) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return true;
  return NOW.getTime() - t > minutes * 60000;
};

const toIso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

function maxIso(list) {
  let best = null;
  let bestT = -Infinity;
  for (const v of list) {
    if (v === null || v === undefined || v === '') continue;
    let t = NaN;
    if (typeof v === 'number') t = v;
    else if (typeof v === 'string' && /^\d{10,13}$/.test(v)) t = Number(v);
    else t = Date.parse(String(v));
    if (Number.isFinite(t) && t > bestT) { bestT = t; best = new Date(t).toISOString(); }
  }
  return best;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return out;
}

/* ==================== 标的宇宙 ==================== */

/* 汉字 → 拼音首字母。只覆盖标的名称里实际出现的字；不在表里的字直接跳过。
   故意只取首字母（贵州茅台 → gzmt），与用户在搜索框里的输入习惯一致。 */
const PY = {
  上: 's', 证: 'z', 指: 'z', 数: 's', 深: 's', 成: 'c', 创: 'c', 业: 'y', 板: 'b', 科: 'k',
  贵: 'g', 州: 'z', 茅: 'm', 台: 't', 宁: 'n', 德: 'd', 时: 's', 代: 'd', 中: 'z', 国: 'g',
  平: 'p', 安: 'a', 五: 'w', 粮: 'l', 液: 'y', 招: 'z', 商: 's', 银: 'y', 行: 'h', 工: 'g',
  农: 'n', 化: 'h', 石: 's', 油: 'y', 比: 'b', 亚: 'y', 迪: 'd', 芯: 'x', 际: 'j', 隆: 'l',
  基: 'j', 绿: 'l', 能: 'n', 美: 'm', 的: 'd', 集: 'j', 团: 't', 海: 'h', 天: 't', 味: 'w',
  长: 'c', 江: 'j', 电: 'd', 力: 'l', 紫: 'z', 金: 'j', 矿: 'k', 京: 'j', 东: 'd', 方: 'f',
  富: 'f', 联: 'l', 财: 'c', 信: 'x', 券: 'q', 万: 'w', 免: 'm', 康: 'k', 威: 'w', 视: 's',
  恒: 'h', 瑞: 'r', 医: 'y', 药: 'y', 迈: 'm', 疗: 'l', 立: 'l', 讯: 'x', 精: 'j', 密: 'm',
  神: 's', 华: 'h', 生: 's', 技: 'j', 腾: 't', 控: 'k', 股: 'g', 阿: 'a', 里: 'l', 巴: 'b',
  移: 'y', 动: 'd', 汇: 'h', 丰: 'f', 小: 'x', 米: 'm', 网: 'w', 易: 'y', 友: 'y', 邦: 'b',
  保: 'b', 险: 'x', 建: 'j', 设: 's', 洋: 'y', 份: 'f', 快: 'k', 手: 's', 踏: 't', 体: 't',
  育: 'y', 健: 'j', 润: 'r', 啤: 'p', 酒: 'j', 底: 'd', 捞: 'l', 实: 's', 新: 'x', 鸿: 'h',
  地: 'd', 产: 'c', 河: 'h', 娱: 'y', 乐: 'l', 道: 'd', 琼: 'q', 斯: 's', 纳: 'n', 达: 'd',
  克: 'k', 标: 'b', 普: 'p', 苹: 'p', 果: 'g', 英: 'y', 伟: 'w', 微: 'w', 软: 'r', 特: 't',
  拉: 'l', 马: 'm', 逊: 'x', 谷: 'g', 歌: 'g', 博: 'b', 通: 't', 超: 'c', 半: 'b', 导: 'd',
  奈: 'n', 飞: 'f', 尔: 'e', 高: 'g', 积: 'j', 光: 'g', 甲: 'j', 骨: 'g', 文: 'w', 摩: 'm',
  根: 'g', 大: 'd', 沃: 'w', 玛: 'm', 士: 's', 尼: 'n', 音: 'y', 辉: 'h', 埃: 'a', 森: 's',
  孚: 'f', 元: 'y', 离: 'l', 岸: 'a', 人: 'r', 民: 'm', 币: 'b', 欧: 'o', 镑: 'b', 日: 'r',
  港: 'g', 黄: 'h', 白: 'b', 铜: 't', 原: 'y', 然: 'r', 气: 'q', 玉: 'y', 连: 'l', 续: 'x',
  债: 'z', 月: 'y', 年: 'n', 经: 'j', 法: 'f', 韩: 'h', 印: 'y', 度: 'd', 币: 'b', 指: 'z',
};

function pinyinOf(name) {
  let out = '';
  for (const ch of String(name || '')) {
    if (/[A-Za-z0-9]/.test(ch)) out += ch.toLowerCase();
    else if (PY[ch]) out += PY[ch];
  }
  return out;
}

/* 常见口语别名（在名称/代码/拼音首字母之外补充） */
const EXTRA_ALIASES = {
  sh000001: ['上证', '大盘', '沪指'],
  sz399001: ['深成指', '深指'],
  sz399006: ['创业板', '创指'],
  sh000688: ['科创', '科创50'],
  sh600519: ['茅台', 'maotai'],
  sz300750: ['宁王', 'ningde'],
  sh601318: ['平安', 'pingan'],
  sh600036: ['招行'],
  sh601398: ['工行'],
  sh601288: ['农行'],
  sh601988: ['中行'],
  sh600028: ['中石化'],
  sh601857: ['中石油'],
  sz002594: ['byd'],
  sh688981: ['中芯'],
  sh600900: ['长电'],
  sh601899: ['紫金'],
  sz000725: ['京东方'],
  sz300059: ['东财'],
  sh600030: ['中信'],
  sz000002: ['万科'],
  hkHSI: ['恒指', 'hsi'],
  hkHSTECH: ['恒科', 'hstech'],
  hk00700: ['腾讯', 'tencent'],
  hk09988: ['阿里', 'alibaba'],
  hk03690: ['美团'],
  hk01810: ['小米'],
  hk09618: ['京东'],
  hk09999: ['网易'],
  usDJI: ['道指'],
  usIXIC: ['纳指', 'nasdaq'],
  usINX: ['标普', 'spx', 'sp500'],
  usAAPL: ['苹果', 'apple'],
  usNVDA: ['英伟达', 'nvidia'],
  usMSFT: ['微软'],
  usTSLA: ['特斯拉', 'tesla'],
  usAMZN: ['亚马逊'],
  usGOOG: ['谷歌', 'google'],
  usAVGO: ['博通'],
  usAMD: ['amd'],
  usNFLX: ['奈飞'],
  usTSM: ['台积电'],
  'EM:100.UDI': ['dxy', '美元指数'],
  'EM:101.GC00Y': ['黄金', 'gold', 'gc'],
  'EM:101.SI00Y': ['白银', 'silver'],
  'EM:102.CL00Y': ['原油', 'oil', 'cl'],
  'EM:102.NG00Y': ['天然气', 'gas'],
  'EM:171.US10Y': ['美债10年', '美十债', 'us10y'],
  'EM:171.CN10Y': ['中债10年', '中十债', 'cn10y'],
  BTCUSDT: ['比特币', 'btc', '大饼'],
  ETHUSDT: ['以太坊', 'eth'],
  BNBUSDT: ['币安币', 'bnb'],
  SOLUSDT: ['sol'],
  XRPUSDT: ['瑞波'],
  DOGEUSDT: ['狗狗币', 'doge'],
};

const CRYPTO_ZH = {
  BTCUSDT: '比特币', ETHUSDT: '以太坊', BNBUSDT: '币安币', SOLUSDT: '索拉纳',
  XRPUSDT: '瑞波币', DOGEUSDT: '狗狗币',
};

const MARKET_META = [
  { id: 'cn', label: 'A股', description: '沪深京上市公司与 A 股指数' },
  { id: 'hk', label: '港股', description: '港交所上市公司与恒生系列指数' },
  { id: 'us', label: '美股', description: '纽交所/纳斯达克/美交所标的与美股指数' },
  { id: 'global', label: '全球指数', description: '日经、DAX、富时、CAC、KOSPI、SENSEX 等' },
  { id: 'crypto', label: '加密货币', description: '币安 USDT 交易对' },
  { id: 'fx', label: '外汇', description: '主要货币对与美元指数' },
  { id: 'commodity', label: '大宗商品', description: '黄金、白银、铜、原油、天然气、玉米' },
  { id: 'macro', label: '宏观利率', description: '主要经济体国债收益率' },
];

const KIND_META = [
  { id: 'index', label: '指数' },
  { id: 'stock', label: '个股' },
  { id: 'crypto', label: '加密货币' },
  { id: 'fx', label: '外汇' },
  { id: 'commodity', label: '商品' },
  { id: 'rate', label: '利率' },
];

function buildUniverse() {
  const src = loadUniverse();
  const bySymbol = new Map();
  const rows = [];

  const push = ({ symbol, name, market, group, kind, code, secid, source }) => {
    if (!symbol || bySymbol.has(symbol)) return;
    const pinyin = pinyinOf(name);
    const aliases = new Set([name, symbol, code, pinyin].filter(Boolean));
    for (const a of (EXTRA_ALIASES[symbol] || [])) aliases.add(String(a).toLowerCase());
    const entry = {
      symbol,
      name,
      market,
      group,
      kind,
      code: code || symbol,
      secid: secid || null,
      source,
      pinyin,
      aliases: Array.from(aliases).filter(Boolean).sort(),
    };
    bySymbol.set(symbol, entry);
    rows.push(entry);
  };

  for (const item of src.tencent) {
    const symbol = item.symbol;
    let market = 'cn';
    if (/^hk/i.test(symbol)) market = 'hk';
    else if (/^us/i.test(symbol)) market = 'us';
    const kind = item.group === 'index' ? 'index' : 'stock';
    const code = symbol.replace(/^[a-z]{2}/i, '');
    push({ symbol, name: item.label, market, group: item.group, kind, code, source: 'tencent' });
  }

  for (const item of src.em) {
    const kind = item.group === 'macro' ? 'rate' : (item.group === 'fx' ? 'fx' : 'commodity');
    push({
      symbol: item.symbol, name: item.label, market: item.group, group: item.group, kind,
      code: item.secid.split('.').slice(1).join('.'), secid: item.secid, source: 'eastmoney',
    });
  }

  for (const item of src.globalIndex) {
    push({
      symbol: item.symbol, name: item.name, market: 'global', group: 'index', kind: 'index',
      code: item.secid.split('.').slice(1).join('.'), secid: item.secid, source: 'eastmoney',
    });
  }

  for (const symbol of src.cryptoUniverse) {
    push({
      symbol, name: CRYPTO_ZH[symbol] || symbol.replace(/USDT$/, ''), market: 'crypto',
      group: 'crypto', kind: 'crypto', code: symbol, source: 'binance',
    });
  }

  rows.sort((a, b) => (a.group + a.symbol).localeCompare(b.group + b.symbol));

  const env = envelope('universe', {
    count: rows.length,
    markets: MARKET_META,
    kinds: KIND_META,
    symbols: rows,
  }, {
    asof: GENERATED_AT,
    source: 'js/data/universe.js（与页面共用的标的常量表）',
    stale: false,
    license: GENERAL_LICENSE,
    note: 'symbol 是其它端点与 MCP 工具的标准入参；aliases 含中文名、代码、拼音首字母与常见口语别名；secid 仅东财源使用。',
  });

  return { env, rows, bySymbol };
}

/* ==================== 数据集定义（manifest 与 openapi 的唯一事实源） ==================== */

const DATASETS = [
  {
    id: 'index', path: 'api/v1/index.json', title: '根索引', kind: 'meta',
    description: '列出全部数据集、各自路径、更新时间与滞后状态，是 Agent 的第一入口。',
  },
  {
    id: 'manifest', path: 'api/v1/manifest.json', title: '机器可读清单', kind: 'meta',
    description: '每个数据集的 id/标题/路径/字段定义/样例/数据截止时间，供 Agent 生成调用参数。',
  },
  {
    id: 'universe', path: 'api/v1/universe.json', title: '标的宇宙', kind: 'data',
    description: '代码、名称、市场、分组、拼音首字母与别名，用于把用户口语解析成标准 symbol。',
  },
  {
    id: 'quotes.latest', path: 'api/v1/quotes/latest.json', title: '行情快照', kind: 'data',
    description: '构建时抓取的行情快照，带 asof 与 stale；抓取失败时沿用上次快照并诚实标注。',
  },
  {
    id: 'klines.catalog', path: 'api/v1/markets/klines.json', title: 'K 线目录', kind: 'data',
    description: '可用 K 线标的清单、周期与行数，指向 api/v1/klines/{symbol}.json。',
  },
  {
    id: 'klines.symbol', path: 'api/v1/klines/{symbol}.json', title: '单标的 K 线', kind: 'data',
    description: '日/周/月 K 线（时间与开高低收），每个标的一个文件；路径里的 {symbol} 取目录中的代码。',
  },
  {
    id: 'events.global', path: 'api/v1/events/global.json', title: '全球事件', kind: 'data',
    description: '全球宏观/地缘事件，附分类、国家、0-100 严重度与关联标的。',
  },
  {
    id: 'prediction.markets', path: 'api/v1/prediction/markets.json', title: '预测市场概率', kind: 'data',
    description: '事件与档位两层结构，probability 为 0-1 隐含概率；不含平台标识与链接。',
  },
  {
    id: 'institutions.holdings', path: 'api/v1/institutions/holdings.json', title: '机构持仓', kind: 'data',
    description: 'SEC 13F 机构季度持仓、规则化因子 ETF 全量持仓、基金合计持仓的加减仓榜。',
  },
  {
    id: 'macro.series', path: 'api/v1/macro/series.json', title: '宏观序列', kind: 'data',
    description: '世界银行年度指标（GDP/增长/通胀/失业/债务/经常账户），附 FRED 口径目录。',
  },
  {
    id: 'health', path: 'api/v1/health.json', title: '链路自检', kind: 'meta',
    description: '各数据集最近构建时间、条数、耗时与 stale 状态。',
  },
];

const FIELD_DEFS = {
  index: [
    { name: 'version', type: 'string', unit: null, desc: 'API 版本号' },
    { name: 'generatedAt', type: 'string', unit: null, desc: '构建时间（ISO 8601）' },
    { name: 'count', type: 'integer', unit: '个', desc: '数据集数量' },
    { name: 'datasets', type: 'array', unit: null, desc: '数据集摘要列表（id/title/path/asof/stale/count）' },
    { name: 'entrypoints', type: 'object', unit: null, desc: 'manifest/health/openapi 的入口路径' },
  ],
  manifest: [
    { name: 'version', type: 'string', unit: null, desc: 'API 版本号' },
    { name: 'generatedAt', type: 'string', unit: null, desc: '构建时间（ISO 8601）' },
    { name: 'base', type: 'string', unit: null, desc: '静态 API 根路径' },
    { name: 'datasets', type: 'array', unit: null, desc: '数据集定义列表（含 fields/sample）' },
  ],
  universe: [
    { name: 'symbol', type: 'string', unit: null, desc: '标准标的代码（其它端点的入参）' },
    { name: 'name', type: 'string', unit: null, desc: '中文名称' },
    { name: 'market', type: 'string', unit: null, desc: '市场：cn/hk/us/global/crypto/fx/commodity/macro' },
    { name: 'kind', type: 'string', unit: null, desc: '品类：index/stock/crypto/fx/commodity/rate' },
    { name: 'group', type: 'string', unit: null, desc: '页面分组（与 universe.js 的 group 一致）' },
    { name: 'code', type: 'string', unit: null, desc: '交易所代码（去掉市场前缀）' },
    { name: 'secid', type: 'string', unit: null, desc: '东财 secid，仅东财源标的非空' },
    { name: 'pinyin', type: 'string', unit: null, desc: '中文名的拼音首字母串' },
    { name: 'aliases', type: 'array', unit: null, desc: '别名列表（中文简称/代码/常见口语）' },
    { name: 'source', type: 'string', unit: null, desc: '取数源：tencent/eastmoney/binance' },
  ],
  quotes: [
    { name: 'symbol', type: 'string', unit: null, desc: '标准标的代码' },
    { name: 'name', type: 'string', unit: null, desc: '上游返回的名称' },
    { name: 'market', type: 'string', unit: null, desc: '市场分组' },
    { name: 'kind', type: 'string', unit: null, desc: '品类' },
    { name: 'price', type: 'number', unit: '价格', desc: '最新价' },
    { name: 'prevClose', type: 'number', unit: '价格', desc: '昨收' },
    { name: 'open', type: 'number', unit: '价格', desc: '今开' },
    { name: 'high', type: 'number', unit: '价格', desc: '最高' },
    { name: 'low', type: 'number', unit: '价格', desc: '最低' },
    { name: 'change', type: 'number', unit: '价格', desc: '涨跌额' },
    { name: 'changePct', type: 'number', unit: '%', desc: '涨跌幅（百分数）' },
    { name: 'quoteAt', type: 'integer', unit: 'ms', desc: '上游行情时刻的毫秒时间戳（美股为 null）' },
    { name: 'updatedAt', type: 'integer', unit: 'ms', desc: '抓取时刻的毫秒时间戳' },
    { name: 'source', type: 'string', unit: null, desc: '取数源标识' },
  ],
  'klines.catalog': [
    { name: 'count', type: 'integer', unit: '个', desc: '可用标的数量' },
    { name: 'periods', type: 'array', unit: null, desc: '周期枚举：day/week/month' },
    { name: 'symbols', type: 'array', unit: null, desc: '标的清单（symbol/name/market/path/periods/asof/stale）' },
  ],
  'klines.symbol': [
    { name: 'symbol', type: 'string', unit: null, desc: '标准标的代码' },
    { name: 'name', type: 'string', unit: null, desc: '中文名称' },
    { name: 'market', type: 'string', unit: null, desc: '市场分组' },
    { name: 'periods', type: 'object', unit: null, desc: '按周期分组：day/week/month → { interval, count, rows[{time,open,high,low,close}], asof, stale, source }' },
  ],
  events: [
    { name: 'id', type: 'string', unit: null, desc: '事件稳定 id' },
    { name: 'category', type: 'string', unit: null, desc: '分类：central_bank/macro/trade/conflict/geopolitics 等' },
    { name: 'title', type: 'string', unit: null, desc: '标题' },
    { name: 'source', type: 'string', unit: null, desc: '快讯来源' },
    { name: 'sourceUrl', type: 'string', unit: null, desc: '来源主页链接' },
    { name: 'publishedAt', type: 'string', unit: null, desc: '发布时间（ISO 8601）' },
    { name: 'country', type: 'string', unit: null, desc: '国家/地区中文名；定位不到时为 null' },
    { name: 'lat', type: 'number', unit: '度', desc: '纬度；定位不到时为 null' },
    { name: 'lng', type: 'number', unit: '度', desc: '经度；定位不到时为 null' },
    { name: 'severity', type: 'integer', unit: '0-100', desc: '严重度（由 importance 映射，不是上游原始字段）' },
    { name: 'importance', type: 'string', unit: null, desc: '上游规则评分：high/med/low' },
    { name: 'relatedSymbols', type: 'array', unit: null, desc: '关联标的代码列表' },
    { name: 'relatedAssets', type: 'array', unit: null, desc: '关联资产类别列表' },
  ],
  prediction: [
    { name: 'id', type: 'string', unit: null, desc: '事件 id' },
    { name: 'title', type: 'string', unit: null, desc: '英文标题' },
    { name: 'titleZh', type: 'string', unit: null, desc: '中文标题；未翻译时为 null' },
    { name: 'category', type: 'string', unit: null, desc: '类别：election/geopolitics/crypto/economy 等' },
    { name: 'partition', type: 'boolean', unit: null, desc: '是否为多档互斥事件' },
    { name: 'endDate', type: 'integer', unit: 'ms', desc: '事件截止时间' },
    { name: 'updatedAt', type: 'integer', unit: 'ms', desc: '上游更新时间' },
    { name: 'outcomeCount', type: 'integer', unit: '个', desc: '档位总数' },
    { name: 'outcomes', type: 'array', unit: null, desc: '档位列表（id/label/labelZh/probability/change24h）' },
    { name: 'rest', type: 'object', unit: null, desc: '未列出的剩余档位聚合（probability/count）' },
  ],
  institutions: [
    { name: 'asOf', type: 'string', unit: null, desc: '本数据集最新构建时间' },
    { name: 'institutions', type: 'array', unit: null, desc: '13F 机构列表（含 holdings/exits、reportDate、lagDays）' },
    { name: 'etf', type: 'object', unit: null, desc: '规则化因子 ETF 全量持仓与交集（funds/overlap）' },
    { name: 'fundHoldings', type: 'object', unit: null, desc: '基金合计持仓的加仓/减仓榜（topAdd/topTrim）' },
  ],
  macro: [
    { name: 'count', type: 'integer', unit: '条', desc: '序列数量' },
    { name: 'catalog', type: 'array', unit: null, desc: '指标目录（key/code/label/unit）' },
    { name: 'series', type: 'array', unit: null, desc: '序列列表（id/country/indicator/points[{date,value}]）' },
    { name: 'fred', type: 'object', unit: null, desc: 'FRED 口径目录与可用性说明' },
  ],
  health: [
    { name: 'status', type: 'string', unit: null, desc: 'ok / degraded' },
    { name: 'generatedAt', type: 'string', unit: null, desc: '自检生成时间' },
    { name: 'durationMs', type: 'integer', unit: 'ms', desc: '本轮构建总耗时' },
    { name: 'datasets', type: 'array', unit: null, desc: '各数据集 lastBuilt/count/ms/stale' },
  ],
};

/* ==================== 行情 ==================== */

function attachUniverseMeta(quotes, bySymbol) {
  return quotes.map((q) => {
    const u = bySymbol.get(q.symbol);
    return {
      symbol: q.symbol,
      name: (u && u.name) || q.name || q.symbol,
      market: (u && u.market) || q.market || 'other',
      kind: (u && u.kind) || null,
      price: q.price,
      prevClose: q.prevClose,
      open: q.open,
      high: q.high,
      low: q.low,
      change: q.change,
      changePct: q.changePct,
      quoteAt: Number.isFinite(q.quoteAt) ? q.quoteAt : null,
      updatedAt: Number.isFinite(q.updatedAt) ? q.updatedAt : null,
      source: q.source,
    };
  });
}

async function buildQuotes(universe) {
  const started = Date.now();
  const symbols = universe.rows.map((r) => r.symbol);
  const prev = readJsonIf('api/v1/quotes/latest.json');
  let live = { quotes: [], errors: [], via: 'offline' };
  if (!OFFLINE) {
    try {
      live = await fetchQuotes(symbols, { offline: false });
    } catch (e) {
      live = { quotes: [], errors: [{ source: 'network', message: String(e && e.message || e) }], via: 'fail' };
    }
  } else {
    live.errors.push({ source: 'network', message: '构建脚本处于离线模式' });
  }

  let rows = attachUniverseMeta(live.quotes || [], universe.bySymbol);
  let asof = maxIso(rows.map((q) => q.quoteAt || q.updatedAt));
  let stale = false;
  let note = '实时抓取的行情快照；quoteAt 是上游行情时刻，updatedAt 是抓取时刻。只含价格与涨跌字段。';
  let via = live.via;

  if (!rows.length) {
    if (prev && prev.data && Array.isArray(prev.data.quotes) && prev.data.quotes.length) {
      rows = prev.data.quotes;
      asof = prev.meta ? prev.meta.asof : asof;
      stale = true;
      note = '本轮构建未能获取实时行情，沿用上一次提交的快照；请结合 meta.asof 判断时效。';
      via = 'snapshot';
    } else {
      stale = true;
      note = '本轮构建未能获取实时行情，且没有历史快照；quotes 为空，不编造数字。';
      via = 'empty';
    }
  }

  // 按宇宙顺序稳定排序，保证重复构建输出一致
  const order = new Map(universe.rows.map((r, i) => [r.symbol, i]));
  rows.sort((a, b) => (order.has(a.symbol) ? order.get(a.symbol) : 1e9) - (order.has(b.symbol) ? order.get(b.symbol) : 1e9));

  const env = envelope('quotes.latest', {
    count: rows.length,
    via,
    quotes: rows,
    errors: live.errors || [],
  }, {
    asof,
    source: '公开行情接口（腾讯 qt.gtimg.cn / 东方财富 push2delay / 币安 data-api）',
    stale,
    license: GENERAL_LICENSE,
    note,
  });

  writeJson('api/v1/quotes/latest.json', env);
  return { env, count: rows.length, ms: Date.now() - started, stale, asof };
}

/* ==================== K 线 ==================== */

async function buildKlines(universe) {
  const started = Date.now();
  const tasks = [];
  for (const symbol of KLINE_SYMBOLS) {
    for (const period of KLINE_PERIODS) tasks.push({ symbol, period });
  }

  const results = await mapLimit(tasks, 4, async ({ symbol, period }) => {
    const prev = readJsonIf('api/v1/klines/' + symbol + '.json');
    const prevBlock = prev && prev.data && prev.data.periods && prev.data.periods[period] ? prev.data.periods[period] : null;
    let rows = [];
    let fetched = false;
    let error = null;
    if (!OFFLINE) {
      try {
        const live = await fetchKlines(symbol, period, KLINE_LIMITS[period], { offline: false });
        rows = live.rows || [];
        fetched = rows.length > 0;
        if (live.error) error = live.error;
      } catch (e) {
        error = String(e && e.message || e);
      }
    }
    let stale = false;
    if (!rows.length && prevBlock && Array.isArray(prevBlock.rows) && prevBlock.rows.length) {
      rows = prevBlock.rows;
      stale = true;
    } else if (!rows.length) {
      stale = true;
    }
    return { symbol, period, rows, fetched, stale, error };
  });

  const grouped = new Map();
  for (const r of results) {
    if (!grouped.has(r.symbol)) grouped.set(r.symbol, []);
    grouped.get(r.symbol).push(r);
  }

  const catalog = [];
  for (const symbol of KLINE_SYMBOLS) {
    const u = universe.bySymbol.get(symbol);
    const blocks = {};
    let symbolStale = false;
    let symbolAsOf = null;
    for (const period of KLINE_PERIODS) {
      const r = grouped.get(symbol).find((x) => x.period === period);
      const rows = (r.rows || []).slice(-KLINE_LIMITS[period]);
      const asof = rows.length ? String(rows[rows.length - 1].time) : null;
      blocks[period] = {
        interval: period,
        count: rows.length,
        asof,
        stale: !!r.stale,
        source: 'tencent/eastmoney/binance（经 js/sources 适配器）',
        rows,
      };
      if (r.stale) symbolStale = true;
      if (asof && (!symbolAsOf || String(asof) > String(symbolAsOf))) symbolAsOf = asof;
    }
    const env = envelope('klines.symbol', {
      symbol,
      name: u ? u.name : symbol,
      market: u ? u.market : 'other',
      periods: blocks,
    }, {
      asof: symbolAsOf,
      source: '腾讯 ifzq / 东方财富 push2his / 币安 klines（复用 js/sources 口径）',
      stale: symbolStale,
      license: GENERAL_LICENSE,
      note: 'K 线只含时间与开高低收；周/月线为上游自然周期。',
    });
    writeJson('api/v1/klines/' + symbol + '.json', env);
    catalog.push({
      symbol,
      name: u ? u.name : symbol,
      market: u ? u.market : 'other',
      path: 'api/v1/klines/' + symbol + '.json',
      asof: symbolAsOf,
      stale: symbolStale,
      periods: Object.fromEntries(KLINE_PERIODS.map((p) => [p, {
        count: blocks[p].count, asof: blocks[p].asof, stale: blocks[p].stale,
      }])),
    });
  }

  const catalogEnv = envelope('klines.catalog', {
    count: catalog.length,
    periods: KLINE_PERIODS,
    symbols: catalog,
  }, {
    asof: maxIso(catalog.map((c) => c.asof)),
    source: '腾讯 ifzq / 东方财富 push2his / 币安 klines',
    stale: catalog.some((c) => c.stale),
    license: GENERAL_LICENSE,
    note: '每个标的的完整日/周/月序列在 api/v1/klines/{symbol}.json；MCP 的 get_klines 会优先实时抓取，失败再回退这些文件。',
  });
  writeJson('api/v1/markets/klines.json', catalogEnv);

  return {
    catalogEnv,
    count: catalog.length,
    ms: Date.now() - started,
    stale: catalogEnv.meta.stale,
    asof: catalogEnv.meta.asof,
    files: catalog.map((c) => c.path),
  };
}

/* ==================== 全球事件 ==================== */

const SEVERITY = { high: 85, med: 55, low: 30 };

/* 合规红线：API 产物里不得出现第三方预测/博彩平台品牌字样。
   新闻快讯可能整段引用平台名，宁可整条剔除，也不改写原文。 */
const BRAND_BLOCK = /polymarket/i;

function mentionsBlockedBrand(event) {
  const hay = [
    event.title, event.source, event.sourceUrl,
    ...(Array.isArray(event.relatedAssets) ? event.relatedAssets : []),
    ...(Array.isArray(event.relatedSymbols) ? event.relatedSymbols : []),
  ].join(' ');
  return BRAND_BLOCK.test(hay);
}

async function buildEvents() {
  const started = Date.now();
  const src = readJsonIf('data/events/global-events.json');
  const prev = readJsonIf('api/v1/events/global.json');
  if (!src || !Array.isArray(src.events)) {
    if (prev) return { env: prev, count: prev.data.count || 0, ms: Date.now() - started, stale: prev.meta.stale, asof: prev.meta.asof, reused: true };
    throw new Error('缺少 data/events/global-events.json，且没有历史 API 快照');
  }

  const rawEvents = src.events.filter((e) => !mentionsBlockedBrand(e));
  const blockedCount = src.events.length - rawEvents.length;
  const events = rawEvents.map((e) => ({
    id: e.id,
    category: e.type || 'other',
    title: e.title,
    source: e.source || null,
    sourceUrl: e.sourceUrl || null,
    publishedAt: toIso(e.publishedAt),
    country: e.country || null,
    lat: Number.isFinite(e.lat) ? e.lat : null,
    lng: Number.isFinite(e.lng) ? e.lng : null,
    severity: SEVERITY[e.importance] !== undefined ? SEVERITY[e.importance] : 30,
    importance: e.importance || 'low',
    relatedSymbols: Array.isArray(e.relatedSymbols) ? e.relatedSymbols : [],
    relatedAssets: Array.isArray(e.relatedAssets) ? e.relatedAssets : [],
  })).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));

  const catCount = new Map();
  const countryCount = new Map();
  for (const e of events) {
    catCount.set(e.category, (catCount.get(e.category) || 0) + 1);
    if (e.country) countryCount.set(e.country, (countryCount.get(e.country) || 0) + 1);
  }

  const asof = src.generatedAt || null;
  const stale = isStaleIso(asof, FRESHNESS_MINUTES['events.global']);
  const env = envelope('events.global', {
    count: events.length,
    windowHours: src.windowHours || null,
    categories: Array.from(catCount, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    countries: Array.from(countryCount, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    events,
  }, {
    asof,
    source: src.source || '公开新闻快讯（采集脚本产物）',
    stale,
    license: src.license || GENERAL_LICENSE,
    note: 'severity 是把上游 importance 映射成 0-100 的展示口径；坐标为关键词地理定位，精度为国家/地区级，定位不到时为 null。'
      + (blockedCount ? ' 含第三方平台品牌字样的 ' + blockedCount + ' 条快讯按合规口径未纳入。' : '')
      + (stale ? ' 上游采集任务多轮未更新，数据可能滞后。' : ''),
  });

  writeJson('api/v1/events/global.json', env);
  return { env, count: events.length, ms: Date.now() - started, stale, asof };
}

/* ==================== 预测市场 ==================== */

async function buildPrediction() {
  const started = Date.now();
  const src = readJsonIf('data/events/polymarket.json');
  const prev = readJsonIf('api/v1/prediction/markets.json');
  if (!src || !Array.isArray(src.events)) {
    if (prev) return { env: prev, count: prev.data.count || 0, ms: Date.now() - started, stale: prev.meta.stale, asof: prev.meta.asof, reused: true };
    throw new Error('缺少 data/events/polymarket.json，且没有历史 API 快照');
  }

  const events = src.events.map((e) => ({
    id: e.id,
    title: e.title || e.stem || '',
    titleZh: e.titleZh || null,
    category: e.category || 'other',
    partition: !!e.partition,
    endDate: Number.isFinite(e.endDate) ? e.endDate : null,
    updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt : null,
    outcomeCount: Number.isFinite(e.outcomeCount) ? e.outcomeCount : (Array.isArray(e.outcomes) ? e.outcomes.length : 0),
    outcomes: (Array.isArray(e.outcomes) ? e.outcomes : []).map((o) => ({
      id: o.id,
      label: o.label,
      labelZh: o.labelZh || null,
      probability: Number.isFinite(o.probability) ? o.probability : null,
      change24h: Number.isFinite(o.change24h) ? o.change24h : null,
    })),
    rest: e.rest && Number.isFinite(e.rest.probability)
      ? { probability: e.rest.probability, count: Number.isFinite(e.rest.count) ? e.rest.count : null }
      : null,
  })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const catCount = new Map();
  for (const e of events) catCount.set(e.category, (catCount.get(e.category) || 0) + 1);

  const asof = src.generatedAt || null;
  const stale = isStaleIso(asof, FRESHNESS_MINUTES['prediction.markets']);
  const env = envelope('prediction.markets', {
    count: events.length,
    categories: Array.from(catCount, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    events,
  }, {
    asof,
    source: '公开预测市场概率聚合（只读；不含平台标识与链接）',
    stale,
    license: '概率数值来自公开市场报价聚合，仅用于信息展示；不构成预测或投资建议。',
    note: 'probability 为 0-1 的隐含事件概率；outcomes 只保留档位标签与概率，不含平台标识、链接与交易功能。'
      + (stale ? ' 采集任务多轮未更新，概率可能滞后。' : ''),
  });

  writeJson('api/v1/prediction/markets.json', env);
  return { env, count: events.length, ms: Date.now() - started, stale, asof };
}

/* ==================== 机构持仓 ==================== */

async function buildInstitutions() {
  const started = Date.now();
  const f13 = readJsonIf('data/actors/13f.json');
  const etf = readJsonIf('data/actors/etf.json');
  const fh = readJsonIf('data/actors/fundholds.json');
  const prev = readJsonIf('api/v1/institutions/holdings.json');
  if ((!f13 || !Array.isArray(f13.institutions)) && prev) {
    return { env: prev, count: prev.data.institutions ? prev.data.institutions.length : 0, ms: Date.now() - started, stale: prev.meta.stale, asof: prev.meta.asof, reused: true };
  }

  const institutions = (f13 && Array.isArray(f13.institutions) ? f13.institutions : []).map((x) => ({
    slug: x.slug,
    name: x.name,
    cik: x.cik || null,
    filingCik: x.filingCik || null,
    reportDate: x.reportDate || null,
    filedAt: x.filedAt || null,
    lagDays: Number.isFinite(x.lagDays) ? x.lagDays : null,
    priorAvailable: !!x.priorAvailable,
    priorReportDate: x.priorReportDate || null,
    priorNote: x.priorNote || null,
    totalValueUsd: Number.isFinite(x.totalValueUsd) ? x.totalValueUsd : null,
    holdingsCount: Number.isFinite(x.holdingsCount) ? x.holdingsCount : (Array.isArray(x.holdings) ? x.holdings.length : 0),
    optionRows: Number.isFinite(x.optionRows) ? x.optionRows : null,
    holdings: Array.isArray(x.holdings) ? x.holdings : [],
    exits: Array.isArray(x.exits) ? x.exits : [],
  }));

  const etfBlock = etf ? {
    asOf: etf.asOf || null,
    published: etf.published || null,
    lagDays: Number.isFinite(etf.lagDays) ? etf.lagDays : null,
    funds: ApiSafe(etf.funds),
    overlap: etf.overlap || null,
  } : null;

  const fhBlock = fh ? {
    reportDate: fh.reportDate || null,
    reportDateName: fh.reportDateName || null,
    lagDays: Number.isFinite(fh.lagDays) ? fh.lagDays : null,
    partial: !!fh.partial,
    disclosureScope: fh.disclosureScope || null,
    fundsReporting: Number.isFinite(fh.fundsReporting) ? fh.fundsReporting : null,
    topAdd: Array.isArray(fh.topAdd) ? fh.topAdd : [],
    topTrim: Array.isArray(fh.topTrim) ? fh.topTrim : [],
  } : null;

  const asof = maxIso([f13 && f13.generatedAt, etf && etf.generatedAt, fh && fh.generatedAt]);
  const stale = isStaleIso(asof, FRESHNESS_MINUTES['institutions.holdings']);
  const env = envelope('institutions.holdings', {
    asOf: asof,
    institutions,
    etf: etfBlock,
    fundHoldings: fhBlock,
  }, {
    asof,
    source: 'SEC EDGAR 13F · 发行方公开 ETF 持仓 · 东方财富基金持仓统计',
    stale,
    license: '公开披露数据；13F 为季度持仓，ETF 为发行方日更全量持仓，基金口径为季度前十大汇总。',
    note: '13F 报告期末到提交日实测滞后 34~45 天，每家机构的 lagDays 已单列；ETF 是规则化因子产品的被动持仓，不是基金经理主观判断；基金合计持仓含被动申赎，加减仓不能读成主动判断。'
      + (stale ? ' 本数据集已超过 10 天未更新。' : ''),
  });

  writeJson('api/v1/institutions/holdings.json', env);
  return { env, count: institutions.length, ms: Date.now() - started, stale, asof };
}

/* 只保留上报字段（递归剔除任何交易活跃度键），保证 API 产物与合规口径一致 */
function ApiSafe(value) {
  if (Array.isArray(value)) return value.map(ApiSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/vol/i.test(k) || /liquidity/i.test(k)) continue;
      out[k] = ApiSafe(v);
    }
    return out;
  }
  return value;
}

/* ==================== 宏观序列 ==================== */

const FRED_CATALOG = [
  { id: 'DGS10', name: '美国10年期国债收益率' },
  { id: 'DGS2', name: '美国2年期国债收益率' },
  { id: 'FEDFUNDS', name: '联邦基金利率' },
  { id: 'CPIAUCSL', name: '美国CPI' },
];

async function fetchWorldBankSeries() {
  const meta = loadWorldBankMeta();
  const isos = meta.countries.map((c) => c.iso).join(';');
  const catalog = [];
  const series = [];
  for (const [key, ind] of Object.entries(meta.indicators)) {
    catalog.push({ key, code: ind.code, label: ind.label, unit: ind.hint || null, source: '世界银行' });
    let rows = [];
    try {
      const url = 'https://api.worldbank.org/v2/country/' + isos + '/indicator/' + ind.code +
        '?format=json&per_page=500&date=2010:2026';
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenFinLens-Build/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      rows = Array.isArray(j) && j[1] ? j[1] : [];
    } catch (e) {
      console.warn('[worldbank] ' + key + ' 拉取失败：' + (e && e.message ? e.message : e));
      continue;
    }
    for (const country of meta.countries) {
      const points = rows
        .filter((r) => r && r.country && String(r.country.id).toUpperCase() === country.iso && typeof r.value === 'number')
        .map((r) => ({ date: String(r.date), value: r.value }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!points.length) continue;
      series.push({
        id: 'WB:' + country.iso + ':' + key,
        name: country.name + '·' + ind.label,
        country: country.name,
        iso: country.iso,
        indicator: key,
        indicatorLabel: ind.label,
        unit: ind.hint || null,
        freq: '年',
        source: '世界银行公开数据',
        points,
      });
    }
  }
  return { catalog, series };
}

async function buildMacro() {
  const started = Date.now();
  const prev = readJsonIf('api/v1/macro/series.json');
  let catalog = [];
  let series = [];
  let stale = false;
  let note = '世界银行年度指标，最新非空年份为准；不同国家的发布滞后 1 年属正常。FRED 序列因前端不内置访问密钥默认未启用，只给出口径目录。';

  if (!OFFLINE) {
    try {
      const got = await fetchWorldBankSeries();
      catalog = got.catalog;
      series = got.series;
    } catch (e) {
      console.warn('[macro] 世界银行序列拉取失败：' + (e && e.message ? e.message : e));
    }
  }

  if (!series.length && prev && prev.data && Array.isArray(prev.data.series) && prev.data.series.length) {
    series = prev.data.series;
    catalog = prev.data.catalog || catalog;
    stale = true;
    note = '本轮构建未能获取世界银行序列，沿用上一次提交的快照；请结合 meta.asof 判断时效。';
  } else if (!series.length) {
    stale = true;
    note = '本轮构建未能获取世界银行序列，且没有历史快照；series 为空，不编造数字。';
  }

  const asof = maxIso(series.map((s) => (s.points && s.points.length ? s.points[s.points.length - 1].date : null)));
  const env = envelope('macro.series', {
    count: series.length,
    catalog,
    series,
    fred: {
      available: false,
      reason: '前端不内置访问密钥；如需 FRED 序列，请在部署环境自行注入或走代理。',
      series: FRED_CATALOG,
    },
  }, {
    asof,
    source: '世界银行公开 API（api.worldbank.org），指标口径复用 js/sources/worldbank.js',
    stale,
    license: '世界银行公开数据（CC BY 4.0）；仅用于信息展示。',
    note,
  });

  writeJson('api/v1/macro/series.json', env);
  return { env, count: series.length, ms: Date.now() - started, stale, asof };
}

/* ==================== manifest / index / health / openapi ==================== */

function sampleOf(id, built) {
  const env = built[id] && built[id].env;
  const d = env ? env.data : null;
  switch (id) {
    case 'index':
      return { version: VERSION, generatedAt: GENERATED_AT, count: DATASETS.length, datasets: [{ id: 'quotes.latest', title: '行情快照', path: 'api/v1/quotes/latest.json', stale: false }], entrypoints: { manifest: 'api/v1/manifest.json', health: 'api/v1/health.json', openapi: 'api/openapi.json' } };
    case 'manifest':
      return { version: VERSION, generatedAt: GENERATED_AT, base: 'api/v1', datasets: [{ id: 'quotes.latest', title: '行情快照', path: 'api/v1/quotes/latest.json', kind: 'data' }] };
    case 'universe':
      return d && d.symbols.length ? d.symbols[0] : null;
    case 'quotes.latest':
      return d && d.quotes.length ? d.quotes[0] : null;
    case 'klines.catalog':
      return d ? { count: d.count, periods: d.periods, symbols: d.symbols.slice(0, 1) } : null;
    case 'klines.symbol': {
      const files = (built['klines.symbol'] && built['klines.symbol'].files) || [];
      const first = files.length ? readJsonIf(files[0]) : null;
      if (!first || !first.data) return null;
      const p = first.data.periods.day;
      return { symbol: first.data.symbol, name: first.data.name, market: first.data.market, periods: { day: { interval: 'day', count: p.count, asof: p.asof, stale: p.stale, source: p.source, rows: p.rows.slice(0, 1) } } };
    }
    case 'events.global':
      return d && d.events.length ? d.events[0] : null;
    case 'prediction.markets':
      return d && d.events.length ? d.events[0] : null;
    case 'institutions.holdings':
      if (!d) return null;
      return {
        asOf: d.asOf,
        institutions: d.institutions.slice(0, 1).map((x) => ({ slug: x.slug, name: x.name, reportDate: x.reportDate, lagDays: x.lagDays, holdingsCount: x.holdingsCount })),
        etf: d.etf ? { asOf: d.etf.asOf, published: d.etf.published, lagDays: d.etf.lagDays, funds: d.etf.funds.slice(0, 1).map((f) => ({ key: f.key, ticker: f.ticker, zh: f.zh })), overlap: d.etf.overlap ? { keys: d.etf.overlap.keys, labels: d.etf.overlap.labels } : null } : null,
        fundHoldings: d.fundHoldings ? { reportDate: d.fundHoldings.reportDate, reportDateName: d.fundHoldings.reportDateName, lagDays: d.fundHoldings.lagDays, topAdd: d.fundHoldings.topAdd.slice(0, 1), topTrim: d.fundHoldings.topTrim.slice(0, 1) } : null,
      };
    case 'macro.series':
      if (!d) return null;
      return {
        count: d.count,
        catalog: d.catalog.slice(0, 1),
        series: d.series.slice(0, 1).map((s) => ({ ...s, points: s.points.slice(-2) })),
        fred: { available: d.fred.available, reason: d.fred.reason, series: d.fred.series.slice(0, 1) },
      };
    case 'health':
      return { status: 'ok', generatedAt: GENERATED_AT, durationMs: 0, datasets: [{ id: 'quotes.latest', lastBuilt: GENERATED_AT, count: 1, ms: 0, stale: false }] };
    default:
      return null;
  }
}

function buildManifest(stats) {
  const datasets = DATASETS.map((def) => {
    const stat = stats[def.id] || {};
    const env = stat.env;
    const fields = FIELD_DEFS[def.id] || FIELD_DEFS[def.id.split('.')[0]] || [];
    const sample = sampleOf(def.id, stats);
    const ds = {
      id: def.id,
      title: def.title,
      description: def.description,
      path: def.path,
      kind: def.kind,
      fields,
      sample,
      asof: stat.asof !== undefined ? stat.asof : null,
      stale: stat.stale === true,
      count: stat.count !== undefined ? stat.count : null,
      license: env ? env.meta.license : GENERAL_LICENSE,
      note: env ? env.meta.note : '',
    };
    if (def.path.includes('{')) {
      ds.files = (stats['klines.symbol'] && stats['klines.symbol'].files) || [];
    }
    return ds;
  });

  return envelope('manifest', {
    version: VERSION,
    base: 'api/v1',
    datasets,
  }, {
    asof: GENERATED_AT,
    source: '本项目构建产物（data/** 与 js/data/universe.js）',
    stale: false,
    license: GENERAL_LICENSE,
    note: 'fields 描述每个数据集条目级字段；sample 是与字段一一对应的示例对象。路径含 {symbol} 的数据集在 files 里列出全部具体文件。',
  });
}

function buildHealth(stats, durationMs) {
  const ids = DATASETS.map((d) => d.id);
  const rows = ids.map((id) => {
    const st = stats[id] || {};
    return {
      id,
      path: DATASETS.find((d) => d.id === id).path,
      lastBuilt: GENERATED_AT,
      asof: st.asof !== undefined ? st.asof : null,
      count: st.count !== undefined ? st.count : null,
      ms: REPRODUCIBLE ? 0 : (st.ms !== undefined ? st.ms : 0),
      stale: st.stale === true,
    };
  });
  const staleIds = rows.filter((r) => r.stale).map((r) => r.id);
  return envelope('health', {
    status: staleIds.length ? 'degraded' : 'ok',
    generatedAt: GENERATED_AT,
    durationMs,
    mode: OFFLINE ? 'offline' : 'live',
    staleDatasets: staleIds,
    datasets: rows,
  }, {
    asof: GENERATED_AT,
    source: '构建脚本自检',
    stale: false,
    license: GENERAL_LICENSE,
    note: 'status=degraded 表示至少一个数据集已过期；具体原因看 staleDatasets 与各数据集的 meta.note。',
  });
}

function buildIndex(manifestEnv, healthEnv) {
  const datasets = manifestEnv.data.datasets.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    path: d.path,
    kind: d.kind,
    asof: d.asof,
    stale: d.stale,
    count: d.count,
    updatedAt: GENERATED_AT,
  }));
  return envelope('index', {
    version: VERSION,
    generatedAt: GENERATED_AT,
    count: datasets.length,
    datasets,
    entrypoints: {
      manifest: 'api/v1/manifest.json',
      health: 'api/v1/health.json',
      openapi: 'api/openapi.json',
      universe: 'api/v1/universe.json',
    },
    health: healthEnv.data.status,
  }, {
    asof: GENERATED_AT,
    source: '本项目构建产物',
    stale: false,
    license: GENERAL_LICENSE,
    note: '先读本索引挑数据集，再读 manifest 看字段；stale=true 的数据集回答用户时必须说明时效。',
  });
}

function buildOpenApi() {
  const envelopeSchema = {
    type: 'object',
    required: ['ok', 'data', 'meta'],
    properties: {
      ok: { type: 'boolean', description: '是否成功；本 API 的静态产物恒为 true' },
      data: { description: '数据集业务内容，形状见 manifest 对应条目的 fields/sample' },
      meta: { $ref: '#/components/schemas/Meta' },
    },
    additionalProperties: true,
  };
  const paths = {};
  for (const def of DATASETS) {
    const p = '/' + def.path;
    const get = {
      operationId: def.id.replace(/[^A-Za-z0-9]+/g, '_'),
      summary: def.title,
      description: def.description,
      tags: [def.kind === 'meta' ? 'meta' : 'data'],
      responses: {
        200: {
          description: '统一信封响应',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
        },
      },
    };
    if (def.path.includes('{symbol}')) {
      get.parameters = [{
        name: 'symbol',
        in: 'path',
        required: true,
        description: '标的代码，取值见 api/v1/markets/klines.json 的 symbols[].symbol',
        schema: { type: 'string', examples: ['sh000001', 'usAAPL', 'BTCUSDT'] },
      }];
    }
    paths[p] = { get };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenFinLens 静态数据 API',
      version: '1.0.0',
      description: '纯静态、只读、无需访问密钥的全球金融数据 API。所有端点返回 { ok, data, meta } 统一信封；' +
        '数据滞后时 meta.stale=true。GitHub Pages 可直接 GET。',
      license: { name: 'MIT', url: 'https://github.com/5777-wq/openfinlens/blob/main/LICENSE' },
    },
    servers: [
      { url: 'https://5777-wq.github.io/openfinlens/', description: '生产（GitHub Pages）' },
      { url: 'http://127.0.0.1:8000/', description: '本地静态服务器（仓库根目录）' },
    ],
    tags: [
      { name: 'data', description: '业务数据集' },
      { name: 'meta', description: '索引、清单与自检' },
    ],
    paths,
    components: {
      schemas: {
        Envelope: envelopeSchema,
        Meta: {
          type: 'object',
          required: ['dataset', 'asof', 'generatedAt', 'source', 'stale', 'license', 'note'],
          properties: {
            dataset: { type: 'string', description: '数据集 id' },
            asof: { type: ['string', 'null'], description: '数据截止时间（ISO 8601 或日期串）；未知为 null' },
            generatedAt: { type: 'string', description: '构建时间（ISO 8601）' },
            source: { type: 'string', description: '数据来源说明' },
            stale: { type: 'boolean', description: '是否滞后或降级' },
            license: { type: 'string', description: '数据许可与使用边界' },
            note: { type: 'string', description: '口径与注意事项' },
          },
          additionalProperties: true,
        },
        Error: {
          type: 'object',
          required: ['ok', 'error'],
          properties: {
            ok: { type: 'boolean', enum: [false] },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}

/* ==================== 主流程 ==================== */

async function main() {
  const started = Date.now();
  console.log('[build-api] 开始：' + GENERATED_AT + (OFFLINE ? '（离线模式）' : '（联网模式）'));
  mkdirSync(V1, { recursive: true });

  const stats = {};

  const universe = buildUniverse();
  writeJson('api/v1/universe.json', universe.env);
  stats.universe = { env: universe.env, count: universe.rows.length, ms: 0, stale: false, asof: universe.env.meta.asof };
  console.log('[build-api] universe: ' + universe.rows.length + ' 个标的');

  const quotes = await buildQuotes(universe);
  stats['quotes.latest'] = quotes;
  console.log('[build-api] quotes: ' + quotes.count + ' 条，stale=' + quotes.stale);

  const klines = await buildKlines(universe);
  stats['klines.catalog'] = { ...klines, env: klines.catalogEnv };
  stats['klines.symbol'] = {
    env: null, count: klines.count, ms: klines.ms, stale: klines.stale, asof: klines.asof, files: klines.files,
  };
  console.log('[build-api] klines: ' + klines.count + ' 个标的 × ' + KLINE_PERIODS.length + ' 周期');

  const events = await buildEvents();
  stats['events.global'] = events;
  console.log('[build-api] events: ' + events.count + ' 条，stale=' + events.stale);

  const prediction = await buildPrediction();
  stats['prediction.markets'] = prediction;
  console.log('[build-api] prediction: ' + prediction.count + ' 个事件，stale=' + prediction.stale);

  const institutions = await buildInstitutions();
  stats['institutions.holdings'] = institutions;
  console.log('[build-api] institutions: ' + institutions.count + ' 家机构，stale=' + institutions.stale);

  const macro = await buildMacro();
  stats['macro.series'] = macro;
  console.log('[build-api] macro: ' + macro.count + ' 条序列，stale=' + macro.stale);

  // manifest 依赖数据集的统计；先占位 meta 条目，再回填自身
  stats.index = { env: null, count: DATASETS.length, ms: 0, stale: false, asof: GENERATED_AT };
  stats.manifest = { env: null, count: DATASETS.length, ms: 0, stale: false, asof: GENERATED_AT };
  stats.health = { env: null, count: DATASETS.length, ms: 0, stale: false, asof: GENERATED_AT };

  const manifest = buildManifest(stats);
  stats.manifest.env = manifest;
  writeJson('api/v1/manifest.json', manifest);
  console.log('[build-api] manifest: ' + manifest.data.datasets.length + ' 个数据集');

  const health = buildHealth(stats, REPRODUCIBLE ? 0 : Date.now() - started);
  stats.health.env = health;
  writeJson('api/v1/health.json', health);
  console.log('[build-api] health: ' + health.data.status);

  const index = buildIndex(manifest, health);
  stats.index.env = index;
  writeJson('api/v1/index.json', index);

  const openapi = buildOpenApi();
  writeJson('api/openapi.json', openapi);

  console.log('[build-api] 完成：' + Object.keys(stats).length + ' 个数据集，耗时 ' + (Date.now() - started) + 'ms');
  if (OFFLINE) console.log('[build-api] 提示：离线模式不会更新实时行情/K 线/宏观，stale 会如实保留。');
}

main().catch((e) => {
  console.error('[build-api] 失败：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
