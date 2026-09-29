"""從 GitHub 上的鏡像清單找出可用的維基鏡像，並測試它們能不能當 Commons 的替代入口。

用法：python tools/recognize/_mirror_hunt.py
"""
from __future__ import annotations

import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; macaumemory/1.0)"}

LISTS = [
    "https://raw.githubusercontent.com/Heroic-Studio/Google-Mirrors/master/README.md",
    "https://raw.githubusercontent.com/IngressPrime/Google-Mirrors/master/README.md",
]


def get(url: str, timeout: int = 20) -> str:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return f"__HTTP_{e.code}__"
    except Exception as e:
        return f"__ERR_{type(e).__name__}_{str(e)[:40]}__"


def probe(url: str, timeout: int = 12) -> str:
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(150)
            return "OK %s %.1fs %r" % (r.status, time.time() - t, body[:90])
    except urllib.error.HTTPError as e:
        return "HTTP %s %.1fs" % (e.code, time.time() - t)
    except Exception as e:
        return "ERR %s %s" % (type(e).__name__, str(e)[:44])


def main() -> int:
    found: list[str] = []
    for lst in LISTS:
        text = get(lst)
        if text.startswith("__"):
            print(f"[warn] {lst}: {text}")
            continue
        urls = sorted(set(re.findall(r"https?://[^\s\)\]\"'<>`]+", text)))
        cand = [u for u in urls if re.search(r"wiki", u, re.I) and "github" not in u.lower()]
        print(f"[list] {lst.split('/')[4]}: {len(urls)} 個網址，其中 {len(cand)} 個疑似維基鏡像")
        for c in cand:
            print("   ", c)
        found.extend(cand)

    print("\n=== 逐一測試（首頁） ===")
    for u in dict.fromkeys(found):
        print(f"  {u[:70]:70s} {probe(u)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
