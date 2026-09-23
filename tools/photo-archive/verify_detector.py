"""實測 Detector（YOLO 物件偵測 + 人臉模糊）在真實照片上的行為。

背景：photo-archive.json 裡的 facesBlurred 全是 0，但那其實是「沒跑」而不是「沒偵測到臉」
（OpenCV 5 不再隨附 Haar XML，CascadeClassifier 拿到空分類器 → 靜默回 0）。
本腳本用真實照片（Wikimedia Commons，含路人）實測，作為隱私處理的證據。

用法：
    python tools/photo-archive/verify_detector.py                # 兩邊都測
    python tools/photo-archive/verify_detector.py --source=cc    # 只測 Commons 實拍
    python tools/photo-archive/verify_detector.py --source=archive --limit=8
產出：tools/eval/out/yolo-check.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))

from PIL import Image  # noqa: E402

from pipeline import Detector  # noqa: E402

CC_DIR = ROOT / "photos-src" / "cc"
ARCHIVE = ROOT / "public" / "data" / "photo-archive.json"


def collect(source: str, limit: int):
    items = []   # (標籤, 相對路徑, 建築 id)
    if source in ("archive", "both") and ARCHIVE.exists():
        data = json.loads(ARCHIVE.read_text(encoding="utf-8"))
        for p in data["places"]:
            for ph in p["photos"]:
                # 注意：archive 的 file 欄位是相對於 public/（例：photos/MM-0001_....jpg）
                items.append((p["id"], "public/" + ph["file"], p["id"]))
    if source in ("cc", "both") and CC_DIR.exists():
        for folder in sorted(x for x in CC_DIR.iterdir() if x.is_dir()):
            for f in sorted(folder.glob("*.jpg")) + sorted(folder.glob("*.png")):
                items.append((folder.name, str(f.relative_to(ROOT)).replace("\\", "/"), folder.name))
    return items[:limit] if limit else items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="both", choices=["archive", "cc", "both"])
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    items = collect(args.source, args.limit)
    if not items:
        raise SystemExit("找不到測試照片（先跑 fetch_commons.py？）")

    t0 = time.time()
    det = Detector()
    print(f"[yolo] 模型載入完成（{time.time() - t0:.1f}s）weights=yolo11n.pt")
    print(f"[face] YuNet={det.yunet_ok}  Haar={det.cascade_ok}  OpenCV={det.cv2 is not None}")

    rows, n_obj, n_face, n_person = [], 0, 0, 0
    print(f"\n{'來源':16} {'檔案':40} {'物件':28} {'人臉模糊':18}")
    for label, rel, bid in items:
        try:
            img = Image.open(ROOT / rel).convert("RGB")
        except Exception as e:
            print(f"{label:16} {rel[-40:]:40} 開檔失敗 {e}")
            continue
        t = time.time()
        try:
            objects = det.detect(img)
            err = None
        except Exception as e:
            objects, err = None, str(e)
        _, n_blur, method, detail = det.blur_privacy(img)
        dt = time.time() - t
        obj_s = "、".join(f"{k}×{v}" for k, v in (objects or {}).items()) or "—"
        if objects:
            n_obj += 1
        n_face += detail["faces"]
        n_person += detail["persons"]
        print(f"{label:16} {rel.split('/')[-1][:40]:40} {obj_s[:24]:24} "
              f"{method[:22]:22} 臉{detail['faces']:<3} 人{detail['persons']:<3} {dt:5.2f}s")
        rows.append(dict(place=bid, file=rel, objects=objects, error=err,
                         privacy_method=method, blurred=n_blur,
                         faces=detail["faces"], persons=detail["persons"], seconds=round(dt, 2)))

    by_method = {}
    for r in rows:
        by_method[r["privacy_method"]] = by_method.get(r["privacy_method"], 0) + 1
    out = ROOT / "tools" / "eval" / "out" / "yolo-check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(
        generated=time.strftime("%Y-%m-%dT%H:%M:%S"),
        source=args.source, n_photos=len(rows), weights="yolo11n.pt", conf=0.35,
        face_detectors=dict(yolo_face=det.face_ok, yunet=det.yunet_ok, haar=det.cascade_ok),
        face_model=".cache/models/face/yolov11n-face.pt（YOLO 人臉）＋ yolo11n.pt（COCO person）",
        note="實拍照片來自 Wikimedia Commons（授權見 photos-src/cc/ATTRIBUTION.csv）；"
             "3D 渲染圖對 YOLO 屬分布外，故以實拍照片作為主要證據",
        summary=dict(photos_with_objects=n_obj, faces_blurred=n_face, persons_blurred=n_person,
                     method_usage=by_method),
        results=rows,
    ), ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n[結果] {len(rows)} 張：{n_obj} 張偵測到物件；模糊人臉 {n_face}、人物 {n_person}；方法 {by_method}")
    print(f"[out]  {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
