"""第二輪探測：找出「這台機器真的拿得到開放授權澳門建築照片」的來源。

已知可用：GitHub(raw/codeload)、hf-mirror.com、modelscope.cn、國內鏡像、macaumemory.mo
已知不可用：*.wikimedia.org / *.wikipedia.org / google / archive.org / openverse

用法：python tools/recognize/_source_probe.py
"""
from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; macaumemory/1.0)"}

# Commons 上真實存在的檔案（檔名來自既有 ATTRIBUTION.csv，路徑由 MediaWiki 決定，
# 這裡改用 Special:FilePath——它會 302 到正確的 upload 路徑，不必猜 hash）
COMMONS_FILE = "File:A-Ma_Temple_(Macau)_01.JPG"


def commons_direct() -> str:
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(COMMONS_FILE)


TARGETS: dict[str, str] = {
    # --- 圖床代理能不能真的把 Commons 圖拉過來 ---
    "wsrv: Special:FilePath": "https://wsrv.nl/?" + urllib.parse.urlencode({"url": commons_direct()}),
    "wsrv: Special:FilePath&output=json": "https://wsrv.nl/?"
        + urllib.parse.urlencode({"url": commons_direct(), "output": "json"}),
    "wsrv: docs page": "https://wsrv.nl/",
    # --- 其他第三方程式代理（有些站得慢，timeout 20s）---
    "gh-proxy pass-through": "https://gh-proxy.com/https://raw.githubusercontent.com/git/git/master/README.md",
    "ghproxy.net pass-through": "https://ghproxy.net/https://raw.githubusercontent.com/git/git/master/README.md",
    # --- 國內可及的澳門官方來源 ---
    "macaumemory.mo": "https://www.macaumemory.mo/",
    "macaumemory search": "https://www.macaumemory.mo/search?keyword=%E5%A4%A7%E4%B8%89%E5%B7%B4",
    "icm.gov.mo": "https://www.icm.gov.mo/",
    "macauheritage.net": "https://www.macauheritage.net/",
    "macaulifestyle": "https://www.macaulifestyle.com/",
    "macaotourism.gov.mo": "https://www.macaotourism.gov.mo/",
    "wh.mo": "https://www.wh.mo/",
    # --- 維基鏡像（再試一次）---
    "kkwiki": "https://zhwk.kkwiki.win/",
    "wikipedia mirror anti": "https://anti.zhongwen.wiki/",
    "wikiwand": "https://www.wikiwand.com/",
    # --- 其他開放授權圖庫 ---
    "unsplash": "https://unsplash.com/",
    "pexels": "https://www.pexels.com/",
    "pixabay": "https://pixabay.com/",
    "flickr": "https://www.flickr.com/",
    "openverse frontend": "https://openverse.org/",
    "met museum api": "https://collectionapi.metmuseum.org/public/collection/v1/objects/45734",
    "rijksmuseum": "https://www.rijksmuseum.nl/api/en/collection?key=0fiuZFh4&q=macau",
    "europeana": "https://www.europeana.eu/",
    # --- 地圖/街景類（可能有 CC 授權影像）---
    "mapillary api": "https://graph.mapillary.com/",
    "karta view": "https://kartaview.org/",
    "openstreetmap": "https://www.openstreetmap.org/",
}


def probe(url: str, timeout: int = 18) -> str:
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            body = r.read(150)
            return "OK %s %s %.1fs %r" % (r.status, r.headers.get("Content-Type", "")[:24], time.time() - t, body[:80])
    except urllib.error.HTTPError as e:
        try:
            body = e.read(120)
        except Exception:
            body = b""
        return "HTTP %s %.1fs %r" % (e.code, time.time() - t, body[:90])
    except Exception as e:
        return "ERR %s %s %.1fs" % (type(e).__name__, str(e)[:46], time.time() - t)


def main() -> int:
    for k, v in TARGETS.items():
        print(f"{k:34s} {probe(v)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
