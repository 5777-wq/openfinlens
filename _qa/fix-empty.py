# -*- coding: utf-8 -*-
import io
CR = chr(13); LF = chr(10)
base = 'D:/57的vibe coding内容/global-fin-dashboard/'

# 空态补「引导动作」：文案之外给一个能点的下一步（面板层的 .empty > a/button 样式已备好）
p = base + 'js/app.js'
s = io.open(p, encoding='utf-8', newline='').read()
crlf = (CR + LF) in s

old1 = """      box.innerHTML = '<div class="empty-hint">在任意卡片右上角点 ★ 收藏，这里就会出现你的自选（带走势图）</div>';"""
new1 = """      box.innerHTML = '<div class="empty-hint">在任意卡片右上角点 ★ 收藏，这里就会出现你的自选（带走势图）'
        + '<a class="empty-cta" href="#tab=all">去市场总览 →</a></div>';"""
old2 = """      el.watchWall.innerHTML = '<div class="empty-hint">点击卡片右上角 ★ 添加自选</div>';"""
new2 = """      el.watchWall.innerHTML = '<div class="empty-hint">还没有自选标的'
        + '<a class="empty-cta" href="#tab=all">去市场总览挑几只 →</a></div>';"""
for a, b in ((old1, new1), (old2, new2)):
    a2 = a.replace('\n', CR + LF) if crlf else a
    b2 = b.replace('\n', CR + LF) if crlf else b
    if a2 not in s:
        raise SystemExit('MISS app.js: ' + a[:50])
    s = s.replace(a2, b2, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('app.js empty-state CTA patched')

# 样式壳：空态引导胶囊（只消费令牌）
p2 = base + 'css/ui/01-shell.css'
s2 = io.open(p2, encoding='utf-8', newline='').read()
if '.empty-cta' not in s2:
    block = """

/* 空态引导动作：光有说明文字的空态等于死路，给一个能点的下一步。
   视觉上用描边胶囊（不是实心强调块）：它是引导，不是页面主操作。 */
.empty-cta {
  display: inline-flex; align-items: center; gap: var(--sp-4);
  margin-left: var(--sp-8); padding: var(--sp-4) var(--sp-12);
  border: 1px solid var(--border-hover); border-radius: var(--r-pill);
  color: var(--accent-signature); font-size: var(--fs-12); text-decoration: none;
  white-space: nowrap; vertical-align: baseline;
  transition: background-color var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.empty-cta:hover { background: var(--accent-soft); border-color: var(--accent-signature); }
.empty-cta:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 640px) {
  .empty-cta { margin-left: 0; margin-top: var(--sp-8); }
}
"""
    s2 = s2.rstrip() + block
    io.open(p2, 'w', encoding='utf-8', newline='').write(s2)
    print('01-shell.css .empty-cta added')
