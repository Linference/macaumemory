"""一次性網路探測：找出「這台機器能怎麼拿到 Wikimedia Commons 的圖與授權資訊」。
只是診斷工具，不影響嵌入庫。用完可刪。
"""
from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; macaumemory/1.0)"}


def get(url: str, timeout: int = 25, head: bool = False) -> str:
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=UA, method="HEAD" if head else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = b"" if head else r.read(120)
            ct = r.headers.get("Content-Type", "")[:28]
            return f"OK {r.status} {ct} len={r.headers.get('Content-Length')} %.1fs {body[:70]!r}" % (time.time() - t)
    except urllib.error.HTTPError as e:
        return "HTTP %s %.1fs %r" % (e.code, time.time() - t, e.read()[:200])
    except Exception as e:
        return "ERR %s %s %.1fs" % (type(e).__name__, str(e)[:60], time.time() - t)


def w(url: str, **kw) -> str:
    """把目標網址塞進 weserv 圖床代理。"""
    q = {"url": url}
    q.update(kw)
    return "https://images.weserv.nl/?" + urllib.parse.urlencode(q)


TESTS = {
    # weserv 到底能不能連到 upload.wikimedia.org？
    "wsrv: real commons file (svg logo)": w("https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg"),
    "wsrv: real commons file + w=200": w("https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg", w=200),
    "wsrv: nonexistent commons file": w("https://upload.wikimedia.org/wikipedia/commons/1/1a/ZZZ_nope_not_here.jpg"),
    # weserv 能不能當「文字代理」拿 API?
    "wsrv: commons api json": w("https://commons.wikimedia.org/w/api.php?action=query&format=json"),
    "wsrv: commons category html": w("https://commons.wikimedia.org/wiki/Category:A-Ma_Temple"),
    # GitHub raw（已知可用）
    "github raw": "https://raw.githubusercontent.com/git/git/master/README.md",
    # hf-mirror（已知可用）
    "hf-mirror api": "https://hf-mirror.com/api/datasets?search=macau&limit=3",
    # 其他可能的 Commons 鏡像
    "wikiwand": "https://www.wikiwand.com/en/articles/Macau",
    "wiki.lihebi": "https://wiki.lihebi.com/",
    "wikipedia mirror cdn": "https://zh.wikipedia.mirror.swiftserve.com/",
}


def main() -> int:
    for k, v in TESTS.items():
        print(f"{k:42s} {get(v, timeout=20)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
