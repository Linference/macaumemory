import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
sys.path.insert(0, "tools/photo-archive")
from PIL import Image
from pipeline import ClipEngine
eng = ClipEngine()
img = Image.open(".cache/real-photo.jpg")
print("圖片尺寸:", img.size, "模式:", img.mode)
prompts = [
    ("a photo of a landscape with mountains", "風景／山"),
    ("a photo of a city street", "城市街道"),
    ("a photo of a building", "建築物"),
    ("a photo of the ruins of a church facade", "教堂前壁遺跡"),
    ("a photo of a bowl of noodles", "一碗麵"),
    ("a photo of a cat", "貓"),
    ("a photo of a person", "人"),
    ("an abstract wallpaper pattern", "抽象圖案"),
]
vf, cls = eng.encode(img)
tf = eng._encode_text([p for p, _ in prompts])
print("\n=== 真實照片 vs 各種文字描述（CLIP 餘弦相似度）===")
sims = [(float(sum(a*b for a, b in zip(vf, t))), zh) for (_, zh), t in zip(prompts, tf)]
for s, zh in sorted(sims, reverse=True):
    print(f"  {s:+.3f}  {'█' * max(0, int((s - 0.12) * 60)):<34} {zh}")
print("\n=== CLIP 對這張圖的 12 類建築分類結果 ===")
for c, v in cls["top"]:
    from taxonomy import CLASS_ZH
    print(f"  {v:.1%}  {CLASS_ZH[c]}")
