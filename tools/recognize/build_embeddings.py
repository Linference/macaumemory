"""建立「澳門建築記憶點」的視覺嵌入庫 → public/data/memory-embeddings.json

流程
    photos-src/cc/<building_id>/*.jpg  （101 張、21 棟、開放授權實拍）
        ↓ 每張照片各自做 DINOv2 編碼（多裁切 + 水平翻轉平均）
    每棟一組 L2 正規化的向量
        ↓ 同一棟做平均 → 再 L2 正規化 → 該棟的「質心向量」
    輸出 JSON：{ model, dim, preproc, buildings: [{ id, nameZh, cls, vectors: [...] , centroid: [...] }] }

為什麼前端只算點積：
    所有向量（含查詢照片的）都已 L2 正規化，餘弦相似度 = 點積，省掉前端開根號。

為什麼用 photos-src/cc（而不是 public/photos）：
    public/photos 只有 4 棟、6 張，且是 3D 模型截圖（分布外）。
    photos-src/cc 是 101 張真實照片、20+ 棟建築，同一棟有不同攝影者／年份／角度，
    這才是「使用者拿手機拍一張」的真實分布（tools/eval 的 E1r 實驗就是用它）。

用法：
    python tools/recognize/build_embeddings.py
    python tools/recognize/build_embeddings.py --onnx tools/recognize/out/dinov2-small-336.onnx   # 用 ONNX 編碼（預設）
    python tools/recognize/build_embeddings.py --torch                                          # 用 PyTorch 編碼（對照組）
    python tools/recognize/build_embeddings.py --eval                                           # 額外做 Top-1/Top-3 檢索評估
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "public" / "data" / "memory-embeddings.json"
CC_DIR = ROOT / "photos-src" / "cc"
DEMO_DIR = ROOT / "photos-src" / "demo"
DEFAULT_ONNX = Path(__file__).resolve().parent / "out" / "dinov2-small-336.onnx"

SIZE = 336                      # 336 / 14 = 24 → 576 patch + 1 cls
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

sys.path.insert(0, str(Path(__file__).resolve().parent))


# --------------------------------------------------------------------------- 建築名冊
# photos-src/cc 的資料夾 id → 網站用的中文名／類別／對應的景點 id（可點進地圖與三維模型）
# cls 用 datasets/macau-buildings/data.yaml 的 11 類（YOLO 標籤），中文名見 src/recognize/labels.js
# spot 對應 public/data/attractions.json 的 id（tools/recognize/check-spot-ids.mjs 可驗證）
# accept_cls：稽核（audit_references.py）時「這棟建築合理的 YOLO 類別」——
#   11 類的分類器對某些建築型態本來就沒有對應類別（例如燈塔、修院、中式廟宇的圍牆），
#   把可接受的類別寫進來，稽核才不會把「分類器能力不足」誤判成「照片是壞圖」。
BUILDINGS: dict[str, dict] = {
    "ruins-st-paul":       {"zh": "大三巴牌坊",       "en": "Ruins of St. Paul's",        "cls": "monument",          "spot": "ruins-st-paul"},
    "macau-tower":         {"zh": "澳門旅遊塔",       "en": "Macau Tower",                "cls": "civic",             "spot": "macau-tower"},
    "macau-science-center": {"zh": "澳門科學館",      "en": "Macao Science Center",       "cls": "civic",             "spot": "macau-science-center"},
    "the-venetian":        {"zh": "澳門威尼斯人",     "en": "The Venetian Macao",         "cls": "casino_hotel",      "spot": "venetian"},
    "grand-lisboa":        {"zh": "葡京酒店（新葡京）", "en": "Hotel & Grand Lisboa",      "cls": "casino_hotel",      "spot": "grand-lisboa"},
    "a-ma-temple":         {"zh": "媽閣廟",           "en": "A-Ma Temple",                "cls": "temple",            "spot": "a-ma-temple"},
    "kun-iam-temple":      {"zh": "觀音堂（普濟禪院）", "en": "Kun Iam Temple",            "cls": "temple",            "spot": None},
    "st-dominic-church":   {"zh": "玫瑰堂（聖多明我教堂）", "en": "St. Dominic's Church",  "cls": "church",            "spot": "st-dominic"},
    "st-lawrence-church":  {"zh": "聖老楞佐堂",       "en": "St. Lawrence's Church",      "cls": "church",            "spot": "st-lawrence"},
    "cathedral-macau":     {"zh": "主教座堂（大堂）",   "en": "Cathedral of Macau",         "cls": "church",            "spot": "cathedral"},
    "mandarins-house":     {"zh": "鄭家大屋",         "en": "Mandarin's House",           "cls": "tong_lau",          "spot": "mandarins-house",
                            # YOLO 對鄭家大屋一律判 portuguese(0.9)：它是嶺南院落式大宅，
                            # 11 類裡沒有對應類別。這是類別定義問題，不是照片問題（curation.json 有記）。
                            "accept_cls": ["portuguese", "village"]},
    "taipa-houses":        {"zh": "龍環葡韻住宅式博物館", "en": "Taipa Houses–Museum",     "cls": "portuguese",        "spot": "taipa-houses"},
    "moorish-barracks":    {"zh": "港務局大樓",       "en": "Moorish Barracks",           "cls": "portuguese",        "spot": "moorish-barracks"},
    "leal-senado":         {"zh": "民政總署大樓",     "en": "Leal Senado Building",       "cls": "civic",             "spot": "leal-senado"},
    "senado-square":       {"zh": "議事亭前地",       "en": "Senado Square",              "cls": "civic",             "spot": "senado-square"},
    "rua-da-felicidade":   {"zh": "福隆新街",         "en": "Rua da Felicidade",          "cls": "tong_lau",          "spot": None},
    "red-market":          {"zh": "紅街市（提督街市）", "en": "Red Market",                "cls": "market",            "spot": "red-market"},
    "coloane-village":     {"zh": "路環市區",         "en": "Coloane Village",            "cls": "village",           "spot": None},
    "guiuan-village":      {"zh": "氹仔舊城區",       "en": "Taipa Old Village",          "cls": "village",           "spot": None},
    "lai-chi-vun":         {"zh": "荔枝碗船廠",       "en": "Lai Chi Vun Shipyards",      "cls": "industrial",        "spot": "lai-chi-vun"},

    # === 擴充：澳門歷史城區與被評定的文物建築 ===
    # 照片來源見 photos-src/cc/ATTRIBUTION-user-provided.csv（使用者提供）與
    # photos-src/cc/ATTRIBUTION-references.csv（Wikimedia Commons）。
    "st-joseph-seminary":  {"zh": "聖若瑟修院及聖堂", "en": "St. Joseph's Seminary and Church",
                            "cls": "church", "accept_cls": ["portuguese", "civic"], "spot": "st-joseph-seminary"},
    "na-tcha-temple":      {"zh": "大三巴哪吒廟",     "en": "Na Tcha Temple",
                            "cls": "temple", "accept_cls": ["monument", "village", "tong_lau"],
                            "spot": "na-tcha-temple"},
    "guia-fortress":       {"zh": "東望洋炮台及燈塔",  "en": "Guia Fortress and Lighthouse",
                            "cls": "monument", "accept_cls": ["civic", "portuguese", "church"],
                            "spot": "guia-fortress"},
    "dom-pedro-v-theatre": {"zh": "崗頂劇院（伯多祿五世劇院）", "en": "Dom Pedro V Theatre",
                            # YOLO 對這棟一律判 monument(0.8)：新古典主義劇院在 11 類裡沒有對應類別。
                            "cls": "civic", "accept_cls": ["portuguese", "monument"], "spot": None},
    # === 新增：使用者提供的本機照片（澳门著名建筑图片，857 張）===
    "fortress-monte":      {"zh": "大炮台（聖保祿炮台）", "en": "Fortress of Our Lady of the Mount",
                            "cls": "monument", "accept_cls": ["portuguese", "civic", "village"],
                            "spot": "fortress-monte"},
    "lou-kau-house":       {"zh": "盧家大屋（金玉堂）", "en": "Lou Kau Mansion",
                            "cls": "tong_lau", "accept_cls": ["portuguese", "village"], "spot": None},
    "portas-do-cerco":     {"zh": "關閘（關閘拱門）",  "en": "Portas do Cerco",
                            "cls": "monument", "accept_cls": ["village", "civic"], "spot": "portas-do-cerco"},
    "macau-museum":        {"zh": "澳門博物館",       "en": "Macau Museum",
                            "cls": "civic", "accept_cls": ["portuguese", "monument"],
                            "spot": "museum-macau-museum"},
    "grand-prix-museum":   {"zh": "澳門大賽車博物館",  "en": "Macau Grand Prix Museum",
                            "cls": "civic", "accept_cls": ["portuguese", "monument"],
                            "spot": "grand-prix-museum"},
    "macau-cultural-centre": {"zh": "澳門文化中心",    "en": "Macau Cultural Centre",
                            "cls": "civic", "accept_cls": ["portuguese"], "spot": "centro-cultural"},
    "fishermans-wharf":    {"zh": "澳門漁人碼頭",     "en": "Macau Fisherman's Wharf",
                            "cls": "casino_hotel", "accept_cls": ["monument", "portuguese", "civic"],
                            "spot": "fisherman-wharf"},
    "galaxy-macau":        {"zh": "澳門銀河",         "en": "Galaxy Macau",
                            "cls": "casino_hotel", "accept_cls": ["residential_tower"],
                            "spot": "galaxy"},
    "londoner-macao":      {"zh": "澳門倫敦人",       "en": "The Londoner Macao",
                            "cls": "casino_hotel", "accept_cls": ["residential_tower", "monument"],
                            "spot": "londoner"},
    "wynn-macau":          {"zh": "永利澳門",         "en": "Wynn Macau",
                            "cls": "casino_hotel", "accept_cls": ["residential_tower"], "spot": "wynn-macau"},
    "wynn-palace":         {"zh": "永利皇宮",         "en": "Wynn Palace",
                            "cls": "casino_hotel", "accept_cls": ["residential_tower"], "spot": "wynn-palace"},
    "mgm-macau":           {"zh": "澳門美高梅",       "en": "MGM Macau",
                            "cls": "casino_hotel", "accept_cls": ["residential_tower", "civic"],
                            "spot": "mgm-macau"},
    "kun-iam-statue":      {"zh": "觀音蓮花苑",       "en": "Kun Iam Statue",
                            "cls": "monument", "accept_cls": ["temple", "civic"], "spot": "kun-iam-statue"},
}

# 少數 demo 截圖（3D 模型）也納入參考庫：它們就是網站上三維模型的樣貌，
# 對「拿我們自己的模型截圖去查」這種用法特別有幫助。
DEMO_EXTRA: dict[str, str] = {
    "大三巴牌坊-demo.jpg": "ruins-st-paul",
    "大三巴牌坊-demo2.jpg": "ruins-st-paul",
    "澳門巴黎人-demo.jpg": "parisian",
    "澳門旅遊塔-demo.jpg": "macau-tower",
    "澳門旅遊塔-demo2.jpg": "macau-tower",
    "澳門科學館-demo.jpg": "macau-science-center",
}

# demo 截圖才有的建築（photos-src/cc 沒有這個資料夾）
BUILDINGS["macau-science-center"] = {"zh": "澳門科學館", "en": "Macao Science Center",
                                     "cls": "civic", "spot": "macau-science-center"}
BUILDINGS["parisian"] = {"zh": "澳門巴黎人", "en": "The Parisian Macao",
                         "cls": "casino_hotel", "spot": "parisian"}


def sha256(p: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- 前處理
def preprocess(img: Image.Image, size: int = SIZE) -> np.ndarray:
    """shortest-edge resize + center crop（與 tools/eval/dino_embed.py 同一套邏輯）。"""
    w, h = img.size
    s = size / min(w, h)
    if s != 1.0:
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
    w, h = img.size
    left, top = (w - size) // 2, (h - size) // 2
    img = img.crop((left, top, left + size, top + size))
    a = np.asarray(img, dtype=np.float32) / 255.0
    a = (a - MEAN) / STD
    return np.transpose(a, (2, 0, 1))[None]        # (1,3,H,W)


def _crops(img: Image.Image, size: int = SIZE, n_crop: int = 3):
    """多裁切：全圖置中 + 左右各偏一點，模擬使用者取景偏移。"""
    out = [preprocess(img, size)]
    if n_crop <= 1:
        return out
    w, h = img.size
    s = size / min(w, h)
    rw, rh = max(size, round(w * s)), max(size, round(h * s))
    resized = img.resize((rw, rh), Image.BICUBIC)
    for frac in (0.12, -0.12):
        dx = int((rw - size) * frac)
        dy = int((rh - size) * frac)
        left = min(max(0, (rw - size) // 2 + dx), rw - size)
        top = min(max(0, (rh - size) // 2 + dy), rh - size)
        out.append(preprocess(resized.crop((left, top, left + size, top + size)), size))
    return out


# --------------------------------------------------------------------------- 編碼器
class OnnxEncoder:
    """用 onnxruntime 跑匯出的 DINOv2（與瀏覽器同一顆模型、同一套前處理）。"""

    name = "onnx"

    def __init__(self, path: Path, threads: int = 0):
        import onnxruntime as ort

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        self.input = self.sess.get_inputs()[0].name
        self.model_name = path.name
        self.dim = int(self.sess.get_outputs()[0].shape[-1])

    def embed(self, imgs: list[Image.Image], flip_tta: bool = True) -> np.ndarray:
        vecs = []
        for im in imgs:
            batch = _crops(im)
            if flip_tta:
                batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
            arr = np.concatenate(batch, 0)
            out = self.sess.run(None, {self.input: arr})[0]        # (N, dim)
            out = out / np.linalg.norm(out, axis=-1, keepdims=True)
            v = out.mean(0)
            vecs.append(v / np.linalg.norm(v))
        return np.stack(vecs, 0).astype(np.float32)


class TorchEncoder:
    """PyTorch 對照組（tools/eval/dino_embed.py 的同一顆模型）。"""

    name = "torch"

    def __init__(self, model_id: str = "facebook/dinov2-small", device: str | None = None):
        import torch
        from transformers import AutoModel

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = AutoModel.from_pretrained(model_id).to(self.device).eval()
        self.model_name = model_id
        self.dim = int(self.model.config.hidden_size)

    def embed(self, imgs: list[Image.Image], flip_tta: bool = True) -> np.ndarray:
        torch = self.torch
        vecs = []
        for im in imgs:
            batch = _crops(im)
            if flip_tta:
                batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
            x = torch.from_numpy(np.concatenate(batch, 0)).to(self.device)
            with torch.no_grad():
                out = self.model(pixel_values=x).last_hidden_state[:, 0]
            out = out / out.norm(dim=-1, keepdim=True)
            v = out.mean(0).cpu().numpy()
            vecs.append(v / np.linalg.norm(v))
        return np.stack(vecs, 0).astype(np.float32)


# --------------------------------------------------------------------------- 主流程
def collect_references() -> list[dict]:
    """回傳 [{id, path, src}]：cc 的實拍 + demo 的模型截圖（後者標記 isDemo）。

    會套用 curation.json：exclude 清單（人工複核確認「主體不是這棟建築」的照片）與
    exclude_buildings（整棟移除，例如參考照片全部不合格的街景類）。
    """
    ex = load_curation()
    excluded = ex.get("exclude_set", set())
    drop_buildings = set(ex.get("exclude_buildings", {}))
    refs: list[dict] = []
    for bid in sorted(BUILDINGS):
        if bid in drop_buildings:
            continue
        d = CC_DIR / bid
        if d.is_dir():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                    if f"{bid}/{f.name}" in excluded:
                        continue
                    refs.append({"id": bid, "path": f, "isDemo": False})
    for fname, bid in DEMO_EXTRA.items():
        if bid not in BUILDINGS or bid in drop_buildings:
            continue
        f = DEMO_DIR / fname
        if f.is_file() and f"{bid}/{fname}" not in excluded:
            refs.append({"id": bid, "path": f, "isDemo": True})
    if excluded or drop_buildings:
        print(f"      curation.json：排除 {len(excluded)} 張照片、{len(drop_buildings)} 棟建築")
    return refs


def load_curation() -> dict:
    """讀 curation.json（不存在就回空設定，流程仍可跑）。"""
    p = Path(__file__).resolve().parent / "curation.json"
    if not p.is_file():
        return {"exclude_set": set(), "exclude_buildings": {}}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"      !! curation.json 讀取失敗（忽略）：{e}")
        return {"exclude_set": set(), "exclude_buildings": {}}
    files = {e["file"] if isinstance(e, dict) else e for e in raw.get("exclude", [])}
    return {"exclude_set": files, "exclude_buildings": raw.get("exclude_buildings", {}), "why": raw.get("why", "")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", default=str(DEFAULT_ONNX))
    ap.add_argument("--torch", action="store_true", help="改用 PyTorch 編碼（對照組）")
    ap.add_argument("--torch-model", default="facebook/dinov2-small")
    ap.add_argument("--no-tta", action="store_true", help="關閉多裁切與水平翻轉")
    ap.add_argument("--eval", action="store_true", help="做 leave-one-out 檢索評估（Top-1/Top-3）")
    ap.add_argument("--min-vectors", type=int, default=1)
    ap.add_argument("--out", default=str(OUT_JSON))
    args = ap.parse_args()

    refs = collect_references()
    n_b = len({r["id"] for r in refs})
    print(f"[1/4] 參考影像 {len(refs)} 張、{n_b} 棟建築"
          f"（實拍 {sum(1 for r in refs if not r['isDemo'])}、模型截圖 {sum(1 for r in refs if r['isDemo'])}）")

    if args.torch:
        enc = TorchEncoder(args.torch_model)
        onnx_hash = None
    else:
        p = Path(args.onnx)
        if not p.is_file():
            raise SystemExit(f"找不到 ONNX：{p}\n請先跑 python tools/recognize/export_dino_onnx.py")
        enc = OnnxEncoder(p)
        onnx_hash = sha256(p)
        # 前端會去 public/models/ 載入模型；若那份與建庫用的不是同一個檔，
        # 查詢向量與庫內向量會落在不同分布（曾經真的發生過：同一張圖自相似度只有 0.06）。
        pub = ROOT / "public" / "models" / p.name
        if pub.is_file():
            same = sha256(pub) == onnx_hash
            print(f"      public/models/{p.name} 與建庫用檔同檔 = {same}")
            if not same:
                print("      !! 不同檔！前端會用 public/models 那份，這會讓所有查詢失效。")
                print(f"         請執行：copy \"{p}\" \"{pub}\"")
        else:
            print(f"      !! public/models/{p.name} 不存在（前端會載入不到模型）")
    print(f"[2/4] 編碼器 {enc.name} · {enc.model_name} · 維度 {enc.dim}"
          f" · TTA {'off' if args.no_tta else 'on'}")

    t0 = time.time()
    rows: list[dict] = []
    for i, r in enumerate(refs, 1):
        try:
            img = Image.open(r["path"]).convert("RGB")
        except Exception as e:
            print(f"  !! 讀不到 {r['path']}: {e}")
            continue
        v = enc.embed([img], flip_tta=not args.no_tta)[0]
        rows.append({"id": r["id"], "file": r["path"].name, "isDemo": r["isDemo"], "v": v})
        if i % 10 == 0 or i == len(refs):
            print(f"      {i}/{len(refs)} … {time.time()-t0:.1f}s")
    print(f"      編碼完成 {len(rows)} 張，{time.time()-t0:.1f} 秒")

    dim = int(rows[0]["v"].shape[0])
    assert all(r["v"].shape[0] == dim for r in rows), "維度不一致"

    # ---------------------------------------------------------------- 每棟質心
    buildings = []
    for bid in sorted({r["id"] for r in rows}):
        mine = [r for r in rows if r["id"] == bid]
        if len(mine) < args.min_vectors:
            continue
        M = np.stack([r["v"] for r in mine], 0)
        c = M.mean(0)
        c = c / np.linalg.norm(c)
        meta = BUILDINGS[bid]
        buildings.append({
            "id": bid,
            "zh": meta["zh"],
            "en": meta["en"],
            "cls": meta["cls"],
            "spot": meta["spot"],
            # 三維模型連結由 resolve_models() 依 manifest.json 填入（見 main()）。
            # 原本這裡寫的是 SPOT_MODEL.get(meta["spot"], meta["spot"])——那個
            # fallback 會把 spot id 當成 model id 寫進輸出，導致 21 棟裡有 13 棟
            # 指向不存在的模型，前端「看三維模型」按鈕必然失敗。
            "model": None,
            "count": len(mine),
            "files": [r["file"] for r in mine],
            "centroid": [round(float(x), 6) for x in c],
            "vectors": [[round(float(x), 6) for x in r["v"]] for r in mine],
        })
    print(f"[3/4] 建築質心 {len(buildings)} 筆（每棟 {min(b['count'] for b in buildings)}~"
          f"{max(b['count'] for b in buildings)} 張參考）")

    # ---------------------------------------------------------------- 檢索評估
    metrics = {}
    if args.eval:
        metrics = leave_one_out(rows)
        print("[eval] " + json.dumps(metrics, ensure_ascii=False))

    # ---------------------------------------------------------------- 輸出
    # 接上 resolve_models()：把每棟的三維模型連結解析成「manifest.json 裡真的有的
    # 模型 id」，沒有對應模型的建築一律留 None（前端據此隱藏按鈕，而不是給出會失敗
    # 的連結）。這個函式原本只被定義、從未被呼叫，因此壞的 fallback 一直是實際
    # 生效的程式——這是 13 棟指向不存在模型的直接原因。
    _resolved = resolve_models({b["id"]: b for b in buildings})
    for _b in buildings:
        _b["model"] = _resolved.get(_b["id"])
    print(
        "      [model] 三維模型連結："
        f"{sum(1 for b in buildings if b.get('model'))} 棟有、"
        f"{sum(1 for b in buildings if not b.get('model'))} 棟無"
    )

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "encoder": {
            "name": "DINOv2 ViT-S/14 (facebook/dinov2-small)",
            "source": enc.model_name,
            "runtime": "onnxruntime-web (wasm)",
            "onnx_sha256": onnx_hash,
            "onnx_bytes": (Path(args.onnx).stat().st_size if not args.torch else None),
            "dim": dim,
            "size": SIZE,
            "pool": "cls",
            "normalized": True,
        },
        "preproc": {
            "resize": "shortest-edge → center crop",
            "size": SIZE,
            "mean": MEAN.tolist(),
            "std": STD.tolist(),
            "tta": not args.no_tta,
            "crops": 3 if not args.no_tta else 1,
            "flip": not args.no_tta,
        },
        "categories": CATEGORY_ZH,
        "count": len(buildings),
        "buildings": buildings,
        "eval": metrics,
        "note": "向量皆已 L2 正規化，前端以點積算餘弦相似度；centroid 為該棟所有參考向量的平均（再正規化）。",
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"[4/4] → {out}（{out.stat().st_size/1e6:.2f} MB）")

    # 顯示前幾名的兩兩相似度，方便肉眼確認庫的區辨力
    cents = np.array([b["centroid"] for b in buildings], np.float32)
    S = cents @ cents.T
    np.fill_diagonal(S, -1)
    pairs = [(float(S[i, j]), buildings[i]["zh"], buildings[j]["zh"])
             for i in range(len(buildings)) for j in range(i + 1, len(buildings))]
    pairs.sort(reverse=True)
    print("[相似度] 最像的 5 組不同建築（越低越好）：")
    for s, a, b in pairs[:5]:
        print(f"      {s:.3f}  {a} ↔ {b}")
    print(f"[相似度] 全部不同棟配對：平均 {np.mean([p[0] for p in pairs]):.3f}、"
          f"最大 {pairs[0][0]:.3f}")
    return 0


def leave_one_out(rows: list[dict]) -> dict:
    """留一法檢索：拿掉一張照片後，用它去查剩下的庫，看能不能找回同棟。"""
    ids = sorted({r["id"] for r in rows})
    idx = {b: i for i, b in enumerate(ids)}
    V = np.stack([r["v"] for r in rows], 0)
    y = np.array([idx[r["id"]] for r in rows])
    S = V @ V.T
    np.fill_diagonal(S, -1e9)                     # 自己不算
    top1 = top3 = 0
    n = 0
    margins, sims_same, sims_diff = [], [], []
    for i in range(len(rows)):
        g = y[i]
        # 用「其餘同棟的最高分」當作該棟分數（留一法），才不會被單張雜訊主導。
        # 注意：沒有其他同棟樣本的棟別（例如只有一張 demo 截圖的建築）不能給 -1e9，
        # 否則它會變成「永遠的第一名」—— 這種棟別直接略過。
        scores = np.full(len(ids), -np.inf, np.float32)
        for b in range(len(ids)):
            m = (y == b) & (np.arange(len(rows)) != i)
            if m.any():
                scores[b] = S[i][m].max()
        if not np.isfinite(scores[g]):
            continue                                   # 該棟只有這一張，無法當查詢
        r = np.argsort(-scores)
        if r[0] == g:
            top1 += 1
        if g in r[:3]:
            top3 += 1
        if len(r) > 1:
            margins.append(float(scores[r[0]] - scores[r[1]]))
        sims_same.append(float(scores[g]))
        sims_diff.append(float(np.max(np.delete(scores, g))))
        n += 1
    # 檢索門檻建議：不同棟配對的 95% 分位 + 一點餘裕 → 前端可以拿來判斷「可能是別的建築」
    try:
        diff_scores = np.array(sims_diff, np.float32)
        same_scores = np.array(sims_same, np.float32)
        dist = {"diff_p50": float(np.percentile(diff_scores, 50)),
                "diff_p95": float(np.percentile(diff_scores, 95)),
                "same_p05": float(np.percentile(same_scores, 5)),
                "same_mean": float(same_scores.mean())}
    except Exception:
        dist = {}
    return {
        "n_queries": n,
        "n_buildings": len(ids),
        "top1": round(top1 / n, 4) if n else None,
        "top3": round(top3 / n, 4) if n else None,
        "sim_same_mean": round(float(np.mean(sims_same)), 4) if sims_same else None,
        "sim_diff_mean": round(float(np.mean(sims_diff)), 4) if sims_diff else None,
        "margin_mean": round(float(np.mean(margins)), 4) if margins else None,
        "distribution": {k: round(v, 4) for k, v in dist.items()},
        "suggested": {
            "hit": round(dist.get("diff_p95", 0.45) + 0.03, 2),
            "maybe": round(dist.get("diff_p50", 0.30), 2),
        },
    }


# 景點 id → public/models/manifest.json 的模型 id。
# ⚠️ 只有真的存在 GLB 的才填；不要用「景點 id 當模型 id」的萬用 fallback ——
#    那會讓前端對每一棟都顯示「三維模型」按鈕，點下去卻找不到模型。
#    這裡寫死一份對照，並在 build 時用 manifest.json 驗證（見 resolve_models()）。
MODEL_BY_SPOT = {
    "parisian": "parisian",
    "macau-tower": "macau-tower",
    "macau-science-center": "macau-science-center",
    "galaxy": "galaxy-macau",
    "londoner": "londoner-macao",
}


def resolve_models(buildings_meta: dict) -> dict:
    """把建築的 spot → model 解析成「manifest.json 裡真的有的模型 id」（沒有就 None）。"""
    manifest = ROOT / "public" / "models" / "manifest.json"
    available = set()
    if manifest.is_file():
        try:
            available = set(json.loads(manifest.read_text(encoding="utf-8")).get("models", {}).keys())
        except Exception as e:
            print(f"      !! manifest.json 讀取失敗：{e}")
    else:
        print("      !! 找不到 public/models/manifest.json，三維模型連結一律留空")
    resolved = {}
    for bid, meta in buildings_meta.items():
        want = MODEL_BY_SPOT.get(meta.get("spot"))
        if want and want in available:
            resolved[bid] = want
        elif want:
            print(f"      !! {bid} 指定的模型 {want} 不在 manifest.json 裡，改為 None")
            resolved[bid] = None
        else:
            resolved[bid] = None
    return resolved

CATEGORY_ZH = {
    "portuguese": "葡式殖民建築",
    "temple": "中式廟宇",
    "church": "天主教教堂",
    "tong_lau": "騎樓與唐樓",
    "residential_tower": "現代高層住宅",
    "casino_hotel": "酒店與娛樂場",
    "civic": "公共建築",
    "industrial": "工業與倉庫",
    "village": "圍里與村落民居",
    "monument": "牌坊與紀念物",
    "market": "街市與市集",
    "street": "街景與其他",
}


if __name__ == "__main__":
    raise SystemExit(main())
