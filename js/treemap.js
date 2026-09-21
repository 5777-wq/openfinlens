/* treemap.js —— squarify 布局 + canvas 渲染 + 缩放平移 + hover 浮层（自实现，不引 d3）
   说明：文档 5.3 给的简化两段切割版在 ~5000 块时纵横比失控（长条状不可读），
   这里按标准 squarify（Bruls 2000）实现同一接口 squarify(items,x,y,w,h)，
   仍为纯手写、无依赖，视觉与性能都达标。

   视口模型（支持滚轮缩放 / 拖拽平移，用户反馈小块看不清字）：
     屏幕 = (布局 - 偏移) × 缩放      sx = (lx - ox) * zoom
     布局 = 屏幕 / 缩放 + 偏移        lx = sx / zoom + ox
   zoom=1 时 ox=oy=0（贴边钳制）。缩放锚点是光标位置；拖拽超过阈值后抑制 click。
   拖拽为抓取语义（内容跟手，ox -= dx/z）；右键复位（dblclick 因单击即进详情而不可达）。 */

const Treemap = (() => {
  /* ---- 视口数学（纯函数，便于单测）----
     屏↔布局映射：sx = (lx - ox) * z，反演 lx = sx / z + ox。
     抓取语义（内容跟手）：拖右 dx>0 时内容右移，视口原点应 ox -= dx/z。
     之前写成 ox += dx/z，拖动方向整体反了（"推纸"而非"抓纸"）。 */
  function clamp(v, w, h) {
    v.zoom = Math.min(ZOOM_MAX, Math.max(1, v.zoom));
    const maxX = Math.max(0, w * (1 - 1 / v.zoom));
    const maxY = Math.max(0, h * (1 - 1 / v.zoom));
    v.ox = Math.min(maxX, Math.max(0, v.ox));
    v.oy = Math.min(maxY, Math.max(0, v.oy));
    return v;
  }

  // 以屏幕点 (px,py) 为锚缩放 factor 倍；锚点下的布局点在缩放前后保持在同一屏幕位置
  function applyZoom(v, px, py, factor, w, h) {
    const old = v.zoom;
    v.zoom = Math.min(ZOOM_MAX, Math.max(1, old * factor));
    if (v.zoom === old) return v;
    v.ox = px / old - px / v.zoom + v.ox;
    v.oy = py / old - py / v.zoom + v.oy;
    return clamp(v, w, h);
  }

  function applyPan(v, dx, dy, w, h) {
    v.ox -= dx / v.zoom;   // 抓取语义：跟手（此前 + 号方向相反）
    v.oy -= dy / v.zoom;
    return clamp(v, w, h);
  }

  const ZOOM_MAX = 12;

  // ---------- 布局 ----------
  function squarify(items, x, y, w, h) {
    const out = [];
    const list = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    if (!list.length || w <= 0 || h <= 0) return out;

    const total = list.reduce((s, i) => s + i.value, 0);
    const scale = (w * h) / total;           // value → 像素面积
    let idx = 0;
    let rx = x, ry = y, rw = w, rh = h;

    while (idx < list.length) {
      const shortSide = Math.min(rw, rh);
      if (shortSide <= 0) break;
      const row = [];
      let rowSum = 0;
      let bestRatio = Infinity;

      // 贪心往当前行加块，直到纵横比变差
      while (idx + row.length < list.length) {
        const v = list[idx + row.length].value;
        const nextSum = rowSum + v;
        const ratio = rowRatio(row.concat(v), nextSum, shortSide, scale);
        if (row.length && ratio > bestRatio) break;
        row.push(v);
        rowSum = nextSum;
        bestRatio = ratio;
      }

      // 铺这一行
      const thick = (rowSum * scale) / shortSide;
      let cur = 0;
      const horiz = rw >= rh;               // 长边水平 → 行竖着切（纵向条带）
      for (let k = 0; k < row.length; k++) {
        const cell = (row[k] * scale) / thick;
        const item = list[idx + k];
        if (horiz) out.push({ x: rx, y: ry + cur, w: thick, h: cell, item });
        else out.push({ x: rx + cur, y: ry, w: cell, h: thick, item });
        cur += cell;
      }
      idx += row.length;
      if (horiz) { rx += thick; rw -= thick; }
      else { ry += thick; rh -= thick; }
      if (rw <= 0.5 || rh <= 0.5) break;
    }
    return out;

    function rowRatio(vals, sum, side, sc) {
      const thickness = (sum * sc) / side;
      if (thickness <= 0) return Infinity;
      let worstR = 0;
      for (const v of vals) {
        const len = (v * sc) / thickness;
        const r = len > 0 ? Math.max(thickness / len, len / thickness) : Infinity;
        if (r > worstR) worstR = r;
      }
      return worstR;
    }
  }

  // ---------- 色阶 ----------
  function hexToRgb(hex) {
    const s = String(hex).trim().replace('#', '');
    const n = s.length === 3
      ? s.split('').map(c => c + c).join('')
      : s.slice(0, 6);
    const v = parseInt(n, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  let _cs = { up: [255, 92, 92], down: [46, 189, 133] };
  let _csDirty = true;   // 脏标记：paint 不每帧读 getComputedStyle，仅首次与红绿切换时刷新
  function refreshColors() {
    const st = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const up = (body.getPropertyValue('--up') || st.getPropertyValue('--up')).trim();
    const down = (body.getPropertyValue('--down') || st.getPropertyValue('--down')).trim();
    if (up) _cs.up = hexToRgb(up);
    if (down) _cs.down = hexToRgb(down);
    _csDirty = false;
  }

  // 涨跌幅 → 颜色（±3% 封顶，从 #333 线性插值到涨/跌色）
  function pctColor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '#222';
    const t = Math.max(-3, Math.min(3, pct)) / 3;
    const to = t >= 0 ? _cs.up : _cs.down;
    const from = [51, 51, 51];
    const a = Math.abs(t);
    const c = from.map((f, i) => Math.round(f + (to[i] - f) * a));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // ---------- 渲染 + 视口 ----------
  // items: [{ name, code, value(面积权重), pct, price, payload }]
  function create(canvas, { onClick, onViewportChange, iconFor } = {}) {
    const ctx = canvas.getContext('2d', { alpha: false });
    let layout = [];
    let data = [];
    let dpr = 1;
    let hoverIdx = -1;
    let rafId = 0;
    const view = { zoom: 1, ox: 0, oy: 0 };   // 偏移为"布局坐标原点"，向右下为正
    let dragged = false;

    const withRect = (fn) => {
      const rect = canvas.getBoundingClientRect();
      fn(rect.width, rect.height);
    };

    function resize() {
      const rect = canvas.getBoundingClientRect();
      // 板块不可见（display:none / hidden）时 rect 为 0：跳过，否则画布被打成 1×1、
      // 布局清空，回到该板块后黑屏/命中错位（要等下一次刷新才恢复）
      if (rect.width < 2 || rect.height < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      withRect((w, h) => clamp(view, w, h));
      relayout();
    }

    let dropped = 0;   // 排布时被 <0.5px 剩余矩形丢弃的尾部标的数（UI 据此提示"另有 N 只"）
    function relayout() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;   // 不可见时保留旧布局
      layout = squarify(data, 0, 0, rect.width, rect.height);
      dropped = data.length - layout.length;
      draw();
    }

    function setData(items) {
      data = items.map(it => Object.assign({}, it, { value: Math.max(it.value || 0, 0.0001) }));
      hoverIdx = -1;      // 重排后 layout 已变，旧 hover 会把白框画在别的票上
      preloadIcons();
      relayout();
    }

    // LOGO 预加载（加密图标等）：加载完成触发一次重绘把图标画上
    const imgCache = new Map();
    function iconImg(item) {
      if (!iconFor) return null;
      const url = iconFor(item);
      if (!url) return null;
      let img = imgCache.get(url);
      if (!img) {
        img = new Image();
        img.onload = () => draw();
        img.src = url;
        imgCache.set(url, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    }

    function preloadIcons() {
      if (!iconFor) return;
      data.forEach(it => iconImg(it));
    }

    // 刷新只换色换价、不重排（文档要求"只换色不闪白"）
    // rows: [{ code, price, changePct }] —— 顺带更新 price 与 payload，否则浮层/点击会一直用 30s 前的数据
    function updatePct(rows) {
      const map = {};
      (rows || []).forEach(r => { if (r && r.code) map[r.code] = r; });
      layout.forEach(cell => {
        const r = map[cell.item.code];
        if (!r) return;
        if (r.changePct !== undefined) cell.item.pct = r.changePct;
        if (r.price !== undefined) cell.item.price = r.price;
        if (cell.item.payload) {
          if (r.changePct !== undefined) cell.item.payload.changePct = r.changePct;
          if (r.price !== undefined) cell.item.payload.price = r.price;
        }
      });
      draw();
    }

    function resetView() {
      view.zoom = 1; view.ox = 0; view.oy = 0;
      canvas.style.cursor = 'default';
      draw();
      if (onViewportChange) onViewportChange(view);
    }

    function zoomAt(px, py, factor) {
      withRect((w, h) => applyZoom(view, px, py, factor, w, h));
      canvas.style.cursor = view.zoom > 1 ? 'grab' : 'default';   // 缩回 ×1 后不该还是"可抓取"态
      draw();
      if (onViewportChange) onViewportChange(view);
    }

    function panBy(dx, dy) {
      withRect((w, h) => applyPan(view, dx, dy, w, h));
      draw();
      if (onViewportChange) onViewportChange(view);
    }

    function draw() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        paint();
      });
    }

    function paint() {
      if (_csDirty) refreshColors();   // 仅脏时读计算样式（hover 60fps 下不再每帧强制样式重算）
      ctx.save();
      ctx.scale(dpr, dpr);
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);

      const z = view.zoom;

      for (let i = 0; i < layout.length; i++) {
        const c = layout[i];
        const sx = (c.x - view.ox) * z, sy = (c.y - view.oy) * z;
        const sw = c.w * z, sh = c.h * z;
        // 视口裁剪：放大后绝大多数块在屏外，直接跳过
        if (sx + sw < 0 || sy + sh < 0 || sx > W || sy > H) continue;
        const w = Math.max(0, sw - 1), h = Math.max(0, sh - 1);
        if (w < 0.7 || h < 0.7) continue;
        ctx.fillStyle = pctColor(c.item.pct);
        // 2px 圆角（密集排布），太小的块直接矩形省算力
        if (w > 8 && h > 8) roundRect(ctx, sx, sy, w, h, 2);
        else ctx.fillRect(sx, sy, w, h);

        if (i === hoverIdx) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx + 0.75, sy + 0.75, w - 1.5, h - 1.5);
        }

        /* ---- 文字（TradingView 风格）：居中 + 字号随块面连续自适应，三级降级 ----
           两行（名称+涨幅）→ 一行（名称）→ 仅涨幅数字；块面小于 13px 才退为纯色块。
           字号由块的短边决定而非全局常量：大块大字、小块小字，缩小也有信息量。 */
        const base = Math.min(w, h);
        if (base < 13) continue;
        const item = c.item;
        const pctTxt = item.pct === null || item.pct === undefined || isNaN(item.pct) ? '--'
          : (item.pct > 0 ? '+': '') + item.pct.toFixed(2) + '%';
        const cx = sx + w / 2, cy = sy + h / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 一级：两行居中（名称 + 涨跌幅），字号受宽高双重约束
        let s = Math.max(9, Math.min(base * 0.17, 30));
        const icon = iconFor ? iconImg(item) : null;
        const nameFits = w >= 44;
        if (nameFits && h >= s * 2.55) {
          ctx.font = `600 ${s}px -apple-system, "PingFang SC", sans-serif`;
          const name = fitText(ctx, item.name, w - 10);
          ctx.fillStyle = 'rgba(255,255,255,0.96)';
          const nameW = Math.min(ctx.measureText(name).width, w - 10);
          if (icon && w >= 78) {
            const totalW = 16 + 6 + nameW;
            const ix = cx - totalW / 2;
            ctx.drawImage(icon, ix, cy - s * 1.15, 16, 16);
            // 名称必须改左对齐：textAlign 仍是 center 时名称中心落在 ix+22，
            // 左半截直接压在 logo 上（用户截图实锤的"logo 和文字重叠"）
            ctx.textAlign = 'left';
            ctx.fillText(name, ix + 22, cy - s * 0.62);
            ctx.textAlign = 'center';
          } else {
            ctx.fillText(name, cx, cy - s * 0.62);
          }
          ctx.fillStyle = 'rgba(255,255,255,0.82)';
          ctx.font = `${Math.max(8, Math.round(s * 0.82))}px ui-monospace, Menlo, monospace`;
          ctx.fillText(pctTxt, cx, cy + s * 0.75);
          continue;
        }

        // 二级：单行名称，字号贴着块高走
        const s1 = Math.max(8, Math.min(base * 0.34, 15));
        if (w >= 30 && h >= s1 + 3) {
          ctx.fillStyle = 'rgba(255,255,255,0.94)';
          ctx.font = `500 ${s1}px -apple-system, "PingFang SC", sans-serif`;
          ctx.fillText(fitText(ctx, item.name, w - 5), cx, cy);
          continue;
        }

        // 三级：只放得下一个数字——画涨幅（比名称信息量大），8px 是可辨认下限
        if (w >= 21 && h >= 9) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '8px ui-monospace, Menlo, monospace';
          ctx.fillText(pctTxt, cx, cy);
        }
      }
      ctx.restore();
    }

    function roundRect(g, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h, rr);
      g.arcTo(x + w, y + h, x, y + h, rr);
      g.arcTo(x, y + h, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
      g.fill();
    }

    function fitText(g, text, maxW) {
      if (g.measureText(text).width <= maxW) return text;
      let s = text;
      while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    }

    // 命中测试：屏幕坐标 → 布局坐标（缩放拖拽后仍然正确）
    function hitTest(px, py) {
      const lx = px / view.zoom + view.ox;
      const ly = py / view.zoom + view.oy;
      for (let i = 0; i < layout.length; i++) {
        const c = layout[i];
        if (lx >= c.x && lx <= c.x + c.w && ly >= c.y && ly <= c.y + c.h) return i;
      }
      return -1;
    }

    function setHover(i) {
      if (i === hoverIdx) return;
      hoverIdx = i;
      draw();
    }

    /* ---- 交互：滚轮缩放 / 拖拽平移 / 右键复位 / 触屏单指拖 + 双指捏合 ---- */
    canvas.addEventListener('wheel', (e) => {
      const factor = Math.exp(-e.deltaY * 0.0016);
      // 已是最小倍率再往下滚：不吞事件，放行页面滚动（否则光标悬在图上页面滚不动）
      if (view.zoom <= 1 && factor < 1) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    let pan = null;      // { x, y }   上一个采样点
    let panStart = null; // { x, y }   按下起点（阈值按累计位移算，慢拖不误触 click）
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      pan = { x, y };
      panStart = { x, y };
      dragged = false;
      canvas.style.cursor = 'grabbing';
      // 指针捕获：把后续 mousemove/mouseup 钉在 canvas 上。裸 window 监听时，拖出浏览器
      // 窗口外松开 mouseup 会丢——pan 永不清空，热力图跟着无按键的鼠标平移、且 dragged
      // 卡 true 把点击全吞掉。捕获后窗口外的 mouseup 也会派发到 canvas（再冒泡到 window）。
      if (canvas.setPointerCapture && e.pointerId !== undefined) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* 鼠标已抬起的边缘态，忽略 */ }
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!pan) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const dx = mx - pan.x, dy = my - pan.y;
      // 阈值按"自按下起的累计位移"：按单次 move 增量算，20 次 ×3px 的慢拖永远不会触发平移，
      // 且松手后 click 不被抑制 → 误开详情
      if (!dragged && Math.abs(mx - panStart.x) + Math.abs(my - panStart.y) > 4) {
        dragged = true;
        pan = { x: mx, y: my };   // 越过阈值那一刻重置基准，避免第一跳跳动
      }
      if (dragged && (dx || dy)) panBy(dx, dy);
      pan = { x: mx, y: my };
    });
    window.addEventListener('mouseup', () => {
      pan = null;
      canvas.style.cursor = view.zoom > 1 ? 'grab' : 'default';
    });

    // 复位：右键（桌面）。原 dblclick 实际不可达——单击色块立刻切详情、热力图区被隐藏，
    // 第二次点击落不到 canvas 上；触屏/习惯按钮的用户走"复位 ×N"按钮。
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      resetView();
    });

    canvas.addEventListener('click', (e) => {
      if (dragged) { dragged = false; return; }   // 拖拽结束不算点击
      const rect = canvas.getBoundingClientRect();
      const i = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (i >= 0 && onClick) onClick(layout[i].item);
    });

    // 触屏：单指平移（350ms 长按浮层逻辑由外部绑定），双指捏合缩放
    let touch = null;
    const tpos = (t, r) => ({ x: t.clientX - r.left, y: t.clientY - r.top });
    canvas.addEventListener('touchstart', (e) => {
      const r = canvas.getBoundingClientRect();
      if (e.touches.length === 1) {
        const p = tpos(e.touches[0], r);
        touch = { mode: 'pan', x: p.x, y: p.y, sx: p.x, sy: p.y, dist: 0 };
        dragged = false;
      } else if (e.touches.length === 2) {
        const [a, b] = e.touches;
        const mp = tpos({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }, r);
        touch = {
          mode: 'pinch',
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          mx: mp.x, my: mp.y,
        };
        dragged = false;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!touch) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (touch.mode === 'pan' && e.touches.length === 1) {
        const p = tpos(e.touches[0], r);
        const dx = p.x - touch.x, dy = p.y - touch.y;
        if (!dragged && Math.abs(p.x - touch.sx) + Math.abs(p.y - touch.sy) > 4) {
          dragged = true;
          touch.x = p.x; touch.y = p.y;
        }
        if (dragged && (dx || dy)) panBy(dx, dy);
        touch.x = p.x; touch.y = p.y;
      } else if (touch.mode === 'pinch' && e.touches.length === 2) {
        const [a, b] = e.touches;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (touch.dist > 0) {
          const mp = tpos({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }, r);
          zoomAt(mp.x, mp.y, dist / touch.dist);
        }
        touch.dist = dist;
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (!touch) return;
      // 捏合后抬起一指：剩余手指无缝转为单指平移（原实现直接清状态，手势整体死亡）
      if (touch.mode === 'pinch' && e.touches.length === 1) {
        const r = canvas.getBoundingClientRect();
        const p = tpos(e.touches[0], r);
        touch = { mode: 'pan', x: p.x, y: p.y, sx: p.x, sy: p.y, dist: 0 };
      } else if (e.touches.length === 0) {
        touch = null;
      }
    });

    return {
      setData, updatePct, resize, draw, hitTest, setHover,
      resetView, zoomAt,
      get zoomLevel() { return view.zoom; },
      get isDragged() { return dragged; },
      cellAt(i) { return layout[i]; },
      get count() { return layout.length; },
      get droppedCount() { return dropped; },   // 剩余矩形 <0.5px 被丢的尾部标的数
    };
  }

  return { create, squarify, pctColor, refreshColors,
    // 视口纯函数（单测用）：语义见文件头注释
    viewport: { clamp, applyZoom, applyPan, ZOOM_MAX } };
})();

window.Treemap = Treemap;
