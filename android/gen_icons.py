#!/usr/bin/env python
# gen_icons.py —— 生成启动图标（与网页版 logo 同语言：黑底 + 交互强调色圆点）
# 用 PIL 画，避免引入任何二进制素材；产物进 res/mipmap-*/
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "res")
BG = (10, 10, 11, 255)        # #0a0a0b
ACCENT = (232, 163, 61, 255)  # #e8a33d（2026-09-15 由 #D97757 改来，与 css --accent-signature 同值）
DARK = (28, 28, 30, 255)

SIZES = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
         "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}

def make(size):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    # 外环（透镜）
    ring_w = max(2, size // 16)
    pad = size * 0.18
    d.ellipse([pad, pad, size - pad, size - pad], outline=ACCENT, width=ring_w)
    # 内点（市场）
    dot = size * 0.16
    cx = cy = size / 2
    d.ellipse([cx - dot / 2, cy - dot / 2, cx + dot / 2, cy + dot / 2], fill=ACCENT)
    # 右下小方点（数据感）
    sq = size * 0.09
    d.rectangle([size * 0.68, size * 0.68, size * 0.68 + sq, size * 0.68 + sq], fill=DARK)
    return img

for name, px in SIZES.items():
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    make(px).save(os.path.join(d, "ic_launcher.png"))
    print("ok", name, px)
