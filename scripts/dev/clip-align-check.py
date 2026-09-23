import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
sys.path.insert(0, "tools/photo-archive")
import torch
from PIL import Image
from pipeline import ClipEngine

eng = ClipEngine()
m, proc, dev = eng.model, eng.processor, eng.device

print("=== 模型結構檢查 ===")
print("  config.projection_dim =", getattr(m.config, "projection_dim", None))
print("  has vision_model/text_model:", hasattr(m, "vision_model"), hasattr(m, "text_model"))
print("  has visual_projection/text_projection:", hasattr(m, "visual_projection"), hasattr(m, "text_projection"))
print("  logit_scale =", float(m.logit_scale.exp()))

img = Image.open("photos-src/demo/大三巴牌坊-demo.jpg")
im_in = proc(images=img, return_tensors="pt").to(dev)
tx_in = proc(text=["a photo of a church facade", "a bowl of noodles"], return_tensors="pt", padding=True).to(dev)

with torch.no_grad():
    # A. 用 get_*_features
    a_img = m.get_image_features(**im_in); a_txt = m.get_text_features(**tx_in)
    # B. 手動走 vision_model / text_model + projection
    vo = m.vision_model(pixel_values=im_in["pixel_values"])
    img_pool = vo.pooler_output if hasattr(vo, "pooler_output") else vo[1]
    b_img = m.visual_projection(img_pool)
    to = m.text_model(input_ids=tx_in["input_ids"], attention_mask=tx_in["attention_mask"])
    txt_pool = to.pooler_output if hasattr(to, "pooler_output") else to[1]
    b_txt = m.text_projection(txt_pool)

def info(name, x):
    if torch.is_tensor(x):
        print(f"  {name:34} tensor {tuple(x.shape)}")
    else:
        print(f"  {name:34} {type(x).__name__} keys={list(x.keys()) if hasattr(x,'keys') else ''}")
info("get_image_features →", a_img); info("get_text_features →", a_txt)
print("  visual_projection:", m.visual_projection)
print("  text_projection  :", m.text_projection)

def norm(t):
    if not torch.is_tensor(t):
        t = getattr(t, "pooler_output", None)
        if t is None: t = t.last_hidden_state[:, 0]
    return t / t.norm(dim=-1, keepdim=True)

for tag, I, T in [("get_*_features", a_img, a_txt), ("手動 model+projection", b_img, b_txt)]:
    i2, t2 = norm(I), norm(T)
    sims = (i2 @ t2.T).squeeze(0)
    print(f"\n=== {tag} ===")
    print(f"  image dim={i2.shape[-1]}  text dim={t2.shape[-1]}")
    print(f"  'a photo of a church facade' = {float(sims[0]):+.3f}")
    print(f"  'a bowl of noodles'          = {float(sims[1]):+.3f}")
    print(f"  乘上 logit_scale 後的機率(softmax): {torch.softmax(sims*float(m.logit_scale.exp()), -1).tolist()}")
