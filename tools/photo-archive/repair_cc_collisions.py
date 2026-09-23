"""修復 Commons 抓圖的檔名衝突：早期版本把檔名截斷到 70 字，導致不同檔案互相覆蓋。

作法是逐一用 Commons API 依「原始標題」重新取得該檔案的 URL，另存為帶雜湊的新檔名，
再更新 ATTRIBUTION.csv 的路徑，讓每一筆紀錄都對應到真正存在、且不重複的檔案。

用法：python tools/photo-archive/repair_cc_collisions.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ATTR = ROOT / "photos-src" / "cc" / "ATTRIBUTION.csv"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "macaumemory-isef/1.0 (student science project)"}


def imageinfo(title: str):
    url = API + "?" + urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1280, "format": "json", "formatversion": "2"})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = json.loads(r.read())
    pages = data.get("query", {}).get("pages") or []
    if not pages:
        return None
    ii = (pages[0].get("imageinfo") or [None])[0]
    return ii


def main():
    rows = list(csv.DictReader(ATTR.open(encoding="utf-8-sig")))
    counts = Counter(r["file"] for r in rows)
    dup_files = {f for f, n in counts.items() if n > 1}
    if not dup_files:
        print("[repair] 沒有衝突，無需處理")
        return

    seen_first = set()
    repaired = 0
    for r in rows:
        if r["file"] not in dup_files:
            continue
        if r["file"] not in seen_first:
            seen_first.add(r["file"])          # 第一個保留原檔
            continue
        title = r["commons_title"]
        try:
            ii = imageinfo(title)
            if not ii or not ii.get("thumburl"):
                print(f"  ✗ 取不到 {title[:50]}")
                continue
            safe = re.sub(r"[^\w.\-]+", "_", title.replace("File:", ""))[:60]
            safe += "_" + hashlib.md5(title.encode("utf-8")).hexdigest()[:6]
            ext = ".png" if ii.get("mime") == "image/png" else ".jpg"
            out = (ROOT / Path(r["file"])).parent / (safe + ext)
            req = urllib.request.Request(ii["thumburl"], headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                out.write_bytes(resp.read())
            r["file"] = str(out.relative_to(ROOT)).replace("\\", "/")
            r["width"], r["height"] = ii.get("width"), ii.get("height")
            r["bytes"] = out.stat().st_size
            repaired += 1
            print(f"  ✓ 救回 {title[:60]} → {out.name}")
            time.sleep(0.5)
        except Exception as e:
            print(f"  ✗ {title[:50]}：{type(e).__name__} {str(e)[:60]}")

    with ATTR.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)

    files = sorted(p for p in (ROOT / "photos-src" / "cc").rglob("*") if p.suffix.lower() in (".jpg", ".png"))
    print(f"\n[repair] 救回 {repaired} 張；ATTRIBUTION {len(rows)} 筆、實體檔案 {len(files)} 個")


if __name__ == "__main__":
    main()
