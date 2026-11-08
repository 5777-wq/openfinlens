// 把 tokens.test 里「8 套皮肤」的断言改成 v2 的「两套模式（nexus 深空 / daylight 日光）」
const fs = require('fs');
const p = 'D:/57的vibe coding内容/global-fin-dashboard/_test/tokens.test.mjs';
let s = fs.readFileSync(p, 'utf8');
const CRLF = s.includes('\r\n');
if (CRLF) s = s.replace(/\r\n/g, '\n');

const swap = (from, to, label) => {
  if (!s.includes(from)) throw new Error('找不到片段：' + (label || from.slice(0, 40)));
  s = s.split(from).join(to);
};

/* 1) pill 内边距：四套边框皮肤 → 基础 pill 规则 */
swap(`test('带边框的四种皮肤里 .pill 必须有自己的内边距（文字不能贴框线）', () => {
  // 这四套给 .pill 套了 1px 边框，但基础 .pill 的 padding 是给"下划线型"设计的，
  // 套上边框后文字直接压在框上——用户反馈"tag 做得太逼仄"的根因。
  ['swiss', 'bauhaus', 'clay', 'memphis'].forEach(t => {
    const re = new RegExp(\`html\\\\[data-theme="\${t}"\\\\] \\\\.pill \\\\{[^}]*\\\\}\`);
    const m = CSS.match(re);
    assert.ok(m, \`\${t} 主题里找不到 .pill 规则\`);
    const pad = /padding:\\s*([^;]+);/.exec(m[0]);
    assert.ok(pad, \`\${t} 的 .pill 没有内边距\`);
    const nums = pad[1].match(/\\d+/g).map(Number);
    assert.ok(nums.length >= 2, \`\${t} 的 .pill 内边距应写"上下 左右"两段，实际 "\${pad[1]}"\`);
    assert.ok(nums[1] >= 8, \`\${t} 的 .pill 左右内边距只有 \${nums[1]}px，文字会贴住边框\`);
  });
});`,
`test('视图切换 .pill 必须有自己的内边距（文字不能贴框线）', () => {
  // v2 新语言里 pill 一律带 1px 描边。下划线型 pill 可以很薄，
  // 一旦套上边框，薄内边距会让文字压在框上——用户反馈"tag 太逼仄"的根因。
  const m = CSS.match(/\\n\\.pill \\{([\\s\\S]*?)\\n\\}/);
  assert.ok(m, '找不到基础 .pill 规则');
  const pad = /padding:\\s*([^;]+);/.exec(m[1]);
  assert.ok(pad, '.pill 没有显式内边距');
  const parts = pad[1].trim().split(/\\s+/);
  assert.ok(parts.length >= 2, '.pill 内边距应写"上下 左右"两段，实际 "' + pad[1] + '"');
  const left = parts[1];
  const px = /^([\\d.]+)px$/.exec(left);
  const spVar = /^var\\(--sp-(\\d+)\\)$/.exec(left);
  const val = px ? parseFloat(px[1]) : (spVar ? parseFloat(spVar[1]) : NaN);
  assert.ok(!Number.isNaN(val) && val >= 8, '.pill 左右内边距只有 ' + left + '，文字会贴住边框');
});`, 'pill');

/* 2) 0 圆角通配 → 禁止通配清零 + 语义圆点必须是圆 */
swap(`test('0 圆角通配不得压掉语义圆点（事件类型色点必须是圆）', () => {
  // 四套设计语言皮肤用 \`* { border-radius: 0 !important }\` 统一硬朗感，
  // 但它会把 .ev-dot（事件类型前置色点）压成方块，丢掉"这是一个点"的读感。
  ['swiss', 'bauhaus', 'clay', 'memphis'].forEach(t => {
    const re = new RegExp(\`html\\\\[data-theme="\${t}"\\\\] \\\\.ev-dot[^{]*\\\\{[^}]*border-radius:\\\\s*50%\`);
    assert.ok(re.test(CSS), \`\${t} 主题的 .ev-dot 缺少圆角豁免\`);
  });
});`,
`test('不许用 *{border-radius:0!important} 统一改圆角（语义圆点会被压成方块）', () => {
  // 旧的四套"设计语言皮肤"曾用它一次性清零圆角，代价是 .ev-dot（事件类型色点）
  // 变成方块、"这是一个点"的读感消失。v2 只有一套形状令牌，不需要这种通配改法。
  const stripped = CSS.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
  assert.ok(!/\\*\\s*\\{[^}]*border-radius:\\s*0\\s*!important/.test(stripped),
    '又出现了 * { border-radius: 0 !important } 通配清零');
  const m = stripped.match(/\\.ev-dot[^{]*\\{[^}]*\\}/);
  assert.ok(m, '找不到 .ev-dot 规则');
  assert.ok(/border-radius:\\s*(50%|999px|var\\(--r-pill\\))/.test(m[0]),
    '.ev-dot 丢了圆形（事件类型色点应是圆点）');
});`, 'evdot');

/* 3) 皮肤清单 → 两套模式 */
swap(`const THEMES = [':root', 'swiss', 'paper', 'bauhaus', 'clay', 'memphis', 'aurora', 'oled'];`,
  `/* v2（2026-11）推倒重来：旧 8 套皮肤删除，只剩一套设计语言的两个模式。
     ':root' = 深空（nexus，默认），'daylight' = 日光。对比度守卫对两套都要成立。 */
const THEMES = [':root', 'daylight'];`, 'themes');
s = s.replace(/8 套皮肤/g, '两套模式').replace(/5 套浅色皮肤/g, '日光模式').replace(/5\. 套浅色皮肤/g, '日光模式');

/* 4) 阴影：浅色承接方改成 daylight；删掉「暗色另两套不得覆写」 */
swap(`  ['swiss', 'paper', 'bauhaus', 'clay', 'memphis'].forEach(t => {
    const s = themeVar('shadow-1', themeBlock(t));
    assert.ok(s && /rgba\\(/.test(s), t + ' 皮肤块缺 --shadow-1 亮色覆盖（rgba 阴影）：' + s);
  });
  // 暗色另两套（aurora/oled）不得覆写 shadow 令牌——继承 :root 的 none。
  ['aurora', 'oled'].forEach(t => {
    const b = themeBlock(t);
    assert.ok(!/--shadow-1\\s*:/.test(b) && !/--shadow-2\\s*:/.test(b),
      t + ' 皮肤块不应覆写 --shadow-*（暗色一律禁阴影，继承 :root 的 none）');
  });`,
`  // 海拔交给日光模式承接：daylight 必须覆写 --shadow-1/2 亮影，否则卡片浮不起来。
  const dayBlock = themeBlock('daylight');
  ['shadow-1', 'shadow-2'].forEach(tok => {
    const v = themeVar(tok, dayBlock);
    assert.ok(v && /rgba\\(/.test(v), 'daylight 缺 --' + tok + ' 亮色覆盖（rgba 阴影）：' + v);
  });`, 'shadow');

/* 5) 暗色两组：只扫 :root */
s = s.replace(/\[\':root\', \'aurora\', \'oled\'\]\.forEach\(t => \{/g, `[':root'].forEach(t => {`);
s = s.replace(/test\('暗色 3 套文字灰阶对全部四表面 ≥4\.5:1（:root\/aurora\/oled）'/,
  `test('深空模式文字灰阶对全部四表面 ≥4.5:1（:root）'`);

if (CRLF) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(p, s, 'utf8');
console.log('patched');
