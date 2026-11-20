/* js/ui/command.js —— ⌘K / Ctrl+K 命令面板（UI v2）
 * ---------------------------------------------------------------------------
 * 为什么是"命令面板"而不是再加一个搜索框：v2 把 12 个板块收成 5 个一级，
 * 高频操作（切板块 / 开指标 / 换模式 / 导出快照 / 刷新 / 找标的）需要一个
 * 不占顶栏、全键盘可达的统一入口。TradingView / Linear / Raycast 都是这个解法。
 *
 * 三条设计约束：
 *   ① **执行动作必须走已有入口**：导航/模式/指标/刷新/快照全部经
 *      window.AppNav（app.js 暴露面），本文件不碰 state、不写 DOM 业务结构。
 *      ——命令面板只做"找到并触发"，避免它长成第二个 app.js。
 *   ② 全键盘：⌘K/Ctrl+K 开、↑↓ 选、↵ 执行、Esc 关、Tab 不逃逸
 *      （焦点陷阱复用 js/focus-trap.js，全站一套实现）。
 *   ③ 离线也要能用：本地词典（universe.js + 自选）先出结果；东财远程搜索
 *      是增强项，失败/超时静默退回本地，不弹错、不空转。
 *
 * 数据源：标的（本地词典 + 远程搜索，支持代码 / 中文名 / 拼音首字母）
 *         功能命令（5 个一级 + 12 个子项、指标、模式、快照、刷新、设置）
 * ------------------------------------------------------------------------- */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ITEM_LIMIT = 28;          // 结果上限：面板高度有边界，多了要滚动反而难定位
  const REMOTE_DEBOUNCE = 220;    // 远程搜索防抖（本地结果先行，不阻塞输入）

  let host = null, panel = null, input = null, list = null, emptyHint = null, trigger = null;
  let trap = null, isOpen = false, sel = -1, remoteTimer = 0, remoteSeq = 0;
  let items = [];                 // 当前渲染的候选（顺序即 ↑↓ 顺序）
  let remoteItems = [];           // 远程搜索结果（与本地结果合并去重）
  let localSymbols = null;        // 本地词典（懒建，只建一次）

  /* ==================== 拼音首字母 ====================
     不为几千个汉字手写映射表：Intl.Collator 的 zh-pinyin 排序里，汉字按拼音
     排在同一顺序上，所以"某字 ≥ 某个声母锚点、< 下一个声母锚点"就等于它的首字母。
     锚点本身是各声母的代表字（阿 八 擦 搭 蛾 发 噶 哈 击 喀 拉 妈 拿 哦 啪 期 然 撒 塌 挖 昔 压 匝）。
     拿不到 Collator（老浏览器/无 ICU）时静默退化为"只匹配名称与代码"。 */
  const ANCHORS = ['阿', '八', '擦', '搭', '蛾', '发', '噶', '哈', '击', '喀', '拉', '妈',
    '拿', '哦', '啪', '期', '然', '撒', '塌', '挖', '昔', '压', '匝'];
  const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
  let collator = null;
  let pyCache = new Map();

  function initialsOf(text) {
    if (!text) return '';
    if (collator === null) {
      try { collator = new Intl.Collator('zh-Hans-u-co-pinyin'); }
      catch (e) { collator = false; }
    }
    let out = '';
    for (const ch of String(text)) {
      if (/[\u4e00-\u9fff]/.test(ch)) {
        if (!collator) continue;
        let hit = pyCache.get(ch);
        if (hit === undefined) {
          let idx = -1;
          for (let i = 0; i < ANCHORS.length; i++) {
            if (collator.compare(ANCHORS[i], ch) <= 0) idx = i; else break;
          }
          hit = idx < 0 ? '' : LETTERS[idx];
          pyCache.set(ch, hit);
        }
        out += hit;
      } else if (/[a-z0-9]/i.test(ch)) {
        out += ch.toUpperCase();
      }
    }
    return out;
  }

  /* 模糊匹配打分（0 = 不匹配）。层级：
     精确代码 > 精确 symbol > 代码前缀 > 名称前缀 > 拼音前缀 > 名称包含 >
     拼音包含 > 子序列（gzmt → 贵州茅台）> 提示词包含。 */
  function subsequence(q, s) {
    if (!q) return false;
    let i = 0;
    for (const ch of s) { if (ch === q[i]) i++; if (i >= q.length) return true; }
    return false;
  }

  function score(q, item) {
    if (!q) return 1;
    const Q = q.toLowerCase();
    const name = String(item.label || '').toLowerCase();
    const code = String(item.code || '').toLowerCase();
    const sym = String(item.symbol || '').toLowerCase();
    const py = String(item.py || '').toLowerCase();
    const hint = String(item.hint || '').toLowerCase();
    if (code && code === Q) return 100;
    if (sym && sym === Q) return 98;
    if (code && code.indexOf(Q) === 0) return 92;
    if (name && name.indexOf(Q) === 0) return 88;
    if (py && py.indexOf(Q) === 0) return 84;
    if (name && name.indexOf(Q) > 0) return 74;
    if (py && py.indexOf(Q) > 0) return 64;
    if (subsequence(Q, py)) return 48;
    if (subsequence(Q, name)) return 34;
    if (code && code.indexOf(Q) > 0) return 30;
    if (hint && hint.indexOf(Q) >= 0) return 20;
    return 0;
  }

  /* ==================== 数据源 ==================== */

  function guessCode(symbol, secid) {
    if (secid) { const p = String(secid).split('.'); return p[1] || p[0] || ''; }
    const s = String(symbol || '');
    if (s.indexOf('EM:') === 0) { const p = s.slice(3).split('.'); return p[1] || p[0] || ''; }
    const m = /^[a-z]{2}(.+)$/.exec(s);
    return m ? m[1] : s;
  }

  const MARKET_LABEL = {
    cn: 'A股', hk: '港股', us: '美股', index: '指数', crypto: '加密',
    fx: '外汇', commodity: '大宗', macro: '宏观', other: '其他',
  };

  /* 本地词典：universe.js 的三张表 + 自选。离线可用，零请求。 */
  function buildLocalSymbols() {
    if (localSymbols) return localSymbols;
    const out = [];
    const seen = new Set();
    const push = (x) => {
      const sym = x.symbol || (x.secid ? 'EM:' + x.secid : '');
      if (!sym || seen.has(sym)) return;
      seen.add(sym);
      const label = x.label || x.name || sym;
      out.push({
        kind: 'symbol',
        group: '标的',
        label: label,
        code: x.code || guessCode(sym, x.secid),
        symbol: sym,
        secid: x.secid || (sym.indexOf('EM:') === 0 ? sym.slice(3) : ''),
        market: x.market || x.group || '',
        py: initialsOf(label),
      });
    };
    (global.TENCENT_UNIVERSE || []).forEach(push);
    (global.EM_UNIVERSE || []).forEach(push);
    (global.GLOBAL_INDEX || []).forEach(push);
    (global.CRYPTO_UNIVERSE || []).forEach((sym) => push({ symbol: sym, label: sym.replace(/USDT$/, ''), group: 'crypto' }));
    try {
      if (global.Store && global.Store.watchlist) {
        global.Store.watchlist.all().forEach((x) => push({ symbol: x.symbol, name: x.name, market: x.market }));
      }
    } catch (e) { /* 隐私模式拿不到 localStorage：本地词典少掉自选，不影响其余 */ }
    localSymbols = out;
    return out;
  }

  /* 功能命令：导航 + 操作。动作一律经 AppNav（不存在时按钮仍在，但执行是空操作）。 */
  function buildCommands() {
    const nav = global.Navmap;
    const app = global.AppNav;
    const out = [];
    const goTab = (tab, label, primaryLabel) => ({
      kind: 'cmd', group: '导航', label: label,
      hint: '跳转 · ' + primaryLabel, py: initialsOf(label),
      symbol: '', code: '', run() { if (app) app.setTab(tab); },
    });
    const goPrimary = (p, label) => ({
      kind: 'cmd', group: '导航', label: label,
      hint: '一级入口', py: initialsOf(label),
      symbol: '', code: '', run() { if (app) app.navToPrimary(p); },
    });

    if (nav && nav.PRIMARY_DEFS) {
      // 一级入口本身（点它就落到该一级上次停留的子项）
      nav.PRIMARY_DEFS.forEach((p) => out.push(goPrimary(p.key, p.label)));
      // 12 个子项（一级 · 子项），文案与顶栏二级条一致
      nav.PRIMARY_DEFS.forEach((p) => {
        p.children.forEach((k) => {
          const label = (global.TabScope && global.TabScope.labelOf(k)) || k;
          // 一级与子项同名时（事件/事件）不重复写两级，只留一个词
          const text = label === p.label ? label : p.label + ' · ' + label;
          out.push(goTab(k, text, p.label));
        });
      });
    }

    const ops = [
      { label: '指标设置', hint: '打开指标菜单', run() { if (app) app.openIndicator(''); } },
      { label: '成交量副图', hint: '开指标 · 成交量', run() { if (app) app.openIndicator('vol'); } },
      { label: 'RSI 副图', hint: '开指标 · RSI', run() { if (app) app.openIndicator('rsi'); } },
      { label: 'MACD 副图', hint: '开指标 · MACD', run() { if (app) app.openIndicator('macd'); } },
      { label: '切换为日光模式', hint: 'daylight', run() { if (app) app.setTheme('daylight'); } },
      { label: '切换为深空模式', hint: 'nexus', run() { if (app) app.setTheme('nexus'); } },
      { label: '一键切换模式', hint: '深空 ⇄ 日光', run() { if (app) app.toggleTheme(); } },
      { label: '立即刷新行情', hint: '重新抓一轮（等同下个轮询）', run() { if (app) app.refresh(); } },
      { label: '导出快照', hint: '下载 JSON（设置/自选/情绪历史）', run() { if (app) app.exportSnapshot(); } },
      { label: '打开设置', hint: '模式 / 涨跌 / 刷新 / 板块', run() { const b = $('settingsBtn'); if (b) b.click(); } },
    ];
    ops.forEach((o) => {
      out.push({
        kind: 'cmd', group: '操作', label: o.label, hint: o.hint,
        py: initialsOf(o.label), symbol: '', code: '', run: o.run,
      });
    });
    return out;
  }

  function buildAll(query) {
    const q = String(query || '').trim();
    const cmds = buildCommands();
    const locals = buildLocalSymbols();
    if (!q) {
      // 空查询：给"导航优先"的默认列表 + 操作，标的让用户开始打字再出现
      return cmds.filter((c) => c.group === '导航').slice(0, 14)
        .concat(cmds.filter((c) => c.group === '操作'));
    }
    const scored = [];
    cmds.forEach((c) => { const s = score(q, c); if (s) scored.push({ item: c, s }); });
    locals.forEach((c) => { const s = score(q, c); if (s) scored.push({ item: c, s }); });
    remoteItems.forEach((c) => { const s = score(q, c); if (s) scored.push({ item: c, s }); });
    // 功能命令排在标的之前（命令面板的约定：先给"能做的事"，再给"能看的标的"），
    // 组内仍按相关度。否则输入「日光」会被「日光控股」这类标的抢走默认选中项。
    scored.sort((a, b) => {
      const tier = (x) => (x.item.kind === 'cmd' ? 0 : 1);
      return (tier(a) - tier(b)) || (b.s - a.s);
    });
    const seen = new Set();
    const out = [];
    for (const x of scored) {
      // 同一只标的有两份来源（本地词典 / 东财远程）：代码相同即视为同一条，
      // 保留打分更高的那份（本地带 market，标签更有用）
      const key = x.item.kind === 'symbol'
        ? 'symbol|' + (x.item.code || x.item.symbol || x.item.label)
        : 'cmd|' + x.item.label;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x.item);
      if (out.length >= ITEM_LIMIT) break;
    }
    return out;
  }

  /* ==================== 渲染 ==================== */

  function tagOf(item) {
    if (item.kind === 'symbol') return item.market ? (MARKET_LABEL[item.market] || item.market) : '标的';
    return item.group || '命令';
  }

  function render(query) {
    items = buildAll(query);
    if (!list) return;
    const html = [];
    let lastGroup = '';
    items.forEach((item, i) => {
      const g = item.kind === 'symbol' ? '标的' : (item.group || '命令');
      if (g !== lastGroup) {
        html.push('<div class="cmd-group-label" role="presentation">' + g + '</div>');
        lastGroup = g;
      }
      const meta = item.kind === 'symbol'
        ? (item.code ? String(item.code) : '')
        : (item.hint || '');
      // 命令的分组已经在组标题里了（导航/操作），行内再挂一枚「导航」只是噪音；
      // 标的的 tag 是市场归属（A股/港股/美股…），扫读时有信息量，保留。
      const tag = item.kind === 'symbol' ? '<span class="cmd-item-tag">' + tagOf(item) + '</span>' : '';
      html.push(
        '<div class="cmd-item" id="cmd-opt-' + i + '" role="option" aria-selected="false" data-idx="' + i + '">'
        + tag
        + '<span class="cmd-item-label">' + esc(item.label) + '</span>'
        + '<span class="cmd-item-meta">' + esc(meta) + '</span>'
        + '</div>');
    });
    list.innerHTML = html.join('');
    const scroller = list.parentElement;
    if (scroller && scroller.classList && scroller.classList.contains('cmd-scroll')) scroller.scrollTop = 0;
    sel = items.length ? 0 : -1;
    paint();
    if (emptyHint) emptyHint.hidden = items.length > 0;
    if (input) {
      input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
      if (sel >= 0) input.setAttribute('aria-activedescendant', 'cmd-opt-' + sel);
      else input.removeAttribute('aria-activedescendant');
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function paint() {
    if (!list) return;
    const nodes = list.querySelectorAll('.cmd-item');
    for (let i = 0; i < nodes.length; i++) {
      const on = i === sel;
      nodes[i].classList.toggle('sel', on);
      nodes[i].setAttribute('aria-selected', String(on));
    }
    const cur = sel >= 0 ? list.querySelector('[data-idx="' + sel + '"]') : null;
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 老浏览器忽略 */ }
    }
    if (input) {
      if (cur) input.setAttribute('aria-activedescendant', cur.id);
      else input.removeAttribute('aria-activedescendant');
    }
  }

  function move(delta) {
    if (!items.length) return;
    sel = (sel + delta + items.length) % items.length;
    paint();
  }

  function runItem(i) {
    const item = items[i];
    if (!item) return;
    closePalette();
    if (item.kind === 'symbol') {
      if (global.AppNav && global.AppNav.openSymbol) global.AppNav.openSymbol(item);
    } else if (typeof item.run === 'function') {
      item.run();
    }
  }

  /* ==================== 远程搜索（增强项，失败静默退化） ==================== */
  function scheduleRemote(q) {
    clearTimeout(remoteTimer);
    if (!q || !global.AppNav || !global.AppNav.searchSymbols) return;
    const mySeq = ++remoteSeq;
    remoteTimer = setTimeout(() => {
      Promise.resolve(global.AppNav.searchSymbols(q)).then((rows) => {
        if (mySeq !== remoteSeq || !isOpen) return;
        remoteItems = (rows || []).slice(0, 12).map((x) => {
          const label = x.name || x.code || '';
          const symbol = x.symbol || (x.secid ? 'EM:' + x.secid : '');
          return {
            kind: 'symbol', group: '标的', label: label,
            code: x.code || guessCode(symbol, x.secid), symbol: symbol, secid: x.secid || '',
            market: x.market || '', py: initialsOf(label),
          };
        });
        render(input ? input.value : '');
      }).catch(() => {});
    }, REMOTE_DEBOUNCE);
  }

  /* ==================== 开关与键盘 ==================== */

  function openPalette() {
    if (isOpen) return;
    isOpen = true;
    remoteItems = [];
    clearTimeout(remoteTimer);
    if (!host) return;
    host.hidden = false;
    document.body.classList.add('modal-open');
    // display 从 none 变成 block 不触发 transition：强制一帧 reflow 再加 .is-open
    void host.offsetWidth;
    host.classList.add('is-open');   // 强制过一帧 reflow 后同帧加类，transition 才会跑
    if (input) { input.value = ''; input.setAttribute('aria-expanded', 'false'); }
    render('');
    if (global.FocusTrap) {
      trap = global.FocusTrap.open(panel, { initialFocus: input, onEscape: closePalette });
    }
    if (input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  function closePalette() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(remoteTimer);
    if (host) host.classList.remove('is-open');
    if (trap) { trap.close(); trap = null; }
    document.body.classList.remove('modal-open');
    if (input) input.setAttribute('aria-expanded', 'false');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    // 等收起动效走完再 display:none（motion 层的 --ease-exit 是 .2s）
    setTimeout(() => { if (!isOpen && host) host.hidden = true; }, 220);
  }

  function togglePalette() { if (isOpen) closePalette(); else openPalette(); }

  function onInput() {
    const q = input ? input.value.trim() : '';
    render(q);
    scheduleRemote(q);
  }

  function onKeydown(e) {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    if (e.key === 'Home') { e.preventDefault(); sel = items.length ? 0 : -1; paint(); return; }
    if (e.key === 'End') { e.preventDefault(); sel = items.length - 1; paint(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0) runItem(sel); return; }
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
  }

  function bind() {
    host = $('cmdPalette');
    panel = $('cmdPanel');
    input = $('cmdInput');
    list = $('cmdList');
    emptyHint = $('cmdEmpty');
    trigger = $('cmdOpen');
    if (!host || !panel || !input || !list) return;

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    // 点击执行（pointerdown 而不是 click：焦点陷阱/关闭时序下 click 更易被吞）
    list.addEventListener('click', (e) => {
      const node = e.target.closest && e.target.closest('.cmd-item');
      if (!node) return;
      runItem(+node.getAttribute('data-idx'));
    });
    list.addEventListener('mousemove', (e) => {
      const node = e.target.closest && e.target.closest('.cmd-item');
      if (!node) return;
      const i = +node.getAttribute('data-idx');
      if (i !== sel) { sel = i; paint(); }
    });
    const scrim = $('cmdScrim');
    if (scrim) scrim.addEventListener('click', closePalette);
    if (trigger) trigger.addEventListener('click', openPalette);

    // 全局快捷键：⌘K / Ctrl+K。输入框里也生效（命令面板要能随时唤起）。
    document.addEventListener('keydown', (e) => {
      const k = e.key && e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        togglePalette();
      }
    });
    // 触发按钮可被脚本点击；打开状态下点外面由遮罩负责，Esc 由焦点陷阱负责
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  global.CommandPalette = {
    open: openPalette,
    close: closePalette,
    toggle: togglePalette,
    isOpen: () => isOpen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
