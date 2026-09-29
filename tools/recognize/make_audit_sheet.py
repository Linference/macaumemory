"""把稽核出的可疑參考照片拼成一張聯絡表（contact sheet），方便人工複核。

用法：
    python tools/recognize/make_audit_sheet.py
    python tools/recognize/make_audit_sheet.py --only other_class
輸出：tools/recognize/out/ref-audit-sheet.jpg
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
CC = ROOT / "photos-src" / "cc"
DEMO = ROOT / "photos-src" / "demo"

CELL = 260
COLS = 6


def resolve(bid: str, fname: str) -> Path | None:
    for base in (CC / bid, DEMO):
        p = base / fname
        if p.is_file():
            return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="只列某種判定（other_class / no_detection / tiny_subject）")
    ap.add_argument("--out", default=str(OUT / "ref-audit-sheet.jpg"))
    args = ap.parse_args()

    rows = json.loads((OUT / "ref-audit.json").read_text(encoding="utf-8"))
    if args.only:
        rows = [r for r in rows if r["verdict"] == args.only]
    else:
        rows = [r for r in rows if r["verdict"] != "ok"]
    print(f"{len(rows)} 張可疑影像")

    cols = COLS
    n = len(rows)
    grid_rows = (n + cols - 1) // cols
    label_h = 34
    sheet = Image.new("RGB", (cols * CELL, grid_rows * (CELL + label_h)), (11, 15, 20))
    draw = ImageDraw.Draw(sheet)
    for i, r in enumerate(rows):
        p = resolve(r["id"], r["file"])
        cx, cy = (i % cols) * CELL, (i // cols) * (CELL + label_h)
        if p is None:
            draw.text((cx + 6, cy + 6), f"{r['id']}\n{r['file'][:24]}\n（找不到檔）", fill=(240, 180, 160))
            continue
        try:
            im = Image.open(p).convert("RGB")
            im.thumbnail((CELL, CELL), Image.LANCZOS)
            sheet.paste(im, (cx + (CELL - im.width) // 2, cy))
        except Exception as e:
            draw.text((cx + 6, cy + 6), f"讀取失敗 {e}", fill=(240, 180, 160))
        color = (248, 113, 113) if r["verdict"] == "other_class" else (250, 204, 21)
        draw.text((cx + 5, cy + CELL + 2), f"{r['id'][:20]}", fill=color)
        draw.text((cx + 5, cy + CELL + 15), f"{r['file'][:32]}", fill=(180, 195, 210))
        draw.text((cx + CELL - 78, cy + CELL + 2), r["verdict"][:12], fill=color)
    sheet.save(args.out, quality=88)
    print(f"→ {args.out}（{sheet.width}×{sheet.height}）")
    # 依序編號，方便對照
    for i, r in enumerate(rows):
        print(f"  [{i:2d}] {r['verdict']:13s} {r['id']:22s} {r['file'][:48]:48s} {r['why'][:60]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
