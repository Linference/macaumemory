"""實時偵測鏡頭：建築偵測 ＋ 人物框 ＋ 人臉模糊，在瀏覽器裡看即時結果。

三層模型同時跑：
    ① macau-buildings-best.pt（本專案微調 11 類）→ 認建築，畫類別框
    ② yolo11n.pt（COCO）→ 偵測 person，畫紅框
    ③ yolov11n-face.pt → 偵測人臉並**模糊**（青框標示），保護隱私

用法：
    python tools/yolo-dataset/live_detect.py                    # 攝影機 0，開 http://127.0.0.1:8099/
    python tools/yolo-dataset/live_detect.py --no-privacy       # 只畫建築框＋person 框
    python tools/yolo-dataset/live_detect.py --source 1         # 第二台攝影機
    python tools/yolo-dataset/live_detect.py --source demo.mp4  # 影片檔（展場備援）
    python tools/yolo-dataset/live_detect.py --window           # OpenCV 原生視窗（按 Q 結束）
    python tools/yolo-dataset/live_detect.py --conf 0.45        # 提高建築門檻

結束：在跑這個腳本的終端按 Ctrl+C（或叫我停掉背景工作）。
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
COCO = ROOT / "yolo11n.pt"
FACE = ROOT / ".cache" / "models" / "face" / "yolov11n-face.pt"
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
FONT_B = Path(r"C:\Windows\Fonts\msjhbd.ttc")
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from fetch_dataset import CLASSES  # noqa: E402

ZH = {k: v[0] for k, v in CLASSES.items()}
PALETTE = [(214, 48, 49), (0, 148, 168), (200, 162, 74), (108, 92, 231), (46, 134, 222),
           (232, 106, 51), (30, 160, 110), (192, 57, 143), (52, 108, 76), (140, 122, 0), (90, 90, 90)]
PERSON_COL = (231, 76, 60)
FACE_COL = (0, 168, 168)

LOCK = threading.Lock()
LATEST = {"jpeg": None, "frame": None, "info": ""}
STOP = threading.Event()


def _label_box(d, x, y, text, font, fill, img_w):
    """在 (x, y) 畫一個色塊標籤（自動夾住右邊界，避免超出畫面）。"""
    tw = d.textlength(text, font=font)
    x = min(max(0, x), max(0, img_w - tw - 12))
    d.rectangle((x, y, x + tw + 10, y + 24), fill=fill)
    d.text((x + 5, y + 1), text, font=font, fill=(255, 255, 255))


def annotate(frame_bgr, bld_boxes, bld_names, person_boxes, face_boxes, conf_th, privacy):
    """畫建築框（類別色）、person 框（紅）、人臉框（青）並模糊人臉。"""
    img = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    f = ImageFont.truetype(str(FONT_B), 18)
    f_small = ImageFont.truetype(str(FONT), 16)

    # ① 先模糊人臉（在畫框之前，避免把框線也糊掉）
    blurred = 0
    if privacy:
        for b in face_boxes:
            x0, y0, x1, y1 = (float(v) for v in b.xyxy[0].tolist())
            w, h = x1 - x0, y1 - y0
            pad = int(max(w, h) * 0.28)
            box = (int(max(0, x0 - pad)), int(max(0, y0 - pad)),
                   int(min(img.width, x1 + pad)), int(min(img.height, y1 + pad)))
            if box[2] - box[0] < 6 or box[3] - box[1] < 6:
                continue
            region = img.crop(box).filter(ImageFilter.GaussianBlur(radius=max(7, int(min(w, h) * 0.30))))
            img.paste(region, box[:2])
            blurred += 1

    d = ImageDraw.Draw(img)

    # ② person 框（紅）
    for b in person_boxes:
        x0, y0, x1, y1 = (float(v) for v in b.xyxy[0].tolist())
        d.rectangle((x0, y0, x1, y1), outline=PERSON_COL, width=3)
        ly = y0 - 24 if y0 - 24 >= 36 else y0 + 4
        _label_box(d, x0, ly, f"person {float(b.conf[0]):.2f}", f, PERSON_COL, img.width)

    # ③ 人臉框（青）＋已模糊標示
    for b in face_boxes:
        x0, y0, x1, y1 = (float(v) for v in b.xyxy[0].tolist())
        d.rectangle((x0, y0, x1, y1), outline=FACE_COL, width=3)
        ly = y1 + 2 if y1 + 26 < img.height else y1 - 26
        _label_box(d, x0, ly, "臉部已模糊" if privacy else "face", f, FACE_COL, img.width)

    # ④ 建築框（依類別著色）
    counts = {}
    for b in bld_boxes:
        cf = float(b.conf[0])
        if cf < conf_th:
            continue
        ci = int(b.cls[0])
        x0, y0, x1, y1 = (float(v) for v in b.xyxy[0].tolist())
        col = PALETTE[ci % len(PALETTE)]
        d.rectangle((x0, y0, x1, y1), outline=col, width=3)
        name = ZH.get(bld_names[ci], bld_names[ci])
        ly = y0 - 24 if y0 - 24 >= 36 else y0 + 4
        _label_box(d, x0, ly, f"{name} {cf:.2f}", f, col, img.width)
        counts[name] = counts.get(name, 0) + 1

    parts = [f"建築 {sum(counts.values())}"]
    if counts:
        parts.append("、".join(f"{k}×{v}" for k, v in counts.items()))
    parts.append(f"person {len(person_boxes)}")
    if privacy:
        parts.append(f"已模糊人臉 {blurred}")
    info = "　".join(parts)

    # 標題帶
    d.rectangle((0, 0, img.width, 34), fill=(16, 32, 51))
    d.text((10, 7), "建築偵測（類別框）＋ person（紅框）＋ 人臉模糊（青框）· yolo11n 微調 11 類",
           font=f_small, fill=(240, 244, 248))
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR), info


def capture_loop(models, src, conf, imgsz, use_window: bool, privacy: bool):
    bld, coco, face = models
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        with LOCK:
            LATEST["info"] = f"無法開啟來源：{src}"
        print(f"[live] 無法開啟 {src}")
        return
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    t0, n = time.time(), 0
    print(f"[live] 開始擷取 source={src}（Ctrl+C 結束）privacy={privacy}")
    while not STOP.is_set():
        ok, frame = cap.read()
        if not ok:
            if isinstance(src, str) and Path(str(src)).exists():      # 影片播完就循環
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            time.sleep(0.05)
            continue
        bres = bld.predict(frame, conf=conf, imgsz=imgsz, verbose=False)[0]
        pres = coco.predict(frame, conf=0.35, imgsz=imgsz, classes=[0], verbose=False)[0] if coco else None
        fres = face.predict(frame, conf=0.35, imgsz=imgsz, verbose=False)[0] if (face and privacy) else None
        vis, info = annotate(frame, bres.boxes, bld.names,
                             pres.boxes if pres is not None else [],
                             fres.boxes if fres is not None else [], conf, privacy)
        n += 1
        if n % 15 == 0:
            info = f"{info}　[{n / max(time.time() - t0, 1e-6):.0f} FPS]"
        with LOCK:
            LATEST["frame"] = vis
            LATEST["info"] = info
            ok2, buf = cv2.imencode(".jpg", vis, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ok2:
                LATEST["jpeg"] = buf.tobytes()
        if use_window:
            cv2.imshow("Macau Building Detector", vis)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                STOP.set()
                break
    cap.release()
    if use_window:
        cv2.destroyAllWindows()
    print("[live] 擷取結束")


PAGE = """<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>阿獅的建築偵測 · 實時鏡頭</title>
<style>
 body{margin:0;background:#0b1622;color:#eef2f6;font-family:"Microsoft JhengHei",system-ui,sans-serif}
 header{display:flex;gap:14px;align-items:center;padding:12px 20px;background:#0f2033;border-bottom:3px solid #c8a24a;flex-wrap:wrap}
 header h1{margin:0;font-size:20px} header .tag{padding:5px 10px;border-radius:4px;font-size:13px;font-weight:700;background:#2a7f8f}
 header .tag.red{background:#c0392b} header .tag.teal{background:#008080} header .tag.warn{background:#7a5c12}
 main{padding:16px;display:flex;justify-content:center}
 img{max-width:100%;border-radius:12px;border:1px solid #24405c;background:#000}
 .info{margin-top:12px;font-size:15px;color:#a9bccd;text-align:center}
 .legend{max-width:980px;margin:14px auto;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
 .legend span{border:1px solid #24405c;border-radius:999px;padding:4px 10px;font-size:13px;color:#cfe0ee}
 code{background:#16324d;padding:2px 6px;border-radius:4px}
</style></head><body>
<header><h1>阿獅的建築偵測 · 實時鏡頭</h1>
<span class="tag">建築框：11 類</span>
<span class="tag red">person 框</span>
<span class="tag teal">人臉模糊</span>
<span class="tag warn">弱標註模型 · 驗證集 mAP50 0.594</span></header>
<main><div><img src="/stream" alt="live"></div></main>
<div class="info">把鏡頭對著建築物或澳門建築照片即可。沒框到是正常的——未見過的建築偵測率約 37%。<br>
<code>--conf</code> 調建築門檻、<code>--no-privacy</code> 關掉人臉模糊。</div>
<div class="legend">__LEGEND__</div>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):        # 靜音，避免洗版
        pass

    def do_GET(self):
        if self.path.startswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                while not STOP.is_set():
                    with LOCK:
                        buf = LATEST["jpeg"]
                    if buf is None:
                        time.sleep(0.05)
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(buf)).encode() + b"\r\n\r\n" + buf + b"\r\n")
                    time.sleep(0.04)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if self.path.startswith("/info"):
            with LOCK:
                body = (LATEST["info"] or "").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        legend = "".join(f'<span style="border-color:rgb{tuple(PALETTE[i % len(PALETTE)])}">{ZH[c]}</span>'
                         for i, c in enumerate(CLASSES))
        body = PAGE.replace("__LEGEND__", legend).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="0", help="攝影機編號（0/1…）、影片檔路徑，或 rtsp 網址")
    ap.add_argument("--conf", type=float, default=0.35, help="建築偵測信心門檻")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--window", action="store_true", help="改用 OpenCV 原生視窗（按 Q 結束）")
    ap.add_argument("--no-privacy", action="store_true", help="關掉人臉偵測與模糊")
    args = ap.parse_args()

    if not WEIGHTS.exists():
        raise SystemExit(f"找不到訓練好的權重 {WEIGHTS}，請先跑 train.py")
    src = int(args.source) if str(args.source).isdigit() else args.source

    bld = YOLO(str(WEIGHTS))
    coco = YOLO(str(COCO)) if COCO.exists() else None
    face = YOLO(str(FACE)) if FACE.exists() else None
    privacy = not args.no_privacy and face is not None
    print(f"[live] 建築模型 {WEIGHTS.name}（{len(bld.names)} 類）· person={'有' if coco else '無'} · "
          f"人臉={'有' if face else '無'} · privacy={privacy} · conf={args.conf}")

    th = threading.Thread(target=capture_loop, args=((bld, coco, face), src, args.conf, args.imgsz,
                                                     args.window, privacy), daemon=True)
    th.start()

    if args.window:
        while th.is_alive() and not STOP.is_set():
            time.sleep(0.2)
        STOP.set()
        return

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"\n[live] 打開瀏覽器： http://127.0.0.1:{args.port}/")
    print("[live] 若要停止：在這個終端按 Ctrl+C\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        srv.shutdown()
        print("[live] 已停止")


if __name__ == "__main__":
    main()
