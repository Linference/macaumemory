"""耐心重試探測：Commons 到底是『完全封鎖』還是『間歇限流』？

用法：python tools/recognize/_net_patient.py [每輪間隔秒] [輪數]
"""
from __future__ import annotations

import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}

# 多個 Wikimedia 進入點（不同 IP / 不同服務）
TARGETS = [
    ("commons-api", "https://commons.wikimedia.org/w/api.php?action=query&format=json&meta=siteinfo"),
    ("upload-https", "https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg"),
    ("wikipedia-org", "https://www.wikipedia.org/"),
    ("wikimedia-org", "https://www.wikimedia.org/"),
    ("commons-wiki", "https://commons.wikimedia.org/wiki/Main_Page"),
]


def probe(url: str, timeout: int = 12) -> tuple[bool, str]:
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            r.read(64)
            return True, "HTTP %s %.1fs" % (r.status, time.time() - t)
    except urllib.error.HTTPError as e:
        return e.code < 500, "HTTP %s %.1fs" % (e.code, time.time() - t)
    except Exception as e:
        return False, "%s %s %.1fs" % (type(e).__name__, str(e)[:44], time.time() - t)


def main() -> int:
    gap = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    tally = {n: [0, 0] for n, _ in TARGETS}
    for rd in range(1, rounds + 1):
        stamp = time.strftime("%H:%M:%S")
        line = [f"[{stamp}] round {rd}/{rounds}:"]
        for name, url in TARGETS:
            ok, detail = probe(url)
            tally[name][0 if ok else 1] += 1
            line.append(f"{name}={'OK' if ok else 'X'}({detail})")
        print("  ".join(line), flush=True)
        if rd < rounds:
            time.sleep(gap)
    print("\n=== 彙總 ===")
    for name, (ok, bad) in tally.items():
        print(f"  {name:16s} OK {ok} / 失敗 {bad}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
