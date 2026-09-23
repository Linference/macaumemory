"""組裝評測資料集清單：多視角渲染 + 既有示範照片 + （之後）真實手機照片。

產出 tools/eval/dataset/dataset.csv：
    file,building_id,building_zh,class_id,tier,note

tier 的意義
    render-base / render-cond / render-cond2   本專案 GLB 多視角渲染（受控實驗）
    demo-map                                   既有示範照片＝3D 地圖截圖
    demo-crop                                  同一張截圖的裁切（資料洩漏對照組，主實驗排除）
    real-phone                                 真實手機實拍（使用者提供；檔名自動編號）

用法：
    python tools/eval/build_dataset.py
    python tools/eval/build_dataset.py --check     # 只檢查還缺哪些建築的實拍
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "tools" / "eval"
DATASET = EVAL / "dataset"
RENDERS_MANIFEST = DATASET / "manifest.json"
OUT_CSV = DATASET / "dataset.csv"
REAL_DIR = ROOT / "photos-src" / "real"

# 建築／文物主檔：id → (中文名, 12 類別 id, 種類)
CATALOG = {
    "macau-tower": ("澳門旅遊塔", "civic", "building"),
    "parisian": ("澳門巴黎人", "casino_hotel", "building"),
    "macau-science-center": ("澳門科學館", "civic", "building"),
    "galaxy-macau": ("澳門銀河", "casino_hotel", "building"),
    "londoner-macao": ("澳門倫敦人", "casino_hotel", "building"),
    "ruins-st-paul": ("大三巴牌坊", "monument", "building"),
    "tang-sancai-camel": ("唐三彩雙峰駱駝俑", "artifact", "artifact"),
    "yongle-blue-white-flask": ("明永樂青花葫蘆扁瓶", "artifact", "artifact"),
}

# 既有示範照片（3D 地圖截圖）→ 建築 id；crop 檔是被裁切的第二張，屬資料洩漏對照
DEMO_MAP = {
    "大三巴牌坊-demo.jpg": ("ruins-st-paul", "demo-map", "3D 地圖截圖（大三巴無 GLB 模型）"),
    "大三巴牌坊-demo2.jpg": ("ruins-st-paul", "demo-crop", "同一張截圖裁切＋調亮（洩漏對照，主實驗排除）"),
    "澳門旅遊塔-demo.jpg": ("macau-tower", "demo-map", "3D 地圖截圖"),
    "澳門旅遊塔-demo2.jpg": ("macau-tower", "demo-crop", "同一張截圖裁切（洩漏對照，主實驗排除）"),
    "澳門科學館-demo.jpg": ("macau-science-center", "demo-map", "3D 地圖截圖"),
    "澳門巴黎人-demo.jpg": ("parisian", "demo-map", "3D 地圖截圖"),
}

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
CC_DIR = ROOT / "photos-src" / "cc"
CC_ATTR = CC_DIR / "ATTRIBUTION.csv"


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


def rows_from_renders():
    if not RENDERS_MANIFEST.exists():
        return []
    data = json.loads(RENDERS_MANIFEST.read_text(encoding="utf-8"))
    out = []
    for r in data.get("renders", []):
        zh, cls, _kind = CATALOG.get(r["model"], (r["model"], "unknown", "building"))
        out.append(dict(
            file=r["file"], building_id=r["model"], building_zh=zh, class_id=cls,
            tier=f"render-{r['tier']}",
            note=f"GLB 多視角渲染 az={r['az']} el={r['el']} dist={r['dist']} bg={r['bg']} @{r['res']}px",
        ))
    return out


def rows_from_demo():
    out = []
    demo_dir = ROOT / "photos-src" / "demo"
    if not demo_dir.exists():
        return out
    for name, (bid, tier, note) in DEMO_MAP.items():
        p = demo_dir / name
        if p.exists():
            zh, cls, _kind = CATALOG[bid]
            out.append(dict(file=rel(p), building_id=bid, building_zh=zh, class_id=cls, tier=tier, note=note))
    return out


def rows_from_real():
    out = []
    if not REAL_DIR.exists():
        return out
    for sub in sorted(p for p in REAL_DIR.iterdir() if p.is_dir()):
        bid = sub.name
        if bid not in CATALOG:
            print(f"[warn] photos-src/real/{bid} 不在主檔中，略過（請用 CATALOG 裡的 id）")
            continue
        zh, cls, _kind = CATALOG[bid]
        for f in sorted(sub.iterdir()):
            if f.suffix.lower() in IMG_EXT:
                out.append(dict(file=rel(f), building_id=bid, building_zh=zh, class_id=cls,
                                tier="real-phone", note="使用者實拍（手機）"))
    return out


def rows_from_cc():
    """Wikimedia Commons 實拍照片（開放授權，含作者／授權／日期）。
    這些是**真實照片**，是評估真實世界表現的主要依據。"""
    if not CC_ATTR.exists():
        return []
    out = []
    with CC_ATTR.open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if not (ROOT / r["file"]).exists():
                continue
            out.append(dict(
                file=r["file"], building_id=r["building_id"], building_zh=r["building_zh"],
                class_id=r["class_id"], tier="real-cc",
                note=f'Commons · {r["license"]} · {r["author"][:32]} · {r["date"][:10]}',
            ))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只報告實拍覆蓋率")
    args = ap.parse_args()

    rows = rows_from_renders() + rows_from_demo() + rows_from_real() + rows_from_cc()
    if not args.check:
        DATASET.mkdir(parents=True, exist_ok=True)
        with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["file", "building_id", "building_zh", "class_id", "tier", "note"])
            w.writeheader()
            w.writerows(rows)
        print(f"[dataset] {len(rows)} 張 → {rel(OUT_CSV)}")

    by_tier, by_building = {}, {}
    for r in rows:
        by_tier[r["tier"]] = by_tier.get(r["tier"], 0) + 1
        by_building.setdefault(r["building_id"], {}).setdefault(r["tier"], 0)
        by_building[r["building_id"]][r["tier"]] += 1

    print("\n=== 各來源張數 ===")
    for k, v in sorted(by_tier.items()):
        print(f"  {k:16} {v:4d}")
    print("\n=== 各建築（render-base / demo-map / real-cc / real-phone）===")
    all_ids = list(dict.fromkeys(list(CATALOG) + [r["building_id"] for r in rows]))
    for bid in all_ids:
        zh = CATALOG.get(bid, (bid, "?", ""))[0]
        d = by_building.get(bid, {})
        cc, real = d.get("real-cc", 0), d.get("real-phone", 0)
        flag = ""
        if cc == 0 and real == 0:
            flag = "   ← 只有渲染圖，缺實拍"
        elif cc + real < 3:
            flag = "   ← 實拍不足 3 張"
        print(f"  {bid:24} {zh:12} render={d.get('render-base', 0):3d} demo={d.get('demo-map', 0)} "
              f"cc={cc:2d} phone={real}{flag}")
    print(f"\nCommons 實拍：{rel(CC_DIR)}（授權與作者見 ATTRIBUTION.csv）")
    print(f"手機實拍目錄：{rel(REAL_DIR)}/<building_id>/*.jpg（放進去後重跑本腳本就自動納入）")


if __name__ == "__main__":
    main()
