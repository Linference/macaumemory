"""把澳門建築 YOLO 權重匯出成 ONNX（給瀏覽器用）。

權重：.cache/models/yolo/macau-buildings-best.pt（yolo11s 微調，11 類）
輸出：public/models/macau-buildings-yolo.onnx（imgsz=768, opset=17）

為什麼 imgsz=768：
    澳門建築在照片裡常只佔畫面一角（街景、遠景），640 訓練解析度下小目標會掉。
    768 是 yolo11 的合法輸入（stride 32 的整數倍），且與訓練用的 letterbox 一致。

用法：
    python tools/recognize/export_yolo_onnx.py
    python tools/recognize/export_yolo_onnx.py --imgsz 640     # 想更小更快時
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
DATA_YAML = ROOT / "datasets" / "macau-buildings" / "data.yaml"
PUBLIC_MODELS = ROOT / "public" / "models"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(WEIGHTS))
    ap.add_argument("--imgsz", type=int, default=768)
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--name", default="macau-buildings-yolo.onnx")
    args = ap.parse_args()

    from ultralytics import YOLO

    weights = Path(args.weights)
    if not weights.is_file():
        raise SystemExit(f"找不到權重：{weights}")

    print(f"[1/4] 載入權重 {weights.name} …")
    model = YOLO(str(weights))
    names = model.names
    print(f"      類別 {len(names)}：{names}")

    print(f"[2/4] 匯出 ONNX（imgsz={args.imgsz}, opset={args.opset}）…")
    t0 = time.time()
    out = model.export(format="onnx", imgsz=args.imgsz, opset=args.opset, dynamic=False,
                       simplify=True, half=False)
    out = Path(str(out))
    print(f"      {out} · {out.stat().st_size/1e6:.1f} MB · {time.time()-t0:.0f} 秒")

    print("[3/4] 驗證 ONNX 可載入並推理 …")
    import numpy as np
    import onnxruntime as ort

    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    print(f"      輸入 {inp.name} {inp.shape} {inp.type}")
    for o in sess.get_outputs():
        print(f"      輸出 {o.name} {o.shape}")
    dummy = np.random.rand(1, 3, args.imgsz, args.imgsz).astype(np.float32)
    res = sess.run(None, {inp.name: dummy})
    print(f"      推理輸出 {[tuple(r.shape) for r in res]}")

    print("[4/4] 複製到 public/models/ …")
    PUBLIC_MODELS.mkdir(parents=True, exist_ok=True)
    dst = PUBLIC_MODELS / args.name
    shutil.copy2(out, dst)
    print(f"      → {dst}（{dst.stat().st_size/1e6:.1f} MB）")

    # 類別對照表給前端用（中文名稱由 src/recognize/labels.js 維護，這裡只記錄原始順序）
    meta = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": str(weights.relative_to(ROOT)).replace("\\", "/"),
        "imgsz": args.imgsz,
        "opset": args.opset,
        "nc": len(names),
        "names": [names[i] for i in sorted(names)],
        "file": args.name,
        "bytes": dst.stat().st_size,
        "input": {"name": inp.name, "shape": inp.shape},
        "output_shape": [list(r.shape) for r in res],
    }
    meta_path = PUBLIC_MODELS / (args.name.replace(".onnx", ".json"))
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"      → {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
