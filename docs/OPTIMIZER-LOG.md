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
