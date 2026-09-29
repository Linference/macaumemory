"""圖床代理下載速度基準測試：找出「經 wsrv 抓 Commons 圖」最穩最快的參數。

用法：python tools/recognize/_wsrv_bench.py
"""
from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}

# 三個真實的 Commons 檔案（大小／方向不同）
FILES = [
    dict(name="science-center-2011", url="https://upload.wikimedia.org/wikipedia/commons/6/6a/Macao_Science_Center_2011.JPG",
         w=4000, h=3000),
    dict(name="science-center-portrait", url="https://upload.wikimedia.org/wikipedia/commons/2/2f/Centro_de_Ciencia%2C_Macao%2C_2013-08-08%2C_DD_04.jpg",
         w=2829, h=4529),
]


def thumb(url: str, w: int) -> str:
    name = url.rsplit("/", 1)[-1]
    return url.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/") + f"/{w}px-{name}"


def try_fetch(label: str, url: str, timeout: int = 60) -> tuple[bool, str, float]:
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            data = r.read()
        secs = time.time() - t
        if len(data) < 8000:
            return False, f"{len(data)}B", secs
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
            return True, f"{len(data)/1024:.0f}KB {im.size[0]}x{im.size[1]} {im.format}", secs
        except Exception as e:
            return False, f"decode {e}", secs
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}", time.time() - t
    except Exception as e:
        return False, f"{type(e).__name__} {str(e)[:40]}", time.time() - t


QUERY_VARIANTS = [
    ("plain (no params)", {}),
    ("output=jpg q=92", {"output": "jpg", "q": "92"}),
    ("w=1400 output=jpg", {"w": "1400", "output": "jpg"}),
    ("w=1400 output=jpg q=88 &il", {"w": "1400", "output": "jpg", "q": "88", "il": ""}),
    ("w=1400 fit=inside", {"w": "1400", "fit": "inside", "output": "jpg"}),
]

for f in FILES:
    print("=" * 92)
    print(f"### {f['name']}  {f['w']}x{f['h']}")
    for label, target in [("ORIGINAL upload url", f["url"]), ("COMMONS thumb url 1400", thumb(f["url"], 1400))]:
        for qlabel, params in QUERY_VARIANTS:
            u = "https://wsrv.nl/?" + urllib.parse.urlencode({"url": target, **params})
            ok, detail, secs = try_fetch(qlabel, u)
            print(f"   {'OK ' if ok else 'X  '} {label:24s} {qlabel:26s} {secs:>6.1f}s  {detail}")
