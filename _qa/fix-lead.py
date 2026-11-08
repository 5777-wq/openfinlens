# -*- coding: utf-8 -*-
import io
CR = chr(13); LF = chr(10)
base = 'D:/57的vibe coding内容/global-fin-dashboard/'

def patch(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    crlf = (CR + LF) in s
    for a, b in pairs:
        a2 = a.replace('\n', CR + LF) if crlf else a
        b2 = b.replace('\n', CR + LF) if crlf else b
        if a2 not in s:
            raise SystemExit('MISS in %s: %r' % (path, a[:60]))
        s = s.replace(a2, b2, 1)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)

patch(base + 'css/style.css', [
    ("  --bg-sunken: #03060a;\n",
     "  --bg-sunken: #03060a;\n"
     "  /* 斑马纹面：比 --bg-sunken 亮、比 --bg-hover 暗，专门给长表格（13F/年度收益/相关性）用。\n"
     "     深空下 --bg-sunken 与 --bg-card 只差 7 个灰阶，条纹实际上看不见。 */\n"
     "  --bg-zebra: #0e151f;\n"),
    ("  --bg-sunken: #e8eef6;\n",
     "  --bg-sunken: #e8eef6;\n  --bg-zebra: #f1f5fa;\n"),
])

patch(base + 'css/ui/03-panels.css', [
    (".fp-tr:not(.fp-th):nth-child(even) { background: var(--bg-sunken); }",
     ".fp-tr:not(.fp-th):nth-child(even) { background: var(--bg-zebra); }"),
    (".cmp-row:not(.cmp-head):nth-child(even) { background-color: var(--bg-sunken); }",
     ".cmp-row:not(.cmp-head):nth-child(even) { background-color: var(--bg-zebra); }"),
    (".cmp-row:not(.cmp-head):nth-child(even) > span:first-child { background: var(--bg-sunken); }",
     ".cmp-row:not(.cmp-head):nth-child(even) > span:first-child { background: var(--bg-zebra); }"),
])

patch(base + 'js/compareview.js', [
    ("        // 强度用品牌色透明度表达（不用涨跌色：相关性没有涨跌方向）\n"
     "        const a = Math.min(0.42, Math.abs(v) * 0.42).toFixed(3);\n"
     "        return `<span class=\"cmp-corr\" style=\"background:rgba(var(--accent-rgb),${a})\">${v.toFixed(2)}</span>`;",
     "        // 强度用**中性石板色**的透明度表达：相关性没有涨跌方向（不用涨跌色），\n"
     "        // 也不该用品牌强调色做整格填充（强调色只留给当前态与图表主指标线）。\n"
     "        const a = Math.min(0.55, Math.abs(v) * 0.55).toFixed(3);\n"
     "        return `<span class=\"cmp-corr\" style=\"background:rgba(146,176,214,${a})\">${v.toFixed(2)}</span>`;"),
])

patch(base + 'js/fundquiz.js', [
    ("      el.form.hidden = !all && done === 0;",
     "      // 早先的 `!all && done === 0` 在「一题未答」时把表单藏了，引导区又没有开始按钮，\n"
     "      // 结果是用户永远点不到第一题（功能性 bug，2026-11 UI 验收发现）。\n"
     "      // 现在：未答完就显示表单，引导语作为首屏说明留在上方，答完整体收起。\n"
     "      el.form.hidden = all;"),
])
print('all done')
