#!/usr/bin/env python
"""
澳門特色建築照片檔案產線
------------------------------------------------
輸入：photos-src/ 下的照片（jpg / png / heic / webp，手機拍的即可，含 EXIF GPS）
輸出：
  public/photos/<id>.jpg          網站用大圖（最長邊 1600）
  public/photos/thumb/<id>.jpg    縮圖（480）
  public/data/photos.geojson      地圖圖層（含座標、類別、解讀）
  public/data/photo-archive.json  完整檔案（含 EXIF、模型結果、來源）

流程：EXIF 定位 → 校正方向 → YOLO 偵測人物（可選人臉模糊）→ CLIP 零樣本分類
      → 比對最近景點／建築 → DeepSeek 產生解讀 → 寫出檔案

用法：
  python tools/photo-archive/pipeline.py                 # 全部處理
  python tools/photo-archive/pipeline.py --limit 5       # 只處理 5 張（測試）
  python tools/photo-archive/pipeline.py --no-clip       # 跳過 CLIP（只做 EXIF/縮圖）
  python tools/photo-archive/pipeline.py --blur-faces    # 人臉自動模糊
  python tools/photo-archive/pipeline.py --caption deepseek
  python tools/photo-archive/pipeline.py --refresh       # 忽略快取重跑
手動修正：在 photos-src/labels.csv 填 `檔名,類別id,解讀文字`，會優先採用。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Windows 主控台預設 cp950，強制用 UTF-8 輸出避免中文/符號報錯
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

# HuggingFace 在中國大陸常被阻擋，預設走公開鏡像（可用環境變數 HF_ENDPOINT 覆蓋）
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "photos-src"
OUT_PHOTOS = ROOT / "public" / "photos"
OUT_THUMB = OUT_PHOTOS / "thumb"
DATA = ROOT / "public" / "data"
CACHE = ROOT / ".cache" / "photo-archive"
for p in (OUT_PHOTOS, OUT_THUMB, DATA, CACHE):
    p.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(Path(__file__).parent))
from taxonomy import TAXONOMY, CLASS_ZH, CLASS_COLOR, class_prompts  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}
MAX_SIDE, THUMB_SIDE = 1600, 480


# ---------------------------------------------------------------- 工具
def log(msg: str) -> None:
    print(msg, flush=True)


def dms_to_deg(vals, ref) -> float | None:
    try:
        d, m, s = [float(x) for x in vals]
        deg = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            deg = -deg
        return round(deg, 6)
    except Exception:
        return None


def read_exif(img: Image.Image):
    exif = img.getexif()
    info = {"gps": None, "taken": None, "make": None, "model": None}
    if not exif:
        return info
    info["make"] = exif.get(271)
    info["model"] = exif.get(272)
    dt = exif.get(36867) or exif.get(306)  # DateTimeOriginal / DateTime
    if dt:
        try:
            info["taken"] = datetime.strptime(str(dt), "%Y:%m:%d %H:%M:%S").isoformat()
        except Exception:
            info["taken"] = str(dt)
    try:
        gps = exif.get_ifd(0x8825)
        if gps:
            lat = dms_to_deg(gps.get(2), gps.get(1))
            lon = dms_to_deg(gps.get(4), gps.get(3))
            alt = gps.get(6)
            if lat is not None and lon is not None:
                info["gps"] = {"lat": lat, "lon": lon, "alt": float(alt) if alt else None}
    except Exception:
        pass
    return info


def photo_id(path: Path) -> str:
    h = hashlib.sha1(path.read_bytes()).hexdigest()[:10]
    slug = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", path.stem).strip("-")[:28]
    return f"{slug}-{h}" if slug else h


def haversine(a, b) -> float:
    R = 6371000.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a[1], a[0], b[1], b[0]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    s = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(s)))


# ---------------------------------------------------------------- CLIP 零樣本分類
class ClipClassifier:
    LOCAL_CLIP = ROOT / ".cache" / "models" / "clip-vit-base-patch32"

    def __init__(self, model_name=None, device=None):
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        if model_name is None:
            model_name = str(ClipClassifier.LOCAL_CLIP) if ClipClassifier.LOCAL_CLIP.exists() else "openai/clip-vit-base-patch32"
        self.model_name = model_name
        log(f"  載入 CLIP：{model_name}（{self.device}）…")
        self.model = CLIPModel.from_pretrained(model_name).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(model_name)
        self.labels = class_prompts()
        self.text_feats = self._encode_texts([p for _, p in self.labels])
        log(f"  文字提示詞 {len(self.labels)} 條已編碼")

    def _project(self, out, which):
        """transformers v5 的 get_*_features 可能回傳 output 物件而非張量，這裡統一處理"""
        torch = self.torch
        if torch.is_tensor(out):
            return out
        pooled = getattr(out, "pooler_output", None)
        if pooled is None:
            pooled = out.last_hidden_state[:, 0]
        proj = getattr(self.model, "text_projection" if which == "text" else "visual_projection", None)
        dim = getattr(self.model.config, "projection_dim", None)
        if proj is not None and dim is not None and pooled.shape[-1] != dim:
            pooled = proj(pooled)
        return pooled

    def _encode_texts(self, texts):
        torch = self.torch
        with torch.no_grad():
            inputs = self.processor(text=texts, return_tensors="pt", padding=True).to(self.device)
            feats = self._project(self.model.get_text_features(**inputs), "text")
            return feats / feats.norm(dim=-1, keepdim=True)

    def classify(self, img: Image.Image, topk=3):
        torch = self.torch
        with torch.no_grad():
            inputs = self.processor(images=img.convert("RGB"), return_tensors="pt").to(self.device)
            feats = self._project(self.model.get_image_features(**inputs), "image")
            feats = feats / feats.norm(dim=-1, keepdim=True)
            if feats.shape[-1] != self.text_feats.shape[-1]:
                raise RuntimeError(f"特徵維度不一致 image={feats.shape[-1]} text={self.text_feats.shape[-1]}")
            scale = float(self.model.logit_scale.exp()) if hasattr(self.model, "logit_scale") else 100.0
            logits = (feats @ self.text_feats.T).squeeze(0) * scale
            probs = logits.softmax(dim=-1).float().cpu().numpy()
        # 同一類別的多條提示詞取平均
        scores: dict[str, float] = {}
        for (cid, _p), pr in zip(self.labels, probs):
            scores[cid] = scores.get(cid, 0.0) + float(pr)
        for cid in scores:
            scores[cid] /= sum(1 for c, _ in self.labels if c == cid)
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        return {"cls": ranked[0][0], "conf": round(ranked[0][1], 3), "top": [(c, round(v, 3)) for c, v in ranked[:topk]]}


# ---------------------------------------------------------------- YOLO 偵測 + 人臉模糊
class Detector:
    def __init__(self, weights="yolo11n.pt"):
        from ultralytics import YOLO

        self.model = YOLO(weights)
        self.cascade = None
        try:
            import cv2

            self.cv2 = cv2
            self.cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        except Exception:
            self.cv2 = None

    def detect(self, img: Image.Image):
        import numpy as np

        arr = np.array(img.convert("RGB"))
        res = self.model.predict(arr, verbose=False, conf=0.35)[0]
        counts: dict[str, int] = {}
        boxes = []
        for b in res.boxes:
            name = res.names[int(b.cls[0])]
            counts[name] = counts.get(name, 0) + 1
            boxes.append([float(x) for x in b.xyxy[0].tolist()])
        return counts, boxes

    def blur_faces(self, img: Image.Image) -> tuple[Image.Image, int]:
        if self.cascade is None:
            return img, 0
        import numpy as np

        arr = self.cv2.cvtColor(np.array(img.convert("RGB")), self.cv2.COLOR_RGB2BGR)
        gray = self.cv2.cvtColor(arr, self.cv2.COLOR_BGR2GRAY)
        faces = self.cascade.detectMultiScale(gray, 1.15, 5, minSize=(28, 28))
        for (x, y, w, h) in faces:
            pad = int(w * 0.25)
            x0, y0 = max(0, x - pad), max(0, y - pad)
            x1, y1 = min(arr.shape[1], x + w + pad), min(arr.shape[0], y + h + pad)
            region = arr[y0:y1, x0:x1]
            k = max(5, (w // 3) | 1)
            arr[y0:y1, x0:x1] = self.cv2.GaussianBlur(region, (k, k), 0)
        return Image.fromarray(self.cv2.cvtColor(arr, self.cv2.COLOR_BGR2RGB)), len(faces)



# ---------------------------------------------------------------- 位置推斷分類（不需任何模型）
OSM_TO_CLASS = {
    "hotel": "casino_hotel", "motel": "casino_hotel", "hostel": "casino_hotel",
    "temple": "temple", "chinese_temple": "temple", "shrine": "temple", "monastery": "temple",
    "church": "church", "cathedral": "church", "chapel": "church", "mosque": "church",
    "apartments": "residential_tower", "residential": "residential_tower", "dormitory": "residential_tower",
    "terrace": "residential_tower", "barracks": "residential_tower",
    "house": "village", "detached": "village", "bungalow": "village", "cabin": "village",
    "industrial": "industrial", "warehouse": "industrial", "factory": "industrial", "garage": "industrial",
    "school": "civic", "university": "civic", "college": "civic", "hospital": "civic",
    "government": "civic", "museum": "civic", "public": "civic", "civic": "civic", "train_station": "civic",
    "commercial": "civic", "retail": "civic", "office": "civic", "supermarket": "civic", "market": "market",
    "ruins": "monument", "monument": "monument", "memorial": "monument", "castle": "monument",
}
ATTR_TO_CLASS = {
    "heritage": "monument", "museum": "civic", "temple": "temple", "landmark": "civic",
    "resort": "casino_hotel", "nature": "street", "district": "tong_lau", "transport": "civic",
}
# 世界遺產歷史城區（葡式建築密集）的粗略範圍
HISTORIC_CENTRE = (113.530, 22.186, 113.545, 22.203)   # W, S, E, N
PORTUGUESE_HINT = ("龍環葡韻", "亞婆井", "鄭家大屋", "盧家大屋", "市政署", "議事亭", "崗頂", "港務局", "聖老楞佐", "白鴿巢", "東望洋", "媽閣")


def infer_class_from_location(coord, near_attraction, near_building):
    """用「最接近的景點／建築」推斷類別，回傳 (class_id, confidence, reason)"""
    if near_attraction and near_attraction.get("distM", 999) <= 60:
        cls = ATTR_TO_CLASS.get(near_attraction.get("cat") or "", None)
        if cls:
            return cls, 0.72, f"緊鄰景點「{near_attraction['zh']}」"
    if near_building:
        t = (near_building.get("t") or "").lower()
        cls = OSM_TO_CLASS.get(t)
        if cls:
            if cls == "residential_tower" and (near_building.get("h") or 0) and near_building["h"] < 15:
                return "tong_lau", 0.6, f"低層住宅「{near_building['n']}」"
            return cls, 0.68, f"建築類型 {t}（{near_building['n']}）"
    lon, lat = coord
    if HISTORIC_CENTRE[0] <= lon <= HISTORIC_CENTRE[2] and HISTORIC_CENTRE[1] <= lat <= HISTORIC_CENTRE[3]:
        h = (near_building or {}).get("h") or 99
        if h < 16:
            return "portuguese", 0.55, "位於世界遺產歷史城區、低層建築"
    if near_attraction and any(k in str(near_attraction.get("zh", "")) for k in PORTUGUESE_HINT):
        return "portuguese", 0.5, "接近葡式歷史建築群"
    return "street", 0.35, "無明確線索"

# ---------------------------------------------------------------- 最近景點／建築
def load_reference():
    attractions, buildings = [], []
    p = DATA / "attractions.json"
    if p.exists():
        for a in json.loads(p.read_text("utf-8")).get("attractions", []):
            attractions.append({"id": a["id"], "zh": a.get("zh"), "cat": a.get("cat"), "brief": a.get("brief"), "coords": a["coords"]})
    p = DATA / "macau-buildings.geojson"
    if p.exists():
        gj = json.loads(p.read_text("utf-8"))
        for f in gj.get("features", []):
            if not f.get("properties", {}).get("n"):
                continue
            ring = f["geometry"]["coordinates"][0]
            cx = sum(pt[0] for pt in ring) / len(ring)
            cy = sum(pt[1] for pt in ring) / len(ring)
            pr = f["properties"]
            buildings.append({"n": pr.get("n"), "t": pr.get("t"), "h": pr.get("h"), "coords": [cx, cy]})
    log(f"  參考資料：景點 {len(attractions)}、有名稱建築 {len(buildings)}")
    return attractions, buildings


def nearest(items, coord, max_m):
    best, best_d = None, 1e9
    for it in items:
        d = haversine(coord, it["coords"])
        if d < best_d:
            best, best_d = it, d
    if best and best_d <= max_m:
        return {**best, "distM": round(best_d)}
    return None


# ---------------------------------------------------------------- DeepSeek 解讀
def deepseek_caption(meta: dict, key: str, model="deepseek-flash") -> dict:
    import urllib.request

    class_hint = "、".join(f"{CLASS_ZH[c]}({v:.0%})" for c, v in meta["top"])
    parts = [
        f"照片拍攝時間：{meta.get('taken') or '未知'}",
        f"GPS：{meta['lat']:.5f}, {meta['lon']:.5f}",
        f"CLIP 影像分類結果（僅供參考）：{class_hint}",
    ]
    if meta.get("near_attraction"):
        na = meta["near_attraction"]
        parts.append(f"距離 {na['distM']} 公尺處是知名景點「{na['zh']}」（{na.get('brief') or ''}）")
    if meta.get("near_building"):
        nb = meta["near_building"]
        parts.append(f"最近的有名稱建築：「{nb['n']}」類型 {nb.get('t') or '未知'}，高度約 {nb.get('h') or '未知'} 公尺")
    if meta.get("objects"):
        parts.append(f"偵測到的物件：{meta['objects']}")
    prompt = (
        "你是澳門建築與文化遺產的導覽專家。以下是一張遊客在澳門拍的照片的客觀資訊（你看不到照片，"
        "請只根據這些資訊與你對澳門的認識來推測）：\n" + "\n".join(f"- {p}" for p in parts) +
        "\n\n請用繁體中文輸出 JSON（不要其他文字）：\n"
        '{"caption":"2~3 句建築解讀（風格、年代、特色、與澳門歷史的關聯）","tags":["3~5 個關鍵詞"],'
        '"style":"你判斷的建築風格（例如 南洋騎樓／葡式巴洛克／現代主義）","confidence":"高/中/低"}'
    )
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.6,
        "max_tokens": 700,
        "thinking": {"type": "disabled"},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.loads(r.read().decode("utf-8"))
    txt = j["choices"][0]["message"]["content"].strip()
    m = re.search(r"\{[\s\S]*\}", txt)
    try:
        return json.loads(m.group(0)) if m else {"caption": txt, "tags": []}
    except Exception:
        return {"caption": txt, "tags": []}


def find_deepseek_key() -> str | None:
    if os.environ.get("DEEPSEEK_API_KEY"):
        return os.environ["DEEPSEEK_API_KEY"]
    p = ROOT / "public" / "ai-local.json"
    if p.exists():
        try:
            # 注意：PowerShell 寫出的 JSON 可能帶 BOM，要用 utf-8-sig 讀
            return json.loads(p.read_text(encoding="utf-8-sig")).get("key")
        except Exception as e:
            log(f"  ⚠ 讀取 {p.name} 失敗：{e}")
            return None
    return None


# ---------------------------------------------------------------- 主流程
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-clip", action="store_true")
    ap.add_argument("--no-yolo", action="store_true")
    ap.add_argument("--blur-faces", action="store_true")
    ap.add_argument("--caption", choices=["none", "deepseek"], default="deepseek")
    ap.add_argument("--clip-model", default=None, help="CLIP 模型路徑或 HF id；預設優先用 .cache/models/clip-vit-base-patch32")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--nearest-m", type=int, default=200)
    args = ap.parse_args()

    files = sorted(p for p in SRC.rglob("*") if p.suffix.lower() in IMAGE_EXT)
    if args.limit:
        files = files[: args.limit]
    if not files:
        log(f"找不到照片。請把手機拍的照片放進：{SRC}")
        return 1
    log(f"待處理照片 {len(files)} 張")

    manual: dict[str, dict] = {}
    lp = SRC / "labels.csv"
    if lp.exists():
        with lp.open(encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                fn = (row.get("檔名") or row.get("file") or "").strip()
                if fn:
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
                    }
        log(f"  手動標註 {len(manual)} 筆")

    attractions, buildings = load_reference()
    clip = None if args.no_clip else ClipClassifier(args.clip_model)
    det = None if args.no_yolo else Detector()
    key = find_deepseek_key() if args.caption == "deepseek" else None
    if args.caption == "deepseek" and not key:
        log("  ⚠ 找不到 DeepSeek 金鑰（public/ai-local.json 或環境變數 DEEPSEEK_API_KEY）→ 跳過自動解讀")
    cap_cache_p = CACHE / "captions.json"
    cap_cache = json.loads(cap_cache_p.read_text("utf-8")) if cap_cache_p.exists() else {}

    results, skipped = [], []
    for i, path in enumerate(files, 1):
        try:
            raw = Image.open(path)
            raw = ImageOps.exif_transpose(raw)
            exif = read_exif(Image.open(path))
        except Exception as e:
            log(f"[{i}/{len(files)}] ✗ {path.name}：無法讀取（{e}）")
            skipped.append((path.name, "無法讀取"))
            continue
        pid = photo_id(path)
        man = manual.get(path.name)
        gps = exif.get("gps")
        geo_source = "exif"
        if not gps and man and man.get("lat") is not None and man.get("lon") is not None:
            gps = {"lat": man["lat"], "lon": man["lon"], "alt": None}
            geo_source = "csv"
        if not gps:
            # 後備：用檔名比對景點名稱（適合沒有 GPS 的相機或老照片）
            stem = path.stem.lower()
            hit = None
            for a in attractions:
                for nm in [a.get("zh") or "", a.get("id") or ""]:
                    nm = str(nm).lower()
                    if len(nm) >= 4 and nm in stem:
                        hit = a
                        break
                if hit:
                    break
            if hit:
                gps = {"lat": hit["coords"][1], "lon": hit["coords"][0], "alt": None}
                geo_source = "name:" + str(hit["zh"])
        if not gps:
            log(f"[{i}/{len(files)}] ⚠ {path.name}：沒有 GPS，略過（可在 labels.csv 補 lat/lon）")
            skipped.append((path.name, "缺少 GPS"))
            continue

        web = raw.copy()
        web.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        faces = 0
        if det and args.blur_faces:
            web, faces = det.blur_faces(web)
        web.convert("RGB").save(OUT_PHOTOS / f"{pid}.jpg", "JPEG", quality=82, optimize=True)
        thumb = raw.copy()
        thumb.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
        thumb.convert("RGB").save(OUT_THUMB / f"{pid}.jpg", "JPEG", quality=80, optimize=True)

        objects, _boxes = ({}, [])
        if det:
            try:
                objects, _boxes = det.detect(raw)
            except Exception as e:
                log(f"    YOLO 失敗：{e}")

        coord0 = [gps["lon"], gps["lat"]]
        near_attr0 = nearest(attractions, coord0, args.nearest_m)
        near_bld0 = nearest(buildings, coord0, args.nearest_m)
        loc_cls, loc_conf, loc_why = infer_class_from_location(coord0, near_attr0, near_bld0)
        cls_res = {"cls": loc_cls, "conf": loc_conf, "top": [(loc_cls, loc_conf)], "source": "location", "why": loc_why}
        clip_top = None
        if clip:
            try:
                clip_res = clip.classify(raw)
                clip_top = clip_res["top"]
                has_loc_clue = bool(loc_why) and "無明確線索" not in loc_why
                if not has_loc_clue and clip_res["conf"] >= 0.30:
                    # 只有「位置完全沒線索」時才用 CLIP 決定類別
                    clip_res["source"] = "clip"
                    clip_res["why"] = "CLIP 影像分類（位置無明確線索）"
                    cls_res = clip_res
                else:
                    cls_res["why"] = loc_why + (
                        f"；CLIP 認為是 {CLASS_ZH[clip_res['cls']]}{clip_res['conf']:.0%}（僅供參考）" if clip_res["conf"] >= 0.3 else "；CLIP 影像分類無明顯傾向"
                    )
            except Exception as e:
                log(f"    CLIP 失敗：{e}")

        if man and man.get("cls") in CLASS_ZH:
            cls_res = {"cls": man["cls"], "conf": 1.0, "top": [(man["cls"], 1.0)], "manual": True}

        coord = [gps["lon"], gps["lat"]]
        meta = {
            "id": pid,
            "src": str(path.relative_to(ROOT)),
            "lat": gps["lat"], "lon": gps["lon"], "alt": gps.get("alt"),
            "taken": exif.get("taken"),
            "device": " ".join(x for x in [exif.get("make"), exif.get("model")] if x),
            "cls": cls_res["cls"], "conf": cls_res["conf"], "top": cls_res["top"],
            "manual": cls_res.get("manual", False),
            "objects": objects, "facesBlurred": faces, "geoSource": geo_source,
            "near_attraction": nearest(attractions, coord, args.nearest_m),
            "near_building": nearest(buildings, coord, args.nearest_m),
        }

        caption = man.get("caption") if man else None
        if not caption and key:
            ck = hashlib.sha1(json.dumps({k: meta[k] for k in ("cls", "lat", "lon", "objects")}, sort_keys=True).encode()).hexdigest()[:16]
            if ck in cap_cache and not args.refresh:
                caption = cap_cache[ck].get("caption")
                meta["tags"] = cap_cache[ck].get("tags", [])
                meta["style"] = cap_cache[ck].get("style")
            else:
                try:
                    out = deepseek_caption(meta, key)
                    caption = out.get("caption")
                    meta["tags"] = out.get("tags", [])
                    meta["style"] = out.get("style")
                    cap_cache[ck] = out
                    cap_cache_p.write_text(json.dumps(cap_cache, ensure_ascii=False, indent=1), "utf-8")
                except Exception as e:
                    log(f"    DeepSeek 解讀失敗：{e}")
        meta["caption"] = caption or ""
        meta["clipTop"] = clip_top
        meta["clsSource"] = "manual" if cls_res.get("manual") else cls_res.get("source", "location")
        meta["clsWhy"] = cls_res.get("why", "")
        meta["geoSource"] = geo_source
        meta["credit"] = (man or {}).get("credit", "")
        meta["tags"] = meta.get("tags", [])
        results.append(meta)
        near = meta["near_attraction"]
        near_txt = ""
        if near:
            near_txt = " | 近 " + str(near["zh"]) + "(" + str(near["distM"]) + "m)"
        manual_txt = "（手動）" if meta["manual"] else ""
        log(f"[{i}/{len(files)}] ✓ {path.name} → {CLASS_ZH[meta['cls']]} {meta['conf']:.0%}{manual_txt}"
            f" | {meta['lat']:.5f},{meta['lon']:.5f}{near_txt}")

    # ---------------- 輸出
    feats = [{
        "type": "Feature",
        "properties": {
            "id": m["id"], "file": f"photos/{m['id']}.jpg", "thumb": f"photos/thumb/{m['id']}.jpg",
            "cls": m["cls"], "clsZh": CLASS_ZH[m["cls"]], "color": CLASS_COLOR[m["cls"]],
            "conf": m["conf"], "top": m["top"], "caption": m["caption"], "tags": m["tags"],
            "lat": m["lat"], "lon": m["lon"], "alt": m.get("alt"),
            "style": m.get("style"), "taken": m.get("taken"), "device": m.get("device"),
            "nearId": (m["near_attraction"] or {}).get("id"), "nearZh": (m["near_attraction"] or {}).get("zh"),
            "nearDist": (m["near_attraction"] or {}).get("distM"),
            "building": (m["near_building"] or {}).get("n"),
            "clsSource": m.get("clsSource"), "clsWhy": m.get("clsWhy"), "geoSource": m.get("geoSource"),
            "clipTop": m.get("clipTop"), "manual": m["manual"],
            "credit": m.get("credit"), "geoSource": m.get("geoSource"),
        },
        "geometry": {"type": "Point", "coordinates": [round(m["lon"], 6), round(m["lat"], 6)]},
    } for m in results]

    (DATA / "photos.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "澳門特色建築照片檔案",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "taxonomy": {t[0]: {"zh": t[1], "color": t[2]} for t in TAXONOMY},
        "features": feats,
    }, ensure_ascii=False, indent=1), "utf-8")
    (DATA / "photo-archive.json").write_text(json.dumps({
        "generated": datetime.now().isoformat(timespec="seconds"),
        "count": len(results),
        "photos": results,
        "skipped": [{"file": f, "reason": r} for f, r in skipped],
    }, ensure_ascii=False, indent=1), "utf-8")

    log("\n================ 完成 ================")
    log(f"收錄 {len(results)} 張，略過 {len(skipped)} 張")
    if results:
        from collections import Counter
        c = Counter(CLASS_ZH[m["cls"]] for m in results)
        log("類別分佈：" + "、".join(f"{k} {v}" for k, v in c.most_common()))
    if skipped:
        log("略過清單：")
        for f, r in skipped[:10]:
            log(f"  - {f}（{r}）")
    log(f"圖片輸出：{OUT_PHOTOS}")
    log(f"檔案輸出：{DATA / 'photos.geojson'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
