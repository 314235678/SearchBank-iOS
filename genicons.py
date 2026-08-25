"""
genicons.py —— 把用户给的源 PNG 缩放到 iOS AppIcon 全套尺寸，
输出 SearchBank/Assets.xcassets/AppIcon.appiconset/{name}.png + Contents.json。

依赖：Pillow（pip install Pillow）

用法：
    python genicons.py                       # 用 E:\\桌面\\在线考试-01.png（默认）
    python genicons.py path/to/icon.png      # 指定源图
"""
import os, sys, json
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "SearchBank", "Assets.xcassets", "AppIcon.appiconset")
os.makedirs(OUT, exist_ok=True)

SRC = sys.argv[1] if len(sys.argv) > 1 else r"E:\桌面\在线考试-01.png"

# [filename, pixel_size, idiom, scale, point_size]
ICONS = [
    ["icon-20@2x.png",        40,  "iphone",         "2x",  "20x20"],
    ["icon-20@3x.png",        60,  "iphone",         "3x",  "20x20"],
    ["icon-29@2x.png",        58,  "iphone",         "2x",  "29x29"],
    ["icon-29@3x.png",        87,  "iphone",         "3x",  "29x29"],
    ["icon-40@2x.png",        80,  "iphone",         "2x",  "40x40"],
    ["icon-40@3x.png",       120,  "iphone",         "3x",  "40x40"],
    ["icon-60@2x.png",       120,  "iphone",         "2x",  "60x60"],
    ["icon-60@3x.png",       180,  "iphone",         "3x",  "60x60"],
    ["icon-76.png",           76,  "ipad",           "1x",  "76x76"],
    ["icon-76@2x.png",       152,  "ipad",           "2x",  "76x76"],
    ["icon-83.5@2x.png",     167,  "ipad",           "2x",  "83.5x83.5"],
    ["icon-1024.png",       1024,  "ios-marketing",  "1x",  "1024x1024"],
]

print("source:", SRC)

# 1) 先读源图
src = Image.open(SRC)
if src.mode != "RGBA":
    src = src.convert("RGBA")
src_w, src_h = src.size
print("source size:", src_w, "x", src_h)

# 2) 用一张大底图（1024）当 master，缩放 + 锐化一次
master = src.resize((1024, 1024), Image.LANCZOS)

images = []
for name, size, idiom, scale, point in ICONS:
    img = master.resize((size, size), Image.LANCZOS)
    out_path = os.path.join(OUT, name)
    # iOS AppIcon 不允许 alpha；要么白底要么实色。这里用白底（若源图本身有透明，合成到白底）
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        out = Image.alpha_composite(bg, img).convert("RGB")
    else:
        out = img.convert("RGB")
    # AppStore 1024 必须是 PNG，无 alpha
    out.save(out_path, format="PNG", optimize=True)
    images.append({"idiom": idiom, "scale": scale, "size": point, "filename": name})
    print(f"  -> {name} ({size}x{size})")

# 3) 写 Contents.json（若已存在则覆盖 images 字段）
contents_path = os.path.join(OUT, "Contents.json")
if os.path.exists(contents_path):
    try:
        with open(contents_path, "r", encoding="utf-8") as f:
            contents = json.load(f)
    except Exception:
        contents = {}
else:
    contents = {}
contents["images"] = images
contents["info"] = {"version": 1, "author": "xcode"}

with open(contents_path, "w", encoding="utf-8") as f:
    json.dump(contents, f, ensure_ascii=False, indent=2)

print("written", len(images), "icons + Contents.json")
