import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
sys.path.insert(0, "tools/photo-archive")
from pathlib import Path
from PIL import Image
from pipeline import ClipEngine

eng = ClipEngine()
imgs = {
    "大三巴①": "photos-src/demo/大三巴牌坊-demo.jpg",
    "大三巴②(裁切調亮轉3°)": "photos-src/demo/大三巴牌坊-demo2.jpg",
    "旅遊塔①": "photos-src/demo/澳門旅遊塔-demo.jpg",
    "旅遊塔②": "photos-src/demo/澳門旅遊塔-demo2.jpg",
    "巴黎人": "photos-src/demo/澳門巴黎人-demo.jpg",
}
vecs = {}
for name, f in imgs.items():
    im = Image.open(f)
    v, cls = eng.encode(im)
    vecs[name] = v

print("=" * 78)
print("【實驗一】影像 ↔ 影像：同一個嵌入空間裡的相似度（就是我判斷『拍過了』的依據）")
print("=" * 78)
names = list(vecs)
print("            " + "".join(f"{n[:8]:>11}" for n in names))
for a in names:
    row = "".join(f"{sum(x*y for x,y in zip(vecs[a],vecs[b])):>11.2f}" for b in names)
    print(f"{a[:10]:12}{row}")

print()
print("=" * 78)
print("【實驗二】影像 ↔ 文字：同一張圖（大三巴）與任意文字描述比對 —— 這就是『圖文對比』")
print("=" * 78)
prompts = [
    ("a photo of the ruins of a church facade in Macau", "英文：澳門教堂前壁遺跡"),
    ("a photo of a stone archway monument",              "英文：石造牌坊紀念物"),
    ("a photo of a modern high-rise apartment tower",    "英文：現代高層住宅"),
    ("a photo of a Portuguese colonial building",        "英文：葡式殖民建築"),
    ("a photo of a Chinese temple",                      "英文：中式廟宇"),
    ("a photo of a casino hotel with a glass facade",     "英文：酒店娛樂場"),
    ("a photo of a cat",                                 "英文：一隻貓"),
    ("a bowl of noodles",                                "英文：一碗麵"),
    ("澳門大三巴牌坊的照片",                              "中文（此模型是英文訓練，所以分數偏低）"),
    ("一座中式廟宇",                                      "中文"),
]
tfeats = eng._encode_text([p for p, _ in prompts])
tv = vecs["大三巴①"]
for (p, zh), tf in zip(prompts, tfeats):
    sim = float(sum(x*y for x, y in zip(tv, tf)))
    bar = "█" * max(0, int((sim - 0.1) * 40))
    print(f"  {sim:5.2f}  {bar:<30} {zh}")
