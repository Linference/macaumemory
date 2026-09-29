"""針對少數幾張照片做「大圖 + 完整檔名 + 編號」的檢視表，避免縮圖看不清楚。

用法：
    python tools/recognize/make_review_sheet.py <building_id> [--files f1,f2] [--cell 700]
輸出：tools/recognize/out/detail/<building_id>-review.jpg
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
OUT = Path(__file__).resolve().parent / "out" / "detail"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bid")
    ap.add_argument("--files", default=None, help="逗號分隔的檔名（預設全部）")
    ap.add_argument("--cell", type=int, default=700)
    ap.add_argument("--cols", type=int, default=3)
    args = ap.parse_args()

    d = CC / args.bid
    files = sorted(f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if args.files:
        want = set(args.files.split(","))
        files = [f for f in files if f.name in want]
    if not files:
        print("  沒有符合的檔案")
        return 1
    cols = args.cols
    cell = args.cell
    label = 30
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + label)), (11, 15, 20))
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        cx, cy = (i % cols) * cell, (i // cols) * (cell + label)
        im = Image.open(f).convert("RGB")
        im.thumbnail((cell, cell), Image.LANCZOS)
        sheet.paste(im, (cx + (cell - im.width) // 2, cy))
        draw.text((cx + 5, cy + cell + 4), f"[{i:02d}] {f.name[:70]}", fill=(225, 235, 245))
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{args.bid}-review.jpg"
    sheet.save(p, quality=92)
    print(f"  {p.relative_to(ROOT)}  ({len(files)} 張)")
    for i, f in enumerate(files):
        print(f"    [{i:02d}] {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
