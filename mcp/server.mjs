#!/usr/bin/env node
/* server.mjs —— OpenFinLens MCP server（stdio + JSON-RPC 2.0，零第三方依赖）
 *
 * 用法：
 *   node mcp/server.mjs                # 正常模式：实时抓取优先，失败回退静态 API
 *   node mcp/server.mjs --offline      # 离线模式：只读 api/v1 静态产物（CI / 无网环境）
 *   OPENFINLENS_OFFLINE=1 node mcp/server.mjs
 *
 * 客户端接入方式见 mcp/README.md。协议实现见 mcp/lib/rpc.mjs，工具实现见 mcp/lib/tools.mjs。
 * 注意：stdout 只输出 JSON-RPC 消息；诊断信息一律走 stderr。
 */

import { runStdioServer, PROTOCOL_VERSION, SERVER_INFO } from './lib/rpc.mjs';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stderr.write([
    'OpenFinLens MCP server ' + SERVER_INFO.version,
    '协议版本：' + PROTOCOL_VERSION,
    '',
    '用法：node mcp/server.mjs [--offline]',
    '  --offline   只读 api/v1 静态产物，不发起任何网络请求',
    '',
    '环境变量：',
    '  OPENFINLENS_OFFLINE=1       等价于 --offline',
    '  OPENFINLENS_TIMEOUT_MS=12000  单次上游请求超时（毫秒）',
    '',
    'stdio 传输：一行一个 JSON-RPC 2.0 消息。',
  ].join('\n') + '\n');
  process.exit(0);
}

const offline = argv.includes('--offline') || process.env.OPENFINLENS_OFFLINE === '1';
const timeoutEnv = Number(process.env.OPENFINLENS_TIMEOUT_MS || 12000);
const timeoutMs = Number.isFinite(timeoutEnv) && timeoutEnv >= 1000 ? timeoutEnv : 12000;

process.stderr.write('[openfinlens-mcp] 启动：' + (offline ? '离线模式（只读静态快照）' : '在线模式（实时优先，失败回退静态快照）') + '\n');

runStdioServer({ offline, timeoutMs })
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write('[openfinlens-mcp] 退出：' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
