#!/usr/bin/env node
/* collect-fundholds.mjs —— A股 基金持仓变动采集（东财数据中心，免密钥）
   产物 data/actors/fundholds.json（随仓库提交，前端只读这份静态 JSON）。

   口径（必须原样透传到界面，否则会被误读）：
   · 这是**基金合计**口径（东财 ORG_TYPE=01），包含主动基金与 **ETF/指数基金**——
     所以"加仓"里混着被动申购，实测加仓榜前列是京东方A/交通银行/农业银行这类宽基权重，
     不能当成"主动基金经理在买"。界面必须写明这一点。
   · 季度披露，且**滞后大**（产物里给 lagDays = 报告期末到今天的天数），界面必须显示。
   · 拿不到"哪只基金持有什么"：该接口是**按股票聚合**的（谁被基金持有多少），
     基金名称要逐股走另一个无 CORS 的单股接口，全市场要 5000+ 次请求，不做。

   ★ 报告期必须"披露完整"才用（2026-10 修的 P0，这段判据别删）
   季度报告是**陆续披露**的：报告期结束后 15 个工作日内基金才陆续交当期报告，头几天
   只有极少数基金交了，接口里当期行数就是"已交报告的基金"的子集。直接取字典里的最新
   REPORT_DATE 就会拿到这种**残缺期**；而上游的"变动"是按"新期合计 − 上期合计"算的，
   残缺期里"上期"是完整的，于是几乎所有股票都成了"巨量减仓"——实测 2026-10-20：
   2026-09-30 期只有 237 只股票（36 只基金交过报告，Σ持股对 362），榜单里出现
   "减仓工商银行 152 亿"这种与事实相反的资金流信号（真实情况是没人交三季报）。
   所以取报告期要过两道闸门（见下方"完整性判定"）：
     ① 披露窗口已关闭：法定期限（一/三季报 15 个工作日、中报 2 个月、年报 3 个月）已过；
        或上游字典的 IS_COMPLETE 标记为 1（实测只有最新一期是 0，但不知它何时翻 1，
        所以只有覆盖度也接近去年水平（≥95%）时才认这条捷径）。
     ② 覆盖度达标：与**去年同期同类型**报告期相比，"每股平均被几只基金持有"不低于 85%。
   任一条不满足就往前回退到上一个合格期；一个合格期都没有 → exit 1，保留旧产物。

   ★ 为什么要跟"去年同期同类型"比（而不是紧邻的上一期）：
   季报（一/三季报）只披露**前十大重仓股**，中报/年报披露**全部持仓**，两者的
   行数/持仓对数差一个数量级（实测 2026-06-30 中报 5311 只股票 / 88.0 万持仓对，
   2026-03-31 一季报 3916 只 / 8.6 万）。拿紧邻上一期当基准，一季报会被永远判成
   "残缺"；拿去年同季比才能把"披露深度差异"消掉，剩下的才是"有没有交齐"。

   取数：同一报表按 HOLDCHA_NUM 降序/升序各取 2 页（接口 pageSize 上限 500），
   拿到"增仓最多 / 减仓最多"各 1000 行，再按**变动金额**（变动股数 × 隐含单价）重排取 Top。
   隐含单价 = HOLD_VALUE / TOTAL_SHARES（该股的基金合计持仓市值 ÷ 持股数），不需要额外行情源。
   ★ 取数必须带 REPORT_DATE 过滤：否则残缺期的行（变动股数巨大、排序靠前）会把上一期的
     行挤出分页窗口，"回退到上一期"就变成了"用上一期的残缺片段"。
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

/* ---- 完整性判定参数（口径见文件头） ---- */
const CANDIDATE_MAX = 5;      // 最多往前回退几期（够覆盖一个完整季度）
const COV_MIN = 0.85;         // 覆盖度下限：相对去年同期同类型，"每股平均持有基金数"之比
const COV_FLAG_MIN = 0.95;    // 走"上游 IS_COMPLETE"捷径时要求更严（该捷径可能提前翻牌）
const SCAN_MAX_PAGES = 14;    // 单期扫描页数上限（500/页 → 7000 行，实测最大期 5311 行）

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

const isoUTC = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoUTC(d); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return isoUTC(d); };
// 工作日只扣周末：法定节假日的调休无法预知，后面统一加缓冲天数兜住
function addWorkdays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  let c = 0;
  while (c < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) c++; }
  return isoUTC(d);
}

/* 披露深度类型：季报（一/三季报）只披露前十大重仓股，中报/年报披露全部持仓。
   这是《公开募集证券投资基金信息披露管理办法》的硬规则（季度报告的组合报告只列前十名股票），
   不是写死的日期特例——所以跨年、跨季度都成立。 */
const isTop10Period = (rd) => { const md = rd.slice(5); return md === '03-31' || md === '09-30'; };
const scopeOf = (rd) => (isTop10Period(rd) ? 'TOP10' : 'FULL');

/* 去年同期同类型（跨年对比用；季末月日相同，报告期都是季末，不存在 2/29 之类的边界） */
const prevYearSameType = (iso) => (Number(iso.slice(0, 4)) - 1) + iso.slice(4);
/* 全持仓期找"同一季度的前十大期"当参照：2026-06-30 → 2026-03-31，2025-12-31 → 2025-09-30 */
function siblingTop10(iso) {
  const y = iso.slice(0, 4), md = iso.slice(5);
  if (md === '06-30') return y + '-03-31';
  if (md === '12-31') return y + '-09-30';
  return null;
}

/* 法定披露期限：过了这天，这期就该交齐了
   （《公开募集证券投资基金信息披露管理办法》第二十条：季报 15 个工作日、中报 2 个月、年报 3 个月）。
   工作日只扣周末（节假日调休预知不了），再统一 +10 自然日缓冲覆盖节假日顺延。 */
function usableAfter(rd) {
  const md = rd.slice(5);
  if (md === '03-31' || md === '09-30') return addDays(addWorkdays(rd, 15), 10);
  if (md === '06-30') return addDays(addMonths(rd, 2), 10);
  return addDays(addMonths(rd, 3), 10);
}

/* 报告期字典：带 IS_COMPLETE（上游自己标的"这期已完整"） */
async function fetchDictionary() {
  const j = await get(API + '?' + new URLSearchParams({
    reportName: 'RPT_MAIN_REPORTDATE', columns: 'ALL', pageNumber: '1', pageSize: '200',
    sortColumns: 'REPORT_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB',
  }));
  const rows = (j && j.success && j.result && Array.isArray(j.result.data)) ? j.result.data : [];
  return rows.map(r => ({
    date: String(r.REPORT_DATE || '').slice(0, 10),
    name: String(r.REPORT_DATE_NAME || ''),
    upstreamComplete: String(r.IS_COMPLETE || '') === '1',
  })).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

/* 某报告期的"披露画像"：扫全量行，统计这只股票被多少只基金持有（HOULD_NUM）
   · stocks      = 该期有基金持仓的股票数
   · pairs       = Σ HOULD_NUM = 基金-股票持仓对数（**披露进度的直接量**：交了几只基金就翻几倍）
   · avgHolders  = pairs / stocks = 每只股票平均被几只基金持有（跨期可比的"深度"指标）
   · maxHolders  = 单只股票最多的持有基金数
   实测（2026-10-20）：2026-09-30 期 237 只股票 / 362 对 / 单股 1.5 只基金（残缺）；
   2025-09-30 期 3767 只 / 78677 对 / 单股 20.9 只基金（完整）。 */
async function profilePeriod(rd) {
  const filter = `(ORG_TYPE="01")(REPORT_DATE='${rd}')`;
  const q = (pn, pageSize) => API + '?' + new URLSearchParams({
    reportName: 'RPT_MAIN_ORGHOLD', columns: 'SECURITY_CODE,HOULD_NUM', filter,
    pageNumber: String(pn), pageSize: String(pageSize),
    sortColumns: 'SECURITY_CODE', sortTypes: '1', source: 'WEB', client: 'WEB',
  }).toString();
  const head = await get(q(1, 1));
  const stocks = (head && head.result && typeof head.result.count === 'number') ? head.result.count : 0;
  let pairs = 0, rows = 0, maxHolders = 0;
  const pages = Math.min(Math.ceil(stocks / 500), SCAN_MAX_PAGES);
  if (Math.ceil(stocks / 500) > SCAN_MAX_PAGES) {
    console.warn(`  ! ${rd} 有 ${stocks} 行，超过扫描上限（${SCAN_MAX_PAGES} 页），覆盖度会偏低`);
  }
  for (let pn = 1; pn <= pages; pn++) {
    const j = await get(q(pn, 500));
    const data = (j && j.result && Array.isArray(j.result.data)) ? j.result.data : [];
    for (const r of data) {
      const h = num(r.HOULD_NUM) || 0;
      rows++; pairs += h; if (h > maxHolders) maxHolders = h;
    }
    if (pn < pages) await sleep(200);
  }
  // 扫描期间数据可能在变（正在披露的期会边扫边长）——对不上就说明这不是一个稳定快照
  if (stocks && rows !== stocks) console.warn(`  ! ${rd} 扫描行数 ${rows} 与 count ${stocks} 不一致（数据正在变动）`);
  return { stocks, rows, pairs, maxHolders, avgHolders: rows ? pairs / rows : 0 };
}

/* 单只股票最多的持有基金数（1 个请求，用于快速对标，不扫全量） */
async function maxHoldersOf(rd) {
  const j = await get(API + '?' + new URLSearchParams({
    reportName: 'RPT_MAIN_ORGHOLD', columns: 'SECURITY_CODE,HOULD_NUM',
    filter: `(ORG_TYPE="01")(REPORT_DATE='${rd}')`,
    pageNumber: '1', pageSize: '1', sortColumns: 'HOULD_NUM', sortTypes: '-1',
    source: 'WEB', client: 'WEB',
  }));
  const r = (j && j.result && Array.isArray(j.result.data) && j.result.data[0]) ? j.result.data[0] : null;
  return r ? (num(r.HOULD_NUM) || 0) : 0;
}

/* 估算"本期已披露的基金只数"（前端要显示"这一期有多少只基金交了报告"）
   · 前十大期：每只基金最多披露 10 只重仓股 → Σ(每股被几只基金持有) ÷ 10 ≈ 已披露基金数
     （实测 2026-03-31：85855 ÷ 10 ≈ 8,586 只，与公募基金数量级吻合）
   · 全持仓期：每只基金披露的持仓数不固定，折不出来；用**同一季度的前十大期**近似
     （同一批基金披露，基金数基本相同），并用 maxHolders 粗查参照期是否也残缺。 */
async function estimateFundsReporting(rd, prof, dict) {
  if (isTop10Period(rd)) {
    return { funds: Math.round(prof.pairs / 10), basis: '前十大期：Σ(每股持有基金数) ÷ 10' };
  }
  const sib = siblingTop10(rd);
  if (!sib) return { funds: null, basis: '全持仓期：无同期前十大期，无法折算' };
  const sp = await profilePeriod(sib);
  const sibRef = dict.find(x => x.date === prevYearSameType(sib));
  if (sibRef) {
    const rm = await maxHoldersOf(sibRef.date);
    if (rm > 0 && sp.maxHolders < 0.6 * rm) {
      console.warn(`  ! 同期前十大期 ${sib} 看起来也不完整（单股最多 ${sp.maxHolders} 只基金 vs 去年 ${rm}），本期基金数不折算`);
      return { funds: null, basis: `全持仓期：同期前十大期 ${sib} 疑似残缺，未折算` };
    }
  }
  return { funds: Math.round(sp.pairs / 10), basis: `全持仓期：用同期前十大期 ${sib} 折算（同一批基金）` };
}

const urlOf = (rd, sort, pn) => API + '?' + new URLSearchParams({
  reportName: 'RPT_MAIN_ORGHOLD',
  columns: COLS,
  filter: `(ORG_TYPE="01")(REPORT_DATE='${rd}')`,  // ★ 锁定到已判定完整的报告期
  pageNumber: String(pn), pageSize: '500',   // 接口上限 500
  sortColumns: 'REPORT_DATE,HOLDCHA_NUM',
  sortTypes: '-1,' + sort,                   // 报告期恒降序；变动股数按需升/降
  source: 'WEB', client: 'WEB',
}).toString();

/* 取"变动股数"某一端的前 N 行（分页并发） */
async function fetchSide(rd, sort, pages = 2) {
  const jobs = [];
  for (let pn = 1; pn <= pages; pn++) jobs.push(get(urlOf(rd, sort, pn)));
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
  console.log('拉取报告期字典…');
  const dict = await fetchDictionary();
  if (!dict.length) throw new Error('拿不到报告期字典');
  const today = isoUTC(new Date());

  /* ---- 完整性判定：从最新一期往前找第一个"披露完整"的期 ---- */
  console.log('逐期做完整性判定（法定披露窗口 + 覆盖度对比去年同期同类型）…');
  let picked = null;   // 选中的完整期
  let rejected = null; // 比选中期更新的那一期（= 下一期），用于"还没披露完"的提示
  for (const c of dict.slice(0, CANDIDATE_MAX)) {
    const ref = dict.find(x => x.date === prevYearSameType(c.date));
    const prof = await profilePeriod(c.date);
    const profRef = ref ? await profilePeriod(ref.date) : null;
    const usable = usableAfter(c.date);
    const legalClosed = today > usable;
    const cov = (profRef && profRef.avgHolders > 0) ? prof.avgHolders / profRef.avgHolders : 0;
    // 主路径：法定披露期限已过（过了这天绝大多数基金就交齐了）+ 覆盖度没塌
    // 捷径：上游自己标了 IS_COMPLETE=1（但不知它何时翻牌，所以覆盖度要求更严）
    const legalOk = legalClosed && cov >= COV_MIN;
    const flagOk = c.upstreamComplete && cov >= COV_FLAG_MIN;
    const ok = legalOk || flagOk;
    const why = legalOk ? '法定期限已过'
      : flagOk ? '上游标记完整'
        : !legalClosed ? '披露窗口未关闭' : '覆盖度不足';
    console.log(`  ${c.date} ${c.name}｜股票 ${prof.stocks} 持仓对 ${prof.pairs} 单股均 ${prof.avgHolders.toFixed(1)} 只基金`
      + `｜参考 ${ref ? ref.date : '无'}(${profRef ? profRef.avgHolders.toFixed(1) : '-'})`
      + `｜覆盖度 ${(cov * 100).toFixed(1)}%｜可用日 ${usable}｜${ok ? '✔ ' + why : '✘ ' + why}`);
    if (ok) { picked = { c, prof, ref, profRef, cov, usable, why }; break; }
    rejected = { c, prof, cov, usable, why };
  }
  if (!picked) throw new Error('没有任何报告期通过完整性判定——不写文件，保留旧产物');

  const reportDate = picked.c.date;
  const reportDateName = picked.c.name;
  console.log(`选用 ${reportDate} ${reportDateName}（${picked.why}，覆盖度 ${(picked.cov * 100).toFixed(1)}%）`);

  await sleep(400);
  console.log('拉取增仓端（按变动股数降序 ×2 页）…');
  const addRows = await fetchSide(reportDate, '-1');
  await sleep(400);
  console.log('拉取减仓端（按变动股数升序 ×2 页）…');
  const trimRows = await fetchSide(reportDate, '1');

  const clean = (rows) => rows
    .map(shape)
    .filter(x => x.code && x.reportDate === reportDate && x.chgShares !== null && x.chgValue !== null);

  const add = clean(addRows).filter(x => x.chgShares > 0).sort(byAbsChgValue).slice(0, 40);
  const trim = clean(trimRows).filter(x => x.chgShares < 0).sort(byAbsChgValue).slice(0, 40);
  if (!add.length && !trim.length) throw new Error('两端都没取到有效行——不写文件，保留旧产物');

  const lagDays = Math.round((Date.now() - Date.parse(reportDate + 'T00:00:00Z')) / 86400000);

  /* ---- 产物里的完整性元信息（前端据此显示"这期完整 / 下一期还没披露完"） ---- */
  const fr = await estimateFundsReporting(reportDate, picked.prof, dict);
  // 下一期同样给一个"已披露多少只基金"：它是残缺期，这个数恰恰能说明"才几家交了"
  const nfr = rejected ? await estimateFundsReporting(rejected.c.date, rejected.prof, dict) : null;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: '东财数据中心 · RPT_MAIN_ORGHOLD（基金口径，季度）',
    confidence: 'REPORTED',
    reportDate,
    reportDateName,
    lagDays,
    // —— 完整性元信息（新增，2026-10 P0 修复）——
    // partial: 本期是否残缺。脚本只写通过完整性判定的期，所以恒为 false；
    //   留这个字段是为了让前端不必猜——"没这个字段的旧产物"和"这期残缺"要能区分开。
    partial: false,
    // disclosureScope: 本期披露深度。'FULL'=中报/年报（披露全部持仓）；'TOP10'=一/三季报（只披露前十大重仓股）
    disclosureScope: scopeOf(reportDate),
    // fundsReporting: 本期已披露的基金只数（估算，口径见 fundsReportingBasis）
    fundsReporting: fr.funds,
    fundsReportingBasis: fr.basis,
    // coverageRatio: 覆盖度 = 本期"每股平均持有基金数" ÷ 去年同期同类型的同一指标（1.0 = 与去年持平）
    coverageRatio: Number(picked.cov.toFixed(3)),
    // refReportDate: 判定覆盖度时用的参考期（去年同期同类型）
    refReportDate: picked.ref ? picked.ref.date : null,
    // completenessBasis: 选中这一期的理由（'法定期限已过' / '上游标记完整'）
    completenessBasis: picked.why,
    // nextPeriodPending: 下一期（更新的那一期）是否还没披露完 —— true 时前端要提示"下一期仍在披露中"
    nextPeriodPending: !!rejected,
    nextPeriod: rejected ? {
      reportDate: rejected.c.date,
      reportDateName: rejected.c.name,
      disclosureScope: scopeOf(rejected.c.date),
      fundsReporting: nfr ? nfr.funds : null,
      fundsReportingBasis: nfr ? nfr.basis : null,
      usableAfter: rejected.usable,   // 预计这期披露完毕的日期（法定期限 + 缓冲）
      reason: rejected.why,           // 为什么还没被采用
    } : null,
    note: '这是**基金合计**持仓（含 ETF/指数基金），不是主动基金口径——被动申赎同样会体现为'
      + '"加仓/减仓"，所以榜单前列常是宽基权重股，不能读成"基金经理在买"。'
      + '季度披露且滞后大（界面显示的 lagDays 是距报告期末的天数）。'
      + '本期是**披露完整**的报告期（partial=false，判定依据见 completenessBasis / coverageRatio）。'
      + '注意：上游的"变动"是与**紧邻的上一报告期**相比，而一/三季报只披露前十大重仓股、中报/年报披露全部持仓——'
      + '所以中报的"加仓"天然偏大（上一期只统计了前十大），一/三季报的"减仓"天然偏大（上一期是全持仓），'
      + '两边的绝对金额都要当量级看，不能当精确的买卖金额。'
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
  console.log(`  完整性：${picked.why}（覆盖度 ${(picked.cov * 100).toFixed(1)}%，参考 ${picked.ref ? picked.ref.date : '-'}）`
    + `· 本期已披露约 ${fr.funds === null ? '—' : fr.funds} 只基金（${fr.basis}）`);
  if (rejected) {
    console.log(`  下一期 ${rejected.c.date} ${rejected.c.name}：尚未披露完（${rejected.why}，预计 ${rejected.usable} 后可用）`
      + `${nfr && nfr.funds !== null ? '· 目前约 ' + nfr.funds + ' 只基金已披露' : ''}`);
  } else {
    console.log('  下一期：暂无更新的报告期');
  }
  console.log('  增仓 Top3: ' + add.slice(0, 3).map(x => `${x.name} +${(x.chgValue / 1e8).toFixed(1)}亿`).join(', '));
  console.log('  减仓 Top3: ' + trim.slice(0, 3).map(x => `${x.name} ${(x.chgValue / 1e8).toFixed(1)}亿`).join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
