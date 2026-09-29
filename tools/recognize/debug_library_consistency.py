"""把「建庫時」與「查詢時」的每一步拆開比對，找出向量不一致的來源。

建立嵌入庫用的是 build_embeddings.OnnxEncoder.embed()，查詢也應該走同一條路。
本檔逐步驗證：
  1. 兩個 ONNX 檔（tools/recognize/out 與 public/models）是否同一個檔（雜湊）
  2. 同一張圖連續呼叫 embed() 兩次，向量是否一致（是否 nondeterministic）
  3. 庫內向量的「來源」：用 stored 向量反推它所對應的前處理張量是否與現在一致
     —— 直接把 _crops() 產生的張量餵進去，跟 stored 向量比對
  4. 逐張檢查所有庫內向量與「重新編碼同檔」的餘弦，列出不一致的清單
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import _crops, OnnxEncoder  # noqa: E402


def sha(p: Path, n: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            b = f.read(n)
            if not b:
                break
            h.update(b)
    return h.hexdigest()[:16]


def main() -> int:
    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    out_onnx = ROOT / "tools" / "recognize" / "out" / "dinov2-small-336.onnx"
    pub_onnx = ROOT / "public" / "models" / "dinov2-small-336.onnx"
    print("[1] ONNX 檔比對")
    print(f"    tools/recognize/out : {sha(out_onnx)}  {out_onnx.stat().st_size} bytes")
    print(f"    public/models       : {sha(pub_onnx)}  {pub_onnx.stat().st_size} bytes")
    print(f"    同檔 = {sha(out_onnx) == sha(pub_onnx)}")

    enc = OnnxEncoder(pub_onnx)
    b = data["buildings"][0]
    fname = b["files"][0]
    p = ROOT / "photos-src" / "cc" / b["id"] / fname
    img = Image.open(p).convert("RGB")

    print("\n[2] 決定性檢查：同一張圖連續編碼兩次")
    v1 = enc.embed([img])
    v2 = enc.embed([img])
    print(f"    兩次向量餘弦 = {float(v1[0] @ v2[0]):.8f}（應為 1.0）")

    print("\n[3] 前處理張量檢查")
    crop = _crops(img, 336)
    print(f"    _crops 回傳 {len(crop)} 個張量，形狀 {crop[0].shape}，dtype {crop[0].dtype}")
    arr = np.concatenate(crop + [c[:, :, :, ::-1].copy() for c in crop], 0)
    print(f"    批次 {arr.shape} · min {arr.min():.3f} max {arr.max():.3f} mean {arr.mean():.3f}")
    out = enc.sess.run(None, {enc.input: arr})[0]
    out = out / np.linalg.norm(out, axis=-1, keepdims=True)
    vv = out.mean(0); vv /= np.linalg.norm(vv)
    stored = np.array(b["vectors"][0], np.float32)
    print(f"    直接算出的向量 與 庫內第 0 筆 餘弦 = {float(vv @ stored):.6f}（應為 1.0）")
    print(f"    embed() 回傳的向量 與 庫內第 0 筆 餘弦 = {float(v1[0] @ stored):.6f}")

    print("\n[4] 全庫一致性：重新編碼每張參考圖，與庫內對應向量比對")
    bad = []
    tot = 0
    for bb in data["buildings"]:
        for i, fn in enumerate(bb["files"]):
            fp = ROOT / "photos-src" / "cc" / bb["id"] / fn
            if not fp.is_file():
                continue
            im = Image.open(fp).convert("RGB")
            v = enc.embed([im])[0]
            c = float(v @ np.array(bb["vectors"][i], np.float32))
            tot += 1
            if c < 0.999:
                bad.append((c, bb["id"], fn))
    bad.sort()
    print(f"    檢查 {tot} 筆，餘弦 < 0.999 的有 {len(bad)} 筆")
    for c, bid, fn in bad[:12]:
        print(f"      {c:+.4f}  {bid:22s} {fn[:52]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
