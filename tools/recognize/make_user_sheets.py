"""為使用者提供的本機照片資料夾產生聯絡表，用來逐張目視挑選。

來源：C:\\Users\\LINKIT\\Desktop\\澳门著名建筑图片\\<中文資料夾名>\\*.jpg
輸出：tools/recognize/out/user-sheets/<id>-<n>.jpg

用法：
    python tools/recognize/make_user_sheets.py                  # 全部 29 棟
    python tools/recognize/make_user_sheets.py --only 大三巴牌坊,媽閣廟
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(r"C:\Users\LINKIT\Desktop\澳门著名建筑图片")
OUT = Path(__file__).resolve().parent / "out" / "user-sheets"

# 資料夾（簡體中文）→ 專案用建築 id。這份對照同時被 import_user_photos.py 使用。
FOLDER_TO_ID: dict[str, str] = {
    # 已在庫中
    "大三巴牌坊": "ruins-st-paul",
    "妈阁庙": "a-ma-temple",
    "民政总署大楼": "leal-senado",
    "港务局大楼": "moorish-barracks",
    "郑家大屋": "mandarins-house",
    "玫瑰堂": "st-dominic-church",
    "龙环葡韵": "taipa-houses",
    "澳门旅游塔": "macau-tower",
    "澳门科学馆": "macau-science-center",
    "威尼斯人度假村": "the-venetian",
    "巴黎人酒店": "parisian",
    "新葡京酒店": "grand-lisboa",
    # 新增
    "东望洋灯塔": "guia-fortress",
    "圣若瑟修院": "st-joseph-seminary",
    "岗顶剧院": "dom-pedro-v-theatre",
    "大炮台": "fortress-monte",
    "哪吒庙": "na-tcha-temple",
    "卢家大屋": "lou-kau-house",
    "关闸": "portas-do-cerco",
    "澳门博物馆": "macau-museum",
    "澳门大赛车博物馆": "grand-prix-museum",
    "澳门文化中心": "macau-cultural-centre",
    "澳门渔人码头": "fishermans-wharf",
    "澳门银河": "galaxy-macau",
    "澳门伦敦人": "londoner-macao",
    "永利澳门": "wynn-macau",
    "永利皇宫": "wynn-palace",
    "美高梅": "mgm-macau",
    "观音莲花苑": "kun-iam-statue",
}

CELL = 250
COLS = 6
LABEL_H = 20


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="逗號分隔的來源資料夾名")
    ap.add_argument("--per-sheet", type=int, default=30)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    index: dict[str, list[str]] = {}
    for folder, bid in sorted(FOLDER_TO_ID.items()):
        if only and folder not in only:
            continue
        d = SRC / folder
        if not d.is_dir():
            print(f"  !! 找不到資料夾：{d}")
            continue
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
        index[bid] = [f.name for f in files]
        sizes = []
        for start in range(0, len(files), args.per_sheet):
            chunk = files[start:start + args.per_sheet]
            rows = (len(chunk) + COLS - 1) // COLS
            sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL_H)), (11, 15, 20))
            draw = ImageDraw.Draw(sheet)
            for i, f in enumerate(chunk):
                cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL_H)
                try:
                    im = Image.open(f).convert("RGB")
                    sizes.append((im.width, im.height))
                    im.thumbnail((CELL, CELL), Image.LANCZOS)
                    sheet.paste(im, (cx + (CELL - im.width) // 2, cy))
                except Exception as e:
                    draw.text((cx + 4, cy + 4), f"讀取失敗 {e}", fill=(240, 180, 160))
                draw.text((cx + 4, cy + CELL + 3), f"{start + i:02d} {f.name[:30]}", fill=(205, 218, 232))
            n = start // args.per_sheet + 1
            p = OUT / f"{bid}-{n}.jpg"
            sheet.save(p, quality=88)
            print(f"  {p.name}  ({len(chunk)} 張)")
        if sizes:
            mn = (min(s[0] for s in sizes), min(s[1] for s in sizes))
            mx = (max(s[0] for s in sizes), max(s[1] for s in sizes))
            print(f"      {bid:24s} {len(files):3d} 張 · 最小 {mn[0]}x{mn[1]} 最大 {mx[0]}x{mx[1]}")

    (Path(__file__).resolve().parent / "out" / "user-folder-index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n共 {len(index)} 棟 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
