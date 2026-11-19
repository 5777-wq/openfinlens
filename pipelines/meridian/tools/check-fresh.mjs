#!/usr/bin/env node
/* check-fresh.mjs —— Meridian 心跳检查：us-signals.json 的 marketDate 必须 == 最近已收盘交易日。
 * 移植自 us-stock-monitor tools/check-fresh.mjs，产物路径改为协议化 us-signals.json。
 * 退出码：0 新鲜；1 陈旧/缺失（CI 里触发失败告警 curl）。 */

import { readFileSync } from 'node:fs';
import { lastClosedDate } from '../../../core/engine/market-time.mjs';

const file = process.argv[2];
if (!file) { console.error('用法: node check-fresh.mjs <us-signals.json 路径>'); process.exit(1); }

let meta = null;
try {
  meta = JSON.parse(readFileSync(file, 'utf8')).marketClock || null;
} catch (e) { /* 读不出来按缺失处理 */ }

if (!meta || !meta.marketDate) {
  console.error('::error::us-signals.json 缺失或没有 marketClock.marketDate —— ' + file);
  process.exit(1);
}

const expect = lastClosedDate();
if (meta.marketDate === expect) {
  console.log('us-signals.json 新鲜：' + meta.marketDate);
  process.exit(0);
}
console.error('::error::us-signals.json 落后：marketDate=' + meta.marketDate + '，最近已收盘交易日=' + expect);
process.exit(1);
