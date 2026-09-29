"""建築辨識的視覺化展示：查詢照片 → Top-3 候選（含相似度與參考圖）。

為什麼用 import 而不是重寫前處理：嵌入庫是用 build_embeddings.py 的
preprocess/_crops 算出來的，若這裡自己實作一份，只要 resize 或裁切差一點，
向量就會落在不同的分布上，相似度全部失真。直接引用同一份程式碼是唯一能
保證一致的做法。
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = Path(__file__).resolve().parents[2]          # 專案根目錄
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import OnnxEncoder, collect_references  # noqa: E402

CC_DIR = ROOT / "photos-src" / "cc"
OUT = ROOT / "docs" / "figs" / "recognize-demo.png"


def main() -> int:
    data = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    buildings = data["buildings"]
    centroids = np.array([b["centroid"] for b in buildings], np.float32)
    names = [b["zh"] for b in buildings]
    classes = data["categories"]

    encoder = OnnxEncoder(ROOT / "public/models" / data["encoder"]["source"])
    print(f"  編碼器：{data['encoder']['name']} · 建築 {len(buildings)} 棟")

    # 挑三棟參考圖最多的建築當查詢來源（每棟取「一張」當查詢，其餘留作參考）
    picks = sorted(buildings, key=lambda b: -b["count"])[:3]
    fig = plt.figure(figsize=(15, 3.1 * len(picks)), facecolor="#0b0f14")

    for row, target in enumerate(picks):
        query_file = CC_DIR / target["id"] / target["files"][0]
        query_img = Image.open(query_file).convert("RGB")
        v = encoder.embed([query_img])[0].astype(np.float32)
        v /= (np.linalg.norm(v) + 1e-9)

        sims = centroids @ v
        order = np.argsort(-sims)
        hit = order[0] == buildings.index(target)

        # 左：查詢照片
        ax = fig.add_subplot(len(picks), 4, row * 4 + 1, facecolor="#0b0f14")
        ax.imshow(query_img)
        ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f"查詢照片\n{target['zh']}", color="#c8a24a", fontsize=11.5, fontweight="bold")
        for s in ax.spines.values():
            s.set_color("#4ade80" if hit else "#f87171"); s.set_linewidth(2.5)

        # 右三格：Top-3 候選
        for k in range(3):
            idx = int(order[k])
            b = buildings[idx]
            ax = fig.add_subplot(len(picks), 4, row * 4 + 2 + k, facecolor="#0b0f14")
            try:
                ref = Image.open(CC_DIR / b["id"] / b["files"][0]).convert("RGB")
                ax.imshow(ref)
            except Exception:
                ax.text(0.5, 0.5, "（無參考圖）", color="#8fa3b8",
                        ha="center", va="center", transform=ax.transAxes)
            ax.set_xticks([]); ax.set_yticks([])
            ok = idx == buildings.index(target)
            mark = "✓ 正確" if ok else ""
            ax.set_title(f"Top{k+1}  {sims[idx]:.3f}  {mark}\n{b['zh']}",
                         color="#4ade80" if ok else "#e8eef5",
                         fontsize=10, fontweight="bold" if ok else "normal")
            for s in ax.spines.values():
                s.set_color("#4ade80" if ok else "#26374a")
                s.set_linewidth(2.5 if ok else 1)

        print(f"  [{row+1}] {target['zh']}：Top-1 = {names[int(order[0])]}（{sims[int(order[0])]:.3f}）"
              f"{' ✓' if hit else ' ✗'}")

    fig.suptitle(
        f"澳門建築辨識 · DINOv2 ViT-S/14 嵌入 + 餘弦相似度"
        f"｜資料庫 {len(buildings)} 棟 · 自評 Top-1 {data['eval']['top1']*100:.1f}%"
        f" · Top-3 {data['eval']['top3']*100:.1f}%",
        color="#e8eef5", fontsize=14, y=0.995)
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT, dpi=105, facecolor="#0b0f14")
    print(f"  OK 已輸出 {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
