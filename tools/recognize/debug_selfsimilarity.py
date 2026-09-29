"""診斷：把「庫裡的參考照片」拿去查詢，看與庫內向量的自相似度是否為 1。

若同一張圖的查詢向量與庫內自己的向量餘弦 ≠ 1，代表查詢路徑與建庫路徑不一致。
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import OnnxEncoder  # noqa: E402


def main() -> int:
    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    print("encoder.source =", data["encoder"]["source"])
    print("preproc =", json.dumps(data["preproc"], ensure_ascii=False))
    print("has centroid:", "centroid" in data["buildings"][0], "| has vectors:", "vectors" in data["buildings"][0])

    enc = OnnxEncoder(ROOT / "public/models" / data["encoder"]["source"])
    b = data["buildings"][0]
    print(f"\n建築[0] {b['id']} {b['zh']} count={b['count']} files={b['files']}")
    V = np.array(b["vectors"], np.float32)
    print("庫內向量長度:", np.round(np.linalg.norm(V, axis=1), 6))

    for fi, fname in enumerate(b["files"][:2]):
        p = ROOT / "photos-src" / "cc" / b["id"] / fname
        if not p.is_file():
            print(f"  查詢檔不存在：{p}")
            continue
        img = Image.open(p).convert("RGB")
        v = enc.embed([img])[0].astype(np.float32)
        v = v / (np.linalg.norm(v) + 1e-9)
        sims = V @ v
        print(f"  查詢 {fname}: 查詢向量長度={np.linalg.norm(enc.embed([img])[0]):.6f}"
              f" → 與庫內同棟各向量餘弦 {np.round(sims, 4)}（自己那筆應該 = 1.0）")

    # 用 centroid（如果 JSON 有）與個別向量各算一次 Top-1
    if "centroid" in data["buildings"][0]:
        cent = np.array([x["centroid"] for x in data["buildings"]], np.float32)
        print("\ncentroid 長度:", np.round(np.linalg.norm(cent, axis=1)[:3], 6))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
