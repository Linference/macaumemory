"""試打 data.gov.mo 的官方 API（api.data.gov.mo）與澳門政府 GIS 服務，並查其開放資料條款。

用法：python tools/recognize/_datagov_api2.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*"}
OUT = Path(__file__).resolve().parent / "out"


def get(url: str, timeout: int = 25, data: bytes | None = None, ctype: str | None = None):
    t = time.time()
    h = dict(UA)
    if ctype:
        h["Content-Type"] = ctype
    try:
        req = urllib.request.Request(url, headers=h, data=data)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), round(time.time() - t, 1)
    except urllib.error.HTTPError as e:
        try:
            b = e.read()
        except Exception:
            b = b""
        return e.code, b, round(time.time() - t, 1)
    except Exception as e:
        return 0, str(e).encode(), round(time.time() - t, 1)


def show(label: str, url: str, timeout: int = 20, n: int = 320, data=None, ctype=None):
    st, raw, secs = get(url, timeout, data, ctype)
    body = raw.decode("utf-8", "replace")
    print(f"   [{st:>4}] {label:44s} {len(raw):>8}B {secs:>5.1f}s")
    if raw:
        snip = re.sub(r"\s+", " ", body)[:n]
        print(f"          {snip}")
    return st, body


print("=" * 96)
print("[A] api.data.gov.mo")
for u in ["https://api.data.gov.mo", "https://api.data.gov.mo/", "https://api.data.gov.mo/swagger",
          "https://api.data.gov.mo/swagger/index.html", "https://api.data.gov.mo/api",
          "https://api.data.gov.mo/api/datasets", "https://api.data.gov.mo/Datasets",
          "https://api.data.gov.mo/api/Datasets", "https://api.data.gov.mo/health",
          "https://api.data.gov.mo/api/health", "https://api.data.gov.mo/version"]:
    show(u.replace("https://", ""), u)
    time.sleep(0.3)

print("\n" + "=" * 96)
print("[B] 政府 GIS（ArcGIS REST）")
for u in ["https://webmap.gis.gov.mo/arcgis/rest/services?f=json",
          "https://webmap.gis.gov.mo/arcgis/rest/services/WebMap?f=json",
          "https://webmap.gis.gov.mo/arcgis/rest/services/WebMap/MacauMap_T_POI/MapServer?f=json",
          "https://webmap4safp.gis.gov.mo/arcgis/rest/services?f=json"]:
    show(u.split("gis.gov.mo")[-1][:44], u, n=600)
    time.sleep(0.3)

print("\n" + "=" * 96)
print("[C] data.gov.mo 開放資料條款")
for u in ["https://data.gov.mo/terms", "https://data.gov.mo/zh-hant/terms", "https://data.gov.mo/opendata",
          "https://data.gov.mo/about", "https://data.gov.mo/faq", "https://data.gov.mo/statement",
          "https://data.gov.mo/copyright", "https://data.gov.mo/policy"]:
    st, body = show(u.replace("https://data.gov.mo", ""), u, n=400)
    time.sleep(0.3)

print("\n" + "=" * 96)
print("[D] index.js 裡的資料集關鍵字（找有沒有文化遺產類資料集）")
p = OUT / "datagovmo-index.js"
if p.is_file():
    js = p.read_text(encoding="utf-8", errors="replace")
    for kw in ["文化遺產", "文物", "歷史建築", "文化局", "heritage", "Heritage", "歷史城區"]:
        n = js.count(kw)
        print(f"   {kw:10s} 出現 {n} 次")
    for m in list(re.finditer(r"文化遺產|文物", js))[:6]:
        a = max(0, m.start() - 150)
        print("   …", re.sub(r"\s+", " ", js[a:m.end() + 200])[:340])
