"""產生 Commons 實拍照片的聯絡表（每棟建築一張代表圖），方便快速檢視抓到的資料。"""
from __future__ import annotations

import csv
from collections import OrderedDict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
ATTR = CC / "ATTRIBUTION.csv"
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
OUT = ROOT / "tools" / "eval" / "out" / "cc-contact-sheet.jpg"

COLS, CELL, PAD, LABEL = 5, 300, 10, 34


def main():
    rows = list(csv.DictReader(ATTR.open(encoding="utf-8-sig")))
    by_b = OrderedDict()
    for r in rows:
        by_b.setdefault(r["building_id"], []).append(r)

    n = len(by_b)
    rows_n = (n + COLS - 1) // COLS
    W = COLS * CELL + (COLS + 1) * PAD
    H = rows_n * (CELL + LABEL) + (rows_n + 1) * PAD + 46
    sheet = Image.new("RGB", (W, H), (18, 32, 46))
    d = ImageDraw.Draw(sheet)
    f_title = ImageFont.truetype(str(FONT), 24)
    f_lab = ImageFont.truetype(str(FONT), 15)
    f_sub = ImageFont.truetype(str(FONT), 12)

    d.text((PAD, 12), f"Wikimedia Commons 實拍資料集：{n} 棟澳門建築 · {len(rows)} 張照片（開放授權）",
           font=f_title, fill=(238, 242, 246))

    for i, (bid, items) in enumerate(by_b.items()):
        r, c = divmod(i, COLS)
        x = PAD + c * (CELL + PAD)
        y = 46 + PAD + r * (CELL + LABEL + PAD)
        try:
            im = Image.open(ROOT / items[0]["file"]).convert("RGB")
            s = min(im.width, im.height)
            im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2))
            im = im.resize((CELL, CELL), Image.LANCZOS)
            sheet.paste(im, (x, y))
        except Exception as e:
            d.rectangle((x, y, x + CELL, y + CELL), fill=(60, 60, 60))
            d.text((x + 8, y + 8), f"讀取失敗 {e}", font=f_sub, fill=(255, 200, 200))
        d.text((x, y + CELL + 4), items[0]["building_zh"], font=f_lab, fill=(240, 244, 248))
        d.text((x, y + CELL + 20), f'{items[0]["class_id"]} · {len(items)} 張 · {items[0]["license"][:14]}',
               font=f_sub, fill=(150, 170, 190))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT, quality=88)
    print(f"[sheet] {OUT.relative_to(ROOT)}  {sheet.size}  {OUT.stat().st_size / 1024:.0f} KB  （{n} 棟）")


if __name__ == "__main__":
    main()
