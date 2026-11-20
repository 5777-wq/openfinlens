/* iife.mjs —— ESM → window 命名空间的极薄桥接（core/bridge）
 *
 * 为什么存在：core/ 全部是原生 ESM（唯一真源），而 Academy 老视图与主仓未迁移脚本是
 * 经典 <script> IIFE、依赖 window 全局。裁定（2026-11-19）：不为洁癖重写老视图——
 * 由本模块把 core 挂回历史命名空间，老代码几乎零改动接入（Phase 4 正式切换）。
 *
 * 用法（页面侧二选一）：
 *   <script type="module" src="/core/bridge/auto.mjs"></script>          ← 自动安装
 *   <script type="module">
 *     import { installOn } from '/core/bridge/iife.mjs';
 *     installOn(window);                                                 ← 显式安装
 *   </script>
 *
 * 契约（_test/core-bridge.test.mjs 守住）：
 *   · window.OpenFinCore = { version, engine, compare } —— 新代码的规范入口；
 *   · window.Technical  = 主仓 js/technical.js 原语子集的同名同口径镜像；
 *     analyze/computeProfile 是视图聚合层，Phase 4 随视图迁移，此处刻意不提供——
 *     桥接缺谁一目了然，不做静默半兼容。
 * 本模块零 DOM / 零网络：installOn 的 target 由调用方给（测试注入普通对象即可）。 */

import * as indicators from '../engine/indicators.mjs';
import * as weekly from '../engine/weekly.mjs';
import * as marketTime from '../engine/market-time.mjs';
import * as signals from '../engine/signals.mjs';
import * as compare from '../engine/compare.mjs';

export const BRIDGE_VERSION = 'phase2';

/* installOn(target)：把 core 挂到 target（浏览器传 window；测试传普通对象）。
 * 幂等：重复安装覆盖同一批键，不累积。 */
export function installOn(target = globalThis) {
  const core = {
    version: BRIDGE_VERSION,
    engine: {
      // 序列原语（主仓 technical.js 口径）
      smaSeries: indicators.smaSeries,
      emaSeries: indicators.emaSeries,
      rsiSeries: indicators.rsiSeries,
      rsi: indicators.rsi,
      macd: indicators.macd,
      kdj: indicators.kdj,
      boll: indicators.boll,
      atr: indicators.atr,
      volumeRatio: indicators.volumeRatio,
      maSystem: indicators.maSystem,
      // Vegas 三通道（Meridian 口径）
      tunnelPos: indicators.tunnelPos,
      tunnelEvent: indicators.tunnelEvent,
      tunnelSnap: indicators.tunnelSnap,
      rsiSnap: indicators.rsiSnap,
      // 周线重采样
      resampleWeekly: weekly.resampleWeekly,
      weekEndOf: weekly.weekEndOf,
      // 美东交易日时钟
      etNow: marketTime.etNow,
      lastClosedDate: marketTime.lastClosedDate,
      splitClosed: marketTime.splitClosed,
      tradingDaysBetween: marketTime.tradingDaysBetween,
      // 单标的信号评估（Meridian 口径）
      evaluate: signals.evaluate,
      stalenessGate: signals.stalenessGate,
      summarize: signals.summarize,
    },
    compare,
  };
  target.OpenFinCore = core;
  target.Technical = {
    smaSeries: indicators.smaSeries,
    emaSeries: indicators.emaSeries,
    rsi: indicators.rsi,
    macd: indicators.macd,
    kdj: indicators.kdj,
    boll: indicators.boll,
    atr: indicators.atr,
    volumeRatio: indicators.volumeRatio,
    maSystem: indicators.maSystem,
  };
  return core;
}
