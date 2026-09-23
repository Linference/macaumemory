from PIL import Image, ImageEnhance
from pathlib import Path
src = Path("photos-src/demo/大三巴牌坊-demo.jpg")
im = Image.open(src)
w, h = im.size
im2 = im.crop((int(w*0.12), int(h*0.10), int(w*0.88), int(h*0.92)))   # 不同取景
im2 = ImageEnhance.Brightness(im2).enhance(1.18)
im2 = ImageEnhance.Contrast(im2).enhance(1.08)
im2 = im2.rotate(-3, expand=True, fillcolor=(255,255,255))
im2.save("photos-src/demo/大三巴牌坊-demo2.jpg", quality=88)
print("已產生第二張大三巴照片:", im2.size)

# 另一棟：旅遊塔再拍一張（控制組）
src2 = Path("photos-src/demo/澳門旅遊塔-demo.jpg")
im3 = Image.open(src2)
w, h = im3.size
im3 = im3.crop((0, int(h*0.08), w, h)).resize((int(w*0.9), int(h*0.84)))
im3.save("photos-src/demo/澳門旅遊塔-demo2.jpg", quality=88)
print("已產生第二張旅遊塔照片")
