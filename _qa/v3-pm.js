const fs = require('fs');
const B = 'D:/57的vibe coding内容/global-fin-dashboard/';
function patch(p, pairs) {
  let s = fs.readFileSync(B + p, 'utf8');
  const crlf = s.includes('\r\n');
  if (crlf) s = s.split('\r\n').join('\n');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(p + ' MISS: ' + a.slice(0, 60));
    s = s.split(a).join(b);
  }
  if (crlf) s = s.split('\n').join('\r\n');
  fs.writeFileSync(B + p, s, 'utf8');
  console.log('patched', p);
}

patch('js/app.js', [
  [
    "        el.pmSub.textContent = `市场隐含概率（${viaTxt}${ageTxt ? ' · ' + ageTxt : ''}）`\n          + (stale ? ' · 数据已滞后' : '') + ' · 仅供参考，不构成预测或投资建议';",
    "        // v3：标题下一行只留「口径 + 新鲜度」，免责声明收进底部说明，不再在页头重复一遍\n        el.pmSub.textContent = `隐含概率 · ${viaTxt}${ageTxt ? ' · ' + ageTxt : ''}${stale ? ' · 已滞后' : ''}`;",
  ],
]);

patch('js/pmview.js', [
  [
    "      + `<div class=\"pm-ov-note\">${partN} 个互斥事件可看档位分布环图 · ${total - partN} 个独立问句事件只给概率条`\n      + `</div>`\n",
    '',
  ],
]);
console.log('done');
