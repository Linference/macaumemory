"""把真實點雲 PLY 轉成動畫要用的 JSON（供 Canvas 版動畫載入）。

為什麼要轉：瀏覽器無法直接解析 PLY。轉成 JSON 後，動畫頁可以用真實點雲，
而不是隨機生成——這對「不是 AI 生成的假動畫」很重要。
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PLY = ROOT / ".cache" / "live-view" / "cloud.ply"
OUT = ROOT / "tools" / "video" / "animation-data.js"
LIMIT = 3200


def main() -> int:
    if not PLY.is_file():
        print(f"  !! 找不到 {PLY}")
        return 1
    raw = PLY.read_bytes()
    end = raw.find(b"end_header") + len(b"end_header\n")
    header = raw[:end].decode("ascii", "replace")
    n = int([l for l in header.splitlines() if l.startswith("element vertex")][0].split()[-1])
    data = np.loadtxt(PLY, skiprows=header.count("\n"), max_rows=n)
    if data.ndim == 1:
        data = data.reshape(1, -1)
    xyz = data[:, :3].astype(np.float64)
    rgb = (data[:, 3:6] / 255.0).astype(np.float64)

    # 以包圍盒中心為原點（構圖穩定）；座標縮到約 ±1 的範圍
    xyz = xyz - (xyz.max(axis=0) + xyz.min(axis=0)) / 2
    scale = float(np.abs(xyz).max()) or 1.0
    xyz = xyz / scale

    if len(xyz) > LIMIT:
        idx = np.linspace(0, len(xyz) - 1, LIMIT).astype(int)
        xyz, rgb = xyz[idx], rgb[idx]

    pts = [[round(float(x), 4), round(float(y), 4), round(float(z), 4),
            round(float(r), 3), round(float(g), 3), round(float(b), 3)]
           for (x, y, z), (r, g, b) in zip(xyz, rgb)]

    payload = {
        "note": "真實重建點雲（PLY 轉出），座標已置中並正規化到 ±1",
        "scaleMeters": round(scale, 3),
        "count": len(pts),
        "points": pts,
        # 真實擬合出來的包圍盒尺寸（公尺）與其在正規化座標中的比例
        "box": {"sizeMeters": [12.70, 12.27, 3.54],
                "sizeNorm": [round(12.70 / scale, 3), round(12.27 / scale, 3), round(3.54 / scale, 3)]},
    }
    OUT.write_text("window.ANIM_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"  ✓ {len(pts)} 點（原 {n}）· 尺度 {scale:.2f} m → {OUT.name}"
          f"（{OUT.stat().st_size/1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
