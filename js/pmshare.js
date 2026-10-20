/* js/pmshare.js —— 市场预测单条信息 → 可分享图片（金时快讯那种形态）

   为什么做这个：一条「某事件隐含概率 62%」的信息，单独截屏转发出去几乎没信息量
   ——没有口径、没有时间、没有来源，收到的人得反问。做成一张带品牌与口径的图片，
   转发的人不用解释，看到的人也知道这是谁的快照、什么时候的快照、概率怎么来的。

   三条硬约束（与项目既有的合规红线一致）：
   ① 图上不得出现预测市场的 slug / URL / tokenId——那等于给交易入口开口子。
      二维码只指向我们自己的站点，而且不携带任何事件标识。
   ② 必须写清「这是报价快照、不是预测」，并保留不构成投资建议的声明。
   ③ 配色读当前皮肤的 CSS 变量，八套皮肤下分享出去的图和屏幕上是同一套视觉。

   纯前端：画布 → PNG → Web Share API（支持就交给系统分享面板，能直接发微信/微博）
   → 不支持则退回下载。整个过程不发起任何网络请求。 */

(function (global) {
  'use strict';

  /* 二维码只指向我们自己的首页 + 事件分区。
     刻意不带事件 id：事件 id 内部嵌了上游的事件编号，不该外传。 */
  const SHARE_URL = 'https://5777-wq.github.io/openfinlens/#tab=events';

  const W = 1080, H = 1440, PAD = 72;
  const MAX_OUTCOMES = 6;
  const DPR = 2;                    // 导出 2 倍图，社交平台压缩后仍然清晰

  /* ==================== 取色 ==================== */

  function cssVar(name, fallback) {
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name); } catch (e) { v = ''; }
    return (v && v.trim()) || fallback;
  }

  function parseColor(s) {
    s = String(s || '').trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(',').map(x => parseFloat(x));
      if (p.length >= 3 && !isNaN(p[0])) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
    }
    return null;
  }

  /* 半透明色叠在底色上得到实色——canvas 不认半透明底，得自己合成 */
  function over(fg, bg) {
    const f = parseColor(fg);
    const b = parseColor(bg) || { r: 0, g: 0, b: 0, a: 1 };
    if (!f) return fg;
    const a = Math.max(0, Math.min(1, f.a));
    return `rgb(${Math.round(f.r * a + b.r * (1 - a))},${Math.round(f.g * a + b.g * (1 - a))},${Math.round(f.b * a + b.b * (1 - a))})`;
  }

  function theme() {
    const t = {
      bg: cssVar('--bg', '#0a0a0b'),
      elev: cssVar('--bg-elevated', '#131316'),
      card: cssVar('--bg-card', '#101013'),
      text: cssVar('--text', '#f2f2f0'),
      text2: cssVar('--text-secondary', '#9a9aa2'),
      text3: cssVar('--text-tertiary', '#808088'),
      faint: cssVar('--text-faint', '#5c5c63'),
      border: cssVar('--border', 'rgba(255,255,255,0.07)'),
      accent: cssVar('--accent-signature', '#e8a33d'),
      up: cssVar('--up', '#ff5c5c'),
      down: cssVar('--down', '#2ebd85'),
    };
    t.borderSolid = over(t.border, t.bg);
    t.elevSolid = over(t.elev, t.bg);
    t.cardSolid = over(t.card, t.bg);
    return t;
  }

  const CJK = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Source Han Sans SC',sans-serif";
  const MONO = cssVar('--font-mono', 'ui-monospace,monospace');

  /* ==================== 文本排版 ==================== */

  /* 逐字测量换行：中文按字断、英文按词断都能对付（英文单词被切开也不影响可读性） */
  function wrapText(ctx, text, maxWidth, maxLines) {
    const chars = Array.from(String(text == null ? '' : text));
    const lines = [];
    let cur = '';
    for (const ch of chars) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = ch; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    if (!maxLines || lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }

  function fmtVol(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    n = Number(n);
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(0) + '万';
    return String(Math.round(n));
  }

  function fmtPct(p) {
    if (p === null || p === undefined || isNaN(p)) return '—';
    return (Number(p) * 100).toFixed(p >= 0.995 || p <= 0.005 ? 0 : 1) + '%';
  }

  function fmtDay(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtClock(d) {
    const p = (n) => String(n).padStart(2, '0');
    return fmtDay(d.getTime()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ==================== 卡片绘制 ==================== */

  /* 事件 → 竖版卡片画布。
     ev 用的是 polymarket.js 的共享模型：{ titleZh/title, category, partition,
     outcomes:[{ labelZh/label, probability, change24h }], volume24hr, liquidity, endDate } */
  function drawCard(ev, opts) {
    const o = opts || {};
    const T = theme();
    const cv = document.createElement('canvas');
    cv.width = W * DPR;
    cv.height = H * DPR;
    const c = cv.getContext('2d');
    c.scale(DPR, DPR);
    c.textBaseline = 'alphabetic';

    const palette = (global.PMCharts && global.PMCharts.PALETTE) || ['#4c8dff', '#f0a63a', '#a06ce8', '#2fb8a6', '#e0699f', '#9fb03c', '#8a93a6', '#c9834a'];
    const catColor = (global.Polymarket && global.Polymarket.CAT_META && global.Polymarket.CAT_META[ev.category] && global.Polymarket.CAT_META[ev.category].color) || T.accent;

    // 底
    c.fillStyle = T.bg;
    c.fillRect(0, 0, W, H);

    // 品牌条
    c.fillStyle = T.elevSolid;
    c.fillRect(0, 0, W, 104);
    c.fillStyle = T.borderSolid;
    c.fillRect(0, 103, W, 1);
    c.fillStyle = T.accent;
    c.beginPath();
    c.arc(PAD + 7, 52, 7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = T.text;
    c.font = '600 21px ' + CJK;
    c.textAlign = 'left';
    c.fillText('OpenFinLens', PAD + 26, 60);
    c.fillStyle = T.text3;
    c.font = '15px ' + CJK;
    c.textAlign = 'right';
    c.fillText('市场预测 · 隐含概率快照', W - PAD, 59);

    // 类别标记
    let y = 150;
    if (ev.category) {
      const label = (global.Polymarket && global.Polymarket.CAT_META && global.Polymarket.CAT_META[ev.category] && global.Polymarket.CAT_META[ev.category].label) || ev.category;
      c.font = '600 17px ' + CJK;
      const tw = c.measureText(label).width;
      c.fillStyle = over(catColor, T.bg);
      c.globalAlpha = 0.16;
      c.fillRect(PAD, y, tw + 28, 34);
      c.globalAlpha = 1;
      c.fillStyle = catColor;
      c.fillRect(PAD, y, 3, 34);
      c.fillStyle = T.text2;
      c.textAlign = 'left';
      c.fillText(label, PAD + 14, y + 23);
      y += 56;
    }

    // 标题（模板题用词干 + 档位名补全，与页面口径一致）
    const title = o.title || ev.titleZh || ev.title || '';
    c.fillStyle = T.text;
    c.font = '600 38px ' + CJK;
    const tLines = wrapText(c, title, W - PAD * 2, 3);
    for (const ln of tLines) {
      c.fillText(ln, PAD, y + 40);
      y += 52;
    }

    // 时间行
    y += 8;
    c.fillStyle = T.text3;
    c.font = '16px ' + CJK;
    const bits = [];
    if (ev.updatedAt) bits.push('快照 ' + fmtClock(new Date(ev.updatedAt)));
    if (ev.endDate) bits.push('截止 ' + fmtDay(ev.endDate));
    if (ev.outcomeCount) bits.push(ev.outcomeCount + ' 个档位');
    c.fillText(bits.join('  ·  '), PAD, y + 12);

    // 分隔线
    y += 40;
    c.fillStyle = T.borderSolid;
    c.fillRect(PAD, y, W - PAD * 2, 1);

    // 档位区
    const outs = (ev.outcomes || []).slice(0, MAX_OUTCOMES);
    const footTop = H - 268;                     // 底部品牌区起点
    const areaTop = y + 34;
    const areaH = footTop - areaTop - 40;         // 留给档位区的高度
    const rowH = outs.length ? Math.max(74, Math.min(112, areaH / outs.length)) : 0;

    outs.forEach((o2, i) => {
      const ry = areaTop + i * rowH;
      const p = Number(o2.probability);
      const col = palette[i % palette.length];
      // 档位名
      c.fillStyle = T.text;
      c.font = '23px ' + CJK;
      c.textAlign = 'left';
      const label = o2.labelZh || o2.label || '';
      const maxLabelW = W - PAD * 2 - 220;
      c.fillText(wrapText(c, label, maxLabelW, 1)[0] || '', PAD, ry + 26);
      // 概率
      c.fillStyle = col;
      c.font = '600 34px ' + MONO;
      c.textAlign = 'right';
      c.fillText(fmtPct(p), W - PAD, ry + 28);
      // 24h 变化
      const ch = Number(o2.change24h);
      if (!isNaN(ch) && o2.change24h !== null && o2.change24h !== undefined) {
        c.fillStyle = ch > 0 ? T.up : (ch < 0 ? T.down : T.text3);
        c.font = '17px ' + MONO;
        c.textAlign = 'right';
        c.fillText((ch > 0 ? '+' : '') + ch.toFixed(1) + ' pct 24h', W - PAD, ry + 54);
      }
      // 概率条
      const barY = ry + rowH - 22;
      const barW = W - PAD * 2;
      c.fillStyle = over(T.border, T.bg);
      c.fillRect(PAD, barY, barW, 7);
      if (!isNaN(p) && p > 0) {
        c.fillStyle = col;
        c.fillRect(PAD, barY, Math.max(3, barW * Math.min(1, p)), 7);
      }
    });

    // 口径提示：互斥与否决定概率能不能加总，这句必须留在图上
    c.textAlign = 'left';
    c.fillStyle = T.text3;
    c.font = '16px ' + CJK;
    const note = ev.partition
      ? '档位互斥，概率合计约 100%'
      : '各档位是彼此独立的问句，概率不可加总';
    c.fillText(note, PAD, Math.min(footTop - 16, areaTop + Math.max(0, outs.length) * rowH + 4));

    // 底部品牌区
    c.fillStyle = T.borderSolid;
    c.fillRect(PAD, footTop, W - PAD * 2, 1);

    const qrSize = 168;
    const qrX = W - PAD - qrSize;
    const qrY = footTop + 30;
    if (global.QR) {
      try {
        const qr = global.QR.encode(SHARE_URL);
        // 二维码必须深色模块 + 浅色底，否则深色皮肤下扫不出来
        c.fillStyle = '#ffffff';
        c.fillRect(qrX - 14, qrY - 14, qrSize + 28, qrSize + 28);
        const cell = qrSize / qr.size;
        c.fillStyle = '#000000';
        for (let r = 0; r < qr.size; r++) {
          for (let cc = 0; cc < qr.size; cc++) {
            if (qr.get(r, cc)) c.fillRect(qrX + cc * cell, qrY + r * cell, cell + 0.5, cell + 0.5);
          }
        }
      } catch (e) { /* 二维码失败不影响其余内容 */ }
    }
    c.fillStyle = T.text3;
    c.font = '14px ' + CJK;
    c.textAlign = 'right';
    c.fillText('扫码看更多', qrX - 14, qrY + qrSize + 6);

    c.textAlign = 'left';
    c.fillStyle = T.text;
    c.font = '600 24px ' + CJK;
    c.fillText('OpenFinLens', PAD, footTop + 48);
    c.fillStyle = T.text3;
    c.font = '17px ' + MONO;
    c.fillText('5777-wq.github.io/openfinlens', PAD, footTop + 80);
    c.fillStyle = T.faint;
    c.font = '15px ' + CJK;
    c.fillText('概率来自公开预测市场的实时报价，是市场当下的定价，不是预测，也不是建议。', PAD, footTop + 112);
    c.fillText('24h 成交 $' + fmtVol(ev.volume24hr) + '  ·  流动性 $' + fmtVol(ev.liquidity), PAD, footTop + 138);
    c.fillText('生成于 ' + fmtClock(new Date()), PAD, footTop + 162);

    return cv;
  }

  /* ==================== 导出 ==================== */

  function toBlob(canvas) {
    return new Promise((res) => {
      if (canvas.toBlob) canvas.toBlob((b) => res(b), 'image/png');
      else res(null);
    });
  }

  /* 文件名不带事件 id（内部嵌了上游编号，不外传），只带时间戳 */
  function fileStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'openfinlens-pm-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(canvas) {
    const a = document.createElement('a');
    a.download = fileStamp() + '.png';
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* 系统分享：支持 Web Share API Level 2 就交给系统面板（能直接发微信/微博/相册），
     不支持则返回 false，调用方退回下载。 */
  async function nativeShare(canvas) {
    const blob = await toBlob(canvas);
    if (!blob) return false;
    let file;
    try { file = new File([blob], fileStamp() + '.png', { type: 'image/png' }); } catch (e) { return false; }
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
    try {
      await navigator.share({ files: [file], title: 'OpenFinLens · 市场预测' });
      return true;
    } catch (e) {
      return false;   // 用户取消也算没分享成功
    }
  }

  /* ==================== 弹层 ==================== */

  let overlay = null, preview = null, current = null, deps = {};

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.getElementById('shareOverlay');
    if (!overlay) return null;
    preview = document.getElementById('sharePreview');
    const close = document.getElementById('shareClose');
    const save = document.getElementById('shareSave');
    const native = document.getElementById('shareNative');
    if (close) close.addEventListener('click', hide);
    if (save) save.addEventListener('click', () => { if (current) download(current); });
    if (native) {
      native.addEventListener('click', async () => {
        if (!current) return;
        const ok = await nativeShare(current);
        if (!ok) download(current);      // 系统分享不可用就直接下载，不给用户一个死按钮
      });
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
    return overlay;
  }

  function show(canvas) {
    current = canvas;
    if (!ensureOverlay()) return;
    if (preview) {
      preview.innerHTML = '';
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = '市场预测分享卡片';
      preview.appendChild(img);
    }
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('active'));
    document.body.classList.add('modal-open');
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.classList.remove('modal-open');
    setTimeout(() => { if (overlay) overlay.hidden = true; }, 240);
    current = null;
  }

  /* 打开某条事件的分享卡片。
     deps: { getEvent(id) → 事件对象 }（事件数据在 app.js 的 state 里，视图模块拿不到） */
  function open(eventId) {
    const ev = deps.getEvent ? deps.getEvent(eventId) : null;
    if (!ev) return false;
    try {
      show(drawCard(ev));
      return true;
    } catch (e) {
      if (deps.onError) deps.onError(e);
      return false;
    }
  }

  function mount(d) {
    deps = d || {};
  }

  global.PMShare = { mount, open, drawCard, download, nativeShare, SHARE_URL, hide };
})(typeof window !== 'undefined' ? window : globalThis);
