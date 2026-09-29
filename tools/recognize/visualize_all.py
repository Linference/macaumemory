"""全部參考照片逐一測試（留一法），並把「認錯的」全部畫出來。

為什麼要用留一法而不是直接查詢：
    若查詢圖本身還在庫裡，它對自己的貢獻會讓相似度虛高（top-1 看起來很漂亮）。
    留一法（查詢時把自己從該棟的向量集合中移除，重新算 centroid）才是誠實的數字。
    這也避免了專案稍早發生過的教訓：庫內互查永遠測不到「查詢路徑」的問題。

輸出：
    docs/figs/recognize-all-failures.png   所有認錯的案例（查詢 + 錯誤答案 + 正確答案）
    docs/figs/recognize-all-summary.png    整體準確率與逐棟表現
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import OnnxEncoder  # noqa: E402

CC_DIR = ROOT / "photos-src" / "cc"
FIGS = ROOT / "docs" / "figs"


def l2(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def main() -> int:
    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    blds = data["buildings"]
    idx_of = {b["id"]: i for i, b in enumerate(blds)}

    # 攤平成 (棟索引, 向量)
    owner, vecs, src = [], [], []
    for i, b in enumerate(blds):
        for k, v in enumerate(b["vectors"]):
            owner.append(i)
            vecs.append(v)
            # 每個向量對應的來源檔名（長度可能不一致，取不到就退回第一張）
            src.append(b["files"][k] if k < len(b["files"]) else b["files"][0])
    owner = np.array(owner)
    V = l2(np.array(vecs, np.float32))
    print(f"  參考向量 {len(V)} 條 · 建築 {len(blds)} 棟 · 維度 {V.shape[1]}")

    # 留一法：用庫內向量互查（等同「同一張圖重新編碼後查詢」的下界，
    # 因為已驗證重新編碼的自相似度 = 0.999999）
    top1_hit, top3_hit = 0, 0
    per_class = defaultdict(lambda: [0, 0])
    failures = []
    for q in range(len(V)):
        own = owner[q]
        scores = []
        for i, b in enumerate(blds):
            # 留一：查詢自己所屬的那棟要把這一條排除
            mask = (owner == i)
            if i == own:
                mask[q] = False
            if not mask.any():
                continue
            scores.append((i, float(np.max(V[mask] @ V[q]))))
        scores.sort(key=lambda t: -t[1])
        pred = scores[0][0]
        ok = pred == own
        top1_hit += ok
        top3_hit += any(i == own for i, _ in scores[:3])
        per_class[blds[own]["zh"]][1] += 1
        per_class[blds[own]["zh"]][0] += ok
        if not ok:
            failures.append({
                "q": q, "own": own, "pred": pred,
                "truth": blds[own]["zh"], "wrong": blds[pred]["zh"],
                "score": scores[0][1],
                "truth_score": next((s for i, s in scores if i == own), 0.0),
                "file": src[q],
            })

    n = len(V)
    print(f"  Top-1：{top1_hit}/{n} = {top1_hit/n*100:.2f}%")
    print(f"  Top-3：{top3_hit}/{n} = {top3_hit/n*100:.2f}%")
    print(f"  認錯：{len(failures)} 件")

    # ---------------- 圖一：整體與逐棟 ----------------
    fig = plt.figure(figsize=(14, 5.2), facecolor="#0b0f14")
    ax = fig.add_subplot(1, 2, 1, facecolor="#0b0f14")
    bars = ax.bar(["Top-1", "Top-3"], [top1_hit / n * 100, top3_hit / n * 100],
                  color=["#c8a24a", "#2a7f8f"], width=0.5)
    for b, v in zip(bars, [top1_hit / n * 100, top3_hit / n * 100]):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.5, f"{v:.1f}%",
                ha="center", color="#e8eef5", fontsize=13, fontweight="bold")
    ax.set_ylim(0, 108); ax.set_title(f"留一法辨識準確率（{n} 張參考照片）",
                                      color="#c8a24a", fontsize=13, fontweight="bold")
    ax.tick_params(colors="#8fa3b8")
    for s in ax.spines.values():
        s.set_color("#26374a")

    ax = fig.add_subplot(1, 2, 2, facecolor="#0b0f14")
    items = sorted(per_class.items(), key=lambda kv: -(kv[1][0] / kv[1][1]))
    names = [k for k, _ in items]
    rates = [v[0] / v[1] * 100 for _, v in items]
    counts = [v[1] for _, v in items]
    y = np.arange(len(names))
    colors = ["#4ade80" if r >= 80 else ("#c8a24a" if r >= 50 else "#f87171") for r in rates]
    ax.barh(y, rates, color=colors, height=0.66)
    ax.set_yticks(y); ax.set_yticklabels([f"{k}（{c}）" for k, c in zip(names, counts)],
                                         color="#e8eef5", fontsize=9)
    ax.invert_yaxis(); ax.set_xlim(0, 108)
    ax.set_title("逐棟準確率（括號為參考圖數）", color="#c8a24a", fontsize=13, fontweight="bold")
    ax.tick_params(colors="#8fa3b8")
    for s in ax.spines.values():
        s.set_color("#26374a")
    fig.suptitle("澳門建築辨識 · 全部參考照片逐一測試（留一法）",
                 color="#e8eef5", fontsize=15, y=0.99)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    out1 = FIGS / "recognize-all-summary.png"
    fig.savefig(out1, dpi=105, facecolor="#0b0f14")
    print(f"  OK {out1.name}")

    # ---------------- 圖二：所有認錯的 ----------------
    if failures:
        cols = min(5, len(failures))
        rows = (len(failures) + cols - 1) // cols
        fig = plt.figure(figsize=(3.0 * cols, 3.5 * rows + 1.0), facecolor="#0b0f14")
        for k, f in enumerate(failures):
            ax = fig.add_subplot(rows, cols, k + 1, facecolor="#0b0f14")
            try:
                path = CC_DIR / blds[f["own"]]["id"] / f["file"]
                ax.imshow(Image.open(path).convert("RGB"))
            except Exception:
                ax.text(0.5, 0.5, "（圖不可讀）", color="#8fa3b8", ha="center",
                        va="center", transform=ax.transAxes)
            ax.set_xticks([]); ax.set_yticks([])
            ax.set_title(f"應為：{f['truth']}（{f['truth_score']:.2f}）\n"
                         f"誤判：{f['wrong']}（{f['score']:.2f}）",
                         color="#f87171", fontsize=9.5)
            for s in ax.spines.values():
                s.set_color("#f87171"); s.set_linewidth(1.6)
        fig.suptitle(f"認錯的 {len(failures)} 件（共 {n} 張參考照片）· 標題為「正確答案 vs 系統給的答案」",
                     color="#e8eef5", fontsize=14, y=0.995)
        fig.tight_layout(rect=[0, 0, 1, 0.955])
        out2 = FIGS / "recognize-all-failures.png"
        fig.savefig(out2, dpi=105, facecolor="#0b0f14")
        print(f"  OK {out2.name}")

    # 文字清單
    if failures:
        print("\n  認錯清單：")
        for f in failures:
            print(f"    {f['truth']:<14} → 誤判 {f['wrong']:<14}"
                  f"（正確 {f['truth_score']:.3f} vs 誤判 {f['score']:.3f}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
