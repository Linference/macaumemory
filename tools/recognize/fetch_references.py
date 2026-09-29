"""為澳門建築辨識系統抓「每棟建築的參考照片」（擴充參考照片資料庫）。

## 為什麼要繞道兩個代理

這台機器**完全無法直連 Wikimedia**（實測 commons/upload/wikipedia/wikidata/meta/maps 全部
SSL handshake timeout 或 connection reset；`_net_patient.py` 連續 8 輪 40 次全部失敗）。
但兩段可用的中繼把路走通了：

    文字：Commons API  ← api.allorigins.win/raw?url=…    （回傳原始 JSON）
    圖片：upload 圖檔  ← wsrv.nl/?url=…                 （公共圖床 CDN，直接吃 upload.wikimedia.org 網址）

於是「抓圖」與「抓授權中繼資料」都能走同一批原始檔，授權紀錄與既有 `photos-src/cc` 同一套標準。

## 流程

    1. Commons 策展分類（Category:*）為主，全文檢索（gsrsearch）為輔
    2. 授權關卡：只收 CC / 公有領域；Licensing 欄位含 nc / nd / fair use / non-free 一律丟掉
    3. SHA1 去重（同一張圖不同標題只收一次）；已存在的 SHA1 直接跳過
    4. 依原圖尺寸選一個夠用的縮圖寬（預設最長邊 1400），經 wsrv 下載，存成 JPEG
    5. 每張圖的出處（作者／授權／來源頁／分類／SHA1）寫進
       photos-src/cc/ATTRIBUTION-references.csv 與 tools/recognize/refs-sources.json

## 用法

    python tools/recognize/fetch_references.py --dry-run                  # 只查詢、不下載
    python tools/recognize/fetch_references.py --only macau-science-center --per-building 6
    python tools/recognize/fetch_references.py --per-building 6           # 全部目標
    python tools/recognize/fetch_references.py --sleep 2.0                # 代理被限流時放慢
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html as H
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CC_DIR = ROOT / "photos-src" / "cc"
ATTR = CC_DIR / "ATTRIBUTION-references.csv"
STATE = Path(__file__).resolve().parent / "refs-sources.json"

UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project; educational)"}
API = "https://commons.wikimedia.org/w/api.php"
RELAYS = [
    "https://api.allorigins.win/raw?url=",
    "https://api.allorigins.win/get?url=",      # 包在 {"contents": "..."} 裡，備援
]
WSRV = "https://wsrv.nl/?"

# --------------------------------------------------------------------------- 抓取目標
# cats   : Commons 策展分類（人工維護，精度高）——主要來源
# catdeep: 是否遞迴子分類（只走「還是澳門」的子分類）
# search : Commons 全文檢索關鍵字——補足分類沒收錄的
TARGETS: dict[str, dict] = {
    # ===== 既有建築補圖（目前只有 1 張 → 留一法必然 0%）=====
    "macau-science-center": {
        "cats": ["Category:Macau Science Center"], "catdeep": 2,
        "search": ["Macao Science Center building", "澳門科學館"],
    },
    "parisian": {
        "cats": ["Category:The Parisian Macao"], "catdeep": 2,
        "search": ["Parisian Macao Eiffel Tower replica", "澳門巴黎人"],
    },
    "st-lawrence-church": {
        "cats": ["Category:St. Lawrence's Church (Macau)"], "catdeep": 2,
        # ⚠ 不要用「聖老楞佐堂」全文檢索：Commons 上那組同名照片其實是羅馬的
        #   San Lorenzo in Panisperna（實測抓回 4 張義大利教堂）。只用英文與澳門地名。
        "search": ["St Lawrence Church Macau facade", "Igreja de São Lourenço Macau",
                   "Macau São Lourenço church"],
    },
    "guiuan-village": {
        "cats": ["Category:Taipa Village", "Category:Rua do Cunha", "Category:Taipa Old Village"],
        "catdeep": 2, "search": ["Taipa village Macau street", "氹仔舊城區", "Taipa old town Macau"],
    },
    # ===== 既有建築補圖（參考數偏少／表現偏弱）=====
    "red-market": {
        "cats": ["Category:Red Market (Macau)", "Category:Almirante Lacerda Municipal Market"],
        "catdeep": 1, "search": ["Red Market Macau building", "紅街市"],
    },
    "guiuan-village": {
        "cats": ["Category:Taipa Village", "Category:Rua do Cunha", "Category:Taipa Old Village"],
        "catdeep": 2, "search": ["Taipa village Macau street", "氹仔舊城區"],
    },
    "coloane-village": {
        "cats": ["Category:Coloane Village"], "catdeep": 2,
        "search": ["Coloane village Macau square", "Coloane Macau street"],
    },
    "rua-da-felicidade": {
        "cats": ["Category:Rua da Felicidade"], "catdeep": 1,
        "search": ["Rua da Felicidade Macau shophouse", "Rua da Felicidade Macau street"],
    },
    "lai-chi-vun": {
        "cats": ["Category:Lai Chi Vun Shipyards"], "catdeep": 1,
        "search": ["Lai Chi Vun shipyard Macau"],
    },
    "moorish-barracks": {
        "cats": ["Category:Moorish Barracks"], "catdeep": 1,
        "search": ["Moorish Barracks Macau"],
    },
    "cathedral-macau": {
        "cats": ["Category:Cathedral of Macau"], "catdeep": 1,
        "search": ["Cathedral of the Nativity of Our Lady Macau facade"],
    },
    "st-dominic-church": {
        "cats": ["Category:St. Dominic's Church (Macau)"], "catdeep": 1,
        "search": ["St Dominic Church Macau facade"],
    },
    "a-ma-temple": {
        "cats": ["Category:A-Ma Temple"], "catdeep": 2,
        "search": ["A-Ma Temple Macau entrance gate"],
    },
    "kun-iam-temple": {
        "cats": ["Category:Kun Iam Temple"], "catdeep": 2,
        "search": ["Kun Iam Temple Macau"],
    },
    "mandarins-house": {
        "cats": ["Category:Mandarin's House"], "catdeep": 1,
        "search": ["Mandarin's House Macau courtyard facade"],
    },
    "taipa-houses": {
        "cats": ["Category:Taipa Houses Museum"], "catdeep": 1,
        "search": ["Taipa Houses Museum Macau"],
    },
    "leal-senado": {
        "cats": ["Category:Leal Senado"], "catdeep": 1,
        "search": ["Leal Senado Macau facade"],
    },
    "senado-square": {
        "cats": ["Category:Senado Square"], "catdeep": 1,
        "search": ["Senado Square Macau"],
    },
    "ruins-st-paul": {
        "cats": ["Category:Ruins of Saint Paul"], "catdeep": 2,
        "search": ["Ruins of Saint Paul Macau facade"],
    },
    "macau-tower": {
        "cats": ["Category:Macau Tower"], "catdeep": 1,
        "search": ["Macau Tower exterior"],
    },
    "grand-lisboa": {
        "cats": ["Category:Grand Lisboa", "Category:Hotel Lisboa"], "catdeep": 2,
        "search": ["Grand Lisboa Macau exterior"],
    },
    "the-venetian": {
        "cats": ["Category:The Venetian Macao"], "catdeep": 2,
        "search": ["Venetian Macao exterior facade"],
    },
    # ===== 新增：澳門歷史城區與被評定文物建築 =====
    "st-joseph-seminary": {
        "cats": ["Category:Saint Joseph's Seminary and Church"], "catdeep": 2,
        "search": ["St Joseph Seminary Church Macau", "聖若瑟修院"],
    },
    "sam-kai-vui-kun": {
        "cats": ["Category:Sam Kai Vui Kun"], "catdeep": 1,
        "search": ["Sam Kai Vui Kun temple Macau", "三街會館"],
    },
    "lin-fung-temple": {
        "cats": ["Category:Lin Fung Temple"], "catdeep": 1,
        "search": ["Lin Fung Temple Macau", "蓮峰廟"],
    },
    "st-anthony-church": {
        "cats": ["Category:St. Anthony's Church (Macau)"], "catdeep": 1,
        "search": ["St Anthony Church Macau", "聖安多尼堂"],
    },
    "st-augustine-church": {
        "cats": ["Category:St. Augustine's Church (Macau)"], "catdeep": 1,
        "search": ["St Augustine Church Macau", "聖奧斯定堂"],
    },
    "st-lazarus-church": {
        "cats": ["Category:St. Lazarus' Church (Macau)", "Category:St. Lazarus Parish"],
        "catdeep": 1, "search": ["St Lazarus Church Macau", "望德堂"],
    },
    "dom-pedro-v-theatre": {
        "cats": ["Category:Dom Pedro V Theatre"], "catdeep": 1,
        "search": ["Dom Pedro V Theatre Macau", "崗頂劇院"],
    },
    "santa-sancha": {
        "cats": ["Category:Santa Sancha Centre"], "catdeep": 1,
        "search": ["Santa Sancha Palace Macau", "竹仔室"],
    },
    "guia-fortress": {
        "cats": ["Category:Guia Fortress"], "catdeep": 2,
        "search": ["Guia Fortress Macau chapel lighthouse", "東望洋炮台"],
    },
    "na-tcha-temple": {
        "cats": ["Category:Na Tcha Temple"], "catdeep": 1,
        "search": ["Na Tcha Temple Macau", "大三巴哪吒廟"],
    },
}

# 只用於抓圖；實際入庫的建築名冊在 build_embeddings.py 的 BUILDINGS
NEW_BUILDING_IDS = [
    "st-joseph-seminary", "sam-kai-vui-kun", "lin-fung-temple", "st-anthony-church",
    "st-augustine-church", "st-lazarus-church", "dom-pedro-v-theatre", "santa-sancha",
    "guia-fortress", "na-tcha-temple",
]

BAD_TITLE = re.compile(
    r"(map|plan|logo|diagram|coat of arms|flag|chart|graph|svg|icon|banknote|stamp|"
    r"floor ?plan|3d model|panorama of the museum|\.pdf|\.tif|\.djvu|\.webm|\.ogv|"
    r"interior|inside|indoor|altar|ceiling|stained glass|plaque|sign|poster|menu|"
    r"statue|sculpture|monument to|bust|relief|painting|drawing|engraving|postcard|"
    r"blueprint|sketch|exhibit|display|board|seal|crest|emblem|"
    # 中文檔名常見的地雷
    r"室內|內部|內景|特寫|細節|告示|說明牌|海報|模型|平面圖|地圖|郵票|繪畫|畫作|版畫)",
    re.I)

# 授權關卡：只接受這些（比對 Licensing 短名的開頭）
OK_LICENSE = re.compile(
    r"^(cc0|cc[- ]by([- ]sa)?([- ]\d(\.\d)?)?|public domain|pd[- ]|no restrictions|"
    r"gfdl|cc[- ]by[- ]sa[- ]\d\.\d)", re.I)
BAD_LICENSE = re.compile(r"(\bnc\b|non[- ]?commercial|\bnd\b|no[- ]?deriv|fair use|non[- ]?free|"
                         r"all rights reserved|copyright|©)", re.I)


# --------------------------------------------------------------------------- 代理呼叫
class RelayBusy(RuntimeError):
    """文字代理回 429（額度用完）——呼叫者應該退避重試，而不是當成「這棟沒圖」。"""


def relay(params: dict, retries: int = 6, timeout: int = 60, sleep: float = 1.0) -> dict:
    """經 allorigins 呼叫 Commons API。回傳 {} 代表這一輪拿不到資料。

    實測這個文字代理連續呼叫約 8 次後開始回 429，之後要等冷卻。因此：
      · 輪替兩個端點（/raw 與 /get）
      · 遇到 429 用指數退避（1、2、4、8、16 秒）
      · 完全失敗時丟 RelayBusy，讓上層知道「是代理忙，不是這棟沒圖」
    """
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    last = ""
    saw_429 = False
    for i in range(retries):
        relay_base = RELAYS[i % len(RELAYS)]
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(relay_base + urllib.parse.quote(url, safe=""), headers=UA),
                    timeout=timeout) as r:
                raw = r.read().decode("utf-8", "replace")
            if relay_base.endswith("get?url="):
                raw = json.loads(raw).get("contents", "")
            data = json.loads(raw)
            if isinstance(data, dict) and (data.get("query") or data.get("batchcomplete")):
                return data
            # 合法的空結果（例如分類不存在）也算成功，避免無限重試
            if isinstance(data, dict) and "error" not in data:
                return data
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 429:
                saw_429 = True
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:60]}"
        time.sleep(sleep * (2 ** min(i, 4)))          # 1、2、4、8、16 秒
    print(f"      [warn] API 失敗（{last}）", flush=True)
    if saw_429:
        raise RelayBusy(last)
    return {}


def img_info(pages: list[dict]) -> list[dict]:
    """把 API 的 pages 轉成乾淨的清單（含授權關卡）。"""
    out = []
    for p in pages or []:
        ii = (p.get("imageinfo") or [{}])[0]
        if not ii or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        title = p.get("title", "")
        if BAD_TITLE.search(title):
            continue
        w, h = ii.get("width") or 0, ii.get("height") or 0
        if min(w, h) < 700:                       # 太小的圖對 336 編碼器沒有意義
            continue
        em = ii.get("extmetadata", {})

        def g(k: str) -> str:
            return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", str(em.get(k, {}).get("value", ""))))).strip()

        lic = g("LicenseShortName") or g("License")
        if not lic:
            continue
        if BAD_LICENSE.search(lic) and not OK_LICENSE.match(lic):
            continue
        if not OK_LICENSE.match(lic):
            continue
        out.append({
            "title": title, "url": ii.get("url"), "width": w, "height": h,
            "mime": ii.get("mime"), "sha1": ii.get("sha1") or "",
            "author": g("Artist")[:120], "license": lic,
            "license_url": g("LicenseUrl")[:200],
            "date": g("DateTimeOriginal")[:24],
            "desc": g("ImageDescription")[:200],
            "credit": g("Credit")[:120],
            "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
        })
    return out


def list_category(cat: str, limit: int = 200, sleep: float = 1.0) -> list[dict]:
    d = cached_relay({"action": "query", "generator": "categorymembers", "gcmtitle": cat,
                      "gcmtype": "file", "gcmlimit": str(limit), "prop": "imageinfo",
                      "iiprop": "url|extmetadata|size|mime|sha1"}, sleep)
    return img_info((d.get("query") or {}).get("pages") or [])


def list_subcats(cat: str, limit: int = 60, sleep: float = 1.0) -> list[str]:
    d = cached_relay({"action": "query", "generator": "categorymembers", "gcmtitle": cat,
                      "gcmtype": "subcat", "gcmlimit": str(limit)}, sleep)
    return [p.get("title", "") for p in ((d.get("query") or {}).get("pages") or [])]


def list_search(query: str, limit: int = 40, offset: int = 0, sleep: float = 1.0) -> list[dict]:
    d = cached_relay({"action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": "6",
                      "gsrlimit": str(limit), "gsroffset": str(offset), "prop": "imageinfo",
                      "iiprop": "url|extmetadata|size|mime|sha1"}, sleep)
    return img_info((d.get("query") or {}).get("pages") or [])


MACAU = re.compile(r"Macau|Macao|Taipa|Coloane|Cotai|澳門|氹仔|路環|聖|廟|堂|修院|會館", re.I)


def gather(bid: str, spec: dict, sleep: float) -> list[dict]:
    """收集一棟建築的候選圖（分類優先、子分類遞迴、再全文檢索）。"""
    got: list[dict] = []
    seen: set[str] = set()

    def add(items: list[dict], tag: str):
        for it in items:
            key = it["sha1"] or it["title"]
            if key in seen:
                continue
            seen.add(key)
            it["from"] = tag
            got.append(it)

    for cat in spec.get("cats", []):
        add(list_category(cat, sleep=sleep), cat)
        time.sleep(sleep)
        if spec.get("catdeep", 0) >= 1:
            for sub in list_subcats(cat, sleep=sleep):
                if not MACAU.search(sub):
                    continue
                add(list_category(sub, sleep=sleep), sub)
                time.sleep(sleep)
                if spec.get("catdeep", 0) >= 2:
                    for sub2 in list_subcats(sub, sleep=sleep):
                        if not MACAU.search(sub2):
                            continue
                        add(list_category(sub2, sleep=sleep), sub2)
                        time.sleep(sleep)
    for q in spec.get("search", []):
        add(list_search(q, 40, 0, sleep=sleep), f"search:{q}")
        time.sleep(sleep)
    return got


# --------------------------------------------------------------------------- 下載
def filepath_url(item: dict, width: int) -> str:
    """Commons 的 Special:FilePath —— 由 MediaWiki 自己解析檔名並 302 到正確的圖檔網址。

    為什麼不用 API 回傳的 `url` 欄位：實測 `upload.wikimedia.org/wikipedia/commons/6/6a/...`
    這種「原始檔網址」交給 wsrv 一律回 404（可能是 wsrv 上游取了不同區域的節點），
    而 `Special:FilePath/<檔名>?width=N` 全部成功。檔名不必猜 hash，交給 MediaWiki 解析。
    """
    name = urllib.parse.unquote(item["title"].replace("File:", "")).replace(" ", "_")
    q = {"width": str(width)}
    return ("https://commons.wikimedia.org/wiki/Special:FilePath/"
            + urllib.parse.quote(name, safe="") + "?" + urllib.parse.urlencode(q))


def download(item: dict, dest: Path, sleep: float, retries: int = 3, max_edge: int = 1920) -> tuple[bool, str]:
    """經 wsrv 抓 Commons 圖（走 Special:FilePath，讓 MediaWiki 產生縮圖）。成功回 True。"""
    target = filepath_url(item, max_edge)
    url = WSRV + urllib.parse.urlencode({"url": target, "output": "jpg", "q": "92"})
    last = ""
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                data = r.read()
            if len(data) < 12000:
                raise ValueError(f"檔案過小 {len(data)}B")
            img = Image.open(io.BytesIO(data))
            img.load()
            if min(img.size) < 320:
                raise ValueError(f"尺寸過小 {img.size}")
            img.convert("RGB").save(dest, "JPEG", quality=92, optimize=True)
            return True, f"{len(data)}B {img.size[0]}x{img.size[1]}"
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:60]}"
            time.sleep(sleep * (i + 1))
    return False, last


def safe_name(title: str, limit: int = 52) -> str:
    base = title.replace("File:", "").rsplit(".", 1)[0]
    base = re.sub(r"[^\w\u4e00-\u9fff.\-]+", "_", base).strip("_")
    return base[:limit] + "_" + hashlib.md5(title.encode()).hexdigest()[:6] + ".jpg"


# --------------------------------------------------------------------------- API 快取
CACHE_DIR = Path(__file__).resolve().parent / ".cache-refs"


def cached_relay(params: dict, sleep: float) -> dict:
    """把 API 回應存到磁碟（每個查詢一個檔），避免代理額度用完後整個流程卡死。

    快取讓「額度用完 → 等冷卻 → 續跑」變得有意義：重跑時所有查過的查詢都直接命中。
    """
    key = hashlib.sha1(json.dumps(params, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
    f = CACHE_DIR / f"{key}.json"
    if f.is_file():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    data = relay(params, sleep=sleep)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


# --------------------------------------------------------------------------- 主流程
def load_state() -> dict:
    if STATE.is_file():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except Exception:
            return {"files": {}}
    return {"files": {}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="逗號分隔的建築 id（預設全部）")
    ap.add_argument("--per-building", type=int, default=6, help="每棟最多下載幾張（含既有）")
    ap.add_argument("--max-edge", type=int, default=1920, help="下載的長邊上限（Commons 縮圖寬）")
    ap.add_argument("--sleep", type=float, default=1.2, help="每次代理呼叫之間的間隔")
    ap.add_argument("--cooldown", type=float, default=75, help="文字代理回 429 時的冷卻秒數")
    ap.add_argument("--dry-run", action="store_true", help="只查詢候選，不下載")
    ap.add_argument("--include-existing", action="store_true",
                    help="連已經有 >=3 張的既有建築也補（預設只補不足的與新增的）")
    args = ap.parse_args()

    wanted = set(args.only.split(",")) if args.only else set(TARGETS)
    state = load_state()

    # 已有的 SHA1（避免抓到同一張圖的不同命名）
    have_sha: set[str] = set(state.get("sha1", []))
    print(f"[0] 既有已記錄 SHA1 {len(have_sha)} 筆")

    total_ok = total_try = 0
    summary: dict[str, dict] = {}
    for bid in sorted(wanted):
        spec = TARGETS.get(bid)
        if not spec or not (spec.get("cats") or spec.get("search")):
            continue
        d = CC_DIR / bid
        have = len([f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")]) if d.is_dir() else 0
        if have >= args.per_building and not args.include_existing:
            print(f"[skip] {bid:24s} 已有 {have} 張（>= {args.per_building}）")
            continue
        print(f"\n[{bid}] 現有 {have} 張，目標 {args.per_building}", flush=True)
        for attempt in (1, 2):
            try:
                cands = gather(bid, spec, args.sleep)
                break
            except RelayBusy as e:
                if attempt == 2:
                    print(f"      [skip] 文字代理忙碌（{e}），這棟跳過；稍後重跑會用快取接續", flush=True)
                    cands = []
                    break
                print(f"      [busy] 文字代理額度用完（{e}），冷卻 {args.cooldown}s 後重試…", flush=True)
                time.sleep(args.cooldown)
        print(f"      候選 {len(cands)} 張（授權與尺寸關卡後）", flush=True)
        if args.dry_run:
            for c in cands[:12]:
                print(f"        · {c['title'][:58]:58s} {c['width']}x{c['height']} {c['license'][:16]:16s} {c['from'][:26]}")
            summary[bid] = {"candidates": len(cands), "added": 0}
            continue

        d.mkdir(parents=True, exist_ok=True)
        added = 0
        for c in cands:
            if have + added >= args.per_building:
                break
            key = c["sha1"] or c["title"]
            if key in have_sha:
                continue
            dest = d / safe_name(c["title"])
            total_try += 1
            ok, detail = download(c, dest, args.sleep, max_edge=args.max_edge)
            if not ok:
                print(f"      [x] {c['title'][:50]:50s} {detail}")
                continue
            have_sha.add(key)
            added += 1
            total_ok += 1
            st = state.setdefault("files", {}).setdefault(f"{bid}/{dest.name}", {})
            st.update({k: c[k] for k in ("title", "url", "page", "author", "license", "license_url",
                                         "date", "width", "height", "sha1", "from")})
            st["building"] = bid
            st["bytes"] = dest.stat().st_size
            print(f"      [+] {dest.name[:56]:56s} {c['license'][:14]:14s} {detail}")
            time.sleep(args.sleep)
        state["sha1"] = sorted(have_sha)
        state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        summary[bid] = {"had": have, "candidates": len(cands), "added": added}
        print(f"      → {bid}：{have} + {added} = {have + added} 張")

    print(f"\n[完成] 嘗試 {total_try} 張、成功 {total_ok} 張")
    print(json.dumps(summary, ensure_ascii=False, indent=1))

    # ------------------------------------------------------------- 出處 CSV
    files = state.get("files", {})
    if files:
        rows = []
        for key in sorted(files):
            r = files[key]
            rows.append({
                "building_id": r.get("building", key.split("/")[0]),
                "file": "photos-src/cc/" + key,
                "commons_title": r.get("title", ""),
                "author": r.get("author", ""),
                "license": r.get("license", ""),
                "license_url": r.get("license_url", ""),
                "date": r.get("date", ""),
                "source_page": r.get("page", ""),
                "original_url": r.get("url", ""),
                "original_width": r.get("width", ""),
                "original_height": r.get("height", ""),
                "sha1": r.get("sha1", ""),
                "discovered_via": r.get("from", ""),
                "source": "wikimedia_commons",
                "note": "經 wsrv.nl 圖床代理取得（本機無法直連 Wikimedia）",
            })
        fields = list(rows[0])
        with ATTR.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        print(f"→ {ATTR}（{len(rows)} 筆）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
