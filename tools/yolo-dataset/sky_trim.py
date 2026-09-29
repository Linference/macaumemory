"""保守的天空偵測與裁切：用來收緊 VLM 給的框。

為什麼需要：
    VLM 找得到建築，但框會偏鬆——實測 12 張裡框內天空像素中位數高達 0.53，
    因為模型傾向把「建築上方那一列」也算進去。這個模組只做「減法」：
    當框的外圈明顯是天空時往內縮，**永遠不會把框放大**，所以不會製造新錯誤。

規則（刻意保守）：
    外圈條帶與再往內一圈都要 ≥ 60% 天空像素才縮；每邊最多縮掉原本的 25%；
    縮完面積若剩不到 25% 就整張放棄修正（代表原始偵測本身就不可信）。
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

SKY_MIN = 0.60
MAX_SHRINK = 0.25
MIN_KEEP = 0.25


def imread_unicode(p: str | Path):
    """cv2.imread 在 Windows 上讀不了中文路徑；改用 np.fromfile + imdecode。"""
    try:
        return cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        return None


def sky_mask(bgr: np.ndarray) -> np.ndarray:
    """天空近似遮罩：偏藍（含夜晚深藍）或很亮且低飽和（陰天/過曝）。"""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    blueish = (h > 85) & (h < 135) & (s > 25) & (v > 110)
    dark_blue = (h > 90) & (h < 140) & (s > 60) & (v > 35)      # 夜景天空
    bright_low_sat = (s < 45) & (v > 190)
    return blueish | dark_blue | bright_low_sat


def sky_frac(mask: np.ndarray, box) -> float:
    x, y, w, h = (int(round(v)) for v in box)
    x, y = max(0, x), max(0, y)
    sub = mask[y:y + max(0, h), x:x + max(0, w)]
    return float(sub.mean()) if sub.size else 0.0


def trim_by_sky(box, mask: np.ndarray, sky_min: float = SKY_MIN,
                max_shrink: float = MAX_SHRINK, min_keep: float = MIN_KEEP):
    """回傳 (新框, 各邊縮掉比例, 是否套用)。"""
    H, W = mask.shape
    x, y, w, h = box
    x0, y0, x1, y1 = float(x), float(y), float(x + w), float(y + h)
    ox0, oy0, ox1, oy1 = x0, y0, x1, y1
    step = max(2, int(round(min(W, H) * 0.01)))

    def slice_for(axis, side, off):
        if axis == "y":
            yy = y0 + off if side < 0 else y1 + off
            a, b = sorted((int(yy), int(yy) + step))
            return slice(max(0, a), max(0, b)), slice(int(x0), int(x1))
        xx = x0 + off if side < 0 else x1 + off
        a, b = sorted((int(xx), int(xx) + step))
        return slice(int(y0), int(y1)), slice(max(0, a), max(0, b))

    def strip(axis, side):
        nonlocal x0, y0, x1, y1
        limit = (y1 - y0) if axis == "y" else (x1 - x0)
        moved = 0
        while moved < limit * max_shrink:
            off = moved if side < 0 else -moved
            s1 = mask[slice_for(axis, side, off)]
            inner_off = moved + step if side < 0 else -(moved + step)
            s2 = mask[slice_for(axis, side, inner_off)]
            if s1.size == 0 or s2.size == 0 or s1.mean() < sky_min or s2.mean() < sky_min:
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
        return moved / max(1.0, limit)

    shr = {"top": strip("y", -1), "bottom": strip("y", +1),
           "left": strip("x", -1), "right": strip("x", +1)}
    area0 = (ox1 - ox0) * (oy1 - oy0)
    area1 = (x1 - x0) * (y1 - y0)
    if area1 < min_keep * area0 or area1 <= 1:
        return [ox0, oy0, ox1 - ox0, oy1 - oy0], shr, False
    return [x0, y0, x1 - x0, y1 - y0], shr, True


EDGE_MIN = 0.02     # 邊緣密度門檻：低於此視為「空帶」（天空/地面/水面）
EDGE_PAD = 0.02     # 保留 2% 邊界，避免切到建築邊緣


def trim_by_edges(box, bgr: np.ndarray, edge_min: float = EDGE_MIN,
                  max_shrink: float = 0.30, pad: float = EDGE_PAD):
    """用邊緣密度剖面切掉框內「空的」上下帶。

    為什麼需要：天空遮罩抓不到「陰天灰白天空」與「夜間黑天空」，但這些區域的共同特徵是
    **沒有結構邊緣**。建築外牆／屋頂一定充滿邊緣，所以從外往內找第一個邊緣密度達標的
    列/欄，就能通用地貼緊建築的外緣——不分白天黑夜。
    只做減法，且每邊最多縮 30%。
    """
    H, W = bgr.shape[:2]
    x0, y0, w, h = (float(v) for v in box)
    x0i, y0i = int(round(x0)), int(round(y0))
    x1i, y1i = int(round(x0 + w)), int(round(y0 + h))
    x0i, y0i = max(0, x0i), max(0, y0i)
    x1i, y1i = min(W, x1i), min(H, y1i)
    if x1i - x0i < 8 or y1i - y0i < 8:
        return list(box), False
    sub = bgr[y0i:y1i, x0i:x1i]
    gray = cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 60, 160) > 0
    rows = edges.mean(axis=1)
    cols = edges.mean(axis=0)
    hh, ww = rows.shape[0], cols.shape[0]

    def first(profile, n, reverse=False):
        lim = int(n * max_shrink)
        idx = range(n - 1, n - 1 - lim, -1) if reverse else range(0, lim)
        for i in idx:
            if profile[i] >= edge_min:
                return i
        return None

    ti = first(rows, hh)
    bi = first(rows, hh, reverse=True)
    li = first(cols, ww)
    ri = first(cols, ww, reverse=True)
    if None in (ti, bi, li, ri) or ti >= bi or li >= ri:
        return list(box), False
    p = max(2, int(round(min(hh, ww) * pad)))
    ny0 = y0i + max(0, ti - p)
    ny1 = y0i + min(hh, bi + p + 1)
    nx0 = x0i + max(0, li - p)
    nx1 = x0i + min(ww, ri + p + 1)
    area0 = (x1i - x0i) * (y1i - y0i)
    area1 = (nx1 - nx0) * (ny1 - ny0)
    if area1 < 0.25 * area0 or area1 <= 4:
        return list(box), False
    return [float(nx0), float(ny0), float(nx1 - nx0), float(ny1 - ny0)], True


def refine_box(box, bgr: np.ndarray):
    """天空裁切 + 邊緣裁切，回傳 (新框, 診斷 dict)。"""
    diag: dict = {}
    m = sky_mask(bgr)
    b1, shr, ok1 = trim_by_sky(box, m)
    diag["sky_applied"] = ok1
    diag["sky_shrink"] = {k: round(v, 3) for k, v in shr.items()}
    diag["sky_before"] = round(sky_frac(m, box), 3)
    diag["sky_after"] = round(sky_frac(m, b1), 3)
    b2, ok2 = trim_by_edges(b1, bgr)
    diag["edge_applied"] = ok2
    return b2, diag
