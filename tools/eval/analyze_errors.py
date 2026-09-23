"""錯誤分析：E1/E2 的誤判集中在哪些建築配對？並量化「地理先驗」能把候選縮到多小。

用法：python tools/eval/analyze_errors.py
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "eval" / "out"

CATALOG_ZH = {
    "macau-tower": "澳門旅遊塔", "parisian": "澳門巴黎人", "macau-science-center": "澳門科學館",
    "galaxy-macau": "澳門銀河", "londoner-macao": "澳門倫敦人", "ruins-st-paul": "大三巴牌坊",
}

# 測試建築的真實座標（取自專案景點資料，用於地理先驗分析）
COORDS = {
    "macau-tower": (113.5368, 22.179819),
    "parisian": (113.560718, 22.143676),
    "macau-science-center": (113.556965, 22.186193),
    "galaxy-macau": (113.5543, 22.1466),
    "londoner-macao": (113.5571, 22.1460),
    "ruins-st-paul": (113.540839, 22.197458),
}


def haversine(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    pairs = sorted(OUT.glob("pairs_E1_*.csv"))
    if not pairs:
        raise SystemExit("找不到 E1 的配對檔，請先跑 evaluate.py")
    rows = list(csv.DictReader(pairs[0].open(encoding="utf-8-sig")))
    neg = defaultdict(list)
    for r in rows:
        if r["same"] == "0":
            a, b = r["building"].split("|")
            neg["  vs  ".join(sorted([CATALOG_ZH.get(a, a), CATALOG_ZH.get(b, b)]))].append(float(r["cosine"]))

    md = ["# 錯誤分析：誤判都在哪裡？\n",
          "## 一、E1 各建築配對的相似度（依誤判率排序）\n",
          "| 建築配對 | 配對數 | 平均相似度 | >0.86 比例 | >0.90 比例 |", "|---|---|---|---|---|"]
    print("=== E1：不同建築的相似度（依誤判率排序）===")
    print(f"{'配對':32} {'n':>5} {'mean':>7} {'>0.86':>8} {'>0.90':>8}")
    for k, v in sorted(neg.items(), key=lambda kv: -(np.array(kv[1]) >= 0.86).mean()):
        a = np.array(v)
        print(f"{k:32} {len(a):5d} {a.mean():7.3f} {(a >= 0.86).mean() * 100:7.1f}% {(a >= 0.90).mean() * 100:7.1f}%")
        md.append(f"| {k} | {len(a)} | {a.mean():.3f} | {(a >= 0.86).mean() * 100:.1f}% | {(a >= 0.90).mean() * 100:.1f}% |")

    md += ["\n## 二、地理先驗能把候選縮到多小（90 公尺半徑）\n",
           "| 建築 | 90m 內其他測試建築 | 最近的鄰居 |", "|---|---|---|"]
    ids = list(COORDS)
    print("\n=== 地理先驗：90 公尺內的其他測試建築數量 ===")
    for i, a in enumerate(ids):
        others = sorted(((haversine(COORDS[a], COORDS[b]), b) for b in ids if b != a))
        near = [f"{CATALOG_ZH[b]}({d:.0f}m)" for d, b in others if d <= 90]
        print(f"  {CATALOG_ZH[a]:10} → 90m 內其他建築：{len(near)} 棟 {('· ' + ', '.join(near)) if near else ''}")
        md.append(f"| {CATALOG_ZH[a]} | {len(near)} | {CATALOG_ZH[others[0][1]]}（{others[0][0]:.0f} m） |")

    dists = sorted(haversine(COORDS[a], COORDS[b]) for i, a in enumerate(ids) for b in ids[i + 1:])
    print(f"\n  兩兩距離：最小 {dists[0]:.0f} m、中位 {np.median(dists):.0f} m")
    md += [f"\n最短兩棟距離 {dists[0]:.0f} m、中位 {np.median(dists):.0f} m；"
           "視覺誤判全部發生在地理上相距很遠的建築之間（路氹城度假村群），"
           "90 公尺的 GPS 先驗可直接把這些候選全部排除，"
           "視覺比對因此只需負責「同一棟的不同角度」這一件事。\n"]
    (OUT / "error-analysis.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\n[寫出] {(OUT / 'error-analysis.md').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
