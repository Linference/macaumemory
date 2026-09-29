"""實驗 2：用保守的 CV 天空裁切（sky trim）收緊 VLM 的框，量測改善幅度。

規則（刻意保守，寧可少修也不要修壞）：
  只在「外側那一圈明顯是天空」時才往內縮：外圈條帶與再往內一圈都必須 ≥ 60% 天空像素。
  每邊最多縮掉原本的 25%；修完若面積剩不到 25% 就放棄修正（代表偵測不可信）。

用法：python tools/yolo-dataset/_exp_trim.py
"""
import json
import statistics
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vlm_bbox_label import _font  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXP = ROOT / ".cache" / "vlm-label" / "exp"
OUT = ROOT / ".cache" / "vlm-label" / "trim"

SKY_MIN = 0.60
MAX_SHRINK = 0.25
MIN_KEEP = 0.25


def imread_unicode(p: Path):
    """cv2.imread 在 Windows 上讀不了中文路徑，改用 np.fromfile + imdecode。"""
    try:
        buf = np.fromfile(str(p), dtype=np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception:
        return None


def sky_mask(bgr: np.ndarray) -> np.ndarray:
    """天空近似遮罩：亮、低飽和、偏藍。"""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    blueish = (h > 85) & (h < 135) & (s > 25) & (v > 110)
    bright_low_sat = (s < 45) & (v > 190)
    return blueish | bright_low_sat


def sky_frac(mask: np.ndarray, b) -> float:
    x, y, w, h = (int(round(v)) for v in b)
    x, y = max(0, x), max(0, y)
    sub = mask[y:y + h, x:x + w]
    return float(sub.mean()) if sub.size else 0.0


def trim(box, mask: np.ndarray):
    """回傳 (新框, 各邊縮掉的比例, 是否套用)。"""
    H, W = mask.shape
    x, y, w, h = box
    x0, y0, x1, y1 = x, y, x + w, y + h
    orig = (x0, y0, x1, y1)
    step = max(2, int(round(min(W, H) * 0.01)))

    def strip(axis, side):
        """axis: 'y' 上下, 'x' 左右；side: -1 上/左, +1 下/右。"""
        nonlocal x0, y0, x1, y1
        limit = (y1 - y0) if axis == "y" else (x1 - x0)
        moved = 0
        while moved < limit * MAX_SHRINK:
            s1 = (slice(int(y0), int(y0) + step), slice(int(x0), int(x1))) if axis == "y" and side < 0 else \
                 (slice(int(y1) - step, int(y1)), slice(int(x0), int(x1))) if axis == "y" else \
                 (slice(int(y0), int(y1)), slice(int(x0), int(x0) + step)) if side < 0 else \
                 (slice(int(y0), int(y1)), slice(int(x1) - step, int(x1)))
            s2 = (slice(int(y0) + step, int(y0) + 2 * step), slice(int(x0), int(x1))) if axis == "y" and side < 0 else \
                 (slice(int(y1) - 2 * step, int(y1) - step), slice(int(x0), int(x1))) if axis == "y" else \
                 (slice(int(y0), int(y1)), slice(int(x0) + step, int(x0) + 2 * step)) if side < 0 else \
                 (slice(int(y0), int(y1)), slice(int(x1) - 2 * step, int(x1) - step))
            a = mask[s1]
            b = mask[s2]
            if a.size == 0 or b.size == 0 or a.mean() < SKY_MIN or b.mean() < SKY_MIN:
                break
            if axis == "y":
                if side < 0:
                    y0 += step
                else:
                    y1 -= step
            else:
                if side < 0:
                    x0 += step
                else:
                    x1 -= step
            moved += step
        return moved / max(1, limit)

    shr = {"top": strip("y", -1), "bottom": strip("y", +1), "left": strip("x", -1), "right": strip("x", +1)}
    area0 = (orig[2] - orig[0]) * (orig[3] - orig[1])
    area1 = (x1 - x0) * (y1 - y0)
    if area1 < MIN_KEEP * area0 or area1 <= 1:
        return box, shr, False
    return [x0, y0, x1 - x0, y1 - y0], shr, True


def main():
    data = json.loads((EXP / "exp.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    for vname, rs in data.items():
        rows = []
        for r in rs:
            p = Path(r["file"])
            bgr = imread_unicode(p)
            if bgr is None:
                print(f"  [skip] 讀不到 {p}")
                continue
            sc = 896 / max(bgr.shape[:2])
            if sc < 1.0:
                bgr = cv2.resize(bgr, (round(bgr.shape[1] * sc), round(bgr.shape[0] * sc)), interpolation=cv2.INTER_AREA)
            m = sky_mask(bgr)
            newb, shr, applied = trim(r["box"], m)
            H, W = m.shape
            a0 = r["box"][2] * r["box"][3] / (W * H)
            a1 = newb[2] * newb[3] / (W * H)
            rows.append({**r, "trim_box": [round(v, 1) for v in newb], "trim_applied": applied,
                         "sky_before": round(sky_frac(m, r["box"]), 3),
                         "sky_after": round(sky_frac(m, newb), 3),
                         "area_before": round(a0, 3), "area_after": round(a1, 3),
                         "shrink": {k: round(v, 3) for k, v in shr.items()}})
            print(f"  {vname:10} {p.parent.name:6}/{p.name:7} area {a0:.3f}→{a1:.3f} "
                  f"sky {rows[-1]['sky_before']:.2f}→{rows[-1]['sky_after']:.2f} {shr}")
        report[vname] = rows
        sb = [x["sky_before"] for x in rows]
        sa = [x["sky_after"] for x in rows]
        ab = [x["area_before"] for x in rows]
        aa = [x["area_after"] for x in rows]
        print(f"{vname:10} 天空殘留 中位 {statistics.median(sb):.3f} → {statistics.median(sa):.3f} | "
              f"面積 中位 {statistics.median(ab):.3f} → {statistics.median(aa):.3f} | "
              f"套用 {sum(1 for x in rows if x['trim_applied'])}/{len(rows)}")
    (OUT / "trim.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    # 視覺比較：前後並排
    for vname, rows in report.items():
        import PIL.Image as I
        import PIL.ImageDraw as D
        cols, cell = 6, 400
        n = len(rows)
        rr = (n + cols - 1) // cols
        sh = I.new("RGB", (cols * (cell + 6) + 6, rr * (cell + 30 + 6) + 6 + 30), (24, 24, 28))
        d = D.Draw(sh)
        d.text((6, 4), f"trim on {vname}  (blue=VLM box, red=after sky-trim)", font=_font(24), fill=(255, 235, 120))
        f = _font(18)
        for i, r in enumerate(rows):
            a, c = divmod(i, cols)
            x, y = 6 + c * (cell + 6), 36 + a * (cell + 30 + 6)
            im = I.open(r["file"]).convert("RGB")
            s = cell / max(im.size)
            im = im.resize((round(im.width * s), round(im.height * s)), I.LANCZOS)
            if im.width > cell or im.height > cell:
                im = im.crop((0, 0, min(cell, im.width), min(cell, im.height)))
            dd = D.Draw(im)
            for bx, col in ((r["box"], (60, 140, 255)), (r["trim_box"], (255, 40, 40))):
                dd.rectangle([bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3]], outline=col, width=3)
            sh.paste(im, (x + (cell - im.width) // 2, y))
            d.text((x + 2, y + cell + 4), f"{Path(r['file']).name} area {r['area_before']:.2f}→{r['area_after']:.2f}",
                   font=f, fill=(230, 230, 230))
        out = OUT / f"trim-{vname}.jpg"
        sh.save(out, "JPEG", quality=85)
        print(f"[out] {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
