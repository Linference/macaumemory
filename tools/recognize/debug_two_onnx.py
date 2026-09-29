"""比對兩個 DINOv2 ONNX 檔在同一個張量上的輸出，並找出嵌入庫是用哪一個建的。"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import _crops  # noqa: E402

ONNX = {
    "tools/recognize/out": ROOT / "tools" / "recognize" / "out" / "dinov2-small-336.onnx",
    "public/models": ROOT / "public" / "models" / "dinov2-small-336.onnx",
}


def embed(sess, inp, img):
    c = _crops(img, 336)
    arr = np.concatenate(c + [x[:, :, :, ::-1].copy() for x in c], 0)
    o = sess.run(None, {inp: arr})[0]
    o = o / np.linalg.norm(o, axis=-1, keepdims=True)
    v = o.mean(0)
    return v / np.linalg.norm(v)


def main() -> int:
    import onnxruntime as ort

    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    b = data["buildings"][0]
    img = Image.open(ROOT / "photos-src" / "cc" / b["id"] / b["files"][0]).convert("RGB")
    stored = np.array(b["vectors"][0], np.float32)

    vecs = {}
    for name, p in ONNX.items():
        s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
        v = embed(s, s.get_inputs()[0].name, img)
        vecs[name] = v
        print(f"{name:22s} {p.stat().st_size:>10d} bytes → 與庫內向量餘弦 = {float(v @ stored):+.6f}")

    a, c = vecs["tools/recognize/out"], vecs["public/models"]
    print(f"\n兩檔彼此餘弦 = {float(a @ c):+.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
