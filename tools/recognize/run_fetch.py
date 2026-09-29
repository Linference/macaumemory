"""背景啟動 fetch_references.py，輸出直接寫入 UTF-8 檔（避免 PowerShell 管線緩衝與編碼問題）。

用法：
    python tools/recognize/run_fetch.py 5 1.0            # per-building, sleep
    python tools/recognize/run_fetch.py 8 1.0 --only macau-science-center,parisian
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / "tools" / "recognize" / "out" / "fetch-log.txt"


def main() -> int:
    per = sys.argv[1] if len(sys.argv) > 1 else "5"
    sleep = sys.argv[2] if len(sys.argv) > 2 else "1.0"
    extra = sys.argv[3:]
    cmd = [sys.executable, "-u", str(ROOT / "tools" / "recognize" / "fetch_references.py"),
           "--per-building", per, "--sleep", sleep, *extra]
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write("\n" + "=" * 80 + "\n" + " ".join(cmd[1:]) + "\n")
        f.flush()
        rc = subprocess.call(cmd, cwd=str(ROOT), stdout=f, stderr=subprocess.STDOUT)
    print(f"returncode={rc} → {LOG}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
