#!/usr/bin/env node
/* reconcile.mjs —— 数字对账工具
   写文章时用它查准确值，别凭印象写数字。
   用法：
     node scripts/reconcile.mjs 2008-09-15            查某天所有序列的收盘价
     node scripts/reconcile.mjs 2008-09-15 SPX GC00Y  只查指定序列
     node scripts/reconcile.mjs --crisis 2008          查某个危机包的峰谷与最惨一天
     node scripts/reconcile.mjs --list                列出所有可用序列
*/
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'history');

const args = process.argv.slice(2);
/** 解析：--flag [value] 与位置参数分开 */
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { flags[args[i]] = next; i++; }
    else flags[args[i]] = true;
  } else {
    positional.push(args[i]);
  }
}

async function seriesIds() {
  const files = await readdir(DIR);
  return files.filter((f) => f.endsWith('.json') && !f.startsWith('crisis-')).map((f) => f.replace('.json', ''));
}

async function load(id) {
  const p = path.join(DIR, id + '.json');
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8'));
}

/** 取 <= date 的最近一个点 */
function atOrBefore(points, date) {
  let best = null;
  for (const p of points) {
    if (p.t <= date) best = p; else break;
  }
  return best;
}

/** 危机包里的日频数据（比月度序列精确得多，优先查） */
async function dailyIndex() {
  const files = await readdir(DIR);
  const map = new Map();
  for (const f of files.filter((x) => x.startsWith('crisis-') && x.endsWith('.json'))) {
    const pkg = JSON.parse(await readFile(path.join(DIR, f), 'utf8'));
    for (const s of pkg.series || []) {
      if (!map.has(s.key)) map.set(s.key, []);
      map.get(s.key).push({ pkg: pkg.title, byDate: new Map(s.points.map((p) => [p.t, p.v])) });
    }
  }
  return map;
}

async function main() {
  if (flags['--list']) {
    const ids = await seriesIds();
    for (const id of ids) {
      const s = await load(id);
      console.log(`${id.padEnd(11)} ${s.name}  ${s.points[0].t} → ${s.points[s.points.length - 1].t}  ${s.points.length} 点`);
    }
    return;
  }

  if (flags['--crisis']) {
    const id = flags['--crisis'];
    const p = path.join(DIR, 'crisis-' + id + '.json');
    if (!existsSync(p)) { console.error('没有这个危机包：' + id); process.exit(1); }
    const pkg = JSON.parse(await readFile(p, 'utf8'));
    console.log(`\n${pkg.title}  ${pkg.from} → ${pkg.to}  ${pkg.dates.length} 个交易日\n`);
    for (const s of pkg.series) {
      let peak = null, trough = null, worst = { pct: 0, t: '' };
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i];
        if (!peak || p.v > peak.v) peak = p;
        if (!trough || p.v < trough.v) trough = p;
        if (i > 0) {
          const pct = (p.v / s.points[i - 1].v - 1) * 100;
          if (pct < worst.pct) worst = { pct, t: p.t };
        }
      }
      const drop = ((trough.v / peak.v - 1) * 100).toFixed(2);
      console.log(`${s.name.padEnd(18)} 峰值 ${String(peak.v).padStart(12)} (${peak.t})  谷底 ${String(trough.v).padStart(12)} (${trough.t})  跌幅 ${drop}%  最惨一天 ${worst.pct.toFixed(2)}% (${worst.t})`);
    }
    console.log('\n事件：');
    pkg.events.forEach((e) => console.log(`  ${e.t}  ${e.title}`));
    console.log('');
    return;
  }

  const date = positional[0];
  if (!date) {
    console.log('用法：node scripts/reconcile.mjs <YYYY-MM-DD> [序列id...]');
    console.log('      node scripts/reconcile.mjs --crisis <id>');
    console.log('      node scripts/reconcile.mjs --list');
    return;
  }
  const want = positional.slice(1);
  const ids = want.length ? want : await seriesIds();
  const daily = await dailyIndex();
  console.log(`\n${date} 的收盘价（优先取日频，其次取该日或之前最近一个月末）\n`);
  for (const id of ids) {
    const s = await load(id);
    // 先找日频：危机包里如果有这一天的精确值，就用它
    let hit = null;
    for (const entry of daily.get(id) || []) {
      if (entry.byDate.has(date)) { hit = { v: entry.byDate.get(date), t: date, pkg: entry.pkg, freq: '日频' }; break; }
    }
    if (hit) {
      const nm = s ? s.name : id;
      console.log(`${id.padEnd(11)} ${nm.padEnd(16)} ${String(hit.v).padStart(14)} ${s ? (s.unit || '') : ''}  (${hit.t} · ${hit.freq} · ${hit.pkg})`);
      continue;
    }
    if (!s) { console.log(`${id.padEnd(11)} —— 没有这个序列`); continue; }
    const p = atOrBefore(s.points, date);
    if (!p) { console.log(`${id.padEnd(11)} ${s.name.padEnd(16)} —— 该日期之前没有数据`); continue; }
    console.log(`${id.padEnd(11)} ${s.name.padEnd(16)} ${String(p.v).padStart(14)} ${s.unit || ''}  (${p.t}${p.t !== date ? '，最近月末' : ''})`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
