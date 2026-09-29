"""驗證修正後的取圖路徑（Special:FilePath）速度與成功率，並測代理的連續呼叫上限。

用法：python tools/recognize/_bench2.py
"""
from __future__ import annotations

import io
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}
WSRV = "https://wsrv.nl/?"

FILES = [
    ("Macao Science Center 2011.JPG", 4000, 3000),
    ("Centro de Ciencia, Macao, 2013-08-08, DD 04.jpg", 2829, 4529),
    ("The Parisian Macao 30-01-2023(1).jpg", 4032, 3024),
    ("聖老楞佐堂3.JPG", 4000, 3000),
    ("Ruins of Saint Paul's, Macau (Ank Kumar) 01.jpg", 3253, 4880),
]


def filepath(title: str, width: int) -> str:
    name = urllib.parse.unquote(title).replace(" ", "_")
    return ("https://commons.wikimedia.org/wiki/Special:FilePath/"
            + urllib.parse.quote(name, safe="") + "?" + urllib.parse.urlencode({"width": str(width)}))


def fetch(url: str, timeout: int = 75):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            data = r.read()
        secs = time.time() - t
        im = Image.open(io.BytesIO(data))
        im.load()
        return True, f"{len(data)/1024:6.0f}KB {im.size[0]}x{im.size[1]} {im.format}", secs
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}", time.time() - t
    except Exception as e:
        return False, f"{type(e).__name__} {str(e)[:44]}", time.time() - t


print("### [1] Special:FilePath + wsrv（width 變化）")
for title, w, h in FILES:
    for width in (1400, 2000):
        u = WSRV + urllib.parse.urlencode({"url": filepath(title, width), "output": "jpg", "q": "92"})
        ok, detail, secs = fetch(u)
        print(f"   {'OK ' if ok else 'X  '} w={width:<5} {title[:46]:46s} {secs:>6.1f}s  {detail}")

print("\n### [2] 連續 12 張（測代理穩定度與速率）")
t0 = time.time()
ok = 0
for i in range(12):
    title, w, h = FILES[i % len(FILES)]
    u = WSRV + urllib.parse.urlencode({"url": filepath(title, 1400), "output": "jpg", "q": "92"})
    good, detail, secs = fetch(u)
    ok += good
    print(f"   [{i:2d}] {'OK ' if good else 'X  '} {secs:>6.1f}s  {detail}")
print(f"   → 12 張成功 {ok}，總計 {time.time()-t0:.1f}s（平均 {(time.time()-t0)/12:.1f}s/張）")

print("\n### [3] allorigins 連續 12 次 API（測文字代理穩定度）")
API = ("https://commons.wikimedia.org/w/api.php?action=query&titles=File:"
       + urllib.parse.quote("Macao Science Center 2011.JPG")
       + "&prop=imageinfo&iiprop=url|extmetadata&format=json&formatversion=2")
relay = "https://api.allorigins.win/raw?url=" + urllib.parse.quote(API, safe="")
t0 = time.time()
ok = 0
for i in range(12):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(relay, headers=UA), timeout=60) as r:
            data = r.read()
        good = b"imageinfo" in data
        ok += good
        print(f"   [{i:2d}] {'OK ' if good else 'X  '} {len(data):>6}B {time.time()-t:>6.1f}s")
    except Exception as e:
        print(f"   [{i:2d}] X   {type(e).__name__} {str(e)[:40]} {time.time()-t:>6.1f}s")
print(f"   → 12 次成功 {ok}，總計 {time.time()-t0:.1f}s（平均 {(time.time()-t0)/12:.1f}s/次）")
