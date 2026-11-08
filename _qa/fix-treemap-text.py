# -*- coding: utf-8 -*-
import io
CR = chr(13); LF = chr(10)
p = 'D:/57的vibe coding内容/global-fin-dashboard/js/treemap.js'
s = io.open(p, encoding='utf-8', newline='').read()
crlf = (CR + LF) in s
if crlf:
    s = LF.join(s.split(CR + LF))

pairs = [
    # 二级：单行名称，块太窄时挤成一团 → 门槛 30 → 34
    ("        if (w >= 30 && h >= s1 + 3) {",
     "        if (w >= 34 && h >= s1 + 3) {"),
    # 三级：只放一个数字。8px + w>=21 会在密集区糊成一片（用户截图可见）：
    # 门槛提到 28×11、字号 9px —— 宁可少画一个数字，也不要糊成噪点。
    ("        if (w >= 21 && h >= 9) {\n          ctx.fillStyle = inkOn(tileRgb, 0.85);\n          ctx.font = '8px ui-monospace, Menlo, monospace';",
     "        if (w >= 28 && h >= 11) {\n          ctx.fillStyle = inkOn(tileRgb, 0.85);\n          ctx.font = '9px ui-monospace, Menlo, monospace';"),
]
for a, b in pairs:
    if a not in s:
        raise SystemExit('MISS: ' + a[:60])
    s = s.replace(a, b, 1)

if crlf:
    s = (CR + LF).join(s.split(LF))
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('treemap text thresholds tightened')
