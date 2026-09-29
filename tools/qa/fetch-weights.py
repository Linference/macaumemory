"""可斷點續傳的權重下載器。

為什麼需要：此環境對 GitHub Releases 的大檔下載常中途停住（SSL read timeout），
而 ultralytics 內建的 curl 下載又會因憑證驗證失敗（Curl return value 35）而放棄。
這支用 Python urllib + HTTP Range 續傳，分段重試直到檔案完整。

用法：python tools/qa/fetch-weights.py yolo11s.pt
"""
from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = [
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/{name}",
    "https://github.com/ultralytics/assets/releases/download/v8.4.0/{name}",
    "https://github.com/ultralytics/assets/releases/download/v8.2.0/{name}",
]
UA = {"User-Agent": "Mozilla/5.0"}


def size_of(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return int(r.headers.get("Content-Length") or 0)


def download(url: str, dst: Path, attempts: int = 8) -> bool:
    total = size_of(url)
    if total == 0:
        print(f"  ✗ 無法取得檔案大小：{url}")
        return False
    print(f"  目標 {total / 1048576:.1f} MB")
    for i in range(1, attempts + 1):
        have = dst.stat().st_size if dst.exists() else 0
        if have >= total:
            print(f"  ✓ 已完成（{have / 1048576:.1f} MB）")
            return True
        req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r, dst.open("ab") as f:
                while True:
                    chunk = r.read(1 << 18)
                    if not chunk:
                        break
                    f.write(chunk)
                    got = have + f.tell() - have
                    if got // (2 << 20) != have // (2 << 20):
                        print(f"    … {got / 1048576:.1f}/{total / 1048576:.1f} MB", flush=True)
        except Exception as e:
            now = dst.stat().st_size if dst.exists() else 0
            print(f"    第 {i} 次中斷於 {now / 1048576:.1f} MB（{type(e).__name__}）；續傳重試…", flush=True)
            time.sleep(3)
    ok = dst.exists() and dst.stat().st_size >= total
    print("  ✓ 完成" if ok else "  ✗ 仍未完成")
    return ok


def main():
    if len(sys.argv) < 2:
        raise SystemExit("用法：python tools/qa/fetch-weights.py yolo11s.pt")
    name = sys.argv[1]
    dst = ROOT / name
    if dst.exists() and dst.stat().st_size > 1_000_000:
        print(f"已存在 {name}（{dst.stat().st_size / 1048576:.1f} MB），略過")
        return 0
    for tpl in CANDIDATES:
        url = tpl.format(name=name)
        print(f"嘗試 {url}")
        if download(url, dst):
            return 0
    print("全部來源都失敗。可改用本機已有的 yolo11n.pt 訓練，或稍後再試。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
