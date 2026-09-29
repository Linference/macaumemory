"""VLM 標註品管：把 .cache/vlm-label/labels.json 過濾成可併入資料集的名單。

VLM 的框不可全信，因此這裡用明確規則逐條把關（每一條都記錄原因，可回溯）：

  R1  檔案不存在 / 讀不到
  R2  框座標含 NaN 或越界（超出影像範圍）
  R3  框佔畫面比例 > 0.95（幾乎框滿整張＝偷懶或建築真的佔滿，一律視為可疑）
  R4  框佔畫面比例 < 0.02（太小，框不可信；這類圖多為遠景全景）
  R5  長寬比極端（> 8 或 < 1/8，例如 10:1 細長條）
  R6  模型判斷「不是建築」(is_building=false) 或信心 < 0.5
  R7  模型自評佔比與實際框面積落差 > 0.45（模型自己在心虛，框明顯偏鬆）
  R8  原圖最短邊 < 200px（解析度太低，框的精度沒有意義）
  R9  近似重複圖（縮圖灰階 dHash 距離 ≤ 6，只留第一張）

另外「標記但不剔除」的兩個旗標，供類別平衡階段加權：
  clean=false → 畫面有浮水印/文字/拼貼（實測 857 張裡比例很高，全剔除會損失太多資料）
  n_buildings>=3 → 畫面有多棟建築，框可能挑錯棟

輸出：
  .cache/vlm-label/selection.json    每張的判定與最終框（含正規化後的 YOLO 標籤）
  .cache/vlm-label/filter-report.csv 逐張判定明細
  .cache/vlm-label/stats.json        各規則剔除統計

用法：
    python tools/yolo-dataset/filter_vlm_labels.py
    python tools/yolo-dataset/filter_vlm_labels.py --max-area 0.90 --dup-dist 4
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".cache" / "vlm-label"
CACHE = WORK / "labels.json"
OUT = WORK / "selection.json"
REPORT = WORK / "filter-report.csv"
STATS = WORK / "stats.json"

CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]
FOLDER_CLASS = {
    "大三巴牌坊": "monument", "哪吒庙": "temple", "大炮台": "monument", "妈阁庙": "temple",
    "玫瑰堂": "church", "民政总署大楼": "civic", "港务局大楼": "portuguese",
    "郑家大屋": "tong_lau", "卢家大屋": "tong_lau", "龙环葡韵": "portuguese",
    "圣若瑟修院": "church", "岗顶剧院": "civic", "东望洋灯塔": "monument", "关闸": "monument",
    "澳门博物馆": "civic", "澳门大赛车博物馆": "civic", "澳门文化中心": "civic",
    "澳门旅游塔": "civic", "澳门科学馆": "civic", "澳门渔人码头": "casino_hotel",
    "威尼斯人度假村": "casino_hotel", "巴黎人酒店": "casino_hotel", "新葡京酒店": "casino_hotel",
    "澳门银河": "casino_hotel", "澳门伦敦人": "casino_hotel", "永利澳门": "casino_hotel",
    "永利皇宫": "casino_hotel", "美高梅": "casino_hotel", "观音莲花苑": "monument",
}


def dhash(im: Image.Image, size: int = 8) -> int:
    """差異雜湊：縮成 (size+1)×size 灰階，比較相鄰像素亮暗。"""
    g = im.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for r in range(size):
        base = r * (size + 1)
        for c in range(size):
            bits = (bits << 1) | (1 if px[base + c] < px[base + c + 1] else 0)
    return bits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-area", type=float, default=0.95)
    ap.add_argument("--min-area", type=float, default=0.02)
    ap.add_argument("--max-aspect", type=float, default=8.0)
    ap.add_argument("--min-conf", type=float, default=0.5)
    ap.add_argument("--max-ratio-gap", type=float, default=0.45)
    ap.add_argument("--min-side", type=int, default=200)
    ap.add_argument("--dup-dist", type=int, default=6)
    ap.add_argument("--keep-dirty", action="store_true",
                    help="連 clean=false（浮水印/拼貼）也保留；預設保留但標記")
    args = ap.parse_args()

    data = json.loads(CACHE.read_text(encoding="utf-8"))
    print(f"[filter] 讀入 {len(data)} 筆 VLM 結果")

    rows: list[dict] = []
    hashes: dict[int, list[str]] = defaultdict(list)
    stats = Counter()
    per_class_kept: Counter = Counter()
    stats_codes: Counter = Counter()

    for key, r in sorted(data.items(), key=lambda kv: kv[0]):
        folder = r.get("folder") or Path(key).parent.name
        cls = FOLDER_CLASS.get(folder)
        row = {"file": key, "folder": folder, "class": cls, "name": r.get("name"),
               "reject": "", "flagged": "", "vlm_ok": bool(r.get("ok"))}
        if cls is None:
            row["reject"] = "R0: 資料夾不在類別對照表"
            stats["R0"] += 1
            rows.append(row)
            continue
        if not r.get("ok"):
            row["reject"] = "R1: VLM 標註失敗"
            stats["R1"] += 1
            rows.append(row)
            continue
        p = Path(key)
        if not p.exists():
            row["reject"] = "R1: 來源檔不存在"
            stats["R1"] += 1
            rows.append(row)
            continue

        box = r.get("final_box")
        gw, gh = r.get("grid_size") or [None, None]
        osc = (r.get("orig_size") or [None, None])
        ok = True
        # R2 座標
        if (not box or len(box) != 4 or gw is None
                or any(v is None or v != v for v in box)
                or min(box[2], box[3]) <= 0
                or box[0] < -1 or box[1] < -1
                or box[0] + box[2] > gw * 1.01 or box[1] + box[3] > gh * 1.01):
            row["reject"] = "R2: 座標越界/NaN/退化"
            stats["R2"] += 1
            ok = False
        # R3/R4 面積
        if ok:
            area = box[2] * box[3] / (gw * gh)
            row["area"] = round(area, 4)
            if area > args.max_area:
                row["reject"] = f"R3: 框佔畫面 {area:.2f} > {args.max_area}"
                stats["R3"] += 1
                ok = False
            elif area < args.min_area:
                row["reject"] = f"R4: 框佔畫面 {area:.3f} < {args.min_area}"
                stats["R4"] += 1
                ok = False
        # R5 長寬比
        if ok:
            ar = box[2] / box[3]
            row["aspect"] = round(ar, 2)
            if ar > args.max_aspect or ar < 1 / args.max_aspect:
                row["reject"] = f"R5: 長寬比 {ar:.1f} 極端"
                stats["R5"] += 1
                ok = False
        # R6 語意旗標
        if ok:
            st = r.get("stages", {}).get("full", {})
            conf = st.get("conf")
            row["conf"] = conf
            row["n_buildings"] = st.get("n_buildings")
            row["clean"] = st.get("clean")
            row["complete"] = st.get("complete")
            if st.get("is_building") is False:
                row["reject"] = "R6: VLM 判為非建築"
                stats["R6"] += 1
                ok = False
            elif conf is None or conf < args.min_conf:
                row["reject"] = f"R6: 信心 {conf} < {args.min_conf}"
                stats["R6"] += 1
                ok = False
        # R7 自評落差
        if ok:
            gap = r.get("ratio_gap")
            row["ratio_gap"] = gap
            if gap is not None and gap > args.max_ratio_gap:
                row["reject"] = f"R7: 自評落差 {gap:.2f} > {args.max_ratio_gap}"
                stats["R7"] += 1
                ok = False
        # R8 解析度
        if ok and osc and osc[0] and min(osc) < args.min_side:
            row["reject"] = f"R8: 原圖最短邊 {min(osc)}px < {args.min_side}"
            stats["R8"] += 1
            ok = False

        # 旗標（不剔除，但影響類別平衡的優先序）
        if ok:
            flags = []
            if row.get("clean") is False:
                flags.append("dirty")
            if (row.get("n_buildings") or 1) >= 3:
                flags.append("multibldg")
            if row.get("complete") is False:
                flags.append("incomplete")
            row["flagged"] = ",".join(flags)

        # R9 近似重複
        if ok:
            try:
                with Image.open(p) as im:
                    h = dhash(im)
                dup_of = None
                for hh, files in hashes.items():
                    if bin(hh ^ h).count("1") <= args.dup_dist:
                        dup_of = files[0]
                        break
                if dup_of:
                    row["reject"] = f"R9: 近似重複於 {Path(dup_of).name}"
                    stats["R9"] += 1
                    ok = False
                else:
                    hashes[h].append(key)
            except Exception as e:
                row["reject"] = f"R1: 開圖失敗 {type(e).__name__}"
                stats["R1"] += 1
                ok = False

        if ok:
            # 換算成 YOLO 正規化標籤（依送出去那張圖的尺寸；與原圖比例一致）
            x, y, w, h = box
            row["norm"] = [round((x + w / 2) / gw, 6), round((y + h / 2) / gh, 6),
                           round(w / gw, 6), round(h / gh, 6)]
            row["orig_size"] = osc
            row["kept"] = True
            per_class_kept[cls] += 1
            stats["KEEP"] += 1
        else:
            row["kept"] = False
        rows.append(row)

    # ---- 輸出 ----
    WORK.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("", encoding="utf-8")
    with REPORT.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["file", "folder", "class", "name", "kept", "reject",
                                          "flagged", "area", "aspect", "conf", "n_buildings",
                                          "clean", "complete", "ratio_gap"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    OUT.write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")

    total = len(rows)
    kept = stats["KEEP"]
    print(f"\n[filter] 總計 {total} 張，採用 {kept}（{kept / max(1, total):.1%}），剔除 {total - kept}")
    print("[filter] 各規則剔除：")
    for k in sorted(stats):
        if k != "KEEP":
            print(f"    {k:4} {stats[k]:5d}")
    print("[filter] 採用後各類別張數：")
    for c in CLASSES:
        print(f"    {c:20} {per_class_kept.get(c, 0):4d}")
    fl = Counter(f for r in rows if r.get("kept") for f in (r.get("flagged") or "").split(",") if f)
    print(f"[filter] 旗標（保留但標記）：{dict(fl)}")
    STATS.write_text(json.dumps({"total": total, "kept": kept,
                                 "reject_by_rule": {k: v for k, v in stats.items() if k != "KEEP"},
                                 "kept_per_class": dict(per_class_kept),
                                 "flags": dict(fl)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[out] {OUT.relative_to(ROOT)}")
    print(f"[out] {REPORT.relative_to(ROOT)}")
    print(f"[out] {STATS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
