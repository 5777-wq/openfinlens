/* alerts.js —— 到价提醒（2026-09-17）
   TradingView 的"价格告警"本地版：规则存 localStorage（Store.alerts），行情 tick 里判定；
   命中时页面内 toast + 浏览器 Notification（需用户在面板里授权一次）。
   已知边界（面板里如实标注）：后台标签页时轮询暂停（visibilitychange 暂停调度），
   提醒只在看板开着时生效——没有推送服务器，不冒充有。
   结构仿 CompareView：视图模块自持 DOM，app.js 在 init 时把节点与依赖注入（mount）。 */

const AlertCenter = (() => {
  let els = {};      // mount 时注入的节点表
  let deps = {};     // { findQuote, openDetail, targetFromSymbol, getDetail }
  let chartBinding = null;   // { chartApi, symbol }（K线上的提醒价格线）
  let priceLines = [];
  let _toastTimer = null;
  let _toastNode = null;
  let _trap = null;  // 弹层的焦点陷阱（js/focus-trap.js：进焦点 / Tab 循环 / 退出还焦点）

  const esc = (s) => window.U ? window.U.escapeHTML(String(s ?? '')) : String(s ?? '');

  /* ---------- 面板渲染 ---------- */

  function fmtAlertPrice(v) {
    const n = Number(v);
    return Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toFixed(0) : String(n)) : String(v);
  }

  function renderBadge() {
    if (!els.badge) return;
    const n = window.Store.alerts.active().length;
    els.badge.hidden = n === 0;
    els.badge.textContent = String(n);
  }

  function renderPanel() {
    if (!els.list) return;
    const all = window.Store.alerts.all();
    const active = all.filter(a => !a.triggeredAt);
    const done = all.filter(a => a.triggeredAt).sort((a, b) => b.triggeredAt - a.triggeredAt);
    if (!all.length) {
      els.list.innerHTML = '<div class="al-empty">还没有提醒。打开任意标的的 K 线，点「提醒」即可在价格线上立一个触发价。</div>';
    } else {
      els.list.innerHTML =
        active.map(rowHTML).join('') +
        (done.length ? '<div class="al-cap">已触发</div>' + done.map(rowHTML).join('') : '');
    }
    if (els.hint) {
      els.hint.textContent = '提醒在页面打开时生效（后台标签页轮询自动暂停）。' +
        (window.Notification && Notification.permission === 'granted'
          ? '浏览器通知已开启。'
          : '开启浏览器通知后，切到别的窗口也能收到。');
    }
    if (els.perm) {
      els.perm.hidden = !window.Notification || Notification.permission === 'granted' || !all.length;
    }
    renderBadge();
  }

  function rowHTML(a) {
    const dirTxt = a.dir === 'above' ? '≥' : '≤';
    const cls = a.dir === 'above' ? 'up' : 'down';
    const meta = a.triggeredAt
      ? `${dirTxt} ${fmtAlertPrice(a.price)} · 触发于 ${new Date(a.triggeredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}（现价 ${fmtAlertPrice(a.triggeredPrice)}）`
      : `${dirTxt} ${fmtAlertPrice(a.price)}${a.note ? ' · ' + esc(a.note) : ''}`;
    return `<div class="al-row${a.triggeredAt ? ' hit' : ''}" data-alert-id="${esc(a.id)}" role="button" tabindex="0" title="${esc(a.name)} · ${meta}">
      <span class="al-sym">${esc(a.name)}</span>
      <span class="al-cond num ${cls}">${meta}</span>
      <button class="al-del" data-alert-del="${esc(a.id)}" title="删除提醒" aria-label="删除提醒">×</button>
    </div>`;
  }

  /* ---------- 判定 ---------- */

  function check() {
    if (!deps.findQuote || !els.panel) return;
    let hitAny = false;
    window.Store.alerts.all().forEach(a => {
      if (a.triggeredAt) return;
      const q = deps.findQuote(a.symbol);
      if (!q || q.price === null || q.price === undefined || !isFinite(q.price)) return;
      const hit = a.dir === 'above' ? q.price >= a.price : q.price <= a.price;
      if (!hit) return;
      window.Store.alerts.update(a.id, { triggeredAt: Date.now(), triggeredPrice: q.price });
      hitAny = true;
      notify(a, q.price);
    });
    if (hitAny) { renderPanel(); applyChartLines(); }
  }

  function notify(a, price) {
    const dirTxt = a.dir === 'above' ? '上穿' : '下穿';
    toast(`${a.name} ${dirTxt} ${fmtAlertPrice(a.price)} · 现价 ${fmtAlertPrice(price)}`);
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('OpenFinLens · 到价提醒', {
          body: `${a.name} ${dirTxt} ${fmtAlertPrice(a.price)}（现价 ${fmtAlertPrice(price)}）`,
          tag: a.id,
        });
      }
    } catch { /* 通知构造失败不拖垮行情 tick */ }
  }

  function toast(msg) {
    if (!els.toastRoot) return;
    if (!_toastNode) {
      _toastNode = document.createElement('div');
      _toastNode.className = 'ofl-toast';
      els.toastRoot.appendChild(_toastNode);
    }
    _toastNode.textContent = msg;
    _toastNode.classList.add('on');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => _toastNode.classList.remove('on'), 5200);
  }

  /* ---------- K 线价格线 ---------- */

  function cssVar(name, fallback) {
    const v = (getComputedStyle(document.body).getPropertyValue(name) || '').trim();
    return v || fallback;
  }

  function attachChart(chartApi, target) {
    chartBinding = (chartApi && chartApi.candle && target)
      ? { chartApi, symbol: target.symbol }
      : null;
    applyChartLines();
  }

  function applyChartLines() {
    if (priceLines.length && chartBinding) {
      const s = chartBinding.chartApi.candle;
      priceLines.forEach(pl => { try { s.removePriceLine(pl); } catch { /* 图表已销毁 */ } });
    }
    priceLines = [];
    if (!chartBinding) return;
    const s = chartBinding.chartApi.candle;
    window.Store.alerts.all().forEach(a => {
      if (a.triggeredAt || a.symbol !== chartBinding.symbol) return;
      try {
        priceLines.push(s.createPriceLine({
          price: a.price,
          color: a.dir === 'above' ? cssVar('--accent-signature', '#e8a33d') : cssVar('--ma-1', '#5b8def'),
          lineWidth: 1,
          lineStyle: 2,   // dashed
          axisLabelVisible: true,
          title: a.dir === 'above' ? '提醒≥' : '提醒≤',
        }));
      } catch { /* 旧版系列不支持价格线 */ }
    });
  }

  /* ---------- 创建弹层 ---------- */

  function openCreate() {
    const t = deps.getDetail && deps.getDetail();
    if (!t || !els.modal) return;
    if (els.target) els.target.textContent = (t.name || t.code || t.symbol) + '（' + (t.code || '') + '）';
    const q = deps.findQuote ? deps.findQuote(t.symbol) : null;
    // undefined 也要挡：行情对象存在但没带 price 字段时，String(undefined) 会把字面
    // "undefined" 填进输入框（check() 里有同款防护，这里补齐）
    const cur = q && q.price !== null && q.price !== undefined ? q.price : null;
    if (els.price) els.price.value = cur !== null ? String(cur) : '';
    if (els.note) els.note.value = '';
    els.modal.classList.add('active');
    document.body.classList.add('modal-open');
    /* 焦点陷阱走公共实现（js/focus-trap.js，与设置弹层/分享弹层同一套）：
       原来这个弹层完全没有陷阱，Tab 会跑进背景的 K 线页；
       关掉后焦点掉到 body，键盘用户直接迷路。
       现在：焦点进「触发价」输入框，Tab 在弹层内循环，关掉后焦点还给「提醒」按钮。 */
    if (window.FocusTrap) {
      _trap = window.FocusTrap.open(els.modal, { initialFocus: els.price, onEscape: closeCreate });
    } else if (els.price) els.price.focus();
  }

  function closeCreate() {
    if (els.modal) els.modal.classList.remove('active');
    document.body.classList.remove('modal-open');
    if (_trap) { _trap.close(); _trap = null; }   // 关闭时把焦点还给触发点
  }

  function save() {
    const t = deps.getDetail && deps.getDetail();
    if (!t) return;
    const price = parseFloat(els.price && els.price.value);
    if (!Number.isFinite(price) || price <= 0) { toast('请先填一个有效的触发价'); return; }
    const dir = els.dir && els.dir.value === 'below' ? 'below' : 'above';
    window.Store.alerts.add({
      symbol: t.symbol, name: t.name || t.code || t.symbol, market: t.market,
      dir, price, note: (els.note && els.note.value || '').trim(),
    });
    closeCreate();
    renderPanel();
    applyChartLines();
    toast(`已创建提醒：${t.name || t.symbol} ${dir === 'above' ? '≥' : '≤'} ${fmtAlertPrice(price)}`);
  }

  /* ---------- 事件绑定 ---------- */

  /* 收起铃铛下拉：默认把焦点还给铃铛（键盘用户按 Esc 之后不至于迷路）。
     鼠标点外面收起时不要抢焦点——用户已经点到别处了。
     app.js 的 Esc 分支会调它——Esc 只关最上面那一层。 */
  function closePanel(opts) {
    if (!els.panel || els.panel.hidden) return;
    els.panel.hidden = true;
    if (els.bell) {
      els.bell.setAttribute('aria-expanded', 'false');
      if ((!opts || opts.focus !== false) && els.bell.focus) {
        try { els.bell.focus(); } catch (err) { /* 忽略 */ }
      }
    }
  }

  function bind() {
    if (els.bell) {
      els.bell.addEventListener('click', (e) => {
        e.stopPropagation();
        const show = els.panel.hidden;
        els.panel.hidden = !show;
        els.bell.setAttribute('aria-expanded', String(show));
        if (show) {
          renderPanel();
          // 下拉是个 role=dialog：打开后焦点要进去（键盘用户否则还留在铃铛上，
          // 不知道面板已经开了）；面板里没有可聚焦元素时落在面板本身。
          const list = (window.FocusTrap && window.FocusTrap.focusables)
            ? window.FocusTrap.focusables(els.panel) : [];
          const first = list[0] || els.panel;
          if (first && first.focus) { try { first.focus(); } catch (err) { /* 忽略 */ } }
        }
      });
    }
    // 点面板外收起
    document.addEventListener('click', (e) => {
      if (!els.panel || els.panel.hidden) return;
      if (e.target.closest && (e.target.closest('#alertPanel') || e.target.closest('#alertBell'))) return;
      closePanel({ focus: false });   // 鼠标点外面：不抢焦点
    });
    if (els.list) {
      els.list.addEventListener('click', (e) => {
        const del = e.target.closest && e.target.closest('[data-alert-del]');
        if (del) {
          e.stopPropagation();
          window.Store.alerts.remove(del.getAttribute('data-alert-del'));
          renderPanel();
          applyChartLines();
          return;
        }
        const row = e.target.closest && e.target.closest('[data-alert-id]');
        if (row && deps.openDetail && deps.targetFromSymbol) {
          const a = window.Store.alerts.all().find(x => x.id === row.getAttribute('data-alert-id'));
          if (a) {
            const t = deps.targetFromSymbol(a.symbol);
            if (t) {
              els.panel.hidden = true;
              deps.openDetail(t);
            }
          }
        }
      });
    }
    if (els.perm) {
      els.perm.addEventListener('click', () => {
        if (!window.Notification) { toast('这个浏览器不支持桌面通知'); return; }
        Notification.requestPermission().then(() => renderPanel());
      });
    }
    if (els.detailBtn) els.detailBtn.addEventListener('click', openCreate);
    if (els.cancel) els.cancel.addEventListener('click', closeCreate);
    if (els.save) els.save.addEventListener('click', save);
    if (els.modal) {
      els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeCreate(); });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // 弹层的 Esc 由焦点陷阱接管（捕获阶段就收走了），这里只是没有陷阱时的兜底
      if (els.modal && els.modal.classList.contains('active') && !_trap) closeCreate();
    });
  }

  function mount(nodes, dependencies) {
    els = nodes || {};
    deps = dependencies || {};
    bind();
    renderPanel();
  }

  return { mount, check, attachChart, applyChartLines, openCreate, closeCreate, closePanel, toast, isPanelOpen: () => !!(els.panel && !els.panel.hidden) };
})();

window.AlertCenter = AlertCenter;
