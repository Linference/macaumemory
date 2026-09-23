"""用 CLIP 自動清洗 YOLO 訓練資料集：把「不對類」與「不是建築」的圖片挑出來。

為什麼需要這一步：Wikimedia Commons 是全文檢索，查 "casino Macau" 會回傳店內商品、
吊燈、酒杯甚至飛機——實測 628 張裡有相當比例根本不是該類建築（見 out/overview.jpg）。
若不先清洗，人工標註會浪費大量時間，而且會教出錯的模型。

判定方式（兩道關卡）：
    ① 類別關：CLIP 零樣本 12 類機率，該圖片所屬資料夾的類別機率必須進 top-k 且 ≥ p_min
    ② 雜物關：與「非建築」提示詞（室內、招牌、食物、人像、文件、地圖…）的相似度必須低於 junk_max

被剔除的圖片會被**移到 images/rejected/<class>/**（不刪除），並記錄原因到 out/filter-report.csv，
方便你回頭檢查判錯的案例。

用法：
    python tools/yolo-dataset/filter_dataset.py                 # 只報告，不動檔案
    python tools/yolo-dataset/filter_dataset.py --apply         # 實際移動檔案
    python tools/yolo-dataset/filter_dataset.py --p-min 0.15 --top-k 3 --junk-max 0.30 --apply
"""
from __future__ import annotations

import argparse
import csv
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
RAW = DS / "images" / "raw"
REJ = DS / "images" / "rejected"
OUT = DS / "out"
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
sys.path.insert(0, str(ROOT / "tools" / "eval"))
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))

from clip_embed import ClipScorer  # noqa: E402
from fetch_dataset import CLASSES  # noqa: E402

JUNK_PROMPTS = [
    "a close-up photo of food or a drink",
    "a photo of a shop sign or a logo",
    "a photo of a person posing for the camera",
    "a photo of the interior of a room with furniture",
    "a photo of a document, poster or a map",
    "a photo of a plant, a tree or flowers",
    "a photo of a statue or a small object on display",
    "a photo of a car, a bus or a boat",
    "a photo of the sky, clouds or a sunset",
    "a screenshot or a diagram",
]
# 我們要的是「建築外觀」：室內照（門廳、走廊、展間）對偵測器是雜訊，另外用一組提示詞擋掉
EXTERIOR_PROMPTS = [
    "an outdoor photo of a building exterior seen from the street",
    "a photo of a building facade taken from outside",
]
INTERIOR_PROMPTS = [
    "an indoor photo taken inside a building",
    "a photo of a room, a hallway or a corridor indoors",
    "a photo of a museum exhibition room",
    "a photo of an indoor courtyard seen through a doorway",
]
# 這些類別在 taxonomy 裡沒有（taxonomy 是建築類型），所以類別關只對有對應的類別做
TAXO_MAP = {
    "portuguese": "portuguese", "temple": "temple", "church": "church", "tong_lau": "tong_lau",
    "residential_tower": "residential_tower", "casino_hotel": "casino_hotel", "civic": "civic",
    "industrial": "industrial", "village": "village", "monument": "monument", "market": "market",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--p-min", type=float, default=0.15, help="所屬類別的 CLIP 機率下限")
    ap.add_argument("--top-k", type=int, default=3, help="所屬類別至少要進前 k 名")
    ap.add_argument("--junk-max", type=float, default=0.27, help="與雜物提示詞的絕對相似度上限")
    ap.add_argument("--junk-margin-max", type=float, default=0.0,
                    help="相對判定：（雜物相似度 − 最佳建築類別相似度）超過此值就剔除。"
                         "實測分布 p90=+0.016、p95=+0.034，預設 0.0 約剔除 16%%，比絕對閾值可靠。")
    ap.add_argument("--interior-margin", type=float, default=0.0,
                    help="室內關：室內相似度 − 室外相似度 超過此值就剔除（預設 0：只要更像室內就剔除）")
    ap.add_argument("--interior-exempt", default="market,industrial",
                    help="這些類別豁免室內關。原因：街市內部、船廠本來就是拍攝主體，"
                         "把它們當雜訊會把該類殺光（實測 market 47→13）。")
    ap.add_argument("--restore", action="store_true",
                    help="把 images/rejected/ 的圖片全部搬回 images/raw/（重新調參前先還原）")
    ap.add_argument("--apply", action="store_true", help="實際移動被剔除的檔案")
    ap.add_argument("--gate-exempt", default="monument,village",
                    help="這些類別跳過「類別關」只做「雜物關」。原因：CLIP 的 12 類裡對牌坊／村落辨識力差"
                         "（實測大三巴被 CLIP 判成教堂 81%），硬卡會誤殺好圖。")
    ap.add_argument("--only", default=None)
    args = ap.parse_args()

    exempt = {c.strip() for c in args.gate_exempt.split(",") if c.strip()}
    int_exempt = {c.strip() for c in args.interior_exempt.split(",") if c.strip()}
    wanted = set(args.only.split(",")) if args.only else set(CLASSES)

    if args.restore:
        n = 0
        for cls_dir in sorted(REJ.iterdir()) if REJ.exists() else []:
            if not cls_dir.is_dir():
                continue
            dest = RAW / cls_dir.name
            dest.mkdir(parents=True, exist_ok=True)
            for f in cls_dir.iterdir():
                if f.is_file():
                    shutil.move(str(f), str(dest / f.name))
                    n += 1
        print(f"[restore] 已把 {n} 張從 images/rejected/ 搬回 images/raw/")
        return
    scorer = ClipScorer()
    class_ids, prompts, owner = scorer.taxonomy_vectors()
    text = scorer.embed_texts(prompts)
    junk = scorer.embed_texts(JUNK_PROMPTS)
    ext = scorer.embed_texts(EXTERIOR_PROMPTS)
    inte = scorer.embed_texts(INTERIOR_PROMPTS)
    print(f"[filter] CLIP {scorer.model_name} · 類別 {len(class_ids)} · 雜物 {len(JUNK_PROMPTS)} · "
          f"室內外 {len(EXTERIOR_PROMPTS)}/{len(INTERIOR_PROMPTS)}")

    rows, kept = [], 0
    per_class = {}
    for cid in CLASSES:
        if cid not in wanted:
            continue
        imgs = sorted(p for p in (RAW / cid).glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if not imgs:
            continue
        feats = scorer.embed_images([str(p) for p in imgs], batch=16)
        probs, _, _ = scorer.classify(feats, text, owner, len(class_ids))
        cls_sim = feats @ text.T                      # 與每個類別提示詞的相似度
        best_cls = cls_sim.max(1)
        junk_sim = feats @ junk.T
        ext_sim = (feats @ ext.T).max(1)
        int_sim = (feats @ inte.T).max(1)
        k_keep = 0
        for i, p in enumerate(imgs):
            target = TAXO_MAP.get(cid)
            order = list(np.argsort(-probs[i]))
            rank = order.index(class_ids.index(target)) + 1 if target in class_ids else 1
            p_cls = float(probs[i][class_ids.index(target)]) if target in class_ids else 1.0
            jmax = float(junk_sim[i].max())
            margin = jmax - float(best_cls[i])
            why = []
            if cid not in exempt:
                if rank > args.top_k:
                    why.append(f"類別排名第 {rank}")
                if p_cls < args.p_min:
                    why.append(f"類別機率 {p_cls:.2f} 過低")
            if margin > args.junk_margin_max:
                j = int(junk_sim[i].argmax())
                why.append(f"更像雜物（{JUNK_PROMPTS[j][:18]}…，margin {margin:+.2f}）")
            elif jmax > args.junk_max:
                j = int(junk_sim[i].argmax())
                why.append(f"雜物相似度 {jmax:.2f}（{JUNK_PROMPTS[j][:18]}…）")
            # 室內關：要的是建築外觀，室內照對偵測器是雜訊（街市／船廠等類別豁免）
            if cid not in int_exempt and float(int_sim[i]) > float(ext_sim[i]) + args.interior_margin:
                why.append(f"像室內照（室內 {int_sim[i]:.2f} > 室外 {ext_sim[i]:.2f}）")
            ok = not why
            rows.append(dict(class_id=cid, file=str(p.relative_to(ROOT)).replace("\\", "/"),
                             keep=int(ok), cls_prob=round(p_cls, 3), cls_rank=rank,
                             junk_top=round(jmax, 3), junk_margin=round(margin, 3), reason="；".join(why)))
            if ok:
                k_keep += 1
                kept += 1
            elif args.apply:
                dest = REJ / cid
                dest.mkdir(parents=True, exist_ok=True)
                shutil.move(str(p), str(dest / p.name))
        per_class[cid] = (len(imgs), k_keep)
        print(f"  {cid:20} {len(imgs):3d} 張 → 保留 {k_keep:3d}（剔除 {len(imgs) - k_keep:3d}）")

    OUT.mkdir(parents=True, exist_ok=True)
    rep = OUT / "filter-report.csv"
    with rep.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["class_id", "file", "keep", "cls_prob", "cls_rank",
                                          "junk_top", "junk_margin", "reason"])
        w.writeheader()
        w.writerows(rows)

    total = sum(n for n, _ in per_class.values())
    print(f"\n[filter] 總計 {total} 張 → 保留 {kept}（{kept / max(total, 1) * 100:.0f}%）、"
          f"剔除 {total - kept}")
    print(f"[filter] 報告：{rep.relative_to(ROOT)}"
          + ("（已實際移動檔案到 images/rejected/）" if args.apply else "（dry-run：未移動檔案，加 --apply 才會生效）"))
    weak = [c for c, (n, k) in per_class.items() if n and k < n * 0.5]
    if weak:
        print(f"[filter] ⚠ 保留率 < 50% 的類別（建議補抓或改查詢詞）：{weak}")


if __name__ == "__main__":
    main()
