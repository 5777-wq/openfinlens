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
