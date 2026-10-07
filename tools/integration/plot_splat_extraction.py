"""Plot actual sparse-point selection as an SVG, without modifying photos."""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path("D:/tujian_model/20260918-165619_微信视频2026-09-18_132842_469/work/colmap/sparse/0/points3D.bin")
REPORT = ROOT / "output/integration/splat-seed-validation/target-selection.json"
OUTPUT = ROOT / "output/integration/splat-ui-check/extraction-points.svg"
report = json.loads(REPORT.read_text(encoding="utf-8-sig"))
points, colors = [], []
with SOURCE.open("rb") as stream:
    count = struct.unpack("<Q", stream.read(8))[0]
    for _ in range(count):
        row = struct.unpack("<QdddBBBd", stream.read(43))
        points.append(row[1:4])
        colors.append(row[4:7])
        track_count = struct.unpack("<Q", stream.read(8))[0]
        stream.seek(track_count * 8, 1)
assert count == report["totalPoints"], "Source reconstruction differs from the report"
selected = report["points"]
original_set = set(points)
assert all(tuple(point) in original_set for point in selected), "Selected points missing from source"
assert len(selected) == report["selectedPoints"]

yaw, elevation = math.radians(35), math.radians(24)
def project(point):
    x, y, z = point
    horizontal = x * math.cos(yaw) - z * math.sin(yaw)
    depth = x * math.sin(yaw) + z * math.cos(yaw)
    vertical = y * math.cos(elevation) - depth * math.sin(elevation)
    return horizontal, -vertical

projected = [project(point) for point in points]
target_projected = [project(point) for point in selected]
ordered_x = sorted(point[0] for point in projected)
ordered_y = sorted(point[1] for point in projected)
lower, upper = int(count * .005), min(count-1, int(count * .995))
xmin = min(ordered_x[lower], min(point[0] for point in target_projected))
xmax = max(ordered_x[upper], max(point[0] for point in target_projected))
ymin = min(ordered_y[lower], min(point[1] for point in target_projected))
ymax = max(ordered_y[upper], max(point[1] for point in target_projected))
displayed = sum(xmin <= x <= xmax and ymin <= y <= ymax for x, y in projected)
scale = min(980 / (xmax-xmin), 620 / (ymax-ymin))
cx, cy = (xmax+xmin)/2, (ymax+ymin)/2
def position(point, panel):
    x, y = point
    return 600 + panel * 1200 + (x-cx)*scale, 610 + (y-cy)*scale

parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1120" viewBox="0 0 2400 1120">',
         '<rect width="2400" height="1120" fill="#f6f4ed"/>',
         '<g font-family="Microsoft YaHei, sans-serif" fill="#183c36">',
         '<text x="85" y="95" font-size="47" font-weight="700">多视角测试框 → 三维点筛选</text>',
         '<text x="85" y="150" font-size="25" fill="#576760">室内流程样例 · 两张测试影格中的框，约束共同观测到的稀疏点</text>',
         f'<text x="140" y="240" font-size="34">原始重建：{count:,} 个点</text>',
         f'<text x="1340" y="240" font-size="34">测试框筛选：{len(selected):,} 个点</text>',
         '<path d="M1200 220V950" stroke="#d9ded7" stroke-width="2"/>',
         f'<text x="85" y="1020" font-size="23" fill="#576760">同一投影视角与比例；视窗显示 {displayed:,} 个场景点，并保留全部筛选点。灰色：场景；绿色：筛选点。</text>',
         '<text x="85" y="1070" font-size="23" fill="#576760">视窗取场景 0.5–99.5% 分位主体范围。测试框来自自动化流程验证；建筑精度仍待独立评估。</text>',
         '</g>']
for panel in (0, 1):
    parts.append(f'<g opacity="{.65 if panel == 0 else .12}">')
    for point, rgb in zip(projected, colors):
        if not (xmin <= point[0] <= xmax and ymin <= point[1] <= ymax):
            continue
        x, y = position(point, panel)
        color = '#%02x%02x%02x' % rgb if panel == 0 else '#73817b'
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="1.25" fill="{color}"/>')
    parts.append('</g>')
for point in selected:
    x, y = position(project(point), 1)
    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4.1" fill="#13846f"/>')
parts.append('</svg>')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(''.join(parts), encoding='utf-8')
print(f"Verified {count} source points and {len(selected)} selected points; saved {OUTPUT}")
