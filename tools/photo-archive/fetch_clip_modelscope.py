#!/usr/bin/env python
"""從 ModelScope（阿里魔搭）下載 CLIP 模型到專案 .cache/models/（中國大陸網路較快）"""
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from modelscope import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / ".cache" / "models"
DEST.mkdir(parents=True, exist_ok=True)

CANDIDATES = [
    "AI-ModelScope/clip-vit-base-patch32",
    "openai-mirror/clip-vit-base-patch32",
    "damo/CLIP-ViT-B-32",
]
for repo in CANDIDATES:
    try:
        print(f"嘗試 {repo} …", flush=True)
        path = snapshot_download(repo, local_dir=str(DEST / "clip-vit-base-patch32"))
        print("下載完成:", path, flush=True)
        for f in sorted(Path(path).glob("*")):
            print(f"  {f.name}  {f.stat().st_size/1048576:.1f} MB", flush=True)
        break
    except Exception as e:
        print(f"  失敗：{str(e)[:160]}", flush=True)
