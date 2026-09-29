"""印出指定建築的逐張稽核結果（verdict + YOLO 判定），供人工對照聯絡表判斷。

用法：python tools/recognize/show_audit.py [building_id ...]
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"
rows = json.loads((OUT / "ref-audit.json").read_text(encoding="utf-8"))
per: dict[str, list[dict]] = defaultdict(list)
for r in rows:
    per[r["id"]].append(r)

want = sys.argv[1:] or sorted(per)
for bid in want:
    rs = per.get(bid)
    if not rs:
        continue
    ok = sum(1 for r in rs if r["verdict"] == "ok")
    print(f"\n=== {bid}  ({len(rs)} 張，ok {ok}) ===")
    for r in sorted(rs, key=lambda r: r["file"]):
        print(f"  {r['verdict']:13s} {r['file'][:46]:46s} {r['top'][:34]:34s} {r['why'][:56]}")
