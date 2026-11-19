#!/usr/bin/env node
/* to-placeholders.mjs —— 一次性把标的专文里的手写月末价换成构建期占位符

   背景：东财前复权序列会在分红/基准变化时整体重缩放历史值，文章手写的
   「月末价 2221.56」隔天就可能与序列对不上（collect 闸门 2026-10-23 首次拦下）。
   占位符 {{series:<sid>|<YYYY-MM>}} 由 build-content.mjs 在编译时从
   data/history 解析成数字——文章永远与数据卡一致。

   脚本做的事：对 content/assets/*.md 里匹配契约正则的数字
   （「月末价 X」「从 X 到 Y」），在对应序列里反查这个值落在哪个月，
   把数字替换成占位符。反查不到或一个月匹配多值时报错退出，人工处理。
   幂等：已替换过的文件不再有裸数字可匹配。 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const assetsSrc = await readFile(path.join(ROOT, 'js/views/assets.js'), 'utf8');
  const so = /const SERIES_OF = \{([\s\S]*?)\n  \};/.exec(assetsSrc);
  const SERIES_OF = {};
  for (const line of so[1].split('\n')) {
    const kv = /^\s*'?([^':]+)'?\s*:\s*'([^']+)'/.exec(line);
    if (kv) SERIES_OF[kv[1]] = kv[2];
  }

  const files = (await readdir(path.join(ROOT, 'content/assets'))).filter((f) => f.endsWith('.md'));
  let total = 0;
  for (const f of files) {
    const id = f.replace(/\.md$/, '');
    const sid = SERIES_OF[id] || id;
    const j = JSON.parse(await readFile(path.join(ROOT, 'data/history', sid + '.json'), 'utf8'));
    const byVal = new Map(); // toFixed(2) → [months]
    for (const p of j.points || []) {
      const k = Number(p.v).toFixed(2);
      byVal.set(k, [...(byVal.get(k) || []), p.t.slice(0, 7)]);
    }
    const p = path.join(ROOT, 'content/assets', f);
    let text = await readFile(p, 'utf8');
    let n = 0;
    let failed = 0;

    const replaceNum = (num) => {
      const months = byVal.get(Number(num).toFixed(2));
      if (!months || !months.length) { console.error(`  ✗ ${f}: ${num} 在 ${sid} 序列里找不到`); failed++; return num; }
      if (months.length > 1) { console.error(`  ✗ ${f}: ${num} 匹配多个月（${months.join(',')}），请人工指定`); failed++; return num; }
      n++;
      return `{{series:${sid}|${months[0]}}}`;
    };

    text = text.replace(/月末价\s*([\d.]+)/g, (m, num) => '月末价 ' + replaceNum(num));
    text = text.replace(/从\s*([\d.]+)\s*到\s*([\d.]+)/g, (m, a, b) => '从 ' + replaceNum(a) + ' 到 ' + replaceNum(b));

    if (n) { await writeFile(p, text, 'utf8'); }
    total += n;
    console.log(`${f}: 替换 ${n} 处${failed ? '，失败 ' + failed + ' 处' : ''}`);
  }
  if (total === 0) console.log('没有需要替换的裸数字（可能已全部转换）');
}

main().catch((e) => { console.error('[to-placeholders] 失败：', e); process.exit(1); });
