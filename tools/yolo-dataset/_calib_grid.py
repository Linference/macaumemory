"""網格標註校正實驗：用「已知正確答案」的合成圖量測 VLM 的系統性偏差。

做法：在真實照片上貼一個明顯的合成方塊（純色、帶邊框），方塊的真實位置已知，
      跑 VLM 的網格 prompt，比較回報的格子與真實格子差幾格。
      這樣就能分離「模型讀網格的能力」與「模型判斷真實建築邊界的能力」。

用法：python tools/yolo-dataset/_calib_grid.py
"""
import json
import random
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vlm_bbox_label import (GRID, LETTERS, PROMPT, Usage, api_key, call_vlm,  # noqa: E402
                            cells_box, draw_grid, _jpeg)

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(r"C:\Users\LINKIT\Desktop\澳门著名建筑图片")
OUT = ROOT / ".cache" / "vlm-label" / "calib"


def make_case(path: Path, W: int = 896) -> tuple[bytes, tuple, tuple]:
    with Image.open(path) as im:
        im = im.convert("RGB")
        sc = W / max(im.size)
        if sc < 1.0:
            im = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
        w, h = im.size
        rng = random.Random(zlib.crc32(path.name.encode()))
        c0 = rng.randint(1, GRID - 2)
        c1 = rng.randint(c0 + 1, GRID)
        r0 = rng.randint(1, GRID - 2)
        r1 = rng.randint(r0 + 1, GRID)
        d = ImageDraw.Draw(im)
        x0, x1 = w * (c0 - 1) / GRID, w * c1 / GRID
        y0, y1 = h * (r0 - 1) / GRID, h * r1 / GRID
        col = rng.choice([(255, 60, 60), (60, 120, 255), (40, 190, 90), (255, 180, 40)])
        d.rectangle([x0, y0, x1, y1], fill=col, outline=(0, 0, 0), width=6)
        d.ellipse([(x0 + x1) / 2 - 30, (y0 + y1) / 2 - 30, (x0 + x1) / 2 + 30, (y0 + y1) / 2 + 30],
                  fill=(255, 255, 255), outline=(0, 0, 0), width=4)
        overlay = im
    return _jpeg(draw_grid(overlay)), (c0, r0, c1, r1), (w, h)


CALIB_PROMPT = PROMPT.replace(
    "請找出畫面中**最大、最完整的那一棟建築**，回答它的主體佔到第幾欄到第幾欄、第幾列到第幾列。",
    "畫面中有一個**純色實心方塊（正中央有白色圓點）**，那不是建築。請回答那個方塊佔到第幾欄到第幾欄、第幾列到第幾列（只算方塊本身）。"
).replace("- 只框建築本體（外牆、屋頂）。**不要把天空、地面、樹木、街道、水面、旗桿算進去**。", "")


def main():
    key = api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    imgs = []
    for name in ("东望洋灯塔", "大三巴牌坊", "妈阁庙", "威尼斯人度假村", "卢家大屋", "关闸"):
        fs = sorted((SRC / name).glob("*.jpg"))
        imgs.append(fs[3])
    usage = Usage()
    rows = []
    for p in imgs:
        b, truth, (w, h) = make_case(p)
        (OUT / f"{p.parent.name}__{p.stem}.jpg").write_bytes(b)
        parsed, u, fin = call_vlm(b, "image/jpeg", key, "deepseek-flash",
                                  CALIB_PROMPT.format(g=GRID, letters=LETTERS))
        usage.add(u, "calib", ok=parsed is not None)
        if not parsed:
            print(f"{p.parent.name}/{p.name}: 解析失敗 finish={fin}")
            continue
        got = (parsed.get("col_from"), parsed.get("row_from"), parsed.get("col_to"), parsed.get("row_to"))
        try:
            gt = tuple(int(v) for v in got)
            dc0, dr0, dc1, dr1 = (gt[0] - truth[0], gt[1] - truth[1], gt[2] - truth[2], gt[3] - truth[3])
            iou = None
            bx = cells_box(gt[0], gt[2], gt[1], gt[3], w, h)
            tb = cells_box(truth[0], truth[2], truth[1], truth[3], w, h)
            if bx and tb:
                ix = max(0, min(bx[0] + bx[2], tb[0] + tb[2]) - max(bx[0], tb[0]))
                iy = max(0, min(bx[1] + bx[3], tb[1] + tb[3]) - max(bx[1], tb[1]))
                inter = ix * iy
                iou = inter / (bx[2] * bx[3] + tb[2] * tb[3] - inter)
            print(f"{p.parent.name:8}/{p.name:8} truth={truth} got={gt} "
                  f"delta(c0,r0,c1,r1)=({dc0},{dr0},{dc1},{dr1}) IoU={iou:.2f}")
            rows.append({"img": str(p), "truth": truth, "got": gt,
                         "delta": [dc0, dr0, dc1, dr1], "iou": iou, "raw": parsed})
        except (TypeError, ValueError):
            print(f"{p.parent.name}/{p.name}: 非整數 {got}")
    usage.save()
    if rows:
        import statistics
        for i, nm in enumerate(("dc0", "dr0", "dc1", "dr1")):
            ds = [r["delta"][i] for r in rows]
            print(f"  {nm}: mean={statistics.mean(ds):+.2f} median={statistics.median(ds):+.1f} vals={ds}")
        print(f"  IoU: mean={statistics.mean(r['iou'] for r in rows):.3f} "
              f"median={statistics.median(r['iou'] for r in rows):.3f}")
        print(f"  API calls={usage.calls} tokens={usage.pt + usage.ct}")
    (OUT / "calib.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
