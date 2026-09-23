"""從 Wikimedia Commons 抓澳門建築實拍照片（含授權標註）。

為什麼用 Commons：它是唯一同時滿足「真實照片」+「明確授權」+「有拍攝日期/作者」的來源，
而這三件事對 ISEF 的資料誠信都必要。每張圖都會記錄作者、授權、拍攝日期與來源頁。

用法：
    python tools/photo-archive/fetch_commons.py                  # 抓全部清單
    python tools/photo-archive/fetch_commons.py --only=a-ma-temple,red-market
    python tools/photo-archive/fetch_commons.py --per=6 --width=1280

產出：
    photos-src/cc/<building_id>/*.jpg        （實拍照片，分建築）
    photos-src/cc/ATTRIBUTION.csv            （每張圖的作者／授權／來源／日期）
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "photos-src" / "cc"
ATTR = DEST / "ATTRIBUTION.csv"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "macaumemory-isef/1.0 (student science project; educational use)"}

# 建築清單：(building_id, 中文名, taxonomy 類別, 搜尋關鍵字)
BUILDINGS = [
    ("ruins-st-paul",      "大三巴牌坊",       "monument",         ["Ruins of Saint Paul Macau", "大三巴牌坊"]),
    ("a-ma-temple",        "媽閣廟",           "temple",           ["A-Ma Temple Macau", "媽閣廟"]),
    ("kun-iam-temple",     "觀音堂",           "temple",           ["Kun Iam Temple Macau", "觀音堂 澳門"]),
    ("st-dominic-church",  "玫瑰堂",           "church",           ["St. Dominic's Church Macau", "玫瑰堂 澳門"]),
    ("st-lawrence-church", "聖老楞佐堂",       "church",           ["St. Lawrence's Church Macau", "聖老楞佐堂"]),
    ("cathedral-macau",    "主教座堂",         "church",           ["Cathedral of the Nativity of Our Lady Macau", "澳門主教座堂"]),
    ("mandarins-house",    "鄭家大屋",         "portuguese",       ["Mandarin's House Macau", "鄭家大屋"]),
    ("taipa-houses",       "龍環葡韻",         "portuguese",       ["Taipa Houses Museum", "龍環葡韻"]),
    ("moorish-barracks",   "港務局大樓",       "portuguese",       ["Moorish Barracks Macau", "港務局大樓"]),
    ("leal-senado",        "市政署大樓",       "civic",            ["Leal Senado Building Macau", "市政署大樓"]),
    ("rua-da-felicidade",  "福隆新街",         "tong_lau",         ["Rua da Felicidade Macau", "福隆新街"]),
    ("red-market",         "紅街市",           "market",           ["Red Market Macau", "紅街市"]),
    ("coloane-village",    "路環市區",         "village",          ["Coloane Village Macau", "路環 村"]),
    ("lai-chi-vun",        "荔枝碗船廠",       "industrial",       ["Lai Chi Vun shipyard", "荔枝碗船廠"]),
    ("macau-tower",        "澳門旅遊塔",       "civic",            ["Macau Tower", "澳門旅遊塔"]),
    ("grand-lisboa",       "葡京酒店",         "casino_hotel",     ["Grand Lisboa Macau", "葡京"]),
    ("the-venetian",       "威尼斯人",         "casino_hotel",     ["The Venetian Macao", "威尼斯人 澳門"]),
    ("senado-square",      "議事亭前地",       "street",           ["Senado Square Macau", "議事亭前地"]),
    ("st-paul-street",     "大三巴街景",       "street",           ["Rua de São Paulo Macau", "大三巴街"]),
    ("guiuan-village",     "氹仔舊城區",       "tong_lau",         ["Taipa Old Village Macau", "氹仔舊城區"]),
]

BAD_WORDS = re.compile(r"(map|plan|logo|diagram|coat of arms|flag|chart|graph|svg|icon|banknote|stamp|"
                       r"panorama of|interior of the museum|floor plan)", re.I)


def api(params: dict, retries=3):
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == retries - 1:
                print(f"    [warn] API 失敗：{type(e).__name__} {e}")
                return {}
            time.sleep(1.5 * (i + 1))
    return {}


def search_images(query: str, limit: int):
    """搜尋 File 命名空間，回傳 imageinfo 清單。"""
    data = api({
        "action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": 6,
        "gsrlimit": limit, "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1280,
    })
    out = []
    for page in (data.get("query", {}).get("pages") or []):
        ii = (page.get("imageinfo") or [{}])[0]
        if not ii:
            continue
        title = page.get("title", "")
        if BAD_WORDS.search(title):
            continue
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 800:
            continue
        out.append(dict(title=title, url=ii.get("thumburl") or ii.get("url"),
                        mime=ii.get("mime"), width=ii.get("width"), height=ii.get("height"),
                        meta=ii.get("extmetadata", {}), page=page.get("descriptionurl") or
                        "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))))
    return out


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", str(s or ""))
    return html.unescape(s).replace("\n", " ").strip()


def download(url: str, path: Path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    path.write_bytes(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=5, help="每棟最多抓幾張")
    ap.add_argument("--only", default=None, help="只抓指定 building_id（逗號分隔）")
    ap.add_argument("--sleep", type=float, default=0.4)
    args = ap.parse_args()

    wanted = set(args.only.split(",")) if args.only else None
    DEST.mkdir(parents=True, exist_ok=True)
    rows, seen_titles = [], set()

    for bid, zh, cls, queries in BUILDINGS:
        if wanted and bid not in wanted:
            continue
        folder = DEST / bid
        folder.mkdir(parents=True, exist_ok=True)
        got, used = 0, []
        for q in queries:
            if got >= args.per:
                break
            for item in search_images(q, args.per * 3):
                if got >= args.per:
                    break
                if item["title"] in seen_titles:
                    continue
                seen_titles.add(item["title"])
                em = item["meta"]
                # 檔名加上標題雜湊，避免長標題被截斷後互相覆蓋（曾因此丟失 4 張圖）
                safe = re.sub(r"[^\w.\-]+", "_", item["title"].replace("File:", ""))[:60]
                safe += "_" + hashlib.md5(item["title"].encode("utf-8")).hexdigest()[:6]
                if not safe.lower().endswith((".jpg", ".jpeg", ".png")):
                    safe += ".jpg"
                out = folder / safe
                try:
                    n = download(item["url"], out)
                except Exception as e:
                    print(f"    [warn] 下載失敗 {item['title'][:40]}: {str(e)[:50]}")
                    continue
                got += 1
                used.append(item["title"])
                rows.append(dict(
                    building_id=bid, building_zh=zh, class_id=cls,
                    file=str(out.relative_to(ROOT)).replace("\\", "/"),
                    commons_title=item["title"],
                    author=strip_html(em.get("Artist", {}).get("value", "")),
                    license=strip_html(em.get("LicenseShortName", {}).get("value", "")),
                    date=strip_html(em.get("DateTimeOriginal", {}).get("value", ""))[:19],
                    description=strip_html(em.get("ImageDescription", {}).get("value", ""))[:120],
                    source_page=item["page"], width=item["width"], height=item["height"],
                    bytes=n,
                ))
                time.sleep(args.sleep)
            time.sleep(args.sleep)
        print(f"  {bid:22} {zh:8} {cls:16} 抓到 {got} 張")

    # 合併寫入（保留既有紀錄，重跑不會重複）
    old = []
    if ATTR.exists():
        with ATTR.open(encoding="utf-8-sig") as f:
            old = [r for r in csv.DictReader(f) if r["file"] not in {x["file"] for x in rows}]
    fields = list(rows[0].keys()) if rows else (list(old[0].keys()) if old else [])
    with ATTR.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in old + rows:
            w.writerow(r)

    print(f"\n[cc] 本次下載 {len(rows)} 張，ATTRIBUTION 共 {len(old) + len(rows)} 筆 → {ATTR.relative_to(ROOT)}")
    lic = {}
    for r in rows:
        lic[r["license"]] = lic.get(r["license"], 0) + 1
    print("[cc] 授權分布：", json.dumps(lic, ensure_ascii=False))


if __name__ == "__main__":
    main()
