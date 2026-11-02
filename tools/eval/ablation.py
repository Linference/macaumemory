"""GMVR 消融實驗：每次只改一個變量，在同一個參考庫（38 棟／335 張）上做留一法，比較 Top-1 / Top-3。

基準（與網站 src/recognize 一致）
    參考庫：DINOv2 ViT-S/14 ONNX（public/models/dinov2-vits14-336.onnx），整張圖三裁切 + 水平翻轉取平均
    查詢：YOLO（macau-buildings-best）信心最高的框 → 裁切 → 該框 + 翻轉；偵測不到就用整張圖三裁切 + 翻轉
    比對：每棟取「其餘參考照片的最高相似度」；YOLO 類別與該棟類別一致時 +0.02（網站 compare.js 的 clsHint）
變體（每個只改一項）
    A1 不用 YOLO 裁切（查詢用整張圖）        A2 查詢不做多裁切與翻轉
    A3 每棟取所有參考照片的平均向量（質心）    A4 不用類別提示
    A5 DINOv2-base（參考庫與查詢都換）        A6 CLIP ViT-B/32（參考庫與查詢都換）
    M  多視角：同棟 3 張照片當一組查詢（三張都不留在庫中），比較「第一張單拍」與「三張平均」
位置輔助需要帶 GPS 的實地照片，參考庫的公開照片沒有拍攝位置，本腳本不測（待實地採集後用 independent-eval.mjs）。

統計：Top-1/Top-3 附 Wilson 95% 信賴區間；與基準逐張配對，用 McNemar 精確檢定（雙尾二項檢定）。
說明：本腳本由 AI 程式助手（Claude）協助撰寫；結果解讀由研究者負責。

用法：python tools/eval/ablation.py            # 首次會計算並快取向量到 tools/eval/out/ablation-cache/
      python tools/eval/ablation.py --fresh    # 忽略快取重算
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
import build_embeddings as be  # noqa: E402  （共用參考庫名冊、前處理、編碼器）

OUT = ROOT / "tools" / "eval" / "out"
CACHE = OUT / "ablation-cache"
ONNX = ROOT / "public" / "models" / "dinov2-vits14-336.onnx"
YOLO = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
CLS_BONUS = 0.02
SEED = 20261101


# ─────────── 統計 ───────────
def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def mcnemar_exact(a: np.ndarray, b: np.ndarray) -> dict:
    """a、b 為同一批查詢的對錯（bool）。b01 = 基準錯而變體對，b10 = 基準對而變體錯。"""
    b01 = int(np.sum(~a & b)); b10 = int(np.sum(a & ~b)); n = b01 + b10
    if n == 0:
        return {"b01": 0, "b10": 0, "p": 1.0}
    k = min(b01, b10)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n * 2
    return {"b01": b01, "b10": b10, "p": round(min(1.0, p), 4)}


# ─────────── 編碼 ───────────
def load_img(p: Path) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(p)).convert("RGB")


class OnnxSingle(be.OnnxEncoder):
    """可切換：多裁切（3）或只用置中一張；翻轉 TTA 開或關；可先裁 YOLO 框。"""

    def embed_one(self, im: Image.Image, n_crop: int = 3, flip: bool = True) -> np.ndarray:
        batch = be._crops(im, n_crop=n_crop)
        if flip:
            batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
        out = self.sess.run(None, {self.input: np.concatenate(batch, 0)})[0]
        out = out / np.linalg.norm(out, axis=-1, keepdims=True)
        v = out.mean(0)
        return (v / np.linalg.norm(v)).astype(np.float32)


class ClipEncoder:
    def __init__(self):
        import torch
        from transformers import CLIPModel
        self.torch = torch
        self.dev = "cuda" if torch.cuda.is_available() else "cpu"
        self.m = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(self.dev).eval()
        self.mean = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
        self.std = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)

    def embed_one(self, im: Image.Image, n_crop: int = 3, flip: bool = True) -> np.ndarray:
        torch = self.torch
        batch = []
        for b in be._crops(im, size=224, n_crop=n_crop):           # 先用 DINO 的 ImageNet 正規化取裁切，再換回 CLIP 正規化
            x = b[0].transpose(1, 2, 0) * be.STD + be.MEAN
            batch.append(((x - self.mean) / self.std).transpose(2, 0, 1)[None].astype(np.float32))
        if flip:
            batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
        with torch.no_grad():
            f = self.m.get_image_features(pixel_values=torch.from_numpy(np.concatenate(batch, 0)).to(self.dev))
        f = getattr(f, "pooler_output", f)
        f = (f / f.norm(dim=-1, keepdim=True)).mean(0).cpu().numpy()
        return (f / np.linalg.norm(f)).astype(np.float32)


class TorchDino:
    def __init__(self, model_id: str):
        self.enc = be.TorchEncoder(model_id)

    def embed_one(self, im: Image.Image, n_crop: int = 3, flip: bool = True) -> np.ndarray:
        torch = self.enc.torch
        batch = be._crops(im, n_crop=n_crop)
        if flip:
            batch = batch + [b[:, :, :, ::-1].copy() for b in batch]
        with torch.no_grad():
            out = self.enc.model(pixel_values=torch.from_numpy(np.concatenate(batch, 0)).to(self.enc.device)).last_hidden_state[:, 0]
        out = (out / out.norm(dim=-1, keepdim=True)).mean(0).cpu().numpy()
        return (out / np.linalg.norm(out)).astype(np.float32)


def yolo_boxes(paths: list[Path]) -> list[dict | None]:
    from ultralytics import YOLO
    m = YOLO(str(YOLO_PATH))
    res = []
    for p in paths:
        r = m.predict(str(p), conf=0.25, iou=0.45, verbose=False)[0]
        if r.boxes is None or len(r.boxes) == 0:
            res.append(None); continue
        i = int(r.boxes.conf.argmax())
        x1, y1, x2, y2 = (float(v) for v in r.boxes.xyxy[i])
        res.append({"box": [x1, y1, x2, y2], "cls": m.names[int(r.boxes.cls[i])], "score": float(r.boxes.conf[i])})
    return res


YOLO_PATH = YOLO


def cached(name: str, fn, fresh: bool):
    f = CACHE / f"{name}.npy"
    if f.exists() and not fresh:
        return np.load(f)
    v = fn(); np.save(f, v); return v


# ─────────── 檢索 ───────────
def scores_matrix(Q: np.ndarray, R: np.ndarray, y: np.ndarray, nb: int, centroid: bool, exclude_self: bool, mask_rows=None):
    """回傳 (nq, nb) 每棟分數；exclude_self 時第 i 個查詢不與第 i 張參考比（留一法）。"""
    S = Q @ R.T
    if exclude_self:
        np.fill_diagonal(S, -np.inf)
    if mask_rows is not None:
        S[:, mask_rows] = -np.inf
    out = np.full((len(Q), nb), -np.inf, np.float32)
    for b in range(nb):
        cols = np.where(y == b)[0]
        if not len(cols):
            continue
        if centroid:
            for i in range(len(Q)):
                keep = cols[np.isfinite(S[i, cols])]
                if len(keep):
                    c = R[keep].mean(0); c /= np.linalg.norm(c)
                    out[i, b] = float(Q[i] @ c)
        else:
            out[:, b] = S[:, cols].max(1)
    return out


def evaluate(sc: np.ndarray, y: np.ndarray, valid: np.ndarray):
    order = np.argsort(-sc, 1)
    rank = np.array([int(np.where(order[i] == y[i])[0][0]) + 1 for i in range(len(y))])
    top1 = (rank == 1) & valid; top3 = (rank <= 3) & valid
    return top1[valid], top3[valid], rank


def summarize(name: str, desc: str, t1: np.ndarray, t3: np.ndarray, base_t1=None) -> dict:
    n = len(t1); k1 = int(t1.sum()); k3 = int(t3.sum())
    d = {"name": name, "desc": desc, "n": n, "top1": round(k1 / n, 4), "top1_ci": [round(x, 4) for x in wilson(k1, n)],
         "top3": round(k3 / n, 4), "top3_ci": [round(x, 4) for x in wilson(k3, n)]}
    if base_t1 is not None:
        d["mcnemar_vs_base"] = mcnemar_exact(base_t1, t1)
    return d


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--fresh", action="store_true"); a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    refs = be.collect_references()
    paths = [r["path"] for r in refs]
    ids = sorted({r["id"] for r in refs}); idx = {b: i for i, b in enumerate(ids)}
    y = np.array([idx[r["id"]] for r in refs]); nb = len(ids)
    cls_of = np.array([be.BUILDINGS[b]["cls"] for b in ids])
    counts = np.bincount(y, minlength=nb); valid = counts[y] >= 2          # 只有一張的棟別無法當查詢
    print(f"參考照片 {len(refs)} 張、{nb} 棟；可作查詢 {int(valid.sum())} 張")
    imgs = None

    def images():
        nonlocal imgs
        if imgs is None:
            imgs = [load_img(p) for p in paths]
        return imgs

    onnx = None

    def enc_onnx():
        nonlocal onnx
        if onnx is None:
            onnx = OnnxSingle(ONNX)
        return onnx

    R = cached("ref-small-tta", lambda: np.stack([enc_onnx().embed_one(im) for im in images()]), a.fresh)
    Q_full_notta = cached("q-small-full-notta", lambda: np.stack([enc_onnx().embed_one(im, n_crop=1, flip=False) for im in images()]), a.fresh)
    det_file = CACHE / "yolo.json"
    if det_file.exists() and not a.fresh:
        dets = json.loads(det_file.read_text(encoding="utf-8"))
    else:
        dets = yolo_boxes(paths); det_file.write_text(json.dumps(dets), encoding="utf-8")

    def crop_vecs():
        out = []
        for im, d in zip(images(), dets):
            if d is None:
                out.append(enc_onnx().embed_one(im))               # 網站：偵測不到就整張圖三裁切 + 翻轉
            else:
                x1, y1, x2, y2 = d["box"]
                out.append(enc_onnx().embed_one(im.crop((int(x1), int(y1), int(math.ceil(x2)), int(math.ceil(y2)))), n_crop=1, flip=True))
        return np.stack(out)
    Q_yolo = cached("q-small-yolo", crop_vecs, a.fresh)
    det_cls = np.array([d["cls"] if d else "" for d in dets])

    def bonus(sc, use=True):
        if not use:
            return sc
        sc = sc.copy()
        for i, c in enumerate(det_cls):
            if c:
                sc[i, cls_of == c] += CLS_BONUS
        return sc

    rows = []
    base = bonus(scores_matrix(Q_yolo, R, y, nb, centroid=False, exclude_self=True))
    b1, b3, _ = evaluate(base, y, valid)
    outcomes = {"B": b1}                     # 每張查詢的 Top-1 對錯，供繪圖（tools/eval/figures_nature.py）
    rows.append(summarize("B", "基準（網站現行流程）：YOLO 裁切＋翻轉・每棟取最高分・類別提示", b1, b3))
    variants = [
        ("A1", "不用 YOLO 裁切（查詢用整張圖三裁切＋翻轉）", bonus(scores_matrix(R, R, y, nb, False, True), use=False)),
        ("A2", "查詢不做多裁切與翻轉（整張圖置中一張）", bonus(scores_matrix(Q_full_notta, R, y, nb, False, True), use=False)),
        ("A3", "每棟取參考照片平均向量（質心）", bonus(scores_matrix(Q_yolo, R, y, nb, True, True))),
        ("A4", "不用 YOLO 類別提示", scores_matrix(Q_yolo, R, y, nb, False, True)),
    ]
    # A2 與 A1 只差「多裁切＋翻轉」一項（都用整張圖），故與 A1 配對；其餘與基準配對
    a1_t1, _, _ = evaluate(variants[0][2], y, valid)
    for name, desc, sc in variants:
        t1, t3, _ = evaluate(sc, y, valid); outcomes[name] = t1
        if name == "A2":
            d = summarize(name, desc, t1, t3); d["mcnemar_vs_A1"] = mcnemar_exact(a1_t1, t1); rows.append(d)
        else:
            rows.append(summarize(name, desc, t1, t3, b1))
        print(rows[-1])

    # 編碼器替換：參考庫與查詢都用同一個編碼器，整張圖三裁切＋翻轉（與 A1 同口徑，故與 A1 配對比較）
    for name, desc, key, mk in (("A5", "DINOv2-base（大模型，整張圖）", "dino-base", lambda: TorchDino("facebook/dinov2-base")),
                                ("A6", "CLIP ViT-B/32（整張圖）", "clip-b32", ClipEncoder)):
        def run(mk=mk):
            e = mk(); return np.stack([e.embed_one(im) for im in images()])
        V = cached(f"ref-{key}", run, a.fresh)
        t1, t3, _ = evaluate(scores_matrix(V, V, y, nb, False, True), y, valid); outcomes[name] = t1
        d = summarize(name, desc, t1, t3); d["mcnemar_vs_A1"] = mcnemar_exact(a1_t1, t1); rows.append(d); print(d)

    # 多視角：同棟取 3 張當一組（不留在庫中），其餘照片當參考庫
    rng = np.random.default_rng(SEED)
    single, multi, groups = [], [], 0
    margin_single, margin_multi = [], []     # 正確建築分數 − 最高的其他建築分數
    for b in range(nb):
        mem = np.where(y == b)[0]
        if len(mem) < 4:
            continue
        mem = rng.permutation(mem)
        for g in range(len(mem) // 3):
            grp = mem[g * 3:(g + 1) * 3]
            S =scores_matrix(Q_yolo[grp], R, y, nb, centroid=False, exclude_self=False, mask_rows=grp)
            for k, i in enumerate(grp):
                if det_cls[i]:
                    S[k, cls_of == det_cls[i]] += CLS_BONUS
            single.append(int(np.argmax(S[0])) == b)
            fused = np.where(np.isfinite(S), S, -9).mean(0)
            multi.append(int(np.argmax(fused)) == b)
            margin_single.append(float(S[0, b] - np.max(np.delete(S[0], b))))
            margin_multi.append(float(fused[b] - np.max(np.delete(fused, b))))
            groups += 1
    single, multi = np.array(single), np.array(multi)
    mv = {"name": "M", "desc": "多視角：同棟三張一組（三張都不在庫中），第一張單拍 vs 三張平均", "groups": groups,
          "single_top1": round(float(single.mean()), 4), "single_ci": [round(x, 4) for x in wilson(int(single.sum()), groups)],
          "multi_top1": round(float(multi.mean()), 4), "multi_ci": [round(x, 4) for x in wilson(int(multi.sum()), groups)],
          "mcnemar": mcnemar_exact(single, multi)}
    print(mv)

    det_rate = sum(1 for d in dets if d) / len(dets)
    out = {"generated_by": "tools/eval/ablation.py", "seed": SEED, "n_refs": len(refs), "n_buildings": nb, "n_queries": int(valid.sum()),
           "yolo_detect_rate": round(det_rate, 4), "rows": rows, "multiview": mv,
           "not_tested": "位置輔助：參考庫照片沒有拍攝 GPS，需實地採集後以 independent-eval.mjs 測試"}
    np.savez(OUT / "ablation-outcomes.npz", **outcomes, mv_single=single, mv_multi=multi,
             mv_margin_single=np.array(margin_single), mv_margin_multi=np.array(margin_multi))
    (OUT / "ablation.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["| 代號 | 設定 | Top-1 (95% CI) | Top-3 (95% CI) | McNemar（對照） |", "|---|---|---|---|---|"]
    for r in rows:
        mc = r.get("mcnemar_vs_base") or r.get("mcnemar_vs_A1")
        ref = "基準" if "mcnemar_vs_base" in r else "A1"
        mcs = f"對{ref}：+{mc['b01']}／−{mc['b10']}，p = {mc['p']}" if mc else "—"
        md.append(f"| {r['name']} | {r['desc']} | {r['top1']:.2%} ({r['top1_ci'][0]:.1%}–{r['top1_ci'][1]:.1%}) | {r['top3']:.2%} ({r['top3_ci'][0]:.1%}–{r['top3_ci'][1]:.1%}) | {mcs} |")
    md.append(f"\n多視角（{groups} 組）：單拍 {mv['single_top1']:.1%}，三張平均 {mv['multi_top1']:.1%}；McNemar +{mv['mcnemar']['b01']}／−{mv['mcnemar']['b10']}，p = {mv['mcnemar']['p']}")
    md.append(f"\nYOLO 偵測到建築的比例：{det_rate:.1%}。位置輔助未測（參考庫照片無拍攝 GPS）。")
    (OUT / "ablation.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
