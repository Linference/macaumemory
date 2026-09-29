"""編碼器選型實驗：同一批參考照片上比較（CLS / GeM / CLS+GeM）×（TTA on/off）。

背景
    第一版用 DINOv2 ViT-S/14 + CLS-only + 336px 建庫，留一法檢索只有 Top-1 31%、
    AUC 0.583 —— 明顯不足以支撐「認出是哪一棟」。
    tools/eval 之前量到 AUC 0.998/0.796 的設定是 base + **CLS+GeM** + 518px，
    所以懷疑關鍵在「池化方式」與「解析度」。本檔在同一批照片上把變因拆開量。

用法
    python tools/recognize/ablation_pooling.py --model facebook/dinov2-small --size 336 \
        --pools cls,gem,cls+gem --eval
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_embeddings import BUILDINGS, collect_references  # noqa: E402

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(img: Image.Image, size: int) -> np.ndarray:
    w, h = img.size
    s = size / min(w, h)
    if s != 1.0:
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
    w, h = img.size
    left, top = (w - size) // 2, (h - size) // 2
    img = img.crop((left, top, left + size, top + size))
    a = np.asarray(img, np.float32) / 255.0
    a = (a - MEAN) / STD
    return np.transpose(a, (2, 0, 1))


def crops(img: Image.Image, size: int, n: int):
    out = [preprocess(img, size)]
    if n <= 1:
        return out
    w, h = img.size
    s = size / min(w, h)
    rw, rh = max(size, round(w * s)), max(size, round(h * s))
    rz = img.resize((rw, rh), Image.BICUBIC)
    for frac in (0.12, -0.12):
        dx, dy = int((rw - size) * frac), int((rh - size) * frac)
        left = min(max(0, (rw - size) // 2 + dx), rw - size)
        top = min(max(0, (rh - size) // 2 + dy), rh - size)
        out.append(preprocess(rz.crop((left, top, left + size, top + size)), size))
    return out


def pool(tokens, mode: str, p: float = 3.0):
    """tokens: (B, 1+N, C) → (B, C) 或 (B, 2C)"""
    import torch
    cls, patch = tokens[:, 0], tokens[:, 1:]
    gem = (patch.clamp(min=1e-6).pow(p).mean(dim=1)).pow(1.0 / p)
    if mode == "cls":
        return cls
    if mode == "gem":
        return gem
    return torch.cat([cls, gem], dim=-1)


def metrics(V: np.ndarray, ids: list[str]) -> dict:
    n = len(V)
    S = V @ V.T
    same, diff = [], []
    for i in range(n):
        for j in range(i + 1, n):
            (same if ids[i] == ids[j] else diff).append(S[i, j])
    same, diff = np.array(same), np.array(diff)
    allv = np.concatenate([same, diff])
    lab = np.concatenate([np.ones(len(same)), np.zeros(len(diff))])
    order = np.argsort(allv)
    ranks = np.empty(len(allv)); ranks[order] = np.arange(1, len(allv) + 1)
    auc = (ranks[lab == 1].sum() - len(same) * (len(same) + 1) / 2) / (len(same) * len(diff))

    per = defaultdict(list)
    for i, b in enumerate(ids):
        per[b].append(i)
    buildings = sorted(per)
    top1 = top3 = tot = 0
    margins, hit_sims = [], []
    for i in range(n):
        sc = {}
        for b in buildings:
            o = [j for j in per[b] if j != i]
            if o:
                sc[b] = float(np.max(S[i, o]))
        if ids[i] not in sc:
            continue
        r = sorted(sc.items(), key=lambda kv: -kv[1])
        pos = [b for b, _ in r].index(ids[i])
        tot += 1
        top1 += pos == 0
        top3 += pos < 3
        margins.append(r[0][1] - r[1][1] if len(r) > 1 else 1.0)
        hit_sims.append(sc[ids[i]])
    # 交叉域門檻參考：不同棟的 95% 分位
    return {
        "n": n,
        "same_mean": round(float(same.mean()), 4),
        "diff_mean": round(float(diff.mean()), 4),
        "diff_p95": round(float(np.percentile(diff, 95)), 4),
        "gap_same_minus_diffp95": round(float(same.mean() - np.percentile(diff, 95)), 4),
        "auc": round(float(auc), 4),
        "top1": round(top1 / tot, 4),
        "top3": round(top3 / tot, 4),
        "n_queries": tot,
        "hit_sim_mean": round(float(np.mean(hit_sims)), 4),
        "margin_mean": round(float(np.mean(margins)), 4),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="facebook/dinov2-small")
    ap.add_argument("--size", type=int, default=336)
    ap.add_argument("--pools", default="cls,gem,cls+gem")
    ap.add_argument("--tta", default="on", choices=["on", "off"])
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--out", default="tools/recognize/out/ablation.json")
    args = ap.parse_args()

    import torch
    from transformers import AutoModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(args.model).to(device).eval()
    hidden = model.config.hidden_size
    print(f"模型 {args.model} · size {args.size} · device {device} · hidden {hidden} · TTA {args.tta}")

    refs = collect_references()
    ids = [r["id"] for r in refs]
    print(f"參考影像 {len(refs)} 張 / {len(set(ids))} 棟")

    # 一次算完所有視圖，之後各池化方式共用（省時間）
    modes = args.pools.split(",")
    tta = args.tta == "on"
    results = {}
    feats: dict[str, list[np.ndarray]] = {m: [] for m in modes}
    t0 = time.time()
    for i, r in enumerate(refs, 1):
        try:
            img = Image.open(r["path"]).convert("RGB")
        except Exception as e:
            print(f"  !! {r['path']}: {e}")
            continue
        views = crops(img, args.size, 3 if tta else 1)
        if tta:
            views = views + [v[:, :, ::-1].copy() for v in views]
        with torch.no_grad():
            x = torch.from_numpy(np.stack(views, 0)).to(device)
            out = model(pixel_values=x, interpolate_pos_encoding=True)
            tokens = out.last_hidden_state
            for m in modes:
                v = pool(tokens, m)
                v = v / v.norm(dim=-1, keepdim=True)
                v = v.mean(0).cpu().numpy()
                feats[m].append(v / np.linalg.norm(v))
        if i % 20 == 0:
            print(f"  {i}/{len(refs)} … {time.time()-t0:.0f}s")

    for m in modes:
        V = np.stack(feats[m], 0).astype(np.float32)
        mt = metrics(V, ids)
        mt["dim"] = int(V.shape[1])
        results[f"{args.model}@{args.size}px/{m}/{'tta' if tta else 'notta'}"] = mt
        print(f"\n[{m}] dim={mt['dim']} AUC={mt['auc']} Top-1={mt['top1']*100:.1f}% Top-3={mt['top3']*100:.1f}%"
              f" 同棟均值={mt['same_mean']} 不同棟均值={mt['diff_mean']} 不同棟95%={mt['diff_p95']}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    prev = json.load(open(out, encoding="utf-8")) if out.is_file() else {}
    prev.update(results)
    out.write_text(json.dumps(prev, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {out}（累積 {len(prev)} 組設定）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
