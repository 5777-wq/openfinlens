/* flags.js —— 内联 SVG 简化国旗（Windows Chrome 不渲染 emoji 国旗，只能自绘）
   全部为几何简化版（20×14，圆角 2），在小尺寸下以主色/条带/主图案可辨识为准。 */

const Flags = (() => {
  const S = (inner) => `<svg class="flag" viewBox="0 0 20 14" width="20" height="14" aria-hidden="true">${inner}</svg>`;

  // 五角星 path（外接圆半径 r，中心 cx,cy，顶点朝上）
  function star(cx, cy, r, fill) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.4;
      pts.push((cx + rr * Math.cos(ang)).toFixed(2) + ',' + (cy + rr * Math.sin(ang)).toFixed(2));
    }
    return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
  }

  const MAP = {
    cn: () => S(`<rect width="20" height="14" fill="#DE2910"/>${star(4.2, 4.4, 2.4, '#FFDE00')}` +
      star(8.6, 2, 0.8, '#FFDE00') + star(10, 4, 0.8, '#FFDE00') + star(10, 6.6, 0.8, '#FFDE00') + star(8.6, 8.4, 0.8, '#FFDE00')),
    us: () => {
      let stripes = '';
      for (let i = 0; i < 7; i++) stripes += `<rect y="${(i * 2).toFixed(1)}" width="20" height="1.1" fill="#B22234"/>`;
      return S(`<rect width="20" height="14" fill="#fff"/>${stripes}<rect width="9" height="7.7" fill="#3C3B6E"/>` +
        [[2, 2], [4.5, 2], [7, 2], [3.2, 3.8], [5.8, 3.8], [2, 5.6], [4.5, 5.6], [7, 5.6]].map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="0.55" fill="#fff"/>`).join(''));
    },
    hk: () => {
      let petals = '';
      for (let i = 0; i < 5; i++) {
        petals += `<ellipse cx="10" cy="5.4" rx="1.5" ry="2.6" fill="#fff" transform="rotate(${i * 72} 10 7)"/>`;
      }
      return S(`<rect width="20" height="14" fill="#DE2910"/>${petals}<circle cx="10" cy="7" r="0.9" fill="#DE2910"/>`);
    },
    jp: () => S(`<rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="3.4" fill="#BC002D"/>`),
    de: () => S(`<rect width="20" height="4.7" fill="#000"/><rect y="4.7" width="20" height="4.7" fill="#DD0000"/><rect y="9.3" width="20" height="4.7" fill="#FFCE00"/>`),
    gb: () => S(`<rect width="20" height="14" fill="#012169"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" stroke-width="2.6"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" stroke-width="1.1"/><rect x="8.4" width="3.2" height="14" fill="#fff"/><rect y="5.4" width="20" height="3.2" fill="#fff"/><rect x="9.1" width="1.8" height="14" fill="#C8102E"/><rect y="6.1" width="20" height="1.8" fill="#C8102E"/>`),
    fr: () => S(`<rect width="6.7" height="14" fill="#0055A4"/><rect x="6.7" width="6.6" height="14" fill="#fff"/><rect x="13.3" width="6.7" height="14" fill="#EF4135"/>`),
    kr: () => S(`<rect width="20" height="14" fill="#fff"/><path d="M10,3.5 A3.5,3.5 0 0 1 10,10.5 A1.75,1.75 0 0 1 10,7 A1.75,1.75 0 0 0 10,3.5 Z" fill="#CD2E3A" transform="rotate(-25 10 7)"/><path d="M10,3.5 A3.5,3.5 0 0 0 10,10.5 A1.75,1.75 0 0 0 10,7 A1.75,1.75 0 0 1 10,3.5 Z" fill="#0047A0" transform="rotate(-25 10 7)"/><path d="M3.2,2.8 L5.4,4.4 M3.6,2.2 L5.8,3.8" stroke="#000" stroke-width="0.5"/><path d="M14.6,9.6 L16.8,11.2 M15,9 L17.2,10.6" stroke="#000" stroke-width="0.5"/><path d="M3.2,11.2 L5.4,9.6 M3.6,11.8 L5.8,10.2" stroke="#000" stroke-width="0.5"/><path d="M14.6,4.4 L16.8,2.8 M15,5 L17.2,3.4" stroke="#000" stroke-width="0.5"/>`),
    in: () => S(`<rect width="20" height="4.7" fill="#FF9933"/><rect y="4.7" width="20" height="4.7" fill="#fff"/><rect y="9.3" width="20" height="4.7" fill="#138808"/><circle cx="10" cy="7" r="1.7" fill="none" stroke="#000080" stroke-width="0.55"/><circle cx="10" cy="7" r="0.4" fill="#000080"/>`),
    eu: () => {
      let dots = '';
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        dots += `<circle cx="${(10 + 2.6 * Math.cos(a)).toFixed(2)}" cy="${(7 + 2.6 * Math.sin(a)).toFixed(2)}" r="0.55" fill="#FFCC00"/>`;
      }
      return S(`<rect width="20" height="14" fill="#003399"/>${dots}`);
    },
    coin: () => S(`<circle cx="10" cy="7" r="6.4" fill="#F7931A"/><text x="10" y="10.6" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="monospace">₿</text>`),
  };

  function flag(code) {
    const f = MAP[code];
    return f ? f() : '';
  }

  return { flag, MAP };
})();

window.Flags = Flags;
