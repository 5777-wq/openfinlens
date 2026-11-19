#!/usr/bin/env node
/* build-content.mjs —— content/*.md → data/content/*.json（零依赖）
   frontmatter 支持：key: value、key: [a, b, c]、key: "带引号"
   数组也支持多行 - item 形式。 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'data', 'content');

/* ---------- 构建期占位符：{{series:<序列id>|<YYYY-MM>}} ----------
   正文里的「会动的数字」（月末价、从 X 到 Y）不许手写：前复权序列会在
   分红/基准变化时整体重缩放历史值，手写数字隔天就和数据卡对不上
   （2026-10-23 collect 闸门首次拦下）。写成占位符，这里从 data/history
   解析成数字——文章与序列永远一致。解析失败 = 构建失败，不许留空。 */
const SERIES_DIR = path.join(ROOT, 'data', 'history');
const seriesCache = new Map();
async function resolvePlaceholders(raw) {
  if (!raw.includes('{{series:')) return raw;
  return String(raw).replace(/\{\{series:([A-Za-z0-9._-]+)\|(\d{4}-\d{2})\}\}/g, (m, sid, month) => {
    if (!seriesCache.has(sid)) {
      try { seriesCache.set(sid, JSON.parse(readFileSync(path.join(SERIES_DIR, sid + '.json'), 'utf8'))); }
      catch (e) { throw new Error(`占位符引用的序列不存在：${sid}（data/history/${sid}.json 读不到：${e.message}）`); }
    }
    const j = seriesCache.get(sid);
    const pt = (j.points || []).find((x) => String(x.t).startsWith(month));
    if (!pt) throw new Error(`占位符解析失败：${sid} 在 ${month} 没有月末点`);
    // 输出 markdown 链接：数字本身不变，但读者能点开看这条序列的来源、图表与原始 JSON。
    // 站内路由 #/series/<id> 就是 data/history/<id>.json 的展示页。
    return '[' + Number(pt.v).toFixed(2) + '](#/series/' + sid + ')';
  });
}

/* 语义上就是数字的字段：只有这几个。
   其余一律保持字符串——related 里混着「1990」这类年份和术语 id，
   一旦被转成 Number，页面按字符串查索引就查不到，整块「接着读」会消失。 */
const NUMERIC_FIELDS = new Set(['readMinutes', 'difficulty']);

/** 只有字段名已知时才做数字强转；数组元素一律按字符串处理 */
function toNumberIfNumericField(key, val) {
  if (!NUMERIC_FIELDS.has(key)) return val;
  if (typeof val !== 'string') return val;
  const s = val.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : val;
}

function parseScalar(v) {
  const s = String(v).trim();
  if (!s) return '';
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  // 数字不在这里转：id、related 里混着年份和术语 id，转成 Number 就查不到了
  return s;
}

function parseValue(raw) {
  const v = String(raw).trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => parseScalar(x));
  }
  return parseScalar(v);
}

/** 极简 frontmatter 解析 */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(toNumberIfNumericField(currentKey, parseScalar(item[1])));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];
    if (val.trim() === '') { meta[key] = []; currentKey = key; }
    else { meta[key] = toNumberIfNumericField(key, parseValue(val)); currentKey = null; }
  }
  return { meta, body: m[2] };
}

async function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) out.push(...await walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * 这篇文章引用的数据，最新的一点是几号。
 *
 * 标的文的 id 就是序列 id，危机文的 id 对应 crisis-<id>.json。
 * 拿不到就返回 null（比如纯概念文，本来就没有自己的序列）。
 */
async function latestDataDate(id, section) {
  const name = section === 'crisis' ? 'crisis-' + id : id;
  const p = path.join(ROOT, 'data', 'history', name + '.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(await readFile(p, 'utf8'));
    if (j.points && j.points.length) return j.points[j.points.length - 1].t;
    if (j.dates && j.dates.length) return j.dates[j.dates.length - 1];
  } catch (e) { /* 读不了就当没有 */ }
  return null;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = await walk(SRC);
  const items = [];
  const stale = [];

  for (const f of files) {
    const raw = await resolvePlaceholders(await readFile(f, 'utf8'));
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.id) {
      console.warn(`[build] 跳过（没有 id）：${path.relative(SRC, f)}`);
      continue;
    }
    const id = String(meta.id);
    const section = meta.section || path.basename(path.dirname(f));
    /* dataAsOf 是手写的「本文写于哪天」，它永远停在写作那天。
       这里再算一个 dataAsOfActual：这篇文章引用的数据实际最新到哪天。
       页面上两个都显示，读者自己判断新鲜度；
       手写的那个比实际旧了，就在这里喊一声（不阻断）。 */
    const dataAsOfActual = await latestDataDate(id, section);
    const payload = Object.assign({}, meta, {
      id,
      section,
      body: body.trim(),
      dataAsOfActual: dataAsOfActual,
    });
    await writeFile(path.join(OUT, id + '.json'), JSON.stringify(payload, null, 2), 'utf8');
    if (dataAsOfActual && meta.dataAsOf && String(dataAsOfActual) > String(meta.dataAsOf)) {
      stale.push(`${id}：正文写的 dataAsOf=${meta.dataAsOf}，但它引用的数据已经到 ${dataAsOfActual}`);
    }
    items.push({
      id,
      section: payload.section,
      title: meta.title || id,
      dek: meta.dek || '',
      tag: meta.tag || '',
      tags: meta.tags || [],
      readMinutes: meta.readMinutes || null,
      dataAsOf: meta.dataAsOf || null,
      dataAsOfActual: dataAsOfActual,
      difficulty: meta.difficulty || null,
      updatedAt: meta.updatedAt || null,
      file: path.relative(SRC, f).replace(/\\/g, '/'),
    });
    console.log(`[build] ${id}  ← ${path.relative(SRC, f)}`);
  }

  items.sort((a, b) => (a.section || '').localeCompare(b.section || '') || String(a.id).localeCompare(String(b.id)));
  // 产物必须确定性：不能带时间戳，否则 CI 的一致性校验每次都会误报
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify({ items }, null, 2), 'utf8');

  // 「哪些终端标的在本站真的有标的页」——终端靠它判断该不该给标的页（不给半空页）。
  // 每次构建重新算：口径与页面完全一致，不手抄第二份映射。
  const { buildAssetIds } = await import('./export-asset-ids.mjs');
  const assetIds = await buildAssetIds();
  await writeFile(path.join(ROOT, 'content', '_meta', 'asset-ids.json'), JSON.stringify(assetIds, null, 2) + '\n', 'utf8');
  console.log(`[build] asset-ids.json（${assetIds.count} 个终端标的在本站有页）`);

  // 元数据目录里的 JSON 直接复制（术语库 / 新手路径）
  const metaDir = path.join(SRC, '_meta');
  if (existsSync(metaDir)) {
    for (const name of await readdir(metaDir)) {
      if (!name.endsWith('.json')) continue;
      const from = path.join(metaDir, name);
      const raw = await readFile(from, 'utf8');
      try {
        JSON.parse(raw);
      } catch (e) {
        const m = /position (\d+)/.exec(e.message);
        let where = '';
        if (m) {
          const lines = raw.slice(0, Number(m[1])).split(/\r?\n/);
          where = `（${name} 第 ${lines.length} 行附近）`;
        }
        throw new Error(`${name}${where} 不是合法 JSON：${e.message}\n`
          + '  提示：JSON 字符串里如果要引号，请用中文引号「」或""，不要用直引号 " "。');
      }
      await copyJson(from, path.join(OUT, name));
      console.log(`[build] ${name}（元数据）`);
    }
  }

  console.log(`[build] 完成：${items.length} 篇文章 → data/content/`);
  if (stale.length) {
    console.log('');
    console.warn(`[build] 提醒：${stale.length} 篇的 dataAsOf 比它引用的数据旧——`);
    stale.forEach((s) => console.warn('  · ' + s));
    console.warn('  dataAsOf 是「本文写于哪天」，页面会同时显示数据实际截止日；');
    console.warn('  想更新的话，把 frontmatter 里的 dataAsOf / updatedAt 一起改掉。');
  }
}

async function copyJson(from, to) {
  const j = JSON.parse(await readFile(from, 'utf8'));
  await writeFile(to, JSON.stringify(j, null, 2), 'utf8');
}

main().catch((e) => { console.error('[build] 失败：', e.message); process.exit(1); });
