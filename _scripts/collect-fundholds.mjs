#!/usr/bin/env node
/* collect-fundholds.mjs —— A股 基金持仓变动采集（东财数据中心，免密钥）
   产物 data/actors/fundholds.json（随仓库提交，前端只读这份静态 JSON）。

   口径（必须原样透传到界面，否则会被误读）：
   · 这是**基金合计**口径（东财 ORG_TYPE=01），包含主动基金与 **ETF/指数基金**——
     所以"加仓"里混着被动申购，实测加仓榜前列是京东方A/交通银行/农业银行这类宽基权重，
     不能当成"主动基金经理在买"。界面必须写明这一点。
   · 季度披露，且**滞后大**（实测最新完整期 2026-06-30 中报，距报告期末约 2.5 个月），
     产物里给 lagDays（报告期末到今天的天数），界面必须显示。
   · 拿不到"哪只基金持有什么"：该接口是**按股票聚合**的（谁被基金持有多少），
     基金名称要逐股走另一个无 CORS 的单股接口，全市场要 5000+ 次请求，不做。

   取数：同一报表按 HOLDCHA_NUM 降序/升序各取 2 页（接口 pageSize 上限 500），
   拿到"增仓最多 / 减仓最多"各 1000 行，再按**变动金额**（变动股数 × 隐含单价）重排取 Top。
   隐含单价 = HOLD_VALUE / TOTAL_SHARES（该股的基金合计持仓市值 ÷ 持股数），不需要额外行情源。
   原则：宁缺毋假——拿不到就不写文件、保留旧产物。 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'actors', 'fundholds.json');
const API = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
// datacenter 要求带 Referer（实测不带会被部分角色拦）
const HEADERS = { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' };
const COLS = 'SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE,REPORT_DATE,HOULD_NUM,TOTAL_SHARES,'
  + 'HOLD_VALUE,FREESHARES_RATIO,HOLDCHA,HOLDCHA_NUM,HOLDCHA_RATIO';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

async function get(url, attempt = 0) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: HEADERS });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(3000 * (attempt + 1));
      return get(url, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const urlOf = (sort, pn) => API + '?' + new URLSearchParams({
  reportName: 'RPT_MAIN_ORGHOLD',
  columns: COLS,
  filter: '(ORG_TYPE="01")',                 // 01 = 基金
  pageNumber: String(pn), pageSize: '500',   // 接口上限 500
  sortColumns: 'REPORT_DATE,HOLDCHA_NUM',
  sortTypes: '-1,' + sort,                   // 报告期恒降序；变动股数按需升/降
  source: 'WEB', client: 'WEB',
}).toString();

/* 取"变动股数"某一端的前 N 行（分页并发） */
async function fetchSide(sort, pages = 2) {
  const jobs = [];
  for (let pn = 1; pn <= pages; pn++) jobs.push(get(urlOf(sort, pn)));
  const res = await Promise.all(jobs);
  const rows = [];
  res.forEach(j => {
    if (j && j.success && j.result && Array.isArray(j.result.data)) rows.push(...j.result.data);
  });
  // 同一只股可能因分页位移重复出现（按变动股数排序时更明显）——按代码去重
  const seen = new Set();
  return rows.filter(r => {
    const c = String(r.SECURITY_CODE || '');
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}

function shape(r) {
  const shares = num(r.TOTAL_SHARES);
  const value = num(r.HOLD_VALUE);
  const chgShares = num(r.HOLDCHA_NUM);
  // 隐含单价 = 该股基金合计持仓市值 ÷ 持股数；用于把"变动股数"换算成"变动金额"
  const px = (shares && value && shares > 0) ? value / shares : null;
  return {
    code: String(r.SECURITY_CODE || ''),
    name: String(r.SECURITY_NAME_ABBR || ''),
    secucode: String(r.SECUCODE || ''),
    reportDate: String(r.REPORT_DATE || '').slice(0, 10),
    fundCount: num(r.HOULD_NUM),            // 持有该股的基金只数
    holdShares: shares,
    holdValue: value,
    freeRatio: num(r.FREESHARES_RATIO),     // 基金合计持股占流通股比 %
    chg: String(r.HOLDCHA || ''),           // '增仓' | '减仓'
    chgShares,
    chgRatio: num(r.HOLDCHA_RATIO),         // 变动幅度 %
    chgValue: (px !== null && chgShares !== null) ? chgShares * px : null,
  };
}

const byAbsChgValue = (a, b) => Math.abs(b.chgValue || 0) - Math.abs(a.chgValue || 0);

async function main() {
  console.log('拉取最新基金持仓报告期…');
  const rd = await get(API + '?' + new URLSearchParams({
    reportName: 'RPT_MAIN_REPORTDATE', columns: 'ALL', pageNumber: '1', pageSize: '1',
    sortColumns: 'REPORT_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB',
  }));
  const latest = rd && rd.success && rd.result && rd.result.data && rd.result.data[0];
  if (!latest) throw new Error('拿不到报告期字典');
  const reportDate = String(latest.REPORT_DATE || '').slice(0, 10);
  const reportDateName = String(latest.REPORT_DATE_NAME || '');
  console.log(`最新完整期：${reportDate} ${reportDateName}`);

  await sleep(400);
  console.log('拉取增仓端（按变动股数降序 ×2 页）…');
  const addRows = await fetchSide('-1');
  await sleep(400);
  console.log('拉取减仓端（按变动股数升序 ×2 页）…');
  const trimRows = await fetchSide('1');

  const clean = (rows) => rows
    .map(shape)
    .filter(x => x.code && x.reportDate === reportDate && x.chgShares !== null && x.chgValue !== null);

  const add = clean(addRows).filter(x => x.chgShares > 0).sort(byAbsChgValue).slice(0, 40);
  const trim = clean(trimRows).filter(x => x.chgShares < 0).sort(byAbsChgValue).slice(0, 40);
  if (!add.length && !trim.length) throw new Error('两端都没取到有效行——不写文件，保留旧产物');

  const lagDays = Math.round((Date.now() - Date.parse(reportDate + 'T00:00:00Z')) / 86400000);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: '东财数据中心 · RPT_MAIN_ORGHOLD（基金口径，季度）',
    confidence: 'REPORTED',
    reportDate,
    reportDateName,
    lagDays,
    note: '这是**基金合计**持仓（含 ETF/指数基金），不是主动基金口径——被动申赎同样会体现为'
      + '"加仓/减仓"，所以榜单前列常是宽基权重股，不能读成"基金经理在买"。'
      + '季度披露且滞后大（界面显示的 lagDays 是距报告期末的天数）。'
      + '接口按股票聚合，拿不到"哪只基金持有什么"（基金名称需逐股请求另一个无 CORS 的单股接口，'
      + '全市场 5000+ 次，不做）。变动金额 = 变动股数 × 隐含单价（持仓市值 ÷ 持股数）。'
      + '全部为历史事实陈述，不构成任何建议。',
    topAdd: add,
    topTrim: trim,
  };

  const body = JSON.stringify(payload, null, 1);
  if (body.length > 3 * 1024 * 1024) {
    console.error('产物体积异常（' + body.length + 'B），拒绝写入');
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  let old = null;
  try { old = readFileSync(OUT, 'utf8'); } catch { /* 首次生成 */ }
  if (old === body + '\n') { console.log('内容无变化，不写文件'); return; }
  writeFileSync(OUT, body + '\n');
  console.log(`写入 ${OUT}：${reportDate} ${reportDateName}（距期末 ${lagDays} 天）· 增仓 ${add.length} 条 · 减仓 ${trim.length} 条`);
  console.log('  增仓 Top3: ' + add.slice(0, 3).map(x => `${x.name} +${(x.chgValue / 1e8).toFixed(1)}亿`).join(', '));
  console.log('  减仓 Top3: ' + trim.slice(0, 3).map(x => `${x.name} ${(x.chgValue / 1e8).toFixed(1)}亿`).join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
