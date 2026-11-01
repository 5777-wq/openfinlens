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

## 2026-10-31 21:46 · P0 画线工具·交互：选中/拖拽/删除/全部隐藏 + 浮动工具条与右键菜单

### 目标
TV-ROADMAP P0 第 3 条（画线交互，接骨架轮）。只描述事实口径：命中容差 8px、从最上层往下找；
拖拽吸附 K 线换锚/移价；删除与隐藏都是显式操作（删除即落盘、隐藏只藏不删）。边界：不做
框选多选、不做锚点级手柄拖拽（TradingView 端点拖拽留给后续细节轮）。

**选题偏序留痕（P0★）**：TV-ROADMAP 在本轮规划与评审之间被用户加入了未提交的工作区编辑——
P0★「UI 语言统一」小节（6 条全未勾 + 未跟踪的 docs/UI-AUDIT.md），按文件字面序先于画线交互。
评审员在明知此节存在的前提下裁定「观察项，不判违规」并放行本方案修订重提，OPTIMIZER-LOG
三轮实践也均直接做 P0 图表核心小节——本轮按评审指令施工画线交互；建议下一轮转向 P0★
第 1 条「语义色收敛」（UI-AUDIT.md 48 行诊断已就位，届时先评估「全站排查替换」规模）。

### 改动
1. `js/charts.js`（+331/-20，保持全 CRLF）：① 纯函数区新增并导出 `DRAW_HIT_TOL=8`、
   `segDist`（点到线段距离，投影参数钳 [0,1]）、`drawTextBox`（文字命中框估算：11px mono，
   charCode>0xFF 记 11px/字否则 6.6px/字，锚点为 fillText 基线，框 [x-2,y-16,w+6,20]——
   不用 measureText，离线确定性）、`hitDrawing`（六工具逐个：trend 走 segDist、hline
   |y-y1|≤tol 且 x≤w-axisW+tol、vline |x-x1|≤tol、rect 外接域 ±tol 含内部、fib x 在跨度内
   且 y 与 fibYs 某档 ≤tol（null 档跳过）、text 落框内；d/c 为 null 一律不命中）、
   `hitTestDrawings`（尾部最上层优先回扫，null coords 条目跳过）、`moveDrawing`（hline 只动
   p1、vline 只动 k1、text 与两点工具 k1/k2+p1/p2 全位移；越界/锚不在 keys/非数位移返回
   null；Object.assign 不用 spread，老 WebView 安全）、`clampBox`（浮层贴边钳制，框大于
   区域归 0）；`themeColors()` 追加 `accent`（--accent-signature 令牌，现有消费者按需解构
   零影响）。② `createKline` 交互态：`selIdx/dragCtx/hidden/hoverHit/toolbarEl/ctxMenuEl`
   闭包状态 + `onHideAll` 回调；`coordsOf` 为 fib 追加 `fibYs`（逐档 priceToCoordinate，
   解析不出记 null）；`drawOverlay` hidden 清屏即返回、非工具态画选中端点手柄（c.accent
   3px 实心圆）并摆位工具条；`onMouseDown` 重排——最前两道 closest('.k-draw-sel,.k-draw-ctx')
   与 hidden 放行，随后统一 closeCtxMenu()（不加 document mousedown，Esc 兜底），drawTool
   分支维持原画线行为并起笔 select(-1)，无工具分支命中→stopPropagation+选中+吸附可得才
   建 dragCtx（不可用只选中不拖，诚实降级）；`onMouseMove` 拖拽走 `applyDrag`（**两道 null
   守卫**：snapPoint 回 null 直接 return——不守卫 mousemove 每帧 TypeError；moveDrawing/
   sanitizeDrawing 回 null 直接 return 不置 moved 不改 drawings——不守卫则 drawings[idx]=null
   打洞、onMouseUp 落盘时该条画线从 localStorage 静默永久删除）、无拖拽时 hoverHit 变化才
   切 cursor 不重画；`onMouseUp`（document 新增）收尾，moved 才 onDrawings 落盘（拖拽过程
   零 localStorage 写）；`onKeyDown` Esc 一层层退（菜单→选中→画线模式）+ Delete 删除选中
   （既有 INPUT/TEXTAREA/SELECT 守卫沿用）；`contextmenu`（el capture 新增）命中打开两项
   菜单「删除该画线」（splice + onDrawings 落盘，与 Delete 同口径）/「隐藏全部画线」
   （setHidden(true) + onHideAll(true)，未传回调仅本图临时隐藏）；浮动工具条 `.k-draw-sel`
   6 个 data-ci 色块取 --ma-N 令牌 + 删除按钮，改 ci 与删除都立即 onDrawings 落盘（防改色
   刷新即丢）；`setDrawTool` 补 select(-1)/closeCtxMenu()/复位内联 cursor；`setDrawings`
   回灌清选中关浮层弃拖；`setHidden` 收敛布尔并关选中/菜单/拖拽态；导出面追加 setHidden；
   `remove()` 仅补摘两个新监听（document mouseup、el contextmenu）并清浮层 DOM——不新增
   也不多摘 document mousedown。
2. `js/app.js`（+31/-3，保持全 CRLF）：① state 增 `drawHidden: !!Store.get('drawHideV1', false)`；
   ② DOM_IDS 补 `drawHide`；③ `applyDrawTool` 扩展：drawHide 按钮 active/aria-pressed 同步 +
   `state.chart.setHidden(state.drawHidden)`（存在性守卫同 setDrawTool）；④ bindEvents 补
   drawHide 点击（取反 → Store.set → applyDrawTool）；⑤ createKline options 补
   `onHideAll`（记忆 + applyDrawTool 收敛；图表侧已由菜单 setHidden 生效，回调只管 app 层）。
   loadDetailChart 的 K 线分支既有 setDrawings+applyDrawTool，换标的/换周期自动重放隐藏态。
3. `index.html`（保持 LF）：6 个画线按钮后追加 `#drawHide`（◉ 字形，全中文 title/aria +
   aria-pressed，不带 data-draw 不进工具白名单）；全部 67 处业务资源 `?v=20261031b` →
   `?v=20261031c`（单调递增 bump，vendor 语义化版本不动）。
4. `css/style.css`（+30，只小段插入、保持全 CRLF）：`.k-draw-sel`（absolute z-index:6、
   bg-card/chart-border 令牌、flex、pointer-events:auto）+ `.k-draw-swatch`（12×12 色块、
   .on 描边 --text-secondary，对齐 .ma-swatch 先例；不在 .ma-menu i 通配作用域，选择器独立
   写）+ `.k-draw-del`（hover --bg-hover）+ `.k-draw-ctx`（z-index:7、按钮块级全宽）+
   `@keyframes kdrawIn`（opacity/translateY(2px) 起，150ms --ease-out 挂两个浮层——只碰
   opacity/transform，全局 prefers-reduced-motion 块自动把时长归零）；按钮过渡仅
   color/border-color（--dur-fast/--ease-out，.draw-btn 先例）。取色全走既有令牌、零 hex
   字面量。与方案的一处偏差：补了 `#drawHide.active` 三行——方案按钮类用 `.pill.draw-btn`
   本可复用 `.draw-btn.active`，但 id 选择器显式落一条更防后续类名重构时静默掉选中态。
5. `_test/charts.test.mjs`（+12 组，29→41）：segDist 三向（含端点外投影钳端点）；
   drawTextBox ASCII/CJK 分档与框尺寸确定性（浮点和用 1e-9 容差比较，同输入逐字段全等）；
   hitDrawing 六工具各一组（trend 线上/端点/离线、hline 容差与价格轴越界、vline、rect 含
   内部、fib 档/null 档/出跨度、text 档内外）+ null 输入与重叠最上层/null coords 跳过合一
   组；moveDrawing 位移口径与守卫面（越界/锚缺/非数/脏输入/keys 缺失→null）一组；clampBox
   四向+空区域；导出守卫（七个新符号全在导出面、DRAW_HIT_TOL=8）。
6. `_test/tokens.test.mjs`（+2 组，37→39）：「index.html 必须保留 id="drawHide" 且带
   aria-pressed」结构守卫（照 maReset 先例）；「js/app.js 必须保留 drawHideV1 持久化与
   setHidden 接线」双断言守卫（缺持久化则刷新即丢、缺接线则按钮点了图不隐藏）。

### 测试
- `node _test/run-all.mjs --offline`：共 43 组（离线 37 / 实网 6），本次执行 37 组、跳过 6 组，
  **✓ 全部测试组通过**（基线本轮实测 37 组全绿，施工后组数不变、用例数递增——组=文件级
  条目，本轮只扩展既有 charts/tokens 两个测试文件，run-all.mjs 零改动）。
- 单跑：`node _test/charts.test.mjs` 41 passed / 0 failed（29→41，新增 12 组）；
  `node _test/tokens.test.mjs` 39 passed / 0 failed（37→39，新增 2 组）。
- 行尾核验（逐文件实跑字节统计）：charts.js/app.js/style.css 保持全 CRLF（裸 LF 0），
  index.html/charts.test.mjs/tokens.test.mjs/docs 保持 LF（CRLF 0）。
- 红线核对：全中文 title/aria（drawHide「隐藏全部画线（画线保留，再次点击显示）」）；动效
  只 opacity/transform、150ms、统一 --ease-out、prefers-reduced-motion 全局块覆盖；无
  setInterval（无新增调度）；零新增取数零 API key（红线 6 无涉）；无成交量展示/无
  Polymarket 字样/无省略号问句；删除/选中/隐藏纯交互不涉买卖建议；?v= 单调递增至
  20261031c；无开源代码移植；未做实网验证（红线 11）；未 git commit / push。
- 浏览器内实选/实拖/右键属视觉冒烟，留给人工轮次；本轮以纯函数单测 + 静态守卫为完成判定
  依据。`?v=` 一致性、6 个 data-draw 白名单、vendor 版本锁定等既有守卫在按钮新增与 bump 后
  自然回归（tokens/charts 组内）。

### 涉及文件
- `js/charts.js`、`js/app.js`、`index.html`、`css/style.css`
- `_test/charts.test.mjs`、`_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0 第 3 条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-10-31 23:17 · P0★ 页头降级：tab 标题改小节头（12px 标签+元数据行）、分隔线家族统一 1px、tokens.test 两组结构断言

### 目标
路线图 P0★ 第 2 条（UI-AUDIT.md 病灶二）：巨型 tab 标题（swiss/bauhaus/clay/memphis 四套
clamp 到 64~72px 的报纸头版语言）降级为小节头——12px 大写字距标签 + 一行元数据
（`.page-sub` 的标的数·刷新·抓取时间已存在，零 JS 改动）；2~4px 粗黑规则线（含
`3px double` 报头双线）统一 1px；省出的高度还给数据（`.page-head` margin 28→16px）。
**范围边界**：卡片左竖条/色带 accent 边（`.pm-sec-head`、`.pm-card`、`#heroStrip`）与
选中下划线（`.tab.active::after`）不属"分隔线"，留给下一轮「形状令牌」与既有选中态语言。

### 改动
1. `css/style.css`（+9/-19，全 CRLF 保持，17 处小段编辑零整文件重写）：① 基础
   `h1.page-title` 26px → 12px/600/0.14em/uppercase/`--text`（小节头语言，h1 语义保留，
   读屏仍是页标题；层级高于 11px/`--text-secondary` 的 `.section-title`）；② `.page-head`
   `align-items: flex-end → baseline`、`margin-bottom: 28px → 16px`（标题降为 12px 后
   标签与元数据同行基线对齐）；③ 删窄屏媒体查询里 `h1.page-title { font-size: 22px }`
   （基础降级后它会反向放大页头）；④ 删四套巨型标题规则：swiss（clamp 36-64px）、
   bauhaus（clamp 40-72px + 900 重）、clay（clamp 38-68px）、memphis（clamp 36-64px +
   rotate(-1.5deg) 倾斜）——memphis 的 Righteous 经 `--font-sans`（L1937）由 body 继承、
   paper/clay 的衬线经共享 font-family 规则保留、aurora 渐变字保留（12px 上仍成立），
   四套皮肤的身份层不丢；⑤ 分隔线家族 16 处 → 1px solid：oled/paper 的 `.section`/
   `.pm-sec`/`.pm-overview`（3px double → 1px，`.section` padding-top 16→14 与其余皮肤
   对齐）、swiss/bauhaus/memphis 的 `.section`/`.pm-sec`/`.sec-line`/`.topbar`
   （2/3/4px → 1px；memphis 彩虹渐变 sec-line 保留、仅高度 4→1px）、删 swiss
   `.topbar::after` 双线偏移装饰；⑥ 顺手修正 3 处因此过时的注释（"报头双线"“粗黑规则线”
   "极端字号对比"）。
2. `_test/tokens.test.mjs`（+56，2 组，42→44，测试先行）：组一「页头是小节头」——扫描
   CSS_NC 全部选择器含 page-title 的规则，禁 clamp()、font-size ≤13px，且存在 12px 基础
   规则；组二「分隔线家族统一 1px」——选择器命中 `.section/.pm-sec/.pm-overview/
   .sec-line/.topbar`（负向先行 `(?![\w-])` 排除 .section-head/.pm-sec-head/.topbar-actions
   等同前缀子元素）的规则体禁 `double`、border 声明（排除 border-radius）px ≤1、
   `.sec-line` 显式 height ≤1px。施工前实跑 `node _test/tokens.test.mjs` = 42 passed /
   2 failed，失败清单与预案逐条一致（4 处 clamp + 16 处粗线，零意外项）。
3. `index.html`（67 处）：业务资源 `?v=20261031d` → `?v=20261031e`（style.css 内容变更
   触发缓存失效，单调递增；vendor 语义化版本不动；非 v= 改动行数实测 0，LF 保持）。

### 测试
- 测试先行：施工前 `node _test/tokens.test.mjs` = **42 passed / 2 failed**（两组新断言
  先红，失败点与预判一致）。
- 施工后单跑：`node _test/tokens.test.mjs` = **44 passed / 0 failed**（42→44）。
- 全量：`node _test/run-all.mjs --offline` = 共 43 组（离线 37 / 实网 6），本次执行
  37 组、跳过 6 组，**✓ 全部测试组通过**。
- 行尾核验（逐文件实跑字节统计）：style.css CR=2609 LF=2609 全 CRLF（裸 LF=0）、
  index.html CR=0 纯 LF、tokens.test.mjs CR=0 纯 LF。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤经守卫组二全量扫描（收敛对
  所有皮肤一致生效，渐变/衬线/几何字身份保留）；无成交量展示/无 Polymarket 字样/无
  省略号问句；纯视觉降级不涉买卖建议；零 JS 改动（无 setInterval、零新增取数零 API key，
  红线 5/6 无涉）；style.css 小段编辑、index.html/测试/docs 保持 LF；?v= 单调递增至
  20261031e；无开源代码移植；未做实网验证（红线 11）；未 git commit / push。
- 8 套皮肤页头实拍观感属视觉冒烟，留给人工轮次；本轮以结构断言 + 静态守卫为完成判定。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0★ 第 2 条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-10-31 22:49 · P0★ 语义色收敛（修订版）：删死令牌 --ok、警示改橙、交互态去涨跌色、tokens.test 三组结构断言

### 目标
路线图 P0★ 第 1 条：语义色收敛——红/绿只许表示涨跌，警示一律用橙；全站排查替换非涨跌元素上的涨跌色，并在 tokens.test 钉成三组结构断言。修订版相对初版的一处硬伤裁决：初版想保留 `--ok: #2ebd85` 作组三断言豁免，与"红/绿只许表示涨跌"自相矛盾。**--ok 删除依据（评审要求留痕①）**：`git show ae3768e -- css/style.css` 实查显示该"死代码清理"提交已删最后消费者 `.status-ok { color: var(--ok); }` 只留定义；`grep -rn "var(--ok\b"` 全仓（js/css/html/mjs/json）仅命中根目录 4 份独立评审报告 HTML，它们自带内联令牌（如 FIX-VERIFICATION-20260914.html 的 `--ok:#1f7a52`，与 style.css 值不同）且不加载 css/style.css——即全仓对 style.css 的 `--ok` 零消费，自 ae3768e 起即死令牌。删除它使组三断言成为无豁免绝对禁令，恰是路线图的字面要求。

### 改动
1. `css/style.css`（+21/-14，全 CRLF 保持，14 处小段编辑零整文件重写）：⓪ 删 L70-71 注释与 `--ok: #2ebd85;` 死令牌；① `--warn: #ff5c5c` → `#ff8f3d`（警示橙），注释独立成行置于声明上方（行内注释会被 tokens.test 的 themeVar 正则 `([^;]+)` 捕进值里导致 hex2rgb 抛错，故照 tape-h 注释块先例）；② paper/swiss/bauhaus/clay/memphis 五套浅色皮肤各增 1 行 `--warn: #a04c05;`（**对比度归因（留痕③）**：对最差表面 paper `--bg-elevated #edebe4` 实测 4.99:1，对白底 5.95:1，8 套皮肤 × bg/bg-elevated/bg-card 三表面全部 ≥4.5:1）；③ `#sourceStatus.warn` 淡底 `rgba(255,92,92,0.06)` → `color-mix(in srgb, var(--warn) 7%, transparent)`；④ `.ma-line-row button:hover` 色 `--down-text` → `--accent-signature`；⑤ `.imp-kind.k-data` 硬编码 `#2ebd85`/`rgba(46,189,133,.4)` → `--text-secondary`/`--border-hover`；⑥ `.cmp-chip-x:hover` 色 `--up-text` → `--accent-signature`；⑦ `.fq-tier.t1/.t2` → 中性 `--text-tertiary`/`--border`；⑧ `.fq-tier.t4/.t5` → `--warn` + color-mix 45%；⑨ `.mac-spread i` → warn color-mix 14% 底 + warn 字；⑩ `.mac-spread.inv` / ⑪ `.sig-card.inv` 描边 → warn color-mix 45%；⑫ `.pr-op.danger` → `--warn`；⑬ `.pr-op.armed` 两处红 rgba → warn color-mix 14%/50%。
2. `js/fundprofile.js`（1 行，CRLF 保持）：L289 资产配置"股票"段 `var(--up)` → `var(--ma-1)`（资产类别取图表调色板槽位蓝；"债券"accent、"现金"白维持）。**留痕②**：该 JS 改动不在组二/组三任何断言扫描范围（两断言只扫 CSS），属装饰性低风险、本轮无单测覆盖，如实记录。
3. `_test/tokens.test.mjs`（+76，3 组，39→42，测试先行）：组一「警示色 --warn 与涨跌色解耦且 8 套皮肤对三表面都 ≥4.5:1」（themeVarOrRoot('warn') 存在且 hex、≠ 红涨/绿涨两种模式的 --up/--down 值、contrast ≥4.5）；组二「非涨跌元素禁用涨跌色」规则级白名单（按既有 CSS_NC 先例剥注释、`[^{}]+\{[^{}]*\}` 切规则，凡消费 var(--up*)/var(--down*) 八形态的规则 selector 必须命中 14 项方向语义白名单 .up/.down/.hero-chg/.sb-panic/.sb-greed/.thermo-track/.ts-/.tc-bias/.imp-dir/.pm-chg/.brk-chg/.rbar/.brief-bar/.brief-v，评审核实恰穷尽剩余方向色规则；断言信息写明**白名单只减不增**，新增须走评审）；组三「涨跌色硬编码字面量清零（无豁免）」（剥注释 + 剥 `--(up|down|text-rise|text-fall)[a-z-]*:` 令牌声明后，CSS 全文不得出现 #ff5c5c/#2ebd85/#f6465d/rgba(255,92,92,/rgba(46,189,133,/rgba(246,70,93,——因 --ok 已删，无任何具名豁免；JS 画布 fallback 属方向色语义不在扫描范围，只扫 CSS）。
4. `index.html`（67 处）：业务资源 `?v=20261031c` → `?v=20261031d`（vendor 4 个语义化版本不动，单调递增）。
5. **保留不动（评审已核实为方向语义，白名单内留痕）**：`.sb-panic`/`.sb-greed`/`.thermo-track` 情绪表盘（恐慌↔跌、贪婪↔涨的方向性情绪刻度）、`.imp-dir`（预期↑↓）、app.js 龙虎榜买卖方向色、价格闪烁 `--up-rgb`/`--down-rgb`（CSS 无 var() 消费、仅 JS WAAPI 用）、portfolio.js 曲线填充。

### 测试
- 测试先行：施工前 `node _test/tokens.test.mjs` = **39 passed / 3 failed**（新增 3 组先红，失败点与预判一致：组一 --warn=#ff5c5c 撞涨红、组二恰 6 条规则越白名单、组三 5 类字面量残留）。
- 施工后单跑：`node _test/tokens.test.mjs` = **42 passed / 0 failed**（39→42）。
- 全量：`node _test/run-all.mjs --offline` = 共 43 组（离线 37 / 实网 6），本次执行 37 组、跳过 6 组，**✓ 全部测试组通过**。
- 行尾核验（逐文件实跑字节统计）：style.css 2621 CR=2621 LF 全 CRLF（裸 LF=0）、fundprofile.js 382=382 全 CRLF；tokens.test.mjs/index.html/两份 docs CR=0 纯 LF。
- 未做实网验证（红线 11）；未 git commit / push。8 套皮肤警示橙实拍观感属视觉冒烟，留给人工轮次。

### 涉及文件
- `css/style.css`、`js/fundprofile.js`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0★ 第 1 条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 00:26 · P0★ 形状令牌：radius 4/8/14 三档 + 阴影两档进 tokens、描边一档标记条 2px、全站 radius 收敛六形态、tokens.test 增三组形状断言

### 目标
路线图 P0★ 第 3 条（UI-AUDIT.md 病灶三）：卡片语言三种以上并存——圆角、描边、阴影各成体系，
此前 tokens.test 管住了颜色令牌、没管形状令牌。实测盘点（本轮 grep 全量）：radius 散布
1/1.5/2/3/4/5/6/8/9/10/12/14/16px 共 13 种字面量 + 0/50%/999px（测试先行红清单 105 处）；
box-shadow 海拔字面量 11 处 5 种写法；非 1px 可见描边 14 处（3px/4px 标记条与 2px 全边描边）。
处方：radius 三档（--r-sm/md/lg = 4/8/14）+ 阴影两档（--shadow-1/2）进 tokens、可见描边收敛
1px 一档、方向边标记条统一 2px，卡片收敛三模板：大卡/浮层 = --r-lg + --shadow-2（modal、
aurora 玻璃面板）；标准卡 = --r-md + 1px 描边（pm-card/fq-card/event-detail 等）；迷你卡/
行内控件 = --r-sm 无阴影（qrow/chip/徽章/取色块）；条形轨道 = 999px 胶囊；方角(0)/圆(50%)
是 paper 皮肤与几何图形的身份层。**范围边界**：零 JS 改动（js/*.js grep border-radius/
box-shadow 内联为空）；不新增任何 box-shadow 过渡（FIELD-NOTES 家规 2，L1949/L1958 存量
transition 声明原样保留）；inset 选中/下划线指示条与 focus-ring 复合环非海拔阴影，不在
两档体系内。

### 改动
1. `css/style.css`（+141/-130，全 CRLF 保持 2620=2620，约 90 处小段编辑零整文件重写）：
   ① :root 尾部插入形状令牌 `--r-sm: 4px; --r-md: 8px; --r-lg: 14px;` 与
   `--shadow-1: 0 8px 28px rgba(0,0,0,0.5)`（浮出菜单/提示浮层/悬停浮起一档）、
   `--shadow-2: 0 16px 44px rgba(0,0,0,0.38)`（模态/大浮层一档，取自现存出现 4 次的字面量），
   含三模板映射中文注释；同步修正头部过时注释「圆角只有 6 / 3px 两档」。② radius 收敛
   105 处 → 六形态 {var(--r-sm), var(--r-md), var(--r-lg), 0, 50%, 999px}，按选择器语义
   分流（非盲替）：42 处 3px 与 15 处 1/1.5/2px 徽章/控件/输入 → --r-sm；13 处 4px 按语义
   分流（控件 fq-opt → r-sm；浮层 ma-menu/alert-panel/k-draw-sel/k-draw-ctx/toast 与
   内容卡 chart-event/fq-lv/fq-chain/fq-stale/share-preview img → r-md）；12 处 6px（modal
   → r-lg，globe-stage/event-detail/pm-overview/fq-q/fq-intro/fq-verdict/fq-warn/fq-card →
   r-md，fp-tr → r-sm，mac-spread i → r-sm）；3 处 5px（fp-bar 及其 i 进度条 → 999px，
   pm-card → r-md）；条形轨道归 999px 胶囊（rbar .rb-track、brief-bar、pm-out-bar 及其 i、
   mac-cbar 及其 i，与既有唯一 999px brk-chg 同语言）；微件归 r-sm（logo-dot/switch 旋钮/
   ma-menu i/ma-line-dot/cmp-dot/fq-scale i/flag/qlogo/ma-swatch/k-draw-swatch/fq-chain-q i，
   浏览器对超尺寸半径自动钳到半短边，视觉不变或可接受）；8/9/10/12px 控件与卡（mac-spread/
   port-num/aurora modal-close/fp-stack/mac-chip/fp-ret/sig-card/pstat → r-md，alert-badge →
   r-sm）；皮肤块（aurora section 14px/modal 14px/pm-sec 16px/pm-overview 16px → r-lg、
   pm-card 12px → r-md、seg 9px → r-md、seg button 6px → r-sm；paper 方角 0 身份与 50% 圆
   全部保留不动）；1173 多值「0 4px 4px 0」→「0 var(--r-sm) var(--r-sm) 0」。③ 阴影两档
   11 处：ma-menu/alert-panel/toast/pm-card:hover/gloss-tip → var(--shadow-1)；aurora
   section/pm-sec/pm-overview → var(--shadow-2)；paper 主题块内新增 1 行
   `--shadow-1: 0 8px 20px rgba(25,25,20,0.12)` 亮色覆盖，其 pm-card:hover 规则体改
   var(--shadow-1)。④ 描边一档 + 标记条统一 2px 14 处：bauhaus/memphis 的 .modal
   border 2px → 1px；标记条 3px/4px → 2px（fq-intro/fq-verdict/fq-warn/toast、swiss
   pm-card 与 heroStrip 左条、clay heroStrip 顶条与 pm-card 左条、bauhaus/memphis
   heroStrip 底条、paper pm-card border-left-width、memphis pm-card border-bottom-width）。
2. `_test/tokens.test.mjs`（+96，3 组，44→47，测试先行照 23:17 轮先红后绿先例）：组一
   「radius 三档令牌」——正则抓 CSS_NC 全部 border-radius（含 !important 与多值形态）逐
   分量 ∈ 六形态，违规报「选择器: 值」，另卡 --r-sm/md/lg 恰为 4/8/14px；组二「阴影两档
   令牌」——全部 box-shadow ∈ {var(--shadow-1), var(--shadow-2), none} ∪ inset 开头 ∪
   ^0 0 0 2px（焦点环复合），--shadow-1/2 须为 rgba(0,0,0,…) 黑基，paper 块须有
   --shadow-1 亮色覆盖（缺了浅色皮肤会拿到纯黑 0.5 重阴影）；组三「描边一档」——0 处
   方向边或全边宽度 ≥3px（放行 6 处 solid transparent 滚动条 thumb 内边距技巧）、0 处
   全边 border: 2px，方向边 2px 即标记条合法。复用既有 CSS_NC/cssVar/themeBlock 助手。
3. `index.html`（67 处单处替换，保持纯 LF）：业务资源 `?v=20261031e` → `?v=20261101a`
   （style.css 内容变更触发缓存失效，字典序单调递增；vendor 语义化版本不动；非 v= 改动
   实测 0 行）。

**与方案的三处偏差裁定（留痕）**：
- aurora `.pm-card:hover` 的彩色辉光 `0 12px 34px rgba(90,110,255,0.25)` 收敛为中性
  `var(--shadow-1)`——彩色辉光属第二套海拔语言，玻璃渐变底色身份保留，海拔归令牌；
- `.pm-out-bar > i` 的 `0 0 10px rgba(var(--glow-1), 0.25)` 辉光**删除**而非收敛——oled
  皮肤本就覆盖为 none，这是跨皮肤不一致的装饰噪声（删一致性噪声优于保留一份字面量），
  oled 的 `box-shadow: none` 覆盖随之成为无害冗余保留；
- 描边实测 14 处而非方案预估 13 处：`clay .pm-card` 左条 3px（L2188）在方案清单外，
  同属「标记条统一 2px」口径（基础 .pm-card 左竖条即 2px），一并收敛；radius 实测红清单
  105 处而非方案预估约 80 处（方案按声明行计数、红清单按选择器计数，两口径之差），逐条
  对照零意外项。

### 测试
- 测试先行：施工前 `node _test/tokens.test.mjs` = **44 passed / 3 failed**（三组新断言
  先红，失败清单 radius 105 + shadow 11 + 描边 14，与预案逐条对照零意外项）。
- 施工后单跑：`node _test/tokens.test.mjs` = **47 passed / 0 failed**（44→47）。
- 全量：`node _test/run-all.mjs --offline` = 共 43 组（离线 37 / 实网 6），本次执行
  37 组、跳过 6 组，**✓ 全部测试组通过**。
- 行尾核验（逐文件实跑字节统计）：style.css CR=2620 LF=2620 全 CRLF（裸 LF=0）、
  index.html CR=0 纯 LF、tokens.test.mjs CR=0 纯 LF、两份 docs CR=0 纯 LF。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤收敛一致生效（paper 方角 0
  与 50% 圆身份、aurora 玻璃渐变、四套几何皮肤 `* { border-radius: 0 !important }` 身份
  层全部保留，swiss/clay/memphis 选中豁免与 ev-dot 圆点守卫自然回归）；无成交量展示/
  无 Polymarket 字样/无省略号问句；纯形状重构不涉买卖建议；零 JS 改动（无 setInterval、
  零新增取数零 API key，红线 5/6 无涉）；不新增任何动画（存量 box-shadow transition
  原样，未新碰）；?v= 单调递增至 20261101a；无开源代码移植；未做实网验证（红线 11）；
  未 git commit / push。
- 8 套皮肤形状实拍观感属视觉冒烟，留给人工轮次；本轮以结构断言 + 静态守卫为完成判定。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0★ 第 3 条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 01:51 · P0★ 间距骨架①：七档 --sp 令牌进 tokens + 6/10px 两大离格值 172 处清零（14px 与字号音阶留后续轮，条目不勾）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第一轮：七档 --sp-4/8/12/16/24/32/48 进 tokens，清掉最大两档离格值 6px/10px（实测 172 处/158 行）。条目**未完**——剩余离格 226 处（实测：14px×58、5px×36、7px×25、18px×22、20px×21、9px×21、28px×8、44px×6、其余零星 29 处）与字号音阶五档（12/13/15/20/32，大数字 30/34/56px 属展示层需裁定豁免口径）留后续轮，TV-ROADMAP 本条**不勾选**。混行尾红线「只小段编辑」零偏离：全程 Edit 声明片段级编辑，无脚本改写。

### 改动
1. `css/style.css`（162+/158-，全 CRLF 保持）：① --shadow-2 与 --topbar-h 之间插入间距令牌块（注释两行：七档定义 + 映射规则「就近取档、平局向上」，字号音阶五档由后续轮引入不混入本组；一行：--sp-4…48 七档声明，16/24/32/48 骨架先行允许零消费）；② 文件头注释形状令牌行后补「· 间距七档 --sp-4…48（4/8/12/16/24/32/48）」；③ 158 行内 172 处间距声明值替换：6px→var(--sp-8)、10px→var(--sp-12)，共 60 种声明形态、Edit replace_all 按声明片段+分号锚定逐组替换——同行 width/height/left/font-size/transform 等非间距声明从片段粒度上构造性零接触。非间距 6/10px 声明实测 115 处（方案口径 116，差 1 属基线统计口径差）逐字节未动。
2. `index.html`（67/67）：业务资源 ?v=20261101a → ?v=20261101b（当日字母序单调递增；vendor 语义化版本不动；纯 LF 保持）。已知内联残留照旧留痕：index.html:713 margin-top:6px、js/app.js:2891 margin-top:10px（不在断言域，后续轮随对应文件清理）。
3. `_test/tokens.test.mjs`（+56，测试先行）：组一「间距七档令牌」——七档经既有 cssVar 读取、值逐个 equal '4px'…'48px'；组二「间距离格值渐进清零 + 令牌真实消费」——断言 A 按 `[^{}]+\{[^{}]*\}` 切规则扫 margin/padding/gap 家族（含方向/逻辑变体）声明，禁用集 ['6','10']（注释写明**只增不减**、14px×58 由后续轮加入）命中必为 0，违规输出「选择器 → 声明」清单，<4px 发丝级豁免（实测 2px×32、3px×15、1px×13）；断言 B var(--sp- ≥150 防令牌摆设化（实际 172）。
4. 施工后实测口径：间距声明 px 字面量共 536 处——在档未接线 250（8px×84、12px×74、16px×41、4px×40、24px×8、32px×3，后续轮接线）、发丝级 60、离格 226（与 398−172=226 核对一致）。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **47 passed / 2 failed**（恰为两组新断言；组二违规清单收口 "172 !== 0"，与基线枚举一致、零意外项）。
- 施工后单跑：`node _test/tokens.test.mjs` → **49 passed / 0 failed**。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（run-all.mjs 零改动）。
- Q1 硬护栏（只读审计脚本，`git show HEAD:css/style.css` 基线 vs 工作区）：间距声明 6/10px 残留 **0**；非间距声明 115 条多重集逐字节一致（仅剥 \r）；CSS 去注释后 var(--sp- 恰 **172** 次。
- 行尾字节：style.css CR=LF=2624、裸 LF=0（全 CRLF，+4 行=令牌块 3+头注释 1）；index.html / tokens.test.mjs / OPTIMIZER-LOG.md CR=0（纯 LF）。`git diff --numstat`：style.css 162/158、index.html 67/67、tokens.test.mjs +56——增删合计 ≈545 行，两口径均 ≤600。
- 未做实网验证（红线 11）；未 git commit / push。零 JS 改动、零新增取数零 API key、零新增动画与调度；8 套皮肤块内 6/10px 消费点同规则替换、身份层零触碰；无成交量展示/无 Polymarket 字样/无省略号问句/纯间距重构不涉买卖建议。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条未完成不勾选，文件零改动）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 02:36 · P0★ 间距骨架②：离格间距全量清零进七档 --sp 令牌、禁用集补至穷尽、两处内联残留清账（字号音阶留下一轮，条目不勾）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第二轮（①轮留痕"14px 与字号音阶留后续轮"的自然续作）：把剩余全部离格间距清零并钉死断言。实测口径（与断言 A 同口径枚举脚本）：离格正值（≥4px、非七档）共 **206 处声明 / 226 个离格 px 点 / 113 种声明形态**（方案口径"238 行"为含注释行的粗统计，形态数 113 与方案一致；按值 14×58、5×36、7×25、18×22、20×21、9×21、28×8、44×6、余零星）。条目**未完**——字号音阶五档（12/13/15/20/32，10px×86、11px×87 为大头，约 230 处）属小节头/标签全站字号语义变更，按①轮先例独立成轮（③），TV-ROADMAP 本条**不勾选**。混行尾红线零偏离：全程 Edit replace_all 声明片段级编辑，无脚本改写、无整文件重写。

### 改动
1. `css/style.css`（196+/196-，全 CRLF 保持、总行 2624 不变）：① 113 种离格声明形态共 206 处按 **20 组映射**（就近取档、平局向上：5→--sp-4；7/9→--sp-8；11/13→--sp-12；14/15/17/18/19→--sp-16；20/22/26→--sp-24；28/30/34→--sp-32；40/44/56/72→--sp-48）逐片段 replace_all（声明+分号锚定），混声明（如 `padding: var(--sp-12) 14px`）只换离格段、var 段原样；② 边界口径：在档字面量 8/12/16/24/32/48px **不接线**（实测 251 处留后续接线轮）；<4px 发丝级 62 处与负 margin 不动；calc() 内在档 32/24/16px 保留，calc 相关离格点按同映射替换（topbar+tape 偏移 padding 的 28px→--sp-32、72px→--sp-48；page-top margin calc 内 40px→--sp-48；声明含 calc 的 56px/14px 同规则）；③ `column-gap: 40px` 是 `gap: 40px` 的后缀子串——替换串保前缀故语义正确，执行顺序先 column-gap 后 gap；④ 同行 width/height/left/font-size/transform 等非间距声明从片段粒度上构造性零接触。**最强审计**：HEAD 基线做同套 113 形态替换后与工作区逐字节一致（剥 \r 比较）——改动面恰为 113 形态替换、零其他字节变动；CRLF 行数 2624 与 HEAD 一致。
2. `index.html`（68/68，纯 LF 保持）：① 67 处业务资源 ?v=20261101b → ?v=20261101c（当日字母序单调递增；style.css 内容变更触发缓存失效；vendor 语义化版本 4.2.3/3.1.0 等不动）；② L713 内联残留 `margin-top:6px` → `var(--sp-8)`（①轮留痕债，var 经 :root 令牌继承到内联样式生效）。
3. `js/app.js`（1/1，全 CRLF 保持）：L2891 内联字符串 `margin-top:10px` → `var(--sp-12)`（①轮留痕的第二处内联残留，同机制；经 Edit 提交过 PreToolUse 检查）。
4. `_test/tokens.test.mjs`（+20/-9）：组二「间距离格值清零 + 令牌真实消费」——BANNED 从 `['6','10']` 补齐为全量离格档位 22 个（5/6/7/9/10/11/13/14/15/17/18/19/20/22/26/28/30/34/40/44/56/72，**只增不减**纪律不变，骨架①两档原样保留）；断言 B 下限 150→370（实测 398，留 28 余量）；块注释改写：间距部分清零完毕、剩余在档字面量是"接线"问题、字号音阶五档（12/13/15/20/32）明确下一轮处理。组一「七档令牌值不漂」断言原样通过。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **48 passed / 1 failed**（唯一红组即间距组，违规清单收口 "226 !== 0"，与枚举 226 个离格 px 点互证、零意外项）。
- 施工后单跑：`node _test/tokens.test.mjs` → **49 passed / 0 failed**。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**。
- 复扫互证：枚举脚本重扫——113 形态全部未命中、离格违规 0、var(--sp-) 消费 **172→398**（与方案干跑预估一致）、行数不变；内存干跑曾暴露清单解析错列 bug（var 数假降 152），修正后重验通过——干跑作为施工前防线起了作用。
- 行尾字节（node 逐字节）：style.css CRLF=2624/裸LF=0、app.js CRLF=6375/裸LF=0（全 CRLF）；index.html CRLF=0、tokens.test.mjs CRLF=0、OPTIMIZER-LOG.md CRLF=0（纯 LF）。`git diff --numstat`：style.css 196/196、index.html 68/68、app.js 1/1、tokens.test +20/-9，增删合计 ≈559 行。
- 未做实网验证（红线 11）；未 git commit / push；视觉冒烟（间距收紧后 8 套皮肤实拍）留人工轮次。红线核对：零 JS 取数逻辑、零新增动画与调度（纯间距重构）；8 套皮肤无 --sp-* 覆盖（grep 全文件仅 style.css:90 :root 一处定义），映射在各皮肤块内一致生效、身份层零触碰；无成交量展示/无 Polymarket 字样/无省略号问句/不涉买卖建议；无开源代码移植。

### 涉及文件
- `css/style.css`、`index.html`、`js/app.js`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条未完成不勾选——字号音阶五档留下一轮，文件零改动）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 03:50 · P0★ 间距骨架③a：--fs 五档令牌进 tokens、13/15/20/32 组 67 处归档接线（展示层大数字归 32 档、2 条冗余移动覆盖删除）、12 档过渡白名单钉断言（12 档 284 处留 ③b/③c，条目不勾）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第三轮。按评审唯一拦阻点拆轮：既定预算口径为 git numstat 增删合计（①轮留痕「≈545 两口径均 ≤600」、②轮「≈559」），原方案 style.css 353 处修改在该口径记 ≈706、总计 ≈930+ 超限五成，拆为 ③a/③b/③c 三轮——本轮 **③a = 令牌 + 测试 + 13/15/20/32 组 67 处归档接线（含展示层大数字裁定与在档 13×32/15×4/20×2 接线）+ 2 条覆盖删除 + font 简写清账**。实测基线（施工前 grep `font-size:[^;]*;` 全量枚举）：声明 354 处 = 本轮 67 处换算（12.5×8、13×32、14×6、15×4、16×1、17×2、18×3[总 4 处、另 1 处删除]、19×2、20×2、21×1、22×2、24×1、30×1、34×1、56×1）+ 12 档 284 处（8/9/9.5/10/10.5/11/11.5/12px，10px×86、11px×87 为大头）+ `'0'`×1 + 删除 2，逐项核对零意外；`font-size:` 无空格形态/`!important`/`@font-face` 均 0 处、css/ 目录仅 style.css，replace_all 锚形态安全。条目**未完**——12 档 284 处由 ③b/③c 分两半接线、spacing 在档字面量接线同留后续轮，TV-ROADMAP 本条**不勾选**。

### 改动
1. `css/style.css`（79+/72−，全 CRLF 保持、净 +7 行 2624→2631，全程 Edit 声明片段级小段编辑、零整文件重写）：① :root 在 --sp-48 声明行后插入字号五档令牌块（注释五行：五档定义 +「就近取档、平局向上」映射规则 + Floor=12 可读性下限 + 展示层大数字一并归 --fs-32/--fs-20 的裁定——不再保留 30/34/56 的第三极，音阶落差由字重与 tabular-nums 承担）；文件头部令牌注释行补「· 字号五档 --fs-12/13/15/20/32（12/13/15/20/32px）」；另两处注释一致性顺手账：L6 设计语言行「30-56px mono 主数字」→「32px」（56→32 落地后原文失实）、L89 间距组注释「字号音阶五档由后续轮引入」→「见下一组 --fs-* 令牌」（本组落地后原文失实），均注释级零行为变更。② 15 组值级 replace_all（`"font-size: Npx;"` 声明+分号锚）共 **67 处归档**：12.5/13→--fs-13（40）、14/15/16/17→--fs-15（13）、18/19/20/21/22/24→--fs-20（11）、30/34/56→--fs-32（3）；展示层大数字裁定：thermo-score 56→32 为本轮最大视觉变量、detail-price 34→32、hero-value 24→var(--fs-20)（L748 @640 覆盖保留收缩，24 就近档即 20）、gcard .hero-value 17→15、wcard .hero-value 22→20、#detailStar 18→20；同行 width/height/letter-spacing 等非字号声明从片段粒度上构造性零接触。③ 删 2 条媒体覆盖（措辞按评审意见纠正）：L768 `.detail-price{font-size:28px}`@640——**不是 no-op**：就近取档 28→32 与基线同值、覆盖冗余故删，删除后移动端价格 28→32 为 **+4px 实质变更**（390px 详情头核算：名 20px≈80px + 价 32px≈125px < 358px 可用宽，不溢出；删除位留两行注释留痕）；L1649 `.wcard .hero-value{font-size:18px}`@860——18→20 与基线同档，真 no-op 冗余删除。两处均服从同一「就近取档」机械规则，不再诉诸单方「防溢出」理由。④ L2592 `.ask::before` 简写 `font: 10px/15px var(--font-mono)` → `font: var(--fs-12)/16px var(--font-mono)`（行高 15→16px 手算补偿，保 ? 在 16×16 圈内居中）。⑤ L2584 `font-size: 0` 保留为唯一永久豁免（.ask 触达区文字隐藏技巧）。施工后重扫：font-size 声明 352 处 = 67 var(--fs-*) + 284 十二档 + `'0'`×1；8 套皮肤无 --fs-* 覆盖（grep 全文件仅 :root 一处定义，与 ②轮 --sp 同查法）；paper/clay .section-title 覆盖令牌化后字号身份语义不变、font-family 规则零触碰。
2. `index.html`（67/67，纯 LF 保持）：业务资源 ?v=20261101c → ?v=20261101d（style.css 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0 等不动）。
3. `_test/tokens.test.mjs`（+61，插入在间距两组之后，测试先行照 ①② 先红后绿纪律）：组一「字号五档令牌」——cssVar 逐个 assert.equal 锁 --fs-12/13/15/20/32 = 12/13/15/20/32px 防漂。组二「font-size 收敛五档·阶段一」——断言 A 照 L814 CSS_NC 切分先例扫全部规则体，font-size 声明值 ∈ var(--fs-12/13/15/20/32) ∪ {'0'} ∪ 十二档过渡白名单 {8px/9px/9.5px/10px/10.5px/11px/11.5px/12px}（注释写明白名单**只减不增**、③b/③c 分两半清零至空），违规输出「选择器 → 声明」清单；断言 B 全文 /font\s*:\s*[\d.]/ = 0（简写带 px 字号防绕过；font-family/font-weight 冒号前有后缀天然不匹配）；断言 C var(--fs- ≥60（实测 68 = 67 声明 + 1 简写，下限留余量）防令牌摆设化。
4. 范围外留痕：worldmap.js:454 内联 font-size:10px 移出本轮、随 ③b 12 档接线（本轮零 JS 改动）；flags.js:48 SVG 绘图属性维持豁免（不在 CSS 断言域）。
5. spacing 在档字面量口径注记：③b 前按断言 A 同口径（CSS_NC 规则体切分 + 间距家族正则）重扫 margin/padding/gap 家族在档字面量 4/8/12/16/24/32/48px = **251 处**（8px×85、4px×40、12px×74、16px×41、24px×8、32px×3），与 ②轮留痕 251 一致；方案手记的「252 vs 250/251 有 ±2 口径漂移」经同口径重枚举证实为粗 grep 口径差、无实质漂移——③b 接线以同口径 251 为准。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **49 passed / 2 failed**（唯二红组即两组新断言；组二断言 A 违规清单 **69 项**收口 "69 !== 0"，与基线枚举 69 处 >12 档 raw——含在档 13×32/15×4/20×2 与待删 28px——逐条对照零意外项；font 简写 1 处（L2592）在组二断言 B，A 清零后可达）。
- 施工后单跑：`node _test/tokens.test.mjs` → **51 passed / 0 failed**（断言 C 实测 var(--fs- 68 次）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（run-all.mjs 零改动）。未做实网验证（红线 11）。
- 行尾字节（node 逐字节）：style.css CRLF=2631/裸LF=0（全 CRLF，净 +7 = 令牌块 6 + 头注释 1 + 删除位注释净 +1 − 删除 1）；index.html、tokens.test.mjs、OPTIMIZER-LOG.md CR=0（纯 LF）。`git diff --numstat`：style.css 79/72、index.html 67/67、tokens.test.mjs 61/0——增删合计 **346 行**（不含留痕文档），两口径均 ≤600（原方案 353 处记 ≈930 超限五成，评审拆轮后达标）。
- 视觉冒烟清单（留人工轮）：① thermo-score 56→32（本轮最大视觉变量）；② detail-price 移动端 28→32（+4px 实质变更，390px 详情头已核算不溢出）；③ .ask 问号 12px/行高 16px 圈内居中（行高 15→16 手算补偿）；④ hero-value 24→20 与 gcard 17→15、wcard 22→20 跨区差异；⑤ 13/15/20 组正文 ±1px 观感（40/13/11 处大面积换档）；⑥ paper/clay .section-title 令牌化后观感。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤令牌 :root 单点定义、无皮肤覆盖；无成交量展示/无 Polymarket 字样/无省略号问句；纯排版收敛不涉买卖建议；零 JS 改动、零新增取数零 API key、无 setInterval、无新增动画；style.css 全程小段编辑保持全 CRLF；?v= 单调递增 20261101d；无开源代码移植。未 git commit / push。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条未完成不勾选——12 档 284 处接线与 spacing 在档接线留后续轮，文件零改动）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 04:22 · P0★ 间距骨架③b：10/11px 字号档 173 处接线归 --fs-12、12 档过渡白名单收窄删两键（剩余 111 处留 ③c，条目不勾）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第四轮，按 ③a 留痕的拆轮计划续作：本轮 **③b = 接线最大的两档 10px×86 + 11px×87 共 173 处 → var(--fs-12)**（就近取档规则下 8~12px 全归 --fs-12，Floor=12px 可读性下限），并把十二档过渡白名单按「只减不增」纪律删掉 10px/11px 两键、断言 C 下限 60→230。实测基线（施工前 node 计数）：style.css `font-size: 10px;` 86 处、`font-size: 11px;` 87 处，全部为「带空格+分号」单一形态（无空格形态 0、注释内残留 0）；var(--fs- 消费 68（剥注释同 68）；JS 内联 1~11px 字号仅 worldmap.js:454 一处（vendor 0 处，flags.js:48 为 SVG 绘图属性不在 CSS 断言域）；worldmap.test.mjs 无字号断言。条目**未完**——剩余 8/9/9.5/10.5/11.5/12px 共 111 处由 ③c 收尾、spacing 在档字面量接线（同口径重扫恰 **251 处**：8px×85、4px×40、12px×74、16px×41、24px×8、32px×3，与 ③a 留痕一致）同留后续轮，TV-ROADMAP 本条**不勾选**。混行尾红线零偏离：全程 Edit replace_all 声明片段级编辑（style.css 仅 2 次），无脚本改写、无整文件重写。

### 改动
1. `_test/tokens.test.mjs`（+17/−12，测试先行照 ①②③a 先红后绿纪律）：① 白名单收窄——ALLOWED 集合删除 '10px' 与 '11px' 两键，余 var(--fs-12/13/15/20/32) ∪ {8px/9px/9.5px/10.5px/11.5px/12px} ∪ {'0'} 共 12 键；② 块注释「进度」段改写：③a 清零 >12 档 67 处 + font 简写清账、③b（本轮）接线 173 处 → var(--fs-12)、剩余 111 处（12px×86 为纯令牌改名，其余 25 处为升档）由 ③c 收尾；③ 测试名改「font-size 收敛五档·阶段二（10/11px 档接线清零、font 简写清零、var(--fs-) ≥230）」；④ 断言 C 下限 60→230（注释写明实测 241 = ③a 68 + ③b 173）防令牌摆设化。
2. `css/style.css`（173/173，全 CRLF 保持、总行 2631 不变，仅 2 次 Edit replace_all 片段级）：`font-size: 10px;` → `font-size: var(--fs-12);`（86 处）、`font-size: 11px;` → `font-size: var(--fs-12);`（87 处）——声明+分号锚定，同行 font-family/font-weight/color 等声明从片段粒度上构造性零接触；无新令牌、无皮肤块改动（--fs-* 定义全文件恰 5 处、全部在 :root 单点，8 套皮肤一致生效）；无任何动画/transition 触碰。
3. `js/worldmap.js`（1/1，全 CRLF 保持）：L454 事件浮层内联模板串 `font-size:10px;` → `font-size:var(--fs-12);`——CSS 自定义属性经 :root 继承在内联样式生效（②轮 app.js:2891 margin-top:10px→var(--sp-12) 同机制先例）；事件浮层小字 10→12px 升档与全站 Floor 一致。
4. `index.html`（67/67，纯 LF 保持）：全部 67 处业务资源 ?v=20261101d → ?v=20261101e（style.css 与 worldmap.js 内容均变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0 等不动，`20261101d` 残留 0）。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **50 passed / 1 failed**（唯一红组即字号组，违规清单收口 "173 !== 0"，与基线枚举 10px×86+11px×87 逐条对照零意外项）。
- 施工后单跑：`node _test/tokens.test.mjs` → **51 passed / 0 failed**（断言 C 实测 var(--fs- 241 次）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（run-all.mjs 零改动）。未做实网验证（红线 11）。
- 复扫互证（node 计数）：接线后 CSS 去注释内 `font-size: 10px;`/`font-size: 11px;` 各恰 **0**、var(--fs- 消费恰 **241**（=240 声明 + 1 .ask::before 简写）、font-size 声明总数 **352**（=var(--fs-12) 173 + 其余 179 = 67 令牌 + 111 白名单余量 + 1 '0'）；断言 A 同口径分布复核：var(--fs-13)×40/var(--fs-15)×13/var(--fs-20)×11/var(--fs-32)×3、12px×86/9px×6/11.5px×10/10.5px×5/8px×2/9.5px×2、'0'×1——与 ③c 剩余口径 8×2/9×6/9.5×2/10.5×5/11.5×10/12×86=111 完全一致。
- 行尾字节（node 逐字节）：style.css CRLF=2631/裸LF=0（全 CRLF 不变）、worldmap.js CRLF=571/裸LF=0；index.html、tokens.test.mjs、OPTIMIZER-LOG.md CR=0（纯 LF）。`git diff --numstat`：style.css 173/173、index.html 67/67、worldmap.js 1/1、tokens.test.mjs +17/−12——增删合计 **511 行**（不含留痕文档）≤600。
- 视觉冒烟清单（留人工轮）：10/11px→12px 全站小字升档，重点核对窄容器（pill 徽章、行情条、表格列头、hero-cap 大写字距标签）是否换行溢出；8 套皮肤下色令牌不变仅字号变、对比度结论不变；worldmap 事件浮层小字同步 12px。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤 --fs-* :root 单点定义无覆盖；无成交量展示/无 Polymarket 字样/无省略号问句；纯排版收敛不涉买卖建议；零新增取数零 API key、无 setInterval、无新增动画（内联字号变更非动画）；style.css 全程小段编辑保持全 CRLF；?v= 单调递增 20261101e；无开源代码移植、无新增纯函数（接线轮，红线 12 不适用）。未 git commit / push。

### 涉及文件
- `css/style.css`、`index.html`、`js/worldmap.js`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条未完成不勾选——③c 111 处与 spacing 在档 251 处接线留后续轮，文件零改动）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 05:20 · P0★ 间距骨架③c：字号 12 档余量 111 处接线归 --fs-12、过渡白名单清空（spacing 在档 251 处留 ④ 轮，条目不勾）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第五轮，按 ③b 留痕的拆轮计划收尾字号部分：本轮 **③c = 接线剩余 8/9/9.5/10.5/11.5/12px 共 111 处 → var(--fs-12)**（12px×86 为纯令牌改名零视觉变化，其余 25 处升档至 Floor=12），十二档过渡白名单清空、字号音阶五档收敛**全部完成**。实测基线（施工前 node 逐形态枚举）：六形态 raw=去注释逐形态相等——8px×2、9px×6、9.5px×2、10.5px×5、11.5px×10、12px×86 合计 111；无空格形态 0、`!important` 形态 0；font-size 声明总数 352、var(--fs- 消费 241（与 ③b 留痕一致）；注释内零残留。预算拆轮依据同 ③a 评审口径（git numstat 增删合计）：spacing 在档 251 处若并进本轮 style.css 即 362/362≈724 行、总计 ≈888 超限近五成，故 spacing 接线独立成 ④ 轮。条目**未完**——spacing 在档字面量 251 处接线（8px×85、4px×40、12px×74、16px×41、24px×8、32px×3，③a 同口径）留 ④ 轮，'style.css 清 magic number' 未全量达成，TV-ROADMAP 本条**不勾选**、文件零改动。混行尾红线零偏离：style.css 仅 6 次 Edit replace_all 声明片段级编辑（六锚串互不为子串：9/9.5、10/10.5 均带小数点分隔、声明+分号定界），无脚本改写、无整文件重写。

### 改动
1. `_test/tokens.test.mjs`（+21/−20，纯 LF 保持，测试先行照 ①②③a③b 先红后绿纪律）：① 字号组头注释「进度」段改写：③a 清零 >12 档 67 处 + font 简写清账、③b 接线 173 处、③c（本轮）接线剩余 111 处、白名单清空、五档收敛**全部完成**；font-size:0 豁免机制写明（640px 媒体查询内 0 隐藏文字、::before 以 var(--fs-12)/16px 重绘问号，桌面 9.5→12 接线后与移动端自然对齐）；spacing 在档 251 处留 ④ 轮注记。② 测试名「font-size 收敛五档·阶段二（…≥230）」→「font-size 收敛五档·终（12 档白名单清空、font 简写清零、var(--fs-) ≥340）」。③ 断言 A ALLOWED 集合删除 '8px'/'9px'/'9.5px'/'10.5px'/'11.5px'/'12px' 六键，余 var(--fs-12/13/15/20/32) ∪ {'0'}，失败信息同步改写（raw 档位只许令牌 ∪ {0}，新档位须走评审）。④ 断言 C 下限 230→340（注释写明实测 352 = ③b 241 + ③c 111，留 12 余量）防令牌摆设化。⑤ **方案外连带修复一处**：L649 页头组钉的是字面量正则 `/font-size:\s*12px/`，本轮把基础 h1.page-title 的 12px 接线成 var(--fs-12) 后失配（绿相首跑第二红），放宽为 `/font-size:\s*(12px|var\(--fs-12\))/`——令牌值恰 12px 由字号五档组钉死，两种形态同义接受，断言语义（基础页头必须落在 12px 小节头档）不变、非放松。
2. `css/style.css`（111/111，全 CRLF 保持、总行 2631 不变，仅 6 次 Edit replace_all 声明片段级编辑、零整文件重写）：`font-size: 8px;`（2 处）、`font-size: 9px;`（6 处）、`font-size: 9.5px;`（2 处）、`font-size: 10.5px;`（5 处）、`font-size: 11.5px;`（10 处）、`font-size: 12px;`（86 处）各整体替换为 `font-size: var(--fs-12);`——六种形态全部归 Floor=12 档（就近取档：8/9/9.5/10.5/11.5 距 12 均近于距 13）；声明+分号锚定，同行 font-family/line-height/color/transition 等声明构造性零接触（diff 复核：唯一伴现 transition 行的 transition 声明原样）；无新令牌、无皮肤块改动（--fs-* 定义全文件恰 5 处全在 :root 单点，8 套皮肤一致生效）、无任何 transition/animation 触碰。
3. `index.html`（67/67，纯 LF 保持）：全部 67 处业务资源 ?v=20261101e → ?v=20261101f（style.css 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动，20261101e 残留 0）。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **50 passed / 1 failed**（唯一红组即字号组，违规清单收口 "111 !== 0"，分布 12px×86/11.5×10/10.5×5/9×6/9.5×2/8×2 与基线枚举逐条对照零意外项；page-title 组施工前为绿）。
- 施工后单跑（首跑暴露 ⑤ 连带红）：`node _test/tokens.test.mjs` → 50 passed / 1 failed（第二红即页头组字面量正则失配，见改动 ⑤）；修复后复跑 → **51 passed / 0 failed**（断言 C 实测 var(--fs- 352 ≥ 340）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（run-all.mjs 零改动）。未做实网验证（红线 11）。
- 复扫互证（node 计数）：六形态去注释残留恰 0；font-size 声明总数 352 = var(--fs-五档) 351 + '0'×1；var(--fs- 消费 352；--fs-* 定义点恰 5 处全在 :root。
- 行尾字节（node 逐字节）：style.css CR=2631=LF=2631（全 CRLF、裸 LF=0、总行 2631 不变）；index.html CR=0（纯 LF）；tokens.test.mjs CR=0（纯 LF）。`git diff --numstat`：style.css 111/111、index.html 67/67、tokens.test.mjs 21/20——增删合计 **397 行**（不含留痕文档）≤600。
- 视觉冒烟清单（留人工轮）：25 处升档重点核对 .pm-donut-ct/.pm-donut-cs（8→12 环形图中心数字）、.ask（9.5→12 桌面问号与移动端对齐，15px 圈内 12px 字形不溢出）、9px 徽章组（.qc-flag/.vb-title/.my/.ev-imp/.imp-kind）、11.5px 组（.fq-*/.imp-sum/.pm-out-l/.cmp-corr/.gloss-tip .gt-link）、10.5px 组（.imp-dir/.sr-count/.brk-chg/.ce-link）；12px×86 纯改名零视觉变化；8 套皮肤下仅字号变、色令牌与对比度结论不变。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤 --fs-* :root 单点定义无覆盖；无成交量展示/无 Polymarket 品牌字样新增（diff 内 polymarket 字样均为既有文件路径随版本号 bump）/无省略号问句；纯排版收敛不涉买卖建议；零 JS 改动、零新增取数零 API key、无 setInterval、无新增动画；style.css 全程小段编辑保持全 CRLF；?v= 单调递增 20261101f；无开源代码移植、无新增纯函数（接线轮，红线 12 不适用）。未 git commit / push。附注：Mimosa 提交前扫描报 js/app.js 既有历史风险（ssrf 链等 1 高危）——均为本轮未触碰文件的存量问题，非本轮引入。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条未完成不勾选——spacing 在档 251 处接线留 ④ 轮，文件零改动）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 06:52 · P0★ 间距骨架④a：4/8/12 三档 199 处接线归 --sp、孤儿尾行清账、花括号配平守卫（条目不勾，52 处留 ④b）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第六轮，按评审三点意见修订后的拆轮方案 (a) 执行：本轮 **④a = 接线 4/8/12 三档在档字面量 → var(--sp-4/8/12)** + ae3768e 孤儿尾行清账（配平修复）+ 花括号配平结构守卫。实测基线（施工前 node 逐出现位置精确映射）：4/8/12 三档在档值恰 **199 处 / 67 种声明形态 / 172 个物理行**（方案估 174 行，差 2 属统计口径差——按 px 点逐出现位置映射行号实测 172，不影响预算与验收口径，如实记录）；**calc() 内 ④a 档值恰 0 处**（干跑枚举证实，本轮不碰任何 calc，④b 时把 calc 内 32/24/16px 与同声明裸 16px 一并接线，「原样」自始至终仅指 <4px 发丝级与负值）；var(--sp- 消费 398；CSS_NC 花括配平 1271 '{' vs 1272 '}'（孤儿行含 1 枚 '}'）；发丝级 1/2/3px×60（1px×12、2px×32、3px×16）与负值 margin 恰 2 处（.sr-only `margin: -1px`、.rbar .rb-track > b `margin-left: -3.5px`）。条目**未完**——16/24/32/48 共 52 处（16px×41、24px×8、32px×3、48px×0）留 ④b 收尾，'style.css 清 magic number' 未全量达成，TV-ROADMAP 本条**不勾选**。混行尾红线零偏离：全程 Edit 声明片段级小段编辑（67 次 replace_all + 2 次结构小段编辑），无脚本改写、无整文件重写。

### 改动
1. `css/style.css`（173/174，全 CRLF 保持、总行 2631→2630，仅删 1 行孤儿）：① 孤儿尾行清账先于接线执行——L575 `  padding-bottom: 4px; scrollbar-width: thin; }` 整行删除（ae3768e 2026-10-20 误删 .chain-flow 规则头的残留，评审已核其不进 251/199 口径、删除零行为影响、修复配平 -1）；② L89 令牌注释第 1 行改写：`--sp-16/24/32/48 骨架先行、由后续轮接线` → `④a 已接线 4/8/12 三档；16/24/32/48 共 52 处留 ④b`（注释级零行为变更）；③ 67 种声明形态共 **184 处声明级锚匹配**（一声明多档位如 `padding: 8px 8px 8px 4px` 计 4 个 px 点，合计恰 199 px 点）逐形态 Edit replace_all（声明+分号锚定，身份映射 Npx→var(--sp-N)，值零变化零视觉影响）。锚串安全面（施工前枚举验证）：67 锚串全部以分号定界**互不为子串**；row-gap/column-gap 裸 px 形态零命中；67 锚串在全部注释内零命中；原始空白形态核对零异常（冒号后带空格、无 `!important`、无跨行声明）。混合形态只换 ④a 档段：16/24/32/48 段、发丝级 2px/3px、0、负值、既有 var 段本轮原样（如 `padding: 12px 16px` → `padding: var(--sp-12) 16px`，16px 留 ④b）。**最强审计**：HEAD 基线做同套 67 锚替换 + 删孤儿行 + 改注释后与工作区**逐字节一致**——改动面恰为计划内编辑、零其他字节变动。施工后重扫：规则体内 4/8/12 间距字面量残留 **0**；var(--sp- 消费 **398→597**（=398+199，与方案预期一致；方案干跑的 598 为其正则模拟命中孤儿行的伪影，锚定模拟孤儿行不接线、删行前后均 597）；CSS_NC 花括号 **1271/1271 配平恢复**（全文口径 1272/1272）；--sp-* 定义恰 7 处全在 :root 单点（8 套皮肤零覆盖）。
2. `index.html`（67/67，纯 LF 保持）：全部 67 处业务资源 ?v=20261101f → ?v=20261101g（style.css 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动，20261101f 残留 0）。评审要求裁掉的 4 处内联清账本轮不做、留痕随 ④b 处理：L242/L247 `margin-bottom:32px`、L470 `margin-top:32px`、L802 `margin-top:18px`（HTML 内联不在 CSS 断言域）。
3. `_test/tokens.test.mjs`（43/18，纯 LF 保持，测试先行照 ①②③a③b③c 先红后绿纪律）：① 间距组 BANNED 追加 `'4','8','12'` 三档（注释写明 ④a 接线后三档清零、禁用集仍只增不减、<4px 发丝级 1/2/3px×60 与负值 -1px/-3.5px 两处为永久豁免）；② 断言 B 下限 370→550（注释写明实测 597=398+199、余量 47；④b 接线 52 处后再升至 600/实测预估 649）；③ 组头「进度」注释改写（①②③ 沿革 + ④a 接线 199 处 + 16/24/32/48 共 52 处留 ④b + calc 处置口径）、组一注释「--sp-16/24/32/48 在 ④b 接线前允许零消费」、测试名改「间距离格值清零 + ④a 在档接线（4/8/12 三档清零、var(--sp-) ≥550）」；字号组尾注（原 L860-863）「spacing 在档 251 处留后续 ④ 轮」同步改写为「④a 已接线 4/8/12 三档 199 处，16/24/32/48 共 52 处留 ④b」；④ 新增结构守卫组「CSS 花括号配平」：断言 CSS_NC 中 '{' 与 '}' 计数**相等**（写等式不硬编码——计数随行数演化，配平关系才是不变量），注释记 ae3768e 孤儿尾行教训（孤儿片段被规则切分器静默跳过、其声明从此无人看守，宽松恢复还可能吞掉后续规则）与 ④a 清孤儿后实测（去注释口径 1271 对、全文 1272 对）。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **50 passed / 2 failed**（唯二红组即间距组与配平组；间距组违规清单收口 **"199 !== 0"**、与施工前枚举 199 px 点逐条对照零意外项；配平组收口 **"1271 !== 1272"**——孤儿行的 1 枚 '}'，两处红与干跑预期完全一致）。
- 施工后单跑：`node _test/tokens.test.mjs` → **52 passed / 0 failed**（51→52，新增配平组；断言 B 实测 var(--sp- 597 ≥ 550）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（组数不变，run-all.mjs 零改动）。未做实网验证（红线 11）。
- 复扫互证（node 逐字节）：67 锚替换后工作区与 HEAD 基线模拟**逐字节一致**；规则体内 4/8/12 残留 0；--sp-* 定义恰 7 处全在 :root；style.css CRLF=2630/裸LF=0（全 CRLF，总行 2631→2630 仅孤儿行 -1）；index.html/tokens.test.mjs CR=0（纯 LF）；`?v=20261101g` 恰 67 处、20261101f 残留 0、vendor 四个语义化版本原样。
- `git diff --numstat`：style.css 173/174、index.html 67/67、tokens.test.mjs 43/18——增删合计 **542 行**（不含留痕文档）≤600（方案估 ≈530，同区间；先例 ①545/②559/③b511/③c397）。
- 视觉冒烟清单（留人工轮）：身份映射零视觉变化为本轮主口径（Npx→var(--sp-N) 同值替换），重点仅 8 套皮肤回归 + .chain-flow 展开态（本轮只删孤儿行不恢复规则头，展开态维持现状横条缺失，恢复另立条目）。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤 --sp/--fs 均 :root 单点定义零覆盖；无 JS 逻辑改动、无 setInterval、无新增动画、零新增取数零 API key；无成交量展示/无 Polymarket 字样/无省略号问句；纯排版接线不涉买卖建议；style.css 全程声明片段级编辑无整文件重写、实施后逐字节复核全 CRLF（裸 LF=0）。未 git commit / push。

### 留痕
- **④b 计划**（收尾轮）：接线 16/24/32/48 共 52 处（约 37-40 行）+ calc 内 32/24/16px 与同声明裸 16px 共 3 条一并接线（`calc(var(--topbar-h)+var(--tape-h)+32px)` 等）+ index.html 4 处内联清账（L242/L247/L470/L802）+ bump 20261101h + 断言 B 550→600（实测预估 649）+ BANNED 补四档 + 勾选 TV-ROADMAP 条目，预估 ≈250 行余量足。
- **.chain-flow 回归登记**：ae3768e（2026-10-20）误删 `.chain-flow { display: flex; align-items: stretch; gap: 6px; overflow-x: auto;` 规则头，展开态弹性布局失效——app.js:4005 仍产出该容器、.link-node（flex: 1 1 0）/​.chain-arrow（flex-shrink: 0）弹性子项属性落空；孤儿尾行已由本轮清账删除（配平恢复），规则头恢复需视觉轮实测横条 vs 竖排，已按评审建议登记为 TV-ROADMAP P0★ 新条目（防仅 LOG 留痕沉底）。
- **预算实测数**：542 行 ≤600；④a 三档 199 处（8px×85、12px×74、4px×40）+ ④b 余量 52 处（16px×41、24px×8、32px×3）= 251 与 ②③a 留痕口径一致。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（本条不勾选——16/24/32/48 共 52 处留 ④b；新增 .chain-flow 恢复条目）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 07:35 · P0★ 间距骨架④b——16/24/32/48 共 52 处接线归 --sp、calc 三条与 index.html 内联清账、chain-flow 规则头恢复（间距骨架条目勾选）

### 目标
TV-ROADMAP P0★ 第 4 条「间距 8px 骨架」渐进施工第七轮（收尾），按 ④a 留痕的 ④b 计划执行，并按「小项可合并 2-3 个」指令合并同小节小项「产业链展开态 .chain-flow 规则头恢复」：本轮 **④b = 接线 16/24/32/48 共 52 处（16px×41、24px×8、32px×3，含 calc() 内 32/24/16px 与同声明裸 16px——④a「不碰 calc」的例外到期）+ index.html 4 处内联清账（L242/L247/L470/L802）+ .chain-flow 规则头插回（ae3768e^ L432-433 原状逐字恢复，仅 gap 6px→--sp-8、padding-bottom 4px→--sp-4 按②轮映射令牌化）+ 断言 B 550→600 + BANNED 补四档**。实测基线（施工前断言域同口径枚举）：48 种声明形态 / 49 处声明 / **52 个 px 点**（16px×41 + 24px×8 + 32px×3，48px×0），与方案 52 点总数逐项吻合（方案逐形态计数与"约 28 种声明锚"为粗口径，实测 48 形态如实按枚举接线）；31 锚串经施工前验证：互不为子串、注释零命中、无空格/`!important` 变体零命中。发丝级 1/2/3px×60 与负值 -1px/-3.5px 两处为永久豁免不动。两小项完成后 P0★ 尚余「暗色皮肤对比度修复」「移动端修急」两条未勾，不构成里程碑。混行尾红线零偏离：全程 Edit 声明片段级小段编辑（31 次 replace_all/单点替换 + 1 次双行插入 + 1 次注释行收账），无脚本改写、无整文件重写。

### 改动
1. `_test/tokens.test.mjs`（52/16，纯 LF 保持，测试先行照 ①②③a③b③c④a 先红后绿纪律）：① 间距组 BANNED 追加 `'16','24','32','48'` 四档（注释写明 ④b 接线后清零、禁用集仍只增不减、永久豁免为发丝级 1/2/3px×60 与负值两处合计 62——方案手记"发丝级×62"系含负值的合计口径，按实测分列）；② 断言 B 下限 550→600（注释写明实测 651=597+52+2，含 .chain-flow 恢复的 2 处令牌消费；**方案干跑预估 649 漏计 chain-flow 的 2 处**，如实按实测记）；③ 测试名改「间距离格值清零 + ④b 在档接线（16/24/32/48 清零、calc 内一并接线、var(--sp-) ≥600）」、组头「进度」注释改写为 ④b 收尾完成/条目可勾选/calc 口径收账，并更正上一版组头笔误「禁用集只减不增」→「只增不减」（注释级）；④ 七档令牌组注释「--sp-16/24/32/48 在 ④b 接线前允许零消费」改写为已接线；⑤ 新增结构守卫组「.chain-flow 规则头恢复守卫」**两个 test()**：(a) CSS_NC 必须存在选择器恰为 `.chain-flow` 的规则、规则体含 display: flex / align-items: stretch / overflow-x: auto / gap: var(--sp-8)（防再次静默误删——ae3768e 事故形态：规则头被删、孤儿尾行残留、花括号配平破裂，配平守卫防结构破裂、本组防规则缺失）；(b) js/app.js 必须仍产出 `class="chain-flow"` 容器（照 drawHideV1 跨文件守卫先例——容器消失则 CSS 规则成死代码无人察觉；红相 (b) 即绿，与方案红相「52 passed / 2 failed」互证）。
2. `css/style.css`（49/47，全 CRLF 保持、总行 2630→2632，仅 chain-flow +2 行）：① 31 锚 49 处声明 52 px 点身份映射 Npx→var(--sp-N)、值零变化零视觉影响（calc 三条：.main 基础 32px→var(--sp-32)、.main @640 24px→var(--sp-24) 且同声明裸 16px→var(--sp-16)、.gloss-tip 两处媒体覆盖 16px→var(--sp-16)；混合声明只换离格段、既有 var 段与 0 原样）；② L575 前产业链注释块与 .link-node 之间插回 `.chain-flow { display: flex; align-items: stretch; gap: var(--sp-8); overflow-x: auto;\r\n  padding-bottom: var(--sp-4); scrollbar-width: thin; }`（ae3768e^ L432-433 原状逐字恢复、仅两处按②轮映射令牌化；横条+overflow-x 滚动即 ae3768e 前长期原行为，竖排改版属后续视觉轮议题；零新增动画/transition）；③ :root 间距令牌注释「④a 已接线 4/8/12 三档；16/24/32/48 共 52 处留 ④b」→「④b 已全量接线」（注释一致性顺手账，照 ③a 先例；方案未列此项，+1/−1 如实记）。
3. `index.html`（71/71，纯 LF 保持）：① 4 处内联清账（④a 留痕债）：L242/L247 `margin-bottom:32px`→`var(--sp-32)`、L470 `margin-top:32px`→`var(--sp-32)`、L802 `margin-top:18px`→`var(--sp-16)`（18 离格按②轮映射 14/15/17/18/19→16；var 经 :root 令牌继承到内联样式生效，②轮 app.js:2891、③b 轮 worldmap.js:454 同机制先例）；② 全部 67 处业务资源 ?v=20261101g→?v=20261101h（style.css 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动，20261101g 残留 0）。
4. `docs/TV-ROADMAP.md`：勾选两条——P0★「间距 8px 骨架」（④a+④b 全量达成：七档令牌、spacing 魔法数清零——发丝级与负值按断言域永久豁免、字号五档、index.html 内联清账）与「产业链展开态 .chain-flow 规则头恢复」（条目文字不动，勾选依据=离线测试全绿+守卫钉死；视觉冒烟按完成判定留人工轮）。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **52 passed / 2 failed**（与方案预估逐字一致；唯二红组即间距组与 chain-flow CSS 守卫，间距组违规清单收口 **"52 !== 0"**、与施工前枚举 52 px 点逐条对照零意外项；app.js 容器守卫红相即绿）。
- 施工后单跑：`node _test/tokens.test.mjs` → **54 passed / 0 failed**（52→54；方案写 53 为算术口径差——守卫组实为 (a)(b) 两个 test()，红相 52/2 恰与两 test 结构互证；断言 B 实测 var(--sp- 651 ≥ 600）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（run-all.mjs 零改动）。未做实网验证（红线 11）。
- 复扫互证（node 脚本，与测试同口径）：规则体内 ≥4px 间距字面量残留恰 **0**（发丝级 1×13 含 -1px、2×32、3×16、3.5×1 原样）；calc 内 ≥4px 残留 **0**；var(--sp-) 消费 **597→651**；--sp-* 定义恰 **7** 处全在 :root（8 套皮肤零覆盖）；CSS_NC 花括号 **1272/1272 配平**（插入为完整规则 +1/+1）。
- 最强审计（④a 同款）：`git show HEAD:css/style.css` 基线做同套 31 锚替换（模拟命中 49 处声明）+ :root 注释改写 + chain-flow 插入后，与工作区**逐字节一致**（剥 \r 比较——HEAD blob 纯 LF、工作区全 CRLF 系 core.autocrlf=true 检出转换，git diff/numstat 均按归一化内容计算，②轮「剥 \r 比较」同口径），证明改动面恰为计划内编辑、零其他字节变动。
- 行尾核验（node 逐字节）：style.css CRLF=2632/裸 LF=0/裸 CR=0（全 CRLF，+2 行）；index.html CR=0 纯 LF；tokens.test.mjs CR=0 纯 LF；TV-ROADMAP.md CR=0 纯 LF。`git diff --numstat`：style.css 49/47、index.html 71/71、tokens.test.mjs 52/16——增删合计 **306 行** ≤600（方案估 ≈281，同区间；先例 ①545/②559/③b511/③c397/④a542）。
- `?v=` 守卫：20261101h 恰 67 处、20261101g 残留 0、vendor 四个语义化版本原样（tokens.test 既有守卫自然回归）。
- 视觉冒烟清单（留人工轮）：.chain-flow 展开态横条在 8 套皮肤下的观感与横向滚动；4/8→16px 升档的两处内联（selftest 折叠头 margin-top 18→16、moodPanel 底距 32px 令牌化同值）。其余 49 处声明为身份映射零视觉变化。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤 --sp/--fs 均 :root 单点定义零覆盖；无成交量展示/无 Polymarket 品牌字样新增（diff 内 polymarket 字样均为既有文件路径随版本号 bump）/无省略号问句；纯排版接线与布局恢复不涉买卖建议；零 JS 逻辑改动、无 setInterval、零新增动画与调度、零新增取数零 API key；style.css 全程 Edit 小段编辑、实施后逐字节复核全 CRLF（裸 LF=0）；?v= 单调递增 20261101h；无开源代码移植、无新增纯函数（接线轮，红线 12 不适用）。未 git commit / push。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0★「间距 8px 骨架」与「产业链展开态 .chain-flow 规则头恢复」两条）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 08:37 · P0★ 暗色对比度修复 + 移动端修急——暗色灰阶提亮/黑影禁用改 1px 描边、简报带堆叠级联序修复、顶栏搜索占中（P0★ 小节收官里程碑）

### 目标
TV-ROADMAP P0★ 最后两条合并施工（「小项可合并」）：①「暗色皮肤对比度修复」——UI-AUDIT 病灶五（OLED 纯黑下对比度塌：阴影在纯黑上不可见、卡片失边界、灰字约 3:1）；②「移动端修急」——病灶六（390px 情绪条行溢出"3 涨"数字被裁、顶栏拥挤）。两条完成即 P0★ 7 条全勾 = 小节收官里程碑。施工前 node 实算定位两处病根：**暗色三套（:root/aurora/oled）--text-faint 对最差表面仅 2.75~2.98:1**（.brief-c 计数/图例刻度等信息性文字正用它，旧注释"仅装饰符号不承载信息"不成立）；**--border rgba alpha 0.06~0.10 合成后对 --bg 仅 1.10~1.15:1**（卡片边界形同不存在）；**--shadow-1 rgba(0,0,0,0.5) 黑影叠 #0a0a0b/#000 底 1:1 不可见**。**移动端修急的病根不是缺规则而是级联序事故**——窄屏堆叠规则（grid-template-columns: 1fr 等）写在文件前部首个 640px 媒体块（红相实测 index 37865），被文件更后位置的 .brief-row/.brief-v 基础规则（index 87404、同特异性后者胜）静默覆盖，三列网格 170+140+间距已 326px、390px 屏可用 ~358px、第三列 brief-v 只剩十几像素。混行尾红线零偏离：style.css 全程 Edit 片段级小段编辑（14 次替换/插入），无脚本改写、无整文件重写。

### 改动
1. `_test/tokens.test.mjs`（126/9，纯 LF 保持，测试先行先红后绿）：① 「阴影两档令牌」组尾改写：:root --shadow-1/2 断言由 rgba(0,0,0,…) 黑基改为 **=== 'none'**（暗色禁阴影）；5 套浅色皮肤（swiss/paper/bauhaus/clay/memphis）块 themeVar('shadow-1') 必须存在且含 rgba（浅色亮影承接海拔）；aurora/oled 两块不得覆写 shadow 令牌（继承 none）；组内 box-shadow 声明白名单断言原样保留；测试名同步改写。② 新增组「暗色 3 套文字灰阶对全部四表面 ≥4.5:1」：[':root','aurora','oled'] × ['text-secondary','text-tertiary','text-faint'] 经 themeVarOrRoot 取值，对 bg/bg-elevated/bg-card/bg-hover 用既有 contrast() 实算 ≥4.5（红相：faint 2.98 先红钉住）。③ 新增组「暗色 1px 描边可见度」：新增 rgbaOver 合成助手（rgba 前景按 alpha 合成到 bg 再算——描边是半透明色，直接拿 rgba 值算对比度会失真），--border 合成后 ≥1.25:1、--border-hover ≥1.7:1（红相：:root 1.15 先红）。④ 新增组「移动端修急：简报带堆叠级联序 + 顶栏搜索占中」：CSS_NC 中 '.brief-row { grid-template-columns: 1fr' 的位置必须 **>** '.brief-row { display: grid' 的位置（级联序守卫——本轮事故形态钉死，红相 37865 < 87404）；.brief-v white-space:normal、.logo span 缩图标存在；.topbar-actions { flex: 1 与 .search-wrap { flex: 1、.search-input width:100% 锚定在 .topbar-actions 所在媒体块内断言（**方案偏差修正**：全站已有 `.cmp-search .search-input { width: 100%; }`（css/style.css:1395），按方案原文做全局子串断言会恒绿误判已修，故收窄到媒体块作用域并补 138px 定宽清零断言）。
2. `css/style.css`（39/18，全 CRLF 保持、总行 2632→2653，14 次 Edit 片段级）：① :root 灰阶提亮（原地改值）：--text-secondary #9a9aa2→#b4b4bc、--text-tertiary #808088→#a0a0a8、--text-faint #5c5c63→#8a8a92，faint 行尾注释改写（.brief-c 计数/图例刻度等信息性文字也用它、已提亮至 ≥4.5:1、浅色皮肤块各自覆写不受影响）；② :root --shadow-1/--shadow-2 值改 none，注释块改写（暗色 3 套一律禁阴影、卡片边界交给 1px 描边、浅色亮影由皮肤块承接；**方案偏差修正**：方案注释稿称"--shadow-2 现无消费者"，实查 --shadow-2 消费者恰有 aurora 玻璃面板三处（.section L2021/.pm-sec L2076/.pm-overview L2085），注释按实情写"消费者仅 aurora 三处、暗色下同样解析为 none、保留令牌位"——方案该句为不实陈述，不照抄）；③ :root --border 0.07→0.15、--border-hover 0.16→0.26；④ aurora 块灰阶 #9aa2b8→#aeb7cf、#7e86a0→#96a0bc、#5a6178→#7e88a6、--border 0.10→0.17、--border-hover 0.22→0.32；⑤ oled 块 --border 0.06→0.15、--border-hover 0.14→0.26（灰阶继承 :root 不覆写）；⑥ 4 套浅色皮肤块各 +1 行 --shadow-1 亮影（swiss rgba(17,17,17,0.16)/bauhaus rgba(26,26,26,0.16)/clay rgba(43,42,38,0.14)/memphis rgba(24,24,26,0.16)，均 0 8px 24px 形态；paper 已有不动）；⑦ 简报带级联序修复：删首个 640px 媒体块内死规则（注释+3 条，留指针注释），在 .brief-v b.lead.down 之后、wgrid 注释之前插入 @media (max-width:640px) 堆叠块（.brief-row 1fr / .brief-bar 100% / .brief-v normal）+ 中文注释说明必须位于基础规则之后；⑧ 顶栏重排：.topbar-actions margin-left:auto→flex:1 + margin-left:var(--sp-16) + min-width:0，新增 .search-wrap{flex:1;min-width:0;}、.search-input 138px→100%，logo 规则上方补重排注释。所有 box-shadow:var(--shadow-1/2) 消费者（ma-menu:943、alert-panel:1810、ofl-toast:1849、pm-card:hover:2010、aurora 玻璃面板 .section:2042/.pm-sec:2097/.pm-overview:2106、paper pm-card:hover:2084、gloss-tip:2526）声明原样、暗色下解析为 none，pm-card:hover 保留 transform 浮起 + border-color 反馈；js/*.js 零改动（grep 确认无 box-shadow/灰阶硬编码消费）。
3. `index.html`（67/67，纯 LF 保持）：全部 67 处业务资源 ?v=20261101h→?v=20261101i（style.css 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动，20261101h 残留 0）。
4. `docs/TV-ROADMAP.md`：勾选 P0★ 上述两条（条目文字不动）。至此 P0★ 7 条全勾 = 小节收官里程碑。

### 测试
- 测试先行红相：`node _test/tokens.test.mjs` → **53 passed / 4 failed**（唯四红组即阴影组/暗色灰阶组/描边可见度组/移动端级联序组，红项与施工前 node 实算预判逐一对照零意外：阴影 s1=rgba(0,0,0,0.5)≠none、faint 2.98<4.5、:root --border 合成 1.15<1.25、堆叠 37865<87404）。
- 施工后单跑：`node _test/tokens.test.mjs` → **57 passed / 0 failed**（53→57 新增 3 组 + 阴影组改写；方案预估 51→55 为基数口径差，红相 53/4 与四 test 结构互证）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（基线本轮施工前实测同 37 组全绿，run-all.mjs 零改动）。未做实网验证（红线 11）。
- 对比度实算（node，WCAG 相对亮度公式，施工前预验 + 测试组全量钉死）：暗色灰阶新值对最差表面——:root 8.85/7.02/5.32、oled（继承 :root）9.08/7.21/5.46、aurora 8.53/6.56/4.86，全部 ≥4.5:1（旧值 2.75~2.98）；描边合成后 :root 1.47/2.22、aurora 1.30/1.81、oled 1.39/2.10，全部 ≥1.25/≥1.7（旧值 1.10~1.15/1.35~1.53）。方案给出的 aurora 4.86 与 :root/oled 各值实算吻合；方案旧值口径 6.64/4.73/2.80 与本轮实算 6.52/4.65/2.75 为表面集合口径差（四表面 vs 三表面），新值与阈值判定不受影响，如实记录。
- 行尾核验（node 逐字节）：style.css CRLF=2653/裸 LF=0（全 CRLF，+21 行）；index.html CR=0 纯 LF；tokens.test.mjs CR=0 纯 LF；TV-ROADMAP.md/OPTIMIZER-LOG.md CR=0 纯 LF。`git diff --numstat`：tokens.test.mjs 126/9、style.css 39/18、index.html 67/67——增删合计 **326 行** ≤600（方案估 ≈300，同区间）。
- `?v=` 守卫：20261101i 恰 67 处、20261101h 残留 0、vendor 四个语义化版本原样。
- 视觉冒烟清单（留人工轮）：暗色 3 套（终端黑/极光/纯黑）的灰阶观感与卡片 1px 边界清晰度、4 套浅色悬停浮起阴影变轻（0.5→0.14~0.16 alpha）、390px 简报带三行堆叠（标签/分布条/数字，"3 涨"完整可读）、顶栏搜索占中后的第一行观感与触控目标宽度。
- 红线核对：全中文注释；分区卡片+折叠布局零改动；8 套皮肤全兼容（浅色 5 套仅 +1 行亮影、身份层零触碰；暗色 3 套灰阶/描边/阴影经测试组逐表面全量实算）；无成交量展示/无 Polymarket 字样/无省略号问句；纯视觉与排版修复不涉买卖建议；零 JS 改动、零新增取数零 API key、无 setInterval、无新增动画（纯静态属性变更）；style.css 全程片段级编辑实施后逐字节复核全 CRLF（裸 LF=0）；?v= 单调递增 20261101i。未 git commit / push。

### 涉及文件
- `css/style.css`、`index.html`
- `_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0★「暗色皮肤对比度修复」「移动端修急」两条——P0★ 7 条全勾收官）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 09:44 · P0 图表核心：标尺切换（普通/对数/百分比）+ 双标的归一化叠加对比（compare overlay）

### 目标
TV-ROADMAP 最靠前未勾项：P0 图表核心第 4 条「标尺与对比」。防重复核查：OPTIMIZER-LOG 541 行无此条目施工记录；grep 全 js/index 无既有 setScale/rebaseCompare/kcmp/scaleToggle 实现（charts.js 的 setLog 属基金对比页 createCompare 专用，与本轮 K 线图无关）。可行性逐点实查：① 标尺 = LWC priceScale mode 0/1/2（createCompare L1489-1494 setLog 已有同 API 先例，PriceScaleMode 数值常量 v3/v4/v5 稳定）；② 对比叠加 = 追加一条虚线 Line series 走归一化重定基，值落在主图价格单位、与蜡烛共用右轴，对数模式下值恒正安全；③ 数据复用既有管线零新增取数——候选来自 EastmoneySource.search（与顶栏搜索同源）、K 线复用 klineFor（自带 in-flight 去重与周期分源），前端零 API key；④ 对比标的会话级不落盘（TradingView 同为先例）；⑤ UI 挂点在详情工具条，复用 .ma-wrap/.ma-menu 弹层语言与 .sr-item/.sr-empty 通用候选样式。测试先行：新断言先红（charts.test 41/8 失败全为新组、tokens.test 57/2 失败全为新守卫，与预案逐条对照零意外项）后施工。混行尾红线零偏离：charts.js/app.js 全程 Edit 片段级编辑、style.css 仅 5 行小段插入，无整文件重写。

### 改动
1. `js/charts.js`（+128/-2，全 CRLF 保持）：① 纯函数区新增导出 `sanitizeScale(v)`（只认 'log'/'pct' 字面量，其余含数字/undefined/null/'LOG' 大写/空串/中文一律收敛 'normal'）与 `rebaseCompare(mainKlines, cmpKlines)`——双标的归一化叠加核心口径：时间键归一（字符串日期/伪 UTC 秒统一串键）建主图 close 反查 Map，**交集口径**只保留主图也有的时间（防 LWC 时间轴被对比序列撑出幽灵 bar），以首个共同时间定基 factor = 主图基准 close / 对比基准 close，points 的 time 用主图原始 time（时间轴零变化）、value = +(cmpClose×factor).toFixed(4)；脏输入（非数组/交集空/基准 close 非有限或 ≤0）→ points:[]，中段非正 close 跳点；② createKline 新增 `setScale(mode)`（'log'→1/'pct'→2/其余→0，try/catch 老版本静默降级）；③ createKline 新增对比线状态与 `setCompare(cmp)`：series 惰性创建（color 取 themeColors().lineColors[5] 即 --ma-5 令牌链、lineWidth 2、lineStyle 2 虚线与均线实线区分、lastValueVisible/priceLineVisible false 不挤右轴、crosshairMarkerVisible true），null/空 points 清数据保 series（均线池同款不销毁策略），setData 归一化 points 且**不调 fitContent**（points ⊆ 主图时间集，时间轴零变化）；cmpMap/cmpBase 闭包供图例反查；applyTheme 内对比线随换肤重取令牌色；④ legendHTML 末尾追加对比读数「对比名 ±累计涨跌幅%」（基准 = 首点即首个共同交易日，统计口径、不带方向色、无建议语义）；⑤ createKline 返回对象追加 `getKlines: () => lastKlines`（app 层 rebase 用它保证与画布同源——setData 过滤脏 bar 口径一致，绝不喂出画布上不存在的时间点）与 `setScale, setCompare`；⑥ remove() 无需新增清理（chart.remove() 销毁全部 series）；文件头注释补两行口径说明。
2. `js/app.js`（+204/-1，全 CRLF 保持）：① state 增 `chartScale`（照 drawHidden L127 先例 `window.Charts.sanitizeScale(Store.get('chartScaleV1','normal'))`——charts.js defer 且排在 app.js 前，顺序有保证）、`cmpTarget: null`、`cmpSeq: 0`（对比会话代号，同 chartGen/searchGen 惯例）；② DOM_IDS 补 8 个 id（scaleToggle/scaleMenu/kcmpToggle/kcmpMenu/kcmpInput/kcmpResults/kcmpClear/kcmpStatus）；③ openDetail 在 state.detail 赋值后重置对比会话（cmpTarget=null、++cmpSeq 作废在途对比请求、清状态行——换标的不继承上一个标的的对比线）；④ loadDetailChart K 线分支在 applyDrawTool 后追加 setScale 重放 + applyCompareOverlay(gen)；分时分支按 maToggle.disabled 同款把 scaleToggle/kcmpToggle 置 disabled 并关掉还开着的弹层（分时无蜡烛序列与右轴标尺语义，诚实禁用）；⑤ 新增 `applyScale()`（scaleMenu 三个 radio checked/label.on 同步 + chart.setScale，存在性守卫同 setDrawTool）与 `saveScale(v)`（sanitize 收敛后落 Store 'chartScaleV1'）；⑥ 新增 `applyCompareOverlay(gen)`（async 双 stale 守卫：gen 对齐 chartGen + seq 对齐 cmpSeq + detail 对齐，防慢响应覆盖新图/新对比；无目标 → setCompare(null)+syncCompareUi 收敛；有目标 → klineFor(state.cmpTarget, state.detailPeriod) 复用分源管线 → Charts.rebaseCompare(state.chart.getKlines(), rows) → points 空 → 状态行「没有共同交易日」+ setCompare(null) 诚实空态——跨市场无共同交易日/分钟级时间轴无交集/加密主图时间编码不同都落到这里）；⑦ 新增 `syncCompareUi()`（kcmpToggle active 态 = 对比生效中（evtToggle 同款）、kcmpClear 显隐、状态行文案三处收敛）；⑧ bindEvents 追加：scaleToggle 点击开合 scaleMenu（照 maToggle 先例、打开时 applyScale 回显）、scaleMenu change 委托 [data-scale] → saveScale、kcmpToggle 开合 kcmpMenu（开时聚焦输入框）、kcmpInput input → debounce(doCmpSearch, 240)（复用 utils debounce 的 setTimeout 链，无 setInterval）+ 本地 cmpSearchGen 竞态守卫（照 compareview 先例，不与顶栏 searchGen 互踩）、keydown ↑↓/Enter/Esc（照 compareview 先例但 **Enter 无选中项不放行**——无 secid 取不了 K 线，状态行提示「请从候选里选择一个标的」，不做裸文本兜底）、kcmpResults click 委托 data-kci → pickCmpTarget（构型照 pickSearch：{symbol:'EM:'+secid, name, code, market: marketFromSecid, secid, tencent: tencentOfSecid}；与当前标的同 symbol 提示「与当前标的相同」不生效；否则 ++cmpSeq、cmpTarget=picked、关菜单、applyCompareOverlay(state.chartGen)）、kcmpClear 点击 → ++cmpSeq、cmpTarget=null、setCompare(null)、syncCompareUi('')。
3. `index.html`（+89/-67，纯 LF 保持）：① L404 ma-wrap 结束后、L405 事件按钮前插入两组控件：`#scaleToggle`（「标尺 ▾」pill，中文 title）+ `#scaleMenu`（class ma-menu 复用，hidden，三行 label.ma-pane-row data-scale=normal|log|pct + radio name=kscale，文案普通/对数/百分比全中文）；`#kcmpToggle`（「对比」pill，中文 title）+ `#kcmpMenu`（class "ma-menu kcmp-menu"，内含 ma-sec-t 标题「对比标的」、#kcmpInput class search-input type=search autocomplete=off、#kcmpResults 候选容器、#kcmpStatus 状态行 role=status、#kcmpClear class ma-add「清除对比」hidden）；② 全部 67 处业务资源 ?v=20261101i → ?v=20261101j（当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动）。新按钮不带 data-draw，6 件画线白名单计数不变。
4. `css/style.css`（+4/-0，混行尾只小段插入零重写）：.ma-menu 规则块附近追加 3 条——`.kcmp-menu { min-width: 240px; }`、`.kcmp-menu .search-input { width: 100%; margin-bottom: var(--sp-4); }`（.cmp-search .search-input 同款先例）、`.kcmp-status { font-size: var(--fs-12); color: var(--text-faint); padding: var(--sp-4) 0 0; min-height: 1em; }`——取值全走 --fs-12/--text-faint/--sp-4 令牌，零 hex 字面量、零新增动画/transition（弹层 hidden 直切，与 maMenu 现行为一致）。
5. `_test/charts.test.mjs`（+77/-0，纯 LF 保持）：新增 8 组——sanitizeScale 合法值往返；sanitizeScale 脏值收敛（数字/undefined/null/'LOG'/空串/'百分比'）；rebaseCompare 同涨幅两序列重合（factor=2、末值=110）；差异走势（cmp 翻倍 main 1.5 倍 → 末值 200）；首个共同时间为基准（main 自 t0、cmp 自 t1 → t1 首点、t0 不入 points、factor 按该日算）；cmp 独有时间点剔除（交集防幽灵 bar）；脏数据收敛（非数组/交集空/close 非有限/基准 ≤0 → points 空、中段非正 close 跳点）；导出面守卫。跨 realm 对象一律 JSON.stringify 串比较（既有先例）。
6. `_test/tokens.test.mjs`（+28/-0，纯 LF 保持）：新增 2 组——①「index.html 必须保留标尺与对比入口」结构守卫（scaleToggle/kcmpToggle 存在且带中文 title、data-scale 三档 ∈ {normal,log,pct} 且互不重复、kcmpClear/kcmpStatus 存在）；②「app.js 必须接线标尺与对比」跨文件守卫（chartScaleV1 持久化 + setScale 调用 + rebaseCompare 调用 + klineFor(state.cmpTarget 复用，缺持久化刷新即丢、缺接线按钮点了图不变、缺复用则破坏取数管线纪律）。既有守卫自然回归：?v= 一致性、vendor 锁版本、6 个 data-draw 白名单、花括号配平、间距/字号断言域、暗色灰阶对比度断言域。

### 测试
- 测试先行红相：`node _test/charts.test.mjs` → **41 passed / 8 failed**（唯八红组即新 8 组，红项全为「C.rebaseCompare is not a function / Charts 缺少导出」）；`node _test/tokens.test.mjs` → **57 passed / 2 failed**（唯二红组即新守卫：scaleToggle 不存在、chartScaleV1 缺失）——与预案逐条对照零意外项。
- 施工后单跑：charts.test.mjs → **49 passed / 0 failed**（41→49）；tokens.test.mjs → **59 passed / 0 failed**（57→59）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 37 组**全部通过**（施工前基线实测同 37 组全绿，run-all.mjs 零改动）。未做实网验证（红线 11）。
- 语法核验：`node --check js/app.js`、`node --check js/charts.js` 通过。
- 行尾核验（node 逐字节）：charts.js CRLF=1926/裸 LF=0、app.js CRLF=6578/裸 LF=0、style.css CRLF=2657/裸 LF=0（全 CRLF）；index.html CRLF=0 纯 LF；`git ls-files --eol` 仓库口径 i/crlf（charts.js/app.js）/i/lf（其余）与改前一致。
- 预算：`git diff --numstat` 增删合计（不含留痕文档）charts.test 77/0 + tokens.test 28/0 + style.css 4/0 + index.html 89/67 + app.js 204/1 + charts.js 128/2 = **600 行** ≤600（方案估 ≈490，index.html 的 67 处 bump 在 numstat 按 67+67 计；方案「index.html≈91」为单行计数口径，如实按 numstat 口径记并压缩注释至达标）。
- `?v=` 守卫：20261101j 恰 67 处、20261101i 残留 0、vendor 四个语义化版本原样（tokens.test 既有守卫自然回归）。
- 红线核对：全中文 UI 与注释；分区卡片+折叠布局零改动；8 套皮肤零触碰（新 UI 取值 --fs-12/--text-faint/--sp-4 全走已收敛令牌，弹层复用 .ma-menu 既有配色语言）；无成交量数据新增（不碰 vol 副图）；无 Polymarket 字样新增；对比读数为统计口径累计涨跌幅、不带方向色、无买卖建议；前端零 API key 零新增取数代码（红线 6 无涉）；无 setInterval（新增调度仅 utils debounce 的 setTimeout 链；全文件 setInterval 计数 1 处为既有注释文字，diff 零新增）；零新增动画与 transition；.sh 未触碰；无开源代码移植（红线 9 无涉）。对比标的会话级不落盘（TradingView 同为先例）；跨市场日历差异下对比线只在共同交易日有读数，其余诚实空态。
- 视觉冒烟清单（留人工轮）：标尺三档切换在 8 套皮肤下的右轴刻度观感（对数/百分比档位的刻度密度）；对比线虚线在暗/亮皮肤下与均线的区分度；kcmp 菜单在 390px 窄屏的开合与候选列表滚动；对比读数在十字线悬停时与 MA 读数的同行排布。

### 涉及文件
- `js/charts.js`、`js/app.js`、`index.html`、`css/style.css`
- `_test/charts.test.mjs`、`_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0 图表核心「标尺与对比」条目——条目文字不动，勾选依据=离线测试全绿+守卫钉死；浏览器内实点/实拖属视觉冒烟留人工轮）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 10:32 · P0 图表核心：图表类型五档切换（蜡烛/美式棒/线/面积/平均K-HA）同实例零闪烁 + heikinAshi 纯函数单测

### 目标
TV-ROADMAP 最靠前未勾项：P0 图表核心第 5 条「图表类型」。防重复核查：grep 全 js/index 无既有 setType/ktype/heikinAshi/sanitizeChartType 实现；OPTIMIZER-LOG 570 行无此条目施工记录。可行性逐点实查：① LWC 4.2.3 已确认含 addBarSeries 工厂（vendor 本地实测 lib/lightweight-charts.standalone.production.js?v=4.2.3 在册）；② LWC 不能原地改 series 类型——换档 = removeSeries 旧主系列 + 新建，同实例不重建图表；③ 存视野（getVisibleRange）→换系列→喂同源数据→回灌视野（setVisibleRange），全程同步不 fitContent，时间轴不动即零重载闪烁，老版本 LWC 缺 API 时 try/catch 静默降级；④ AlertCenter 经 charts.js 导出面 candle 改 getter 自动跟随新主系列（js/alerts.js:122/130/135 均为调用时读取、applyChartLines 为公开导出 alerts.js:285、removePriceLine 逐条 try/catch alerts.js:131）；⑤ 零新增取数、零 setInterval、零新增动画（.ma-menu 无 transition，hidden 直切）。测试先行：新断言先红后施工，红相与预案逐条对照零意外项。

### 改动
1. `js/charts.js`（+122/-18，全 CRLF 保持）：① 纯函数区（sanitizeScale 同区）新增导出 `CHART_TYPES=['candle','bar','line','area','ha']`、`sanitizeChartType(v)`（只认五字面量，其余含大写 'HA'/数字/null/空串/中文/对象一律收敛 'candle'，sanitizeScale 同口径）与 `heikinAshi(klines)`——HA 标准口径：haClose=(o+h+l+c)/4，首根 haOpen=(o+c)/2、其后 haOpen=(前根haOpen+前根haClose)/2，haHigh=max(h,haOpen,haClose)、haLow=min(l,haOpen,haClose)，输出 open/high/low/close 四字段直接可喂 Candlestick 系列，time 原样保留、不 mutate 输入，脏输入（非数组→[]、单项 OHLC 任一非有限→跳根、平滑链接最近一根有效 HA）；② addSeries legacy 映射补 Bar:'addBarSeries'；③ createKline 主系列改由构建函数管理：mainSeriesOptions(t)（candle/ha 走 themeColors().up/down，bar 加 openVisible，line/area 走 lineColors[0] 令牌链 + area 渐变 '40'/'0a' 透明度后缀——createTrend 同款先例）+ MAIN_KIND 映射（ha→Candlestick），闭包 candle 改 let 可重指派，新增 curType/haCache；④ setData 拆出 applyTypeData()（candle/bar 喂 OHLC、line/area 喂 {time,value:close}、ha 喂 heikinAshi 序列且 haCache 供图例），fitContent/schedulePaneRender/renderMA/paintLegend 管线零改动；⑤ 新增 setType(type)：sanitize→同档早退→getVisibleRange 存视野→removeSeries 旧主系列（try/catch）→重建→applyTypeData→setVisibleRange 回灌（try/catch 老版本静默降级）→applyMarkers（事件标记挂新系列）→drawOverlay→paintLegend，全程同步无重排、不 fitContent；MA 池/对比线/画线 overlay/自绘副图经闭包与独立 series 自动跟随、零接触；⑥ applyTheme 的 candle.applyOptions 改为 applyOptions(mainSeriesOptions(curType))（line/area 不误喂蜡烛选项）；⑦ legendHTML 读数改 viewAt(idx)（ha 模式且 haCache 等长时读 HA 值——所见即所得，TradingView 同款；涨跌幅按所显序列前一根 close 算，统计口径），ha 模式时间行后追加 .kl-dim「平均K」诚实标注（复用既有样式 style.css:1752，零新 CSS）；getKlines() 仍回实值 lastKlines（rebaseCompare/均线/副图口径不变）；⑧ 导出面 candle 快照改 getter（alerts.js 调用时读取自动跟随），追加 setType/CHART_TYPES/sanitizeChartType/heikinAshi；文件头注释补一行 setType 口径。
2. `js/app.js`（+44/-1，全 CRLF 保持）：① state 增 chartType（照 chartScale 先例：window.Charts.sanitizeChartType(Store.get('chartTypeV1','candle'))）；② DOM_IDS 补 ktypeToggle/ktypeMenu；③ 新增 applyType()（ktypeMenu 内 [data-ktype] radio checked/label.on 同步 + chart.setType 存在性守卫 + AlertCenter.applyChartLines() 重挂到价提醒线——applyChartLines 先逐条 removePriceLine 再新建，无双挂）与 saveType(v)（sanitize 收敛后落 Store 'chartTypeV1'）；④ loadDetailChart K 线分支在 setScale 重放后补 setType(state.chartType) 重放（实例可能刚换 kind 或跨标的复用）；分时分支按 scaleToggle 同款把 ktypeToggle 置 disabled 并关 ktypeMenu 弹层；⑤ bindEvents 照 scaleToggle 块追加 ktypeToggle 开合（打开时 applyType 回显、active=菜单展开中）与 ktypeMenu change 委托 [data-ktype]→saveType；⑥ 提醒线两条路径无双挂：interactive saveType 经 applyType 调 AlertCenter.applyChartLines，replay 路径由既有 AlertCenter.attachChart 自动完成。
3. `index.html`（+78/-67，纯 LF 保持）：scaleMenu 的 ma-wrap 结束后插入「类型」控件块——pill 按钮 ktypeToggle（全中文 title「图表类型：蜡烛/美式棒/线/面积/平均K」）+ ma-menu 弹层 ktypeMenu 五行 label.ma-pane-row data-ktype=candle|bar|line|area|ha + radio name=ktype（文案：蜡烛/美式棒/线/面积/平均K（HA），HA 缩写与既有 RSI/MACD 及路线图原文一致）；复用 .ma-menu/.ma-pane-row 既有弹层语言（css 零改动），heat-toolbar 本就 flex-wrap（style.css:328）不破坏 390px 布局；全部 67 处业务资源 ?v=20261101j→?v=20261101k（当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动）；新按钮不带 data-draw，6 件画线白名单计数不变。
4. `_test/charts.test.mjs`（+82 行 8 组，全 CRLF 保持，插在 sanitizeScale/rebaseCompare 同区与导出守卫区）：sanitizeChartType 合法值往返（五档原样通过）/脏值收敛（数字/undefined/null/'HA'大写/空串/'蜡烛'/对象/数组→'candle'）；heikinAshi 首根口径（haOpen=(o+c)/2、haClose=(o+h+l+c)/4、包络含 HA 实体）/平滑口径（第二根 haOpen=(前根haOpen+前根haClose)/2 + 上根实体盖过当根区间的构造用例验证 haHigh 取 haOpen）/保形（time 原样、长度不变、输入数组不被 mutate）/脏输入（非数组→[]、OHLC 非有限项跳根且链不断）；导出面守卫（CHART_TYPES/sanitizeChartType/heikinAshi 挂 Charts 导出、恰五值互不重复）；data-ktype UI 白名单一致性（index.html 入口全 ∈ CHART_TYPES 恰 5 档互不重复，照 data-draw 先例）。跨 realm 数组一律 JSON.stringify 串比较（既有先例）。
5. `_test/tokens.test.mjs`（+22 行 2 组，全 CRLF 保持）：①「index.html 必须保留图表类型入口」结构守卫（照 scaleToggle/kcmpToggle 组先例：ktypeToggle 存在且带中文 title、data-ktype 五值恰各一不重复）；②「js/app.js 必须接线图表类型」跨文件守卫（chartTypeV1 持久化 + setType 调用 + sanitizeChartType 消费，缺持久化刷新即丢、缺接线按钮点了图不变）。

### 测试
- 测试先行（先红后绿）：新增断言后单跑 `node _test/charts.test.mjs` → 49 passed / 8 failed（失败恰为 8 个新组：sanitizeChartType×2、heikinAshi×4、导出守卫、data-ktype UI，与预案逐条对照零意外项）；`node _test/tokens.test.mjs` → 59 passed / 2 failed（唯二红组即 ktypeToggle 入口缺失与 chartTypeV1 接线缺失）。
- 施工后单跑：charts.test **57 passed / 0 failed**（49→57，+8 恰为新组）；tokens.test **61 passed / 0 failed**（59→61，+2 恰为新守卫）。
- 全量：`node _test/run-all.mjs --offline` 共 43 组（离线 37/实网 6）执行 37 组全部通过（收官复跑「全部测试组通过」）。如实记录：中途一轮 insight.test.mjs 红过一次（「加密K线 5m 仅 0 根」——该组实为 Binance 实网取数，本环境取到 0 根；git stash 后在干净基线树上复跑同样 9 passed/1 failed，证实为与本轮无关的间歇性外部依赖，与本轮改动无因果），复跑全绿。
- 语法核验：`node --check js/charts.js`、`node --check js/app.js` 通过。
- 行尾核验（node 逐字节，口径=与改前同尾、不新增裸 LF/CR 翻转）：js/charts.js CRLF=2030/裸 LF=0、js/app.js CRLF=6621/裸 LF=0（全 CRLF）；_test/charts.test.mjs CRLF=581/裸 LF=0、_test/tokens.test.mjs CRLF=1139/裸 LF=0、docs/TV-ROADMAP.md CRLF=82/裸 LF=0（全 CRLF）；index.html 纯 LF（CR=0/LF=968）——施工中发现 Edit 工具把 index.html 整文件翻成了 CRLF，已用 node 按字节还原为纯 LF（内容零变化，git diff 仍 78/67），核验通过；本条目沿 OPTIMIZER-LOG 尾段现状以 LF 追加、既有行未动。
- 预算：`git diff --numstat` 增删合计（不含留痕文档）charts.test 82/0 + tokens.test 22/0 + index.html 78/67 + app.js 44/1 + charts.js 122/18 = **434 行** ≤600（方案预估 ≈410-450 区间内；index.html 67 处 bump 按增删双计 134，上轮同口径先例 OPTIMIZER-LOG:562）。
- ?v= 守卫：20261101k 恰 67 处、20261101j 残留 0、vendor 四个语义化版本原样（4.2.3/3.1.0/3.2.4/3.1.1）。
- 红线核对：全中文 title/文案/注释；零新增取数零 API key（红线 6 无涉）；零新增 setInterval（charts.js 计数 0、app.js diff 新增行 setInterval 计数 0）；零新增动画（css/style.css 本轮零改动，.ma-menu 无 transition、hidden 直切）；不碰成交量展示（HA 图例量行随 HA 值自然不显，副图口径未动）；无 Polymarket 字样新增；图例涨跌幅为统计口径、不带方向建议；未做实网验证（红线 11）。
- 如实声明边界：setType 运行时行为（同实例换系列/视野回灌/零闪烁）、8 套皮肤下五档显示形态与 390px 窄屏按钮换行属视觉冒烟，按 TV-ROADMAP「视觉冒烟留人工轮次」惯例未自动化；本轮完成判定=纯函数单测（heikinAshi/sanitizeChartType 8 组）+ 静态守卫（入口/接线/?v=）+ 离线全量全绿。

### 涉及文件
- `js/charts.js`、`js/app.js`、`index.html`
- `_test/charts.test.mjs`、`_test/tokens.test.mjs`
- `docs/TV-ROADMAP.md`（勾选 P0 图表核心「图表类型」条目——条目文字不动，勾选依据=离线测试全绿+守卫钉死；浏览器内实切/实看属视觉冒烟留人工轮）、`docs/OPTIMIZER-LOG.md`（本条目）

## 2026-11-01 12:06 · P0 图表核心：副图指标扩充五件——VWAP/ATR/StochRSI/CCI/DMI·ADX 进副图体系（OBV 待红线裁决另轮）

### 目标
TV-ROADMAP 最靠前未勾项：P0 图表核心第 6 条「指标扩充」。按已评审方案执行（解阻路径 a）：本轮五件 = VWAP / ATR / StochRSI / CCI / DMI·ADX；**OBV 摘除**——其以量为量纲，方案原 fmtVol 扩分支自证撞红线 2（TV-ROADMAP.md:19「不展示成交量数据」不可协商，原文同 .zcode/workflows/hourly-project-optimizer.dwf.ts:80），路线图 :19 禁与 :43 令的体系矛盾不宜由施工评审自裁，认可「拿不准就按不放行」。VWAP 评审已裁定展示的是价格序列、量仅作权重，与已上线多轮存续的量比（technical.js:143）同为「消费量而不展示量」口径，字面不触红线 2。防重复核查：grep js/ 无 vwap/stochrsi/cci/dmi 实现痕迹；technical.js:124 末值版 atr 画不了序列、职责不同不冲突；OPTIMIZER-LOG 无本条目施工记录。可行性：三层结构（panes.js 纯计算 / charts.js 自绘 / app.js 自动菜单+泛化处理器，app.js:5978-5989 菜单由 PANE_DEFS 自动渲染、:6195-6221 radio/参数处理器按 min/max 钳制均亲读核实）新增副图**零 app.js 改动**；分时图 setPane 空实现（charts.js:1571）不受影响。测试先行先红后绿。

### 改动
1. `js/panes.js`（+173/-3，纯 LF 保持，node 字节级拼接）：① 纯函数区新增五件 + dayAnchor/smaPadded 助手——`dayAnchor(t)`（VWAP 会话锚：字符串取前 10 位（日 K 串，js/sources/eastmoney.js:205）、伪 UTC 秒取 UTC 日期（分钟 K 墙钟日，js/sources/eastmoney.js:226））；`vwapSeries(klines)`（tp=(h+l+c)/3，Σ(tp×v)/Σv 跨日重置 = TradingView Session 锚口径；量仅作权重；无量/脏 bar 不进累计、该点不画）；`atrSeries(klines,n=14)`（TR 自第 1 根起、种子=前 n 根 TR 的 SMA、此后 Wilder 递推与 technical.atr 同口径，值按有效 bar 原始下标落位）；`stochRsiSeries(closes,n=14,kS=3,dS=3)`（RSI 的 n 窗随机化 raw、平窗=50，K=raw 的 SMA(kS)、D=K 的 SMA(dS)，值域 0~100）+ `smaPadded`（带 null 的 SMA，窗内全有效才算，**逐窗直加**——首版滑动加减实测浮点漂移可溢出值域一个 ε，见测试节）；`cciSeries(klines,n=20)`（tp 的 n 窗 SMA 与平均绝对偏差，md=0→0）；`dmiSeries(klines,n=14,m=14)`（+DM/-DM/TR 的 Wilder 平滑→+DI/-DI 自第 n 个有效 bar 起效，DX 再平滑→ADX 自第 n+m-1 个起效；ks.length<n+1 早退）。② PANE_DEFS 追加 5 条（vwap range:'free' / atr / stochrsi range:'pct' / cci / dmi，参数全带 def/min/max），既有 rsi 补 range:'pct'（vol/macd 零变化），OBV 不进清单。③ computePane 局部 pick 助手 + 5 个键分支（vol/rsi/macd 既有分支逐字不动）。④ paneRange 扩展：rsi 或 range==='pct'→固定 0~100；range==='free'→纯自适应不强制含零；其余 lo=min(lo,0)（vol/atr/cci/dmi 等价旧口径，cci 负值不裁剪，panes.test:158 三元式实测兼容）。⑤ 导出面追加五个新纯函数。
2. `js/charts.js`（+36/-22，净 +14 ≤ ±40，全 CRLF 保持，node 字节级拼接五段小编辑）：① 模块作用域新增 `PANE_LINE_SLOTS`（vol:[] 登记空槽、rsi:[1]、macd:[2,5]、vwap:[0]、atr:[3]、stochrsi:[1,5]、cci:[3]、dmi:[1,5,2]，OBV 不在表内）——vol 空槽为守卫断言全键覆盖所补（渲染仍走专用柱分支，行为零变化）；② `paneTitle()` 泛化——删 rsi/macd/vol 三特例，统一由 paneDef 拼 label+参数逗号串（钳制与 computePane 同式），vol→'成交量'、rsi→'RSI(14)'、macd→'MACD(12,26,9)' 与旧实现逐字相同，新键自动得 'VWAP'/'ATR(14)'/'StochRSI(14,3,3)'/'CCI(20)'/'DMI(14,14)'；③ renderPane 通用线装配——除 vol 外按 pane.lines×槽位取 c.lineColors 令牌链（rsi→lineColors[1]、macd DIF/DEA→[2,5] 与旧码逐字一致，槽位 5 在 --ma-0..5 链内），**MACD 柱正负染色分支保留在通用装配之后**（评审点名风险，注释钉死先后）；④ 纵轴域改按 paneDef(key).range 驱动——'pct'→固定 0~100+ticks、'free'→includeZero:false（VWAP 价格域否则被 0 基压扁）、其余含零；⑤ :142 注释同步八键口径。fmtTick/fmtValue 未动。
3. `css/style.css`（+2/-0，全 CRLF 保持只小段插入）：.ma-menu 规则块内补 `max-height: min(70vh, 560px); overflow-y: auto;`（副图单选 3 行→8 行后弹层过高窄屏溢出；纯静态滚动属性、零颜色零动画，.ma-menu 无 transition、hidden 直切）。
4. `index.html`（+67/-67，纯 LF 保持）：业务资源 ?v=20261101k→?v=20261101l 全部 67 处（panes.js/charts.js 内容变更触发缓存失效，当日字母序单调递增；vendor 语义化版本 4.2.3/3.1.0/3.2.4/3.1.1 不动）。app.js 本轮零改动（git diff 0 行）。
5. `_test/panes.test.mjs`（+213/-5，纯 LF 保持，先红后绿）：改写既有「指标清单」组为八键口径（键序互不重复、label 非空、range ∈ {pct,free,undefined}、params 的 def/min/max 齐全且 def 落域内、新键 paneDef 可达、obv 返回 null 登记未入选）；新增 12 组——vwapSeries 三组（恒定 tp、跨日重置含日界前后断言、脏/无量输入不进累计）、atrSeries 两组（恒定 TR + 脏 bar 原位落值、Wilder 递推手算 16/3→62/9→232/27 逐步核对）、stochRsiSeries 两组（单调上涨→K=D=50 含预热下标、随机序列 K/D 与手算 SMA 全序列核对+值域 [0,100]）、cciSeries 一组（恒定→0、上行→正、预热 null、n 超长全 null）、dmiSeries 一组（+DI>-DI、值域、+DI 第 n / ADX 第 n+m-1 有效 bar 起效、不足全 null）、computePane 集成一组（vwap1/atr1/stochrsi2/cci1/dmi3 条数、time 对齐、脏 bar 不出现、未知键空结构）、paneRange 一组（stochrsi 固定 0~100、vwap free 不含零、cci 负值不裁剪、atr 含零）、跨文件守卫一组（charts.js 的 PANE_LINE_SLOTS 必须覆盖 PANE_DEFS 全部八键，照 tokens.test 跨文件守卫先例）。

### 测试
- 红相（先红后绿）：`node _test/panes.test.mjs` → **14 passed / 13 failed**，失败恰为改写清单组 + 12 新组（P.vwapSeries is not a function 等），与预案逐条对照零意外项。
- 施工后单跑：panes.test **27 passed / 0 failed**（15→27，+12 恰为新组）；charts.test **57 passed / 0 failed**（回归零破坏）；tokens.test **61 passed / 0 failed**（?v= 一致性与 vendor 守卫自然回归）。
- 全量：`node _test/run-all.mjs --offline` → 共 43 组（离线 37 / 实网 6），执行 **37 组全部通过**（施工前基线同 37 组全绿，run-all.mjs 零改动）。未做实网验证（红线 11）。
- 语法核验：`node --check js/panes.js`、`node --check js/charts.js` 通过。
- 测试先行的实际收益：stochRsi 随机组首跑抓到 smaPadded 滑动加减的浮点漂移（实测 -1.42e-14 越出 [0,100] 下界）——实现改逐窗直加后全绿，属真缺陷非测试误报。
- 行尾核验（node 逐字节）：js/panes.js CR=0/359 行（纯 LF）、_test/panes.test.mjs CR=0/390 行（纯 LF）、index.html CR=0/968 行（纯 LF）；js/charts.js CR=2044/裸 LF=0、css/style.css CR=2659/裸 LF=0（全 CRLF）；`git ls-files --eol` 仓库口径 i/lf（panes/test/index）/i/crlf（charts）与改前一致。施工方式说明：全程 node 字节级拼接（上轮记录过 Edit 工具会把 LF 文件整翻 CRLF 的坑，本轮规避）。
- 预算：`git diff --numstat` 增删合计（不含留痕文档）panes.js 173/3 + panes.test 213/5 + charts.js 36/22 + style.css 2/0 + index.html 67/67（双计 134）= **588 行 ≤600 硬上限**。如实登记两处偏离方案预算：panes.js 173 超单文件预算 165 共 8 行（超因 = ① smaPadded 浮点漂移修复改逐窗直加 ② PANE_LINE_SLOTS 补 vol 空槽登记项，均为方案文本未预见的必要修正，未靠删断言/注释保预算）；panes.test 213 ≤220 ✓。
- ?v= 守卫：20261101l 恰 67 处、20261101k 残留 0、vendor 四版本原样。
- 红线核对：全中文注释与文案；分区卡片+折叠布局零改动；8 套皮肤零触碰（取色全走 --ma-0..5 令牌链、.ma-menu 追加无颜色属性）；无 setInterval；零新增动画/transition；零新增取数（红线 6 无涉）；五指标均统计口径、无买卖建议；新增行 grep Polymarket 命中 2 处均为 index.html 既有脚本标签的版本号 bump 机械结果、非新增品牌内容；省略号问句 0；.sh 未触碰；无开源代码移植（红线 9 无涉）。
- **OBV 待裁决登记（解阻路径 b）**：OBV 以量为量纲，与红线 2（TV-ROADMAP.md:19「不展示成交量数据·不可协商」）的适用边界存在体系争议，留用户裁决——若裁定红线 2 不涵盖「免收费 K 线可算、量仅作输入的统计类指标」，另轮补齐 OBV（单键隔离：panes.js 一分支 + 一条 PANE_DEF + PANE_LINE_SLOTS 一行槽位，一行摘除/补回不牵连本轮五件）。
- 如实声明边界：五新键的运行时实画（VWAP 跨日锚点形态、DMI 三线取色、.ma-menu 8 行弹层窄屏滚动、paneTitle 参数串显示）属视觉冒烟，按 TV-ROADMAP「视觉冒烟留人工轮次」惯例未自动化；本轮完成判定 = 纯函数单测（12 组）+ 跨文件守卫 + 离线全量全绿。**docs/TV-ROADMAP.md 本轮零改动**——条目「指标扩充」含 OBV 未全量达成不勾选，照间距骨架①先例。

### 涉及文件
- `js/panes.js`、`js/charts.js`、`css/style.css`、`index.html`
- `_test/panes.test.mjs`
- `docs/OPTIMIZER-LOG.md`（本条目）；`docs/TV-ROADMAP.md` 零改动（条目未全量达成不勾选）
