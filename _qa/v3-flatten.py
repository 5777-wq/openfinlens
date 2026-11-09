# -*- coding: utf-8 -*-
"""v3 减法②：去掉光面渐变 / 玻璃模糊 / 内高光，改成实底 + 1px 描边。"""
import io, re
CR, LF = chr(13), chr(10)
B = 'D:/57的vibe coding内容/global-fin-dashboard/'

def fix(path):
    s = io.open(path, encoding='utf-8', newline='').read()
    crlf = (CR + LF) in s
    if crlf: s = LF.join(s.split(CR + LF))
    orig = s

    # 1) 光面渐变 → 实底
    s = s.replace("background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0) 60%), var(--bg-card);",
                  "background: var(--bg-card);")
    s = re.sub(r"background:\s*linear-gradient\(180deg,\s*rgba\(255,255,255,0\.0[0-9]+\),[\s\S]{0,40}?var\(--bg-card\);",
               "background: var(--bg-card);", s)
    # 2) 去掉 backdrop-filter（玻璃）
    s = re.sub(r"\n[ \t]*-?w?e?b?k?i?t?-?backdrop-filter:[^;]+;", "", s)
    s = re.sub(r"\n[ \t]*backdrop-filter:[^;]+;", "", s)
    # 3) 玻璃底色 → 不透明面板色
    s = s.replace("background: var(--bg-glass);", "background: var(--bg-elevated);")
    # 4) 内高光（光面的一部分）
    s = re.sub(r"\s*inset 0 1px 0 rgba\(255,255,255,0\.0[0-9]\),?", "", s)
    s = re.sub(r"\s*inset 0 1px 0 rgba\(255,255,255,0\.0[0-9]\),", "", s)
    if crlf: s = (CR + LF).join(s.split(LF))
    if s != orig:
        io.open(path, 'w', encoding='utf-8', newline='').write(s)
        print('flattened', path)

for f in ['01-shell.css', '02-market.css', '03-panels.css', '04-motion.css']:
    fix(B + 'css/ui/' + f)
print('done')
