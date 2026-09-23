"""建築資料前後對比預覽：把 GeoJSON 用斜投影畫成 2.5D 城市模型，顏色依高度。

用途：無法開瀏覽器截圖時，用靜態圖驗證「高度模型」對天際線的實際影響。

用法：python tools/map/preview_buildings.py
產出：datasets/macau-buildings/out/height-before-after.png
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / ".cache" / "backup" / "macau-buildings.old.geojson"
NEW = ROOT / "public" / "data" / "macau-buildings.geojson"
OUT = ROOT / "datasets" / "macau-buildings" / "out" / "height-before-after.png"

# 兩塊示範區：南灣／新口岸（高樓＋老建築混雜）、路氹城（度假村群）
DISTRICTS = {
    "南灣・新口岸（高樓與老城混雜）": (113.536, 22.182, 113.557, 22.198),
    "路氹城（度假村群）": (113.556, 22.140, 113.578, 22.156),
}

# 高度 → 顏色（與 src/map-style.js 的 BUILDING_COLOR_BY_HEIGHT 同一組色階）
RAMP = [(0, "#a79d8b"), (12, "#b2a895"), (30, "#bdb3a0"), (60, "#c9c0ae"), (120, "#d6cebe"), (250, "#e3ddd0")]


def ramp_color(h: float) -> str:
    h = max(0.0, min(250.0, h))
    for (h0, c0), (h1, c1) in zip(RAMP, RAMP[1:]):
        if h <= h1:
            t = (h - h0) / (h1 - h0) if h1 > h0 else 0
            c0 = tuple(int(c0[i:i + 2], 16) for i in (1, 3, 5))
            c1 = tuple(int(c1[i:i + 2], 16) for i in (1, 3, 5))
            return "#%02x%02x%02x" % tuple(int(a + (b - a) * t) for a, b in zip(c0, c1))
    return RAMP[-1][1]


def load(geojson: Path, bbox):
    """取出範圍內的建築，回傳 (lon, lat, height) 的清單。"""
    w, s, e, n = bbox
    feats = json.loads(geojson.read_text(encoding="utf-8"))["features"]
    out = []
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        if max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n:
            continue
        props = f["properties"]
        h = props.get("h")
        if h is None:                      # 舊資料沒有面積模型時，用舊樣式的類型固定值
            t = props.get("t") or "yes"
            h = {"apartments": 21, "residential": 21, "commercial": 26, "hotel": 26, "yes": 13,
                 "house": 6.5, "detached": 6.5, "industrial": 12, "school": 16}.get(t, 12)
        out.append((ring, float(h), props.get("hs") or ("fixed" if props.get("h") is None else "measured")))
    return out


def draw(ax, buildings, bbox, title, subtitle):
    w, s, e, n = bbox
    lat0 = (s + n) / 2
    mx = 111320 * abs(__import__("math").cos(__import__("math").radians(lat0)))
    my = 110574
    # 斜投影：高度往上、往右上偏（等角感）
    def proj(lon, lat, h=0.0):
        x = (lon - w) * mx
        y = (lat - s) * my
        return x + h * 0.42, y * 1.0 + h * 1.15

    items = []
    for ring, h, src in buildings:
        pts = [proj(p[0], p[1]) for p in ring]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        items.append((cy, cx, ring, h, src))
    items.sort(key=lambda t: (t[0], t[1]))          # 由遠而近畫

    for _, _, ring, h, src in items:
        base = [proj(p[0], p[1]) for p in ring]
        top = [proj(p[0], p[1], h) for p in ring]
        col = ramp_color(h)
        # 側面（暗）— 以底部到頂部的外框模擬
        side = base + top[::-1]
        ax.add_patch(MPoly(side, closed=True, facecolor="#3a3a38", edgecolor="none", alpha=0.5, zorder=2))
        # 頂面（亮，依高度）
        ax.add_patch(MPoly(top, closed=True, facecolor=col, edgecolor="#1a1a18", linewidth=0.25, zorder=3))

    hs = [b[1] for b in buildings]
    hs_sorted = sorted(hs)
    p90 = hs_sorted[int(len(hs_sorted) * 0.9)] if hs_sorted else 0
    ax.set_xlim(-30, (e - w) * mx + p90 * 0.42 + 30)
    ax.set_ylim(-30, (n - s) * my + p90 * 1.15 + 30)
    ax.set_facecolor("#0f1620")
    ax.set_title(f"{title}\n{subtitle}", color="#10243A", fontsize=12, pad=10)
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color("#c9c2b4")


def main():
    if not OLD.exists():
        raise SystemExit(f"找不到舊資料 {OLD}（應為改動前的備份）")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(len(DISTRICTS), 2, figsize=(13, 6.4 * len(DISTRICTS)), facecolor="#f7f5f0")
    if len(DISTRICTS) == 1:
        axes = [axes]
    for r, (name, bbox) in enumerate(DISTRICTS.items()):
        old = load(OLD, bbox)
        new = load(NEW, bbox)
        draw(axes[r][0], old, bbox, f"{name}｜改動前", f"{len(old)} 棟・有高度 {sum(1 for b in old if b[2]=='measured')} 棟・其餘用類型固定值")
        draw(axes[r][1], new, bbox, f"{name}｜改動後", f"{len(new)} 棟・100% 有高度（實測 {sum(1 for b in new if b[2]=='measured')}＋面積模型 {sum(1 for b in new if b[2]=='area')}）")
    fig.suptitle("澳門建築高度模型：改動前後 2.5D 對比（顏色＝高度，斜投影非真實視角）", fontsize=15, color="#10243A", y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.985))
    fig.savefig(OUT, dpi=110, facecolor="#f7f5f0")
    print(f"[out] {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB")

    # 順便印出高度分布對比
    import statistics
    for name, bbox in DISTRICTS.items():
        for tag, path in (("改動前", OLD), ("改動後", NEW)):
            bs = load(path, bbox)
            hs = [b[1] for b in bs]
            print(f"  {name} {tag}：{len(bs)} 棟，高度中位 {statistics.median(hs):.1f} m，"
                  f"最高 {max(hs):.0f} m，不同高度值 {len(set(round(h) for h in hs))} 種")


if __name__ == "__main__":
    main()
