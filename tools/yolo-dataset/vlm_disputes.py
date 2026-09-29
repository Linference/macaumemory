"""把 VLM 與資料夾標籤不一致的圖做成聯絡表，人工判斷誰對。

用法：python tools/yolo-dataset/vlm_disputes.py [--out datasets/macau-buildings/out/vlm-disputes.jpg]
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
REP = ROOT / "datasets" / "macau-buildings" / "out" / "vlm-report.csv"
ZH = {"portuguese": "葡式", "temple": "廟宇", "church": "教堂", "tong_lau": "騎樓",
      "residential_tower": "高層住宅", "casino_hotel": "酒店娛樂", "civic": "公共",
      "industrial": "工業", "village": "村落", "monument": "牌坊紀念", "market": "街市",
      "not_building": "非建築"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "datasets/macau-buildings/out/vlm-disputes.jpg"))
    ap.add_argument("--min-conf", type=float, default=0.6)
    args = ap.parse_args()

    rows = [r for r in csv.DictReader(REP.open(encoding="utf-8-sig"))
            if r["agree"] == "False" and float(r["vlm_conf"]) >= args.min_conf]
    rows.sort(key=lambda r: -float(r["vlm_conf"]))
    if not rows:
        raise SystemExit("沒有高信心的不一致案例")

    CW, CH, PAD, CAP = 300, 210, 10, 42
    cols = 4
    nrows = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (CW + PAD) + PAD, nrows * (CH + CAP + PAD) + PAD + 40), (247, 245, 240))
    d = ImageDraw.Draw(sheet)
    fb = ImageFont.truetype(r"C:\Windows\Fonts\msjhbd.ttc", 15)
    f = ImageFont.truetype(r"C:\Windows\Fonts\msjh.ttc", 13)
    d.text((PAD, 10), f"VLM 高信心反對的 {len(rows)} 張（左：資料夾標籤　右：VLM 判斷）", font=fb, fill=(16, 32, 51))

    for i, r in enumerate(rows):
        rr, cc = divmod(i, cols)
        x = PAD + cc * (CW + PAD)
        y = 40 + PAD + rr * (CH + CAP + PAD)
        p = ROOT / r["file"]
        try:
            im = Image.open(p).convert("RGB")
        except Exception:
            continue
        im.thumbnail((CW, CH))
        sheet.paste(im, (x + (CW - im.width) // 2, y + (CH - im.height) // 2))
        d.rectangle((x, y, x + CW, y + CH), outline=(210, 205, 195))
        face = ZH.get(r["folder_class"], r["folder_class"])
        said = ZH.get(r["vlm_class"], r["vlm_class"])
        d.text((x + 2, y + CH + 4), f"標籤：{face}", font=f, fill=(180, 60, 50))
        d.text((x + 2, y + CH + 21), f"VLM：{said}（{r['vlm_conf']}）", font=f, fill=(30, 130, 90))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, quality=88)
    print(f"[out] {Path(args.out).relative_to(ROOT)}  {len(rows)} 張  {Path(args.out).stat().st_size//1024} KB")


if __name__ == "__main__":
    main()
