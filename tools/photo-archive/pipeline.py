#!/usr/bin/env python
"""
澳門記憶 · 建築記憶點產線 v2
=========================================================
核心概念：以「建築」為單位建立記憶點（Place），每棟建築一個永久編號 MM-0001，
同一棟建築不論拍幾次、從哪個角度拍，都會歸到同一個記憶點。

判定「拍過了」的流程：
  1) GPS 落入 / 緊鄰同一棟 OSM 建築（或同一個景點）→ 候選記憶點
  2) CLIP 影像向量餘弦相似度驗證（同一棟不同角度仍會相似）
     - ≥ --same  (預設 0.86) → 併入既存記憶點
     - ≥ --review(預設 0.70) → 併入，但標記 needsReview 待人工確認
     - 低於門檻但有地理候選 → 建立新記憶點並標記 needsReview（可能是同棟不同風格面）
  3) 沒有地理候選 → 建立新記憶點
自動命名：MM-0001_20260301-143022.jpg（編號＋拍攝時間）

輸出：
  public/data/places.geojson       地圖圖層（一個記憶點一個點，含封面、照片清單、解讀）
  public/data/photo-archive.json   完整檔案（含每張照片的 EXIF、相似度、來源）
  .cache/photo-archive/places-registry.json   記憶點註冊表（含影像向量，可累積）

用法：
  python tools/photo-archive/pipeline.py                 # 增量處理 photos-src/
  python tools/photo-archive/pipeline.py --limit 5
  python tools/photo-archive/pipeline.py --blur-faces --caption deepseek
  python tools/photo-archive/pipeline.py --rebuild       # 忽略註冊表重新建立
  python tools/photo-archive/pipeline.py --list-places   # 只列出目前記憶點
"""
from __future__ import annotations

import argparse, csv, hashlib, json, math, os, re, sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "photos-src"
OUT_PHOTOS = ROOT / "public" / "photos"
OUT_THUMB = OUT_PHOTOS / "thumb"
DATA = ROOT / "public" / "data"
CACHE = ROOT / ".cache" / "photo-archive"
for p in (OUT_PHOTOS, OUT_THUMB, DATA, CACHE):
    p.mkdir(parents=True, exist_ok=True)
REGISTRY = CACHE / "places-registry.json"

sys.path.insert(0, str(Path(__file__).parent))
from taxonomy import CLASS_ZH, CLASS_COLOR, class_prompts  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}
MAX_SIDE, THUMB_SIDE = 1600, 480


def log(*a):
    print(*a, flush=True)


def haversine(a, b) -> float:
    R = 6371000.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a[1], a[0], b[1], b[0]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    s = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(s)))


def dms_to_deg(vals, ref):
    try:
        d, m, s = [float(x) for x in vals]
        deg = d + m / 60 + s / 3600
        return round(-deg if ref in ("S", "W") else deg, 6)
    except Exception:
        return None


def read_exif(path: Path):
    out = {"gps": None, "taken": None, "make": None, "model": None}
    try:
        with Image.open(path) as im:
            exif = im.getexif()
    except Exception:
        return out
    if not exif:
        return out
    out["make"], out["model"] = exif.get(271), exif.get(272)
    dt = exif.get(36867) or exif.get(306)
    if dt:
        try:
            out["taken"] = datetime.strptime(str(dt), "%Y:%m:%d %H:%M:%S").isoformat()
        except Exception:
            out["taken"] = str(dt)
    try:
        gps = exif.get_ifd(0x8825)
        if gps:
            lat = dms_to_deg(gps.get(2), gps.get(1))
            lon = dms_to_deg(gps.get(4), gps.get(3))
            if lat is not None and lon is not None:
                out["gps"] = {"lat": lat, "lon": lon, "alt": float(gps[6]) if gps.get(6) else None}
    except Exception:
        pass
    return out


def stamp(exif_taken: str | None) -> str:
    if exif_taken:
        try:
            return datetime.fromisoformat(exif_taken).strftime("%Y%m%d-%H%M%S")
        except Exception:
            pass
    return datetime.now().strftime("%Y%m%d-%H%M%S")


# ---------------------------------------------------------------- CLIP（分類 + 影像向量）
class ClipEngine:
    LOCAL = ROOT / ".cache" / "models" / "clip-vit-base-patch32"

    def __init__(self, model_name=None, device=None):
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        name = model_name or (str(self.LOCAL) if self.LOCAL.exists() else "openai/clip-vit-base-patch32")
        log(f"  載入 CLIP：{name}（{self.device}）…")
        self.model = CLIPModel.from_pretrained(name).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(name)
        self.labels = class_prompts()
        self.text_feats = self._encode_text([p for _, p in self.labels])
        self.scale = float(self.model.logit_scale.exp()) if hasattr(self.model, "logit_scale") else 100.0

    def _project(self, out, which):
        t = self.torch
        if t.is_tensor(out):
            return out
        pooled = getattr(out, "pooler_output", None)
        if pooled is None:
            pooled = out.last_hidden_state[:, 0]
        proj = getattr(self.model, f"{which}_projection", None)
        dim = getattr(self.model.config, "projection_dim", None)
        if proj is not None and dim and pooled.shape[-1] != dim:
            pooled = proj(pooled)
        return pooled

    def _encode_text(self, texts):
        t = self.torch
        with t.no_grad():
            inp = self.processor(text=texts, return_tensors="pt", padding=True).to(self.device)
            f = self._project(self.model.get_text_features(**inp), "text")
            return f / f.norm(dim=-1, keepdim=True)

    def encode(self, img: Image.Image):
        """回傳 (單位向量 numpy, 分類結果)"""
        t = self.torch
        with t.no_grad():
            inp = self.processor(images=img.convert("RGB"), return_tensors="pt").to(self.device)
            f = self._project(self.model.get_image_features(**inp), "image")
            f = f / f.norm(dim=-1, keepdim=True)
            logits = (f @ self.text_feats.T).squeeze(0) * self.scale
            probs = logits.softmax(-1).float().cpu().numpy()
        vec = f.squeeze(0).float().cpu().numpy()
        scores = {}
        for (cid, _p), pr in zip(self.labels, probs):
            scores[cid] = scores.get(cid, 0.0) + float(pr)
        for cid in scores:
            scores[cid] /= sum(1 for c, _ in self.labels if c == cid)
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        return vec, {"cls": ranked[0][0], "conf": round(ranked[0][1], 3), "top": [(c, round(v, 3)) for c, v in ranked[:3]]}


def cosine(a, b) -> float:
    if a is None or b is None:
        return -1.0
    s = sum(x * y for x, y in zip(a, b))
    return float(s)


# ---------------------------------------------------------------- YOLO + 人臉模糊
class Detector:
    def __init__(self, weights="yolo11n.pt"):
        from ultralytics import YOLO
        self.model = YOLO(weights)
        self.cv2 = None
        self.cascade = None
        self.cascade_ok = False
        self.yunet = None
        self.yunet_ok = False
        self.face_model = None
        self.face_ok = False
        face_dir = ROOT / ".cache" / "models" / "face"
        try:
            import cv2
            self.cv2 = cv2

            # ① YOLO 人臉模型（yolo11n-face）——本機的主力（OpenCV 5 已移除 Haar 且讀不了 YuNet）
            fw = face_dir / "yolov11n-face.pt"
            if fw.exists():
                try:
                    self.face_model = YOLO(str(fw))
                    self.face_ok = True
                except Exception as e:
                    log(f"    [privacy] YOLO 人臉模型載入失敗：{e}")

            # ② YuNet（舊環境可用；OpenCV 5 的 ONNX 解析器讀不了 2023mar 模型）
            onnx = face_dir / "face_detection_yunet_2023mar.onnx"
            if onnx.exists() and onnx.stat().st_size > 10000 and hasattr(cv2, "FaceDetectorYN_create"):
                try:
                    self.yunet = cv2.FaceDetectorYN_create(str(onnx), "", (320, 320), 0.85, 0.3, 5000)
                    self.yunet_ok = True
                except Exception as e:
                    log(f"    [privacy] YuNet 不可用（{str(e)[:60]}…）")

            # ③ Haar 級聯（OpenCV 4 可用；5.0 已移除 CascadeClassifier）
            for xml in (face_dir / "haarcascade_frontalface_default.xml",
                        Path(getattr(getattr(cv2, "data", None), "haarcascades", "") or "") / "haarcascade_frontalface_default.xml"):
                if xml.exists() and hasattr(cv2, "CascadeClassifier"):
                    c = cv2.CascadeClassifier(str(xml))
                    if not c.empty():
                        self.cascade, self.cascade_ok = c, True
                        break
        except Exception:
            pass
        log(f"    [privacy] 人臉偵測：YOLO-face={self.face_ok} YuNet={self.yunet_ok} Haar={self.cascade_ok}；"
            f"人物偵測（YOLO person）＝一律可用")

    def detect(self, img):
        import numpy as np
        res = self.model.predict(np.array(img.convert("RGB")), verbose=False, conf=0.35)[0]
        counts = {}
        for b in res.boxes:
            n = res.names[int(b.cls[0])]
            counts[n] = counts.get(n, 0) + 1
        return counts

    def blur_faces(self, img):
        if not self.cascade_ok:
            return img, 0
        import numpy as np
        arr = self.cv2.cvtColor(np.array(img.convert("RGB")), self.cv2.COLOR_RGB2BGR)
        faces = self.cascade.detectMultiScale(self.cv2.cvtColor(arr, self.cv2.COLOR_BGR2GRAY), 1.15, 5, minSize=(28, 28))
        for (x, y, w, h) in faces:
            p = int(w * 0.25)
            x0, y0, x1, y1 = max(0, x - p), max(0, y - p), min(arr.shape[1], x + w + p), min(arr.shape[0], y + h + p)
            k = max(5, (w // 3) | 1)
            arr[y0:y1, x0:x1] = self.cv2.GaussianBlur(arr[y0:y1, x0:x1], (k, k), 0)
        return Image.fromarray(self.cv2.cvtColor(arr, self.cv2.COLOR_BGR2RGB)), len(faces)

    def blur_persons(self, img, conf=0.35):
        """用 YOLO 的 person 類別（COCO id=0）模糊整個人物區域。回傳 (影像, 數量)。"""
        return self._blur_boxes(img, self.model, conf=conf, classes=[0])

    def _blur_boxes(self, img, model, conf=0.35, classes=None):
        """用指定 YOLO 模型偵測並高斯模糊框選區域。"""
        if self.cv2 is None:
            return img, 0
        import numpy as np
        arr = np.array(img.convert("RGB"))
        res = model.predict(arr, verbose=False, conf=conf, classes=classes)[0]
        n = 0
        for b in res.boxes:
            x0, y0, x1, y1 = (int(v) for v in b.xyxy[0].tolist())
            pad = 6
            x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
            x1, y1 = min(arr.shape[1], x1 + pad), min(arr.shape[0], y1 + pad)
            if x1 <= x0 or y1 <= y0:
                continue
            k = max(11, ((x1 - x0) // 6) | 1)
            if k % 2 == 0:
                k += 1
            arr[y0:y1, x0:x1] = self.cv2.GaussianBlur(arr[y0:y1, x0:x1], (k, k), 0)
            n += 1
        return Image.fromarray(arr), n

    def blur_yolo_faces(self, img, conf=0.35):
        """用 yolo11n-face 模糊人臉。回傳 (影像, 人臉數)。"""
        if not self.face_ok:
            return img, 0
        return self._blur_boxes(img, self.face_model, conf=conf)

    def blur_yunet(self, img, score=0.85):
        """YuNet 人臉偵測 + 高斯模糊。回傳 (影像, 人臉數)。"""
        if not self.yunet_ok:
            return img, 0
        import numpy as np
        arr = np.array(img.convert("RGB"))
        h, w = arr.shape[:2]
        self.yunet.setInputSize((w, h))
        _, faces = self.yunet.detect(arr)
        n = 0
        if faces is not None:
            for f in faces:
                x, y, fw, fh = (int(v) for v in f[:4])
                p = int(fw * 0.25)
                x0, y0 = max(0, x - p), max(0, y - p)
                x1, y1 = min(w, x + fw + p), min(h, y + fh + p)
                if x1 <= x0 or y1 <= y0:
                    continue
                k = max(11, ((x1 - x0) // 3) | 1)
                if k % 2 == 0:
                    k += 1
                arr[y0:y1, x0:x1] = self.cv2.GaussianBlur(arr[y0:y1, x0:x1], (k, k), 0)
                n += 1
        return Image.fromarray(arr), n

    def blur_privacy(self, img, conf=0.35):
        """回傳 (影像, 總模糊數, 方法字串, 明細 dict)。

        隱私採「寧可過度」策略：先模糊偵測到的人臉，再把整個人物區域也模糊——
        因為背對鏡頭、戴帽、戴口罩的人臉偵測不到，但人物框仍能保護。
        """
        detail = {"faces": 0, "persons": 0}
        out = img
        if self.face_ok:
            out, detail["faces"] = self.blur_yolo_faces(out, conf=conf)
        elif self.cascade_ok:
            out, detail["faces"] = self.blur_faces(out)
        elif self.yunet_ok:
            out, detail["faces"] = self.blur_yunet(out)
        if self.cv2 is not None:
            out, detail["persons"] = self.blur_persons(out, conf=conf)
        methods = []
        if detail["faces"]:
            methods.append("yolo-face" if self.face_ok else ("haar-face" if self.cascade_ok else "yunet-face"))
        if detail["persons"]:
            methods.append("yolo-person")
        return out, detail["faces"] + detail["persons"], "+".join(methods) or "none", detail


# ---------------------------------------------------------------- 參考資料
def load_reference():
    attractions, buildings = [], []
    p = DATA / "attractions.json"
    if p.exists():
        for a in json.loads(p.read_text(encoding="utf-8")).get("attractions", []):
            attractions.append({"id": a["id"], "zh": a.get("zh"), "cat": a.get("cat"), "brief": a.get("brief"), "coords": a["coords"]})
    p = DATA / "macau-buildings.geojson"
    if p.exists():
        for f in json.loads(p.read_text(encoding="utf-8")).get("features", []):
            pr = f.get("properties", {})
            if not pr.get("n"):
                continue
            ring = f["geometry"]["coordinates"][0]
            cx = sum(q[0] for q in ring) / len(ring)
            cy = sum(q[1] for q in ring) / len(ring)
            buildings.append({"n": pr.get("n"), "t": pr.get("t"), "h": pr.get("h"), "coords": [cx, cy]})
    log(f"  參考資料：景點 {len(attractions)}、有名稱建築 {len(buildings)}")
    return attractions, buildings


def nearest(items, coord, max_m):
    best, bd = None, 1e9
    for it in items:
        d = haversine(coord, it["coords"])
        if d < bd:
            best, bd = it, d
    return {**best, "distM": round(bd)} if best and bd <= max_m else None


OSM_TO_CLASS = {
    "hotel": "casino_hotel", "motel": "casino_hotel", "temple": "temple", "shrine": "temple", "monastery": "temple",
    "church": "church", "cathedral": "church", "chapel": "church", "mosque": "church",
    "apartments": "residential_tower", "residential": "residential_tower", "dormitory": "residential_tower", "terrace": "residential_tower",
    "house": "village", "detached": "village", "bungalow": "village",
    "industrial": "industrial", "warehouse": "industrial", "factory": "industrial",
    "school": "civic", "university": "civic", "college": "civic", "hospital": "civic", "government": "civic",
    "museum": "civic", "public": "civic", "civic": "civic", "train_station": "civic",
    "commercial": "civic", "retail": "civic", "office": "civic", "supermarket": "civic", "market": "market",
    "ruins": "monument", "monument": "monument", "memorial": "monument",
}
ATTR_TO_CLASS = {"heritage": "monument", "museum": "civic", "temple": "temple", "landmark": "civic",
                 "resort": "casino_hotel", "nature": "street", "district": "tong_lau", "transport": "civic"}
HISTORIC = (113.530, 22.186, 113.545, 22.203)


def infer_class(coord, near_a, near_b):
    if near_a and near_a.get("distM", 999) <= 60 and ATTR_TO_CLASS.get(near_a.get("cat") or ""):
        return ATTR_TO_CLASS[near_a["cat"]], 0.72, f"緊鄰景點「{near_a['zh']}」"
    if near_b:
        t = (near_b.get("t") or "").lower()
        if t in OSM_TO_CLASS:
            cls = OSM_TO_CLASS[t]
            if cls == "residential_tower" and (near_b.get("h") or 0) < 15:
                return "tong_lau", 0.6, f"低層住宅「{near_b['n']}」"
            return cls, 0.68, f"建築類型 {t}（{near_b['n']}）"
    lon, lat = coord
    if HISTORIC[0] <= lon <= HISTORIC[2] and HISTORIC[1] <= lat <= HISTORIC[3] and ((near_b or {}).get("h") or 99) < 16:
        return "portuguese", 0.55, "位於世界遺產歷史城區、低層建築"
    return "street", 0.35, "無明確線索"


# ---------------------------------------------------------------- DeepSeek 解讀
def find_key():
    if os.environ.get("DEEPSEEK_API_KEY"):
        return os.environ["DEEPSEEK_API_KEY"]
    p = ROOT / "public" / "ai-local.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8-sig")).get("key")
        except Exception as e:
            log(f"  ⚠ 讀取 ai-local.json 失敗：{e}")
    return None


def deepseek_caption(meta, key, model="deepseek-flash"):
    import urllib.request
    hints = [f"GPS：{meta['lat']:.5f}, {meta['lon']:.5f}", f"CLIP 分類：{'、'.join(f'{CLASS_ZH[c]}({v:.0%})' for c, v in meta['top'])}"]
    if meta.get("taken"):
        hints.append(f"拍攝時間：{meta['taken']}")
    if meta.get("near_attraction"):
        na = meta["near_attraction"]
        hints.append(f"距 {na['distM']} 公尺是「{na['zh']}」（{na.get('brief') or ''}）")
    if meta.get("near_building"):
        nb = meta["near_building"]
        hints.append(f"最近建築「{nb['n']}」類型 {nb.get('t') or '未知'} 高度 {nb.get('h') or '未知'} 公尺")
    if meta.get("is_extra_photo"):
        hints.append("這是同一棟建築的「第二張（或以上）照片」，請在解讀中補充不同角度／時間可能看到的差異")
    prompt = (
        "你是澳門建築與文化遺產導覽專家。以下是一張照片的客觀資訊（你看不到照片，請依這些資訊與你對澳門的認識推測）：\n"
        + "\n".join(f"- {h}" for h in hints)
        + '\n\n用繁體中文輸出 JSON（不要其他文字）：\n{"caption":"2~3 句建築解讀（風格、年代、特色、與澳門歷史的關聯）","tags":["3~5 個關鍵詞"],"style":"建築風格","confidence":"高/中/低"}'
    )
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                       "temperature": 0.6, "max_tokens": 700, "thinking": {"type": "disabled"}}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", data=body,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.loads(r.read().decode("utf-8"))
    txt = (j["choices"][0]["message"].get("content") or "").strip()
    m = re.search(r"\{[\s\S]*\}", txt)
    try:
        return json.loads(m.group(0)) if m else {"caption": txt, "tags": []}
    except Exception:
        return {"caption": txt, "tags": []}


# ---------------------------------------------------------------- 主流程
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-clip", action="store_true")
    ap.add_argument("--no-yolo", action="store_true")
    ap.add_argument("--blur-faces", action="store_true")
    ap.add_argument("--caption", choices=["none", "deepseek"], default="deepseek")
    ap.add_argument("--clip-model", default=None)
    ap.add_argument("--same", type=float, default=0.86, help="視覺相似度門檻：≥ 視為同一記憶點")
    ap.add_argument("--review", type=float, default=0.70, help="低於此值視為不同建築（但仍保留在地理候選內則標記待複核）")
    ap.add_argument("--radius", type=float, default=90.0, help="地理候選半徑（公尺）")
    ap.add_argument("--refresh", action="store_true", help="忽略已處理紀錄，重新處理所有照片")
    ap.add_argument("--rebuild", action="store_true", help="清空記憶點註冊表重建")
    ap.add_argument("--list-places", action="store_true")
    args = ap.parse_args()

    if args.rebuild and REGISTRY.exists():
        REGISTRY.unlink()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {"places": {}, "seq": 0, "processed": {}}

    if args.list_places:
        for pid, pl in sorted(registry["places"].items()):
            log(f"{pid}  {pl.get('zh') or pl.get('nearZh') or '(未命名)':14} {CLASS_ZH.get(pl['cls'], pl['cls']):8} "
                f"{len(pl['photos'])} 張  首次 {pl.get('firstSeen','')[:10]}{'  ⚠待複核' if pl.get('needsReview') else ''}")
        log(f"共 {len(registry['places'])} 個記憶點")
        return 0

    files = sorted(p for p in SRC.rglob("*") if p.suffix.lower() in IMAGE_EXT)
    if args.limit:
        files = files[: args.limit]
    if not files:
        log(f"找不到照片，請放進：{SRC}")
        return 1
    log(f"待處理 {len(files)} 張")

    manual = {}
    lp = SRC / "labels.csv"
    if lp.exists():
        with lp.open(encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                fn = (row.get("檔名") or row.get("file") or "").strip()
                if not fn:
                    continue
                def num(v):
                    try:
                        return float(v)
                    except Exception:
                        return None
                manual[Path(fn).name] = {
                    "cls": (row.get("類別id") or row.get("class") or "").strip(),
                    "caption": (row.get("解讀") or row.get("caption") or "").strip(),
                    "lat": num(row.get("lat")), "lon": num(row.get("lon")),
                    "credit": (row.get("credit") or row.get("來源") or "").strip(),
                    "place": (row.get("記憶點") or row.get("place") or "").strip(),
                }
        log(f"  手動標註 {len(manual)} 筆")

    attractions, buildings = load_reference()
    clip = None if args.no_clip else ClipEngine(args.clip_model)
    det = None if args.no_yolo else Detector()
    key = find_key() if args.caption == "deepseek" else None
    if args.caption == "deepseek" and not key:
        log("  ⚠ 沒有 DeepSeek 金鑰 → 跳過自動解讀（可放 public/ai-local.json 或設 DEEPSEEK_API_KEY）")
    cap_cache_p = CACHE / "captions.json"
    cap_cache = json.loads(cap_cache_p.read_text(encoding="utf-8")) if cap_cache_p.exists() else {}

    new_count = merged_count = skipped = 0
    report = []

    for i, path in enumerate(files, 1):
        sig = f"{path.stat().st_size}-{int(path.stat().st_mtime)}"
        if not args.refresh and registry["processed"].get(str(path.relative_to(ROOT))) == sig:
            log(f"[{i}/{len(files)}] ↷ {path.name}（已處理過，略過）")
            skipped += 1
            continue
        try:
            with Image.open(path) as im:
                raw = ImageOps.exif_transpose(im)
                raw = raw.copy()
            exif = read_exif(path)
        except Exception as e:
            log(f"[{i}/{len(files)}] ✗ {path.name} 讀取失敗：{e}")
            skipped += 1
            continue

        man = manual.get(path.name, {})
        gps, geo_src = exif.get("gps"), "exif"
        if not gps and man.get("lat") is not None and man.get("lon") is not None:
            gps, geo_src = {"lat": man["lat"], "lon": man["lon"], "alt": None}, "csv"
        if not gps:
            stem = path.stem.lower()
            hit = next((a for a in attractions if any(len(str(n).lower()) >= 4 and str(n).lower() in stem for n in (a.get("zh"), a.get("id")))), None)
            if hit:
                gps, geo_src = {"lat": hit["coords"][1], "lon": hit["coords"][0], "alt": None}, "name:" + str(hit["zh"])
        if not gps:
            log(f"[{i}/{len(files)}] ⚠ {path.name}：沒有 GPS（可在 labels.csv 補 lat/lon）")
            skipped += 1
            continue

        coord = [gps["lon"], gps["lat"]]
        near_a = nearest(attractions, coord, 200)
        near_b = nearest(buildings, coord, 200)
        loc_cls, loc_conf, loc_why = infer_class(coord, near_a, near_b)

        vec, clip_res, clip_top = None, None, None
        if clip:
            try:
                vec, clip_res = clip.encode(raw)
                clip_top = clip_res["top"]
            except Exception as e:
                log(f"    CLIP 失敗：{e}")
        cls_res = {"cls": loc_cls, "conf": loc_conf, "top": [(loc_cls, loc_conf)], "source": "location", "why": loc_why}
        if clip_res:
            has_loc = "無明確線索" not in loc_why
            if not has_loc and clip_res["conf"] >= 0.30:
                cls_res = {**clip_res, "source": "clip", "why": "CLIP 影像分類（位置無線索）"}
            else:
                cls_res["why"] = loc_why + (f"；CLIP 傾向 {CLASS_ZH[clip_res['cls']]}{clip_res['conf']:.0%}" if clip_res["conf"] >= 0.3 else "；CLIP 無明顯傾向")
        if man.get("cls") in CLASS_ZH:
            cls_res = {"cls": man["cls"], "conf": 1.0, "top": [(man["cls"], 1.0)], "source": "manual", "why": "手動標註"}
        if man.get("caption"):
            cls_res["why"] = "手動標註"

        objects = {}
        if det:
            try:
                objects = det.detect(raw)
            except Exception as e:
                log(f"    YOLO 失敗：{e}")

        # ---------------- 記憶點判定 ----------------
        places = registry["places"]
        if man.get("place") and man["place"] in places:
            pid, sim, decision = man["place"], 1.0, "manual"
        else:
            cands = [(pid2, haversine(coord, pl["coords"]), cosine(vec, pl.get("vec"))) for pid2, pl in places.items()
                     if haversine(coord, pl["coords"]) <= args.radius]
            cands.sort(key=lambda x: (-x[2], x[1]))
            pid, sim, decision = None, -1.0, "new"
            if cands:
                best_id, best_d, best_sim = cands[0]
                if best_sim >= args.same:
                    pid, sim, decision = best_id, best_sim, "merge"
                elif best_sim >= args.review:
                    pid, sim, decision = best_id, best_sim, "merge-review"
                else:
                    decision = "new-near"      # 位置很近但影像不像 → 可能是新建築，標記待複核
        needs_review = decision in ("merge-review", "new-near")

        if pid is None:
            registry["seq"] += 1
            pid = f"MM-{registry['seq']:04d}"
            new_count += 1
        else:
            merged_count += 1

        ts = stamp(exif.get("taken"))
        base = f"{pid}_{ts}"
        out_name, n = base, 1
        while (OUT_PHOTOS / f"{out_name}.jpg").exists() and registry["processed"].get(str(path.relative_to(ROOT))) != sig:
            n += 1
            out_name = f"{base}-{n}"

        web = raw.copy()
        web.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        faces = 0
        privacy = {"method": "skipped", "count": 0, "reason": "未加 --blur-faces"}
        if det and args.blur_faces:
            web, faces, method, detail = det.blur_privacy(web)
            privacy = {"method": method, "count": faces, "faces": detail["faces"],
                       "persons": detail["persons"], "reason": "已執行"}
            log(f"    隱私處理：{method}，人臉 {detail['faces']}、人物 {detail['persons']}")
        web.convert("RGB").save(OUT_PHOTOS / f"{out_name}.jpg", "JPEG", quality=82, optimize=True)
        th = raw.copy()
        th.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
        th.convert("RGB").save(OUT_THUMB / f"{out_name}.jpg", "JPEG", quality=80, optimize=True)

        photo = {
            "file": f"photos/{out_name}.jpg", "thumb": f"photos/thumb/{out_name}.jpg",
            "orig": path.name, "taken": exif.get("taken"), "device": " ".join(x for x in [exif.get("make"), exif.get("model")] if x) or None,
            "credit": man.get("credit") or None, "geoSource": geo_src, "facesBlurred": faces,
            "privacyBlur": privacy,
            "similarity": round(sim, 3) if sim >= 0 else None, "decision": decision, "objects": objects or None,
        }

        # 解讀（第一次建立記憶點或手動指定時）
        caption = man.get("caption")
        extras = {"tags": [], "style": None}
        if not caption and key:
            ck = hashlib.sha1(json.dumps({"c": cls_res["cls"], "la": round(gps["lat"], 4), "lo": round(gps["lon"], 4)}, sort_keys=True).encode()).hexdigest()[:16]
            if ck in cap_cache and not args.refresh:
                extras = cap_cache[ck]
                caption = extras.get("caption")
            else:
                try:
                    out = deepseek_caption({**{"lat": gps["lat"], "lon": gps["lon"], "top": cls_res["top"],
                                               "taken": exif.get("taken"), "near_attraction": near_a, "near_building": near_b,
                                               "is_extra_photo": pid in places}}, key)
                    extras = {"caption": out.get("caption", ""), "tags": out.get("tags", []), "style": out.get("style")}
                    cap_cache[ck] = extras
                    cap_cache_p.write_text(json.dumps(cap_cache, ensure_ascii=False, indent=1), encoding="utf-8")
                    caption = extras["caption"]
                except Exception as e:
                    log(f"    DeepSeek 失敗：{e}")

        if pid in places:
            pl = places[pid]
            pl["photos"].append(photo)
            pl["lastSeen"] = exif.get("taken") or datetime.now().isoformat()
            pl["needsReview"] = pl.get("needsReview", False) or needs_review
            if caption and not pl.get("caption"):
                pl.update({"caption": caption, "tags": extras.get("tags", []), "style": extras.get("style")})
            if cls_res["conf"] > pl.get("conf", 0) and cls_res["source"] != "location":
                pl.update({"cls": cls_res["cls"], "conf": cls_res["conf"], "clsWhy": cls_res["why"], "clsSource": cls_res["source"]})
        else:
            zh = (near_a or {}).get("zh") or (near_b or {}).get("n") or f"未命名建築 {pid}"
            places[pid] = {
                "id": pid, "coords": coord, "zh": zh, "cls": cls_res["cls"], "conf": cls_res["conf"],
                "clsSource": cls_res["source"], "clsWhy": cls_res["why"],
                "caption": caption or "", "tags": extras.get("tags", []), "style": extras.get("style"),
                "nearId": (near_a or {}).get("id"), "nearZh": (near_a or {}).get("zh"),
                "building": (near_b or {}).get("n"), "geoSource": geo_src,
                "firstSeen": exif.get("taken") or datetime.now().isoformat(), "lastSeen": exif.get("taken") or datetime.now().isoformat(),
                "vec": [round(float(x), 5) for x in vec] if vec is not None else None,
                "clipTop": clip_top, "needsReview": needs_review, "photos": [photo],
            }

        registry["processed"][str(path.relative_to(ROOT))] = sig
        REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=1), encoding="utf-8")

        tag = {"manual": "手動", "merge": f"併入 {pid}", "merge-review": f"併入 {pid}（待複核）", "new-near": f"新建 {pid}（待複核）"}.get(decision, f"新建 {pid}")
        simtxt = f" 相似度 {sim:.2f}" if sim >= 0 else "（無視覺比對）"
        report.append((path.name, pid, tag, simtxt))
        log(f"[{i}/{len(files)}] ✓ {path.name} → {tag} {CLASS_ZH[cls_res['cls']]}{simtxt} | {exif.get('taken') or ''}")

    # ---------------- 輸出 ----------------
    places = registry["places"]
    feats = []
    for pid, pl in sorted(places.items()):
        cover = pl["photos"][0]
        feats.append({
            "type": "Feature",
            "properties": {
                "id": pid, "zh": pl.get("zh"), "cls": pl["cls"], "clsZh": CLASS_ZH.get(pl["cls"], pl["cls"]),
                "color": CLASS_COLOR.get(pl["cls"], "#d8b45a"), "conf": pl.get("conf"),
                "clsSource": pl.get("clsSource"), "clsWhy": pl.get("clsWhy"), "clipTop": pl.get("clipTop"),
                "caption": pl.get("caption"), "tags": pl.get("tags"), "style": pl.get("style"),
                "cover": cover["file"], "coverThumb": cover["thumb"],
                "photos": pl["photos"], "photoCount": len(pl["photos"]),
                "nearId": pl.get("nearId"), "nearZh": pl.get("nearZh"), "building": pl.get("building"),
                "firstSeen": pl.get("firstSeen"), "lastSeen": pl.get("lastSeen"),
                "needsReview": bool(pl.get("needsReview")), "geoSource": pl.get("geoSource"),
            },
            "geometry": {"type": "Point", "coordinates": [round(pl["coords"][0], 6), round(pl["coords"][1], 6)]},
        })
    (DATA / "places.geojson").write_text(json.dumps({
        "type": "FeatureCollection", "name": "澳門記憶 · 建築記憶點",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "taxonomy": {t[0]: {"zh": t[1], "color": t[2]} for t in TAXONOMY_FOR_SITE()},
        "features": feats,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "photo-archive.json").write_text(json.dumps({
        "generated": datetime.now().isoformat(timespec="seconds"),
        "places": [{"id": pid, **{k: v for k, v in pl.items() if k != "vec"}} for pid, pl in sorted(places.items())],
        "counts": {"places": len(places), "photos": sum(len(p["photos"]) for p in places.values())},
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # 清掉不再被任何記憶點引用的舊圖檔
    used = {Path(ph["file"]).name for pl in places.values() for ph in pl["photos"]}
    removed = 0
    for d in (OUT_PHOTOS, OUT_THUMB):
        for f in d.glob("*.jpg"):
            if f.name not in used:
                f.unlink()
                removed += 1
    if removed:
        log(f"（已清理 {removed} 個不再使用的舊圖檔）")

    log("\n================ 完成 ================")
    log(f"照片 {len(files) - skipped} 張（新增記憶點 {new_count}、併入既有 {merged_count}、略過 {skipped}）")
    log(f"目前共 {len(places)} 個記憶點、{sum(len(p['photos']) for p in places.values())} 張照片")
    for name, pid, tag, simtxt in report:
        log(f"  {name[:26]:28} {tag}{simtxt}")
    return 0


def TAXONOMY_FOR_SITE():
    from taxonomy import TAXONOMY
    return TAXONOMY


if __name__ == "__main__":
    raise SystemExit(main())
