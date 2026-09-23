import json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path

print("=" * 74)
print("① CLIP 零樣本分類 + 影像向量（判斷「這是什麼建築」與「是不是同一棟」）")
print("=" * 74)
s = Path("tools/photo-archive/pipeline.py").read_text(encoding="utf-8-sig")
for key in ["自.*模型", "logit_scale", "get_image_features", "cosine", "--same", "--review", "haversine"]:
    pass
import re
def show(pat, n=3, label=""):
    if label:
        print(f"\n--- {label} ---")
    hits = [l.rstrip() for l in s.split("\n") if re.search(pat, l)]
    for l in hits[:n]:
        print("   ", l.strip()[:118])

show(r"logit_scale", 2, "CLIP 相似度→機率（關鍵：要有 logit_scale 才會收斂）")
show(r"cosine\(", 3, "影像向量餘弦相似度（重複拍攝判定）")
show(r'args\.(same|review)', 3, "同一棟判定門檻")
show(r"haversine\(", 2, "地理距離（主鍵）")

print()
print("=" * 74)
print("② 模型與套件實際版本")
print("=" * 74)
import torch, transformers, ultralytics, cv2
print(f"  PyTorch       {torch.__version__}   CUDA={torch.cuda.is_available()}  {torch.cuda.get_device_name(0) if torch.cuda.is_available() else ''}")
print(f"  transformers  {transformers.__version__}   （CLIPModel / CLIPProcessor）")
print(f"  ultralytics   {ultralytics.__version__}   （YOLO11n 物件偵測）")
print(f"  OpenCV        {cv2.__version__}   （Haar 人臉偵測→模糊）")
from pathlib import Path as P
m = P(".cache/models/clip-vit-base-patch32/pytorch_model.bin")
print(f"  CLIP 模型      {m.stat().st_size/1048576:.0f} MB  clip-vit-base-patch32（151M 參數，512 維向量）")
