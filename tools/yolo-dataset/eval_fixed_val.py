"""在**固定的舊驗證集**上評估模型，讓擴充前後可以逐類別直接對比。

為什麼需要這個：
    併入新資料後 val 從 117 張變成兩三百張，直接跑 train.py --val 得到的 mAP
    與基準線（0.519）不可比。這個腳本用同一批「舊 val 117 張」評估任意權重，
    並輸出整體 mAP50 與各類別 AP50，方便 before/after 對照。

用法：
    python tools/yolo-dataset/eval_fixed_val.py --weights .cache/models/yolo/macau-buildings-best.pt
    python tools/yolo-dataset/eval_fixed_val.py --weights datasets/macau-buildings/runs/vlm-exp/weights/best.pt \
        --tag after --imgsz 768
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
OUT = DS / "out"
CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]


def build_val_list(exclude_vlm: bool = True) -> Path:
    """產生只含原始 val 影像的清單檔（YOLO 的 val 可指向 .txt 清單）。"""
    imgs = sorted((DS / "images" / "val").glob("*.jpg"))
    if exclude_vlm:
        imgs = [p for p in imgs if "_vlm_" not in p.stem]
    lst = OUT / ("val-original.txt" if exclude_vlm else "val-all.txt")
    lst.parent.mkdir(parents=True, exist_ok=True)
    lst.write_text("\n".join(str(p.resolve()).replace("\\", "/") for p in imgs) + "\n", encoding="utf-8")
    return lst, len(imgs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--imgsz", type=int, default=768)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--device", default="0")
    ap.add_argument("--tag", default="eval")
    ap.add_argument("--include-vlm", action="store_true", help="連 VLM 新圖一起評（預設只用原 val）")
    args = ap.parse_args()

    lst, n = build_val_list(exclude_vlm=not args.include_vlm)
    print(f"[eval] {args.weights}")
    print(f"[eval] {'全部 val' if args.include_vlm else '原始 val'}：{n} 張（清單 {lst.relative_to(ROOT)}）")

    yaml_path = OUT / f"data-{args.tag}.yaml"
    yaml_path.write_text(
        f"path: {DS.resolve()}\ntrain: images/train\nval: {lst.resolve()}\n\n"
        f"nc: {len(CLASSES)}\nnames:\n" + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES)),
        encoding="utf-8")

    m = YOLO(args.weights).val(data=str(yaml_path), imgsz=args.imgsz, batch=args.batch,
                              device=args.device, plots=False, verbose=False)
    res = {"weights": args.weights, "val_images": n, "mAP50": round(float(m.box.map50), 4),
           "mAP50-95": round(float(m.box.map), 4),
           "precision": round(float(m.box.mp), 4), "recall": round(float(m.box.mr), 4),
           "per_class": {}}
    names = m.names
    for i, ap50 in zip(m.box.ap_class_index, m.box.ap50):
        res["per_class"][names[int(i)]] = round(float(ap50), 4)
    print(f"\n  mAP50    = {res['mAP50']:.3f}")
    print(f"  mAP50-95 = {res['mAP50-95']:.3f}")
    print(f"  P = {res['precision']:.3f}  R = {res['recall']:.3f}")
    for c in CLASSES:
        if c in res["per_class"]:
            print(f"    {c:22} AP50={res['per_class'][c]:.3f}")

    OUT.mkdir(parents=True, exist_ok=True)
    jf = OUT / f"eval-{args.tag}.json"
    jf.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n[out] {jf.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
