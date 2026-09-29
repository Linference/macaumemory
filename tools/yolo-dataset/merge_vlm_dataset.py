"""把過濾後的 VLM 標註併入 YOLO 資料集（**不破壞既有影像**）。

命名契約（非常重要）：
    既有管線的 class_of() 用「**最長前綴**」比對類別（因為類別名本身可能含底線，
    例如 casino_hotel、tong_lau、residential_tower）。因此新檔名一律是
        <class>_vlm_<中文資料夾>_<原檔名>.jpg
    開頭就是類別名（滿足 class_of），中段帶 `_vlm_` 標記（可單獨移除整批）。
    實例：monument_vlm_东望洋灯塔_01.jpg

分流規則（依既有 train/val 比例 500:117 ≈ 81%:19%，用固定亂數種子）：
    只把新資料放進 train 與 val，**完全不動既有 500 + 117 張**，
    這樣 val 仍可與基準線逐類別對比（val 會變大，所以也會另外用「舊 val」單獨評估）。

用法：
    python tools/yolo-dataset/merge_vlm_dataset.py --dry-run
    python tools/yolo-dataset/merge_vlm_dataset.py --apply
    python tools/yolo-dataset/merge_vlm_dataset.py --apply --val-frac 0.17
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
WORK = ROOT / ".cache" / "vlm-label"
SELECTION = WORK / "selection.json"
MANIFEST = DS / "out" / "vlm-merged.csv"

CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]
TAG = "_vlm_"


def class_of(stem: str):
    for cid in sorted(CLASSES, key=len, reverse=True):
        if stem.startswith(cid + "_"):
            return cid
    return None


def pick_balanced(rows: list[dict], cap: int) -> list[dict]:
    """每類設上限；同分時優先「乾淨畫面、少建築、高信心、框不要太大」。

    clean=false 的圖不剔除（浮水印是這批網路照片的常態，全砍會少掉一半資料），
    但排序時降級，讓乾淨的圖優先被選進前 cap 名。
    """
    by_cls: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_cls[r["class"]].append(r)

    def score(r: dict):
        st = r.get("stages", {}).get("full", {})
        return (
            0 if r.get("clean") is not False else 1,          # 乾淨優先
            0 if (r.get("n_buildings") or 1) <= 2 else 1,      # 單棟優先
            -(st.get("conf") or 0),                            # 高信心優先
            abs(r.get("ratio_gap") or 0),                      # 框與自評一致者優先
            r.get("area") or 0,                                # 框小一點優先（大框通常偏鬆）
            r["file"],                                         # 決定性
        )

    out = []
    for cls, rs in by_cls.items():
        rs = sorted(rs, key=score)
        kept = rs[:cap] if cap > 0 else rs
        out += kept
        if len(rs) > len(kept):
            print(f"    [cap] {cls:20} {len(rs):4d} → {len(kept):4d}（因每類上限 {cap} 截掉 {len(rs) - len(kept)}）")
        else:
            print(f"    [cap] {cls:20} {len(rs):4d}（未達上限）")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--cap", type=int, default=120, help="每類別最多併入幾張（0=不限）")
    ap.add_argument("--val-frac", type=float, default=0.19)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SELECTION.exists():
        raise SystemExit(f"找不到 {SELECTION}，請先跑 filter_vlm_labels.py")
    rows = [r for r in json.loads(SELECTION.read_text(encoding="utf-8"))["rows"] if r.get("kept")]
    print(f"[merge] 過濾後可用 {len(rows)} 張，每類上限 {args.cap}")

    print("[merge] 類別平衡選擇：")
    chosen = pick_balanced(rows, args.cap)
    rng = random.Random(args.seed)
    rng.shuffle(chosen)
    n_val = round(len(chosen) * args.val_frac)
    val_set = chosen[:n_val]
    train_set = chosen[n_val:]

    used_names: set[str] = set()
    plan: list[tuple[dict, str, str]] = []      # (row, split, new_stem)
    for split, rs in (("val", val_set), ("train", train_set)):
        for r in rs:
            src = Path(r["file"])
            stem = f"{r['class']}{TAG}{r['folder']}_{src.stem}"
            stem = stem.replace(" ", "_")
            base, i = stem, 2
            while stem in used_names:
                stem = f"{base}_{i}"
                i += 1
            used_names.add(stem)
            plan.append((r, split, stem))

    per_split = Counter(s for _, s, _ in plan)
    per_cls_split: dict[str, Counter] = defaultdict(Counter)
    for r, s, _ in plan:
        per_cls_split[r["class"]][s] += 1
    print(f"\n[merge] 計畫新增：train {per_split['train']}、val {per_split['val']}，合計 {len(plan)}")
    print(f"{'class':22}{'train':>7}{'val':>6}  | 既有 train")
    existing_train = Counter()
    for p in (DS / "images" / "train").glob("*"):
        c = class_of(p.stem)
        if c:
            existing_train[c] += 1
    for c in CLASSES:
        print(f"{c:22}{per_cls_split[c]['train']:7d}{per_cls_split[c]['val']:6d}  | {existing_train[c]:5d}")

    if args.dry_run or not args.apply:
        print("\n[merge] 這是 dry-run，沒有寫入任何檔案。確認後加 --apply。")
        return

    manifest_rows = []
    copied = 0
    for r, split, stem in plan:
        src = Path(r["file"])
        d_img = DS / "images" / split
        d_lbl = DS / "labels" / split
        dst_img = d_img / f"{stem}.jpg"
        dst_lbl = d_lbl / f"{stem}.txt"
        if dst_img.exists() or dst_lbl.exists():
            print(f"  [skip] 已存在 {dst_img.name}")
            continue
        d_img.mkdir(parents=True, exist_ok=True)
        d_lbl.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst_img)
        # 標籤：class_id cx cy w h（已正規化）。刻意重寫成小數 6 位，與既有格式一致。
        with Image.open(dst_img) as im:
            W, H = im.size
        cx, cy, w, h = r["norm"]
        ci = CLASSES.index(r["class"])
        dst_lbl.write_text(f"{ci} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n", encoding="utf-8")
        manifest_rows.append({"image": dst_img.name, "split": split, "class": r["class"],
                              "class_id": ci, "source": r["file"], "folder": r["folder"],
                              "area": r.get("area"), "flags": r.get("flagged"),
                              "orig_size": f"{W}x{H}"})
        copied += 1

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    import csv
    with MANIFEST.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["image", "split", "class", "class_id", "source",
                                          "folder", "area", "flags", "orig_size"])
        w.writeheader()
        w.writerows(manifest_rows)
    print(f"\n[done] 已複製 {copied} 張（train {per_split['train']}、val {per_split['val']}）")
    print(f"[out] 清單 {MANIFEST.relative_to(ROOT)}（可用它單獨移除這批：檔名含 {TAG}）")
    print(f"[next] python tools/yolo-dataset/train.py --warm-start .cache/models/yolo/macau-buildings-best.pt "
          f"--epochs 150 --imgsz 768 --batch 12 --name vlm-exp")


if __name__ == "__main__":
    main()
