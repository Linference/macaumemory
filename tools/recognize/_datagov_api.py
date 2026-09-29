"""從 data.gov.mo 的 index.js 找出真正的資料集 API，並試打。

用法：python tools/recognize/_datagov_api.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
OUT = Path(__file__).resolve().parent / "out"


def get(url: str, timeout: int = 25):
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=UA)
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


st, raw, secs = get("https://data.gov.mo/index.js")
print(f"index.js {st} {len(raw)}B {secs}s")
js = raw.decode("utf-8", "replace")
(OUT / "datagovmo-index.js").write_text(js, encoding="utf-8")

print("\n[1] 含 api/dataset/Datasets 的字串常值")
cands = set()
for m in re.finditer(r'["\'`]([^"\'`]{0,120}(?:api|Datasets|datasets|GetDataset|Search)[^"\'`]{0,120})["\'`]', js):
    s = m.group(1)
    if len(s) < 160 and not s.startswith("data:"):
        cands.add(s)
for c in sorted(cands)[:80]:
    print("   ", c[:140])

print("\n[2] 絕對 http(s) 端點")
for c in sorted({u for u in re.findall(r'https?://[A-Za-z0-9\.\-/_%]+', js)}):
    if any(k in c.lower() for k in ("api", "gov.mo", "service", "arcgis", "rest")):
        print("   ", c[:150])

print("\n[3] 試打候選端點")
for path in ["/Datasets", "/DatasetsOfMap", "/api/Datasets", "/api/datasets", "/Datasets/List",
             "/Datasets?lang=zh-hant", "/api/Datasets/List", "/Dataset/List", "/api/GetDatasets"]:
    st, raw, secs = get("https://data.gov.mo" + path, timeout=20)
    body = raw.decode("utf-8", "replace")
    print(f"   {path:26s} {st:>4} {len(raw):>8}B {secs:>5.1f}s {body[:110].replace(chr(10),' ')}")
    time.sleep(0.3)

print("\n[4] 政府 GIS / 其他官方入口")
for u in ["https://webmap.gis.gov.mo/", "https://webmap.gis.gov.mo/arcgis/rest/services",
          "https://www.gis.gov.mo/", "https://www.gov.mo/zh-hant/", "https://www.gov.mo/robots.txt"]:
    st, raw, secs = get(u, timeout=20)
    print(f"   {u:56s} {st:>4} {len(raw):>8}B {secs:>5.1f}s {raw[:90]!r}")
