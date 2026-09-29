"""把一批預覽圖併成一張聯絡表（contact sheet），方便人工檢視。

用法：
    python tools/yolo-dataset/make_contact_sheet.py --src .cache/vlm-label/render-probe \
        --out .cache/vlm-label/sheet-probe.jpg --cols 5 --cell 420
    python tools/yolo-dataset/make_contact_sheet.py --manifest list.txt --out sheet.jpg
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def font(size: int):
    for n in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(n, size)
        except Exception:
            continue
    return ImageFont.load_default()


def fit(im: Image.Image, w: int, h: int) -> Image.Image:
    sc = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", nargs="*", default=[], help="預覽圖資料夾（可多個）")
    ap.add_argument("--manifest", default=None, help="每行一個圖檔路徑，可加 |標題")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=5)
    ap.add_argument("--cell", type=int, default=430)
    ap.add_argument("--title", default="")
    args = ap.parse_args()

    items: list[tuple[Path, str]] = []
    if args.manifest:
        for line in Path(args.manifest).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            p, _, cap = line.partition("|")
            items.append((Path(p), cap or Path(p).stem))
    for s in args.src:
        d = Path(s)
        if not d.is_absolute():
            d = ROOT / d
        items += [(p, p.stem) for p in sorted(d.glob("*.jpg"))]
    if not items:
        raise SystemExit("沒有圖片")

    cols = args.cols
    rows = (len(items) + cols - 1) // cols
    cell, cap_h, pad = args.cell, 30, 6
    W = cols * (cell + pad) + pad
    H = rows * (cell + cap_h + pad) + pad + (34 if args.title else 0)
    sheet = Image.new("RGB", (W, H), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    f = font(19)
    ft = font(26)
    top = 0
    if args.title:
        d.text((pad, 6), args.title, font=ft, fill=(255, 235, 120))
        top = 34
    for i, (p, cap) in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = top + pad + r * (cell + cap_h + pad)
        try:
            with Image.open(p) as im:
                im = fit(im.convert("RGB"), cell, cell)
        except Exception as e:
            d.text((x, y), f"ERR {p.name}: {e}", font=f, fill=(255, 90, 90))
            continue
        sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        d.rectangle([x, y, x + cell, y + cell], outline=(80, 80, 90))
        d.text((x + 2, y + cell + 4), cap[:52], font=f, fill=(230, 230, 230))
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, "JPEG", quality=85)
    print(f"[out] {out} ({sheet.width}x{sheet.height}, {len(items)} 張)")


if __name__ == "__main__":
    main()
