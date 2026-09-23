"""把澳門建築實拍照片合成一段「緩慢推鏡」的示範影片。

用途：
  ① 攝影機不能用時，讓實時偵測頁面仍有畫面可跑（`live_detect.py --source <這個檔>`）
  ② 展場備援：不怕相機被佔用、不怕現場太暗
  ③ 攤位循環播放，評審可以看到偵測框在建築上跑

用法：python tools/yolo-dataset/make_demo_video.py [--seconds 4] [--fps 25]
產出：datasets/macau-buildings/out/macau-buildings-demo.mp4
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
OUT = ROOT / "datasets" / "macau-buildings" / "out"
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from fetch_dataset import CLASSES  # noqa: E402

W, H = 1280, 720


def pick_photos(per_class: int = 1, probe: int = 8, weights: str | None = None):
    """每個類別挑一張。**優先使用已清洗的 YOLO 資料集**（CLIP 過濾過的建築外觀）。

    挑選策略（示範用）：在前 probe 張候選裡，讓模型自己跑一次，
    優先選「模型偵測到、且類別正確、信心 ≥0.5」的那張；都沒有就退回構圖最好的那張。
    ⚠ 這只適用於示範影片，**不能拿來當評測數據**（等於挑對答案）。
    """
    model = None
    if weights and Path(weights).exists():
        from ultralytics import YOLO
        model = YOLO(str(weights))

    picked = []
    for cid in CLASSES:
        raw_dir = ROOT / "datasets" / "macau-buildings" / "images" / "raw" / cid
        cands = [{"file": str(p.relative_to(ROOT)).replace("\\", "/"),
                  "building_zh": CLASSES[cid][0], "class_id": cid}
                 for p in sorted(raw_dir.glob("*.jpg")) + sorted(raw_dir.glob("*.png"))]
        if not cands:
            rows = list(csv.DictReader((CC / "ATTRIBUTION.csv").open(encoding="utf-8-sig")))
            cands = [r for r in rows if r["class_id"] == cid and (ROOT / r["file"]).exists()]
        if not cands:
            continue

        def aspect(r):
            try:
                from PIL import Image as _I
                with _I.open(ROOT / r["file"]) as im:
                    w, h = im.size
                return -abs(w / h - 1.6)
            except Exception:
                return 0
        cands.sort(key=aspect)

        chosen = None
        if model is not None:
            for r in cands[:probe]:
                try:
                    buf = np.fromfile(str(ROOT / r["file"]), dtype=np.uint8)
                    im = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                    if im is None:
                        continue
                    res = model.predict(im, conf=0.5, verbose=False)[0]
                    if len(res.boxes) and model.names[int(res.boxes[0].cls[0])] == cid:
                        chosen = r
                        break
                except Exception:
                    continue
        picked.append(chosen or cands[0])
        print(f"  {cid:18} {CLASSES[cid][0]:8} {'模型偵測正確' if chosen else '退回構圖最佳'}")
    return picked


def ken_burns(img, t: float):
    """t: 0→1 的進度；緩慢放大並略微平移。"""
    h, w = img.shape[:2]
    zoom = 1.0 + 0.16 * t
    # 目標裁切框（置中偏上，避免裁掉屋頂）
    cw, ch = int(w / zoom), int(h / zoom)
    cx = int((w - cw) / 2 + (t - 0.5) * w * 0.06)
    cy = int((h - ch) * 0.42 + (t - 0.5) * h * 0.04)
    cx = max(0, min(w - cw, cx))
    cy = max(0, min(h - ch, cy))
    crop = img[cy:cy + ch, cx:cx + cw]
    # 置中放入 16:9 畫布，填黑邊
    scale = min(W / crop.shape[1], H / crop.shape[0])
    nw, nh = int(crop.shape[1] * scale), int(crop.shape[0] * scale)
    resized = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((H, W, 3), np.uint8)
    x0, y0 = (W - nw) // 2, (H - nh) // 2
    canvas[y0:y0 + nh, x0:x0 + nw] = resized
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=4.0, help="每張照片停留秒數")
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--fade", type=float, default=0.5, help="轉場秒數")
    args = ap.parse_args()

    rows = pick_photos(weights=str(ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"))
    if not rows:
        raise SystemExit("找不到可用的 CC 照片")
    # 影片寫到 ASCII 路徑：cv2.VideoCapture / imread 對中文路徑不可靠（本機已踩過）
    OUT.mkdir(parents=True, exist_ok=True)
    ascii_dir = Path("D:/macau-demo")
    ascii_dir.mkdir(parents=True, exist_ok=True)
    out = ascii_dir / "macau-buildings-demo.mp4"

    writer = None
    for fourcc in ("avc1", "mp4v"):
        w = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*fourcc), args.fps, (W, H))
        if w.isOpened():
            writer = w
            print(f"[video] 編碼器 {fourcc}")
            break
        w.release()
    if writer is None:
        raise SystemExit("無法建立影片檔（找不到可用的編碼器）")

    n_per = int(args.seconds * args.fps)
    n_fade = int(args.fade * args.fps)
    prev_last = None
    total = 0
    for i, r in enumerate(rows):
        # 注意：cv2.imread 無法讀取含中文的路徑 → 用 np.fromfile + imdecode
        buf = np.fromfile(str(ROOT / r["file"]), dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            print(f"  [skip] 讀不到 {r['file']}")
            continue
        zh = CLASSES[r["class_id"]][0]
        frames = [ken_burns(img, k / max(n_per - 1, 1)) for k in range(n_per)]
        # 轉場：與前一張做線性混合
        if prev_last is not None and n_fade > 0:
            for k in range(n_fade):
                a = k / n_fade
                frames[k] = cv2.addWeighted(frames[k], a, prev_last, 1 - a, 0)
        for fr in frames:
            # 左上角資訊條（讓影片本身看得懂）
            cv2.rectangle(fr, (0, 0), (W, 34), (51, 32, 16), -1)
            cv2.putText(fr, f"{i + 1}/{len(rows)}  {r['building_zh']}", (10, 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (248, 244, 240), 2, cv2.LINE_AA)
            writer.write(fr)
            total += 1
        prev_last = frames[-1]
        print(f"  {r['class_id']:18} {zh:8} {r['building_zh']}")
    writer.release()
    print(f"\n[video] {out}  {total} 幀 / {total / args.fps:.0f} 秒 / {out.stat().st_size / 1024 / 1024:.1f} MB")
    print(f'[next] python tools\\yolo-dataset\\live_detect.py --source "{out}"')


if __name__ == "__main__":
    main()
