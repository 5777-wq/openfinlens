# -*- coding: utf-8 -*-
"""v3 测试同步：简报带下线后，把两条依赖 .brief 的断言换成等价守卫。"""
import io
CR, LF = chr(13), chr(10)
p = 'D:/57的vibe coding内容/global-fin-dashboard/_test/tokens.test.mjs'
s = io.open(p, encoding='utf-8', newline='').read()
crlf = (CR + LF) in s
if crlf: s = LF.join(s.split(CR + LF))

# 1) 图形色块：从 .brief-bar 换成振幅条游标（.rbar .rb-track > b）
old1 = """  // 分布条/热力图色块是图形，不是文字：必须还是亮色，否则热力图整体变暗
  const bar = CSS.match(/\\.brief-bar\\s*>\\s*\\.b-up\\s*\\{([^}]*)\\}/);
  assert.ok(bar && /var\\(--up\\)/.test(bar[1]), '分布条的色块不该换成文字色');"""
new1 = """  // 图形色块（振幅条游标）是图形不是文字：必须还是亮色，否则整块图形会塌成灰
  const bar = CSS.match(/\\.rbar \\.rb-track > b\\s*\\{([^}]*)\\}/);
  assert.ok(bar && /var\\(--up\\)/.test(bar[1]), '图形色块不该换成文字色（应用 --up，不是 --up-text）');"""
assert old1 in s, '找不到断言1'
s = s.replace(old1, new1, 1)

# 2) 移动端守卫：简报带已删除 → 换成全局小节头 / 顶栏守卫
old2 = """  // 断言 A：堆叠规则必须位于 .brief-row 基础规则之后——同特异性后者胜，
  // 放在基础规则之前（如首个 640px 媒体块）会被静默覆盖（本轮事故形态）。
  const base = CSS_NC.indexOf('.brief-row { display: grid');
  const stack = CSS_NC.indexOf('.brief-row { grid-template-columns: 1fr');
  assert.ok(base > -1, '找不到 .brief-row 基础规则（display: grid）');
  assert.ok(stack > -1, '找不到简报带窄屏堆叠规则（grid-template-columns: 1fr）');
  assert.ok(stack > base,
    `简报带堆叠规则（index ${stack}）位于基础规则（index ${base}）之前——会被同特异性后置规则静默覆盖（数字被裁的事故形态）`);
  assert.ok(/\\.brief-v\\s*\\{\\s*white-space:\\s*normal;\\s*\\}/.test(CSS_NC),
    '找不到 .brief-v 窄屏折行规则（white-space: normal）');"""
new2 = """  // 断言 A（v3 改）：简报带已整块下线，改为守卫它的替代问题——
  // 长副标题不许把小节标题压成竖排（390px 下曾出现"热力图"竖排三个字）。
  const sh = CSS_NC.match(/\\.section-head\\s*\\{([^}]*)\\}/);
  assert.ok(sh, '找不到 .section-head 规则');
  assert.ok(/flex-wrap:\\s*wrap/.test(sh[1]), '.section-head 缺 flex-wrap: wrap（长副标题会把标题压成竖排）');
  assert.ok(/\\.section-head \\.section-title\\s*\\{[^}]*flex:\\s*none/.test(CSS_NC),
    '.section-title 缺 flex: none（会被副标题挤扁）');"""
assert old2 in s, '找不到断言2'
s = s.replace(old2, new2, 1)
s = s.replace("test('移动端修急：简报带堆叠级联序 + 顶栏搜索占中（390px 守卫）'",
              "test('移动端修急：小节头不竖排 + 顶栏搜索占中（390px 守卫）'", 1)

# 3) 白名单里去掉 .brief-bar / .brief-v（规则已删，留着会让人以为还在用）
s = s.replace("'.rbar', '.brief-bar', '.brief-v']", "'.rbar']", 1)

if crlf: s = (CR + LF).join(s.split(LF))
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('tokens.test synced')
