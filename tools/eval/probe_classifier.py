"""③ 用 VLM 標註訓練線性探針分類器，取代 CLIP 零樣本分類。

思路（對應 OpenFACADES 那篇的結論：微調過的模型勝過 zero-shot）：
    ① 用 DeepSeek 視覺模型為訓練集圖產生類別標籤（已存在 .cache/vlm/labels.json）
    ② 以 DINOv2 凍結特徵 + 邏輯迴歸（線性探針）訓練分類器
    ③ 在**完全獨立的實拍 CC 照片集**上評估 top-1 準確率，與 CLIP 零樣本（實測 53.5%）對照

為什麼用線性探針而不是微調整個網路：
    資料量只有幾百張，微調大模型會過擬合；凍結特徵＋線性分類器是低資料量下的標準做法，
    訓練只要幾秒、可完整交叉驗證，而且結果可解釋（每個類別一個權重向量）。

用法：
    python tools/eval/probe_classifier.py                 # 訓練 + 評估
    python tools/eval/probe_classifier.py --encoder clip  # 用 CLIP 特徵對照
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "eval" / "out"
VLM_CACHE = ROOT / ".cache" / "vlm" / "labels.json"
DS = ROOT / "datasets" / "macau-buildings"
sys.path.insert(0, str(ROOT / "tools" / "eval"))
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))

CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]


def dataset_rows():
    """YOLO 資料集圖（train+val），附 VLM 標籤。"""
    labels = json.loads(VLM_CACHE.read_text(encoding="utf-8")) if VLM_CACHE.exists() else {}
    # 快取鍵是 Windows 反斜線路徑；統一轉成正斜線再查找，避免兩邊格式不一致而全部落空
    labels = {k.replace("\\", "/"): v for k, v in labels.items()}
    rows = []
    for split in ("train", "val"):
        for p in sorted((DS / "images" / split).glob("*")):
            key = str(p.relative_to(ROOT)).replace("\\", "/")
            v = labels.get(key, {})
            cls = v.get("class")
            if cls in CLASSES and float(v.get("confidence") or 0) >= 0.5:
                rows.append(dict(path=p, label=cls, conf=float(v.get("confidence") or 0)))
    return rows


def cc_rows():
    """獨立的 CC 實拍照片（含人工策展類別），作為測試集。"""
    import evaluate as ev
    rows = ev.load_dataset()
    out = []
    for r in rows:
        if r["tier"] == "real-cc" and r["class_id"] in CLASSES:
            out.append(dict(path=r["path"], label=r["class_id"]))
    return out


def embed(scorer, rows, tag):
    cache = OUT / f"probe-feats-{tag}.npz"
    have = {}
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        have = {k: z[k] for k in z.files}
    todo = [r for r in rows if str(r["path"]) not in have]
    if todo:
        print(f"[probe] 嵌入 {len(todo)} 張（快取 {len(have)}）…")
        feats = scorer.embed_images([str(r["path"]) for r in todo])
        for r, f in zip(todo, feats):
            have[str(r["path"])] = f.astype(np.float32)
        np.savez_compressed(cache, **have)
    X = np.stack([have[str(r["path"])] for r in rows])
    return X


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--encoder", default="dino", choices=["dino", "clip", "both"],
                    help="both = CLIP 與 DINOv2 特徵拼接（跨域泛化通常最好）")
    ap.add_argument("--dino-model", default="facebook/dinov2-base")
    ap.add_argument("--dino-size", type=int, default=336)
    ap.add_argument("--C", type=float, default=1.0, help="邏輯迴歸正則化強度倒數")
    args = ap.parse_args()

    train_rows, test_rows = dataset_rows(), cc_rows()
    print(f"[probe] 訓練集 {len(train_rows)} 張（VLM 標籤）、測試集 {len(test_rows)} 張（人工策展標籤，獨立）")
    print("  訓練集類別分布：" + json.dumps(dict(Counter(r['label'] for r in train_rows)), ensure_ascii=False))

    from dino_embed import build_scorer
    if args.encoder == "dino":
        scorer = build_scorer("dino", model_id=args.dino_model, size=args.dino_size,
                              pool="cls", tta=True, resize="shortest")
        print(f"[probe] 編碼器 {scorer.model_name}")
        Xtr = embed(scorer, train_rows, "dino-train")
        Xte = embed(scorer, test_rows, "dino-test")
    elif args.encoder == "clip":
        scorer = build_scorer("clip")
        print(f"[probe] 編碼器 {scorer.model_name}")
        Xtr = embed(scorer, train_rows, "clip-train")
        Xte = embed(scorer, test_rows, "clip-test")
    else:
        # 拼接兩種特徵：各自 L2 正規化後串接（維度不同，先各自標準化避免其中一側主導）
        d = build_scorer("dino", model_id=args.dino_model, size=args.dino_size,
                         pool="cls", tta=True, resize="shortest")
        c = build_scorer("clip")
        print(f"[probe] 編碼器拼接：{d.model_name} + {c.model_name}")
        Dtr, Dte = embed(d, train_rows, "dino-train"), embed(d, test_rows, "dino-test")
        Ctr, Cte = embed(c, train_rows, "clip-train"), embed(c, test_rows, "clip-test")
        nz = lambda X: X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
        Xtr = np.hstack([nz(Ctr), nz(Dtr)])
        Xte = np.hstack([nz(Cte), nz(Dte)])
        scorer = d
        print(f"  拼接後維度 {Xtr.shape[1]}")
    ytr = np.array([CLASSES.index(r["label"]) for r in train_rows])
    yte = np.array([CLASSES.index(r["label"]) for r in test_rows])

    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score, StratifiedKFold

    clf = LogisticRegression(C=args.C, max_iter=3000, class_weight="balanced")
    # 訓練集上的交叉驗證（看是否過擬合）
    n_splits = min(5, min(Counter(ytr).values()))
    if n_splits >= 3:
        cv = cross_val_score(clf, Xtr, ytr, cv=StratifiedKFold(n_splits, shuffle=True, random_state=0))
        print(f"[probe] 訓練集 {n_splits} 折交叉驗證準確率：{cv.mean() * 100:.1f}% ± {cv.std() * 100:.1f}%")
    clf.fit(Xtr, ytr)

    pred = clf.predict(Xte)
    acc = float((pred == yte).mean())
    print(f"\n=== 獨立測試集（{len(test_rows)} 張實拍照片）top-1 準確率 {acc * 100:.1f}% ===")
    print(f"  對照：CLIP 零樣本（同一測試集）= 53.5%　→　{'提升' if acc > 0.535 else '未提升'} "
          f"{(acc - 0.535) * 100:+.1f} 個百分點")

    print("\n  各類別準確率（測試集）：")
    for i, c in enumerate(CLASSES):
        m = yte == i
        if m.sum():
            print(f"    {c:20} {int((pred[m] == i).sum()):3d}/{int(m.sum()):3d} = "
                  f"{(pred[m] == i).mean() * 100:5.1f}%")

    # 混淆矩陣最常錯的組合
    conf = Counter((CLASSES[t], CLASSES[p]) for t, p in zip(yte, pred) if t != p)
    if conf:
        print("\n  最常混淆（真實→預測）：" + "、".join(f"{a}→{b}×{n}" for (a, b), n in conf.most_common(5)))

    (OUT / f"probe-{args.encoder}.json").write_text(json.dumps(dict(
        encoder=scorer.model_name, train=len(train_rows), test=len(test_rows),
        test_acc=acc, clip_zero_shot=0.535, C=args.C,
        per_class={c: (float((pred[yte == i] == i).mean()) if (yte == i).sum() else None)
                   for i, c in enumerate(CLASSES)}), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n[out] {(OUT / f'probe-{args.encoder}.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
