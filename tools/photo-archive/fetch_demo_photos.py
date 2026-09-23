#!/usr/bin/env python
"""
從 Wikimedia Commons 抓少量「CC 授權」的澳門建築照片，作為測試與示範素材。
會把作者／授權寫進 photos-src/labels.csv 的 credit 欄，網站上必須顯示這些標示。

用法：python tools/photo-archive/fetch_demo_photos.py
"""
from __future__ import annotations
import csv, json, re, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "photos-src" / "demo"
SRC.mkdir(parents=True, exist_ok=True)
API = "https://commons.wikimedia.org/w/api.php"
UA = "macau-3d-atlas/1.0 (educational demo; contact: local build)"
WANT = 1600

TARGETS = [
    ("Ruins of St. Paul Macau facade", "大三巴牌坊"),
    ("A-Ma Temple Macau", "媽閣廟"),
    ("St Lawrence Church Macau", "聖老楞佐堂"),
    ("Taipa Houses Museum", "龍環葡韻"),
    ("Macau Tower", "澳門旅遊塔"),
    ("Senado Square Macau", "議事亭前地"),
]


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def clean(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "").strip()


rows = []
for query, zh in TARGETS:
    try:
        j = api({
            "action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {query}", "gsrnamespace": "6", "gsrlimit": "3",
            "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": str(WANT),
        })
    except Exception as e:
        print(f"  ✗ {zh} 查詢失敗：{e}")
        continue
    pages = j.get("query", {}).get("pages", [])
    if not pages:
        print(f"  ✗ {zh} 找不到圖片")
        continue
    page = pages[0]
    info = (page.get("imageinfo") or [{}])[0]
    url = info.get("thumburl") or info.get("url")
    meta = info.get("extmetadata", {})
    artist = clean(meta.get("Artist", {}).get("value", "")) or "Wikimedia Commons"
    lic = meta.get("LicenseShortName", {}).get("value", "見來源頁")
    src_page = info.get("descriptionurl", "")
    if not url:
        continue
    name = f"{zh}.jpg"
    out = SRC / name
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, out.open("wb") as fh:
            fh.write(r.read())
    except Exception as e:
        print(f"  ✗ {zh} 下載失敗：{e}")
        continue
    credit = f"{artist} / {lic} / Wikimedia Commons"
    rows.append({"檔名": name, "類別id": "", "解讀": "", "lat": "", "lon": "", "credit": credit, "來源頁": src_page})
    print(f"  ✓ {zh} ← {page.get('title')}  ({lic})")

# 寫入/合併 labels.csv（保留既有內容）
lp = ROOT / "photos-src" / "labels.csv"
existing = {}
if lp.exists():
    with lp.open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            existing[(row.get("檔名") or "").strip()] = row
for r in rows:
    existing[r["檔名"]] = {**existing.get(r["檔名"], {}), **r}
cols = ["檔名", "類別id", "解讀", "lat", "lon", "credit", "來源頁"]
with lp.open("w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for k in sorted(existing):
        w.writerow({c: existing[k].get(c, "") for c in cols})
print(f"\n已下載 {len(rows)} 張到 {SRC}")
print(f"授權資訊已寫入 {lp}（網站務必顯示 credit）")
