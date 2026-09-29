"""檢查「選片清單」裡每張照片的尺寸與長寬比，標出偏小的（會影響 336px 編碼器）。

用法：python tools/recognize/check_selection.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_user_photos import SELECTIONS, SRC  # noqa: E402
from make_user_sheets import FOLDER_TO_ID  # noqa: E402

MIN_EDGE = 400          # 最短路邊低於此值 → 對 336px 編碼器偏小
id_to_folder = {v: k for k, v in FOLDER_TO_ID.items()}

for bid in sorted(SELECTIONS):
    folder = id_to_folder.get(bid)
    if not folder:
        continue
    files = sorted(f for f in (SRC / folder).iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
    rows = []
    for i, f in enumerate(files):
        try:
            with Image.open(f) as im:
                w, h = im.size
        except Exception:
            w = h = 0
        rows.append((i, f.name, w, h))
    picked = [r for r in rows if r[0] in SELECTIONS[bid]]
    small = [r for r in picked if min(r[2], r[3]) < MIN_EDGE]
    ok = len(picked) - len(small)
    flag = "" if ok >= 3 else "   ←★ 合格張數不足 3"
    print(f"\n{bid:24s} 選 {len(picked):2d} 張，其中 {ok} 張 ≥{MIN_EDGE}px{flag}")
    for i, name, w, h in picked:
        mark = "  ⚠ 偏小" if min(w, h) < MIN_EDGE else ""
        print(f"    [{i:2d}] {name:8s} {w:4d}x{h:<4d} 比例 {w/max(1,h):.2f}{mark}")
    if small:
        # 建議：同棟裡尺寸夠大、又還沒被選的候選（僅供人工複核，不自動替換）
        bigs = [r for r in rows if min(r[2], r[3]) >= MIN_EDGE and r[0] not in SELECTIONS[bid]]
        print(f"    同棟未選且尺寸足夠的候選 {len(bigs)} 張：")
        for i, name, w, h in bigs[:12]:
            print(f"      ({i:2d}) {name:8s} {w}x{h}")
