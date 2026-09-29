"""測試「庫裡沒有的建築」會怎樣——這是開放集（open-set）問題。

背景：辨識系統永遠會給出 Top-1（最近鄰），即使那棟建築根本不在資料庫裡。
所以關鍵不是「它答什麼」，而是「它的相似度分數落在哪」：
    高分（≥0.82）→ 系統會自信地給出**錯誤**答案（危險）
    低分（<0.48）→ 系統應誠實說「可能不在資料庫中」（正確行為）

測試素材：photos-src/cc/st-paul-street/ 的 5 張照片——這一棟已被 curator
從資料庫移除（5 張參考照沒有一張拍出街屋立面），因此它們是貨真價實的
「庫外建築」。
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import OnnxEncoder  # noqa: E402

CC_DIR = ROOT / "photos-src" / "cc"
UNKNOWN_DIRS = ["st-paul-street"]      # 已從庫中移除


def main() -> int:
    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    blds = data["buildings"]
    C = np.array([b["centroid"] for b in blds], np.float32)
    C /= (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9)
    hit_t = data["eval"]["suggested"]["hit"]
    maybe_t = data["eval"]["suggested"]["maybe"]

    enc = OnnxEncoder(ROOT / "public/models" / data["encoder"]["source"])
    print(f"  資料庫 {len(blds)} 棟 · 門檻 hit={hit_t} / maybe={maybe_t}")
    print(f"  測試素材：庫外建築（已從庫移除的 {', '.join(UNKNOWN_DIRS)}）\n")

    rows = []
    for d in UNKNOWN_DIRS:
        for f in sorted((CC_DIR / d).iterdir()):
            if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            v = enc.embed([Image.open(f).convert("RGB")])[0].astype(np.float32)
            v /= (np.linalg.norm(v) + 1e-9)
            sims = C @ v
            order = np.argsort(-sims)
            rows.append((f.name, float(sims[order[0]]), blds[int(order[0])]["zh"],
                         float(sims[order[1]]), blds[int(order[1])]["zh"], float(sims[order[2]])))

    print(f"  {'檔案':<46} {'Top-1 分數':>10}  {'判定':<10} 最相似的棟")
    print("  " + "-" * 104)
    danger = 0
    for name, s1, n1, s2, n2, s3 in rows:
        if s1 >= hit_t:
            verdict = "✗ 自信誤答"
            danger += 1
        elif s1 >= maybe_t:
            verdict = "△ 勉強候選"
        else:
            verdict = "✓ 應答『不在庫中』"
        print(f"  {name[:44]:<46} {s1:>10.3f}  {verdict:<10} {n1}（次 {s2:.3f} {n2}）")

    print()
    print(f"  最高分：{max(r[1] for r in rows):.3f}　最低：{min(r[1] for r in rows):.3f}")
    print(f"  落在『自信』門檻（≥{hit_t}）以上的：{danger} / {len(rows)} 件")
    if danger == 0:
        print("  → 系統不會對庫外建築自信誤答；搭配『全部分數偏低就說不在庫中』即可安全")
    else:
        print("  → ⚠ 有庫外建築會被自信地誤判，前端必須加上額外保護")
    return 0


if __name__ == "__main__":
    sys.exit(main())
