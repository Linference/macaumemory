"""自訓練標註精煉：用已訓練的模型回頭修正／補齊弱標註框（pseudo-label refinement）。

為什麼有效：
    第一版標註由 YOLO-World 自動產生，常見兩個問題——
      ① 漏框（YOLO-World 沒抓到，那張圖就沒有訓練訊號）
      ② 鬆框（框進太多樹木／天空，定位不準，直接壓低 mAP50-95）
    用自己的模型跑一遍，可以把「漏掉的補上」與「鬆的收緊」，這是小資料集提升 mAP 最有效的手段之一。

風險與節制：
    自訓練會放大模型自身的錯誤，因此只在「類別正確且信心 ≥ 門檻」時才動標註；
    兩者不一致時預設保留原標註並記入報告，交由人工複核（--prefer 可改為取聯集）。

用法：
    python tools/yolo-dataset/refine_labels.py                 # 只出報告，不改檔案
    python tools/yolo-dataset/refine_labels.py --apply         # 實際寫回 labels/
    python tools/yolo-dataset/refine_labels.py --add-unlabeled --apply   # 另外替沒有標註的圖補框
    python tools/yolo-dataset/refine_labels.py --min-conf 0.6 --imgsz 768
"""
from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
OUT = DS / "out"
CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]


def class_of(stem: str) -> str | None:
    """從檔名取出類別 id。類別名可能含底線（casino_hotel、tong_lau、residential_tower），
    因此必須用「最長前綴」比對，不能用 split("_")[0]（會得到 casino／tong／residential）。"""
    for cid in sorted(CLASSES, key=len, reverse=True):
        if stem.startswith(cid + "_"):
            return cid
    return None




def iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / area if area > 0 else 0.0


def read_labels(p: Path):
    out = []
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        t = line.split()
        if len(t) >= 5:
            out.append((int(t[0]), *map(float, t[1:5])))   # (cls, cx, cy, w, h) 正規化
    return out


def to_xyxy(b, W, H):
    _, cx, cy, w, h = b
    return ((cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H)


def to_yolo(cls, xyxy, W, H):
    x0, y0, x1, y1 = xyxy
    return f"{cls} {((x0 + x1) / 2) / W:.6f} {((y0 + y1) / 2) / H:.6f} {(x1 - x0) / W:.6f} {(y1 - y0) / H:.6f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--add-unlabeled", action="store_true", help="也替目前沒有標註的圖補框（寫入 labels/train）")
    ap.add_argument("--min-conf", type=float, default=0.55, help="低於此信心不動標註")
    ap.add_argument("--replace-conf", type=float, default=0.70, help="高於此信心直接用模型的框")
    ap.add_argument("--min-iou-agree", type=float, default=0.30, help="與原框 IoU 低於此視為不一致（記入報告）")
    ap.add_argument("--scan-raw", action="store_true",
                    help="掃描 images/raw 中尚未進入 train/val 的圖，用模型補框後加入 images/train"
                         "（YOLO-World 漏掉的那些，等於多一批訓練資料）")
    ap.add_argument("--imgsz", type=int, default=768)
    ap.add_argument("--device", default="0")
    ap.add_argument("--weights", default=str(WEIGHTS))
    args = ap.parse_args()

    wpath = Path(args.weights)
    if not wpath.exists():
        raise SystemExit(f"找不到權重 {wpath}，請先跑 train.py")
    model = YOLO(str(wpath))
    print(f"[refine] 模型 {wpath.name} · conf≥{args.min_conf} · replace≥{args.replace_conf} · imgsz {args.imgsz}")

    stats = Counter()
    per_class = defaultdict(Counter)
    report = []

    for split in ("train", "val"):
        img_dir = DS / "images" / split
        lbl_dir = DS / "labels" / split
        for img in sorted(list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png"))):
            cid = class_of(img.stem)
            if cid not in CLASSES:
                continue
            ci = CLASSES.index(cid)
            lbl = lbl_dir / (img.stem + ".txt")
            old = read_labels(lbl)
            res = model.predict(str(img), conf=args.min_conf, imgsz=args.imgsz, device=args.device, verbose=False)[0]
            H, W = res.orig_shape
            cands = [b for b in res.boxes if int(b.cls[0]) == ci]
            if not cands:
                stats["模型未偵測到同類" if old else "無標註且模型未偵測到"] += 1
                per_class[cid]["模型未偵測到"] += 1
                continue
            best = max(cands, key=lambda b: float(b.conf[0]))
            conf = float(best.conf[0])
            nbox = tuple(float(v) for v in best.xyxy[0].tolist())
            if not old:
                stats["補上漏框"] += 1
                per_class[cid]["補上漏框"] += 1
                report.append((split, img.name, cid, "補框", f"conf={conf:.2f}"))
                if args.apply and args.add_unlabeled:
                    lbl.parent.mkdir(parents=True, exist_ok=True)
                    lbl.write_text(to_yolo(ci, nbox, W, H) + "\n")
                continue
            obox = to_xyxy(old[0], W, H)
            ov = iou(obox, nbox)
            if ov >= 0.6:
                stats["一致（不變）"] += 1
            elif ov >= args.min_iou_agree:
                # 大致同一棟但框不緊：用兩者聯集（包含原框、也納入模型認為的範圍）
                u = (min(obox[0], nbox[0]), min(obox[1], nbox[1]), max(obox[2], nbox[2]), max(obox[3], nbox[3]))
                stats["部分重疊→取聯集" if conf < args.replace_conf else "部分重疊→取模型框"] += 1
                per_class[cid]["精修"] += 1
                new = u if conf < args.replace_conf else nbox
                if args.apply:
                    lbl.write_text(to_yolo(ci, new, W, H) + "\n")
            else:
                stats["不一致（保留原框，待複核）"] += 1
                per_class[cid]["不一致"] += 1
                report.append((split, img.name, cid, "不一致", f"IoU={ov:.2f} conf={conf:.2f}"))
                if conf >= args.replace_conf and args.apply:
                    lbl.write_text(to_yolo(ci, nbox, W, H) + "\n")
                    stats["不一致但高信心→改用模型框"] += 1

    # ---- ② 掃描 raw：把 YOLO-World 漏掉、尚未進入 train/val 的圖用模型補框後加入訓練集 ----
    added_raw = 0
    if args.scan_raw:
        import shutil
        stems = {p.stem for p in (DS / "images" / "train").glob("*")} | {p.stem for p in (DS / "images" / "val").glob("*")}
        raw_dir = DS / "images" / "raw"
        per_class_add = defaultdict(int)
        for cid in CLASSES:
            ci = CLASSES.index(cid)
            for img in sorted(list((raw_dir / cid).glob("*.jpg")) + list((raw_dir / cid).glob("*.png"))):
                stem = f"{cid}_{img.stem}"
                if stem in stems:
                    continue
                res = model.predict(str(img), conf=args.min_conf, imgsz=args.imgsz, device=args.device, verbose=False)[0]
                H, W = res.orig_shape
                cands = [b for b in res.boxes if int(b.cls[0]) == ci]
                if not cands:
                    stats["raw：模型也找不到（略過）"] += 1
                    continue
                best = max(cands, key=lambda b: float(b.conf[0]))
                nbox = tuple(float(v) for v in best.xyxy[0].tolist())
                added_raw += 1
                per_class_add[cid] += 1
                stats["raw：補框後加入訓練集"] += 1
                if args.apply:
                    dst_img = DS / "images" / "train" / f"{stem}.jpg"
                    shutil.copy2(img, dst_img)
                    lbl = DS / "labels" / "train" / f"{stem}.txt"
                    lbl.parent.mkdir(parents=True, exist_ok=True)
                    lbl.write_text(to_yolo(ci, nbox, W, H) + "\n")
        if per_class_add:
            print("[refine] raw 補框各類別：" + "、".join(f"{k}:{v}" for k, v in per_class_add.items()))
        print(f"[refine] raw 掃描完成：新增 {added_raw} 張" + ("（已寫入）" if args.apply else "（未寫入，加 --apply）"))

    print("\n[refine] 統計：")
    for k, v in stats.most_common():
        print(f"  {k:24} {v:5d}")
    print("\n[refine] 各類別：")
    for cid in CLASSES:
        c = per_class.get(cid)
        if c:
            print(f"  {cid:18} " + "、".join(f"{k}:{v}" for k, v in c.items()))

    OUT.mkdir(parents=True, exist_ok=True)
    rep = OUT / "refine-report.csv"
    with rep.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["split", "image", "class", "狀況", "說明"])
        w.writerows(report)
    print(f"\n[out] 待複核清單 {rep.relative_to(ROOT)}（{len(report)} 筆）")
    print("[note] 未加 --apply，僅出報告；確認後再加 --apply 寫回標註" if not args.apply else "[done] 標註已更新，請重跑 train.py")


if __name__ == "__main__":
    main()
