"""用已訓練的偵測器反向清洗 raw 圖池：把「模型強烈認為不是這個類別」的圖移出訓練集。

為什麼需要：放寬 CLIP 類別關後救回 231 張（對補足街市、工業、騎樓等少樣本類別很關鍵），
但同時也放進了錯類別的圖（例如 church 資料夾裡出現現代高樓、tong_lau 裡出現度假村）。
類別錯誤對偵測器是直接有害的雜訊，所以用「在乾淨子集上訓練出來的模型」當裁判，
把明顯不同意且高信心的圖移到 images/suspect/，不參與訓練但仍保留可追溯。

用法：
    python tools/yolo-dataset/verify_recovered.py                # 只報告
    python tools/yolo-dataset/verify_recovered.py --apply         # 實際移到 images/suspect/
    python tools/yolo-dataset/verify_recovered.py --min-conf 0.6  # 提高裁判門檻（更寬容）
"""
from __future__ import annotations

import argparse
import csv
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
RAW = DS / "images" / "raw"
SUSPECT = DS / "images" / "suspect"
OUT = DS / "out"
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--min-conf", type=float, default=0.55, help="模型對『別的類別』的信心高於此值才判為可疑")
    ap.add_argument("--imgsz", type=int, default=768)
    ap.add_argument("--device", default="0")
    ap.add_argument("--weights", default=str(WEIGHTS))
    args = ap.parse_args()

    if not Path(args.weights).exists():
        raise SystemExit(f"找不到權重 {args.weights}")
    model = YOLO(args.weights)
    print(f"[verify] 裁判模型 {Path(args.weights).name} · 判為可疑的門檻 conf≥{args.min_conf}")

    stats = Counter()
    per_class = defaultdict(Counter)
    rows = []
    for cid in CLASSES:
        ci = CLASSES.index(cid)
        folder = RAW / cid
        if not folder.exists():
            continue
        for img in sorted(list(folder.glob("*.jpg")) + list(folder.glob("*.png"))):
            res = model.predict(str(img), conf=0.30, imgsz=args.imgsz, device=args.device, verbose=False)[0]
            stats["總計"] += 1
            if not len(res.boxes):
                stats["模型沒偵測到（保留）"] += 1
                continue
            top = max(res.boxes, key=lambda b: float(b.conf[0]))
            tcls = int(top.cls[0])
            tconf = float(top.conf[0])
            if tcls == ci:
                stats["模型同意（保留）"] += 1
            elif tconf >= args.min_conf:
                stats["模型強烈不同意（可疑）"] += 1
                per_class[cid][f"→{CLASSES[tcls]}"] += 1
                rows.append(dict(file=str(img.relative_to(ROOT)).replace("\\", "/"), folder_class=cid,
                                 model_says=CLASSES[tcls], conf=round(tconf, 3)))
                if args.apply:
                    dst = SUSPECT / cid
                    dst.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(img), str(dst / img.name))
            else:
                stats["模型不同意但信心不足（保留）"] += 1

    print("\n[verify] 統計：")
    for k, v in stats.most_common():
        print(f"  {k:22} {v:5d}")
    print("\n[verify] 各類別被判可疑的流向：")
    for cid in CLASSES:
        if per_class.get(cid):
            print(f"  {cid:18} " + "、".join(f"{k}:{v}" for k, v in per_class[cid].most_common()))
    OUT.mkdir(parents=True, exist_ok=True)
    rep = OUT / "suspect-report.csv"
    with rep.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["file", "folder_class", "model_says", "conf"])
        w.writeheader()
        w.writerows(rows)
    print(f"\n[out] {rep.relative_to(ROOT)}（{len(rows)} 筆）")
    print("[done] 已移到 images/suspect/" if args.apply else "[note] 未加 --apply，僅出報告")


if __name__ == "__main__":
    main()
