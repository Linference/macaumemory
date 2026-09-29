"""把「本輪從 Wikimedia 抓來、但已被使用者本機照片取代」的參考照片移到 _hold/。

為什麼要清掉：同一棟建築如果同時有 Wikimedia 與使用者照片，兩者的拍攝風格／
後製差異會把該棟的向量分布拉寬，而且我已經目視比較過——本機照片的取景普遍
比 Commons 的分類照片更接近「手機拍一張」的真實使用情境。

保留：原本就有的 101 張 Commons 參考照（那些是既有基準，不在本次清理範圍），
以及 11 棟**只有 Wikimedia 有照片**的建築（大教堂、路環、氹仔舊城、觀音堂、
荔枝碗、紅街市、福隆新街、議事亭前地、聖老楞佐堂、聖安多尼堂、望德堂）。

用法：python tools/recognize/purge_wikimedia_extras.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CC = ROOT / "photos-src" / "cc"
HOLD = ROOT / "photos-src" / "_hold-wikimedia"
STATE = Path(__file__).resolve().parent / "refs-sources.json"

# 本輪抓的 Wikimedia 檔名一律帶 6 碼 md5 後綴（XXXXXXXX.jpg），據此辨識
import re  # noqa: E402

MD5ISH = re.compile(r"_[0-9a-f]{6}\.jpg$", re.I)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.is_file() else {"files": {}}
    files = state.setdefault("files", {})

    moved, removed_state = [], []
    for d in sorted(p for p in CC.iterdir() if p.is_dir()):
        for f in sorted(d.iterdir()):
            if f.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            if d.name in ("_hold",):
                continue
            if d.name == "demo":
                continue
            if not MD5ISH.search(f.name):
                continue                     # 不是本輪抓的 → 保留
            key = f"{d.name}/{f.name}"
            if args.dry_run:
                print(f"  [dry] {key}")
                continue
            dest = HOLD / d.name / f.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(dest))
            moved.append(key)
            if key in files:
                files.pop(key)
                removed_state.append(key)

    if not args.dry_run:
        state["updated"] = __import__("time").strftime("%Y-%m-%dT%H:%M:%S")
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        (HOLD / "README.md").parent.mkdir(parents=True, exist_ok=True)
        (HOLD / "README.md").write_text(
            "本輪（2026-09）從 Wikimedia Commons 抓來的參考照片，經目視比較後由使用者提供的\n"
            "本機照片取代，因此移到這裡保存而非刪除。授權仍為 CC／公有領域，\n"
            "出處見 photos-src/cc/ATTRIBUTION-references.csv。\n", encoding="utf-8")

    print(f"\n移動 {len(moved)} 張 → {HOLD.relative_to(ROOT)}")
    print(f"從 refs-sources.json 移除 {len(removed_state)} 筆")
    # 列出每個資料夾剩下的張數
    for d in sorted(p for p in CC.iterdir() if p.is_dir()):
        n = len([f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")])
        if n:
            print(f"  {d.name:24s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
