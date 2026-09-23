"""視覺化：同一張照片上，YOLO 看到什麼 vs CLIP 判定什麼建築。

為什麼要這張圖：評審（與使用者）常以為「YOLO 在認建築」。事實上 COCO 預訓練的 YOLO
根本沒有「建築」這個類別，它只會框出人、車、冰箱…；建築類型是 CLIP 零樣本分類在做。
這張對照圖把兩件事畫在一起，用來回答「那你們到底怎麼認建築」。

用法：python tools/eval/visualize_detection.py [--n 8]
產出：tools/eval/out/detection-demo.jpg
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))
sys.path.insert(0, str(ROOT / "tools" / "eval"))

from clip_embed import ClipScorer  # noqa: E402
from pipeline import Detector  # noqa: E402
from taxonomy import CLASS_ZH  # noqa: E402

FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
FONT_B = Path(r"C:\Windows\Fonts\msjhbd.ttc")
OUT = ROOT / "tools" / "eval" / "out" / "detection-demo.jpg"
ATTR = ROOT / "photos-src" / "cc" / "ATTRIBUTION.csv"

CELL_W, PHOTO_H, CAP_H, PAD, COLS = 420, 315, 132, 12, 4
HEAD = 92
RED, TEAL, GOLD, INK, GREY = (214, 48, 49), (0, 148, 168), (200, 162, 74), (16, 32, 51), (90, 100, 110)


def F(size, bold=False):
    return ImageFont.truetype(str(FONT_B if bold else FONT), size)


def pick_photos(n: int):
    """挑有人的照片（展示 YOLO）＋乾淨建築照（展示 CLIP），並取中文建築名。"""
    rows = list(csv.DictReader(ATTR.open(encoding="utf-8-sig")))
    y = json.loads((ROOT / "tools" / "eval" / "out" / "yolo-check.json").read_text(encoding="utf-8"))
    counts = {}
    for r in y["results"]:
        key = r["file"].replace("public/", "")
        counts[key] = r.get("objects") or {}
    with_people = [r for r in rows if (counts.get(r["file"], {}) or {}).get("person")]
    clean = [r for r in rows if not (counts.get(r["file"], {}) or {}).get("person")]
    with_people.sort(key=lambda r: -((counts.get(r["file"], {}) or {}).get("person", 0)))
    half = max(1, n // 2)
    picked = with_people[:half] + clean[: n - half]
    return picked[:n], counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    args = ap.parse_args()

    rows, counts = pick_photos(args.n)
    if not rows:
        raise SystemExit("找不到照片，請先跑 fetch_commons.py")

    det = Detector()
    print(f"[yolo] yolo11n（COCO）＋ yolo11n-face：face_ok={det.face_ok}")
    scorer = ClipScorer()
    class_ids, prompts, owner = scorer.taxonomy_vectors()
    text_feats = scorer.embed_texts(prompts)
    print(f"[clip] {scorer.model_name} · {len(class_ids)} 類")

    cols = min(COLS, len(rows))
    rows_n = (len(rows) + cols - 1) // cols
    W = cols * CELL_W + (cols + 1) * PAD
    H = HEAD + rows_n * (PHOTO_H + CAP_H + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (245, 243, 238))
    d = ImageDraw.Draw(sheet)

    d.rectangle((0, 0, W, HEAD), fill=(16, 32, 51))
    d.text((PAD, 14), "YOLO 看到什麼　vs　CLIP 判定什麼建築", font=F(26, True), fill=(240, 244, 248))
    d.text((PAD, 48), "YOLO（COCO 80 類）沒有「建築」這個類別 → 框出來的是人與物件；建築類型由 CLIP 零樣本分類（12 類）判定。",
           font=F(14), fill=(170, 186, 202))
    d.text((PAD, 68), "紅框＝YOLO person　青框＝YOLO 人臉（yolo11n-face）　照片：Wikimedia Commons（開放授權）",
           font=F(13), fill=(140, 160, 178))

    n_hit = n_person_total = n_face_total = 0
    for i, r in enumerate(rows):
        rr, cc = divmod(i, cols)
        x = PAD + cc * (CELL_W + PAD)
        y = HEAD + PAD + rr * (PHOTO_H + CAP_H + PAD)
        img = Image.open(ROOT / r["file"]).convert("RGB")
        scale = CELL_W / img.width
        disp = img.resize((CELL_W, max(1, int(img.height * scale))), Image.LANCZOS)

        # ---- YOLO：人物 + 人臉 ----
        res = det.model.predict(np.array(img), verbose=False, conf=0.35, classes=[0])[0]
        persons = [(b.xyxy[0].tolist(), float(b.conf[0])) for b in res.boxes]
        faces = []
        if det.face_ok:
            rf = det.face_model.predict(np.array(img), verbose=False, conf=0.35)[0]
            faces = [(b.xyxy[0].tolist(), float(b.conf[0])) for b in rf.boxes]
        n_person_total += len(persons)
        n_face_total += len(faces)

        dd = ImageDraw.Draw(disp)
        for (x0, y0, x1, y1), cf in persons:
            dd.rectangle((x0 * scale, y0 * scale, x1 * scale, y1 * scale), outline=RED, width=2)
            dd.text((x0 * scale + 2, max(0, y0 * scale - 12)), f"person {cf:.2f}", font=F(11, True), fill=RED)
        for (x0, y0, x1, y1), cf in faces:
            dd.rectangle((x0 * scale, y0 * scale, x1 * scale, y1 * scale), outline=TEAL, width=2)
            dd.text((x0 * scale + 2, max(0, y1 * scale + 1)), f"face {cf:.2f}", font=F(11, True), fill=TEAL)

        crop = disp.crop((0, 0, CELL_W, min(PHOTO_H, disp.height))) if disp.height >= PHOTO_H else disp
        sheet.paste(crop, (x, y))
        if crop.height < PHOTO_H:
            d.rectangle((x, y + crop.height, x + CELL_W, y + PHOTO_H), fill=(228, 226, 220))

        # ---- CLIP：12 類機率 ----
        vec = scorer.embed_images([str(ROOT / r["file"])])[0]
        probs_c, _, _ = scorer.classify(vec[None, :], text_feats, owner, len(class_ids))
        p = probs_c[0]
        order = np.argsort(-p)[:3]

        cy = y + PHOTO_H
        d.rectangle((x, cy, x + CELL_W, cy + CAP_H), fill=(255, 255, 255), outline=(215, 212, 205))
        d.text((x + 8, cy + 6), f'{r["building_zh"]}（{r["class_id"]}）', font=F(14, True), fill=INK)
        d.text((x + 8, cy + 26), f"YOLO：person ×{len(persons)}、face ×{len(faces)}", font=F(12), fill=RED if persons or faces else GREY)
        d.text((x + 8, cy + 44), "CLIP 零樣本分類：", font=F(12), fill=GREY)
        for k, idx in enumerate(order):
            cid = class_ids[idx]
            bar_y = cy + 62 + k * 20
            w = int((CELL_W - 130) * float(p[idx]))
            d.text((x + 8, bar_y - 2), f"{CLASS_ZH[cid][:8]}", font=F(12), fill=INK if k == 0 else GREY)
            d.rectangle((x + 96, bar_y + 2, x + 96 + max(2, w), bar_y + 13), fill=GOLD if k == 0 else (205, 190, 150))
            d.text((x + 100 + max(2, w), bar_y - 1), f"{p[idx] * 100:.0f}%", font=F(12, True), fill=INK if k == 0 else GREY)
        hit = class_ids[order[0]] == r["class_id"]
        n_hit += int(hit)
        d.text((x + CELL_W - 62, cy + 6), "✓ 命中" if hit else "✗ 未命中",
               font=F(13, True), fill=(30, 140, 70) if hit else (200, 60, 50))

    d.text((PAD, H - 22),
           f"統計（本圖 {len(rows)} 張）：YOLO 框出 person {n_person_total} 個、face {n_face_total} 個、"
           f"建築 0 棟（COCO 80 類裡沒有「建築」）；CLIP 12 類 top-1 命中 {n_hit}/{len(rows)}。"
           f"全資料集（101 張實拍）CLIP top-1 準確率 53.5%。",
           font=F(13), fill=GREY)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT, quality=90)
    print(f"[out] {OUT.relative_to(ROOT)}  {sheet.size}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
