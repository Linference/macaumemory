"""第三輪：找一個能轉發 Commons API（純文字）的代理，好拿到檔名／授權／作者。

wsrv.nl 已證明可以取到 commons 的『圖片』（走 Special:FilePath）。
現在缺的是『文字中繼』：把 https://commons.wikimedia.org/w/api.php?... 的 JSON 帶回來。

用法：python tools/recognize/_proxy_hunt.py
"""
from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; macaumemory/1.0)"}

API = ("https://commons.wikimedia.org/w/api.php?action=query&titles=File:Macau_Tower.jpg"
       "&prop=imageinfo&iiprop=url|extmetadata&format=json&formatversion=2")


def enc(u: str) -> str:
    return urllib.parse.quote(u, safe="")


def u(u: str) -> str:
    return urllib.parse.quote(u, safe="")


CANDIDATES: dict[str, str] = {
    # CORS / 通用轉發代理
    "allorigins raw": "https://api.allorigins.win/raw?url=" + enc(API),
    "allorigins get": "https://api.allorigins.win/get?url=" + enc(API),
    "corsproxy.io": "https://corsproxy.io/?" + enc(API),
    "cors.isomorphic": "https://cors.isomorphic-git.org/" + API,
    "thingproxy": "https://thingproxy.freeboard.io/fetch/" + API,
    "whateverorigin": "http://www.whateverorigin.org/get?url=" + enc(API),
    "jsonp.afeld": "https://jsonp.afeld.me/?url=" + enc(API),
    "crossorigin.me": "https://crossorigin.me/" + API,
    "test.cors.workers.dev": "https://test.cors.workers.dev/?" + API,
    "cors-anywhere hf": "https://cors-anywhere.herokuapp.com/" + API,
    "r.jina.ai": "https://r.jina.ai/" + API,
    "textance": "https://api.codetabs.com/v1/proxy?quest=" + enc(API),
    "codetabs proxy": "https://api.codetabs.com/v1/proxy/?quest=" + enc(API),
    "12ft": "https://12ft.io/proxy?q=" + enc(API),
    # 有沒有其他能『讀任意網址』的 CDN
    "wsrv plain": "https://wsrv.nl/?url=" + enc(API),
    "images.weserv blank": "https://images.weserv.nl/?url=" + enc(API) + "&output=json&n=-1",
}


def probe(url: str, timeout: int = 20) -> str:
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            body = r.read(200)
            return "OK %s %s %.1fs %r" % (r.status, r.headers.get("Content-Type", "")[:22], time.time() - t, body[:110])
    except urllib.error.HTTPError as e:
        try:
            body = e.read(140)
        except Exception:
            body = b""
        return "HTTP %s %.1fs %r" % (e.code, time.time() - t, body[:110])
    except Exception as e:
        return "ERR %s %s %.1fs" % (type(e).__name__, str(e)[:40], time.time() - t)


def main() -> int:
    for k, v in CANDIDATES.items():
        print(f"{k:26s} {probe(v)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
