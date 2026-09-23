"""蓮花標誌實測：把三張生成圖去背、染成品牌金，並在真實尺寸下比較（含 22px 網站徽章情境）。

輸出 docs/logo-test.png
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ATT = Path(r"C:\Users\LINKIT\.dsh\attachments\v1\objects")
OUT = ROOT / "docs" / "logo-test.png"
BRAND_GOLD = (200, 162, 74)      # #C8A24A
INK = (16, 32, 51)               # #10243A
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
FONT_B = Path(r"C:\Windows\Fonts\msjhbd.ttc")

SRC = {
    "A｜幾何五瓣＋中心點": ATT / "06" / "06a311148c4cab782d55e5344d34b665092b35360d0472b96116394a69e26465",
    "B1｜等高線蓮花": ATT / "dc" / "dc1e949c0c1f0607f144a058b845ed2922f89542f62932611000ddd6dd0379b0",
    "B2｜等高線蓮花（密）": ATT / "00" / "003c1a39b500011511caac254d2d27f8e8d7e2ebe898368c29657d440afc49d0",
}


def extract_mark(path: Path, pad_ratio=0.04, ink_thresh=190):
    """把金色線稿抽出來：回傳 (RGBA 正方形圖, 原圖裁切框)。"""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    # 金色判定：偏黃（R>B）且不是接近白（排除紙紋與浮水印）
    mask = (r - b > 25) & (r < ink_thresh + 60) & (g > 60) & (b < 200)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise SystemExit(f"找不到圖形：{path.name}")
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    pad = int(side * pad_ratio)
    half = side // 2 + pad
    box = (max(0, cx - half), max(0, cy - half), min(im.width, cx + half), min(im.height, cy + half))
    crop = im.crop(box)
    # 轉成 RGBA：以亮度做 alpha（線愈深愈不透明），顏色統一成品牌金
    gray = np.asarray(crop.convert("L")).astype(float)
    alpha = np.clip((255 - gray) / 255 * 2.2, 0, 1)          # 線稿→不透明，紙紋→透明
    alpha[alpha < 0.18] = 0                                   # 去掉殘留紙紋
    rgba = np.zeros((crop.height, crop.width, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = BRAND_GOLD
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA"), box


def on_bg(mark: Image.Image, size: int, bg):
    """把標誌縮到指定尺寸，貼在指定底色上（取樣用最近鄰也試，避免細節糊掉）。"""
    canvas = Image.new("RGB", (size, size), bg)
    m = mark.resize((size, size), Image.LANCZOS)
    canvas.paste(m, (0, 0), m)
    return canvas


def main():
    marks = {}
    for name, p in SRC.items():
        if not p.exists():
            print("缺少", p)
            continue
        marks[name], box = extract_mark(p)
        print(f"  {name}：裁切 {box}  → {marks[name].size}")

    if not marks:
        raise SystemExit("沒有可用的圖")

    sizes = [160, 96, 48, 32, 22]
    pad, row_h = 16, 190
    panel_w = pad + sum(s + pad + 30 for s in sizes) + 260
    W = panel_w + pad
    H = 74 + len(marks) * row_h + 150
    sheet = Image.new("RGB", (W, H), (247, 245, 240))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(str(FONT), 15)
    fb = ImageFont.truetype(str(FONT_B), 17)
    ft = ImageFont.truetype(str(FONT_B), 22)

    d.rectangle((0, 0, W, 56), fill=INK)
    d.text((pad, 12), "蓮花標誌實測：不同尺寸下的可辨識度（金 #C8A24A）", font=ft, fill=(240, 244, 248))

    y = 74
    for name, mark in marks.items():
        d.text((pad, y + 60), name, font=fb, fill=INK)
        x = pad + 250
        d.text((x, y - 2), "淺底", font=f, fill=(120, 130, 140))
        for s in sizes:
            tile = on_bg(mark, s, (247, 245, 240))
            sheet.paste(tile, (x, y + 18))
            d.text((x, y + 20 + max(sizes) + 2), f"{s}px", font=f, fill=(120, 130, 140))
            x += s + pad + 22
        y += row_h

    # 真實情境：網站左上角膠囊徽章（深色面板）
    y += 6
    d.text((pad, y), "實際情境：網站左上角徽章（深色面板，圖標 22px）", font=fb, fill=INK)
    y += 30
    bx = pad
    for name, mark in marks.items():
        bw, bh = 210, 46
        d.rounded_rectangle((bx, y, bx + bw, y + bh), 999, fill=(22, 34, 48), outline=(70, 90, 110))
        ic = Image.new("RGB", (22, 22), (22, 34, 48))
        m22 = mark.resize((22, 22), Image.LANCZOS)
        ic.paste(m22, (0, 0), m22)
        sheet.paste(ic, (bx + 12, y + 12))
        d.text((bx + 42, y + 8), "澳門立體誌", font=ImageFont.truetype(str(FONT_B), 15), fill=(230, 236, 242))
        d.text((bx + 42, y + 26), "3D Macau Atlas", font=ImageFont.truetype(str(FONT), 10), fill=(150, 165, 180))
        bx += bw + 14

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"\n[out] {OUT.relative_to(ROOT)}  {sheet.size}  {OUT.stat().st_size / 1024:.0f} KB")

    # 同時把去背、統一成品牌金的乾淨素材存下來（透明 PNG，可直接用於網站／展板）
    assets = ROOT / "public" / "brand"
    assets.mkdir(parents=True, exist_ok=True)
    names = {"A｜幾何五瓣＋中心點": "lotus-a.png",
             "B1｜等高線蓮花": "lotus-b1.png",
             "B2｜等高線蓮花（密）": "lotus-b2.png"}
    for name, mark in marks.items():
        p = assets / names.get(name, "lotus.png")
        mark.resize((512, 512), Image.LANCZOS).save(p)
        print(f"  ✓ {p.relative_to(ROOT)}  512×512 透明 PNG")


if __name__ == "__main__":
    main()
