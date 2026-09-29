"""產生乾淨的最終框預覽圖（只畫最終框，細線），供人工檢視框的緊實度。

用法：
    python tools/yolo-dataset/render_final.py --labels .cache/vlm-label/labels.json \
        --out .cache/vlm-label/render-final --keys accepted.txt
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
LONG = 900


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keys", default=None, help="文字檔：每行一個圖片完整路徑，只畫這些")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--width", type=int, default=2)
    ap.add_argument("--color", default="255,0,200")
    args = ap.parse_args()

    data = json.loads(Path(args.labels).read_text(encoding="utf-8"))
    recs = list(data.values())
    if args.keys:
        want = {l.strip() for l in Path(args.keys).read_text(encoding="utf-8").splitlines() if l.strip()}
        recs = [r for r in recs if r["file"] in want]
    recs = [r for r in recs if r.get("ok") and r.get("final_box")]
    if args.limit:
        recs = recs[:args.limit]
    col = tuple(int(v) for v in args.color.split(","))
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for r in recs:
        p = Path(r["file"])
        try:
            with Image.open(p) as im:
                im = im.convert("RGB")
                sc = LONG / max(im.size)
                im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
                W, H = im.size
                gw, gh = r.get("grid_size") or [W, H]
                sx, sy = W / gw, H / gh
                x, y, w, h = r["final_box"]
                d = ImageDraw.Draw(im)
                d.rectangle([x * sx, y * sy, (x + w) * sx, (y + h) * sy], outline=col, width=args.width)
                im.save(out / f"{p.parent.name}__{p.stem}.jpg", "JPEG", quality=85)
                n += 1
        except Exception as e:
            print(f"[warn] {p.name}: {e}")
    print(f"[out] {n} 張 → {out}")


if __name__ == "__main__":
    main()
