"""自動預標註：用 YOLO-World（開放詞彙）框出建築 → 產生 YOLO 格式標籤 → 切分 train/val。

為什麼可以自動標類別：這個資料集是**按類別分資料夾**下載的（temple/、church/…），
類別已知；YOLO-World 只負責「框在哪」，類別直接用資料夾標籤。這樣就把最花時間的
「畫框」自動化，人工只需修正框的位置。

⚠ 防資料洩漏（重要）：同一棟建築的不同照片若同時出現在 train 與 val，val 分數會虛高。
   所以切分預設採 **--group-split**：先用 CLIP 影像向量把近似重複的照片聚成組
   （同一棟／同一角度視為同組），再「整組」分到 train 或 val。

流程：
    images/raw/<class>/*.jpg
      → YOLO-World 偵測框（類別用資料夾標籤）
      → CLIP 向量分組 → 依組切分 train/val
      → images/{train,val}/ 與 labels/{train,val}/
      → out/preview-prelabel.jpg（畫框預覽，肉眼檢查）

用法：
    python tools/yolo-dataset/prelabel.py
    python tools/yolo-dataset/prelabel.py --confidence 0.3 --val-ratio 0.15
    python tools/yolo-dataset/prelabel.py --no-group-split      # 改回隨機切分（不建議）
    python tools/yolo-dataset/prelabel.py --limit 20            # 每類只做 20 張（快速試跑）
"""
from __future__ import annotations

import argparse
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
RAW = DS / "images" / "raw"
WORLD = ROOT / ".cache" / "models" / "yolo" / "yolov8s-worldv2.pt"
FONT = Path(r"C:\Windows\Fonts\msjh.ttc")
OUT = DS / "out"

sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
sys.path.insert(0, str(ROOT / "tools" / "eval"))
from fetch_dataset import CLASSES  # noqa: E402

CLASS_IDS = list(CLASSES)
CLASS_ZH = {k: v[0] for k, v in CLASSES.items()}

# 開放詞彙提示詞：只需要「框」，類別由資料夾決定
PROMPTS = ["a photo of a building", "a photo of a building facade",
           "a photo of a house", "a photo of a temple or church building"]


def building_key(stem: str) -> str:
    """從檔名推測「這是哪一棟建築」，用來把同一棟的照片分到同一組。

    Commons 的檔名通常含建築名（例：Dom_Pedro_V_Theatre_20-10-2023_7_ab12cd），
    把日期、編號、雜訊去掉後取前幾個詞當作建築鍵。
    這比只靠 CLIP 相似度可靠：不同角度的同一棟可能只有 0.75~0.85 相似度。
    """
    import re as _re

    s = stem
    # 去掉類別前綴（例如 church_ / monument_）
    if "_" in s:
        head, rest = s.split("_", 1)
        if head.isalpha() and len(head) < 20:
            s = rest
    s = _re.sub(r"(19|20)\d{2}[-_.]?\d{0,2}[-_.]?\d{0,2}", " ", s)   # 日期
    s = _re.sub(r"\b(19|20)\d{2}\b", " ", s)
    s = _re.sub(r"IMG[_ ]?\d+", " ", s)
    s = _re.sub(r"[0-9a-f]{6,}", " ", s)          # 檔名尾端的雜湊
    s = _re.sub(r"[_\-.,()]+", " ", s)
    toks = [t for t in s.split() if len(t) > 3 and not t.isdigit()]
    return " ".join(toks[:3]).lower()


def group_split(records, val_ratio: float, threshold: float, use_names: bool = True):
    """把「同一棟建築」的照片聚成組（防同棟洩漏），再以整組做按類別分層的 train/val 切分。

    分組同時用兩個訊號：
      ① 檔名推測的建築鍵（精確，優先）
      ② CLIP 影像向量相似度 ≥ threshold（補漏：不同命名但同一棟、或近重複）
    """
    from collections import Counter

    from clip_embed import ClipScorer

    scorer = ClipScorer()
    paths = [str(r["src"]) for r in records]
    print(f"[group] 計算 {len(paths)} 張的 CLIP 向量…")
    feats = scorer.embed_images(paths, batch=16)

    # ---- ① 先用檔名建築鍵分組 ----
    parent = list(range(len(records)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    if use_names:
        bykey = {}
        for i, r in enumerate(records):
            k = building_key(r["src"].stem)
            if k:
                bykey.setdefault(k, []).append(i)
        for idxs in bykey.values():
            for j in idxs[1:]:
                union(idxs[0], j)

    # ---- ② 再用 CLIP 相似度合併（貪婪取質心） ----
    clusters: list[dict] = []
    for i in range(len(records)):
        f = feats[i]
        hit = None
        for cl in clusters:
            if float(np.dot(f, cl["centroid"])) >= threshold:
                hit = cl
                break
        if hit is None:
            clusters.append({"members": [i], "centroid": f.copy()})
        else:
            hit["members"].append(i)
            m = np.mean([feats[j] for j in hit["members"]], axis=0)
            hit["centroid"] = m / (np.linalg.norm(m) + 1e-9)
    for cl in clusters:
        for j in cl["members"][1:]:
            union(cl["members"][0], j)

    # ---- 收斂成最終組 ----
    buckets = {}
    for i in range(len(records)):
        buckets.setdefault(find(i), []).append(i)
    groups = []
    for members in buckets.values():
        cnt = Counter(records[i]["cid"] for i in members)
        groups.append({"members": members, "classes": cnt, "used": False})
    print(f"[group] 分組訊號：檔名建築鍵={use_names}、CLIP 門檻={threshold}")

    cls_total = Counter(r["cid"] for r in records)
    target = {c: (max(1, round(n * val_ratio)) if n >= 3 else 0) for c, n in cls_total.items()}
    val_ids: set[int] = set()
    val_cls: Counter = Counter()

    # ---- ① 先確保每個類別在 val 都有代表：挑「該類純度高、組又小」的組 ----
    for c, need0 in sorted(target.items(), key=lambda kv: cls_total[kv[0]]):
        need = need0 - val_cls[c]
        cands = [g for g in groups if not g["used"] and c in g["classes"]]
        cands.sort(key=lambda g: (g["classes"][c] / len(g["members"]), len(g["members"])))
        for g in cands:
            if need <= 0:
                break
            g["used"] = True
            val_ids.update(g["members"])
            for cc, k in g["classes"].items():
                val_cls[cc] += k
            need = need0 - val_cls[c]

    # ---- ② 剩餘名額用最大的組填，讓 val 有多樣性（不超過總量目標） ----
    want_total = round(len(records) * val_ratio)
    for g in sorted(groups, key=lambda g: -len(g["members"])):
        if g["used"] or len(val_ids) >= want_total:
            continue
        g["used"] = True
        val_ids.update(g["members"])
        for cc, k in g["classes"].items():
            val_cls[cc] += k

    for i, r in enumerate(records):
        r["split"] = "val" if i in val_ids else "train"

    sizes = sorted((len(g["members"]) for g in groups), reverse=True)
    print(f"[group] {len(records)} 張 → {len(groups)} 組（最大組 {sizes[0]} 張、單張組 "
          f"{sum(1 for s in sizes if s == 1)} 組）；val {len(val_ids)}、train {len(records) - len(val_ids)}")
    dist = "、".join(f"{c}:{val_cls.get(c, 0)}/{cls_total[c]}" for c in sorted(cls_total))
    print(f"[group] val 各類別佔比（val/總）：{dist}")
    zero = [c for c in cls_total if cls_total[c] >= 3 and val_cls.get(c, 0) == 0]
    if zero:
        print(f"[group] ⚠ 這些類別在 val 為 0（AP 無法計算）：{zero}")
    return records


def random_split(records, val_ratio: float, seed: int = 20260923):
    import random
    random.seed(seed)
    idx = list(range(len(records)))
    random.shuffle(idx)
    n_val = int(len(records) * val_ratio)
    val_ids = set(idx[:n_val])
    for i, r in enumerate(records):
        r["split"] = "val" if i in val_ids else "train"
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confidence", type=float, default=0.25)
    ap.add_argument("--max-boxes", type=int, default=1, help="每張最多保留幾個框（單一建築建議 1）")
    ap.add_argument("--val-ratio", type=float, default=0.15)
    ap.add_argument("--group-threshold", type=float, default=0.92, help="CLIP 餘弦 ≥ 此值視為同一棟（同一組）")
    ap.add_argument("--no-group-split", action="store_true", help="改用隨機切分（會造成同棟洩漏，不建議）")
    ap.add_argument("--only", default=None)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    wanted = set(args.only.split(",")) if args.only else set(CLASS_IDS)
    for sub in ("train", "val"):
        (DS / "images" / sub).mkdir(parents=True, exist_ok=True)
        (DS / "labels" / sub).mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(WORLD))
    model.set_classes(PROMPTS)
    print(f"[world] {WORLD.name} · conf={args.confidence} · max_boxes={args.max_boxes}")

    records, previews, stats = [], [], {}
    for cid in CLASS_IDS:
        if cid not in wanted:
            continue
        imgs = sorted(p for p in (RAW / cid).glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if args.limit:
            imgs = imgs[: args.limit]
        if not imgs:
            stats[cid] = (0, 0)
            continue
        labeled = 0
        for p in imgs:
            img = Image.open(p).convert("RGB")
            res = model.predict(np.array(img), conf=args.confidence, verbose=False)[0]
            bs = sorted(res.boxes, key=lambda b: -float(b.conf[0]))[: args.max_boxes]
            W_, H_ = img.size
            lines = []
            for b in bs:
                x0, y0, x1, y1 = (float(v) for v in b.xyxy[0].tolist())
                x0, y0 = max(0.0, x0), max(0.0, y0)
                x1, y1 = min(float(W_), x1), min(float(H_), y1)
                if x1 - x0 < 24 or y1 - y0 < 24:
                    continue
                lines.append(f"{CLASS_IDS.index(cid)} {(x0 + x1) / 2 / W_:.6f} {(y0 + y1) / 2 / H_:.6f} "
                             f"{(x1 - x0) / W_:.6f} {(y1 - y0) / H_:.6f}")
            if not lines:
                continue
            labeled += 1
            records.append(dict(src=p, cid=cid, lines=lines, conf=float(bs[0].conf[0]) if bs else 0.0))
            if len(previews) < 12 and len(lines) == 1 and labeled % 3 == 0:
                previews.append((img.copy(), bs[0], cid, p.name))
        stats[cid] = (len(imgs), labeled)
        print(f"  {cid:20} {CLASS_ZH[cid]:8} 影像 {len(imgs):3d} → 偵測到框 {labeled:3d}")

    if not records:
        raise SystemExit("沒有任何影像被偵測到框；可降低 --confidence 或先確認 images/raw 有圖")

    records = (random_split(records, args.val_ratio) if args.no_group_split
               else group_split(records, args.val_ratio, args.group_threshold))

    for r in records:
        stem = f'{r["cid"]}_{r["src"].stem}'[:110]
        shutil.copy2(r["src"], DS / "images" / r["split"] / f"{stem}.jpg")
        (DS / "labels" / r["split"] / f"{stem}.txt").write_text("\n".join(r["lines"]) + "\n", encoding="utf-8")

    if previews:
        cols, cw = 4, 300
        rows = (len(previews) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cw + (cols + 1) * 8, rows * (cw + 34) + 8), (245, 243, 238))
        d = ImageDraw.Draw(sheet)
        f = ImageFont.truetype(str(FONT), 14)
        for i, (img, box, cid, name) in enumerate(previews):
            rr, cc = divmod(i, cols)
            x, y = 8 + cc * (cw + 8), 8 + rr * (cw + 34)
            s = cw / img.width
            im = img.resize((cw, max(1, int(img.height * s))), Image.LANCZOS).crop((0, 0, cw, cw))
            dd = ImageDraw.Draw(im)
            x0, y0, x1, y1 = (v * s for v in box.xyxy[0].tolist())
            dd.rectangle((x0, y0, x1, y1), outline=(214, 48, 49), width=3)
            dd.text((x0 + 3, max(0, y0 - 14)), f"{CLASS_ZH[cid]} {float(box.conf[0]):.2f}", font=f, fill=(214, 48, 49))
            sheet.paste(im, (x, y))
            d.text((x, y + cw + 4), name[:38], font=f, fill=(70, 80, 90))
        pv = OUT / "preview-prelabel.jpg"
        sheet.save(pv, quality=88)
        print(f"[preview] {pv.relative_to(ROOT)}  ← 務必肉眼檢查框有沒有框住主要建築")

    n_tr = sum(1 for r in records if r["split"] == "train")
    n_va = len(records) - n_tr
    print(f"\n[prelabel] 共 {len(records)} 張：train {n_tr} / val {n_va}")
    print(f"[prelabel] 產出 {DS.relative_to(ROOT)}/images/{{train,val}} 與 labels/{{train,val}}")
    empty = [c for c, (n, l) in stats.items() if n and l == 0]
    if empty:
        print(f"[prelabel] ⚠ 完全沒框到的類別：{empty}（可降低 --confidence 重跑）")


if __name__ == "__main__":
    main()
