# -*- coding: utf-8 -*-
"""v3 减法：把 v2 的深空蓝调换成纯黑/纯白 + 中性灰；强调色退成单色（白/黑）。"""
import io, re
CR, LF = chr(13), chr(10)
B = 'D:/57的vibe coding内容/global-fin-dashboard/'

def read(p):
    s = io.open(p, encoding='utf-8', newline='').read()
    return s, ((CR + LF) in s)

def write(p, s, crlf):
    if crlf: s = (CR + LF).join(s.split(LF))
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

p = B + 'css/style.css'
s, crlf = read(p)
s = LF.join(s.split(CR + LF)) if crlf else s

# ---------- 深空（改为纯黑单色） ----------
dark_old = """  /* ---------- 底色五层：0 画布 → 1 面板 → 2 卡片 → 3 悬停 → 4 按下 ---------- */
  --bg: #05080d;
  --bg-elevated: #0b1119;
  --bg-card: #0a0f17;
  --bg-hover: #131c27;
  --bg-sunken: #03060a;
  /* 斑马纹面：比 --bg-sunken 亮、比 --bg-hover 暗，专门给长表格（13F/年度收益/相关性）用。
     深空下 --bg-sunken 与 --bg-card 只差 7 个灰阶，条纹实际上看不见。 */
  --bg-zebra: #0e151f;
  --bg-glass: rgba(11,17,25,0.72);"""
dark_new = """  /* ---------- 底色五层（2026-11 v3 减法：纯黑 + 中性灰，不再有蓝调） ---------- */
  --bg: #000000;
  --bg-elevated: #0a0a0a;
  --bg-card: #0b0b0b;
  --bg-hover: #171717;
  --bg-sunken: #060606;
  --bg-zebra: #101010;
  --bg-glass: rgba(0,0,0,0.86);"""
assert dark_old in s; s = s.replace(dark_old, dark_new, 1)

txt_old = """  /* ---------- 文字四级（对最差表面均 ≥4.5:1） ---------- */
  --text: #e8f0fa;
  --text-secondary: #a6b6ca;
  --text-tertiary: #8496ab;
  --text-faint: #7b8da4;"""
txt_new = """  /* ---------- 文字四级（纯中性灰，对最差表面均 ≥4.5:1） ---------- */
  --text: #f2f2f2;
  --text-secondary: #a8a8a8;
  --text-tertiary: #8a8a8a;
  --text-faint: #7d7d7d;"""
assert txt_old in s; s = s.replace(txt_old, txt_new, 1)

bd_old = """  --border: rgba(146,176,214,0.17);
  --border-hover: rgba(146,176,214,0.30);
  --border-soft: rgba(146,176,214,0.07);
  --border-strong: rgba(146,176,214,0.42);"""
bd_new = """  --border: rgba(255,255,255,0.14);
  --border-hover: rgba(255,255,255,0.28);
  --border-soft: rgba(255,255,255,0.07);
  --border-strong: rgba(255,255,255,0.40);"""
assert bd_old in s; s = s.replace(bd_old, bd_new, 1)

acc_old = """  --accent-signature: #35e1ff;
  --accent-rgb: 53,225,255;
  --accent-2: #4f7cff;
  --accent-2-rgb: 79,124,255;
  --accent-soft: rgba(53,225,255,0.12);
  --accent-line: linear-gradient(90deg, rgba(53,225,255,0), rgba(53,225,255,0.85) 18%, rgba(79,124,255,0.85) 78%, rgba(79,124,255,0));"""
acc_new = """  --accent-signature: #ffffff;
  --accent-rgb: 255,255,255;
  --accent-2: #d4d4d4;
  --accent-2-rgb: 212,212,212;
  --accent-soft: rgba(255,255,255,0.10);
  --accent-line: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.85) 18%, rgba(255,255,255,0.85) 78%, rgba(255,255,255,0));"""
assert acc_old in s; s = s.replace(acc_old, acc_new, 1)

grid_old = """  --grid-line: rgba(120,160,200,0.05);
  --glow-1: 53,225,255;
  --glow-2: 79,124,255;
  --topbar-bg: rgba(5,8,13,0.82);
  --tape-bg: rgba(5,8,13,0.78);"""
grid_new = """  --grid-line: rgba(255,255,255,0.04);
  --glow-1: 255,255,255;
  --glow-2: 255,255,255;
  --topbar-bg: rgba(0,0,0,0.86);
  --tape-bg: rgba(0,0,0,0.82);"""
assert grid_old in s; s = s.replace(grid_old, grid_new, 1)

ma_old = "  --ma-0: #35e1ff;"
ma_new = "  --ma-0: #ffffff;"
assert ma_old in s; s = s.replace(ma_old, ma_new, 1)

chart_old = """  --chart-text: #7e90a6;
  --chart-grid: rgba(146,176,214,0.06);
  --chart-border: rgba(146,176,214,0.12);"""
chart_new = """  --chart-text: #8a8a8a;
  --chart-grid: rgba(255,255,255,0.06);
  --chart-border: rgba(255,255,255,0.12);"""
assert chart_old in s; s = s.replace(chart_old, chart_new, 1)

# ---------- 日光（纯白单色） ----------
day_old = """  --bg: #f6f8fb;
  --bg-elevated: #ffffff;
  --bg-card: #ffffff;
  --bg-hover: #eef3f9;
  --bg-sunken: #e8eef6;
  --bg-zebra: #f1f5fa;
  --bg-glass: rgba(255,255,255,0.78);
  --text: #0b1520;
  --text-secondary: #46586d;
  --text-tertiary: #5f7288;
  --text-faint: #6f8296;
  --border: rgba(18,42,70,0.12);
  --border-hover: rgba(18,42,70,0.26);
  --border-soft: rgba(18,42,70,0.06);
  --border-strong: rgba(18,42,70,0.34);
  --accent-signature: #0091ad;
  --accent-rgb: 0,145,173;
  --accent-2: #2f5bf0;
  --accent-2-rgb: 47,91,240;
  --accent-soft: rgba(0,145,173,0.10);
  --grid-line: rgba(30,70,110,0.05);
  --glow-1: 0,145,173;
  --glow-2: 47,91,240;
  --topbar-bg: rgba(246,248,251,0.85);
  --tape-bg: rgba(246,248,251,0.8);"""
day_new = """  --bg: #ffffff;
  --bg-elevated: #ffffff;
  --bg-card: #ffffff;
  --bg-hover: #f2f2f2;
  --bg-sunken: #f7f7f7;
  --bg-zebra: #fafafa;
  --bg-glass: rgba(255,255,255,0.86);
  --text: #111111;
  --text-secondary: #4d4d4d;
  --text-tertiary: #666666;
  --text-faint: #737373;
  --border: rgba(0,0,0,0.14);
  --border-hover: rgba(0,0,0,0.28);
  --border-soft: rgba(0,0,0,0.07);
  --border-strong: rgba(0,0,0,0.38);
  --accent-signature: #000000;
  --accent-rgb: 0,0,0;
  --accent-2: #333333;
  --accent-2-rgb: 51,51,51;
  --accent-soft: rgba(0,0,0,0.08);
  --grid-line: rgba(0,0,0,0.04);
  --glow-1: 0,0,0;
  --glow-2: 0,0,0;
  --topbar-bg: rgba(255,255,255,0.88);
  --tape-bg: rgba(255,255,255,0.84);"""
assert day_old in s; s = s.replace(day_old, day_new, 1)

# 日光强调色相关的两处（焦点环 / 图表 / 阴影）保持中性
s = s.replace("  --focus-ring: #0091ad;\n  --warn: #b45309;", "  --focus-ring: #000000;\n  --warn: #b45309;", 1)
s = s.replace("  --chart-text: #5f7288;\n  --chart-grid: rgba(18,42,70,0.07);\n  --chart-border: rgba(18,42,70,0.14);",
              "  --chart-text: #666666;\n  --chart-grid: rgba(0,0,0,0.07);\n  --chart-border: rgba(0,0,0,0.14);", 1)
s = s.replace("  --ring-glow: 0 0 0 1px rgba(var(--accent-rgb),0.45), 0 0 24px -10px rgba(var(--accent-rgb),0.5);",
              "  --ring-glow: 0 0 0 1px rgba(var(--accent-rgb),0.35);", 1)
s = s.replace("  --ring-glow: 0 0 0 1px rgba(var(--accent-rgb),0.35), 0 0 28px -8px rgba(var(--accent-rgb),0.55);",
              "  --ring-glow: 0 0 0 1px rgba(var(--accent-rgb),0.35);", 1)
s = s.replace("  --shadow-1: 0 1px 2px rgba(11,21,32,0.05), 0 8px 24px -12px rgba(11,21,32,0.18);\n  --shadow-2: 0 2px 6px rgba(11,21,32,0.07), 0 24px 60px -24px rgba(11,21,32,0.28);",
              "  --shadow-1: 0 1px 2px rgba(0,0,0,0.05), 0 8px 24px -14px rgba(0,0,0,0.16);\n  --shadow-2: 0 2px 8px rgba(0,0,0,0.06), 0 24px 60px -26px rgba(0,0,0,0.22);", 1)

# 画布环境光（网格 + 双光斑）整块删除：v3 要平，不要氛围
amb = re.search(r"/\* 画布环境光：[\s\S]*?body::before \{[\s\S]*?\n\}\n", s)
assert amb, '找不画布环境光块'
s = s[:amb.start()] + "/* v3：画布环境光（网格 + 光斑）已删除——纯黑/纯白底上叠氛围只会显脏。 */\n" + s[amb.end():]

if crlf: s = (CR + LF).join(s.split(LF))
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('style.css flattened')
