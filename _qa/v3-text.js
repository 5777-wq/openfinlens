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

patch('index.html', [
  [
    '    <p class="page-sub" id="eventsSub">事件 → 宏观/地缘新闻 → 影响资产 → K线反应，四层联动</p>',
    '    <!-- v3：「事件→新闻→资产→K线，四层联动」是实现口径，用户不需要在标题下读它。 -->\n    <p class="page-sub" id="eventsSub" hidden></p>',
  ],
  [
    '    <p class="page-sub" id="chainSub">环节强度 = 环节内成分股涨跌幅简单平均，点击环节展开成分股</p>',
    '    <p class="page-sub" id="chainSub">环节强度 = 成分股涨跌简单平均 · 点开看成分</p>',
  ],
  [
    '      <p class="pm-note">概率为公开预测市场当前定价隐含的"事件发生可能性"，仅作信息参考，不构成预测或投资建议；\n        本站不提供、不引导任何交易，亦不含任何外部链接。环图按各档位报价占比绘制，图例数字为市场真实报价。</p>',
    '      <p class="pm-note">概率为公开预测市场的隐含定价，仅供参考；不构成预测或投资建议，本站不提供任何交易入口。</p>',
  ],
]);

patch('js/pmview.js', [
  ['      + `<br>环图按各档位报价占比绘制，图例数字为市场真实报价</div>`', '      + `</div>`'],
]);
console.log('done');
