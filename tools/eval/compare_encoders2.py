"""並排比較多個編碼器設定的評測結果（CLIP vs DINOv2 各種配置）。"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"
CONFIGS = [
    ("CLIP ViT-B/32（原基準）", "metrics.json"),
    ("DINOv2 518 壓扁 cls+gem", "metrics-dino.json"),
    ("DINOv2 518 等比 cls", "metrics-dino-short.json"),
    ("DINOv2 336 等比 cls", "metrics-dino-336cls.json"),
    ("DINOv2 518 等比 cls+gem", "metrics-dino-518clsgem.json"),
    ("DINOv2 518 等比 cls 無翻轉", "metrics-dino-518notta.json"),
]
EXPS = ["E1_渲染同環境", "E1b_文物", "E1r_實拍真實照片", "E2_跨條件", "E4_跨域"]


def load(name):
    p = OUT / name
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("results", d)


def main():
    print(f"{'設定':30}" + "".join(f"{e.split('_')[0]:>10}" for e in EXPS))
    print("-" * 80)
    for label, f in CONFIGS:
        r = load(f)
        if not r:
            print(f"{label:30}（找不到 {f}）")
            continue
        cells = [(f"{r[e]['auc']:.3f}" if r.get(e, {}).get("auc") is not None else "—") for e in EXPS]
        print(f"{label:30}" + "".join(f"{c:>10}" for c in cells))

    print("\n=== 實拍 E1r 的判別能力（同棟／不同棟分離度）===")
    print(f"{'設定':30}{'同棟均值':>9}{'不同棟':>9}{'間距':>8}{'同棟p05':>9}{'AUC':>8}")
    for label, f in CONFIGS:
        e = load(f).get("E1r_實拍真實照片")
        if not e:
            continue
        pos, neg = e.get("pos_mean"), e.get("neg_mean")
        print(f"{label:30}{pos:>9.3f}{neg:>9.3f}{pos - neg:>8.3f}{e.get('pos_p05', float('nan')):>9.3f}{e.get('auc'):>8.3f}")

    print("\n=== 建議閾值（實拍 E1r；由 Youden J 最佳點決定）===")
    for label, f in CONFIGS:
        e = load(f).get("E1r_實拍真實照片")
        if not e:
            continue
        print(f"  {label:28} 最佳閾值 {e.get('best_threshold', float('nan')):.3f}"
              f"（TPR {e.get('best_tpr', 0) * 100:.1f}% / FPR {e.get('best_fpr', 0) * 100:.1f}%）")


if __name__ == "__main__":
    main()
