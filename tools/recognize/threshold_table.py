"""從實測分布算出「相似度門檻表」，順便驗證建議門檻的精確率／召回率。

用嵌入庫 JSON 裡的逐張向量重算「查詢照片 vs 參考照片」的相似度分布（留一法），
再對每個候選門檻算：
    認出率（recall）= 同棟配對中 ≥ 門檻的比例
    誤判率（false accept）= 不同棟配對中 ≥ 門檻的比例
    精確率（precision）= 檢索 Top-1 命中的查詢中，分數 ≥ 門檻 的比例

用法：
    python tools/recognize/threshold_table.py public/data/memory-embeddings.json
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "public/data/memory-embeddings.json"
    d = json.load(open(path, encoding="utf-8"))
    ids, vecs = [], []
    for b in d["buildings"]:
        for v in b["vectors"]:
            ids.append(b["id"])
            vecs.append(v)
    V = np.array(vecs, np.float32)
    n = len(V)
    same, diff = [], []
    for i in range(n):
        for j in range(i + 1, n):
            (same if ids[i] == ids[j] else diff).append(float(V[i] @ V[j]))
    same, diff = np.array(same), np.array(diff)

    print(f"{path}")
    print(f"  {n} 張參考 · {len(set(ids))} 棟 · 維度 {V.shape[1]}")
    print(f"  同棟配對 {len(same)} 組：平均 {same.mean():.3f} · 中位 {np.median(same):.3f} · 5% 分位 {np.percentile(same,5):.3f}")
    print(f"  不同棟配對 {len(diff)} 組：平均 {diff.mean():.3f} · 中位 {np.median(diff):.3f} · 95% 分位 {np.percentile(diff,95):.3f}")

    # 檢索：對每張圖，用該棟其他張當庫
    per = defaultdict(list)
    for i, b in enumerate(ids):
        per[b].append(i)
    buildings = sorted(per)
    rows = []
    for i in range(n):
        sc = {}
        for b in buildings:
            o = [j for j in per[b] if j != i]
            if o:
                sc[b] = float(np.max(V[i] @ V[o].T))
        if ids[i] not in sc:
            continue
        r = sorted(sc.items(), key=lambda kv: -kv[1])
        rows.append({"truth": ids[i], "pred": r[0][0], "sim": r[0][1], "truth_sim": sc[ids[i]],
                     "top1": r[0][0] == ids[i]})

    print("\n  門檻   認出率(同棟≥門檻)  誤判率(不同棟≥門檻)  Top-1 命中且≥門檻  未達門檻時 Top-1 仍對")
    table = []
    for thr in [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70, 0.79]:
        rec = float((same >= thr).mean())
        fa = float((diff >= thr).mean())
        conf = [r for r in rows if r["top1"] and r["sim"] >= thr]
        acc = float(np.mean([r["top1"] for r in rows if r["sim"] >= thr])) if any(r["sim"] >= thr for r in rows) else float("nan")
        cov = len(conf) / len(rows)
        table.append({"thr": thr, "recall": round(rec, 4), "false_accept": round(fa, 4),
                      "top1_accuracy_above": round(acc, 4), "coverage": round(cov, 4)})
        print(f"  {thr:.2f}   {rec*100:6.1f}%           {fa*100:6.1f}%              {acc*100:6.1f}%（覆蓋 {cov*100:4.1f}%）")

    # 建議：挑「Top-1 準確率 ≥ 0.9」且覆蓋率最大的門檻
    good = [t for t in table if t["top1_accuracy_above"] >= 0.9]
    pick = max(good, key=lambda t: t["coverage"]) if good else table[0]
    print(f"\n  建議：hit 門檻 = {pick['thr']:.2f}"
          f"（此時 Top-1 準確率 {pick['top1_accuracy_above']*100:.1f}%、"
          f"涵蓋 {pick['coverage']*100:.1f}% 的查詢、同棟認出率 {pick['recall']*100:.1f}%）")
    mid = [t for t in table if t["false_accept"] <= 0.10]
    if mid:
        m = max(mid, key=lambda t: t["thr"])
        print(f"  建議：maybe 門檻 = {m['thr']:.2f}（誤判率 ≤10%）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
