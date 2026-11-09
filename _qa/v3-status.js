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

// 事件页右上角状态行：原来把采集器技术名（GDELT DOC 2.0 / artlist）也写上去，用户读不出重点
patch('js/app.js', [
  [
    "    const src = (state.eventsVia === 'cache' ? '缓存 · ' : '') + (state.eventsSource || '') +\n      ' · 最新事件 ' + ageTxt +\n      (stale ? ' · 上游疑似停更' : '');",
    "    // v3：只留「来源 · 最新事件多长时间前 · 是否滞后」，去掉采集器技术名（GDELT DOC 2.0/artlist 这类）。\n    const src = (state.eventsVia === 'cache' ? '缓存 · ' : '') +\n      (state.eventsSourceLabel || state.eventsSource || '') +\n      ' · 最新 ' + ageTxt +\n      (stale ? ' · 已滞后' : '');",
  ],
]);
console.log('done');
