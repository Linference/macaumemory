"""從 geo_verify.py 的 CSV 做內點門檻掃描：找「零誤判下最大召回」的甜蜜點。

用法：python tools/eval/geo_sweep.py [--method sift]
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="sift")
    args = ap.parse_args()
    p = OUT / f"geo-verify-{args.method}.csv"
    if not p.exists():
        raise SystemExit(f"找不到 {p}，請先跑 geo_verify.py --method {args.method}")
    rows = list(csv.DictReader(p.open(encoding="utf-8-sig")))
    for r in rows:
        r["inliers"] = int(r["inliers"])
        r["same_building"] = r["same_building"] == "True"
        r["global_sim"] = float(r["global_sim"])
    same = [r for r in rows if r["same_building"]]
    diff = [r for r in rows if not r["same_building"]]
    print(f"配對 {len(rows)}：同棟 {len(same)}、不同棟 {len(diff)}")

    print(f"\n=== 只用全局相似度的基準（不同門檻）===")
    print(f"{'全局門檻':>9}{'接受同棟':>10}{'接受不同棟':>11}{'精確率':>9}{'召回':>8}")
    for thr in (0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40):
        tp = sum(1 for r in same if r["global_sim"] >= thr)
        fp = sum(1 for r in diff if r["global_sim"] >= thr)
        prec = tp / (tp + fp) if tp + fp else float("nan")
        print(f"{thr:>9.2f}{tp:>10}{fp:>11}{prec * 100:>8.1f}%{tp / len(same) * 100:>7.1f}%")

    print(f"\n=== 全局 ≥ 0.15 後再加幾何驗證（內點門檻掃描）===")
    print(f"{'內點門檻':>9}{'接受同棟':>10}{'接受不同棟':>11}{'精確率':>9}{'召回':>8}")
    pool_same = [r for r in same if r["global_sim"] >= 0.15]
    pool_diff = [r for r in diff if r["global_sim"] >= 0.15]
    for k in (1, 3, 5, 8, 10, 12, 15, 20, 25, 30):
        tp = sum(1 for r in pool_same if r["inliers"] >= k)
        fp = sum(1 for r in pool_diff if r["inliers"] >= k)
        prec = tp / (tp + fp) if tp + fp else float("nan")
        print(f"{k:>9}{tp:>10}{fp:>11}{prec * 100:>8.1f}%{tp / len(same) * 100:>7.1f}%")

    print(f"\n=== 內點數分布 ===")
    for name, group in (("同棟", same), ("不同棟", diff)):
        inl = sorted(r["inliers"] for r in group)
        if not inl:
            continue
        p50 = inl[len(inl) // 2]
        p90 = inl[int(len(inl) * 0.9)]
        print(f"  {name}：中位 {p50}、p90 {p90}、最大 {inl[-1]}、為 0 的比例 "
              f"{sum(1 for x in inl if x == 0) / len(inl) * 100:.0f}%")


if __name__ == "__main__":
    main()
