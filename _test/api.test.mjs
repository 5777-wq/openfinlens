/* api.test.mjs —— API 链路契约 + 合规 + MCP 协议冒烟（离线组，零外网）
 *
 * 覆盖：
 *   1. 统一信封：api/v1/** 下每个 JSON 可解析且 ok/meta 字段齐全；
 *   2. manifest 与实际文件一致：清单里列出的文件都存在，字段声明与 sample 匹配；
 *   3. index / health / manifest 三份元数据互相自洽；
 *   4. openapi.json 的路径集合与 manifest 完全一致（OpenAPI 3.1）；
 *   5. 合规红线：api/ 与 mcp/ 产物里不出现第三方预测平台品牌字样，不出现交易量类字段；
 *   6. MCP 协议冒烟：spawn node mcp/server.mjs（--offline），走 initialize → tools/list →
 *      tools/call → resources/list/read → ping，断言 id 对应、result 形状、工具数与文档一致。
 *
 * 本组不依赖真实网络：MCP 子进程用 OPENFINLENS_OFFLINE=1，静态端点直接读文件。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const V1_DIR = path.join(API_DIR, 'v1');
const ENVELOPE_KEYS = ['dataset', 'asof', 'generatedAt', 'source', 'stale', 'license', 'note'];
const FIELD_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

let pass = 0;
let fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('✓ ' + name);
  } catch (e) {
    fail++;
    console.log('✗ ' + name + '\n   ' + (e && e.message ? e.message : e));
  }
}

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const relOf = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/');

function walkFiles(absDir, out = []) {
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const p = path.join(absDir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function collectKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

/* ---------------- 1. 清单与信封 ---------------- */

const manifest = readJson('api/v1/manifest.json');
const datasets = manifest.data.datasets;

await test('manifest：统一信封与 meta 必填字段齐全', () => {
  assert.equal(manifest.ok, true, 'ok 必须是 true');
  assert.ok(manifest.data && Array.isArray(manifest.data.datasets), 'manifest.data.datasets 必须是数组');
  assert.ok(datasets.length >= 10, '数据集数量异常：' + datasets.length);
  assert.equal(manifest.meta.dataset, 'manifest');
  for (const key of ENVELOPE_KEYS) assert.ok(key in manifest.meta, 'meta 缺少 ' + key);
  assert.equal(typeof manifest.meta.stale, 'boolean');
  assert.ok(Number.isFinite(Date.parse(manifest.meta.generatedAt)), 'generatedAt 不是合法时间');
});

await test('manifest：每个数据集的字段声明与 sample 一一对应', () => {
  const seen = new Set();
  for (const ds of datasets) {
    assert.ok(ds.id && !seen.has(ds.id), '数据集 id 缺失或重复：' + ds.id);
    seen.add(ds.id);
    assert.ok(ds.title, ds.id + ' 缺少 title');
    assert.ok(ds.path, ds.id + ' 缺少 path');
    assert.ok(['data', 'meta'].includes(ds.kind), ds.id + ' 的 kind 不合法');
    assert.ok(Array.isArray(ds.fields) && ds.fields.length > 0, ds.id + ' 缺少 fields');
    assert.ok(ds.sample && typeof ds.sample === 'object', ds.id + ' 缺少 sample 对象');
    for (const f of ds.fields) {
      assert.ok(f.name, ds.id + ' 有字段缺少 name');
      assert.ok(FIELD_TYPES.has(f.type), ds.id + '.' + f.name + ' 的 type 不合法：' + f.type);
      assert.ok(typeof f.desc === 'string' && f.desc.length > 0, ds.id + '.' + f.name + ' 缺少 desc');
      assert.ok(Object.prototype.hasOwnProperty.call(ds.sample, f.name),
        ds.id + ' 的 sample 缺少字段 ' + f.name);
    }
  }
});

await test('manifest：列出的文件全部真实存在（模板路径检查 files）', () => {
  for (const ds of datasets) {
    if (ds.path.includes('{')) {
      assert.ok(Array.isArray(ds.files) && ds.files.length > 0, ds.id + ' 模板路径缺少 files');
      for (const f of ds.files) {
        assert.ok(existsSync(path.join(ROOT, f)), ds.id + ' 列出的文件不存在：' + f);
      }
    } else {
      assert.ok(existsSync(path.join(ROOT, ds.path)), ds.id + ' 的路径不存在：' + ds.path);
    }
  }
});

await test('api/v1：所有 JSON 可解析且满足统一信封约束', () => {
  const files = walkFiles(V1_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 25, 'api/v1 JSON 文件数量异常：' + files.length);
  const ids = new Set(datasets.map((d) => d.id));
  for (const file of files) {
    const rel = relOf(file);
    let env;
    try { env = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(rel + ' 不是合法 JSON：' + e.message); }
    assert.equal(typeof env.ok, 'boolean', rel + ' 缺少布尔 ok');
    assert.equal(env.ok, true, rel + ' 的 ok 不是 true');
    assert.ok(env.data !== undefined && env.data !== null, rel + ' 缺少 data');
    assert.ok(env.meta && typeof env.meta === 'object', rel + ' 缺少 meta');
    for (const key of ENVELOPE_KEYS) assert.ok(key in env.meta, rel + ' 的 meta 缺少 ' + key);
    assert.ok(ids.has(env.meta.dataset), rel + ' 的 meta.dataset 未在 manifest 登记：' + env.meta.dataset);
    assert.equal(typeof env.meta.stale, 'boolean', rel + ' 的 meta.stale 必须是布尔');
    assert.ok(Number.isFinite(Date.parse(env.meta.generatedAt)), rel + ' 的 generatedAt 不合法');
    assert.ok(typeof env.meta.source === 'string' && env.meta.source.length > 0, rel + ' 的 source 为空');
    assert.ok(typeof env.meta.license === 'string' && env.meta.license.length > 0, rel + ' 的 license 为空');
    assert.ok(typeof env.meta.note === 'string' && env.meta.note.length > 0, rel + ' 的 note 为空');
  }
});

await test('index / health / manifest 三份元数据自洽', () => {
  const index = readJson('api/v1/index.json');
  const health = readJson('api/v1/health.json');
  const ids = datasets.map((d) => d.id).sort();
  assert.equal(index.data.count, datasets.length, 'index.count 与 manifest 数据集数不一致');
  assert.deepEqual(index.data.datasets.map((d) => d.id).sort(), ids, 'index 数据集集合与 manifest 不一致');
  assert.ok(['ok', 'degraded'].includes(health.data.status), 'health.status 不合法');
  assert.deepEqual(health.data.datasets.map((d) => d.id).sort(), ids, 'health 数据集集合与 manifest 不一致');
  const staleIds = health.data.datasets.filter((d) => d.stale === true).map((d) => d.id).sort();
  assert.deepEqual(staleIds, [...health.data.staleDatasets].sort(), 'health.staleDatasets 与明细不一致');
});

await test('quotes / klines 的时效字段是合法 ISO 或 null', () => {
  const quotes = readJson('api/v1/quotes/latest.json');
  assert.ok(quotes.meta.asof === null || Number.isFinite(Date.parse(quotes.meta.asof)), 'quotes.meta.asof 不合法');
  for (const q of quotes.data.quotes) {
    assert.ok(q.symbol, '行情缺少 symbol');
    assert.ok(Number.isFinite(q.price), q.symbol + ' 的 price 不是有限数字');
    assert.ok(!('volume' in q), q.symbol + ' 出现了交易量类字段');
  }
  const catalog = readJson('api/v1/markets/klines.json');
  for (const s of catalog.data.symbols) {
    const file = 'api/v1/klines/' + s.symbol + '.json';
    assert.ok(existsSync(path.join(ROOT, file)), 'K 线文件缺失：' + file);
    const env = readJson(file);
    for (const period of ['day', 'week', 'month']) {
      const block = env.data.periods[period];
      assert.ok(block && Array.isArray(block.rows), s.symbol + ' 缺少 ' + period + ' 周期');
      for (const row of block.rows.slice(0, 3)) {
        assert.deepEqual(Object.keys(row).sort(), ['close', 'high', 'low', 'open', 'time'],
          s.symbol + ' 的 K 线行字段不合法：' + Object.keys(row).join(','));
        assert.ok(Number.isFinite(row.open) && Number.isFinite(row.close), s.symbol + ' 的 OHLC 不是有限数字');
      }
    }
  }
});

/* ---------------- 2. OpenAPI ---------------- */

await test('openapi.json：OpenAPI 3.1 结构合法且路径集合与 manifest 一致', () => {
  const doc = readJson('api/openapi.json');
  assert.match(String(doc.openapi), /^3\.1\./, 'openapi 版本必须是 3.1.x');
  assert.ok(doc.info && doc.info.title && doc.info.version, 'openapi.info 不完整');
  assert.ok(doc.paths && typeof doc.paths === 'object', 'openapi.paths 缺失');
  const norm = (p) => String(p).replace(/^\/+/, '');
  const openapiPaths = Object.keys(doc.paths).map(norm).sort();
  const manifestPaths = datasets.map((d) => norm(d.path)).sort();
  assert.deepEqual(openapiPaths, manifestPaths, 'openapi 路径集合与 manifest 不一致');
  for (const [p, item] of Object.entries(doc.paths)) {
    assert.ok(item.get, p + ' 缺少 GET 操作');
    assert.ok(item.get.responses && item.get.responses['200'], p + ' 缺少 200 响应');
    assert.ok(item.get.summary, p + ' 缺少 summary');
  }
  assert.ok(doc.components && doc.components.schemas && doc.components.schemas.Envelope, '缺少 Envelope schema');
});

/* ---------------- 3. 合规扫描 ---------------- */

await test('合规：api/ 与 mcp/ 不出现第三方预测平台品牌字样', () => {
  const bad = [];
  for (const dir of [API_DIR, path.join(ROOT, 'mcp')]) {
    for (const file of walkFiles(dir)) {
      if (!/\.(json|mjs|md|js|txt)$/i.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (/polymarket/i.test(text)) bad.push(relOf(file));
    }
  }
  assert.deepEqual(bad, [], '以下文件出现了平台品牌字样：' + bad.join(', '));
});

await test('合规：api/ 的 JSON 不含交易量类字段', () => {
  const keys = new Set();
  for (const file of walkFiles(API_DIR).filter((f) => f.endsWith('.json'))) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    for (const k of collectKeys(parsed)) keys.add(k);
  }
  const bad = [...keys].filter((k) => /volume|liquidity/i.test(k));
  assert.deepEqual(bad, [], '出现交易量类字段：' + bad.join(', '));
});

await test('合规：mcp/ 源码与文档不含交易量类英文标识', () => {
  const bad = [];
  for (const file of walkFiles(path.join(ROOT, 'mcp'))) {
    if (!/\.(json|mjs|md|js|txt)$/i.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/\bvolume\b/i.test(text)) bad.push(relOf(file));
  }
  assert.deepEqual(bad, [], '以下文件出现了 volume 标识：' + bad.join(', '));
});

await test('合规：预测市场只保留事件/档位/概率，不含平台标识与链接', () => {
  const pred = readJson('api/v1/prediction/markets.json');
  assert.ok(pred.data.events.length > 0, '预测市场没有数据');
  const text = JSON.stringify(pred);
  assert.doesNotMatch(text, /polymarket/i);
  assert.doesNotMatch(text, /https?:\/\//i, '预测市场产物不应出现外链');
  const keys = new Set(collectKeys(pred));
  const bad = [...keys].filter((k) => /slug|tokenid|url|volume|liquidity/i.test(k));
  assert.deepEqual(bad, [], '预测市场出现不应暴露的字段：' + bad.join(', '));
});

/* ---------------- 4. MCP 协议冒烟 ---------------- */

function docToolNames() {
  const doc = readFileSync(path.join(ROOT, 'docs/API.md'), 'utf8');
  const start = doc.indexOf('## 5. MCP 工具表');
  assert.ok(start >= 0, 'docs/API.md 缺少「MCP 工具表」章节');
  const end = doc.indexOf('### 5.1', start);
  const chunk = doc.slice(start, end > start ? end : undefined);
  const names = [...chunk.matchAll(/^\|\s*`([a-z][a-z0-9_]*)`\s*\|/gm)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

function rpcSession(requests, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], {
      cwd: ROOT,
      env: { ...process.env, OPENFINLENS_OFFLINE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const want = new Set(requests.filter((r) => Object.prototype.hasOwnProperty.call(r, 'id')).map((r) => String(r.id)));
    const got = new Map();
    const raw = [];
    let stderr = '';
    let done = false;

    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* ignore */ }
      resolve({ got, raw, stderr, ...extra });
    };

    const timer = setTimeout(() => finish({ timeout: true }), timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        raw.push(t);
        let msg;
        try { msg = JSON.parse(t); } catch { continue; }
        if (msg && Object.prototype.hasOwnProperty.call(msg, 'id')) got.set(String(msg.id), msg);
        if ([...want].every((id) => got.has(id))) finish({ timeout: false });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (e) => finish({ spawnError: e }));
    child.on('exit', () => {
      if (!done) setTimeout(() => finish({ exitedEarly: true }), 10);
    });

    for (const req of requests) child.stdin.write(JSON.stringify(req) + '\n');
    setTimeout(() => {
      try { child.stdin.end(); } catch { /* ignore */ }
    }, 500);
  });
}

function toolText(res) {
  assert.ok(res && res.result, '响应缺少 result');
  const content = res.result.content;
  assert.ok(Array.isArray(content) && content.length > 0, '工具结果缺少 content');
  assert.equal(content[0].type, 'text', '工具结果 content[0] 必须是 text');
  return JSON.parse(content[0].text);
}

const rpcRequests = [
  {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'api-test', version: '0' } },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_datasets', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_manifest', arguments: {} } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_health', arguments: {} } },
  { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'search_symbols', arguments: { query: '茅台' } } },
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_events', arguments: { limit: 3 } } },
  { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_prediction_markets', arguments: { limit: 2 } } },
  { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_klines', arguments: { symbol: 'sh600519', period: 'day', limit: 3 } } },
  { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_institution_holdings', arguments: { kind: '13f', limit: 2 } } },
  { jsonrpc: '2.0', id: 11, method: 'resources/list' },
  { jsonrpc: '2.0', id: 12, method: 'resources/read', params: { uri: 'openfinlens://api/v1/index.json' } },
  { jsonrpc: '2.0', id: 13, method: 'ping' },
  { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
  { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'get_quotes', arguments: { symbols: ['sh600519', 'AAPL'] } } },
  { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'get_macro_series', arguments: { country: 'US', indicator: 'gdp', limit: 2 } } },
];

const session = await rpcSession(rpcRequests);

await test('MCP：进程完成握手，stdout 全部是合法 JSON-RPC 行', () => {
  assert.ok(!session.spawnError, '无法启动 mcp/server.mjs：' + (session.spawnError && session.spawnError.message));
  assert.ok(!session.timeout, 'MCP 响应超时；stderr=' + session.stderr.slice(0, 500));
  assert.ok(session.raw.length >= 16, '响应行数不足：' + session.raw.length);
  for (const line of session.raw) {
    const msg = JSON.parse(line);
    assert.equal(msg.jsonrpc, '2.0', '响应缺少 jsonrpc=2.0');
  }
});

await test('MCP：initialize 返回协议版本与 capabilities', () => {
  const res = session.got.get('1');
  assert.ok(res && res.result, 'initialize 没有 result');
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.ok(res.result.capabilities.tools, '缺少 tools capability');
  assert.ok(res.result.capabilities.resources, '缺少 resources capability');
  assert.equal(res.result.serverInfo.name, 'openfinlens');
});

await test('MCP：tools/list 与 docs/API.md 工具表数量/名称一致', () => {
  const res = session.got.get('2');
  assert.ok(res && res.result && Array.isArray(res.result.tools), 'tools/list 没有 tools 数组');
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, docToolNames(), 'tools/list 与文档工具表不一致');
  assert.ok(names.length >= 11, '工具数量不足：' + names.length);
  for (const tool of res.result.tools) {
    assert.ok(tool.name, '工具缺少 name');
    assert.ok(/[\u4e00-\u9fff]/.test(tool.description || ''), tool.name + ' 的 description 不是中文');
    assert.equal(tool.inputSchema.type, 'object', tool.name + ' 的 inputSchema.type 必须是 object');
    assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object',
      tool.name + ' 缺少 inputSchema.properties');
  }
  const klines = res.result.tools.find((t) => t.name === 'get_klines');
  assert.deepEqual(klines.inputSchema.required, ['symbol']);
  const fund = res.result.tools.find((t) => t.name === 'get_fund_profile');
  assert.deepEqual(fund.inputSchema.required, ['code']);
});

await test('MCP：list_datasets / get_manifest / get_health 返回结构化 JSON', () => {
  const list = toolText(session.got.get('3'));
  assert.equal(list.ok, true);
  assert.ok(list.count >= 10 && Array.isArray(list.datasets), 'list_datasets 形状不合法');

  const man = toolText(session.got.get('4'));
  assert.equal(man.ok, true);
  assert.equal(man.count, datasets.length, 'MCP 清单数据集数与静态 manifest 不一致');

  const health = toolText(session.got.get('5'));
  assert.equal(health.ok, true);
  assert.ok(['ok', 'degraded'].includes(health.status), 'health.status 不合法');
  assert.ok(Array.isArray(health.datasets) && health.datasets.length >= 10);
});

await test('MCP：search_symbols 支持中文名解析', () => {
  const res = toolText(session.got.get('6'));
  assert.equal(res.ok, true);
  assert.ok(res.matches.length > 0, '没有匹配结果');
  assert.equal(res.matches[0].symbol, 'sh600519', '茅台应解析到 sh600519');
});

await test('MCP：get_events / get_prediction_markets 遵守 limit 与合规口径', () => {
  const events = toolText(session.got.get('7'));
  assert.equal(events.ok, true);
  assert.ok(events.events.length <= 3, 'get_events 没有遵守 limit');
  assert.ok(events.meta && events.meta.dataset === 'events.global');

  const pred = toolText(session.got.get('8'));
  assert.equal(pred.ok, true);
  assert.ok(pred.events.length <= 2, 'get_prediction_markets 没有遵守 limit');
  assert.doesNotMatch(JSON.stringify(pred), /polymarket/i);
  assert.ok(pred.events[0].outcomes && pred.events[0].outcomes[0].probability !== undefined,
    '预测市场缺少档位概率');
});

await test('MCP：get_klines 离线回退静态快照且只含 OHLC', () => {
  const res = toolText(session.got.get('9'));
  assert.equal(res.ok, true);
  assert.equal(res.symbol, 'sh600519');
  assert.equal(res.period, 'day');
  assert.ok(res.count > 0 && res.rows.length > 0, 'K 线为空');
  assert.equal(res.via, 'static');
  for (const row of res.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['close', 'high', 'low', 'open', 'time']);
  }
});

await test('MCP：get_institution_holdings 支持 13F 口径', () => {
  const res = toolText(session.got.get('10'));
  assert.equal(res.ok, true);
  assert.equal(res.kind, '13f');
  assert.ok(Array.isArray(res.institutions) && res.institutions.length > 0);
  assert.ok(res.institutions[0].holdings.length <= 2, 'holdings 没有遵守 limit');
});

await test('MCP：离线时 get_quotes 回退静态快照并说明原因', () => {
  const res = toolText(session.got.get('15'));
  assert.equal(res.ok, true);
  assert.equal(res.via, 'static');
  assert.equal(res.meta.dataset, 'quotes.latest');
  assert.ok(res.count >= 2 && res.quotes.length >= 2, '静态快照行情为空');
  assert.match(res.meta.note, /静态快照/, '没有说明回退原因');
  for (const q of res.quotes) assert.ok(Number.isFinite(q.price), q.symbol + ' 缺少有效价格');
});

await test('MCP：get_macro_series 返回序列与 points', () => {
  const res = toolText(session.got.get('16'));
  assert.equal(res.ok, true);
  assert.ok(res.count >= 1 && res.series.length >= 1, '宏观序列为空');
  assert.ok(Array.isArray(res.series[0].points) && res.series[0].points.length > 0, '宏观序列没有 points');
});

await test('MCP：resources/list 与 resources/read 可用', () => {
  const list = session.got.get('11');
  assert.ok(list && list.result && Array.isArray(list.result.resources), 'resources/list 形状不合法');
  assert.ok(list.result.resources.length >= 10, '资源数量不足');
  for (const r of list.result.resources) {
    assert.match(r.uri, /^openfinlens:\/\/api\//, '资源 uri 不合法：' + r.uri);
    assert.equal(r.mimeType, 'application/json');
  }
  const read = session.got.get('12');
  assert.ok(read && read.result && Array.isArray(read.result.contents), 'resources/read 形状不合法');
  const env = JSON.parse(read.result.contents[0].text);
  assert.equal(env.meta.dataset, 'index');
});

await test('MCP：ping 与未知工具的 isError 语义', () => {
  const ping = session.got.get('13');
  assert.ok(ping && ping.result, 'ping 没有 result');
  const bad = session.got.get('14');
  assert.ok(bad && bad.result, '未知工具没有返回 result');
  assert.equal(bad.result.isError, true, '未知工具必须返回 isError=true');
  const payload = toolText(bad);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_TOOL');
});

/* ---------------- 汇总 ---------------- */

console.log('\n===== api 组汇总 =====');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail) process.exit(1);
console.log('✓ api 组全部通过');
