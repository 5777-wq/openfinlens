# -*- coding: utf-8 -*-
"""v3 减法③：删掉首屏市场简报带 / 冗长说明行 / 空自选占位；页脚数据源墙收进折叠。"""
import io, re
CR, LF = chr(13), chr(10)
B = 'D:/57的vibe coding内容/global-fin-dashboard/'

def load(p):
    s = io.open(p, encoding='utf-8', newline='').read()
    return s, (CR + LF) in s

def save(p, s, crlf):
    if crlf: s = (CR + LF).join(s.split(LF))
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('patched', p)

# ============ 1) index.html：删简报带 + 页脚折叠 ============
p = B + 'index.html'
s, crlf = load(p)
if crlf: s = LF.join(s.split(CR + LF))

# 简报带整块（含上方注释）
m = re.search(r"[ \t]*<!--[^\n]*仪表条语言[\s\S]*?<div id=\"marketBriefLive\"[^\n]*\n", s)
if not m:
    m = re.search(r"[ \t]*<div class=\"brief\" id=\"marketBrief\"[\s\S]*?<div id=\"marketBriefLive\"[^\n]*\n", s)
assert m, '找不到简报带块'
s = s[:m.start()] + "      <!-- v3（2026-11-09）：市场简报带已删除。它把「全球指数几涨几跌」和「A股宽度」\n           用两条长条再讲一遍，与下方指数卡完全重复；用户原话「这个玩意啥用都没有」。\n           市场宽度仍在「市场 → 情绪」分区里完整保留。 -->\n" + s[m.end():]

# 页脚数据源墙 → 折叠
foot_old = re.search(r"(    <div>\n      数据来源：[\s\S]*?不构成投资建议。\n    </div>\n)", s)
assert foot_old, '找不到页脚数据源段'
s = s[:foot_old.start()] + (
    "    <details class=\"foot-src\">\n"
    "      <summary>数据来源与免责声明</summary>\n"
    "      <p>\n"
    "        腾讯财经（A股/港股/美股/全球指数、K线、分时）· 东方财富（A股全市场、外汇、大宗商品、国债收益率、搜索、板块榜、龙虎榜）·\n"
    "        币安（加密行情与K线）· 新浪财经（滚动新闻）· 世界银行（宏观年度指标）·\n"
    "        GDELT + 新浪7x24（全球事件，GitHub Actions 采集为静态 JSON，浏览器不直连）· SEC EDGAR（13F 季度持仓，静态 JSON）·\n"
    "        中金所股指期权经东方财富 · 加密期权 OKX/Deribit。\n"
    "        行情为第三方公开接口数据，可能延迟，仅供参考，不构成投资建议。\n"
    "      </p>\n"
    "    </details>\n") + s[foot_old.end():]
if crlf: s = (CR + LF).join(s.split(LF))
save(p, s, crlf)

# ============ 2) app.js：删 renderMarketBrief + 说明行 + 空自选占位 ============
p = B + 'js/app.js'
s, crlf = load(p)
if crlf: s = LF.join(s.split(CR + LF))

# 2a. 删函数（从注释标题到下一个大节注释前）
start = s.index("  /* 「市场简报」带（2026-10-20）")
end = s.index("  /* ==================== 吸顶指数跑马条（2026-09-17）")
s = s[:start] + ("  /* v3：renderMarketBrief 已删除（市场简报带整块下线）。\n"
                 "     它的两条长条与下方指数卡重复，属于「结论层」的过度设计；\n"
                 "     市场宽度与情绪分仍由「市场 → 情绪」分区完整提供。 */\n\n") + s[end:]

# 2b. 调用点
s = s.replace("    hydrateSparks(el.heroStrip);\n    hydrateSparks(el.watchGrid);\n    renderMarketBrief();\n",
              "    hydrateSparks(el.heroStrip);\n    hydrateSparks(el.watchGrid);\n", 1)

# 2c. el 引用
s = s.replace("'watchSection', 'watchGrid', 'watchSub', 'watchMore', 'marketBrief', 'marketBriefLive',",
              "'watchSection', 'watchGrid', 'watchSub', 'watchMore',", 1)

# 2d. 冗长说明行：heroCap 不再写长句（整块保持隐藏）
old_cap = """    const keys = heroKeys();
    const cap = document.getElementById('heroCap');
    if (cap) {
      cap.hidden = false;
      // 读法要写清：四条线是同一条时间轴上的"相对首日涨跌幅"，
      // 纵轴高度可直接横向比较（用户问"上证怎么和标普不对齐"——
      // 之前各按自己的 min-max 缩放，幅度全丢了，看着像两条不相干的曲线）。
      cap.textContent = '全球核心指数 · 点击进详情 · 曲线为近 60 个交易日 · 四条线同一时间轴，纵轴为相对首日涨跌幅';
    }
    box.innerHTML = keys.map(heroCellHTML).join('');"""
new_cap = """    const keys = heroKeys();
    // v3：这段说明性长句已删除（"四条线同一时间轴/纵轴为相对首日涨跌幅"讲的是实现，
    // 不是用户此刻需要的）。曲线口径改为 hover 时在图例上体现，不在首屏占一行。
    box.innerHTML = keys.map(heroCellHTML).join('');"""
assert old_cap in s, '找不到 heroCap 块'
s = s.replace(old_cap, new_cap, 1)

# 2e. 空自选：整块隐藏，不留占位卡（用户："空的就别占地方"）
old_watch = """    if (el.watchSection) el.watchSection.hidden = false;
    const list = homeWatchItems();
    const items = list.filter(x => x.q && x.q.price !== null);"""
new_watch = """    const list = homeWatchItems();
    // v3 逻辑改动：没有自选就整块隐藏。旧版留一张空态卡占掉一整行首屏高度，
    // 而「去市场总览」本身就在一级导航里，不需要一块永远为空的区域来提醒。
    if (el.watchSection) el.watchSection.hidden = !list.length;
    if (!list.length) { box.innerHTML = ''; return; }
    const items = list.filter(x => x.q && x.q.price !== null);"""
assert old_watch in s, '找不到 renderHomeWatch 头部'
s = s.replace(old_watch, new_watch, 1)

# 去掉后面重复的空态分支
old_empty = """    if (!list.length) {
      box.innerHTML = '<div class="empty-hint">在任意卡片右上角点 ★ 收藏，这里就会出现你的自选（带走势图）'
        + '<a class="empty-cta" href="#tab=all">去市场总览 →</a></div>';
      return;
    }
"""
assert old_empty in s, '找不到空态分支'
s = s.replace(old_empty, "", 1)

if crlf: s = (CR + LF).join(s.split(LF))
save(p, s, crlf)

# ============ 3) CSS：删 .brief 规则 ============
for f in ['css/style.css', 'css/ui/02-market.css']:
    p = B + f
    s, crlf = load(p)
    if crlf: s = LF.join(s.split(CR + LF))
    n0 = len(s)
    # 逐条删选择器以 .brief 开头的规则
    out, i, removed = [], 0, 0
    while i < len(s):
        # 找规则起点：从当前位置开始的选择器块
        m = re.compile(r"([^{}]+)\{([^{}]*)\}").search(s, i)
        if not m:
            out.append(s[i:]); break
        sel = m.group(1)
        first = sel.strip().split('\n')[-1].strip()
        if first.startswith('.brief') or '.brief-' in first or '.brief ' in first + ' ':
            out.append(s[i:m.start()])
            removed += 1
            i = m.end()
        else:
            out.append(s[i:m.end()])
            i = m.end()
    s2 = ''.join(out)
    if crlf: s2 = (CR + LF).join(s2.split(LF))
    io.open(p, 'w', encoding='utf-8', newline='').write(s2)
    print('brief CSS removed', f, removed, 'rules', n0, '->', len(s2))
