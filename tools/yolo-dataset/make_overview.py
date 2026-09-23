"""資料集總覽表：每個類別抽幾張縮圖排在一起，讓人一眼看出抓到的圖片品質與多樣性。

用法：python tools/yolo-dataset/make_overview.py [--per-class 6]
產出：datasets/macau-buildings/out/overview.jpg
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
RAW = DS / "images" / "raw"
OUT = DS / "out"
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from fetch_dataset import CLASSES  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=6)
    ap.add_argument("--thumb", type=int, default=210)
    args = ap.parse_args()

    rows = []
    for cid, (zh, _q) in CLASSES.items():
        imgs = sorted(p for p in (RAW / cid).glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if imgs:
            step = max(1, len(imgs) // args.per_class)
            rows.append((cid, zh, len(imgs), imgs[::step][: args.per_class]))

    if not rows:
        raise SystemExit("images/raw 沒有圖片，請先跑 fetch_dataset.py")

    t = args.thumb
    W = 130 + args.per_class * (t + 6) + 10
    H = 46 + len(rows) * (t + 26) + 10
    sheet = Image.new("RGB", (W, H), (245, 243, 238))
    d = ImageDraw.Draw(sheet)
    f_t = ImageFont.truetype(str(FONT), 22)
    f = ImageFont.truetype(str(FONT), 15)
    f_s = ImageFont.truetype(str(FONT), 13)

    total = sum(r[2] for r in rows)
    d.rectangle((0, 0, W, 38), fill=(16, 32, 51))
    d.text((10, 8), f"澳門建築偵測資料集：{len(rows)} 類 · {total} 張（Wikimedia Commons，授權見 ATTRIBUTION.csv）",
           font=f_t, fill=(240, 244, 248))

    for i, (cid, zh, n, imgs) in enumerate(rows):
        y = 46 + i * (t + 26)
        d.text((10, y + t // 2 - 16), zh, font=f, fill=(16, 32, 51))
        d.text((10, y + t // 2 + 2), f"{n} 張", font=f_s, fill=(110, 120, 130))
        for j, p in enumerate(imgs):
            x = 130 + j * (t + 6)
            try:
                im = Image.open(p).convert("RGB")
                s = min(im.width, im.height)
                im = im.crop(((im.width - s) // 2, (im.height - s) // 3, (im.width + s) // 2, (im.height + 2 * s) // 3))
                sheet.paste(im.resize((t, t), Image.LANCZOS), (x, y))
            except Exception as e:
                d.rectangle((x, y, x + t, y + t), fill=(220, 218, 212))
                d.text((x + 6, y + 6), str(e)[:24], font=f_s, fill=(150, 60, 60))

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "overview.jpg"
    sheet.save(out, quality=88)
    print(f"[overview] {out.relative_to(ROOT)}  {sheet.size}  {out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
