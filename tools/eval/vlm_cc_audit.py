"""用 DeepSeek 視覺審計「未見過的 CC 測試照片」：區分「模型失準」與「測試圖本身不是建築」。

動機：獨立驗收顯示偵測率 65%、偵測到的當中類別正確 56%。但 CC 測試集來自 Commons 分類，
      其中混有室內照、藝術品特寫、招牌等非建築外景——這些照片任何偵測器都不可能「正確」。
      先審計測試集組成，才能給出不被資料雜訊汙染的結論。

用法：python tools/eval/vlm_cc_audit.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
from collections import Counter

import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "yolo-dataset"))
from vlm_label import api_key, vlm_classify, CLASSES  # noqa: E402

CC = ROOT / "photos-src" / "cc"
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"


def unseen_paths():
    ds_titles = set()
    attr = ROOT / "datasets" / "macau-buildings" / "ATTRIBUTION.csv"
    if attr.exists():
        for r in csv.DictReader(attr.open(encoding="utf-8-sig")):
            ds_titles.add(r["commons_title"])
    rows = list(csv.DictReader((CC / "ATTRIBUTION.csv").open(encoding="utf-8-sig")))
    out = []
    for r in rows:
        if r["class_id"] in CLASSES and r["commons_title"] not in ds_titles and (ROOT / r["file"]).exists():
            out.append(r)
    return out


def main():
    rows = unseen_paths()
    print(f"[audit] 未見過的 CC 測試照片 {len(rows)} 張")
    key = api_key()
    verdicts = vlm_classify([ROOT / r["file"] for r in rows], key, "deepseek-flash", "low", 12)

    from ultralytics import YOLO
    model = YOLO(str(WEIGHTS))
    stats = Counter()
    per_group = {"建築外景": [0, 0], "非建築": [0, 0]}      # [偵測到, 類別正確]
    detail = []
    for r in rows:
        v = verdicts.get(ROOT / r["file"], {})
        vlm_cls = v.get("class", "?")
        is_building = vlm_cls in CLASSES
        res = model.predict(ROOT / r["file"], conf=0.25, verbose=False)[0]
        top = model.names[int(res.boxes[0].cls[0])] if len(res.boxes) else None
        det = top is not None
        ok = det and top == r["class_id"]
        group = "建築外景" if is_building else "非建築"
        stats[f"{group}：{'有框到' if det else '沒框到'}"] += 1
        per_group[group][0] += 1 if det else 0
        per_group[group][1] += 1 if ok else 0
        detail.append(dict(file=r["file"], truth_class=r["class_id"], building_zh=r["building_zh"],
                           vlm_class=vlm_cls, vlm_conf=v.get("confidence"),
                           detected=top or "", detected_ok=ok))

    print("\n[audit] 測試集組成（由 VLM 判定）：")
    for k, v in stats.most_common():
        print(f"  {k:22} {v:3d}")
    nb = per_group["非建築"][0] + sum(v for k, v in stats.items() if k.startswith("非建築：沒框到"))
    b_total = per_group["建築外景"][0] + sum(v for k, v in stats.items() if k.startswith("建築外景：沒框到"))
    print(f"\n  判定為建築外景：{b_total} 張；判定為非建築：{nb} 張"
          f"（{nb / len(rows) * 100:.0f}% 的測試圖其實不是建築外景）")
    if b_total:
        print(f"  【只看建築外景】偵測率 {per_group['建築外景'][0]}/{b_total} = "
              f"{per_group['建築外景'][0] / b_total * 100:.0f}%、"
              f"偵測且類別正確 {per_group['建築外景'][1]}/{b_total} = "
              f"{per_group['建築外景'][1] / b_total * 100:.0f}%")

    out = ROOT / "tools" / "eval" / "out" / "cc-unseen-audit.csv"
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(detail[0].keys()))
        w.writeheader()
        w.writerows(detail)
    print(f"\n[out] {out.relative_to(ROOT)}（{len(detail)} 筆，可逐張檢視）")


if __name__ == "__main__":
    main()
