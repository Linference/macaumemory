"""下載人臉偵測模型，修好「OpenCV 5 沒有隨附 Haar XML」造成的隱私模糊失效。

抓兩個模型：
  1. Haar cascade XML（OpenCV 官方 repo）— 傳統、快，但準確率普通
  2. YuNet ONNX（opencv_zoo）— 深度學習人臉偵測，小（~230 KB）且準確得多

用法：python tools/photo-archive/fetch_face_models.py
產出：.cache/models/face/haarcascade_frontalface_default.xml
      .cache/models/face/face_detection_yunet_2023mar.onnx
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / ".cache" / "models" / "face"
UA = {"User-Agent": "macaumemory-isef/1.0 (student science project)"}

MODELS = [
    ("haarcascade_frontalface_default.xml",
     "https://raw.githubusercontent.com/opencv/opencv/4.x/data/haarcascades/haarcascade_frontalface_default.xml"),
    ("face_detection_yunet_2023mar.onnx",
     "https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"),
]


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS:
        out = DEST / name
        if out.exists() and out.stat().st_size > 1000:
            print(f"  ✓ 已存在 {name}（{out.stat().st_size / 1024:.0f} KB）")
            continue
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            out.write_bytes(data)
            print(f"  ↓ {name}（{len(data) / 1024:.0f} KB）→ {out.relative_to(ROOT)}")
        except Exception as e:
            print(f"  ✗ {name} 下載失敗：{type(e).__name__} {str(e)[:80]}")
    print(f"\n[face] 模型目錄：{DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
