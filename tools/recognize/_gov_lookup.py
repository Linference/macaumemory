"""看 data.gov.mo 到底是什麼（SPA？入口在哪）、以及 macaumemory.mo 的授權條款與搜尋入口。

用法：python tools/recognize/_gov_lookup.py
"""
from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "recognize" / "out"


def dns(h):
    try:
        return sorted({i[4][0] for i in socket.getaddrinfo(h, 443)})
    except Exception as e:
        return f"ERR {e}"


def get(url: str, timeout: int = 30):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), round(time.time() - t, 1)
    except urllib.error.HTTPError as e:
        try:
            b = e.read().decode("utf-8", "replace")
        except Exception:
            b = ""
        return e.code, b, round(time.time() - t, 1)
    except Exception as e:
        return 0, f"__ERR__ {type(e).__name__} {e}", round(time.time() - t, 1)


print("[DNS]")
for h in ["data.gov.mo", "www.data.gov.mo", "culturalheritage.mo", "macaumemory.mo", "icm.gov.mo",
          "macau.gov.mo", "www.gov.mo"]:
    print(f"  {h:24s} {dns(h)}")

print("\n[data.gov.mo 首頁全文]")
st, html, secs = get("https://data.gov.mo/")
print(f"  status={st} secs={secs} bytes={len(html)}")
print(html[:4200])

print("\n[data.gov.mo 常見入口]")
for path in ["/home", "/index", "/zh-hant", "/zh-hant/", "/dataset", "/datasets", "/catalog",
             "/api/v1", "/opendata", "/ckan", "/api/3/action/package_list", "/list", "/search"]:
    st, html, secs = get("https://data.gov.mo" + path, timeout=20)
    tag = "HTML" if html.lstrip().startswith("<") and len(html) > 200 else html[:90].replace("\n", " ")
    print(f"  {path:32s} {st:>4} {secs:>5.1f}s {len(html):>7}B  {tag[:100]}")

print("\n[macaumemory.mo 條款／版權頁全文]")
for path in ["/terms", "/copyright", "/about", "/privacy", "/disclaimer", "/zh-hant/terms"]:
    st, html, secs = get("https://www.macaumemory.mo" + path, timeout=25)
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    print(f"  {path:20s} {st:>4} {secs:>5.1f}s  {text[:400]}")

print("\n[保存 gov 頁面]")
OUT.mkdir(parents=True, exist_ok=True)
st, html, _ = get("https://data.gov.mo/")
(OUT / "datagovmo-home.html").write_text(html, encoding="utf-8")
for p in ("/terms", "/copyright"):
    st, h, _ = get("https://www.macaumemory.mo" + p, timeout=25)
    (OUT / f"macaumemory{p.replace('/','_')}.html").write_text(h, encoding="utf-8")
print(f"  → {OUT}")
