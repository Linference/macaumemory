"""為「每一棟建築」產生聯絡表（contact sheet），用來逐張目視複核參考照片。

與 make_audit_sheet.py 的差別：
    make_audit_sheet.py  只列「YOLO 判定可疑」的照片（給複核用的短清單）
    make_reference_sheet.py  列出**指定建築的所有照片**，每張標上檔名與 YOLO 判定，
                              因為「偵測不到不等於照片錯」——最後仍必須人眼看過每一張。

用法：
    python tools/recognize/make_reference_sheet.py --only dom-pedro-v-theatre
    python tools/recognize/make_reference_sheet.py --per-sheet 12      # 每張聯絡表放幾格
輸出：tools/recognize/out/sheets/<building>-<n>.jpg
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
OUT = Path(__file__).resolve().parent / "out"
SHEETS = OUT / "sheets"

CELL = 340
COLS = 4


def verdict_map() -> dict[str, dict]:
    """讀 ref-audit.json（若存在），把 (building, file) → 判定。"""
    p = OUT / "ref-audit.json"
    if not p.is_file():
        return {}
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {f"{r.get('id')}/{r.get('file')}": r for r in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="逗號分隔的建築 id；預設全部")
    ap.add_argument("--per-sheet", type=int, default=12)
    ap.add_argument("--all", action="store_true", help="連既有建築也一起產生（預設只做有新增的）")
    args = ap.parse_args()

    SHEETS.mkdir(parents=True, exist_ok=True)
    vm = verdict_map()
    wanted = set(args.only.split(",")) if args.only else None

    dirs = sorted(d for d in CC.iterdir() if d.is_dir())
    if wanted:
        dirs = [d for d in dirs if d.name in wanted]

    made = []
    for d in dirs:
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if not files:
            continue
        for start in range(0, len(files), args.per_sheet):
            chunk = files[start:start + args.per_sheet]
            rows = (len(chunk) + COLS - 1) // COLS
            label_h = 40
            sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + label_h)), (11, 15, 20))
            draw = ImageDraw.Draw(sheet)
            for i, f in enumerate(chunk):
                cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + label_h)
                try:
                    im = Image.open(f).convert("RGB")
                    im.thumbnail((CELL, CELL), Image.LANCZOS)
                    sheet.paste(im, (cx + (CELL - im.width) // 2, cy))
                except Exception as e:
                    draw.text((cx + 6, cy + 6), f"讀取失敗 {e}", fill=(240, 180, 160))
                v = vm.get(f"{d.name}/{f.name}", {})
                verdict = v.get("verdict", "?")
                color = {"ok": (74, 222, 128), "other_class": (248, 113, 113),
                         "no_detection": (250, 204, 21), "tiny_subject": (251, 146, 60)}.get(verdict, (160, 175, 190))
                draw.text((cx + 5, cy + CELL + 1), f.name[:44], fill=(214, 226, 238))
                draw.text((cx + 5, cy + CELL + 14), f"idx={start + i} {verdict}", fill=color)
                draw.text((cx + 5, cy + CELL + 27), (v.get("top", "") or "")[:42], fill=(150, 168, 186))
            n = start // args.per_sheet + 1
            out = SHEETS / f"{d.name}-{n}.jpg"
            sheet.save(out, quality=90)
            made.append(out)
            print(f"  {out.relative_to(ROOT)}  ({len(chunk)} 張)")
    print(f"\n共 {len(made)} 張聯絡表 → {SHEETS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
