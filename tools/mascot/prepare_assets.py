"""把使用者生成的阿獅三視圖放進專案，並產生網站用的尺寸。

來源是生圖工具的輸出（1664×2496 PNG，右下角有生成器水印），處理：
    1. 裁掉底部水印
    2. 輸出網站用的 JPEG（原圖太大）
    3. 產生對話頭像用的方形裁切（對準臉部）

用法：python tools/mascot/prepare_assets.py
產出：public/mascot/ashih-front.jpg / ashih-side.jpg / ashih-back.jpg / ashih-avatar.jpg
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "mascot"
ATT = Path(r"C:\Users\LINKIT\.dsh\attachments\v1\objects")

SRC = {
    "front": ATT / "f2" / "f2ec72b6c3506cb46449bf95a156944501db7186b46b93049a1b753c27f5a99f",
    "side": ATT / "43" / "43d1f06e81eea67d294e35b0e9474a35d6bda69cd3b39723850a3e7dbe4f6d35",
    "back": ATT / "f7" / "f7621191e8b0b43e41718d00070b7c07692c17f5754b0b5113e5efa3a6c65f86",
}

WATERMARK_CROP = 0.045     # 底部裁掉比例（去掉生成器水印）
AVATAR_BOX = (0.12, 0.16, 0.88, 0.62)   # 頭像方形框（相對比例，對準臉部）


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, src in SRC.items():
        if not src.exists():
            print(f"  ✗ 找不到 {name}：{src}")
            continue
        im = Image.open(src).convert("RGB")
        w, h = im.size
        im = im.crop((0, 0, w, int(h * (1 - WATERMARK_CROP))))
        # 網站用：最長邊 1000px
        scale = 1000 / max(im.size)
        if scale < 1:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        out = OUT / f"ashih-{name}.jpg"
        im.save(out, "JPEG", quality=90, optimize=True)
        print(f"  ✓ {out.relative_to(ROOT)}  {im.size}  {out.stat().st_size / 1024:.0f} KB")

    front = Image.open(OUT / "ashih-front.jpg").convert("RGB")
    w, h = front.size
    x0, y0, x1, y1 = (int(w * AVATAR_BOX[0]), int(h * AVATAR_BOX[1]),
                      int(w * AVATAR_BOX[2]), int(h * AVATAR_BOX[3]))
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    box = (max(0, cx - side // 2), max(0, cy - side // 2))
    av = front.crop((box[0], box[1], box[0] + side, box[1] + side)).resize((512, 512), Image.LANCZOS)
    av.save(OUT / "ashih-avatar.jpg", "JPEG", quality=92, optimize=True)
    print(f"  ✓ {(OUT / 'ashih-avatar.jpg').relative_to(ROOT)}  512x512（頭像裁切，請檢查框是否對準臉）")


if __name__ == "__main__":
    main()
