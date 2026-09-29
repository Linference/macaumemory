"""並排比較兩個編碼器的評測結果（CLIP vs DINOv2）。

用法：python tools/eval/compare_encoders.py [--a metrics.json] [--b metrics-dino.json]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "eval" / "out"
ORDER = ["E1_渲染同環境", "E1b_文物", "E1r_實拍真實照片", "E2_跨條件", "E4_跨域", "E5_地圖截圖"]


def load(p: Path) -> dict:
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("results", d)


def fmt(x, digits=3, pct=False):
    if x is None:
        return "—"
    if pct:
        return f"{x * 100:.1f}%"
    return f"{x:.{digits}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="metrics.json", help="基準（CLIP）")
    ap.add_argument("--b", default="metrics-dino.json", help="新編碼器（DINOv2）")
    args = ap.parse_args()
    A, B = load(OUT / args.a), load(OUT / args.b)
    if not A or not B:
        raise SystemExit(f"找不到評測結果：{args.a}={bool(A)} / {args.b}={bool(B)}")

    print(f"基準 A = {args.a}　新編碼器 B = {args.b}\n")
    print(f"{'實驗':<22}{'指標':<14}{'CLIP':>10}{'DINOv2':>10}{'變化':>10}")
    print("-" * 68)
    for name in ORDER:
        a, b = A.get(name), B.get(name)
        if not a and not b:
            continue
        for key, label, pct in (("auc", "AUC", False),
                                ("same_mean", "同棟平均相似度", False),
                                ("diff_mean", "不同棟平均相似度", False),
                                ("tpr_at_best", "最佳 TPR", True),
                                ("fpr_at_best", "最佳 FPR", True)):
            av = (a or {}).get(key)
            bv = (b or {}).get(key)
            if av is None and bv is None:
                continue
            d = (bv - av) if (av is not None and bv is not None) else None
            arrow = "" if d is None else ("  ↑" if d > 0.005 else ("  ↓" if d < -0.005 else "  ="))
            print(f"{name if key == 'auc' else '':<22}{label:<14}{fmt(av, pct=pct):>10}{fmt(bv, pct=pct):>10}"
                  f"{(f'{d:+.3f}' if d is not None and not pct else (f'{d*100:+.1f}pp' if d is not None else '—')):>10}{arrow}")
        print("-" * 68)

    # 閾值掃描（實拍）—— 決定產品參數的關鍵
    for tag in ("E1_threshold", "E1r_threshold"):
        a, b = A.get(tag), B.get(tag)
        if not a or not b:
            continue
        print(f"\n=== {tag}（閾值掃描）===")
        print(f"{'閾值':>6}{'CLIP TPR':>10}{'CLIP FPR':>10}{'DINO TPR':>10}{'DINO FPR':>10}")
        for ta, tb in zip(a.get("rows", []), b.get("rows", [])):
            print(f"{ta.get('thr', 0):>6.2f}{fmt(ta.get('tpr'), pct=True):>10}{fmt(ta.get('fpr'), pct=True):>10}"
                  f"{fmt(tb.get('tpr'), pct=True):>10}{fmt(tb.get('fpr'), pct=True):>10}")


if __name__ == "__main__":
    main()
