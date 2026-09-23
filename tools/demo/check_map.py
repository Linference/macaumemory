"""驗證示範頁的地圖幾何：用同一份邊界＋記憶點資料畫圖，確認投影與位置正確。

輸出 tools/demo/out/map-check.png（僅供檢查，不進版控）
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "demo" / "out"

BBOX = dict(lon0=113.525, lon1=113.600, lat0=22.103, lat1=22.222)
W = 100.0
H = 100.0 * ((BBOX["lat1"] - BBOX["lat0"]) / ((BBOX["lon1"] - BBOX["lon0"]) * 0.9262))


def proj(lon, lat):
    return ((lon - BBOX["lon0"]) / (BBOX["lon1"] - BBOX["lon0"]) * W,
            (BBOX["lat1"] - lat) / (BBOX["lat1"] - BBOX["lat0"]) * H)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    b = json.loads((ROOT / "public" / "data" / "macau-boundary.geojson").read_text(encoding="utf-8"))
    archive = json.loads((ROOT / "public" / "data" / "photo-archive.json").read_text(encoding="utf-8"))
    resorts = [("銀河", 113.5543, 22.1466), ("倫敦人", 113.5571, 22.1460), ("巴黎人", 113.5607, 22.1437)]

    fig, ax = plt.subplots(figsize=(6, 8), dpi=140)
    rings = []
    for f in b.get("features", []):
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else (g.get("coordinates") if g.get("type") == "MultiPolygon" else [])
        for poly in polys:
            for ring in poly:
                if len(ring) < 4:
                    continue
                xs, ys = zip(*[proj(c[0], c[1]) for c in ring])
                ax.plot(xs, ys, color="#3c5876", lw=0.8)
                rings.append(len(ring))

    for p in archive["places"]:
        x, y = proj(p["coords"][0], p["coords"][1])
        ax.plot(x, y, "o", color="#c0392b", ms=7)
        ax.annotate(f'{p["id"]} {p["zh"]}', (x, y), textcoords="offset points", xytext=(6, 4), fontsize=8)

    for name, lon, lat in resorts:
        x, y = proj(lon, lat)
        ax.plot(x, y, "s", color="#7f8c8d", ms=5)
        ax.annotate(name, (x, y), textcoords="offset points", xytext=(6, -10), fontsize=7.5, color="#516273")
        ax.add_patch(plt.Circle((x, y), 90 / (111320 * 0.9262) / (BBOX["lon1"] - BBOX["lon0"]) * W,
                                fill=False, ls="--", color="#c8a24a", lw=0.9))

    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.set_aspect("equal")
    ax.set_title(f"示範頁地圖幾何檢查（viewBox 0 0 {W:.0f} {H:.0f}）", fontsize=10)
    ax.grid(alpha=0.15)
    fig.tight_layout()
    p = OUT / "map-check.png"
    fig.savefig(p)
    print(f"[check] {p}  ({len(rings)} 個邊界環, 最大 {max(rings)} 點)")

    xs = [proj(pl["coords"][0], pl["coords"][1])[0] for pl in archive["places"]]
    ys = [proj(pl["coords"][0], pl["coords"][1])[1] for pl in archive["places"]]
    print(f"[check] 記憶點落點 x {min(xs):.1f}~{max(xs):.1f} / y {min(ys):.1f}~{max(ys):.1f}（應落在 0~{W:.0f} / 0~{H:.0f} 內）")


if __name__ == "__main__":
    main()
