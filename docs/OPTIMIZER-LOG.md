# 优化工作流日志 · OPTIMIZER-LOG

> 每轮追加一条：`## <日期时间> · <标题>`，下分「改动 / 理由 / 涉及文件」三小节。只记录已施工完成并离线预检通过的轮次。

## 2026-10-31 18:40 · 折叠状态持久化：13 个静态分区刷新后恢复折叠态（含 id 补全 + 净化纯函数 + 离线守卫）

### 改动
1. `js/utils.js`（+16/-1）：新增纯函数 `sanitizeFolds(raw, validIds)`——把 localStorage 读回的折叠表收敛成 `{id:true}`，只留「值为严格 `true` 且 id 在现存名单里」的键；非对象脏值（null/数字/数组/字符串）、脏 id、非 true 值一律丢弃，`validIds` 缺省按空名单处理。挂到 `window.U` 导出。思路对齐 `js/zones.js` 的 `resolveZone`（非法值收敛回落，不抛错不猜）。
2. `index.html`（7 行各改 1 处）：给 7 个原本无 id 的静态折叠分区补 id——`seatSection`(261)/`lhbSection`(272)/`fundSection`(283)/`brkSection`(307)/`etfSection`(318)/`sbSection`(352)/`voicesSection`(457)，命名对齐既有 `cmpMetricsSec` 等。`?v=` 版本号零改动（diff 中 0 处 `v=` 行），index.html 保持纯 LF。
3. `js/app.js`（+33/-3）：① `setFold` 增加第三参 `instant`，与 `reduceMotion()` 合并走直接落位分支——开机恢复不做 fold-out 过渡动画，动画分支本身零改动（仍只经 CSS 类碰 opacity/transform）；② `bindEvents` 内新增 `readFolds()`/`saveFold()`：键为分区 id、只记「被收起」的集合（存 Store 的 `foldsV1` 键，落盘为 `gfd_foldsV1`），展开即删；读取时用 `U.sanitizeFolds` 按现存 `[data-fold][id]` 净化；③ 点击委托在 `setFold` 后补 `saveFold`；键盘路径走 `head.click()`（app.js:5360）自动覆盖；④ aria 初始化循环之后恢复：净化后仍存在的 id 才 `setFold(sec, true, true)`。开机顺序核验：`bindEvents()`（app.js:6072）先于 `MacroView.mount`（6166）/`PortfolioView.mount`（6175），bind 时 DOM 里只有 index.html 的 13 个静态分区——宏观/持仓等动态分区天然不参与记忆，维持每次展开的现状（有意收窄）。
4. `_test/utils.test.mjs`（+32）：4 组 `sanitizeFolds` 断言（脏值收敛 / true+白名单过滤 / 大小写敏感与缺省空名单 / 合法值原样保留）。对象比较用 `JSON.stringify` 串比较——utils.js 在 vm 沙箱里跑，返回对象原型来自沙箱 realm，`deepStrictEqual` 会因跨 realm 原型误报。
5. `_test/tokens.test.mjs`（+9）：新增结构守卫「index.html 每个 data-fold 折叠分区都必须带 id」（照 159-167 行正则审计先例），防未来新增分区漏写 id 导致持久化静默跳过。
6. 行尾归一：上一轮遗留把 `_test/utils.test.mjs`/`_test/tokens.test.mjs` 工作副本整文件翻成了 CRLF（HEAD blob 均为纯 LF），本轮用 `sed -i 's/\r$//'` 归一回 LF，内容零变化（`git diff` 仍为 +9/+32 两段新增）。

### 理由
- 痛点最实：index.html 13 个 `data-fold` 分区此前每次刷新全部弹回展开，聪明钱/情绪等长板块要反复手收（`setFold` 原本只切 CSS 类、store.js 全文无 fold 条目，均实测确认）。
- 改动最小：净 +82 行代码；不碰网络、不碰 CSS、不碰 `?v=`、无 `setInterval`、无新增动画——不触任何红线。`Store.set` 自带 try/catch（js/store.js:10-12），键仅约百字节，隐私模式/配额场景静默忽略即可。
- 纯离线可测：净化逻辑抽成纯函数，4 组断言 + 1 条结构守卫全部离线可跑。

### 验证
- `node _test/run-all.mjs --offline`：共 42 组（离线 36 / 实网 6），本次执行 36 组、跳过 6 组，**✓ 全部测试组通过**。
- 单独复跑：`node _test/utils.test.mjs` 16 passed / 0 failed（含 4 组 sanitizeFolds 断言）；`node _test/tokens.test.mjs` 35 passed / 0 failed（含新守卫「每个 data-fold 分区必须带 id」）。
- 未做实网验证（红线 11）；未 git commit / push。

### 涉及文件
- `js/utils.js`、`index.html`、`js/app.js`、`_test/utils.test.mjs`、`_test/tokens.test.mjs`
- `docs/OPTIMIZER-LOG.md`（本文件，本轮新建）

## 2026-10-31 19:46 · P0 图表核心：图表角落常显代码·周期 legend + 指标面板颜色/线宽/一键重置

### 目标
对标 TradingView 的两项 P0 收尾（TV-ROADMAP P0 第 1、7 条合并施工）：① 十字线信息浮层里缺的最后一角——图表左上角常显「代码 · 周期」徽标（OHLC/涨跌幅/日期随十字线联动 2026-09-17 已落地，本轮补 TradingView 左上角那种常驻读数）；② 指标参数面板补齐「颜色/线宽可调 + 一键重置」（周期可调与 localStorage 记忆已有）。边界：副图线（RSI/DIF/DEA/MACD 柱）不开放换色——MACD 柱红绿是涨跌方向语义、RSI 有 0-100 固定域，副图保持主题令牌与语义色。

### 改动
1. `js/charts.js`（+119/-15）：① 模块作用域新增纯函数 `legendBadge(info)`（code/period 各自 trim 后用 ' · ' 连接，任一为空只显示另一段，全空返回 ''）与 `slotStyles(lines, paletteN)`（输入展开前配置数组，输出与展开后槽位一一对应的 `[{ci,w}]`：ci 数值强转、非法/缺失 → null 画图时回退槽位序号，合法值归一 `((round(ci)%n)+n)%n`；线宽仅 1/2/3 合法其余一律 1；BOLL 三轨从 ci 起顺延取色 ci/ci+1/ci+2 循环），连同 `escHtml` 一并挂到导出；② `createKline`/`createTrend` 各新增 `symInfo` 闭包变量 + `symHTML()`（有值时输出 `<span class="kl-sym">`，textContent 级转义）+ `setInfo(info)`（非对象置 null 并重画，setData 之前调用也安全），`paintLegend` 改为 `symHTML() + legendHTML(idx)`——徽标在无数据时也常显；③ 取色接线：闭包新增 `slotStyle` 与 `slotColorOf/slotWidthOf`，`renderMA` 算出 active 后 `slotStyle = slotStyles(active, themeColors().lineColors.length)`，`syncSeriesPool` 末尾补色、`applyTheme` 重刷、`legendHTML` 均线读数三处全部改走 `slotColorOf`（否则换肤会把用户选色重置回槽位序号），一切取色仍走 `var(--ma-N)` 令牌链、零 hex 字面量；④ **setMAVisible 保留 ci/w**：原 normalize 只留 `{type,n,on}`，localStorage 里存的选色会在下一次 setMAVisible 被剥掉（本条必修坑），现在 ci 非法归 null、w 收敛到 1/2/3 后随配置一起带走。
2. `js/app.js`（+41/-4）：① `el` 列表补 `maReset`；② `loadDetailChart` 在 `!state.chart` 守卫之后、setPane 之前调用 `state.chart.setInfo({ code: t.code || t.symbol, period: 当前 active 周期按钮 textContent })`——周期文案单一来源是 index.html 按钮文字（分时/5分/15分/60分/日K/周K/月K），不另立映射表；③ `renderMaMenu` 每行追加线宽下拉 `<select data-maw>`（1px/2px/3px）与 6 色取色板 `<i class="ma-swatch" data-macolor="i:k" style="background:var(--ma-k)">`（当前指派 `.on`，`resolvedCi` 与 charts.js slotStyles 同口径，未指派回退槽位序号），原 `ma-line-dot` 行内色点由色板取代（点色已不能反映用户选色）；④ `document` 级 change 监听加 `data-maw` 分支（1/2/3 之外按 1，与 slotStyles 同口径）；**与方案的一处偏差**：`data-macolor` 走 click 委托而非 change——`<i>` 元素不触发 change 事件，方案的 change 分支按字面实现会是死代码，意图（点击色块立即上图并落 Store）在 click 监听里落地，`applyMaLine` 管线不变；⑤ `el.maReset` 点击：恢复 MA_CFG_DEFAULT（lines 逐项浅拷贝、pane 新对象，防共享引用污染默认值），Store/setMAVisible/setPane 由 `saveMaCfg` 一并完成。
3. `index.html`：`#maAdd` 后追加 `<button type="button" class="ma-add" id="maReset">恢复默认</button>`（复用现有样式类）；全部 67 处业务资源 `?v=20261029a` → `?v=20261031a`（vendor 的语义化版本不动），满足单调递增与 tokens.test 一致性守卫。
4. `css/style.css`（+8，只小段插入、保持原有 CRLF 行尾）：`.k-legend .kl-sym`（`--text-secondary` + 500 字重，纯 color 令牌字段暗亮皮肤自动适配）；`.ma-swatches`/`.ma-menu .ma-swatch`（10×10 色块、`.on` 描边 `--text-secondary`）——选择器提为 `.ma-menu .ma-swatch` 是必须的：`.ma-menu i` 通配规则（14×3 细条 + margin-left:auto）特异性更高，会压掉裸 `.ma-swatch`。无动画、无颜色字面量。
5. `_test/charts.test.mjs`（新建，147 行，纯离线）：照 utils.test.mjs 的 vm 沙箱先例载入真实 charts.js（顶层无 DOM/LWC 访问），14 组断言——legendBadge 拼接/空段剔除/非对象；slotStyles 默认回退/BOLL 三轨顺延（ci:4→[4,5,0]、ci:5→[5,0,1]）/线宽收敛/ci 归一（ci:0 是合法下标不是缺失）/paletteN 非 6/多条混合槽位一一对应/脏元素跳过；calcMA 手算核对（正常窗口/null 收盘断线/n 大于序列长度全 null，此前导出多年从无单测）。跨 realm 数组用 JSON 串比较。
6. `_test/tokens.test.mjs`（+10/-2）：renderMaMenu 守卫放宽为 `/var\(--ma-\$\{/`（色板仍全取令牌），新增 data-macolor/data-maw 存在性断言，hexInMenu 为 null 原样保留；新增结构守卫「index.html 必须含 id="maReset"」。`_test/run-all.mjs` 在 paneview 之后注册 `charts.test.mjs`（离线组）。

### 测试
- `node _test/run-all.mjs --offline`：共 43 组（离线 37 / 实网 6），本次执行 37 组、跳过 6 组，**✓ 全部测试组通过**（基线本轮实测为 36 组全绿，施工后新增 charts.test.mjs 成 37 组）。
- 单跑：`node _test/charts.test.mjs` 14 passed / 0 failed；`node _test/tokens.test.mjs` 36 passed / 0 failed。
- 未做实网验证（红线 11：不动 curl/外部行情接口）；未 git commit / push。行尾核验：charts.js/app.js/run-all.mjs/style.css 保持全 CRLF，index.html/tokens.test.mjs/charts.test.mjs/docs 保持 LF。
- 注：Mimosa 提交前扫描报的 1 高危（app.js:4677 污点链）与各中危均为此前轮次的存量代码/vendor 副本，不在本轮改动面内——本轮零新增取数代码（红线 6 无涉）。

### 涉及文件
- `js/charts.js`、`js/app.js`、`index.html`、`css/style.css`
- `_test/charts.test.mjs`（新建）、`_test/tokens.test.mjs`、`_test/run-all.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0 两条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-10-31 20:41 · P0 画线工具基础六件：吸附 K 线 + 按代码 localStorage 持久化

### 目标
TV-ROADMAP P0 第 2 条（骨架轮）：只做「画得出 / 存得住 / 重画正确」——趋势线/水平线/垂直线/矩形/斐波那契回撤/文字标注六件，吸附 K 线落点，按标的 symbol 存 localStorage；选中/拖拽/删除/隐藏留给下一条「画线工具·交互」（P0 第 3 条）。勾完本条 P0 仍余 5 条未勾，不构成里程碑。

### 改动
1. `js/charts.js`（+429/-8，保持全 CRLF）：① 纯函数区新增并导出 `DRAW_TOOLS=['trend','hline','vline','rect','fib','text']`、`sanitizeDrawing`（tool 白名单 / k1 必须是 `YYYY-MM-DD` 或纯数字秒**字符串**（tKey 两种产物，数字类型拒收）/ p1 经 `+` 强转须有限 / 两点工具（trend/rect/fib）必须另有合法 k2,p2、单点工具忽略 k2,p2 / text trim 非空截断 40 字符 / ci 与 slotStyles 同口径归一、非法→null）、`sanitizeDrawings`（非数组→[]、脏项过滤、200 条上限）、`sanitizeDrawStore`（键 trim 后非空且 ≤24 字符、**纯数字键剔除**——真符号必带市场前缀/字母，纯数字键只可能是误存下标；值须非空数组逐项净化）、`fibLevels`（FIB 七档，纯算术方向无关）；② `createKline` 增可选第二参 `options={onDrawings,onToolEnd}`（不传行为不变，createTrend 不动）：`.k-draw` overlay canvas 挂 el（同 .k-legend 先例，z-index 低于图例、pointer-events:none），dpr 变换 + 尺寸失配重设位图；`snapPoint` 走 `coordinateToTime` 经 tKey 反查当前序列原始 time + `coordinateToPrice`，任一不可用返回 null（老版本 LWC 静默退化为画不了，诚实降级）；`drawOverlay` 逐条 k→time→`timeToCoordinate`、p→`priceToCoordinate`，按 tool 分支画 trend/hline（止于 priceScale('right').width() 同款逻辑，右端价格标签）/vline/rect（描边+6% 填充）/fib（7 条水平细线+档位%/价格标签）/text；取色全走 themeColors 的 --ma-N 令牌链、标签文字走 --chart-text（renderPane 同款兜底写法）；交互 capture 监听 el 的 mousedown/mousemove/mouseleave + document keydown——drawTool 为 null 放行，激活时仅 mousedown stopPropagation（拦 LWC 平移与 subscribeClick 事件标记，十字线/图例照常联动当取点辅助），单点工具一下提交、两点工具第一下落 draft、mousemove 预览、第二下提交，Esc 取消 draft 并退出（onToolEnd 回调），text 工具锚点浮出 `.k-draw-input`（Enter 提交、Esc/失焦取消）；提交路径 `sanitizeDrawings(drawings.concat([nd]))` → 重画 → onDrawings；`setDrawings(list)` 回灌（timeByKey 反查表失效重建）、`setDrawTool(tool)`（白名单外置 null、清 draft、el toggle `k-drawing`）；③ 重画接线：`runPaneRender` 末尾追加 `drawOverlay()`（复用 rAF+40ms WebView 兜底链）、`runResizeRender`/`applyTheme` 各补一次（换肤即时重取令牌色）、`setData` 里失效反查表；④ remove() 摘除 drawCanvas / 文字输入框 / document keydown / el 三监听。
2. `js/app.js`（+55/-2，保持全 CRLF）：① state 增 `drawTool:null`；② `saveDrawings(list)`（键=state.detail.symbol 写 `drawV1`，读写两侧都过 Charts.sanitizeDraw*，清空即删键）、`drawFor(symbol)`、`applyDrawTool()`（同步 [data-draw] 按钮 active 态 + state.chart.setDrawTool，图表可能已随切标的换新故带守卫）；③ createKline 调用处传 `{ onDrawings: saveDrawings, onToolEnd: ()=>{ state.drawTool=null; applyDrawTool(); } }`；④ loadDetailChart 的 K 线分支在 setData/setMAVisible 之后 `setDrawings(drawFor(t.symbol))` + `applyDrawTool()`——图表实例跨标的复用时每次按当前 symbol 重灌，无串档窗口；⑤ bindEvents 绑 6 个画线按钮：同 tool 再点退出（toggle）、否则切换（与 maToggle 同款模式）。
3. `index.html`（保持 LF）：详情工具条 alertDetailBtn 后追加 6 个 `<button class="pill draw-btn" data-draw="…">`（字形 ╱ ─ │ ▭ ƒ T，title/aria 全中文含「吸附K线，Esc退出」提示）；全部 67 处业务资源 `?v=20261031a` → `?v=20261031b`（单调递增 bump，vendor 语义化版本 4.2.3 等不动）。
4. `css/style.css`（+18，只小段插入、保持全 CRLF）：`.k-draw`（absolute inset:0、pointer-events:none、z-index:4 低于图例的 5）、`#klineChart.k-drawing{cursor:crosshair}`、`.k-draw-input`（bg --bg-card / border --chart-border / color --text 令牌）、`.draw-btn.active`（accent + bg-hover + border-hover 令牌）与 `.draw-btn` 过渡（仅 border-color/color，--dur-fast/--ease-out）。**与方案的一处偏差**：输入框文字色方案写的是 `--text-primary`，本仓库无该令牌（主文字令牌是 `--text`），按实有令牌落地。
5. `_test/charts.test.mjs`（+15 组，共 29 组）：sanitizeDrawing 8 组（合法往返收敛 / tool 白名单含大写拒收 / k1 两种 tKey 产物通过、数字与脏串拒收 / p1 强转与有限性 / 两点必填 k2,p2、单点忽略 / text 空拒超长截 40 / ci 归一 / 非对象拒）；sanitizeDrawings 2 组；sanitizeDrawStore 2 组（坏键坏值收敛、合法结构保留）；fibLevels 2 组（10→20 七档 0.5 档=15、反向 20→10 的 0.618 档=13.82、p1=p2 全档同价）；白名单一致性 1 组（读 index.html 断言 6 个 data-draw 全 ∈ DRAW_TOOLS 且互不重复，防 UI 与白名单漂移）。跨 realm 对象一律 JSON.stringify 串比较（既有先例）。
6. `_test/tokens.test.mjs`（+1 组，共 37 组）：「index.html 必须保留 6 个 data-draw 画线按钮（title/aria 齐全）」结构守卫；`?v=` 一致性与 vendor 版本守卫 bump 后自然通过无需改。

### 测试
- `node _test/run-all.mjs --offline`：共 43 组（离线 37 / 实网 6），本次执行 37 组、跳过 6 组，**✓ 全部测试组通过**（基线 37 组全绿，施工后仍 37 组全绿）。
- 单跑：`node _test/charts.test.mjs` 29 passed / 0 failed（新增 15 组）；`node _test/tokens.test.mjs` 37 passed / 0 failed（新增 1 组）。
- 红线核对：全中文 title/aria；overlay 取色全走 --ma-N/--chart-text 令牌链、applyTheme 换肤重画；无成交量展示/无 Polymarket 字样/无省略号问句；纯几何标注工具不涉买卖建议；零新增取数零 API key（红线 6 无涉）；无 setInterval（复用 rAF+40ms 兜底 setTimeout 链，无新增调度）；charts.js/app.js/style.css 保持全 CRLF、index.html/测试/docs 保持 LF；?v= bump 至 20261031b；无开源代码移植；未做实网验证（红线 11）；未 git commit / push。
- 浏览器内实画（真点按/拖拽）属视觉冒烟，留给人工轮次；本轮以纯函数单测 + 静态守卫为完成判定依据。

### 涉及文件
- `js/charts.js`、`js/app.js`、`index.html`、`css/style.css`
- `_test/charts.test.mjs`、`_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0 第 2 条）、`docs/OPTIMIZER-LOG.md`（本条目）
