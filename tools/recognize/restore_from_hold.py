"""把 _hold 裡的檔案搬回 photos-src/cc/（並清掉 curation.json 對應的排除紀錄）。

用於「當初排除的理由是相對的（例如五張同角度只留一張），但後來該棟照片不足」的情況。

用法：
    python tools/recognize/restore_from_hold.py st-lawrence-church          # 列出可還原的
    python tools/recognize/restore_from_hold.py st-lawrence-church --apply  # 實際還原
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
HOLDS = [ROOT / "photos-src" / "_hold-wikimedia", ROOT / "photos-src" / "_hold"]
CURATION = Path(__file__).resolve().parent / "curation.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--keep-exclusion", action="store_true", help="保留 curation.json 的排除紀錄")
    args = ap.parse_args()

    moved, freed = [], []
    for bid in args.ids:
        dest_dir = CC / bid
        if not dest_dir.is_dir():
            print(f"  !! {bid}：photos-src/cc/{bid} 不存在")
            continue
        have = {f.name for f in dest_dir.iterdir()}
        for h in HOLDS:
            src_dir = h / bid
            if not src_dir.is_dir():
                continue
            for f in sorted(src_dir.iterdir()):
                if f.suffix.lower() not in (".jpg", ".jpeg", ".png") or f.name in have:
                    continue
                print(f"  {'搬回' if args.apply else '[dry] 可搬回'} {bid}/{f.name}"
                      f"  （{h.name}，{f.stat().st_size//1024} KB）")
                if args.apply:
                    shutil.move(str(f), str(dest_dir / f.name))
                    moved.append(f"{bid}/{f.name}")

    if args.apply and moved and not args.keep_exclusion:
        cur = json.loads(CURATION.read_text(encoding="utf-8"))
        want = set(moved)
        keep = [e for e in cur.get("exclude", []) if e.get("file") not in want]
        freed = [e["file"] for e in cur.get("exclude", []) if e.get("file") in want]
        cur["exclude"] = keep
        cur["exclude_history"] = cur.get("exclude_history", [])
        for e in cur.get("exclude", []):
            pass
        CURATION.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n由 curation.json 的 exclude 移除 {len(freed)} 筆：")
        for f in freed:
            print("   ", f)

    print(f"\n{'還原' if args.apply else '可還原'} {len(moved) if args.apply else '（dry-run）'} 個檔案")
    if args.apply:
        for bid in args.ids:
            d = CC / bid
            if d.is_dir():
                n = len([f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")])
                print(f"  {bid:24s} {n} 張")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
