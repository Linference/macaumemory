"""訓練澳門建築偵測器（YOLO11n）並輸出評估結果。

前置：
    1. python tools/yolo-dataset/fetch_dataset.py --per-class 60
    2. python tools/yolo-dataset/prelabel.py           # 自動預標註 + 切分 train/val
    3. （建議）用 LabelImg / CVAT / Ultralytics HUB 人工修正 labels/ 裡的框

用法：
    python tools/yolo-dataset/train.py                          # 預設 100 epochs
    python tools/yolo-dataset/train.py --epochs 150 --batch 16
    python tools/yolo-dataset/train.py --model yolo11s.pt       # 想更準就用 s
產出：
    datasets/macau-buildings/runs/train/weights/best.pt
    datasets/macau-buildings/runs/train/results.csv（訓練曲線）
    .cache/models/yolo/macau-buildings-best.pt（複製一份，方便管線取用）
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
DATA = DS / "data.yaml"
RUNS = DS / "runs"
KEEP = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo11n.pt", help="yolo11n.pt（快）／yolo11s.pt（準）")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="0", help="0=GPU，cpu=CPU")
    ap.add_argument("--name", default="train")
    args = ap.parse_args()

    if not DATA.exists():
        raise SystemExit(f"找不到 {DATA}，請先跑 fetch_dataset.py")
    n_train = len(list((DS / "images" / "train").glob("*")))
    n_val = len(list((DS / "images" / "val").glob("*")))
    if n_train == 0:
        raise SystemExit("images/train 是空的，請先跑 prelabel.py")
    print(f"[data] train {n_train} 張、val {n_val} 張；{DATA.relative_to(ROOT)}")

    model = YOLO(args.model)
    model.train(
        data=str(DATA), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        device=args.device, project=str(RUNS), name=args.name, exist_ok=True,
        # 小資料集常用的增強
        mosaic=1.0, degrees=8.0, translate=0.1, scale=0.5, fliplr=0.5,
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.4, close_mosaic=10,
        patience=30, plots=True, verbose=True,
    )

    best = RUNS / args.name / "weights" / "best.pt"
    print("\n[val] 驗證集評估：")
    metrics = YOLO(str(best)).val(data=str(DATA), imgsz=args.imgsz, device=args.device)
    print(f"  mAP50    = {metrics.box.map50:.3f}")
    print(f"  mAP50-95 = {metrics.box.map:.3f}")
    per_class = getattr(metrics.box, "ap_class_index", None)
    if per_class is not None:
        names = metrics.names
        for i, ap50 in zip(per_class, metrics.box.ap50):
            print(f"    {names[int(i)]:22} AP50={ap50:.3f}")

    KEEP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, KEEP)
    print(f"\n[out] best.pt → {best.relative_to(ROOT)}")
    print(f"[out] 另存一份 → {KEEP.relative_to(ROOT)}（管線可直接載入）")
    print("[next] 用法：det = YOLO('.cache/models/yolo/macau-buildings-best.pt'); det.predict(照片)")


if __name__ == "__main__":
    main()
