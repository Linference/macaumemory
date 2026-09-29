"""找出 data.gov.mo 的資料集 API，以及 macaumemory 的《使用條款》《授權條款》實際網址。

用法：python tools/recognize/_datasets_lookup.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "recognize" / "out"


def get(url: str, timeout: int = 25):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, r.read(), r.headers.get("Content-Type", ""), round(time.time() - t, 1)
    except urllib.error.HTTPError as e:
        try:
            b = e.read()
        except Exception:
            b = b""
        return e.code, b, e.headers.get("Content-Type", ""), round(time.time() - t, 1)
    except Exception as e:
        return 0, str(e).encode(), type(e).__name__, round(time.time() - t, 1)


print("=" * 96)
print("[A] data.gov.mo 首頁的 script / 連結")
st, raw, ct, secs = get("https://data.gov.mo/")
html = raw.decode("utf-8", "replace")
for s in sorted(set(re.findall(r'<script[^>]+src\s*=\s*["\']([^"\']+)["\']', html, re.I))):
    print("   script:", s)
for l in sorted(set(re.findall(r'href\s*=\s*["\']([^"\']+)["\']', html))):
    print("   link  :", l)
for m in re.finditer(r"[\"']([^\"']*(?:ajax|json|ashx|asmx|svc|api)[^\"']*)[\"']", html, re.I):
    print("   api-ish:", m.group(1)[:120])

print("\n" + "=" * 96)
print("[B] data.gov.mo 常見入口（含 POST / 大小寫變化）")
paths = ["/index.html", "/main", "/home.html", "/zh-hant/index.html", "/List.aspx", "/list.aspx",
         "/Search.aspx", "/search.aspx", "/DatasetList.aspx", "/datalist", "/dataSet",
         "/service", "/services", "/Common/", "/WebService/", "/Handler/", "/api/dataset",
         "/api/datasets", "/api/Data", "/Data.ashx", "/Dataset.ashx", "/GetDatasetList",
         "/OpenData/", "/opendata/index.html"]
for p in paths:
    st, raw, ct, secs = get("https://data.gov.mo" + p, timeout=15)
    body = raw.decode("utf-8", "replace")
    tag = "SAME-4327B-SHELL" if len(raw) == 4327 else body[:70].replace("\n", " ")
    print(f"   {p:26s} {st:>4} {len(raw):>7}B {secs:>5.1f}s {tag[:80]}")

print("\n" + "=" * 96)
print("[C] macaumemory 條款頁面")
st, raw, ct, secs = get("https://www.macaumemory.mo/")
html = raw.decode("utf-8", "replace")
for l in sorted(set(re.findall(r'href\s*=\s*["\']([^"\']+)["\']', html))):
    print("   link:", l)
for m in re.finditer(r'(?:使用條款|授權條款|服務條款|版權)', html):
    a = max(0, m.start() - 200)
    print("   …", re.sub(r"\s+", " ", html[a:m.end() + 260])[:460])

print("\n  試常見條款路徑：")
for p in ["/terms-of-use", "/termsOfUse", "/use-terms", "/license", "/licence", "/license-terms",
          "/authorization", "/member-terms", "/service-terms", "/serviceTerms", "/userTerms",
          "/statement", "/policies", "/policy", "/rule", "/rules", "/agreement"]:
    st, raw, ct, secs = get("https://www.macaumemory.mo" + p, timeout=15)
    body = raw.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", body, re.S)
    # macaumemory 是 SPA：內容全由前端渲染；判斷方式是看是否有「找不到」字樣
    print(f"   {p:22s} {st:>4} {len(raw):>7}B  title={title.group(1).strip()[:30] if title else '—'}")

print("\n" + "=" * 96)
print("[D] data.gov.mo 的 JS bundle 內容（找 API 路徑）")
st, raw, ct, secs = get("https://data.gov.mo/index.css", timeout=15)
print(f"   index.css {st} {len(raw)}B")
for name in ["index.js", "main.js", "app.js", "index.min.js", "js/index.js", "assets/index.js"]:
    st, raw, ct, secs = get("https://data.gov.mo/" + name, timeout=15)
    print(f"   {name:20s} {st} {len(raw)}B")
    if st == 200 and len(raw) > 500:
        js = raw.decode("utf-8", "replace")
        urls = sorted(set(re.findall(r'["\'](/[A-Za-z0-9_\-/\.]*(?:api|Api|ashx|asmx|json|Dataset)[A-Za-z0-9_\-/\.]*)["\']', js)))
        for u in urls[:40]:
            print("        ", u[:120])
