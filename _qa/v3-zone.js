const fs = require('fs');
const p = 'D:/57的vibe coding内容/global-fin-dashboard/js/app.js';
let s = fs.readFileSync(p, 'utf8');
const crlf = s.includes('\r\n');
if (crlf) s = s.split('\r\n').join('\n');

const old = "    if (state.tab === 'all') { el.cardWall.innerHTML = ''; el.cardWall.hidden = true; return; }\n";
const neu = `    if (state.tab === 'all') {
      el.cardWall.innerHTML = '';
      el.cardWall.hidden = true;
      // data-zone 必须同步摘掉：分区判定只看 [data-zone] 节点的 hidden。
      // 留一个空的 data-zone 容器会让「概览」分区仍然可选，点过去就是一片空白（v3 实测）。
      el.cardWall.removeAttribute('data-zone');
      if (typeof syncZones === 'function') syncZones();
      return;
    }
    el.cardWall.hidden = false;
    el.cardWall.setAttribute('data-zone', 'overview');
`;
if (!s.includes(old)) throw new Error('anchor missing');
s = s.replace(old, neu, 1);

// 保留原有的 innerHTML 赋值处不重复设 hidden
if (crlf) s = s.split('\n').join('\r\n');
fs.writeFileSync(p, s, 'utf8');
new Function(fs.readFileSync(p, 'utf8'));
console.log('ok');
