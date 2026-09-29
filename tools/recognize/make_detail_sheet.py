"""放大檢視「已匯入的照片」本身（不是原始資料夾），確認主體真的是該棟建築。

用法：python tools/recognize/make_detail_sheet.py <building_id> [<building_id> ...]
輸出：tools/recognize/out/detail/<building_id>.jpg
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
OUT = Path(__file__).resolve().parent / "out" / "detail"

CELL = 420
COLS = 5
LABEL_H = 22


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for bid in sys.argv[1:]:
        d = CC / bid
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if not files:
            print(f"  {bid}: 沒有檔案")
            continue
        rows = (len(files) + COLS - 1) // COLS
        sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL_H)), (11, 15, 20))
        draw = ImageDraw.Draw(sheet)
        for i, f in enumerate(files):
            cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL_H)
            im = Image.open(f).convert("RGB")
            im.thumbnail((CELL, CELL), Image.LANCZOS)
            sheet.paste(im, (cx + (CELL - im.width) // 2, cy))
            draw.text((cx + 4, cy + CELL + 4), f"{i:02d} {f.name[:40]}", fill=(210, 222, 235))
        p = OUT / f"{bid}.jpg"
        sheet.save(p, quality=92)
        print(f"  {p.relative_to(ROOT)}  ({len(files)} 張)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
