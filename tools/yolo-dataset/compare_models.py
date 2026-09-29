"""在同一驗證集上比較新舊偵測器，避免「驗證集換了」造成的假進步或假退步。

用法：python tools/yolo-dataset/compare_models.py
"""
from __future__ import annotations

from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
DATA = DS / "data.yaml"
MODELS = {
    "舊：yolo11n / 640px / 322 張訓練": DS / "runs" / "train" / "weights" / "best.pt",
    "新：yolo11s / 768px / 451 張訓練": ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt",
}


def main():
    results = {}
    for name, path in MODELS.items():
        if not path.exists():
            print(f"  ✗ 找不到 {name} → {path}")
            continue
        m = YOLO(str(path))
        r = m.val(data=str(DATA), imgsz=768, device="0", verbose=False)
        per = {m.names[int(i)]: float(a) for i, a in zip(r.box.ap_class_index, r.box.ap50)}
        results[name] = (r, per, path)
        print(f"\n=== {name} ===")
        print(f"  mAP50 {r.box.map50:.3f}  mAP50-95 {r.box.map:.3f}  P {r.box.mp:.3f}  R {r.box.mr:.3f}")

    if len(results) < 2:
        return
    names = list(results)
    a, b = results[names[0]], results[names[1]]
    classes = [c for c in a[1] if c in b[1]]
    print(f"\n=== 各類別 AP50 對照（同一驗證集）===")
    print(f"  {'類別':22}{'舊':>8}{'新':>8}{'差異':>9}")
    for c in sorted(classes, key=lambda x: -(b[1][x] - a[1][x])):
        d = b[1][c] - a[1][c]
        flag = "↑" if d > 0.02 else ("↓" if d < -0.02 else " ")
        print(f"  {c:22}{a[1][c]:8.3f}{b[1][c]:8.3f}{d:+9.3f} {flag}")
    print(f"\n  整體 mAP50：{a[0].box.map50:.3f} → {b[0].box.map50:.3f}（{b[0].box.map50 - a[0].box.map50:+.3f}）")
    print(f"  整體 mAP50-95：{a[0].box.map:.3f} → {b[0].box.map:.3f}（{b[0].box.map - a[0].box.map:+.3f}）")
    print(f"  召回 R：{a[0].box.mr:.3f} → {b[0].box.mr:.3f}（{b[0].box.mr - a[0].box.mr:+.3f}）")


if __name__ == "__main__":
    main()
