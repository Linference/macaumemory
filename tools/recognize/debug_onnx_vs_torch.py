"""逐位比對「Python ONNX 編碼」與「PyTorch 編碼」是否一致，並找出不一致的來源。

用法：
    python tools/recognize/debug_onnx_vs_torch.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_embeddings import _crops, preprocess, OnnxEncoder  # noqa: E402


def main() -> int:
    import torch
    from transformers import AutoModel

    onnx_path = Path(__file__).resolve().parent / "out" / "dinov2-small-336.onnx"
    print(f"ONNX: {onnx_path.name}")
    enc = OnnxEncoder(onnx_path)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained("facebook/dinov2-small").to(dev).eval()

    # 取 6 張不同建築的照片
    from build_embeddings import collect_references
    refs = collect_references()
    pick = [refs[0], refs[3], refs[10], refs[25], refs[60], refs[100]]
    print(f"{'檔案':46s} {'ONNX·PyTorch':>12s} {'形狀':>12s}")
    bad = 0
    for r in pick:
        img = Image.open(r["path"]).convert("RGB")
        # ---- ONNX
        batch = _crops(img, 336)
        batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
        arr = np.concatenate(batch, 0)
        o = enc.sess.run(None, {enc.input: arr})[0]
        o = o / np.linalg.norm(o, axis=-1, keepdims=True)
        v_onnx = o.mean(0); v_onnx /= np.linalg.norm(v_onnx)
        # ---- PyTorch（逐張、不做批次，排除 batch 影響）
        with torch.no_grad():
            x = torch.from_numpy(arr).to(dev)
            t = model(pixel_values=x, interpolate_pos_encoding=True).last_hidden_state[:, 0]
            t = t / t.norm(dim=-1, keepdim=True)
            v_t = t.mean(0).cpu().numpy(); v_t /= np.linalg.norm(v_t)
        cos = float(v_onnx @ v_t)
        flag = "" if cos > 0.9999 else "  <-- 不一致"
        if cos <= 0.9999:
            bad += 1
        print(f"{r['path'].name[:46]:46s} {cos:12.6f} {str(o.shape):>12s}{flag}")
        if cos <= 0.9999:
            # 逐一比較單張視圖，看是全部都不一致還是某幾個裁切
            with torch.no_grad():
                t1 = model(pixel_values=torch.from_numpy(arr).to(dev),
                           interpolate_pos_encoding=True).last_hidden_state[:, 0].cpu().numpy()
            t1 = t1 / np.linalg.norm(t1, axis=-1, keepdims=True)
            for k in range(len(arr)):
                c = float(o[k] @ t1[k])
                print(f"     視圖 {k}（{'原' if k < 3 else '翻轉'}）cos={c:.6f}"
                      f"{'' if c > 0.9999 else '   <-- 這裡不一致'}")
    print("\n結論：" + ("全部一致" if bad == 0 else f"{bad}/{len(pick)} 張不一致 —— 需要修匯出或前處理"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
