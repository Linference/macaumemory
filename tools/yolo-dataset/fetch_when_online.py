"""等 Commons 恢復就連線抓圖的守候程序。

背景：Wikimedia 這幾個 host（commons / upload / zh.wikipedia）目前 SSL handshake 逾時，
      研判是被暫時限流或網路封鎖；而 GitHub / Overpass 正常，所以不是整體斷網。
      這個程序每 N 秒探測一次 Commons API，一恢復就自動執行大規模抓圖，不必人工盯著。

用法：
    python tools/yolo-dataset/fetch_when_online.py                # 每 180 秒探測，最多等 6 小時
    python tools/yolo-dataset/fetch_when_online.py --per-class 600 --interval 120 --max-hours 8
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "yolo-dataset" / "fetch_dataset.py"
UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}


def commons_ok(timeout=15) -> tuple[bool, str]:
    q = {"action": "query", "titles": "File:Macau Tower.jpg", "prop": "imageinfo",
         "iiprop": "url", "format": "json", "formatversion": "2"}
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status == 200, f"HTTP {r.status}"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:50]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=int, default=180, help="探測間隔（秒）")
    ap.add_argument("--max-hours", type=float, default=6.0)
    ap.add_argument("--per-class", type=int, default=600)
    ap.add_argument("--subcats", type=int, default=2)
    ap.add_argument("--cat-limit", type=int, default=150)
    ap.add_argument("--search-pages", type=int, default=4)
    args = ap.parse_args()

    deadline = time.time() + args.max_hours * 3600
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        ok, detail = commons_ok()
        stamp = time.strftime("%H:%M:%S")
        if ok:
            print(f"[{stamp}] ✓ Commons 已恢復（{detail}），開始抓圖（第 {attempt} 次探測）", flush=True)
            cmd = [sys.executable, "-u", str(SCRIPT), "--per-class", str(args.per_class),
                   "--subcats", str(args.subcats), "--cat-limit", str(args.cat_limit),
                   "--search-pages", str(args.search_pages), "--sleep", "0.4"]
            print("  執行：" + " ".join(cmd[1:]), flush=True)
            rc = subprocess.call(cmd, cwd=str(ROOT))     # 繼承 stdio，不捕捉輸出
            print(f"[{stamp}] 抓圖結束（returncode={rc}）", flush=True)
            return rc
        print(f"[{stamp}] ✗ Commons 仍不可用（{detail}）；{args.interval}s 後再試"
              f"（剩餘 {max(0, (deadline - time.time()) / 3600):.1f} 小時）", flush=True)
        time.sleep(args.interval)
    print("已達等待上限，放棄。可稍後再手動執行 fetch_dataset.py", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
