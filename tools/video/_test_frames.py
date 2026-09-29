"""快速測試：只渲染幾個關鍵帧，確認構圖與字幕正確後再跑完整 750 帧。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import render_innovation as R

# 各階段的代表帧
KEYS = [45, 150, 300, 450, 540, 620, 700, 735]

R.OUT.mkdir(parents=True, exist_ok=True)
pts, rgb = R.load_points()
print(f"  點雲 {len(pts)} 點")
fig = plt.figure(figsize=(R.W / R.DPI, R.H / R.DPI), dpi=R.DPI)
for i in KEYS:
    R.render(i, pts, rgb, fig)
    print(f"  ✓ 帧 {i}（{i/R.FPS:.1f}s）")
# 合成一張預覽
import PIL.Image as I
imgs = [I.open(R.OUT / f"{i:04d}.png") for i in KEYS]
cols, rows = 4, 2
tw, th = imgs[0].size[0] // 3, imgs[0].size[1] // 3
sheet = I.new("RGB", (tw * cols, th * rows), (11, 15, 20))
for k, im in enumerate(imgs[: cols * rows]):
    sheet.paste(im.resize((tw, th)), ((k % cols) * tw, (k // cols) * th))
sheet.save(R.OUT / "_preview.png")
print(f"  ✓ 預覽 → {R.OUT / '_preview.png'}")
