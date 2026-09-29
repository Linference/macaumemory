"""「建築記憶點」重辨識評測主程式。

跑完會產生（全部在 tools/eval/out/）：
    embeddings.npz      每張圖的 CLIP 影像向量（可重現，不必重算）
    pairs_*.csv         每個實驗的所有配對與相似度
    metrics.json        全部量化結果（AUC、最佳閾值、TPR/FPR…）
    fig-*.png / .svg    可直接放展板的圖
    report.md           自動生成的結果報告（含方法、數據、限制）

用法：
    python tools/eval/evaluate.py
    python tools/eval/evaluate.py --experiments=e1,e2      # 只跑部分
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import random
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix

from dino_embed import build_scorer

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "tools" / "eval"
DATASET_CSV = EVAL / "dataset" / "dataset.csv"
OUT = EVAL / "out"
SEED = 20260923
random.seed(SEED)
np.random.seed(SEED)

plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Microsoft YaHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

ACCENT, ACCENT2, MUTED = "#c0392b", "#2c6fbb", "#7f8c8d"


# ---------------------------------------------------------------- 資料
def load_dataset():
    if not DATASET_CSV.exists():
        raise SystemExit("找不到 dataset.csv，請先跑 python tools/eval/build_dataset.py")
    with DATASET_CSV.open(encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f)]
    for r in rows:
        r["path"] = ROOT / r["file"]
    missing = [r["file"] for r in rows if not r["path"].exists()]
    if missing:
        print(f"[warn] {len(missing)} 個檔案不存在，已排除（例：{missing[:3]}）")
        rows = [r for r in rows if r["path"].exists()]
    return rows


def embed_all(rows, scorer):
    # 快取必須「依編碼器分開」：否則換成 DINOv2 時會直接沿用 CLIP 的舊特徵，
    # 產生看起來合理、實際上完全錯誤的對照結果（這是最危險的一種錯誤）。
    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(scorer.model_name).split("/")[-1])[:48]
    cache_path = OUT / f"embeddings-{slug}.npz"
    cache = {}
    if cache_path.exists():
        z = np.load(cache_path, allow_pickle=True)
        cache = {k: z[k] for k in z.files}
    todo = [r for r in rows if r["file"] not in cache]
    if todo:
        print(f"[{slug}] 需要計算 {len(todo)} 張（快取已有 {len(cache)} 張）…")
        feats = scorer.embed_images([str(r["path"]) for r in todo])
        for r, f in zip(todo, feats):
            cache[r["file"]] = f.astype(np.float32)
        OUT.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache_path, **cache)
    for r in rows:
        r["vec"] = cache[r["file"]]
    return rows


# ---------------------------------------------------------------- 配對與指標
def cos(a, b):
    return float(np.dot(a, b))


def make_pairs(rows, pos_filter, neg_filter, max_neg=6000, label=""):
    """pos_filter/neg_filter: (row_a, row_b) -> bool，決定哪些配對算正/負樣本。"""
    sims, labels, meta = [], [], []
    groups = defaultdict(list)
    for r in rows:
        groups[r["building_id"]].append(r)

    for bid, items in groups.items():
        for a, b in itertools.combinations(items, 2):
            if pos_filter(a, b):
                sims.append(cos(a["vec"], b["vec"]))
                labels.append(1)
                meta.append((a["file"], b["file"], bid))

    all_items = [r for r in rows]
    negs = []
    for a, b in itertools.combinations(all_items, 2):
        if a["building_id"] == b["building_id"]:
            continue
        if neg_filter(a, b):
            negs.append((a, b))
    random.shuffle(negs)
    for a, b in negs[:max_neg]:
        sims.append(cos(a["vec"], b["vec"]))
        labels.append(0)
        meta.append((a["file"], b["file"], f'{a["building_id"]}|{b["building_id"]}'))

    sims = np.asarray(sims, np.float64)
    labels = np.asarray(labels, np.int32)
    print(f"[{label}] 正樣本 {int(labels.sum())} · 負樣本 {int((1 - labels).sum())}")
    return sims, labels, meta


def threshold_metrics(sims, labels, thresholds=(0.70, 0.86)):
    out = {}
    if len(set(labels.tolist())) < 2:
        return {"auc": None, "note": "只有單一類別，無法計算 AUC"}
    fpr, tpr, thr = roc_curve(labels, sims)
    auc = float(roc_auc_score(labels, sims))
    j = tpr - fpr
    best_i = int(np.argmax(j))
    out.update(
        auc=auc,
        best_threshold=float(thr[best_i]),
        best_tpr=float(tpr[best_i]),
        best_fpr=float(fpr[best_i]),
        youden_j=float(j[best_i]),
    )
    for t in thresholds:
        pred = sims >= t
        tp = int(((pred == 1) & (labels == 1)).sum())
        fn = int(((pred == 0) & (labels == 1)).sum())
        fp = int(((pred == 1) & (labels == 0)).sum())
        tn = int(((pred == 0) & (labels == 0)).sum())
        out[f"t{t:.2f}"] = dict(
            tpr=tp / max(tp + fn, 1), fpr=fp / max(fp + tn, 1),
            precision=tp / max(tp + fp, 1), recall=tp / max(tp + fn, 1),
            accuracy=(tp + tn) / max(tp + fn + fp + tn, 1),
            tp=tp, fp=fp, fn=fn, tn=tn,
        )
    pos, neg = sims[labels == 1], sims[labels == 0]
    out.update(
        pos_mean=float(pos.mean()), pos_std=float(pos.std()),
        neg_mean=float(neg.mean()), neg_std=float(neg.std()),
        pos_p05=float(np.percentile(pos, 5)), pos_p95=float(np.percentile(pos, 95)),
        neg_p95=float(np.percentile(neg, 95)), neg_p99=float(np.percentile(neg, 99)),
        separation=float(pos.mean() - neg.mean()),
    )
    # 閾值掃描表（給展板與決策用）
    table = []
    for t in np.round(np.arange(0.70, 0.925, 0.02), 2):
        pred = sims >= t
        tp = int(((pred == 1) & (labels == 1)).sum())
        fn = int(((pred == 0) & (labels == 1)).sum())
        fp = int(((pred == 1) & (labels == 0)).sum())
        tn = int(((pred == 0) & (labels == 0)).sum())
        table.append(dict(t=float(t), recall=tp / max(tp + fn, 1), fpr=fp / max(fp + tn, 1),
                          precision=tp / max(tp + fp, 1), accuracy=(tp + tn) / max(tp + fn + fp + tn, 1)))
    out["threshold_table"] = table
    return out


def save_pairs(name, sims, labels, meta):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"pairs_{name}.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["file_a", "file_b", "building", "same", "cosine"])
        for (a, b, bid), s, y in zip(meta, sims, labels):
            w.writerow([a, b, bid, int(y), f"{s:.6f}"])
    return p


# ---------------------------------------------------------------- 圖表
def fig_hist(sims, labels, name, title, path_png):
    pos, neg = sims[labels == 1], sims[labels == 0]
    bins = np.linspace(min(sims.min(), 0.2), 1.0, 60)
    fig, ax = plt.subplots(figsize=(8.6, 4.6), dpi=160)
    ax.hist(neg, bins=bins, alpha=0.62, label=f"不同建築（n={len(neg)}）", color=MUTED, density=True)
    ax.hist(pos, bins=bins, alpha=0.78, label=f"同一建築（n={len(pos)}）", color=ACCENT, density=True)
    for t, c, ls in ((0.70, ACCENT2, "--"), (0.86, "#1b7a3f", "-.")):
        ax.axvline(t, color=c, ls=ls, lw=1.6, label=f"現行閾值 {t:.2f}")
    ax.set_xlabel("CLIP 影像向量餘弦相似度")
    ax.set_ylabel("機率密度")
    ax.set_title(title)
    ax.legend(fontsize=9)
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(path_png)
    fig.savefig(str(path_png).replace(".png", ".svg"))
    plt.close(fig)


def fig_roc(curves, path_png):
    fig, ax = plt.subplots(figsize=(5.4, 5.0), dpi=160)
    for label, (fpr, tpr, auc) in curves.items():
        ax.plot(fpr, tpr, lw=2, label=f"{label}（AUC={auc:.3f}）")
    ax.plot([0, 1], [0, 1], ls=":", color=MUTED, lw=1)
    ax.set_xlabel("偽陽性率 FPR（把不同建築誤判成同棟）")
    ax.set_ylabel("真陽性率 TPR（同棟認出率）")
    ax.set_title("重辨識 ROC 曲線")
    ax.legend(fontsize=9, loc="lower right")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(path_png)
    fig.savefig(str(path_png).replace(".png", ".svg"))
    plt.close(fig)


def fig_threshold(sims, labels, path_png, current=(0.70, 0.86)):
    ts = np.linspace(0.3, 0.99, 200)
    tpr = [(sims[labels == 1] >= t).mean() for t in ts]
    fpr = [(sims[labels == 0] >= t).mean() for t in ts]
    fig, ax = plt.subplots(figsize=(8.6, 4.4), dpi=160)
    ax.plot(ts, tpr, color=ACCENT, lw=2, label="同棟認出率 TPR")
    ax.plot(ts, fpr, color=ACCENT2, lw=2, label="誤判率 FPR")
    best = ts[int(np.argmax(np.array(tpr) - np.array(fpr)))]
    ax.axvline(best, color="#1b7a3f", ls="-.", lw=1.6, label=f"最佳閾值 {best:.3f}")
    for t in current:
        ax.axvline(t, color=MUTED, ls=":", lw=1.2)
    ax.set_xlabel("相似度閾值")
    ax.set_ylabel("比率")
    ax.set_title("閾值選擇：認出率與誤判率的取捨")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(path_png)
    fig.savefig(str(path_png).replace(".png", ".svg"))
    plt.close(fig)


def fig_bar(metrics_by_exp, path_png):
    labels = [k for k, v in metrics_by_exp.items() if v.get("auc") is not None]
    aucs = [metrics_by_exp[k]["auc"] for k in labels]
    fig, ax = plt.subplots(figsize=(8.6, 3.8), dpi=160)
    bars = ax.bar(range(len(labels)), aucs, color=[ACCENT, ACCENT2, "#1b7a3f", "#8e44ad"][:len(labels)])
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylim(0.5, 1.02)
    ax.axhline(1.0, color=MUTED, ls=":", lw=1)
    ax.set_ylabel("AUC")
    ax.set_title("各實驗的辨識能力（AUC 越接近 1 越好）")
    for b, a in zip(bars, aucs):
        ax.text(b.get_x() + b.get_width() / 2, a + 0.008, f"{a:.3f}", ha="center", fontsize=9)
    ax.grid(alpha=0.25, axis="y")
    fig.tight_layout()
    fig.savefig(path_png)
    fig.savefig(str(path_png).replace(".png", ".svg"))
    plt.close(fig)


def fig_confusion(cm, class_ids, path_png, acc):
    fig, ax = plt.subplots(figsize=(6.4, 5.6), dpi=160)
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(class_ids)))
    ax.set_yticks(range(len(class_ids)))
    ax.set_xticklabels(class_ids, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(class_ids, fontsize=8)
    for i in range(len(class_ids)):
        for j in range(len(class_ids)):
            if cm[i, j]:
                ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=8,
                        color="white" if cm[i, j] > cm.max() * 0.6 else "black")
    ax.set_xlabel("CLIP 判定")
    ax.set_ylabel("實際類別")
    ax.set_title(f"零樣本分類混淆矩陣（top-1 準確率 {acc:.1%}）")
    fig.colorbar(im, ax=ax, shrink=0.8)
    fig.tight_layout()
    fig.savefig(path_png)
    fig.savefig(str(path_png).replace(".png", ".svg"))
    plt.close(fig)


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--experiments", default="e1,e1r,e2,e3,e4,e5,e6")
    ap.add_argument("--encoder", default="clip", choices=["clip", "dino"],
                    help="影像編碼器：clip（原基準）或 dino（DINOv2，重辨識用）")
    ap.add_argument("--dino-model", default="facebook/dinov2-base")
    ap.add_argument("--dino-size", type=int, default=518, help="DINOv2 輸入邊長（224/336/518）")
    ap.add_argument("--dino-pool", default="cls+gem", choices=["cls", "gem", "cls+gem"])
    ap.add_argument("--dino-no-tta", action="store_true", help="關閉水平翻轉增強")
    ap.add_argument("--dino-resize", default="squash", choices=["squash", "shortest"])
    ap.add_argument("--out-suffix", default="", help="輸出檔名後綴，避免覆蓋 CLIP 的報告")
    args = ap.parse_args()
    want = {s.strip() for s in args.experiments.split(",")}
    OUT.mkdir(parents=True, exist_ok=True)

    rows = load_dataset()
    if args.encoder == "dino":
        scorer = build_scorer("dino", model_id=args.dino_model, size=args.dino_size,
                              pool=args.dino_pool, tta=not args.dino_no_tta, resize=args.dino_resize)
    else:
        scorer = build_scorer("clip")
    print(f"[{args.encoder}] 模型 {scorer.model_name} · 裝置 {scorer.device} · scale {scorer.scale:.1f}")
    rows = embed_all(rows, scorer)

    results, curves = {}, {}

    def run(name, subset, pos_f, neg_f, desc, save=True, chart=True):
        sims, labels, meta = make_pairs(subset, pos_f, neg_f, label=name)
        m = threshold_metrics(sims, labels)
        m["description"] = desc
        m["n_pos"] = int(labels.sum())
        m["n_neg"] = int((1 - labels).sum())
        results[name] = m
        if save:
            save_pairs(name, sims, labels, meta)
        if chart and m.get("auc") is not None:
            fpr, tpr, _ = roc_curve(labels, sims)
            curves[name] = (fpr, tpr, m["auc"])
            fig_hist(sims, labels, name, f"{name}：同棟 vs 不同棟相似度分布", OUT / f"fig-hist-{name}.png")
        return sims, labels, m

    buildings = [r for r in rows if r["class_id"] != "artifact"]
    artifacts = [r for r in rows if r["class_id"] == "artifact"]
    base = lambda r: r["tier"] == "render-base"
    cross = lambda r: r["tier"] in ("render-cond", "render-cond2")
    b_base = [r for r in buildings if base(r)]

    if "e1" in want:
        run("E1_渲染同環境", b_base, lambda a, b: True, lambda a, b: True,
            "5 棟建築 GLB 多視角渲染，同一環境環繞 12 方位角。這是最乾淨的受控條件。")
        if artifacts:
            run("E1b_文物", [r for r in artifacts if base(r)], lambda a, b: True, lambda a, b: True,
                "兩件文物（唐三彩駱駝、青花扁瓶）的多視角重辨識。")

    cc = [r for r in rows if r["tier"] == "real-cc"]
    cc_by_b = defaultdict(list)
    for r in cc:
        cc_by_b[r["building_id"]].append(r)
    cc_rich = [r for r in cc if len(cc_by_b[r["building_id"]]) >= 2]
    if "e1r" in want and len(cc_by_b) >= 3:
        run("E1r_實拍真實照片", cc_rich, lambda a, b: True, lambda a, b: True,
            f"Wikimedia Commons 實拍照片：{len(cc_by_b)} 棟建築、每棟 ≥2 張（不同攝影者／年份／角度／光線）。"
            "這是**真實世界**的重辨識表現，也是本專案最重要的一組數字。")

    if "e2" in want:
        run("E2_跨條件", buildings,
            lambda a, b: (base(a) and cross(b)) or (base(b) and cross(a)),
            lambda a, b: (base(a) and cross(b)) or (base(b) and cross(a)) or (cross(a) and cross(b)),
            "同棟但改變仰角（7°/20°/42°）、距離（0.72~1.28 倍）與光照（棚拍／陰天／夕陽）→ 模擬不同時間與天氣重拍。")

    if "e3" in want:
        # 文物 vs 建築：不同種類卻長得都像「立體模型」時的誤併風險
        cross_pairs = [cos(a["vec"], b["vec"]) for a in artifacts for b in b_base]
        if cross_pairs:
            v = np.array(cross_pairs)
            results["E3_文物與建築的誤併風險"] = dict(
                description="把文物與建築交叉配對，看有多少會超過歸戶閾值（越低越好）",
                n_pairs=len(v), mean=float(v.mean()), max=float(v.max()),
                p95=float(np.percentile(v, 95)),
                over_070=int((v >= 0.70).sum()), over_086=int((v >= 0.86).sum()),
            )

    if "e4" in want:
        # 跨域：GLB 渲染 ↔（地圖截圖／Commons 實拍）同一棟建築
        dom = {}
        for counterpart in ("demo-map", "real-cc"):
            pairs = []
            for bid in {r["building_id"] for r in rows}:
                rend = [r for r in rows if r["building_id"] == bid and base(r)]
                other = [r for r in rows if r["building_id"] == bid and r["tier"] == counterpart]
                for o in other:
                    for r in rend:
                        pairs.append((bid, cos(r["vec"], o["vec"])))
            if pairs:
                vals = np.array([v for _, v in pairs])
                dom[counterpart] = dict(
                    n_pairs=len(vals), mean=float(vals.mean()), std=float(vals.std()),
                    min=float(vals.min()), max=float(vals.max()),
                    by_building={b: round(float(np.mean([v for bb, v in pairs if bb == b])), 4)
                                 for b in sorted({b for b, _ in pairs})})
        if dom:
            results["E4_跨域（渲染↔實拍/截圖）"] = dict(
                description="同一棟建築、不同呈現方式之間的相似度：數值越低代表域偏移越大，"
                            "也就越不能把渲染圖上調好的閾值直接套到實拍照片。",
                **{k: v for k, v in dom.items()})

    if "e5" in want:
        # 資料洩漏對照：既有 pipeline 的「同棟第二張」其實是裁切圖
        leak = []
        for bid in {r["building_id"] for r in rows}:
            crop = [r for r in rows if r["building_id"] == bid and r["tier"] == "demo-crop"]
            demo = [r for r in rows if r["building_id"] == bid and r["tier"] == "demo-map"]
            for c in crop:
                for d in demo:
                    leak.append((bid, cos(c["vec"], d["vec"])))
        ref_sims, ref_labels, _ = make_pairs(b_base, lambda a, b: True, lambda a, b: True, label="E5_ref")
        ref_same = ref_sims[ref_labels == 1]
        results["E5_洩漏對照"] = dict(
            description="同一棟的『第二張照片』若是原圖裁切，相似度會虛高；與真正不同視角的同棟相似度對比",
            crop_pairs={b: round(float(np.mean([v for bb, v in leak if bb == b])), 4) for b in sorted({b for b, _ in leak})},
            n_crop=len(leak),
            render_same_mean=float(ref_same.mean()), render_same_p05=float(np.percentile(ref_same, 5)),
            render_same_p50=float(np.percentile(ref_same, 50)),
        )

    if "e6" in want and args.encoder == "clip":
        class_ids, prompts, owner = scorer.taxonomy_vectors()
        text_feats = scorer.embed_texts(prompts)
        eval_rows = [r for r in buildings if r["class_id"] in class_ids]  # 文物不在 12 類體系內
        feats = np.stack([r["vec"] for r in eval_rows])
        probs_c, probs_l, _ = scorer.classify(feats, text_feats, owner, len(class_ids))
        y_true = np.array([class_ids.index(r["class_id"]) for r in eval_rows])
        y_c = probs_c.argmax(1)
        y_l = probs_l.argmax(1)
        acc_c = float((y_c == y_true).mean())
        acc_l = float((y_l == y_true).mean())
        present = sorted(set(y_true.tolist()))
        cm = confusion_matrix(y_true, y_c, labels=present)
        fig_confusion(cm, [class_ids[i] for i in present], OUT / f"fig-confusion{args.out_suffix}.png", acc_c)
        top1_conf = probs_c.max(1)
        # 依來源分層看準確率（渲染 vs 真實照片）——這是本實驗最有意義的對比
        tiers = {}
        for tier_name, mask in (("render（3D 渲染）", np.array([r["tier"].startswith("render") for r in eval_rows])),
                                ("real-cc（Commons 實拍）", np.array([r["tier"] == "real-cc" for r in eval_rows])),
                                ("demo-map（地圖截圖）", np.array([r["tier"] == "demo-map" for r in eval_rows]))):
            if mask.sum() >= 5:
                tiers[tier_name] = dict(n=int(mask.sum()), accuracy=float((y_c[mask] == y_true[mask]).mean()))
        results["E6_零樣本分類"] = dict(
            description="12 類澳門建築分類（taxonomy.py 的 30 條提示詞）；實際類別涵蓋 "
                        f"{len(present)} 類。標註由本專案依建築身分指派，非獨立第三方標註。",
            n=len(eval_rows),
            accuracy_standard=acc_c, accuracy_legacy=acc_l,
            agreement_between_aggregations=float((y_c == y_l).mean()),
            mean_top1_confidence=float(top1_conf.mean()),
            accuracy_by_tier=tiers,
            per_class={class_ids[i]: int((y_true == i).sum()) for i in present},
            predictions={class_ids[i]: int((y_c == i).sum()) for i in range(len(class_ids)) if (y_c == i).any()},
        )

    # ---- 輸出
    if "E1_渲染同環境" in results:
        sims, labels, _ = make_pairs(b_base, lambda a, b: True, lambda a, b: True, label="E1_threshold")
        fig_threshold(sims, labels, OUT / f"fig-threshold{args.out_suffix}.png")

    if curves:
        fig_roc(curves, OUT / f"fig-roc{args.out_suffix}.png")
        fig_bar({k: v for k, v in results.items() if v.get("auc") is not None}, OUT / f"fig-auc{args.out_suffix}.png")

    (OUT / f"metrics{args.out_suffix}.json").write_text(
        json.dumps(dict(generated=__import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
                        clip_model=scorer.model_name, seed=SEED, results=results), ensure_ascii=False, indent=1),
        encoding="utf-8")
    write_report(rows, results, args.out_suffix)
    print(f"\n[done] 結果在 {OUT.relative_to(ROOT)}/（metrics{args.out_suffix}.json、report{args.out_suffix}.md、fig-*.png）")


def write_report(rows, results, suffix: str = ""):
    L = []
    A = L.append
    A("# 建築記憶點 · 重辨識評測報告\n")
    A(f"生成時間：{__import__('time').strftime('%Y-%m-%d %H:%M')}　|　資料集：{len(rows)} 張影像\n")
    A("## 一、方法\n")
    A("1. **資料來源**：本專案 7 個 GLB 模型（5 棟建築 + 2 件文物）以 VTK 離屏渲染，"
      "每個模型 20 個視角（12 方位角 + 8 組跨條件）；另有 4 張既有「3D 地圖截圖」。")
    A("2. **取像分層**：`render-base` 同環境環繞；`render-cond/cond2` 改變仰角、距離與光照；`demo-map` 為地圖截圖；")
    A("   `demo-crop` 是舊流程用同張截圖裁切出的『第二張』，**主實驗排除**，只用於洩漏對照。")
    A("3. **相似度**：CLIP ViT-B/32 影像向量（L2 正規化）之餘弦相似度。")
    A("4. **判定**：相似度 ≥ 閾值視為同一棟（記憶點歸戶）。")
    A("5. **可重現性**：`python tools/eval/render_views.py && python tools/eval/build_dataset.py && python tools/eval/evaluate.py`，"
      f"隨機種子固定為 {SEED}。")
    A("6. **範圍界定（重要）**：本報告的每一項指標都只衡量 **CLIP 影像嵌入**的重辨識能力。"
      "YOLO 僅用於物件偵測與隱私模糊，**不參與任何受測指標**；其實測結果另見 "
      "`tools/eval/out/yolo-check.json`（6 張測試圖中 1 張偵測到物件且類別錯誤，因人臉級聯在 OpenCV 5 不可用，"
      "已改用 YOLO person 模糊模式）。\n")

    A("## 二、結果\n")
    for name, m in results.items():
        A(f"### {name}\n")
        A(f"{m.get('description','')}\n")
        if m.get("auc") is not None:
            A(f"- 配對數：正樣本 {m['n_pos']}、負樣本 {m['n_neg']}")
            A(f"- **AUC = {m['auc']:.3f}**；最佳閾值 {m['best_threshold']:.3f}（TPR {m['best_tpr']:.3f} / FPR {m['best_fpr']:.3f}）")
            A(f"- 同棟相似度：{m['pos_mean']:.3f} ± {m['pos_std']:.3f}（5% 分位 {m['pos_p05']:.3f}）")
            A(f"- 不同棟相似度：{m['neg_mean']:.3f} ± {m['neg_std']:.3f}（95% 分位 {m['neg_p95']:.3f}）")
            A("")
            if m.get("threshold_table"):
                A("| 閾值 | 認出率 TPR | 誤判率 FPR | 精確率 | 整體正確率 |")
                A("|---|---|---|---|---|")
                for row in m["threshold_table"]:
                    A(f"| {row['t']:.2f} | {row['recall']:.3f} | {row['fpr']:.3f} | {row['precision']:.3f} | {row['accuracy']:.3f} |")
                A("")
        else:
            for k, v in m.items():
                if k == "description":
                    continue
                A(f"- {k}: {json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v}")
        A("")
    A("## 三、結論與限制\n")
    A("- 受控條件下（同環境多視角）CLIP 影像向量能有效區分同棟／不同棟，閾值 0.86 的誤判率見上表。")
    A("- 跨條件（不同仰角、距離、光照）性能會下降，這正是實拍情境，也是需要 GPS 先驗輔助的原因。")
    A("- 渲染影像非真實照片：本報告的用途是**受控實驗**，真實世界的準確率需由實拍資料集驗證（見 `photos-src/real/`）。")
    A("- 樣本量限制：分類實驗（E6）實際類別僅涵蓋 3 類，僅作 sanity check，不能宣稱 12 類準確率。\n")
    (OUT / f"report{suffix}.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
