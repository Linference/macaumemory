"""CLIP 評測用封裝：影像嵌入、文字嵌入、零樣本分類（正確的聚合順序）。

與 tools/photo-archive/pipeline.py 的差異（本檔為評測基準）：
    pipeline.py 先對「所有提示詞」做 softmax，再依類別平均 → 類別機率會被提示詞條數左右。
    這裡改成業界標準：先依類別平均「相似度(logits)」，再對類別做 softmax。
    兩種做法都會被 evaluate.py 一併輸出，用來量化差異。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "photo-archive"))

DEFAULT_MODEL = ROOT / ".cache" / "models" / "clip-vit-base-patch32"


class ClipScorer:
    def __init__(self, model_dir: Path | str | None = None, device: str | None = None):
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        path = Path(model_dir) if model_dir else DEFAULT_MODEL
        name = str(path) if path.exists() else "openai/clip-vit-base-patch32"
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = CLIPModel.from_pretrained(name).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(name)
        self.scale = float(self.model.logit_scale.exp()) if hasattr(self.model, "logit_scale") else 100.0
        self.model_name = name

    # ---------------------------------------------------------------- 嵌入
    def embed_images(self, paths, batch: int = 16) -> np.ndarray:
        from PIL import Image

        torch = self.torch
        feats = []
        with torch.no_grad():
            for i in range(0, len(paths), batch):
                chunk = paths[i:i + batch]
                imgs = [Image.open(p).convert("RGB") for p in chunk]
                inp = self.processor(images=imgs, return_tensors="pt").to(self.device)
                out = self.model.get_image_features(**inp)
                if not torch.is_tensor(out):
                    out = out.pooler_output
                out = out / out.norm(dim=-1, keepdim=True)
                feats.append(out.float().cpu().numpy())
        return np.concatenate(feats, 0) if feats else np.zeros((0, 512), np.float32)

    def embed_texts(self, texts) -> np.ndarray:
        torch = self.torch
        with torch.no_grad():
            inp = self.processor(text=list(texts), return_tensors="pt", padding=True, truncation=True).to(self.device)
            out = self.model.get_text_features(**inp)
            if not torch.is_tensor(out):
                out = out.pooler_output
            out = out / out.norm(dim=-1, keepdim=True)
        return out.float().cpu().numpy()

    # ---------------------------------------------------------------- 分類
    def taxonomy_vectors(self):
        """回傳 (class_ids, prompt_texts, class_index_of_prompt)。"""
        from taxonomy import TAXONOMY

        class_ids, prompts, owner = [], [], []
        for cid, _zh, _color, ps in TAXONOMY:
            class_ids.append(cid)
            for p in ps:
                prompts.append(p)
                owner.append(len(class_ids) - 1)
        return class_ids, prompts, np.asarray(owner, dtype=int)

    def classify(self, img_feats: np.ndarray, text_feats: np.ndarray, owner: np.ndarray, n_classes: int):
        """回傳 (probs_correct[N,C], probs_legacy[N,C], prompt_top1_idx[N])。"""
        sims = img_feats @ text_feats.T                       # [N, P]（已 L2 正規化 → 餘弦）
        # 標準：先依類別平均 logits，再對類別 softmax
        per_class = np.stack([sims[:, owner == c].mean(1) for c in range(n_classes)], 1) * self.scale
        e = np.exp(per_class - per_class.max(1, keepdims=True))
        probs_correct = e / e.sum(1, keepdims=True)
        # 舊版（pipeline.py 現行）：先對所有提示詞 softmax 再依類別平均
        ep = np.exp(sims * self.scale - (sims * self.scale).max(1, keepdims=True))
        pp = ep / ep.sum(1, keepdims=True)
        probs_legacy = np.stack([pp[:, owner == c].mean(1) for c in range(n_classes)], 1)
        return probs_correct, probs_legacy, sims.argmax(1)
