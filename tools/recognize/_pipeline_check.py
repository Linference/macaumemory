"""驗證兩段式取圖管線：Commons API（經 allorigins 文字代理）＋ 圖片（經 wsrv 圖床代理）。

要確認的四件事：
    1. API 能不能列分類成員、能不能查 extmetadata（授權／作者）
    2. API 回傳的 upload.wikimedia.org 原始網址，wsrv 能不能直接抓（省掉猜 hash）
    3. wsrv 的縮圖參數（w / h / fit / output）行為
    4. 兩段代理的穩定度與速率上限（連續呼叫會不會被擋）

用法：python tools/recognize/_pipeline_check.py
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}
RELAY = "https://api.allorigins.win/raw?url="
WSRV = "https://wsrv.nl/?"
API = "https://commons.wikimedia.org/w/api.php"


def relay(params: dict, timeout: int = 45, retries: int = 3) -> dict:
    """經 allorigins 呼叫 Commons API。"""
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    last = ""
    for i in range(retries):
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(RELAY + urllib.parse.quote(url, safe=""), headers=UA),
                    timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:70]}"
            time.sleep(2 * (i + 1))
    return {"__error__": last}


def wsrv(url: str, **kw) -> str:
    q = {"url": url}
    q.update(kw)
    return WSRV + urllib.parse.urlencode(q)


def fetch(url: str, timeout: int = 40) -> tuple[int, str, int, bytes]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            b = r.read()
            return r.status, r.headers.get("Content-Type", ""), len(b), b
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), 0, e.read()[:200]
    except Exception as e:
        return 0, type(e).__name__, 0, str(e)[:120].encode()


def main() -> int:
    print("=" * 78)
    print("[1] API：分類成員 + extmetadata")
    t = time.time()
    d = relay({"action": "query", "generator": "categorymembers",
               "gcmtitle": "Category:Saint Lawrence's Church (Macau)", "gcmtype": "file", "gcmlimit": "5",
               "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime|sha1", "iiurlwidth": "1024"})
    print(f"    耗時 {time.time()-t:.1f}s · error={d.get('__error__')}")
    pages = (d.get("query") or {}).get("pages") or []
    print(f"    取得 {len(pages)} 個檔案")
    raw_url = None
    for p in pages[:5]:
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {})
        def g(k):
            v = em.get(k, {}).get("value", "")
            import re
            import html
            return html.unescape(re.sub(r"<[^>]+>", "", str(v)))[:60]
        print(f"      {p['title'][:56]:56s} {ii.get('width')}x{ii.get('height')} {ii.get('mime')}")
        print(f"        license={g('LicenseShortName')!r} author={g('Artist')!r}")
        print(f"        url={str(ii.get('url'))[:90]}")
        if raw_url is None:
            raw_url = ii.get("url")

    print("=" * 78)
    print("[2] wsrv 抓 upload.wikimedia.org 原始網址（不猜 hash）")
    if raw_url:
        for label, target in [("original url", raw_url),
                              ("original url + w=1024", wsrv(raw_url, w=1024)),
                              ("Special:FilePath", wsrv(
                                  "https://commons.wikimedia.org/wiki/Special:FilePath/"
                                  + urllib.parse.quote(raw_url.rsplit("/", 1)[-1]))) ]:
            st, ct, n, body = fetch(target)
            print(f"    {label:22s} → {st} {ct[:20]} {n}B head={body[:4]!r}")

    print("=" * 78)
    print("[3] wsrv 縮圖行為")
    if raw_url:
        for kw in [{"w": "1024"}, {"h": "1024"}, {"w": "1024", "fit": "cover"},
                   {"w": "1024", "output": "jpg"}, {"w": "1024", "output": "json"}, {"w": "60", "output": "json"}]:
            target = wsrv(raw_url, **kw)
            st, ct, n, body = fetch(target)
            extra = ""
            if "json" in ct:
                try:
                    j = json.loads(body)
                    extra = f" format={j.get('format')} {j.get('width')}x{j.get('height')} bytes={j.get('size') or j.get('bytes')}"
                except Exception as e:
                    extra = f" json-parse-fail {e}"
            print(f"    {str(kw):34s} → {st} {ct[:18]} {n}B{extra}")

    print("=" * 78)
    print("[4] 連續呼叫穩定度（10 次小圖）")
    if raw_url:
        ok = 0
        t0 = time.time()
        for i in range(10):
            st, ct, n, _ = fetch(wsrv(raw_url, w=256, output="json"))
            ok += st == 200
        print(f"    10 次裡成功 {ok} 次，共 {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
