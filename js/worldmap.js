/* worldmap.js —— 平面世界地图（事件页 [3D 地球 | 平面地图] 二选一）
   底图投影与"跨 180° 经线"的切割交给 d3-geo（本地 vendor，无运行时 CDN）：
   geoEquirectangular 负责投影，geoPath 默认的 clipAntimeridian 在 ±180° 处
   把跨线几何切开，球面绕序决定哪一侧是多边形内部——孔洞天然正确。
   视觉与 3D 一致：暗色海洋 + 灰蓝陆地 + 类型色事件点；聚类复用 Events.cluster。
   交互：拖拽平移、滚轮缩放（围绕指针）、点击事件点/聚合簇、悬停提示。
   动画：rAF 单循环只服务选中脉冲与相机平移，静止即停；
   全程只操作 canvas 内部绘制，不碰 CSS width/height/top/left。 */

window.WorldMapView = (() => {
  const W = 360, H = 180;                       // 世界坐标域
  const escapeHTML = window.U.escapeHTML;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 唯一投影口径 ----------
     世界坐标 = 等距圆柱：x = lng + 180 (W/2)，y = 90 − lat (H/2 − lat)。
     底图（d3Proj/buildLandPath）与事件点（project）必须共用这一口径：
     曾经底图单独写成 lng + W，陆地整体东移 180°，点全落在海里。
     下面的 d3 投影参数刻意写成与 wx/wy 恒等（1 rad = 180/π 世界单位），
     单测里直接断言 proj(lng,lat) === [wx(lng), wy(lat)]。 */
  const wx = lng => lng + W / 2;
  const wy = lat => H / 2 - lat;

  let container = null, canvas = null, ctx = null, tip = null;
  let hooks = {};
  let land = null;                              // { path: Path2D, rings: n }
  let landFeatures = null;                      // Feature[]：空白点选的国家命中（点在多边形）用
  let events = [], clusters = [];
  let bucket = 10;                              // 聚类粒度（度），随缩放变细
  let selected = null, hover = null;
  let fit = 1, view = { s: 1, tx: 0, ty: 0 };
  let dpr = 1, raf = 0, pulseT0 = 0, camAnim = null;
  let drag = null, pinch = null, ready = false, failed = false;
  let resizeBound = null;
  let fontMono = 'monospace';                   // 帧循环里读 getComputedStyle 会强制样式重算，只取一次

  /* 图层注册表（ARCHITECTURE.md §10）：新图层 = 注册表加项 + render 加一段绘制，
     visible 由设置面板开关；land 是底图恒显，selection 只在有选中时才有意义 */
  const layers = { grid: true, points: true, selection: true };

  /* ---------- 几何：Feature[] → 世界坐标 Path2D ---------- */

  function d3Proj() {
    return window.d3.geoEquirectangular()
      .scale(180 / Math.PI)                     // 弧度 → 世界单位，1 rad = 180/π
      .translate([W / 2, H / 2]);               // → x = lng + 180，y = 90 − lat
  }

  function buildLandPath(features) {
    if (!window.d3 || !window.d3.geoPath || !window.d3.geoEquirectangular) return null;
    const path = new Path2D();
    let rings = 0, sample = null, nan = 0;
    const ok = (x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) return true;
      nan++;
      return false;
    };
    // d3 逐环调用 beginPath/moveTo/lineTo/closePath；Path2D 没有 beginPath，
    // 每环自然成为一个独立子路径，最后一次性 fill() 即得整张底图。
    const sink = {
      beginPath() {},
      moveTo(x, y) {
        if (!ok(x, y)) return;
        path.moveTo(x, y);
        if (!sample) sample = [Math.round(x), Math.round(y)];
      },
      lineTo(x, y) { if (ok(x, y)) path.lineTo(x, y); },
      closePath() { path.closePath(); rings++; },
      arc() {},                                  // 只画多边形，不需要点符号
    };
    window.d3.geoPath(d3Proj(), sink)({ type: 'FeatureCollection', features: features || [] });
    return rings ? { path, rings, sample, nan } : null;
  }

  /* ---------- 聚类 ---------- */

  function bucketForZoomAt(z) {
    if (z < 1.5) return 10;
    if (z < 2.6) return 6;
    if (z < 5) return 3;
    return 0;
  }

  function bucketForZoom() { return bucketForZoomAt(view.s / fit); }

  function regroup() {
    const prev = bucket;
    bucket = bucketForZoom();
    clusters = window.Events.cluster(events, bucket);
    clusters.forEach(c => {
      c.r = 3.6 + 1.7 * Math.min(4, Math.log2(c.count || 1));
    });
    return prev !== bucket;   // 聚类粒度变化时调用方应刷新状态行
  }

  /* 屏幕坐标每帧按当前视图重算。地图横向循环（陆地画多份世界副本），
     点必须规范到「离屏幕中心最近」的那个副本——否则拖过世界接缝后，
     点会留在另一个副本的天空上，看起来"标到了别的国家" */
  function wrapSx(sxRaw, span, cw) {
    return ((sxRaw - cw / 2) % span + span * 1.5) % span - span / 2 + cw / 2;
  }

  function project() {
    const span = W * view.s;
    const cw = canvas.width / dpr;
    clusters.forEach(c => {
      c.sx = wrapSx(wx(c.lng) * view.s + view.tx, span, cw);
      c.sy = wy(c.lat) * view.s + view.ty;
    });
  }

  /* 纵向边界：世界高于容器 → ty ∈ [ch-世界高, 0]（底对齐～顶对齐）；
     世界矮于容器（缩太小）→ 锁定垂直居中，不留上下黑边 */
  function clampTyVal(ty, ch, s) {
    const worldH = H * (s === undefined ? view.s : s);
    if (worldH >= ch) return clamp(ty, ch - worldH, 0);
    return (ch - worldH) / 2;
  }
  function clampTy(ty) {
    return clampTyVal(ty, container ? container.clientHeight : 0);
  }

  /* ---------- 视图 ----------
     初始 = 「一个世界横向铺满容器」（Leaflet 式 minZoom 概念）：
     s = cw/360，纵向居中或夹住——保证首屏恰好一个完整世界，绝不露出相邻副本的碎片。
     最小缩放 = 铺满宽度，缩不下去（再小接缝就会进画面）。 */

  function baseScale() {
    return container ? container.clientWidth / W : 1;
  }

  function resize() {
    if (!canvas || !container) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    fit = baseScale();
    if (ready) {
      view.s = Math.max(view.s, fit);
      view.tx = clampTx(view.tx);
      view.ty = clampTy(view.ty);
      regroup();
    }
    repaintNow();
  }

  function clampTx(tx) {
    // 横向自由循环，但世界副本整体不许离开视口（否则一侧全黑一侧重世界）
    const cw = container ? container.clientWidth : 0;
    const span = W * view.s;
    if (span <= cw) return (cw - span) / 2;
    return clamp(tx, cw - span, 0);
  }

  function fitView() {
    if (!container) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    fit = baseScale();
    view.s = fit;
    view.tx = 0;                                   // 横向恰好铺满
    view.ty = clampTyVal(0, ch);
  }

  function setCenter(wxp, wyp, targetS, animate) {
    const cw = container.clientWidth, ch = container.clientHeight;
    const s = clamp(targetS || view.s, fit, fit * 18);
    const to = { s, tx: clampTx(cw / 2 - wxp * s), ty: clampTy(ch / 2 - wyp * s) };
    if (!animate || reduceMotion()) {
      view = to; camAnim = null; regroup(); repaintNow(); return;
    }
    camAnim = { from: Object.assign({}, view), to, t0: performance.now(), dur: 500 };
    schedule();
  }

  /* ---------- 绘制 ---------- */

  function drawGrid(x0, x1, y0, y1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1 / view.s;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / 30) * 30; x <= x1; x += 30) {
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / 30) * 30; y <= y1; y += 30) {
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  function drawPoint(c, t) {
    ctx.beginPath();
    ctx.arc(c.sx, c.sy, c.r, 0, Math.PI * 2);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,15,0.85)';     // 深色描边把点从陆地纹理上衬出来
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (c.importance >= 3) {                    // high：外描环提示重要度
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, c.r + 2.4, 0, Math.PI * 2);
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (c.count > 1) {                          // 聚合数标
      ctx.font = '10px ' + fontMono;
      ctx.fillStyle = 'rgba(242,242,240,0.78)';
      ctx.textAlign = 'center';
      ctx.fillText('×' + c.count, c.sx, c.sy - c.r - 4);
    }
    if (selected && c.evs.includes(selected)) drawSelection(c, t);
  }

  function drawSelection(c, t) {
    const base = c.r + 3;
    if (reduceMotion()) {
      ring(c.sx, c.sy, base, 0.9);
      ring(c.sx, c.sy, base + 5, 0.35);
      return;
    }
    const phase = ((t - pulseT0) / 1400) % 1;
    ring(c.sx, c.sy, base, 0.95);
    ring(c.sx, c.sy, base + phase * 14, 0.55 * (1 - phase));
  }

  function ring(x, y, r, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(217,119,87,' + alpha + ')';   // 主题橙
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function render(t) {
    if (!ctx || !container) return;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0c0f';                  // 海洋，与 3D 底色一致
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(view.s * dpr, 0, 0, view.s * dpr, view.tx * dpr, view.ty * dpr);
    const x0 = -view.tx / view.s, x1 = x0 + cw / view.s;
    const y0 = -view.ty / view.s, y1 = y0 + ch / view.s;

    if (land) {
      // 覆盖视口的所有世界副本（拖多远都循环，不再只画固定三份）
      const span = W * view.s;
      const k0 = Math.floor(-view.tx / span);
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        if (k * W > x1 || (k + 1) * W < x0) continue;
        ctx.save();
        ctx.translate(k * W, 0);
        ctx.fillStyle = 'rgba(139,158,182,0.32)';        // 陆地：与 3D hex 同色系，略提亮保轮廓可读
        ctx.fill(land.path);                             // nonzero：d3 切好的环绕序已经自洽（孔洞反向）
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1 / view.s;
        ctx.stroke(land.path);
        ctx.restore();
      }
    }
    if (layers.grid) drawGrid(x0, x1, y0, y1);
    // 事件点的 sx/sy 已是屏幕像素，必须切回屏幕坐标系再画——
    // 否则会再吃一次世界变换（双重变换），点被整体推出地球（真实事故：全部悬在海上）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (layers.points) {
      project();
      clusters.forEach(c => drawPoint(c, t));
    } else if (selected) {
      // 点层关闭时选中环仍要可见（否则用户失去选中反馈）
      const c = clusters.find(x => x.evs.includes(selected));
      if (c) { project(); drawSelection(c, t); }
    }
  }

  /* ---------- rAF：仅服务选中脉冲与相机动画；交互路径走同步 repaintNow，
     不依赖 rAF——帧回调被环境冻结时拖拽/缩放依然即时响应 ---------- */

  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

  function repaintNow() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!ready || failed) return;
    render(performance.now());
  }

  function frame(t) {
    raf = 0;
    if (!ready || failed) return;
    if (camAnim) {
      const p = clamp((t - camAnim.t0) / camAnim.dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      view.s = camAnim.from.s + (camAnim.to.s - camAnim.from.s) * e;
      view.tx = camAnim.from.tx + (camAnim.to.tx - camAnim.from.tx) * e;
      view.ty = camAnim.from.ty + (camAnim.to.ty - camAnim.from.ty) * e;
      if (p >= 1) {
        camAnim = null;
        if (regroup() && hooks.onStatus) hooks.onStatus(statusText());
      } else regroup();
    }
    render(t);
    if (camAnim || (selected && !reduceMotion())) schedule();
  }

  /* ---------- 命中检测与交互 ---------- */

  function pick(mx, my) {
    let best = null, bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(c.sx - mx, c.sy - my);
      if (d < Math.max(11, c.r + 5) && d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  /* 空白点选的国家命中：d3.geoContains 逐个做球面点在多边形判定（110m 全集
     177 个 feature，单次点击毫秒级）。命中返回 {id, name}（id=ISO 3166-1 numeric，
     由上层映射回 ISO2）；海面返回 null，由上层退"最近首都"兜底。
     旧实现只有 nearestCountry：点新疆曾因"距伊斯兰堡更近"判给巴基斯坦。 */
  function featureAt(features, lng, lat) {
    if (!features || !window.d3 || !window.d3.geoContains) return null;
    for (const f of features) {
      if (window.d3.geoContains(f, [lng, lat])) {
        return { id: f.id != null ? String(f.id) : null, name: (f.properties && f.properties.name) || null };
      }
    }
    return null;
  }

  function landFeatureAt(lng, lat) {
    return featureAt(landFeatures, lng, lat);
  }

  function bindEvents() {
    /* 多指追踪：单指拖拽，双指捏合缩放（触摸/触屏板），Leaflet 同款语义 */
    const pointers = new Map();

    const zoomAt = (mx, my, s2) => {
      s2 = clamp(s2, fit, fit * 18);
      const wxp = (mx - view.tx) / view.s, wyp = (my - view.ty) / view.s;
      view.s = s2;
      view.tx = clampTx(mx - wxp * s2);
      view.ty = clampTy(my - wyp * s2);
      if (regroup() && hooks.onStatus) hooks.onStatus(statusText());
      repaintNow();
    };

    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };

    canvas.addEventListener('pointerdown', e => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 指针可能已释放（触屏快速抬起/合成事件） */ }
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      camAnim = null;
      hideTip();
      if (pointers.size === 1) {
        drag = { mx: e.offsetX, my: e.offsetY, tx: view.tx, ty: view.ty, moved: false };
        container.classList.add('dragging');
      } else if (pointers.size === 2) {
        drag = null;                       // 双指接管：退出单指拖拽
        pinch = pinchState();
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size >= 2 && pinch) {
        const st = pinchState();
        const factor = st.dist / (pinch.dist || 1);
        if (Math.abs(factor - 1) > 0.005) {
          zoomAt(st.cx, st.cy, view.s * factor);
          // 捏合中心跟随：把上一帧中心的世界点贴回当前中心
          const wxp = (pinch.cx - view.tx) / view.s, wyp = (pinch.cy - view.ty) / view.s;
          view.tx = clampTx(st.cx - wxp * view.s);
          view.ty = clampTy(st.cy - wyp * view.s);
          regroup(); repaintNow();
        }
        pinch = st;
        return;
      }
      if (drag) {
        const dx = e.offsetX - drag.mx, dy = e.offsetY - drag.my;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        view.tx = clampTx(drag.tx + dx);
        view.ty = clampTy(drag.ty + dy);
        if (drag.moved) { regroup(); repaintNow(); hideTip(); }
        return;
      }
      const hit = pick(e.offsetX, e.offsetY);
      hover = hit;
      canvas.style.cursor = hit ? 'pointer' : '';
      if (hit) showTip(hit, e.offsetX, e.offsetY); else hideTip();
    });
    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {           // 双指抬起一根 → 回到单指拖拽
        const [p] = [...pointers.values()];
        drag = { mx: p.x, my: p.y, tx: view.tx, ty: view.ty, moved: true };
        return;
      }
      if (pointers.size === 0) {
        const wasClick = drag && !drag.moved;
        drag = null;
        container.classList.remove('dragging');
        if (wasClick) {
          const hit = pick(e.offsetX, e.offsetY);
          if (hit) {
            if (hit.count > 1 && hit.evs.length > 1) { if (hooks.onCluster) hooks.onCluster(hit); }
            else if (hooks.onSelect) hooks.onSelect(hit.evs[0]);
          } else if (hooks.onCountryPick) {
            // 空白处点击 → 反解经纬度 + 陆地多边形命中（未命中给 null）给上层做国家详情
            let lng = (e.offsetX - view.tx) / view.s - W / 2;
            lng = ((lng + 180) % 360 + 360) % 360 - 180;   // 循环域归一
            const lat = H / 2 - (e.offsetY - view.ty) / view.s;
            if (lat >= -90 && lat <= 90) hooks.onCountryPick({ lat, lng, land: landFeatureAt(lng, lat) });
          }
        }
      }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', e => {
      if (!pointers.size) { hideTip(); hover = null; }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(e.offsetX, e.offsetY, view.s * factor);
    }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, view.s * 1.9);
    });
    resizeBound = () => resize();
    window.addEventListener('resize', resizeBound);
  }

  function showTip(c, mx, my) {
    const ev = c.evs[0];
    if (!ev || !tip) return;
    const head = c.count > 1 ? `${c.count} EVENTS · ${ev.country || ''}` : (ev.country || '');
    tip.innerHTML =
      `<div style="color:var(--text-tertiary);font-size:10px;letter-spacing:.06em">${escapeHTML(head)}</div>` +
      escapeHTML((ev.title || '').slice(0, 64));
    tip.hidden = false;
    const rect = container.getBoundingClientRect();
    // 容器的 CSS 宽高可能都小于提示框尺寸（窄屏），此时 clamp 的上下界会翻转，
    // 把提示推到画布外——先夹住上界，保证 lo <= hi。
    const w = tip.offsetWidth || 220, h = tip.offsetHeight || 46;
    const maxX = Math.max(4, rect.width - w - 8), maxY = Math.max(4, rect.height - h - 8);
    const x = clamp(mx + 14, 4, maxX), y = clamp(my + 14, 4, maxY);
    tip.style.transform = `translate(${x}px,${y}px)`;
  }

  function hideTip() { if (tip) tip.hidden = true; }

  function statusText() {
    const n = events.filter(e => e.lat !== null && e.lng !== null).length;
    // 远景是聚合视图（一个点代表一片），不说明白会被当成"事件只有这么点"
    const agg = bucket > 0 ? '（' + bucket + '° 聚合，放大拆分）' : '';
    return clusters.length + ' 个事件点' + agg + ' · 覆盖 ' + n + ' 条事件';
  }

  /* ---------- 对外 API ---------- */

  function create(mount, userHooks) {
    container = mount;
    hooks = userHooks || {};
    canvas = document.createElement('canvas');
    canvas.className = 'wmap-canvas geo-content';
    canvas.setAttribute('aria-label', '平面世界地图：全球事件分布');
    tip = document.createElement('div');
    tip.className = 'wmap-tip';
    tip.hidden = true;
    container.appendChild(canvas);
    container.appendChild(tip);
    ctx = canvas.getContext('2d');
    try {
      fontMono = getComputedStyle(document.body).getPropertyValue('--font-mono').trim() || 'monospace';
    } catch { fontMono = 'monospace'; }
    bindEvents();

    // topojson 与 d3 都是 defer 脚本：等 DOMContentLoaded 后它们必定就位
    const ready2 = (name) => window[name] ? Promise.resolve() :
      new Promise(res => document.addEventListener('DOMContentLoaded', () => res(), { once: true }));

    return Promise.all([
      fetch('assets/globe/countries-110m.json').then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      ready2('topojson'),
      ready2('d3'),
    ]).then(([topo]) => {
      landFeatures = topo && topo.objects && topo.objects.countries && window.topojson && window.d3
        ? window.topojson.feature(topo, topo.objects.countries).features
        : null;
      land = landFeatures ? buildLandPath(landFeatures) : null;
      failed = !land;
      ready = !failed;
      fitView();
      resize();
      if (hooks.onStatus) hooks.onStatus(statusText());
      return !failed;
    }).catch(() => { failed = true; return false; });
  }

  function setEvents(list) {
    events = list || [];
    if (selected && !events.includes(selected)) selected = null;
    if (ready) { regroup(); repaintNow(); if (hooks.onStatus) hooks.onStatus(statusText()); }
  }

  function select(ev) {
    selected = ev;
    pulseT0 = performance.now();
    if (ev && ev.lat !== null && ev.lng !== null && ready) {
      setCenter(wx(ev.lng), wy(ev.lat), Math.max(view.s, fit * 2.2), true);
    } else repaintNow();
  }

  function focus(lat, lng) {
    if (ready) setCenter(wx(lng), wy(lat), Math.max(view.s, fit * 2.2), true);
  }

  function dispose() {
    if (resizeBound) window.removeEventListener('resize', resizeBound);
    resizeBound = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    events = []; clusters = []; selected = null; ready = false;
    landFeatures = null;
    if (container) container.innerHTML = '';
    canvas = null; ctx = null; tip = null;
  }

  return {
    create, setEvents, select, focus, resize, dispose, isReady: () => ready,
    /* 图层开关（设置面板/图层控制条用） */
    setLayerVisible: (id, on) => {
      if (!(id in layers)) return false;
      layers[id] = !!on;
      repaintNow();
      return true;
    },
    layerState: () => Object.assign({}, layers),
    /* 纯几何，供离线单测：底图与事件点必须共用 wx/wy，二者一旦分叉点就会落在海里 */
    geo: { bucketForZoomAt, wrapSx, clampTyVal, wx, wy, buildLandPath, d3Proj, featureAt },
    /* 自检探针：当前视图 + 全部聚簇的（数据坐标→屏幕坐标）投影，用于核对点与底图对齐 */
    _debug: () => ({
      fit, view: Object.assign({}, view), bucket, landRings: land ? land.rings : -1,
      landFeatures: landFeatures ? landFeatures.length : 0,
      clusters: clusters.map(c => ({
        lat: c.lat, lng: c.lng, sx: c.sx, sy: c.sy, count: c.count,
        country: c.evs[0] ? c.evs[0].country : null,
      })),
    }),
  };
})();
