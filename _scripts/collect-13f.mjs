#!/usr/bin/env node
/* collect-13f.mjs —— 多家机构的 13F-HR 持仓采集（SEC EDGAR 官方数据，浏览器永不直连 SEC）
   原 collect-brk.mjs 只做伯克希尔；本版推广为"机构清单"，并修掉三个实测坑：

   坑 1｜期权被当现货：原按 CUSIP 聚合，实测 ARK 的 00214Q104 同时有 91,105 股正股与
        8,900 张 Call，会被合并成"100,005 股"。现在聚合键是 **CUSIP + 看涨看跌**，
        并在产物里给每行标 kind（SH / CALL / PUT）。
   坑 2｜13F-NT 静默漏一期：机构把持仓交给另一个申报主体时会交 13F-NT（无持仓表）。
        实测 Pershing Square 2026Q2 就是 13F-NT，只找 13F-HR 会把上一季当成"最新"。
        现在按报告期取最新一期，若是 13F-NT 就读它的 otherManagersInfo.cik 顺藤找到
        真正持有持仓的申报主体，再取那一期。
   坑 3｜滞后不透明：13F 是季度披露，实测报告期末到提交日滞后 34~45 天。产物里直接给出
        lagDays，前端必须把天数写在标题上——否则用户会以为是"最近持仓"。

   流程：submissions JSON → 最新一期（必要时顺藤）→ 两期 infotable.xml → 聚合（分 kind）
        → 环比 → data/actors/13f.json（随仓库提交，前端只读这份静态 JSON）。
   口径：13F 是季度披露的美股**多头**持仓（SEC 2023-01 起 value 为整美元），
        不含空头/非美资产；期权以 putCall 单独成行，其"股数"是名义合约股数，不是持股。
   原则：宁缺毋假——某家机构失败不影响其他家；全部失败则 exit 1 且绝不改写旧文件。 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'actors', '13f.json');

/* 机构清单：CIK 均实测可用（entityName 已核对）。
   Scion 未纳入：其实测最新一期停在 2025-09-30，此后无新 13F——放进来只会显示陈旧数据。
   伯克希尔排第一（前端默认选中）。 */
const INSTITUTIONS = [
  { slug: 'berkshire', name: '伯克希尔·哈撒韦', cik: '0001067983', short: 'Berkshire' },
  { slug: 'bridgewater', name: '桥水基金', cik: '0001350694', short: 'Bridgewater' },
  { slug: 'ark', name: 'ARK 投资', cik: '0001697748', short: 'ARK' },
  { slug: 'pershing', name: 'Pershing Square', cik: '0001336528', short: 'Pershing' },
];

// SEC 公平访问政策要求"名称 + 可联系邮箱"；实测 noreply 类隐私代理邮箱域名会被 WAF 403
const UA = 'OpenFinLens AdminContact@proton.me';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const noLead = (cik) => String(cik).replace(/^0+/, '');

/* 部分 WAF（含 SEC 在部分网络下）按 TLS/HTTP 指纹放行 curl、拦 Node fetch：
   fetch 403 时退避重试，仍不行就落到 curl 再试一轮（Actions 上通常用不到）。 */
function curlGet(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-s', '--max-time', '25', '-A', UA, url], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

async function get(url, attempt = 0) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    // SEC 公平访问政策：必须带可联系的 User-Agent；限流时退避重试
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(4000 * (attempt + 1));
      return get(url, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (e) {
    if (attempt >= 3 || (e.message && !e.message.includes('HTTP 403'))) {
      try { return await curlGet(url); } catch { throw e; }
    }
    await sleep(4000 * (attempt + 1));
    return get(url, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

/* 目录里挑 infotable：命名不统一（infotable.xml / Form13FInfoTable.xml / 56757.xml …），
   先按名字匹配，兜底取第一个非 primary_doc/coverpage 的 xml */
function pickInfoTableXml(dirItems) {
  const files = (dirItems || []).map(x => String(x.name || '')).filter(n => /\.xml$/i.test(n));
  return files.find(n => /infotable|form13finfo|informationtable/i.test(n))
    || files.find(n => !/primary_doc|coverpage|signature|submission/i.test(n))
    || files[0];
}

/* infotable xml → 行数组。命名空间无关的正则解析，只取必需字段——不上 XML 解析器（零依赖约束）。 */
function parseInfoTable(xml) {
  const blocks = xml.split(/<\/[\w:]*infoTable>/i).slice(0, -1);
  const rows = [];
  for (const b of blocks) {
    const tag = (name) => {
      const m = b.match(new RegExp('<[\\w:]*' + name + '>([^<]*)</[\\w:]*' + name + '>', 'i'));
      return m ? m[1].trim() : '';
    };
    const sharesM = b.match(/<[\w:]*sshPrnamt>([^<]*)<\/[\w:]*sshPrnamt>/i);
    const issuer = tag('nameOfIssuer');
    // SEC 自 2023-01 起 13F value 字段为整美元（此前是千美元）；只抓最近两期，必然都是新口径
    const valueUsd = +tag('value');
    const shares = sharesM ? +sharesM[1].replace(/,/g, '') : NaN;
    if (!issuer || !isFinite(valueUsd)) continue;
    const pc = tag('putCall').toUpperCase();
    rows.push({
      issuer,
      cusip: tag('cusip'),
      valueUsd,
      shares: isFinite(shares) ? shares : null,
      // 坑 1：期权必须与正股分开，否则同一 CUSIP 的正股与期权会被加成一个数
      kind: pc === 'CALL' ? 'CALL' : pc === 'PUT' ? 'PUT' : 'SH',
      discretion: tag('investmentDiscretion') || null,
    });
  }
  return rows;
}

/* 同一发行人的正股/多账户按 **CUSIP + 持仓类型** 聚合（期权不并入正股） */
function aggregate(rows) {
  const m = new Map();
  rows.forEach(r => {
    const k = (r.cusip || r.issuer) + '|' + r.kind;
    const prev = m.get(k);
    if (prev) {
      prev.valueUsd += r.valueUsd;
      if (r.shares !== null) prev.shares = (prev.shares || 0) + r.shares;
    } else {
      m.set(k, { issuer: r.issuer, cusip: r.cusip, kind: r.kind, valueUsd: r.valueUsd, shares: r.shares });
    }
  });
  return Array.from(m.values());
}

async function fetchQuarter(cik, accession) {
  const dir = accession.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${noLead(cik)}/${dir}`;
  const idx = JSON.parse(await get(base + '/index.json'));
  const xmlName = pickInfoTableXml(idx.directory && idx.directory.item);
  if (!xmlName) throw new Error('infotable xml not found in ' + accession);
  const xml = await get(base + '/' + encodeURIComponent(xmlName));
  return aggregate(parseInfoTable(xml));
}

/* 13F-NT（无持仓表）→ 读它 primary doc 里的 otherManagersInfo.cik，找到真正申报持仓的主体。
   实测 Pershing Square 2026Q2 属此情形：NT 由 CIK 1336528 提交，点名 PERSHING SQUARE INC.
   (CIK 0002026053) 才是持仓申报人。 */
async function resolveNtManager(cik, accession) {
  const dir = accession.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${noLead(cik)}/${dir}`;
  const idx = JSON.parse(await get(base + '/index.json'));
  const files = (idx.directory && idx.directory.item) || [];
  const primary = files.find(x => /primary_doc\.xml$/i.test(String(x.name || '')))
    || files.find(x => /\.xml$/i.test(String(x.name || '')));
  if (!primary) return null;
  const xml = await get(base + '/' + encodeURIComponent(primary.name));
  const m = xml.match(/<[\w:]*otherManager>[\s\S]*?<[\w:]*cik>(\d+)<\/[\w:]*cik>/i)
    || xml.match(/<[\w:]*cik>(\d{7,10})<\/[\w:]*cik>/i);
  return m ? m[1].padStart(10, '0') : null;
}

/* 取一家机构的最近两期：按报告期归并 13F-HR / 13F-NT，取最新一期（必要时顺藤），再取上上期 */
async function fetchInstitution(inst) {
  const sub = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${inst.cik}.json`));
  const f = (sub.filings && sub.filings.recent) || {};
  if (!Array.isArray(f.form)) throw new Error('submissions 结构异常');
  const byPeriod = new Map();   // reportDate → { hr: acc|null, nt: acc|null }
  for (let i = 0; i < f.form.length; i++) {
    const form = f.form[i];
    if (form !== '13F-HR' && form !== '13F-NT') continue;
    const rd = f.reportDate ? f.reportDate[i] : null;
    if (!rd) continue;
    if (!byPeriod.has(rd)) byPeriod.set(rd, { hr: null, nt: null });
    const slot = byPeriod.get(rd);
    const acc = { accession: f.accessionNumber[i], reportDate: rd, filedAt: f.filingDate ? f.filingDate[i] : null };
    if (form === '13F-HR') { if (!slot.hr) slot.hr = acc; }
    else if (!slot.nt) slot.nt = acc;
  }
  const periods = Array.from(byPeriod.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));   // 报告期倒序
  if (!periods.length) throw new Error('未找到 13F-HR / 13F-NT');

  const cur = periods[0];
  let filingCik = inst.cik;
  let acc = cur[1].hr;
  let viaNt = null;
  if (!acc && cur[1].nt) {
    // 坑 2：最新一期只有 NT → 顺藤找持仓申报主体，并在同一报告期里取它的 13F-HR
    await sleep(600);
    const mgrCik = await resolveNtManager(inst.cik, cur[1].nt.accession);
    if (!mgrCik) throw new Error(`${cur[0]} 只有 13F-NT 且未能解析出承接主体`);
    const sub2 = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${mgrCik}.json`));
    const g = (sub2.filings && sub2.filings.recent) || {};
    for (let i = 0; i < (g.form || []).length; i++) {
      if (g.form[i] === '13F-HR' && g.reportDate && g.reportDate[i] === cur[0]) {
        acc = { accession: g.accessionNumber[i], reportDate: cur[0], filedAt: g.filingDate ? g.filingDate[i] : null };
        filingCik = mgrCik;
        viaNt = cur[1].nt.accession;
        break;
      }
    }
    if (!acc) throw new Error(`${cur[0]} 的承接主体 ${mgrCik} 未找到同期 13F-HR`);
  }
  if (!acc) throw new Error('未找到可用的 13F-HR');

  // 上一期：优先取报告期更早的那一期（同样允许顺藤）
  let prevAgg = null, prevAcc = null;
  for (const [rd, slot] of periods.slice(1)) {
    try {
      await sleep(600);
      if (slot.hr) { prevAgg = await fetchQuarter(filingCik, slot.hr.accession); prevAcc = slot.hr; break; }
    } catch (e) { console.error(`  ${inst.short} 上一期 ${rd} 失败: ` + e.message); }
  }

  const curAgg = await fetchQuarter(filingCik, acc.accession);
  return { acc, curAgg, prevAgg, prevAcc, filingCik, viaNt };
}

function buildPayload(inst, r) {
  const { acc, curAgg, prevAgg, prevAcc, filingCik, viaNt } = r;
  const key = (h) => (h.cusip || h.issuer) + '|' + (h.kind || 'SH');
  const prevMap = new Map((prevAgg || []).map(h => [key(h), h]));
  const totalValueUsd = curAgg.reduce((s, h) => s + h.valueUsd, 0);
  const holdings = curAgg.map(h => {
    const p = prevMap.get(key(h));
    let change = 'HOLD', sharesChange = null, sharesChangePct = null;
    if (!p) change = 'NEW';
    else if (h.shares !== null && p.shares !== null && p.shares > 0) {
      sharesChange = h.shares - p.shares;
      sharesChangePct = (h.shares - p.shares) / p.shares * 100;
      if (Math.abs(sharesChangePct) < 0.005) change = 'HOLD';
      else change = sharesChange > 0 ? 'ADD' : 'TRIM';
    }
    return {
      issuer: h.issuer, cusip: h.cusip, kind: h.kind || 'SH',
      valueUsd: h.valueUsd, shares: h.shares,
      pctOfTotal: totalValueUsd ? +(h.valueUsd / totalValueUsd * 100).toFixed(2) : null,
      change, sharesChange,
      sharesChangePct: sharesChangePct === null ? null : +sharesChangePct.toFixed(2),
    };
  }).sort((a, b) => b.valueUsd - a.valueUsd);

  const exits = prevAgg
    ? prevAgg.filter(h => !curAgg.some(c => key(c) === key(h)))
      .sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 12)
      .map(h => ({ issuer: h.issuer, cusip: h.cusip, kind: h.kind || 'SH', prevShares: h.shares }))
    : [];

  // 坑 3：把真实滞后算出来给前端（报告期末 → 提交日），前端必须显示
  const lagDays = (acc.reportDate && acc.filedAt)
    ? Math.round((Date.parse(acc.filedAt + 'T00:00:00Z') - Date.parse(acc.reportDate + 'T00:00:00Z')) / 86400000)
    : null;

  return {
    slug: inst.slug, name: inst.name, cik: inst.cik,
    filingCik,                       // 实际申报持仓的主体（13F-NT 顺藤后与 cik 不同）
    viaNtAccession: viaNt || null,   // 非空表示本期是经 13F-NT 顺藤得到的
    reportDate: acc.reportDate,
    filedAt: acc.filedAt,
    lagDays,
    priorReportDate: prevAcc ? prevAcc.reportDate : null,
    totalValueUsd,
    holdingsCount: holdings.length,
    optionRows: holdings.filter(h => h.kind !== 'SH').length,
    // 期权行必须落在产物里：按市值排序它们常排到 80 名之外（实测 ARK 那张 Call 在 191 行的后半），
    // 被 slice 切掉后前端只能显示"含 N 项期权"却看不到任何一行。Top80 + 全部期权行（去重后按市值重排）。
    holdings: (() => {
      const top = holdings.slice(0, 80);
      const opts = holdings.filter(h => h.kind !== 'SH' && !top.includes(h));
      return top.concat(opts).sort((a, b) => b.valueUsd - a.valueUsd);
    })(),
    exits,
  };
}

async function main() {
  const out = [];
  for (const inst of INSTITUTIONS) {
    try {
      console.log(`拉取 ${inst.short}（CIK ${inst.cik}）…`);
      const r = await fetchInstitution(inst);
      const p = buildPayload(inst, r);
      console.log(`  ✓ ${p.reportDate} 提交 ${p.filedAt}（滞后 ${p.lagDays} 天）· ${p.holdingsCount} 项`
        + `${p.optionRows ? '（含 ' + p.optionRows + ' 项期权）' : ''}`
        + `${p.viaNtAccession ? ' · 经 13F-NT 顺藤至 CIK ' + p.filingCik : ''}`);
      out.push(p);
    } catch (e) {
      console.error(`  ✗ ${inst.short} 失败（跳过，不影响其他机构）: ` + e.message);
    }
    await sleep(600);
  }
  if (!out.length) throw new Error('全部机构均失败——不写文件，保留旧产物');

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'SEC EDGAR · 13F-HR（多家机构，官方季度披露）',
    confidence: 'REPORTED',
    note: '13F 为季度披露的美股多头持仓，含看涨/看跌期权（kind=CALL/PUT，其"股数"为名义合约股数，不是持股）。'
      + '报告期末到提交日实测滞后 34~45 天，每家机构的 lagDays 已单列，界面必须把天数标出。'
      + '不含空头（除 put）/非美资产；环比为与上一期同 CUSIP 同类型的股数对比；CUSIP 换码可能误标"新进"。'
      + '全部为历史事实陈述，不构成任何建议。',
    institutions: out,
  };

  const body = JSON.stringify(payload, null, 1);
  if (body.length > 3 * 1024 * 1024) {
    console.error('产物体积异常（' + body.length + 'B），拒绝写入');
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body + '\n') {
    console.log('内容无变化，不写文件');
    return;
  }
  writeFileSync(OUT, body + '\n');
  console.log(`写入 ${OUT}：${out.length} 家机构 · ${out.map(p => p.short || p.name + '@' + p.reportDate).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
