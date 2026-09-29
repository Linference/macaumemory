"""列出 attractions.json 的景點（給 build_embeddings.py 的 spot 欄位對照用）。

用法：python tools/recognize/_spots.py [關鍵字...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
d = json.loads((ROOT / "public" / "data" / "attractions.json").read_text(encoding="utf-8"))
keys = sys.argv[1:]
for a in d["attractions"]:
    name = a.get("name", "")
    if keys and not any(k in name or k in a.get("id", "") for k in keys):
        continue
    print(f"{a.get('id',''):26s} | {name:24s} | {a.get('category','')}")
print(f"\n共 {len(d['attractions'])} 個景點")
