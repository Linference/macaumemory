"""用獨立照片集驗收訓練好的偵測器（不只看 val 的 mAP）。

誠實做法：把 photos-src/cc 的 101 張分成「訓練時用過」與「完全沒用過」兩組，
分別量測：
    ① 偵測率：這張照片有沒有框出至少一棟建築（召回代理指標）
    ② 類別準確率：框出來的主要類別是否等於該照片的真實類別
並附註樣本數，避免用 8 張就下結論。

用法：python tools/yolo-dataset/eval_on_cc.py
"""
from __future__ import annotations

import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
CC = ROOT / "photos-src" / "cc"
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from fetch_dataset import CLASSES  # noqa: E402

ZH = {k: v[0] for k, v in CLASSES.items()}


def load(split_filter=None):
    ds_titles = set()
    attr = ROOT / "datasets" / "macau-buildings" / "ATTRIBUTION.csv"
    if attr.exists():
        for r in csv.DictReader(attr.open(encoding="utf-8-sig")):
            ds_titles.add(r["commons_title"])
    rows = list(csv.DictReader((CC / "ATTRIBUTION.csv").open(encoding="utf-8-sig")))
    out = []
    skipped = 0
    for r in rows:
        if not (ROOT / r["file"]).exists():
            continue
        # 只評「偵測器有的 11 類」：街景（street）不在偵測器類別內，算進去會讓準確率失真
        if r["class_id"] not in CLASSES:
            skipped += 1
            continue
        seen = r["commons_title"] in ds_titles
        if split_filter == "seen" and not seen:
            continue
        if split_filter == "unseen" and seen:
            continue
        out.append(r)
    if skipped:
        print(f"  （已排除 {skipped} 張不在偵測器類別內的照片，例如 street 街景）")
    return out


def evaluate(model, rows, conf=0.25):
    det = 0
    cls_ok = 0
    cls_n = 0
    per_cls = defaultdict(lambda: [0, 0, 0])   # [n, detected, class_ok]
    confs = []
    for r in rows:
        res = model.predict(str(ROOT / r["file"]), conf=conf, verbose=False)[0]
        n = len(res.boxes)
        per_cls[r["class_id"]][0] += 1
        if n:
            det += 1
            per_cls[r["class_id"]][1] += 1
            confs.append(float(res.boxes[0].conf[0]))
            top = model.names[int(res.boxes[0].cls[0])]
            cls_n += 1
            if top == r["class_id"]:
                cls_ok += 1
                per_cls[r["class_id"]][2] += 1
    return dict(n=len(rows), det=det, cls_ok=cls_ok, cls_n=cls_n,
                mean_conf=float(np.mean(confs)) if confs else 0.0, per_cls=dict(per_cls))


def main():
    model = YOLO(str(WEIGHTS))
    print(f"[eval] 權重 {WEIGHTS.name}\n")
    results = {}
    for tag, label in (("seen", "訓練時用過的照片"), ("unseen", "完全沒用過的照片")):
        rows = load(tag)
        if not rows:
            print(f"{label}：0 張，略過")
            continue
        m = evaluate(model, rows)
        results[tag] = m
        print(f"=== {label}（{m['n']} 張）===")
        print(f"  偵測率（至少框到一棟）：{m['det']}/{m['n']} = {m['det'] / m['n'] * 100:.0f}%")
        print(f"  類別準確率（框到且類別正確）：{m['cls_ok']}/{m['cls_n']} = "
              f"{m['cls_ok'] / m['cls_n'] * 100 if m['cls_n'] else 0:.0f}%（分母＝有框到的張數）")
        print(f"  平均信心度：{m['mean_conf']:.2f}")
        print("  各類別（張數/偵測到/類別正確）：")
        for c in sorted(m["per_cls"], key=lambda k: -m["per_cls"][k][0]):
            n, d, ok = m["per_cls"][c]
            print(f"    {ZH.get(c, c):10} {n:3d} / {d:3d} / {ok:3d}")
        print()

    if "unseen" in results and "seen" in results:
        a, b = results["unseen"], results["seen"]
        print(f"[結論] 沒見過的照片偵測率 {a['det'] / a['n'] * 100:.0f}% vs 見過的 "
              f"{b['det'] / b['n'] * 100:.0f}%；"
              f"類別準確率 {a['cls_ok'] / max(a['cls_n'], 1) * 100:.0f}% vs {b['cls_ok'] / max(b['cls_n'], 1) * 100:.0f}%")
        print(f"        （未見過組只有 {a['n']} 張，信賴區間很寬，報告要註明）")


if __name__ == "__main__":
    main()
