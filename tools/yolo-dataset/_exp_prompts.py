"""A/B 比較不同網格 prompt 的框緊實度（tightness），挑出最好的版本。

量測指標：
  - 框佔畫面比例（area_frac）與模型自評 ratio 的落差（落差大＝模型自己在心虛）
  - 「天空殘留率」：框中屬於天空的像素比例（用 HSV 亮藍＋高亮度＋低飽和度近似偵測天空）
  - 視覺聯絡表：實際讀圖檢視

用法：python tools/yolo-dataset/_exp_prompts.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vlm_bbox_label import (GRID, LETTERS, Usage, _font, _jpeg, api_key,  # noqa: E402
                            call_vlm, cells_box, draw_grid)

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(r"C:\Users\LINKIT\Desktop\澳门著名建筑图片")
OUT = ROOT / ".cache" / "vlm-label" / "exp"

COMMON_TAIL = """

另外請回報：
- ratio：這棟建築的可見面積大約佔整張畫面的幾分之幾（0~1）。
- n_buildings：畫面裡大約有幾棟明顯可辨識的建築（整數）。
- clean：畫面是否乾淨（true），或是有浮水印／文字標註／拼貼分割線／明顯後製（false）。
- complete：這棟建築是否完整可見（沒有被切掉大半、沒有被嚴重遮擋）。
- conf：你對以上判斷的信心（0~1）。

**直接輸出以下 JSON，不要有任何推理或說明文字：**
{{"col_from":2,"col_to":4,"row_from":2,"row_to":4,"ratio":0.35,"n_buildings":1,"clean":true,"complete":true,"is_building":true,"conf":0.85}}"""

HEAD = """看這張照片，畫面已疊加 {g}×{g} 網格：欄（左右）由左至右標為 1~{g}，列（上下）由上至下標為 A~{letters}。
網格標籤畫在圖片頂端、左端、右端、底端。
"""

VARIANTS = {
    # v1：原始版本（基準）
    "v1_base": HEAD + """
請找出畫面中**最大、最完整的那一棟建築**，回答它的主體佔到第幾欄到第幾欄、第幾列到第幾列。
- 只框建築本體（外牆、屋頂）。**不要把天空、地面、樹木、街道、水面、旗桿算進去**。
- 若畫面有多棟建築，只挑最大最完整的那一棟，不要把它們合併成一個大框。
- 若畫面裡沒有建築（純風景、室內特寫、食物、人物、地圖、文件），把 is_building 填 false。""" + COMMON_TAIL,

    # v2：加入「至少佔三分之一才算」的量化門檻
    "v2_thresh": HEAD + """
請找出畫面中**最大、最完整的那一棟建築**，然後判斷它的主體外牆範圍。
判斷規則（逐格檢查，寧可少算也不要多算）：
- 對最上面那列：如果那一列**大部分是天空**（建築只佔該列高度不到 1/3），就不要把那一列算進去。
- 對最下面那列：如果那一列**大部分是地面/馬路/台階/水池/草地**，就不要把那一列算進去。
- 同理處理最左欄與最右欄：如果那一欄大多是背景（天空、樹、鄰棟、空曠處），就不要算。
- 只框**建築物本身**（外牆、屋頂、塔身）。天空、雲、地面、樹木、街道、欄杆、旗桿一律不算。
- 若畫面有多棟建築，只挑最大最完整的那一棟，不要合併。
- 若畫面裡沒有建築，把 is_building 填 false。""" + COMMON_TAIL,

    # v3：要求先列出每列每欄的內容再決定（結構化）
    "v3_scan": HEAD + """
請找出畫面中**最大、最完整的那一棟建築**。
請先在心裏掃描每一列與每一欄的內容，再決定範圍。判斷規則（寧可少算也不要多算）：
- 最上面那列若主要是天空（建築佔該列不到 1/3）→ 排除。
- 最下面那列若主要是地面、台階、馬路、水池、草地 → 排除。
- 最左/最右欄若主要是背景、樹、鄰棟建築 → 排除。
- 只框建築本體（外牆、屋頂、塔身），不含天空、地面、樹木、街道、旗桿、欄杆。
- 若畫面有多棟建築，只挑最大最完整的那一棟。
- 若畫面裡沒有建築，把 is_building 填 false。
另外回報 tight_ratio：這棟建築佔**你所框的那個矩形**的面積比例（0~1，框很緊就接近 1）。""" + COMMON_TAIL.replace(
        '"is_building":true,"conf"', '"is_building":true,"tight_ratio":0.7,"conf"'),
}


def sky_frac(im: Image.Image, box) -> float:
    """框內「天空像素」比例（粗略近似：偏藍且亮，或接近純白且位於框上半）。"""
    x, y, w, h = (int(v) for v in box)
    x, y = max(0, x), max(0, y)
    crop = np.asarray(im.crop((x, y, x + w, y + h)).convert("RGB"), dtype=np.float32) / 255.0
    if crop.size == 0:
        return 0.0
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    mx, mn = crop.max(-1), crop.min(-1)
    blue = (b > r + 0.08) & (b > g + 0.03) & (mx > 0.5)
    return float(blue.mean())


def main():
    key = api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ("东望洋灯塔", "大三巴牌坊"):
        for i, v in enumerate(VARIANTS):
            pass
    imgs = []
    for name in ("东望洋灯塔", "大三巴牌坊"):
        imgs += sorted((SRC / name).glob("*.jpg"))[:6]
    usage = Usage()
    results = {}
    for p in imgs:
        with Image.open(p) as im0:
            im0 = im0.convert("RGB")
            sc = 896 / max(im0.size)
            if sc < 1.0:
                im0 = im0.resize((round(im0.width * sc), round(im0.height * sc)), Image.LANCZOS)
            W, H = im0.size
            base = im0
            gb = _jpeg(draw_grid(im0.copy()))
        for vname, vprompt in VARIANTS.items():
            parsed, u, fin = call_vlm(gb, "image/jpeg", key, "deepseek-flash",
                                      vprompt.format(g=GRID, letters=LETTERS))
            usage.add(u, vname, ok=parsed is not None)
            if not parsed:
                print(f"  {vname} {p.name}: 解析失敗")
                continue
            box = cells_box(parsed.get("col_from"), parsed.get("col_to"),
                            parsed.get("row_from"), parsed.get("row_to"), W, H)
            if not box:
                print(f"  {vname} {p.name}: 格子無法解析 {parsed}")
                continue
            area = box[2] * box[3] / (W * H)
            sk = sky_frac(base, box)
            results.setdefault(vname, []).append(
                {"file": str(p), "cells": [parsed.get("col_from"), parsed.get("row_from"),
                                           parsed.get("col_to"), parsed.get("row_to")],
                 "area": round(area, 3), "ratio": parsed.get("ratio"), "sky": round(sk, 3),
                 "conf": parsed.get("conf"), "n": parsed.get("n_buildings"), "box": [round(v, 1) for v in box]})
            print(f"  {vname:10} {p.parent.name:6}/{p.name:7} cells={results[vname][-1]['cells']} "
                  f"area={area:.3f} ratio={parsed.get('ratio')} sky={sk:.2f} conf={parsed.get('conf')}")

    print("\n=== 彙總 ===")
    for vname, rs in results.items():
        import statistics
        areas = [r["area"] for r in rs]
        skies = [r["sky"] for r in rs]
        print(f"{vname:10} n={len(rs)} area 中位={statistics.median(areas):.3f} "
              f"天空殘留 中位={statistics.median(skies):.3f} 平均={statistics.mean(skies):.3f}")

    # 視覺比較表：每個 variant 一列
    for vname, rs in results.items():
        cols = 6
        cell = 400
        rows = (len(rs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (cell + 6) + 6, rows * (cell + 30 + 6) + 6 + 30), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        f = _font(18)
        d.text((6, 4), f"variant {vname}", font=_font(24), fill=(255, 235, 120))
        for i, r in enumerate(rs):
            rr, cc = divmod(i, cols)
            x = 6 + cc * (cell + 6)
            y = 36 + rr * (cell + 30 + 6)
            with Image.open(r["file"]) as im:
                im = im.convert("RGB")
                sc = cell / max(im.size)
                im = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
                if im.width > cell or im.height > cell:
                    im = im.crop((0, 0, min(cell, im.width), min(cell, im.height)))
                dd = ImageDraw.Draw(im)
                bx = r["box"]
                dd.rectangle([bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3]], outline=(255, 40, 40), width=2)
                sheet.paste(im, (x + (cell - im.width) // 2, y))
            d.rectangle([x, y, x + cell, y + cell], outline=(80, 80, 90))
            d.text((x + 2, y + cell + 4), f"{Path(r['file']).parent.name}/{Path(r['file']).name} "
                                          f"a={r['area']:.2f} sky={r['sky']:.2f}", font=f, fill=(230, 230, 230))
        out = OUT / f"sheet-{vname}.jpg"
        sheet.save(out, "JPEG", quality=85)
        print(f"[out] {out.relative_to(ROOT)}")
    (OUT / "exp.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    usage.save()
    print(f"[api] calls={usage.calls} tokens={usage.pt + usage.ct}")


if __name__ == "__main__":
    main()
