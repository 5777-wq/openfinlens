# -*- coding: utf-8 -*-
"""删掉 renderMarketBrief 的全部调用点（函数已随简报带下线）。"""
import io
CR, LF = chr(13), chr(10)
p = 'D:/57的vibe coding内容/global-fin-dashboard/js/app.js'
s = io.open(p, encoding='utf-8', newline='').read()
crlf = (CR + LF) in s
if crlf: s = LF.join(s.split(CR + LF))

pairs = [
    ("    renderMood();\n    // 市场简报带的 A股行跟着宽度数据走\n    renderMarketBrief();\n",
     "    renderMood();\n"),
    ("    renderMarketBrief();   // 概览条与指数卡共用同一批数据，一起刷新\n", ""),
    ("      renderHero();\n      renderHomeWatch();\n      renderMarketBrief();\n      ensureSparks();\n",
     "      renderHero();\n      renderHomeWatch();\n      ensureSparks();\n"),
    ("      renderHomeWatch();\n      renderMarketBrief();\n      ensureSparks();\n",
     "      renderHomeWatch();\n      ensureSparks();\n"),
]
for a, b in pairs:
    if a not in s:
        raise SystemExit('MISS: ' + repr(a[:50]))
    s = s.replace(a, b, 1)

if crlf: s = (CR + LF).join(s.split(LF))
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('call sites removed')
