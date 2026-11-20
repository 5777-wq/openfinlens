/* components/chain-heat.js —— 产业链环节强弱（签名组件）
   强弱口径：环节内成分股「当日涨跌幅等权平均」，直接标在页面上，不做加工。 */
(function () {
  'use strict';

  const esc = (s) => window.Fmt.esc(s);
  const CHUNK = 45;
  let secidMap = null;   // symbol → { secid, name }
  let quotes = new Map(); // secid → { price, pct, name }

  async function loadSecidMap() {
    if (secidMap) return secidMap;
    try {
      const res = await window.SafeNet.fetch('data/chain-secids.json', { cache: 'no-cache' });
      secidMap = res.ok ? await res.json() : {};
    } catch (e) { secidMap = {}; }
    return secidMap;
  }

  /** 批量拉取产业链成分股行情 */
  async function loadQuotes() {
    const map = await loadSecidMap();
    const entries = Object.entries(map).filter(([, v]) => v && v.secid);
    if (!entries.length) return quotes;

    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const secids = slice.map(([, v]) => v.secid).join(',');
      const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f12,f13,f14&secids='
        + encodeURIComponent(secids);
      try {
        const res = await window.SafeNet.fetch(url);
        if (!res.ok) continue;
        const j = await res.json();
        ((j.data && j.data.diff) || []).forEach((d) => {
          const key = `${d.f13}.${d.f12}`;
          const scale = Math.pow(10, d.f1);
          quotes.set(key, {
            name: d.f14,
            price: d.f2 === undefined ? null : d.f2 / scale,
            pct: d.f3 === undefined ? null : d.f3 / 100,
          });
        });
      } catch (e) { /* 单块失败不影响其它块 */ }
    }
    return quotes;
  }

  /** 环节强度 = 成分股当日涨跌幅等权平均（%）；无数据返回 null */
  function segmentStrength(seg) {
    let sum = 0, n = 0;
    (seg.stocks || []).forEach((s) => {
      const m = secidMap && secidMap[s.symbol];
      if (!m) return;
      const q = quotes.get(m.secid);
      if (!q || q.pct === null) return;
      sum += q.pct; n++;
    });
    return n ? { value: sum / n, n, missing: (seg.stocks || []).length - n } : null;
  }

  /** 渲染一条链（环节数组名为 links，见 vendor/core/industry-chains.js） */
  function render(container, chain) {
    if (!container || !chain) return;
    const segs = chain.links || chain.segments || [];
    const rows = segs.map((seg) => {
      const st = segmentStrength(seg);
      const v = st ? st.value : null;
      // 热力：-3% ~ +3% 映射到 0-100
      const heat = v === null ? 0 : Math.max(0, Math.min(100, ((v + 3) / 6) * 100));
      const color = v === null ? 'var(--rule)'
        : (v >= 0 ? `rgba(194,64,47,${(0.12 + (v / 3) * 0.5).toFixed(3)})`
          : `rgba(27,122,87,${(0.12 + (-v / 3) * 0.5).toFixed(3)})`);
      const width = Math.max(3, Math.min(100, (v === null ? 0 : Math.abs(v) / 3 * 100)));
      return `<div class="chain-seg" data-seg="${esc(seg.name)}">
        <span class="cs-n" title="${esc(seg.desc || '')}">${esc(seg.name)}</span>
        <span class="cs-bar"><i style="width:${width.toFixed(1)}%;background:${color}"></i></span>
        <span class="cs-v ${v === null ? 'muted' : (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'))}">${v === null ? '--' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'}</span>
      </div>`;
    }).join('');

    const rated = segs.filter((s) => segmentStrength(s)).map(segmentStrength).filter(Boolean);
    const avg = rated.length ? rated.reduce((a, b) => a + b.value, 0) / rated.length : null;

    container.innerHTML = `<div class="chain">
      <div class="chain-h">
        <span class="ch-n">${esc(chain.name)}</span>
        ${avg === null ? '' : `<span class="tag ${avg > 0 ? 'up' : 'down'}">整体 ${avg > 0 ? '+' : ''}${avg.toFixed(2)}%</span>`}
        <span class="ch-d">成分股等权平均涨跌幅 · ${segs.length} 个环节</span>
      </div>
      ${rows}
    </div>`;
  }

  window.ChainHeat = { loadSecidMap, loadQuotes, segmentStrength, render };
})();
