"""易混建築的幾何重排序：只在首位與次位分數接近時，用局部特徵 + RANSAC 內點數重新決定首位。

規則（事先固定，不用測試結果調參）
  觸發：首位與次位的影像分差 < 0.08（留一法中約 14% 的查詢，46/335）
  對 Top-3 每個候選建築：取與查詢最相似的那張參考照片，計算 DISK + LightGlue（或 SIFT）匹配後的 RANSAC 內點數
  改判：內點最多的候選若 ≥ 20 個內點，且比原首位多 ≥ 10 個，才取代原首位；否則維持影像排序
比較：與純影像留一法（ablation A1，即網站現行檢索）逐張配對，McNemar 精確檢定；另報觸發子集的準確率
說明：本腳本由 AI 程式助手（Claude）協助撰寫；結果解讀由研究者負責。
用法：python tools/eval/rerank.py [--method disk|sift]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "eval"))
import ablation as ab  # noqa: E402
import extended as ex  # noqa: E402
from geo_verify import DiskLightGlueMatcher, SiftMatcher  # noqa: E402

MARGIN, MIN_INL, LEAD = 0.08, 20, 10


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--method", default="disk", choices=["disk", "sift"]); a = ap.parse_args()
    refs, ids, y, R = ex.load()
    nb = len(ids); valid = np.bincount(y, minlength=nb)[y] >= 2
    S = R @ R.T; np.fill_diagonal(S, -np.inf)
    sc = ex.building_scores(R, R, y, nb, ~np.eye(len(y), dtype=bool))
    order = np.argsort(-sc, 1)
    base = order[:, 0] == y
    matcher = DiskLightGlueMatcher() if a.method == "disk" else SiftMatcher()
    final = base.copy(); trig = np.zeros(len(y), bool); changed = []
    cache = {}
    for i in np.where(valid)[0]:
        top = order[i, :3]
        if sc[i, top[0]] - sc[i, top[1]] >= MARGIN:
            continue
        trig[i] = True
        inl = []
        for b in top:
            cols = np.where(y == b)[0]
            j = cols[np.argmax(S[i, cols])]
            key = (min(i, j), max(i, j))
            if key not in cache:
                cache[key] = matcher.verify(refs[i]["path"], refs[j]["path"]).get("inliers", 0)
            inl.append(cache[key])
        best = int(np.argmax(inl))
        pick = top[0]
        if best != 0 and inl[best] >= MIN_INL and inl[best] - inl[0] >= LEAD:
            pick = top[best]
            changed.append({"query": refs[i]["path"].name, "truth": ids[y[i]], "from": ids[top[0]], "to": ids[pick], "inliers": inl})
        final[i] = pick == y[i]
    b, f, t = base[valid], final[valid], trig[valid]
    out = {"method": matcher.name, "rule": {"margin": MARGIN, "min_inliers": MIN_INL, "lead": LEAD},
           "n": int(valid.sum()), "triggered": int(t.sum()),
           "top1_base": round(float(b.mean()), 4), "top1_rerank": round(float(f.mean()), 4),
           "triggered_base": round(float(b[t].mean()), 4) if t.any() else None,
           "triggered_rerank": round(float(f[t].mean()), 4) if t.any() else None,
           "mcnemar": ab.mcnemar_exact(b, f), "changed": changed}
    (ROOT / "tools/eval/out" / f"rerank-{a.method}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "changed"}, ensure_ascii=False))
    for c in changed:
        print(" ", c)


if __name__ == "__main__":
    main()
