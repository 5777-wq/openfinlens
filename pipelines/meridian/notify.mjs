/* notify.mjs —— 可选信号推送（默认关闭，config.notify.enabled 打开）
 * 移植自 Meridian lib/notify.mjs（原样；密钥优先级 env > config.local > config.json，
 * CI 的 NOTIFY_* GitHub Secrets 与本模块约定一致）。
 * 支持三通道（按配置可多开）：
 *   · Server酱（sctapi.ftqq.com/<KEY>.send，微信接收）
 *   · Bark（iOS，https://api.day.app/<key>/<title>/<body>）
 *   · Telegram Bot（sendMessage）
 * 只推"有内容"的日子（onlySignals=true 时无超买/超卖/事件则不发）。 */

import { execFile } from 'node:child_process';

const enc = encodeURIComponent;

function viaCurlPost(url, form) {
  return new Promise((resolve) => {
    const args = ['-s', '--max-time', '15', '-X', 'POST', url];
    for (const [k, v] of Object.entries(form || {})) args.push('--data-urlencode', `${k}=${v}`);
    execFile('curl', args, { windowsHide: true, timeout: 20000 }, () => resolve());
  });
}

async function post(url, bodyObj) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(15000) });
    // 推送失败不影响监控主流程，但必须留痕（不再静默吞掉）[FIX-05]
    if (!r.ok) console.error('[notify] http', r.status, '<-', url.slice(0, 60));
  } catch (e) {
    // fetch 被墙/失败时退 curl（本机实测对多数海外接口更通）
    try { await viaCurlPost(url, bodyObj); }
    catch (e2) { console.error('[notify] failed', (e2 || e).message, '<-', url.slice(0, 60)); }
  }
}

export function composeMessage(data) {
  const { meta, spmo, summary } = data;
  const ls = (r) => `${r.ticker}(${r.rsi6 ? r.rsi6.value.toFixed(0) : '--'})`;
  const lines = [];
  lines.push(`SPMO 收盘 ${spmo ? spmo.close.toFixed(2) : '--'} · RSI6 ${spmo && spmo.rsi6 ? spmo.rsi6.value.toFixed(1) : '--'}`);
  if (summary.obReturn && summary.obReturn.length) lines.push('【超买回落·做T回补观察】' + summary.obReturn.map(ls).join(' '));
  if (summary.osReturn && summary.osReturn.length) lines.push('【超卖回升·吸纳确认观察】' + summary.osReturn.map(ls).join(' '));
  if (summary.overbought.length) lines.push('【超买·做T观察】' + summary.overbought.map(ls).join(' '));
  if (summary.oversold.length) lines.push('【超卖·吸纳观察】' + summary.oversold.map(ls).join(' '));
  if (summary.events.length) {
    // 每个标的带出事件方向：主通道上穿=向上突破，回落=自上方回归通道，回升=自下方回归通道
    const evTxt = (t) => t.key.replace('通道', '') + (t.event === 'break_up' ? '上穿' : t.event === 'break_down' ? '下穿' : t.event === 'reenter_up' ? '回升' : '回落');
    lines.push('【通道事件】' + summary.events.map((r) => {
      const evs = (r.tunnels || []).filter((t) => t.event).map(evTxt);
      const evsWk = (r.wk && r.wk.tunnels || []).filter((t) => t && t.event).map((t) => '周' + evTxt(t));
      return r.ticker + '（' + [...evs, ...evsWk].join('·') + '）';
    }).join(' '));
  }
  if (!lines.length) lines.push('今日无信号');
  return { title: `Meridian ${meta.marketDate}`, body: lines.join('\n') + `\n(${meta.generatedAtLocal})` };
}

/* 告警通道 [FIX-05]：与信号推送分开——监控失败/心跳过期时直接发，不受 onlySignals 影响。
 * CI 里失败告警由 workflow 的 curl 步骤承担（Secrets 直读）；本函数供本地/脚本场景复用。 */
export async function sendAlert(ncIn, title, body) {
  const env = process.env;
  const nc = {
    ...ncIn,
    serverchanSendkey: env.NOTIFY_SERVERCHAN_KEY || ncIn?.serverchanSendkey || '',
    barkUrl: env.NOTIFY_BARK_URL || ncIn?.barkUrl || '',
    telegramToken: env.NOTIFY_TELEGRAM_TOKEN || ncIn?.telegramToken || '',
    telegramChatId: env.NOTIFY_TELEGRAM_CHAT_ID || ncIn?.telegramChatId || '',
  };
  const jobs = [];
  if (nc.serverchanSendkey) jobs.push(post(`https://sctapi.ftqq.com/${nc.serverchanSendkey}.send`, { title, desp: body }));
  if (nc.barkUrl) jobs.push(post(nc.barkUrl.replace(/\/$/, '') + '/' + enc(title) + '/' + enc(body.slice(0, 180)), {}));
  if (nc.telegramToken && nc.telegramChatId) jobs.push(post(`https://api.telegram.org/bot${nc.telegramToken}/sendMessage`, { chat_id: nc.telegramChatId, text: `*${title}*\n${body}` }));
  await Promise.all(jobs);
  return jobs.length > 0;
}

export async function notifyIfEnabled(ncIn, data) {
  // 密钥优先取环境变量（CI 走 GitHub Secrets），其次 config.local/config.json——避免 token 进公开仓库
  const env = process.env;
  const nc = {
    ...ncIn,
    serverchanSendkey: env.NOTIFY_SERVERCHAN_KEY || ncIn?.serverchanSendkey || '',
    barkUrl: env.NOTIFY_BARK_URL || ncIn?.barkUrl || '',
    telegramToken: env.NOTIFY_TELEGRAM_TOKEN || ncIn?.telegramToken || '',
    telegramChatId: env.NOTIFY_TELEGRAM_CHAT_ID || ncIn?.telegramChatId || '',
  };
  if (!nc || !nc.enabled) return;
  const { summary } = data;
  const hasSignal = summary.overbought.length || summary.oversold.length || summary.events.length;
  if (nc.onlySignals && !hasSignal) return;
  const { title, body } = composeMessage(data);
  const jobs = [];
  if (nc.serverchanSendkey) {
    jobs.push(post(`https://sctapi.ftqq.com/${nc.serverchanSendkey}.send`, { title, desp: body.replace(/\n/g, '\n\n') }));
  }
  if (nc.barkUrl) {
    jobs.push(post(nc.barkUrl.replace(/\/$/, '') + '/' + enc(title) + '/' + enc(body.slice(0, 180)), {}));
  }
  if (nc.telegramToken && nc.telegramChatId) {
    jobs.push(post(`https://api.telegram.org/bot${nc.telegramToken}/sendMessage`,
      { chat_id: nc.telegramChatId, text: `*${title}*\n${body}`, disable_notification: !hasSignal }));
  }
  await Promise.all(jobs);
}
