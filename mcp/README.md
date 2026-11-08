# OpenFinLens MCP Server

把 OpenFinLens 的全球金融数据接进任意支持 MCP 的 Agent 客户端。**stdio 传输、JSON-RPC 2.0、零第三方依赖**，只用 Node 内置模块。

- 协议版本：`2024-11-05`
- 传输：stdio，一行一个 JSON 消息
- 依赖：Node.js ≥ 18.17（需要全局 `fetch`；推荐 Node 20+）
- 数据：优先实时抓取公开行情接口，失败自动回退仓库里的 `api/v1/**` 静态快照
- 无需访问密钥、无需账号、只读

## 目录

```
mcp/
  server.mjs              入口（stdio 循环）
  package.json            type=module，bin 指向 server.mjs
  lib/
    rpc.mjs               JSON-RPC 2.0 协议层
    tools.mjs             11 个工具的定义与实现
    api-store.mjs         读静态 API、统一信封校验、标的模糊匹配
    live-sources.mjs      实时行情/K线/基金画像（经 vm 复用 js/sources/*.js）
    window-env.mjs        用 vm + 假 window 加载前端模块
```

## 先自检

在仓库根目录执行：

```bash
node mcp/server.mjs --help
```

正常启动后进程会停在 stdin 上等待 JSON-RPC 消息（stderr 会打印启动模式）。手动打一发 `initialize`：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  | node mcp/server.mjs --offline
```

期望输出一行 JSON，包含 `"protocolVersion":"2024-11-05"` 和 `"serverInfo"`。

> 离线模式 `--offline`（或环境变量 `OPENFINLENS_OFFLINE=1`）不发起任何网络请求，只读 `api/v1/**`。适合 CI、无网环境和演示。

## Claude Code

把 `/absolute/path/to/openfinlens` 换成仓库所在目录。**推荐用绝对路径**，因为客户端不保证从仓库根目录启动；路径含空格时必须加英文双引号。

- 绝对路径：`node "D:\path\to\openfinlens\mcp\server.mjs"`（任何客户端、任何 cwd 都能用，推荐）；
- 相对路径：`node ./mcp/server.mjs` 只有在客户端固定从仓库根目录启动时才成立。Claude Code / Cursor 保存的是命令而不是 cwd，换机器或换目录就会失效，所以不要依赖相对路径。

可以直接复制粘贴的形态（macOS / Linux）：

```bash
claude mcp add openfinlens -- node "/absolute/path/to/openfinlens/mcp/server.mjs"
```

Windows PowerShell / CMD（`\` 在 shell 里原样写，**不要**写成 `\\`；只有 JSON 配置里才需要 `\\` 转义）：

```bash
claude mcp add openfinlens -- node "D:\57的vibe coding内容\global-fin-dashboard\mcp\server.mjs"
```

离线注册（只读静态快照）：

```bash
claude mcp add openfinlens -- node "/absolute/path/to/openfinlens/mcp/server.mjs" --offline
```

`--` 是 Claude Code 的参数分隔符：它左边的 `openfinlens` 是 MCP 名称，右边的 `node .../server.mjs` 才是真正的启动命令。少了 `--`，Claude Code 会把 `node` 当成自己的参数。

查看与移除：

```bash
claude mcp list
claude mcp remove openfinlens
```

## Cursor

项目级 `.cursor/mcp.json`，或用户级 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "openfinlens": {
      "command": "node",
      "args": ["/absolute/path/to/openfinlens/mcp/server.mjs"],
      "env": {
        "OPENFINLENS_TIMEOUT_MS": "12000"
      }
    }
  }
}
```

Windows 的 `args` 写绝对路径并保留反斜杠转义，例如 `"D:\\57的vibe coding内容\\global-fin-dashboard\\mcp\\server.mjs"`。

## Claude Desktop / 其他客户端

`claude_desktop_config.json` 或等价的 MCP 配置：

```json
{
  "mcpServers": {
    "openfinlens": {
      "command": "node",
      "args": ["/absolute/path/to/openfinlens/mcp/server.mjs", "--offline"]
    }
  }
}
```

任何支持 stdio MCP 的客户端都可以接入；服务端不依赖工作目录，但**必须能读到仓库里的 `api/v1/**`**（server 会按自身位置向上一级定位仓库根目录）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENFINLENS_OFFLINE` | 未设置 | 设为 `1` 等价于 `--offline`，只读静态快照 |
| `OPENFINLENS_TIMEOUT_MS` | `12000` | 单次上游请求超时（毫秒），小于 1000 时按 12000 处理 |

## 工具一览

| 工具 | 作用 |
| --- | --- |
| `list_datasets` | 列出全部数据集、更新时间与滞后状态（Agent 第一步） |
| `get_manifest` | 读取字段定义、样例与数据截止时间 |
| `get_health` | 链路自检：各数据集 lastBuilt / 条数 / 耗时 / stale |
| `search_symbols` | 中文名、拼音首字母、代码、别名模糊搜索 |
| `get_quotes` | 行情快照；实时优先，失败回退静态 |
| `get_klines` | 日/周/月 K 线，只含时间与开高低收 |
| `get_events` | 全球事件，按分类/国家/时间/关键词过滤 |
| `get_prediction_markets` | 预测市场概率，事件 + 档位两层 |
| `get_institution_holdings` | 13F / 因子 ETF / 基金合计持仓 |
| `get_macro_series` | 世界银行年度宏观序列 |
| `get_fund_profile` | 公募基金画像（费率、收益、净值、持仓） |

每个工具都有中文 `description` 与 JSON Schema `inputSchema`；`tools/call` 返回 `content: [{type:"text", text:"<JSON>"}]`。参数错误、未识别标的、离线不可用等情况返回 `isError: true`，文本里是可读的中文错误信息，不会抛异常栈。

### 资源

`resources/list` 暴露 `api/v1` 下的静态产物，URI 形如 `openfinlens://api/v1/quotes/latest.json`；`resources/read` 返回原文件文本。K 线是每个标的一个文件，`resources/list` 只列目录（`api/v1/markets/klines.json`），单标的文件通过 `get_klines` 读取更合适。

## 推荐调用顺序

1. `list_datasets`：确认有哪些数据、哪些已经 stale；
2. `get_manifest({dataset:"..."})`：看字段名、单位与样例；
3. `search_symbols({query:"茅台"})`：把用户口语解析成标准 `symbol`；
4. 按问题选数据工具：行情 `get_quotes`、走势 `get_klines`、事件 `get_events`、概率 `get_prediction_markets`、持仓 `get_institution_holdings`、宏观 `get_macro_series`、基金 `get_fund_profile`。

回答用户时请把 `meta.asof` 与 `meta.stale` 一并考虑：`stale=true` 表示数据滞后或已降级，应主动说明，不要当成实时数据。

## 常见故障

| 现象 | 原因与处理 |
| --- | --- |
| 客户端显示 server 启动失败 | 先在本机执行 `node mcp/server.mjs --help`；确认 Node ≥ 18.17 且 `node` 在 PATH |
| 客户端连上但没有工具 | 确认客户端配置的是 `node` + `server.mjs` 绝对路径；Windows 路径空格要加引号 |
| 进程立刻退出 | 检查 stderr。stdio 模式下 stdin 关闭即正常退出，不是崩溃 |
| 工具返回 `isError: true` | 文本里有中文原因：未识别标的就先用 `search_symbols`；离线模式不支持基金画像；静态文件缺失则先跑一次构建 |
| 数据 `stale: true` | 上游采集未更新或实时抓取失败。用 `get_health` 看是哪个数据集；需要最新快照时在仓库根目录跑 `node _scripts/build-api.mjs` |
| 实时抓取超时 | 提高 `OPENFINLENS_TIMEOUT_MS`，或加 `--offline` 只读静态快照 |
| 中文乱码 | 行情源是 GBK，服务端已用 `TextDecoder('gbk')` 解码；若你的 Node 是精简版（无 full-icu），请换官方发行版 |
| stdout 出现非 JSON 文本 | 不应发生。诊断信息只走 stderr；若出现请附上 stderr 提 issue |

## 合规与边界

- 只读：不提供下单、交易、账户或任何写操作；
- 无访问密钥：所有上游都是公开接口或仓库内静态产物；
- 不展示交易活跃度字段：行情与 K 线只保留价格、涨跌与开高低收；
- 预测市场只保留事件、档位与概率，不含平台标识、链接与交易功能；
- 中文输出；所有概率与统计只描述事实，不构成预测或投资建议，也不推荐买卖。

## 测试

```bash
node _test/api.test.mjs          # API 契约 + MCP 协议冒烟（离线）
node _test/run-all.mjs --offline # 全量离线测试组
```
