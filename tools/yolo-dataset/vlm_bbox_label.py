"""用 DeepSeek 視覺模型替「澳門著名建築圖片」自動產生 YOLO 檢測框。

設計與踩過的坑（重要）：
  1. VLM 的「座標回歸」很弱、但「離散判斷」很強。所以不叫模型直接吐座標，
     而是在圖上疊一張 5×5 標號網格（欄 1-5 由左至右、列 A-E 由上至下），
     請它回答「建築主體佔到第幾欄到第幾欄、第幾列到第幾列」——離散選擇題。
     合成校正實驗（把已知位置的色塊貼在真實照片上）證實讀格能力極準：IoU 平均 0.97。
  2. deepseek-flash 是推理模型，預設會把 token 全花在 reasoning 上、最後吐不出 JSON
     （finish_reason=length、content 空字串）。實測 reasoning_effort="none" 可完全關掉推理：
     延遲 3.0s→0.7s、completion 400→21 tokens，JSON 穩定合法。**這是關鍵設定。**
  3. 模型判斷「建築邊界」會系統性偏鬆（傾向把上方天空那一列算進去）。
     對策有兩層：
       階段 2（放大）：把粗框區域裁出來放大、再疊一次 5×5 網格 → 每格只代表原圖 1/25，
                       量化誤差大幅下降。粗框太小或信心低時觸發。
       階段 3（裁天空）：純 CV，只在框外圈明顯是天空時往內縮，只做減法不做加法。
  4. 另外請模型回報 ratio（自評佔畫面比例）、n_buildings、clean（有無浮水印/拼貼）、
     complete、is_building。ratio 與實際框面積的落差可用來偵測「偷懶框滿整張」。

輸出（中介檔，**不直接寫進資料集**）：
    .cache/vlm-label/labels.json     每張圖的完整 VLM 結果（含各階段與診斷）
    .cache/vlm-label/usage.json      API 用量累計

用法：
    python tools/yolo-dataset/vlm_bbox_label.py --probe 东望洋灯塔 大三巴牌坊 --per-folder 5
    python tools/yolo-dataset/vlm_bbox_label.py --all --workers 6
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from sky_trim import imread_unicode, refine_box, sky_frac, sky_mask, trim_by_sky

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(r"C:\Users\LINKIT\Desktop\澳门著名建筑图片")
WORK = ROOT / ".cache" / "vlm-label"
CACHE = WORK / "labels.json"
USAGE = WORK / "usage.json"
API = "https://api.deepseek.com/chat/completions"

CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]

# 資料夾中文名 → 類別（使用者提供的對照表）
FOLDER_CLASS = {
    "大三巴牌坊": "monument", "哪吒庙": "temple", "大炮台": "monument", "妈阁庙": "temple",
    "玫瑰堂": "church", "民政总署大楼": "civic", "港务局大楼": "portuguese",
    "郑家大屋": "tong_lau", "卢家大屋": "tong_lau", "龙环葡韵": "portuguese",
    "圣若瑟修院": "church", "岗顶剧院": "civic", "东望洋灯塔": "monument", "关闸": "monument",
    "澳门博物馆": "civic", "澳门大赛车博物馆": "civic", "澳门文化中心": "civic",
    "澳门旅游塔": "civic", "澳门科学馆": "civic", "澳门渔人码头": "casino_hotel",
    "威尼斯人度假村": "casino_hotel", "巴黎人酒店": "casino_hotel", "新葡京酒店": "casino_hotel",
    "澳门银河": "casino_hotel", "澳门伦敦人": "casino_hotel", "永利澳门": "casino_hotel",
    "永利皇宫": "casino_hotel", "美高梅": "casino_hotel", "观音莲花苑": "monument",
}

GRID = 5
LONG_EDGE = 896
ZOOM_TRIGGER_AREA = 0.45    # 粗框佔比低於此值就做放大階段（放大後量化誤差降為 1/5）
ZOOM_TRIGGER_CONF = 0.75
PASS2_TRIGGER_RATIO_GAP = 0.22   # 模型自評佔比與框面積落差過大 → 框明顯偏鬆 → 內部再切一次
DEFAULT_MODEL = "deepseek-flash"
LETTERS = "".join(chr(ord("A") + i) for i in range(GRID))

PROMPT = """看這張照片，畫面已疊加 {g}×{g} 網格：欄（左右）由左至右標為 1~{g}，列（上下）由上至下標為 A~{letters}。
網格標籤畫在圖片頂端、左端、右端、底端。

請找出畫面中**最大、最完整的那一棟建築**，然後判斷它的主體外牆範圍。
判斷規則（逐格檢查，寧可少算也不要多算）：
- 對最上面那列：如果那一列**大部分是天空**（建築只佔該列高度不到 1/3），就不要把那一列算進去。
- 對最下面那列：如果那一列**大部分是地面/馬路/台階/水池/草地**，就不要把那一列算進去。
- 同理處理最左欄與最右欄：如果那一欄大多是背景（天空、樹、鄰棟、空曠處），就不要算。
- 只框**建築物本身**（外牆、屋頂、塔身）。天空、雲、地面、樹木、街道、欄杆、旗桿一律不算。
- 若畫面有多棟建築，只挑最大最完整的那一棟，不要合併成一個大框。
- 若畫面裡沒有建築（純風景、室內特寫、食物、人物、地圖、文件），把 is_building 填 false。

另外請回報：
- ratio：這棟建築的可見面積大約佔整張畫面的幾分之幾（0~1）。
- n_buildings：畫面裡大約有幾棟明顯可辨識的建築（整數）。
- clean：畫面是否乾淨（true），或是有浮水印／文字標註／拼貼分割線／明顯後製（false）。
- complete：這棟建築是否完整可見（沒有被切掉大半、沒有被嚴重遮擋）。
- conf：你對以上判斷的信心（0~1）。

**直接輸出以下 JSON，不要有任何推理或說明文字：**
{{"col_from":2,"col_to":4,"row_from":2,"row_to":4,"ratio":0.35,"n_buildings":1,"clean":true,"complete":true,"is_building":true,"conf":0.85}}"""

# 階段 2：只看粗框那一塊，5×5 網格 → 每格 = 原圖的 1/25
PROMPT_ZOOM = """這是同一張照片的**局部放大**，畫面已疊加 {g}×{g} 網格：欄 1~{g} 由左至右，列 A~{letters} 由上至下。
請看這個局部裡**最主要的建築主體**，回答它佔到第幾欄到第幾欄、第幾列到第幾列。
規則（寧可少算也不要多算）：
- 只框建築本體（外牆、屋頂、塔身），不含天空、雲、地面、樹木、街道、欄杆、旗桿。
- 最上面那列若大部分是天空就不要算；最下面那列若大部分是地面就不要算。
- 邊界剛好落在格線上時，選比較保守（框小一點）的那一格。

**直接輸出以下 JSON，不要有任何推理或說明文字：**
{{"col_from":1,"col_to":3,"row_from":1,"row_to":4,"ratio":0.5,"conf":0.85}}"""

# 階段 3：對每個邊界問「支不支持」，用多數決收緊
def edge_prompt(edges: list[str]) -> str:
    lines = []
    for e in edges:
        lines.append(f"- {e}")
    body = "\n".join(lines)
    return f"""這張照片已經畫了一個**紅色外框**（見圖）。請逐一回答下列問題，每題只能答 true（是）或 false（否）：
{body}

判斷標準：只有當「建築本體」真的接觸到該邊界時才答 true；若該邊界整條幾乎都是天空、地面、
樹木、街道或背景，答 false。邊界上有 1~2 個像素碰到不算接觸。

**直接輸出以下 JSON，不要有任何推理或說明文字：**
{{"top":true,"bottom":true,"left":true,"right":true}}"""


def api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        return key
    for p in (ROOT / "public" / "ai-local.json", ROOT / ".cache" / "deepseek.json"):
        if p.exists():
            try:
                d = json.loads(p.read_text(encoding="utf-8-sig"))
                if d.get("key"):
                    return d["key"]
            except Exception:
                pass
    raise SystemExit("缺少 DeepSeek 金鑰：請設 DEEPSEEK_API_KEY 或確認 public/ai-local.json 存在")


def _font(size: int):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_grid(im: Image.Image, g: int = GRID) -> Image.Image:
    im = im.convert("RGB")
    W, H = im.size
    d = ImageDraw.Draw(im)
    fs = max(12, round(min(W, H) / 42))
    f = _font(fs)
    d.rectangle([0, 0, W - 1, H - 1], outline=(255, 0, 255), width=max(2, fs // 7))
    for i in range(1, g):
        x, y = W * i / g, H * i / g
        for k in range(0, W, 26):
            d.line([(x, k), (x, min(H, k + 13))], fill=(255, 0, 255), width=2)
        for k in range(0, H, 26):
            d.line([(k, y), (min(W, k + 13), y)], fill=(255, 0, 255), width=2)
    letters = "".join(chr(ord("A") + i) for i in range(g))
    pad = fs + 6
    for i in range(g):
        cx = W * (i + 0.5) / g
        for yy in (4, H - pad - 2):
            d.rectangle([cx - fs * 0.75, yy, cx + fs * 0.75, yy + pad], fill=(0, 0, 0))
            d.text((cx, yy + pad / 2), str(i + 1), font=f, fill=(0, 255, 255), anchor="mm")
        cy = H * (i + 0.5) / g
        for xx in (4, W - pad - 2):
            d.rectangle([xx, cy - pad / 2, xx + pad, cy + pad / 2], fill=(0, 0, 0))
            d.text((xx + pad / 2, cy), letters[i], font=f, fill=(0, 255, 255), anchor="mm")
    return im


def draw_box_only(im: Image.Image, box) -> Image.Image:
    """畫一個醒目紅框但**不畫網格**（階段 3 問邊界接觸時用）。"""
    im = im.convert("RGB").copy()
    d = ImageDraw.Draw(im)
    x, y, w, h = box
    d.rectangle([x, y, x + w, y + h], outline=(255, 0, 0), width=max(4, int(min(im.size) / 100)))
    return im


def _jpeg(im: Image.Image, q: int = 88) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    return buf.getvalue()


def fit_long(im: Image.Image, long_edge: int = LONG_EDGE) -> Image.Image:
    im = im.convert("RGB")
    sc = long_edge / max(im.size)
    if sc < 1.0:
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    return im


def grid_bytes(path: Path) -> tuple[bytes, str, int, int]:
    with Image.open(path) as im:
        g = draw_grid(fit_long(im))
        return _jpeg(g), "image/jpeg", g.width, g.height


def cells_box(col_from, col_to, row_from, row_to, W, H, g: int = GRID):
    def cn(v):
        if isinstance(v, str):
            v = v.strip().upper()
            if v in LETTERS[:g]:
                return LETTERS.index(v) + 1
        try:
            return int(round(float(v)))
        except (TypeError, ValueError):
            return None

    c0, c1, r0, r1 = cn(col_from), cn(col_to), cn(row_from), cn(row_to)
    if None in (c0, r0, c1, r1):
        return None
    if not (1 <= min(c0, c1) <= g and 1 <= min(r0, r1) <= g):
        return None
    c0, c1 = max(1, min(c0, c1)), min(g, max(c0, c1))
    r0, r1 = max(1, min(r0, r1)), min(g, max(r0, r1))
    return (W * (c0 - 1) / g, H * (r0 - 1) / g, W * (c1 - c0 + 1) / g, H * (r1 - r0 + 1) / g)


def iou_xywh(a, b) -> float:
    if not a or not b:
        return 0.0
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    inter = max(0.0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0.0, min(ay + ah, by + bh) - max(ay, by))
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def clip_box(b, W, H):
    if not b:
        return None
    x, y, w, h = b
    x0, y0 = max(0.0, min(float(x), W)), max(0.0, min(float(y), H))
    x1, y1 = max(0.0, min(float(x + w), W)), max(0.0, min(float(y + h), H))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return x0, y0, x1 - x0, y1 - y0


def parse_reply(txt: str):
    if not txt:
        return None
    try:
        d = json.loads(txt)
    except Exception:
        s, e = txt.find("{"), txt.rfind("}")
        if s < 0 or e <= s:
            return None
        try:
            d = json.loads(txt[s:e + 1])
        except Exception:
            return None
    if isinstance(d, list):
        d = d[0] if d and isinstance(d[0], dict) else None
    if isinstance(d, dict) and isinstance(d.get("results"), list) and d["results"]:
        d = d["results"][0]
    return d if isinstance(d, dict) else None


class Usage:
    def __init__(self):
        self.lock = threading.Lock()
        self.calls = self.failed = self.pt = self.ct = self.rt = 0
        self.by_kind: Counter = Counter()
        if USAGE.exists():
            try:
                d = json.loads(USAGE.read_text(encoding="utf-8"))
                self.calls, self.failed = d.get("calls", 0), d.get("failed", 0)
                self.pt, self.ct, self.rt = (d.get("prompt_tokens", 0), d.get("completion_tokens", 0),
                                             d.get("reasoning_tokens", 0))
                self.by_kind.update(d.get("by_kind", {}))
            except Exception:
                pass

    def add(self, usage: dict | None, kind: str, ok: bool = True):
        with self.lock:
            self.calls += 1
            if not ok:
                self.failed += 1
            self.by_kind[kind] += 1
            if usage:
                self.pt += int(usage.get("prompt_tokens") or 0)
                self.ct += int(usage.get("completion_tokens") or 0)
                self.rt += int(((usage.get("completion_tokens_details") or {}).get("reasoning_tokens")) or 0)

    def save(self):
        with self.lock:
            USAGE.parent.mkdir(parents=True, exist_ok=True)
            USAGE.write_text(json.dumps({
                "calls": self.calls, "failed": self.failed, "prompt_tokens": self.pt,
                "completion_tokens": self.ct, "reasoning_tokens": self.rt,
                "by_kind": dict(self.by_kind), "total_tokens": self.pt + self.ct},
                ensure_ascii=False, indent=1), encoding="utf-8")


def call_vlm(img_bytes: bytes, key: str, model: str, prompt: str,
             detail: str = "high", max_tokens: int = 400, timeout: int = 120):
    """回傳 (parsed|None, usage|None, finish_reason)。reasoning_effort=none 是關鍵。"""
    content = [{"type": "text", "text": prompt},
               {"type": "image_url", "image_url": {
                   "url": f"data:image/jpeg;base64,{base64.b64encode(img_bytes).decode()}", "detail": detail}}]
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                       "response_format": {"type": "json_object"}, "temperature": 0.1,
                       "reasoning_effort": "none", "max_tokens": max_tokens}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read())
    ch = data["choices"][0]
    return parse_reply(ch["message"].get("content")), data.get("usage"), ch.get("finish_reason")


def _f(v):
    try:
        f = float(v)
        return None if f != f else round(f, 3)
    except (TypeError, ValueError):
        return None


def _i(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _ask_cells(img_bytes, key, model, prompt, usage, kind, retries, base_w, base_h):
    """問一次網格；回傳 (box, parsed, cells) 或 (None, None, None)。"""
    for attempt in range(1, retries + 1):
        try:
            parsed, u, fin = call_vlm(img_bytes, key, model, prompt)
            usage.add(u, kind, ok=parsed is not None)
            if parsed is None:
                time.sleep(1.2 * attempt)
                continue
            box = cells_box(parsed.get("col_from"), parsed.get("col_to"),
                            parsed.get("row_from"), parsed.get("row_to"), base_w, base_h)
            if box is None:
                time.sleep(1.2 * attempt)
                continue
            return box, parsed, (parsed.get("col_from"), parsed.get("row_from"),
                                 parsed.get("col_to"), parsed.get("row_to"))
        except urllib.error.HTTPError as e:
            try:
                body = e.read()[:160]
            except Exception:
                body = b""
            usage.add(None, kind, ok=False)
            if e.code in (401, 403, 402):
                raise Fatal(f"HTTP {e.code} {body!r}")
            time.sleep(min(30, 2 * attempt ** 2))
        except Fatal:
            raise
        except Exception:
            usage.add(None, kind, ok=False)
            time.sleep(min(20, 2 * attempt ** 2))
    return None, None, None


class Fatal(Exception):
    pass


def label_one(path: Path, key: str, model: str, retries: int, usage: Usage,
              do_zoom: bool, do_pass2: bool) -> dict:
    rec: dict = {"file": str(path), "folder": path.parent.name, "name": path.name,
                 "errors": [], "stages": {}}
    try:
        with Image.open(path) as im:
            rec["orig_size"] = list(im.size)
    except Exception as e:
        rec["errors"].append(f"open: {e}")
        return rec

    try:
        gb, _, W, H = grid_bytes(path)
    except Exception as e:
        rec["errors"].append(f"grid: {e}")
        return rec
    rec["grid_size"] = [W, H]

    # ---------- 階段 1：全圖 5×5 ----------
    try:
        box1, parsed1, cells1 = _ask_cells(gb, key, model, PROMPT.format(g=GRID, letters=LETTERS),
                                           usage, "full", retries, W, H)
    except Fatal as e:
        rec["fatal"] = True
        rec["fatal_reason"] = str(e)
        return rec
    if box1 is None:
        rec["ok"] = False
        rec["errors"].append("s1: 重試後仍無法取得全圖網格結果")
        return rec
    st1 = {"cells": list(cells1), "box": [round(v, 1) for v in box1],
           "area_frac": round(box1[2] * box1[3] / (W * H), 4),
           "ratio": _f(parsed1.get("ratio")), "n_buildings": _i(parsed1.get("n_buildings")),
           "clean": parsed1.get("clean"), "complete": parsed1.get("complete"),
           "is_building": parsed1.get("is_building"), "conf": _f(parsed1.get("conf"))}
    rec["stages"]["full"] = st1
    cands = [box1]

    # ---------- 階段 2：粗框區域放大後再問一次（量化誤差降為 1/5）----------
    if do_zoom and st1["is_building"] is not False:
        need = st1["area_frac"] < ZOOM_TRIGGER_AREA or (st1["conf"] is not None and st1["conf"] < ZOOM_TRIGGER_CONF)
        if need:
            x, y, w, h = box1
            cx, cy = x + w / 2, y + h / 2
            zw, zh = min(W, max(w * 1.7, W * 0.2)), min(H, max(h * 1.7, H * 0.2))
            zx0 = max(0.0, min(cx - zw / 2, W - zw))
            zy0 = max(0.0, min(cy - zh / 2, H - zh))
            try:
                with Image.open(path) as im:
                    im = fit_long(im)
                    s = W / im.width                       # 原圖 → 送出去的圖
                    crop = im.crop((int(zx0 * s), int(zy0 * s), int((zx0 + zw) * s), int((zy0 + zh) * s)))
                    crop = fit_long(crop)
                    cW, cH = crop.size
                    cb = _jpeg(draw_grid(crop))
                zb, pz, cz = _ask_cells(cb, key, model, PROMPT_ZOOM.format(g=GRID, letters=LETTERS),
                                        usage, "zoom", retries, cW, cH)
                if zb:
                    zx, zy, zw2, zh2 = zb
                    fb = (zx0 + zx * zw / cW, zy0 + zy * zh / cH, zw2 * zw / cW, zh2 * zh / cH)
                    rec["stages"]["zoom"] = {
                        "cells": list(cz), "box": [round(v, 1) for v in fb],
                        "crop": [round(zx0, 1), round(zy0, 1), round(zw, 1), round(zh, 1)],
                        "area_frac": round(fb[2] * fb[3] / (W * H), 4),
                        "ratio": _f(pz.get("ratio")), "conf": _f(pz.get("conf"))}
                    cands.append(fb)
                else:
                    rec["errors"].append("s2: 放大階段無結果")
            except Fatal as e:
                rec["fatal"] = True
                rec["fatal_reason"] = str(e)
                return rec
            except Exception as e:
                rec["errors"].append(f"s2: {type(e).__name__}: {str(e)[:90]}")

    # ---------- 階段 3：框內再切一次（處理「框明顯偏鬆」）----------
    ratio = st1["ratio"]
    base = rec["stages"].get("zoom", {}).get("box") or box1
    if do_pass2 and ratio is not None and st1["is_building"] is not False:
        gap = base[2] * base[3] / (W * H) - ratio
        if gap > PASS2_TRIGGER_RATIO_GAP:
            x, y, w, h = base
            pw, ph = max(w * 1.3, W * 0.15), max(h * 1.3, H * 0.15)
            px0 = max(0.0, min(x + w / 2 - pw / 2, W - pw))
            py0 = max(0.0, min(y + h / 2 - ph / 2, H - ph))
            try:
                with Image.open(path) as im:
                    im = fit_long(im)
                    s = W / im.width
                    crop = im.crop((int(px0 * s), int(py0 * s), int((px0 + pw) * s), int((py0 + ph) * s)))
                    crop = fit_long(crop)
                    cW, cH = crop.size
                    cb = _jpeg(draw_grid(crop))
                pb, pp, cc = _ask_cells(cb, key, model, PROMPT_ZOOM.format(g=GRID, letters=LETTERS),
                                        usage, "pass2", retries, cW, cH)
                if pb:
                    bx, by, bw2, bh2 = pb
                    fb = (px0 + bx * pw / cW, py0 + by * ph / cH, bw2 * pw / cW, bh2 * ph / cH)
                    rec["stages"]["pass2"] = {
                        "cells": list(cc), "box": [round(v, 1) for v in fb],
                        "crop": [round(px0, 1), round(py0, 1), round(pw, 1), round(ph, 1)],
                        "area_frac": round(fb[2] * fb[3] / (W * H), 4), "conf": _f(pp.get("conf"))}
                    cands.append(fb)
            except Fatal as e:
                rec["fatal"] = True
                rec["fatal_reason"] = str(e)
                return rec
            except Exception as e:
                rec["errors"].append(f"s3: {type(e).__name__}: {str(e)[:90]}")

    # 取「最大的那個候選」與「最小候選」的交集傾向：用各階段都同意的較緊框
    # 策略：優先採用最精細階段（pass2 > zoom > full）的框，但若它比粗框大就改用粗框（不能放大）
    final = cands[-1]
    if len(cands) > 1 and final[2] * final[3] > cands[0][2] * cands[0][3] * 1.05:
        final = cands[0]
    final = clip_box(final, W, H) or box1

    # ---------- 階段 4：CV 收緊（天空裁切 + 空帶邊緣裁切；只做減法）----------
    bgr = imread_unicode(path)
    if bgr is not None:
        bgr = cv2_resize_to(bgr, W, H)
        refined, diag = refine_box(final, bgr)
        refined = clip_box(refined, W, H)
        rec["trim"] = diag
        rec["area_before_trim"] = round(final[2] * final[3] / (W * H), 4)
        if refined:
            final = refined

    rec["final_box"] = [round(float(v), 2) for v in final]
    rec["final_area_frac"] = round(final[2] * final[3] / (W * H), 4)
    rec["ratio_gap"] = round(rec["final_area_frac"] - (ratio or 0), 3) if ratio is not None else None
    rec["stages_used"] = len(cands)
    rec["ok"] = True
    return rec


def cv2_resize_to(bgr, W: int, H: int):
    import cv2
    if bgr.shape[1] == W and bgr.shape[0] == H:
        return bgr
    return cv2.resize(bgr, (W, H), interpolation=cv2.INTER_AREA)


def render(path: Path, rec: dict, out_dir: Path) -> Path | None:
    """綠=全圖階段、青=放大/細切階段、紅=最終（去天空後）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(path) as im:
            im = fit_long(im)
            W, H = im.size
            d = ImageDraw.Draw(im)
            f = _font(max(13, W // 46))
            for key, color in (("full", (0, 210, 0)), ("zoom", (0, 200, 255)), ("pass2", (255, 200, 0))):
                b = rec.get("stages", {}).get(key, {}).get("box")
                if not b:
                    continue
                x, y, w, h = b
                d.rectangle([x, y, x + w, y + h], outline=color, width=3)
                d.text((x + 4, y + 4), key, fill=color, font=f, stroke_width=2, stroke_fill=(0, 0, 0))
            fb = rec.get("final_box")
            if fb:
                x, y, w, h = fb
                d.rectangle([x, y, x + w, y + h], outline=(255, 40, 40), width=3)
            dst = out_dir / f"{path.parent.name}__{path.stem}.jpg"
            im.save(dst, "JPEG", quality=84)
        return dst
    except Exception as e:
        print(f"  [render warn] {path.name}: {e}")
        return None


def load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict, lock: threading.Lock):
    with lock:
        WORK.mkdir(parents=True, exist_ok=True)
        tmp = CACHE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(CACHE)


def collect(probe: list[str], per_folder: int) -> list[Path]:
    if probe:
        paths: list[Path] = []
        for name in probe:
            d = SRC / name
            if not d.exists():
                raise SystemExit(f"找不到資料夾 {d}")
            fs = sorted(d.glob("*.jpg"))
            random.Random(7).shuffle(fs)
            paths += sorted(fs[:per_folder])
        return paths
    out: list[Path] = []
    for d in sorted(SRC.iterdir()):
        if d.is_dir():
            out += sorted(d.glob("*.jpg"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", nargs="*", default=[])
    ap.add_argument("--per-folder", type=int, default=5)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--no-zoom", action="store_true")
    ap.add_argument("--no-pass2", action="store_true")
    ap.add_argument("--render-dir", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if not args.probe and not args.all:
        raise SystemExit("請指定 --probe <資料夾...> 或 --all")
    key = api_key()
    targets = collect(args.probe, args.per_folder)
    if args.limit:
        targets = targets[:args.limit]
    cache = {} if args.force else load_cache()
    todo = [p for p in targets if str(p) not in cache or not cache[str(p)].get("ok")]
    print(f"[vlm-bbox] {args.model} detail=high reasoning=none workers={args.workers} "
          f"zoom={not args.no_zoom} pass2={not args.no_pass2} | targets={len(targets)} "
          f"待跑={len(todo)} 快取命中={len(targets) - len(todo)}", flush=True)

    usage = Usage()
    lock = threading.Lock()
    done = 0
    t0 = time.time()
    fatal = threading.Event()

    def work(p: Path):
        if fatal.is_set():
            return None
        try:
            return label_one(p, key, args.model, args.retries, usage, not args.no_zoom, not args.no_pass2)
        except Exception as e:
            return {"file": str(p), "folder": p.parent.name, "name": p.name,
                    "errors": [f"worker: {type(e).__name__}: {str(e)[:120]}"], "stages": {}, "ok": False}

    def handle(p: Path, rec):
        nonlocal done
        cache[str(p)] = rec
        done += 1
        st = rec.get("stages", {}).get("full", {})
        print(f"  [{done}/{len(todo)}] {'OK ' if rec.get('ok') else 'FAIL'} {p.parent.name}/{p.name} "
              f"area={st.get('area_frac')} final={rec.get('final_area_frac')} ratio={st.get('ratio')} "
              f"nb={st.get('n_buildings')} clean={st.get('clean')} conf={st.get('conf')} "
              f"stages={rec.get('stages_used')} ({time.time() - t0:.0f}s)", flush=True)
        if done % 10 == 0:
            save_cache(cache, lock)
            usage.save()

    if args.workers <= 1:
        for p in todo:
            rec = work(p)
            if rec is None:
                break
            handle(p, rec)
            if rec.get("fatal"):
                print(f"[fatal] API 拒絕：{rec.get('fatal_reason')}", flush=True)
                fatal.set()
                break
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(work, p): p for p in todo}
            for fut in as_completed(futs):
                p = futs[fut]
                rec = fut.result()
                if rec is None:
                    continue
                handle(p, rec)
                if rec.get("fatal"):
                    fatal.set()

    save_cache(cache, lock)
    usage.save()

    sel = [cache[str(p)] for p in targets if str(p) in cache]
    ok = [r for r in sel if r.get("ok")]
    print(f"\n[vlm-bbox] 完成 {len(sel)}/{len(targets)}，成功 {len(ok)}，失敗 {len(sel) - len(ok)}")
    errs = Counter(e.split(":")[0] for r in sel for e in r.get("errors", []))
    if errs:
        print("[vlm-bbox] 錯誤：" + "、".join(f"{k}×{v}" for k, v in errs.most_common(8)))
    print(f"[vlm-bbox] API：呼叫 {usage.calls} 次（失敗 {usage.failed}）、"
          f"prompt {usage.pt} + completion {usage.ct} = {usage.pt + usage.ct} tokens（推理 {usage.rt}）"
          f" · stages={dict(usage.by_kind)}")
    if ok:
        import statistics
        af = sorted(r.get("final_area_frac") or 0 for r in ok)
        print(f"[vlm-bbox] 最終框佔比：中位 {statistics.median(af):.3f}、"
              f"<0.02 有 {sum(1 for v in af if v < 0.02)}、>0.95 有 {sum(1 for v in af if v > 0.95)}")
    print(f"[out] {CACHE.relative_to(ROOT)}")

    if args.render_dir:
        rd = Path(args.render_dir)
        if not rd.is_absolute():
            rd = ROOT / rd
        n = sum(1 for p in targets if cache.get(str(p), {}).get("ok") and render(p, cache[str(p)], rd))
        print(f"[out] 預覽圖 {n} 張 → {rd}")


if __name__ == "__main__":
    main()
