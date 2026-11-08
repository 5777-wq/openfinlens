/* rpc.mjs —— MCP JSON-RPC 2.0 协议层（stdio，逐行 JSON，零依赖）
 *
 * 只实现 MCP 2024-11-05 的必要面：
 *   initialize / notifications/initialized / ping / tools/list / tools/call /
 *   resources/list / resources/read
 * 未知方法回 -32601；参数错误回 -32602；工具内部错误一律包成 result.isError，
 * 不让异常栈进入协议层。
 */

import readline from 'node:readline';
import { TOOLS, callTool } from './tools.mjs';
import { resourceList, readResource } from './api-store.mjs';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = {
  name: 'openfinlens',
  title: 'OpenFinLens 全球金融数据',
  version: '1.0.0',
};

const INSTRUCTIONS = [
  'OpenFinLens 是只读的公开金融数据 API，无需访问密钥。',
  '推荐调用顺序：list_datasets 看有哪些数据集 → get_manifest 看字段 → search_symbols 把用户口语解析成 symbol → get_quotes / get_klines / get_events / get_prediction_markets / get_institution_holdings / get_macro_series 取数据。',
  '所有响应都带 meta.asof 与 meta.stale：stale=true 表示数据滞后或降级，回答用户时要说明。',
  '数据只用于信息展示，不构成投资建议；不要据此推荐买卖。',
].join('\n');

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/* 单个 JSON-RPC 消息 → 响应对象（通知返回 undefined） */
export async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return rpcError(null, -32600, 'Invalid Request：消息必须是 JSON 对象');
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const id = hasId ? msg.id : undefined;
  const isNotification = !hasId;

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || !msg.method) {
    return isNotification ? undefined : rpcError(id, -32600, 'Invalid Request：缺少 jsonrpc=2.0 或 method');
  }

  const params = (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) ? msg.params : {};

  try {
    switch (msg.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });

      case 'ping':
        return rpcResult(id, {});

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return undefined;

      case 'tools/list':
        return rpcResult(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case 'tools/call': {
        if (typeof params.name !== 'string' || !params.name) {
          return rpcError(id, -32602, 'Invalid params：tools/call 需要字符串参数 name');
        }
        const result = await callTool(params.name, params.arguments, ctx);
        return rpcResult(id, result);
      }

      case 'resources/list':
        return rpcResult(id, { resources: resourceList() });

      case 'resources/read': {
        if (typeof params.uri !== 'string' || !params.uri) {
          return rpcError(id, -32602, 'Invalid params：resources/read 需要字符串参数 uri');
        }
        try {
          const content = readResource(params.uri);
          return rpcResult(id, { contents: [content] });
        } catch (e) {
          return rpcError(id, -32002, 'Resource not found：' + (e && e.message ? e.message : params.uri));
        }
      }

      default:
        return isNotification ? undefined : rpcError(id, -32601, 'Method not found：' + msg.method);
    }
  } catch (e) {
    return isNotification ? undefined : rpcError(id, -32603, 'Internal error：' + (e && e.message ? e.message : String(e)));
  }
}

/* stdio 逐行循环。串行处理，保证响应顺序与请求顺序一致。 */
export function runStdioServer({ offline = false, timeoutMs = 12000, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const ctx = { offline, timeoutMs };
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();

  const handleLine = async (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      stdout.write(JSON.stringify(rpcError(null, -32700, 'Parse error：无法解析 JSON')) + '\n');
      return;
    }
    const response = await handleMessage(msg, ctx);
    if (response !== undefined) stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', (line) => {
    chain = chain
      .then(() => handleLine(line))
      .catch((e) => {
        // 兜底：协议层绝不让进程崩掉；诊断只走 stderr，不污染 stdout
        try { stderr.write('[openfinlens-mcp] ' + (e && e.message ? e.message : String(e)) + '\n'); } catch { /* ignore */ }
      });
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      chain.then(() => resolve()).catch(() => resolve());
    });
  });
}
