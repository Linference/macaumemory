"""一鍵重現：從參考照片到所有評測數字與圖表。

依序執行（隨機種子已在各腳本內固定）：
  1 tools/eval/ablation.py          消融實驗、多視角（→ out/ablation.json、ablation.md）
  2 tools/eval/extended.py          學習曲線、魯棒性、校準、庫外偵測、int8（→ out/extended.json）
  3 tools/eval/rerank.py            易混建築幾何重排序（→ out/rerank-disk.json）
  4 tools/eval/figures_nature.py    Nature 規格圖（→ docs/figs-nature/）
  5 tools/eval/check_criteria.py    對照設計指標
  6 tools/dataset/build_release.py  開放資料集（只在本機，→ output/dataset/）
並記錄輸入檔的 SHA-256 與套件版本（→ tools/eval/out/reproduce-manifest.json），方便核對「同一份資料、同一顆模型」。
  --fresh   忽略向量快取，從照片重新編碼（約 30–60 分鐘，需 GPU）
  --only N  只跑第 N 步（可重複，例如 --only 4 --only 5）
說明：本腳本由 AI 程式助手（Claude）協助撰寫。
用法：python tools/reproduce.py [--fresh] [--only N]
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as md
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = [
    ("ablation", ["tools/eval/ablation.py"]),
    ("extended", ["tools/eval/extended.py"]),
    ("rerank", ["tools/eval/rerank.py", "--method", "disk"]),
    ("figures", ["tools/eval/figures_nature.py"]),
    ("criteria", ["tools/eval/check_criteria.py"]),
    ("dataset", ["tools/dataset/build_release.py"]),
]
INPUTS = ["public/data/memory-embeddings.json", "public/models/dinov2-vits14-336.onnx", "public/models/dinov2-vits14-336.int8.onnx",
          "public/models/macau-buildings-yolo.onnx", ".cache/models/yolo/macau-buildings-best.pt", "photos-src/cc/ATTRIBUTION.csv",
          "tools/recognize/curation.json"]


def sha(p: Path) -> str | None:
    if not p.exists():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--fresh", action="store_true"); ap.add_argument("--only", type=int, action="append")
    a = ap.parse_args()
    manifest = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "python": sys.version.split()[0], "platform": platform.platform(),
                "packages": {}, "inputs": {p: sha(ROOT / p) for p in INPUTS}, "steps": []}
    for pkg in ("numpy", "onnxruntime", "torch", "transformers", "ultralytics", "kornia", "scikit-learn", "matplotlib", "scipy"):
        try:
            manifest["packages"][pkg] = md.version(pkg)
        except md.PackageNotFoundError:
            manifest["packages"][pkg] = None
    for i, (name, cmd) in enumerate(STEPS, 1):
        if a.only and i not in a.only:
            continue
        args = [sys.executable, *cmd] + (["--fresh"] if a.fresh and name == "ablation" else [])
        print(f"\n=== [{i}/{len(STEPS)}] {name}: {' '.join(cmd)}", flush=True)
        t0 = time.time()
        r = subprocess.run(args, cwd=ROOT, env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        manifest["steps"].append({"step": name, "exit": r.returncode, "seconds": round(time.time() - t0, 1)})
        if r.returncode:
            print(f"!! {name} 失敗（exit {r.returncode}），停止。"); break
    out = ROOT / "tools/eval/out/reproduce-manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\nwrote", out)
    return 0 if all(s["exit"] == 0 for s in manifest["steps"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
