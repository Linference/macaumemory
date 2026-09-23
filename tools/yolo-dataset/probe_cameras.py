"""掃描可用攝影機：逐一開啟 index 0..N，讀一帧並回報解析度與亮度，
用來判斷「哪個 index 是真的鏡頭」以及「畫面是不是被遮住/太暗」。

用法：python tools/yolo-dataset/probe_cameras.py
"""
from __future__ import annotations

import cv2
import numpy as np

print(f"OpenCV {cv2.__version__}")
print(f"{'index':>6} {'開啟':>5} {'解析度':>12} {'平均亮度':>9} {'判斷'}")
found = []
for i in range(5):
    for backend, bname in ((cv2.CAP_DSHOW, "DSHOW"), (cv2.CAP_MSMF, "MSMF"), (None, "預設")):
        cap = cv2.VideoCapture(i, backend) if backend is not None else cv2.VideoCapture(i)
        if not cap.isOpened():
            cap.release()
            continue
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            continue
        h, w = frame.shape[:2]
        mean = float(np.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)))
        verdict = "✅ 可用" if mean > 8 else "⚠ 全黑（鏡頭蓋/太暗/佔用中）"
        print(f"{i:>6} {bname:>5} {w:>5}x{h:<6} {mean:>9.1f} {verdict}")
        if mean > 8:
            found.append(i)
        cap.release()
        break
    else:
        print(f"{i:>6} {'-':>5} {'-':>12} {'-':>9} 沒有裝置")

print(f"\n可用鏡頭 index：{found if found else '（沒有偵測到有畫面的鏡頭）'}")
print("提示：筆電的實體遮蔽蓋、或 Windows 設定 → 隱私權 → 相機 是否允許桌面應用程式使用，都會影響。")
