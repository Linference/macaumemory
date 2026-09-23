"""診斷：驗證集的分數是否被「同一棟建築跑到訓練集」灌水。

做法：用 CLIP 影像向量算每張 val 圖與所有 train 圖的最大餘弦相似度。
若大量 val 圖與某張 train 圖 >0.85，代表它們是同一棟（甚至同一張），
模型等於「背過答案」，val mAP 就不能當作真實表現。

用法：python tools/yolo-dataset/check_leakage.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
sys.path.insert(0, str(ROOT / "tools" / "eval"))
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from clip_embed import ClipScorer  # noqa: E402
from fetch_dataset import CLASSES  # noqa: E402

NAMES = list(CLASSES)


def cls_of(p: Path) -> str:
    return p.stem.split("_")[0]


def main():
    tr = sorted((DS / "images" / "train").glob("*.jpg"))
    va = sorted((DS / "images" / "val").glob("*.jpg"))
    print(f"train {len(tr)} 張、val {len(va)} 張")

    s = ClipScorer()
    ftr = s.embed_images([str(p) for p in tr], batch=16)
    fva = s.embed_images([str(p) for p in va], batch=16)
    sims = fva @ ftr.T                      # [n_val, n_train]
    mx = sims.max(1)
    arg = sims.argmax(1)

    print(f"\nval 對 train 的最大相似度：p50={np.percentile(mx, 50):.3f} p75={np.percentile(mx, 75):.3f} "
          f"p90={np.percentile(mx, 90):.3f} max={mx.max():.3f}")
    for thr in (0.95, 0.90, 0.85, 0.80, 0.75):
        n = int((mx >= thr).sum())
        print(f"  ≥{thr:.2f}：{n:3d} / {len(va)} 張（{n / len(va) * 100:.0f}%）"
              + ("   ← 幾乎是同一張" if thr >= 0.95 else ""))

    print("\n最可疑的 12 張 val（與 train 幾乎重複）：")
    for i in np.argsort(-mx)[:12]:
        j = int(arg[i])
        same = "同類" if cls_of(va[i]) == cls_of(tr[j]) else "★不同類"
        print(f"  {mx[i]:.3f} {same}  val {va[i].name[:34]:34} ≈ train {tr[j].name[:34]}")

    cross = [i for i in range(len(va)) if mx[i] >= 0.85 and cls_of(va[i]) != cls_of(tr[arg[i]])]
    print(f"\n[結論] val 中與 train 相似度 ≥0.85 的有 {int((mx >= 0.85).sum())} 張；"
          f"其中「跨類別」的 {len(cross)} 張（這類才是真正嚴重的洩漏）")


if __name__ == "__main__":
    main()
