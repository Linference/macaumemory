"""嵌入庫品質診斷：同棟 vs 不同棟的相似度分布、檢索指標。

用法：
    python tools/recognize/analyze_embeddings.py tools/recognize/out/emb-fp32.json
    python tools/recognize/analyze_embeddings.py tools/recognize/out/emb-int8.json
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


def load(path: str):
    d = json.load(open(path, encoding="utf-8"))
    ids, files, demo, vecs = [], [], [], []
    for b in d["buildings"]:
        for i, v in enumerate(b["vectors"]):
            ids.append(b["id"])
            files.append(b.get("files", [""] * (i + 1))[i])
            demo.append(str(b.get("files", [""] * (i + 1))[i]).startswith("MM-") or "demo" in str(b.get("files", [""] * (i + 1))[i]))
            vecs.append(v)
    return d, np.array(ids), files, demo, np.array(vecs, np.float32)


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "tools/recognize/out/emb-fp32.json"
    d, ids, files, demo, V = load(path)
    n = len(V)
    print(f"檔案 {path}")
    print(f"  編碼器 {d['encoder']['name']} · 維度 {V.shape[1]} · {n} 張參考 · {len(set(ids))} 棟")
    norms = np.linalg.norm(V, axis=1)
    print(f"  向量長度：min {norms.min():.5f} max {norms.max():.5f}（應為 1.0）")

    S = V @ V.T
    same, diff = [], []
    for i in range(n):
        for j in range(i + 1, n):
            (same if ids[i] == ids[j] else diff).append(S[i, j])
    same, diff = np.array(same), np.array(diff)
    print(f"  同棟配對 n={len(same)}：平均 {same.mean():.3f} · 中位 {np.median(same):.3f} · 5% 分位 {np.percentile(same,5):.3f}")
    print(f"  不同棟配對 n={len(diff)}：平均 {diff.mean():.3f} · 中位 {np.median(diff):.3f} · 95% 分位 {np.percentile(diff,95):.3f}")
    # AUC（同棟分數應該高於不同棟）
    allv = np.concatenate([same, diff])
    lab = np.concatenate([np.ones(len(same)), np.zeros(len(diff))])
    order = np.argsort(allv)
    ranks = np.empty(len(allv)); ranks[order] = np.arange(1, len(allv) + 1)
    auc = (ranks[lab == 1].sum() - len(same) * (len(same) + 1) / 2) / (len(same) * len(diff)) if len(same) and len(diff) else float("nan")
    print(f"  AUC(同棟>不同棟) = {auc:.3f}")

    # 檢索：對每張圖，用「該棟其他張」當庫
    per = defaultdict(list)
    for i, b in enumerate(ids):
        per[b].append(i)
    buildings = sorted(per)
    bidx = {b: k for k, b in enumerate(buildings)}

    rows = []
    for i in range(n):
        scores = {}
        for b in buildings:
            others = [j for j in per[b] if j != i]
            if not others:
                continue
            scores[b] = float(np.max(S[i, others]))
        if ids[i] not in scores:
            continue                                   # 該棟只有這一張，無法查詢
        rank = sorted(scores.items(), key=lambda kv: -kv[1])
        pos = [b for b, _ in rank].index(ids[i])
        top1 = pos == 0
        top3 = pos < 3
        margin = rank[0][1] - rank[1][1] if len(rank) > 1 else 1.0
        rows.append({"file": files[i], "truth": ids[i], "pred": rank[0][0], "sim": rank[0][1],
                     "truth_sim": scores[ids[i]], "pos": pos, "top1": top1, "top3": top3, "margin": margin})

    t1 = sum(r["top1"] for r in rows) / len(rows)
    t3 = sum(r["top3"] for r in rows) / len(rows)
    print(f"\n留一法檢索（{len(rows)} 張可查詢，{len(buildings)} 棟候選）")
    print(f"  Top-1 {t1*100:.1f}%   Top-3 {t3*100:.1f}%")
    print(f"  命中時相似度 平均 {np.mean([r['truth_sim'] for r in rows]):.3f}")
    print(f"  第一名與第二名差距 平均 {np.mean([r['margin'] for r in rows]):.3f}")

    print("\n  最常被搞混的（真→誤判）：")
    wrong = Counter((r["truth"], r["pred"]) for r in rows if not r["top1"])
    for (t, p), c in wrong.most_common(8):
        print(f"    {t:22s} → {p:22s} ×{c}")

    print("\n  難以辨識的樣本（正確答案排很後面）：")
    for r in sorted(rows, key=lambda r: -r["pos"])[:6]:
        print(f"    {r['file'][:46]:46s} 真={r['truth']:20s} 名次={r['pos']+1:2d} 命中相似度={r['truth_sim']:.3f} 預測={r['pred']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
