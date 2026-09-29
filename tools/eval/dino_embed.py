"""DINOv2 評測用封裝：與 clip_embed.ClipScorer 同介面，可直接替換做 A/B 對照。

為什麼換掉 CLIP：
    CLIP 是「影像—文字對比」訓練出來的，特徵偏向語意類別，對「同一棟建築的不同角度」
    這種細粒度個體辨識天生不利；DINOv2 是純視覺自監督，特徵保留更多實例細節，
    是目前 VPR（視覺場所重辨識）領域的主流骨幹。

與 SALAD 的關係：
    SALAD 是 DINOv2 之上的聚合器（把 patch 特徵聚合成固定長度描述子）。
    本檔先實作「CLS ＋ GeM 雙池化 ＋ 多尺度 ＋ 水平翻轉平均」這個穩定且可解釋的版本，
    之後若要接 SALAD 只需替換 _pool()，其餘流程不變。

用法：
    from dino_embed import DinoScorer
    s = DinoScorer("facebook/dinov2-base", size=518)
    feats = s.embed_images([...])        # 已 L2 正規化，維度 = 768×2（cls+gem）
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))

DEFAULT_MODEL = "facebook/dinov2-base"


class DinoScorer:
    def __init__(self, model_id: str = DEFAULT_MODEL, device: str | None = None,
                 size: int = 518, pool: str = "cls+gem", tta: bool = True, resize: str = "squash"):
        import torch
        from transformers import AutoImageProcessor, AutoModel

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = AutoModel.from_pretrained(model_id).to(self.device).eval()
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.size = size
        self.pool = pool
        self.tta = tta
        self.resize = resize
        self.hidden = int(self.model.config.hidden_size)
        self.dim = self.hidden * (2 if pool == "cls+gem" else 1)
        self.scale = 1.0                      # DINOv2 無 logit_scale；相似度即餘弦
        self.model_name = f"{model_id}@{size}px/{pool}/{resize}{'+tta' if tta else '-notta'}"

    # ---------------------------------------------------------------- 池化
    def _pool(self, out, torch):
        """CLS token 與 patch token 的 GeM 池化，回傳 (B, hidden) 或 (B, 2*hidden)。"""
        if self.pool == "cls":
            return out.last_hidden_state[:, 0]
        patch = out.last_hidden_state[:, 1:]                 # (B, N, C)
        # GeM：p=3 比平均池化更強調顯著特徵（VPR 常用）
        p = 3.0
        gem = (patch.clamp(min=1e-6).pow(p).mean(dim=1)).pow(1.0 / p)
        if self.pool == "gem":
            return gem
        return torch.cat([out.last_hidden_state[:, 0], gem], dim=-1)

    def _forward_batch(self, imgs):
        torch = self.torch
        variants = [imgs]
        if self.tta:
            # PIL Image.transpose(0) = FLIP_LEFT_RIGHT（水平翻轉）；建築左右翻轉仍是同一棟
            variants.append([im.transpose(0) for im in imgs])
        vecs = []
        for batch_imgs in variants:
            inp = self.processor(images=batch_imgs, return_tensors="pt",
                                 size={"height": self.size, "width": self.size}).to(self.device)
            with torch.no_grad():
                out = self.model(**inp)
            v = self._pool(out, torch)
            v = v / v.norm(dim=-1, keepdim=True)
            vecs.append(v)
        v = torch.stack(vecs, 0).mean(0)
        v = v / v.norm(dim=-1, keepdim=True)
        return v

    # ---------------------------------------------------------------- 嵌入
    def embed_images(self, paths, batch: int = 8) -> np.ndarray:
        from PIL import Image

        feats = []
        for i in range(0, len(paths), batch):
            chunk = paths[i:i + batch]
            imgs = [Image.open(p).convert("RGB") for p in chunk]
            feats.append(self._forward_batch(imgs).float().cpu().numpy())
        return np.concatenate(feats, 0) if feats else np.zeros((0, self.dim), np.float32)

    # ---------------------------------------------------------------- 文字（DINOv2 無文字塔）
    def embed_texts(self, texts) -> np.ndarray:
        raise NotImplementedError("DINOv2 是純視覺模型，沒有文字塔；零樣本分類請改用 VLM 標註後訓練線性探針")

    def taxonomy_vectors(self):
        raise NotImplementedError("DINOv2 不支援文字提示詞分類")

    def classify(self, *a, **k):
        raise NotImplementedError("DINOv2 不支援零樣本分類；分類請用 tools/eval/probe_classifier.py 的線性探針")


def build_scorer(encoder: str, **kw):
    """依名稱建立編碼器：clip（原基準）或 dino（新）。"""
    if encoder == "clip":
        from clip_embed import ClipScorer
        return ClipScorer(**{k: v for k, v in kw.items() if k in ("model_dir", "device")})
    if encoder in ("dino", "dinov2"):
        return DinoScorer(**{k: v for k, v in kw.items() if k in ("model_id", "device", "size", "pool", "tta", "resize")})
    raise SystemExit(f"未知編碼器：{encoder}（可用 clip / dino）")


if __name__ == "__main__":
    # 快速自測：載入模型並嵌入兩張圖，確認維度與 CUDA 可用
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--size", type=int, default=518)
    ap.add_argument("--images", default=None, help="逗號分隔；預設抓兩張資料集圖")
    args = ap.parse_args()
    s = DinoScorer(args.model, size=args.size)
    print(f"[dino] {s.model_name} · 裝置 {s.device} · 維度 {s.dim}")
    if args.images:
        paths = args.images.split(",")
    else:
        import glob
        paths = (glob.glob(str(ROOT / "datasets/macau-buildings/images/raw/temple/*.jpg"))[:2])
    f = s.embed_images(paths)
    print(f"  嵌入 {f.shape}；任兩張餘弦 = {float(f[0] @ f[1]):.4f}" if len(f) > 1 else f"  嵌入 {f.shape}")
