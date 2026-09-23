"""用訓練好的「澳門建築偵測器」跑真實照片，畫出框與類別（給人看的驗收）。

誠實性：會自動避開訓練集裡出現過的照片（用 Commons 標題比對），
只挑模型**沒見過**的圖，這樣展示才不虛。

用法：python tools/yolo-dataset/demo_detect.py [--n 8]
產出：datasets/macau-buildings/out/detect-demo.jpg
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
CC = ROOT / "photos-src" / "cc"
OUT = ROOT / "datasets" / "macau-buildings" / "out"
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
FONT_B = Path(r"C:\Windows\Fonts\msjhbd.ttc")
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from fetch_dataset import CLASSES  # noqa: E402

CLASS_ZH = {k: v[0] for k, v in CLASSES.items()}
COLORS = [(214, 48, 49), (0, 148, 168), (200, 162, 74), (108, 92, 231), (46, 134, 222),
          (232, 106, 51), (30, 160, 110), (192, 57, 143), (52, 108, 76), (140, 122, 0), (90, 90, 90)]

CELL_W, PHOTO_H, CAP_H, PAD, COLS = 420, 300, 56, 12, 4


def F(size, bold=False):
    return ImageFont.truetype(str(FONT_B if bold else FONT), size)


def pick_unseen(n: int):
    """挑出「不在訓練集裡」的 CC 實拍照片（用 Commons 標題比對）。"""
    ds_titles = set()
    attr = ROOT / "datasets" / "macau-buildings" / "ATTRIBUTION.csv"
    if attr.exists():
        for r in csv.DictReader(attr.open(encoding="utf-8-sig")):
            ds_titles.add(r["commons_title"])
    rows = list(csv.DictReader((CC / "ATTRIBUTION.csv").open(encoding="utf-8-sig")))
    unseen = [r for r in rows if r["commons_title"] not in ds_titles and (ROOT / r["file"]).exists()]
    # 平均取樣，讓類別多樣
    by_cls = {}
    for r in unseen:
        by_cls.setdefault(r["class_id"], []).append(r)
    picked, i = [], 0
    while len(picked) < n and any(len(v) > i for v in by_cls.values()):
        for c in sorted(by_cls):
            if len(by_cls[c]) > i and len(picked) < n:
                picked.append(by_cls[c][i])
        i += 1
    return picked, len(rows) - len(unseen)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    if not WEIGHTS.exists():
        raise SystemExit("找不到訓練好的權重，請先跑 train.py")
    model = YOLO(str(WEIGHTS))
    rows, overlap = pick_unseen(args.n)
    if not rows:
        raise SystemExit("找不到沒被訓練過的 CC 照片")
    print(f"[demo] 權重 {WEIGHTS.name} · 測 {len(rows)} 張未見過的照片（另有 {overlap} 張因在訓練集而排除）")

    cols = min(COLS, len(rows))
    n_rows = (len(rows) + cols - 1) // cols
    W = cols * CELL_W + (cols + 1) * PAD
    H = 74 + n_rows * (PHOTO_H + CAP_H + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (245, 243, 238))
    d = ImageDraw.Draw(sheet)
    d.rectangle((0, 0, W, 62), fill=(16, 32, 51))
    d.text((PAD, 10), "訓練好的 YOLO 偵測澳門建築（未見過的照片）", font=F(24, True), fill=(240, 244, 248))
    d.text((PAD, 40), f"模型：yolo11n 微調 11 類 · 驗證集 mAP50 0.594 / mAP50-95 0.410 · 照片：Wikimedia Commons（開放授權）",
           font=F(13), fill=(170, 186, 202))

    total = 0
    for i, r in enumerate(rows):
        rr, cc = divmod(i, cols)
        x = PAD + cc * (CELL_W + PAD)
        y = 70 + PAD + rr * (PHOTO_H + CAP_H + PAD)
        img = Image.open(ROOT / r["file"]).convert("RGB")
        scale = CELL_W / img.width
        disp = img.resize((CELL_W, max(1, int(img.height * scale))), Image.LANCZOS)
        crop = disp.crop((0, 0, CELL_W, min(PHOTO_H, disp.height)))
        sheet.paste(crop, (x, y))
        if crop.height < PHOTO_H:
            d.rectangle((x, y + crop.height, x + CELL_W, y + PHOTO_H), fill=(228, 226, 220))

        res = model.predict(np.array(img), conf=args.conf, verbose=False)[0]
        dd = ImageDraw.Draw(crop)
        labels = []
        for b in res.boxes:
            ci = int(b.cls[0])
            cf = float(b.conf[0])
            x0, y0, x1, y1 = (v * scale for v in b.xyxy[0].tolist())
            col = COLORS[ci % len(COLORS)]
            dd.rectangle((x0, y0, x1, y1), outline=col, width=3)
            txt = f"{CLASS_ZH.get(model.names[ci], model.names[ci])} {cf:.2f}"
            tw = dd.textlength(txt, font=F(12, True))
            dd.rectangle((x0, max(0, y0 - 16), x0 + tw + 6, max(14, y0)), fill=col)
            dd.text((x0 + 3, max(0, y0 - 15)), txt, font=F(12, True), fill=(255, 255, 255))
            labels.append(f"{CLASS_ZH.get(model.names[ci], model.names[ci])}({cf:.2f})")
        total += len(res.boxes)

        hit = model.names[int(res.boxes[0].cls[0])] == r["class_id"] if len(res.boxes) else False
        d.rectangle((x, y + PHOTO_H, x + CELL_W, y + PHOTO_H + CAP_H), fill=(255, 255, 255), outline=(215, 212, 205))
        d.text((x + 8, y + PHOTO_H + 5), f'{r["building_zh"]}（真實類別：{CLASS_ZH.get(r["class_id"], r["class_id"])}）',
               font=F(13, True), fill=(16, 32, 51))
        d.text((x + 8, y + PHOTO_H + 24), f"偵測：{'、'.join(labels) if labels else '（無）'}", font=F(12),
               fill=(30, 140, 70) if hit else (200, 60, 50))
        d.text((x + CELL_W - 54, y + PHOTO_H + 5), "✓" if hit else "✗", font=F(16, True),
               fill=(30, 140, 70) if hit else (200, 60, 50))
        print(f"  {r['building_zh']:10} 真實 {r['class_id']:18} → 偵測 {labels if labels else '無'}")

    d.text((PAD, H - 22), f"共偵測到 {total} 棟建築（本機 yolo11n 微調，CPU/GPU 即時推理 ~6 ms/張）", font=F(13), fill=(90, 100, 110))
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "detect-demo.jpg"
    sheet.save(p, quality=90)
    print(f"\n[out] {p.relative_to(ROOT)}  {sheet.size}  {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
