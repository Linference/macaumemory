"""在 Python 端檢查 YOLO ONNX 的原始輸出，並與「我前端 decode 的預期」對照。

目的：前端偵測到 0 個框。可能原因
    A. 前端的 letterbox/正規化與 ultralytics 不同 → 模型看到錯誤輸入
    B. 前端的 decode/門檻邏輯有錯
這支腳本用 Python 走「已知正確」的路徑（ultralytics 自己的 letterbox + 後處理），
把每一張圖的候選數、最高信心、以及分類分布印出來，作為前端的對照基準。

用法：python tools/recognize/debug_detect.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ONNX = ROOT / "public" / "models" / "macau-buildings-yolo.onnx"
NAMES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
         "civic", "industrial", "village", "monument", "market"]
IMGSZ = 768

IMAGES = [
    ROOT / "photos-src" / "demo" / "大三巴牌坊-demo.jpg",
    ROOT / "photos-src" / "demo" / "澳門旅遊塔-demo.jpg",
    ROOT / "photos-src" / "cc" / "ruins-st-paul" / "Ruins_of_Saint_Paul_s_Macau_Ank_Kumar_01.jpg",
    ROOT / "photos-src" / "cc" / "moorish-barracks" / "Moorish_Barracks.jpg",
]


def letterbox(img: np.ndarray, size: int = IMGSZ, color: int = 114):
    """完全照 ultralytics 的作法：等比例 + 置中灰邊，回傳 NCHW float 0~1。"""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    if (w, h) != (nw, nh):
        img = np.asarray(Image.fromarray(img).resize((nw, nh), Image.BILINEAR))
    top = (size - nh) // 2
    bottom = size - nh - top
    left = (size - nw) // 2
    right = size - nw - left
    img = np.pad(img, ((top, bottom), (left, right), (0, 0)), constant_values=color)
    x = np.ascontiguousarray(img.transpose(2, 0, 1)[None]).astype(np.float32) / 255.0
    return x, r, left, top


def main() -> int:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name
    print(f"{ONNX.name} · 輸入 {sess.get_inputs()[0].shape} · 輸出 {sess.get_outputs()[0].shape}")

    for p in IMAGES:
        if not p.is_file():
            print(f"\n（找不到 {p}）")
            continue
        img = np.asarray(Image.open(p).convert("RGB"))
        x, r, l, t = letterbox(img)
        out = sess.run(None, {iname: x})[0][0]           # (15, 12096)
        boxes, scores = out[:4], out[4:]
        best = scores.max(0)
        print(f"\n{p.name}  {img.shape[1]}×{img.shape[0]}")
        print(f"  輸入張量：shape {x.shape} min {x.min():.3f} max {x.max():.3f} mean {x.mean():.3f}")
        print(f"  分數：max {best.max():.4f} · >0.25 共 {(best > 0.25).sum()} 個 · >0.10 共 {(best > 0.10).sum()} 個")
        top = np.argsort(-best)[:5]
        for i in top:
            c = int(scores[:, i].argmax())
            cx, cy, bw, bh = boxes[:, i]
            print(f"    anchor {i:5d} · {NAMES[c]:18s} {best[i]:.3f} · cx={cx:7.1f} cy={cy:7.1f} w={bw:6.1f} h={bh:6.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
