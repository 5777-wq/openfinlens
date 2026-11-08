/* api-store.mjs —— MCP 侧读取静态 API 产物与标的解析（零依赖）
 *
 * 静态产物是 API 链路的兜底真相：api/v1/** 由 _scripts/build-api.mjs 生成并随仓库提交。
 * 这里只做三件事：读文件、校验统一信封、提供标的模糊匹配。
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './window-env.mjs';

export const API_DIR = path.join(ROOT, 'api');
export const V1_DIR = path.join(API_DIR, 'v1');
export const OPENAPI_PATH = path.join(API_DIR, 'openapi.json');

const fileCache = new Map();     // rel → { at, mtimeMs, value }

function absOf(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return path.normalize(p);
}

/* 读 JSON，带 mtime 失效的进程内缓存：静态文件重建后无需重启 server */
export function readJson(rel, { ttlMs = 30000 } = {}) {
  const abs = absOf(rel);
  const now = Date.now();
  const hit = fileCache.get(abs);
  let mtimeMs = null;
  try { mtimeMs = statSync(abs).mtimeMs; } catch { mtimeMs = null; }
  if (hit && (now - hit.at < ttlMs) && hit.mtimeMs === mtimeMs) return hit.value;
  if (!existsSync(abs)) throw new Error('找不到静态文件：' + rel);
  const value = JSON.parse(readFileSync(abs, 'utf8'));
  fileCache.set(abs, { at: now, mtimeMs, value });
  return value;
}

/* 读统一信封并校验最小结构；不合法时抛出可读错误（由工具层转成 isError） */
export function readEnvelope(rel) {
  const env = readJson(rel);
  if (!env || env.ok !== true || typeof env.meta !== 'object' || env.meta === null) {
    throw new Error('静态产物信封不合法：' + rel);
  }
  for (const key of ['dataset', 'asof', 'generatedAt', 'source', 'stale', 'license', 'note']) {
    if (!(key in env.meta)) throw new Error('信封缺少 meta.' + key + '：' + rel);
  }
  return env;
}

export function readManifest() {
  return readEnvelope('api/v1/manifest.json');
}

export function slimMeta(meta) {
  return {
    dataset: meta.dataset,
    asof: meta.asof,
    generatedAt: meta.generatedAt,
    source: meta.source,
    stale: meta.stale,
    license: meta.license,
    note: meta.note,
  };
}

/* ---------------- 标的宇宙与模糊匹配 ---------------- */

let uniCache = null;
let uniAt = 0;

export function universeSymbols() {
  if (uniCache && Date.now() - uniAt < 30000) return uniCache;
  const env = readEnvelope('api/v1/universe.json');
  const symbols = env.data && Array.isArray(env.data.symbols) ? env.data.symbols : [];
  uniCache = symbols;
  uniAt = Date.now();
  return symbols;
}

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');

function scoreOne(entry, q) {
  const symbol = norm(entry.symbol);
  const code = norm(entry.code);
  const name = norm(entry.name);
  const pinyin = norm(entry.pinyin);
  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(norm) : [];
  if (!q) return 0;
  if (symbol === q) return 1000;
  if (code === q) return 940;
  if (pinyin && pinyin === q) return 900;
  if (aliases.includes(q)) return 880;
  if (name === q) return 860;
  if (name.startsWith(q)) return 760;
  if (name.includes(q)) return 700;
  if (pinyin && pinyin.startsWith(q)) return 640;
  if (aliases.some((a) => a.startsWith(q))) return 620;
  if (symbol.includes(q)) return 560;
  if (aliases.some((a) => a.includes(q))) return 520;
  if (pinyin && pinyin.includes(q)) return 480;
  if (code.includes(q)) return 420;
  return 0;
}

/* 中文名 / 拼音首字母 / 代码 / 代码后缀 / 别名 五路模糊匹配，返回按分数排序的候选 */
export function searchSymbols(query, limit = 10) {
  const q = norm(query);
  if (!q) return [];
  const rows = universeSymbols()
    .map((entry) => ({ entry, score: scoreOne(entry, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.symbol.localeCompare(b.entry.symbol))
    .slice(0, Math.max(1, Math.min(50, limit)));
  return rows.map((x) => ({ ...x.entry, score: x.score }));
}

/* 把用户口语（600519 / 贵州茅台 / gzmt / AAPL / 苹果）解析成宇宙里的标准 symbol */
export function resolveSymbol(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  const symbols = universeSymbols();
  const lower = raw.toLowerCase();
  const bySymbol = symbols.find((s) => norm(s.symbol) === norm(raw));
  if (bySymbol) return bySymbol;

  // 纯数字：优先按 code 精确匹配（600519 → sh600519，00700 → hk00700）
  if (/^\d{2,6}$/.test(raw)) {
    const padded = raw.length <= 5 ? raw.padStart(5, '0') : raw;
    const byCode = symbols.find((s) => s.code === raw || s.code === padded);
    if (byCode) return byCode;
  }

  // 拉丁字母：常见美股/加密写法补前缀
  if (/^[a-z][a-z0-9.]{0,9}$/i.test(raw)) {
    const us = symbols.find((s) => norm(s.symbol) === 'us' + lower || norm(s.code) === lower);
    if (us) return us;
    const crypto = symbols.find((s) => norm(s.symbol) === lower + 'usdt' || norm(s.symbol) === lower + '-usdt');
    if (crypto) return crypto;
  }

  const ranked = searchSymbols(raw, 1);
  return ranked.length ? ranked[0] : null;
}

/* ---------------- resources ---------------- */

export function resourceList() {
  const env = readManifest();
  const datasets = env.data && Array.isArray(env.data.datasets) ? env.data.datasets : [];
  const out = [];
  for (const ds of datasets) {
    if (!ds || !ds.path || ds.path.includes('{')) continue;   // 模板路径不当作单个资源
    out.push({
      uri: 'openfinlens://' + ds.path,
      name: ds.id,
      title: ds.title || ds.id,
      description: ds.description || ds.title || ds.id,
      mimeType: 'application/json',
    });
  }
  out.push({
    uri: 'openfinlens://api/openapi.json',
    name: 'openapi',
    title: 'OpenAPI 3.1 描述',
    description: '全部 REST 端点的机器可读描述（路径、响应信封、示例）',
    mimeType: 'application/json',
  });
  return out;
}

export function readResource(uri) {
  const raw = String(uri || '').trim();
  let rel = raw;
  if (/^openfinlens:\/\//i.test(raw)) rel = raw.replace(/^openfinlens:\/\//i, '');
  else if (/^file:\/\//i.test(raw)) rel = raw.replace(/^file:\/\//i, '');
  rel = decodeURIComponent(rel).replace(/\\/g, '/');
  const normalized = path.posix.normalize(rel).replace(/^\/+/, '');
  if (!normalized.startsWith('api/') || normalized.includes('..')) {
    throw new Error('只允许读取 api/ 下的静态产物：' + raw);
  }
  const abs = path.normalize(path.join(ROOT, normalized));
  if (!abs.startsWith(path.normalize(API_DIR)) || !existsSync(abs)) {
    throw new Error('资源不存在：' + raw);
  }
  return {
    uri: 'openfinlens://' + normalized,
    mimeType: 'application/json',
    text: readFileSync(abs, 'utf8'),
  };
}
