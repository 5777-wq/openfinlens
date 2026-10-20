<div align="center">

# 🔭 OpenFinLens

**A股、港股、美股、加密、全球事件，一块屏幕读完的纯前端行情终端。**

没有后端，没有 API key，没有构建。clone 下来双击 `index.html`，它就跑起来了。

**[线上体验 →](https://5777-wq.github.io/openfinlens/)**　·　**[下载安卓 APK](https://github.com/5777-wq/openfinlens/releases)**

[![license](https://img.shields.io/badge/license-MIT-000?style=flat-square)](LICENSE)
[![release](https://img.shields.io/github/v/release/5777-wq/openfinlens?style=flat-square&label=release)](https://github.com/5777-wq/openfinlens/releases)
![tests](https://img.shields.io/badge/tests-28%E7%BB%84%C2%B7%E7%A6%BB%E7%BA%BF276%E6%9D%A1-2ebd85?style=flat-square)

<img src="assets/shot-overview.png" alt="OpenFinLens 首屏：全球市场" width="100%">

</div>

## 为什么有这个项目

行情、龙虎榜、南向资金、全球事件，这些数据本来都是免费的，躺在各家公开接口里。收费的是把它们拼到同一块屏幕上——参考价：Bloomberg Terminal，一年三万美元上下。

OpenFinLens 在你的浏览器里直接把数据抓回来、拼成一块屏幕，所有计算都在你自己的机器上完成，连 `node_modules` 都没有。

## 功能

### 全市场热力图

A股 5000+、港股约 2900、美股约 13800、加密 80 币种，全市场热力图用手写的 squarify 布局加 Canvas 渲染：滚轮以光标为锚缩放，拖拽平移，双指捏合。哪个板块涨疯了，一眼看到，不用开 VIP。

图里只有个股，**指数不进图**：上证指数、深证成指、创业板指、科创50 这些是成分股的加权聚合，不是成分股——留着等于把同一批市值算两遍，巨大指数块还会吃掉半屏面积。更要紧的是涨跌家数只该数个股，所以过滤放在取数层，热力图、市场宽度、涨跌幅榜同时干净。

<img src="assets/shot-treemap.png" alt="A股全市场热力图与市场宽度" width="100%">

### 全球事件，钉在地图和 K 线上

GDELT + 新浪 7x24 每 5 分钟采集一次，按类别落在自绘世界地图上，不依赖任何地图服务。事件和龙虎榜还会按日期画进 K 线：点一下，就能看到消息公布那天，价格发生了什么。

<img src="assets/shot-worldmap.png" alt="全球事件地图" width="100%">

### 市场预测：概率不是一个数字，是一条走势

事件页的「市场预测」板块读公开预测市场的隐含概率（只读，不外链、不引导交易）。每个事件一张卡：

- **档位分布环图**——只给档位互斥的事件（美联储几档、选举候选人这类，概率加总≈100%）。档位彼此独立的问句（"停火持续到 10 月 22 吗 / 24 吗"这种嵌套问法）只给概率条并标明"不可相加"：画成饼图等于暗示了并不存在的互斥关系。
- **概率走势**——该档位近 7 天的隐含概率曲线，点档位行即可切换走势图跟的是哪一档；历史没到就写"积累中"，不画假线。
- **类别分布总览**——一屏看完全部事件的类别构成。

数字口径：环图按报价占比绘制，**图例里永远是市场真实报价**；各档位是独立盘口，报价合计偏离 100% 时会单独标出来。

颜色口径：**图例圆点、环图扇区、概率条、走势线四者同色**——一条线就是一个档位，不会串。概率刻意不用主题强调色（红/绿在本项目里是涨跌语义，用红色画概率会被误读成"涨"）。面板底色与各套皮肤一致：卡片底色和环图分隔线由同一个变量驱动，玻璃皮肤下不会"脱层"。

### 打开先给答案：市场简报带

首屏不是"标题 + 一串等权的板块"，而是一条仪表带：**全球指数几涨几跌 + A股全市场什么温度**。条身是市场的真实形状（涨的宽度就是涨的占比），右侧是结论数字（均值 / 情绪分）。不用往下滚就知道今天是什么市况。零新增请求——全球指数用已加载的指数行情，A股用宽度调度器后台算好的结果。

### 其他模块

| 模块 | 能做什么 |
|---|---|
| 披露类资金 | A股龙虎榜与席位 90 天档案；美股 13F 持仓（伯克希尔、桥水、ARK、Pershing）；港股南向持股。只收录监管要求披露的数据，发言 ≠ 交易，口径分开。13F 的上期取不到时该机构标「环比不可用」而不是「全部新进」；A股基金持仓会标出披露完整度与「下一期仍在披露中」——季报只披露前十大重仓股，不标就会被读成「基金集体减仓」 |
| 基金对比 | 最多 8 只标的后复权价归一化对比，收益、最大回撤、夏普、年度矩阵、相关性矩阵，历史最长回到 2006 年。拿不到含分红口径时明确标注「价格收益」，绝不糊弄 |
| 基金画像 | 输入 6 位代码看单只基金：阶段收益与同类排名、净值走势、五维评价、规模与申赎、持有人结构、资产配置、重仓股（点行进 K 线）。天天基金公开披露，免密钥 |
| 投资风格测评 | 6 道题测「能承受多少波动 + 更想要什么」，映射成一组公开可查的**品类清单**，点开即看真实回撤/排名/规模/持仓。**风险闸门是硬规则**：候选的波动档必须 ≤ 你的风险档，投资期限短时上限更低——保守用户绝不会看到行业主题基金。它不预测收益、不推荐买入、不构成投资建议 |
| 持仓跟踪 | 本机记录数量与成本价，实时算市值 / 持仓盈亏 / 当日盈亏；美元、港币按离岸人民币实时交叉价折算成一条总资产曲线（每日一个快照，只存本机） |
| 技术面与情绪 | RSI / MACD / KDJ / BOLL 按日 K 手算，附读法；各市场温度计、涨跌家数、七段分布。只算统计口径，不给买卖建议 |
| 产业链与概念 | 10 条产业链、49 个环节、163 只成分股，环节强度实时计算；东财 500+ 概念板块榜一键跳转 |
| 宏观策略 | 中美国债收益率曲线与利差（含倒挂标注）、大类资产当日矩阵（股指/外汇/商品/利率/加密）、金油比等宏观读数，全部复用已轮询行情零新增请求；世界银行年度热图仍在 |
| 自选与搜索 | 跨市场收藏，中文 / 代码 / 拼音搜索，键盘切换 tab，URL 即分享 |
| 降级策略 | 主源失败走备源，备源失败走 localStorage 缓存，最差情况是「降级角标 + 旧数据」，不弹窗报错 |

宽屏（≥1280px）自动两栏密排，行情 10 秒轮询，红涨绿跌可切换。默认「瑞士」白主题，共 8 套设计语言皮肤一键切换（图表同步换色）。

## 快速开始

**在线用**：打开 [5777-wq.github.io/openfinlens](https://5777-wq.github.io/openfinlens/) 即可，支持 PWA 安装到桌面。

**本地跑**：

```bash
git clone https://github.com/5777-wq/openfinlens.git
cd openfinlens
# 双击 index.html 就能用——所有数据源 CORS 全通，file:// 也能跑
# 或者起个本地服务器：
python -m http.server 8765   # → http://127.0.0.1:8765
```

**手机**：

- **Android**：[Releases](https://github.com/5777-wq/openfinlens/releases) 里有签名 APK（v1.0.2），只申请 `INTERNET` 一个权限。源码在 `android/`，无 Gradle 也能构建：`cd android && bash build.sh`。
- **微信小程序**：`miniprogram/` 是 web-view 壳工程，需要非个人主体和已备案域名，完整门槛与步骤见 [docs/MINIPROGRAM.md](docs/MINIPROGRAM.md)。

## 数据源

全部免密钥：

| 品类 | 主源 | 备源 |
|---|---|---|
| A股 / 港股 / 美股 / 指数 | 腾讯 | 东财 |
| 全市场热力图（A/港/美） | 东财 `clist` 分页并发 | — |
| 加密 | 币安 | OKX |
| 加密流通市值（热力图面积） | CoinPaprika | CoinGecko → 24h成交额代理 |
| K线 / 长历史 | 腾讯 `ifzq` / 东财 `push2his`（含分红） | 熔断后腾讯兜底（标注口径） |
| 全球事件 / 事件概率 / 13F | GDELT + 新浪 / Polymarket（Gamma + CLOB 历史）/ SEC → Actions 采集 | 静态 JSON |
| 外汇 / 商品 / 宏观 / 新闻 | 东财 secid / 世界银行 / 新浪 roll | 缓存 |

## 它怎么工作

```
浏览器（纯客户端）
├── sources/  每类数据一个适配器：主源 ──失败──▶ 备源 ──失败──▶ localStorage 缓存
├── app.js    轮询调度（setTimeout 链）→ 增量 patch DOM，不整墙重建
├── treemap/charts/technical/events/compare  纯函数计算层，全部可单测
├── polymarket/pmcharts/pmview  预测市场：模型层 / 图形层 / 视图层，三层各自可单测
└── worldmap + bus  地图 ↔ K线 ↔ 资金，事件总线联动
```

海外源（GDELT / SEC EDGAR / Polymarket）不在浏览器里请求：GitHub Actions 定时抓取、清洗后把静态 JSON 提交进仓库，浏览器只读仓库里的数据。所以你不需要能直连海外接口。

Polymarket 只提取「事件概率」这个数字和它近 7 天的历史序列，**不存 slug / URL / tokenId**——产物里没有能外链到交易平台的字段，前端想引导交易也没有入口。

市场预测落在三个产物文件里：

| 文件 | 内容 |
|---|---|
| `data/events/polymarket.json` | 事件与档位：标题、类别、各档位报价与 24h 变化、成交/流动性 |
| `data/events/polymarket-history.json` | 概率历史网格（4 小时一格 × 7 天，缺测为 null，不插值） |
| `data/events/polymarket-i18n.json` | 中文标题缓存：同一个标题不重复请求翻译接口 |

采集受 GitHub Actions 调度延迟影响时，可以把 cron 搬到自己服务器上，见 [docs/SERVER-COLLECT.md](docs/SERVER-COLLECT.md)。

## 自部署

push 到你的 GitHub 仓库 → Settings → Pages → `Deploy from a branch`，一分钟后就有自己的地址（`.nojekyll` 已备好）。

默认所有源都直连。如果部署环境访问不到币安 / OKX，或想启用新浪源，可以部署一个 Cloudflare Worker 代理补 Referer / UA：`wrangler deploy worker.js`，仅此一处是可选项。

## 测试

```bash
node _test/run-all.mjs            # 27 组（含实网组）
node _test/run-all.mjs --offline  # 22 组 276 条，断网可跑，已挂 CI
```

技术指标有构造序列对账；降级链是逐条改坏主源实测的，不是纸面设计。预测市场的三层（数据模型 / 图形几何 / 视图渲染）各自可离线单测——扇区角度、走势坐标、档位归属、"互斥才给环图"这些约束都是断言出来的，不靠肉眼看图。

## 常见问题

**数据是实时的吗？**
不是。全部来自第三方免费公开接口，有延迟、会出错，仅供研究参考（见下方免责声明）。

**在国内能用吗？**
能。行情主源是腾讯和东财，国内直连；海外源已经转成仓库里的静态 JSON，浏览器不请求 GDELT / SEC / Polymarket。

**会上传我的任何数据吗？**
不会。没有后端，没有统计埋点，自选和缓存都存在你浏览器的 localStorage 里。

**红涨绿跌反了？**
设置里可以切换。

## 免责声明

仅供学习与技术研究，**不构成投资建议**。数据来自第三方公开接口，有延迟、会出错；据此交易，后果自负。

## Contributors

感谢每一个为这个看板付出的人。

[![5777-wq](https://avatars.githubusercontent.com/u/264733989?v=4&s=40)](https://github.com/5777-wq) **[5777-wq](https://github.com/5777-wq)** · 项目作者
[![Mavis](https://avatars.githubusercontent.com/u/194880281?v=4&s=40)](https://github.com/MiniMax-AI) **[Mavis](https://github.com/MiniMax-AI)** · [MiniMax Code](https://github.com/MiniMax-AI) 的 AI 编程助手，负责架构设计、代码实现与测试
[![zhipuai](https://avatars.githubusercontent.com/u/133244859?v=4&s=40)](https://github.com/zhipuai) **[智谱 AI · GLM](https://github.com/zhipuai)** · 模型与推理能力支持

AI 协作部分在每次提交的 commit message 里也留了共同作者署名（`Co-Authored-By`），与 Claude Code 的做法一致——谁在写代码、用的哪个模型，翻历史都查得到。

## License

[MIT](LICENSE)

---

<div align="center">

**技术栈：** 原生 HTML/CSS/JS · [lightweight-charts](https://github.com/tradingview/lightweight-charts)（vendored）· d3-geo / topojson（vendored）· 手写 squarify

实现细节与接口踩坑：[docs/FIELD-NOTES.md](docs/FIELD-NOTES.md)　·　架构设计：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

*如果它帮你省了一笔行情软件订阅费，star 就当是咖啡钱。* ☕

</div>
